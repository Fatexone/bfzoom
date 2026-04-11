"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { ChevronDown, ChevronUp } from "lucide-react";
import VideoCall from "@/components/video/VideoCall";
import AiPracticeNotebookDrawer from "@/components/video/AiPracticeNotebookDrawer";
import AiPracticeRealtimeShell from "@/components/video/AiPracticeRealtimeShell";
import { useAiPracticeViewportProfile } from "@/components/video/useAiPracticeViewportProfile";
import UiLocaleSwitch from "@/components/ui/UiLocaleSwitch";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";
import { auth } from "@/lib/firebaseConfig";
import { setAuthGuardCookie } from "@/lib/authGuard";
import {
  AI_PRACTICE_NOTEBOOK_OPEN_EVENT,
  AI_PRACTICE_NOTEBOOK_UPDATED_EVENT,
} from "@/lib/aiPracticeNotebook";
import { buildCreditsPageHref } from "@/lib/creditPacks";
import {
  TRANSLATION_ENTITLEMENT_UPDATED_EVENT,
  type TranslationEntitlementUpdateDetail,
} from "@/lib/translationEntitlementEvents";

type GuideStepId = "speak" | "coach" | "tools" | "notebook";

type AiExerciseGuideStepCopy = {
  id: GuideStepId;
  title: string;
  detail: string;
};

type AiExerciseSessionCopy = {
  loadingSession: string;
  loadingExercise: string;
  checkingMinutes: string;
  backLabel: string;
  creditsRemaining: string;
  consumedThisSession: string;
  buyCredits: string;
  notebook: string;
  realtimeOff: string;
  realtimeOn: string;
  lockedTitle: string;
  lockedMessage: string;
  lockedOverlayTitle: string;
  lockedOverlayMessage: string;
  retryMinutesCheck: string;
  unlimitedLabel: string;
  guideTitle: string;
  guideShow: string;
  guideHide: string;
  guideCurrent: string;
  guideNext: string;
  guideContextDefault: string;
  guideContextRealtime: string;
  guideSteps: AiExerciseGuideStepCopy[];
};

type AiExerciseSessionProps = {
  basePath: string;
  backHref: string;
  leaveHref: string;
  stickyParams?: Record<string, string>;
};

