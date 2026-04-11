"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import UiLocaleSwitch from "@/components/ui/UiLocaleSwitch";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";
import { useTranslationEntitlement } from "@/hooks/useTranslationEntitlement";
import {
  buildMobileAppHref,
  buildCreditsPageHref,
  CREDIT_PACKS,
  DEFAULT_CREDIT_PACK_ID,
  getCreditPack,
  type CreditPackId,
  type MobileReturnTarget,
} from "@/lib/creditPacks";
import { startCreditsCheckout } from "@/lib/creditsCheckoutClient";

type CreditsCopy = {
  title: string;
  subtitle: string;
  activeBalance: string;
  exactTime: string;
  secureCheckout: string;
  buyNow: string;
  preparing: string;
  loginRequired: string;
  checkoutError: string;
  missingLink: string;
  returnToCall: string;
  backToDashboard: string;
  backToApp: string;
  mobileHintTitle: string;
  mobileHintBody: string;
  mobileLoginHint: string;
  useSameEmail: (email: string) => string;
};

const COPY: Record<UiLocale, CreditsCopy> = {
  fr: {
    title: "Acheter des minutes de traduction",
    subtitle:
      "Choisis un pack minutes pour relancer la traduction pendant tes appels, ta visio ou tes exercices.",
    activeBalance: "Solde actuel",
    exactTime: "Temps exact restant",
    secureCheckout: "Paiement Stripe securise",
    buyNow: "Acheter maintenant",
    preparing: "Preparation...",
    loginRequired: "Connecte-toi pour acheter des credits.",
    checkoutError: "Impossible de preparer le paiement.",
    missingLink: "Lien de paiement introuvable.",
    returnToCall: "Retourner a la communication",
    backToDashboard: "Retour au dashboard",
    backToApp: "Retour dans l'app BFZoom",
    mobileHintTitle: "Achat web pour l'app iPhone",
    mobileHintBody:
      "Tu es sur le checkout web BFZoom. Connecte-toi avec le meme email que dans l'app pour acheter tes minutes, puis reviens dans l'app.",
    mobileLoginHint:
      "Si le web te demande de te connecter, c'est normal : l'achat se fait ici pour alimenter les minutes de ton app iPhone.",
    useSameEmail: (email: string) => `Email conseille pour cette recharge : ${email}`,
  },
  en: {
    title: "Buy translation minutes",
    subtitle:
      "Pick a minute pack to resume translation during calls, video sessions, or exercises.",
    activeBalance: "Current balance",
    exactTime: "Exact time remaining",
    secureCheckout: "Secure Stripe checkout",
    buyNow: "Buy now",
    preparing: "Preparing...",
    loginRequired: "Sign in to buy credits.",
    checkoutError: "Unable to prepare checkout.",
    missingLink: "Missing checkout link.",
    returnToCall: "Return to the call",
    backToDashboard: "Back to dashboard",
    backToApp: "Back to the BFZoom app",
    mobileHintTitle: "Web checkout for the iPhone app",
    mobileHintBody:
      "You are on the BFZoom web checkout. Sign in with the same email you use in the app to buy minutes, then go back to the app.",
    mobileLoginHint:
      "If the web asks you to sign in, that is expected: the purchase happens here and credits your iPhone app minutes.",
    useSameEmail: (email: string) => `Recommended email for this top-up: ${email}`,
  },
};

const formatExactDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

type CreditsPageClientProps = {
  initialPack: CreditPackId;
  returnTo: string | null;
  mobileReturn: MobileReturnTarget | null;
  prefillEmail: string | null;
};

const creditsPageShellStyle = {
  background: "var(--bfz-shell)",
} as const;

const creditsPageGlowStyle = {
  background: "var(--bfz-shell-glow)",
  pointerEvents: "none",
} as const;

const creditsSurfaceStrongClass =
  "border border-[color:var(--bfz-line-strong)] bg-[var(--bfz-surface-strong)] shadow-[0_18px_44px_rgba(8,20,51,0.08)]";

const creditsDarkPanelClass =
  "border border-white/10 bg-[linear-gradient(160deg,rgba(8,20,51,0.98)_0%,rgba(12,42,112,0.94)_100%)] text-white shadow-[0_30px_90px_rgba(8,20,51,0.16)]";

