// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*", // 🔒 à restreindre plus tard à ton domaine (ex: "https://bfzoom.vercel.app")
    methods: ["GET", "POST"],
  },
});

/* ===========================================================
   🎥 GESTION DES ROOMS POUR VISIO BFZOOM
=========================================================== */
io.on("connection", (socket) => {
  console.log("🟢 Client connecté :", socket.id);

  // Rejoint une salle
  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;

    console.log(`👥 Room ${roomId}: ${count} utilisateur(s)`);

    // informe tous les clients de la room du nombre total
    io.to(roomId).emit("room-users", { count });

    // informe les autres qu’un nouvel utilisateur arrive
    socket.to(roomId).emit("user-joined", { id: socket.id });
  });

  // Quitte la salle
  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    io.to(roomId).emit("room-users", { count });
    console.log(`🚪 ${socket.id} a quitté ${roomId}`);
  });

  // === WebRTC Signaling ===
  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", { roomId, offer });
  });

  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", { roomId, answer });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { roomId, candidate });
  });

  // === Déconnexion ===
  socket.on("disconnect", () => {
    console.log("🔴 Déconnexion :", socket.id);
  });
});

/* ===========================================================
   🚀 Lancement du serveur
=========================================================== */
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () =>
  console.log(`✅ Socket.IO Server opérationnel sur le port ${PORT}`)
);
