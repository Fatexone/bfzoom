export const CREDIT_PACKS = [
  { id: "60", label: "60 min", minutes: 60, price: "7,99€" },
  { id: "180", label: "180 min", minutes: 180, price: "19,99€" },
  { id: "600", label: "600 min", minutes: 600, price: "49,99€" },
] as const;

export type CreditPackId = (typeof CREDIT_PACKS)[number]["id"];
export type MobileReturnTarget = "dashboard" | "conference" | "interpreter";

export const DEFAULT_CREDIT_PACK_ID: CreditPackId = "60";

const CREDIT_PACK_IDS = new Set<CreditPackId>(
  CREDIT_PACKS.map((pack) => pack.id)
);
const MOBILE_RETURN_TARGETS = new Set<MobileReturnTarget>([
  "dashboard",
  "conference",
  "interpreter",
]);

export const isCreditPackId = (value: unknown): value is CreditPackId =>
  typeof value === "string" && CREDIT_PACK_IDS.has(value as CreditPackId);

export const getCreditPack = (value: unknown) => {
  if (isCreditPackId(value)) {
    return CREDIT_PACKS.find((pack) => pack.id === value) ?? CREDIT_PACKS[0];
  }
  return CREDIT_PACKS[0];
};

export const normalizeInternalReturnTo = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
};

export const normalizeMobileReturnTarget = (value: unknown): MobileReturnTarget | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return MOBILE_RETURN_TARGETS.has(trimmed as MobileReturnTarget)
    ? (trimmed as MobileReturnTarget)
    : null;
};

export const normalizePrefillEmail = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@") || trimmed.length > 180) return null;
  return trimmed;
};

export const buildMobileAppHref = (target: MobileReturnTarget) => `bfzoom://${target}`;

export const buildCreditsPageHref = ({
  pack,
  returnTo,
  mobileReturn,
  prefillEmail,
}: {
  pack?: CreditPackId | null;
  returnTo?: string | null;
  mobileReturn?: MobileReturnTarget | null;
  prefillEmail?: string | null;
} = {}) => {
  const params = new URLSearchParams();
  if (pack) {
    params.set("pack", pack);
  }
  const safeReturnTo = normalizeInternalReturnTo(returnTo);
  if (safeReturnTo) {
    params.set("returnTo", safeReturnTo);
  }
  const safeMobileReturn = normalizeMobileReturnTarget(mobileReturn);
  if (safeMobileReturn) {
    params.set("mobileReturn", safeMobileReturn);
  }
  const safePrefillEmail = normalizePrefillEmail(prefillEmail);
  if (safePrefillEmail) {
    params.set("prefillEmail", safePrefillEmail);
  }
  const query = params.toString();
  return query ? `/credits?${query}` : "/credits";
};
