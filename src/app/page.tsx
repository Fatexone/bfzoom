"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Manrope, Space_Grotesk } from "next/font/google";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { onAuthStateChanged } from "firebase/auth";

const titleFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

const bodyFont = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true); 
  const [userEmail, setUserEmail] = useState("");

  const theme = {
    "--ink": "#0b1220",
    "--brand": "#0ea5e9",
    "--accent": "#f59e0b",
    "--paper": "#f8fafc",
  } as CSSProperties;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("🕵️ Vérification de l'utilisateur...", user);
      setUserEmail(user?.email ?? "");
      
      setTimeout(() => { // ✅ Ajout d'un délai
        if (user) {
          console.log("🔄 Utilisateur connecté, redirection vers /dashboard...");
          router.push("/dashboard");
        } else {
          console.log("👤 Aucun utilisateur connecté, affichage de la page d'accueil.");
        }
      }, 1500); // 🔄 Attente de 1.5s pour éviter un problème de synchro Firebase
      
      setLoading(false);
    });
  
    return () => unsubscribe();
  }, [router]);
  
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">⏳ Chargement...</div>;
  }

  return (
    <div className={`${bodyFont.className} min-h-screen text-(--ink)`} style={theme}>
      <div className="relative overflow-hidden bg-(--paper)">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(40%_40%_at_12%_10%,rgba(14,165,233,0.25),transparent),radial-gradient(45%_35%_at_90%_15%,rgba(245,158,11,0.2),transparent),linear-gradient(180deg,#f8fafc,#eef3f8_40%,#f9fafb)]" />
        <div className="absolute -right-24 top-20 -z-10 h-72 w-72 rounded-full bg-sky-200/60 blur-3xl" />
        <div className="absolute -left-32 bottom-24 -z-10 h-80 w-80 rounded-full bg-amber-200/60 blur-3xl" />

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
          <div className={`${titleFont.className} text-xl font-semibold tracking-tight`}>
            BFZoom
            <span className="ml-2 text-xs font-semibold text-slate-500">live</span>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-700 md:flex">
            <Link className="hover:text-slate-950 transition" href="/videoconference">
              Visioconference
            </Link>
            <Link className="hover:text-slate-950 transition" href="/practice">
              Entrainement
            </Link>
            <Link className="hover:text-slate-950 transition" href="/chat">
              Chat
            </Link>
            <Link className="hover:text-slate-950 transition" href="/contact">
              Contact
            </Link>
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-400 hover:text-slate-900 transition"
            >
              Se connecter
            </Link>
            <Link
              href="/login?next=/videoconference?create=1"
              className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition"
            >
              Creer une session
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-6 pb-16 pt-10 sm:pt-16">
          <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
                Reunions multilingues & entrainement
              </p>
              <h1
                className={`${titleFont.className} mt-4 text-4xl font-semibold leading-tight text-slate-900 sm:text-5xl`}
              >
                Des reunions video nettes, un chat fluide, et un module
                d&rsquo;apprentissage des langues pour tes calls internationaux.
              </h1>
              <p className="mt-4 max-w-xl text-base text-slate-600 sm:text-lg">
                BFZoom te permet de lancer une session en quelques secondes,
                de choisir la langue du meeting, et de t&rsquo;entrainer a parler
                avant tes rendez-vous avec un alter ego intelligent.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link
                  href="/login?next=/videoconference?create=1"
                  className="rounded-2xl bg-sky-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200/80 hover:bg-sky-500 transition"
                >
                  Creer une session
                </Link>
                <Link
                  href="/practice"
                  className="rounded-2xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 transition"
                >
                  S&rsquo;entrainer
                </Link>
                {userEmail ? (
                  <Link
                    href="/dashboard"
                    className="rounded-2xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 transition"
                  >
                    Aller au dashboard
                  </Link>
                ) : (
                  <Link
                    href="/signup"
                    className="rounded-2xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 transition"
                  >
                    Creer un compte
                  </Link>
                )}
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-xs text-slate-600">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  Langue du meeting
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇸🇦 Arabe</span>
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇬🇧 Anglais</span>
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇨🇳 Chinois</span>
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇪🇸 Espagnol</span>
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇮🇷 Persan</span>
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇮🇱 Hebreu</span>
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇮🇹 Italien</span>
                  <span className="rounded-full border border-slate-200 px-3 py-1">🇷🇺 Russe</span>
                </div>
              </div>
              <div className="mt-6 flex items-center gap-4 text-xs text-slate-500">
                <span className="rounded-full bg-slate-900 px-3 py-1 font-semibold text-white">
                  1 clic
                </span>
                <span>Invitations faciles</span>
                <span>Qualite adaptee au reseau</span>
                <span>Langues du meeting</span>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Collaboration instantanee
                  </span>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                    Simple
                  </span>
                </div>
                <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="text-sm font-semibold text-slate-900">
                    Creer une session, puis partager le lien de la salle.
                  </p>
                  <p className="mt-2 text-xs text-slate-600">
                  Ton interlocuteur n&rsquo;a qu&rsquo;a cliquer pour rejoindre.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-16 grid gap-6 md:grid-cols-3">
            {[
              {
                title: "Sessions stables",
                detail: "Video fluide, gestion des coupures et reprise rapide.",
              },
              {
                title: "Chat intelligent",
                detail: "Historique propre, notifications et partage instantane.",
              },
              {
                title: "Controles pro",
                detail: "Camera, micro, plein ecran et partage en un geste.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg"
              >
                <h3 className={`${titleFont.className} text-lg font-semibold text-slate-900`}>
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-slate-600">{item.detail}</p>
              </div>
            ))}
          </section>

          <section className="mt-16 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="rounded-3xl border border-slate-200 bg-white/95 p-6 shadow-lg">
                <h3 className={`${titleFont.className} text-xl font-semibold text-slate-900`}>
                  Module d&rsquo;apprentissage des langues
                </h3>
              <p className="mt-2 text-sm text-slate-600">
                En visio, tu choisis la langue du meeting. Le module training te prepare
                a parler ces langues avant tes calls.
              </p>
              <p className="mt-3 text-xs text-slate-500">
                Arabe • Anglais • Chinois • Espagnol • Persan (Farsi) • Hebreu • Italien • Russe
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Link
                    href="/practice"
                    className="rounded-2xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition"
                  >
                    Tester l&rsquo;entrainement
                  </Link>
                <Link
                  href="/dashboard"
                  className="rounded-2xl border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400 transition"
                >
                  Voir les modules
                </Link>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <div className="grid gap-4">
                {[
                  "Choix de la langue du meeting",
                  "Lecons adaptees au niveau",
                  "Push-to-talk, pas d'enregistrement continu",
                  "Répéter, phonétique, traduction",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-16 rounded-3xl border border-slate-200 bg-slate-900 px-6 py-8 text-white sm:px-10">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className={`${titleFont.className} text-2xl font-semibold`}>
                  Pret a lancer ta prochaine session ?
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Lance une salle ou entraine-toi avant un rendez-vous important.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/login?next=/videoconference?create=1"
                  className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-200 transition"
                >
                  Demarrer maintenant
                </Link>
                  <Link
                    href="/practice"
                    className="rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10 transition"
                  >
                    S&rsquo;entrainer
                  </Link>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}