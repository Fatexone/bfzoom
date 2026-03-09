"use client";

import { Suspense } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import VideoConferenceContent from "@/components/video/VideoConferenceContent";
import UiLocaleSwitch from "@/components/ui/UiLocaleSwitch";
import { useUiLocale } from "@/components/ui/UiLocaleProvider";

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
  const searchParams = useSearchParams();
  const roomId = (searchParams.get("room") || "").trim();
  const isRoomView = roomId.length > 0;

  return (
    <div
      className={`relative text-slate-900 ${
        isRoomView
          ? "h-[100dvh] min-h-[100dvh] bg-slate-950"
          : "min-h-screen bg-gradient-to-b from-blue-50 via-sky-50 to-sky-100"
      }`}
    >
      <div className="absolute right-4 top-4 z-20">
        <UiLocaleSwitch />
      </div>
      <main
        className={`flex flex-1 flex-col items-center ${
          isRoomView
            ? "h-full min-h-0 justify-stretch p-0"
            : "justify-center px-4 py-6 sm:px-8 sm:py-10"
        }`}
      >
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className={isRoomView ? "h-full w-full max-w-none" : "w-full max-w-6xl"}
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
  const { locale } = useUiLocale();
  const loadingLabel =
    locale === "fr" ? "Chargement de la visioconférence…" : "Loading video conference…";

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
        <p className="text-sm font-medium">{loadingLabel}</p>
      </motion.div>
    </div>
  );
}
