"use client";

import { useState, useRef, useCallback } from "react";
import {
  Video,
  Link2,
  PlusCircle,
  Copy,
  Check,
  Users,
  Shield,
  Hash,
} from "lucide-react";
import { motion } from "framer-motion";

interface LobbyProps {
  onJoin: (roomId: string) => void;
}

/* =======================================================
   🧭 LOBBY — accueil de visioconférence sublimé
======================================================= */
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
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* fallback silencieux */
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="
        w-full max-w-xl mx-auto p-8 sm:p-10
        bg-gradient-to-br from-zinc-900/70 via-black/60 to-zinc-900/70
        border border-white/10 rounded-3xl shadow-[0_0_40px_rgba(0,0,0,0.6)]
        backdrop-blur-2xl text-center text-white
      "
    >
      {/* ====== Titre ====== */}
      <motion.h1
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-3xl sm:text-4xl font-extrabold mb-6 flex justify-center items-center gap-2"
      >
        <Video className="w-8 h-8 text-blue-400" />
        <span className="tracking-tight">BFZoom</span>
      </motion.h1>

      {/* ====== Tags ====== */}
      <div className="flex items-center justify-center flex-wrap gap-2 sm:gap-3 mb-8">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-400/30 text-blue-200 text-xs sm:text-sm">
          <Users className="w-4 h-4" /> 1:1 privé
        </span>
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 text-xs sm:text-sm">
          <Shield className="w-4 h-4" /> WebRTC chiffré
        </span>
      </div>

      {/* ====== Input ====== */}
      <div className="relative mb-8">
        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          ref={inputRef}
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Entrez un code de salle"
          className="
            w-full pl-9 pr-12 py-3 rounded-xl
            bg-black/40 border border-white/10
            focus:outline-none focus:ring-2 focus:ring-blue-500/40
            text-sm sm:text-base placeholder-gray-500 text-gray-100
            transition-all duration-300
          "
        />
        <button
          type="button"
          onClick={copyRoom}
          className="
            absolute right-2 top-1/2 -translate-y-1/2 p-2
            rounded-md bg-white/5 hover:bg-white/10
            border border-white/10 transition
          "
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4 text-gray-400" />
          )}
        </button>
      </div>

      {/* ====== Boutons ====== */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <motion.button
          whileTap={{ scale: 0.95 }}
          whileHover={{
            scale: 1.03,
            boxShadow: "0 0 20px rgba(59,130,246,0.3)",
          }}
          onClick={handleCreateRoom}
          disabled={loading}
          className="
            flex items-center justify-center gap-2 px-6 py-3
            rounded-xl font-semibold
            bg-gradient-to-r from-blue-600 to-blue-500
            hover:from-blue-500 hover:to-blue-400
            shadow-[0_0_20px_rgba(37,99,235,0.3)]
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-300
          "
        >
          <PlusCircle className="w-5 h-5" />
          {loading ? "Création…" : "Créer une salle"}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.95 }}
          whileHover={{
            scale: 1.03,
            boxShadow: "0 0 20px rgba(16,185,129,0.3)",
          }}
          onClick={handleJoinRoom}
          disabled={loading}
          className="
            flex items-center justify-center gap-2 px-6 py-3
            rounded-xl font-semibold
            bg-gradient-to-r from-emerald-600 to-emerald-500
            hover:from-emerald-500 hover:to-emerald-400
            shadow-[0_0_20px_rgba(16,185,129,0.3)]
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-300
          "
        >
          <Link2 className="w-5 h-5" />
          {loading ? "Connexion…" : "Rejoindre"}
        </motion.button>
      </div>

      {/* ====== Bas de page ====== */}
      <p className="text-gray-400 text-xs sm:text-sm leading-relaxed">
        Partage ton code avec ton interlocuteur et commence la visio.
      </p>
    </motion.div>
  );
}
