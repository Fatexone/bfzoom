const DEFAULT_FREE_TRIAL_MINUTES = 3;

const toSafeInteger = (value: unknown, fallback = 0) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return fallback;
};

const configuredFreeTrialMinutes = toSafeInteger(
  process.env.BFZOOM_FREE_TRANSLATION_TRIAL_MINUTES,
  toSafeInteger(
    process.env.BFZOOM_FREE_TRANSLATION_MINUTES_PER_MONTH,
    DEFAULT_FREE_TRIAL_MINUTES
  )
);

export const FREE_TRANSLATION_TRIAL_MINUTES = Math.max(
  0,
  configuredFreeTrialMinutes || DEFAULT_FREE_TRIAL_MINUTES
);
export const FREE_TRANSLATION_TRIAL_SECONDS =
  FREE_TRANSLATION_TRIAL_MINUTES * 60;
// Backward compatibility aliases (legacy naming used "per month").
export const FREE_TRANSLATION_MINUTES_PER_MONTH = FREE_TRANSLATION_TRIAL_MINUTES;
export const FREE_TRANSLATION_SECONDS_PER_MONTH = FREE_TRANSLATION_TRIAL_SECONDS;

export const getTranslationPeriodKey = (now = new Date()) => {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
};

const resolvePaidSeconds = (wallet: Record<string, unknown> | null) => {
  if (!wallet) return 0;
  const balanceSeconds = toSafeInteger(wallet.balanceSeconds);
  if (balanceSeconds > 0) return balanceSeconds;
  const balanceMinutes = toSafeInteger(wallet.balance);
  return balanceMinutes * 60;
};

export const secondsToWalletMinutes = (seconds: number) =>
  Math.max(0, Math.ceil(Math.max(0, Math.floor(seconds)) / 60));

export type TranslationCreditsSnapshot = {
  periodKey: string;
  freeSecondsLimit: number;
  freeSecondsUsed: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
  totalSecondsRemaining: number;
  enabled: boolean;
};

export const buildTranslationCreditsSnapshot = ({
  wallet,
  meter,
  unlimited,
  now = new Date(),
}: {
  wallet: Record<string, unknown> | null;
  meter: Record<string, unknown> | null;
  unlimited: boolean;
  now?: Date;
}): TranslationCreditsSnapshot => {
  const periodKey = getTranslationPeriodKey(now);
  const freeSecondsUsedRaw = toSafeInteger(
    meter?.freeTrialUsedSeconds,
    toSafeInteger(meter?.freeUsedSeconds)
  );
  const freeSecondsLimit = FREE_TRANSLATION_TRIAL_SECONDS;
  const freeSecondsUsed = Math.min(freeSecondsLimit, freeSecondsUsedRaw);
  const freeSecondsRemaining = Math.max(0, freeSecondsLimit - freeSecondsUsed);
  const paidSecondsRemaining = resolvePaidSeconds(wallet);
  const totalSecondsRemaining = unlimited
    ? Number.MAX_SAFE_INTEGER
    : freeSecondsRemaining + paidSecondsRemaining;
  return {
    periodKey,
    freeSecondsLimit,
    freeSecondsUsed,
    freeSecondsRemaining,
    paidSecondsRemaining,
    totalSecondsRemaining,
    enabled: unlimited || totalSecondsRemaining > 0,
  };
};

export type TranslationConsumptionPlan =
  | {
      ok: true;
      nextFreeSecondsUsed: number;
      nextPaidSecondsRemaining: number;
      consumedFreeSeconds: number;
      consumedPaidSeconds: number;
    }
  | {
      ok: false;
      missingSeconds: number;
    };

export const planTranslationConsumption = ({
  snapshot,
  secondsRequested,
}: {
  snapshot: TranslationCreditsSnapshot;
  secondsRequested: number;
}): TranslationConsumptionPlan => {
  const requested = Math.max(1, Math.floor(secondsRequested));
  if (snapshot.totalSecondsRemaining < requested) {
    return {
      ok: false,
      missingSeconds: requested - snapshot.totalSecondsRemaining,
    };
  }
  const consumedFreeSeconds = Math.min(snapshot.freeSecondsRemaining, requested);
  const remainingAfterFree = requested - consumedFreeSeconds;
  const consumedPaidSeconds = Math.min(
    snapshot.paidSecondsRemaining,
    remainingAfterFree
  );
  return {
    ok: true,
    nextFreeSecondsUsed: snapshot.freeSecondsUsed + consumedFreeSeconds,
    nextPaidSecondsRemaining: snapshot.paidSecondsRemaining - consumedPaidSeconds,
    consumedFreeSeconds,
    consumedPaidSeconds,
  };
};

export const buildTranslationLockedReason = () =>
  "Traduction indisponible: tes 3 minutes d'essai gratuit sont epuisees et tu n'as plus de credits actifs. La visio et le chat restent disponibles.";
