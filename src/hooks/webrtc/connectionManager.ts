/**
 * connectionManager.ts
 * Gestion bas-niveau du cycle de vie RTCPeerConnection
 */

export const createPeerConnection = (
  config: RTCConfiguration,
  onRemoteStream: (stream: MediaStream) => void,
  log: (label: string, ...data: unknown[]) => void
): RTCPeerConnection => {
  const pc = new RTCPeerConnection(config);

  // === Logs d’état internes (utile pour debug WebRTC) ===
  pc.onconnectionstatechange = () =>
    log("🔗 connectionState:", pc.connectionState);
  pc.onsignalingstatechange = () =>
    log("🧭 signalingState:", pc.signalingState);
  pc.oniceconnectionstatechange = () =>
    log("🧊 iceConnectionState:", pc.iceConnectionState);
  pc.onicegatheringstatechange = () =>
    log("❄️ iceGatheringState:", pc.iceGatheringState);

  // === Envoi des ICE locales ===
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      log("📤 ICE locale émise:", event.candidate.candidate);
    } else {
      log("✅ ICE locale terminée");
    }
  };

  // === Gestion des flux distants robustes ===
  const remoteMediaStream = new MediaStream();

  pc.ontrack = (event: RTCTrackEvent) => {
    log("📡 ontrack déclenché:", event.track.kind);

    // Ajout du track dans le flux distant reconstruit
    remoteMediaStream.addTrack(event.track);

    // Si event.streams est fourni, on l’utilise pour cohérence
    const [eventStream] = event.streams;
    const finalStream = eventStream ?? remoteMediaStream;

    onRemoteStream(finalStream);
    log(
      "🎥 Flux distant mis à jour — tracks:",
      finalStream.getTracks().map((t) => t.kind)
    );
  };

  return pc;
};

/**
 * Ferme proprement une RTCPeerConnection + arrête les pistes locales.
 */
export const cleanupPeerConnection = (
  pc: RTCPeerConnection | null,
  log: (label: string, ...data: unknown[]) => void
): void => {
  if (!pc) return;
  try {
    pc.getSenders().forEach((s) => s.track?.stop());
    pc.close();
    log("🔻 RTCPeerConnection fermée et pistes stoppées");
  } catch (e) {
    log("⚠️ Erreur cleanupPeerConnection:", e);
  }
};
