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

/* ===========================================================
   🌐 Endpoint de test
=========================================================== */
app.get("/", (_req, res) => {
  res.send("🚀 Serveur Socket.IO BFZoom actif !");
});

/* ===========================================================
   🎥 GESTION DES ROOMS — version stable + logs
=========================================================== */
io.on("connection", (socket) => {
  console.log("🟢 Client connecté :", socket.id);

  // 🛰️ Log tous les events reçus côté serveur
  socket.onAny((event, payload) => {
    console.log(`📡 [EVENT] ${event}`, payload ? JSON.stringify(payload).slice(0, 200) : "");
  });

  /* ---------------- JOIN ROOM ---------------- */
  socket.on("join-room", (roomId) => {
    console.log(`➡️ ${socket.id} rejoint la salle : ${roomId}`);
    socket.join(roomId);

    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    console.log(`👥 Room ${roomId}: ${count} utilisateur(s)`);

    // Informe tout le monde du nombre total
    io.to(roomId).emit("room-users", { count });

    // ✅ Détermine qui initie l’offre :
    const others = [...(room || [])].filter((id) => id !== socket.id);
    if (others.length === 1) {
      const initiatorId = others[0];
      io.to(initiatorId).emit("initiate-offer", { roomId, peerId: socket.id });
      console.log(`🎬 ${initiatorId} doit créer l’offre pour ${socket.id}`);
    }

    io.to(roomId).emit("user-joined", { id: socket.id });
  });

  /* ---------------- LEAVE ROOM ---------------- */
  socket.on("leave-room", (roomId) => {
    console.log(`🚪 ${socket.id} quitte la salle : ${roomId}`);
    socket.leave(roomId);

    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;
    io.to(roomId).emit("room-users", { count });
    console.log(`👥 Room ${roomId}: ${count} utilisateur(s) restants`);
  });

  /* ===========================================================
     🔁 Signaling WebRTC — avec logs
  =========================================================== */
  socket.on("offer", ({ roomId, offer }) => {
    console.log(`📨 Offre reçue de ${socket.id} → relayée à ${roomId}`);
    socket.to(roomId).emit("offer", { roomId, offer });
  });

  socket.on("answer", ({ roomId, answer }) => {
    console.log(`📨 Réponse reçue de ${socket.id} → relayée à ${roomId}`);
    socket.to(roomId).emit("answer", { roomId, answer });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    console.log(`🧊 ICE candidate reçue → relayée à ${roomId}`);
    socket.to(roomId).emit("ice-candidate", { roomId, candidate });
  });

  /* ---------------- DISCONNECT ---------------- */
  socket.on("disconnect", (reason) => {
    console.log(`🔴 Déconnexion ${socket.id} (${reason})`);
  });
});

/* ===========================================================
   🚀 Lancement du serveur
=========================================================== */
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`✅ Socket.IO Server opérationnel sur le port ${PORT}`);
});
