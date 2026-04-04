import { useCallback, useEffect, useRef, useState } from "react";
import { env } from "../config/env";
import {
  fetchTranslationEntitlement,
  isTranslationAbortError,
  type TranslationEntitlementResult,
} from "../services/translation";

export type TranslationCredits = TranslationEntitlementResult;

export function useTranslationCredits(bearerToken?: string) {
  const [credits, setCredits] = useState<TranslationCredits | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const latestCreditsRef = useRef<TranslationCredits | null>(null);
  const requestIdRef = useRef(0);
  const lastBearerTokenRef = useRef("");

  const refetch = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    const normalizedBearerToken = (bearerToken || "").trim();
    if (!normalizedBearerToken) {
      requestIdRef.current += 1;
      lastBearerTokenRef.current = "";
      latestCreditsRef.current = null;
      setCredits(null);
      setError(null);
      setRefreshing(false);
      setStale(false);
      setLastLoadedAt(null);
      setLoading(false);
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    setError(null);
    const bearerTokenChanged = normalizedBearerToken !== lastBearerTokenRef.current;
    lastBearerTokenRef.current = normalizedBearerToken;

    if (bearerTokenChanged) {
      latestCreditsRef.current = null;
      setCredits(null);
      setRefreshing(false);
      setStale(false);
      setLoading(true);
    } else if (latestCreditsRef.current) {
      setLoading(false);
      setRefreshing(true);
    } else {
      setRefreshing(false);
      setLoading(true);
    }

    const apiBaseUrl = env.apiBaseUrl.trim().replace(/\/+$/, "");
    void fetchTranslationEntitlement({
      apiBaseUrl,
      bearerToken: normalizedBearerToken,
      signal: controller?.signal,
    })
      .then((data) => {
        if (requestId !== requestIdRef.current) return;
        latestCreditsRef.current = data;
        setCredits(data);
        setError(null);
        setStale(false);
        setLastLoadedAt(Date.now());
        setRefreshing(false);
        setLoading(false);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        if (isTranslationAbortError(err)) return;
        setCredits(latestCreditsRef.current);
        setStale(Boolean(latestCreditsRef.current));
        setError(err instanceof Error ? err.message : "Erreur chargement crédits");
        setRefreshing(false);
        setLoading(false);
      });

    return () => {
      controller?.abort();
    };
  }, [bearerToken, refreshNonce]);

  return {
    credits,
    loading,
    refreshing,
    error,
    stale,
    lastLoadedAt,
    hasLoaded: lastLoadedAt !== null,
    refetch,
  };
}
