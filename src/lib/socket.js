// src/lib/socket.js
import { io } from "socket.io-client";

// 🌍 Configuration dynamique depuis .env
const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL?.replace(/\/$/, "") ||
  "https://vps-ac6b333d.vps.ovh.net"; // HTTPS par défaut
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";

// 🧩 Instance unique (évite les doublons HMR en dev)
let socketInstance;

if (typeof window !== "undefined") {
  if (!window.__bfzoom_socket__) {
    const socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ["websocket"], // ✅ WebSocket pur, pas polling
      secure: true, // ✅ obligatoire sur HTTPS / Vercel
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
      autoConnect: true,
      extraHeaders: {
        Origin: "https://bfzoom.vercel.app", // aide CORS côté serveur
      },
    });

    // === Logs diagnostics ===
    socket.on("connect", () => {
      console.log("✅ [BFZoom] Socket connectée :", SOCKET_URL);
    });

    socket.on("disconnect", (reason) => {
      console.warn("⚠️ [BFZoom] Socket déconnectée :", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("❌ [BFZoom] Erreur Socket.IO :", err.message);
    });

    socket.on("reconnect_attempt", (n) => {
      if (n % 3 === 0) console.log("↻ Tentative de reconnexion", n);
    });

    // 🔍 expose pour debug
    window.__bfzoom_socket__ = socket;
  }

  socketInstance = window.__bfzoom_socket__;
}

// ✅ Export propre pour tous les imports client-side
export const socket = socketInstance;

// (Optionnel) accès debug dans la console
if (typeof window !== "undefined") window.__socket = socketInstance;
