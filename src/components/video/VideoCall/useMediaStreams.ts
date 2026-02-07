"use client";

import { useEffect, useState, useCallback, useRef } from "react";

/** WebKit fullscreen typings (Safari) */
interface WebkitDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface WebkitHTMLElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

/**
 * 🎥 Gestion audio/vidéo + plein écran + stabilité iOS
 * Ne capture pas le flux, ne modifie que les tracks locales.
 */
export default function useMediaStreams(localStream: MediaStream | null) {
  const [cameraOn, setCameraOn] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // sauvegarde d’état caméra lors du changement d’onglet
  const wasCameraOnRef = useRef(true);

  /* 🎙️ Gestion du micro */
  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => {
      if (t) t.enabled = !isMuted;
    });
  }, [isMuted, localStream]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  /* 📸 Gestion caméra on/off */
  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;

    const next = !videoTracks[0].enabled;
    videoTracks.forEach((t) => {
      if (t) t.enabled = next;
    });
    setCameraOn(next);
  }, [localStream]);

  /* 🔄 Redémarrage caméra (utile Safari freeze) */
  const restartCamera = useCallback(async () => {
    if (!localStream) return;
    try {
      localStream.getVideoTracks().forEach((t) => t.stop());

      const fresh = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      const newTrack = fresh.getVideoTracks()[0];
      if (!newTrack) return;

      localStream.getVideoTracks().forEach((t) => localStream.removeTrack(t));
      localStream.addTrack(newTrack);

      newTrack.enabled = cameraOn;
    } catch (e) {
      console.error("❌ restartCamera failed:", e);
    }
  }, [localStream, cameraOn]);

  /* ⛶ Gestion plein écran (standard + WebKit fallback) */
  const requestFullscreen = useCallback(() => {
    const doc = document as WebkitDocument;
    const el = document.documentElement as WebkitHTMLElement;

    const isFs =
      document.fullscreenElement ??
      doc.webkitFullscreenElement ??
      null;

    if (!isFs) {
      const req =
        el.requestFullscreen?.bind(el) ??
        el.webkitRequestFullscreen?.bind(el);

      req?.();
      setIsFullscreen(true);
    } else {
      const exit =
        document.exitFullscreen?.bind(document) ??
        doc.webkitExitFullscreen?.bind(doc);

      exit?.();
      setIsFullscreen(false);
    }
  }, []);

  /* 💤 iOS/Safari: pause la caméra quand l’onglet est masqué */
  useEffect(() => {
    const handleVisibility = () => {
      if (!localStream) return;
      if (document.hidden) {
        wasCameraOnRef.current = cameraOn;
        localStream.getVideoTracks().forEach((t) => (t.enabled = false));
        setCameraOn(false);
      } else {
        localStream.getVideoTracks().forEach(
          (t) => (t.enabled = wasCameraOnRef.current)
        );
        setCameraOn(wasCameraOnRef.current);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [localStream, cameraOn]);

  return {
    cameraOn,
    isMuted,
    isFullscreen,
    toggleMute,
    toggleCamera,
    requestFullscreen, // ✅ correspondance avec VideoControls
    restartCamera,
  };
}