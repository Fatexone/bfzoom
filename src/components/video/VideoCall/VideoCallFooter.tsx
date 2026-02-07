"use client";

import { motion } from "framer-motion";
import { Wifi } from "lucide-react";

export default function VideoCallFooter() {
  const year = new Date().getFullYear();

  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="
        w-full text-center py-3 sm:py-4
        bg-white/70 border-t border-sky-200
        backdrop-blur
        text-slate-500 text-xs sm:text-sm
        tracking-wide select-none
      "
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 px-4">
        <motion.p className="font-light text-[11px] sm:text-xs">
          © {year} — <span className="text-blue-600 font-medium">BFZoom</span>. Tous droits
          réservés.
        </motion.p>

        <div className="hidden sm:block w-px h-4 bg-slate-300/60" />

        <motion.div className="flex items-center gap-1.5 text-[11px] sm:text-xs">
          <Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          <span className="tracking-tight">Connexion stable</span>
        </motion.div>
      </div>
    </motion.footer>
  );
}