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

/**
 * 🎯 Gestion complète du signaling WebRTC avec Socket.IO
 * → Compatible mobile / desktop
 * → Évite les collisions d'offres ("perfect negotiation")
 */
export const attachSignalingHandlers = (
  pc: RTCPeerConnection,
  roomId: string,
  log: (label: string, ...data: unknown[]) => void,
  isPolite: boolean // ✅ True pour l’invité, False pour le créateur
): (() => void) => {
  /* =======================================================
     📦 État interne
  ======================================================= */
  const polite = isPolite; // ✅ pas de warning ESLint
  let remoteDescriptionSet = false;
  let isMakingOffer = false;
  const pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  /* =======================================================
     🧊 ICE locale
  ======================================================= */
  pc.onicecandidate = (evt) => {
    if (evt.candidate) {
      socket.emit("ice-candidate", { roomId, candidate: evt.candidate.toJSON() });
      log("📤 ICE candidate locale envoyée");
    }
  };

  pc.oniceconnectionstatechange = () => {
    log("🧊 ICE connectionState:", pc.iceConnectionState);
  };

  /* =======================================================
     🎛️ Prépare transceivers
  ======================================================= */
  const waitSendersOrAddTransceivers = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      const hasTrack = pc.getSenders().some((s) => !!s.track);
      if (hasTrack) return;
      await new Promise<void>((r) => setTimeout(r, 100));
    }
    if (pc.getTransceivers().length === 0) {
      try {
        pc.addTransceiver("video", { direction: "sendrecv" });
        pc.addTransceiver("audio", { direction: "sendrecv" });
        log("➕ Transceivers ajoutés (fallback)");
      } catch (e) {
        log("⚠️ Impossible d'ajouter des transceivers:", e);
      }
    }
  };

  /* =======================================================
     📡 Offer reçue
  ======================================================= */
  const onOffer = async ({ offer }: OfferPayload): Promise<void> => {
    try {
      if (!offer) return;

      const offerCollision = isMakingOffer || pc.signalingState !== "stable";

      if (offerCollision) {
        log("⚠️ Collision d’offre détectée");
        if (!polite) {
          log("🚫 Offre ignorée (non-polite)");
          return;
        }
      }

      log("📨 Offer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescriptionSet = true;

      await waitSendersOrAddTransceivers();

      // Ajoute les ICE en attente
      for (const c of pendingRemoteCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
          console.error("⚠️ Erreur addIceCandidate (flush):", e);
        }
      }
      pendingRemoteCandidates.length = 0;

      // Crée et envoie l’answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { roomId, answer });
      log("📤 Answer envoyée !");
    } catch (err) {
      console.error("❌ Erreur sur réception offer:", err);
    }
  };

  /* =======================================================
     📡 Answer reçue
  ======================================================= */
  const onAnswer = async ({ answer }: AnswerPayload): Promise<void> => {
    try {
      if (!answer) return;
      if (pc.signalingState !== "have-local-offer") {
        log("⚠️ Ignorer answer (mauvais état):", pc.signalingState);
        return;
      }

      log("📨 Answer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescriptionSet = true;

      for (const c of pendingRemoteCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
          console.error("⚠️ Erreur addIceCandidate (flush):", e);
        }
      }
      pendingRemoteCandidates.length = 0;
    } catch (err) {
      console.error("❌ Erreur sur réception answer:", err);
    }
  };

  /* =======================================================
     ❄️ ICE distante
  ======================================================= */
  const onIceCandidate = async ({ candidate }: CandidatePayload): Promise<void> => {
    try {
      if (!candidate) return;

      if (!remoteDescriptionSet || !pc.remoteDescription) {
        pendingRemoteCandidates.push(candidate);
        log("🧊 ICE distante reçue avant SDP → en attente");
        return;
      }

      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      log("✅ ICE candidate distante ajoutée");
    } catch (err) {
      console.error("⚠️ Erreur addIceCandidate:", err);
    }
  };

  /* =======================================================
     🛰️ Création d’offre locale
  ======================================================= */
  const onCreateOffer = async (): Promise<void> => {
    try {
      if (isMakingOffer) {
        log("⚠️ Offer déjà en cours, skip");
        return;
      }
      isMakingOffer = true;

      log("🎬 Création d’offre locale (create-offer)");
      await waitSendersOrAddTransceivers();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("offer", { roomId, offer });
      log("📤 Offre envoyée");
    } catch (err) {
      console.error("❌ Erreur createOffer:", err);
    } finally {
      isMakingOffer = false;
    }
  };

  /* =======================================================
     🔌 Abonnements Socket.IO
  ======================================================= */
  socket.on("offer", onOffer);
  socket.on("answer", onAnswer);
  socket.on("ice-candidate", onIceCandidate);
  socket.on("create-offer", onCreateOffer);

  /* =======================================================
     🧹 Cleanup
  ======================================================= */
  return () => {
    socket.off("offer", onOffer);
    socket.off("answer", onAnswer);
    socket.off("ice-candidate", onIceCandidate);
    socket.off("create-offer", onCreateOffer);
  };
};