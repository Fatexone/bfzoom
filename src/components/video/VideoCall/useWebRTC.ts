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

  /* =======================================================
     🔌 Connexion Socket.IO + gestion de la room
  ======================================================= */
  useEffect(() => {
    const handleConnect = () => {
      console.log("✅ Socket connecté :", socket.id);
      setConnected(true);
      socket.emit("join-room", roomId);
    };

    const handleDisconnect = () => {
      console.warn("⚠️ Socket déconnecté");
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
        const pc = new RTCPeerConnection(rtcConfigRef.current);
        peerConnectionRef.current = pc;

        // ✅ Capture du flux local (Safari-safe)
        let local: MediaStream | null = null;
        try {
          local = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
        } catch {
          // fallback sans audio
          local = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
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
          console.log("📡 Flux distant reçu");
          setRemoteStream(stream);
        };

        // Transmission ICE
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("ice-candidate", {
              roomId,
              candidate: event.candidate.toJSON(),
            });
          }
        };

        pc.onconnectionstatechange = () => {
          console.log("🔗 WebRTC:", pc.connectionState);
        };

        /* ---------------- Écoute des signaux ---------------- */

        // Offre reçue
        socket.on("offer", async ({ offer }: OfferPayload) => {
          if (!isMounted || !offer) return;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("answer", { roomId, answer });
        });

        // Réponse reçue
        socket.on("answer", async ({ answer }: AnswerPayload) => {
          if (!isMounted || !answer) return;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        });

        // ICE candidate reçue
        socket.on("ice-candidate", async ({ candidate }: CandidatePayload) => {
          if (!isMounted || !candidate) return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            console.error("Erreur ICE:", err);
          }
        });

        // Nombre d’utilisateurs
        socket.on("room-users", async ({ count }: RoomUsersPayload) => {
          if (!isMounted) return;
          setUserCount(count);
          setOtherUserConnected(count > 1);

          // Offre auto quand 2 users
          if (count === 2 && pc.signalingState === "stable") {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket.emit("offer", { roomId, offer });
            } catch (err) {
              console.error("Erreur création offre:", err);
            }
          }
        });

        socket.on("user-joined", () =>
          console.log("👤 Nouvel utilisateur rejoint la room")
        );
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
        ["offer", "answer", "ice-candidate", "room-users", "user-joined"].forEach((e) =>
          socket.off(e)
        );

        const pc = peerConnectionRef.current;
        if (pc) {
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
      if (pc) {
        pc.getSenders().forEach((s) => s.track?.stop?.());
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
