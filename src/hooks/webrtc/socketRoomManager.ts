// src/hooks/webrtc/socketRoomManager.ts
import { socket } from "@/lib/socket";

/**
 * 🔌 Gestion complète de la room Socket.IO
 * Compatible multi-participants (2 à 6+) + host unique
 * =======================================================
 * - rejoint automatiquement la room
 * - reçoit le rôle (créateur/invité)
 * - suit la liste et le nombre d’utilisateurs
 * - détecte les arrivées/départs
 * - réagit à la fermeture automatique de la salle
 * - gère la reconnexion automatique
 */
export const initSocketRoomHandlers = (
  roomId: string,
  setIsCreator: (v: boolean) => void,
  setUserCount: (n: number) => void,
  setOtherUserConnected: (b: boolean) => void,
  log: (label: string, ...data: unknown[]) => void,
  onRoomClosed?: () => void,
  onParticipantsUpdate?: (participants: string[], count?: number) => void
): (() => void) => {
  /* =======================================================
     🔁 Fonction utilitaire pour rejoindre la room
  ======================================================= */
  const joinRoom = () => {
    if (socket.connected) {
      socket.emit("join-room", roomId);
      log("📨 join-room émis", { roomId });
    } else {
      log("⏳ Socket non connectée — attente avant join-room...");
    }
  };

  /* =======================================================
     🔌 Handlers Socket.IO
  ======================================================= */
  const handleConnect = () => {
    log("✅ Socket connectée → rejoin room automatiquement");
    joinRoom();
  };

  const handleDisconnect = (reason: string) => {
    log("⚠️ Socket déconnectée :", reason);
  };

  const handleRoomRole = ({
    isCreator,
    hostId,
  }: {
    isCreator: boolean;
    hostId: string;
  }) => {
    setIsCreator(isCreator);
    log("🎭 Rôle attribué :", isCreator ? "Créateur (host)" : "Invité", "→ hostId:", hostId);
  };

  const handleRoomUsers = ({
    participants = [],
    count,
    hostId,
  }: {
    participants?: string[];
    count: number;
    hostId: string;
  }) => {
    setUserCount(count);
    setOtherUserConnected(count > 1);
    onParticipantsUpdate?.(participants, count);
    log(`👥 room-users (${count})`, { participants, hostId });
  };

  const handleUserJoined = ({ id }: { id: string }) => {
    log(`🟢 user-joined → ${id}`);
  };

  const handleUserLeft = ({ id }: { id: string }) => {
    log(`🔴 user-left → ${id}`);
  };

  const handleRoomClosed = ({ reason }: { reason: string }) => {
    log("🏁 room-closed → fermeture automatique (host parti)", reason);
    onRoomClosed?.();
  };

  /* =======================================================
     🧩 Souscriptions Socket.IO
  ======================================================= */
  socket.on("connect", handleConnect);
  socket.on("disconnect", handleDisconnect);
  socket.on("room-role", handleRoomRole);
  socket.on("room-users", handleRoomUsers);
  socket.on("user-joined", handleUserJoined);
  socket.on("user-left", handleUserLeft);
  socket.on("room-closed", handleRoomClosed);

  // Premier join dès le montage (si déjà connecté)
  if (socket.connected) {
    joinRoom();
  } else {
    socket.once("connect", () => {
      log("⚡ Première connexion socket → join-room");
      joinRoom();
    });
  }

  /* =======================================================
     🧹 Cleanup complet
  ======================================================= */
  return () => {
    log("🧹 Cleanup : leave-room + remove listeners");
    socket.emit("leave-room", roomId);
    socket.off("connect", handleConnect);
    socket.off("disconnect", handleDisconnect);
    socket.off("room-role", handleRoomRole);
    socket.off("room-users", handleRoomUsers);
    socket.off("user-joined", handleUserJoined);
    socket.off("user-left", handleUserLeft);
    socket.off("room-closed", handleRoomClosed);
  };
};