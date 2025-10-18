"use client";

import { useState, useRef, useCallback } from "react";
import { Video, Link2, PlusCircle, Copy, Check, Users, Shield, Hash } from "lucide-react";
import { motion } from "framer-motion";

interface LobbyProps {
  onJoin: (roomId: string) => void;
}

export default function Lobby({ onJoin }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const generateRoomId = () => `room-${Math.random().toString(36).slice(2, 8)}`;

  const handleCreateRoom = useCallback(() => {
    const id = generateRoomId();
    localStorage.setItem("lastRoomId", id);
    setLoading(true);
    setTimeout(() => {
      onJoin(id);
      setLoading(false);
    }, 500);
  }, [onJoin]);

  const handleJoinRoom = useCallback(() => {
    if (!roomId.trim()) {
      inputRef.current?.focus();
      return;
    }
    localStorage.setItem("lastRoomId", roomId);
    setLoading(true);
    setTimeout(() => {
      onJoin(roomId);
      setLoading(false);
    }, 400);
  }, [onJoin, roomId]);

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {}
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-xl p-8 bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl text-center"
    >
      <h1 className="text-3xl font-bold mb-6 flex justify-center items-center gap-2">
        <Video className="w-7 h-7 text-blue-400" />
        Visioconférence
      </h1>

      <div className="flex items-center justify-center gap-3 mb-6">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-200 text-xs">
          <Users className="w-4 h-4" /> 1:1 privé
        </span>
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-xs">
          <Shield className="w-4 h-4" /> WebRTC chiffré
        </span>
      </div>

      <div className="relative mb-6">
        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Entrez un code de salle"
          className="w-full pl-9 pr-12 py-3 rounded-lg bg-gray-800 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 text-base placeholder-gray-500"
        />
        <button
          type="button"
          onClick={copyRoom}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 transition"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <button
          onClick={handleCreateRoom}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 transition font-semibold disabled:opacity-50"
        >
          <PlusCircle className="w-5 h-5" />
          {loading ? "Création..." : "Créer une salle"}
        </button>
        <button
          onClick={handleJoinRoom}
          disabled={loading}
          className="flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-green-600 hover:bg-green-700 transition font-semibold disabled:opacity-50"
        >
          <Link2 className="w-5 h-5" />
          {loading ? "Connexion..." : "Rejoindre"}
        </button>
      </div>

      <p className="text-gray-400 text-xs">
        Partage ton code avec ton interlocuteur et commence la visio.
      </p>
    </motion.div>
  );
}
