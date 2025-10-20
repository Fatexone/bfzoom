"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { socket } from "@/lib/socket";

/* ---------------------------- Types ---------------------------- */
interface OfferPayload {
  roomId: string;
  offer: RTCSessionDescriptionInit;
}

interface AnswerPayload {
  roomId: string;
  answer: RTCSessionDescriptionInit;
}

interface CandidatePayload {
  roomId: string;
  candidate: RTCIceCandidateInit;
}

interface RoomUsersPayload {
  count: number;
}

/* ---------------------------- Hook principal ---------------------------- */
export function useWebRTC(roomId: string, onClose: () => void) {
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const rtcConfigRef = useRef<RTCConfiguration>({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: [
          "turn:global.relay.metered.ca:80",
          "turns:global.relay.metered.ca:443",
        ],
        username: "openai",
        credential: "openai123",
      },
    ],
  });

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [userCount, setUserCount] = useState(1);
  const [connected, setConnected] = useState(false);
  const [otherUserConnected, setOtherUserConnected] = useState(false);

  // ✅ Helper logs 100% compatibles ESLint (pas de any)
  const log = (label: string, ...data: unknown[]) =>
    console.log(`%c[WebRTC] ${label}`, "color:#0ff;font-weight:600", ...data);

  /* =======================================================
     🔌 Connexion Socket.IO + gestion de la room
  ======================================================= */
  useEffect(() => {
    const handleConnect = () => {
      log("✅ Socket connectée :", socket?.id);
      setConnected(true);
      socket.emit("join-room", roomId);
      log("📨 join-room émis", { roomId });
    };

    const handleDisconnect = () => {
      log("⚠️ Socket déconnectée");
      setConnected(false);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [roomId]);

  /* =======================================================
     🎥 Initialisation WebRTC et Signaling
  ======================================================= */
  useEffect(() => {
    let isMounted = true;

    const initWebRTC = async () => {
      try {
        log("🚀 Init RTCPeerConnection avec config", rtcConfigRef.current);
        const pc = new RTCPeerConnection(rtcConfigRef.current);
        peerConnectionRef.current = pc;

        // États & debug
        pc.onconnectionstatechange = () => log("🔗 pc.connectionState →", pc.connectionState);
        pc.onsignalingstatechange = () => log("🧭 pc.signalingState →", pc.signalingState);
        pc.onicegatheringstatechange = () => log("🧊 pc.iceGatheringState →", pc.iceGatheringState);
        pc.oniceconnectionstatechange = () => log("🧊 pc.iceConnectionState →", pc.iceConnectionState);

        // ✅ Capture du flux local (Safari-safe)
        let local: MediaStream | null = null;
        try {
          local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          log("🎥 getUserMedia OK (audio+video)");
        } catch (e1: unknown) {
          log("⚠️ getUserMedia audio+video a échoué, retry vidéo seule", e1);
          try {
            local = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            log("🎥 getUserMedia OK (vidéo seule)");
          } catch (e2: unknown) {
            console.error("❌ getUserMedia impossible", e2);
            return;
          }
        }

        if (!isMounted || !local) return;

        localStreamRef.current = local;
        setLocalStream(local);

        // Ajoute les pistes locales
        local.getTracks().forEach((track) => pc.addTrack(track, local));

        // Réception du flux distant
        pc.ontrack = (event) => {
          if (!isMounted) return;
          const [stream] = event.streams;
          log("📡 Flux distant reçu (ontrack)", { tracks: stream?.getTracks()?.length ?? 0 });
          setRemoteStream(stream);
        };

        // Transmission ICE
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            log("❄️ ICE sortante → emit ice-candidate");
            socket.emit("ice-candidate", {
              roomId,
              candidate: event.candidate.toJSON(),
            });
          } else {
            log("🧊 Fin de la collecte ICE (candidate=null)");
          }
        };

        /* ---------------- Écoute des signaux ---------------- */

        // Offre reçue
        const onOffer = async ({ offer }: OfferPayload) => {
          log("📨 offer reçue");
          if (!isMounted || !offer) return;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          log("📌 setRemoteDescription(offer) OK");
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          log("📤 answer créée + setLocalDescription(answer) OK → emit answer");
          socket.emit("answer", { roomId, answer });
        };

        // Réponse reçue
        const onAnswer = async ({ answer }: AnswerPayload) => {
          log("📨 answer reçue");
          if (!isMounted || !answer) return;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          log("📌 setRemoteDescription(answer) OK");
        };

        // ICE candidate reçue
        const onIce = async ({ candidate }: CandidatePayload) => {
          log("📨 ice-candidate reçue");
          if (!isMounted || !candidate) return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            log("✅ addIceCandidate OK");
          } catch (e: unknown) {
            console.error("❌ Erreur addIceCandidate:", e);
          }
        };

        // Nombre d’utilisateurs
        const onRoomUsers = async ({ count }: RoomUsersPayload) => {
          log("👥 room-users →", count);
          if (!isMounted) return;
          setUserCount(count);
          setOtherUserConnected(count > 1);

          // Offre auto quand 2 users (garde-fou 'stable')
          if (count === 2 && pc.signalingState === "stable") {
            try {
              log("🎬 Deux utilisateurs → création de l’offre");
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              log("📤 Offre envoyée → emit offer");
              socket.emit("offer", { roomId, offer });
            } catch (e: unknown) {
              console.error("❌ Erreur création offre:", e);
            }
          } else {
            log("⏳ Pas d'offre (count != 2 ou signaling != stable)", {
              count,
              signalingState: pc.signalingState,
            });
          }
        };

        const onUserJoined = () => log("👤 user-joined");

        socket.on("offer", onOffer);
        socket.on("answer", onAnswer);
        socket.on("ice-candidate", onIce);
        socket.on("room-users", onRoomUsers);
        socket.on("user-joined", onUserJoined);
      } catch (e: unknown) {
        console.error("❌ Erreur init WebRTC:", e);
      }
    };

    initWebRTC();

    /* ---------------- Cleanup complet ---------------- */
    return () => {
      isMounted = false;
      try {
        log("🧹 Cleanup : emit leave-room");
        socket.emit("leave-room", roomId);

        socket.off("offer");
        socket.off("answer");
        socket.off("ice-candidate");
        socket.off("room-users");
        socket.off("user-joined");

        const pc = peerConnectionRef.current;
        if (pc) {
          pc.getSenders().forEach((s) => s.track?.stop?.());
          pc.close();
          log("🔻 RTCPeerConnection fermé");
        }

        peerConnectionRef.current = null;

        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        setLocalStream(null);
        setRemoteStream(null);
      } catch (e: unknown) {
        console.warn("⚠️ Erreur cleanup WebRTC:", e);
      }
    };
  }, [roomId]);

  /* =======================================================
     ❌ Quitter proprement la session
  ======================================================= */
  const leaveRoom = useCallback(() => {
    try {
      log("🚪 leaveRoom()");
      socket.emit("leave-room", roomId);

      const pc = peerConnectionRef.current;
      if (pc) {
        pc.getSenders().forEach((s) => s.track?.stop?.());
        pc.close();
        log("🔻 RTCPeerConnection fermé (leaveRoom)");
      }

      peerConnectionRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setRemoteStream(null);
      onClose?.();
    } catch (e: unknown) {
      console.warn("⚠️ Erreur leaveRoom:", e);
    }
  }, [roomId, onClose]);

  /* =======================================================
     📦 Valeurs retournées
  ======================================================= */
  return {
    localStream,
    remoteStream,
    userCount,
    connected,
    otherUserConnected,
    leaveRoom,
  };
}
