// src/lib/socket.js
import { io } from "socket.io-client";

// ⚙️ URL + path (laisse /socket.io si tu ne changes rien côté serveur)
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";

// ✅ Création unique de l’instance Socket.IO (évite les doublons HMR)
let socketInstance;

if (typeof window !== "undefined") {
  if (!window.__bfzoom_socket__) {
    const socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ["websocket"], // 🔒 WebSocket only pour Render/Vercel
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      autoConnect: true,
    });

    // === Log & diagnostics ===
    socket.on("connect", () => {
      console.log("✅ [BFZoom] Socket connecté →", SOCKET_URL);
    });

    socket.on("disconnect", (reason) => {
      console.warn("⚠️ [BFZoom] Socket déconnecté :", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("❌ [BFZoom] Erreur Socket.IO :", err.message);
    });

    socket.on("reconnect_attempt", (n) => {
      if (n % 3 === 0) console.log("↻ Tentative de reconnexion", n);
    });

    // 🔍 Expose pour le debug console
    window.__bfzoom_socket__ = socket;
  }

  socketInstance = window.__bfzoom_socket__;
}

// ✅ Export propre pour tous les imports client-side
export const socket = socketInstance;

// (Optionnel) Export debug
if (typeof window !== "undefined") window.__socket = socketInstance;
