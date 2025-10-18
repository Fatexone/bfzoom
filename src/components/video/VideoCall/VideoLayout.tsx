"use client";

import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { motion } from "framer-motion";

export interface VideoLayoutProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  cameraOn: boolean;
}

export interface VideoLayoutHandle {
  togglePiP: () => void;
}

/**
 * 🎥 Layout vidéo responsive + Picture-in-Picture natif
 */
const VideoLayout = forwardRef<VideoLayoutHandle, VideoLayoutProps>(
  ({ localStream, remoteStream, isMuted, cameraOn }, ref) => {
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [bounds, setBounds] = useState<DOMRect | null>(null);

    useEffect(() => {
      if (localVideoRef.current && localStream) {
        localVideoRef.current.srcObject = localStream;
      }
    }, [localStream]);

    useEffect(() => {
      if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    }, [remoteStream]);

    useEffect(() => {
      const update = () => {
        if (containerRef.current) setBounds(containerRef.current.getBoundingClientRect());
      };
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }, []);

    /* =====================================================
       🎞️ Mode Picture-in-Picture (PiP)
    ===================================================== */
    const togglePiP = async () => {
      const video = localVideoRef.current;
      if (!video) return;

      try {
        // Si déjà en PiP → quitter
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          return;
        }

        // Safari / Chrome : activer PiP sur la vidéo locale
        if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
          await video.requestPictureInPicture();
        }
      } catch (err) {
        console.error("❌ Erreur PiP :", err);
      }
    };

    useImperativeHandle(ref, () => ({ togglePiP }));

    const hasRemote = !!remoteStream;

    return (
      <div
        ref={containerRef}
        className="relative w-full aspect-video max-h-[90vh] bg-black rounded-2xl overflow-hidden border border-white/10 shadow-lg"
      >
        {/* Remote (interlocuteur) */}
        {hasRemote ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm sm:text-base">
            En attente d’un interlocuteur…
          </div>
        )}

        {/* Local (toi) */}
        {cameraOn && (
          <motion.div
            drag
            dragConstraints={
              bounds
                ? {
                    top: -bounds.height / 2,
                    bottom: bounds.height / 2,
                    left: -bounds.width / 2,
                    right: bounds.width / 2,
                  }
                : undefined
            }
            dragElastic={0.2}
            dragMomentum={false}
            className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 w-28 h-20 sm:w-44 sm:h-32 md:w-56 md:h-40 rounded-xl overflow-hidden border border-white/20 bg-black/50 shadow-lg hover:scale-[1.03] transition-transform cursor-grab active:cursor-grabbing"
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted={isMuted}
              className="w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
          </motion.div>
        )}

        {!cameraOn && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            🚫 Caméra désactivée
          </div>
        )}
      </div>
    );
  }
);

VideoLayout.displayName = "VideoLayout";
export default VideoLayout;
