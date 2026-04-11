"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type UiLocale = "fr" | "en";

const UI_LOCALE_STORAGE_KEY = "bfzoom:ui-locale";

type UiLocaleContextValue = {
  locale: UiLocale;
  setLocale: (value: UiLocale) => void;
};

const UiLocaleContext = createContext<UiLocaleContextValue | undefined>(undefined);

const normalizeUiLocale = (value?: string | null): UiLocale => {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized.startsWith("fr")) return "fr";
  if (normalized.startsWith("en")) return "en";
  return "en";
};

const detectBrowserLocale = (): UiLocale => {
  if (typeof window === "undefined") return "en";
  const languages = [
    ...(window.navigator.languages || []),
    window.navigator.language || "",
  ];
  for (const candidate of languages) {
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    if (lower.startsWith("fr")) return "fr";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
};

export function UiLocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>("en");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(UI_LOCALE_STORAGE_KEY);
    const next = normalizeUiLocale(stored || detectBrowserLocale());
    setLocaleState(next);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(UI_LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((value: UiLocale) => {
    setLocaleState(value);
  }, []);

  const contextValue = useMemo<UiLocaleContextValue>(
    () => ({
      locale,
      setLocale,
    }),
    [locale, setLocale]
  );

  return <UiLocaleContext.Provider value={contextValue}>{children}</UiLocaleContext.Provider>;
}

export const useUiLocale = () => {
  const context = useContext(UiLocaleContext);
  if (!context) {
    throw new Error("useUiLocale must be used within UiLocaleProvider.");
  }
  return context;
};

