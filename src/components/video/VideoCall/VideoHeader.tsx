"use client";

import React from "react";

interface VideoHeaderProps {
  roomId: string;
  connected: boolean;
  userCount: number;
  onLeave: () => void;
  isGuest?: boolean;
  guestName?: string;
}

/* =======================================================
   🎛️ En-tête de la visioconférence (haut de page)
======================================================= */
export default function VideoHeader({
  roomId,
  connected,
  userCount,
  onLeave,
  isGuest = false,
  guestName = "",
}: VideoHeaderProps) {
  return (
    <header className="flex items-center justify-between py-4 border-b border-white/10">
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold">
          Salle : <span className="text-blue-400">{roomId}</span>
        </h2>

        <p className="text-sm text-gray-400">
          {connected ? "🟢 Connecté" : "🔴 Déconnecté"} – {userCount}{" "}
          participant{userCount > 1 ? "s" : ""}
        </p>

        {isGuest ? (
          <p className="text-sm text-gray-400 italic mt-1">
            Invité : {guestName || "Anonyme"}
          </p>
        ) : (
          <p className="text-sm text-gray-400 italic mt-1">Créateur connecté</p>
        )}
      </div>

      <button
        onClick={onLeave}
        className="bg-red-600 hover:bg-red-500 transition text-white px-4 py-2 rounded-lg font-medium"
      >
        Quitter
      </button>
    </header>
  );
}
