"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import VideoCall from "@/components/video/VideoCall";
import { setAuthGuardCookie } from "@/lib/authGuard";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";

/* =======================================================
   🎥 BFZoom — Version stable & responsive (2025)
   - Compatible Mac, iPhone, Android, iPad
   - Séparation claire Lobby / Salle active
======================================================= */

const GUEST_NAME_STORAGE_KEY = "bfzoom:guest-name";

type VideoConferenceCopy = {
  guestDefaultName: string;
  unauthorizedCreate: string;
  sessionLoading: string;
  loginNeeded: string;
  allowlistChecking: string;
  allowlistErrorRetry: string;
  allowlistDenied: string;
  allowlistUnfinished: string;
  allowlistDeniedByStatus: (status: number) => string;
  allowlistDeniedGeneric: string;
  allowlistDeniedCreate: string;
  allowlistUnknownError: string;
  allowlistRetryAction: string;
  createRoomOrJoin: string;
  createRoom: string;
  joinRoomPlaceholder: string;
  joinRoomAction: string;
  joinRoomEmptyError: string;
  checkingRights: string;
  checkingRightsHint: string;
  guestNameLabel: string;
  guestNamePlaceholder: string;
  guestNameVisibleHint: string;
  directExerciseLoading: string;
};

const VIDEO_COPY: Record<UiLocale, VideoConferenceCopy> = {
  fr: {
    guestDefaultName: "Invité BFZoom",
    unauthorizedCreate: "Tu n’es pas autorisé à créer une salle pour le moment.",
    sessionLoading: "Chargement de la session...",
    loginNeeded: "Connexion requise.",
    allowlistChecking: "Vérification des droits en cours, réessaie dans un instant.",
    allowlistErrorRetry: "Impossible de vérifier tes droits, clique sur « Vérifier mes droits ».",
    allowlistDenied: "Ton compte n'est pas autorisé à créer une salle.",
    allowlistUnfinished: "Vérification non terminée.",
    allowlistDeniedByStatus: (status: number) => `Autorisation refusée (${status})`,
    allowlistDeniedGeneric: "Impossible de vérifier tes droits. Réessaie dans un instant.",
    allowlistDeniedCreate: "Ton compte n'est pas autorisé pour le moment.",
    allowlistUnknownError: "Impossible de vérifier tes droits.",
    allowlistRetryAction: "Réessayer la vérification",
    createRoomOrJoin: "Crée une salle ou rejoins-en une existante.",
    createRoom: "➕ Créer une salle",
    joinRoomPlaceholder: "Code de salle (ex: room-ab12cd)",
    joinRoomAction: "🔗 Rejoindre en invité",
    joinRoomEmptyError: "Entre un code de salle pour rejoindre.",
    checkingRights: "Vérification en cours…",
    checkingRightsHint: "🔄 Vérification des droits en cours, patiente juste une seconde…",
    guestNameLabel: "Nom invité",
    guestNamePlaceholder: "Ex: Marie",
    guestNameVisibleHint: "Visible pour les participants.",
    directExerciseLoading: "Ouverture de l'exercice IA en cours...",
  },
  en: {
    guestDefaultName: "BFZoom Guest",
    unauthorizedCreate: "You are not allowed to create a room right now.",
    sessionLoading: "Loading session...",
    loginNeeded: "Sign-in required.",
    allowlistChecking: "Checking permissions, please try again in a moment.",
    allowlistErrorRetry: "Unable to verify permissions, click “Check my permissions”.",
    allowlistDenied: "Your account is not allowed to create a room.",
    allowlistUnfinished: "Verification is not completed yet.",
    allowlistDeniedByStatus: (status: number) => `Authorization denied (${status})`,
    allowlistDeniedGeneric: "Unable to verify permissions. Try again in a moment.",
    allowlistDeniedCreate: "Your account is not currently allowed.",
    allowlistUnknownError: "Unable to verify your permissions.",
    allowlistRetryAction: "Retry verification",
    createRoomOrJoin: "Create a room or join an existing one.",
    createRoom: "➕ Create room",
    joinRoomPlaceholder: "Room code (e.g. room-ab12cd)",
    joinRoomAction: "🔗 Join as guest",
    joinRoomEmptyError: "Enter a room code to join.",
    checkingRights: "Checking permissions…",
    checkingRightsHint: "🔄 Verifying permissions, please wait a second…",
    guestNameLabel: "Guest name",
    guestNamePlaceholder: "Ex: Maria",
    guestNameVisibleHint: "Visible to participants.",
    directExerciseLoading: "Opening AI exercise...",
  },
};

