"use client";

import { useEffect, useRef } from "react";

/**
 * 🎥 VideoStream — composant vidéo universel (iPhone, Mac, Android)
 * Gère un flux externe (remoteStream) ou local, avec effets visuels optionnels.
 */
export interface VideoStreamProps {
  videoEffect?: string;
  isMuted?: boolean;
  cameraOn?: boolean;
  externalStream?: MediaStream | null;
}

export default function VideoStream({
  videoEffect = "none",
  isMuted = false,
  cameraOn = true,
  externalStream = null,
}: VideoStreamProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const internalStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const videoElement = videoRef.current;
        if (!videoElement) return;

        // 🎯 Si un flux externe est fourni (remote ou local partagé)
        if (externalStream) {
          videoElement.srcObject = externalStream;
          videoElement.muted = isMuted;
          videoElement.playsInline = true;
          videoElement.setAttribute("webkit-playsinline", "true");

          // Lecture forcée sur Safari
          try {
            await videoElement.play();
          } catch (err) {
            console.warn("⚠️ Lecture flux externe bloquée :", err);
          }
          return;
        }

        // 🎥 Sinon, capture locale
        const local = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (cancelled) return;
        internalStreamRef.current = local;
        videoElement.srcObject = local;
        videoElement.muted = true; // Toujours muté côté local
        videoElement.playsInline = true;
        videoElement.setAttribute("webkit-playsinline", "true");

        try {
          await videoElement.play();
        } catch (err) {
          console.warn("⚠️ Lecture flux local bloquée :", err);
        }
      } catch (err) {
        console.error("❌ Erreur accès caméra/micro :", err);
      }
    };

    setup();

    // 🧹 Nettoyage propre
    return () => {
      cancelled = true;
      internalStreamRef.current?.getTracks().forEach((t) => t.stop());
      internalStreamRef.current = null;
    };
  }, [externalStream, isMuted]);

  /* =======================================================
     🖼️ Rendu vidéo responsive + indicateurs
  ======================================================= */
  return (
    <div
      className="
        relative w-full h-full flex items-center justify-center
        bg-black rounded-2xl overflow-hidden border border-white/10
      "
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
        className={`
          w-full h-full object-cover transition-all duration-500
          ${cameraOn ? "opacity-100" : "opacity-40"}
          ${
            videoEffect === "grayscale"
              ? "filter grayscale"
              : videoEffect === "blur"
              ? "filter blur-sm"
              : videoEffect === "contrast"
              ? "filter contrast-150"
              : ""
          }
        `}
      />

      {/* Indicateurs visuels */}
      <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 text-[10px] sm:text-xs md:text-sm select-none">
        {!cameraOn && (
          <span className="px-2 py-1 bg-red-600/80 rounded-lg shadow-sm">
            🚫 Caméra OFF
          </span>
        )}
        {isMuted && (
          <span className="px-2 py-1 bg-yellow-500/80 rounded-lg shadow-sm">
            🔇 Micro OFF
          </span>
        )}
      </div>
    </div>
  );
}