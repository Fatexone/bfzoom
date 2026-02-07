"use client";

import { db, storage, auth } from "@/lib/firebaseConfig";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import type { ChatMessageType } from "@/types/Chat";
import { getIdToken } from "firebase/auth";

export const getDirectChatId = (userIdA: string, userIdB: string) => {
  return [userIdA, userIdB].sort().join("__");
};

export const getOrCreateDirectChat = async (
  currentUserId: string,
  otherUserId: string
) => {
  const chatId = getDirectChatId(currentUserId, otherUserId);
  const chatRef = doc(db, "chats", chatId);
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
  }

  return chatId;
};

export const sendTextMessage = async ({
  chatId,
  text,
  senderId,
  senderName,
}: {
  chatId: string;
  text: string;
  senderId: string;
  senderName: string;
}) => {
  const messageRef = await addDoc(collection(db, `chats/${chatId}/messages`), {
    type: "text",
    text,
    encrypted: false,
    senderId,
    senderName,
    createdAt: serverTimestamp(),
  });

  await updateChatLastMessage({
    chatId,
    type: "text",
    text,
    senderId,
  });

  return messageRef.id;
};

export const updateChatLastMessage = async ({
  chatId,
  type,
  text,
  senderId,
}: {
  chatId: string;
  type: ChatMessageType;
  text?: string;
  senderId: string;
}) => {
  const chatRef = doc(db, "chats", chatId);
  await updateDoc(chatRef, {
    updatedAt: serverTimestamp(),
    lastMessage: {
      type,
      text: text ?? "",
      senderId,
      createdAt: serverTimestamp(),
    },
  });
};

export const sendAttachmentMessage = async ({
  chatId,
  file,
  senderId,
  senderName,
}: {
  chatId: string;
  file: File;
  senderId: string;
  senderName: string;
}) => {
  const current = auth.currentUser;
  if (!current) {
    throw new Error("Utilisateur non connecté");
  }
  await getIdToken(current, true);

  const timestamp = Date.now();
  const safeName = file.name.replace(/\s+/g, "_");
  const storagePath = `chats/${chatId}/${timestamp}_${safeName}`;
  const storageRef = ref(storage, storagePath);
  const uploaded = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(uploaded.ref);
  const isImage = file.type.startsWith("image/");
  const type: ChatMessageType = isImage ? "image" : "file";

  const messageRef = await addDoc(collection(db, `chats/${chatId}/messages`), {
    type,
    text: isImage ? "Image" : file.name,
    encrypted: false,
    senderId,
    senderName,
    createdAt: serverTimestamp(),
    attachment: {
      url,
      path: storagePath,
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
    },
  });

  await updateChatLastMessage({
    chatId,
    type,
    text: isImage ? "Image" : file.name,
    senderId,
  });

  return messageRef.id;
};

export const sendVoiceMessage = async ({
  chatId,
  blob,
  duration,
  senderId,
  senderName,
}: {
  chatId: string;
  blob: Blob;
  duration: number;
  senderId: string;
  senderName: string;
}) => {
  const current = auth.currentUser;
  if (!current) {
    throw new Error("Utilisateur non connecté");
  }
  await getIdToken(current, true);

  const timestamp = Date.now();
  const mimeTypeRaw = blob.type || "audio/webm";
  const mimeType = mimeTypeRaw.split(";")[0];
  const ext = mimeType.split("/")[1] || "webm";
  const storagePath = `chats/${chatId}/voice-notes/${timestamp}.${ext}`;
  const storageRef = ref(storage, storagePath);
  const uploaded = await uploadBytes(storageRef, blob);
  const url = await getDownloadURL(uploaded.ref);

  const messageRef = await addDoc(collection(db, `chats/${chatId}/messages`), {
    type: "voice" as ChatMessageType,
    text: "Note vocale",
    encrypted: false,
    senderId,
    senderName,
    createdAt: serverTimestamp(),
    voiceNote: {
      url,
      path: storagePath,
      duration,
      mimeType,
      size: blob.size,
    },
  });

  await updateChatLastMessage({
    chatId,
    type: "voice" as ChatMessageType,
    text: "Note vocale",
    senderId,
  });

  return messageRef.id;
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
  const uniqueMembers = Array.from(new Set([createdBy, ...memberIds]));
  const groupRef = await addDoc(collection(db, "chats"), {
    type: "group",
    title: title.trim() || "Groupe",
    participants: uniqueMembers,
    admins: [createdBy],
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastMessage: null,
  });
  return groupRef.id;
};

export const markChatRead = async ({
  chatId,
  userId,
}: {
  chatId: string;
  userId: string;
}) => {
  await setDoc(
    doc(db, `chats/${chatId}/reads`, userId),
    { lastReadAt: serverTimestamp() },
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
  if (memberIds.length === 0) return;
  await updateDoc(doc(db, "chats", chatId), {
    participants: arrayUnion(...memberIds),
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
  await updateDoc(doc(db, "chats", chatId), {
    participants: arrayRemove(memberId),
    admins: arrayRemove(memberId),
    updatedAt: serverTimestamp(),
  });
};