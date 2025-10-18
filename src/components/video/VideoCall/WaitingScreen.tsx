"use client";

import React from "react";
import { motion } from "framer-motion";
import { Users, Loader2 } from "lucide-react";

interface WaitingScreenProps {
  roomId: string;
  userCount: number;
}

/**
 * Écran d'attente centré, lisible et responsive
 */
export default function WaitingScreen({ roomId, userCount }: WaitingScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="w-full h-full flex flex-col items-center justify-center gap-4 px-4 py-8 text-center bg-black/60 rounded-2xl border border-white/10 backdrop-blur-md"
    >
      {/* Avatar + Loader */}
      <div className="flex flex-col items-center justify-center gap-3">
        <div className="text-5xl sm:text-6xl animate-pulse">👤</div>
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>

      {/* Texte principal */}
      <div>
        <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2">
          En attente d’un interlocuteur…
        </h2>
        <p className="text-sm sm:text-base text-gray-300">
          La salle est prête. Partage le code à ton partenaire pour démarrer la visio.
        </p>
      </div>

      {/* Infos salle */}
      <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-3 text-sm sm:text-base text-gray-400">
        <div className="flex items-center gap-1.5">
          <Users className="w-4 h-4" />
          <span>Participants connectés :</span>
          <span className="text-blue-400 font-semibold">{userCount}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span>•</span>
          <span>Code de la salle :</span>
          <span className="text-blue-400 font-mono">{roomId}</span>
        </div>
      </div>

      {/* Message connexion */}
      <p className="mt-6 text-xs sm:text-sm text-gray-500 italic">
        Connexion en cours…
      </p>
    </motion.div>
  );
}
