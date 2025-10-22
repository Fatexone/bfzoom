"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import Lobby from "@/components/video/lobby/Lobby";
import VideoCall from "@/components/video/VideoCall";

/* =======================================================
   🎥 BFZoom — Version minimaliste et stable
======================================================= */
export default function VideoConferenceContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [copied, setCopied] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();

  /* 🔐 Vérifie la connexion Firebase */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setIsGuest(!user));
    return () => unsub();
  }, []);

  /* 🔗 Récupère le roomId depuis l'URL */
  useEffect(() => {
    const urlRoom = searchParams.get("room");
    if (urlRoom && urlRoom !== roomId) {
      setRoomId(urlRoom);
    }
  }, [searchParams, roomId]);

  /* 🧭 Création et jointure de salle */
  const generateRoomId = () => "room-" + Math.random().toString(36).slice(2, 8);

  const handleCreateRoom = useCallback(() => {
    const id = generateRoomId();
    router.push(`/videoconference?room=${id}`);
    setRoomId(id);
  }, [router]);

  const handleJoinRoom = useCallback(
    (id: string) => {
      router.push(`/videoconference?room=${id}`);
      setRoomId(id);
    },
    [router]
  );

  const handleLeaveRoom = useCallback(() => {
    setRoomId(null);
    router.push("/videoconference");
  }, [router]);

  /* 📋 Lien d'invitation */
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
    } catch (err) {
      console.error("Erreur de copie :", err);
    }
  }, [inviteLink]);

  /* =======================================================
     🖼️ Rendu
  ======================================================= */
  if (!roomId) {
    // === LOBBY ===
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 text-gray-800 px-4">
        <div className="max-w-md w-full bg-white shadow-lg rounded-2xl p-6 border border-gray-200">
          <h1 className="text-3xl font-bold text-center mb-2">BFZoom</h1>
          <p className="text-center text-gray-500 text-sm mb-6">
            Crée une salle ou rejoins une salle existante.
          </p>

          <div className="space-y-4">
            <button
              onClick={handleCreateRoom}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-semibold"
            >
              ➕ Créer une salle
            </button>

            <div className="border-t border-gray-200 pt-4">
              <Lobby onJoin={handleJoinRoom} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === SALLE ACTIVE ===
  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-white">
      {!isGuest && (
        <div className="p-4 bg-gray-800 border-b border-gray-700 text-sm">
          <p className="mb-1">🔗 Partage ce lien :</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={inviteLink}
              readOnly
              onFocus={(e) => e.target.select()}
              className="flex-1 px-3 py-2 rounded-md bg-gray-700 border border-gray-600 text-gray-200 text-xs"
            />
            <button
              onClick={copyInvite}
              className="px-4 py-2 bg-blue-600 rounded-md hover:bg-blue-500 text-xs font-medium"
            >
              {copied ? "Copié ✅" : "Copier"}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-400">Salle : {roomId}</p>
        </div>
      )}

      <div className="flex-1 flex items-center justify-center">
        <VideoCall roomId={roomId} />
      </div>

      <button
        onClick={handleLeaveRoom}
        className="m-4 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm"
      >
        Quitter la salle
      </button>
    </div>
  );
}
