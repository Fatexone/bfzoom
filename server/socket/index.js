// server/socket/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4001;

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

console.log("🚀 Socket.IO Server BFZoom démarré...");

io.on("connection", (socket) => {
  console.log("🟢 Nouveau client :", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    const clients = room ? Array.from(room) : [];

    const isCreator = clients.length === 1;
    socket.emit("room-role", { isCreator });

    console.log(`👥 ${roomId}: ${clients.length} client(s)`);

    if (clients.length === 2) {
      const [creatorId] = clients;
      io.to(creatorId).emit("create-offer");
      console.log(`🎬 create-offer envoyé au créateur (${creatorId})`);
    }

    io.to(roomId).emit("room-users", { count: clients.length });
    socket.to(roomId).emit("user-joined", { id: socket.id });
  });

  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    const clients = room ? Array.from(room) : [];
    io.to(roomId).emit("room-users", { count: clients.length });
    console.log(`🚪 ${socket.id} a quitté ${roomId}`);
  });

  socket.on("offer", (data) => socket.to(data.roomId).emit("offer", data));
  socket.on("answer", (data) => socket.to(data.roomId).emit("answer", data));
  socket.on("ice-candidate", (data) =>
    socket.to(data.roomId).emit("ice-candidate", data)
  );

  socket.on("disconnect", () => {
    console.log("🔴 Déconnecté :", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Socket.IO prêt sur le port ${PORT}`);
});
