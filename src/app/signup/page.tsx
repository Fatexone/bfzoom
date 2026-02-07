"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { Sparkles, MessageCircle, Video, Brain } from "lucide-react";

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
            Le chat qui te fait monter de niveau.
          </h1>
          <p className="mt-4 text-base text-gray-300 md:text-lg">
            {inviter
              ? `${inviter} t’a invité à rejoindre BFZoom.`
              : "Crée ton compte et commence à discuter."}
          </p>
          <p className="mt-2 text-sm text-gray-400">
            Corrige, traduis et transforme tes échanges en actions claires.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
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
              <MessageCircle className="h-6 w-6 text-amber-300" />
              <p className="mt-3 text-sm font-semibold">Chat intelligent</p>
              <p className="text-xs text-gray-400">
                Résumés & actions en 1 clic.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <Brain className="h-6 w-6 text-emerald-300" />
              <p className="mt-3 text-sm font-semibold">Training</p>
              <p className="text-xs text-gray-400">
                Coaching guidé, exercices, progrès.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-2">
              <Video className="h-6 w-6 text-blue-300" />
              <p className="mt-3 text-sm font-semibold">Visio BFZOOM</p>
              <p className="text-xs text-gray-400">
                Appels fluides + partage d’objectifs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}