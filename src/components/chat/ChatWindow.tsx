//Ce composant affiche les messages de la conversation en cours.
"use client";

import { Dispatch } from "react";
import { ChatMessage } from "@/types/ChatMessage";
import { User } from "@/types/User";

// ✅ Action locale pour manipuler les messages dans un reducer
type Action =
  | { type: "ADD_MESSAGE"; payload: ChatMessage }
  | { type: "REMOVE_MESSAGE"; payload: string }
  | { type: "CLEAR_CHAT" };

interface ChatWindowProps {
  chatMessages: ChatMessage[];
  dispatch: Dispatch<Action>;
  selectedUser: User | null;
  currentUser: User | null;
}

export default function ChatWindow({
  chatMessages,
  dispatch,
  selectedUser,
  currentUser,
}: ChatWindowProps) {
  // ⛔ Aucun utilisateur sélectionné
  if (!selectedUser) {
    return (
      <div className="p-4 text-center text-gray-400">
        Sélectionne un utilisateur pour commencer une discussion.
      </div>
    );
  }

  // ⛔ Utilisateur non connecté
  if (!currentUser) {
    return (
      <div className="p-4 text-center text-red-400">
        Erreur : utilisateur non connecté.
      </div>
    );
  }

  // 💬 Filtrer les messages entre les deux utilisateurs
  const filteredMessages = chatMessages.filter(
    (msg) =>
      (msg.senderId === currentUser.id &&
        msg.receiverId === selectedUser.id) ||
      (msg.senderId === selectedUser.id &&
        msg.receiverId === currentUser.id)
  );

  return (
    <div className="w-full max-w-lg h-80 bg-white shadow-md rounded-lg p-4 overflow-y-auto border border-gray-300">
      {/* 📭 Aucun message */}
      {filteredMessages.length === 0 ? (
        <p className="text-gray-400 text-center">
          Aucun message avec {selectedUser.name}...
        </p>
      ) : (
        filteredMessages.map((msg) => (
          <div
            key={msg.id}
            className={`relative p-3 mb-3 rounded-lg shadow ${
              msg.senderId === currentUser.id
                ? "bg-blue-100 text-right"
                : "bg-gray-200 text-left"
            }`}
          >
            {/* 💬 Contenu du message */}
            <span className="text-gray-800">{msg.text}</span>

            {/* ⏱️ Timer si le message est temporaire */}
            {msg.timeLeft !== null && msg.timeLeft !== undefined && (
              <div className="text-xs text-gray-500">
                ⏳ {msg.timeLeft}s
              </div>
            )}

            {/* 📉 Barre de progression */}
            {msg.timeLeft !== null && msg.timeLeft !== undefined && msg.timeLeft > 0 && (
              <div className="absolute bottom-0 left-0 w-full h-1 bg-blue-200">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{
                    width: `${(msg.timeLeft / (msg.timeLeft + 1)) * 100}%`,
                  }}
                ></div>
              </div>
            )}

            {/* ❌ Supprimer si auteur */}
            {msg.senderId === currentUser.id && (
              <button
                className="absolute top-1 right-2 text-red-500 hover:text-red-700 text-sm"
                onClick={() =>
                  dispatch({ type: "REMOVE_MESSAGE", payload: msg.id })
                }
              >
                Supprimer
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
