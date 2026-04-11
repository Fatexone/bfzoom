"use client";

import { motion } from "framer-motion";
import { Users, Power } from "lucide-react";

export default function VideoCallHeader({
  roomId: _roomId,
  userCount,
  onLeave,
}: {
  roomId: string;
  userCount: number;
  onLeave: () => void;
}) {
  const connectionStatus =
    userCount > 1 ? "En cours" : userCount === 1 ? "En attente" : "Vide";

  const connectionColor =
    userCount > 1 ? "bg-green-500" : userCount === 1 ? "bg-yellow-500" : "bg-red-500";

  return (
    <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            BFZoom
          </h2>

          <p className="text-sm text-slate-600 mt-1 flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${connectionColor}`} />
            {connectionStatus} — {userCount}{" "}
            {userCount > 1 ? "participants" : "participant"}
          </p>
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.9 }}
        whileHover={{ scale: 1.05 }}
        transition={{ duration: 0.15 }}
        onClick={onLeave}
        className="
          flex items-center justify-center gap-2
          bg-red-600 hover:bg-red-700 text-white
          px-4 py-2 rounded-xl font-medium
          transition-all duration-200 ease-out
          focus:outline-none focus:ring-2 focus:ring-red-500/40
          active:scale-95
        "
      >
        <Power className="w-5 h-5" />
        <span className="text-sm sm:text-base">Quitter</span>
      </motion.button>

      <div className="absolute right-0 -bottom-5 sm:hidden flex items-center gap-1 text-xs text-gray-500">
        <Users className="w-3.5 h-3.5" />
        {userCount}
      </div>
    </div>
  );
}
