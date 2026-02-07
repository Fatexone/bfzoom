// server/socket/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

/**
 * ENV utiles (optionnels) :
 * - PORT=4001
 * - SOCKET_CORS_ORIGIN=https://ton-front-prod (sinon * par défaut)
 */

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4001;

const corsOrigin = process.env.SOCKET_CORS_ORIGIN || "*";
const corsOrigins =
  corsOrigin === "*"
    ? "*"
    : corsOrigin.split(",").map((o) => o.trim()).filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: corsOrigins,
    methods: ["GET", "POST"],
  },
});

// 👩‍⚕️ Healthcheck simple
app.get("/health", (_req, res) => res.status(200).send("ok"));

console.log("🚀 Socket.IO Server BFZoom démarré...");

/**
 * Mémoire rooms (ephemeral) :
 * rooms = Map<roomId, { hostId: string, participants: Set<string> }>
 * - hostId : premier socket entrant ; si le host part -> room fermée (room-closed)
 * - participants : socketIds actuellement dans la room
 */
const rooms = new Map();

/* =======================================================
   🔧 Helpers
======================================================= */
const getParticipants = (roomId) => {
  const r = rooms.get(roomId);
  return r ? Array.from(r.participants) : [];
};

const ensureRoom = (roomId) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { hostId: null, participants: new Set() });
  }
  return rooms.get(roomId);
};

const removeFromRoom = (roomId, socketId) => {
  const r = rooms.get(roomId);
  if (!r) return;
  r.participants.delete(socketId);
  if (r.participants.size === 0) {
    rooms.delete(roomId); // salle vide -> suppression mémoire
  }
};

const isInSameRoom = (roomId, socketId) => {
  const r = rooms.get(roomId);
  return !!(r && r.participants.has(socketId));
};

/* =======================================================
   🔌 Connexions Socket.IO
======================================================= */
io.on("connection", (socket) => {
  console.log("🟢 Nouveau client :", socket.id);

  /**
   * 🏠 JOIN-ROOM
   * payload accepté : string | { roomId: string, displayName?: string }
   */
  socket.on("join-room", (payload) => {
    const roomId = typeof payload === "string" ? payload : payload?.roomId;
    if (!roomId) return;

    // On adhère au room niveau Socket.IO
    socket.join(roomId);

    // On garantit l'existence de la room mémoire et on ajoute le participant
    const r = ensureRoom(roomId);
    if (!r.hostId) r.hostId = socket.id; // premier arrivé = host
    r.participants.add(socket.id);

    // Rôle host/creator pour le socket entrant
    const isCreator = socket.id === r.hostId;
    socket.emit("room-role", { isCreator, hostId: r.hostId });

    // Liste des participants mise à jour pour tout le monde
    const participants = getParticipants(roomId);
    io.to(roomId).emit("room-users", {
      participants,
      count: participants.length,
      hostId: r.hostId,
    });

    // Informer les autres qu'un utilisateur vient d'arriver
    socket.to(roomId).emit("user-joined", { id: socket.id });

    console.log(`👥 Room ${roomId}: ${participants.length} client(s) | host=${r.hostId}`);
  });

  /**
   * 🚪 LEAVE-ROOM (départ volontaire)
   */
  socket.on("leave-room", (roomId) => {
    if (!roomId) return;

    // Retirer côté mémoire
    const r = rooms.get(roomId);
    if (!r) {
      socket.leave(roomId);
      return;
    }

    const wasHost = socket.id === r.hostId;
    removeFromRoom(roomId, socket.id);

    // Quitter la room Socket.IO
    socket.leave(roomId);

    if (wasHost) {
      // Host quitte → fermer la salle pour tous
      console.log(`🏁 Host ${socket.id} a quitté ${roomId} → fermeture de la salle`);
      io.to(roomId).emit("room-closed", { reason: "host_left" });

      // Retirer tout le monde de la room côté Socket.IO (nettoyage)
      io.in(roomId).socketsLeave(roomId);

      // Supprimer définitivement la room mémoire
      rooms.delete(roomId);
    } else {
      // Participant normal
      socket.to(roomId).emit("user-left", { id: socket.id });
      const participants = getParticipants(roomId);
      io.to(roomId).emit("room-users", {
        participants,
        count: participants.length,
        hostId: r.hostId,
      });
      console.log(`🚪 ${socket.id} a quitté ${roomId} (restants: ${participants.length})`);
    }
  });

  /**
   * 📡 SIGNALISATION WebRTC (ciblée par socketId)
   * payload attendu :
   * - offer:        { roomId, to, sdp }
   * - answer:       { roomId, to, sdp }
   * - ice-candidate:{ roomId, to, candidate }
   * Le serveur vérifie que 'to' et 'from' sont bien dans la même room.
   */
  socket.on("offer", ({ roomId, to, sdp }) => {
    if (!roomId || !to || !sdp) return;
    if (!isInSameRoom(roomId, socket.id) || !isInSameRoom(roomId, to)) return;

    io.to(to).emit("offer", { from: socket.id, sdp });
    // console.log(`📨 offer ${socket.id} → ${to} [${roomId}]`);
  });

  socket.on("answer", ({ roomId, to, sdp }) => {
    if (!roomId || !to || !sdp) return;
    if (!isInSameRoom(roomId, socket.id) || !isInSameRoom(roomId, to)) return;

    io.to(to).emit("answer", { from: socket.id, sdp });
    // console.log(`📨 answer ${socket.id} → ${to} [${roomId}]`);
  });

  socket.on("ice-candidate", ({ roomId, to, candidate }) => {
    if (!roomId || !to || !candidate) return;
    if (!isInSameRoom(roomId, socket.id) || !isInSameRoom(roomId, to)) return;

    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
    // console.log(`🧊 ice ${socket.id} → ${to} [${roomId}]`);
  });

  /**
   * 💬 Chat texte (room-wide)
   */
  socket.on("chat-message", ({ roomId, msg }) => {
    if (!roomId || !msg) return;
    // { sender, text, ts? }
    io.to(roomId).emit("chat-message", msg);
  });

  /**
   * 🔌 Déconnexion : parcourir toutes les rooms du socket
   * et appliquer la même logique que leave-room, en sécurité.
   */
  socket.on("disconnecting", () => {
    // socket.rooms contient aussi socket.id → on filtre
    for (const roomId of socket.rooms) {
      if (roomId === socket.id) continue;

      const r = rooms.get(roomId);
      if (!r) {
        // quitter la room IO au cas où
        socket.leave(roomId);
        continue;
      }

      const wasHost = socket.id === r.hostId;
      removeFromRoom(roomId, socket.id);
      socket.leave(roomId);

      if (wasHost) {
        console.log(`🏁 Host ${socket.id} déconnecté de ${roomId} → fermeture de la salle`);
        io.to(roomId).emit("room-closed", { reason: "host_left" });
        io.in(roomId).socketsLeave(roomId);
        rooms.delete(roomId);
      } else {
        socket.to(roomId).emit("user-left", { id: socket.id });
        const participants = getParticipants(roomId);
        if (rooms.has(roomId)) {
          io.to(roomId).emit("room-users", {
            participants,
            count: participants.length,
            hostId: r.hostId,
          });
        }
      }
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Déconnecté :", socket.id);
  });
});

/* =======================================================
   🚀 Start
======================================================= */
server.listen(PORT, () => {
  console.log(`✅ Socket.IO prêt sur le port ${PORT}`);
});