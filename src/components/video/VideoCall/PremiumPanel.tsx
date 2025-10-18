// src/components/video/VideoCall/PremiumPanel.tsx
"use client";

import { motion } from "framer-motion";
import Timer from "@/components/video/timer/Timer";
import OpenAIEspace from "@/components/video/panels/OpenAIEspace";

export default function PremiumPanel() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-4xl flex flex-col md:flex-row justify-center items-center gap-6 px-4 py-6 bg-black/40 backdrop-blur-md border-t border-white/10"
    >
      <div className="flex-1 flex justify-center">
        <Timer />
      </div>
      <div className="flex-1 flex justify-center">
        <OpenAIEspace />
      </div>
    </motion.div>
  );
}
