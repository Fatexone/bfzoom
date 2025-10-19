"use client";

import { useState, useCallback, useEffect } from "react";
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
  const [guestName, setGuestName] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  /* =======================================================
     🔐 Vérifie la connexion Firebase (détermine guest/creator)
  ======================================================= */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setIsGuest(!u);
    });
    return () => unsub();
  }, []);

  /* =======================================================
     🔗 Récupère le roomId depuis l’URL
  ======================================================= */
  useEffect(() => {
    const urlRoom = searchParams.get("room");
    if (urlRoom && urlRoom !== roomId) {
      setRoomId(urlRoom);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /* =======================================================
     🎬 Création / entrée / sortie de salle
  ======================================================= */
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

  /* =======================================================
     📋 Copie du lien d’invitation
  ======================================================= */
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
      // Fallback pour anciens navigateurs
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

  /* =======================================================
     🧍 Mode invité → saisie du prénom avant entrée
  ======================================================= */
  if (isGuest && roomId && !confirmed) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-gray-900 via-black to-gray-800 text-white px-6 text-center">
        <h2 className="text-2xl font-bold mb-4">Rejoindre la salle privée</h2>
        <p className="text-sm text-gray-400 mb-6 max-w-sm">
          Ce lien vous permet de rejoindre une visioconférence sécurisée.
        </p>
        <input
          type="text"
          placeholder="Votre prénom"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
          className="px-4 py-2 rounded-lg text-black mb-4 w-60 text-center"
        />
        <button
          onClick={() => guestName && setConfirmed(true)}
          disabled={!guestName}
          className={`px-6 py-2 rounded-lg font-medium transition ${
            guestName
              ? "bg-blue-600 hover:bg-blue-500"
              : "bg-gray-500 cursor-not-allowed"
          }`}
        >
          Entrer dans la salle
        </button>
      </div>
    );
  }

  /* =======================================================
     🧠 Écran principal
  ======================================================= */
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-gray-900 via-black to-gray-800 text-white overflow-hidden">
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

          {/* 🔵 Bouton création de salle */}
          <div className="flex items-center justify-center mb-6">
            <button
              onClick={handleCreateRoom}
              className="px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition font-medium"
            >
              ➕ Créer une nouvelle salle
            </button>
          </div>

          {/* 🟡 Composant Lobby pour rejoindre une salle */}
          <Lobby onJoin={handleJoinRoom} />
        </motion.div>
      ) : (
        /* === SALLE ACTIVE === */
        <div className="w-full">
          {/* 🔗 Bandeau de lien à copier (caché pour les invités) */}
          <div className="w-full max-w-2xl mx-auto px-6 pt-6">
            {!isGuest && (
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
            )}
          </div>

          {/* 🎥 Lancement de la visio */}
          <VideoCall
            roomId={roomId}
            onClose={handleLeaveRoom}
            isGuest={isGuest}
            guestName={guestName || `Invité-${Math.floor(Math.random() * 999)}`}
          />
        </div>
      )}
    </div>
  );
}
