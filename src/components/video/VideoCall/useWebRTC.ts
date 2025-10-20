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

  // Rôle + protections contre les re-runs & conditions de course
  const [isCreator, setIsCreator] = useState(false);
  const isCreatorRef = useRef(false);
  const offerMadeRef = useRef(false); // anti-doublons d’offre

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

  // ✅ Helper logs
  const log = (label: string, ...data: unknown[]) =>
    console.log(`%c[WebRTC] ${label}`, "color:#0ff;font-weight:600", ...data);

  /* =======================================================
     🔌 Connexion Socket.IO + join room
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
     🎭 Rôle créateur / invité (ne recrée pas le PC)
  ======================================================= */
  useEffect(() => {
    const onRole = ({ isCreator }: { isCreator: boolean }) => {
      setIsCreator(isCreator);
      isCreatorRef.current = isCreator; // évite la stale closure
      log("🎭 Rôle attribué :", isCreator ? "Créateur" : "Invité");
    };

    socket.on("room-role", onRole);
    return () => {
      socket.off("room-role", onRole);
    };
  }, []);

  /* =======================================================
     🎥 Initialisation WebRTC et Signaling
     ⚠️ IMPORTANT: ne dépend QUE de roomId (pas de isCreator)
  ======================================================= */
  useEffect(() => {
    let isMounted = true;
    offerMadeRef.current = false; // réinitialise à chaque nouvelle room

    const initWebRTC = async () => {
      try {
        log("🚀 Init RTCPeerConnection avec config", rtcConfigRef.current);
        const pc = new RTCPeerConnection(rtcConfigRef.current);
        peerConnectionRef.current = pc;

        // États & debug
        pc.onconnectionstatechange = () =>
          log("🔗 pc.connectionState →", pc.connectionState);
        pc.onsignalingstatechange = () =>
          log("🧭 pc.signalingState →", pc.signalingState);
        pc.onicegatheringstatechange = () =>
          log("🧊 pc.iceGatheringState →", pc.iceGatheringState);
        pc.oniceconnectionstatechange = () =>
          log("🧊 pc.iceConnectionState →", pc.iceConnectionState);

        // ✅ Capture du flux local (fallback vidéo seule)
        let local: MediaStream | null = null;
        try {
          local = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          log("🎥 getUserMedia OK (audio+video)");
        } catch (e1: unknown) {
          log("⚠️ getUserMedia audio+video échoué, retry vidéo seule", e1);
          try {
            local = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
            log("🎥 getUserMedia OK (vidéo seule)");
          } catch (e2: unknown) {
            console.error("❌ getUserMedia impossible", e2);
            return;
          }
        }

        if (!isMounted || !local) return;
        localStreamRef.current = local;
        setLocalStream(local);

        // Ajout des pistes locales
        local.getTracks().forEach((track) => pc.addTrack(track, local));

        // Réception du flux distant
        pc.ontrack = (event) => {
          if (!isMounted) return;
          const [stream] = event.streams;
          log("📡 Flux distant reçu", {
            tracks: stream?.getTracks()?.length ?? 0,
          });
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
            log("🧊 Fin de la collecte ICE");
          }
        };

        /* =======================================================
           🔁 Gestion des signaux WebRTC
        ======================================================= */
        const onOffer = async ({ offer }: OfferPayload) => {
          log("📨 Offer reçue");
          if (!isMounted || !offer) return;
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          log("📌 setRemoteDescription(offer) OK");

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          log("📤 Answer créée → emit answer");
          socket.emit("answer", { roomId, answer });
        };

        const onAnswer = async ({ answer }: AnswerPayload) => {
          log("📨 Answer reçue");
          if (!isMounted || !answer) return;
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          log("📌 setRemoteDescription(answer) OK");
        };

        const onIce = async ({ candidate }: CandidatePayload) => {
          log("📨 ICE candidate reçue");
          if (!isMounted || !candidate) return;
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            log("✅ addIceCandidate OK");
          } catch (e: unknown) {
            console.error("❌ Erreur addIceCandidate:", e);
          }
        };

        /* =======================================================
           👥 Gestion du nombre d’utilisateurs
           → Seul le créateur lance l’offre, avec anti-doublons
        ======================================================= */
        const onRoomUsers = async ({ count }: RoomUsersPayload) => {
          log("👥 room-users →", count);
          if (!isMounted) return;

          setUserCount(count);
          setOtherUserConnected(count > 1);

          // Seul le créateur initie l'offre, une seule fois, quand au moins 2 présents
          if (count >= 2 && isCreatorRef.current && !offerMadeRef.current) {
            try {
              // Attente active jusqu’à "stable" pour éviter les courses
              let spin = 0;
              while (pc.signalingState !== "stable" && spin < 50) {
                await new Promise((r) => setTimeout(r, 100));
                spin++;
              }

              log("🎬 Créateur → création de l’offre");
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              offerMadeRef.current = true;
              socket.emit("offer", { roomId, offer });
              log("📤 Offre envoyée");
            } catch (e) {
              console.error("❌ Erreur création offre:", e);
            }
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
        log("🧹 Cleanup : leave-room");
        socket.emit("leave-room", roomId);

        socket.off("offer");
        socket.off("answer");
        socket.off("ice-candidate");
        socket.off("room-users");
        socket.off("user-joined");
        socket.off("room-role"); // important si le composant est démonté

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
        offerMadeRef.current = false;
      } catch (e: unknown) {
        console.warn("⚠️ Erreur cleanup WebRTC:", e);
      }
    };
  }, [roomId]); // ⚠️ ne pas dépendre de isCreator

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
    isCreator, // 👑 utile pour afficher "Vous êtes l'hôte"
    leaveRoom,
  };
}
