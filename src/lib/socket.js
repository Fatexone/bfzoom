// src/lib/socket.js
import { io } from "socket.io-client";

// 🌍 Configuration dynamique depuis .env (ou fallback public)
const DEFAULT_SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL?.replace(/\/$/, "") ||
  "https://socket.bfzoom.fr"; // fallback public
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";

// 🧩 Instance unique (évite les doublons HMR en dev)
let socketInstance;

if (typeof window !== "undefined") {
  if (!window.__bfzoom_socket__) {
    // Utilise l’URL fournie (env) ou le fallback public. Pour un socket local, définis NEXT_PUBLIC_SOCKET_URL.
    const socketUrl = DEFAULT_SOCKET_URL;

    const socket = io(socketUrl, {
      path: SOCKET_PATH,
      // Démarre en polling (tolérant aux proxys) puis upgrade WS si possible.
      transports: ["polling", "websocket"],
      secure: socketUrl.startsWith("https://"),
      withCredentials: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
      autoConnect: true,
    });

    // === Logs diagnostics ===
    socket.on("connect", () => {
      console.log("✅ [BFZoom] Socket connectée :", socketUrl);
    });

    socket.on("disconnect", (reason) => {
      console.warn("⚠️ [BFZoom] Socket déconnectée :", reason);
    });

    socket.on("connect_error", (err) => {
      console.error("❌ [BFZoom] Erreur Socket.IO :", err?.message, {
        description: err?.description,
        transport: err?.transport,
      });
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