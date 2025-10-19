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
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [userCount, setUserCount] = useState(1);
  const [connected, setConnected] = useState(false);
  const [otherUserConnected, setOtherUserConnected] = useState(false);

  /* =======================================================
     🔌 Connexion Socket.io + gestion de la room
  ======================================================= */
  useEffect(() => {
    const handleConnect = () => {
      console.log("✅ Socket connecté au serveur :", socket.id);
      setConnected(true);
      socket.emit("join-room", roomId);
    };

    const handleDisconnect = () => {
      console.warn("🔌 Socket déconnecté");
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

    const configuration: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    const initWebRTC = async () => {
      try {
        const pc = new RTCPeerConnection(configuration);
        peerConnectionRef.current = pc;

        // 🎥 Capture du flux local
        const local = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!isMounted) return;

        localStreamRef.current = local;
        setLocalStream(local);

        // Ajout des pistes locales
        local.getTracks().forEach((track) => pc.addTrack(track, local));

        // Réception du flux distant
        pc.ontrack = (event) => {
          if (!isMounted) return;
          const [stream] = event.streams;
          console.log("📡 Flux distant reçu");
          setRemoteStream(stream);
        };

        // Transmission des ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("ice-candidate", {
              roomId,
              candidate: event.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          console.log("🔗 WebRTC state:", pc.connectionState);
        };

        /* ---------------- Écoute des signaux ---------------- */

        // 📨 Offre reçue
        socket.on("offer", async ({ offer }: OfferPayload) => {
          console.log("📨 Offre reçue");
          if (!offer || !isMounted) return;
          if (pc.signalingState === "closed") return;

          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("answer", { roomId, answer });
        });

        // 📨 Réponse reçue
        socket.on("answer", async ({ answer }: AnswerPayload) => {
          console.log("📨 Réponse reçue");
          if (!answer || !isMounted) return;
          if (pc.signalingState === "closed") return;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        });

        // ❄️ ICE candidate reçue
        socket.on("ice-candidate", async ({ candidate }: CandidatePayload) => {
          if (!candidate || !isMounted) return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log("❄️ ICE candidate ajoutée");
          } catch (err) {
            console.error("Erreur ajout ICE:", err);
          }
        });

        // 👥 Gestion du nombre d’utilisateurs dans la room
        socket.on("room-users", async ({ count }: RoomUsersPayload) => {
          if (!isMounted) return;
          console.log("👥 Utilisateurs dans la room :", count);
          setUserCount(count);
          setOtherUserConnected(count > 1);

          // 🚀 Si on est deux et que la connexion est stable => création d’offre
          if (count === 2 && pc.signalingState === "stable") {
            console.log("🧩 Deux utilisateurs détectés — création et envoi de l’offre");
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.emit("offer", { roomId, offer });
            } catch (err) {
              console.error("Erreur lors de la création de l’offre :", err);
            }
          }
        });

        // 👤 Log simple quand un utilisateur rejoint
        socket.on("user-joined", () => {
          console.log("👤 Nouvel utilisateur rejoint la room");
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
        socket.off("ice-candidate");
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
        setLocalStream(null);
        setRemoteStream(null);
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
      setLocalStream(null);
      setRemoteStream(null);
      onClose?.();
    } catch (err) {
      console.warn("Erreur leaveRoom:", err);
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
