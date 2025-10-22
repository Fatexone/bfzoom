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

app.get("/health", (_req, res) => res.status(200).send("ok"));

console.log("🚀 Socket.IO Server BFZoom démarré...");

io.on("connection", (socket) => {
  console.log("🟢 Nouveau client :", socket.id);

  /* =======================================================
     🏠 Rooms WebRTC
  ======================================================= */
  socket.on("join-room", (roomId) => {
    socket.join(roomId);

    const room = io.sockets.adapter.rooms.get(roomId);
    const clients = room ? Array.from(room) : [];

    // Si premier arrivant → créateur
    const isCreator = clients.length === 1;
    socket.emit("room-role", { isCreator });

    // Notifie tout le monde du nombre d’utilisateurs
    io.to(roomId).emit("room-users", { count: clients.length });

    // Si un second utilisateur rejoint, demander au créateur de créer l’offer
    if (clients.length === 2) {
      io.to(roomId).emit("create-offer", roomId);
    }

    console.log(`👥 Room ${roomId}: ${clients.length} client(s)`);
  });

  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit("user-left", { id: socket.id });

    const room = io.sockets.adapter.rooms.get(roomId);
    const clients = room ? Array.from(room) : [];
    io.to(roomId).emit("room-users", { count: clients.length });

    console.log(`🚪 ${socket.id} a quitté ${roomId}`);
  });

  /* =======================================================
     📡 Signalisation WebRTC (diffusion room-wide)
  ======================================================= */
  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", { offer });
    console.log(`📨 Offer relayée dans ${roomId}`);
  });

  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", { answer });
    console.log(`📨 Answer relayée dans ${roomId}`);
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { candidate });
    console.log(`🧊 ICE candidate relayée dans ${roomId}`);
  });

  /* =======================================================
     💬 Chat texte
  ======================================================= */
  socket.on("chat-message", ({ roomId, msg }) => {
    if (!roomId || !msg) return;
    console.log(`💬 [${roomId}] ${msg.sender}: ${msg.text}`);
    io.to(roomId).emit("chat-message", msg);
  });

  /* =======================================================
     🔌 Déconnexion
  ======================================================= */
  socket.on("disconnecting", () => {
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;
      socket.to(roomId).emit("user-left", { id: socket.id });

      const room = io.sockets.adapter.rooms.get(roomId);
      const clients = room ? Array.from(room) : [];
      io.to(roomId).emit("room-users", { count: clients.length });
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Déconnecté :", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Socket.IO prêt sur le port ${PORT}`);
});
