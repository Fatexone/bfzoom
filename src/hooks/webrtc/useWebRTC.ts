"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { socket } from "@/lib/socket";
import { initSocketRoomHandlers } from "./socketRoomManager";
import { createPeerConnection, cleanupPeerConnection } from "./connectionManager";
import { attachSignalingHandlers } from "./signalingHandlers";

/**
 * Hook principal : gestion WebRTC + Socket.IO + cleanup
 * Version corrigée avec flag isPolite (perfect negotiation)
 */
export function useWebRTC(roomId: string, onClose: () => void) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [connected, setConnected] = useState(false);
  const [otherUserConnected, setOtherUserConnected] = useState(false);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  const log = (label: string, ...data: unknown[]) =>
    console.log(`%c[WebRTC] ${label}`, "color:#00ffff;font-weight:600", ...data);

  /* =======================================================
     🎬 INITIALISATION complète (Room + RTC + Signaling)
  ======================================================= */
  useEffect(() => {
    let isMounted = true;

    const rtcConfig: RTCConfiguration = {
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
    };

    /* --- Socket room handlers --- */
    const detachRoomHandlers = initSocketRoomHandlers(
      roomId,
      setIsCreator,
      setUserCount,
      setOtherUserConnected,
      log
    );

    /* --- Création de la connexion WebRTC --- */
    const pc = createPeerConnection(
      rtcConfig,
      (stream) => {
        if (isMounted) setRemoteStream(stream);
      },
      log
    );

    peerConnectionRef.current = pc;

    /* =======================================================
       🔄 Détermination du rôle “polite” (évite les collisions SDP)
    ======================================================= */
    // Si l’utilisateur est le créateur de la salle → non-polite (il initie)
    // Si c’est l’invité (non-créateur) → polite = true
    const isPolite = !isCreator;

    /* --- Attachement des handlers de signaling --- */
    const detachSignaling = attachSignalingHandlers(pc, roomId, log, isPolite);

    /* --- Capture du flux local --- */
    (async () => {
      try {
        const local = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!isMounted) return;
        setLocalStream(local);
        local.getTracks().forEach((t) => pc.addTrack(t, local));
        log("🎥 getUserMedia OK (audio+video)");
      } catch (err) {
        log("⚠️ getUserMedia échoué, tentative fallback vidéo seule :", err);
        try {
          const fallback = await navigator.mediaDevices.getUserMedia({ video: true });
          if (isMounted) {
            setLocalStream(fallback);
            fallback.getTracks().forEach((t) => pc.addTrack(t, fallback));
            log("🎥 getUserMedia OK (vidéo seule)");
          }
        } catch (e2) {
          console.error("❌ Impossible d’accéder à la caméra/micro :", e2);
        }
      }
    })();

    /* --- État Socket.IO --- */
    const handleConnect = () => {
      setConnected(true);
      log("✅ Socket.IO connectée");
    };

    const handleDisconnect = (reason: string) => {
      setConnected(false);
      log("⚠️ Socket déconnectée :", reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    /* --- Cleanup complet --- */
    return () => {
      isMounted = false;

      log("🧹 Cleanup : fermeture room + peer connection");

      // 1️⃣ Supprimer handlers WebRTC
      detachSignaling();

      // 2️⃣ Supprimer handlers Socket.IO liés à la room
      detachRoomHandlers();

      // 3️⃣ Fermer connexion WebRTC
      cleanupPeerConnection(peerConnectionRef.current, log);

      // 4️⃣ Quitter la room côté serveur
      socket.emit("leave-room", roomId);

      // 5️⃣ Nettoyer listeners socket globaux
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);

      // 6️⃣ Nettoyage d’état React
      setLocalStream(null);
      setRemoteStream(null);
      peerConnectionRef.current = null;
    };
  }, [roomId, isCreator]); // ← important : relancer si créateur change

  /* =======================================================
     🚪 Quitter proprement la session
  ======================================================= */
  const leaveRoom = useCallback(() => {
    log("🚪 leaveRoom() manuel appelé");
    cleanupPeerConnection(peerConnectionRef.current, log);
    socket.emit("leave-room", roomId);
    onClose?.();
  }, [roomId, onClose]);

  /* =======================================================
     📦 Valeurs retournées
  ======================================================= */
  return {
    localStream,
    remoteStream,
    isCreator,
    userCount,
    connected,
    otherUserConnected,
    leaveRoom,
  };
}
