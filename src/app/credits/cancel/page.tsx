import Link from "next/link";
import {
  buildCreditsPageHref,
  buildMobileAppHref,
  getCreditPack,
  normalizeInternalReturnTo,
  normalizeMobileReturnTarget,
} from "@/lib/creditPacks";

type CreditsCancelPageProps = {
  searchParams: Promise<{
    pack?: string | string[];
    returnTo?: string | string[];
    mobileReturn?: string | string[];
  }>;
};

export default async function CreditsCancelPage({
  searchParams,
}: CreditsCancelPageProps) {
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
      <div className="mx-auto max-w-xl rounded-4xl border border-white/10 bg-slate-950 p-8 text-center shadow-2xl">
        <p className="text-xs uppercase tracking-[0.22em] text-amber-200">
          Paiement annule
        </p>
        <h1 className="mt-3 text-3xl font-extrabold text-white">
          Le pack {pack.label} n’a pas ete achete.
        </h1>
        <p className="mt-3 text-sm text-slate-300">
          Aucun debit n’a ete confirme. Tu peux relancer le paiement quand tu veux.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href={buildCreditsPageHref({ pack: pack.id, returnTo, mobileReturn })}
            className="inline-flex rounded-2xl bg-amber-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
          >
            Reessayer le paiement
          </Link>
          {mobileReturn ? (
            <a
              href={buildMobileAppHref(mobileReturn)}
              className="inline-flex rounded-2xl border border-white/15 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/30"
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
        </div>
      </div>
    </div>
  );
}
