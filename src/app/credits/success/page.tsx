import Link from "next/link";
import {
  buildCreditsPageHref,
  buildMobileAppHref,
  getCreditPack,
  normalizeInternalReturnTo,
  normalizeMobileReturnTarget,
} from "@/lib/creditPacks";

type CreditsSuccessPageProps = {
  searchParams: Promise<{
    pack?: string | string[];
    returnTo?: string | string[];
    mobileReturn?: string | string[];
  }>;
};

export default async function CreditsSuccessPage({
  searchParams,
}: CreditsSuccessPageProps) {
  const params = await searchParams;
  const rawPack = Array.isArray(params.pack) ? params.pack[0] : params.pack;
  const rawReturnTo = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const rawMobileReturn = Array.isArray(params.mobileReturn)
    ? params.mobileReturn[0]
    : params.mobileReturn;
  const pack = getCreditPack(rawPack);
  const returnTo = normalizeInternalReturnTo(rawReturnTo);
  const mobileReturn = normalizeMobileReturnTarget(rawMobileReturn);

  return (
    <div className="min-h-dvh bg-linear-to-br from-slate-950 via-slate-900 to-black px-6 py-12 text-white">
      <div className="mx-auto max-w-xl rounded-4xl border border-emerald-400/20 bg-slate-950 p-8 text-center shadow-2xl">
        <p className="text-xs uppercase tracking-[0.22em] text-emerald-200">
          Paiement confirme
        </p>
        <h1 className="mt-3 text-3xl font-extrabold text-white">
          Ton pack {pack.label} est en cours d’activation.
        </h1>
        <p className="mt-3 text-sm text-slate-300">
          Stripe a valide le paiement. Tes minutes vont apparaitre sur ton solde des que le webhook est traite.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {mobileReturn ? (
            <a
              href={buildMobileAppHref(mobileReturn)}
              className="inline-flex rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Retour dans l&apos;app BFZoom
            </a>
          ) : null}
          <Link
            href={returnTo ?? "/dashboard"}
            className="inline-flex rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/30"
          >
            {returnTo ? "Retourner a la communication" : "Retour au dashboard"}
          </Link>
          <Link
            href={buildCreditsPageHref({ pack: pack.id, returnTo, mobileReturn })}
            className="inline-flex rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/30"
          >
            Voir les packs credits
          </Link>
        </div>
      </div>
    </div>
  );
}
