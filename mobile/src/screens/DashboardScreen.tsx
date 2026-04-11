import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import Constants from "expo-constants";
import { useI18n } from "../i18n";
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

const MOBILE_BRAND_ICON = require("../../assets/icon.png");

const toSafeString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const logIap = (event: string, details?: Record<string, unknown>) => {
  const suffix = details
    ? ` ${Object.entries(details)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")}`
    : "";
  console.log(`[BFZoom][IAP] ${event}${suffix}`);
};

const matchesMessage = (message: string, pattern: RegExp) => pattern.test(message.toLowerCase());
const isPurchaseCanceledMessage = (message: string) =>
  matchesMessage(message, /(purchase canceled|achat annule|purchase did not start)/i);
const isPurchasePendingMessage = (message: string) =>
  matchesMessage(message, /(pending approval|en attente d'approbation|deferred)/i);
const isNativeIapBuildMessage = (message: string) =>
  matchesMessage(message, /(storekit|iap ios natif indisponible|this build|purchase listener unavailable)/i);
const isStoreAccountMessage = (message: string) =>
  matchesMessage(message, /(not available.*app store|unavailable.*app store|compte app store|pack de traduction n'est pas disponible)/i);

type DashboardNotice = {
  title: string;
  body: string;
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
            welcome: (name: string) => `Bienvenue, ${name}`,
            heroSubtitle:
              "Retrouve ici tes deux usages BFZoom: la visioconference pour parler au monde et Pocket Interpreter pour echanger sans barriere en face-a-face.",
            heroSubtitleGuest:
              "Depuis cet ecran, tu retrouves la visioconference BFZoom, Pocket Interpreter et tes minutes de traduction. Cree un compte quand tu veux pour synchroniser ton usage sur plusieurs appareils.",
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
            creditsIssueTitle: "Minutes temporairement indisponibles",
            creditsIssueBody:
              "Impossible de verifier ton solde pour le moment. Reessaie dans quelques secondes.",
            loadingOffers: "Chargement des offres iOS...",
            buyInIos: "Acheter ce pack",
            finalApplePriceHint:
              "Le prix final et la devise sont confirmes par Apple sur l'ecran d'achat.",
            debugCatalogTitle: "Achat iPhone non testable sur cette build",
            debugCatalogBody:
              "Cette build debug charge bien le catalogue BFZoom, mais pas les vrais produits App Store. Pour acheter sur iPhone, il faut une build signee avec le bundle officiel BFZoom ou une build TestFlight.",
            packUnavailableShort: "TestFlight requis",
            packUnavailableHint:
              "Achat bloque sur cette build debug: produit App Store non charge.",
            buildLabel: (version: string, build: string | null) =>
              build ? `Version ${version} · build ${build}` : `Version ${version}`,
            brandSignature: "by Beyond Frontiers",
            iapUnavailableBuild:
              "Achats in-app indisponibles sur cette build debug. Utilise le bundle officiel BFZoom ou TestFlight.",
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
            purchasePendingTitle: "Achat en attente",
            purchasePendingBody:
              "Apple attend encore une validation. Tu peux verifier ton achat dans quelques instants.",
            purchaseUnavailableTitle: "Achats iPhone indisponibles",
            purchaseUnavailableBody:
              "Les achats integres ne sont pas actifs sur cette build. Il faut tester une build iOS avec StoreKit.",
            storeAccountTitle: "Pack indisponible",
            storeAccountBody:
              "Ce pack n'est pas accessible avec le compte App Store actuellement connecte.",
            purchaseIssueTitle: "Achat non finalise",
            purchaseIssueBody:
              "La demande d'achat n'a pas pu aboutir. Reessaie dans un instant.",
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
            welcome: (name: string) => `Welcome, ${name}`,
            heroSubtitle:
              "This is your BFZoom hub: multilingual video calls to speak to the world, and Pocket Interpreter for barrier-free face-to-face moments.",
            heroSubtitleGuest:
              "From this screen, you access BFZoom video calls, Pocket Interpreter and your translation minutes. Create an account whenever you want to sync your usage across devices.",
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
            creditsIssueTitle: "Minutes temporarily unavailable",
            creditsIssueBody:
              "Your balance could not be checked right now. Try again in a few seconds.",
            loadingOffers: "Loading iOS offers...",
            buyInIos: "Buy this pack",
            finalApplePriceHint:
              "Apple confirms the final local price and currency on the purchase sheet.",
            debugCatalogTitle: "iPhone purchase unavailable on this build",
            debugCatalogBody:
              "This debug build loads the BFZoom catalog but not the live App Store products. To purchase on iPhone, use a build signed with the official BFZoom bundle ID or TestFlight.",
            packUnavailableShort: "TestFlight required",
            packUnavailableHint:
              "Purchase blocked on this debug build: App Store product not loaded.",
            buildLabel: (version: string, build: string | null) =>
              build ? `Version ${version} · build ${build}` : `Version ${version}`,
            brandSignature: "by Beyond Frontiers",
            iapUnavailableBuild:
              "In-app purchases are unavailable in this debug build. Use the official BFZoom bundle or TestFlight.",
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
            purchasePendingTitle: "Purchase pending",
            purchasePendingBody:
              "Apple is still waiting for approval. Check your purchase status again in a moment.",
            purchaseUnavailableTitle: "iPhone purchases unavailable",
            purchaseUnavailableBody:
              "In-app purchases are not active in this build. Test with an iOS build that includes StoreKit.",
            storeAccountTitle: "Pack unavailable",
            storeAccountBody:
              "This pack is not available for the App Store account currently signed in on the device.",
            purchaseIssueTitle: "Purchase not completed",
            purchaseIssueBody:
              "The purchase request could not be completed. Please try again shortly.",
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
  }, [user]);

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
  }, [user]);

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

  const showDebugCatalogFallback =
    __DEV__ && iapNativeReady && availableIapPacks.length === 0 && iapPacks.length > 0;

  const displayedIapPacks = useMemo(() => {
    if (availableIapPacks.length > 0) return availableIapPacks;
    if (showDebugCatalogFallback) return iapPacks;
    return [];
  }, [availableIapPacks, iapPacks, showDebugCatalogFallback]);

  const creditsNotice = useMemo<DashboardNotice | null>(() => {
    const message = toSafeString(creditsError);
    if (!message) return null;
    return {
      title: ui.creditsIssueTitle,
      body: ui.creditsIssueBody,
    };
  }, [creditsError, ui.creditsIssueBody, ui.creditsIssueTitle]);

  const iapNotice = useMemo<DashboardNotice | null>(() => {
    const message = toSafeString(iapError);
    if (!message || isPurchaseCanceledMessage(message)) return null;
    if (isPurchasePendingMessage(message)) {
      return {
        title: ui.purchasePendingTitle,
        body: ui.purchasePendingBody,
      };
    }
    if (isNativeIapBuildMessage(message)) {
      return {
        title: ui.purchaseUnavailableTitle,
        body: ui.purchaseUnavailableBody,
      };
    }
    if (isStoreAccountMessage(message)) {
      return {
        title: ui.storeAccountTitle,
        body: ui.storeAccountBody,
      };
    }
    return {
      title: ui.purchaseIssueTitle,
      body: ui.purchaseIssueBody,
    };
  }, [
    iapError,
    ui.purchaseIssueBody,
    ui.purchaseIssueTitle,
    ui.purchasePendingBody,
    ui.purchasePendingTitle,
    ui.purchaseUnavailableBody,
    ui.purchaseUnavailableTitle,
    ui.storeAccountBody,
    ui.storeAccountTitle,
  ]);

  const catalogNotice = useMemo<DashboardNotice | null>(() => {
    if (!showDebugCatalogFallback) return null;
    return {
      title: ui.debugCatalogTitle,
      body: ui.debugCatalogBody,
    };
  }, [showDebugCatalogFallback, ui.debugCatalogBody, ui.debugCatalogTitle]);

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
  }, [ui.apiMissing, ui.iapLoadError, user]);

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
          <View style={styles.brandRow}>
            <Image source={MOBILE_BRAND_ICON} style={styles.brandLogo} resizeMode="cover" alt="" />
            <View style={styles.heroTextBlock}>
              <Text style={styles.brand}>BFZoom</Text>
              <Text style={styles.brandHint}>{ui.brandSignature}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.title}>{ui.welcome(displayName)}</Text>
        <Text style={styles.subtitle}>{isGuestMode ? ui.heroSubtitleGuest : ui.heroSubtitle}</Text>
        <Text style={styles.buildText}>{buildLabel}</Text>
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
        {creditsNotice ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>{creditsNotice.title}</Text>
            <Text style={styles.noticeBody}>{creditsNotice.body}</Text>
          </View>
        ) : null}
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

        {catalogNotice ? (
          <View style={styles.noticeCard}>
            <Text style={styles.noticeTitle}>{catalogNotice.title}</Text>
            <Text style={styles.noticeBody}>{catalogNotice.body}</Text>
          </View>
        ) : null}

        {displayedIapPacks.map((pack) => {
          const canPurchase = iapNativeReady && pack.hasNativeProduct;
          const disabled = Boolean(iapBusyProductId) || !canPurchase;
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
                <Text style={styles.packPrice}>{pack.price}</Text>
                {!canPurchase ? (
                  <Text style={styles.packHint}>{ui.packUnavailableHint}</Text>
                ) : null}
              </View>
              <View
                style={[styles.actionButton, styles.actionPrimary, disabled && styles.buttonDisabled]}
                pointerEvents="none"
              >
                {iapBusyProductId === pack.productId ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.actionButtonText}>
                    {canPurchase ? ui.buyInIos : ui.packUnavailableShort}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}

        {!iapNativeReady ? (
          <Text style={styles.infoText}>{ui.iapUnavailableBuild}</Text>
        ) : null}
        {iapNativeReady && !iapLoading && displayedIapPacks.length === 0 ? (
          <Text style={styles.infoText}>{ui.unavailableCatalog}</Text>
        ) : null}
        {iapInfo ? <Text style={styles.successText}>{iapInfo}</Text> : null}
        {iapNotice ? (
          <View style={[styles.noticeCard, styles.noticeCardWarm]}>
            <Text style={styles.noticeTitle}>{iapNotice.title}</Text>
            <Text style={styles.noticeBody}>{iapNotice.body}</Text>
          </View>
        ) : null}
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
    alignItems: "flex-start",
  },
  heroTextBlock: {
    gap: 4,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  brand: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  brandHint: {
    color: "#38bdf8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
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
  packPrice: {
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: "800",
  },
  packHint: {
    color: "#94a3b8",
    fontSize: 11,
    lineHeight: 16,
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
  noticeCard: {
    borderWidth: 1,
    borderColor: "#1e3a8a",
    borderRadius: 12,
    backgroundColor: "#0f172a",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  noticeCardWarm: {
    borderColor: "#7c2d12",
    backgroundColor: "#1c1917",
  },
  noticeTitle: {
    color: "#e2e8f0",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  noticeBody: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 17,
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