export default function CreditsPageClient({
  initialPack,
  returnTo,
  mobileReturn,
  prefillEmail,
}: CreditsPageClientProps) {
  const router = useRouter();
  const { locale } = useUiLocale();
  const t = COPY[locale];
  const [selectedPack, setSelectedPack] = useState<CreditPackId>(initialPack);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    totalSecondsRemaining,
    loading: entitlementLoading,
  } = useTranslationEntitlement();
  const selectedPackData = getCreditPack(selectedPack);
  const backHref = useMemo(() => {
    if (mobileReturn) {
      return buildMobileAppHref(mobileReturn);
    }
    return returnTo ?? "/dashboard";
  }, [mobileReturn, returnTo]);
  const checkoutPageHref = useMemo(
    () =>
      buildCreditsPageHref({
        pack: selectedPack,
        returnTo,
        mobileReturn,
        prefillEmail,
      }),
    [mobileReturn, prefillEmail, returnTo, selectedPack]
  );

  useEffect(() => {
    setSelectedPack(initialPack);
  }, [initialPack]);

  const handleBuy = async () => {
    setError(null);
    setLoading(true);
    try {
      const url = await startCreditsCheckout({
        pack: selectedPack,
        returnTo: returnTo ?? "/dashboard",
        mobileReturn,
      });
      window.location.assign(url);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "checkout_error";
      if (message === "login_required") {
        const loginQuery = new URLSearchParams();
        loginQuery.set("next", checkoutPageHref);
        if (mobileReturn) {
          loginQuery.set("mobileTopup", "1");
        }
        if (prefillEmail) {
          loginQuery.set("email", prefillEmail);
        }
        router.push(`/login?${loginQuery.toString()}`);
        return;
      } else if (message === "missing_checkout_url") {
        setError(t.missingLink);
      } else {
        setError(message !== "checkout_error" ? message : t.checkoutError);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-dvh px-6 py-10 text-[color:var(--bfz-ink-950)]"
      style={creditsPageShellStyle}
    >
      <div className="absolute inset-0" style={creditsPageGlowStyle} />

      <div className="relative z-10">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <a
            href={backHref}
            className={`${creditsSurfaceStrongClass} inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-white`}
          >
            {mobileReturn ? t.backToApp : returnTo ? t.returnToCall : t.backToDashboard}
          </a>
          <UiLocaleSwitch />
        </div>

        <div className="mx-auto mt-8 grid w-full max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className={`${creditsSurfaceStrongClass} rounded-4xl p-7`}>
            <p className="text-xs uppercase tracking-[0.22em] text-[color:var(--bfz-teal-700)]">
              BFZoom Credits
            </p>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-[color:var(--bfz-ink-950)] sm:text-4xl">
              {t.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-slate-600 sm:text-base">
              {t.subtitle}
            </p>
            {mobileReturn ? (
              <div className="mt-5 rounded-3xl border border-sky-200 bg-sky-50 p-4">
                <p className="text-sm font-semibold text-sky-900">{t.mobileHintTitle}</p>
                <p className="mt-1 text-sm text-sky-800/90">{t.mobileHintBody}</p>
                <p className="mt-2 text-sm text-sky-800/85">{t.mobileLoginHint}</p>
                {prefillEmail ? (
                  <p className="mt-2 text-sm font-medium text-sky-900">
                    {t.useSameEmail(prefillEmail)}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 grid gap-3">
              {CREDIT_PACKS.map((pack) => {
                const isSelected = selectedPack === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => setSelectedPack(pack.id)}
                    className={`rounded-3xl border p-5 text-left transition ${
                      isSelected
                        ? "border-amber-300 bg-amber-50 shadow-[0_0_0_1px_rgba(245,158,11,0.22)]"
                        : "border-[color:var(--bfz-line)] bg-[var(--bfz-surface-muted)] hover:border-[color:var(--bfz-line-strong)] hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xl font-semibold text-[color:var(--bfz-ink-950)]">{pack.label}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {pack.minutes} minutes de traduction actives
                        </p>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-sm font-semibold ${
                          isSelected
                            ? "border border-amber-200 bg-white text-amber-800"
                            : "border border-[color:var(--bfz-line)] bg-white text-slate-700"
                        }`}
                      >
                        {pack.price}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className={`${creditsDarkPanelClass} rounded-4xl p-7`}>
            <p className="text-xs uppercase tracking-[0.22em] text-amber-200">
              {t.activeBalance}
            </p>
            <p className="mt-3 text-4xl font-extrabold text-white">
              {entitlementLoading ? "..." : formatExactDuration(totalSecondsRemaining)}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {t.exactTime}
            </p>

            <div className="mt-8 rounded-3xl border border-amber-400/25 bg-amber-500/10 p-5">
              <p className="text-sm text-amber-100">{t.secureCheckout}</p>
              <p className="mt-2 text-3xl font-extrabold text-white">
                {selectedPackData.price}
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {selectedPackData.minutes} minutes ajoutees a ton solde
              </p>
            </div>

            <button
              type="button"
              onClick={handleBuy}
              disabled={loading}
              className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-[color:var(--bfz-amber-600)] px-4 py-3 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:opacity-60"
            >
              {loading ? t.preparing : `${t.buyNow} ${selectedPackData.label}`}
            </button>

            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={buildCreditsPageHref({
                  pack: DEFAULT_CREDIT_PACK_ID,
                  returnTo,
                  mobileReturn,
                  prefillEmail,
                })}
                className="rounded-full border border-white/12 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-white/30 hover:text-white"
              >
                60 min
              </Link>
              <Link
                href={buildCreditsPageHref({ pack: "180", returnTo, mobileReturn, prefillEmail })}
                className="rounded-full border border-white/12 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-white/30 hover:text-white"
              >
                180 min
              </Link>
              <Link
                href={buildCreditsPageHref({ pack: "600", returnTo, mobileReturn, prefillEmail })}
                className="rounded-full border border-white/12 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-white/30 hover:text-white"
              >
                600 min
              </Link>
            </div>

            {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
