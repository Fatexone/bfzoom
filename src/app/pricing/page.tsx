"use client";

import { useState } from "react";
import { auth } from "@/lib/firebaseConfig";
import { getIdToken } from "firebase/auth";

export default function PricingPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);
    try {
      const current = auth.currentUser;
      if (!current) {
        throw new Error("Connecte-toi pour passer Premium.");
      }
      const token = await getIdToken(current, true);
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Erreur paiement");
      }
      window.location.href = data.url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur paiement";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh bg-linear-to-br from-gray-950 via-gray-900 to-black text-white px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-bold">Passe en Premium</h1>
        <p className="mt-2 text-gray-300">
          Débloque la traduction illimitée, la correction avancée et les résumés IA.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Gratuit</h2>
            <ul className="mt-4 space-y-2 text-sm text-gray-300">
              <li>• Chat 1‑1 + groupes</li>
              <li>• 30 améliorations / mois</li>
              <li>• 10 résumés IA / mois</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-6">
            <h2 className="text-xl font-semibold">Premium</h2>
            <p className="mt-2 text-3xl font-bold">9,90€ / mois</p>
            <ul className="mt-4 space-y-2 text-sm text-gray-100">
              <li>• Traduction illimitée</li>
              <li>• Correction + coaching linguistique</li>
              <li>• Résumés & actions illimités</li>
            </ul>
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="mt-6 w-full rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {loading ? "Redirection..." : "Passer Premium"}
            </button>
            {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}