"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import BlurredVideo from "./BlurredVideo";

export interface VideoLayoutProps {
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  isMuted: boolean;
  cameraOn: boolean;
  blurOn?: boolean;
}

const LOCAL_STREAM_ID = "local-self";

export default function VideoLayout({
  localStream,
  remoteStreams,
  isMuted,
  cameraOn,
  blurOn = false,
}: VideoLayoutProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [needsAudioUnlock, setNeedsAudioUnlock] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  const attachLocalVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (!el || !localStream) return;
      el.srcObject = localStream;
      el.muted = true;
      el.playsInline = true;
      el.setAttribute("webkit-playsinline", "true");
      (async () => {
        try {
          await el.play();
        } catch (err) {
          console.warn("⚠️ Lecture flux local bloquée :", err);
        }
      })();
    },
    [localStream]
  );

  const renderLocalPreview = (className: string) => {
    if (blurOn) {
      return (
        <BlurredVideo
          stream={localStream}
          className={className}
          mirrored
          backgroundBlurAmount={10}
          edgeBlurAmount={4}
        />
      );
    }

    return (
      <video
        ref={attachLocalVideo}
        autoPlay
        playsInline
        muted
        disablePictureInPicture
        className={className}
        style={{ transform: "scaleX(-1)" }}
      />
    );
  };

  /* Flux local (au cas où le ref change quand un participant arrive) */
  useEffect(() => {
    if (localVideoRef.current) {
      attachLocalVideo(localVideoRef.current);
    }
  }, [localStream, attachLocalVideo]);

  /* Flux distants */
  const tryPlayRemotes = useCallback(async () => {
    let blocked = false;
    for (const [id, stream] of Object.entries(remoteStreams)) {
      const videoEl = remoteRefs.current[id];
      if (!videoEl) continue;
      if (videoEl.srcObject !== stream) videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.setAttribute("webkit-playsinline", "true");
      videoEl.muted = !audioUnlocked;
      videoEl.volume = audioUnlocked ? 1 : 0;
      try {
        if (videoEl.paused) await videoEl.play();
      } catch (err) {
        blocked = true;
        console.warn(`⚠️ Lecture flux distant ${id} bloquée :`, err);
      }
    }
    setNeedsAudioUnlock(blocked);
  }, [remoteStreams, audioUnlocked]);

  useEffect(() => {
    queueMicrotask(() => {
      void tryPlayRemotes();
    });
  }, [tryPlayRemotes]);

  /* Items (local + distants) */
  type StreamItem = {
    id: string;
    label: string;
    muted: boolean;
    hasVideo: boolean;
    isLocal?: boolean;
    stream?: MediaStream;
    renderRef?: React.Ref<HTMLVideoElement>; // ✅ accepte RefObject OU callback
  };

  const remoteIds = Object.keys(remoteStreams);
  const hasRemote = remoteIds.length > 0;

  const layoutStreams: StreamItem[] = [
    ...(localStream
      ? [
          {
            id: LOCAL_STREAM_ID,
            label: "Vous",
            muted: true,
            hasVideo: cameraOn && localStream.getVideoTracks().length > 0,
            isLocal: true,
            stream: localStream,
          },
        ]
      : []),
    ...remoteIds.map((id) => {
      const stream = remoteStreams[id];
      const hasVideo =
        stream?.getVideoTracks().some((track) => track.enabled) ?? false;
      return {
        id,
        label: `Participant ${id.slice(0, 5)}`,
        muted: !audioUnlocked,
        hasVideo,
        stream,
        renderRef: (el: HTMLVideoElement | null) => {
          remoteRefs.current[id] = el;
          if (!el) return;
          const source = remoteStreams[id];
          if (source && el.srcObject !== source) {
            el.srcObject = source;
          }
          el.playsInline = true;
          el.setAttribute("webkit-playsinline", "true");
          el.muted = !audioUnlocked;
          el.volume = audioUnlocked ? 1 : 0;
          void el
            .play()
            .then(() => setNeedsAudioUnlock(false))
            .catch(() => setNeedsAudioUnlock(true));
        },
      };
    }),
  ];

  const activeColumns = Math.max(
    1,
    Math.min(4, Math.ceil(Math.sqrt(Math.max(1, layoutStreams.length))))
  );
  const gridStyle = {
    gridTemplateColumns: `repeat(${activeColumns}, minmax(0, 1fr))`,
  };

  return (
    <div
      className={`
        relative w-full h-full bg-slate-100 
        grid gap-3 p-2 sm:p-3
        rounded-2xl border border-slate-200 shadow-md
        auto-rows-[minmax(0,1fr)] min-h-dvh
      `}
      style={gridStyle}
    >
      {layoutStreams.map((stream) => {
        const videoReady = stream.hasVideo && Boolean(stream.stream);
        return (
          <div
            key={stream.id}
            className="relative flex items-center justify-center rounded-2xl overflow-hidden bg-black aspect-video sm:aspect-[4/3] md:aspect-[16/9]"
          >
            {stream.isLocal ? (
              stream.hasVideo ? (
                renderLocalPreview("w-full h-full object-cover rounded-2xl")
              ) : (
                <div className="text-slate-400 text-sm select-none">
                  🚫 Caméra désactivée
                </div>
              )
            ) : videoReady ? (
              <video
                ref={stream.renderRef}
                autoPlay
                playsInline
                muted={stream.muted}
                disablePictureInPicture
                className="w-full h-full object-cover rounded-2xl"
              />
            ) : (
              <div className="text-slate-400 text-sm select-none">
                🚫 Caméra désactivée
              </div>
            )}
            <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md select-none">
              {stream.label}
            </div>
          </div>
        );
      })}

      {hasRemote && (!audioUnlocked || needsAudioUnlock) && (
        <div className="absolute inset-x-0 bottom-6 flex items-center justify-center">
          <button
            onClick={() => {
              setAudioUnlocked(true);
              void tryPlayRemotes();
            }}
            className="px-4 py-2 rounded-full bg-white/90 text-slate-900 text-sm font-semibold shadow-lg border border-slate-200"
          >
            Activer le son
          </button>
        </div>
      )}

      {!hasRemote && (
        <div className="absolute inset-x-0 bottom-4 text-center text-slate-500 text-sm">
          En attente d’autres participants…
        </div>
      )}
    </div>
  );
}