"use client";

import { useCallback, useRef, useState, Suspense, useEffect } from "react";
import dynamic from "next/dynamic";
import { useWebRTC } from "@/hooks/webrtc/useWebRTC";
import useMediaStreams from "./useMediaStreams";

import VideoLayout, { VideoLayoutHandle } from "./VideoLayout";
import ControlsBar from "./ControlsBar";
import VideoHeader from "./VideoHeader";
import VideoFooter from "./VideoFooter";
import WaitingScreen from "./WaitingScreen";
import ChatBox from "./ChatBox"; // 🆕 import ajouté

import Timer from "@/components/video/timer/Timer";
import OpenAIEspace from "@/components/video/panels/OpenAIEspace";
import ExerciseMenu from "@/components/video/menus/ExerciseMenu";

// Lazy-load lourd (BodyPix & tfjs chargés dans VideoEffects)
const VideoEffects = dynamic(
  () => import("@/components/video/effects/VideoEffects"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-40 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
    ),
  }
);

/* ---------------------------- Types ---------------------------- */
interface VideoCallProps {
  roomId: string;
  onClose: () => void;
  isGuest?: boolean;
  guestName?: string;
}

/* =======================================================
   🎥 VISIO — version professionnelle et responsive
======================================================= */
export default function VideoCall({
  roomId,
  onClose,
  isGuest = false,
  guestName = "",
}: VideoCallProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<VideoLayoutHandle | null>(null);

  /* =======================================================
     🔗 WebRTC : flux local / distant
  ======================================================= */
  const {
    localStream,
    remoteStream,
    userCount,
    connected,
    otherUserConnected,
    leaveRoom,
  } = useWebRTC(roomId, onClose);

  /* =======================================================
     🎙️ Contrôles audio / vidéo
  ======================================================= */
  const {
    isMuted,
    toggleMute,
    cameraOn,
    toggleCamera,
    fullScreen,
    toggleFullScreen,
  } = useMediaStreams(localStream);

  /* =======================================================
     ⚙️ États UI & Effets
  ======================================================= */
  const [videoEffect, setVideoEffect] = useState<"none" | string>("none");
  const [isMobile, setIsMobile] = useState(false);

  // Détection responsive côté client
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const handleLeave = useCallback(() => {
    leaveRoom();
  }, [leaveRoom]);

  const handleTogglePiP = useCallback(() => {
    layoutRef.current?.togglePiP();
  }, []);

  /* =======================================================
     🧠 Rendu principal
  ======================================================= */
  return (
    <div
      ref={containerRef}
      className="flex flex-col min-h-[100dvh] w-full bg-gradient-to-b from-zinc-900 via-black to-zinc-900 text-white overflow-hidden"
    >
      {/* -------- HEADER -------- */}
      <header className="w-full px-3 sm:px-6 md:px-10 pt-[env(safe-area-inset-top)]">
        <VideoHeader
          roomId={roomId}
          connected={connected}
          userCount={userCount}
          onLeave={handleLeave}
          isGuest={isGuest}
          guestName={guestName}
        />
      </header>

      {/* -------- MAIN -------- */}
      <main
        className="
          flex-1 flex flex-col lg:flex-row gap-4 sm:gap-6 md:gap-8
          max-w-[1400px] mx-auto px-2 sm:px-5 md:px-8
          py-3 sm:py-6 overflow-y-auto
        "
      >
        {/* === ZONE VIDÉO === */}
        <section
          className="
            flex-1 flex flex-col items-center justify-center
            w-full lg:w-2/3 xl:w-3/4 gap-4 transition-all relative
          "
        >
          {/* 🎬 Vidéos */}
          <div className="relative w-full rounded-2xl overflow-hidden shadow-lg">
            <VideoLayout
              ref={layoutRef}
              localStream={localStream}
              remoteStream={remoteStream}
              isMuted={isMuted}
              cameraOn={cameraOn}
            />
          </div>

          {/* 💬 ChatBox (toujours présent) */}
          <ChatBox
            roomId={roomId}
            userName={guestName || (isGuest ? "Invité" : "Créateur")}
          />

          {/* 🎛️ Contrôles bas de page */}
          <ControlsBar
            isMuted={isMuted}
            onToggleMute={toggleMute}
            cameraOn={cameraOn}
            onToggleCamera={toggleCamera}
            fullScreen={fullScreen}
            onToggleFullScreen={toggleFullScreen}
            onTogglePiP={handleTogglePiP}
            onLeave={handleLeave}
          />

          {/* 🕒 Écran d’attente */}
          {!otherUserConnected && (
            <div className="flex flex-col items-center text-center mt-6 mb-10">
              <WaitingScreen roomId={roomId} userCount={userCount} />
              <p className="text-gray-400 text-sm mt-2">
                {isGuest
                  ? "En attente du créateur de la salle..."
                  : "En attente de ton interlocuteur..."}
              </p>
            </div>
          )}
        </section>

        {/* === PANNEAU LATÉRAL === */}
        <aside
          className={`
            w-full lg:w-1/3 xl:w-1/4
            flex flex-col gap-4 transition-all
            ${isMobile ? "hidden" : "block"}
          `}
        >
          <Suspense
            fallback={
              <div className="w-full h-32 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
            }
          >
            <VideoEffects videoEffect={videoEffect} setVideoEffect={setVideoEffect} />
          </Suspense>

          {/* Modules IA / Timer */}
          {!isGuest && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
              <Timer />
              <OpenAIEspace />
            </div>
          )}
        </aside>
      </main>

      {/* -------- MENU EXERCICES -------- */}
      {!isGuest && <ExerciseMenu />}

      {/* -------- FOOTER -------- */}
      <footer className="w-full mt-auto pb-[env(safe-area-inset-bottom)]">
        <VideoFooter />
      </footer>
    </div>
  );
}
