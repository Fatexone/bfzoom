"use client";

import { Suspense } from "react";
import { motion } from "framer-motion";
import VideoConferenceContent from "@/components/video/VideoConferenceContent";

/* =======================================================
   🎥 PAGE VISIO — fond bleu clair, responsive, menu déroulant
======================================================= */
export default function VideoConferencePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ResponsiveLayout>
        <VideoConferenceContent />
      </ResponsiveLayout>
    </Suspense>
  );
}

/* =======================================================
   🧱 Layout clair & responsive avec menu burger
======================================================= */
function ResponsiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-sky-50 to-sky-100 text-slate-900">
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-6xl"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

/* =======================================================
   ⏳ Fallback de chargement léger & clair
======================================================= */
function LoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-blue-50 via-sky-50 to-sky-100 text-slate-700">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col items-center gap-4"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full"
        />
        <p className="text-sm font-medium">Chargement de la visioconférence…</p>
      </motion.div>
    </div>
  );
}