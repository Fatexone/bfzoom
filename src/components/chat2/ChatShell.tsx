"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/types/User";
import type { Chat, ChatMessage } from "@/types/Chat";
import type { Contact } from "@/types/Contact";
import ChatSidebar from "./ChatSidebar";
import ChatThread from "./ChatThread";
import ChatComposer, {
  CHAT_LANGUAGE_OPTIONS,
  type ChatComposerHandle,
  type ChatLanguageCode,
} from "./ChatComposer";
import {
  createGroupChat,
  addGroupMembers,
  markChatRead,
  removeGroupMember,
  sendAttachmentMessage,
  sendTextMessage,
  sendVoiceMessage,
} from "./chatApi";
import {
  useChatList,
  useChatMessages,
  useContacts,
  useParticipantIds,
  useChatReadMap,
  useUserMap,
} from "./chatHooks";
import ChatGroupModal from "./ChatGroupModal";
import ChatGroupManageModal from "./ChatGroupManageModal";
import { auth, db } from "@/lib/firebaseConfig";
import { acceptCall, endCall, startCall, useCallState } from "@/lib/calls";
import {
  appendCallHistory,
  markMissedCallsAsRead,
  subscribeMissedCalls,
  subscribeUnreadMissedCallsCount,
  type MissedCallEntry,
} from "@/lib/callHistory";
import LiveKitCall from "@/components/video/LiveKit/LiveKitCall";
import { getIdToken } from "firebase/auth";
import { collection, deleteDoc, doc, getDocs, onSnapshot, updateDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { canUseCredit, incrementCredit } from "./credits";
import UpgradeModal from "./UpgradeModal";
import { consumeAiTokens } from "@/lib/tokensClient";
import { ADMIN_EMAIL } from "@/config/constants";

const TOKEN_COSTS: Record<"improve" | "summary", number> = {
  improve: 1,
  summary: 2,
};
const CHAT_TRANSLATION_MAX_SECONDS_PER_MESSAGE = 24;

type ChatTranslationEntitlementState = {
  enabled: boolean;
  lockReason: string;
  loading: boolean;
  isPremium: boolean;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
};

type UpgradePrompt = {
  title: string;
  message: string;
  ctaLabel: string;
};

const DEFAULT_CHAT_TRANSLATION_ENTITLEMENT: ChatTranslationEntitlementState = {
  enabled: true,
  lockReason: "",
  loading: true,
  isPremium: false,
  totalSecondsRemaining: 180,
  freeSecondsRemaining: 180,
  paidSecondsRemaining: 0,
};

const DEFAULT_UPGRADE_PROMPT: UpgradePrompt = {
  title: "Passe en Premium",
  message: "Débloque les résumés IA et la correction illimitée.",
  ctaLabel: "Passer Premium",
};

const formatTranslationRemaining = (remainingSeconds?: number | null) => {
  if (typeof remainingSeconds !== "number" || !Number.isFinite(remainingSeconds)) {
    return "Synchronisation...";
  }
  if (remainingSeconds >= Number.MAX_SAFE_INTEGER / 2) {
    return "Illimite";
  }
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const normalizeTranslationEntitlement = (
  payload: unknown
): ChatTranslationEntitlementState => {
  const raw = (payload || {}) as Record<string, unknown>;
  const freeSecondsRemaining =
    typeof raw.freeSecondsRemaining === "number" && Number.isFinite(raw.freeSecondsRemaining)
      ? Math.max(0, Math.floor(raw.freeSecondsRemaining))
      : 0;
  const paidSecondsRemaining =
    typeof raw.paidSecondsRemaining === "number" && Number.isFinite(raw.paidSecondsRemaining)
      ? Math.max(0, Math.floor(raw.paidSecondsRemaining))
      : 0;
  const totalSecondsRemaining =
    typeof raw.totalSecondsRemaining === "number" && Number.isFinite(raw.totalSecondsRemaining)
      ? Math.max(0, Math.floor(raw.totalSecondsRemaining))
      : freeSecondsRemaining + paidSecondsRemaining;
  const enabled =
    typeof raw.enabled === "boolean" ? raw.enabled : totalSecondsRemaining > 0;
  const lockReason = typeof raw.lockReason === "string" ? raw.lockReason.trim() : "";
  return {
    enabled,
    lockReason: enabled ? "" : lockReason,
    loading: false,
    isPremium: raw.isPremium === true,
    totalSecondsRemaining,
    freeSecondsRemaining,
    paidSecondsRemaining,
  };
};

const estimateTranslationSeconds = (text: string) => {
  const length = text.trim().length;
  if (!length) return 1;
  const base = Math.ceil(length / 30) * 3;
  return Math.max(1, Math.min(CHAT_TRANSLATION_MAX_SECONDS_PER_MESSAGE, base));
};

const CHAT_LANGUAGE_LABELS = Object.fromEntries(
  CHAT_LANGUAGE_OPTIONS.map((entry) => [entry.code, entry.label])
) as Record<ChatLanguageCode, string>;

const sanitizeLanguageCode = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase().slice(0, 8);
};

const toBaseLanguageCode = (value?: string) => {
  const normalized = sanitizeLanguageCode(value);
  if (!normalized) return "";
  return normalized.split("-")[0] || normalized;
};

const parseJsonPayload = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getAiMessageContent = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const content = choices[0]?.message?.content;
  return typeof content === "string" ? content : "";
};

const extractTimestampMs = (
  value?: { toMillis?: () => number; toDate?: () => Date } | null
) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  return 0;
};

