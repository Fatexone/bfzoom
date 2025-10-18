//en-tête de session (infos salle)

"use client";

import React from "react";

interface VideoHeaderProps {
  roomId: string;
  connected: boolean;
  userCount: number;
  onLeave: () => void;
}

/* =======================================================
   🎛️ VideoHeader — Barre supérieure de la visio
   -------------------------------------------------------
   - Affiche le code de salle, la connexion, le nombre d’utilisateurs
   - Bouton "Quitter" clair et responsive
======================================================= */

export default function VideoHeader({
  roomId,
  connected,
  userCount,
  onLeave,
}: VideoHeaderProps) {
  return (
    <header className="w-full flex flex-col sm:flex-row justify-between items-center gap-3 sm:gap-0 px-6 py-4 bg-black/40 backdrop-blur-md border-b border-white/10 text-white shadow-sm">
      {/* Bloc gauche : infos session */}
      <div className="text-center sm:text-left">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
          🔴 Salle — <span className="text-blue-400">{roomId}</span>
        </h2>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-1 text-sm text-gray-300">
          <span>
            {connected ? "🟢 Connecté" : "⚫ Déconnecté"}
          </span>
          <span>
            👥 {userCount} {userCount > 1 ? "participants" : "participant"}
          </span>
        </div>
      </div>

      {/* Bouton Quitter */}
      <button
        onClick={onLeave}
        className="flex items-center justify-center gap-2 px-5 py-2 rounded-lg font-semibold bg-red-600 hover:bg-red-700 transition shadow-md text-sm sm:text-base"
      >
        ❌ Quitter
      </button>
    </header>
  );
}
