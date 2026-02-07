"use client";

import { useState, useRef, useCallback } from "react";
import { Video, Link2, PlusCircle, Copy, Check, Hash, Users, Shield } from "lucide-react";

interface LobbyProps {
  onJoin: (roomId: string) => void;
}

/* =======================================================
   🧭 LOBBY — version claire, minimaliste & responsive
======================================================= */
export default function Lobby({ onJoin }: LobbyProps) {
  const [roomId, setRoomId] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const generateRoomId = () => `room-${Math.random().toString(36).slice(2, 8)}`;

  const handleCreateRoom = useCallback(() => {
    const id = generateRoomId();
    setLoading(true);
    setTimeout(() => {
      onJoin(id);
      setLoading(false);
    }, 400);
  }, [onJoin]);

  const handleJoinRoom = useCallback(() => {
    if (!roomId.trim()) {
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    setTimeout(() => {
      onJoin(roomId);
      setLoading(false);
    }, 400);
  }, [onJoin, roomId]);

  const copyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {/* silencieux */}
  };

  return (
    <div className="w-full max-w-md mx-auto p-6 sm:p-8 bg-white border border-gray-200 rounded-2xl shadow-md text-center">
      {/* ===== Titre ===== */}
      <h1 className="text-2xl font-bold mb-2 flex items-center justify-center gap-2 text-gray-800">
        <Video className="w-6 h-6 text-blue-500" />
        <span>BFZoom</span>
      </h1>
      <p className="text-gray-500 text-sm mb-6">
        Crée une salle ou rejoins-en une avec un simple code.
      </p>

      {/* ===== Tags ===== */}
      <div className="flex justify-center flex-wrap gap-2 mb-6">
        <span className="flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          <Users className="w-3 h-3" /> 1:1 privé
        </span>
        <span className="flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-green-50 text-green-700 border border-green-200">
          <Shield className="w-3 h-3" /> WebRTC chiffré
        </span>
      </div>

      {/* ===== Input ===== */}
      <div className="relative mb-5">
        <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          ref={inputRef}
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Entrer le code de la salle"
          className="w-full pl-9 pr-10 py-2.5 border border-gray-300 rounded-lg text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition"
        />
        <button
          onClick={copyRoom}
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-400 hover:text-gray-600"
          title="Copier le code"
        >
          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>

      {/* ===== Boutons ===== */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleCreateRoom}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg font-medium text-sm disabled:opacity-50"
        >
          <PlusCircle className="w-4 h-4" />
          {loading ? "Création…" : "Créer une salle"}
        </button>

        <button
          onClick={handleJoinRoom}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-lg font-medium text-sm disabled:opacity-50"
        >
          <Link2 className="w-4 h-4" />
          {loading ? "Connexion…" : "Rejoindre"}
        </button>
      </div>

      {/* ===== Bas ===== */}
      <p className="mt-5 text-gray-500 text-xs">
        Partage ton code avec ton interlocuteur pour démarrer la visioconférence.
      </p>
    </div>
  );
}