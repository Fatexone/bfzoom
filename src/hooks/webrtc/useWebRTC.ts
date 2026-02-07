"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { socket } from "@/lib/socket";
import { initSocketRoomHandlers } from "./socketRoomManager";
import { createPeerConnection, cleanupPeerConnection } from "./connectionManager";

export function useWebRTC(roomId: string, onClose: () => void) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [isCreator, setIsCreator] = useState(false);
  const [userCount, setUserCount] = useState(1);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isRequestingMedia, setIsRequestingMedia] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Références stables
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingIceRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const pcStateRef = useRef<
    Record<
      string,
      {
        makingOffer: boolean;
        ignoreOffer: boolean;
        polite: boolean;
      }
    >
  >({});
  const isMountedRef = useRef(true);

  /* ✅ log mémoïsé (stable, pas de re-déclaration à chaque render) */
  const log = useCallback((label: string, ...data: unknown[]) => {
    console.log(`%c[WebRTC] ${label}`, "color:#00ffff;font-weight:600", ...data);
  }, []);

  const replaceLocalStream = useCallback(
    (next: MediaStream) => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      setLocalStream(next);
      localStreamRef.current = next;
    },
    []
  );

  const attachLocalTracksToPc = useCallback(
    async (pc: RTCPeerConnection, stream: MediaStream) => {
      let changed = false;
      const orderedTracks = [
        ...stream.getAudioTracks(),
        ...stream.getVideoTracks(),
      ];
      for (const track of orderedTracks) {
        let sender = pc.getSenders().find((s) => s.track?.kind === track.kind);
        if (!sender) {
          sender = pc.addTransceiver(track.kind, { direction: "sendrecv" }).sender;
          changed = true;
        }
        if (sender.track?.id !== track.id) {
          await sender.replaceTrack(track);
          changed = true;
        }
      }
      return changed;
    },
    []
  );

  const acquireLocalStream = useCallback(async () => {
    setIsRequestingMedia(true);
    setMediaError(null);
    try {
      const local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      replaceLocalStream(local);
      log("🎥 Flux local prêt (audio+vidéo)");
      return;
    } catch (err) {
      log("⚠️ getUserMedia échoué, fallback vidéo seule :", err);
      setMediaError("Autorisation micro refusée ou indisponible.");
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        replaceLocalStream(fallback);
        log("🎥 Flux local prêt (vidéo seule)");
      } catch (e2) {
        console.error("❌ Impossible d’accéder à la caméra/micro :", e2);
        setMediaError("Autorisation caméra/micro refusée ou indisponible.");
      }
    } finally {
      setIsRequestingMedia(false);
    }
  }, [log, replaceLocalStream]);

  /* ✅ leaveRoom en haut, mémoïsé : réutilisable partout (handlers/cleanup) */
  const leaveRoom = useCallback(() => {
    log("🚪 leaveRoom() manuel / global");
    for (const id in peerConnectionsRef.current) {
      try {
        peerConnectionsRef.current[id].close();
      } catch {}
      delete peerConnectionsRef.current[id];
    }
    setRemoteStreams({});
    cleanupPeerConnection(null, log);
    pcStateRef.current = {};
    socket.emit("leave-room", roomId);
    onCloseRef.current?.();
  }, [log, roomId]);

  /* =======================================================
     🎥 Effet 1 — Acquisition du flux local (indépendant)
     -> évite d’utiliser localStream dans l’autre useEffect
  ======================================================= */
  useEffect(() => {
    isMountedRef.current = true;

    (async () => {
      if (!isMountedRef.current) return;
      await acquireLocalStream();
    })();

    return () => {
      isMountedRef.current = false;
      // on ne stoppe pas ici : c’est leaveRoom/cleanup qui gère
    };
  }, [acquireLocalStream]);

  /* =======================================================
     📡 Effet 2 — Room + signalisation + connexions
     (ne dépend PAS de localStream)
  ======================================================= */
  useEffect(() => {
    isMountedRef.current = true;

    const stunUrls =
      process.env.NEXT_PUBLIC_STUN_URLS?.split(",").map((u) => u.trim()).filter(Boolean) ||
      ["stun:stun.l.google.com:19302"];
    const turnUrls = process.env.NEXT_PUBLIC_TURN_URLS
      ?.split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
    const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

    const iceServers: RTCIceServer[] = [{ urls: stunUrls }];
    if (turnUrls?.length && turnUsername && turnCredential) {
      iceServers.push({
        urls: turnUrls,
        username: turnUsername,
        credential: turnCredential,
      });
    } else if (turnUrls?.length) {
      log("⚠️ TURN URLs fournis sans credentials, TURN ignoré");
    }

    const rtcConfig: RTCConfiguration = {
      iceServers,
    };

    /* Participants → nettoyage connexions obsolètes */
    const handleParticipantsUpdate = (participants: string[] = [], count?: number) => {
      log("👥 Participants :", participants);
      setUserCount(count ?? participants.length);
      if (participants.length > 0) {
        for (const id in peerConnectionsRef.current) {
          if (!participants.includes(id)) {
            log("🧹 Suppression connexion obsolète :", id);
            try {
              peerConnectionsRef.current[id].close();
            } catch {}
            delete peerConnectionsRef.current[id];
            setRemoteStreams((prev) => {
              const updated = { ...prev };
              delete updated[id];
              return updated;
            });
          }
        }
      }

    };

    /* Création d’une connexion vers un pair */
    const createConnectionTo = (remoteSocketId: string) => {
      if (peerConnectionsRef.current[remoteSocketId]) return;

      log("➕ Création RTCPeerConnection vers", remoteSocketId);
      const pc = createPeerConnection(
        rtcConfig,
        (stream) => {
          if (!isMountedRef.current) return;
          setRemoteStreams((prev) => ({ ...prev, [remoteSocketId]: stream }));
          log("🎬 Flux distant reçu de", remoteSocketId);
        },
        log
      );

      // Stabilise l'ordre des m-lines (audio puis video) même si le flux local arrive plus tard.
      if (pc.getTransceivers().length === 0) {
        pc.addTransceiver("audio", { direction: "sendrecv" });
        pc.addTransceiver("video", { direction: "sendrecv" });
      }

      pcStateRef.current[remoteSocketId] = {
        makingOffer: false,
        ignoreOffer: false,
        polite: !isCreator, // host = impolite, invité = polite
      };

      pc.onnegotiationneeded = async () => {
        const state = pcStateRef.current[remoteSocketId];
        if (!state) return;
        try {
          state.makingOffer = true;
          const offer = await pc.createOffer();
          if (pc.signalingState !== "stable") return;
          await pc.setLocalDescription(offer);
          socket.emit("offer", { roomId, to: remoteSocketId, sdp: pc.localDescription });
          log("📨 Offer envoyée →", remoteSocketId);
        } catch (err) {
          log("⚠️ Erreur negotiationneeded :", err);
        } finally {
          state.makingOffer = false;
        }
      };

      // Ajoute/remplace les pistes locales si dispo (via ref stable)
      const ls = localStreamRef.current;
      if (ls) {
        void attachLocalTracksToPc(pc, ls);
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            roomId,
            to: remoteSocketId,
            candidate: event.candidate,
          });
        }
      };

      peerConnectionsRef.current[remoteSocketId] = pc;
    };

    /* Room handlers (adapter ta signature réelle si nécessaire) */
    const detachRoomHandlers = initSocketRoomHandlers(
      roomId,
      setIsCreator,
      setUserCount,
      () => {},
      log,
      () => {
        log("🏁 Room fermée (hôte parti)");
        leaveRoom();
      },
      handleParticipantsUpdate
    );

    /* Signalisation ciblée */
    const drainPendingIce = async (peerId: string, pc: RTCPeerConnection) => {
      const pending = pendingIceRef.current[peerId];
      if (!pending || pending.length === 0) return;
      pendingIceRef.current[peerId] = [];
      for (const cand of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          log("⚠️ Erreur addIceCandidate (pending) :", err);
        }
      }
    };

    const handleUserJoined = ({ id }: { id: string }) => {
      log("🟢 Nouveau participant :", id);
      if (!isCreator) {
        log("🧭 Offre ignorée (non-host) — attente de l’offer du host");
        return;
      }
      createConnectionTo(id);
    };

    const handleOffer = async ({
      from,
      sdp,
    }: {
      from: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (!from || !sdp || !sdp.type) {
        log("⚠️ Offer invalide ignorée", { from, sdp });
        return;
      }
      log("📩 Offer reçue de", from);
      createConnectionTo(from);
      const pc = peerConnectionsRef.current[from];
      if (!pc) return;
      const state = pcStateRef.current[from];

      const offerCollision = sdp.type === "offer" && (state?.makingOffer || pc.signalingState !== "stable");
      if (state) {
        state.ignoreOffer = !state.polite && offerCollision;
      }
      if (state?.ignoreOffer) {
        log("⚠️ Offer ignorée (collision, impolite)");
        return;
      }

      if (offerCollision && state?.polite) {
        await pc.setLocalDescription({ type: "rollback" });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await drainPendingIce(from, pc);
      if (sdp.type === "offer") {
        if (localStreamRef.current) {
          await attachLocalTracksToPc(pc, localStreamRef.current);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", { roomId, to: from, sdp: pc.localDescription });
        log("📤 Answer envoyée →", from);
      }
    };

    const handleAnswer = async ({
      from,
      sdp,
    }: {
      from: string;
      sdp: RTCSessionDescriptionInit;
    }) => {
      if (!from || !sdp || !sdp.type) {
        log("⚠️ Answer invalide ignorée", { from, sdp });
        return;
      }
      log("📩 Answer reçue de", from);
      const pc = peerConnectionsRef.current[from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await drainPendingIce(from, pc);
      }
    };

    const handleIceCandidate = async ({
      from,
      candidate,
    }: {
      from: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const pc = peerConnectionsRef.current[from];
      if (!candidate) return;
      if (!pc) {
        pendingIceRef.current[from] = [
          ...(pendingIceRef.current[from] || []),
          candidate,
        ];
        log("⏳ ICE en attente (pc manquante)", { from });
        return;
      }
      if (!pc.remoteDescription) {
        pendingIceRef.current[from] = [
          ...(pendingIceRef.current[from] || []),
          candidate,
        ];
        log("⏳ ICE en attente (remoteDescription absente)", { from });
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        log("⚠️ Erreur addIceCandidate :", err);
      }
    };

    const handleUserLeft = ({ id }: { id: string }) => {
      log("🔴 Participant parti :", id);
      if (peerConnectionsRef.current[id]) {
        try {
          peerConnectionsRef.current[id].close();
        } catch {}
        delete peerConnectionsRef.current[id];
        delete pcStateRef.current[id];
        setRemoteStreams((prev) => {
          const updated = { ...prev };
          delete updated[id];
          return updated;
        });
      }
    };

    socket.on("user-joined", handleUserJoined);
    socket.on("offer", handleOffer);
    socket.on("answer", handleAnswer);
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("user-left", handleUserLeft);

    return () => {
      isMountedRef.current = false;
      log("🧹 Cleanup signalisation + room");
      // Ferme toutes les PC
      for (const id in peerConnectionsRef.current) {
        try {
          peerConnectionsRef.current[id].close();
        } catch {}
      }
      peerConnectionsRef.current = {};
      pcStateRef.current = {};

      detachRoomHandlers();
      socket.off("user-joined", handleUserJoined);
      socket.off("offer", handleOffer);
      socket.off("answer", handleAnswer);
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("user-left", handleUserLeft);

      setRemoteStreams({});
      // on ne touche pas localStream ici (c’est global au hook)
    };
  }, [roomId, log, leaveRoom, isCreator, attachLocalTracksToPc]); // ✅ pas de localStream ici (on passe par localStreamRef)

  /* =======================================================
     🔄 Attache les tracks locales aux PC existantes
     (la négociation est gérée via onnegotiationneeded)
  ======================================================= */
  useEffect(() => {
    const ls = localStreamRef.current;
    if (!ls) return;

    if (ls.getAudioTracks().length === 0) {
      log("⚠️ Aucun track audio local — vérifie les permissions micro");
    }

    Object.entries(peerConnectionsRef.current).forEach(([peerId, pc]) => {
      void (async () => {
        const changed = await attachLocalTracksToPc(pc, ls);
        if (!changed) return;
      })();
    });
  }, [localStream, attachLocalTracksToPc, log]);

  /* =======================================================
     📦 Retour hook
  ======================================================= */
  return {
    localStream,
    remoteStreams,
    isCreator,
    userCount,
    leaveRoom, // exposé au composant
    mediaError,
    isRequestingMedia,
    requestMedia: acquireLocalStream,
  };
}