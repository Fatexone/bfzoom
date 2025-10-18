"use client";

import { useCallback, useRef, useState, Suspense } from "react";
import dynamic from "next/dynamic";
import { useWebRTC } from "./useWebRTC";
import useMediaStreams from "./useMediaStreams";

import VideoLayout, { VideoLayoutHandle } from "./VideoLayout";
import ControlsBar from "./ControlsBar";
import VideoHeader from "./VideoHeader";
import VideoFooter from "./VideoFooter";
import WaitingScreen from "./WaitingScreen";

import Timer from "@/components/video/timer/Timer";
import OpenAIEspace from "@/components/video/panels/OpenAIEspace";
import ExerciseMenu from "@/components/video/menus/ExerciseMenu";

// Lazy-load lourd (BodyPix & tfjs chargés dans VideoEffects)
const VideoEffects = dynamic(() => import("@/components/video/effects/VideoEffects"), {
  ssr: false,
  loading: () => (
    <div className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl h-40 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
  ),
});

/* ---------------------------- Types ---------------------------- */
interface VideoCallProps {
  roomId: string;
  onClose: () => void;
}

/* =======================================================
   🎥 VISIO — Responsive, accessible, haut de gamme
======================================================= */
export default function VideoCall({ roomId, onClose }: VideoCallProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<VideoLayoutHandle | null>(null); // ✅ ref pour le PiP

  // ---------- WebRTC ----------
  const {
    localStream,
    remoteStream,
    userCount,
    connected,
    otherUserConnected,
    leaveRoom,
  } = useWebRTC(roomId, onClose);

  // ---------- Caméra / micro / plein écran ----------
  const {
    isMuted,
    toggleMute,
    cameraOn,
    toggleCamera,
    fullScreen,
    toggleFullScreen,
  } = useMediaStreams(localStream);

  // ---------- Effets vidéo ----------
  const [videoEffect, setVideoEffect] = useState<"none" | string>("none");

  // ---------- Quitter ----------
  const handleLeave = useCallback(() => {
    leaveRoom();
  }, [leaveRoom]);

  // ---------- Toggle Picture-in-Picture ----------
  const handleTogglePiP = useCallback(() => {
    layoutRef.current?.togglePiP();
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex min-h-[100dvh] w-full flex-col bg-gradient-to-b from-zinc-900 via-black to-zinc-900 text-white overflow-hidden"
    >
      {/* HEADER */}
      <div className="w-full px-3 sm:px-6 md:px-10 pt-[env(safe-area-inset-top)]">
        <VideoHeader
          roomId={roomId}
          connected={connected}
          userCount={userCount}
          onLeave={handleLeave}
        />
      </div>

      {/* MAIN */}
      <main
        className="
          flex-1 w-full mx-auto
          px-2 sm:px-5 md:px-8
          py-3 sm:py-6
          max-w-[1400px]
          flex flex-col gap-4 sm:gap-6 md:gap-8
          overflow-y-auto
          pb-[120px] sm:pb-[120px] md:pb-[110px]
        "
        role="main"
      >
        {/* Bloc vidéo + commandes */}
        <section className="w-full grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
          {/* Zone vidéo (prend la place) */}
          <div className="lg:col-span-8 flex flex-col items-center gap-4">
            <div className="w-full">
              <VideoLayout
                ref={layoutRef} // ✅ permet d’appeler togglePiP()
                localStream={localStream}
                remoteStream={remoteStream}
                isMuted={isMuted}
                cameraOn={cameraOn}
              />
            </div>

            <ControlsBar
              isMuted={isMuted}
              onToggleMute={toggleMute}
              cameraOn={cameraOn}
              onToggleCamera={toggleCamera}
              fullScreen={fullScreen}
              onToggleFullScreen={toggleFullScreen}
              onTogglePiP={handleTogglePiP} // ✅ nouvelle prop
              onLeave={handleLeave}
            />
          </div>

          {/* Panneau latéral intelligent (stack → side) */}
          <aside className="lg:col-span-4 flex flex-col gap-4 max-h-[calc(100vh-200px)] overflow-y-auto">
            <Suspense
              fallback={
                <div className="w-full h-32 rounded-2xl bg-white/5 border border-white/10 animate-pulse" />
              }
            >
              <VideoEffects videoEffect={videoEffect} setVideoEffect={setVideoEffect} />
            </Suspense>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-4">
              <Timer />
              <OpenAIEspace />
            </div>
          </aside>
        </section>

        {/* Écran d’attente si interlocuteur absent */}
        {!otherUserConnected && (
          <section className="w-full flex justify-center">
            <div className="w-full max-w-md">
              <WaitingScreen roomId={roomId} userCount={userCount} />
            </div>
          </section>
        )}
      </main>

      {/* MENU EXERCICES (fixed, non intrusif) */}
      <ExerciseMenu />

      {/* FOOTER */}
      <div className="w-full mt-auto pb-[env(safe-area-inset-bottom)]">
        <VideoFooter />
      </div>
    </div>
  );
}
