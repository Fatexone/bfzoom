import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { useI18n } from "../i18n";
import { env } from "../config/env";
import { auth } from "../services/firebase";

type LandingScreenProps = {
  onOpenLogin: () => void;
};

type AccordionKey = "pricing" | "features" | "languages";

const MOBILE_BRAND_ICON = require("../../assets/icon.png");

const resolveWebUrl = (path: string) => {
  const base = env.apiBaseUrl || "";
  if (
    /(^https?:\/\/localhost)|(^https?:\/\/127\.)|(^https?:\/\/0\.0\.0\.0)/i.test(base)
  ) {
    return `https://www.bfzoom.fr${path}`;
  }
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base.replace(/\/+$/, "")}${path}`;
  }
  return `https://www.bfzoom.fr${path}`;
};

type AccordionProps = {
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
  items: string[];
  children?: ReactNode;
};

function LandingAccordion({
  title,
  description,
  isOpen,
  onToggle,
  items,
  children,
}: AccordionProps) {
  return (
    <View style={styles.accordionCard}>
      <Pressable style={styles.accordionHead} onPress={onToggle}>
        <View style={styles.accordionHeadText}>
          <Text style={styles.accordionTitle}>{title}</Text>
          <Text style={styles.accordionDescription}>{description}</Text>
        </View>
        <Text style={styles.accordionIcon}>{isOpen ? "-" : "+"}</Text>
      </Pressable>
      {isOpen ? (
        <View style={styles.accordionContent}>
          {items.map((item) => (
            <View key={`${title}-${item}`} style={styles.accordionItem}>
              <Text style={styles.accordionItemDot}>•</Text>
              <Text style={styles.accordionItemText}>{item}</Text>
            </View>
          ))}
          {children}
        </View>
      ) : null}
    </View>
  );
}

