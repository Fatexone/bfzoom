"use client";

import { Suspense } from "react";
import AiExerciseSession from "@/components/video/AiExerciseSession";
import { useUiLocale } from "@/components/ui/UiLocaleProvider";

export default function ExerciceIaPage() {
  return (
    <Suspense fallback={<ExerciseLoadingFallback />}>
      <AiExerciseSession
        basePath="/exercice-ia"
        backHref="/dashboard"
        leaveHref="/dashboard"
      />
    </Suspense>
  );
}

function ExerciseLoadingFallback() {
  const { locale } = useUiLocale();
  const label =
    locale === "fr" ? "Chargement de l'exercice IA..." : "Loading AI exercise...";

  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/65 p-6 text-center shadow-xl backdrop-blur">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        <p className="text-sm font-semibold text-slate-100">{label}</p>
      </div>
    </div>
  );
}