const COPY: Record<UiLocale, AiExerciseSessionCopy> = {
  fr: {
    loadingSession: "Chargement de la session...",
    loadingExercise: "Ouverture de l'exercice IA en cours...",
    checkingMinutes: "Verification des minutes AI Practice...",
    backLabel: "Retour au dashboard",
    creditsRemaining: "Credits restants",
    consumedThisSession: "Consomme (session)",
    buyCredits: "Acheter des credits",
    notebook: "Carnet",
    realtimeOff: "Realtime web beta",
    realtimeOn: "Realtime web: on",
    lockedTitle: "AI Practice nécessite des minutes actives",
    lockedMessage:
      "Tes 3 minutes offertes sont épuisées et tu n’as plus de minutes BFZoom actives. Recharge pour lancer une nouvelle session IA.",
    lockedOverlayTitle: "Session IA en pause",
    lockedOverlayMessage:
      "Tu n’as plus de minutes actives. Recharge pour reprendre AI Practice. L’écran d’exercice reste ouvert, mais l’expérience est bloquée tant que le solde n’est pas rétabli.",
    retryMinutesCheck: "Reverifier mes minutes",
    unlimitedLabel: "Illimite",
    guideTitle: "Guide rapide",
    guideShow: "Afficher",
    guideHide: "Masquer",
    guideCurrent: "Maintenant",
    guideNext: "Ensuite",
    guideContextDefault:
      "Avance etape par etape pour pratiquer sans te perdre dans l’interface.",
    guideContextRealtime:
      "L’echange est en cours. Parle, lis la reponse coach, puis ajuste-la si besoin.",
    guideSteps: [
      {
        id: "speak",
        title: "Parle dans ta langue de base",
        detail:
          "Commence dans ta langue de base pour declencher la reponse du coach IA.",
      },
      {
        id: "coach",
        title: "Lis la reponse dans la langue a travailler",
        detail:
          "Observe la proposition du coach IA puis reformule-la avant de repondre.",
      },
      {
        id: "tools",
        title: "Utilise les aides rapides",
        detail:
          "Appuie sur Traduire, Lire ou Phonetique quand tu bloques sur une formulation.",
      },
      {
        id: "notebook",
        title: "Sauvegarde les meilleures phrases",
        detail:
          "Ajoute au Carnet uniquement les phrases utiles a rejouer et memoriser.",
      },
    ],
  },
  en: {
    loadingSession: "Loading session...",
    loadingExercise: "Opening AI exercise...",
    checkingMinutes: "Checking AI Practice minutes...",
    backLabel: "Back to dashboard",
    creditsRemaining: "Credits remaining",
    consumedThisSession: "Consumed (session)",
    buyCredits: "Buy credits",
    notebook: "Notebook",
    realtimeOff: "Web realtime beta",
    realtimeOn: "Web realtime: on",
    lockedTitle: "AI Practice requires active minutes",
    lockedMessage:
      "Your 3 free minutes are used up and you have no active BFZoom minutes left. Top up to start a new AI session.",
    lockedOverlayTitle: "AI session paused",
    lockedOverlayMessage:
      "You no longer have active minutes. Top up to resume AI Practice. The exercise screen stays open, but the experience is locked until your balance is restored.",
    retryMinutesCheck: "Check my minutes again",
    unlimitedLabel: "Unlimited",
    guideTitle: "Quick guide",
    guideShow: "Show",
    guideHide: "Hide",
    guideCurrent: "Now",
    guideNext: "Next",
    guideContextDefault:
      "Move step by step so the exercise stays clear and easy to follow.",
    guideContextRealtime:
      "The exchange is live. Speak, read the coach reply, then refine it if needed.",
    guideSteps: [
      {
        id: "speak",
        title: "Speak in your base language",
        detail:
          "Start in your base language to trigger the AI coach response.",
      },
      {
        id: "coach",
        title: "Read the reply in the target language",
        detail:
          "Review the coach answer, then refine it before responding.",
      },
      {
        id: "tools",
        title: "Use the quick tools",
        detail:
          "Use Translate, Play, or Phonetics whenever you get stuck on phrasing.",
      },
      {
        id: "notebook",
        title: "Save the best phrases",
        detail:
          "Add only the useful phrases to the Notebook so you can replay and memorize them.",
      },
    ],
  },
};

const generateRoomId = () => `room-${Math.random().toString(36).slice(2, 8)}`;

const formatExactDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

