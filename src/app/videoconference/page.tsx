"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import Lobby from "@/components/video/lobby/Lobby";
import VideoCall from "@/components/video/VideoCall";


/* =======================================================
   📹 Page principale : visioconférence BFZoom
======================================================= */
export default function VideoConferencePage() {
  const [roomId, setRoomId] = useState<string | null>(null);


  /* 🎬 Quand l’utilisateur crée ou rejoint une salle */
  const handleJoinRoom = useCallback((id: string) => {
    setRoomId(id);
  }, []);

  /* ❌ Quand la session est fermée */
  const handleLeaveRoom = useCallback(() => {
    setRoomId(null);
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 via-black to-gray-800 text-white overflow-hidden">
      {!roomId ? (
        /* === ÉCRAN D’ACCUEIL / LOBBY === */
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl mx-auto px-6"
        >
          <div className="text-center mb-10">
            <h1 className="text-4xl sm:text-5xl font-extrabold mb-4 tracking-tight">
              BFZoom<span className="text-blue-400">.</span>
            </h1>
            <p className="text-gray-400 text-sm sm:text-base max-w-md mx-auto">
              Crée ou rejoins une salle sécurisée pour échanger en visio 1:1.  
              Tes flux vidéo sont chiffrés via WebRTC 🔒
            </p>

          
          </div>

          {/* === Composant Lobby === */}
          <Lobby onJoin={handleJoinRoom} />
        </motion.div>
      ) : (
        /* === SESSION VIDÉO === */
        <VideoCall
          roomId={roomId}
    
          onClose={handleLeaveRoom}
        />
      )}
    </div>
  );
}
