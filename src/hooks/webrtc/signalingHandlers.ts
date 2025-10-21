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
     📡 Offer reçue → on répond par une Answer
  ======================================================= */
  const onOffer = async ({ offer }: OfferPayload) => {
    try {
      if (!offer) return;
      log("📨 Offer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

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
  const onAnswer = async ({ answer }: AnswerPayload) => {
    try {
      if (!answer) return;
      log("📨 Answer reçue → setRemoteDescription");
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (err) {
      console.error("❌ Erreur sur réception answer:", err);
    }
  };

  /* =======================================================
     ❄️ ICE Candidate reçue → ajout à la connexion
  ======================================================= */
  const onIceCandidate = async ({ candidate }: CandidatePayload) => {
    try {
      if (!candidate) return;
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      log("✅ ICE candidate ajoutée");
    } catch (err) {
      console.error("⚠️ Erreur addIceCandidate:", err);
    }
  };

  /* =======================================================
     🎬 Création d’offre (déclenchée par le serveur)
  ======================================================= */
  const onCreateOffer = async () => {
    try {
      log("🎬 Demande de création d’offre reçue (create-offer)");
      const offer = await pc.createOffer();
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