export default function AiExerciseSession({
  basePath,
  backHref,
  leaveHref,
  stickyParams = {},
}: AiExerciseSessionProps) {
  const { locale } = useUiLocale();
  const t = COPY[locale];
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomFromQuery = searchParams.get("room")?.trim() || "";
  const [roomId, setRoomId] = useState<string | null>(roomFromQuery || null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [exerciseStartRemainingSeconds, setExerciseStartRemainingSeconds] = useState<number | null>(
    null
  );
  const [entitlementLoading, setEntitlementLoading] = useState(true);
  const [entitlementChecked, setEntitlementChecked] = useState(false);
  const [aiPracticeAllowed, setAiPracticeAllowed] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isAdminEntitlement, setIsAdminEntitlement] = useState(false);
  const [isPremiumEntitlement, setIsPremiumEntitlement] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [realtimeWebEnabled, setRealtimeWebEnabled] = useState(false);
  const [realtimeWebLoaded, setRealtimeWebLoaded] = useState(false);
  const [mobileHudExpanded, setMobileHudExpanded] = useState(true);
  const [guideOpen, setGuideOpen] = useState(true);
  const [guidePreferenceLoaded, setGuidePreferenceLoaded] = useState(false);
  const viewportProfile = useAiPracticeViewportProfile();
  const compactViewport = viewportProfile.isPhone;

  const buildRoomHref = useCallback(
    (nextRoomId?: string | null) => {
      const params = new URLSearchParams();
      const stickyKeys = new Set(Object.keys(stickyParams));

      for (const [key, value] of Object.entries(stickyParams)) {
        if (!value) continue;
        params.set(key, value);
      }

      for (const [key, value] of searchParams.entries()) {
        if (key === "room" || key === "host") continue;
        if (stickyKeys.has(key)) continue;
        params.set(key, value);
      }

      if (nextRoomId?.trim()) {
        params.set("room", nextRoomId.trim());
      }

      const search = params.toString();
      return `${basePath}${search ? `?${search}` : ""}`;
    },
    [basePath, searchParams, stickyParams]
  );

  const returnToPracticeHref = buildRoomHref(roomId);
  const compactBackLabel = locale === "fr" ? "Retour" : "Back";
  const compactCreditsLabel = locale === "fr" ? "Credits" : "Credits";
  const hasUnlimitedEntitlement =
    isAdminEntitlement ||
    isPremiumEntitlement ||
    (typeof remainingSeconds === "number" && remainingSeconds >= Number.MAX_SAFE_INTEGER / 2);
  const remainingTimeLabel = entitlementLoading
    ? "..."
    : hasUnlimitedEntitlement
    ? t.unlimitedLabel
    : typeof remainingSeconds === "number"
    ? formatExactDuration(remainingSeconds)
    : "00:00";
  const exerciseConsumedCredits =
    typeof exerciseStartRemainingSeconds === "number" && typeof remainingSeconds === "number"
      ? formatExactDuration(Math.max(0, exerciseStartRemainingSeconds - remainingSeconds))
      : "00:00";
  const sessionLocked =
    authReady && Boolean(userEmail) && !entitlementLoading && !aiPracticeAllowed && sessionStarted;
  const activeGuideStepId: GuideStepId = realtimeWebEnabled ? "coach" : "speak";
  const guideContext = realtimeWebEnabled
    ? t.guideContextRealtime
    : t.guideContextDefault;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthGuardCookie(Boolean(user));
      setUserEmail(user?.email || "");
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!roomFromQuery) return;
    setRoomId((current) => (current === roomFromQuery ? current : roomFromQuery));
  }, [roomFromQuery]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOpenNotebook = () => setNotebookOpen(true);
    window.addEventListener(AI_PRACTICE_NOTEBOOK_OPEN_EVENT, handleOpenNotebook);
    return () => window.removeEventListener(AI_PRACTICE_NOTEBOOK_OPEN_EVENT, handleOpenNotebook);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("bfzoom.ai-exercise.realtime-web");
    setRealtimeWebEnabled(stored === "1");
    setRealtimeWebLoaded(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("bfzoom.ai-exercise.guide-open");
    if (stored === "0") {
      setGuideOpen(false);
    }
    if (stored === "1") {
      setGuideOpen(true);
    }
    setGuidePreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!realtimeWebLoaded || typeof window === "undefined") return;
    window.localStorage.setItem(
      "bfzoom.ai-exercise.realtime-web",
      realtimeWebEnabled ? "1" : "0"
    );
  }, [realtimeWebEnabled, realtimeWebLoaded]);

  useEffect(() => {
    if (!guidePreferenceLoaded || typeof window === "undefined") return;
    window.localStorage.setItem("bfzoom.ai-exercise.guide-open", guideOpen ? "1" : "0");
  }, [guideOpen, guidePreferenceLoaded]);

  useEffect(() => {
    setMobileHudExpanded(!compactViewport);
  }, [compactViewport]);

  useEffect(() => {
    if (!authReady) return;
    if (userEmail) return;
    router.replace(`/login?next=${encodeURIComponent(buildRoomHref(roomId))}`);
  }, [authReady, buildRoomHref, roomId, router, userEmail]);

  const refreshAiPracticeEntitlement = useCallback(async (options?: { silent?: boolean }) => {
    const silent = Boolean(options?.silent);
    if (!auth.currentUser) {
      setAiPracticeAllowed(false);
      setEntitlementChecked(false);
      setIsAdminEntitlement(false);
      setIsPremiumEntitlement(false);
      if (!silent) {
        setEntitlementLoading(false);
      }
      setRemainingSeconds(null);
      return;
    }

    if (!silent) {
      setEntitlementLoading(true);
    }
    try {
      const token = await auth.currentUser.getIdToken(true);
      const response = await fetch("/api/translation/entitlement", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`entitlement_${response.status}`);
      }
      const payload = (await response.json()) as {
        enabled?: boolean;
        isAdmin?: boolean;
        isPremium?: boolean;
        totalSecondsRemaining?: number;
      };
      const totalSecondsRemaining =
        typeof payload.totalSecondsRemaining === "number" && Number.isFinite(payload.totalSecondsRemaining)
          ? Math.max(0, Math.floor(payload.totalSecondsRemaining))
          : 0;
      setIsAdminEntitlement(payload.isAdmin === true);
      setIsPremiumEntitlement(payload.isPremium === true);
      setRemainingSeconds(totalSecondsRemaining);
      setAiPracticeAllowed(Boolean(payload.enabled) && totalSecondsRemaining > 0);
      setEntitlementChecked(true);
    } catch {
      if (!silent) {
        setIsAdminEntitlement(false);
        setIsPremiumEntitlement(false);
        setRemainingSeconds(null);
        setAiPracticeAllowed(false);
        setEntitlementChecked(false);
      }
    } finally {
      if (!silent) {
        setEntitlementLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!userEmail) {
      setAiPracticeAllowed(false);
      setEntitlementChecked(false);
      setEntitlementLoading(false);
      setIsAdminEntitlement(false);
      setIsPremiumEntitlement(false);
      setRemainingSeconds(null);
      return;
    }
    void refreshAiPracticeEntitlement();
  }, [authReady, refreshAiPracticeEntitlement, userEmail]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleNotebookUpdated = () => {
      void refreshAiPracticeEntitlement({ silent: true });
    };
    window.addEventListener(AI_PRACTICE_NOTEBOOK_UPDATED_EVENT, handleNotebookUpdated);
    return () =>
      window.removeEventListener(AI_PRACTICE_NOTEBOOK_UPDATED_EVENT, handleNotebookUpdated);
  }, [refreshAiPracticeEntitlement]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleEntitlementUpdated = (
      event: Event
    ) => {
      const detail = (event as CustomEvent<TranslationEntitlementUpdateDetail>).detail;
      if (!detail) return;
      const totalSecondsRemaining = Math.max(0, Math.floor(detail.totalSecondsRemaining || 0));
      setIsAdminEntitlement(Boolean(detail.isAdmin));
      setIsPremiumEntitlement(Boolean(detail.isPremium));
      setRemainingSeconds(totalSecondsRemaining);
      setAiPracticeAllowed(Boolean(detail.enabled) && totalSecondsRemaining > 0);
      setEntitlementChecked(true);
    };
    window.addEventListener(
      TRANSLATION_ENTITLEMENT_UPDATED_EVENT,
      handleEntitlementUpdated as EventListener
    );
    return () =>
      window.removeEventListener(
        TRANSLATION_ENTITLEMENT_UPDATED_EVENT,
        handleEntitlementUpdated as EventListener
      );
  }, []);

  useEffect(() => {
    if (!authReady || !userEmail || !roomId) return;
    const intervalId = window.setInterval(() => {
      void refreshAiPracticeEntitlement({ silent: true });
    }, 15_000);
    return () => window.clearInterval(intervalId);
  }, [authReady, refreshAiPracticeEntitlement, roomId, userEmail]);

  useEffect(() => {
    if (!roomId || entitlementLoading || !aiPracticeAllowed) return;
    setSessionStarted(true);
  }, [aiPracticeAllowed, entitlementLoading, roomId]);

  useEffect(() => {
    if (roomId) return;
    if (!authReady || !userEmail) return;
    if (entitlementLoading || !aiPracticeAllowed) return;

    const nextRoomId = generateRoomId();
    setRoomId(nextRoomId);
    router.replace(buildRoomHref(nextRoomId));
  }, [aiPracticeAllowed, authReady, buildRoomHref, entitlementLoading, roomId, router, userEmail]);

  useEffect(() => {
    if (!roomId) {
      setExerciseStartRemainingSeconds(null);
      return;
    }
    if (exerciseStartRemainingSeconds !== null) return;
    if (typeof remainingSeconds !== "number") return;
    setExerciseStartRemainingSeconds(remainingSeconds);
  }, [exerciseStartRemainingSeconds, remainingSeconds, roomId]);

  const handleLeaveRoom = useCallback(() => {
    router.replace(leaveHref);
  }, [leaveHref, router]);

  const loadingLabel = useMemo(() => {
    if (!authReady) return t.loadingSession;
    if (entitlementLoading) return t.checkingMinutes;
    return t.loadingExercise;
  }, [authReady, entitlementLoading, t.checkingMinutes, t.loadingExercise, t.loadingSession]);

  if (authReady && userEmail && entitlementLoading && !sessionStarted) {
    return (
      <div className="relative min-h-dvh bg-black text-white">
        <div className="absolute right-4 top-4 z-30">
          <UiLocaleSwitch theme="dark" />
        </div>
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/65 p-6 text-center shadow-xl backdrop-blur">
            <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <p className="text-sm font-semibold text-slate-100">{loadingLabel}</p>
          </div>
        </div>
      </div>
    );
  }

  if (authReady && userEmail && !entitlementLoading && !aiPracticeAllowed && !sessionStarted) {
    return (
      <div className="relative min-h-dvh bg-black text-white">
        <div className="absolute right-4 top-4 z-30">
          <UiLocaleSwitch theme="dark" />
        </div>
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/65 p-6 text-center shadow-xl backdrop-blur">
            <p className="text-lg font-semibold text-white">{t.lockedTitle}</p>
            <p className="mt-3 text-sm leading-6 text-slate-200">{t.lockedMessage}</p>
            <div className="mt-5 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => router.push(buildCreditsPageHref({ returnTo: returnToPracticeHref }))}
                className="inline-flex items-center justify-center rounded-full border border-amber-300/70 bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
              >
                {t.buyCredits}
              </button>
              {!entitlementChecked && (
                <button
                  type="button"
                  onClick={() => void refreshAiPracticeEntitlement()}
                  className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {t.retryMinutesCheck}
                </button>
              )}
              <button
                type="button"
                onClick={() => router.push(backHref)}
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t.backLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!roomId) {
    return (
      <div className="relative min-h-dvh bg-black text-white">
        <div className="absolute right-4 top-4 z-30">
          <UiLocaleSwitch theme="dark" />
        </div>
        <div className="flex min-h-dvh items-center justify-center px-4">
          <div className="w-full max-w-md rounded-2xl border border-white/15 bg-black/65 p-6 text-center shadow-xl backdrop-blur">
            <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <p className="text-sm font-semibold text-slate-100">{loadingLabel}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-x-hidden bg-black text-white">
      <div
        aria-hidden={notebookOpen}
        className={`pointer-events-none absolute left-3 top-3 z-40 transition sm:left-4 sm:top-4 ${
          notebookOpen ? "hidden" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="pointer-events-auto inline-flex items-center rounded-full border border-white/20 bg-black/70 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black/85"
        >
          {compactViewport ? compactBackLabel : t.backLabel}
        </button>
      </div>
      <div
        aria-hidden={notebookOpen}
        className={`absolute right-3 top-3 z-40 transition sm:right-4 sm:top-4 ${
          notebookOpen ? "hidden" : ""
        }`}
      >
        <div
          className={`flex ${compactViewport ? "max-w-[calc(100vw-5.5rem)] flex-col items-end gap-2" : "items-start gap-2"}`}
        >
          <div className={`flex items-start gap-2 ${compactViewport ? "flex-wrap justify-end" : ""}`}>
            <button
              type="button"
              onClick={() => setNotebookOpen(true)}
              className="inline-flex items-center rounded-full border border-sky-300/70 bg-sky-500/18 px-3 py-1.5 text-xs font-semibold text-sky-50 transition hover:bg-sky-500/28"
            >
              {t.notebook}
            </button>
            <UiLocaleSwitch theme="dark" />
            {compactViewport ? (
              <button
                type="button"
                onClick={() => setMobileHudExpanded((value) => !value)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/75 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition hover:bg-black/85"
              >
                <span>
                  {compactCreditsLabel} {entitlementLoading ? "..." : remainingTimeLabel}
                </span>
                {mobileHudExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            ) : null}
          </div>
          {(!compactViewport || mobileHudExpanded) && (
            <div
              className={`rounded-xl border border-white/15 bg-black/72 px-3 py-2 text-[11px] text-white shadow-lg backdrop-blur ${
                compactViewport ? "w-[min(84vw,18rem)] text-left" : "ml-auto w-[20rem] text-left"
              }`}
            >
              <p className="font-semibold">
                {t.creditsRemaining}: {remainingTimeLabel}
              </p>
              <p className="text-[10px] text-amber-200">
                {t.consumedThisSession}: {exerciseConsumedCredits}
              </p>
              <div
                className={`mt-2 flex ${compactViewport ? "flex-col items-stretch gap-2" : "flex-col items-stretch gap-1"}`}
              >
                <button
                  type="button"
                  onClick={() => setRealtimeWebEnabled((value) => !value)}
                  className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
                    realtimeWebEnabled
                      ? "border-sky-300/80 bg-sky-500/20 text-sky-100"
                      : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  {realtimeWebEnabled ? t.realtimeOn : t.realtimeOff}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    router.push(buildCreditsPageHref({ returnTo: returnToPracticeHref }))
                  }
                  className="inline-flex items-center justify-center rounded-full border border-amber-300/70 bg-amber-500/20 px-2.5 py-1 text-[10px] font-semibold text-amber-100 transition hover:bg-amber-500/30"
                >
                  {t.buyCredits}
                </button>
              </div>
              <div className="mt-3 border-t border-white/10 pt-3">
                <button
                  type="button"
                  onClick={() => setGuideOpen((value) => !value)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
                >
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">
                      {t.guideTitle}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {guideOpen ? t.guideHide : t.guideShow}
                    </p>
                  </div>
                  {guideOpen ? (
                    <ChevronUp className="h-3.5 w-3.5 text-slate-300" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 text-slate-300" />
                  )}
                </button>
                {guideOpen ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-[10px] leading-5 text-slate-300">{guideContext}</p>
                    <ol className="space-y-2">
                      {t.guideSteps.map((step, index) => {
                        const isActive = step.id === activeGuideStepId;
                        return (
                          <li
                            key={step.id}
                            className={`rounded-xl border px-3 py-3 ${
                              isActive
                                ? "border-sky-300/35 bg-sky-500/12"
                                : "border-white/10 bg-white/5"
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <span
                                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                                  isActive
                                    ? "bg-sky-300 text-slate-950"
                                    : "bg-white/10 text-white"
                                }`}
                              >
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-[11px] font-semibold text-white">
                                    {step.title}
                                  </p>
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${
                                      isActive
                                        ? "bg-sky-300/18 text-sky-100"
                                        : "bg-white/8 text-slate-300"
                                    }`}
                                  >
                                    {isActive ? t.guideCurrent : t.guideNext}
                                  </span>
                                </div>
                                <p className="mt-1 text-[10px] leading-5 text-slate-300">
                                  {step.detail}
                                </p>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
      <div
        aria-hidden={notebookOpen}
        className={`flex min-h-0 flex-1 items-center justify-center p-0 transition ${
          notebookOpen ? "hidden" : ""
        }`}
      >
        <div className="h-full min-h-0 w-full overflow-hidden bg-black">
          {realtimeWebEnabled ? (
            <AiPracticeRealtimeShell
              roomId={roomId}
              locked={sessionLocked}
              onFallback={() => setRealtimeWebEnabled(false)}
            />
          ) : (
            <VideoCall
              roomId={roomId}
              isHost
              aiTrainingAutoStart
              skipPreJoin
              onLeave={handleLeaveRoom}
            />
          )}
        </div>
      </div>
      {sessionLocked ? (
        <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/72 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-slate-950/92 p-6 text-center shadow-2xl">
            <p className="text-lg font-semibold text-white">{t.lockedOverlayTitle}</p>
            <p className="mt-3 text-sm leading-6 text-slate-200">{t.lockedOverlayMessage}</p>
            <div className="mt-5 flex flex-col gap-3">
              <button
                type="button"
                onClick={() => router.push(buildCreditsPageHref({ returnTo: returnToPracticeHref }))}
                className="inline-flex items-center justify-center rounded-full border border-amber-300/70 bg-amber-500/20 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
              >
                {t.buyCredits}
              </button>
              <button
                type="button"
                onClick={() => void refreshAiPracticeEntitlement()}
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t.retryMinutesCheck}
              </button>
              <button
                type="button"
                onClick={() => router.push(backHref)}
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                {t.backLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <AiPracticeNotebookDrawer open={notebookOpen} onClose={() => setNotebookOpen(false)} />
    </div>
  );
}
