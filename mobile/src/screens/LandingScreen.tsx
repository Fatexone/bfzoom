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
import { LanguageSwitcher, useI18n } from "../i18n";
import { env } from "../config/env";
import { auth } from "../services/firebase";

type LandingScreenProps = {
  onOpenLogin: () => void;
  onOpenConference: () => void;
  onOpenDashboard: () => void;
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
  onOpenConference,
  onOpenDashboard,
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
            heroKicker: "VISIO MULTILINGUE EN DIRECT",
            heroTitle: "Parle ta langue. Le monde te comprend.",
            heroSubtitle:
              "Application mobile de visioconference avec traduction voix + sous-titres en direct. Tu parles dans ta langue, ton interlocuteur recoit dans la sienne. Ideal pour 2 a 4 participants.",
            createRoom: "Creer une room",
            signIn: "Se connecter",
            mobileFirst: "Mobile-first",
            realtime: "Temps reel",
            fastRoomLink: "Lien de salle rapide",
            pricingTitle: "Tarification mobile",
            pricingDescription: "Packs iPhone et minutes de traduction.",
            pricingBody:
              "Telechargement gratuit. Tu peux acheter tes packs de traduction sur iPhone sans partager d'information personnelle. Cree ensuite un compte si tu veux synchroniser tes minutes sur plusieurs appareils. Concu pour les appels 1:1 et les petits groupes jusqu'a 4 participants.",
            loginRequiredTitle: "Connexion requise",
            loginRequiredBody:
              "Pour lancer une session, connecte-toi d'abord. Le meme ecran permet aussi de creer ton compte avec ton email.",
            createAccount: "Creer un compte / se connecter",
            openPacks: "Voir les packs iPhone",
            whyTitle: "Pourquoi BFZoom",
            whyDescription: "Une vraie valeur unique pour communiquer a l'international.",
            languagesTitle: "Langues disponibles",
            languagesDescription:
              "Selection source et langue de reception pour chaque participant.",
            footerConference: "Visioconference",
            openWebError: "Impossible d'ouvrir la page web.",
            signedOutLabel:
              "Connecte-toi pour creer une room et lancer une visio multilingue.",
            connectedLabel: (email: string) => `Connecte: ${email}`,
            featureItems: [
              "Interpretation live: tu parles ta langue, l'autre ecoute dans la sienne.",
              "Talkie-walkie traduction + mode voix naturelle selon ton usage.",
              "Sous-titres partages + voix traduite pour echanges internationaux.",
              "Invitation par lien en un clic, sans friction pour l'invite.",
              "Application mobile concentree sur la visio multilingue en direct, ideale pour 2 a 4 participants.",
            ],
            languageItems: [
              "Francais",
              "Portugais",
              "Portugais (Bresil)",
              "Arabe",
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
            heroKicker: "LIVE MULTILINGUAL CALLS",
            heroTitle: "Speak your language. Let the world understand.",
            heroSubtitle:
              "Mobile video calls with live voice translation and shared captions. You speak in your language, the other participant receives everything in theirs. Ideal for 2 to 4 participants.",
            createRoom: "Create a room",
            signIn: "Sign in",
            mobileFirst: "Mobile-first",
            realtime: "Real-time",
            fastRoomLink: "Fast room link",
            pricingTitle: "Mobile pricing",
            pricingDescription: "iPhone packs and translation minutes.",
            pricingBody:
              "Free download. You can buy iPhone translation packs without sharing personal information. Create an account later if you want to sync your minutes across multiple devices. Built for 1:1 calls and small groups up to 4 participants.",
            loginRequiredTitle: "Sign-in required",
            loginRequiredBody:
              "To start a session, sign in first. The same screen also lets you create your account with your email.",
            createAccount: "Create account / sign in",
            openPacks: "View iPhone packs",
            whyTitle: "Why BFZoom",
            whyDescription: "A real differentiator for international conversations.",
            languagesTitle: "Available languages",
            languagesDescription:
              "Choose a source and listening language for each participant.",
            footerConference: "Video calls",
            openWebError: "Unable to open the web page.",
            signedOutLabel:
              "Sign in to create a room and start a multilingual video call.",
            connectedLabel: (email: string) => `Signed in: ${email}`,
            featureItems: [
              "Live interpreting: you speak your language, the other person listens in theirs.",
              "Push-to-talk translation with natural voice mode depending on your use case.",
              "Shared captions and translated voice for international conversations.",
              "Invite by link in one tap, with no friction for guests.",
              "A mobile app focused on live multilingual video calls, ideal for 2 to 4 participants.",
            ],
            languageItems: [
              "French",
              "Portuguese",
              "Portuguese (Brazil)",
              "Arabic",
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
    if (!userEmail) {
      return ui.signedOutLabel;
    }
    return ui.connectedLabel(userEmail);
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
            <Image source={MOBILE_BRAND_ICON} style={styles.brandLogo} resizeMode="cover" />
            <View>
              <Text style={styles.brand}>BFZoom</Text>
              <Text style={styles.brandHint}>mobile</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <LanguageSwitcher compact />
            <Pressable
              style={styles.headerLink}
              onPress={() => void openWeb("/contact?mobileReturn=home")}
            >
              <Text style={styles.headerLinkText}>{ui.contact}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroKicker}>{ui.heroKicker}</Text>
          <Text style={styles.heroTitle}>{ui.heroTitle}</Text>
          <Text style={styles.heroSubtitle}>
            {ui.heroSubtitle} {sessionLabel}
          </Text>

          <View style={styles.ctaRow}>
            <Pressable style={styles.secondaryCta} onPress={onOpenDashboard}>
              <Text style={styles.secondaryCtaText}>{ui.openPacks}</Text>
            </Pressable>
            {userEmail ? (
              <Pressable style={styles.primaryCta} onPress={onOpenConference}>
                <Text style={styles.primaryCtaText}>{ui.createRoom}</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.primaryCta} onPress={onOpenLogin}>
                <Text style={styles.primaryCtaText}>{ui.signIn}</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.tagsRow}>
            <Text style={styles.statusTag}>{ui.mobileFirst}</Text>
            <Text style={styles.statusTag}>{ui.realtime}</Text>
            <Text style={styles.statusTag}>{ui.fastRoomLink}</Text>
          </View>
        </View>

        <LandingAccordion
          title={ui.pricingTitle}
          description={ui.pricingDescription}
          isOpen={expanded.pricing}
          onToggle={() => toggleAccordion("pricing")}
          items={[]}
        >
          <Text style={styles.offerBody}>{ui.pricingBody}</Text>
          <Pressable style={styles.secondaryCta} onPress={onOpenDashboard}>
            <Text style={styles.secondaryCtaText}>{ui.openPacks}</Text>
          </Pressable>
        </LandingAccordion>

        {!userEmail ? (
          <View style={styles.loginCard}>
            <Text style={styles.loginTitle}>{ui.loginRequiredTitle}</Text>
            <Text style={styles.loginBody}>{ui.loginRequiredBody}</Text>
            <View style={styles.loginActions}>
              <Pressable style={styles.loginGhostButton} onPress={onOpenLogin}>
                <Text style={styles.loginGhostButtonText}>{ui.createAccount}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

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

        <View style={styles.footerRow}>
          <Pressable onPress={onOpenConference}>
            <Text style={styles.footerLink}>{ui.footerConference}</Text>
          </Pressable>
        </View>

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
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
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
  heroKicker: {
    color: "#7dd3fc",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.8,
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
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusTag: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 999,
    backgroundColor: "#0b1220",
    paddingHorizontal: 10,
    paddingVertical: 5,
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
  },
  loginCard: {
    borderWidth: 1,
    borderColor: "#312e81",
    borderRadius: 16,
    backgroundColor: "rgba(30,27,75,0.45)",
    padding: 13,
    gap: 8,
  },
  loginTitle: {
    color: "#e0e7ff",
    fontSize: 16,
    fontWeight: "800",
  },
  loginBody: {
    color: "#c7d2fe",
    fontSize: 13,
    lineHeight: 19,
  },
  loginActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  loginButton: {
    borderRadius: 12,
    backgroundColor: "#4f46e5",
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  loginButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  loginGhostButton: {
    borderWidth: 1,
    borderColor: "#6366f1",
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  loginGhostButtonText: {
    color: "#c7d2fe",
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
  footerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    paddingTop: 4,
  },
  footerLink: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
  },
  errorText: {
    color: "#fca5a5",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
  },
});
