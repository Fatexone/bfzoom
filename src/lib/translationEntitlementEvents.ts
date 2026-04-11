"use client";

export type TranslationEntitlementUpdateDetail = {
  enabled: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
};

export const TRANSLATION_ENTITLEMENT_UPDATED_EVENT =
  "bfzoom:translation-entitlement-updated";

export const dispatchTranslationEntitlementUpdatedEvent = (
  detail: TranslationEntitlementUpdateDetail
) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<TranslationEntitlementUpdateDetail>(
      TRANSLATION_ENTITLEMENT_UPDATED_EVENT,
      { detail }
    )
  );
};
