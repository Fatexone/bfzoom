"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRouter, useSearchParams } from "next/navigation";
import VideoConferenceContent from "@/components/video/VideoConferenceContent";
import { getAiPracticeViewportProfile } from "@/components/video/useAiPracticeViewportProfile";
import UiLocaleSwitch from "@/components/ui/UiLocaleSwitch";
import { useUiLocale } from "@/components/ui/UiLocaleProvider";
import {
  buildConferenceMobileAppHref,
  resolvePreferredMobileStoreUrl,
} from "@/lib/mobileVideoLinks";

/* =======================================================
   🎥 PAGE VISIO — fond bleu clair, responsive, menu déroulant
======================================================= */
export default function VideoConferencePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <VideoConferenceRoute />
    </Suspense>
  );
}

function VideoConferenceRoute() {
  const searchParams = useSearchParams();
  const [isPhoneViewport, setIsPhoneViewport] = useState<boolean | null>(null);
  const wantsAiExercise = searchParams.get("exercise") === "1";
  const inviteId = (searchParams.get("invite") || "").trim();
  const guestName =
    (searchParams.get("name") || searchParams.get("guest") || "").trim();
  const allowPhoneWeb = searchParams.get("web") === "1";

  useEffect(() => {
    const apply = () => setIsPhoneViewport(getAiPracticeViewportProfile().isPhone);
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
    };
  }, []);

  if (wantsAiExercise) {
    return <ExerciseRedirect />;
  }

  if (isPhoneViewport === null) {
    return <LoadingFallback />;
  }

  if (isPhoneViewport && !allowPhoneWeb) {
    return <MobileWebConferenceGate inviteId={inviteId} guestName={guestName} />;
  }

  return (
    <ResponsiveLayout>
      <VideoConferenceContent />
    </ResponsiveLayout>
  );
}

function MobileWebConferenceGate({
  inviteId,
  guestName,
}: {
  inviteId: string;
  guestName: string;
}) {
  const searchParams = useSearchParams();
  const { locale } = useUiLocale();
  const [preferredStoreUrl, setPreferredStoreUrl] = useState("");
  const openAppHref = useMemo(
    () => buildConferenceMobileAppHref({ inviteId, guestName }),
    [guestName, inviteId]
  );
  const continueOnWebHref = useMemo(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("web", "1");
    return `/videoconference?${nextParams.toString()}`;
  }, [searchParams]);

  useEffect(() => {
    setPreferredStoreUrl(resolvePreferredMobileStoreUrl());
  }, []);
  const isInviteFlow = inviteId.length > 0;
  const title =
    locale === "fr"
      ? "Utilise l'app BFZoom sur telephone"
      : "Use the BFZoom app on phone";
  const description =
    locale === "fr"
      ? isInviteFlow
        ? "Cette invitation fonctionne mieux dans l'app BFZoom. Le web mobile n'est pas une experience visio fiable."
        : "La visioconference BFZoom n'est pas prise en charge correctement sur navigateur mobile. Ouvre l'app pour appeler ou creer une salle."
      : isInviteFlow
      ? "This invite works best in the BFZoom app. Mobile web is not a reliable calling experience."
      : "BFZoom video calls are not properly supported in mobile browsers. Open the app to call or create a room.";
  const primaryLabel = locale === "fr" ? "Ouvrir l'app BFZoom" : "Open the BFZoom app";
  const downloadLabel = locale === "fr" ? "Telecharger l'app" : "Download the app";
  const webLabel =
    locale === "fr"
      ? "Continuer quand meme sur le web"
      : "Continue on the web anyway";
  const helper =
    locale === "fr"
      ? "Mode secours seulement. Sur smartphone, la visio BFZoom est prevue pour l'app."
      : "Fallback mode only. On smartphones, BFZoom calls are designed for the app.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-linear-to-b from-slate-950 via-slate-900 to-slate-950 px-4 py-8 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-black/35 p-6 shadow-2xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">BFZoom</p>
        <h1 className="mt-3 text-2xl font-semibold text-white">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-300">{description}</p>
        <a
          href={openAppHref}
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
        >
          {primaryLabel}
        </a>
        {preferredStoreUrl ? (
          <a
            href={preferredStoreUrl}
            className="mt-2 flex w-full items-center justify-center rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            {downloadLabel}
          </a>
        ) : null}
        <Link
          href={continueOnWebHref}
          className="mt-2 flex w-full items-center justify-center rounded-xl border border-slate-600 bg-transparent px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
        >
          {webLabel}
        </Link>
        <p className="mt-3 text-[11px] leading-relaxed text-slate-400">{helper}</p>
      </div>
    </div>
  );
}

function ExerciseRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useUiLocale();

  const targetHref = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of searchParams.entries()) {
      if (key === "exercise" || key === "host" || key === "create") continue;
      params.set(key, value);
    }
    const search = params.toString();
    return `/exercice-ia${search ? `?${search}` : ""}`;
  }, [searchParams]);

  useEffect(() => {
    router.replace(targetHref);
  }, [router, targetHref]);

  const label =
    locale === "fr"
      ? "Redirection vers AI Practice..."
      : "Redirecting to AI Practice...";

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/65 p-6 text-center shadow-xl backdrop-blur">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
        <p className="text-sm font-semibold text-slate-100">{label}</p>
      </div>
    </div>
  );
}

/* =======================================================
   🧱 Layout clair & responsive avec menu burger
======================================================= */
function ResponsiveLayout({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const roomId = (searchParams.get("room") || "").trim();
  const inviteId = (searchParams.get("invite") || "").trim();
  const isRoomView = roomId.length > 0 || inviteId.length > 0;

  return (
    <div
      className={`relative text-slate-900 ${
        isRoomView
          ? "h-dvh min-h-dvh bg-slate-950"
          : "min-h-screen bg-linear-to-b from-blue-50 via-sky-50 to-sky-100"
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-linear-to-b from-blue-50 via-sky-50 to-sky-100 text-slate-700">
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