export default function VideoConferenceContent() {
  const { locale } = useUiLocale();
  const t = VIDEO_COPY[locale];
  const [roomId, setRoomId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [authReady, setAuthReady] = useState(false);
  const [allowlistStatus, setAllowlistStatus] = useState<
    "idle" | "loading" | "allowed" | "denied" | "error"
  >("idle");
  const [allowlistError, setAllowlistError] = useState("");
  const [allowlistRefetchTrigger, setAllowlistRefetchTrigger] = useState(0);
  const [createError, setCreateError] = useState("");
  const [guestDisplayName, setGuestDisplayName] = useState("");
  const [joinRoomInput, setJoinRoomInput] = useState("");

  const searchParams = useSearchParams();
  const router = useRouter();
  const wantsAiExercise = searchParams.get("exercise") === "1";
  const wantsHost = searchParams.get("host") === "1" || wantsAiExercise;
  const isHost = wantsAiExercise ? true : wantsHost && allowlistStatus === "allowed";
  const wantsCreate = searchParams.get("create") === "1" || wantsAiExercise;
  const roomFromQuery = searchParams.get("room")?.trim() || "";
  const canJoinAsGuestByLink = Boolean(roomFromQuery) && !wantsHost;
  const focusedExerciseMode = wantsAiExercise && isHost;
  const guestNameFromQuery =
    searchParams.get("name")?.trim() || searchParams.get("guest")?.trim() || "";

  /* 🔐 Vérifie la connexion Firebase */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthGuardCookie(Boolean(user));
      setUserEmail(user?.email || "");
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (userEmail) return;
    if (canJoinAsGuestByLink) return;
    const search = searchParams.toString();
    const next = `/videoconference${search ? `?${search}` : ""}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [authReady, canJoinAsGuestByLink, router, searchParams, userEmail]);

  useEffect(() => {
    if (!authReady || !canJoinAsGuestByLink) return;
    const emailPrefix = userEmail.split("@")[0]?.trim() || "";
    let fallback = emailPrefix;
    if (!fallback && typeof window !== "undefined") {
      const saved = window.localStorage.getItem(GUEST_NAME_STORAGE_KEY)?.trim() || "";
      fallback = saved;
    }
    const fromQuery = guestNameFromQuery;
    const localizedDefault = (fromQuery || fallback || t.guestDefaultName).slice(0, 80);
    setGuestDisplayName((current) => (current.trim() ? current : localizedDefault));
  }, [authReady, canJoinAsGuestByLink, guestNameFromQuery, t.guestDefaultName, userEmail]);

  useEffect(() => {
    if (!canJoinAsGuestByLink || typeof window === "undefined") return;
    const trimmed = guestDisplayName.trim();
    if (!trimmed) return;
    window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, trimmed.slice(0, 80));
  }, [canJoinAsGuestByLink, guestDisplayName]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const checkAllowlist = async () => {
      if (!authReady || !auth.currentUser) {
        setAllowlistStatus("idle");
        setAllowlistError("");
        return;
      }
      setAllowlistStatus("loading");
      setAllowlistError("");
      try {
        const token = await auth.currentUser.getIdToken();
        const res = await fetch("/api/auth/allowlist", {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error(t.allowlistDeniedByStatus(res.status));
        }
        const data = (await res.json()) as { allowed?: boolean };
        if (cancelled) return;
        if (data.allowed) {
          setAllowlistStatus("allowed");
          setAllowlistError("");
        } else {
          setAllowlistStatus("denied");
          setAllowlistError(t.allowlistDenied);
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : t.allowlistDeniedGeneric;
        setAllowlistStatus("error");
        setAllowlistError(message);
      }
    };
    void checkAllowlist();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [userEmail, authReady, allowlistRefetchTrigger, t]);

  /* 🔗 Récupère ou génère un roomId depuis l'URL */
  useEffect(() => {
    const urlRoom = searchParams.get("room");
    if (urlRoom && urlRoom !== roomId) {
      setRoomId(urlRoom);
    }
  }, [searchParams, roomId]);

  const generateRoomId = () => "room-" + Math.random().toString(36).slice(2, 8);

  useEffect(() => {
    if (roomId) return;
    if (!wantsCreate) return;
    setCreateError("");
    if (!authReady) return;
    if (!userEmail) {
      router.push(
        `/login?next=${encodeURIComponent(
          wantsAiExercise ? "/videoconference?exercise=1" : "/videoconference?create=1"
        )}`
      );
      return;
    }
    if (wantsAiExercise) {
      const id = generateRoomId();
      router.replace(`/videoconference?room=${id}&host=1&exercise=1`);
      setRoomId(id);
      return;
    }
    if (allowlistStatus === "loading" || allowlistStatus === "idle") return;
    if (allowlistStatus === "error") return;
    if (allowlistStatus === "denied" || allowlistStatus !== "allowed") {
      setCreateError(t.unauthorizedCreate);
      router.replace("/videoconference");
      return;
    }
    const id = generateRoomId();
    const target = wantsAiExercise
      ? `/videoconference?room=${id}&host=1&exercise=1`
      : `/videoconference?room=${id}&host=1`;
    router.replace(target);
    setRoomId(id);
  }, [
    roomId,
    wantsCreate,
    userEmail,
    allowlistStatus,
    router,
    authReady,
    wantsAiExercise,
    t.unauthorizedCreate,
  ]);

  /* 🚀 Créer une nouvelle salle */
  const handleCreateRoom = useCallback(() => {
    setCreateError("");
    if (!authReady) {
      setCreateError(t.sessionLoading);
      return;
    }
    if (!userEmail) {
      router.push("/login?next=/videoconference?create=1");
      return;
    }
    if (allowlistStatus === "loading") {
      setCreateError(t.allowlistChecking);
      return;
    }
    if (allowlistStatus === "error") {
      setCreateError(t.allowlistErrorRetry);
      return;
    }
    if (allowlistStatus === "denied") {
      setCreateError(t.allowlistDenied);
      return;
    }
    if (allowlistStatus !== "allowed") {
      setCreateError(t.allowlistUnfinished);
      return;
    }
    const id = generateRoomId();
    router.push(`/videoconference?room=${id}&host=1`);
    setRoomId(id);
  }, [router, userEmail, allowlistStatus, authReady, t.allowlistChecking, t.allowlistDenied, t.allowlistErrorRetry, t.allowlistUnfinished, t.sessionLoading]);

  const handleRetryAllowlist = useCallback(() => {
    setAllowlistRefetchTrigger((prev) => prev + 1);
    setCreateError("");
  }, [setAllowlistRefetchTrigger, setCreateError]);

  const handleJoinRoom = useCallback(() => {
    const target = joinRoomInput.trim();
    if (!target) {
      setCreateError(t.joinRoomEmptyError);
      return;
    }
    setCreateError("");
    router.push(`/videoconference?room=${encodeURIComponent(target)}`);
  }, [joinRoomInput, router, t.joinRoomEmptyError]);

  /* 🚪 Quitter la salle proprement */
  const handleLeaveRoom = useCallback(() => {
    setRoomId(null);
    router.replace("/");
  }, [router]);

  const allowlistBusy = allowlistStatus === "loading";
  const allowlistLocked = allowlistStatus !== "allowed";
  const allowlistMessage =
    allowlistStatus === "denied"
      ? allowlistError || t.allowlistDeniedCreate
      : allowlistStatus === "error"
      ? allowlistError || t.allowlistUnknownError
      : "";
  const showRetryAllowlist = allowlistStatus === "error";

  /* =======================================================
     🧱 LOBBY (avant création de salle)
  ======================================================= */
  if (!roomId) {
    if (wantsAiExercise) {
      return (
        <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 text-gray-800 px-4">
          <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-xl">
            <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
            <p className="text-sm font-semibold text-slate-700">{t.directExerciseLoading}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 text-gray-800 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-6 text-center">
          <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">
            🎥 BFZoom
          </h1>
          <p className="text-center text-gray-500 text-sm mb-6">
            {t.createRoomOrJoin}
          </p>
          <button
            onClick={handleCreateRoom}
            disabled={!authReady || !userEmail || allowlistLocked}
            aria-busy={allowlistBusy || undefined}
            className={`w-full flex items-center justify-center gap-2 border-0 py-3 rounded-lg font-semibold transition-colors ${
              allowlistLocked
                ? "cursor-not-allowed bg-blue-400/70 text-white"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {allowlistBusy ? (
              <>
                <span
                  aria-hidden
                  className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"
                />
                <span>{t.checkingRights}</span>
              </>
            ) : (
              t.createRoom
            )}
          </button>

          <div className="mt-3 flex items-center gap-2">
            <input
              value={joinRoomInput}
              onChange={(event) => setJoinRoomInput(event.target.value.slice(0, 80))}
              placeholder={t.joinRoomPlaceholder}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-400/60"
            />
            <button
              onClick={handleJoinRoom}
              className="shrink-0 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200"
            >
              {t.joinRoomAction}
            </button>
          </div>

          {allowlistBusy && (
            <p
              className="mt-3 text-xs font-semibold text-slate-500"
              role="status"
              aria-live="polite"
            >
              {t.checkingRightsHint}
            </p>
          )}
          {allowlistMessage && (
            <div className="mt-3 space-y-2 text-left text-xs text-amber-600">
              <p>{allowlistMessage}</p>
              {showRetryAllowlist && (
                <button
                  onClick={handleRetryAllowlist}
                  className="text-[11px] font-semibold text-amber-700 hover:text-amber-900"
                >
                  {t.allowlistRetryAction}
                </button>
              )}
            </div>
          )}
          {createError && (
            <p className="mt-3 text-xs text-amber-700">{createError}</p>
          )}
        </div>
      </div>
    );
  }

  /* =======================================================
     🧭 SALLE ACTIVE
  ======================================================= */
  return (
    <div
      className={`flex h-[100dvh] min-h-[100dvh] flex-col overflow-x-hidden text-white ${
        focusedExerciseMode ? "bg-black" : "bg-gray-900"
      }`}
    >
      {canJoinAsGuestByLink && (
        <div className="shrink-0 px-3 pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-7xl rounded-xl border border-white/15 bg-black/25 p-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-200">
              {t.guestNameLabel}
            </label>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={guestDisplayName}
                onChange={(event) => setGuestDisplayName(event.target.value.slice(0, 80))}
                placeholder={t.guestNamePlaceholder}
                className="w-full rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
              />
              <p className="text-[11px] text-gray-300">{t.guestNameVisibleHint}</p>
            </div>
          </div>
        </div>
      )}
      {/* 🎦 Zone vidéo responsive */}
      <div
        className={`flex min-h-0 flex-1 items-center justify-center ${
          focusedExerciseMode ? "p-0" : "p-1.5 sm:p-3 md:p-5"
        }`}
      >
        <div
          className={`h-full min-h-0 w-full overflow-hidden ${
            focusedExerciseMode
              ? "mx-0 max-w-none rounded-none border-0 bg-black shadow-none"
              : "mx-auto max-w-7xl rounded-xl border border-gray-800 bg-gray-950 shadow-2xl"
          }`}
        >
          <VideoCall
            roomId={roomId}
            isHost={isHost}
            aiTrainingAutoStart={wantsAiExercise}
            skipPreJoin={wantsAiExercise}
            defaultDisplayName={guestDisplayName}
            onLeave={handleLeaveRoom}
          />
        </div>
      </div>

      {/* Quitter via la barre de controles */}
    </div>
  );
}
