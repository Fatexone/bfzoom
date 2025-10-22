"use client";

import React, { useEffect, useRef } from "react";

/* =======================================================
   🔧 Types
======================================================= */
export interface VideoLayoutProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  cameraOn: boolean;
}

/* =======================================================
   🎥 VideoLayout — compatible iPhone, Android & Desktop
======================================================= */
export default function VideoLayout({
  localStream,
  remoteStream,
  isMuted,
  cameraOn,
}: VideoLayoutProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  /* =======================================================
     🎬 Gestion des flux
  ======================================================== */
  useEffect(() => {
    const localVideo = localVideoRef.current;
    if (localVideo && localStream) {
      localVideo.srcObject = localStream;
      localVideo.muted = true;
      localVideo.playsInline = true;
      // iOS Safari : demande explicite de lecture
      const playVideo = async () => {
        try {
          await localVideo.play();
        } catch (err) {
          console.warn("⚠️ Lecture flux local bloquée :", err);
        }
      };
      playVideo();
    }
  }, [localStream]);

  useEffect(() => {
    const remoteVideo = remoteVideoRef.current;
    if (remoteVideo && remoteStream) {
      remoteVideo.srcObject = remoteStream;
      remoteVideo.playsInline = true;
      remoteVideo.setAttribute("webkit-playsinline", "true");
      const playVideo = async () => {
        try {
          await remoteVideo.play();
        } catch (err) {
          console.warn("⚠️ Lecture flux distant bloquée :", err);
        }
      };
      playVideo();
    }
  }, [remoteStream]);

  /* =======================================================
     🧱 Flux actifs
  ======================================================== */
  const videoStreams = [
    { ref: localVideoRef, label: "Vous", muted: isMuted, visible: cameraOn },
    remoteStream
      ? { ref: remoteVideoRef, label: "Interlocuteur", muted: false, visible: true }
      : null,
  ].filter(Boolean) as {
    ref: React.RefObject<HTMLVideoElement>;
    label: string;
    muted: boolean;
    visible: boolean;
  }[];

  /* =======================================================
     🖼️ Layout responsive
  ======================================================== */
  return (
    <div
      className="
        relative w-full h-full bg-slate-100 
        grid gap-3 p-2 sm:p-3
        rounded-2xl border border-slate-200 shadow-md
        grid-cols-1 md:grid-cols-2
        auto-rows-[minmax(0,1fr)]
      "
    >
      {videoStreams.map((stream, i) => (
        <div
          key={i}
          className="
            relative flex items-center justify-center
            rounded-2xl overflow-hidden bg-black
            aspect-video sm:aspect-[4/3] md:aspect-[16/9]
          "
        >
          {stream.visible ? (
            <video
              ref={stream.ref}
              autoPlay
              playsInline
              muted={stream.muted}
              disablePictureInPicture
              className="w-full h-full object-cover rounded-2xl"
              style={{
                transform: i === 0 ? "scaleX(-1)" : "none",
              }}
            />
          ) : (
            <div className="text-slate-400 text-sm">🚫 Caméra désactivée</div>
          )}

          <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md select-none">
            {stream.label}
          </div>
        </div>
      ))}

      {videoStreams.length === 1 && (
        <div className="absolute inset-x-0 bottom-4 text-center text-slate-500 text-sm">
          En attente d’un autre participant…
        </div>
      )}
    </div>
  );
}
