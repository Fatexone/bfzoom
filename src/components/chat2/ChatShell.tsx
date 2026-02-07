"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@/types/User";
import type { Chat } from "@/types/Chat";
import ChatSidebar from "./ChatSidebar";
import ChatThread from "./ChatThread";
import ChatComposer, { type ChatComposerHandle } from "./ChatComposer";
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
import LiveKitCall from "@/components/video/LiveKit/LiveKitCall";
import { getIdToken } from "firebase/auth";
import { deleteDoc, doc, onSnapshot } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { canUseCredit, incrementCredit } from "./credits";
import UpgradeModal from "./UpgradeModal";
import { consumeAiTokens } from "@/lib/tokensClient";
import { ADMIN_EMAIL } from "@/config/constants";

const TOKEN_COSTS: Record<"improve" | "summary", number> = {
  improve: 1,
  summary: 2,
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
  const [chatLimit, setChatLimit] = useState(40);
  const handleTokenLimit = useCallback((message: string) => {
    setErrorBanner(message);
    if (message.toLowerCase().includes("tokens insuffisants")) {
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
  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const callState = useCallState(selectedChatId);
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const [callMode, setCallMode] = useState<"audio" | "video">("video");
  const audioContextRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const isCallerInCall = callState?.from === currentUser.id;
  const isCallActive = callState?.status === "in_call";
  const isCallRinging = callState?.status === "ringing";
  const hasIncomingCall = isCallRinging && !isCallerInCall;
  const startRingtone = useCallback(() => {
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    void context.resume().then(() => {
      if (oscillatorRef.current) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 440;
      gain.gain.value = 0.25;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = "sine";
      oscillator.start();
      oscillatorRef.current = oscillator;
      gainRef.current = gain;
    });
  }, []);

  const stopRingtone = useCallback(() => {
    oscillatorRef.current?.stop();
    oscillatorRef.current?.disconnect();
    gainRef.current?.disconnect();
    oscillatorRef.current = null;
    gainRef.current = null;
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
  const startLiveCall = (chatId: string, type: "audio" | "video") => {
    setCallMode(type);
    const roomId = `call-${chatId}-${Date.now()}`;
    void runCallAction(() =>
      startCall({
        chatId,
        roomId,
        from: currentUser.id,
      })
    );
  };

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
  const handleAcceptCall = () => {
    if (!selectedChatId) return;
    void runCallAction(() => acceptCall(selectedChatId, currentUser.id));
  };
  const handleEndCall = () => {
    if (!selectedChatId) return;
    void runCallAction(() => endCall(selectedChatId, currentUser.id));
  };
  const handleCancelCall = () => {
    if (!selectedChatId) return;
    void runCallAction(() => endCall(selectedChatId, currentUser.id));
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

  const contactAliasMap = useMemo(() => {
    const map: Record<string, string> = {};
    contacts.forEach((contact) => {
      if (contact.alias?.trim()) {
        map[contact.id] = contact.alias.trim();
      }
    });
    return map;
  }, [contacts]);

  const selectedTitle = useMemo(() => {
    if (!selectedChat) return "Discussion";
    if (selectedChat.type === "group") return selectedChat.title || "Groupe";
    const otherId = selectedChat.participants.find((id) => id !== currentUser.id);
    const alias = otherId ? contactAliasMap[otherId] : undefined;
    const otherUser = otherId ? userMap[otherId] : null;
    return alias || otherUser?.name || otherUser?.email || "Discussion";
  }, [currentUser.id, selectedChat, userMap, contactAliasMap]);

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

  const showCallOverlay =
    Boolean(callState && callState.status !== "ended" && callState.roomId);
  const overlayTitle = callMode === "video" ? "Appel vidéo" : "Appel audio";

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

  const handleSend = async (text: string) => {
    if (!selectedChatId) return;
    try {
      await sendTextMessage({
        chatId: selectedChatId,
        text,
        senderId: currentUser.id,
        senderName: currentUser.name,
      });
      await markChatRead({ chatId: selectedChatId, userId: currentUser.id });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible d’envoyer le message, vérifie ta connexion.";
      setErrorBanner(message);
      console.error("sendTextMessage error", error);
      throw error;
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

  const handleCreateGroup = async (title: string, memberIds: string[]) => {
    const groupId = await createGroupChat({
      title,
      memberIds,
      createdBy: currentUser.id,
    });
    setSelectedChatId(groupId);
    setMode("chats");
  };

  const handleImprove = async (text: string, targetLang: string) => {
    try {
      const current = auth.currentUser;
      if (!current) throw new Error("Utilisateur non connecté");
      const access = await ensureAiAccess(
        "improve",
        `chat:${selectedChatId ?? "unknown"};lang:${targetLang}`
      );
      const token = await getIdToken(current, true);

      const prompt = [
        "Tu es un coach linguistique.",
        "Détecte la langue source automatiquement.",
        "Corrige la grammaire et le style sans changer le sens.",
        `Traduis vers la langue cible: ${targetLang}.`,
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

  useEffect(() => {
    if (!selectedChatId) return;
    void markChatRead({ chatId: selectedChatId, userId: currentUser.id });
  }, [currentUser.id, selectedChatId]);

  return (
    <div className="relative flex h-full w-full overflow-hidden border border-white/10 bg-white/5 shadow-2xl md:h-[calc(100vh-2rem)] md:max-h-[900px] md:rounded-3xl">
      <div
        className={`fixed inset-y-0 left-0 z-30 w-[88%] max-w-xs transform border-r border-white/10 bg-gray-950/95 transition-transform duration-300 md:static md:z-auto md:w-80 md:bg-white/5 ${
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
          onQuickCall={handleQuickCall}
          onQuickAction={handleQuickAction}
          onSummarizeChat={handleRequestSummarizeChat}
          onRequestDeleteChat={handleRequestDeleteChat}
          summaryLoading={summaryLoading}
        />
      </div>
      {isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(false)}
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          aria-label="Fermer le menu"
        />
      )}

      <div className="relative flex flex-1 min-h-0 flex-col bg-gradient-to-br from-gray-950 via-gray-900 to-black">
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
        <ChatThread
          chat={selectedChat}
          messages={messages}
          currentUserId={currentUser.id}
          title={selectedTitle}
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
            onSendAttachment={handleSendAttachment}
            onSendVoiceNote={handleSendVoiceNote}
            onImprove={handleImprove}
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
                  isHost={isCallerInCall}
                  onLeave={handleEndCall}
                  audioOnly={callMode === "audio"}
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
        <UpgradeModal onClose={() => setShowUpgradeModal(false)} />
      )}
    </div>
  );
}