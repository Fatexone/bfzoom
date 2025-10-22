"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import VideoConferenceContent from "@/components/video/VideoConferenceContent";

/* =======================================================
   🎥 PAGE VISIO — fond bleu clair, responsive, menu déroulant
======================================================= */
export default function VideoConferencePage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <ResponsiveLayout>
        <VideoConferenceContent />
      </ResponsiveLayout>
    </Suspense>
  );
}

/* =======================================================
   🧱 Layout clair & responsive avec menu burger
======================================================= */
function ResponsiveLayout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-blue-50 via-sky-50 to-sky-100 text-slate-900">
      {/* ===== HEADER ===== */}
      <header className="w-full bg-white/90 backdrop-blur border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center px-4 py-3 sm:px-6 sm:py-4">
          <Link href="/" className="text-lg sm:text-xl font-extrabold tracking-tight">
            <span className="text-sky-600">BFZoom</span>
            <span className="text-slate-700">.live</span>
          </Link>

          {/* === Menu Desktop === */}
          <nav className="hidden md:flex gap-6 text-sm font-medium">
            <Link href="/" className="hover:text-sky-700 transition-colors">
              Accueil
            </Link>
            <Link href="/dashboard" className="hover:text-sky-700 transition-colors">
              Tableau de bord
            </Link>
            <Link href="/contact" className="hover:text-sky-700 transition-colors">
              Contact
            </Link>
          </nav>

          {/* === Burger Mobile === */}
          <button
            aria-label="Ouvrir le menu"
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden p-2 rounded-lg hover:bg-slate-100"
          >
            {menuOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {/* === Menu mobile déroulant === */}
        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="md:hidden bg-white/95 backdrop-blur border-t border-slate-200 shadow-sm"
            >
              <div className="flex flex-col">
                <Link
                  href="/"
                  className="px-6 py-3 text-sm border-b border-slate-100 hover:bg-slate-50"
                  onClick={() => setMenuOpen(false)}
                >
                  Accueil
                </Link>
                <Link
                  href="/dashboard"
                  className="px-6 py-3 text-sm border-b border-slate-100 hover:bg-slate-50"
                  onClick={() => setMenuOpen(false)}
                >
                  Tableau de bord
                </Link>
                <Link
                  href="/contact"
                  className="px-6 py-3 text-sm hover:bg-slate-50"
                  onClick={() => setMenuOpen(false)}
                >
                  Contact
                </Link>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      {/* ===== CONTENU ===== */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 sm:px-8 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-6xl"
        >
          {children}
        </motion.div>
      </main>

      {/* ===== FOOTER ===== */}
      <footer className="w-full bg-white/90 backdrop-blur border-t border-slate-200 py-4 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} <b>BFZoom</b> — visioconférence privée & sécurisée
      </footer>
    </div>
  );
}

/* =======================================================
   ⏳ Fallback de chargement léger & clair
======================================================= */
function LoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-blue-50 via-sky-50 to-sky-100 text-slate-700">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col items-center gap-4"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full"
        />
        <p className="text-sm font-medium">Chargement de la visioconférence…</p>
      </motion.div>
    </div>
  );
}
