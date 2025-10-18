"use client";

import { useEffect, useRef } from "react";

export interface VideoStreamProps {
  videoEffect: string;
  isMuted?: boolean;
  cameraOn?: boolean;
  /** ✅ Ajout du flux externe fourni par VideoCall */
  externalStream?: MediaStream;
}

export default function VideoStream({
  videoEffect,
  isMuted = false,
  cameraOn = true,
  externalStream,
}: VideoStreamProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const internalStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        // ✅ Si un flux externe est fourni, on l’utilise
        if (externalStream) {
          if (videoRef.current) videoRef.current.srcObject = externalStream;
          return;
        }

        // Sinon on capture localement
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (cancelled) return;
        internalStreamRef.current = stream;

        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Erreur d’accès caméra/micro :", err);
      }
    };

    setup();

    return () => {
      cancelled = true;
      internalStreamRef.current?.getTracks().forEach((t) => t.stop());
      internalStreamRef.current = null;
    };
  }, [externalStream]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-black rounded-xl overflow-hidden border border-white/10">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`w-full h-full object-cover transition-all duration-500 ${
          videoEffect === "grayscale"
            ? "filter grayscale"
            : videoEffect === "blur"
            ? "filter blur-sm"
            : videoEffect === "contrast"
            ? "filter contrast-150"
            : ""
        } ${cameraOn ? "opacity-100" : "opacity-40"}`}
      />
      <div className="absolute bottom-3 left-3 flex gap-3 text-xs sm:text-sm">
        {!cameraOn && (
          <span className="px-3 py-1 bg-red-600/80 rounded-lg">🚫 Caméra OFF</span>
        )}
        {isMuted && (
          <span className="px-3 py-1 bg-yellow-500/80 rounded-lg">🔇 Micro OFF</span>
        )}
      </div>
    </div>
  );
}
