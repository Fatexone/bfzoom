"use client";

import Link from "next/link";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-linear-to-b from-blue-50 via-sky-50 to-sky-100 text-slate-900">
      <header className="sticky top-0 z-40 w-full bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="text-lg sm:text-xl font-extrabold tracking-tight">
            <span className="text-sky-600">BFZoom</span>
            <span className="text-slate-700">.live</span>
          </Link>
          <nav className="hidden sm:flex gap-4 text-sm font-medium">
            <Link href="/" className="hover:text-sky-700 transition-colors">
              Accueil
            </Link>
            <Link href="/videoconference" className="hover:text-sky-700 transition-colors">
              Visioconférence
            </Link>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="bg-white/95 backdrop-blur shadow-lg rounded-2xl border border-slate-200 p-6 sm:p-8">
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 mb-3">
            Contact
          </h1>
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed mb-6">
            Une question sur BFZoom ou besoin d’assistance&nbsp;? Écris-nous, nous répondons
            rapidement.
          </p>

          <div className="space-y-4 text-sm sm:text-base text-slate-700">
            <div className="flex items-start gap-3">
              <span className="font-semibold text-slate-900">Email</span>
              <a href="mailto:support@bfzoom.live" className="text-sky-700 hover:underline">
                support@bfzoom.live
              </a>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-semibold text-slate-900">Disponibilité</span>
              <span>Lundi – vendredi, 9h-18h (CET)</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-semibold text-slate-900">Bug ou suggestion</span>
              <span>Décris le problème rencontré et l’URL de la salle si possible.</span>
            </div>
          </div>

          <div className="mt-8">
            <Link
              href="/videoconference"
              className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-sky-600 text-white text-sm sm:text-base font-medium hover:bg-sky-700 transition-colors"
            >
              Retour à la visioconférence
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}