"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const GUEST_NAME_STORAGE_KEY = "bfzoom:guest-name";
const GUEST_NAME_MAX_LENGTH = 80;

const sanitizeGuestName = (value: string) => value.trim().slice(0, GUEST_NAME_MAX_LENGTH);
const sanitizeRoomId = (value: string) => value.trim().slice(0, 120);

export default function JoinGuestNameGate({
  room,
  initialName,
}: {
  room: string;
  initialName?: string;
}) {
  const router = useRouter();
  const cleanRoom = sanitizeRoomId(room);
  const [guestName, setGuestName] = useState(() => sanitizeGuestName(initialName || ""));

  useEffect(() => {
    if (guestName) return;
    if (typeof window === "undefined") return;
    const saved = sanitizeGuestName(window.localStorage.getItem(GUEST_NAME_STORAGE_KEY) || "");
    if (!saved) return;
    setGuestName(saved);
  }, [guestName]);

  const helper = useMemo(
    () => `${guestName.length}/${GUEST_NAME_MAX_LENGTH} caracteres`,
    [guestName.length]
  );

  const resolveGuestName = () => sanitizeGuestName(guestName) || "Invite BFZoom";

  const persistGuestName = (value: string) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(GUEST_NAME_STORAGE_KEY, value);
  };

  const buildWebHref = (value: string) => {
    const query = new URLSearchParams({ room: cleanRoom, name: value });
    return `/videoconference?${query.toString()}`;
  };

  const buildMobileHref = (value: string) => {
    const query = new URLSearchParams({ guest: value });
    return `bfzoom://join/${encodeURIComponent(cleanRoom)}?${query.toString()}`;
  };

  const handleContinue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = resolveGuestName();
    persistGuestName(nextName);
    router.replace(buildWebHref(nextName));
  };

  const handleOpenMobileApp = () => {
    const nextName = resolveGuestName();
    persistGuestName(nextName);
    if (typeof window !== "undefined") {
      window.location.href = buildMobileHref(nextName);
    }
  };

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center">
        <form
          onSubmit={handleContinue}
          className="w-full rounded-2xl border border-white/10 bg-black/30 p-5 shadow-xl backdrop-blur"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">
            BFZoom
          </p>
          <h1 className="mt-2 text-xl font-semibold text-white">Rejoindre la salle</h1>
          <p className="mt-2 text-sm text-slate-300">
            Choisis le nom affiche pour les participants puis selectionne App ou Web.
          </p>
          <label htmlFor="guest-name" className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-300">
            Nom invite
          </label>
          <input
            id="guest-name"
            autoFocus
            value={guestName}
            onChange={(event) =>
              setGuestName(event.target.value.slice(0, GUEST_NAME_MAX_LENGTH))
            }
            placeholder="Ex: Marie"
            className="mt-2 w-full rounded-xl border border-white/20 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
          />
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
            <span>Visible dans la visioconference.</span>
            <span>{helper}</span>
          </div>
          <button
            type="submit"
            className="mt-4 w-full rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
          >
            Continuer sur le web
          </button>
          <button
            type="button"
            onClick={handleOpenMobileApp}
            className="mt-2 w-full rounded-xl border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
          >
            Ouvrir l&apos;app mobile
          </button>
          <p className="mt-2 text-[11px] text-slate-400">
            Si l&apos;application n&apos;est pas installee, utilise &quot;Continuer sur le web&quot;.
          </p>
        </form>
      </div>
    </div>
  );
}
