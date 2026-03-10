"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { Bot, ChevronDown, ChevronUp, LogOut, MessageSquare, Share2, Video } from "lucide-react";
import { motion } from "framer-motion";
import { auth, db } from "@/lib/firebaseConfig";
import { ADMIN_EMAIL, ENABLE_STANDALONE_CHAT_MODULE } from "@/config/constants";
import { useTokenWallet } from "@/hooks/useTokenWallet";
import { setAuthGuardCookie } from "@/lib/authGuard";
import UiLocaleSwitch from "@/components/ui/UiLocaleSwitch";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";

type StatusTag = "Admin" | "Premium" | "Decouverte";

const CREDIT_PACKS = [
  { id: "60", label: "60 min", price: "9,90€" },
  { id: "180", label: "180 min", price: "24,90€" },
  { id: "600", label: "600 min", price: "69€" },
] as const;

type DashboardCopy = {
  labels: {
    dashboard: string;
    loading: string;
    welcome: string;
    subtitle: string;
    profileActive: string;
    credits: string;
    status: string;
    role: string;
    emailVerified: string;
    yes: string;
    no: string;
    noActiveCredits: string;
    buyPack: string;
    buyPackPrefix: string;
    preparing: string;
    viewAllOffers: string;
    actions: string;
    createRoom: string;
    openChat: string;
    openAiExercise: string;
    recommendedMode: string;
    offersCredits: string;
    inviteFriend: string;
    advice: string;
    logout: string;
    tokenMessagePurchase: string;
    tokenNeedLogin: string;
    tokenMissingLink: string;
    tokenPrepareError: string;
    adminNoRecharge: string;
    premiumIncluded: string;
    freeMinutesInfo: string;
    statusDisplay: Record<StatusTag, string>;
  };
  share: {
    title: string;
    text: string;
    copied: string;
    prompt: string;
  };
  planRules: Record<StatusTag, string[]>;
  planSummary: Record<StatusTag, string>;
};

