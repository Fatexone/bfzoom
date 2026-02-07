import {
  doc,
  DocumentData,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "./firebaseConfig";
import type { CallRecord, CallStatus } from "@/types/Call";

const CALL_COLLECTION = "calls";

type CallPayload = {
  chatId: string;
  roomId: string;
  from: string;
};

const getCallDocRef = (chatId: string) => doc(db, CALL_COLLECTION, chatId);

export const useCallState = (chatId?: string | null) => {
  const [callState, setCallState] = useState<CallRecord | null>(null);

  useEffect(() => {
    if (!chatId) {
      queueMicrotask(() => {
        setCallState(null);
      });
      return;
    }
    const ref = getCallDocRef(chatId);
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      if (!snapshot.exists()) {
        setCallState(null);
        return;
      }
      const data = snapshot.data() as DocumentData;
      setCallState({
        chatId,
        roomId: data.roomId,
        from: data.from,
        status: data.status as CallStatus,
        createdAt: data.createdAt as Timestamp | undefined,
        updatedAt: data.updatedAt as Timestamp | undefined,
        acceptedAt: data.acceptedAt as Timestamp | undefined,
        endedAt: data.endedAt as Timestamp | undefined,
      });
    });
    return unsubscribe;
  }, [chatId]);

  return callState;
};

export const startCall = async ({ chatId, roomId, from }: CallPayload) => {
  if (!chatId || !roomId || !from) {
    throw new Error("Appel invalide");
  }
  const ref = getCallDocRef(chatId);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    const data = existing.data() as DocumentData;
    if (data.status === "ringing" || data.status === "in_call") {
      throw new Error("Un appel est déjà en cours.");
    }
  }
  await setDoc(ref, {
    chatId,
    roomId,
    from,
    status: "ringing",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const acceptCall = async (chatId: string, userId: string) => {
  if (!chatId || !userId) throw new Error("Appel invalide");
  const ref = getCallDocRef(chatId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error("Aucun appel actif.");
  const data = snapshot.data() as DocumentData;
  if (data.status !== "ringing") throw new Error("Aucun appel entrant.");
  await updateDoc(ref, {
    status: "in_call",
    acceptedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const endCall = async (chatId: string, userId: string, status: CallStatus = "ended") => {
  if (!chatId || !userId) throw new Error("Appel invalide");
  const ref = getCallDocRef(chatId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return;
  await updateDoc(ref, {
    status,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};