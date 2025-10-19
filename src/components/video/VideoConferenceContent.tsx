"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { useSearchParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";

import Lobby from "@/components/video/lobby/Lobby";
import VideoCall from "@/components/video/VideoCall";

/* =======================================================
   🔢 Générateur d'identifiant de salle
======================================================= */
function generateRoomId() {
  return "room-" + Math.random().toString(36).slice(2, 8);
}

/* =======================================================
   📹 Composant principal de la visioconférence
======================================================= */
export default function VideoConferenceContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isGuest, setIsGuest] = useState(false);
  const [fadeIn, setFadeIn] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  /* 🔐 Vérifie la connexion Firebase (détermine guest/creator) */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setIsGuest(!u);
    });
    return () => unsub();
  }, []);

  /* 🔗 Récupère le roomId dans l’URL */
  useEffect(() => {
    const urlRoom = searchParams.get("room");
    if (urlRoom && urlRoom !== roomId) {
      setRoomId(urlRoom);
      setFadeIn(true);
    }
  }, [searchParams, roomId]);

  /* 🎭 Pseudo invité (aucun état inutile) */
  const guestName = useMemo(() => {
    if (!isGuest) return "";
    // pseudo stable dérivé du roomId quand possible
    const suffix =
      (roomId && roomId.slice(-4).replace(/[^a-z0-9]/gi, "")) ||
      String(Math.floor(Math.random() * 9999)).padStart(4, "0");
    return `Invité-${suffix}`;
  }, [isGuest, roomId]);

  /* 🎬 Création / entrée / sortie de salle */
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

  /* 📋 Copie du lien d’invitation */
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

  /* ⚡️ Entrée automatique pour invités (zéro friction) */
  useEffect(() => {
    if (isGuest && roomId) {
      setFadeIn(true);
    }
  }, [isGuest, roomId]);

  /* 🎥 Écran principal */
  return (
    <motion.div
      className="relative min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 via-black to-gray-800 text-white overflow-hidden"
      initial={{ opacity: fadeIn ? 0 : 1 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8 }}
    >
      {!roomId ? (
        /* === PAGE D’ACCUEIL === */
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
              Crée une salle ou rejoins une salle existante. <br />
              Partage ensuite un lien d’invitation direct — accès instantané pour ton interlocuteur.
            </p>
          </div>

          <div className="flex items-center justify-center mb-6">
            <button
              onClick={handleCreateRoom}
              className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition font-medium"
            >
              ➕ Créer une nouvelle salle
            </button>
          </div>

          <Lobby onJoin={handleJoinRoom} />
        </motion.div>
      ) : (
        /* === SALLE ACTIVE === */
        <div className="w-full">
          {/* Bandeau lien (uniquement pour créateur) */}
          {!isGuest && (
            <div className="w-full max-w-2xl mx-auto px-6 pt-6">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-gray-300 mb-2">
                  Partage ce lien à ton interlocuteur :
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
          )}

          {/* Visio (créateur ou invité) */}
          <VideoCall
            roomId={roomId}
            onClose={handleLeaveRoom}
            isGuest={isGuest}
            guestName={guestName}
          />
        </div>
      )}
    </motion.div>
  );
}
