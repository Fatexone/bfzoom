const { io } = require("socket.io-client");

const SOCKET_URL = "https://bfzoom-socket.onrender.com";
const ROOM_ID = process.argv[2] || "test-room";

const socket = io(SOCKET_URL, {
  path: "/socket.io",
  transports: ["websocket"],
  reconnectionAttempts: 2,
});

socket.on("connect", () => {
  console.log("✅ Connecté:", socket.id);
  socket.emit("join-room", ROOM_ID);
  console.log("➡️  join-room:", ROOM_ID);
});

socket.on("room-users", (p) => console.log("�� room-users:", p));
socket.on("user-joined", (p) => console.log("🟢 user-joined:", p));
socket.on("offer", () => console.log("📨 offer reçu"));
socket.on("answer", () => console.log("📨 answer reçu"));
socket.on("ice-candidate", () => console.log("❄️ ice reçu"));
socket.on("disconnect", (r) => console.log("🔌 disconnect:", r));
socket.on("connect_error", (e) => console.log("❌ connect_error:", e.message || e));