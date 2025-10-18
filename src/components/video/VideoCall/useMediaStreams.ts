// src/components/video/VideoCall/useMediaStreams.ts
// 🎥 contrôles audio/vidéo + plein écran (ne capture PAS le flux)
"use client";

import { useEffect, useState, useCallback } from "react";

export default function useMediaStreams(localStream: MediaStream | null) {
  const [cameraOn, setCameraOn] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);

  /* 🎙️ Mute audio selon isMuted */
  useEffect(() => {
    if (!localStream) return;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  }, [isMuted, localStream]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  /* 📸 Caméra on/off */
  const toggleCamera = useCallback(() => {
    if (!localStream) return;
    const videoTracks = localStream.getVideoTracks();
    if (videoTracks.length === 0) return;
    const newState = !videoTracks[0].enabled;
    videoTracks.forEach((t) => (t.enabled = newState));
    setCameraOn(newState);
  }, [localStream]);

  /* ⛶ Plein écran */
  const toggleFullScreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().then(() => setFullScreen(true)).catch(() => {});
    } else {
      document.exitFullscreen?.().then(() => setFullScreen(false)).catch(() => {});
    }
  }, []);

  return {
    // on ne retourne pas localStream ici : il vient de useWebRTC
    cameraOn,
    isMuted,
    toggleMute,
    toggleCamera,
    fullScreen,
    toggleFullScreen,
  };
}
