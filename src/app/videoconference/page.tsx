"use client";

import { Suspense } from "react";
import { motion } from "framer-motion";
import VideoConferenceContent from "@/components/video/VideoConferenceContent";

/* =======================================================
   🎥 Page principale — Expérience immersive & réactive
======================================================= */
export default function VideoConferencePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PageTransition>
        <VideoConferenceContent />
      </PageTransition>
    </Suspense>
  );
}

/* =======================================================
   💫 Transition d’entrée globale
======================================================= */
function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="
        relative w-full min-h-screen overflow-hidden
        bg-gradient-to-b from-black via-zinc-900 to-black
        text-white
      "
    >
      {/* Halo central subtil */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        transition={{ delay: 0.5, duration: 1.5, ease: 'easeInOut' }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.35),_transparent_70%)]"
      />
      {children}
    </motion.div>
  );
}

/* =======================================================
   ⏳ Fallback de chargement stylisé
======================================================= */
function LoadingFallback() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="
        flex flex-col items-center justify-center
        min-h-screen text-white bg-gradient-to-b
        from-zinc-950 via-black to-zinc-900
        overflow-hidden relative
      "
    >
      {/* Halo animé */}
      <motion.div
        initial={{ scale: 1, opacity: 0.2 }}
        animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(37,99,235,0.3),_transparent_70%)]"
      />

      {/* Loader + texte */}
      <motion.div
        initial={{ y: 20 }}
        animate={{ y: [20, 0, 20] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="text-5xl mb-6"
      >
        🎥
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2, repeat: Infinity }}
        className="text-lg sm:text-xl font-light tracking-wide text-gray-300"
      >
        Connexion sécurisée en cours...
      </motion.p>
    </motion.div>
  );
}
