"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import VideoStream from "@/components/video/VideoStream";
import VideoEffects from "@/components/video/VideoEffects";
import OpenAIEspace from "@/components/video/OpenAIEspace";
import Timer from "@/components/video/Timer";
import ExerciseMenu from "@/components/video/ExerciseMenu";
import { socket } from "@/lib/socket";

/* ------------------ Types ------------------ */
interface VideoCallProps {
  roomId: string;
  isPremium: boolean;
  onClose: () => void;
}

type OfferPayload = { roomId: string; offer?: RTCSessionDescriptionInit; sdp?: RTCSessionDescriptionInit };
type AnswerPayload = { roomId: string; answer?: RTCSessionDescriptionInit; sdp?: RTCSessionDescriptionInit };
type CandidatePayload = { roomId: string; candidate?: RTCIceCandidateInit };
type RoomUsersPayload = { count: number };

export default function VideoCall({ roomId, isPremium, onClose }: VideoCallProps) {
  const [videoEffect, setVideoEffect] = useState<"none" | string>("none");
  const [isMuted, setIsMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const [fullScreen, setFullScreen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [otherUserConnected, setOtherUserConnected] = useState(false);
  const [waitingMessage, setWaitingMessage] = useState("🔄 En attente d’un interlocuteur...");
  const [userCount, setUserCount] = useState(1);

  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  /* =======================================================
     🔌 Connexion Socket.io + room
  ======================================================= */
  useEffect(() => {
    socket.emit("join-room", roomId);

    const onConnect = () => {
      setConnected(true);
      socket.emit?.("who-in-room", roomId);
    };
    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [roomId]);

  /* =======================================================
     🎥 Capture du flux local (cleanup sûr)
  ======================================================= */
  useEffect(() => {
    let isMounted = true;
    let stream: MediaStream | null = null;

    const setup = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
      } catch (e) {
        console.error("getUserMedia error:", e);
      }
    };

    setup();

    return () => {
      isMounted = false;
      stream?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, []);

  /* =======================================================
     🎚️ Mute / Caméra
  ======================================================= */
  useEffect(() => {
    const s = localStreamRef.current;
    if (s) s.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  }, [isMuted]);

  useEffect(() => {
    const s = localStreamRef.current;
    if (s) s.getVideoTracks().forEach((t) => (t.enabled = cameraOn));
  }, [cameraOn]);

  /* =======================================================
     🤝 WebRTC + Signalisation (double compat: candidate / ice-candidate)
  ======================================================= */
  useEffect(() => {
    // RTCPeerConnection
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    peerConnectionRef.current = pc;

    // ICE sortant -> serveur (on émet 2 noms d’événements pour compat)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const payload: CandidatePayload = { roomId, candidate: event.candidate.toJSON() };
        socket.emit("candidate", payload);
        socket.emit("ice-candidate", payload);
      }
    };

    // Tracks distants
    pc.ontrack = (event) => {
      if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
      remoteStreamRef.current.addTrack(event.track);

      const remoteEl = remoteVideoRef.current;
      if (remoteEl) remoteEl.srcObject = remoteStreamRef.current;
    };

    // Ajout des tracks locaux (évite doublons en hot reload)
    const addLocalTracks = () => {
      const ls = localStreamRef.current;
      if (!ls) return;
      const existing = new Set(pc.getSenders().map((sd) => sd.track?.id).filter(Boolean) as string[]);
      ls.getTracks().forEach((track) => {
        if (!existing.has(track.id)) pc.addTrack(track, ls);
      });
    };

    // Quand un utilisateur rejoint (déclenché côté serveur)
    const onUserJoined = async () => {
      setOtherUserConnected(true);
      setWaitingMessage("✅ Connexion établie, visio en cours...");

      addLocalTracks();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Compat: offer ou sdp
      socket.emit("offer", { roomId, offer });
      socket.emit("offer", { roomId, sdp: pc.localDescription });
    };

    // Reçoit une offre
    const onOffer = async ({ offer, sdp }: OfferPayload) => {
      const remoteSDP = offer ?? sdp;
      if (!remoteSDP) return;

      setOtherUserConnected(true);
      setWaitingMessage("✅ Connexion établie, visio en cours...");
      await pc.setRemoteDescription(remoteSDP);

      addLocalTracks();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer", { roomId, answer });
      socket.emit("answer", { roomId, sdp: pc.localDescription });
    };

    // Reçoit une réponse
    const onAnswer = async ({ answer, sdp }: AnswerPayload) => {
      const remoteSDP = answer ?? sdp;
      if (!remoteSDP) return;
      await pc.setRemoteDescription(remoteSDP);
    };

    // Reçoit un ICE candidate (deux noms possibles)
    const onCandidate = async ({ candidate }: CandidatePayload) => {
      if (!candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("addIceCandidate error:", err);
      }
    };

    const onUserLeft = () => {
      setOtherUserConnected(false);
      setWaitingMessage("👤 L’interlocuteur a quitté la séance.");
    };

    const onRoomUsers = ({ count }: RoomUsersPayload) => {
      setUserCount(count);
      if (count > 1) {
        setOtherUserConnected(true);
        setWaitingMessage("✅ Connexion établie, visio en cours...");
      } else {
        setOtherUserConnected(false);
        setWaitingMessage("🔄 En attente d’un interlocuteur...");
      }
    };

    // Bindings socket
    socket.on("user-joined", onUserJoined);
    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("candidate", onCandidate);
    socket.on("ice-candidate", onCandidate);
    socket.on("user-left", onUserLeft);
    socket.on("room-users", onRoomUsers);

    return () => {
      socket.off("user-joined", onUserJoined);
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("candidate", onCandidate);
      socket.off("ice-candidate", onCandidate);
      socket.off("user-left", onUserLeft);
      socket.off("room-users", onRoomUsers);

      try {
        pc.getSenders().forEach((sd) => sd.track?.stop?.());
      } catch {
        /* no-op */
      }
      pc.close();
      peerConnectionRef.current = null;
    };
  }, [roomId]);

  /* =======================================================
     ❌ Quitter proprement
  ======================================================= */
  const handleLeaveSession = useCallback(() => {
    // couper médias locaux
    const ls = localStreamRef.current;
    ls?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    // fermer RTCPeerConnection
    const pc = peerConnectionRef.current;
    if (pc) {
      try {
        pc.getSenders().forEach((sd) => sd.track?.stop?.());
      } catch {
        /* no-op */
      }
      pc.close();
      peerConnectionRef.current = null;
    }

    // informer le serveur
    socket.emit("leave-room", roomId);

    setCameraOn(false);
    onClose();
  }, [onClose, roomId]);

  /* =======================================================
     🧰 Sécurité : auto-cleanup quand on cache l’onglet / quitte
  ======================================================= */
  useEffect(() => {
    const onVisibility = () => {
      // Optionnel : couper caméra si onglet caché
      // if (document.hidden) setCameraOn(false);
    };
    const onBeforeUnload = () => {
      socket.emit("leave-room", roomId);
      const ls = localStreamRef.current;
      ls?.getTracks().forEach((t) => t.stop());
    };

    window.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [roomId]);

  /* =======================================================
     ⛶ Plein écran
  ======================================================= */
  const toggleFullScreen = useCallback(() => {
    const el = videoContainerRef.current;
    if (!el) return;

    // @ts-expect-error: webkit vendor
    const webkitRq = el.webkitRequestFullscreen || el.webkitEnterFullscreen;
    // @ts-expect-error: webkit vendor
    const webkitExit = document.webkitExitFullscreen;

    if (!document.fullscreenElement) {
      if (el.requestFullscreen) el.requestFullscreen().then(() => setFullScreen(true)).catch(() => {});
      else if (webkitRq) {
        try {
          webkitRq.call(el);
          setFullScreen(true);
        } catch {}
      }
    } else {
      if (document.exitFullscreen) document.exitFullscreen().then(() => setFullScreen(false)).catch(() => {});
      else if (webkitExit) {
        try {
          webkitExit.call(document);
          setFullScreen(false);
        } catch {}
      }
    }
  }, []);

  /* =======================================================
     🎨 UI
  ======================================================= */
  return (
    <div
      ref={videoContainerRef}
      className="absolute inset-0 flex flex-col justify-between items-center bg-gradient-to-b from-gray-900 via-black to-gray-800 text-white overflow-hidden"
    >
      {/* HEADER */}
      <header className="w-full flex justify-between items-center px-6 py-4 bg-black/40 backdrop-blur-md border-b border-white/10">
        <div>
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight">
            🔴 Séance en direct — <span className="text-blue-400">{roomId}</span>
          </h2>
          <p className="text-xs sm:text-sm text-gray-300">
            {connected ? "🟢 Connecté" : "Connexion..."}
          </p>
          <p className="text-sm text-gray-400 mt-1">
            👥 {userCount} {userCount > 1 ? "participants connectés" : "participant connecté"}
          </p>
        </div>

        <button
          onClick={handleLeaveSession}
          className="bg-red-600 hover:bg-red-700 transition text-sm sm:text-base px-4 py-2 rounded-lg font-semibold shadow-lg"
        >
          ❌ Quitter
        </button>
      </header>

      {/* ZONE VIDÉO */}
      <main className="flex-1 flex flex-col items-center justify-center w-full px-4 sm:px-8 py-4 gap-4 relative">
        {!otherUserConnected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white text-center p-6 z-10">
            <div className="flex items-center justify-center gap-3 animate-pulse">
              <span className="text-2xl">👤</span>
              <p className="text-lg sm:text-2xl font-semibold">{waitingMessage}</p>
            </div>
            <p className="text-sm text-gray-400 mt-3">
              Participants : <span className="text-blue-400 font-mono">{userCount}</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">Code salle : {roomId}</p>
          </div>
        )}

        {/* Vidéo locale */}
        <div className="relative w-full max-w-5xl aspect-video rounded-2xl overflow-hidden shadow-xl border border-white/10 bg-black">
          <VideoStream
            videoEffect={videoEffect}
            isMuted={isMuted}
            cameraOn={cameraOn}
            externalStream={localStreamRef.current ?? undefined}
          />
        </div>

        {/* Vidéo distante */}
        <div className="relative w-full max-w-5xl aspect-video rounded-2xl overflow-hidden shadow-xl border border-white/10 bg-black">
          <video
            ref={remoteVideoRef}
            id="remoteVideo"
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        </div>

        {/* Effets (BodyPix) */}
        <div className="mt-2 sm:mt-4">
          <VideoEffects videoEffect={videoEffect} setVideoEffect={setVideoEffect} />
        </div>
      </main>

      {/* COMMANDES */}
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50">
        <div className="flex flex-wrap justify-center gap-3 px-4 py-3 bg-black/55 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
          {/* 🎙️ Micro */}
          <button
            onClick={() => setIsMuted((prev) => !prev)}
            className={`px-5 py-2.5 rounded-full font-semibold transition flex items-center gap-2 shadow-md ${
              isMuted ? "bg-red-600 hover:bg-red-700" : "bg-gray-700 hover:bg-gray-600"
            }`}
            aria-pressed={isMuted}
          >
            {isMuted ? "🔇 Micro OFF" : "🎤 Micro ON"}
          </button>

          {/* 🎥 Caméra */}
          <button
            onClick={() => {
              const ls = localStreamRef.current;
              if (!ls) return;
              const videoTracks = ls.getVideoTracks();
              if (videoTracks.length > 0) {
                const current = videoTracks[0].enabled;
                videoTracks.forEach((t) => (t.enabled = !current));
                setCameraOn(!current);
              }
            }}
            className={`px-5 py-2.5 rounded-full font-semibold transition flex items-center gap-2 shadow-md ${
              cameraOn ? "bg-gray-700 hover:bg-gray-600" : "bg-red-600 hover:bg-red-700"
            }`}
            aria-pressed={!cameraOn}
          >
            {cameraOn ? "🎥 Caméra ON" : "🚫 Caméra OFF"}
          </button>

          {/* ⛶ Plein écran */}
          <button
            onClick={toggleFullScreen}
            className="px-5 py-2.5 rounded-full font-semibold bg-blue-600 hover:bg-blue-700 transition flex items-center gap-2 shadow-md"
            aria-pressed={fullScreen}
          >
            {fullScreen ? "🗗 Quitter plein écran" : "🗖 Plein écran"}
          </button>
        </div>
      </div>

      {/* PREMIUM */}
      {isPremium && (
        <div className="w-full max-w-4xl flex flex-col md:flex-row justify-center items-center gap-6 px-4 py-6 bg-black/40 backdrop-blur-md border-t border-white/10">
          <div className="flex-1 flex justify-center">
            <Timer />
          </div>
          <div className="flex-1 flex justify-center">
            <OpenAIEspace />
          </div>
        </div>
      )}

      {/* Footer exercices */}
      <footer className="w-full fixed bottom-0 left-0">
        <ExerciseMenu />
      </footer>
    </div>
  );
}
