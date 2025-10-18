"use client";

import React, { useEffect, useState } from "react";
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
  onTogglePiP: () => void; // ✅ nouveau callback PiP
  onLeave?: () => void;
}

/**
 * 🎚 ControlsBar ultra-responsive + auto-hide + Picture-in-Picture
 * - Apparaît au mouvement souris / clavier
 * - Barre fluide, repliée sur mobile
 */
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

  // Auto-hide après 3 s d’inactivité
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

  const btn =
    "flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-4 py-3 sm:px-5 sm:py-3 rounded-xl font-semibold transition active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/30";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.3 }}
          className="
            fixed bottom-6 left-1/2 -translate-x-1/2
            flex flex-wrap justify-center items-center gap-3
            px-3 py-3 sm:px-6 sm:py-4
            bg-black/70 backdrop-blur-lg border border-white/10
            rounded-2xl shadow-lg z-30
            w-[94vw] sm:w-auto
          "
        >
          {/* 🎤 Micro */}
          <button
            onClick={onToggleMute}
            className={`${btn} ${
              isMuted
                ? "bg-red-600/80 hover:bg-red-700 text-white"
                : "bg-gray-800/80 hover:bg-gray-700 text-white"
            }`}
            title={isMuted ? "Activer le micro (M)" : "Couper le micro (M)"}
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="hidden sm:inline">{isMuted ? "OFF" : "ON"}</span>
          </button>

          {/* 🎥 Caméra */}
          <button
            onClick={onToggleCamera}
            className={`${btn} ${
              cameraOn
                ? "bg-gray-800/80 hover:bg-gray-700 text-white"
                : "bg-red-600/80 hover:bg-red-700 text-white"
            }`}
            title={cameraOn ? "Désactiver caméra (C)" : "Activer caméra (C)"}
          >
            {cameraOn ? (
              <Video className="w-5 h-5" />
            ) : (
              <VideoOff className="w-5 h-5" />
            )}
            <span className="hidden sm:inline">{cameraOn ? "ON" : "OFF"}</span>
          </button>

          {/* 🧭 Plein écran */}
          <button
            onClick={onToggleFullScreen}
            className={`${btn} bg-blue-600/80 hover:bg-blue-700 text-white`}
            title="Basculer plein écran (F)"
          >
            {fullScreen ? (
              <Minimize2 className="w-5 h-5" />
            ) : (
              <Maximize2 className="w-5 h-5" />
            )}
            <span className="hidden sm:inline">
              {fullScreen ? "Quitter" : "Plein écran"}
            </span>
          </button>

          {/* 🖼️ Picture-in-Picture */}
          <button
            onClick={onTogglePiP}
            className={`${btn} bg-gray-800/80 hover:bg-gray-700 text-white`}
            title="Activer le mode Picture-in-Picture"
          >
            <PictureInPicture2 className="w-5 h-5" />
            <span className="hidden sm:inline">PiP</span>
          </button>

          {/* 🚪 Quitter */}
          {onLeave && (
            <button
              onClick={onLeave}
              className={`${btn} bg-red-700/90 hover:bg-red-800 text-white shadow-lg`}
              title="Quitter la réunion (Esc)"
            >
              <PhoneOff className="w-5 h-5 rotate-135" />
              <span className="hidden sm:inline">Quitter</span>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
