import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ORCHESTRATOR_IDLE_STOP_MS = 20_000;

export type TranslatorSessionConfig = {
  room: string;
  sourceLanguage: string;
  targetLanguage: string;
  voice: string;
  apiBaseUrl: string;
  livekitUrl: string;
};

type ManagedSession = {
  room: string;
  process: ChildProcess;
  pid: number;
  config: TranslatorSessionConfig;
  owners: Set<string>;
  startedAt: number;
  lastTouchedAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

const normalize = (value: string) => value.trim().toLowerCase();

const sameConfig = (left: TranslatorSessionConfig, right: TranslatorSessionConfig) =>
  normalize(left.sourceLanguage) === normalize(right.sourceLanguage) &&
  normalize(left.targetLanguage) === normalize(right.targetLanguage) &&
  normalize(left.voice) === normalize(right.voice) &&
  normalize(left.apiBaseUrl) === normalize(right.apiBaseUrl) &&
  normalize(left.livekitUrl) === normalize(right.livekitUrl);

const getWorkerPath = () => {
  return path.resolve(process.cwd(), "server/workers/livekit-translator/index.mjs");
};

const streamLogs = (room: string, stream: NodeJS.ReadableStream, level: "log" | "error") => {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += String(chunk || "");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    lines.forEach((line) => {
      const clean = line.trim();
      if (!clean) return;
      const text = `[translator:${room}] ${clean}`;
      if (level === "error") {
        console.error(text);
      } else {
        console.log(text);
      }
    });
  });
};

class LivekitTranslatorOrchestrator {
  private sessions = new Map<string, ManagedSession>();

  ensure(ownerKey: string, config: TranslatorSessionConfig) {
    const room = config.room.trim();
    if (!room) {
      throw new Error("Room id missing for translator orchestrator.");
    }
    const current = this.sessions.get(room);

    if (current && sameConfig(current.config, config)) {
      current.owners.add(ownerKey);
      current.lastTouchedAt = Date.now();
      if (current.idleTimer) {
        clearTimeout(current.idleTimer);
        current.idleTimer = null;
      }
      return {
        status: "running" as const,
        room,
        pid: current.pid,
        owners: current.owners.size,
        startedAt: current.startedAt,
        reconfigured: false,
      };
    }

    if (current) {
      this.stopRoom(room, "reconfigure");
    }

    const session = this.spawnSession(ownerKey, config);
    this.sessions.set(room, session);
    return {
      status: "running" as const,
      room,
      pid: session.pid,
      owners: session.owners.size,
      startedAt: session.startedAt,
      reconfigured: Boolean(current),
    };
  }

  release(ownerKey: string, roomInput: string) {
    const room = roomInput.trim();
    const session = this.sessions.get(room);
    if (!session) {
      return {
        status: "not_found" as const,
        room,
      };
    }

    const hadOwner = session.owners.has(ownerKey);
    if (!hadOwner && session.owners.size === 0) {
      return {
        status: "idle" as const,
        room,
        pid: session.pid,
        owners: 0,
        stoppingInMs: ORCHESTRATOR_IDLE_STOP_MS,
      };
    }

    session.owners.delete(ownerKey);
    session.lastTouchedAt = Date.now();
    if (session.owners.size === 0) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => {
        this.stopRoom(room, "idle_timeout");
      }, ORCHESTRATOR_IDLE_STOP_MS);
    }

    return {
      status: "released" as const,
      room,
      pid: session.pid,
      owners: session.owners.size,
      stoppingInMs: session.owners.size === 0 ? ORCHESTRATOR_IDLE_STOP_MS : 0,
    };
  }

  stopRoom(roomInput: string, reason = "manual") {
    const room = roomInput.trim();
    const session = this.sessions.get(room);
    if (!session) {
      return { status: "not_found" as const, room };
    }

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }

    this.sessions.delete(room);
    try {
      session.process.kill("SIGTERM");
    } catch {}

    const killTimer = setTimeout(() => {
      try {
        if (!session.process.killed) {
          session.process.kill("SIGKILL");
        }
      } catch {}
    }, 1500);
    const maybeNodeTimer = killTimer as unknown as { unref?: () => void };
    maybeNodeTimer.unref?.();

    return {
      status: "stopped" as const,
      room,
      reason,
      pid: session.pid,
    };
  }

  getStatus(roomInput?: string) {
    const room = roomInput?.trim() || "";
    if (room) {
      const session = this.sessions.get(room);
      if (!session) return [];
      return [this.serialize(session)];
    }
    return Array.from(this.sessions.values()).map((session) => this.serialize(session));
  }

  private spawnSession(ownerKey: string, config: TranslatorSessionConfig): ManagedSession {
    const workerSecret = (process.env.TRANSLATOR_WORKER_SECRET || "").trim();
    if (!workerSecret) {
      throw new Error("TRANSLATOR_WORKER_SECRET is missing on backend runtime.");
    }

    const scriptPath = getWorkerPath();
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Translator worker script not found: ${scriptPath}`);
    }
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TRANSLATOR_API_BASE_URL: config.apiBaseUrl,
        LIVEKIT_URL: config.livekitUrl,
        TRANSLATOR_WORKER_SECRET: workerSecret,
        TRANSLATOR_ROOM: config.room,
        TRANSLATOR_SOURCE_LANGUAGE: config.sourceLanguage,
        TRANSLATOR_TARGET_LANGUAGE: config.targetLanguage,
        TRANSLATOR_VOICE: config.voice,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (!child.pid) {
      throw new Error("Unable to start translator worker process.");
    }

    streamLogs(config.room, child.stdout, "log");
    streamLogs(config.room, child.stderr, "error");

    const session: ManagedSession = {
      room: config.room,
      process: child,
      pid: child.pid,
      config,
      owners: new Set([ownerKey]),
      startedAt: Date.now(),
      lastTouchedAt: Date.now(),
      idleTimer: null,
    };

    child.on("exit", (code, signal) => {
      const current = this.sessions.get(config.room);
      if (!current || current.pid !== session.pid) return;
      this.sessions.delete(config.room);
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      console.warn(`[translator:${config.room}] worker exited (${reason})`);
    });

    return session;
  }

  private serialize(session: ManagedSession) {
    return {
      room: session.room,
      pid: session.pid,
      owners: session.owners.size,
      startedAt: session.startedAt,
      lastTouchedAt: session.lastTouchedAt,
      sourceLanguage: session.config.sourceLanguage,
      targetLanguage: session.config.targetLanguage,
      voice: session.config.voice,
      apiBaseUrl: session.config.apiBaseUrl,
      livekitUrl: session.config.livekitUrl,
    };
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __bfzoomTranslatorOrchestrator:
    | LivekitTranslatorOrchestrator
    | undefined;
}

export const getLivekitTranslatorOrchestrator = () => {
  if (!globalThis.__bfzoomTranslatorOrchestrator) {
    globalThis.__bfzoomTranslatorOrchestrator = new LivekitTranslatorOrchestrator();
  }
  return globalThis.__bfzoomTranslatorOrchestrator;
};
