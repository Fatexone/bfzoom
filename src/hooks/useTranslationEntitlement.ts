"use client";

import { useCallback, useEffect, useState } from "react";
import { getIdToken, onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import {
  TRANSLATION_ENTITLEMENT_UPDATED_EVENT,
  type TranslationEntitlementUpdateDetail,
} from "@/lib/translationEntitlementEvents";

export type TranslationEntitlementClientState = {
  enabled: boolean;
  lockReason: string;
  loading: boolean;
  isAdmin: boolean;
  isPremium: boolean;
  totalSecondsRemaining: number;
  freeSecondsRemaining: number;
  paidSecondsRemaining: number;
};

const DEFAULT_TRANSLATION_ENTITLEMENT: TranslationEntitlementClientState = {
  enabled: false,
  lockReason: "",
  loading: true,
  isAdmin: false,
  isPremium: false,
  totalSecondsRemaining: 0,
  freeSecondsRemaining: 0,
  paidSecondsRemaining: 0,
};

const normalizeTranslationEntitlement = (
  payload: unknown
): TranslationEntitlementClientState => {
  const raw = (payload || {}) as Record<string, unknown>;
  const freeSecondsRemaining =
    typeof raw.freeSecondsRemaining === "number" && Number.isFinite(raw.freeSecondsRemaining)
      ? Math.max(0, Math.floor(raw.freeSecondsRemaining))
      : 0;
  const paidSecondsRemaining =
    typeof raw.paidSecondsRemaining === "number" && Number.isFinite(raw.paidSecondsRemaining)
      ? Math.max(0, Math.floor(raw.paidSecondsRemaining))
      : 0;
  const totalSecondsRemaining =
    typeof raw.totalSecondsRemaining === "number" && Number.isFinite(raw.totalSecondsRemaining)
      ? Math.max(0, Math.floor(raw.totalSecondsRemaining))
      : freeSecondsRemaining + paidSecondsRemaining;
  const enabled =
    typeof raw.enabled === "boolean" ? raw.enabled : totalSecondsRemaining > 0;
  const lockReason = typeof raw.lockReason === "string" ? raw.lockReason.trim() : "";
  return {
    enabled,
    lockReason: enabled ? "" : lockReason,
    loading: false,
    isAdmin: raw.isAdmin === true,
    isPremium: raw.isPremium === true,
    totalSecondsRemaining,
    freeSecondsRemaining,
    paidSecondsRemaining,
  };
};

export function useTranslationEntitlement() {
  const [entitlement, setEntitlement] = useState<TranslationEntitlementClientState>(
    DEFAULT_TRANSLATION_ENTITLEMENT
  );

  const refresh = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) {
      setEntitlement({ ...DEFAULT_TRANSLATION_ENTITLEMENT, loading: false });
      return;
    }

    setEntitlement((prev) => ({ ...prev, loading: true }));
    try {
      const token = await getIdToken(current, true);
      const response = await fetch("/api/translation/entitlement", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEntitlement((prev) => ({ ...prev, loading: false }));
        return;
      }
      setEntitlement(normalizeTranslationEntitlement(payload));
    } catch {
      setEntitlement((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      void refresh();
    });
    return () => unsubscribe();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUpdated = (event: Event) => {
      const detail = (event as CustomEvent<TranslationEntitlementUpdateDetail>).detail;
      if (!detail) return;
      setEntitlement({
        enabled: detail.enabled,
        lockReason: detail.enabled ? "" : "",
        loading: false,
        isAdmin: detail.isAdmin,
        isPremium: detail.isPremium,
        totalSecondsRemaining: Math.max(0, Math.floor(detail.totalSecondsRemaining || 0)),
        freeSecondsRemaining: Math.max(0, Math.floor(detail.freeSecondsRemaining || 0)),
        paidSecondsRemaining: Math.max(0, Math.floor(detail.paidSecondsRemaining || 0)),
      });
    };
    window.addEventListener(
      TRANSLATION_ENTITLEMENT_UPDATED_EVENT,
      handleUpdated as EventListener
    );
    return () =>
      window.removeEventListener(
        TRANSLATION_ENTITLEMENT_UPDATED_EVENT,
        handleUpdated as EventListener
      );
  }, []);

  return { ...entitlement, refresh };
}
