import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import Constants from "expo-constants";
import { LanguageSwitcher, useI18n } from "../i18n";
import { env } from "../config/env";
import { useTranslationCredits } from "../hooks/useTranslationCredits";
import { db } from "../services/firebase";
import {
  fetchIosIapCatalog,
  purchaseIosIapPack,
  type IosIapCatalogPack,
} from "../services/iap";

type DashboardScreenProps = {
  user: User;
  onOpenLogin: () => void;
  onOpenInterpreter: () => void;
  onOpenConference: () => void;
  onSignOut: () => void;
};

type UserProfile = {
  name?: string;
  plan?: string;
  isPremium?: boolean;
  freeTrialUsedSeconds?: number;
  freeUsedSeconds?: number;
};

type PackPresentation = {
  badge: string;
  summary: string;
  highlighted?: boolean;
};

type DashboardAccordionKey = "pocket" | "video" | "minutes" | "account";

const toSafeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const logIap = (event: string, details?: Record<string, unknown>) => {
  const suffix = details
    ? ` ${Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")}`
    : "";
  console.log(`[BFZoom][IAP] ${event}${suffix}`);
};

type DashboardAccordionProps = {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function DashboardAccordion({ title, isOpen, onToggle, children }: DashboardAccordionProps) {
  return (
    <View style={styles.accordionCard}>
      <Pressable style={styles.accordionHeader} onPress={onToggle}>
        <Text style={styles.accordionTitle}>{title}</Text>
        <Text style={styles.accordionIcon}>{isOpen ? "−" : "+"}</Text>
      </Pressable>
      {isOpen ? <View style={styles.accordionContent}>{children}</View> : null}
    </View>
  );
}

export function DashboardScreen({
  user,
  onOpenLogin,
  onOpenInterpreter,
  onOpenConference,
  onSignOut,
}: DashboardScreenProps) {
  const { language } = useI18n();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [bearerToken, setBearerToken] = useState<string | undefined>(undefined);
  const [iapLoading, setIapLoading] = useState(false);
  const [iapNativeReady, setIapNativeReady] = useState(false);
  const [iapPacks, setIapPacks] = useState<IosIapCatalogPack[]>([]);
  const [iapBusyProductId, setIapBusyProductId] = useState("");
  const [iapInfo, setIapInfo] = useState("");
  const [iapError, setIapError] = useState("");
  const [openSection, setOpenSection] = useState<DashboardAccordionKey | null>(null);

  const ui = useMemo(
    () =>
      language === "fr"
        ? {
            defaultUser: "Utilisateur",
            loadingBalance: "Chargement de ton solde...",
            translationAvailable: (minutes: number) =>
              `Traduction disponible · ${minutes} min restantes`,
            freeTrial: (minutes: number) => `Essai gratuit · ${minutes} min restantes`,
            topUpRequired: "Recharge requise pour la traduction",
            apiMissing: "Configuration API mobile absente.",
            iapLoadError: "Impossible de charger les offres iOS.",
            iapUnavailable: "Achat iOS indisponible.",
            alreadyProcessed: (totalMinutes: number) =>
              `Achat deja traite. Solde estime: ${totalMinutes} min.`,
            purchaseConfirmed: (minutesAdded: number, totalMinutes: number) =>
              `Achat confirme: +${minutesAdded} min. Solde estime: ${totalMinutes} min.`,
            heroKicker: "BFZOOM IOS",
            welcome: (name: string) => `Bienvenue, ${name}`,
            heroSubtitle:
              "Lance une room, partage le lien et utilise tes minutes de traduction depuis cet ecran.",
            heroSubtitleGuest:
              "Achete tes packs iPhone sans creer de compte BFZoom. Cree un compte plus tard pour synchroniser tes minutes sur plusieurs appareils.",
            pocketTitle: "Pocket Interpreter",
            pocketSummary:
              "Mode face-a-face sur iPhone: maintiens pour parler, BFZoom traduit et lit la phrase a haute voix.",
            openPocket: "Ouvrir Pocket Interpreter",
            videoTitle: "Visioconference",
            videoSummary:
              "Cree une room BFZoom ou rejoins un appel existant depuis l’iPhone.",
            openRooms: "Ouvrir les rooms",
            translationTitle: "Minutes de traduction",
            translationSummary:
              "La traduction en direct BFZoom utilise des minutes de traduction partagees entre l'app iPhone et le web.",
            balance: (value: string) => `Solde: ${value}`,
            trial: (minutes: number) => `Essai: ${minutes} min`,
            account: (value: string) => `Compte: ${value}`,
            premium: "Premium",
            standard: "Standard",
            guest: "Invite",
            creditsError: (message: string) => `Erreur credits: ${message}`,
            loadingOffers: "Chargement des offres iOS...",
            buyInIos: "Acheter ce pack",
            finalApplePriceHint:
              "Le prix final et la devise sont confirmes par Apple sur l'ecran d'achat.",
            buildLabel: (version: string, build: string | null) =>
              build ? `BFZoom iOS ${version} (${build})` : `BFZoom iOS ${version}`,
            iapUnavailableBuild:
              "Achats in-app indisponibles sur ce build. Utilise une build iOS avec StoreKit actif.",
            packMinutes: (minutes: number) => `${minutes} min de traduction`,
            packStarterBadge: "Decouverte",
            packStarterSummary: "Pour tester BFZoom ou couvrir un appel ponctuel.",
            packRecommendedBadge: "Recommande",
            packRecommendedSummary: "Le bon format pour un usage regulier sur plusieurs appels.",
            packProBadge: "Pro",
            packProSummary: "Pour les appels longs, frequents ou un usage intensif.",
            unavailablePack:
              "Ce pack de traduction n'est pas disponible avec ce compte App Store.",
            unavailableCatalog:
              "Les packs de traduction ne sont pas disponibles pour ce compte App Store.",
            accountTitle: "Compte",
            unknownEmail: "Adresse inconnue",
            guestEmail: "Aucun email partage pour l'instant",
            loadingProfile: "Chargement du profil...",
            status: (value: string) => `Statut: ${value}`,
            guestStatus: "Mode invite prive",
            createAccount: "Creer un compte pour synchroniser",
            signOut: "Se deconnecter",
          }
        : {
            defaultUser: "User",
            loadingBalance: "Loading your balance...",
            translationAvailable: (minutes: number) =>
              `Translation available · ${minutes} min left`,
            freeTrial: (minutes: number) => `Free trial · ${minutes} min left`,
            topUpRequired: "Top up required for translation",
            apiMissing: "Mobile API configuration is missing.",
            iapLoadError: "Unable to load iOS offers.",
            iapUnavailable: "iOS purchase unavailable.",
            alreadyProcessed: (totalMinutes: number) =>
              `Purchase already processed. Estimated balance: ${totalMinutes} min.`,
            purchaseConfirmed: (minutesAdded: number, totalMinutes: number) =>
              `Purchase confirmed: +${minutesAdded} min. Estimated balance: ${totalMinutes} min.`,
            heroKicker: "BFZOOM IOS",
            welcome: (name: string) => `Welcome, ${name}`,
            heroSubtitle:
              "Launch a room, share the link and use your translation minutes from this screen.",
            heroSubtitleGuest:
              "Buy iPhone packs without creating a BFZoom account. Create one later to sync your minutes across devices.",
            pocketTitle: "Pocket Interpreter",
            pocketSummary:
              "Face-to-face mode on iPhone: hold to talk, BFZoom translates and reads the sentence aloud.",
            openPocket: "Open Pocket Interpreter",
            videoTitle: "Video calls",
            videoSummary:
              "Create a BFZoom room or join an existing call from your iPhone.",
            openRooms: "Open rooms",
            translationTitle: "Translation minutes",
            translationSummary:
              "Live translation in BFZoom uses translation minutes shared between the iPhone app and the web.",
            balance: (value: string) => `Balance: ${value}`,
            trial: (minutes: number) => `Trial: ${minutes} min`,
            account: (value: string) => `Account: ${value}`,
            premium: "Premium",
            standard: "Standard",
            guest: "Guest",
            creditsError: (message: string) => `Credits error: ${message}`,
            loadingOffers: "Loading iOS offers...",
            buyInIos: "Buy this pack",
            finalApplePriceHint:
              "Apple confirms the final local price and currency on the purchase sheet.",
            buildLabel: (version: string, build: string | null) =>
              build ? `BFZoom iOS ${version} (${build})` : `BFZoom iOS ${version}`,
            iapUnavailableBuild:
              "In-app purchases are unavailable in this build. Use an iOS build with StoreKit enabled.",
            packMinutes: (minutes: number) => `${minutes} translation min`,
            packStarterBadge: "Starter",
            packStarterSummary: "Best for trying BFZoom or covering a short call.",
            packRecommendedBadge: "Recommended",
            packRecommendedSummary: "The right size for regular use across several calls.",
            packProBadge: "Pro",
            packProSummary: "Best for long calls, frequent use or heavier workflows.",
            unavailablePack:
              "This translation pack is not available on the current App Store account.",
            unavailableCatalog:
              "Translation packs are unavailable on this App Store account right now.",
            accountTitle: "Account",
            unknownEmail: "Unknown email",
            guestEmail: "No email shared yet",
            loadingProfile: "Loading profile...",
            status: (value: string) => `Status: ${value}`,
            guestStatus: "Private guest mode",
            createAccount: "Create account to sync",
            signOut: "Sign out",
          },
    [language]
  );

  useEffect(() => {
    if (!db) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    const profileRef = doc(db, "users", user.uid);
    const unsubscribe = onSnapshot(
      profileRef,
      (snapshot) => {
        setProfile(snapshot.exists() ? (snapshot.data() as UserProfile) : null);
        setProfileLoading(false);
      },
      () => {
        setProfile(null);
        setProfileLoading(false);
      }
    );
    return () => unsubscribe();
  }, [user.uid]);

  useEffect(() => {
    let cancelled = false;
    user
      .getIdToken()
      .then((token) => {
        if (!cancelled) setBearerToken(token);
      })
      .catch(() => {
        if (!cancelled) setBearerToken(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [user.uid]);

  const {
    credits,
    loading: creditsLoading,
    error: creditsError,
    refetch: refetchCredits,
  } = useTranslationCredits(bearerToken);

  const displayName = useMemo(() => {
    const name = toSafeString(profile?.name);
    if (name) return name;
    const email = user.email ?? "";
    return email ? email.split("@")[0] : ui.defaultUser;
  }, [profile?.name, ui.defaultUser, user.email]);

  const buildLabel = useMemo(() => {
    const version =
      typeof Constants.expoConfig?.version === "string" && Constants.expoConfig.version.trim()
        ? Constants.expoConfig.version.trim()
        : "1.0.0";
    const iosBuildRaw = (Constants as unknown as { platform?: { ios?: { buildNumber?: string | null } } })
      ?.platform?.ios?.buildNumber;
    const iosBuild =
      typeof iosBuildRaw === "string" && iosBuildRaw.trim() ? iosBuildRaw.trim() : null;
    return ui.buildLabel(version, iosBuild);
  }, [ui]);

  const isPremiumPlan = useMemo(
    () => profile?.isPremium === true || toSafeString(profile?.plan).toLowerCase() === "premium",
    [profile?.isPremium, profile?.plan]
  );
  const isGuestMode = !user.email;

  const freeTrialRemainingMinutes = useMemo(() => {
    if (!credits) return 0;
    return Math.max(0, Math.ceil(Math.max(0, credits.freeSecondsRemaining) / 60));
  }, [credits]);

  const translationStatusLabel = useMemo(() => {
    if (creditsLoading) return ui.loadingBalance;
    if (credits && credits.paidSecondsRemaining > 0) {
      return ui.translationAvailable(Math.ceil(credits.totalSecondsRemaining / 60));
    }
    if (freeTrialRemainingMinutes > 0) {
      return ui.freeTrial(freeTrialRemainingMinutes);
    }
    return ui.topUpRequired;
  }, [credits, creditsLoading, freeTrialRemainingMinutes, ui]);

  const availableIapPacks = useMemo(
    () => (iapNativeReady ? iapPacks.filter((pack) => pack.hasNativeProduct) : []),
    [iapNativeReady, iapPacks]
  );

  const describePack = (minutes: number): PackPresentation => {
    if (minutes >= 600) {
      return {
        badge: ui.packProBadge,
        summary: ui.packProSummary,
      };
    }
    if (minutes >= 180) {
      return {
        badge: ui.packRecommendedBadge,
        summary: ui.packRecommendedSummary,
        highlighted: true,
      };
    }
    return {
      badge: ui.packStarterBadge,
      summary: ui.packStarterSummary,
    };
  };

  useEffect(() => {
    let cancelled = false;

    const loadIapCatalog = async () => {
      const apiBaseUrl = env.apiBaseUrl.trim();
      logIap("dashboard_catalog_load_start", {
        userUid: user.uid,
        hasEmail: Boolean(user.email),
        apiBaseUrl,
      });
      if (!apiBaseUrl) {
        if (!cancelled) setIapError(ui.apiMissing);
        logIap("dashboard_catalog_load_error", {
          reason: "api_missing",
        });
        return;
      }

      setIapLoading(true);
      setIapError("");
      try {
        const token = await user.getIdToken();
        const catalog = await fetchIosIapCatalog({
          apiBaseUrl,
          bearerToken: token,
        });
        if (cancelled) return;
        setIapNativeReady(catalog.nativeReady);
        setIapPacks(catalog.packs);
        logIap("dashboard_catalog_load_ok", {
          nativeReady: catalog.nativeReady,
          packCount: catalog.packs.length,
          nativePackCount: catalog.packs.filter((pack) => pack.hasNativeProduct).length,
          productIds: catalog.packs.map((pack) => pack.productId).join(","),
          prices: catalog.packs.map((pack) => `${pack.productId}:${pack.price}`).join(" | "),
        });
      } catch (error) {
        if (cancelled) return;
        setIapError(error instanceof Error ? error.message : ui.iapLoadError);
        logIap("dashboard_catalog_load_error", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      } finally {
        if (!cancelled) setIapLoading(false);
      }
    };

    void loadIapCatalog();
    return () => {
      cancelled = true;
    };
  }, [ui.apiMissing, ui.iapLoadError, user.uid]);

  useEffect(() => {
    if (iapLoading) return;
    logIap("dashboard_render_state", {
      nativeReady: iapNativeReady,
      packCount: iapPacks.length,
      busyProductId: iapBusyProductId || "none",
      hasError: Boolean(iapError),
      error: iapError || "none",
    });
  }, [iapBusyProductId, iapError, iapLoading, iapNativeReady, iapPacks.length]);

  const onBuyIapPack = async (pack: IosIapCatalogPack) => {
    const apiBaseUrl = env.apiBaseUrl.trim();
    if (!apiBaseUrl) {
      setIapError(ui.apiMissing);
      logIap("dashboard_purchase_blocked", {
        productId: pack.productId,
        reason: "api_missing",
      });
      return;
    }
    if (!iapNativeReady || !pack.hasNativeProduct) {
      setIapError(ui.unavailablePack);
      logIap("dashboard_purchase_blocked", {
        productId: pack.productId,
        reason: !iapNativeReady ? "native_not_ready" : "missing_native_product",
      });
      return;
    }
    setIapInfo("");
    setIapError("");
    setIapBusyProductId(pack.productId);
    logIap("dashboard_purchase_press", {
      productId: pack.productId,
      nativeReady: iapNativeReady,
      hasNativeProduct: pack.hasNativeProduct,
    });
    try {
      const token = await user.getIdToken();
      const result = await purchaseIosIapPack({
        apiBaseUrl,
        bearerToken: token,
        productId: pack.productId,
      });
      const totalMinutes = Math.max(0, Math.ceil((result.totalSecondsRemaining || 0) / 60));
      setIapInfo(
        result.alreadyProcessed
          ? ui.alreadyProcessed(totalMinutes)
          : ui.purchaseConfirmed(result.minutesAdded, totalMinutes)
      );
      logIap("dashboard_purchase_ok", {
        productId: pack.productId,
        alreadyProcessed: result.alreadyProcessed,
        minutesAdded: result.minutesAdded,
        totalMinutes,
      });
      refetchCredits();
    } catch (error) {
      setIapError(error instanceof Error ? error.message : ui.iapUnavailable);
      logIap("dashboard_purchase_error", {
        productId: pack.productId,
        reason: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      setIapBusyProductId("");
    }
  };

  const toggleSection = (key: DashboardAccordionKey) => {
    setOpenSection((current) => (current === key ? null : key));
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.heroTextBlock}>
            <Text style={styles.kicker}>{ui.heroKicker}</Text>
            <Text style={styles.title}>{ui.welcome(displayName)}</Text>
            <Text style={styles.buildText}>{buildLabel}</Text>
          </View>
          <LanguageSwitcher compact />
        </View>
            <Text style={styles.subtitle}>{isGuestMode ? ui.heroSubtitleGuest : ui.heroSubtitle}</Text>
        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>{translationStatusLabel}</Text>
        </View>
      </View>

      <DashboardAccordion
        title={ui.pocketTitle}
        isOpen={openSection === "pocket"}
        onToggle={() => toggleSection("pocket")}
      >
        <Text style={styles.summaryText}>{ui.pocketSummary}</Text>
        <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={onOpenInterpreter}>
          <Text style={styles.actionButtonText}>{ui.openPocket}</Text>
        </Pressable>
      </DashboardAccordion>

      <DashboardAccordion
        title={ui.videoTitle}
        isOpen={openSection === "video"}
        onToggle={() => toggleSection("video")}
      >
        <Text style={styles.summaryText}>{ui.videoSummary}</Text>
        <Pressable style={[styles.actionButton, styles.actionPrimary]} onPress={onOpenConference}>
          <Text style={styles.actionButtonText}>{ui.openRooms}</Text>
        </Pressable>
      </DashboardAccordion>

      <DashboardAccordion
        title={ui.translationTitle}
        isOpen={openSection === "minutes"}
        onToggle={() => toggleSection("minutes")}
      >
        <Text style={styles.summaryText}>{ui.translationSummary}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaChip}>
            {ui.balance(
              creditsLoading
                ? "..."
                : credits
                  ? `${Math.ceil(credits.totalSecondsRemaining / 60)} min`
                  : "0 min"
            )}
          </Text>
          {!isPremiumPlan && freeTrialRemainingMinutes > 0 ? (
            <Text style={styles.metaChip}>{ui.trial(freeTrialRemainingMinutes)}</Text>
          ) : null}
          <Text style={styles.metaChip}>
            {ui.account(isGuestMode ? ui.guest : isPremiumPlan ? ui.premium : ui.standard)}
          </Text>
        </View>
        {creditsError ? <Text style={styles.errorText}>{ui.creditsError(creditsError)}</Text> : null}
        {isGuestMode ? (
          <Pressable style={[styles.actionButton, styles.secondaryButton]} onPress={onOpenLogin}>
            <Text style={styles.secondaryButtonText}>{ui.createAccount}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.infoText}>{ui.finalApplePriceHint}</Text>

        {iapLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#93c5fd" />
            <Text style={styles.infoText}>{ui.loadingOffers}</Text>
          </View>
        ) : null}

        {availableIapPacks.map((pack) => {
          const disabled = Boolean(iapBusyProductId) || !iapNativeReady || !pack.hasNativeProduct;
          const presentation = describePack(pack.minutes);
          return (
            <Pressable
              key={pack.productId}
              disabled={disabled}
              onPress={() => {
                void onBuyIapPack(pack);
              }}
              style={[
                styles.packRow,
                presentation.highlighted && styles.packRowHighlighted,
                disabled && styles.buttonDisabled,
              ]}
            >
              <View style={styles.packHeader}>
                <Text
                  style={[
                    styles.packBadge,
                    presentation.highlighted && styles.packBadgeHighlighted,
                  ]}
                >
                  {presentation.badge}
                </Text>
              </View>
              <View style={styles.packMeta}>
                <Text style={styles.packTitle}>{pack.title || ui.packMinutes(pack.minutes)}</Text>
                <Text style={styles.packSummary}>{pack.description || presentation.summary}</Text>
              </View>
              <View
                style={[styles.actionButton, styles.actionPrimary, disabled && styles.buttonDisabled]}
                pointerEvents="none"
              >
                {iapBusyProductId === pack.productId ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.actionButtonText}>{ui.buyInIos}</Text>
                )}
              </View>
            </Pressable>
          );
        })}

        {!iapNativeReady ? (
          <Text style={styles.infoText}>{ui.iapUnavailableBuild}</Text>
        ) : null}
        {iapNativeReady && !iapLoading && availableIapPacks.length === 0 ? (
          <Text style={styles.infoText}>{ui.unavailableCatalog}</Text>
        ) : null}
        {iapInfo ? <Text style={styles.successText}>{iapInfo}</Text> : null}
        {iapError ? <Text style={styles.errorText}>{iapError}</Text> : null}
      </DashboardAccordion>

      <DashboardAccordion
        title={ui.accountTitle}
        isOpen={openSection === "account"}
        onToggle={() => toggleSection("account")}
      >
        <Text style={styles.summaryText}>
          {isGuestMode ? ui.guestEmail : user.email ?? ui.unknownEmail}
        </Text>
        <Text style={styles.infoText}>
          {isGuestMode
            ? ui.guestStatus
            : profileLoading
              ? ui.loadingProfile
              : ui.status(isPremiumPlan ? ui.premium : ui.standard)}
        </Text>
        <Pressable onPress={onSignOut} style={styles.logoutButton}>
          <Text style={styles.logoutButtonText}>{ui.signOut}</Text>
        </Pressable>
      </DashboardAccordion>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 108,
    gap: 12,
    backgroundColor: "#020617",
  },
  heroCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 18,
    backgroundColor: "#0b1220",
    padding: 16,
    gap: 8,
  },
  heroHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  heroTextBlock: {
    flex: 1,
    gap: 4,
  },
  kicker: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: "#e2e8f0",
    fontSize: 22,
    fontWeight: "800",
  },
  buildText: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
  },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  statusBanner: {
    marginTop: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1e3a8a",
    backgroundColor: "#0f172a",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusBannerText: {
    color: "#bfdbfe",
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 16,
    backgroundColor: "#0b1220",
    padding: 14,
    gap: 10,
  },
  accordionCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 16,
    backgroundColor: "#0b1220",
    overflow: "hidden",
  },
  accordionHeader: {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  accordionTitle: {
    flex: 1,
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "800",
  },
  accordionIcon: {
    color: "#94a3b8",
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 22,
  },
  accordionContent: {
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  sectionTitle: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "800",
  },
  summaryText: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 18,
  },
  infoText: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metaChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  actionColumn: {
    gap: 8,
  },
  actionButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionPrimary: {
    backgroundColor: "#0c4a6e",
    borderColor: "#38bdf8",
  },
  secondaryButton: {
    backgroundColor: "#111827",
    borderColor: "#475569",
  },
  actionButtonText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "800",
  },
  secondaryButtonText: {
    color: "#cbd5e1",
    fontSize: 13,
    fontWeight: "700",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  packRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#0f172a",
    padding: 10,
    gap: 8,
  },
  packRowHighlighted: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  packHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  packBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
    color: "#cbd5e1",
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  packBadgeHighlighted: {
    borderColor: "#7dd3fc",
    backgroundColor: "#0c4a6e",
    color: "#e0f2fe",
  },
  packMeta: {
    gap: 4,
  },
  packTitle: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "800",
  },
  packSummary: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 17,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  successText: {
    color: "#86efac",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  logoutButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#7f1d1d",
    backgroundColor: "#3f1516",
    paddingVertical: 12,
    alignItems: "center",
  },
  logoutButtonText: {
    color: "#fecaca",
    fontSize: 13,
    fontWeight: "800",
  },
});
