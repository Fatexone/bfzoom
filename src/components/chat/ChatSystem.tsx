//Ce composant centralise la logique de gestion des messages, combinant les composants précédents.
"use client";

import { useEffect, useState, useReducer } from "react";
import { db } from "@/lib/firebaseConfig";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  getDoc,
  doc,
} from "firebase/firestore";

import { User } from "@/types/User";
import { ChatMessage } from "@/types/ChatMessage";
import {
  getOrCreateConversationId,
  sendMessage as sendMsgToFirestore,
} from "./chatUtils";

// ✅ Actions possibles pour le reducer
type Action =
  | { type: "ADD_MESSAGE"; payload: ChatMessage }
  | { type: "CLEAR_CHAT" };

// ✅ Reducer pour stocker et mettre à jour les messages
const chatReducer = (state: ChatMessage[], action: Action): ChatMessage[] => {
  switch (action.type) {
    case "ADD_MESSAGE":
      return [...state, action.payload];
    case "CLEAR_CHAT":
      return [];
    default:
      return state;
  }
};

export default function ChatSystem({
  selectedUser,
  setSelectedUser,
  currentUser,
}: {
  selectedUser: User | null;
  setSelectedUser: (user: User | null) => void;
  currentUser: User | null;
}) {
  const [chatMessages, dispatch] = useReducer(chatReducer, []);
  const [message, setMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);

  // 🔁 Écoute en temps réel des messages quand un user est sélectionné
  useEffect(() => {
    if (!currentUser || !selectedUser) return;

    dispatch({ type: "CLEAR_CHAT" });
    let unsubscribe: () => void;

    const setupChat = async () => {
      try {
        // 🔐 Crée ou récupère une conversation entre les deux utilisateurs
        const convoId = await getOrCreateConversationId(
          currentUser.id,
          selectedUser.id
        );
        setConversationId(convoId);



        const convoRef = doc(db, "conversations", convoId);
let convoDoc;
let convoData;

try {
  convoDoc = await getDoc(convoRef);
  convoData = convoDoc.data();

  if (
    !convoDoc.exists() ||
    !convoData?.participants?.includes(currentUser.id)
  ) {
    console.warn("⛔ Accès interdit à cette conversation.");
    return;
  }
} catch (error) {
  console.error("❌ Erreur d'accès à la conversation:", error);
  return;
}




        // 👂 Abonnement en temps réel aux messages
        const q = query(
          collection(db, `conversations/${convoId}/messages`),
          orderBy("timestamp", "asc")
        );

        unsubscribe = onSnapshot(q, (snapshot) => {
          const msgs: ChatMessage[] = [];
          snapshot.forEach((doc) => {
            msgs.push({ ...(doc.data() as ChatMessage), id: doc.id });
          });

          dispatch({ type: "CLEAR_CHAT" });
          msgs.forEach((msg) =>
            dispatch({ type: "ADD_MESSAGE", payload: msg })
          );
        });
      } catch (err) {
        console.error("❌ Erreur setupChat:", err);
      }
    };

    setupChat();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [currentUser, selectedUser]);

  // ✉️ Envoi d'un message à Firestore
  const handleSendMessage = async () => {
    if (!message.trim() || !currentUser || !selectedUser || !conversationId)
      return;

    await sendMsgToFirestore(conversationId, {
      text: message,
      senderId: currentUser.id,
      receiverId: selectedUser.id,
      senderName: currentUser.name,
    });

    setMessage("");
  };

  return (
    <div className="w-full max-w-lg flex flex-col bg-white shadow-lg rounded-lg p-4 border border-gray-300">
      {/* 💬 Affichage des messages */}
      <div className="h-80 overflow-y-auto">
        {!selectedUser ? (
          <p className="text-gray-400 text-center p-4">
            Sélectionnez un utilisateur pour commencer une conversation.
          </p>
        ) : chatMessages.length === 0 ? (
          <p className="text-gray-400 text-center">
            Aucun message avec {selectedUser.name}...
          </p>
        ) : (
          chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`relative p-3 mb-3 rounded-lg shadow-md ${
                msg.senderId === currentUser?.id
                  ? "bg-blue-100 text-right"
                  : "bg-gray-200 text-left"
              }`}
            >
              {msg.senderId !== currentUser?.id && (
                <p className="text-sm font-bold text-gray-600">
                  {msg.senderName}
                </p>
              )}
              <span className="text-gray-700">{msg.text}</span>
            </div>
          ))
        )}
      </div>

      {/* 📝 Input de message */}
      {selectedUser && (
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
            className="flex-grow p-2 border rounded-lg focus:ring-2 focus:ring-blue-400 transition duration-300"
            placeholder="Tapez votre message..."
          />
          <button
            onClick={handleSendMessage}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition duration-300"
          >
            Envoyer
          </button>
        </div>
      )}

      {/* 🔄 Bouton pour changer de destinataire */}
      <div className="mt-4">
        <button
          onClick={() => setSelectedUser(null)}
          className="w-full px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
        >
          Changer dutilisateur
        </button>
      </div>
    </div>
  );
}
