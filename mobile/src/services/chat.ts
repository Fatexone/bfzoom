import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  limitToLast,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  orderBy,
  updateDoc,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { env } from "../config/env";
import { auth, db, storage } from "./firebase";
import type { ChatDoc, ChatMessageDoc } from "../types/chat";

export type BasicUserProfile = {
  id: string;
  name: string;
  email: string;
  phoneE164?: string;
};

export const requireDb = () => {
  if (!db) {
    throw new Error("Firebase Firestore is not configured in mobile env.");
  }
  return db;
};

const requireStorage = () => {
  if (!storage) {
    throw new Error("Firebase Storage is not configured in mobile env.");
  }
  return storage;
};

const toMillis = (value?: { toMillis?: () => number } | null) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  return 0;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  value.forEach((entry) => {
    const clean = typeof entry === "string" ? entry.trim() : "";
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  });
  return out;
};

const normalizeChatDocs = (
  snapshot: QuerySnapshot<DocumentData>,
  currentUserId?: string
): ChatDoc[] => {
  const mapped: ChatDoc[] = [];
  snapshot.docs.forEach((chatSnap) => {
    const data = chatSnap.data() as DocumentData;
    const participants = normalizeStringArray(data.participants);
    const admins = normalizeStringArray(data.admins);
    const chatType = data.type === "group" ? "group" : "direct";
    const hiddenBy =
      data.hiddenBy && typeof data.hiddenBy === "object"
        ? (data.hiddenBy as Record<string, boolean>)
        : {};
    // Keep user-hidden chats out of the list, but resurface when a peer sends a new message.
    const lastMessageSenderId =
      data.lastMessage && typeof data.lastMessage === "object"
        ? String((data.lastMessage as Record<string, unknown>).senderId || "")
        : "";
    if (
      currentUserId &&
      hiddenBy[currentUserId] &&
      (!lastMessageSenderId || lastMessageSenderId === currentUserId)
    ) {
      return;
    }
    mapped.push({
      id: chatSnap.id,
      type: chatType,
      participants,
      admins: admins.length > 0 ? admins : undefined,
      createdBy: typeof data.createdBy === "string" ? data.createdBy : undefined,
      title: typeof data.title === "string" ? data.title : undefined,
      lastMessage: (data.lastMessage as ChatDoc["lastMessage"]) || null,
      updatedAt: (data.updatedAt as ChatDoc["updatedAt"]) || null,
    });
  });

  mapped.sort((a, b) => {
    const left = Math.max(toMillis(a.updatedAt), toMillis(a.lastMessage?.createdAt));
    const right = Math.max(toMillis(b.updatedAt), toMillis(b.lastMessage?.createdAt));
    return right - left;
  });

  return mapped;
};

export const getDirectChatId = (currentUserId: string, otherUserId: string) =>
  [currentUserId, otherUserId].sort().join("__");

export const ensureDirectChat = async (currentUserId: string, otherUserId: string) => {
  const firestore = requireDb();
  const chatId = getDirectChatId(currentUserId, otherUserId);
  const chatRef = doc(firestore, "chats", chatId);
  const chatSnap = await getDoc(chatRef);

  if (!chatSnap.exists()) {
    await setDoc(chatRef, {
      type: "direct",
      participants: [currentUserId, otherUserId],
      createdBy: currentUserId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: null,
    });
  } else {
    await setDoc(
      chatRef,
      {
        [`hiddenBy.${currentUserId}`]: deleteField(),
      },
      { merge: true }
    );
  }

  return chatId;
};

export const createGroupChat = async ({
  title,
  memberIds,
  createdBy,
}: {
  title: string;
  memberIds: string[];
  createdBy: string;
}) => {
  const firestore = requireDb();
  const participants = Array.from(new Set([createdBy, ...memberIds.filter(Boolean)]));
  if (participants.length < 2) {
    throw new Error("Un groupe requiert au moins 2 participants.");
  }

  const groupRef = await addDoc(collection(firestore, "chats"), {
    type: "group",
    title: title.trim() || "Groupe",
    participants,
    admins: [createdBy],
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessage: null,
  });

  return groupRef.id;
};

