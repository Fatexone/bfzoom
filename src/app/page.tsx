"use client";

import { useEffect, useState, type CSSProperties, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { Manrope, Space_Grotesk } from "next/font/google";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  ArrowRight,
  Bot,
  CreditCard,
  Globe2,
  Languages,
  MessageSquareText,
  ShieldCheck,
  Video,
} from "lucide-react";
import { auth } from "@/lib/firebaseConfig";

const titleFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bodyFont = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

type FeatureCard = {
  title: string;
  detail: string;
  icon: ComponentType<{ className?: string }>;
};

type ModuleCard = {
  title: string;
  detail: string;
  bullets: string[];
  href: string;
  cta: string;
  icon: ComponentType<{ className?: string }>;
  shellClass: string;
  iconClass: string;
};

const featureCards: FeatureCard[] = [
  {
    title: "Appel gratuit",
    detail: "Tu entres dans la room sans abonnement. BFZoom facture la traduction et l'IA a l'usage.",
    icon: CreditCard,
  },
  {
    title: "Comprendre en direct",
    detail: "Sous-titres, traduction et restitution vocale pour garder un echange fluide entre langues.",
    icon: Languages,
  },
  {
    title: "Suivi apres l'appel",
    detail: "AI Practice et le chat prolongent l'echange avant et apres la visio.",
    icon: MessageSquareText,
  },
];

const moduleCards: ModuleCard[] = [
  {
    title: "Visioconference multilingue",
    detail: "Le coeur du produit. Tu crees une room, choisis les langues et actives la traduction seulement quand il faut.",
    bullets: [
      "Room partageable en un lien",
      "Sous-titres et traduction vocale",
      "Micro, camera et langues dans le meme flow",
    ],
    href: "/videoconference",
    cta: "Lancer une visio",
    icon: Video,
    shellClass:
      "border-slate-900/70 bg-[linear-gradient(165deg,#081433_0%,#0c2a70_62%,#14b8ff_140%)] text-white shadow-[0_32px_90px_rgba(8,20,51,0.28)]",
    iconClass: "bg-white/12 text-white",
  },
  {
    title: "AI Practice",
    detail: "Tu prepares une reponse, ecoutes la phonetic, repetes et memorises avant une vraie conversation.",
    bullets: [
      "Coach de formulation avant envoi",
      "Audio, phonetic et repetition",
      "Carnet des phrases utiles",
    ],
    href: "/practice",
    cta: "Ouvrir AI Practice",
    icon: Bot,
    shellClass: "border-amber-200 bg-[linear-gradient(180deg,#fff8ef_0%,#ffffff_100%)] text-slate-950",
    iconClass: "bg-amber-100 text-amber-700",
  },
  {
    title: "Chat BFZoom",
    detail: "Tu gardes le lien apres l'appel, sans sortir de l'ecosysteme BFZoom.",
    bullets: [
      "Conversation asynchrone",
      "Suivi simple apres un call",
      "Continuite entre room, IA et messages",
    ],
    href: "/chat",
    cta: "Ouvrir le chat",
    icon: MessageSquareText,
    shellClass: "border-cyan-200 bg-[linear-gradient(180deg,#eff9ff_0%,#ffffff_100%)] text-slate-950",
    iconClass: "bg-cyan-100 text-cyan-700",
  },
];

const supportedLanguages = [
  "Arabe",
  "Darija (Maghreb)",
  "Anglais",
  "Chinois",
  "Espagnol",
  "Persan",
  "Hebreu",
  "Italien",
  "Russe",
];

const workflowSteps = [
  {
    title: "Tu lances la room",
    detail: "La visio reste la porte d'entree simple et gratuite du produit.",
  },
  {
    title: "BFZoom traduit le moment critique",
    detail: "La valeur apparait quand les langues se croisent, pas avant.",
  },
  {
    title: "Tu prolonges l'echange",
    detail: "AI Practice et le chat prennent le relais avant ou apres la conversation live.",
  },
];

