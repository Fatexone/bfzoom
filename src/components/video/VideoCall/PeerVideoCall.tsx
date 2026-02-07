"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWebRTC } from "@/hooks/webrtc/useWebRTC";
import useMediaStreams from "./useMediaStreams";
import VideoLayout from "./VideoLayout";
import VideoControls from "./VideoControls";
import Header from "./VideoCallHeader";
import Footer from "./VideoCallFooter";

export default function PeerVideoCall({
  roomId,
  onLeave,
}: {
  roomId: string;
  onLeave?: () => void;
}) {
  const router = useRouter();
  const {
    localStream,
    remoteStreams,
    userCount,
    leaveRoom,
    mediaError,
    isRequestingMedia,
    requestMedia,
    lowBandwidthMode,
    toggleLowBandwidth,
    connectionWarning,
  } = useWebRTC(roomId, () => {});
  const {
    isMuted,
    cameraOn,
    toggleMute,
    toggleCamera,
    requestFullscreen,
  } = useMediaStreams(localStream);
  const [isBlurOn, setIsBlurOn] = useState(false);

  const handleLeave = () => {
    leaveRoom();
    if (onLeave) {
      onLeave();
      return;
    }
    router.push("/");
  };

  const audioMissing = localStream ? localStream.getAudioTracks().length === 0 : false;

  return (
    <div className="flex flex-col min-h-dvh bg-gradient-to-b from-sky-50 via-blue-50 to-sky-100 text-slate-800 pb-[env(safe-area-inset-bottom)]">
      <div className="sticky top-0 z-40 w-full bg-white/80 backdrop-blur border-b border-sky-200">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <Header roomId={roomId} userCount={userCount} onLeave={handleLeave} />
        </div>
      </div>

      <main className="relative flex-1 flex items-center justify-center w-full mx-auto p-4 sm:p-6 pb-28 sm:pb-6">
          <div className="w-full max-w-6xl">
            {(mediaError || !localStream || audioMissing) && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-semibold">Autorisation caméra / micro requise</p>
                  <p className="text-amber-800">
                    {mediaError ??
                      (connectionWarning ??
                        (audioMissing
                          ? "Le micro n’est pas actif. Autorise l’accès au micro pour partager l’audio."
                          : "Clique pour autoriser la caméra et le micro."))}
                  </p>
                </div>
                <button
                  onClick={() => requestMedia()}
                  disabled={isRequestingMedia}
                  className="
                    inline-flex items-center justify-center
                    rounded-xl bg-amber-600 px-4 py-2
                    text-white font-medium
                    disabled:opacity-60 disabled:cursor-not-allowed
                  "
                >
                  {isRequestingMedia ? "Demande en cours..." : "Autoriser"}
                </button>
                </div>
              </div>
            )}
            {!mediaError && !audioMissing && connectionWarning && (
              <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 shadow-sm">
                {connectionWarning}
              </div>
            )}
          <VideoLayout
            localStream={localStream}
            remoteStreams={remoteStreams}
            isMuted={isMuted}
            cameraOn={cameraOn}
            blurOn={isBlurOn}
            lowBandwidthMode={lowBandwidthMode}
            onToggleLowBandwidth={toggleLowBandwidth}
          />
        </div>

        <VideoControls
          isMuted={isMuted}
          cameraOn={cameraOn}
          onToggleMute={toggleMute}
          onToggleCamera={toggleCamera}
          onFullscreen={requestFullscreen}
          onLeave={handleLeave}
          isBlurOn={isBlurOn}
          onToggleBlur={() => setIsBlurOn((v) => !v)}
          lowBandwidthMode={lowBandwidthMode}
          onToggleLowBandwidth={toggleLowBandwidth}
        />
      </main>

      <Footer />
    </div>
  );
}
