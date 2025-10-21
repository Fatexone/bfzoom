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
     📦 État interne pour fiabiliser l'ordre SDP/ICE
  ======================================================= */
  let remoteDescriptionSet = false;
  const pendingRemoteCandidates: RTCIceCandidateInit[] = [];

  /* =======================================================
     📤 Émettre nos ICE candidates locales
  ======================================================= */
  pc.onicecandidate = (evt: RTCPeerConnectionIceEvent) => {
    const candidate = evt.candidate;
    if (!candidate) return;
    socket.emit("ice-candidate", { roomId, candidate: candidate.toJSON() });
    log("📤 ICE candidate locale envoyée");
  };

  /* Optionnel : logs utiles */
  pc.onnegotiationneeded = () => log("🧾 onnegotiationneeded");
  pc.ontrack = (e: RTCTrackEvent) => {
    const [stream] = e.streams;
    if (stream) log("📡 ontrack déclenché (tracks:", stream.getTracks().length, ")");
  };

  /* =======================================================
     🕒 Helper: attendre des senders/track avant l'offer
     (sinon offer « vide »; on ajoute des transceivers audio/vidéo)
  ======================================================= */
  const waitSendersOrAddTransceivers = async (): Promise<void> => {
    // attend jusqu’à 1s que des tracks soient ajoutées
    for (let i = 0; i < 10; i++) {
      const hasTrack = pc.getSenders().some((s) => !!s.track);
      if (hasTrack) return;
      await new Promise<void>((r) => setTimeout(r, 100));
    }
    // toujours rien → on prépare des transceivers pour recevoir quand même
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
     📡 Offer reçue → on répond par une Answer
  ======================================================= */
  const onOffer = async ({ offer }: OfferPayload): Promise<void> => {
    try {
      if (!offer) return;
      log("📨 Offer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      remoteDescriptionSet = true;

      // vider la file des ICE reçues trop tôt
      for (const c of pendingRemoteCandidates) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        } catch (e) {
          console.error("⚠️ Erreur addIceCandidate (flush):", e);
        }
      }
      pendingRemoteCandidates.length = 0;

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer", { roomId, answer });
      log("📤 Answer envoyée avec succès");
    } catch (err) {
      console.error("❌ Erreur sur réception offer:", err);
    }
  };

  /* =======================================================
     📡 Answer reçue → on finalise la connexion
  ======================================================= */
  const onAnswer = async ({ answer }: AnswerPayload): Promise<void> => {
    try {
      if (!answer) return;
      log("📨 Answer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      remoteDescriptionSet = true;

      // vider la file des ICE reçues trop tôt
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
     ❄️ ICE Candidate distante → ajout avec file d’attente
  ======================================================= */
  const onIceCandidate = async ({ candidate }: CandidatePayload): Promise<void> => {
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
     🎬 Création d’offre (déclenchée par le serveur)
  ======================================================= */
  const onCreateOffer = async (): Promise<void> => {
    try {
      log("🎬 Demande de création d’offre reçue (create-offer)");
      await waitSendersOrAddTransceivers();

      // créer l’offre sans flags dépréciés
      const offerOptions: RTCOfferOptions = {};
      const offer = await pc.createOffer(offerOptions);

      await pc.setLocalDescription(offer);
      socket.emit("offer", { roomId, offer });
      log("📤 Offre créée et envoyée au serveur");
    } catch (err) {
      console.error("❌ Erreur createOffer:", err);
    }
  };

  /* =======================================================
     🔌 Abonnements
  ======================================================= */
  socket.on("offer", onOffer);
  socket.on("answer", onAnswer);
  socket.on("ice-candidate", onIceCandidate);
  socket.on("create-offer", onCreateOffer);

  /* =======================================================
     🧹 Cleanup propre
  ======================================================= */
  return () => {
    socket.off("offer", onOffer);
    socket.off("answer", onAnswer);
    socket.off("ice-candidate", onIceCandidate);
    socket.off("create-offer", onCreateOffer);
  };
};
