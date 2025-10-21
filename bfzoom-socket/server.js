// server.js (ESM)
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);

/* ===========================================================
   ⚙️ Configuration Socket.IO (CORS HTTPS)
=========================================================== */
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://bfzoom.vercel.app",        // Front (Vercel)
      "https://vps-ac6b333d.vps.ovh.net", // Serveur Socket (OVH)
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

/* ===========================================================
   🌐 Endpoint de test
=========================================================== */
app.get("/", (_req, res) => {
  res.send("🚀 Serveur Socket.IO BFZoom actif et prêt !");
});

/* ===========================================================
   🎥 GESTION DES ROOMS — version stable et synchrone
=========================================================== */
io.on("connection", (socket) => {
  console.log("🟢 Client connecté :", socket.id);

  /* ---------------- JOIN ROOM ---------------- */
  socket.on("join-room", (roomId) => {
    console.log(`➡️ ${socket.id} rejoint la salle : ${roomId}`);
    socket.join(roomId);

    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;

    // ✅ Détermine si c’est le créateur
    const isCreator = count === 1;
    socket.emit("room-role", { isCreator });

    // 🔁 Informe tous les membres de la room du nouveau total
    io.to(roomId).emit("room-users", { count });
    console.log(`👥 Room ${roomId}: ${count} utilisateur(s)`);

    // 👑 Si 2 utilisateurs → demande explicite de création d’offre
    if (count === 2) {
      const creatorSocketId = Array.from(room)[0]; // premier = créateur
      console.log(
        `🎬 Demande à ${creatorSocketId} de créer l’offre pour ${socket.id}`
      );
      io.to(creatorSocketId).emit("create-offer");
    }
  });

  /* ---------------- LEAVE ROOM ---------------- */
  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
    console.log(`🚪 ${socket.id} quitte la salle : ${roomId}`);

    const room = io.sockets.adapter.rooms.get(roomId);
    const count = room ? room.size : 0;

    io.to(roomId).emit("room-users", { count });
    console.log(`👥 Room ${roomId}: ${count} utilisateur(s) restants`);
  });

  /* ===========================================================
     🔁 Signaling WebRTC — transmission offer/answer/ICE
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
  console.log(`✅ Socket.IO server opérationnel sur le port ${PORT}`);
});
