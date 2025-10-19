"use client";

import { Suspense } from "react";
import VideoConferenceContent from "@/components/video/VideoConferenceContent";

/* =======================================================
   📹 Page principale — wrapper avec Suspense
   (corrige l’erreur useSearchParams sans boundary)
======================================================= */
export default function VideoConferencePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-black text-white text-lg">
          Chargement de la visioconférence...
        </div>
      }
    >
      <VideoConferenceContent />
    </Suspense>
  );
}
