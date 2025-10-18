//Ce composant gère l'entrée de texte et l'envoi de nouveaux messages.
"use client"; // 👉 Indispensable dans les composants interactifs Next.js (App Router)

import React, { useState } from "react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage }) => {
  const [message, setMessage] = useState("");

  // ✅ Envoi du message s'il n'est pas vide
  const handleSend = () => {
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

  return (
    <div className="p-4 border-t border-gray-300 flex bg-white">
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSend()}
        className="flex-grow p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
        placeholder="Tapez votre message..."
      />
      <button
        onClick={handleSend}
        className="ml-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
      >
        Envoyer
      </button>
    </div>
  );
};

export default ChatInput;
