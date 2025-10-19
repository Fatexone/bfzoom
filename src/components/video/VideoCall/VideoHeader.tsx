"use client";

import React from "react";
import { motion } from "framer-motion";
import { Users, Power } from "lucide-react";

interface VideoHeaderProps {
  roomId: string;
  connected: boolean;
  userCount: number;
  onLeave: () => void;
  isGuest?: boolean;
  guestName?: string;
}

/* =======================================================
   🎛️ En-tête visioconférence — version sublimée
======================================================= */
export default function VideoHeader({
  roomId,
  connected,
  userCount,
  onLeave,
  isGuest = false,
  guestName = "",
}: VideoHeaderProps) {
  const connectionStatus = connected
    ? "Connecté"
    : userCount > 0
    ? "En attente"
    : "Déconnecté";

  const connectionColor = connected
    ? "bg-green-500"
    : userCount > 0
    ? "bg-yellow-500"
    : "bg-red-500";

  return (
    <header
      className="
        relative flex flex-col sm:flex-row sm:items-center sm:justify-between
        gap-4 sm:gap-0 py-4 px-3 sm:px-6
        border-b border-white/10
        bg-black/40 backdrop-blur-md
        rounded-t-2xl shadow-[inset_0_-1px_0_rgba(255,255,255,0.1)]
        text-white z-20
      "
    >
      {/* === Infos Salle === */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Salle :{" "}
            <span className="text-blue-400 font-mono text-base break-all">
              {roomId}
            </span>
          </h2>

          <p className="text-sm text-gray-400 mt-1 flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${connectionColor}`}
            ></span>
            {connectionStatus} — {userCount}{" "}
            {userCount > 1 ? "participants" : "participant"}
          </p>

          <p className="text-xs sm:text-sm text-gray-400 italic mt-1">
            {isGuest
              ? `Invité : ${guestName || "Anonyme"}`
              : "Créateur connecté"}
          </p>
        </div>
      </div>

      {/* === Actions === */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        whileHover={{
          scale: 1.05,
          boxShadow: "0 0 15px rgba(255,0,0,0.4)",
        }}
        transition={{ duration: 0.15 }}
        onClick={onLeave}
        className="
          flex items-center justify-center gap-2
          bg-red-600/90 hover:bg-red-700 text-white
          px-4 sm:px-5 py-2 sm:py-2.5
          rounded-xl font-medium
          transition-all duration-200 ease-out
          focus:outline-none focus:ring-2 focus:ring-red-500/40
          active:scale-95
          shadow-lg shadow-red-900/20
        "
      >
        <Power className="w-5 h-5 sm:w-5 sm:h-5" />
        <span className="text-sm sm:text-base">Quitter</span>
      </motion.button>

      {/* === Badge nombre d’utilisateurs mobile === */}
      <div className="absolute right-4 bottom-2 sm:hidden flex items-center gap-1 text-xs text-gray-400">
        <Users className="w-3.5 h-3.5 text-gray-400" />
        {userCount}
      </div>
    </header>
  );
}