const DASHBOARD_COPY: Record<UiLocale, DashboardCopy> = {
  fr: {
    labels: {
      dashboard: "Dashboard",
      loading: "Chargement...",
      welcome: "Bienvenue",
      subtitle: "Crée une room, ouvre le chat et gère tes crédits depuis un seul écran.",
      profileActive: "Profil actif",
      credits: "Crédits",
      status: "Statut",
      role: "Rôle",
      emailVerified: "E-mail vérifié",
      yes: "Oui",
      no: "Non",
      noActiveCredits: "0 · Aucun crédit actif",
      buyPack: "Acheter pack",
      buyPackPrefix: "Acheter pack",
      preparing: "Préparation...",
      viewAllOffers: "Voir toutes les offres",
      actions: "Actions principales",
      createRoom: "Créer une salle",
      openChat: "Accéder au chat",
      openAiExercise: "Exercice IA",
      recommendedMode: "Mode recommandé : visio pour le live, chat/appels pour le suivi.",
      offersCredits: "Voir les offres crédits",
      inviteFriend: "Inviter un ami",
      advice: "Partage ton lien puis active la traduction uniquement quand nécessaire.",
      logout: "Se déconnecter",
      tokenMessagePurchase: "Paiement validé. Tes crédits arrivent bientôt.",
      tokenNeedLogin: "Connecte-toi pour acheter des crédits.",
      tokenMissingLink: "Lien de paiement introuvable.",
      tokenPrepareError: "Erreur lors de la préparation du paiement.",
      adminNoRecharge: "Compte administrateur : recharge non nécessaire sur ce profil.",
      premiumIncluded: "Premium actif : traduction disponible sans pack crédits complémentaire.",
      freeMinutesInfo: "3 minutes offertes (essai unique). Quand c'est épuisé : active un pack crédits.",
      statusDisplay: {
        Admin: "Admin",
        Premium: "Premium",
        Decouverte: "Découverte",
      },
    },
    share: {
      title: "BFZoom",
      text: "Rejoins-moi sur BFZoom",
      copied: "Lien d’invitation copié !",
      prompt: "Copie ce lien :",
    },
    planRules: {
      Admin: [
        "Accès administrateur complet.",
        "Visio et traduction sans limite sur ce compte.",
        "Compte interne de supervision.",
      ],
      Premium: [
        "Visioconférence multilingue avec mode exercice.",
        "Sous-titres, voix et phonétique disponibles.",
        "Invités par lien, sans compte.",
      ],
      Decouverte: [
        "Visioconférence simple accessible.",
        "3 minutes de traduction offertes une seule fois.",
        "Puis packs crédits 60 / 180 / 600 minutes.",
      ],
    },
    planSummary: {
      Admin: "Mode administrateur : gestion complète et accès illimité.",
      Premium: "Plan Premium : visio multilingue avancée et traduction active.",
      Decouverte: "Compte découverte : visio incluse, 3 minutes de traduction offertes une seule fois.",
    },
  },
  en: {
    labels: {
      dashboard: "Dashboard",
      loading: "Loading...",
      welcome: "Welcome",
      subtitle: "Create a room, open chat, and manage credits from one place.",
      profileActive: "Active profile",
      credits: "Credits",
      status: "Status",
      role: "Role",
      emailVerified: "Email verified",
      yes: "Yes",
      no: "No",
      noActiveCredits: "0 · No active credits",
      buyPack: "Buy pack",
      buyPackPrefix: "Buy pack",
      preparing: "Preparing...",
      viewAllOffers: "View all plans",
      actions: "Main actions",
      createRoom: "Create room",
      openChat: "Open chat",
      openAiExercise: "AI practice",
      recommendedMode: "Recommended flow: video for live sessions, chat/calls for follow-up.",
      offersCredits: "View credit plans",
      inviteFriend: "Invite a friend",
      advice: "Share your link, then enable translation only when needed.",
      logout: "Log out",
      tokenMessagePurchase: "Payment confirmed. Your credits will appear soon.",
      tokenNeedLogin: "Sign in to buy credits.",
      tokenMissingLink: "Payment link not found.",
      tokenPrepareError: "Could not prepare checkout.",
      adminNoRecharge: "Admin account: no top-up needed for this profile.",
      premiumIncluded: "Premium active: translation available without additional credit packs.",
      freeMinutesInfo: "3 free minutes (one-time trial). After that, activate a credit pack.",
      statusDisplay: {
        Admin: "Admin",
        Premium: "Premium",
        Decouverte: "Starter",
      },
    },
    share: {
      title: "BFZoom",
      text: "Join me on BFZoom",
      copied: "Invitation link copied!",
      prompt: "Copy this link:",
    },
    planRules: {
      Admin: [
        "Full administrator access.",
        "Unlimited video and translation on this account.",
        "Internal supervision account.",
      ],
      Premium: [
        "Multilingual video conferencing with practice mode.",
        "Subtitles, voice and phonetics included.",
        "Guests join via link without an account.",
      ],
      Decouverte: [
        "Simple video conferencing included.",
        "3 free translation minutes, one-time trial.",
        "Then credit packs: 60 / 180 / 600 minutes.",
      ],
    },
    planSummary: {
      Admin: "Admin mode: full management access and unlimited usage.",
      Premium: "Premium plan: advanced multilingual video with active translation.",
      Decouverte: "Starter account: video included, 3 free translation minutes as a one-time trial.",
    },
  },
};

