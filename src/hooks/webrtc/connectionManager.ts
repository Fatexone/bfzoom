/**
 * connectionManager.ts
 * Gestion bas-niveau du cycle de vie RTCPeerConnection
 * Version optimisée — compatible iOS / macOS / Windows
 */

export const createPeerConnection = (
  config: RTCConfiguration,
  onRemoteStream: (stream: MediaStream) => void,
  log: (label: string, ...data: unknown[]) => void
): RTCPeerConnection => {
  const pc = new RTCPeerConnection(config);

  /* =======================================================
     🧠 Log des états internes
  ======================================================= */
  pc.onconnectionstatechange = () =>
    log("🔗 connectionState:", pc.connectionState);
  pc.onsignalingstatechange = () =>
    log("🧭 signalingState:", pc.signalingState);
  pc.oniceconnectionstatechange = () =>
    log("🧊 iceConnectionState:", pc.iceConnectionState);
  pc.onicegatheringstatechange = () =>
    log("❄️ iceGatheringState:", pc.iceGatheringState);

  /* =======================================================
     📤 Gestion des ICE Candidates
  ======================================================= */
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      log("📤 ICE locale émise:", event.candidate.candidate);
    } else {
      log("✅ ICE locale terminée");
    }
  };

  /* =======================================================
     🎥 Gestion robuste du flux distant
     - Compatible iPhone Safari
     - Garde un flux unique que l’on met à jour
  ======================================================= */
  const remoteStream = new MediaStream();

  pc.ontrack = (event: RTCTrackEvent) => {
    log("📡 ontrack reçu:", event.track.kind);

    // Ajoute chaque track dans le flux distant unique
    event.streams[0]?.getTracks().forEach((track) => {
      if (!remoteStream.getTracks().find((t) => t.id === track.id)) {
        remoteStream.addTrack(track);
        log("🎬 Track ajoutée au flux distant:", track.kind);
      }
    });

    // ✅ Envoie toujours le même MediaStream
    onRemoteStream(remoteStream);
  };

  /* =======================================================
     🧰 Sécurité : forcer la reconstruction du flux distant
     quand une ICE se reconnecte (utile sur iOS/mac)
  ======================================================= */
  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === "connected") {
      log("✅ ICE connectée — flux distant stable");
      onRemoteStream(remoteStream);
    }
    if (pc.iceConnectionState === "disconnected") {
      log("⚠️ ICE déconnectée — tentative de reconnexion");
    }
  };

  return pc;
};

/* =======================================================
   🧹 Nettoyage complet
======================================================= */
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