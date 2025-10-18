// src/components/video/VideoCall/useWebRTC.ts
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
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [userCount, setUserCount] = useState(1);
  const [connected, setConnected] = useState(false);
  const [otherUserConnected, setOtherUserConnected] = useState(false);

  /* =======================================================
     🔌 Connexion Socket.io + gestion de la room
  ======================================================= */
  useEffect(() => {
    socket.emit("join-room", roomId);
    const handleConnect = () => {
      setConnected(true);
      socket.emit("who-in-room", roomId);
    };
    const handleDisconnect = () => setConnected(false);
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
    const configuration: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    const initWebRTC = async () => {
      try {
        // ⚙️ Création RTCPeerConnection
        const pc = new RTCPeerConnection(configuration);
        peerConnectionRef.current = pc;

        // 🎥 Capture locale
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!isMounted) return;
        localStreamRef.current = localStream;

        // ✅ Ajout des pistes locales (vérifie que le peer est encore ouvert)
        if (pc.signalingState !== "closed") {
          localStream.getTracks().forEach((track) => {
            try {
              pc.addTrack(track, localStream);
            } catch (err) {
              console.warn("⚠️ addTrack ignoré :", err);
            }
          });
        }

        // 🎧 Réception des pistes distantes
        pc.ontrack = (event) => {
          if (!isMounted) return;
          const [stream] = event.streams;
          setRemoteStream(stream);
        };

        // ❄️ Envoi des ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("candidate", {
              roomId,
              candidate: event.candidate.toJSON(),
            });
          }
        };

        /* ---------------- Écoute des signaux ---------------- */
        socket.on("offer", async ({ offer }: OfferPayload) => {
          if (!offer || !isMounted) return;
          if (pc.signalingState === "closed") return;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("answer", { roomId, answer });
        });

        socket.on("answer", async ({ answer }: AnswerPayload) => {
          if (!answer || !isMounted) return;
          if (pc.signalingState === "closed") return;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        });

        socket.on("candidate", async ({ candidate }: CandidatePayload) => {
          if (!candidate || !isMounted) return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error("Erreur ICE:", err);
          }
        });

        socket.on("room-users", ({ count }: RoomUsersPayload) => {
          if (!isMounted) return;
          setUserCount(count);
          setOtherUserConnected(count > 1);
        });

        socket.on("user-joined", async () => {
          if (!isMounted || pc.signalingState === "closed") return;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("offer", { roomId, offer });
        });
      } catch (error) {
        console.error("Erreur init WebRTC:", error);
      }
    };

    initWebRTC();

    /* ---------------- Cleanup complet ---------------- */
    return () => {
      isMounted = false;
      try {
        socket.emit("leave-room", roomId);
        socket.off("offer");
        socket.off("answer");
        socket.off("candidate");
        socket.off("room-users");
        socket.off("user-joined");

        const pc = peerConnectionRef.current;
        if (pc && pc.signalingState !== "closed") {
          pc.getSenders().forEach((s) => s.track?.stop?.());
          pc.close();
        }
        peerConnectionRef.current = null;

        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      } catch (err) {
        console.warn("Erreur cleanup WebRTC:", err);
      }
    };
  }, [roomId]);

  /* =======================================================
     ❌ Quitter proprement la session
  ======================================================= */
  const leaveRoom = useCallback(() => {
    try {
      socket.emit("leave-room", roomId);
      const pc = peerConnectionRef.current;
      if (pc && pc.signalingState !== "closed") {
        pc.getSenders().forEach((sd) => sd.track?.stop?.());
        pc.close();
      }
      peerConnectionRef.current = null;

      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      onClose?.();
    } catch (err) {
      console.warn("Erreur leaveRoom:", err);
    }
  }, [roomId, onClose]);

  /* =======================================================
     📦 Valeurs retournées
  ======================================================= */
  return {
    localStream: localStreamRef.current,
    remoteStream,
    userCount,
    connected,
    otherUserConnected,
    leaveRoom,
  };
}
