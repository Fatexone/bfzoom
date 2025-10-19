"use client";

import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import Lobby from "@/components/video/lobby/Lobby";
import VideoCall from "@/components/video/VideoCall";

/* Utils */
function generateRoomId() {
  return "room-" + Math.random().toString(36).slice(2, 8);
}

/* =======================================================
   📹 Page principale : visioconférence BFZoom
======================================================= */
export default function VideoConferencePage() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  /* 🔗 1) Auto-join si l’URL contient ?room=... */
  useEffect(() => {
    const urlRoom = searchParams.get("room");
    if (urlRoom && urlRoom !== roomId) {
      setRoomId(urlRoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* 🎬 2) Création de salle -> génère un id + met à jour l'URL + entre dans la visio */
  const handleCreateRoom = useCallback(() => {
    const id = generateRoomId();
    // met à jour l'URL pour pouvoir partager le lien
    router.push(`/videoconference?room=${id}`);
    setRoomId(id);
    setCopied(false);
  }, [router]);

  /* 🎬 Quand l’utilisateur crée ou rejoint une salle via le Lobby */
  const handleJoinRoom = useCallback(
    (id: string) => {
      router.push(`/videoconference?room=${id}`);
      setRoomId(id);
      setCopied(false);
    },
    [router]
  );

  /* ❌ Quand la session est fermée */
  const handleLeaveRoom = useCallback(() => {
    setRoomId(null);
    setCopied(false);
    // Nettoie l'URL si besoin
    router.push("/videoconference");
  }, [router]);

  /* 📋 Copier le lien d'invitation */
  const inviteLink =
    typeof window !== "undefined" && roomId
      ? `${window.location.origin}/videoconference?room=${roomId}`
      : "";

  const copyInvite = useCallback(async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // fallback (iOS/some browsers)
      const ta = document.createElement("textarea");
      ta.value = inviteLink;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [inviteLink]);

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
              Crée une salle ou rejoins une salle existante. Partage ensuite un **lien d’invitation** unique, comme sur Zoom.
            </p>
          </div>

          {/* Bouton "Créer une salle" (génère un lien partageable) */}
          <div className="flex items-center justify-center mb-6">
            <button
              onClick={handleCreateRoom}
              className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition font-medium"
            >
              ➕ Créer une nouvelle salle
            </button>
          </div>

          {/* === Composant Lobby (rejoindre via saisie) === */}
          <Lobby onJoin={handleJoinRoom} />
        </motion.div>
      ) : (
        /* === SESSION VIDÉO === */
        <div className="w-full">
          {/* Bandeau lien d'invitation à copier */}
          <div className="w-full max-w-2xl mx-auto px-6 pt-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-gray-300 mb-2">
                Partage ce lien d’invitation à ton interlocuteur :
              </p>
              <div className="flex gap-2">
                <input
                  value={inviteLink}
                  readOnly
                  onFocus={(e) => e.target.select()}
                  className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-sm"
                />
                <button
                  onClick={copyInvite}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium"
                >
                  {copied ? "Copié ✅" : "Copier"}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Salle : <span className="font-mono">{roomId}</span>
              </p>
            </div>
          </div>

          {/* Composant visio */}
          <VideoCall roomId={roomId} onClose={handleLeaveRoom} />
        </div>
      )}
    </div>
  );
}
