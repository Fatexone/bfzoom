"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import { auth, db } from "@/lib/firebaseConfig";
import { doc, onSnapshot } from "firebase/firestore";
import { Brain, ChevronDown, ChevronUp, LogOut, MessageCircle, Share2, Video } from "lucide-react";
import { motion } from "framer-motion";
import { ADMIN_EMAIL } from "@/config/constants";
import { useTokenWallet } from "@/hooks/useTokenWallet";

const PLAN_RULES: Record<string, string[]> = {
  Premium: [
    "Chat, visioconférence et training illimités.",
    "IA avancée + résumé instantané pour chaque discussion.",
  ],
  Gratuit: [
    "Chat : 3 échanges maximum par jour.",
    "Visioconf : 1 session hebdo.",
    "Training : 2 sessions guidées par mois.",
  ],
};

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const { balance: tokenBalance, tier: tokenTier } = useTokenWallet(user?.uid ?? null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoading(false);
      } else {
        router.push("/");
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
      setTokenMessage("Paiement validé. Tes tokens arrivent bientôt.");
      params.delete("purchase");
      const cleanSearch = params.toString();
      const cleanUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}`;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/");
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/signup?invite=${user?.uid ?? ""}`;
    if (navigator.share) {
      await navigator.share({
        title: "BFZoom",
        text: "Rejoins-moi sur BFZoom",
        url,
      });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      alert("Lien d’invitation copié !");
    } else {
      prompt("Copie ce lien :", url);
    }
  };

  const statusTag = useMemo(() => {
    if (Boolean(profile?.isPremium) || profile?.plan === "premium") {
      return "Premium";
    }
    return "Gratuit";
  }, [profile]);

  const planSummary = useMemo(() => {
    if (statusTag === "Premium") {
      return "Plan Premium — accès illimité au chat, à la visioconf et au training boostés par l’IA.";
    }
    return "Plan gratuit — quotas sur le chat, la visioconf et le training.";
  }, [statusTag]);

  const planDetailsList = useMemo(() => PLAN_RULES[statusTag] ?? PLAN_RULES.Gratuit, [statusTag]);

  const roleLabel = useMemo(() => {
    if (user?.email === ADMIN_EMAIL) {
      return "Administrateur";
    }
    if (typeof profile?.role === "string" && profile.role) {
      return profile.role;
    }
    return "BFZoomer";
  }, [profile, user?.email]);

  const infoBadges = useMemo(
    () => [
      { label: "Statut", value: statusTag },
      { label: "Rôle", value: roleLabel },
      { label: "E-mail vérifié", value: user?.emailVerified ? "Oui" : "Non" },
    ],
    [roleLabel, statusTag, user?.emailVerified]
  );

  const emailLabel = user?.email ?? "Adresse inconnue";
  const shareButtonLabel = user?.email === ADMIN_EMAIL ? "Invitations admin" : "Inviter un ami";

  const handleBuyTokens = async () => {
    setTokenMessage(null);
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setTokenMessage("Connecte-toi pour acheter des tokens.");
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
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error ?? "Impossible de lancer le checkout.");
      }
      const data = await response.json().catch(() => ({}));
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setTokenMessage("Lien de paiement introuvable.");
    } catch (error) {
      setTokenMessage(
        error instanceof Error ? error.message : "Erreur lors de la préparation du paiement."
      );
    } finally {
      setTokenLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-400 text-lg">
        ⏳ Chargement...
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-linear-to-br from-gray-950 via-gray-900 to-black text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.15),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(34,197,94,0.12),transparent_60%)]" />

      <div className="relative z-10 mx-auto flex min-h-screen flex-col items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-10 max-w-3xl"
        >
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
            Bienvenue, {emailLabel.split("@")[0]} 👋
          </h1>
          <p className="mt-3 text-gray-400 text-sm sm:text-base">
            Prépare ta prochaine session : visioconf, chat, training, tokens et invitations en
            un seul endroit.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="w-full max-w-4xl rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="flex-1 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-sky-300">Profil actif</p>
                  <h2 className="text-2xl font-semibold text-white">{emailLabel}</h2>
                  <p className="text-sm text-gray-400">{planSummary}</p>
                </div>
                <button
                  onClick={() => setDetailsOpen((prev) => !prev)}
                  aria-expanded={detailsOpen}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/5 text-white/90 transition hover:border-white/40"
                >
                  {detailsOpen ? (
                    <ChevronUp className="h-5 w-5" />
                  ) : (
                    <ChevronDown className="h-5 w-5" />
                  )}
                </button>
              </div>

              <div
                className={`space-y-2 transition-[max-height,opacity] duration-300 ${
                  detailsOpen ? "max-h-60 opacity-100" : "max-h-0 opacity-0"
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
                <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs uppercase tracking-wide text-white/70">
                  <div className="flex items-center justify-between">
                    <span>Tokens</span>
                    <span className="font-semibold text-white">
                      {tokenBalance ?? 0} · {tokenTier ?? "Découverte"}
                    </span>
                  </div>
                  <button
                    onClick={handleBuyTokens}
                    disabled={tokenLoading}
                    className="w-full rounded-full border border-emerald-400/60 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-wider text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-60"
                  >
                    {tokenLoading ? "Préparation..." : "Recharger 5€"}
                  </button>
                  {tokenMessage && (
                    <p className="text-[0.65rem] text-amber-200">{tokenMessage}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-white/70">
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
              </div>
            </div>

            <div className="flex w-full flex-1 flex-col gap-3 rounded-2xl border border-white/10 bg-slate-900/30 p-5 text-sm text-white/70">
              <p className="text-xs uppercase tracking-widest text-blue-200">Actions rapides</p>
              <button
                onClick={() => router.push("/videoconference")}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-gradient-to-r from-blue-600 to-sky-600 px-4 py-3 text-white transition hover:from-blue-500 hover:to-sky-500"
              >
                <span className="font-semibold">Créer une salle</span>
                <Video className="h-5 w-5" />
              </button>
              <button
                onClick={() => router.push("/practice")}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-3 text-white transition hover:from-emerald-500 hover:to-emerald-400"
              >
                <span className="font-semibold">S’entraîner</span>
                <Brain className="h-5 w-5" />
              </button>
              <button
                onClick={() => router.push("/chat")}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-3 text-white transition hover:from-orange-400 hover:to-amber-400"
              >
                <span className="font-semibold">Accéder au chat</span>
                <MessageCircle className="h-5 w-5" />
              </button>
              <button
                onClick={handleShare}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white transition hover:border-white/30"
              >
                <span className="font-semibold">{shareButtonLabel}</span>
                <Share2 className="h-5 w-5" />
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3 text-xs text-gray-300"
        >
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 transition hover:border-white/30"
          >
            <LogOut className="h-4 w-4" /> Se déconnecter
          </button>
          {user?.email === ADMIN_EMAIL ? (
            <Link
              href="/admin/invitations"
              className="flex items-center gap-1 rounded-full border border-emerald-400/60 px-4 py-2 font-semibold text-emerald-200 transition hover:border-emerald-400"
            >
              Invitations admin
            </Link>
          ) : (
            <span className="text-[0.7rem] uppercase tracking-[0.3em] text-gray-500">
              BFZoom {new Date().getFullYear()}
            </span>
          )}
        </motion.div>
      </div>
    </div>
  );
}
