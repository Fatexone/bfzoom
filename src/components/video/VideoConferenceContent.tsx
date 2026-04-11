"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import { extractLivekitInviteId } from "@/lib/livekitInviteLinks";
import VideoCall from "@/components/video/VideoCall";
import { setAuthGuardCookie } from "@/lib/authGuard";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";
import { useTranslationEntitlement } from "@/hooks/useTranslationEntitlement";

/* =======================================================
   🎥 BFZoom — Version stable & responsive (2025)
   - Compatible Mac, iPhone, Android, iPad
   - Séparation claire Lobby / Salle active
======================================================= */

const GUEST_NAME_STORAGE_KEY = "bfzoom:guest-name";
const buildGuestSessionIdentity = () =>
  `guest-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
const sanitizeIdentityBase = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
const buildUserScopedGuestIdentity = (userId?: string | null) => {
  const base = sanitizeIdentityBase(String(userId || ""));
  return base
    ? `guest-${base}-${Math.random().toString(36).slice(2, 10)}${Math.random()
        .toString(36)
        .slice(2, 10)}`
    : buildGuestSessionIdentity();
};
const buildRoomSuffix = () =>
  `${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;

type GuestInviteJoinState = {
  inviteId: string;
  roomId: string;
  identity: string;
  token: string;
  guestTtsToken?: string;
};

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
  inviteOnlyAccess: string;
  createRoomOrJoin: string;
  createRoom: string;
  joinRoomPlaceholder: string;
  joinRoomAction: string;
  joinRoomEmptyError: string;
  checkingRights: string;
  checkingRightsHint: string;
  translationActive: (minutes: number) => string;
  translationLocked: string;
  buyCreditsAction: string;
  guestNameLabel: string;
  guestNamePlaceholder: string;
  guestNameVisibleHint: string;
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
    inviteOnlyAccess: "Cette visioconférence n'accepte plus les codes de room. Utilise une invitation BFZoom.",
    createRoomOrJoin: "Crée une salle ou rejoins-en une existante.",
    createRoom: "➕ Créer une salle",
    joinRoomPlaceholder: "Lien ou invitation BFZoom",
    joinRoomAction: "🔗 Rejoindre en invité",
    joinRoomEmptyError: "Colle une invitation BFZoom valide pour rejoindre.",
    checkingRights: "Vérification en cours…",
    checkingRightsHint: "🔄 Vérification des droits en cours, patiente juste une seconde…",
    translationActive: (minutes: number) => `Traduction disponible · ${minutes} min restantes`,
    translationLocked:
      "Tu peux continuer la visio sans crédits. La traduction reste simplement désactivée jusqu’à recharge.",
    buyCreditsAction: "Acheter des crédits",
    guestNameLabel: "Nom invité",
    guestNamePlaceholder: "Ex: Marie",
    guestNameVisibleHint: "Visible pour les participants.",
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
    inviteOnlyAccess: "This call no longer accepts room codes. Use a BFZoom invite.",
    createRoomOrJoin: "Create a room or join an existing one.",
    createRoom: "➕ Create room",
    joinRoomPlaceholder: "BFZoom invite or link",
    joinRoomAction: "🔗 Join as guest",
    joinRoomEmptyError: "Paste a valid BFZoom invite to join.",
    checkingRights: "Checking permissions…",
    checkingRightsHint: "🔄 Verifying permissions, please wait a second…",
    translationActive: (minutes: number) => `Translation available · ${minutes} min left`,
    translationLocked:
      "You can still use the video room without credits. Translation is simply disabled until you top up.",
    buyCreditsAction: "Buy credits",
    guestNameLabel: "Guest name",
    guestNamePlaceholder: "Ex: Maria",
    guestNameVisibleHint: "Visible to participants.",
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
  const [guestInviteJoin, setGuestInviteJoin] = useState<GuestInviteJoinState | null>(null);
  const [guestInviteStatus, setGuestInviteStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );
  const translationEntitlement = useTranslationEntitlement();

  const searchParams = useSearchParams();
  const router = useRouter();
  const wantsHost = searchParams.get("host") === "1";
  const isHost = wantsHost && allowlistStatus === "allowed";
  const wantsCreate = searchParams.get("create") === "1";
  const inviteFromQuery = searchParams.get("invite")?.trim() || "";
  const roomFromQuery = searchParams.get("room")?.trim() || "";
  const canJoinAsGuestByLink = Boolean(inviteFromQuery) && !wantsHost;
  const guestNameFromQuery =
    searchParams.get("name")?.trim() || searchParams.get("guest")?.trim() || "";
  const guestInviteIdentity = useMemo(() => {
    return buildUserScopedGuestIdentity(auth.currentUser?.uid);
  }, []);

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
    if (!inviteFromQuery || !wantsHost) return;
    const query = new URLSearchParams({ invite: inviteFromQuery });
    if (guestNameFromQuery) {
      query.set("name", guestNameFromQuery.slice(0, 80));
    }
    router.replace(`/videoconference?${query.toString()}`);
  }, [guestNameFromQuery, inviteFromQuery, router, wantsHost]);

  useEffect(() => {
    if (!authReady) return;
    if (roomFromQuery && !wantsHost) {
      router.replace("/videoconference");
      return;
    }
    if (userEmail) return;
    if (canJoinAsGuestByLink) return;
    const search = searchParams.toString();
    const next = `/videoconference${search ? `?${search}` : ""}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [authReady, canJoinAsGuestByLink, roomFromQuery, router, searchParams, userEmail, wantsHost]);

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
        const data = (await res.json()) as {
          allowed?: boolean;
          allowlisted?: boolean;
          accessMode?: "allowlist" | "authenticated";
        };
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
    if (inviteFromQuery || !wantsHost) return;
    const urlRoom = searchParams.get("room");
    if (urlRoom && urlRoom !== roomId) {
      setRoomId(urlRoom);
    }
  }, [inviteFromQuery, roomId, searchParams, wantsHost]);

  useEffect(() => {
    if (!inviteFromQuery || wantsHost) {
      setGuestInviteJoin(null);
      setGuestInviteStatus("idle");
      return;
    }

    const displayName = guestDisplayName.trim() || t.guestDefaultName;
    if (!displayName) return;

    let cancelled = false;
    const controller = new AbortController();

    const redeemInvite = async () => {
      setRoomId(null);
      setGuestInviteStatus("loading");
      setCreateError("");
      try {
        const res = await fetch("/api/livekit/invite/redeem", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            invite: inviteFromQuery,
            identity: guestInviteIdentity,
            name: displayName,
            includeGuestTtsToken: true,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as {
          room?: string;
          token?: string;
          guestTtsToken?: string | null;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(payload.error || "Unable to join this invite.");
        }
        const nextRoomId = (payload.room || "").trim();
        const nextToken = (payload.token || "").trim();
        if (!nextRoomId || !nextToken) {
          throw new Error("Invite response is incomplete.");
        }
        if (cancelled) return;
        setRoomId(nextRoomId);
        setGuestInviteJoin({
          inviteId: inviteFromQuery,
          roomId: nextRoomId,
          identity: guestInviteIdentity,
          token: nextToken,
          guestTtsToken: (payload.guestTtsToken || "").trim() || undefined,
        });
        setGuestInviteStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setGuestInviteJoin(null);
        setGuestInviteStatus("error");
        setCreateError(
          error instanceof Error && error.message.trim()
            ? error.message
            : t.joinRoomEmptyError
        );
      }
    };

    void redeemInvite();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    guestDisplayName,
    guestInviteIdentity,
    inviteFromQuery,
    t.guestDefaultName,
    t.joinRoomEmptyError,
    wantsHost,
  ]);

  const generateRoomId = () => `room-${buildRoomSuffix()}`;

  useEffect(() => {
    if (roomId) return;
    if (!wantsCreate) return;
    setCreateError("");
    if (!authReady) return;
    if (!userEmail) {
      router.push(
        `/login?next=${encodeURIComponent("/videoconference?create=1")}`
      );
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
    router.replace(`/videoconference?room=${id}&host=1`);
    setRoomId(id);
  }, [
    roomId,
    wantsCreate,
    userEmail,
    allowlistStatus,
    router,
    authReady,
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
    const inviteToken = extractLivekitInviteId(joinRoomInput);
    if (!inviteToken) {
      setCreateError(t.joinRoomEmptyError);
      return;
    }
    setCreateError("");
    router.push(`/videoconference?invite=${encodeURIComponent(inviteToken)}`);
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
  const translationMinutesRemaining = Math.max(
    0,
    Math.ceil(translationEntitlement.totalSecondsRemaining / 60)
  );
  const showTranslationStatus =
    authReady && Boolean(userEmail) && !translationEntitlement.loading;
  const showTranslationUpsell =
    showTranslationStatus &&
    !translationEntitlement.enabled &&
    !translationEntitlement.isAdmin &&
    !translationEntitlement.isPremium;
  const translationStatusMessage = !showTranslationStatus
    ? ""
    : translationEntitlement.enabled
    ? t.translationActive(translationMinutesRemaining)
    : t.translationLocked;

  /* =======================================================
     🧱 LOBBY (avant création de salle)
  ======================================================= */
  if (!roomId && !inviteFromQuery) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-linear-to-b from-gray-50 to-gray-100 text-gray-800 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-6 text-center">
          <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">
            🎥 BFZoom
          </h1>
          <p className="text-center text-gray-500 text-sm mb-6">
            {t.inviteOnlyAccess}
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
          {translationStatusMessage && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left text-xs text-slate-700">
              <p>{translationStatusMessage}</p>
              {showTranslationUpsell && (
                <button
                  onClick={() =>
                    router.push(
                      `/credits?returnTo=${encodeURIComponent("/videoconference")}`
                    )
                  }
                  className="mt-3 inline-flex items-center rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                >
                  {t.buyCreditsAction}
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
      className="flex h-dvh min-h-dvh flex-col overflow-x-hidden bg-gray-900 text-white"
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
      {createError && inviteFromQuery ? (
        <div className="shrink-0 px-3 pt-3 sm:px-6">
          <div className="mx-auto w-full max-w-7xl rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {createError}
          </div>
        </div>
      ) : null}
      {/* 🎦 Zone vidéo responsive */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center p-1.5 sm:p-3 md:p-5"
      >
        <div
          className="mx-auto h-full min-h-0 w-full max-w-7xl overflow-hidden rounded-xl border border-gray-800 bg-gray-950 shadow-2xl"
        >
          {inviteFromQuery && !roomId ? (
            <div className="flex h-full min-h-70 items-center justify-center px-6 text-center text-sm text-slate-300">
              {guestInviteStatus === "error"
                ? createError || t.allowlistDeniedGeneric
                : t.sessionLoading}
            </div>
          ) : (
            <VideoCall
              roomId={roomId || guestInviteJoin?.roomId || ""}
              isHost={isHost}
              guestInviteId={guestInviteJoin?.inviteId}
              sessionIdentity={guestInviteJoin?.identity}
              skipPreJoin={Boolean(guestInviteJoin)}
              initialLivekitAuth={
                guestInviteJoin
                  ? {
                      token: guestInviteJoin.token,
                      guestTtsToken: guestInviteJoin.guestTtsToken,
                    }
                  : undefined
              }
              defaultDisplayName={guestDisplayName}
              onLeave={handleLeaveRoom}
            />
          )}
        </div>
      </div>

      {/* Quitter via la barre de controles */}
    </div>
  );
}
