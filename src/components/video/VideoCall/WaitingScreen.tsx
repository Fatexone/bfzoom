"use client";

import React from "react";
import { motion } from "framer-motion";
import { Users, Loader2, Clock } from "lucide-react";

interface WaitingScreenProps {
  roomId: string;
  userCount: number;
}

/* =======================================================
   🎞️ Écran d’attente sublimé — Glass + Motion + Confort visuel
======================================================= */
export default function WaitingScreen({ roomId, userCount }: WaitingScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="
        relative w-full h-full flex flex-col items-center justify-center gap-6
        px-6 py-10 text-center
        bg-gradient-to-br from-black/60 via-zinc-900/40 to-black/70
        rounded-2xl border border-white/10 backdrop-blur-xl
        overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.4)]
      "
    >
      {/* Halo animé en fond */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15, scale: [1, 1.2, 1] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="
          absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,_rgba(37,99,235,0.3),_transparent_70%)]
        "
      />

      {/* Avatar + Loader */}
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: [1, 1.05, 1], rotate: [0, 1, -1, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="flex flex-col items-center justify-center gap-4"
      >
        <div className="text-6xl sm:text-7xl animate-pulse drop-shadow-[0_0_10px_rgba(59,130,246,0.3)]">
          👤
        </div>
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </motion.div>

      {/* Texte principal */}
      <div className="max-w-md mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          className="text-xl sm:text-2xl font-semibold text-white mb-2"
        >
          En attente de ton interlocuteur…
        </motion.h2>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="text-sm sm:text-base text-gray-300 leading-relaxed"
        >
          La salle est prête. <br className="sm:hidden" />
          Partage le code à ton partenaire pour démarrer la visioconférence.
        </motion.p>
      </div>

      {/* Infos salle */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7, duration: 0.6 }}
        className="
          mt-5 flex flex-col sm:flex-row items-center justify-center gap-4
          text-sm sm:text-base text-gray-400
        "
      >
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          <span>Participants :</span>
          <span className="text-blue-400 font-semibold">{userCount}</span>
        </div>
        <div className="hidden sm:block w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" />
          <span>Code :</span>
          <span className="text-blue-400 font-mono text-sm">{roomId}</span>
        </div>
      </motion.div>

      {/* Message de statut */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="mt-6 text-xs sm:text-sm text-gray-500 italic"
      >
        Connexion sécurisée en cours…
      </motion.p>
    </motion.div>
  );
}
