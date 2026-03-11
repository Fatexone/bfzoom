import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import * as Contacts from "expo-contacts";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { onAuthStateChanged, type User } from "firebase/auth";
import { env } from "../config/env";
import { auth, db, firebaseConfigured } from "../services/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { requireDb } from "../services/chat";
import {
  addGroupMembers,
  createGroupChat,
  ensureDirectChat,
  fetchUsersByIds,
  findUsersByEmails,
  findUserByEmail,
  getDirectChatId,
  removeGroupMember,
  removeDirectContactForUser,
  sendAttachmentMessage,
  deleteMessageFromChat,
  sendVoiceNoteMessage,
  sendTextMessage,
  subscribeChats,
  subscribeMessages,
  type BasicUserProfile,
} from "../services/chat";
import { triggerChatPushFanout } from "../services/chatPush";
import {
  markMissedCallsAsRead,
  subscribeMissedCalls,
  type MissedCallEntry,
} from "../services/callHistory";
import { askOpenAi } from "../services/openai";
import { notifyLocalMessage } from "../services/notifications";
import { subscribePresenceMap, type PresenceEntry } from "../services/presence";
import type { ChatDoc, ChatMessageDoc } from "../types/chat";

const timestampToLabel = (value?: { toDate?: () => Date } | null) => {
  if (!value || typeof value.toDate !== "function") return "";
  return value.toDate().toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const timestampMsToLabel = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "";
  const date = new Date(value);
  const now = Date.now();
  if (now - value > 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    });
  }
  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const CHAT_LANGUAGE_OPTIONS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "pt", label: "Português" },
  { code: "pt-br", label: "Português (Brasil)" },
  { code: "hi", label: "हिन्दी" },
  { code: "ko", label: "한국어" },
  { code: "tr", label: "Türkçe" },
  { code: "th", label: "ไทย" },
  { code: "es", label: "Español" },
  { code: "de", label: "Deutsch" },
  { code: "he", label: "עברית" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ru", label: "Русский" },
  { code: "la", label: "Latin" },
  { code: "fa", label: "فارسی" },
] as const;
const RTL_LANGUAGE_CODES = new Set(["ar", "fa", "he"]);

type ChatLanguageCode = (typeof CHAT_LANGUAGE_OPTIONS)[number]["code"];

const CHAT_LANGUAGE_LABELS = Object.fromEntries(
  CHAT_LANGUAGE_OPTIONS.map((entry) => [entry.code, entry.label])
) as Record<ChatLanguageCode, string>;

const sanitizeLanguageCode = (value?: string) => {
  if (!value) return "";
  return value.trim().toLowerCase().slice(0, 8);
};

const isRtlLanguageCode = (value?: string) => {
  if (!value) return false;
  return RTL_LANGUAGE_CODES.has(value.trim().toLowerCase());
};

const parseJsonPayload = (raw: string) => {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
};

type PhoneContactMatch = {
  email: string;
  contactLabel: string;
  phoneE164?: string;
  user: BasicUserProfile;
};

type HomePanelKey = "direct" | "group" | "missed" | "chats";

type PushMessageType = "text" | "image" | "file" | "voice";
type ChatCallMode = "audio" | "video";

type StartCallPayload = {
  userId: string;
  label?: string;
  mode: ChatCallMode;
};

type ChatScreenProps = {
  onStartCall?: (payload: StartCallPayload) => Promise<void>;
  initialSelectedChatId?: string;
  onInitialSelectedChatIdHandled?: () => void;
};

type ChatHomeFilter = "all" | "pinned" | "recent";

type DiscussionsPanelProps = {
  chatSearch: string;
  setChatSearch: (value: string) => void;
  chatHomeFilter: ChatHomeFilter;
  setChatHomeFilter: (value: ChatHomeFilter) => void;
  filteredChats: ChatDoc[];
  currentUser: User;
  resolveChatTitle: (chat: ChatDoc) => string;
  getChatActivityMillis: (chat: ChatDoc) => number;
  timestampMsToLabelValue: (value: number) => string;
  isUserOnline: (userId: string) => boolean;
  getPresenceLabel: (userId: string) => string;
  pinnedChatIds: Record<string, true>;
  togglePinnedChat: (chatId: string) => void;
  onSelectChat: (chatId: string) => void;
};

type ChatHomeHeaderProps = {
  openHomePanel: HomePanelKey | null;
  openHomeSection: (key: HomePanelKey) => void;
  onToggleNewMenu: () => void;
  onOpenNewContact: () => void;
  onOpenNewGroup: () => void;
  newChatMenuOpen: boolean;
  unreadMissedCount: number;
  startingCallMode: ChatCallMode | "";
  activeCallingLabel: string;
  callHistoryError: string;
};

type DiscussionsAccordionProps = {
  openHomePanel: HomePanelKey | null;
  toggleHomePanel: (key: HomePanelKey) => void;
  recentIncomingCount: number;
} & DiscussionsPanelProps;

