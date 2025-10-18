// src/lib/socket.js
import { io } from "socket.io-client";

// ⚙️ URL + path (laisse /socket.io si tu ne changes rien côté serveur)
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH || "/socket.io";

// ✅ Évite les connexions multiples en dev (HMR Next.js)
if (typeof window !== "undefined") {
  // @ts-expect-error: on étend globalThis pour stocker le singleton
  if (!globalThis.__bfzoom_socket__) {
    // Création de l’instance unique
    // NB: transports WebSocket pour éviter le long-polling sur hébergeurs serverless
    // Ajuste la stratégie de reconnexion pour la prod
    const s = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ["websocket"],
      withCredentials: false,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000, // délai de connexion initiale
    });

    s.on("connect", () => {
      console.log("✅ Socket.IO connecté:", SOCKET_URL);
    });

    s.on("connect_error", (err) => {
      console.error("❌ Erreur Socket.IO:", err?.message || err);
    });

    s.on("reconnect_attempt", (n) => {
      if (n % 5 === 0) console.log("↻ Tentative de reconnexion:", n);
    });

   
    globalThis.__bfzoom_socket__ = s;
  }
}


export const socket = typeof window !== "undefined" ? globalThis.__bfzoom_socket__ : null;
