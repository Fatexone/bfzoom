"use client";

import { useEffect, useState } from "react";
import { socket } from "@/lib/socket";
import { motion, AnimatePresence } from "framer-motion";

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
  const [open, setOpen] = useState(false);

  /* =======================================================
     📡 Réception en temps réel
  ======================================================= */
  useEffect(() => {
    const handleIncoming = (msg: ChatMessage) =>
      setMessages((prev) => [...prev, msg]);
    socket.on("chat-message", handleIncoming);
    return () => socket.off("chat-message", handleIncoming);
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
    setMessages((p) => [...p, msg]);
    setInput("");
  };

  /* =======================================================
     🧩 Rendu responsive
  ======================================================= */
  return (
    <>
      {/* 🔘 Bouton flottant mobile */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="
          fixed z-40 bottom-4 right-4 sm:hidden
          w-12 h-12 rounded-full bg-blue-600
          text-white text-2xl font-bold shadow-lg
          flex items-center justify-center active:scale-95
        "
      >
        💬
      </button>

      {/* 💬 Fenêtre de chat */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            transition={{ duration: 0.25 }}
            className="
              fixed z-50 bottom-0 left-0 right-0 sm:static
              sm:w-80 sm:bottom-4 sm:left-4
              bg-black/90 sm:bg-black/70 text-white
              rounded-t-2xl sm:rounded-xl border border-white/10
              backdrop-blur-md shadow-2xl
              flex flex-col sm:p-3
              h-[60vh] sm:h-auto
            "
          >
            {/* 🧱 Header mobile */}
            <div className="sm:hidden flex items-center justify-between p-3 border-b border-white/10">
              <span className="text-sm font-medium">Chat</span>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>

            {/* 💬 Zone messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1 text-sm">
              {messages.map((m) => (
                <div key={m.id} className="leading-snug">
                  <span className="text-gray-400 text-xs">{m.sender} :</span>{" "}
                  <span>{m.text}</span>
                </div>
              ))}
            </div>

            {/* ✏️ Champ d’envoi */}
            <div className="p-3 border-t border-white/10 flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Écrire un message..."
                className="
                  flex-1 bg-white/10 rounded px-3 py-2 text-sm
                  outline-none placeholder-gray-400
                "
              />
              <button
                onClick={sendMessage}
                className="
                  bg-blue-600 hover:bg-blue-700 text-white
                  text-sm px-3 py-2 rounded font-medium
                "
              >
                Envoyer
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 💻 Affichage desktop permanent */}
      <div className="hidden sm:flex fixed bottom-4 left-4 w-80 bg-black/60 text-white rounded-xl shadow-lg p-3 backdrop-blur-sm border border-white/10 flex-col">
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
    </>
  );
}
