import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type RealtimePcmStartOptions = {
  sampleRate?: number;
  chunkMs?: number;
};

type RealtimePcmChunk = {
  audio: string;
  sampleRate: number;
  capturedAt: number;
};

type RealtimePcmCallbacks = {
  onChunk: (chunk: RealtimePcmChunk) => void;
  onError?: (message: string) => void;
  onState?: (state: string) => void;
};

type RealtimePcmNativeModule = {
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
  start: (options?: RealtimePcmStartOptions) => Promise<void>;
  stop: () => Promise<void>;
  appendPcmBase64: (audioBase64: string) => Promise<void>;
  clearPlaybackQueue?: () => Promise<void>;
  setVirtualBackgroundEnabled?: (enabled: boolean) => Promise<void>;
  setVirtualBackgroundImageUrl?: (url: string) => Promise<void>;
};

export type RealtimePcmBridge = {
  start: (options?: RealtimePcmStartOptions) => Promise<void>;
  stop: () => Promise<void>;
  appendPcmBase64: (audioBase64: string) => Promise<void>;
  clearPlaybackQueue: () => Promise<void>;
  dispose: () => void;
};

const nativeModule = NativeModules.RealtimePcmModule as RealtimePcmNativeModule | undefined;

export const isNativeRealtimePcmAvailable = () => {
  return Platform.OS === "ios" && Boolean(nativeModule);
};

export const createRealtimePcmBridge = ({
  onChunk,
  onError,
  onState,
}: RealtimePcmCallbacks): RealtimePcmBridge => {
  if (!isNativeRealtimePcmAvailable() || !nativeModule) {
    throw new Error("Native realtime PCM module unavailable on this device.");
  }

  const emitter = new NativeEventEmitter(nativeModule);
  const chunkSub = emitter.addListener("pcmChunk", (event: Record<string, unknown>) => {
    const audio = String(event?.audio || "");
    if (!audio) return;
    const sampleRate = Number(event?.sampleRate || 24_000);
    const capturedAt = Number(event?.capturedAt || Date.now());
    onChunk({ audio, sampleRate, capturedAt });
  });
  const errorSub = emitter.addListener("pcmError", (event: Record<string, unknown>) => {
    if (!onError) return;
    const message = String(event?.message || "Native audio error.");
    onError(message);
  });
  const stateSub = emitter.addListener("pcmState", (event: Record<string, unknown>) => {
    if (!onState) return;
    onState(String(event?.state || "unknown"));
  });

  let disposed = false;

  return {
    start: async (options) => {
      if (disposed) return;
      await nativeModule.start(options);
    },
    stop: async () => {
      if (disposed) return;
      await nativeModule.stop();
    },
    appendPcmBase64: async (audioBase64: string) => {
      if (disposed || !audioBase64) return;
      await nativeModule.appendPcmBase64(audioBase64);
    },
    clearPlaybackQueue: async () => {
      if (disposed || !nativeModule.clearPlaybackQueue) return;
      await nativeModule.clearPlaybackQueue();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      chunkSub.remove();
      errorSub.remove();
      stateSub.remove();
    },
  };
};

export const configureNativeVirtualBackground = async ({
  enabled,
  imageUrl,
}: {
  enabled: boolean;
  imageUrl?: string;
}) => {
  if (!isNativeRealtimePcmAvailable() || !nativeModule) return;
  const normalizedUrl = (imageUrl || "").trim();

  if (nativeModule.setVirtualBackgroundImageUrl) {
    await nativeModule.setVirtualBackgroundImageUrl(normalizedUrl);
  }
  if (nativeModule.setVirtualBackgroundEnabled) {
    await nativeModule.setVirtualBackgroundEnabled(enabled);
  }
};
