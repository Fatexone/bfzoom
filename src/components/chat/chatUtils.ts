import { db } from "@/lib/firebaseConfig";
import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ChatMessage } from "@/types/ChatMessage";

/**
 * 🔁 Génère un ID de conversation unique basé sur les deux UIDs triés.
 * ✅ Crée le document s'il n'existe pas, avec les participants.
 */
export const getOrCreateConversationId = async (
  user1Id: string,
  user2Id: string
): Promise<string> => {
  const participants = [user1Id, user2Id].sort();
  const conversationId = participants.join("_");

  const convoRef = doc(db, "conversations", conversationId);
  const convoSnap = await getDoc(convoRef);

  if (!convoSnap.exists()) {
    await setDoc(convoRef, {
      participants,
      updatedAt: serverTimestamp(),
      lastMessage: "",
    });
    console.log("🆕 Nouvelle conversation créée :", conversationId);
  } else {
    const data = convoSnap.data();
    if (!data.participants || !Array.isArray(data.participants)) {
      await setDoc(
        convoRef,
        { participants },
        { merge: true }
      );
      console.warn("⚠️ Participants manquants corrigés pour :", conversationId);
    }
  }

  return conversationId;
};

/**
 * 📩 Envoie un message dans une conversation.
 * ✅ Vérifie que les participants sont présents dans le document
 * ✅ Met à jour les métadonnées de la conversation.
 */
export const sendMessage = async (
  conversationId: string,
  message: Omit<ChatMessage, "id">
) => {
  const convoRef = doc(db, "conversations", conversationId);
  const convoSnap = await getDoc(convoRef);

  if (!convoSnap.exists()) {
    throw new Error("❌ Conversation introuvable.");
  }

  const convoData = convoSnap.data();

  if (!convoData.participants || !Array.isArray(convoData.participants)) {
    throw new Error("❌ Accès refusé : participants manquants dans la conversation.");
  }

  // ✅ Ajout du message
  await addDoc(collection(db, `conversations/${conversationId}/messages`), {
    ...message,
    timestamp: serverTimestamp(),
  });

  // 🆙 Mise à jour du dernier message + timestamp
  await setDoc(
    convoRef,
    {
      lastMessage: message.text,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};
