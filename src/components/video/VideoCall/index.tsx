"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Bot, X } from "lucide-react";
import dynamic from "next/dynamic";
import LiveKitCall from "../LiveKit/LiveKitCall";
import { getAuthHeader } from "@/lib/authHeader";

const USE_LIVEKIT = Boolean(process.env.NEXT_PUBLIC_LIVEKIT_URL);
const PeerVideoCall = dynamic(() => import("./PeerVideoCall"), { ssr: false });

/* =======================================================
   🎥 VISIO — mosaïque multi-participants + Coach IA flottant
======================================================= */
export default function VideoCall({
  roomId,
  isHost,
  aiTrainingAutoStart,
  audioOnly,
  skipPreJoin,
  defaultDisplayName,
  onLeave,
}: {
  roomId: string;
  isHost: boolean;
  aiTrainingAutoStart?: boolean;
  audioOnly?: boolean;
  skipPreJoin?: boolean;
  defaultDisplayName?: string;
  onLeave?: () => void;
}) {
  if (USE_LIVEKIT) {
    return (
      <LiveKitVideoCall
        roomId={roomId}
        isHost={isHost}
        aiTrainingAutoStart={aiTrainingAutoStart}
        audioOnly={audioOnly}
        skipPreJoin={skipPreJoin}
        defaultDisplayName={defaultDisplayName}
        onLeave={onLeave}
      />
    );
  }
  return <PeerVideoCall roomId={roomId} onLeave={onLeave} />;
}

function LiveKitVideoCall({
  roomId,
  isHost,
  aiTrainingAutoStart,
  audioOnly,
  skipPreJoin,
  defaultDisplayName,
  onLeave,
}: {
  roomId: string;
  isHost: boolean;
  aiTrainingAutoStart?: boolean;
  audioOnly?: boolean;
  skipPreJoin?: boolean;
  defaultDisplayName?: string;
  onLeave?: () => void;
}) {
  const [userCount, setUserCount] = useState(1);
  const focusedExerciseMode = Boolean(aiTrainingAutoStart);

  return (
    <div
      className={`flex min-h-dvh safe-bottom safe-x ${
        focusedExerciseMode
          ? "bg-black text-white"
          : "bg-linear-to-b from-sky-50 via-blue-50 to-sky-100 text-slate-800"
      }`}
    >
      <div className={focusedExerciseMode ? "w-full" : "w-full max-w-6xl mx-auto p-4 sm:p-6"}>
        <LiveKitCall
          roomId={roomId}
          onParticipantCount={setUserCount}
          isHost={isHost}
          aiTrainingAutoStart={aiTrainingAutoStart}
          audioOnly={audioOnly}
          skipPreJoin={skipPreJoin}
          defaultDisplayName={defaultDisplayName}
          onLeave={onLeave}
        />
      </div>
    </div>
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
  const [history, setHistory] = useState<{ question: string; answer: string }[]>([]);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    if (mq.addEventListener) {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  // ✅ Envoi à OpenAI
  const sendToOpenAI = async () => {
    if (!userMessage.trim()) return;
    setLoading(true);
    try {
      const authHeader = await getAuthHeader();
      const res = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
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
      drag={!isMobile}
      dragConstraints={isMobile ? undefined : { top: -200, bottom: 200, left: -200, right: 200 }}
      dragElastic={0.15}
      className="
        fixed z-50 bottom-6 right-4 left-4 sm:left-auto sm:right-8 sm:bottom-8
        w-auto max-w-[92vw] sm:w-80 md:w-96
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
                    <p className="font-semibold text-sky-700 mb-1">👤 {item.question}</p>
                    <p className="text-slate-700 whitespace-pre-line">{item.answer}</p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
