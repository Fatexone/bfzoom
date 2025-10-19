"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Maximize2,
  Minimize2,
  PhoneOff,
  PictureInPicture2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export interface ControlsBarProps {
  isMuted: boolean;
  onToggleMute: () => void;
  cameraOn: boolean;
  onToggleCamera: () => void;
  fullScreen: boolean;
  onToggleFullScreen: () => void;
  onTogglePiP: () => void;
  onLeave?: () => void;
}

/* =======================================================
   🎚 ControlsBar — version sublimée & réactive
======================================================= */
export default function ControlsBar({
  isMuted,
  onToggleMute,
  cameraOn,
  onToggleCamera,
  fullScreen,
  onToggleFullScreen,
  onTogglePiP,
  onLeave,
}: ControlsBarProps) {
  const [visible, setVisible] = useState(true);
  const [pulse, setPulse] = useState(false);

  /* =======================================================
     🕒 Auto-hide après inactivité
  ======================================================= */
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const show = () => {
      setVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setVisible(false), 3000);
    };
    window.addEventListener("mousemove", show);
    window.addEventListener("keydown", show);
    show();
    return () => {
      window.removeEventListener("mousemove", show);
      window.removeEventListener("keydown", show);
      clearTimeout(timeout);
    };
  }, []);

  /* =======================================================
     ⌨️ Raccourcis clavier
  ======================================================= */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "m") onToggleMute();
      if (e.key.toLowerCase() === "c") onToggleCamera();
      if (e.key.toLowerCase() === "f") onToggleFullScreen();
      if (e.key.toLowerCase() === "p") onTogglePiP();
      if (e.key === "Escape" && onLeave) onLeave();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onToggleMute, onToggleCamera, onToggleFullScreen, onTogglePiP, onLeave]);

  /* =======================================================
     🖱️ Effet tactile visuel
  ======================================================= */
  const triggerPulse = useCallback(() => {
    setPulse(true);
    setTimeout(() => setPulse(false), 200);
  }, []);

  /* =======================================================
     🧱 Style commun
  ======================================================= */
  const btn = `
    flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2
    px-4 py-3 sm:px-5 sm:py-3 rounded-xl font-semibold
    transition active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/30
  `;

  /* =======================================================
     🎨 Rendu
  ======================================================= */
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="
            fixed bottom-5 sm:bottom-6 left-1/2 -translate-x-1/2
            flex flex-wrap justify-center items-center gap-3
            px-3 py-3 sm:px-6 sm:py-4
            bg-black/60 backdrop-blur-xl border border-white/10
            rounded-2xl shadow-[0_0_20px_rgba(0,0,0,0.4)]
            z-50 w-[94vw] sm:w-auto max-w-[95vw]
            pb-[env(safe-area-inset-bottom)]
          "
        >
          {/* 🎤 Micro */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              onToggleMute();
              triggerPulse();
            }}
            className={`${btn} ${
              isMuted
                ? "bg-red-600/90 hover:bg-red-700 text-white"
                : "bg-gray-800/80 hover:bg-gray-700 text-white"
            } ${pulse && !isMuted ? "ring-2 ring-green-400/40" : ""}`}
            title={isMuted ? "Activer le micro (M)" : "Couper le micro (M)"}
          >
            {isMuted ? (
              <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />
            ) : (
              <Mic className="w-5 h-5 sm:w-6 sm:h-6" />
            )}
            <span className="hidden sm:inline">
              {isMuted ? "Micro OFF" : "Micro ON"}
            </span>
          </motion.button>

          {/* 🎥 Caméra */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => {
              onToggleCamera();
              triggerPulse();
            }}
            className={`${btn} ${
              cameraOn
                ? "bg-gray-800/80 hover:bg-gray-700 text-white"
                : "bg-red-600/90 hover:bg-red-700 text-white"
            } ${pulse && !cameraOn ? "ring-2 ring-yellow-400/40" : ""}`}
            title={cameraOn ? "Désactiver caméra (C)" : "Activer caméra (C)"}
          >
            {cameraOn ? (
              <Video className="w-5 h-5 sm:w-6 sm:h-6" />
            ) : (
              <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" />
            )}
            <span className="hidden sm:inline">
              {cameraOn ? "Caméra ON" : "Caméra OFF"}
            </span>
          </motion.button>

          {/* 🧭 Plein écran */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={onToggleFullScreen}
            className={`${btn} bg-blue-600/90 hover:bg-blue-700 text-white`}
            title="Basculer plein écran (F)"
          >
            {fullScreen ? (
              <Minimize2 className="w-5 h-5 sm:w-6 sm:h-6" />
            ) : (
              <Maximize2 className="w-5 h-5 sm:w-6 sm:h-6" />
            )}
            <span className="hidden sm:inline">
              {fullScreen ? "Quitter plein écran" : "Plein écran"}
            </span>
          </motion.button>

          {/* 🖼️ Picture-in-Picture */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={onTogglePiP}
            className={`${btn} bg-gray-800/80 hover:bg-gray-700 text-white`}
            title="Activer le mode Picture-in-Picture (P)"
          >
            <PictureInPicture2 className="w-5 h-5 sm:w-6 sm:h-6" />
            <span className="hidden sm:inline">PiP</span>
          </motion.button>

          {/* 🚪 Quitter */}
          {onLeave && (
            <motion.button
              whileTap={{ scale: 0.9 }}
              whileHover={{
                scale: 1.05,
                boxShadow: "0 0 15px rgba(255,0,0,0.3)",
              }}
              onClick={onLeave}
              className={`${btn} bg-red-700/90 hover:bg-red-800 text-white shadow-lg`}
              title="Quitter la réunion (Esc)"
            >
              <PhoneOff className="w-5 h-5 sm:w-6 sm:h-6 rotate-[135deg]" />
              <span className="hidden sm:inline">Quitter</span>
            </motion.button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
