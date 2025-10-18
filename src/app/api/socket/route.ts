// src/app/api/socket/route.ts
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

// ✅ Étend le type global pour stocker l’instance Socket.IO
declare global {
  // eslint-disable-next-line no-var
  var _io: SocketIOServer | undefined;
}

export const GET = async () => {
  // ⚙️ Empêche la recréation du serveur à chaque requête
  if (!global._io) {
    console.log("🚀 Initialisation du serveur Socket.IO...");

    const ioInstance = new SocketIOServer({
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    global._io = ioInstance;
    io = ioInstance;

    io.on("connection", (socket) => {
      console.log("🟢 Nouveau client connecté :", socket.id);

      /* === Rejoint une salle === */
      socket.on("join-room", (roomId: string) => {
        socket.join(roomId);
        const room = io?.sockets.adapter.rooms.get(roomId);
        const clients = room ? Array.from(room) : [];
        console.log(`👥 Room ${roomId}: ${clients.length} client(s)`);

        io?.to(roomId).emit("room-users", { count: clients.length });
        socket.to(roomId).emit("user-joined", { id: socket.id });
      });

      /* === Quitte une salle === */
      socket.on("leave-room", (roomId: string) => {
        socket.leave(roomId);
        const room = io?.sockets.adapter.rooms.get(roomId);
        const clients = room ? Array.from(room) : [];
        io?.to(roomId).emit("room-users", { count: clients.length });
        console.log(`🚪 ${socket.id} a quitté ${roomId}`);
      });

      /* === WebRTC signaling === */
      socket.on("offer", (data) => socket.to(data.roomId).emit("offer", data));
      socket.on("answer", (data) => socket.to(data.roomId).emit("answer", data));
      socket.on("candidate", (data) =>
        socket.to(data.roomId).emit("candidate", data)
      );

      /* === Déconnexion === */
      socket.on("disconnect", () => {
        console.log("🔴 Client déconnecté :", socket.id);
      });
    });

    console.log("✅ Socket.IO Server prêt !");
  } else {
    io = global._io!;
  }

  return new Response("Socket.IO server is running", { status: 200 });
};
