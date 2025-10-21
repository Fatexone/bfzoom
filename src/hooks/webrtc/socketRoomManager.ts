import { socket } from "@/lib/socket";

/**
 * Initialise la logique de room Socket.IO :
 * - rejoint automatiquement la room
 * - reçoit le rôle (créateur/invité)
 * - suit le nombre d'utilisateurs
 * - gère la reconnexion automatique
 * Retourne une fonction de cleanup complète.
 */
export const initSocketRoomHandlers = (
  roomId: string,
  setIsCreator: (v: boolean) => void,
  setUserCount: (n: number) => void,
  setOtherUserConnected: (b: boolean) => void,
  log: (label: string, ...data: unknown[]) => void
): (() => void) => {
  /* =======================================================
     🔁 Fonction pour rejoindre la room
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

  const handleRoomRole = ({ isCreator }: { isCreator: boolean }) => {
    setIsCreator(isCreator);
    log("🎭 Rôle attribué :", isCreator ? "Créateur" : "Invité");
  };

  const handleRoomUsers = ({ count }: { count: number }) => {
    setUserCount(count);
    setOtherUserConnected(count > 1);
    log("👥 room-users →", count);
  };

  /* =======================================================
     🧩 Souscriptions Socket.IO
  ======================================================= */
  socket.on("connect", handleConnect);
  socket.on("disconnect", handleDisconnect);
  socket.on("room-role", handleRoomRole);
  socket.on("room-users", handleRoomUsers);

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
     🧹 Cleanup
  ======================================================= */
  return () => {
    log("🧹 Cleanup : leave-room + remove listeners");
    socket.emit("leave-room", roomId);
    socket.off("connect", handleConnect);
    socket.off("disconnect", handleDisconnect);
    socket.off("room-role", handleRoomRole);
    socket.off("room-users", handleRoomUsers);
  };
};
