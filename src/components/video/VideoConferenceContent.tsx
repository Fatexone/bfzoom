"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import Lobby from "@/components/video/lobby/Lobby";
import VideoCall from "@/components/video/VideoCall";

/* =======================================================
   🔢 Générateur d'identifiant unique
======================================================= */
function generateRoomId() {
  return "room-" + Math.random().toString(36).slice(2, 8);
}

/* =======================================================
   🎥 Composant principal — BFZoom
======================================================= */
export default function VideoConferenceContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  /* 🔐 Vérifie la connexion Firebase */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setIsGuest(!user));
    return () => unsub();
  }, []);

  /* 🔗 Récupère roomId depuis l’URL */
  useEffect(() => {
    const urlRoom = searchParams.get("room");
    if (urlRoom && urlRoom !== roomId) {
      setRoomId(urlRoom);
      setFadeIn(true);
    }
  }, [searchParams, roomId]);

  /* 🎭 Génère pseudo invité */
  const guestName = useMemo(() => {
    if (!isGuest) return "";
    const suffix =
      (roomId && roomId.slice(-4).replace(/[^a-z0-9]/gi, "")) ||
      String(Math.floor(Math.random() * 9999)).padStart(4, "0");
    return `Invité-${suffix}`;
  }, [isGuest, roomId]);

  /* 🧭 Gestion des transitions de salle */
  const handleCreateRoom = useCallback(() => {
    const id = generateRoomId();
    router.push(`/videoconference?room=${id}`);
    setRoomId(id);
    setCopied(false);
  }, [router]);

  const handleJoinRoom = useCallback(
    (id: string) => {
      router.push(`/videoconference?room=${id}`);
      setRoomId(id);
      setCopied(false);
    },
    [router]
  );

  const handleLeaveRoom = useCallback(() => {
    setRoomId(null);
    setCopied(false);
    router.push("/videoconference");
  }, [router]);

  /* 📋 Copie du lien */
  const inviteLink =
    typeof window !== "undefined" && roomId
      ? `${window.location.origin}/videoconference?room=${roomId}`
      : "";

  const copyInvite = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = inviteLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [inviteLink]);

  /* ⚡ Entrée automatique invité */
  useEffect(() => {
    if (isGuest && roomId) setFadeIn(true);
  }, [isGuest, roomId]);

  /* =======================================================
     🖼️ Rendu
  ======================================================= */
  return (
    <motion.div
      className="
        relative flex flex-col items-center justify-center
        min-h-screen text-white overflow-hidden
        bg-gradient-to-b from-zinc-950 via-black to-zinc-900
      "
      initial={{ opacity: fadeIn ? 0 : 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.7, ease: 'easeOut' }}
    >
      {/* Halo central subtile */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.15 }}
        transition={{ duration: 1.2, delay: 0.5 }}
        className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(37,99,235,0.35),_transparent_70%)]"
      />

      <AnimatePresence mode="wait">
        {/* === LOBBY === */}
        {!roomId && (
          <motion.div
            key="lobby"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full max-w-2xl mx-auto px-6 py-12"
          >
            <div className="text-center mb-10">
              <motion.h1
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-4xl sm:text-5xl font-extrabold mb-3 tracking-tight"
              >
                BFZoom<span className="text-blue-400">.</span>
              </motion.h1>
              <p className="text-gray-400 text-sm sm:text-base max-w-md mx-auto leading-relaxed">
                Crée une salle ou rejoins une salle existante.<br />
                Partage ensuite ton lien d’invitation — accès instantané et sécurisé.
              </p>
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="space-y-8"
            >
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <button
                  onClick={handleCreateRoom}
                  className="
                    w-full sm:w-auto px-6 py-3 rounded-xl
                    bg-blue-600 hover:bg-blue-500
                    transition font-semibold text-sm sm:text-base
                    shadow-[0_0_20px_rgba(59,130,246,0.3)]
                  "
                >
                  ➕ Créer une nouvelle salle
                </button>
              </div>

              <Lobby onJoin={handleJoinRoom} />
            </motion.div>
          </motion.div>
        )}

        {/* === SALLE ACTIVE === */}
        {roomId && (
          <motion.div
            key="room"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col w-full h-screen overflow-hidden"
          >
            {!isGuest && (
              <div className="px-4 sm:px-6 pt-4 pb-3 bg-black/40 backdrop-blur-md border-b border-white/10 shadow-inner">
                <div className="max-w-3xl mx-auto">
                  <p className="text-sm text-gray-300 mb-2">
                    🔗 Partage ce lien à ton interlocuteur :
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      value={inviteLink}
                      readOnly
                      onFocus={(e) => e.target.select()}
                      className="
                        flex-1 px-3 py-2 rounded-lg bg-black/50 border border-white/10
                        text-xs sm:text-sm text-gray-100
                        focus:outline-none focus:ring-2 focus:ring-blue-500/40
                      "
                    />
                    <button
                      onClick={copyInvite}
                      className="
                        px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500
                        text-xs sm:text-sm font-medium transition-all shadow
                      "
                    >
                      {copied ? "Copié ✅" : "Copier"}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-500 font-mono">
                    Salle : {roomId}
                  </p>
                </div>
              </div>
            )}

            <motion.div
              className="flex-1 flex items-center justify-center bg-black"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <VideoCall
                roomId={roomId}
                onClose={handleLeaveRoom}
                isGuest={isGuest}
                guestName={guestName}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
