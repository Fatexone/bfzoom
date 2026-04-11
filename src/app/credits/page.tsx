import CreditsPageClient from "@/components/credits/CreditsPageClient";
import {
  DEFAULT_CREDIT_PACK_ID,
  isCreditPackId,
  normalizeInternalReturnTo,
  normalizeMobileReturnTarget,
  normalizePrefillEmail,
} from "@/lib/creditPacks";

type CreditsPageProps = {
  searchParams: Promise<{
    pack?: string | string[];
    returnTo?: string | string[];
    mobileReturn?: string | string[];
    prefillEmail?: string | string[];
  }>;
};

export default async function CreditsPage({ searchParams }: CreditsPageProps) {
  const params = await searchParams;
  const rawPack = Array.isArray(params.pack) ? params.pack[0] : params.pack;
  const rawReturnTo = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const rawMobileReturn = Array.isArray(params.mobileReturn)
    ? params.mobileReturn[0]
    : params.mobileReturn;
  const rawPrefillEmail = Array.isArray(params.prefillEmail)
    ? params.prefillEmail[0]
    : params.prefillEmail;

  return (
    <CreditsPageClient
      initialPack={isCreditPackId(rawPack) ? rawPack : DEFAULT_CREDIT_PACK_ID}
      returnTo={normalizeInternalReturnTo(rawReturnTo)}
      mobileReturn={normalizeMobileReturnTarget(rawMobileReturn)}
      prefillEmail={normalizePrefillEmail(rawPrefillEmail)}
    />
  );
}
