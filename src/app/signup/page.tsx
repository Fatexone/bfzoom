"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { Sparkles, Globe2, Video, Languages } from "lucide-react";

export default function SignupPage() {
  const [invite, setInvite] = useState<string | null>(null);
  const [inviter, setInviter] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("invite");
    queueMicrotask(() => {
      setInvite(value);
    });

    const loadInviter = async () => {
      if (!value) return;
      const snap = await getDoc(doc(db, "users", value));
      if (snap.exists()) {
        const data = snap.data() as { name?: string; email?: string };
        setInviter(data.name || data.email || "Un utilisateur BFZoom");
      }
    };
    void loadInviter();
  }, []);

  const loginHref = invite
    ? `/login?mode=signup&invite=${encodeURIComponent(invite)}`
    : "/login?mode=signup";

  return (
    <div className="relative min-h-dvh overflow-hidden bg-linear-to-br from-gray-950 via-gray-900 to-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.18),transparent_60%)]" />

      <div className="relative z-10 mx-auto flex max-w-5xl flex-col gap-10 px-6 py-14 md:flex-row md:items-center">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-4 py-1 text-xs font-semibold text-amber-200">
            <Sparkles className="h-4 w-4" />
            Invitation BFZoom
          </div>
          <h1 className="mt-4 text-3xl font-bold leading-tight md:text-5xl">
            Rejoins BFZoom avec ton email.
          </h1>
          <p className="mt-4 text-base text-gray-300 md:text-lg">
            {inviter
              ? `${inviter} t’a invité à rejoindre BFZoom.`
              : "Crée ton compte BFZoom ou connecte-toi en quelques secondes."}
          </p>
          <p className="mt-2 text-sm text-gray-400">
            Un seul parcours email: si ton compte n&apos;existe pas encore, il sera créé automatiquement après vérification.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={loginHref}
              className="inline-flex items-center justify-center rounded-xl bg-amber-600 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-700"
            >
              Continuer avec l’email
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
            >
              Découvrir BFZoom
            </Link>
          </div>
        </div>

        <div className="flex-1">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <Video className="h-6 w-6 text-amber-300" />
              <p className="mt-3 text-sm font-semibold">Visioconférence multilingue</p>
              <p className="text-xs text-gray-400">
                Lance une room BFZoom et partage le lien en un clic.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <Languages className="h-6 w-6 text-emerald-300" />
              <p className="mt-3 text-sm font-semibold">Traduction en direct</p>
              <p className="text-xs text-gray-400">
                Parle ta langue, l&apos;autre reçoit dans la sienne.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
              <Globe2 className="h-6 w-6 text-blue-300" />
              <p className="mt-3 text-sm font-semibold">Accès simple</p>
              <p className="text-xs text-gray-400">
                Vérifie ton email, puis utilise BFZoom sur le web ou dans l&apos;app mobile.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
