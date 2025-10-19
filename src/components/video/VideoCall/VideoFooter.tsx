"use client";

import { motion } from "framer-motion";
import { Wifi } from "lucide-react";

export default function VideoFooter() {
  const year = new Date().getFullYear();

  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="
        w-full text-center py-3 sm:py-4
        bg-gradient-to-t from-black/60 via-black/40 to-transparent
        border-t border-white/10
        backdrop-blur-md
        text-gray-400 text-xs sm:text-sm
        tracking-wide select-none
      "
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 px-4">
        {/* === Branding principal === */}
        <motion.p
          className="font-light text-[11px] sm:text-xs text-gray-400"
          whileHover={{ scale: 1.03, color: "#9ca3af" }}
        >
          © {year} — <span className="text-blue-400 font-medium">BFZoom</span>.
          Tous droits réservés.
        </motion.p>

        {/* === Séparateur visuel === */}
        <div className="hidden sm:block w-px h-4 bg-white/10" />

        {/* === État de connexion / option réseau === */}
        <motion.div
          className="flex items-center gap-1.5 text-[11px] sm:text-xs text-gray-500"
          whileHover={{ scale: 1.05 }}
        >
          <Wifi className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-500" />
          <span className="tracking-tight">Connexion stable</span>
        </motion.div>
      </div>
    </motion.footer>
  );
}