export default function ChatShell({ currentUser }: { currentUser: User }) {
  const router = useRouter();
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [mode, setMode] = useState<"chats" | "contacts">("chats");
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showManageModal, setShowManageModal] = useState(false);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryByChat, setSummaryByChat] = useState<
    Record<string, { summary: string; actions: string[] }>
  >({});
  const [pendingSummaryChatId, setPendingSummaryChatId] = useState<string | null>(
    null
  );
  const [creatingChatWith, setCreatingChatWith] = useState<string | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt>(
    DEFAULT_UPGRADE_PROMPT
  );
  const [chatLimit, setChatLimit] = useState(40);
  const [translationEntitlement, setTranslationEntitlement] = useState<ChatTranslationEntitlementState>(
    DEFAULT_CHAT_TRANSLATION_ENTITLEMENT
  );
  const handleTokenLimit = useCallback((message: string) => {
    setErrorBanner(message);
    const normalized = message.toLowerCase();
    if (
      normalized.includes("tokens insuffisants") ||
      normalized.includes("credits") ||
      normalized.includes("traduction indisponible")
    ) {
      setUpgradePrompt({
        title: "Traduction IA bloquée",
        message:
          "Tu as atteint ta limite gratuite pour la traduction. Recharge tes crédits ou passe Premium pour continuer sans interruption.",
        ctaLabel: "Voir les offres",
      });
      setShowUpgradeModal(true);
    }
  }, []);
  const { chats } = useChatList(currentUser.id, chatLimit);
  const { contacts } = useContacts(currentUser.id);
  const hasMoreChats = chats.length >= chatLimit;
  const loadMoreChats = useCallback(() => {
    setChatLimit((prev) => prev + 40);
  }, [setChatLimit]);
  const participantIds = useParticipantIds(chats, currentUser.id);
  const userMap = useUserMap(participantIds);
  const readMap = useChatReadMap(chats, currentUser.id);
  const { messages, loading, hasMore, loadingMore, loadMore } = useChatMessages(
    selectedChatId
  );
  const isAdmin = currentUser.email === ADMIN_EMAIL;
  const roleLabel = isAdmin
    ? "Administrateur"
    : (profile?.role as string) ?? (isPremium ? "Premium" : "BFZoomer");
  const pushError = (message: string) => {
    setErrorBanner(message);
    console.warn("chat shell:", message);
    setTimeout(() => {
      setErrorBanner((current) => (current === message ? null : current));
    }, 6000);
  };
  const notifyBrowser = useCallback(
    async ({
      title,
      body,
      chatId,
    }: {
      title: string;
      body: string;
      chatId?: string;
    }) => {
      if (typeof window === "undefined" || typeof Notification === "undefined") return;
      try {
        if (Notification.permission !== "granted") return;
        const notification = new Notification(title, {
          body,
          tag: chatId ? `bfzoom-chat-${chatId}` : "bfzoom-chat",
        });
        notification.onclick = () => {
          window.focus();
          if (chatId) {
            setSelectedChatId(chatId);
          }
        };
      } catch {
        // Browser notification can fail because of user policy; ignore.
      }
    },
    []
  );
  const triggerChatPushFanout = useCallback(
    async ({
      chatId,
      messageType,
      previewText,
    }: {
      chatId: string;
      messageType: "text" | "image" | "file" | "voice";
      previewText?: string;
    }) => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return;
      const token = await getIdToken(firebaseUser, true).catch(() => "");
      if (!token) return;

      const response = await fetch("/api/chats/push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          chatId,
          senderName: currentUser.name,
          messageType,
          previewText: previewText?.trim() || "",
        }),
      });

      if (response.ok) return;
      const raw = await response.text().catch(() => "");
      console.warn("chat push failed", response.status, raw);
    },
    [currentUser.name]
  );
  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [activeCallChatId, setActiveCallChatId] = useState<string | null>(null);
  const [missedCalls, setMissedCalls] = useState<MissedCallEntry[]>([]);
  const [unreadMissedCount, setUnreadMissedCount] = useState(0);
  const callState = useCallState(activeCallChatId ?? selectedChatId);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const [chatLanguage, setChatLanguage] = useState<ChatLanguageCode>("fr");
  const [pendingMessagesByChat, setPendingMessagesByChat] = useState<
    Record<string, ChatMessage[]>
  >({});
  const addPendingMessage = useCallback((chatId: string, message: ChatMessage) => {
    setPendingMessagesByChat((current) => {
      const existing = current[chatId] || [];
      const next = [...existing.filter((entry) => entry.id !== message.id), message];
      return { ...current, [chatId]: next };
    });
  }, []);
  const [callMode, setCallMode] = useState<"audio" | "video">("video");
  const callSnapshotByChatRef = useRef<
    Record<
      string,
      {
        status: string;
        from: string;
        acceptedAtMs: number;
        roomId: string;
        callMode: "audio" | "video";
      }
    >
  >({});
  const callEventLoggedRef = useRef<Record<string, true>>({});
  const lastMessageKeyByChatRef = useRef<Record<string, string>>({});
  const chatListHydratedRef = useRef(false);
  const lastIncomingCallNotificationRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const ringPulseTimerRef = useRef<number | null>(null);
  const isCallerInCall = callState?.from === currentUser.id;
  const isCallActive = callState?.status === "in_call";
  const isCallRinging = callState?.status === "ringing";
  const hasIncomingCall = isCallRinging && !isCallerInCall;
  const startRingtone = useCallback(() => {
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    void context.resume().then(() => {
      if (ringPulseTimerRef.current) return;
      const playTone = ({
        frequency,
        offset,
        duration,
        volume,
      }: {
        frequency: number;
        offset: number;
        duration: number;
        volume: number;
      }) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startAt = context.currentTime + offset;
        const attack = Math.min(0.02, duration * 0.35);
        const releaseStart = startAt + Math.max(0.01, duration - 0.08);

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(volume, startAt + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, releaseStart);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.04);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      };

      const playSoftChimePattern = () => {
        playTone({ frequency: 659.25, offset: 0.0, duration: 0.2, volume: 0.09 });
        playTone({ frequency: 783.99, offset: 0.23, duration: 0.24, volume: 0.11 });
        playTone({ frequency: 987.77, offset: 0.54, duration: 0.26, volume: 0.1 });
      };

      playSoftChimePattern();
      ringPulseTimerRef.current = window.setInterval(playSoftChimePattern, 1900);
    });
  }, []);

  const stopRingtone = useCallback(() => {
    if (ringPulseTimerRef.current) {
      window.clearInterval(ringPulseTimerRef.current);
      ringPulseTimerRef.current = null;
    }
    void audioContextRef.current?.suspend().catch(() => {});
  }, []);

  useEffect(() => {
    if (hasIncomingCall) {
      startRingtone();
    } else {
      stopRingtone();
    }
    return () => {
      stopRingtone();
    };
  }, [hasIncomingCall, startRingtone, stopRingtone]);

  useEffect(() => {
    if (callState?.status && callState.status !== "ended") {
      setIsSidebarOpen(false);
    }
  }, [callState]);

  useEffect(() => {
    if (!callState?.status || callState.status === "ended") {
      setIsSidebarOpen(true);
    }
  }, [callState]);
  useEffect(() => {
    if (chats.length === 0) {
      setActiveCallChatId(null);
      callSnapshotByChatRef.current = {};
      return;
    }

    const unsubscribers = chats.map((chat) =>
      onSnapshot(
        doc(db, "calls", chat.id),
        (snapshot) => {
          if (!snapshot.exists()) {
            delete callSnapshotByChatRef.current[chat.id];
            setActiveCallChatId((current) => (current === chat.id ? null : current));
            return;
          }
          const data = snapshot.data() as {
            status?: string;
            from?: string;
            callMode?: "audio" | "video";
            roomId?: string;
            acceptedAt?: { toMillis?: () => number; toDate?: () => Date };
            ringExpiresAt?: { toMillis?: () => number; toDate?: () => Date };
          };
          const previous = callSnapshotByChatRef.current[chat.id];
          const status = data.status || "";
          const from = data.from || "";
          const nextCallMode = data.callMode === "audio" ? "audio" : "video";
          const roomId = (data.roomId || "").trim();
          const acceptedAtMs =
            typeof data.acceptedAt?.toMillis === "function"
              ? data.acceptedAt.toMillis()
              : typeof data.acceptedAt?.toDate === "function"
              ? data.acceptedAt.toDate().getTime()
              : 0;
          const ringExpiresAtMs =
            typeof data.ringExpiresAt?.toMillis === "function"
              ? data.ringExpiresAt.toMillis()
              : typeof data.ringExpiresAt?.toDate === "function"
              ? data.ringExpiresAt.toDate().getTime()
              : 0;

          if (status === "ringing" && ringExpiresAtMs > 0 && ringExpiresAtMs <= Date.now()) {
            void endCall(chat.id, currentUser.id, {
              reason: "no_answer",
              endedBy: "system",
            }).catch(() => {});
            return;
          }

          callSnapshotByChatRef.current[chat.id] = {
            status,
            from,
            acceptedAtMs,
            roomId,
            callMode: nextCallMode,
          };

          if (
            status === "in_call" &&
            previous?.status === "ringing" &&
            previous.from === currentUser.id
          ) {
            const eventKey = `answered:${chat.id}:${roomId}:${currentUser.id}`;
            if (!callEventLoggedRef.current[eventKey]) {
              callEventLoggedRef.current[eventKey] = true;
              const otherId = chat.participants.find((id) => id !== currentUser.id) || "";
              const otherUser = otherId ? userMap[otherId] : null;
              void appendCallHistory({
                ownerUid: currentUser.id,
                peerUserId: otherId,
                peerLabel: otherUser?.name || otherUser?.email || "Contact",
                direction: "outgoing",
                status: "answered",
                mode: nextCallMode,
                chatId: chat.id,
                roomId,
              }).catch(() => {});
            }
          }

          if (
            status === "ended" &&
            previous?.status === "ringing" &&
            previous.from &&
            previous.from !== currentUser.id &&
            previous.acceptedAtMs <= 0
          ) {
            const eventKey = `missed:${chat.id}:${previous.roomId}:${previous.from}`;
            if (!callEventLoggedRef.current[eventKey]) {
              callEventLoggedRef.current[eventKey] = true;
              const otherId = chat.participants.find((id) => id !== currentUser.id) || "";
              const otherUser = otherId ? userMap[otherId] : null;
              void appendCallHistory({
                ownerUid: currentUser.id,
                peerUserId: otherId,
                peerLabel:
                  chat.type === "group"
                    ? chat.title?.trim() || "Groupe"
                    : otherUser?.name || otherUser?.email || "Contact",
                direction: "incoming",
                status: "missed",
                mode: previous.callMode,
                chatId: chat.id,
                roomId: previous.roomId,
              }).catch(() => {});
            }
          }

          const shouldActivateIncomingRinging =
            status === "ringing" &&
            from &&
            from !== currentUser.id &&
            (!activeCallChatId || activeCallChatId === chat.id);
          const shouldKeepActiveInCall =
            status === "in_call" &&
            from &&
            from !== currentUser.id &&
            (activeCallChatId === chat.id || selectedChatId === chat.id || previous?.status === "ringing");

          if (shouldActivateIncomingRinging || shouldKeepActiveInCall) {
            setCallMode(nextCallMode);
            setActiveCallChatId(chat.id);
            setSelectedChatId((current) => (current === chat.id ? current : chat.id));
            return;
          }

          if (status === "ended") {
            setActiveCallChatId((current) => (current === chat.id ? null : current));
          }
        },
        (error) => {
          console.warn("call watcher error", chat.id, error);
        }
      )
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [activeCallChatId, chats, currentUser.id, selectedChatId, userMap]);
  const runCallAction = async (action: () => Promise<void>) => {
    setCallError(null);
    setCallLoading(true);
    try {
      await action();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur lors de l'appel vidéo.";
      setCallError(message);
    } finally {
      setCallLoading(false);
    }
  };

  const resolvePeerMetaForChat = useCallback(
    (chatId: string) => {
      const chat = chats.find((entry) => entry.id === chatId);
      if (!chat) {
        return {
          peerUserId: "",
          peerLabel: "Contact",
        };
      }
      if (chat.type === "group") {
        return {
          peerUserId: "",
          peerLabel: chat.title?.trim() || "Groupe",
        };
      }
      const otherId = chat.participants.find((id) => id !== currentUser.id) || "";
      const otherUser = otherId ? userMap[otherId] : null;
      return {
        peerUserId: otherId,
        peerLabel: otherUser?.name || otherUser?.email || "Contact",
      };
    },
    [chats, currentUser.id, userMap]
  );
  const triggerVoipForDirectChat = useCallback(
    async ({
      chatId,
      roomId,
      callMode,
    }: {
      chatId: string;
      roomId: string;
      callMode: "audio" | "video";
    }): Promise<{
      callUUID?: string;
      degraded?: boolean;
      warning?: string;
    }> => {
      const chat = chats.find((item) => item.id === chatId);
      if (!chat || chat.type !== "direct") return {};
      const targetUid = chat.participants.find((id) => id !== currentUser.id);
      if (!targetUid) return {};

      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return {};
      const bearerToken = await getIdToken(firebaseUser, true).catch(() => "");
      if (!bearerToken) return {};

      const callerName =
        currentUser.name?.trim() || currentUser.email?.trim() || "BFZoom";
      const apiBaseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const livekitUrl = (process.env.NEXT_PUBLIC_LIVEKIT_URL || "").trim();

      const response = await fetch("/api/voip/call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          chatId,
          targetUid,
          roomId,
          callerName,
          role: "guest",
          callMode,
          apiBaseUrl,
          livekitUrl,
          identity: `${currentUser.id}-caller`,
          displayName: callerName,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        callUUID?: string;
        reason?: string;
        message?: string;
        sent?: number;
        fallback?: string;
        error?: string;
        detail?: string;
      };
      if (!response.ok) {
        const reason = payload.detail || payload.error || `HTTP ${response.status}`;
        throw new Error(reason);
      }

      const degradedNoVoipToken = payload.reason === "target_has_no_voip_token";
      const degradedFirestoreFallback = payload.fallback === "firestore_online";

      if (degradedNoVoipToken || degradedFirestoreFallback) {
        return {
          callUUID: (payload.callUUID || "").trim() || undefined,
          degraded: true,
          warning: "Contact indisponible en notification push pour le moment. L'appel continue normalement dans BFZoom.",
        };
      }

      const hardFailure =
        payload.ok === false &&
        typeof payload.sent === "number" &&
        payload.sent <= 0 &&
        payload.fallback !== "firestore_online";
      if (hardFailure) {
        throw new Error(payload.message?.trim() || "Impossible de lancer l'appel.");
      }

      return {
        callUUID: (payload.callUUID || "").trim() || undefined,
      };
    },
    [chats, currentUser.email, currentUser.id, currentUser.name]
  );
  const startLiveCall = useCallback(
    (chatId: string, type: "audio" | "video") => {
      setCallMode(type);
      const roomId = `chat-${chatId}-${Date.now()}`;
      void runCallAction(async () => {
        const peer = resolvePeerMetaForChat(chatId);
        const voipResult = await triggerVoipForDirectChat({
          chatId,
          roomId,
          callMode: type,
        });
        await startCall({
          chatId,
          roomId,
          from: currentUser.id,
          to: peer.peerUserId || undefined,
          callMode: type,
          callUUID: voipResult.callUUID,
        });
        if (voipResult.degraded && voipResult.warning) {
          setCallError(voipResult.warning);
        }
        void appendCallHistory({
          ownerUid: currentUser.id,
          peerUserId: peer.peerUserId,
          peerLabel: peer.peerLabel,
          direction: "outgoing",
          status: "started",
          mode: type,
          chatId,
          roomId,
        }).catch(() => {});
      });
    },
    [currentUser.id, resolvePeerMetaForChat, triggerVoipForDirectChat]
  );

  const handleStartCall = (type: "audio" | "video" = "video") => {
    if (!selectedChatId) {
      setCallError("Sélectionne d'abord une discussion.");
      return;
    }
    startLiveCall(selectedChatId, type);
  };

  const handleQuickCall = (chatId: string, type: "audio" | "video") => {
    setSelectedChatId(chatId);
    startLiveCall(chatId, type);
  };

  const handleQuickAction = (
    chatId: string,
    action: "voice" | "photo" | "video" | "file"
  ) => {
    setSelectedChatId(chatId);
    if (isMobile) {
      setIsSidebarOpen(false);
    }
    const composer = composerRef.current;
    if (!composer) return;
    switch (action) {
      case "voice":
        composer.startVoiceNote();
        break;
      case "photo":
        composer.openCamera("photo");
        break;
      case "video":
        composer.openCamera("video");
        break;
      case "file":
        composer.openFilePicker();
        break;
      default:
        break;
    }
  };
  const currentCallChatId = activeCallChatId ?? selectedChatId;
  const handleAcceptCall = () => {
    if (!currentCallChatId) return;
    void runCallAction(async () => {
      await acceptCall(currentCallChatId, currentUser.id);
      const peer = resolvePeerMetaForChat(currentCallChatId);
      void appendCallHistory({
        ownerUid: currentUser.id,
        peerUserId: peer.peerUserId,
        peerLabel: peer.peerLabel,
        direction: "incoming",
        status: "answered",
        mode: callState?.callMode === "audio" ? "audio" : "video",
        chatId: currentCallChatId,
        roomId: callState?.roomId || "",
      }).catch(() => {});
    });
  };
  const handleEndCall = () => {
    if (!currentCallChatId) return;
    void runCallAction(() => endCall(currentCallChatId, currentUser.id));
  };
  const handleCancelCall = () => {
    if (!currentCallChatId) return;
    void runCallAction(() => endCall(currentCallChatId, currentUser.id));
  };

  const ensureAiAccess = useCallback(
    async (
      type: "improve" | "summary",
      context = ""
    ): Promise<{ useCredit: boolean }> => {
    const credits = await canUseCredit(currentUser.id, type);
    if (credits.ok) {
      return { useCredit: true };
    }
    await consumeAiTokens({
      tokens: TOKEN_COSTS[type],
      type,
      context,
    });
    return { useCredit: false };
    },
    [currentUser.id]
  );

  const refreshTranslationEntitlement = useCallback(async () => {
    try {
      const current = auth.currentUser;
      if (!current) {
        setTranslationEntitlement({
          ...DEFAULT_CHAT_TRANSLATION_ENTITLEMENT,
          loading: false,
          enabled: false,
        });
        return;
      }
      const token = await getIdToken(current, true);
      const response = await fetch("/api/translation/entitlement", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Impossible de synchroniser les credits traduction.";
        setTranslationEntitlement((currentState) => ({
          ...currentState,
          loading: false,
          enabled: false,
          lockReason: message,
        }));
        return;
      }
      setTranslationEntitlement(normalizeTranslationEntitlement(payload));
    } catch {
      setTranslationEntitlement((currentState) => ({
        ...currentState,
        loading: false,
      }));
    }
  }, []);

  const consumeTranslationSeconds = useCallback(
    async (seconds: number, chatId: string) => {
      const current = auth.currentUser;
      if (!current) {
        throw new Error("Session expiree");
      }
      const token = await getIdToken(current, true);
      const response = await fetch("/api/translation/consume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          seconds: Math.max(1, Math.floor(seconds)),
          origin: "chat",
          roomId: chatId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          typeof (payload as { lockReason?: unknown }).lockReason === "string"
            ? (payload as { lockReason: string }).lockReason
            : typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : "Credits traduction insuffisants.";
        throw new Error(message);
      }
      setTranslationEntitlement(normalizeTranslationEntitlement(payload));
    },
    []
  );

  useEffect(() => {
    const update = () => setIsMobile(window.matchMedia("(max-width: 767px)").matches);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    const ref = doc(db, "users", currentUser.id);
    const unsubscribe = onSnapshot(ref, (snap) => {
      const data = snap.data() as Record<string, unknown> | undefined;
      setIsPremium(Boolean(data?.isPremium || data?.plan === "premium"));
      setProfile(data ?? null);
    });
    return () => unsubscribe();
  }, [currentUser.id]);

  useEffect(() => {
    void refreshTranslationEntitlement();
  }, [refreshTranslationEntitlement, isPremium, currentUser.id]);

  useEffect(() => {
    callSnapshotByChatRef.current = {};
    callEventLoggedRef.current = {};
  }, [currentUser.id]);

  useEffect(() => {
    const unsubscribe = subscribeMissedCalls({
      ownerUid: currentUser.id,
      onUpdate: setMissedCalls,
    });
    return () => unsubscribe();
  }, [currentUser.id]);

  useEffect(() => {
    const unsubscribe = subscribeUnreadMissedCallsCount({
      ownerUid: currentUser.id,
      onUpdate: setUnreadMissedCount,
    });
    return () => unsubscribe();
  }, [currentUser.id]);

  const selectedChat = useMemo<Chat | null>(() => {
    if (!selectedChatId) return null;
    return chats.find((chat) => chat.id === selectedChatId) || null;
  }, [chats, selectedChatId]);

  const selectedParticipants = useMemo(() => {
    if (!selectedChat) return [];
    return selectedChat.participants
      .map((id) => userMap[id])
      .filter(Boolean);
  }, [selectedChat, userMap]);

  const contactInfoMap = useMemo(() => {
    const map: Record<string, { alias: string; email: string }> = {};
    contacts.forEach((contact) => {
      map[contact.id] = {
        alias: (contact.alias || "").trim(),
        email: (contact.email || "").trim(),
      };
    });
    return map;
  }, [contacts]);

  const selectedTitle = useMemo(() => {
    if (!selectedChat) return "Discussion";
    if (selectedChat.type === "group") return selectedChat.title || "Groupe";
    const otherId = selectedChat.participants.find((id) => id !== currentUser.id);
    const alias = otherId ? contactInfoMap[otherId]?.alias : "";
    const otherUser = otherId ? userMap[otherId] : null;
    return alias || otherUser?.name || otherUser?.email || "Discussion";
  }, [currentUser.id, selectedChat, userMap, contactInfoMap]);
  const selectedDirectEmail = useMemo(() => {
    if (!selectedChat || selectedChat.type !== "direct") return "";
    const otherId = selectedChat.participants.find((id) => id !== currentUser.id);
    if (!otherId) return "";
    const userEmail = (userMap[otherId]?.email || "").trim();
    if (userEmail) return userEmail;
    return (contactInfoMap[otherId]?.email || "").trim();
  }, [currentUser.id, selectedChat, userMap, contactInfoMap]);
  const getChatLabel = useCallback(
    (chat: Chat) => {
      if (chat.type === "group") return chat.title?.trim() || "Groupe";
      const otherId = chat.participants.find((id) => id !== currentUser.id);
      const alias = otherId ? contactInfoMap[otherId]?.alias : "";
      const otherUser = otherId ? userMap[otherId] : null;
      return alias || otherUser?.name || otherUser?.email || "Discussion";
    },
    [contactInfoMap, currentUser.id, userMap]
  );

  const canManageGroup = Boolean(
    selectedChat &&
      selectedChat.type === "group" &&
      selectedChat.admins?.includes(currentUser.id)
  );

  const unreadMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    chats.forEach((chat) => {
      const last = chat.lastMessage?.createdAt?.toDate
        ? chat.lastMessage.createdAt.toDate()
        : null;
      const read = readMap[chat.id] ?? null;
      map[chat.id] = Boolean(last && (!read || last > read));
    });
    return map;
  }, [chats, readMap]);
  useEffect(() => {
    const nextMap: Record<string, string> = {};
    chats.forEach((chat) => {
      const lastMessage = chat.lastMessage;
      const key = [
        lastMessage?.senderId || "",
        extractTimestampMs(lastMessage?.createdAt || null),
        lastMessage?.type || "",
        lastMessage?.text || "",
      ].join("|");
      nextMap[chat.id] = key;
    });

    if (!chatListHydratedRef.current) {
      chatListHydratedRef.current = true;
      lastMessageKeyByChatRef.current = nextMap;
      return;
    }

    chats.forEach((chat) => {
      const previousKey = lastMessageKeyByChatRef.current[chat.id];
      const nextKey = nextMap[chat.id];
      if (!previousKey || previousKey === nextKey) return;
      const lastMessage = chat.lastMessage;
      if (!lastMessage || lastMessage.senderId === currentUser.id) return;

      const isTabVisible =
        typeof document !== "undefined" ? document.visibilityState === "visible" : true;
      const isCurrentChatVisible = isTabVisible && selectedChatId === chat.id;
      if (isCurrentChatVisible) return;

      const preview = (() => {
        if (lastMessage.type === "voice") return "Note vocale";
        if (lastMessage.type === "image") return "Image";
        if (lastMessage.type === "file") return "Fichier";
        const raw = (lastMessage.text || "").trim();
        return raw || "Nouveau message";
      })();

      void notifyBrowser({
        title: getChatLabel(chat),
        body: preview,
        chatId: chat.id,
      });
    });

    lastMessageKeyByChatRef.current = nextMap;
  }, [chats, currentUser.id, getChatLabel, notifyBrowser, selectedChatId]);
  useEffect(() => {
    if (!hasIncomingCall || !callState?.roomId) return;
    const notificationKey = `${currentCallChatId || ""}:${callState.roomId}`;
    if (lastIncomingCallNotificationRef.current === notificationKey) return;
    lastIncomingCallNotificationRef.current = notificationKey;
    void notifyBrowser({
      title: "Appel entrant BFZoom",
      body: `${selectedTitle} t'appelle`,
      chatId: currentCallChatId || undefined,
    });
  }, [callState?.roomId, currentCallChatId, hasIncomingCall, notifyBrowser, selectedTitle]);
  useEffect(() => {
    if (callState?.status === "ended") {
      lastIncomingCallNotificationRef.current = "";
    }
  }, [callState?.status]);
  const handleMarkMissedRead = useCallback(
    async (callIds: string[]) => {
      try {
        await markMissedCallsAsRead({
          ownerUid: currentUser.id,
          callIds,
        });
      } catch (error) {
        pushError(
          error instanceof Error
            ? error.message
            : "Impossible de marquer les appels manqués comme lus."
        );
      }
    },
    [currentUser.id]
  );
  const handleRecallMissedAudio = useCallback(
    (entry: MissedCallEntry) => {
      const chatId = entry.chatId.trim();
      if (!chatId) {
        setCallError("Rappel impossible: discussion introuvable.");
        return;
      }
      setSelectedChatId(chatId);
      startLiveCall(chatId, "audio");
    },
    [startLiveCall]
  );
  const pendingMessagesForSelectedChat = useMemo(() => {
    if (!selectedChatId) return [];
    return pendingMessagesByChat[selectedChatId] || [];
  }, [pendingMessagesByChat, selectedChatId]);
  const messagesForThread = useMemo(() => {
    if (pendingMessagesForSelectedChat.length === 0) return messages;
    const knownIds = new Set(messages.map((message) => message.id));
    const pendingOnly = pendingMessagesForSelectedChat.filter(
      (message) => !knownIds.has(message.id)
    );
    if (pendingOnly.length === 0) return messages;
    return [...messages, ...pendingOnly];
  }, [messages, pendingMessagesForSelectedChat]);

  useEffect(() => {
    if (!selectedChatId) return;
    if (messages.length === 0) return;
    const knownIds = new Set(messages.map((message) => message.id));
    setPendingMessagesByChat((current) => {
      const existing = current[selectedChatId];
      if (!existing || existing.length === 0) return current;
      const next = existing.filter((message) => !knownIds.has(message.id));
      if (next.length === existing.length) return current;
      const updated = { ...current };
      if (next.length > 0) {
        updated[selectedChatId] = next;
      } else {
        delete updated[selectedChatId];
      }
      return updated;
    });
  }, [messages, selectedChatId]);

  const showCallOverlay =
    Boolean(callState && callState.status !== "ended" && callState.roomId);
  const overlayTitle = callMode === "video" ? "Appel vidéo" : "Appel audio";
  const translationStatusTone = translationEntitlement.loading
    ? "neutral"
    : translationEntitlement.enabled
    ? translationEntitlement.totalSecondsRemaining <= 45
      ? "warning"
      : "ok"
    : "blocked";
  const translationStatusClasses =
    translationStatusTone === "ok"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      : translationStatusTone === "warning"
      ? "border-amber-300/50 bg-amber-500/15 text-amber-100"
      : translationStatusTone === "blocked"
      ? "border-rose-300/50 bg-rose-500/15 text-rose-100"
      : "border-white/15 bg-white/5 text-gray-100";
  const translationPrimaryLine = translationEntitlement.loading
    ? "Synchronisation IA en cours..."
    : translationEntitlement.enabled
    ? `Traduction IA active: ${formatTranslationRemaining(
        translationEntitlement.totalSecondsRemaining
      )} restantes`
    : "Traduction IA bloquée";
  const translationSecondaryLine = translationEntitlement.loading
    ? "Vérification de ton quota gratuit et de tes crédits."
    : translationEntitlement.enabled
    ? translationEntitlement.isPremium
      ? "Plan Premium: accès illimité aux actions IA dans le chat."
      : `Essai gratuit: ${formatTranslationRemaining(
          translationEntitlement.freeSecondsRemaining
        )} • Crédits payants: ${formatTranslationRemaining(
          translationEntitlement.paidSecondsRemaining
        )}`
    : translationEntitlement.lockReason ||
      "Recharge tes crédits ou passe Premium pour continuer.";

  const handleStartDirectChat = async (userId: string) => {
    setCreatingChatWith(userId);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) throw new Error("Session expirée");
      const token = await getIdToken(firebaseUser, true);
      const res = await fetch("/api/chats/direct", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ otherUserId: userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur création chat");
      }
      const { chatId } = (await res.json()) as { chatId: string };
      setSelectedChatId(chatId);
      setMode("chats");
    } catch (error) {
      console.error("Erreur création chat direct", error);
      const message =
        error instanceof Error ? error.message : "Impossible de créer la discussion pour l’instant.";
      pushError(message);
      alert(message);
    } finally {
      setCreatingChatWith(null);
    }
  };

  const translateDraftForChat = useCallback(
    async (
      text: string,
      targetLanguage: ChatLanguageCode,
      options: { stream?: boolean } = {}
    ) => {
      const current = auth.currentUser;
      if (!current) {
        throw new Error("Connexion requise pour traduire avant envoi.");
      }
      const token = await getIdToken(current, true);
      const targetLabel =
        CHAT_LANGUAGE_LABELS[targetLanguage] || targetLanguage.toUpperCase();
      const body: Record<string, unknown> = {
        intent: "translation", // signal au serveur de raccourcir timeout/tokens
        jsonMode: true,
        messages: [
          {
            role: "system",
            content:
              "Tu es un traducteur multilingue pour chat en temps réel. " +
              `Détecte la langue source et traduis vers ${targetLabel} (code ${targetLanguage}). ` +
              'Réponds strictement en JSON: {"translatedText":"...","sourceLanguage":"fr"}. ' +
              "Aucun markdown, aucun texte hors JSON.",
          },
          {
            role: "user",
            content: text,
          },
        ],
      };
      if (options.stream) {
        body.stream = true;
      }
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const errorMessage =
          typeof data.error === "string" ? data.error : "Erreur IA de traduction.";
        throw new Error(errorMessage);
      }

      const raw = getAiMessageContent(data);
      const fallbackText = raw.trim();
      const parsed = parseJsonPayload(raw);
      const translatedCandidate =
        (typeof parsed?.translatedText === "string"
          ? parsed.translatedText
          : fallbackText
        ).trim();
      if (!translatedCandidate) {
        throw new Error("Traduction vide, impossible d'envoyer le message.");
      }
      const sourceLanguage =
        sanitizeLanguageCode(
          typeof parsed?.sourceLanguage === "string"
            ? parsed.sourceLanguage
            : undefined
        ) || "auto";

      const normalizedTarget = sanitizeLanguageCode(targetLanguage);
      const sourceBase = toBaseLanguageCode(sourceLanguage);
      const targetBase = toBaseLanguageCode(normalizedTarget);

      // Guardrail: never rewrite when source and target are effectively the same language.
      if (sourceBase && targetBase && sourceBase === targetBase) {
        return {
          translatedText: text.trim(),
          sourceLanguage,
          targetLanguage,
        };
      }

      // Guardrail: avoid conversational assistant-like replies replacing user text.
      const aiReplyPattern = /^(oui|yes|je\s+suis\s+la|i\s*'?m\s+here|bien\s+sur|of\s+course|d'accord|ok)[\s!,.?]*$/i;
      if (aiReplyPattern.test(translatedCandidate) && translatedCandidate.length < Math.max(24, text.trim().length * 0.5)) {
        return {
          translatedText: text.trim(),
          sourceLanguage,
          targetLanguage,
        };
      }

      return {
        translatedText: translatedCandidate,
        sourceLanguage,
        targetLanguage,
      };
    },
    []
  );

  const handleSend = async (text: string, targetLanguage: ChatLanguageCode) => {
    const chatId = selectedChatId;
    if (!chatId) return;
    const cleanText = text.trim();
    if (!cleanText) return;

    // 1. envoyer immédiatement le message original
    let messageId: string | null = null;
    try {
      messageId = await sendTextMessage({
        chatId,
        text: cleanText, // on conserve l'original en premier lieu
        senderId: currentUser.id,
        senderName: currentUser.name,
      });
      addPendingMessage(chatId, {
        id: messageId,
        type: "text",
        text: cleanText,
        senderId: currentUser.id,
        senderName: currentUser.name,
        createdAt: null,
      });
      await markChatRead({ chatId, userId: currentUser.id });
      void triggerChatPushFanout({
        chatId,
        messageType: "text",
        previewText: cleanText,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Impossible d’envoyer le message, vérifie ta connexion.";
      setErrorBanner(message);
      console.error("sendTextMessage error", err);
      throw err;
    }

    // 2. en arrière-plan, tenter de traduire et mettre à jour
    if (messageId) {
      translateDraftForChat(cleanText, targetLanguage)
        .then(async (translated) => {
          await consumeTranslationSeconds(estimateTranslationSeconds(cleanText), chatId);
          try {
            const msgRef = doc(db, `chats/${chatId}/messages/${messageId}`);
            await updateDoc(msgRef, {
              text: translated.translatedText,
              originalText: cleanText,
              sourceLanguage: translated.sourceLanguage,
              targetLanguage: translated.targetLanguage,
            });
          } catch (err) {
            console.warn("background translation update failed", err);
          }
        })
        .catch((translationError) => {
          const message =
            translationError instanceof Error
              ? translationError.message
              : "Traduction indisponible pour le moment.";
          handleTokenLimit(message);
          console.warn("background translation failed", translationError);
        });
    }
  };

  const handleSendAttachment = async (file: File) => {
    if (!selectedChatId) return;
    try {
      await sendAttachmentMessage({
        chatId: selectedChatId,
        file,
        senderId: currentUser.id,
        senderName: currentUser.name,
      });
      await markChatRead({ chatId: selectedChatId, userId: currentUser.id });
      void triggerChatPushFanout({
        chatId: selectedChatId,
        messageType: file.type.startsWith("image/") ? "image" : "file",
        previewText: file.name,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur lors de l’envoi du fichier.";
      setErrorBanner(message);
      console.error("sendAttachmentMessage error", error);
      throw error;
    }
  };

  const handleSendVoiceNote = async (blob: Blob, duration: number) => {
    if (!selectedChatId) return;
    try {
      await sendVoiceMessage({
        chatId: selectedChatId,
        blob,
        duration,
        senderId: currentUser.id,
        senderName: currentUser.name,
      });
      await markChatRead({ chatId: selectedChatId, userId: currentUser.id });
      void triggerChatPushFanout({
        chatId: selectedChatId,
        messageType: "voice",
        previewText: "Note vocale",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erreur lors de l’envoi de la note vocale.";
      setErrorBanner(message);
      console.error("sendVoiceMessage error", error);
      throw error;
    }
  };

  const handleSendTranslatedVoice = async (
    text: string,
    targetLanguage: ChatLanguageCode
  ) => {
    if (!selectedChatId) return;
    const clean = text.trim();
    if (!clean) return;
    try {
      const translated = await translateDraftForChat(clean, targetLanguage);
      const current = auth.currentUser;
      if (!current) {
        throw new Error("Session expirée");
      }
      const token = await getIdToken(current, true);
      const ttsResponse = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: translated.translatedText,
          voice: "alloy",
        }),
      });
      if (!ttsResponse.ok) {
        throw new Error("Synthese vocale indisponible pour le moment.");
      }
      const arrayBuffer = await ttsResponse.arrayBuffer();
      const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
      const estimatedSeconds = estimateTranslationSeconds(clean);
      await consumeTranslationSeconds(estimatedSeconds, selectedChatId);
      const approxDuration = Math.max(1, Math.min(30, Math.ceil(clean.length / 18)));
      await sendVoiceMessage({
        chatId: selectedChatId,
        blob,
        duration: approxDuration,
        senderId: currentUser.id,
        senderName: currentUser.name,
      });
      await markChatRead({ chatId: selectedChatId, userId: currentUser.id });
      void triggerChatPushFanout({
        chatId: selectedChatId,
        messageType: "voice",
        previewText: "Voix traduite",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible d'envoyer la voix traduite.";
      setErrorBanner(message);
      if (message.toLowerCase().includes("credits") || message.toLowerCase().includes("tokens")) {
        setShowUpgradeModal(true);
      }
      throw error;
    }
  };

  const handleCreateGroup = async (title: string, memberIds: string[]) => {
    const groupId = await createGroupChat({
      title,
      memberIds,
      createdBy: currentUser.id,
    });
    setSelectedChatId(groupId);
    setMode("chats");
  };

  const handleImprove = async (text: string, targetLanguage: ChatLanguageCode) => {
    try {
      const current = auth.currentUser;
      if (!current) throw new Error("Utilisateur non connecté");
      const targetLabel =
        CHAT_LANGUAGE_LABELS[targetLanguage] || targetLanguage.toUpperCase();
      const access = await ensureAiAccess(
        "improve",
        `chat:${selectedChatId ?? "unknown"};lang:${targetLanguage}`
      );
      const token = await getIdToken(current, true);

      const prompt = [
        "Tu es un coach linguistique.",
        "Détecte la langue source automatiquement.",
        "Corrige la grammaire et le style sans changer le sens.",
        `Traduis vers la langue cible: ${targetLabel} (code ${targetLanguage}).`,
        "Retourne un JSON strict avec les clés corrected, translation, note.",
        "note = une explication très courte (1 phrase) ou une chaîne vide.",
        `Texte: ${text}`,
      ].join(" ");

      const res = await fetch("/api/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          jsonMode: true,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: text },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Erreur IA");
      }

      const content = data?.choices?.[0]?.message?.content ?? "";
      const cleaned = String(content).replace(/```json|```/gi, "").trim();
      try {
        const parsed = JSON.parse(cleaned) as {
          corrected?: string;
          translation?: string;
          note?: string;
        };
        const result = {
          corrected: parsed.corrected?.trim() || text,
          translation: parsed.translation?.trim() || "",
          note: parsed.note?.trim() || "",
        };
        if (access.useCredit) {
          await incrementCredit(current.uid, "improve");
        }
        return result;
      } catch {
        const result = { corrected: text, translation: cleaned, note: "" };
        if (access.useCredit) {
          await incrementCredit(current.uid, "improve");
        }
        return result;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur IA";
      handleTokenLimit(message);
      throw error;
    }
  };

  const buildSummaryPrompt = (items: string[]) => {
    return [
      "Tu es un assistant qui résume une conversation et extrait les actions.",
      "Retourne un JSON strict avec les clés: summary (string) et actions (array de strings).",
      "Si aucune action claire, retourne actions: [].",
      "Conversation:",
      ...items,
    ].join("\n");
  };

  const handleSummarize = useCallback(async () => {
    if (!selectedChatId) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const current = auth.currentUser;
      if (!current) throw new Error("Utilisateur non connecté");
      const access = await ensureAiAccess(
        "summary",
        `chat:${selectedChatId ?? "unknown"}`
      );
      const token = await getIdToken(current, true);

      const recent = messages.slice(-40).map((msg) => {
        if (msg.type === "image") {
          return `${msg.senderName}: [Image] ${msg.attachment?.name ?? ""}`.trim();
        }
        if (msg.type === "file") {
          return `${msg.senderName}: [Fichier] ${msg.attachment?.name ?? ""}`.trim();
        }
        return `${msg.senderName}: ${msg.text ?? ""}`.trim();
      });
      if (recent.length === 0) {
        throw new Error("Aucun message à résumer.");
      }

      const body = {
        messages: [
          {
            role: "system",
            content: buildSummaryPrompt(recent),
          },
          {
            role: "user",
            content: "Génère le résumé et les actions.",
          },
        ],
      };

      const res = await fetch("/api/openai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Erreur IA");
      }

      const content = data?.choices?.[0]?.message?.content ?? "";
      const cleaned = String(content).replace(/```json|```/gi, "").trim();
      let summary = "";
      let actions: string[] = [];
      try {
        const parsed = JSON.parse(cleaned) as { summary?: string; actions?: string[] };
        summary = parsed.summary?.trim() ?? "";
        actions = Array.isArray(parsed.actions) ? parsed.actions : [];
      } catch {
        summary = cleaned;
      }

      setSummaryByChat((prev) => ({
        ...prev,
        [selectedChatId]: { summary, actions },
      }));
      if (access.useCredit) {
        await incrementCredit(current.uid, "summary");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Erreur IA";
      setSummaryError(msg);
      handleTokenLimit(msg);
    } finally {
      setSummaryLoading(false);
    }
  }, [selectedChatId, messages, handleTokenLimit, ensureAiAccess]);

  useEffect(() => {
    if (!pendingSummaryChatId) return;
    if (pendingSummaryChatId !== selectedChatId) return;
    void handleSummarize();
    setPendingSummaryChatId(null);
  }, [pendingSummaryChatId, selectedChatId, handleSummarize]);

  const handleRequestSummarizeChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setPendingSummaryChatId(chatId);
  };

  const handleRequestDeleteChat = (chatId: string) => {
    setSelectedChatId(chatId);
    setShowDeleteConfirm(true);
  };

  const handleClearSummary = () => {
    if (!selectedChatId) return;
    setSummaryByChat((prev) => {
      const next = { ...prev };
      delete next[selectedChatId];
      return next;
    });
  };

  const handleAddGroupMembers = async (memberIds: string[]) => {
    if (!selectedChatId) return;
    await addGroupMembers({ chatId: selectedChatId, memberIds });
  };

  const handleRemoveGroupMember = async (memberId: string) => {
    if (!selectedChatId) return;
    await removeGroupMember({ chatId: selectedChatId, memberId });
  };

  const handleDeleteChat = async () => {
    if (!selectedChatId || !selectedChat) return;
    const firebaseUser = auth.currentUser;
    if (!currentUser || !firebaseUser) {
      alert("Tu dois être connecté pour supprimer une discussion.");
      setShowDeleteConfirm(false);
      return;
    }
    const ownerId = selectedChat.createdBy;
    if (ownerId && ownerId !== currentUser.id) {
      alert("Tu n’es pas autorisé à supprimer cette discussion.");
      setShowDeleteConfirm(false);
      return;
    }
    setDeleting(true);
    try {
      const token = await getIdToken(firebaseUser, true);
      const res = await fetch("/api/chats/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          chatId: selectedChatId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Erreur suppression chat");
      }
      setSelectedChatId(chats[0]?.id ?? null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur lors de la suppression.";
      pushError(message);
      alert(message);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedChatId || !currentUser) return;
    const messageRef = doc(db, `chats/${selectedChatId}/messages`, messageId);
    await deleteDoc(messageRef);
  };

  const handleDeleteContact = useCallback(
    async (contact: Contact) => {
      const contactsRef = collection(db, `contacts/${currentUser.id}/list`);
      const snapshot = await getDocs(contactsRef);
      const normalizedEmail = (contact.email || "").trim().toLowerCase();

      const docsToDelete = snapshot.docs.filter((docSnap) => {
        const data = docSnap.data() as {
          uid?: string;
          email?: string;
          emailLower?: string;
        };
        const email = (data.emailLower || data.email || "").trim().toLowerCase();
        return (
          docSnap.id === contact.contactDocId ||
          (Boolean(data.uid) && data.uid === contact.id) ||
          (Boolean(normalizedEmail) && email === normalizedEmail)
        );
      });

      if (docsToDelete.length === 0) return;
      await Promise.all(docsToDelete.map((docSnap) => deleteDoc(docSnap.ref)));
      const label = contact.alias?.trim() || contact.name || contact.email || "Contact";
      setErrorBanner(`Contact supprimé: ${label}`);
    },
    [currentUser.id]
  );

  useEffect(() => {
    if (!selectedChatId) return;
    void markChatRead({ chatId: selectedChatId, userId: currentUser.id });
  }, [currentUser.id, selectedChatId]);

  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden border border-white/10 bg-white/5 shadow-2xl md:h-[calc(100vh-2rem)] md:max-h-225 md:rounded-3xl">
      <div
        className={`fixed inset-y-0 left-0 z-30 w-[88%] max-w-xs transform border-r border-white/10 bg-gray-950/95 transition-transform duration-300 md:static md:z-auto md:w-80 md:min-h-0 md:bg-white/5 ${
          isSidebarOpen
            ? "translate-x-0 md:block"
            : "-translate-x-full md:hidden"
        }`}
      >
        <ChatSidebar
          chats={chats}
          contacts={contacts}
          selectedChatId={selectedChatId}
          onSelectChat={(chatId) => {
            setSelectedChatId(chatId);
            if (isMobile) setIsSidebarOpen(false);
          }}
          onStartDirectChat={handleStartDirectChat}
          onCreateGroup={() => setShowGroupModal(true)}
          userMap={userMap}
          currentUserId={currentUser.id}
          currentUserName={currentUser.name}
          currentUserEmail={currentUser.email}
          mode={mode}
          onModeChange={setMode}
          unreadMap={unreadMap}
          isPremium={isPremium}
          roleLabel={roleLabel}
          onCreateContact={() => router.push("/add-user")}
          onDeleteContact={handleDeleteContact}
          onQuickCall={handleQuickCall}
          onQuickAction={handleQuickAction}
          onSummarizeChat={handleRequestSummarizeChat}
          onRequestDeleteChat={handleRequestDeleteChat}
          summaryLoading={summaryLoading}
          hasMoreChats={hasMoreChats}
          onLoadMoreChats={loadMoreChats}
          missedCalls={missedCalls}
          unreadMissedCount={unreadMissedCount}
          onRecallMissedAudio={handleRecallMissedAudio}
          onMarkMissedRead={handleMarkMissedRead}
          onBackToMenu={() => router.push("/dashboard")}
        />
      </div>
      {isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          aria-label="Fermer le menu"
        />
      )}

      <div className="relative flex flex-1 min-h-0 flex-col bg-linear-to-br from-gray-950 via-gray-900 to-black">
        <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-4 py-3">
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-300">
            Chat
            {unreadMissedCount > 0 ? (
              <span className="inline-flex min-w-4.5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                {unreadMissedCount > 99 ? "99+" : unreadMissedCount}
              </span>
            ) : null}
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            ← Menu modules
          </button>
        </div>
        <div className={`mx-4 mt-3 rounded-xl border px-3 py-2 text-xs ${translationStatusClasses}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-0.5">
              <p className="font-semibold">{translationPrimaryLine}</p>
              <p className="text-[11px] opacity-90">{translationSecondaryLine}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setUpgradePrompt({
                  title: "Booste tes actions IA",
                  message:
                    "Recharge des crédits ou passe Premium pour conserver un chat fluide en traduction, correction et résumé.",
                  ctaLabel: "Comparer les offres",
                });
                setShowUpgradeModal(true);
              }}
              className="rounded-lg border border-current/30 bg-black/10 px-2.5 py-1 text-[11px] font-semibold hover:bg-black/20"
            >
              Recharger / Premium
            </button>
          </div>
        </div>
        {errorBanner && (
          <div className="m-4 rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span>{errorBanner}</span>
              <button
                onClick={() => setErrorBanner(null)}
                className="text-xs font-semibold uppercase tracking-wide text-red-200"
              >
                Fermer
              </button>
            </div>
          </div>
        )}
        {callError && (
          <div className="m-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 shadow-lg">
            <div className="flex items-center justify-between gap-2">
              <span>{callError}</span>
              <button
                onClick={() => setCallError(null)}
                className="text-xs font-semibold uppercase tracking-wide text-amber-200"
              >
                Fermer
              </button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatThread
            chat={selectedChat}
            messages={messagesForThread}
            currentUserId={currentUser.id}
            title={selectedTitle}
            directEmail={selectedDirectEmail}
            canManage={canManageGroup}
            onManage={() => setShowManageModal(true)}
            onSummarize={handleSummarize}
            summary={selectedChatId ? summaryByChat[selectedChatId]?.summary ?? "" : ""}
            actions={selectedChatId ? summaryByChat[selectedChatId]?.actions ?? [] : []}
            summaryLoading={summaryLoading}
            summaryError={summaryError}
            onClearSummary={handleClearSummary}
            isPremium={isPremium}
            onDelete={() => setShowDeleteConfirm(true)}
            canDelete={selectedChat?.createdBy === currentUser.id}
            onDeleteMessage={handleDeleteMessage}
            onRequestContactList={() => {
              setMode("contacts");
              setIsSidebarOpen(true);
            }}
            hideHeader
            loading={loading}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMore}
          />
        </div>
        <div className="md:hidden">
          <div className="flex justify-center px-4 py-2">
            <button
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              className="rounded-2xl border border-white/20 bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-100 transition hover:border-amber-300 hover:bg-amber-500/30"
            >
              {isSidebarOpen ? "Masquer les discussions" : "Revoir les discussions"}
            </button>
          </div>
        </div>
        {selectedChat ? (
          <ChatComposer
            ref={composerRef}
            onSend={handleSend}
            onSendTranslatedVoice={handleSendTranslatedVoice}
            onSendAttachment={handleSendAttachment}
            onSendVoiceNote={handleSendVoiceNote}
            onImprove={handleImprove}
            targetLanguage={chatLanguage}
            onTargetLanguageChange={setChatLanguage}
            disabled={!selectedChatId}
          />
        ) : (
          <div className="flex items-center justify-center border-t border-white/10 bg-white/5 py-6 text-sm text-gray-300">
            Choisis une discussion pour activer le clavier et les options.
          </div>
        )}
        {showCallOverlay && callState && (
          <div className="absolute inset-0 z-40 flex flex-col rounded-3xl border border-emerald-500/60 bg-black/90 p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-white">{overlayTitle}</p>
                <p className="text-xs text-white/70">
                  {hasIncomingCall
                    ? `${selectedTitle} t'appelle`
                    : isCallActive
                    ? "En cours"
                    : isCallRinging
                    ? "Invitation envoyée"
                    : "En attente de réponse..."}
                </p>
                {isCallActive && (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-300 animate-pulse" />
                    Traduction active (credits)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {hasIncomingCall && (
                  <>
                    <button
                      onClick={handleAcceptCall}
                      disabled={callLoading}
                      className="rounded-full border border-emerald-300/60 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-60"
                    >
                      Répondre
                    </button>
                    <button
                      onClick={handleCancelCall}
                      disabled={callLoading}
                      className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-60"
                    >
                      Ignorer
                    </button>
                  </>
                )}
                {!hasIncomingCall && isCallRinging && (
                  <button
                    onClick={handleCancelCall}
                    disabled={callLoading}
                    className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-white transition hover:bg-white/20 disabled:opacity-60"
                  >
                    Annuler
                  </button>
                )}
                {isCallActive && (
                  <button
                    onClick={handleEndCall}
                    disabled={callLoading}
                    className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-rose-100 transition hover:bg-rose-500/20 disabled:opacity-60"
                  >
                    Raccrocher
                  </button>
                )}
              </div>
            </div>
              <div className="mt-3 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black">
              {isCallActive ? (
                <LiveKitCall
                  roomId={callState.roomId ?? ""}
                  isHost={false}
                  onLeave={handleEndCall}
                  audioOnly={callMode === "audio"}
                  defaultDisplayName={currentUser.name}
                  skipPreJoin
                  sessionMode="chat"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-white/70">
                  {hasIncomingCall
                    ? "Appel entrant en attente de réponse..."
                    : "En attente de réponse..."}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="md:hidden">
        <button
          onClick={() => setShowCreateMenu((open) => !open)}
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-3xl text-white shadow-xl"
          aria-label="Créer"
        >
          +
        </button>
        {showCreateMenu && (
          <div className="fixed bottom-24 right-6 z-40 w-48 rounded-2xl border border-white/10 bg-gray-950/95 p-2 shadow-2xl">
            <button
              onClick={() => {
                setShowCreateMenu(false);
                setShowGroupModal(true);
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-white hover:bg-white/10"
            >
              ➕ Nouveau groupe
            </button>
            <button
              onClick={() => {
                setShowCreateMenu(false);
                router.push("/add-user");
              }}
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-white hover:bg-white/10"
            >
              👤 Nouveau contact
            </button>
          </div>
        )}
      </div>

      {showGroupModal && (
        <ChatGroupModal
          contacts={contacts}
          onClose={() => setShowGroupModal(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showManageModal && selectedChat && (
        <ChatGroupManageModal
          contacts={contacts}
          members={selectedParticipants}
          onClose={() => setShowManageModal(false)}
          onAddMembers={handleAddGroupMembers}
          onRemoveMember={handleRemoveGroupMember}
        />
      )}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl border border-red-400/40 bg-gray-950/95 p-6 text-white shadow-2xl">
            <h3 className="text-lg font-semibold text-red-300">
              Supprimer la discussion ?
            </h3>
            <p className="mt-2 text-sm text-gray-300">
              Cette action supprime les messages pour tous les participants.
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
              >
                Annuler
              </button>
              <button
                onClick={handleDeleteChat}
                disabled={deleting}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
              >
                {deleting ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
      {creatingChatWith && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50">
          <div className="rounded-2xl border border-white/10 bg-gray-950/90 px-6 py-4 text-center text-sm text-white">
            Création de la conversation avec{" "}
            <span className="font-semibold">
              {userMap[creatingChatWith]?.name ||
                userMap[creatingChatWith]?.email ||
                "ton contact"}
            </span>
            …
          </div>
        </div>
      )}
      {showUpgradeModal && (
        <UpgradeModal
          onClose={() => setShowUpgradeModal(false)}
          title={upgradePrompt.title}
          message={upgradePrompt.message}
          ctaLabel={upgradePrompt.ctaLabel}
        />
      )}
    </div>
  );
}