export default function Dashboard() {
  const router = useRouter();
  const { locale } = useUiLocale();
  const t = DASHBOARD_COPY[locale];
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const { balance: tokenBalance, tier: tokenTier } = useTokenWallet(user?.uid ?? null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState<(typeof CREDIT_PACKS)[number]["id"]>("60");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoading(false);
      } else {
        setAuthGuardCookie(false);
        router.push("/login?next=/dashboard");
      }
    });
    return () => unsubscribe();
  }, [router]);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    const profileRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(profileRef, (snap) => {
      setProfile(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const setBasedOnViewport = () =>
      setDetailsOpen(window.matchMedia("(min-width: 768px)").matches);
    if (typeof window !== "undefined") {
      setBasedOnViewport();
      window.addEventListener("resize", setBasedOnViewport);
      return () => window.removeEventListener("resize", setBasedOnViewport);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("purchase") === "tokens") {
      setTokenMessage(t.labels.tokenMessagePurchase);
      params.delete("purchase");
      const cleanSearch = params.toString();
      const cleanUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}`;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, [t.labels.tokenMessagePurchase]);

  useEffect(() => {
    router.prefetch("/videoconference");
  }, [router]);

  const handleLogout = async () => {
    await signOut(auth);
    setAuthGuardCookie(false);
    router.push("/login");
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/signup?invite=${user?.uid ?? ""}`;
    if (navigator.share) {
      await navigator.share({
        title: t.share.title,
        text: t.share.text,
        url,
      });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      alert(t.share.copied);
    } else {
      prompt(t.share.prompt, url);
    }
  };

  const isAdminUser = user?.email === ADMIN_EMAIL;

  const statusTag = useMemo<StatusTag>(() => {
    if (isAdminUser) {
      return "Admin";
    }
    if (Boolean(profile?.isPremium) || profile?.plan === "premium") {
      return "Premium";
    }
    return "Decouverte";
  }, [isAdminUser, profile]);

  const planSummary = useMemo(() => t.planSummary[statusTag], [statusTag, t.planSummary]);

  const planDetailsList = useMemo(
    () => t.planRules[statusTag] ?? t.planRules.Decouverte,
    [statusTag, t.planRules]
  );

  const roleLabel = useMemo(() => {
    if (user?.email === ADMIN_EMAIL) {
      return locale === "fr" ? "Administrateur" : "Administrator";
    }
    if (typeof profile?.role === "string" && profile.role) {
      return profile.role;
    }
    return "BFZoomer";
  }, [locale, profile, user?.email]);

  const infoBadges = useMemo(
    () => [
      { label: t.labels.status, value: t.labels.statusDisplay[statusTag] },
      { label: t.labels.role, value: roleLabel },
      { label: t.labels.emailVerified, value: user?.emailVerified ? t.labels.yes : t.labels.no },
    ],
    [roleLabel, statusTag, t.labels, user?.emailVerified]
  );

  const emailLabel = user?.email ?? (locale === "fr" ? "Adresse inconnue" : "Unknown address");
  const hasCredits = (tokenBalance ?? 0) > 0;
  const isPremiumAccount = statusTag === "Premium";

  const handleBuyTokens = async () => {
    setTokenMessage(null);
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setTokenMessage(t.labels.tokenNeedLogin);
      return;
    }
    setTokenLoading(true);
    try {
      const idToken = await currentUser.getIdToken(true);
      const response = await fetch("/api/stripe/tokens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ pack: selectedPack }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error ?? "checkout_error");
      }
      const data = await response.json().catch(() => ({}));
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setTokenMessage(t.labels.tokenMissingLink);
    } catch (error) {
      setTokenMessage(error instanceof Error && error.message !== "checkout_error" ? error.message : t.labels.tokenPrepareError);
    } finally {
      setTokenLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-400 text-lg">
        {t.labels.loading}
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-linear-to-br from-gray-950 via-gray-900 to-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.15),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(34,197,94,0.12),transparent_60%)]" />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex w-full items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/90 transition hover:border-white/30 hover:bg-white/10"
          >
            <Image
              src="/brand/bfzoom-logo.svg"
              alt="BFZoom logo"
              width={28}
              height={28}
              className="h-7 w-7 rounded-lg"
            />
            <span>BFZoom</span>
          </Link>
          <div className="flex items-center gap-3">
            <UiLocaleSwitch theme="dark" />
            <button
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 transition hover:border-white/40 hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t.labels.logout}</span>
            </button>
          </div>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-5 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-xl"
        >
          <p className="text-xs uppercase tracking-[0.22em] text-sky-200/90">{t.labels.dashboard}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {t.labels.welcome}, {emailLabel.split("@")[0]} 👋
          </h1>
          <p className="mt-2 text-sm text-gray-300 sm:text-base">{t.labels.subtitle}</p>
        </motion.section>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.06 }}
            className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-xl"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-blue-200">{t.labels.actions}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => router.push("/videoconference")}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-linear-to-r from-blue-600 to-sky-600 px-4 py-3 text-white transition hover:from-blue-500 hover:to-sky-500"
              >
                <span className="font-semibold">{t.labels.createRoom}</span>
                <Video className="h-5 w-5" />
              </button>

              {ENABLE_STANDALONE_CHAT_MODULE && (
                <button
                  onClick={() => router.push("/chat")}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-linear-to-r from-emerald-600 to-teal-600 px-4 py-3 text-white transition hover:from-emerald-500 hover:to-teal-500"
                >
                  <span className="font-semibold">{t.labels.openChat}</span>
                  <MessageSquare className="h-5 w-5" />
                </button>
              )}

              <button
                onClick={() => router.push("/videoconference?exercise=1")}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-linear-to-r from-amber-600 to-orange-600 px-4 py-3 text-white transition hover:from-amber-500 hover:to-orange-500"
              >
                <span className="font-semibold">{t.labels.openAiExercise}</span>
                <Bot className="h-5 w-5" />
              </button>

              <button
                onClick={() => router.push("/pricing")}
                className="rounded-xl border border-sky-400/60 bg-sky-900/20 px-4 py-3 text-left text-sky-100 transition hover:bg-sky-800/30"
              >
                <span className="font-semibold">{t.labels.offersCredits}</span>
              </button>

              <button
                onClick={handleShare}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white transition hover:border-white/30"
              >
                <span className="font-semibold">{t.labels.inviteFriend}</span>
                <Share2 className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">{t.labels.recommendedMode}</p>
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="rounded-3xl border border-white/10 bg-slate-900/35 p-5 shadow-xl backdrop-blur-xl"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-sky-300">{t.labels.profileActive}</p>
            <h2 className="mt-2 text-lg font-semibold text-white break-all">{emailLabel}</h2>
            <p className="mt-2 text-sm text-gray-300">{planSummary}</p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/70">
              {infoBadges.map((badge) => (
                <span
                  key={badge.label}
                  className="rounded-full border border-white/20 bg-white/5 px-3 py-1 font-semibold text-white/80"
                >
                  <strong className="text-[0.6rem] uppercase tracking-widest text-gray-300">
                    {badge.label}:
                  </strong>{" "}
                  {badge.value}
                </span>
              ))}
            </div>
          </motion.section>
        </div>

        <motion.section
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.16 }}
          className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-sky-200">{t.labels.credits}</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {isAdminUser
                  ? "Illimité · ADMIN"
                  : hasCredits
                  ? `${tokenBalance ?? 0} · ${tokenTier ?? t.labels.credits}`
                  : t.labels.noActiveCredits}
              </p>
            </div>
            <button
              onClick={() => setDetailsOpen((prev) => !prev)}
              aria-expanded={detailsOpen}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 transition hover:border-white/40"
            >
              {detailsOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>

          <div
            className={`mt-4 space-y-3 transition-[max-height,opacity] duration-300 ${
              detailsOpen ? "max-h-130 opacity-100" : "max-h-0 opacity-0"
            }`}
          >
            <ul className="space-y-1 text-sm text-white/80">
              {planDetailsList.map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  {item}
                </li>
              ))}
            </ul>
            {isAdminUser ? (
              <p className="text-xs text-emerald-200">{t.labels.adminNoRecharge}</p>
            ) : isPremiumAccount ? (
              <p className="text-xs text-sky-200">{t.labels.premiumIncluded}</p>
            ) : (
              <>
                <p className="text-xs text-amber-100">{t.labels.freeMinutesInfo}</p>
                <div className="grid grid-cols-3 gap-2">
                  {CREDIT_PACKS.map((pack) => (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => setSelectedPack(pack.id)}
                      className={`rounded-full border px-2 py-1 text-[0.7rem] font-semibold uppercase tracking-wider transition ${
                        selectedPack === pack.id
                          ? "border-emerald-300 bg-emerald-500/20 text-emerald-100"
                          : "border-white/20 bg-white/5 text-white/80 hover:border-white/40"
                      }`}
                    >
                      {pack.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleBuyTokens}
                    disabled={tokenLoading}
                    className="rounded-full border border-emerald-400/60 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-60"
                  >
                    {tokenLoading
                      ? t.labels.preparing
                      : `${t.labels.buyPackPrefix} ${
                          CREDIT_PACKS.find((pack) => pack.id === selectedPack)?.label ?? "60 min"
                        }`}
                  </button>
                  <Link
                    href="/pricing"
                    className="rounded-full border border-sky-400/70 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-sky-100 transition hover:bg-sky-500/20"
                  >
                    {t.labels.viewAllOffers}
                  </Link>
                </div>
                {tokenMessage && <p className="text-xs text-amber-200">{tokenMessage}</p>}
              </>
            )}
          </div>
        </motion.section>

        <p className="mt-6 text-center text-[11px] text-slate-400">{t.labels.advice}</p>
        <p className="mt-2 text-center text-[10px] uppercase tracking-[0.28em] text-gray-500">
          BFZoom {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