function ChatHomeHeader({
  openHomePanel,
  openHomeSection,
  onToggleNewMenu,
  onOpenNewContact,
  onOpenNewGroup,
  newChatMenuOpen,
  unreadMissedCount,
  startingCallMode,
  activeCallingLabel,
  callHistoryError,
}: ChatHomeHeaderProps) {
  return (
    <>
      <View style={styles.homeToolbar}>
        <Pressable
          onPress={() => openHomeSection("chats")}
          style={[styles.homeToolButton, openHomePanel === "chats" && styles.homeToolButtonActive]}
        >
          <Text style={[styles.homeToolText, openHomePanel === "chats" && styles.homeToolTextActive]}>
            Discussions
          </Text>
        </Pressable>
        <Pressable
          onPress={onToggleNewMenu}
          style={[
            styles.homeToolButton,
            newChatMenuOpen &&
              styles.homeToolButtonActive,
          ]}
        >
          <Text
            style={[
              styles.homeToolText,
              newChatMenuOpen && styles.homeToolTextActive,
            ]}
          >
            +
          </Text>
        </Pressable>
        <Pressable
          onPress={() => openHomeSection("missed")}
          style={[styles.homeToolButton, openHomePanel === "missed" && styles.homeToolButtonActive]}
        >
          <View style={styles.homeToolContent}>
            <Text style={[styles.homeToolText, openHomePanel === "missed" && styles.homeToolTextActive]}>
              Appels
            </Text>
            {unreadMissedCount > 0 ? (
              <View style={styles.homeToolBadge}>
                <Text style={styles.homeToolBadgeText}>{unreadMissedCount > 99 ? "99+" : unreadMissedCount}</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      </View>

      {newChatMenuOpen ? (
        <View style={styles.homeToolbarSecondary}>
          <Pressable
            onPress={onOpenNewContact}
            style={[styles.homeToolButtonSecondary, openHomePanel === "direct" && styles.homeToolButtonActive]}
          >
            <Text style={[styles.homeToolText, openHomePanel === "direct" && styles.homeToolTextActive]}>
              Nouveau contact
            </Text>
          </Pressable>
          <Pressable
            onPress={onOpenNewGroup}
            style={[styles.homeToolButtonSecondary, openHomePanel === "group" && styles.homeToolButtonActive]}
          >
            <Text style={[styles.homeToolText, openHomePanel === "group" && styles.homeToolTextActive]}>
              Nouveau groupe
            </Text>
          </Pressable>
        </View>
      ) : null}

      {startingCallMode ? (
        <View style={styles.callStatusBanner}>
          <ActivityIndicator size="small" color="#93c5fd" />
          <Text style={styles.callStatusText}>
            {startingCallMode === "audio" ? "Appel audio en cours..." : "Appel video en cours..."}{" "}
            {activeCallingLabel}
          </Text>
        </View>
      ) : null}

      {callHistoryError ? <Text style={styles.errorInline}>{callHistoryError}</Text> : null}
    </>
  );
}

function DiscussionsPanel({
  chatSearch,
  setChatSearch,
  chatHomeFilter,
  setChatHomeFilter,
  filteredChats,
  currentUser,
  resolveChatTitle,
  getChatActivityMillis,
  timestampMsToLabelValue,
  isUserOnline,
  getPresenceLabel,
  pinnedChatIds,
  togglePinnedChat,
  onSelectChat,
}: DiscussionsPanelProps) {
  return (
    <View style={styles.accordionBody}>
      <View style={styles.chatSearchCard}>
        <TextInput
          value={chatSearch}
          onChangeText={setChatSearch}
          placeholder="Rechercher une discussion..."
          placeholderTextColor="#64748b"
          style={styles.input}
        />
        <View style={styles.chatFilterRow}>
          <Pressable
            onPress={() => setChatHomeFilter("all")}
            style={[styles.chatFilterChip, chatHomeFilter === "all" && styles.chatFilterChipActive]}
          >
            <Text
              style={[
                styles.chatFilterChipText,
                chatHomeFilter === "all" && styles.chatFilterChipTextActive,
              ]}
            >
              Tous
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setChatHomeFilter("pinned")}
            style={[styles.chatFilterChip, chatHomeFilter === "pinned" && styles.chatFilterChipActive]}
          >
            <Text
              style={[
                styles.chatFilterChipText,
                chatHomeFilter === "pinned" && styles.chatFilterChipTextActive,
              ]}
            >
              Épinglés
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setChatHomeFilter("recent")}
            style={[styles.chatFilterChip, chatHomeFilter === "recent" && styles.chatFilterChipActive]}
          >
            <Text
              style={[
                styles.chatFilterChipText,
                chatHomeFilter === "recent" && styles.chatFilterChipTextActive,
              ]}
            >
              Récents
            </Text>
          </Pressable>
        </View>
      </View>

      {filteredChats.length > 0 ? (
        <View style={styles.chatList}>
          {filteredChats.map((item) => {
            const otherId =
              item.type === "direct" ? item.participants.find((id) => id !== currentUser.uid) || "" : "";
            const itemActivityMs = getChatActivityMillis(item);
            const isRecentIncoming =
              item.lastMessage?.senderId !== currentUser.uid &&
              itemActivityMs > 0 &&
              Date.now() - itemActivityMs <= 60 * 60 * 1000;
            const pinned = Boolean(pinnedChatIds[item.id]);

            return (
              <Pressable
                key={item.id}
                style={[styles.chatItem, pinned && styles.chatItemPinned]}
                onPress={() => onSelectChat(item.id)}
              >
                <View style={styles.rowSpaceBetween}>
                  <View style={styles.chatTitleRow}>
                    {isRecentIncoming ? <View style={styles.chatUnreadDot} /> : null}
                    <Text style={styles.chatTitle}>{resolveChatTitle(item)}</Text>
                    {pinned ? <Text style={styles.chatPinnedLabel}>Épinglé</Text> : null}
                  </View>
                  <Text style={styles.chatTime}>{timestampMsToLabelValue(itemActivityMs)}</Text>
                </View>

                {item.type === "direct" ? (
                  <Text
                    style={[
                      styles.chatPresence,
                      isUserOnline(otherId) ? styles.chatPresenceOnline : styles.chatPresenceOffline,
                    ]}
                  >
                    {getPresenceLabel(otherId)}
                  </Text>
                ) : null}

                <View style={styles.rowSpaceBetween}>
                  <Text style={styles.chatPreview} numberOfLines={1}>
                    {item.lastMessage?.text || "Aucun message"}
                  </Text>
                  <Pressable onPress={() => togglePinnedChat(item.id)} style={styles.chatPinButton}>
                    <Text style={styles.chatPinButtonText}>{pinned ? "Désépingler" : "Épingler"}</Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.subtitle}>
            {chatSearch.trim() ? "Aucune discussion trouvée pour cette recherche." : "Aucune discussion trouvée."}
          </Text>
        </View>
      )}
    </View>
  );
}

function DiscussionsAccordion({
  openHomePanel,
  toggleHomePanel,
  recentIncomingCount,
  chatSearch,
  setChatSearch,
  chatHomeFilter,
  setChatHomeFilter,
  filteredChats,
  currentUser,
  resolveChatTitle,
  getChatActivityMillis,
  timestampMsToLabelValue,
  isUserOnline,
  getPresenceLabel,
  pinnedChatIds,
  togglePinnedChat,
  onSelectChat,
}: DiscussionsAccordionProps) {
  if (openHomePanel !== "chats") return null;

  return (
    <View style={styles.accordionCard}>
      <Pressable style={styles.accordionHeader} onPress={() => toggleHomePanel("chats")}>
        <View style={styles.grow}>
          <Text style={styles.sectionTitle}>Discussions</Text>
          <Text style={styles.hintText}>
            {filteredChats.length} conversation(s)
            {recentIncomingCount > 0 ? ` · ${recentIncomingCount} nouveau(x)` : ""}
          </Text>
        </View>
        <Text style={styles.accordionIcon}>−</Text>
      </Pressable>
      <DiscussionsPanel
        chatSearch={chatSearch}
        setChatSearch={setChatSearch}
        chatHomeFilter={chatHomeFilter}
        setChatHomeFilter={setChatHomeFilter}
        filteredChats={filteredChats}
        currentUser={currentUser}
        resolveChatTitle={resolveChatTitle}
        getChatActivityMillis={getChatActivityMillis}
        timestampMsToLabelValue={timestampMsToLabelValue}
        isUserOnline={isUserOnline}
        getPresenceLabel={getPresenceLabel}
        pinnedChatIds={pinnedChatIds}
        togglePinnedChat={togglePinnedChat}
        onSelectChat={onSelectChat}
      />
    </View>
  );
}

export function ChatScreen({
  onStartCall,
  initialSelectedChatId,
  onInitialSelectedChatIdHandled,
}: ChatScreenProps = {}) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [chats, setChats] = useState<ChatDoc[]>([]);
  const [chatError, setChatError] = useState("");
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessageDoc[]>([]);
  const [messageError, setMessageError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingAttachment, setSendingAttachment] = useState(false);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [playingVoiceMessageId, setPlayingVoiceMessageId] = useState("");
  const [chatLanguage, setChatLanguage] = useState<ChatLanguageCode>("fr");
  const [showOriginalByMessage, setShowOriginalByMessage] = useState<Record<string, boolean>>({});
  const [translationError, setTranslationError] = useState("");

  const [createEmail, setCreateEmail] = useState("");
  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [creatingDirect, setCreatingDirect] = useState(false);
  const [createDirectError, setCreateDirectError] = useState("");

  const [groupTitle, setGroupTitle] = useState("");
  const [selectedGroupMemberIds, setSelectedGroupMemberIds] = useState<string[]>([]);
  const [groupCreationStep, setGroupCreationStep] = useState<"select" | "details">("select");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState("");

  const [addMemberEmail, setAddMemberEmail] = useState("");
  const [groupManageBusy, setGroupManageBusy] = useState(false);
  const [groupManageError, setGroupManageError] = useState("");

  const [usersById, setUsersById] = useState<Record<string, BasicUserProfile>>({});
  const [phoneContactMatches, setPhoneContactMatches] = useState<PhoneContactMatch[]>([]);
  const [phoneContactsScanned, setPhoneContactsScanned] = useState(0);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [chatActionBusy, setChatActionBusy] = useState(false);
  const [startingVoiceCallUserId, setStartingVoiceCallUserId] = useState("");
  const [startingCallMode, setStartingCallMode] = useState<ChatCallMode | "">("");
  const [openHomePanel, setOpenHomePanel] = useState<HomePanelKey | null>("chats");
  const [newChatMenuOpen, setNewChatMenuOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [chatHomeFilter, setChatHomeFilter] = useState<ChatHomeFilter>("all");
  const [pinnedChatIds, setPinnedChatIds] = useState<Record<string, true>>({});
  const [missedCalls, setMissedCalls] = useState<MissedCallEntry[]>([]);
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, PresenceEntry>>({});
  const [callHistoryError, setCallHistoryError] = useState("");
  const unreadMissedMarkingRef = useRef<Record<string, true>>({});

  const messageListRef = useRef<FlatList<ChatMessageDoc> | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const recorderUrlRef = useRef("");
  const voiceRecordStartedAtRef = useRef(0);
  const voicePlayerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const voiceMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectedChatIdRef = useRef<string | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const chatSnapshotReadyRef = useRef(false);
  const lastChatMessageKeyRef = useRef<Record<string, string>>({});

  const buildLastMessageKey = useCallback((chat: ChatDoc) => {
    const sender = chat.lastMessage?.senderId || "";
    const text = chat.lastMessage?.text || "";
    const createdAt = chat.lastMessage?.createdAt;
    const createdAtMillis =
      createdAt && typeof createdAt.toMillis === "function"
        ? createdAt.toMillis()
        : createdAt && typeof createdAt.toDate === "function"
          ? createdAt.toDate().getTime()
          : 0;
    return `${sender}|${createdAtMillis}|${text}`;
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    recorderUrlRef.current = recorderState.url || "";
  }, [recorderState.url]);

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId;
    shouldAutoScrollRef.current = true;
  }, [selectedChatId]);

  useEffect(() => {
    chatSnapshotReadyRef.current = false;
    lastChatMessageKeyRef.current = {};
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser) {
      setChats([]);
      setSelectedChatId(null);
      return;
    }

    setChatError("");
    const unsubscribe = subscribeChats(
      currentUser.uid,
      (nextChats) => {
        const nextMessageKeys: Record<string, string> = {};
        nextChats.forEach((chat) => {
          nextMessageKeys[chat.id] = buildLastMessageKey(chat);
        });

        if (chatSnapshotReadyRef.current) {
          nextChats.forEach((chat) => {
            const last = chat.lastMessage;
            if (!last) return;
            if (!last.senderId || last.senderId === currentUser.uid) return;
            if (selectedChatIdRef.current === chat.id) return;
            const previousKey = lastChatMessageKeyRef.current[chat.id] || "";
            const nextKey = nextMessageKeys[chat.id] || "";
            if (!nextKey || previousKey === nextKey) return;
            const title =
              chat.type === "group"
                ? `BFZoom · ${chat.title?.trim() || "Groupe"}`
                : "BFZoom · Nouveau message";
            const body = (last.text || "").trim() || "Tu as reçu un message.";
            void notifyLocalMessage({
              title,
              body,
              data: { chatId: chat.id },
            }).catch(() => {});
          });
        }

        lastChatMessageKeyRef.current = nextMessageKeys;
        chatSnapshotReadyRef.current = true;
        setChats(nextChats);
        setSelectedChatId((current) => {
          if (current && nextChats.some((chat) => chat.id === current)) return current;
          // Keep home visible by default instead of auto-opening the first thread.
          return null;
        });
      },
      (error) => {
        setChatError(error.message);
      }
    );

    return () => unsubscribe();
  }, [buildLastMessageKey, currentUser]);

  useEffect(() => {
    if (!currentUser || chats.length === 0) return;
    const ids = chats
      .flatMap((chat) => chat.participants)
      .filter((id) => id && id !== currentUser.uid && !usersById[id]);
    if (ids.length === 0) return;

    let cancelled = false;
    const loadUsers = async () => {
      try {
        const fetched = await fetchUsersByIds(ids);
        if (!cancelled && Object.keys(fetched).length > 0) {
          setUsersById((current) => ({ ...current, ...fetched }));
        }
      } catch {}
    };
    void loadUsers();

    return () => {
      cancelled = true;
    };
  }, [chats, currentUser, usersById]);

  useEffect(() => {
    if (!currentUser || chats.length === 0) return;

    const discoveredContacts: PhoneContactMatch[] = [];
    const seenUserIds = new Set<string>();

    chats.forEach((chat) => {
      chat.participants.forEach((participantId) => {
        const cleanId = participantId.trim();
        if (!cleanId || cleanId === currentUser.uid || seenUserIds.has(cleanId)) return;
        const profile = usersById[cleanId];
        if (!profile) return;

        seenUserIds.add(cleanId);
        const label = (profile.name || profile.email || cleanId).trim();
        discoveredContacts.push({
          email: (profile.email || "").trim().toLowerCase(),
          contactLabel: label,
          user: profile,
        });
      });
    });

    if (discoveredContacts.length === 0) return;

    setPhoneContactMatches((current) => {
      const byUserId = new Map<string, PhoneContactMatch>();
      current.forEach((entry) => {
        const userId = (entry.user.id || "").trim();
        if (!userId) return;
        byUserId.set(userId, entry);
      });
      discoveredContacts.forEach((entry) => {
        const userId = (entry.user.id || "").trim();
        if (!userId) return;
        if (!byUserId.has(userId)) {
          byUserId.set(userId, entry);
        }
      });
      return Array.from(byUserId.values()).sort((left, right) =>
        left.contactLabel.localeCompare(right.contactLabel, "fr")
      );
    });
  }, [chats, currentUser, usersById]);

  useEffect(() => {
    if (!selectedChatId) {
      setMessages([]);
      setMessageError("");
      return;
    }
    setMessageError("");

    const unsubscribe = subscribeMessages(
      selectedChatId,
      (nextMessages) => {
        setMessages(nextMessages);
      },
      (error) => {
        setMessageError(error.message);
      }
    );

    return () => unsubscribe();
  }, [selectedChatId]);

  useEffect(() => {
    const targetChatId = (initialSelectedChatId || "").trim();
    if (!targetChatId || !currentUser) return;
    if (!chats.some((entry) => entry.id === targetChatId)) return;
    setSelectedChatId(targetChatId);
    onInitialSelectedChatIdHandled?.();
  }, [chats, currentUser, initialSelectedChatId, onInitialSelectedChatIdHandled]);

  const selectedChat = useMemo(
    () => chats.find((entry) => entry.id === selectedChatId) || null,
    [chats, selectedChatId]
  );

  const selectedDirectPeer = useMemo(() => {
    if (!selectedChat || !currentUser || selectedChat.type !== "direct") return null;
    const otherUserId = selectedChat.participants.find((entry) => entry !== currentUser.uid) || "";
    if (!otherUserId) return null;
    const otherUser = usersById[otherUserId];
    const label = otherUser?.name || otherUser?.email || "ce contact";
    const email = (otherUser?.email || "").trim();
    return {
      userId: otherUserId,
      label,
      email,
    };
  }, [currentUser, selectedChat, usersById]);

  const presenceTargetUserIds = useMemo(() => {
    if (!currentUser) return [];
    const ids = new Set<string>();
    chats.forEach((chat) => {
      chat.participants.forEach((participantId) => {
        if (!participantId || participantId === currentUser.uid) return;
        ids.add(participantId);
      });
    });
    phoneContactMatches.forEach((entry) => {
      const id = (entry.user.id || "").trim();
      if (!id || id === currentUser.uid) return;
      ids.add(id);
    });
    return Array.from(ids);
  }, [chats, currentUser, phoneContactMatches]);

  useEffect(() => {
    if (!currentUser) {
      setMissedCalls([]);
      return;
    }
    const unsubscribe = subscribeMissedCalls({
      ownerUid: currentUser.uid,
      onUpdate: (entries) => {
        setMissedCalls(entries);
      },
    });
    return () => {
      unsubscribe();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      unreadMissedMarkingRef.current = {};
      return;
    }
    if (openHomePanel !== "missed") return;
    const unreadIds = missedCalls
      .filter((entry) => !entry.read && !unreadMissedMarkingRef.current[entry.id])
      .map((entry) => entry.id);
    if (unreadIds.length === 0) return;

    unreadIds.forEach((id) => {
      unreadMissedMarkingRef.current[id] = true;
    });

    void markMissedCallsAsRead({
      ownerUid: currentUser.uid,
      callIds: unreadIds,
    }).catch((error) => {
      unreadIds.forEach((id) => {
        delete unreadMissedMarkingRef.current[id];
      });
      setCallHistoryError(
        error instanceof Error ? error.message : "Impossible de marquer les appels comme lus."
      );
    });
  }, [currentUser, missedCalls, openHomePanel]);

  useEffect(() => {
    if (!currentUser) {
      setPresenceByUserId({});
      return;
    }
    const unsubscribe = subscribePresenceMap({
      userIds: presenceTargetUserIds,
      onUpdate: setPresenceByUserId,
    });
    return () => {
      unsubscribe();
    };
  }, [currentUser, presenceTargetUserIds]);

  const isUserOnline = useCallback(
    (userId: string) => Boolean(presenceByUserId[userId]?.online),
    [presenceByUserId]
  );

  const getPresenceLabel = useCallback(
    (userId: string) => {
      const entry = presenceByUserId[userId];
      if (entry?.online) return "En ligne";
      if (entry?.updatedAtMs) {
        return `Vu ${timestampMsToLabel(entry.updatedAtMs)}`;
      }
      return "Hors ligne";
    },
    [presenceByUserId]
  );

  const isGroupAdmin = Boolean(
    selectedChat &&
      currentUser &&
      selectedChat.type === "group" &&
      selectedChat.admins?.includes(currentUser.uid)
  );

  const selectedGroupContacts = useMemo(
    () => phoneContactMatches.filter((entry) => selectedGroupMemberIds.includes(entry.user.id)),
    [phoneContactMatches, selectedGroupMemberIds]
  );

  const activeCallingLabel = useMemo(() => {
    const targetId = startingVoiceCallUserId.trim();
    if (!targetId) return "";
    const user = usersById[targetId];
    if (!user) return "ce contact";
    return user.name || user.email || "ce contact";
  }, [startingVoiceCallUserId, usersById]);

  const unreadMissedCount = useMemo(
    () => missedCalls.reduce((total, entry) => (entry.read ? total : total + 1), 0),
    [missedCalls]
  );

  const getChatActivityMillis = useCallback((chat: ChatDoc) => {
    const fromLastMessage =
      chat.lastMessage?.createdAt && typeof chat.lastMessage.createdAt.toMillis === "function"
        ? chat.lastMessage.createdAt.toMillis()
        : chat.lastMessage?.createdAt && typeof chat.lastMessage.createdAt.toDate === "function"
          ? chat.lastMessage.createdAt.toDate().getTime()
          : 0;
    const fromUpdatedAt =
      chat.updatedAt && typeof chat.updatedAt.toMillis === "function"
        ? chat.updatedAt.toMillis()
        : chat.updatedAt && typeof chat.updatedAt.toDate === "function"
          ? chat.updatedAt.toDate().getTime()
          : 0;
    return Math.max(fromLastMessage, fromUpdatedAt);
  }, []);

  const recentIncomingCount = useMemo(() => {
    if (!currentUser) return 0;
    const now = Date.now();
    return chats.reduce((total, chat) => {
      if (chat.lastMessage?.senderId === currentUser.uid) return total;
      const activityMs = getChatActivityMillis(chat);
      if (activityMs <= 0) return total;
      return now - activityMs <= 60 * 60 * 1000 ? total + 1 : total;
    }, 0);
  }, [chats, currentUser, getChatActivityMillis]);

  const filteredChats = useMemo(() => {
    const query = chatSearch.trim().toLowerCase();
    const now = Date.now();
    return chats
      .filter((chat) => {
        if (chatHomeFilter === "pinned" && !pinnedChatIds[chat.id]) {
          return false;
        }
        if (chatHomeFilter === "recent") {
          const activityMs = getChatActivityMillis(chat);
          if (activityMs <= 0 || now - activityMs > 24 * 60 * 60 * 1000) {
            return false;
          }
        }
        if (!query) return true;
        let title = chat.id;
        if (currentUser) {
          if (chat.type === "group" && chat.title) {
            title = chat.title;
          } else {
            const otherId = chat.participants.find((id) => id !== currentUser.uid);
            if (otherId) {
              const otherUser = usersById[otherId];
              title = otherUser?.name || otherUser?.email || otherId;
            } else {
              title = "Discussion";
            }
          }
        }
        title = title.toLowerCase();
        const preview = (chat.lastMessage?.text || "").toLowerCase();
        return title.includes(query) || preview.includes(query);
      })
      .sort((left, right) => {
        const leftPinned = Boolean(pinnedChatIds[left.id]);
        const rightPinned = Boolean(pinnedChatIds[right.id]);
        if (leftPinned !== rightPinned) {
          return leftPinned ? -1 : 1;
        }
        return getChatActivityMillis(right) - getChatActivityMillis(left);
      });
  }, [chatSearch, chatHomeFilter, chats, currentUser, getChatActivityMillis, pinnedChatIds, usersById]);

  const recordingActive = recorderState.isRecording;

  const toFriendlyAudioError = useCallback((error: unknown) => {
    const raw = error instanceof Error ? error.message : String(error || "Erreur audio");
    if (
      /recording not allowed/i.test(raw) ||
      /osstatus error 5610/i.test(raw) ||
      /audio mode/i.test(raw)
    ) {
      return "Micro iOS indisponible temporairement. Autorise le micro puis réessaie.";
    }
    return raw;
  }, []);

  const setPlaybackAudioMode = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      shouldPlayInBackground: false,
    });
  }, []);

  const setRecordingAudioMode = useCallback(async () => {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
      shouldPlayInBackground: false,
    });
  }, []);

  const resolveUserLabel = useCallback(
    (userId: string) => {
      if (!currentUser) return userId;
      if (userId === currentUser.uid) {
        return "Moi";
      }
      const user = usersById[userId];
      if (!user) return userId;
      return user.name || user.email || userId;
    },
    [currentUser, usersById]
  );

  const resolveChatTitle = useCallback(
    (chat: ChatDoc) => {
      if (!currentUser) return chat.id;
      if (chat.type === "group" && chat.title) return chat.title;
      const otherId = chat.participants.find((id) => id !== currentUser.uid);
      if (!otherId) return "Discussion";
      return resolveUserLabel(otherId);
    },
    [currentUser, resolveUserLabel]
  );

  const toggleHomePanel = useCallback((key: HomePanelKey) => {
    setOpenHomePanel((current) => (current === key ? null : key));
  }, []);

  const togglePinnedChat = useCallback((chatId: string) => {
    setPinnedChatIds((current) => {
      if (current[chatId]) {
        const next = { ...current };
        delete next[chatId];
        return next;
      }
      return { ...current, [chatId]: true };
    });
  }, []);

  const openHomeSection = useCallback((key: HomePanelKey) => {
    setOpenHomePanel(key);
    if (key === "chats" || key === "missed") {
      setNewChatMenuOpen(false);
    }
  }, []);

  const toggleNewChatMenu = useCallback(() => {
    setNewChatMenuOpen((current) => !current);
  }, []);

  const openNewContactPanel = useCallback(() => {
    setOpenHomePanel("direct");
    setNewChatMenuOpen(false);
  }, []);

  const openNewGroupPanel = useCallback(() => {
    setGroupCreationStep("select");
    setOpenHomePanel("group");
    setNewChatMenuOpen(false);
  }, []);

  const toggleGroupMemberSelection = useCallback((memberId: string) => {
    setSelectedGroupMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((entry) => entry !== memberId)
        : [...current, memberId]
    );
  }, []);

  const openDirectChatWithUser = useCallback(
    async (target: BasicUserProfile) => {
      if (!currentUser) {
        throw new Error("Utilisateur non connecté.");
      }
      if (target.id === currentUser.uid) {
        throw new Error("Impossible de créer un chat avec ton propre compte.");
      }
      const chatId = await ensureDirectChat(currentUser.uid, target.id);
      setUsersById((current) => ({ ...current, [target.id]: target }));
      setSelectedChatId(chatId);
    },
    [currentUser]
  );

  const startDirectChat = async () => {
    setCreateDirectError("");
    setCreatingDirect(true);
    try {
      if (!currentUser) {
        throw new Error("Utilisateur non connecté.");
      }
      const email = createEmail.trim().toLowerCase();
      if (!email) {
        throw new Error("Email du contact obligatoire.");
      }
      const target = await findUserByEmail(email);
      if (!target) {
        throw new Error("Utilisateur introuvable pour cet email.");
      }
      const customLabel = `${createFirstName.trim()} ${createLastName.trim()}`.trim();
      const nextUser: BasicUserProfile = {
        ...target,
        name: customLabel || target.name || target.email,
      };
      await openDirectChatWithUser(nextUser);
      setPhoneContactMatches((current) => {
        const next = [...current];
        const existingIndex = next.findIndex((entry) => entry.user.id === nextUser.id);
        const normalizedEntry: PhoneContactMatch = {
          email: nextUser.email || email,
          contactLabel: customLabel || nextUser.name || nextUser.email || email,
          user: nextUser,
        };
        if (existingIndex >= 0) {
          next[existingIndex] = normalizedEntry;
        } else {
          next.push(normalizedEntry);
        }
        return next.sort((left, right) =>
          left.contactLabel.localeCompare(right.contactLabel, "fr")
        );
      });
      setCreateFirstName("");
      setCreateLastName("");
      setCreateEmail("");
      setOpenHomePanel("chats");
      setNewChatMenuOpen(false);
    } catch (error) {
      setCreateDirectError(error instanceof Error ? error.message : "Erreur création chat.");
    } finally {
      setCreatingDirect(false);
    }
  };

  const goToGroupDetailsStep = useCallback(() => {
    setCreateGroupError("");
    if (selectedGroupMemberIds.length === 0) {
      setCreateGroupError("Sélectionne au moins un contact puis appuie sur Suivant.");
      return;
    }
    setGroupCreationStep("details");
  }, [selectedGroupMemberIds.length]);

  const startGroupChat = async () => {
    setCreateGroupError("");
    setCreatingGroup(true);
    try {
      if (!currentUser) {
        throw new Error("Utilisateur non connecté.");
      }

      const memberIds = Array.from(
        new Set(
          selectedGroupMemberIds.filter(
            (memberId) => memberId && memberId !== currentUser.uid
          )
        )
      );
      if (memberIds.length === 0) {
        throw new Error("Sélectionne au moins un contact pour créer le groupe.");
      }

      const chatId = await createGroupChat({
        title: groupTitle.trim() || "Groupe",
        memberIds,
        createdBy: currentUser.uid,
      });

      setGroupTitle("");
      setSelectedGroupMemberIds([]);
      setGroupCreationStep("select");
      setSelectedChatId(chatId);
      setOpenHomePanel("chats");
      setNewChatMenuOpen(false);
    } catch (error) {
      setCreateGroupError(error instanceof Error ? error.message : "Erreur création groupe.");
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleAddMember = async () => {
    setGroupManageError("");
    setGroupManageBusy(true);
    try {
      if (!selectedChat || selectedChat.type !== "group") {
        throw new Error("Aucun groupe sélectionné.");
      }
      if (!isGroupAdmin) {
        throw new Error("Seul un admin peut ajouter des membres.");
      }
      const email = addMemberEmail.trim().toLowerCase();
      if (!email) {
        throw new Error("Email membre manquant.");
      }
      const target = await findUserByEmail(email);
      if (!target) {
        throw new Error("Utilisateur introuvable.");
      }
      if (selectedChat.participants.includes(target.id)) {
        throw new Error("Cet utilisateur est déjà dans le groupe.");
      }
      await addGroupMembers({ chatId: selectedChat.id, memberIds: [target.id] });
      setUsersById((current) => ({ ...current, [target.id]: target }));
      setAddMemberEmail("");
    } catch (error) {
      setGroupManageError(error instanceof Error ? error.message : "Erreur ajout membre.");
    } finally {
      setGroupManageBusy(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    setGroupManageError("");
    setGroupManageBusy(true);
    try {
      if (!selectedChat || selectedChat.type !== "group") {
        throw new Error("Aucun groupe sélectionné.");
      }
      if (!isGroupAdmin) {
        throw new Error("Seul un admin peut retirer des membres.");
      }
      if (memberId === currentUser?.uid) {
        throw new Error("Utilise un autre compte admin pour te retirer du groupe.");
      }
      await removeGroupMember({ chatId: selectedChat.id, memberId });
    } catch (error) {
      setGroupManageError(error instanceof Error ? error.message : "Erreur suppression membre.");
    } finally {
      setGroupManageBusy(false);
    }
  };

  const requestDeleteMessage = useCallback(
    (messageId: string) => {
      if (!selectedChatId || !currentUser) return;
      Alert.alert(
        "Supprimer ce message ?",
        "Cette action est irréversible.",
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Supprimer",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setChatActionBusy(true);
                setMessageError("");
                try {
                  await deleteMessageFromChat({
                    chatId: selectedChatId,
                    messageId,
                    actorUserId: currentUser.uid,
                  });
                } catch (error) {
                  setMessageError(
                    error instanceof Error ? error.message : "Erreur suppression message."
                  );
                } finally {
                  setChatActionBusy(false);
                }
              })();
            },
          },
        ],
        { cancelable: true }
      );
    },
    [currentUser, selectedChatId]
  );

  const handleDeleteDirectContact = useCallback(() => {
    if (!selectedChat || !currentUser || selectedChat.type !== "direct") return;
    const otherUserId = selectedChat.participants.find((entry) => entry !== currentUser.uid) || "";
    if (!otherUserId) return;
    const otherUser = usersById[otherUserId];
    const contactLabel = otherUser?.name || otherUser?.email || "ce contact";

    Alert.alert(
      "Supprimer ce contact ?",
      `Le chat direct avec ${contactLabel} sera retiré de ta liste.`,
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setChatActionBusy(true);
              setMessageError("");
              try {
                await removeDirectContactForUser({
                  chatId: selectedChat.id,
                  currentUserId: currentUser.uid,
                  otherUserId,
                  otherEmail: otherUser?.email,
                });
                setSelectedChatId(null);
              } catch (error) {
                setMessageError(
                  error instanceof Error ? error.message : "Erreur suppression contact."
                );
              } finally {
                setChatActionBusy(false);
              }
            })();
          },
        },
      ],
      { cancelable: true }
    );
  }, [currentUser, selectedChat, usersById]);

  const openContactChat = useCallback(
    async (entry: PhoneContactMatch) => {
      setContactsError("");
      try {
        await openDirectChatWithUser(entry.user);
      } catch (error) {
        setContactsError(error instanceof Error ? error.message : "Impossible d’ouvrir le chat.");
      }
    },
    [openDirectChatWithUser]
  );

  const startInAppCall = useCallback(
    async ({
      userId,
      label,
      mode,
      setError,
    }: {
      userId: string;
      label?: string;
      mode: ChatCallMode;
      setError: (value: string) => void;
    }) => {
      setError("");
      const targetUserId = userId.trim();
      try {
        if (!targetUserId) {
          throw new Error("Contact introuvable.");
        }
        if (!onStartCall) {
          throw new Error("Appel BFZoom indisponible sur cet écran.");
        }
        setStartingVoiceCallUserId(targetUserId);
        setStartingCallMode(mode);
        await onStartCall({
          userId: targetUserId,
          label: label?.trim() || undefined,
          mode,
        });
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Impossible de lancer l’appel BFZoom."
        );
      } finally {
        setStartingVoiceCallUserId((current) => (current === targetUserId ? "" : current));
        setStartingCallMode((current) => (current === mode ? "" : current));
      }
    },
    [onStartCall]
  );

  const callContactInApp = useCallback(
    (entry: PhoneContactMatch, mode: ChatCallMode) => {
      void startInAppCall({
        userId: entry.user.id,
        label: entry.contactLabel || entry.user.name || entry.user.email,
        mode,
        setError: setContactsError,
      });
    },
    [startInAppCall]
  );

  const callSelectedDirectPeer = useCallback((mode: ChatCallMode) => {
    if (!selectedDirectPeer) return;
    void startInAppCall({
      userId: selectedDirectPeer.userId,
      label: selectedDirectPeer.label,
      mode,
      setError: setMessageError,
    });
  }, [selectedDirectPeer, startInAppCall]);

  const deletePhoneContact = useCallback(
    (entry: PhoneContactMatch) => {
      if (!currentUser) return;
      const targetId = entry.user.id;
      const targetLabel = entry.contactLabel || entry.user.name || entry.user.email || "ce contact";

      Alert.alert(
        "Supprimer ce contact ?",
        `Le chat direct avec ${targetLabel} sera retiré de ta liste.`,
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Supprimer",
            style: "destructive",
            onPress: () => {
              void (async () => {
                setChatActionBusy(true);
                setContactsError("");
                try {
                  const directChatId = getDirectChatId(currentUser.uid, targetId);
                  try {
                    await removeDirectContactForUser({
                      chatId: directChatId,
                      currentUserId: currentUser.uid,
                      otherUserId: targetId,
                      otherEmail: entry.user.email || entry.email,
                    });
                  } catch (error) {
                    const message = error instanceof Error ? error.message : "Erreur suppression contact.";
                    if (!/introuvable/i.test(message)) {
                      throw error;
                    }
                  }

                  setPhoneContactMatches((current) =>
                    current.filter((match) => match.user.id !== targetId)
                  );
                  setSelectedGroupMemberIds((current) =>
                    current.filter((memberId) => memberId !== targetId)
                  );
                  if (selectedChatIdRef.current === directChatId) {
                    setSelectedChatId(null);
                  }
                } catch (error) {
                  setContactsError(
                    error instanceof Error ? error.message : "Erreur suppression contact."
                  );
                } finally {
                  setChatActionBusy(false);
                }
              })();
            },
          },
        ],
        { cancelable: true }
      );
    },
    [currentUser]
  );

  const translateDraftForChat = useCallback(
    async (text: string, targetLanguage: ChatLanguageCode) => {
      if (!auth?.currentUser) {
        throw new Error("Connexion requise pour traduire avant envoi.");
      }
      const token = await auth.currentUser.getIdToken(true);
      const targetLabel = CHAT_LANGUAGE_LABELS[targetLanguage] || targetLanguage.toUpperCase();
      const raw = await askOpenAi({
        apiBaseUrl: env.apiBaseUrl.trim().replace(/\/+$/, ""),
        bearerToken: token,
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
      });

      const fallbackText = raw.trim();
      const parsed = parseJsonPayload(raw);
      const translatedCandidate =
        (typeof parsed?.translatedText === "string" ? parsed.translatedText : fallbackText).trim();
      if (!translatedCandidate) {
        throw new Error("Traduction vide, impossible d'envoyer le message.");
      }
      const sourceLanguage =
        sanitizeLanguageCode(
          typeof parsed?.sourceLanguage === "string" ? parsed.sourceLanguage : undefined
        ) || "auto";

      return {
        translatedText: translatedCandidate,
        sourceLanguage,
        targetLanguage,
      };
    },
    []
  );

  const queueChatPushFanout = useCallback(
    async ({
      chatId,
      senderName,
      messageType,
      previewText,
    }: {
      chatId: string;
      senderName: string;
      messageType: PushMessageType;
      previewText?: string;
    }) => {
      if (!currentUser) return;
      const apiBaseUrl = env.apiBaseUrl.trim().replace(/\/+$/, "");
      if (!apiBaseUrl) return;

      const bearerToken = await currentUser.getIdToken().catch(() => "");
      if (!bearerToken) return;

      try {
        await triggerChatPushFanout({
          apiBaseUrl,
          bearerToken,
          chatId,
          senderName,
          messageType,
          previewText,
        });
      } catch (error) {
        console.warn(
          error instanceof Error ? error.message : "Remote chat push fanout failed."
        );
      }
    },
    [currentUser]
  );

  const handleSend = async () => {
    setMessageError("");
    setTranslationError("");
    setAttachmentError("");
    setSending(true);
    try {
      if (!currentUser) {
        throw new Error("Utilisateur non connecté.");
      }
      if (!selectedChatId) {
        throw new Error("Aucune discussion sélectionnée.");
      }
      const cleanDraft = draft.trim();
      if (!cleanDraft) {
        throw new Error("Message vide.");
      }

      // send original immediately
      const senderName =
        currentUser.displayName?.trim() || currentUser.email?.trim() || "Utilisateur";
      let messageId: string | null = null;
      try {
        messageId = await sendTextMessage({
          chatId: selectedChatId,
          text: cleanDraft,
          senderId: currentUser.uid,
          senderName,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Impossible d’envoyer le message, vérifie ta connexion.";
        setTranslationError(message);
        setMessageError(message);
        throw err;
      }

      // background translation
      if (messageId) {
        translateDraftForChat(cleanDraft, chatLanguage)
          .then(async (translated) => {
            try {
              const firestore = requireDb();
              const msgRef = doc(firestore, `chats/${selectedChatId}/messages`, messageId!);
              await updateDoc(msgRef, {
                text: translated.translatedText,
                originalText: cleanDraft,
                sourceLanguage: translated.sourceLanguage,
                targetLanguage: translated.targetLanguage,
              });
            } catch (e) {
              console.warn("mobile background translation update failed", e);
            }
          })
          .catch((translationError) => {
            console.warn(
              translationError instanceof Error
                ? translationError.message
                : "translateDraftForChat fallback to original text"
            );
          });
      }
              void queueChatPushFanout({
        chatId: selectedChatId,
        senderName,
        messageType: "text",
        previewText: cleanDraft,
      });

      setDraft("");
      shouldAutoScrollRef.current = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur envoi message.";
      setTranslationError(message);
      setMessageError(message);
    } finally {
      setSending(false);
    }
  };

  const sendAttachmentFromLocal = useCallback(
    async ({
      uri,
      fileName,
      mimeType,
      fileSize,
    }: {
      uri: string;
      fileName: string;
      mimeType?: string;
      fileSize?: number;
    }) => {
      setMessageError("");
      setAttachmentError("");
      setSendingAttachment(true);
      try {
        if (!currentUser) {
          throw new Error("Utilisateur non connecté.");
        }
        if (!selectedChatId) {
          throw new Error("Aucune discussion sélectionnée.");
        }
        const senderName =
          currentUser.displayName?.trim() || currentUser.email?.trim() || "Utilisateur";
        const normalizedMime = (mimeType || "").trim().toLowerCase();
        const messageType: PushMessageType = normalizedMime.startsWith("image/")
          ? "image"
          : normalizedMime.startsWith("audio/")
            ? "voice"
            : "file";

        await sendAttachmentMessage({
          chatId: selectedChatId,
          localUri: uri,
          fileName,
          contentType: mimeType,
          size: fileSize,
          senderId: currentUser.uid,
          senderName,
        });
        void queueChatPushFanout({
          chatId: selectedChatId,
          senderName,
          messageType,
          previewText: fileName,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erreur envoi fichier.";
        setAttachmentError(message);
        setMessageError(message);
      } finally {
        setSendingAttachment(false);
      }
    },
    [currentUser, queueChatPushFanout, selectedChatId]
  );

  const handlePickFromLibrary = useCallback(async () => {
    setAttachmentError("");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Autorise l’accès Photos pour envoyer une image ou vidéo.");
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: false,
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) {
        throw new Error("Aucun média sélectionné.");
      }
      const inferredType =
        asset.mimeType ||
        (asset.type === "video" ? "video/mp4" : asset.type === "image" ? "image/jpeg" : undefined);
      const extension =
        inferredType && inferredType.includes("/")
          ? inferredType.split("/")[1]?.split(";")[0] || ""
          : asset.type === "video"
            ? "mp4"
            : "jpg";
      const fallbackName = `media-${Date.now()}${extension ? `.${extension}` : ""}`;

      await sendAttachmentFromLocal({
        uri: asset.uri,
        fileName: asset.fileName || fallbackName,
        mimeType: inferredType,
        fileSize: asset.fileSize,
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Erreur sélection média.");
    }
  }, [sendAttachmentFromLocal]);

  const handlePickDocument = useCallback(async () => {
    setAttachmentError("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: "*/*",
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) {
        throw new Error("Aucun fichier sélectionné.");
      }
      await sendAttachmentFromLocal({
        uri: asset.uri,
        fileName: asset.name || `file-${Date.now()}`,
        mimeType: asset.mimeType || "application/octet-stream",
        fileSize: asset.size,
      });
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "Erreur sélection fichier.");
    }
  }, [sendAttachmentFromLocal]);

  const syncPhoneContacts = useCallback(async () => {
    setContactsError("");
    setContactsLoading(true);
    try {
      if (!currentUser) {
        throw new Error("Connexion requise.");
      }
      const permission = await Contacts.requestPermissionsAsync();
      if (permission.status !== "granted") {
        throw new Error("Autorise l’accès Contacts iPhone pour détecter tes contacts BFZoom.");
      }

      const response = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.Emails,
        ],
        pageSize: 1000,
      });

      const emailToLabel = new Map<string, string>();
      response.data.forEach((entry: Contacts.Contact) => {
        const label =
          entry.name?.trim() ||
          [entry.firstName, entry.lastName].filter(Boolean).join(" ").trim() ||
          "Contact";
        (entry.emails || []).forEach((emailEntry: Contacts.Email) => {
          const normalized = emailEntry.email?.trim().toLowerCase() || "";
          if (!normalized || emailToLabel.has(normalized)) return;
          emailToLabel.set(normalized, label);
        });
      });

      const emails = Array.from(emailToLabel.keys());
      setPhoneContactsScanned(emails.length);
      if (emails.length === 0) {
        setPhoneContactMatches([]);
        return;
      }

      const foundByEmail = await findUsersByEmails(emails);
      const matches: PhoneContactMatch[] = [];
      const seenUsers = new Set<string>();

      emails.forEach((email) => {
        const user = foundByEmail[email];
        if (!user) return;
        if (user.id === currentUser.uid) return;
        if (seenUsers.has(user.id)) return;
        seenUsers.add(user.id);
        matches.push({
          email,
          contactLabel: emailToLabel.get(email) || user.name || email,
          user,
        });
      });

      matches.sort((left, right) => left.contactLabel.localeCompare(right.contactLabel, "fr"));
      setPhoneContactMatches(matches);
      setUsersById((current) => {
        const next = { ...current };
        matches.forEach((entry) => {
          next[entry.user.id] = entry.user;
        });
        return next;
      });
    } catch (error) {
      setContactsError(error instanceof Error ? error.message : "Erreur synchronisation contacts.");
    } finally {
      setContactsLoading(false);
    }
  }, [currentUser]);

  const openAttachment = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      setMessageError("Impossible d’ouvrir ce fichier.");
    }
  }, []);

  const clearVoiceMonitor = useCallback(() => {
    if (!voiceMonitorRef.current) return;
    clearInterval(voiceMonitorRef.current);
    voiceMonitorRef.current = null;
  }, []);

  const stopVoicePlayback = useCallback(() => {
    clearVoiceMonitor();
    const player = voicePlayerRef.current;
    if (player) {
      try {
        player.pause();
      } catch {}
      try {
        player.remove();
      } catch {}
    }
    voicePlayerRef.current = null;
    setPlayingVoiceMessageId("");
  }, [clearVoiceMonitor]);

  const playVoiceNote = useCallback(
    async (messageId: string, url: string) => {
      setVoiceError("");
      try {
        if (playingVoiceMessageId === messageId) {
          stopVoicePlayback();
          return;
        }

        stopVoicePlayback();
        await setPlaybackAudioMode().catch(() => {});
        const player = createAudioPlayer({ uri: url });
        voicePlayerRef.current = player;
        setPlayingVoiceMessageId(messageId);
        player.play();

        clearVoiceMonitor();
        voiceMonitorRef.current = setInterval(() => {
          const activePlayer = voicePlayerRef.current;
          if (!activePlayer) {
            clearVoiceMonitor();
            return;
          }
          const ended =
            !activePlayer.playing &&
            activePlayer.duration > 0 &&
            activePlayer.currentTime >= activePlayer.duration - 0.15;
          if (ended) {
            stopVoicePlayback();
          }
        }, 250);
      } catch (error) {
        stopVoicePlayback();
        setVoiceError(toFriendlyAudioError(error));
      }
    },
    [
      clearVoiceMonitor,
      playingVoiceMessageId,
      setPlaybackAudioMode,
      stopVoicePlayback,
      toFriendlyAudioError,
    ]
  );

  const startVoiceRecording = useCallback(async () => {
    setVoiceError("");
    setAttachmentError("");
    try {
      if (recordingActive || sendingVoice) return;
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        throw new Error("Autorise le micro pour envoyer des notes vocales.");
      }
      stopVoicePlayback();
      await setRecordingAudioMode();
      await recorder.prepareToRecordAsync();
      voiceRecordStartedAtRef.current = Date.now();
      recorder.record();
    } catch (error) {
      setVoiceError(toFriendlyAudioError(error));
      void setPlaybackAudioMode().catch(() => {});
    }
  }, [
    recordingActive,
    recorder,
    sendingVoice,
    setPlaybackAudioMode,
    setRecordingAudioMode,
    stopVoicePlayback,
    toFriendlyAudioError,
  ]);

  const stopVoiceRecordingAndSend = useCallback(async () => {
    setVoiceError("");
    setAttachmentError("");
    setSendingVoice(true);
    try {
      if (!recordingActive) return;
      await recorder.stop();
      await setPlaybackAudioMode();
      const uri = recorder.uri || recorderUrlRef.current || recorderState.url || "";
      if (!uri) {
        throw new Error("Audio introuvable.");
      }
      if (!currentUser) {
        throw new Error("Utilisateur non connecté.");
      }
      if (!selectedChatId) {
        throw new Error("Aucune discussion sélectionnée.");
      }
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - (voiceRecordStartedAtRef.current || Date.now())) / 1000)
      );
      const senderName =
        currentUser.displayName?.trim() || currentUser.email?.trim() || "Utilisateur";
      await sendVoiceNoteMessage({
        chatId: selectedChatId,
        localUri: uri,
        mimeType: "audio/mp4",
        duration: durationSeconds,
        senderId: currentUser.uid,
        senderName,
      });
      void queueChatPushFanout({
        chatId: selectedChatId,
        senderName,
        messageType: "voice",
        previewText: "Note vocale",
      });
    } catch (error) {
      const message = toFriendlyAudioError(error);
      setVoiceError(message);
      setMessageError(message);
    } finally {
      setSendingVoice(false);
    }
  }, [
    currentUser,
    queueChatPushFanout,
    recorder,
    recorderState.url,
    recordingActive,
    selectedChatId,
    setPlaybackAudioMode,
    toFriendlyAudioError,
  ]);

  useEffect(() => {
    return () => {
      stopVoicePlayback();
      void recorder.stop().catch(() => {});
    };
  }, [recorder, stopVoicePlayback]);

  useEffect(() => {
    stopVoicePlayback();
    setVoiceError("");
  }, [selectedChatId, stopVoicePlayback]);

  const toggleMessageLanguage = (messageId: string) => {
    setShowOriginalByMessage((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  if (!firebaseConfigured || !db || !auth) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>
          Firebase n’est pas configuré dans `mobile/.env` (chat indisponible).
        </Text>
      </View>
    );
  }

  if (authLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#38bdf8" />
      </View>
    );
  }

  if (!currentUser) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>Chat</Text>
        <Text style={styles.subtitle}>
          Connecte-toi dans l’onglet Conférence pour accéder au chat temps réel.
        </Text>
      </View>
    );
  }

  if (selectedChat) {
    return (
        <View style={styles.threadRoot}>
          <View style={styles.threadHeader}>
            <Pressable style={styles.backButton} onPress={() => setSelectedChatId(null)}>
              <Text style={styles.backText}>Retour</Text>
            </Pressable>
            <View style={styles.threadHeaderText}>
              <Text style={styles.threadTitle}>{resolveChatTitle(selectedChat)}</Text>
              <Text style={styles.threadSubtitle}>
                {selectedChat.type === "group" ? "Groupe" : "Direct"}
              </Text>
              {selectedChat.type === "direct" && selectedDirectPeer?.email ? (
                <Text style={styles.threadPeerEmail}>{selectedDirectPeer.email}</Text>
              ) : null}
              {selectedChat.type === "direct" && selectedDirectPeer ? (
                <Text
                  style={[
                    styles.threadPresenceText,
                    isUserOnline(selectedDirectPeer.userId)
                      ? styles.threadPresenceOnline
                      : styles.threadPresenceOffline,
                  ]}
                >
                  {getPresenceLabel(selectedDirectPeer.userId)}
                </Text>
              ) : null}
            </View>
            {selectedChat.type === "direct" ? (
              <View style={styles.threadHeaderActions}>
                <Pressable
                  style={[styles.callContactButton, !selectedDirectPeer && styles.buttonDisabled]}
                  onPress={() => callSelectedDirectPeer("audio")}
                  disabled={!selectedDirectPeer || Boolean(startingVoiceCallUserId)}
                >
                  <Text style={styles.callContactText}>
                    {selectedDirectPeer &&
                    startingVoiceCallUserId === selectedDirectPeer.userId &&
                    startingCallMode === "audio"
                      ? "Audio..."
                      : "Appel audio"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.callVideoButton, !selectedDirectPeer && styles.buttonDisabled]}
                  onPress={() => callSelectedDirectPeer("video")}
                  disabled={!selectedDirectPeer || Boolean(startingVoiceCallUserId)}
                >
                  <Text style={styles.callVideoText}>
                    {selectedDirectPeer &&
                    startingVoiceCallUserId === selectedDirectPeer.userId &&
                    startingCallMode === "video"
                      ? "Visio..."
                      : "Visio"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.deleteContactButton, chatActionBusy && styles.buttonDisabled]}
                  onPress={handleDeleteDirectContact}
                  disabled={chatActionBusy}
                >
                  <Text style={styles.deleteContactText}>Suppr contact</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {selectedChat.type === "group" ? (
            <View style={styles.groupPanel}>
              <Text style={styles.sectionTitle}>
                Membres ({selectedChat.participants.length}){isGroupAdmin ? " · Admin" : ""}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.memberRow}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {selectedChat.participants.map((participantId) => (
                  <View key={participantId} style={styles.memberBadge}>
                    <Text style={styles.memberText}>{resolveUserLabel(participantId)}</Text>
                    {isGroupAdmin && participantId !== currentUser.uid ? (
                      <Pressable
                        onPress={() => handleRemoveMember(participantId)}
                        disabled={groupManageBusy}
                      >
                        <Text style={styles.memberRemove}>Retirer</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </ScrollView>

              {isGroupAdmin ? (
                <View style={styles.row}>
                  <TextInput
                    value={addMemberEmail}
                    onChangeText={setAddMemberEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    placeholder="email à ajouter"
                    placeholderTextColor="#64748b"
                    style={[styles.input, styles.grow]}
                  />
                  <Pressable
                    onPress={handleAddMember}
                    disabled={groupManageBusy || !addMemberEmail.trim()}
                    style={[
                      styles.createButton,
                      (groupManageBusy || !addMemberEmail.trim()) && styles.buttonDisabled,
                    ]}
                  >
                    <Text style={styles.sendText}>Ajouter</Text>
                  </Pressable>
                </View>
              ) : null}
              {groupManageError ? <Text style={styles.errorInline}>{groupManageError}</Text> : null}
            </View>
          ) : null}

          <View style={styles.translationTools}>
            <Text style={styles.sectionTitle}>Langue chat</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.languageRow}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              {CHAT_LANGUAGE_OPTIONS.map((entry) => (
                <Pressable
                  key={`chat-lang-${entry.code}`}
                  onPress={() => setChatLanguage(entry.code)}
                  style={[
                    styles.languageChip,
                    chatLanguage === entry.code && styles.languageChipActive,
                  ]}
                >
                  <Text style={styles.languageChipText}>{entry.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {translationError ? <Text style={styles.errorInline}>{translationError}</Text> : null}
          </View>

          <FlatList
            ref={messageListRef}
            style={styles.messageListContainer}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollBeginDrag={Keyboard.dismiss}
            scrollEventThrottle={80}
            onScroll={(event) => {
              const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
              const distanceToBottom =
                contentSize.height - (contentOffset.y + layoutMeasurement.height);
              shouldAutoScrollRef.current = distanceToBottom < 90;
            }}
            renderItem={({ item }) => {
            const mine = item.senderId === currentUser.uid;
            const sourceLang = sanitizeLanguageCode(item.sourceLanguage);
            const targetLang = sanitizeLanguageCode(item.targetLanguage);
            const hasDualText =
              Boolean(item.originalText?.trim()) &&
              Boolean(item.text?.trim()) &&
              item.originalText?.trim() !== item.text?.trim();
            const showOriginal = Boolean(showOriginalByMessage[item.id]) && hasDualText;
            const visibleText = showOriginal
              ? item.originalText?.trim() || item.text || ""
              : item.text?.trim() || item.originalText?.trim() || "";
            const visibleLanguageCode = sanitizeLanguageCode(
              showOriginal ? sourceLang : targetLang || chatLanguage
            );
            const rtlMessage = isRtlLanguageCode(visibleLanguageCode);
            const sourceLabel =
              sourceLang && sourceLang.length === 2
                ? sourceLang.toUpperCase()
                : sourceLang
                  ? sourceLang
                  : "AUTO";
            const targetLabel =
              targetLang && targetLang.length === 2
                ? targetLang.toUpperCase()
                : targetLang
                  ? targetLang
                  : chatLanguage.toUpperCase();
            const hasImageAttachment =
              item.type === "image" && Boolean(item.attachment?.url);
            const hasFileAttachment = item.type === "file" && Boolean(item.attachment?.url);
            const hasVoiceNote = item.type === "voice" && Boolean(item.voiceNote?.url);
            const attachmentName = item.attachment?.name || "Fichier";
            const isVideoAttachment = Boolean(item.attachment?.contentType?.startsWith("video/"));
            const voiceDuration = Math.max(1, Math.round(item.voiceNote?.duration || 0));
            const isPlayingThisVoice = playingVoiceMessageId === item.id;

            return (
              <Pressable
                style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}
                onPress={hasDualText ? () => toggleMessageLanguage(item.id) : undefined}
                disabled={!hasDualText}
              >
                {!mine ? <Text style={styles.senderName}>{item.senderName}</Text> : null}
                {hasImageAttachment ? (
                  <Pressable onPress={() => openAttachment(item.attachment!.url)}>
                    <Image source={{ uri: item.attachment!.url }} style={styles.messageImage} />
                    <Text style={styles.attachmentHint}>{attachmentName}</Text>
                  </Pressable>
                ) : hasFileAttachment ? (
                  <Pressable
                    onPress={() => openAttachment(item.attachment!.url)}
                    style={styles.attachmentButton}
                  >
                    <Text style={styles.attachmentButtonText}>
                      {isVideoAttachment ? "▶️ Ouvrir vidéo" : "📎 Ouvrir fichier"}
                    </Text>
                    <Text style={styles.attachmentHint}>{attachmentName}</Text>
                  </Pressable>
                ) : hasVoiceNote ? (
                  <Pressable
                    onPress={() => playVoiceNote(item.id, item.voiceNote!.url)}
                    style={styles.voiceNoteButton}
                  >
                    <Text style={styles.voiceNoteButtonText}>
                      {isPlayingThisVoice ? "⏸ Stop note vocale" : "▶️ Lire note vocale"}
                    </Text>
                    <Text style={styles.attachmentHint}>{voiceDuration}s</Text>
                  </Pressable>
                ) : (
                  <Text style={[styles.messageText, rtlMessage && styles.rtlText]}>
                    {visibleText}
                  </Text>
                )}
                {hasDualText ? (
                  <Text style={styles.languageHint}>
                    {sourceLabel} → {targetLabel} · {showOriginal ? "Original" : "Traduit"} ·
                    toucher pour basculer
                  </Text>
                ) : null}
                {mine ? (
                  <Pressable
                    onPress={() => requestDeleteMessage(item.id)}
                    disabled={chatActionBusy}
                    style={styles.deleteMessageButton}
                  >
                    <Text style={styles.deleteMessageText}>Supprimer</Text>
                  </Pressable>
                ) : null}
                <Text style={styles.messageTime}>{timestampToLabel(item.createdAt)}</Text>
              </Pressable>
            );
            }}
            onContentSizeChange={() => {
              if (!shouldAutoScrollRef.current) return;
              messageListRef.current?.scrollToEnd({ animated: true });
            }}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.subtitle}>Aucun message pour le moment.</Text>
              </View>
            }
          />

          <View style={styles.composer}>
            <View style={styles.attachmentActions}>
              <Pressable
                onPress={handlePickFromLibrary}
                disabled={sendingAttachment || sendingVoice || recordingActive}
                style={[
                  styles.attachmentActionButton,
                  (sendingAttachment || sendingVoice || recordingActive) && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.attachmentActionText}>Media</Text>
              </Pressable>
              <Pressable
                onPress={handlePickDocument}
                disabled={sendingAttachment || sendingVoice || recordingActive}
                style={[
                  styles.attachmentActionButton,
                  (sendingAttachment || sendingVoice || recordingActive) && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.attachmentActionText}>Fichier</Text>
              </Pressable>
              <Pressable
                onPress={recordingActive ? stopVoiceRecordingAndSend : startVoiceRecording}
                disabled={sendingVoice}
                style={[
                  styles.attachmentActionButton,
                  recordingActive && styles.voiceRecordingButton,
                  sendingVoice && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.attachmentActionText}>
                  {sendingVoice ? "Envoi..." : recordingActive ? "Stop" : "Voice"}
                </Text>
              </Pressable>
            </View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ton message..."
              placeholderTextColor="#64748b"
              style={[
                styles.composerInput,
                /[\u0590-\u08FF]/.test(draft) && styles.rtlInput,
              ]}
              multiline
            />
            <Pressable
              onPress={handleSend}
              disabled={
                sending || sendingAttachment || sendingVoice || recordingActive || !draft.trim()
              }
              style={[
                styles.sendButton,
                (sending ||
                  sendingAttachment ||
                  sendingVoice ||
                  recordingActive ||
                  !draft.trim()) &&
                  styles.buttonDisabled,
              ]}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#e2e8f0" />
              ) : (
                <Text style={styles.sendText}>Envoyer</Text>
              )}
            </Pressable>
          </View>
          {sendingAttachment ? <Text style={styles.infoInline}>Envoi du fichier en cours...</Text> : null}
          {recordingActive ? <Text style={styles.infoInline}>Enregistrement vocal en cours...</Text> : null}
          {voiceError ? <Text style={styles.errorInline}>{voiceError}</Text> : null}
          {attachmentError ? <Text style={styles.errorInline}>{attachmentError}</Text> : null}
          {messageError ? <Text style={styles.errorInline}>{messageError}</Text> : null}
        </View>
    );
  }

  const renderNewChatPanels = () => (
    <>
      {openHomePanel === "direct" ? <View style={styles.accordionCard}>
        <Pressable style={styles.accordionHeader} onPress={() => toggleHomePanel("direct")}>
          <View style={styles.grow}>
            <Text style={styles.sectionTitle}>Nouveau contact</Text>
            <Text style={styles.hintText}>
              Renseigne prénom, nom et email du contact.
            </Text>
          </View>
          <Text style={styles.accordionIcon}>−</Text>
        </Pressable>
        <View style={styles.accordionBody}>
          <View style={styles.row}>
            <TextInput
              value={createFirstName}
              onChangeText={setCreateFirstName}
              autoCapitalize="words"
              autoCorrect={false}
              placeholder="Prénom"
              placeholderTextColor="#64748b"
              style={[styles.input, styles.grow]}
            />
            <TextInput
              value={createLastName}
              onChangeText={setCreateLastName}
              autoCapitalize="words"
              autoCorrect={false}
              placeholder="Nom"
              placeholderTextColor="#64748b"
              style={[styles.input, styles.grow]}
            />
          </View>
          <TextInput
            value={createEmail}
            onChangeText={setCreateEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="Adresse email du contact"
            placeholderTextColor="#64748b"
            style={styles.input}
          />
          <Pressable
            onPress={startDirectChat}
            disabled={creatingDirect || !createEmail.trim()}
            style={[
              styles.createButton,
              (creatingDirect || !createEmail.trim()) && styles.buttonDisabled,
            ]}
          >
            {creatingDirect ? (
              <ActivityIndicator size="small" color="#e2e8f0" />
            ) : (
              <Text style={styles.sendText}>Créer contact</Text>
            )}
          </Pressable>
          {createDirectError ? <Text style={styles.errorInline}>{createDirectError}</Text> : null}
        </View>
      </View> : null}

      {openHomePanel === "group" ? <View style={styles.accordionCard}>
        <Pressable style={styles.accordionHeader} onPress={() => toggleHomePanel("group")}>
          <View style={styles.grow}>
            <Text style={styles.sectionTitle}>Nouveau groupe</Text>
            <Text style={styles.hintText}>
              {groupCreationStep === "select"
                ? `Sélection des membres (${selectedGroupMemberIds.length})`
                : "Nom du groupe"}
            </Text>
          </View>
          <Text style={styles.accordionIcon}>−</Text>
        </Pressable>
        <View style={styles.accordionBody}>
          {groupCreationStep === "select" ? (
            <>
              <Pressable
                onPress={syncPhoneContacts}
                disabled={contactsLoading}
                style={[styles.secondaryButton, contactsLoading && styles.buttonDisabled]}
              >
                {contactsLoading ? (
                  <ActivityIndicator size="small" color="#e2e8f0" />
                ) : (
                  <Text style={styles.secondaryButtonText}>Synchroniser les contacts</Text>
                )}
              </Pressable>
              {selectedGroupContacts.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.memberRow}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {selectedGroupContacts.map((entry) => (
                    <View key={`group-member-${entry.user.id}`} style={styles.memberBadge}>
                      <Text style={styles.memberText}>{entry.contactLabel}</Text>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              {phoneContactMatches.length > 0 ? (
                <ScrollView
                  style={styles.contactList}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                >
                  {phoneContactMatches.map((entry) => {
                    const selected = selectedGroupMemberIds.includes(entry.user.id);
                    return (
                      <Pressable
                        key={`group-pick-${entry.user.id}`}
                        onPress={() => toggleGroupMemberSelection(entry.user.id)}
                        style={[styles.groupPickRow, selected && styles.groupPickRowActive]}
                      >
                        <View style={styles.grow}>
                          <Text style={styles.contactName}>{entry.contactLabel}</Text>
                          <Text style={styles.contactMeta}>{entry.user.email || entry.email}</Text>
                        </View>
                        <Text style={styles.groupPickAction}>{selected ? "Retirer" : "Ajouter"}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={styles.subtitleLeft}>
                  Ajoute d’abord des contacts via "Nouveau contact" pour pouvoir créer un groupe.
                </Text>
              )}
              <Pressable
                onPress={goToGroupDetailsStep}
                disabled={selectedGroupMemberIds.length === 0}
                style={[
                  styles.createButton,
                  selectedGroupMemberIds.length === 0 && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.sendText}>Suivant</Text>
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                value={groupTitle}
                onChangeText={setGroupTitle}
                placeholder="Nom du groupe"
                placeholderTextColor="#64748b"
                style={styles.input}
              />
              <View style={styles.row}>
                <Pressable
                  onPress={() => setGroupCreationStep("select")}
                  style={[styles.secondaryButton, styles.grow]}
                >
                  <Text style={styles.secondaryButtonText}>Retour</Text>
                </Pressable>
                <Pressable
                  onPress={startGroupChat}
                  disabled={creatingGroup || !groupTitle.trim()}
                  style={[
                    styles.createButton,
                    styles.grow,
                    (creatingGroup || !groupTitle.trim()) && styles.buttonDisabled,
                  ]}
                >
                  {creatingGroup ? (
                    <ActivityIndicator size="small" color="#e2e8f0" />
                  ) : (
                    <Text style={styles.sendText}>Créer</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
          {contactsError ? <Text style={styles.errorInline}>{contactsError}</Text> : null}
          {createGroupError ? <Text style={styles.errorInline}>{createGroupError}</Text> : null}
        </View>
      </View> : null}
    </>
  );

  const renderMissedCallsPanel = () => {
    if (openHomePanel !== "missed") return null;
    return <View style={styles.accordionCard}>
      <Pressable style={styles.accordionHeader} onPress={() => toggleHomePanel("missed")}>
        <View style={styles.grow}>
          <Text style={styles.sectionTitle}>Appels manques</Text>
          <Text style={styles.hintText}>
            {missedCalls.length} appel(s) manques · {unreadMissedCount} non lu(s)
          </Text>
        </View>
        <Text style={styles.accordionIcon}>−</Text>
      </Pressable>
      <View style={styles.accordionBody}>
        {missedCalls.length > 0 ? (
          <View style={styles.missedList}>
            {missedCalls.map((entry) => {
              const canRecall = Boolean(entry.peerUserId.trim());
              const isCallingCurrent =
                canRecall &&
                startingVoiceCallUserId === entry.peerUserId &&
                startingCallMode === entry.mode;
              return (
                <View key={`missed-${entry.id}`} style={styles.missedRow}>
                  <View style={styles.grow}>
                    <View style={styles.missedTitleRow}>
                      <Text style={styles.contactName}>{entry.peerLabel || "Contact"}</Text>
                      {!entry.read ? (
                        <View style={styles.missedUnreadDot} />
                      ) : null}
                    </View>
                    <Text style={styles.contactMeta}>
                      {entry.mode === "video" ? "Visio" : "Audio"} · {timestampMsToLabel(entry.createdAtMs)}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      void startInAppCall({
                        userId: entry.peerUserId,
                        label: entry.peerLabel || "Contact",
                        mode: entry.mode,
                        setError: setCallHistoryError,
                      });
                    }}
                    disabled={!canRecall || Boolean(startingCallMode)}
                    style={[
                      styles.createButton,
                      styles.smallButton,
                      (!canRecall || Boolean(startingCallMode)) && styles.buttonDisabled,
                    ]}
                  >
                    <Text style={styles.sendText}>
                      {isCallingCurrent ? "Rappel..." : "Rappeler"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.subtitleLeft}>Aucun appel manqué pour le moment.</Text>
        )}
      </View>
    </View>;
  };

  return (
      <View style={styles.listRoot}>
        <Text style={styles.title}>Chat</Text>
        <Text style={styles.subtitle}>Compte connecté: {currentUser.email}</Text>
        <ChatHomeHeader
          openHomePanel={openHomePanel}
          openHomeSection={openHomeSection}
          onToggleNewMenu={toggleNewChatMenu}
          onOpenNewContact={openNewContactPanel}
          onOpenNewGroup={openNewGroupPanel}
          newChatMenuOpen={newChatMenuOpen}
          unreadMissedCount={unreadMissedCount}
          startingCallMode={startingCallMode}
          activeCallingLabel={activeCallingLabel}
          callHistoryError={callHistoryError}
        />

        <ScrollView
          style={styles.homeScroll}
          contentContainerStyle={styles.homeContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {renderNewChatPanels()}

          {renderMissedCallsPanel()}

          <DiscussionsAccordion
            openHomePanel={openHomePanel}
            toggleHomePanel={toggleHomePanel}
            recentIncomingCount={recentIncomingCount}
            chatSearch={chatSearch}
            setChatSearch={setChatSearch}
            chatHomeFilter={chatHomeFilter}
            setChatHomeFilter={setChatHomeFilter}
            filteredChats={filteredChats}
            currentUser={currentUser}
            resolveChatTitle={resolveChatTitle}
            getChatActivityMillis={getChatActivityMillis}
            timestampMsToLabelValue={timestampMsToLabel}
            isUserOnline={isUserOnline}
            getPresenceLabel={getPresenceLabel}
            pinnedChatIds={pinnedChatIds}
            togglePinnedChat={togglePinnedChat}
            onSelectChat={setSelectedChatId}
          />

          {chatError ? <Text style={styles.errorInline}>{chatError}</Text> : null}
        </ScrollView>
      </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    backgroundColor: "#020617",
    gap: 10,
  },
  listRoot: {
    flex: 1,
    backgroundColor: "#020617",
    paddingTop: 14,
    paddingHorizontal: 14,
    gap: 10,
  },
  homeToolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  homeToolbarSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: -2,
  },
  homeToolButton: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  homeToolButtonSecondary: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  homeToolButtonActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  homeToolText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  homeToolTextActive: {
    color: "#e2e8f0",
  },
  homeToolContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  homeToolBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  homeToolBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
  },
  callStatusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#1e3a8a",
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  callStatusText: {
    color: "#bfdbfe",
    fontSize: 12,
    fontWeight: "600",
    flex: 1,
  },
  homeScroll: {
    flex: 1,
  },
  homeContent: {
    paddingBottom: 24,
    gap: 10,
  },
  threadRoot: {
    flex: 1,
    backgroundColor: "#020617",
  },
  threadHeader: {
    borderBottomWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  threadHeaderText: {
    flex: 1,
  },
  threadHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  threadTitle: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "700",
  },
  threadSubtitle: {
    color: "#94a3b8",
    fontSize: 11,
  },
  threadPeerEmail: {
    color: "#93c5fd",
    fontSize: 11,
    marginTop: 2,
  },
  threadPresenceText: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  threadPresenceOnline: {
    color: "#86efac",
  },
  threadPresenceOffline: {
    color: "#94a3b8",
  },
  backButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#1e293b",
  },
  backText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "700",
  },
  deleteContactButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#450a0a",
  },
  deleteContactText: {
    color: "#fecaca",
    fontSize: 11,
    fontWeight: "700",
  },
  callContactButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#0f766e",
    backgroundColor: "#134e4a",
  },
  callContactText: {
    color: "#ccfbf1",
    fontSize: 11,
    fontWeight: "700",
  },
  callVideoButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#1d4ed8",
    backgroundColor: "#1e3a8a",
  },
  callVideoText: {
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: "700",
  },
  groupPanel: {
    borderBottomWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  translationTools: {
    borderBottomWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  languageRow: {
    flexDirection: "row",
    gap: 8,
  },
  languageChip: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  languageChipActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  languageChipText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  memberRow: {
    flexDirection: "row",
    gap: 8,
  },
  memberBadge: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 4,
  },
  memberText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600",
  },
  memberRemove: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "700",
  },
  messageImage: {
    width: 220,
    height: 220,
    borderRadius: 10,
    backgroundColor: "#020617",
  },
  attachmentButton: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  attachmentButtonText: {
    color: "#bfdbfe",
    fontSize: 13,
    fontWeight: "700",
  },
  voiceNoteButton: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  voiceNoteButtonText: {
    color: "#bfdbfe",
    fontSize: 13,
    fontWeight: "700",
  },
  attachmentHint: {
    color: "#94a3b8",
    fontSize: 11,
    marginTop: 4,
  },
  messageList: {
    padding: 12,
    gap: 10,
    paddingBottom: 20,
  },
  messageListContainer: {
    flex: 1,
  },
  bubble: {
    maxWidth: "82%",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  bubbleMine: {
    alignSelf: "flex-end",
    backgroundColor: "#134e4a",
    borderColor: "#0f766e",
  },
  bubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: "#0f172a",
    borderColor: "#334155",
  },
  senderName: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 3,
  },
  messageText: {
    color: "#e2e8f0",
    fontSize: 14,
    lineHeight: 20,
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  messageTime: {
    color: "#94a3b8",
    fontSize: 10,
    marginTop: 4,
  },
  deleteMessageButton: {
    marginTop: 6,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#450a0a",
  },
  deleteMessageText: {
    color: "#fecaca",
    fontSize: 10,
    fontWeight: "700",
  },
  languageHint: {
    color: "#93c5fd",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },
  composer: {
    borderTopWidth: 1,
    borderColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  attachmentActions: {
    gap: 8,
  },
  attachmentActionButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  voiceRecordingButton: {
    borderColor: "#f97316",
    backgroundColor: "#7c2d12",
  },
  attachmentActionText: {
    color: "#bfdbfe",
    fontSize: 12,
    fontWeight: "700",
  },
  composerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    backgroundColor: "#0b1220",
    color: "#e2e8f0",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  rtlInput: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  sendButton: {
    borderRadius: 10,
    backgroundColor: "#0f766e",
    paddingHorizontal: 12,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
  },
  createCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    backgroundColor: "#0b1220",
    padding: 10,
    gap: 8,
  },
  accordionCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    backgroundColor: "#0b1220",
    overflow: "hidden",
  },
  accordionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  accordionBody: {
    borderTopWidth: 1,
    borderColor: "#1e293b",
    padding: 10,
    gap: 8,
  },
  accordionIcon: {
    color: "#93c5fd",
    fontSize: 22,
    fontWeight: "700",
    minWidth: 20,
    textAlign: "center",
    marginTop: -2,
  },
  sectionTitle: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowSpaceBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  grow: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: "#e2e8f0",
    backgroundColor: "#020617",
    fontSize: 14,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  createButton: {
    borderRadius: 10,
    backgroundColor: "#1d4ed8",
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#bfdbfe",
    fontSize: 12,
    fontWeight: "700",
  },
  dangerButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#450a0a",
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: {
    color: "#fecaca",
    fontSize: 12,
    fontWeight: "700",
  },
  hintText: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
  },
  contactList: {
    maxHeight: 180,
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#1e293b",
  },
  contactActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  groupPickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#1e293b",
    borderRadius: 10,
  },
  groupPickRowActive: {
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  groupPickAction: {
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: "700",
  },
  contactName: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
  },
  contactMeta: {
    color: "#94a3b8",
    fontSize: 12,
  },
  contactPresence: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  contactPresenceOnline: {
    color: "#86efac",
  },
  contactPresenceOffline: {
    color: "#94a3b8",
  },
  subtitleLeft: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  chatList: {
    paddingBottom: 24,
    gap: 8,
  },
  chatSearchCard: {
    gap: 8,
    marginBottom: 8,
  },
  chatFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  chatFilterChip: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020617",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chatFilterChipActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  chatFilterChipText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
  },
  chatFilterChipTextActive: {
    color: "#e2e8f0",
  },
  chatItem: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    backgroundColor: "#0b1220",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  chatItemPinned: {
    borderColor: "#0ea5e9",
    backgroundColor: "#082f49",
  },
  chatTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  chatUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
  },
  chatTitle: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  chatPinnedLabel: {
    color: "#7dd3fc",
    fontSize: 10,
    fontWeight: "800",
  },
  chatTime: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
  },
  chatPresence: {
    fontSize: 11,
    fontWeight: "600",
  },
  chatPresenceOnline: {
    color: "#86efac",
  },
  chatPresenceOffline: {
    color: "#94a3b8",
  },
  chatPreview: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
    marginRight: 8,
  },
  chatPinButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#020617",
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  chatPinButtonText: {
    color: "#bfdbfe",
    fontSize: 10,
    fontWeight: "700",
  },
  title: {
    color: "#e2e8f0",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  emptyState: {
    paddingVertical: 28,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  error: {
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  errorInline: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 18,
  },
  infoInline: {
    color: "#93c5fd",
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 10,
  },
  missedList: {
    gap: 8,
  },
  missedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#020617",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  missedTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  missedUnreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f43f5e",
  },
});
