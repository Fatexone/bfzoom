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

  // --- Logs d’état internes (utile pour debug WebRTC) ---
  pc.onconnectionstatechange = () => log("🔗 connectionState:", pc.connectionState);
  pc.onsignalingstatechange = () => log("🧭 signalingState:", pc.signalingState);
  pc.oniceconnectionstatechange = () =>
    log("🧊 iceConnectionState:", pc.iceConnectionState);
  pc.onicegatheringstatechange = () =>
    log("❄️ iceGatheringState:", pc.iceGatheringState);

  // --- Réception du flux distant ---
  pc.ontrack = (event: RTCTrackEvent) => {
    const [stream] = event.streams;
    if (stream) {
      onRemoteStream(stream);
      log("📡 Flux distant reçu (tracks:", stream.getTracks().length, ")");
    }
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