export function LandingScreen({
  onOpenLogin,
}: LandingScreenProps) {
  const { language } = useI18n();
  const [userEmail, setUserEmail] = useState("");
  const [openError, setOpenError] = useState("");
  const [expanded, setExpanded] = useState<Record<AccordionKey, boolean>>({
    pricing: false,
    features: true,
    languages: false,
  });

  const ui = useMemo(
    () =>
      language === "fr"
        ? {
            contact: "Contact",
            heroTitle: "Parle ta langue. BFZoom traduit en direct.",
            heroSubtitle: "Voix traduite et sous-titres partages.",
            signIn: "Se connecter",
            brandSignature: "by Beyond Frontiers",
            pricingTitle: "Informations pratiques",
            pricingDescription: "Application gratuite, 3 minutes offertes et achats iPhone.",
            pricingBody:
              "L'application BFZoom est gratuite au telechargement et inclut 3 minutes de traduction offertes une seule fois. Ensuite, les minutes de traduction s'achetent sur iPhone. Une fois connecte, ton dashboard BFZoom centralise le suivi de tes minutes et de tes usages.",
            whyTitle: "BFZoom",
            whyDescription:
              "Visioconference pour parler au monde, et Pocket pour voyager sans barriere.",
            languagesTitle: "Langues disponibles",
            languagesDescription:
              "Selection source et langue de reception pour chaque participant.",
            openWebError: "Impossible d'ouvrir la page web.",
            connectedLabel: (email: string) => `Compte connecte: ${email}`,
            featureItems: [
              "BFZoom est d'abord une visioconference multilingue: chacun parle sa langue, l'autre comprend dans la sienne.",
              "Voix traduite et sous-titres partages pour echanger avec des clients, proches ou partenaires partout dans le monde.",
              "Pocket Interpreter t'accompagne en face-a-face pour voyager, demander, comprendre et ne plus rester bloque.",
              "Un meme coeur produit, deux usages simples: la room video pour parler au monde, Pocket pour le terrain.",
              "Beyond Frontiers: moins de barrieres linguistiques, plus de conversations utiles.",
            ],
            languageItems: [
              "Francais",
              "Portugais",
              "Portugais (Bresil)",
              "Arabe",
              "Darija (Maghreb)",
              "Anglais",
              "Chinois",
              "Allemand",
              "Espagnol",
              "Hindi",
              "Coreen",
              "Turc",
              "Thai",
              "Japonais",
              "Persan (Farsi)",
              "Hebreu",
              "Italien",
              "Russe",
              "Latin",
            ],
          }
        : {
            contact: "Contact",
            heroTitle: "Speak your language. BFZoom translates live.",
            heroSubtitle: "Translated voice and shared captions.",
            signIn: "Sign in",
            brandSignature: "by Beyond Frontiers",
            pricingTitle: "Practical information",
            pricingDescription: "Free app, 3 free minutes and iPhone purchases.",
            pricingBody:
              "The BFZoom app is free to download and includes 3 one-time free translation minutes. After that, translation minutes are purchased on iPhone. Once signed in, your BFZoom dashboard centralizes your minutes and usage follow-up.",
            whyTitle: "BFZoom",
            whyDescription:
              "Video calls to speak to the world, and Pocket for travel without language barriers.",
            languagesTitle: "Available languages",
            languagesDescription:
              "Choose a source and listening language for each participant.",
            openWebError: "Unable to open the web page.",
            connectedLabel: (email: string) => `Account ready: ${email}`,
            featureItems: [
              "BFZoom is first a multilingual video call experience: each person speaks their own language, the other understands in theirs.",
              "Translated voice and shared captions help you speak with clients, relatives or partners anywhere in the world.",
              "Pocket Interpreter supports face-to-face moments when you travel, ask, understand and avoid getting stuck.",
              "One product core, two simple uses: video rooms to speak to the world, Pocket for the field.",
              "Beyond Frontiers means fewer language barriers and more useful conversations.",
            ],
            languageItems: [
              "French",
              "Portuguese",
              "Portuguese (Brazil)",
              "Arabic",
              "Darija (Maghreb)",
              "English",
              "Chinese",
              "German",
              "Spanish",
              "Hindi",
              "Korean",
              "Turkish",
              "Thai",
              "Japanese",
              "Persian (Farsi)",
              "Hebrew",
              "Italian",
              "Russian",
              "Latin",
            ],
          },
    [language]
  );

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserEmail(user?.email ?? "");
    });
    return () => unsubscribe();
  }, []);

  const sessionLabel = useMemo(() => {
    return userEmail ? ui.connectedLabel(userEmail) : "";
  }, [ui, userEmail]);

  const openWeb = async (path: string) => {
    setOpenError("");
    try {
      await Linking.openURL(resolveWebUrl(path));
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : ui.openWebError);
    }
  };

  const toggleAccordion = (key: AccordionKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <View style={styles.root}>
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View style={styles.brandRow}>
            <Image source={MOBILE_BRAND_ICON} style={styles.brandLogo} resizeMode="cover" alt="" />
            <View>
              <Text style={styles.brand}>BFZoom</Text>
              <Text style={styles.brandHint}>{ui.brandSignature}</Text>
            </View>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                style={styles.headerLink}
                onPress={() => void openWeb("/contact?mobileReturn=home")}
            >
              <Text style={styles.headerLinkText}>{ui.contact}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>{ui.heroTitle}</Text>
          <Text style={styles.heroSubtitle}>{ui.heroSubtitle}</Text>

          {sessionLabel ? (
            <View style={styles.sessionCard}>
              <Text style={styles.sessionLabel}>{sessionLabel}</Text>
            </View>
          ) : null}

          {!userEmail ? (
            <View style={styles.ctaRow}>
              <Pressable style={styles.primaryCta} onPress={onOpenLogin}>
                <Text style={styles.primaryCtaText}>{ui.signIn}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <LandingAccordion
          title={ui.whyTitle}
          description={ui.whyDescription}
          isOpen={expanded.features}
          onToggle={() => toggleAccordion("features")}
          items={ui.featureItems}
        />
        <LandingAccordion
          title={ui.languagesTitle}
          description={ui.languagesDescription}
          isOpen={expanded.languages}
          onToggle={() => toggleAccordion("languages")}
          items={ui.languageItems}
        />
        <LandingAccordion
          title={ui.pricingTitle}
          description={ui.pricingDescription}
          isOpen={expanded.pricing}
          onToggle={() => toggleAccordion("pricing")}
          items={[]}
        >
          <Text style={styles.offerBody}>{ui.pricingBody}</Text>
        </LandingAccordion>

        {openError ? <Text style={styles.errorText}>{openError}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
  },
  glowTop: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    top: -120,
    right: -80,
    backgroundColor: "rgba(14,165,233,0.25)",
  },
  glowBottom: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    bottom: -120,
    left: -90,
    backgroundColor: "rgba(16,185,129,0.2)",
  },
  container: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 108,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
  headerLink: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerLinkText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  heroCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 18,
    backgroundColor: "rgba(8,47,73,0.42)",
    padding: 14,
    gap: 12,
  },
  heroTitle: {
    color: "#f8fafc",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },
  heroSubtitle: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 19,
  },
  sessionCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 12,
    backgroundColor: "rgba(11,18,32,0.88)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sessionLabel: {
    color: "#e2e8f0",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  ctaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  primaryCta: {
    backgroundColor: "#0284c7",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryCtaText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  secondaryCta: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    backgroundColor: "#0b1220",
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  secondaryCtaText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
  },
  offerBody: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 19,
  },
  accordionCard: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 16,
    backgroundColor: "rgba(11,18,32,0.9)",
    overflow: "hidden",
  },
  accordionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  accordionHeadText: {
    flex: 1,
    gap: 3,
  },
  accordionTitle: {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: "800",
  },
  accordionDescription: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 17,
  },
  accordionIcon: {
    color: "#7dd3fc",
    fontSize: 20,
    fontWeight: "800",
    width: 22,
    textAlign: "center",
  },
  accordionContent: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 8,
  },
  accordionItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  accordionItemDot: {
    color: "#38bdf8",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "800",
  },
  accordionItemText: {
    flex: 1,
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: "#fca5a5",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
  },
});
