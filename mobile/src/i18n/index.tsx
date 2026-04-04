import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type AppLanguage = "fr" | "en";

const LANGUAGE_STORAGE_KEY = "bfzoom.app.language";

type I18nContextValue = {
  language: AppLanguage;
  setLanguage: (nextLanguage: AppLanguage) => void;
  ready: boolean;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const detectDefaultLanguage = (): AppLanguage => {
  const locale =
    Intl.DateTimeFormat().resolvedOptions().locale?.toLowerCase().trim() || "en";
  return locale.startsWith("fr") ? "fr" : "en";
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("en");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const stored = (await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY))?.trim().toLowerCase();
        if (cancelled) return;
        if (stored === "fr" || stored === "en") {
          setLanguageState(stored);
        } else {
          setLanguageState(detectDefaultLanguage());
        }
      } catch {
        if (!cancelled) {
          setLanguageState(detectDefaultLanguage());
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    void AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      ready,
    }),
    [language, ready, setLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }
  return context;
};

type LanguageSwitcherProps = {
  compact?: boolean;
  inverted?: boolean;
};

export function LanguageSwitcher({ compact = false, inverted = false }: LanguageSwitcherProps) {
  const { language, setLanguage, ready } = useI18n();

  if (!ready) return null;

  return (
    <View
      style={[
        styles.switcher,
        compact && styles.switcherCompact,
        inverted && styles.switcherInverted,
      ]}
    >
      {(["fr", "en"] as AppLanguage[]).map((option) => {
        const active = language === option;
        return (
          <Pressable
            key={option}
            onPress={() => setLanguage(option)}
            style={[
              styles.switcherButton,
              compact && styles.switcherButtonCompact,
              active && styles.switcherButtonActive,
              inverted && styles.switcherButtonInverted,
              inverted && active && styles.switcherButtonActiveInverted,
            ]}
          >
            <Text
              style={[
                styles.switcherButtonText,
                compact && styles.switcherButtonTextCompact,
                active && styles.switcherButtonTextActive,
                inverted && styles.switcherButtonTextInverted,
                inverted && active && styles.switcherButtonTextActiveInverted,
              ]}
            >
              {option.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  switcher: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    padding: 4,
    alignSelf: "flex-start",
  },
  switcherCompact: {
    gap: 4,
    padding: 3,
  },
  switcherInverted: {
    backgroundColor: "rgba(2,6,23,0.8)",
    borderColor: "#475569",
  },
  switcherButton: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  switcherButtonCompact: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  switcherButtonActive: {
    backgroundColor: "#0c4a6e",
  },
  switcherButtonInverted: {
    backgroundColor: "transparent",
  },
  switcherButtonActiveInverted: {
    backgroundColor: "#e2e8f0",
  },
  switcherButtonText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  switcherButtonTextCompact: {
    fontSize: 11,
  },
  switcherButtonTextActive: {
    color: "#f8fafc",
  },
  switcherButtonTextInverted: {
    color: "#cbd5e1",
  },
  switcherButtonTextActiveInverted: {
    color: "#0f172a",
  },
});
