"use client";

import { useEffect, useState } from "react";
import { socket } from "@/lib/socket";

interface ChatMessage {
  id: string;
  sender: string;
  text: string;
  time: string;
}

interface ChatBoxProps {
  roomId: string;
  userName: string;
}

export default function ChatBox({ roomId, userName }: ChatBoxProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");

  /* =======================================================
     📡 Réception des messages en temps réel
  ======================================================= */
  useEffect(() => {
    const handleIncoming = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
    };

    socket.on("chat-message", handleIncoming);

    return () => {
      socket.off("chat-message", handleIncoming);
    };
  }, []);

  /* =======================================================
     📨 Envoi d’un message
  ======================================================= */
  const sendMessage = () => {
    if (!input.trim()) return;

    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      sender: userName,
      text: input.trim(),
      time: new Date().toLocaleTimeString(),
    };

    socket.emit("chat-message", { roomId, msg });
    setMessages((prev) => [...prev, msg]);
    setInput("");
  };

  return (
    <div className="absolute bottom-4 left-4 w-72 bg-black/60 text-white rounded-xl shadow-lg p-3 backdrop-blur-sm border border-white/10">
      <div className="max-h-48 overflow-y-auto mb-2 space-y-1 text-sm">
        {messages.map((m) => (
          <div key={m.id}>
            <span className="text-gray-400 text-xs">{m.sender} :</span>{" "}
            <span>{m.text}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Écrire un message..."
          className="flex-1 bg-white/10 rounded px-2 py-1 text-sm outline-none"
        />
        <button
          onClick={sendMessage}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded"
        >
          Envoyer
        </button>
      </div>
    </div>
  );
}
