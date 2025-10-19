// server.js (ESM)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*", // 🔒 à restreindre ensuite: "https://bfzoom.vercel.app"
    methods: ["GET", "POST"],
  },
});

// 🩵 Endpoint de test
app.get("/", (_req, res) => {
  res.send("🚀 Serveur Socket.IO BFZoom actif !");
});

/* ===========================================================
   🎥 GESTION DES ROOMS — version stable et pro
=========================================================== */
io.on("connection", (socket) => {
  console.log("🟢 Client connecté :", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    console.log(`👥 Room ${roomId}: ${count} utilisateur(s)`);

    // Informe tout le monde du nombre total
    io.to(roomId).emit("room-users", { count });

    // ✅ Détermine qui initie l’offre :
    // si quelqu’un était déjà là, c’est lui qui démarre
    const others = [...(room || [])].filter((id) => id !== socket.id);
    if (others.length === 1) {
      const initiatorId = others[0];
      io.to(initiatorId).emit("initiate-offer", { roomId, peerId: socket.id });
      console.log(`🎬 Demande à ${initiatorId} de créer l'offre pour ${socket.id}`);
    }

    io.to(roomId).emit("user-joined", { id: socket.id });
  });

  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    io.to(roomId).emit("room-users", { count });
    console.log(`🚪 ${socket.id} a quitté ${roomId}`);
  });

  /* === Signaling WebRTC === */
  socket.on("offer", ({ roomId, offer }) => {
    console.log(`📨 Offre transmise → ${roomId}`);
    socket.to(roomId).emit("offer", { roomId, offer });
  });

  socket.on("answer", ({ roomId, answer }) => {
    console.log(`📨 Réponse transmise → ${roomId}`);
    socket.to(roomId).emit("answer", { roomId, answer });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { roomId, candidate });
  });

  socket.on("disconnect", () => {
    console.log("🔴 Déconnexion :", socket.id);
  });
});

/* ===========================================================
   🚀 Lancement
=========================================================== */
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`✅ Socket.IO server opérationnel sur le port ${PORT}`);
});
