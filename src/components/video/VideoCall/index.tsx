"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Users, Power, Wifi, Bot, X } from "lucide-react";
import { useWebRTC } from "@/hooks/webrtc/useWebRTC";
import useMediaStreams from "./useMediaStreams";
import VideoLayout from "./VideoLayout";

/* =======================================================
   🎥 VISIO — mosaïque style Zoom + Coach IA flottant
======================================================= */
export default function VideoCall({ roomId }: { roomId: string }) {
  const { localStream, remoteStream, userCount, connected, leaveRoom } =
    useWebRTC(roomId, () => {});
  const { isMuted, cameraOn } = useMediaStreams(localStream);

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-sky-50 via-blue-50 to-sky-100 text-slate-800">
      {/* === HEADER intégré === */}
      <div className="sticky top-0 z-40 w-full bg-white/80 backdrop-blur border-b border-sky-200">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <Header
            roomId={roomId}
            connected={connected}
            userCount={userCount}
            onLeave={leaveRoom}
          />
        </div>
      </div>

      {/* === MOSAÏQUE === */}
      <main className="flex-1 flex items-center justify-center w-full mx-auto p-4 sm:p-6">
        <div className="w-full max-w-5xl">
          <VideoLayout
            localStream={localStream}
            remoteStream={remoteStream}
            isMuted={isMuted}
            cameraOn={cameraOn}
          />
        </div>
      </main>

      {/* === COACH IA FLOTTANT === */}
      <OpenAIEspace />

      {/* === FOOTER intégré === */}
      <Footer />
    </div>
  );
}

/* =======================================================
   🎛️ HEADER (local)
======================================================= */
function Header({
  roomId,
  connected,
  userCount,
  onLeave,
}: {
  roomId: string;
  connected: boolean;
  userCount: number;
  onLeave: () => void;
}) {
  const connectionStatus = connected
    ? "Connecté"
    : userCount > 0
    ? "En attente"
    : "Déconnecté";

  const connectionColor = connected
    ? "bg-green-500"
    : userCount > 0
    ? "bg-yellow-500"
    : "bg-red-500";

  return (
    <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
      {/* Infos salle */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Salle :{" "}
            <span className="text-blue-600 font-mono text-base break-all">
              {roomId}
            </span>
          </h2>

          <p className="text-sm text-slate-600 mt-1 flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${connectionColor}`} />
            {connectionStatus} — {userCount}{" "}
            {userCount > 1 ? "participants" : "participant"}
          </p>
        </div>
      </div>

      {/* Quitter */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.05 }}
        transition={{ duration: 0.15 }}
        onClick={onLeave}
        className="
          flex items-center justify-center gap-2
          bg-red-600 hover:bg-red-700 text-white
          px-4 py-2 rounded-xl font-medium
          transition-all duration-200 ease-out
          focus:outline-none focus:ring-2 focus:ring-red-500/40
          active:scale-95
        "
      >
        <Power className="w-5 h-5" />
        <span className="text-sm sm:text-base">Quitter</span>
      </motion.button>

      {/* Badge mobile */}
      <div className="absolute right-0 -bottom-5 sm:hidden flex items-center gap-1 text-xs text-gray-500">
        <Users className="w-3.5 h-3.5" />
        {userCount}
      </div>
    </div>
  );
}

/* =======================================================
   🦶 FOOTER (local)
======================================================= */
function Footer() {
  const year = new Date().getFullYear();

  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="
        w-full text-center py-3 sm:py-4
        bg-white/70 border-t border-sky-200
        backdrop-blur
        text-slate-500 text-xs sm:text-sm
        tracking-wide select-none
      "
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 px-4">
        <motion.p className="font-light text-[11px] sm:text-xs">
          © {year} — <span className="text-blue-600 font-medium">BFZoom</span>. Tous droits réservés.
        </motion.p>

        <div className="hidden sm:block w-px h-4 bg-slate-300/60" />

        <motion.div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
          <Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="tracking-tight">Connexion stable</span>
        </motion.div>
      </div>
    </motion.footer>
  );
}

/* =======================================================
   🤖 COACH IA FLOTTANT — draggable & responsive
======================================================= */
function OpenAIEspace() {
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<
    { question: string; answer: string }[]
  >([]);

  // ✅ Envoi à OpenAI
  const sendToOpenAI = async () => {
    if (!userMessage.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      const data = await res.json();
      const answer = data.choices?.[0]?.message?.content || "Pas de réponse.";
      setAiResponse(answer);
      setHistory((prev) => [...prev, { question: userMessage, answer }]);
      setUserMessage("");
    } catch {
      setAiResponse("Erreur de connexion à l'IA.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      drag
      dragConstraints={{ top: -200, bottom: 200, left: -200, right: 200 }}
      dragElastic={0.15}
      className="
        fixed z-50 bottom-6 right-6 sm:bottom-8 sm:right-8
        w-[90vw] sm:w-80 md:w-96
        bg-white text-slate-800 border border-sky-200
        rounded-2xl shadow-2xl backdrop-blur-lg
        select-none cursor-grab active:cursor-grabbing
        overflow-hidden transition-all duration-300
      "
    >
      {/* === En-tête du panneau === */}
      <div className="flex items-center justify-between px-4 py-3 bg-sky-100 border-b border-sky-200">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-sky-600" />
          <span className="font-semibold text-sm sm:text-base">Coach IA</span>
        </div>
        <button
          onClick={() => setIsAiOpen(!isAiOpen)}
          className="text-sky-700 hover:text-sky-900 transition"
        >
          {isAiOpen ? <X className="w-5 h-5" /> : <span className="text-lg">+</span>}
        </button>
      </div>

      {/* === Contenu repliable === */}
      {isAiOpen && (
        <div className="p-4 space-y-3 bg-sky-50/70 max-h-[60vh] overflow-y-auto">
          {/* Saisie utilisateur */}
          <input
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="Pose ta question..."
            className="
              w-full p-2 rounded-lg text-sm
              bg-white border border-sky-200
              focus:outline-none focus:ring-2 focus:ring-sky-400
            "
          />
          <button
            onClick={sendToOpenAI}
            disabled={loading}
            className="
              w-full py-2 rounded-lg
              bg-sky-600 hover:bg-sky-500
              text-white font-medium text-sm
              transition disabled:opacity-50
            "
          >
            {loading ? "Envoi..." : "Envoyer"}
          </button>

          {/* ⚡ Réponse courante de l'IA */}
          {aiResponse && (
            <div className="mt-3 p-3 rounded-lg bg-white border border-sky-200 text-sm leading-relaxed shadow-sm">
              <p className="font-semibold text-sky-700 mb-1">🤖 Réponse :</p>
              <p className="text-slate-700 whitespace-pre-line">{aiResponse}</p>
            </div>
          )}

          {/* Historique */}
          {history.length > 0 && (
            <div className="mt-3 space-y-3">
              {history
                .slice()
                .reverse()
                .map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-white border border-sky-200 text-sm leading-relaxed shadow-sm"
                  >
                    <p className="font-semibold text-sky-700 mb-1">
                      👤 {item.question}
                    </p>
                    <p className="text-slate-700 whitespace-pre-line">
                      {item.answer}
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
