"use client";

import React, {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { motion } from "framer-motion";

/* =======================================================
   🔧 Types
======================================================= */
export interface VideoLayoutProps {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isMuted: boolean;
  cameraOn: boolean;
}

export interface VideoLayoutHandle {
  togglePiP: () => void;
}

/* =======================================================
   🎥 VideoLayout — version corrigée et robuste
======================================================= */
const VideoLayout = forwardRef<VideoLayoutHandle, VideoLayoutProps>(
  ({ localStream, remoteStream, isMuted, cameraOn }, ref) => {
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [bounds, setBounds] = useState<DOMRect | null>(null);
    const [isPiP, setIsPiP] = useState(false);

    /* =======================================================
       🧠 Gestion des flux vidéo
    ======================================================== */

    // Flux local
    useEffect(() => {
      const video = localVideoRef.current;
      if (video && localStream) {
        video.srcObject = localStream;
        const play = async () => {
          try {
            await video.play();
            console.log("🎥 Flux local en lecture");
          } catch (err) {
            console.warn("⚠️ Lecture vidéo locale bloquée :", err);
          }
        };
        play();
      }
    }, [localStream]);

    // Flux distant
    useEffect(() => {
      const video = remoteVideoRef.current;
      if (video && remoteStream) {
        video.srcObject = remoteStream;
        const play = async () => {
          try {
            await video.play();
            console.log("🎥 Flux distant attaché", remoteStream);
          } catch (err) {
            console.warn("⚠️ Lecture vidéo distante bloquée :", err);
          }
        };
        play();
      }
    }, [remoteStream]);

    // Mesure des limites du conteneur pour le drag
    useEffect(() => {
      const update = () => {
        if (containerRef.current) {
          setBounds(containerRef.current.getBoundingClientRect());
        }
      };
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }, []);

    /* =======================================================
       🖼️ Picture-in-Picture
    ======================================================== */
    const togglePiP = async () => {
      const video = localVideoRef.current;
      if (!video) return;

      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          setIsPiP(false);
        } else if (
          document.pictureInPictureEnabled &&
          !video.disablePictureInPicture
        ) {
          await video.requestPictureInPicture();
          setIsPiP(true);
        }
      } catch (err) {
        console.error("❌ Erreur Picture-in-Picture :", err);
      }
    };

    useImperativeHandle(ref, () => ({ togglePiP }));

    /* =======================================================
       🧩 Rendu principal
    ======================================================== */
    return (
      <div
        ref={containerRef}
        className="
          relative w-full aspect-video max-h-[90vh]
          bg-black rounded-2xl overflow-hidden border border-white/10 shadow-lg
          transition-all duration-300
        "
      >
        {/* === Flux distant (interlocuteur) === */}
        <div className="absolute inset-0 w-full h-full">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted={false}
            className="absolute inset-0 w-full h-full object-cover"
          />
          {!remoteStream && (
            <motion.div
              key="waiting-overlay"
              className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm sm:text-base bg-gradient-to-b from-black/60 to-black/80 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              En attente d’un interlocuteur…
            </motion.div>
          )}
        </div>

        {/* === Flux local (toi) === */}
        {cameraOn ? (
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
            dragElastic={0.15}
            dragMomentum={false}
            className="
              absolute bottom-4 right-4 sm:bottom-6 sm:right-6
              w-28 h-20 sm:w-44 sm:h-32 md:w-56 md:h-40
              rounded-xl overflow-hidden border border-white/20
              bg-black/60 backdrop-blur-sm shadow-lg
              hover:scale-[1.04] active:scale-[0.98]
              transition-transform duration-150 ease-out
              cursor-grab active:cursor-grabbing
            "
          >
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted={isMuted}
              className="w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            <div className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded text-gray-200">
              Toi
            </div>
          </motion.div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
            🚫 Caméra désactivée
          </div>
        )}

        {/* === Badge Picture-in-Picture actif === */}
        {isPiP && (
          <div className="absolute top-2 right-2 bg-blue-600/80 text-white text-[10px] px-2 py-1 rounded-full shadow-md">
            PiP actif
          </div>
        )}
      </div>
    );
  }
);

VideoLayout.displayName = "VideoLayout";
export default VideoLayout;
