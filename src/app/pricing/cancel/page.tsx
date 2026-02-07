"use client";

import Link from "next/link";

export default function PricingCancelPage() {
  return (
    <div className="min-h-dvh bg-linear-to-br from-gray-950 via-gray-900 to-black text-white px-6 py-12">
      <div className="mx-auto max-w-xl rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <h1 className="text-2xl font-bold">Paiement annulé</h1>
        <p className="mt-2 text-sm text-gray-300">
          Pas de souci. Tu peux réessayer quand tu veux.
        </p>
        <Link
          href="/pricing"
          className="mt-6 inline-flex rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white hover:bg-amber-700"
        >
          Voir les offres
        </Link>
      </div>
    </div>
  );
}