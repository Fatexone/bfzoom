"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import VideoCall from "@/components/video/VideoCall";

/* =======================================================
   🎥 BFZoom — Version stable & responsive (2025)
   - Compatible Mac, iPhone, Android, iPad
   - Séparation claire Lobby / Salle active
======================================================= */
export default function VideoConferenceContent() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");
  const [authReady, setAuthReady] = useState(false);
  const [allowlistStatus, setAllowlistStatus] = useState<
    "idle" | "loading" | "allowed" | "denied" | "error"
  >("idle");
  const [allowlistError, setAllowlistError] = useState("");
  const [allowlistRefetchTrigger, setAllowlistRefetchTrigger] = useState(0);
  const [createError, setCreateError] = useState("");

  const searchParams = useSearchParams();
  const router = useRouter();
  const wantsHost = searchParams.get("host") === "1";
  const isHost = wantsHost && allowlistStatus === "allowed";
  const wantsCreate = searchParams.get("create") === "1";

  /* 🔐 Vérifie la connexion Firebase */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUserEmail(user?.email || "");
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

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
          throw new Error(`Autorisation refusée (${res.status})`);
        }
        const data = (await res.json()) as { allowed?: boolean };
        if (cancelled) return;
        if (data.allowed) {
          setAllowlistStatus("allowed");
          setAllowlistError("");
        } else {
          setAllowlistStatus("denied");
          setAllowlistError("Ton compte n'est pas autorisé à créer une salle.");
        }
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : "Impossible de vérifier tes droits. Réessaie dans un instant.";
        setAllowlistStatus("error");
        setAllowlistError(message);
      }
    };
    void checkAllowlist();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [userEmail, authReady, allowlistRefetchTrigger]);

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
      router.push("/login?next=/videoconference?create=1");
      return;
    }
    if (allowlistStatus === "loading" || allowlistStatus === "idle") return;
    if (allowlistStatus === "error") return;
    if (allowlistStatus === "denied" || allowlistStatus !== "allowed") {
      setCreateError("Tu n’es pas autorisé à créer une salle pour le moment.");
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
  ]);

  /* 🚀 Créer une nouvelle salle */
  const handleCreateRoom = useCallback(() => {
    setCreateError("");
    if (!authReady) {
      setCreateError("Chargement de la session...");
      return;
    }
    if (!userEmail) {
      router.push("/login?next=/videoconference?create=1");
      return;
    }
    if (allowlistStatus === "loading") {
      setCreateError("Vérification des droits en cours, réessaie dans un instant.");
      return;
    }
    if (allowlistStatus === "error") {
      setCreateError("Impossible de vérifier tes droits, clique sur « Vérifier mes droits ».");
      return;
    }
    if (allowlistStatus === "denied") {
      setCreateError("Ton compte n'est pas autorisé à créer une salle.");
      return;
    }
    if (allowlistStatus !== "allowed") {
      setCreateError("Vérification non terminée.");
      return;
    }
    const id = generateRoomId();
    router.push(`/videoconference?room=${id}&host=1`);
    setRoomId(id);
  }, [router, userEmail, allowlistStatus, authReady]);

  const handleRetryAllowlist = useCallback(() => {
    setAllowlistRefetchTrigger((prev) => prev + 1);
    setCreateError("");
  }, [setAllowlistRefetchTrigger, setCreateError]);

  /* 🚪 Quitter la salle proprement */
  const handleLeaveRoom = useCallback(() => {
    setRoomId(null);
    router.replace("/");
  }, [router]);

  const allowlistBusy = allowlistStatus === "loading";
  const allowlistLocked = allowlistStatus !== "allowed";
  const allowlistMessage =
    allowlistStatus === "denied"
      ? allowlistError || "Ton compte n'est pas autorisé pour le moment."
      : allowlistStatus === "error"
      ? allowlistError || "Impossible de vérifier tes droits."
      : "";
  const showRetryAllowlist = allowlistStatus === "error";

  /* =======================================================
     🧱 LOBBY (avant création de salle)
  ======================================================= */
  if (!roomId) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 text-gray-800 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 p-6 text-center">
          <h1 className="text-3xl font-bold text-center mb-2 text-gray-800">
            🎥 BFZoom
          </h1>
          <p className="text-center text-gray-500 text-sm mb-6">
            Crée une salle ou rejoins-en une existante.
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
                <span>Vérification en cours…</span>
              </>
            ) : (
              "➕ Créer une salle"
            )}
          </button>
          {allowlistBusy && (
            <p
              className="mt-3 text-xs font-semibold text-slate-500"
              role="status"
              aria-live="polite"
            >
              🔄 Vérification des droits en cours, patiente juste une seconde…
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
                  Réessayer la vérification
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
    <div className="flex flex-col min-h-dvh bg-gray-900 text-white">
      {/* 🎦 Zone vidéo responsive */}
      <div className="flex-1 flex items-center justify-center p-2 sm:p-4 md:p-6">
        <div className="w-full h-full max-w-7xl mx-auto rounded-xl overflow-hidden shadow-2xl border border-gray-800 bg-gray-950">
          <VideoCall roomId={roomId} isHost={isHost} onLeave={handleLeaveRoom} />
        </div>
      </div>

      {/* Quitter via la barre de controles */}
    </div>
  );
}