const primaryCtaHref = "/login?next=/videoconference?create=1";

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState("");

  const theme = {
    "--ink": "#081433",
    "--paper": "#f4eee5",
  } as CSSProperties;

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserEmail(user.email ?? "");
        router.replace("/dashboard");
        return;
      }

      setUserEmail("");
      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div
        className={`${bodyFont.className} flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f4eee5_0%,#eaf3f7_100%)] px-6 text-slate-900`}
      >
        <div className="rounded-[1.75rem] border border-slate-200 bg-white/92 px-6 py-5 shadow-[0_24px_60px_rgba(8,20,51,0.08)]">
          <p className="text-sm font-semibold text-slate-600">Chargement de BFZoom...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${bodyFont.className} min-h-screen text-[var(--ink)]`} style={theme}>
      <div className="relative overflow-hidden bg-[var(--paper)]">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#f4eee5_0%,#ebf3f7_48%,#f7fbfd_100%)]" />
        <div className="absolute left-[-8rem] top-16 -z-10 h-72 w-72 rounded-full bg-cyan-300/30 blur-3xl" />
        <div className="absolute right-[-6rem] top-12 -z-10 h-80 w-80 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute inset-x-0 top-0 -z-10 h-[42rem] bg-[radial-gradient(circle_at_top,rgba(12,42,112,0.08),transparent_52%)]" />

        <header className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-6 lg:px-8">
          <Link href="/" className="inline-flex min-w-0 items-center gap-3">
            <Image
              src="/brand/bfzoom-logo.svg"
              alt="BFZoom logo"
              width={42}
              height={42}
              className="h-10 w-10 rounded-[1rem]"
            />
            <div className="min-w-0">
              <p className={`${titleFont.className} text-lg font-semibold tracking-tight text-slate-950`}>BFZoom</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                by Beyond Frontiers
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-700 lg:flex">
            <Link className="transition hover:text-slate-950" href="#produit">
              Produit
            </Link>
            <Link className="transition hover:text-slate-950" href="#modules">
              Modules
            </Link>
            <Link className="transition hover:text-slate-950" href="#workflow">
              Workflow
            </Link>
            <Link className="transition hover:text-slate-950" href="/contact">
              Contact
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden rounded-full border border-slate-300 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950 sm:inline-flex"
            >
              Se connecter
            </Link>
            <Link
              href={primaryCtaHref}
              className="inline-flex rounded-full bg-[linear-gradient(135deg,#081433_0%,#0c2a70_72%,#14b8ff_100%)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(12,42,112,0.18)] transition hover:brightness-[1.03] hover:saturate-110"
            >
              Lancer BFZoom
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-6 pb-18 pt-8 lg:px-8 lg:pb-24 lg:pt-10">
          <section className="grid gap-10 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
            <div className="max-w-3xl">
              <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-cyan-900/8 bg-white/85 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-900 shadow-sm">
                <Globe2 className="h-3.5 w-3.5" />
                Communication multilingue en direct
              </div>

              <h1
                className={`${titleFont.className} mt-6 max-w-4xl text-5xl font-semibold leading-[0.98] text-slate-950 sm:text-6xl lg:text-7xl`}
              >
                Parlez chacun votre langue.
                <span className="mt-2 block text-[#0c2a70]">Comprenez-vous en direct.</span>
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-8 text-slate-600 sm:text-lg">
                BFZoom n&apos;est pas une page de visio de plus. C&apos;est un produit pense pour les
                echanges entre langues differentes, avec une logique simple: appel gratuit,
                traduction a l&apos;usage, AI Practice avant l&apos;echange et chat pour le suivi.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={primaryCtaHref}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#081433_0%,#0c2a70_72%,#14b8ff_100%)] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_20px_44px_rgba(12,42,112,0.2)] transition hover:brightness-[1.03] hover:saturate-110"
                >
                  Creer une visio
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/practice"
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white/85 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                >
                  Tester AI Practice
                </Link>
                {userEmail ? (
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white/85 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                  >
                    Aller au dashboard
                  </Link>
                ) : (
                  <Link
                    href="/signup"
                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white/85 px-6 py-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-950"
                  >
                    Creer un compte
                  </Link>
                )}
              </div>

              <div className="mt-8 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                {["Appel gratuit", "Traduction live", "AI Practice", "Chat integre"].map((item) => (
                  <span key={item} className="rounded-full border border-slate-200 bg-white/88 px-3 py-1.5 shadow-sm">
                    {item}
                  </span>
                ))}
              </div>

              <div className="mt-8 rounded-[2rem] border border-slate-200/80 bg-white/90 p-5 shadow-[0_24px_60px_rgba(8,20,51,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                      Langues actives
                    </p>
                    <p className={`${titleFont.className} mt-2 text-2xl font-semibold text-slate-950`}>
                      BFZoom connecte les conversations qui se bloquent sur la langue.
                    </p>
                  </div>
                  <span className="hidden rounded-full bg-slate-950 px-3 py-1 text-xs font-semibold text-white sm:inline-flex">
                    Live
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {supportedLanguages.map((language) => (
                    <span
                      key={language}
                      className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700"
                    >
                      {language}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-x-10 top-10 -z-10 h-48 rounded-full bg-cyan-300/30 blur-3xl" />
              <div className="rounded-[2.2rem] border border-slate-950/70 bg-[linear-gradient(155deg,#071229_0%,#0a1d48_52%,#103d7d_100%)] p-5 text-white shadow-[0_38px_120px_rgba(8,20,51,0.28)] sm:p-6">
                <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.05] p-5 backdrop-blur-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/80">
                        BFZoom live room
                      </p>
                      <p className={`${titleFont.className} mt-2 text-2xl font-semibold text-white`}>
                        French to Arabic
                      </p>
                    </div>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-400/12 px-3 py-1 text-[11px] font-semibold text-cyan-50">
                      Appel gratuit
                    </span>
                  </div>

                  <div className="mt-6 space-y-4">
                    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.06] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Ce que tu dis
                      </p>
                      <p className="mt-3 text-lg font-semibold text-white">
                        Bonjour, nous pouvons commencer quand vous etes pret.
                      </p>
                    </div>

                    <div className="rounded-[1.4rem] border border-cyan-300/18 bg-cyan-400/10 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/78">
                        Traduction BFZoom
                      </p>
                      <p className="mt-3 text-lg font-semibold text-cyan-50">
                        Marhaban, yumkinuna al-bad indama takun jahizan.
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.06] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                        Minutes actives
                      </p>
                      <p className={`${titleFont.className} mt-2 text-3xl font-semibold text-white`}>60</p>
                      <p className="mt-2 text-sm text-slate-300">Tu paies la traduction quand elle tourne, pas l&apos;entree en call.</p>
                    </div>
                    <div className="rounded-[1.4rem] border border-amber-300/16 bg-amber-400/10 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/78">
                        AI Practice
                      </p>
                      <p className={`${titleFont.className} mt-2 text-2xl font-semibold text-white`}>Pret avant l&apos;appel</p>
                      <p className="mt-2 text-sm text-slate-200">Travaille la reponse, la phonetic et l&apos;audio avant la conversation live.</p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Sous-titres", value: "Live" },
                    { label: "Chat", value: "Suivi" },
                    { label: "Coach IA", value: "Avant / apres" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[1.2rem] border border-white/10 bg-slate-950/25 px-4 py-3 text-center backdrop-blur-sm"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/55">{item.label}</p>
                      <p className="mt-2 text-sm font-semibold text-white">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section id="produit" className="mt-20 grid gap-5 md:grid-cols-3">
            {featureCards.map((item) => {
              const Icon = item.icon;
              return (
                <article
                  key={item.title}
                  className="rounded-[2rem] border border-slate-200/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(8,20,51,0.08)]"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-[1.15rem] bg-slate-950 text-white shadow-[0_14px_30px_rgba(8,20,51,0.14)]">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h2 className={`${titleFont.className} mt-5 text-2xl font-semibold text-slate-950`}>
                    {item.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.detail}</p>
                </article>
              );
            })}
          </section>

          <section className="mt-20 rounded-[2.4rem] border border-slate-950/80 bg-[linear-gradient(145deg,#081433_0%,#0b245f_54%,#144689_100%)] px-6 py-8 text-white shadow-[0_40px_120px_rgba(8,20,51,0.26)] sm:px-8 lg:px-10">
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/78">
                  Positionnement
                </p>
                <h2 className={`${titleFont.className} mt-3 text-3xl font-semibold sm:text-4xl`}>
                  BFZoom n&apos;est pas un clone de Zoom avec une option de traduction.
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-200 sm:text-base">
                  Le coeur de BFZoom, c&apos;est la comprehension entre langues differentes. La visio
                  reste simple. La valeur arrive quand la traduction, l&apos;IA et le suivi donnent un
                  vrai avantage dans la conversation.
                </p>
              </div>

              <div className="grid gap-3">
                {[
                  "Visio gratuite pour entrer dans l'echange",
                  "Traduction live seulement quand elle cree de la valeur",
                  "AI Practice pour preparer les reponses avant le moment important",
                  "Chat pour prolonger la relation sans sortir du produit",
                ].map((item) => (
                  <div
                    key={item}
                    className="rounded-[1.4rem] border border-white/10 bg-white/[0.06] px-4 py-4 text-sm font-medium text-slate-100 backdrop-blur-sm"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section id="modules" className="mt-20">
            <div className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Une plateforme, trois roles
              </p>
              <h2 className={`${titleFont.className} mt-3 text-3xl font-semibold text-slate-950 sm:text-4xl`}>
                Le produit est clair quand chaque module a sa place.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
                La landing doit vendre la visio multilingue en premier. AI Practice et le chat
                servent la promesse, ils ne la concurrencent pas.
              </p>
            </div>

            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              {moduleCards.map((item) => {
                const Icon = item.icon;
                return (
                  <article
                    key={item.title}
                    className={`rounded-[2rem] border p-6 ${item.shellClass}`}
                  >
                    <span className={`inline-flex h-12 w-12 items-center justify-center rounded-[1.1rem] ${item.iconClass}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className={`${titleFont.className} mt-5 text-2xl font-semibold`}>{item.title}</h3>
                    <p className={`mt-3 text-sm leading-7 ${item.title === "Visioconference multilingue" ? "text-white/80" : "text-slate-600"}`}>
                      {item.detail}
                    </p>
                    <div className="mt-5 space-y-2">
                      {item.bullets.map((bullet) => (
                        <div
                          key={bullet}
                          className={`rounded-[1.1rem] border px-4 py-3 text-sm font-medium ${
                            item.title === "Visioconference multilingue"
                              ? "border-white/10 bg-white/[0.06] text-white/92"
                              : "border-slate-200 bg-white/82 text-slate-700"
                          }`}
                        >
                          {bullet}
                        </div>
                      ))}
                    </div>
                    <Link
                      href={item.href}
                      className={`mt-6 inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                        item.title === "Visioconference multilingue"
                          ? "border border-white/14 bg-white/[0.08] text-white hover:bg-white/[0.14]"
                          : "border border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:text-slate-950"
                      }`}
                    >
                      {item.cta}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </article>
                );
              })}
            </div>
          </section>

          <section id="workflow" className="mt-20 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[2rem] border border-slate-200/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(8,20,51,0.08)] sm:p-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                Workflow BFZoom
              </p>
              <h2 className={`${titleFont.className} mt-3 text-3xl font-semibold text-slate-950`}>
                Un parcours simple pour l&apos;utilisateur.
              </h2>
              <div className="mt-6 grid gap-4">
                {workflowSteps.map((step, index) => (
                  <article
                    key={step.title}
                    className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 px-5 py-5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                        {index + 1}
                      </span>
                      <h3 className={`${titleFont.className} text-xl font-semibold text-slate-950`}>
                        {step.title}
                      </h3>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{step.detail}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="rounded-[2rem] border border-amber-200/70 bg-[linear-gradient(180deg,#fff7ee_0%,#ffffff_100%)] p-6 shadow-[0_24px_60px_rgba(120,53,15,0.08)] sm:p-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-800">
                Modele economique
              </p>
              <h2 className={`${titleFont.className} mt-3 text-3xl font-semibold text-slate-950`}>
                Gratuit pour appeler. Credits pour traduire et utiliser l&apos;IA.
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                C&apos;est la partie qui donne son serieux a BFZoom. Tu n&apos;achetes pas l&apos;entree dans
                la room. Tu paies quand la traduction ou l&apos;IA creent une vraie valeur pendant
                l&apos;echange.
              </p>

              <div className="mt-6 grid gap-3">
                {[
                  { label: "60 min", price: "9,90 EUR" },
                  { label: "180 min", price: "24,90 EUR" },
                  { label: "600 min", price: "69 EUR" },
                ].map((pack) => (
                  <Link
                    key={pack.label}
                    href="/credits"
                    className="flex items-center justify-between rounded-[1.3rem] border border-amber-200 bg-white/92 px-4 py-4 transition hover:border-amber-300 hover:bg-white"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-950">{pack.label}</p>
                      <p className="text-xs text-slate-500">Minutes actives de traduction BFZoom</p>
                    </div>
                    <p className="text-sm font-semibold text-amber-800">{pack.price}</p>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-20 rounded-[2.4rem] border border-slate-950/80 bg-[linear-gradient(145deg,#081433_0%,#0c2a70_62%,#14b8ff_145%)] px-6 py-8 text-white shadow-[0_40px_120px_rgba(8,20,51,0.26)] sm:px-8 lg:px-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/76">
                  BFZoom by Beyond Frontiers
                </p>
                <h2 className={`${titleFont.className} mt-3 text-3xl font-semibold sm:text-4xl`}>
                  Une identite claire, un produit utile, une promesse simple.
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-200 sm:text-base">
                  Lance la visio gratuitement. Active la traduction quand la langue bloque.
                  Prepare-toi avec l&apos;IA. Continue dans le chat. C&apos;est cela que la landing BFZoom
                  doit faire comprendre en quelques secondes.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={primaryCtaHref}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                >
                  Ouvrir BFZoom
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 rounded-full border border-white/18 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                >
                  Nous contacter
                </Link>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { icon: ShieldCheck, text: "Promesse lisible" },
                { icon: Video, text: "Visio d'abord" },
                { icon: Languages, text: "Traduction quand necessaire" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.text}
                    className="rounded-[1.35rem] border border-white/10 bg-white/[0.06] px-4 py-4 backdrop-blur-sm"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
                        <Icon className="h-4 w-4" />
                      </span>
                      <p className="text-sm font-semibold text-white">{item.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