export const subscribeChats = (
  currentUserId: string,
  onUpdate: (chats: ChatDoc[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const firestore = requireDb();
  const chatsQuery = query(
    collection(firestore, "chats"),
    where("participants", "array-contains", currentUserId),
    limit(80)
  );

  return onSnapshot(
    chatsQuery,
    (snapshot) => {
      onUpdate(normalizeChatDocs(snapshot, currentUserId));
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    }
  );
};

export const subscribeMessages = (
  chatId: string,
  onUpdate: (messages: ChatMessageDoc[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const firestore = requireDb();
  const messageQuery = query(
    collection(firestore, `chats/${chatId}/messages`),
    // Keep only recent messages while preserving natural chronological order.
    orderBy("createdAt", "asc"),
    limitToLast(300)
  );

  return onSnapshot(
    messageQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((messageSnap) => {
        const data = messageSnap.data() as DocumentData;
        const attachmentRaw =
          data.attachment && typeof data.attachment === "object"
            ? (data.attachment as Record<string, unknown>)
            : null;
        const attachment =
          attachmentRaw &&
          typeof attachmentRaw.url === "string" &&
          typeof attachmentRaw.path === "string"
            ? {
                url: attachmentRaw.url,
                path: attachmentRaw.path,
                name: typeof attachmentRaw.name === "string" ? attachmentRaw.name : "Fichier",
                size: typeof attachmentRaw.size === "number" ? attachmentRaw.size : 0,
                contentType:
                  typeof attachmentRaw.contentType === "string"
                    ? attachmentRaw.contentType
                    : "application/octet-stream",
              }
            : undefined;
        const voiceRaw =
          data.voiceNote && typeof data.voiceNote === "object"
            ? (data.voiceNote as Record<string, unknown>)
            : null;
        const voiceNote =
          voiceRaw &&
          typeof voiceRaw.url === "string" &&
          typeof voiceRaw.path === "string"
            ? {
                url: voiceRaw.url,
                path: voiceRaw.path,
                duration: typeof voiceRaw.duration === "number" ? voiceRaw.duration : 0,
                mimeType:
                  typeof voiceRaw.mimeType === "string" ? voiceRaw.mimeType : "audio/webm",
                size: typeof voiceRaw.size === "number" ? voiceRaw.size : 0,
              }
            : undefined;
        return {
          id: messageSnap.id,
          type: (data.type as ChatMessageDoc["type"]) || "text",
          text: typeof data.text === "string" ? data.text : "",
          originalText:
            typeof data.originalText === "string" ? data.originalText : undefined,
          sourceLanguage:
            typeof data.sourceLanguage === "string" ? data.sourceLanguage : undefined,
          targetLanguage:
            typeof data.targetLanguage === "string" ? data.targetLanguage : undefined,
          attachment,
          voiceNote,
          senderId: typeof data.senderId === "string" ? data.senderId : "",
          senderName: typeof data.senderName === "string" ? data.senderName : "Utilisateur",
          createdAt: (data.createdAt as ChatMessageDoc["createdAt"]) || null,
        };
      });
      onUpdate(messages);
    },
    (error) => {
      if (onError) {
        onError(error);
      }
    }
  );
};

export const sendTextMessage = async ({
  chatId,
  text,
  originalText,
  sourceLanguage,
  targetLanguage,
  senderId,
  senderName,
}: {
  chatId: string;
  text: string;
  originalText?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  senderId: string;
  senderName: string;
}): Promise<string> => {
  const firestore = requireDb();
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error("Message vide.");
  }

  const messageRef = await addDoc(collection(firestore, `chats/${chatId}/messages`), {
    type: "text",
    text: cleanText,
    originalText: originalText?.trim() || null,
    sourceLanguage: sourceLanguage?.trim() || null,
    targetLanguage: targetLanguage?.trim() || null,
    encrypted: false,
    senderId,
    senderName,
    createdAt: serverTimestamp(),
  });

  await setDoc(
    doc(firestore, "chats", chatId),
    {
      updatedAt: serverTimestamp(),
      hiddenBy: deleteField(),
      lastMessage: {
        type: "text",
        text: cleanText,
        senderId,
        createdAt: serverTimestamp(),
      },
    },
    { merge: true }
  );

  return messageRef.id;
};

const inferAttachmentLabel = (contentType: string, fallbackName: string) => {
  if (contentType.startsWith("image/")) return "Image";
  if (contentType.startsWith("video/")) return "Vidéo";
  if (contentType.startsWith("audio/")) return "Audio";
  return fallbackName;
};

const inferExtensionFromAudio = (uri: string, mimeType: string) => {
  const uriExt = ((uri.split("?")[0] || "").match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();
  if (uriExt) return uriExt;
  const mimeExt = mimeType.split("/")[1]?.split(";")[0]?.toLowerCase() || "";
  if (mimeExt) return mimeExt;
  return "m4a";
};

const sanitizeFileName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "file";
  return trimmed.replace(/\s+/g, "_").replace(/[^\w.\-]/g, "");
};

const fetchBlobFromUri = async (uri: string) => {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error("Impossible de lire le fichier local.");
  }
  return response.blob();
};

export const sendAttachmentMessage = async ({
  chatId,
  localUri,
  fileName,
  contentType,
  size,
  senderId,
  senderName,
}: {
  chatId: string;
  localUri: string;
  fileName: string;
  contentType?: string;
  size?: number;
  senderId: string;
  senderName: string;
}) => {
  const firestore = requireDb();
  const storageInstance = requireStorage();

  if (!auth?.currentUser) {
    throw new Error("Connexion requise pour envoyer un fichier.");
  }

  const safeName = sanitizeFileName(fileName || "file");
  const normalizedType = (contentType || "").trim().toLowerCase() || "application/octet-stream";
  const extensionFromType = normalizedType.includes("/")
    ? normalizedType.split("/")[1]?.split(";")[0] || ""
    : "";
  const hasExtension = /\.[a-z0-9]+$/i.test(safeName);
  const finalName = hasExtension || !extensionFromType ? safeName : `${safeName}.${extensionFromType}`;
  const storagePath = `chats/${chatId}/${Date.now()}_${finalName}`;

  const fileBlob = await fetchBlobFromUri(localUri);
  const fileSize = typeof size === "number" && size > 0 ? size : fileBlob.size || 0;
  const uploaded = await uploadBytes(ref(storageInstance, storagePath), fileBlob, {
    contentType: normalizedType,
  });
  const downloadUrl = await getDownloadURL(uploaded.ref);

  const type: ChatMessageDoc["type"] = normalizedType.startsWith("image/") ? "image" : "file";
  const previewLabel = inferAttachmentLabel(normalizedType, finalName);

  await addDoc(collection(firestore, `chats/${chatId}/messages`), {
    type,
    text: previewLabel,
    encrypted: false,
    senderId,
    senderName,
    createdAt: serverTimestamp(),
    attachment: {
      url: downloadUrl,
      path: storagePath,
      name: finalName,
      size: fileSize,
      contentType: normalizedType,
    },
  });

  await setDoc(
    doc(firestore, "chats", chatId),
    {
      updatedAt: serverTimestamp(),
      hiddenBy: deleteField(),
      lastMessage: {
        type,
        text: previewLabel,
        senderId,
        createdAt: serverTimestamp(),
      },
    },
    { merge: true }
  );
};

export const sendVoiceNoteMessage = async ({
  chatId,
  localUri,
  mimeType,
  duration,
  size,
  senderId,
  senderName,
}: {
  chatId: string;
  localUri: string;
  mimeType?: string;
  duration: number;
  size?: number;
  senderId: string;
  senderName: string;
}) => {
  const firestore = requireDb();
  const storageInstance = requireStorage();

  if (!auth?.currentUser) {
    throw new Error("Connexion requise pour envoyer une note vocale.");
  }

  const normalizedMime = (mimeType || "audio/mp4").trim().toLowerCase();
  const extension = inferExtensionFromAudio(localUri, normalizedMime);
  const storagePath = `chats/${chatId}/voice-notes/${Date.now()}.${extension}`;

  const fileBlob = await fetchBlobFromUri(localUri);
  const fileSize = typeof size === "number" && size > 0 ? size : fileBlob.size || 0;
  const safeDuration = Math.max(1, Math.round(duration || 0));
  const uploaded = await uploadBytes(ref(storageInstance, storagePath), fileBlob, {
    contentType: normalizedMime,
  });
  const downloadUrl = await getDownloadURL(uploaded.ref);

  await addDoc(collection(firestore, `chats/${chatId}/messages`), {
    type: "voice",
    text: "Note vocale",
    encrypted: false,
    senderId,
    senderName,
    createdAt: serverTimestamp(),
    voiceNote: {
      url: downloadUrl,
      path: storagePath,
      duration: safeDuration,
      mimeType: normalizedMime,
      size: fileSize,
    },
  });

  await setDoc(
    doc(firestore, "chats", chatId),
    {
      updatedAt: serverTimestamp(),
      hiddenBy: deleteField(),
      lastMessage: {
        type: "voice",
        text: "Note vocale",
        senderId,
        createdAt: serverTimestamp(),
      },
    },
    { merge: true }
  );
};

export const addGroupMembers = async ({
  chatId,
  memberIds,
}: {
  chatId: string;
  memberIds: string[];
}) => {
  const firestore = requireDb();
  const uniqueIds = Array.from(new Set(memberIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  await updateDoc(doc(firestore, "chats", chatId), {
    participants: arrayUnion(...uniqueIds),
    updatedAt: serverTimestamp(),
  });
};

export const removeGroupMember = async ({
  chatId,
  memberId,
}: {
  chatId: string;
  memberId: string;
}) => {
  const firestore = requireDb();
  if (!memberId) return;

  await updateDoc(doc(firestore, "chats", chatId), {
    participants: arrayRemove(memberId),
    admins: arrayRemove(memberId),
    updatedAt: serverTimestamp(),
  });
};

const mapUserDoc = (id: string, data: DocumentData): BasicUserProfile => ({
  id,
  name: typeof data.name === "string" ? data.name : "Utilisateur",
  email:
    typeof data.email === "string"
      ? data.email.trim().toLowerCase()
      : typeof data.emailLower === "string"
        ? data.emailLower.trim().toLowerCase()
        : "",
  phoneE164:
    typeof data.phoneE164 === "string"
      ? data.phoneE164
      : typeof data.phone === "string"
        ? data.phone
        : undefined,
});

export const normalizePhoneE164 = (value: string): string => {
  const raw = value.trim();
  if (!raw) return "";

  const withPlus = raw.startsWith("00") ? `+${raw.slice(2)}` : raw;
  const compact = withPlus.replace(/[^\d+]/g, "");
  if (!compact) return "";

  if (compact.startsWith("+")) {
    const digits = compact.slice(1).replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";
    return `+${digits}`;
  }

  const digitsOnly = compact.replace(/\D/g, "");
  if (digitsOnly.length < 7) return "";

  // FR fallback for local format 0X XX XX XX XX.
  if (digitsOnly.length === 10 && digitsOnly.startsWith("0")) {
    return `+33${digitsOnly.slice(1)}`;
  }

  // Generic fallback: treat as international digits without plus.
  if (digitsOnly.length >= 8 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }

  return "";
};

const resolveUserViaApi = async ({
  email,
  phoneE164,
}: {
  email?: string;
  phoneE164?: string;
}): Promise<BasicUserProfile | null> => {
  const current = auth?.currentUser;
  const apiBaseUrl = env.apiBaseUrl.trim().replace(/\/+$/, "");
  if (!current || !apiBaseUrl) return null;

  const normalizedEmail = (email || "").trim().toLowerCase();
  const normalizedPhone = (phoneE164 || "").trim();
  if (!normalizedEmail && !normalizedPhone) return null;

  const bearerToken = await current.getIdToken().catch(() => "");
  if (!bearerToken) return null;

  const response = await fetch(`${apiBaseUrl}/api/users/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({
      email: normalizedEmail || undefined,
      phoneE164: normalizedPhone || undefined,
    }),
  }).catch(() => null);

  if (!response || !response.ok) return null;
  const payload = (await response.json().catch(() => null)) as
    | {
        user?: {
          id?: string;
          name?: string;
          email?: string;
          phoneE164?: string;
        };
      }
    | null;
  const user = payload?.user;
  const userId = (user?.id || "").trim();
  if (!userId) return null;

  return {
    id: userId,
    name: (user?.name || "Utilisateur").trim() || "Utilisateur",
    email: (user?.email || "").trim().toLowerCase(),
    phoneE164: (user?.phoneE164 || "").trim() || undefined,
  };
};

export const findUserByEmail = async (emailInput: string): Promise<BasicUserProfile | null> => {
  const firestore = requireDb();
  const email = emailInput.trim();
  if (!email) return null;
  const lowered = email.toLowerCase();

  const byLowerField = query(
    collection(firestore, "users"),
    where("emailLower", "==", lowered),
    limit(1)
  );
  const byLowerFieldSnap = await getDocs(byLowerField);
  if (!byLowerFieldSnap.empty) {
    const userSnap = byLowerFieldSnap.docs[0];
    return mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
  }

  const userQuery = query(collection(firestore, "users"), where("email", "==", email), limit(1));
  const exact = await getDocs(userQuery);
  if (!exact.empty) {
    const userSnap = exact.docs[0];
    return mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
  }

  if (lowered !== email) {
    const loweredQuery = query(
      collection(firestore, "users"),
      where("email", "==", lowered),
      limit(1)
    );
    const fallback = await getDocs(loweredQuery);
    if (!fallback.empty) {
      const userSnap = fallback.docs[0];
      return mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
    }
  }

  const viaApi = await resolveUserViaApi({ email: lowered });
  if (viaApi) return viaApi;

  return null;
};

export const findUserByPhone = async (
  phoneInput: string
): Promise<BasicUserProfile | null> => {
  const firestore = requireDb();
  const normalized = normalizePhoneE164(phoneInput);
  if (!normalized) return null;

  const q = query(
    collection(firestore, "users"),
    where("phoneE164", "==", normalized),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    const userSnap = snap.docs[0];
    return mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
  }

  const legacyQuery = query(collection(firestore, "users"), where("phone", "==", normalized), limit(1));
  const legacySnap = await getDocs(legacyQuery);
  if (!legacySnap.empty) {
    const userSnap = legacySnap.docs[0];
    return mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
  }

  const viaApi = await resolveUserViaApi({ phoneE164: normalized });
  if (viaApi) return viaApi;

  return null;
};

const splitIntoChunks = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export const findUsersByEmails = async (
  emailsInput: string[]
): Promise<Record<string, BasicUserProfile>> => {
  const firestore = requireDb();
  const normalizedEmails = Array.from(
    new Set(
      emailsInput
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (normalizedEmails.length === 0) return {};

  const chunks = splitIntoChunks(normalizedEmails, 10);
  const mapByEmail: Record<string, BasicUserProfile> = {};

  await Promise.all(
    chunks.map(async (batch) => {
      const [byLowerSnapshot, byLegacySnapshot] = await Promise.all([
        getDocs(query(collection(firestore, "users"), where("emailLower", "in", batch), limit(10))),
        getDocs(query(collection(firestore, "users"), where("email", "in", batch), limit(10))),
      ]);
      byLowerSnapshot.forEach((userSnap) => {
        const user = mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
        if (user.email) {
          mapByEmail[user.email.trim().toLowerCase()] = user;
        }
      });
      byLegacySnapshot.forEach((userSnap) => {
        const user = mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
        if (user.email) {
          mapByEmail[user.email.trim().toLowerCase()] = user;
        }
      });
    })
  );

  return mapByEmail;
};

export const findUsersByPhones = async (
  phonesInput: string[]
): Promise<Record<string, BasicUserProfile>> => {
  const firestore = requireDb();
  const normalizedPhones = Array.from(
    new Set(
      phonesInput
        .map((entry) => normalizePhoneE164(entry))
        .filter(Boolean)
    )
  );
  if (normalizedPhones.length === 0) return {};

  const chunks = splitIntoChunks(normalizedPhones, 10);
  const mapByPhone: Record<string, BasicUserProfile> = {};

  await Promise.all(
    chunks.map(async (batch) => {
      const batchQuery = query(collection(firestore, "users"), where("phoneE164", "in", batch), limit(10));
      const snapshot = await getDocs(batchQuery);
      snapshot.forEach((userSnap) => {
        const user = mapUserDoc(userSnap.id, userSnap.data() as DocumentData);
        const normalized = normalizePhoneE164(user.phoneE164 || "");
        if (normalized) {
          mapByPhone[normalized] = user;
        }
      });
    })
  );

  return mapByPhone;
};

export const fetchUsersByIds = async (
  userIds: string[]
): Promise<Record<string, BasicUserProfile>> => {
  const firestore = requireDb();
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const snapshots = await Promise.all(uniqueIds.map((id) => getDoc(doc(firestore, "users", id))));
  const map: Record<string, BasicUserProfile> = {};

  snapshots.forEach((snapshot) => {
    if (!snapshot.exists()) return;
    map[snapshot.id] = mapUserDoc(snapshot.id, snapshot.data() as DocumentData);
  });

  return map;
};

export const deleteMessageFromChat = async ({
  chatId,
  messageId,
  actorUserId,
}: {
  chatId: string;
  messageId: string;
  actorUserId: string;
}) => {
  const firestore = requireDb();
  const messageRef = doc(firestore, `chats/${chatId}/messages`, messageId);
  const messageSnap = await getDoc(messageRef);
  if (!messageSnap.exists()) return;

  const data = messageSnap.data() as DocumentData;
  const senderId = typeof data.senderId === "string" ? data.senderId : "";
  if (!senderId || senderId !== actorUserId) {
    throw new Error("Tu peux supprimer uniquement tes propres messages.");
  }

  await deleteDoc(messageRef);

  const latestQuery = query(
    collection(firestore, `chats/${chatId}/messages`),
    orderBy("createdAt", "desc"),
    limit(1)
  );
  const latestSnap = await getDocs(latestQuery);
  if (latestSnap.empty) {
    await setDoc(
      doc(firestore, "chats", chatId),
      {
        updatedAt: serverTimestamp(),
        lastMessage: null,
      },
      { merge: true }
    );
    return;
  }

  const latestDoc = latestSnap.docs[0];
  const latest = latestDoc.data() as DocumentData;
  await setDoc(
    doc(firestore, "chats", chatId),
    {
      updatedAt: serverTimestamp(),
      lastMessage: {
        type: (latest.type as ChatMessageDoc["type"]) || "text",
        text:
          typeof latest.text === "string" && latest.text.trim()
            ? latest.text.trim()
            : "Message",
        senderId: typeof latest.senderId === "string" ? latest.senderId : "",
        createdAt: latest.createdAt || serverTimestamp(),
      },
    },
    { merge: true }
  );
};

export const removeDirectContactForUser = async ({
  chatId,
  currentUserId,
  otherUserId,
  otherEmail,
}: {
  chatId: string;
  currentUserId: string;
  otherUserId: string;
  otherEmail?: string;
}) => {
  const firestore = requireDb();
  const chatRef = doc(firestore, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) {
    throw new Error("Conversation introuvable.");
  }

  const chatData = chatSnap.data() as DocumentData;
  const participants = Array.isArray(chatData.participants)
    ? (chatData.participants as string[])
    : [];
  if (!participants.includes(currentUserId)) {
    throw new Error("Accès refusé.");
  }
  if (chatData.type !== "direct") {
    throw new Error("La suppression de contact est réservée aux chats directs.");
  }

  await updateDoc(chatRef, {
    [`hiddenBy.${currentUserId}`]: true,
    updatedAt: serverTimestamp(),
  });

  const contactsRef = collection(firestore, `contacts/${currentUserId}/list`);
  const deleteTargets = new Map<string, ReturnType<typeof doc>>();

  if (otherUserId) {
    const byUid = await getDocs(query(contactsRef, where("uid", "==", otherUserId), limit(20)));
    byUid.docs.forEach((entry) => {
      deleteTargets.set(entry.id, entry.ref);
    });
  }

  if (otherEmail?.trim()) {
    const byEmail = await getDocs(
      query(contactsRef, where("email", "==", otherEmail.trim().toLowerCase()), limit(20))
    );
    byEmail.docs.forEach((entry) => {
      deleteTargets.set(entry.id, entry.ref);
    });
  }

  await Promise.all(Array.from(deleteTargets.values()).map((ref) => deleteDoc(ref)));
};
