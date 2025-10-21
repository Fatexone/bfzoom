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
 * Attache les événements Socket.IO liés au signaling WebRTC
 * et renvoie une fonction de cleanup.
 */
export const attachSignalingHandlers = (
  pc: RTCPeerConnection,
  roomId: string,
  log: (label: string, ...data: unknown[]) => void
): (() => void) => {
  /* =======================================================
     📦 État interne
  ======================================================= */
  let remoteDescriptionSet = false;
  let isMakingOffer = false;
  const pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  /* =======================================================
     📤 Émission ICE locale unique
  ======================================================= */
  pc.onicecandidate = (evt: RTCPeerConnectionIceEvent) => {
    const candidate = evt.candidate;
    if (candidate) {
      socket.emit("ice-candidate", { roomId, candidate: candidate.toJSON() });
      log("📤 ICE candidate locale envoyée");
    } else {
      log("✅ ICE locale terminée");
    }
  };

  pc.oniceconnectionstatechange = () => {
    log("🧊 ICE connectionState:", pc.iceConnectionState);
  };

  /* =======================================================
     🕒 Préparer transceivers si pas de tracks
  ======================================================= */
  const waitSendersOrAddTransceivers = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) {
      const hasTrack = pc.getSenders().some((s) => !!s.track);
      if (hasTrack) return;
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    // Si aucune track après 1s → fallback
    if (pc.getTransceivers().length === 0) {
      try {
        pc.addTransceiver("video", { direction: "sendrecv" });
        pc.addTransceiver("audio", { direction: "sendrecv" });
        log("➕ Transceivers audio/vidéo ajoutés (fallback)");
      } catch (e) {
        log("⚠️ Impossible d'ajouter des transceivers:", e);
      }
    }
  };

  /* =======================================================
     📡 Réception d'une offer
  ======================================================= */
  const onOffer = async ({ offer }: OfferPayload): Promise<void> => {
    try {
      if (!offer) return;

      log("📨 Offer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescriptionSet = true;

      // Ajouter nos tracks locales si besoin
      await waitSendersOrAddTransceivers();

      // Vider la file d'attente ICE
      for (const c of pendingRemoteCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
          console.error("⚠️ Erreur addIceCandidate (flush):", e);
        }
      }
      pendingRemoteCandidates.length = 0;

      // Créer et envoyer l'answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { roomId, answer });
      log("📤 Answer envoyée avec succès");
    } catch (err) {
      console.error("❌ Erreur sur réception offer:", err);
    }
  };

  /* =======================================================
     📡 Réception d'une answer
  ======================================================= */
  const onAnswer = async ({ answer }: AnswerPayload): Promise<void> => {
    try {
      if (!answer) return;

      log("📨 Answer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescriptionSet = true;

      // Flush ICE candidates
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
     ❄️ Réception ICE distante
  ======================================================= */
  const onIceCandidate = async ({
    candidate,
  }: CandidatePayload): Promise<void> => {
    try {
      if (!candidate) return;

      if (!remoteDescriptionSet || !pc.remoteDescription) {
        pendingRemoteCandidates.push(candidate);
        log(
          "🧊 ICE distante reçue avant SDP → mise en file (len:",
          pendingRemoteCandidates.length,
          ")"
        );
        return;
      }

      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      log("✅ ICE candidate distante ajoutée");
    } catch (err) {
      console.error("⚠️ Erreur addIceCandidate:", err);
    }
  };

  /* =======================================================
     🎬 Demande de création d’offre
  ======================================================= */
  const onCreateOffer = async (): Promise<void> => {
    try {
      if (isMakingOffer) {
        log("⚠️ Offer déjà en cours, skip");
        return;
      }
      isMakingOffer = true;

      log("🎬 Demande de création d’offre reçue (create-offer)");
      await waitSendersOrAddTransceivers();

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("offer", { roomId, offer });
      log("📤 Offre créée et envoyée au serveur");
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
