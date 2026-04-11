import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { signInWithCustomToken } from "firebase/auth";
import { useI18n } from "../i18n";
import { env } from "../config/env";
import { auth, db } from "../services/firebase";

const ACTIVE_SESSION_STORAGE_KEY = "bfzoom.activeSessionId";
const MOBILE_BRAND_ICON = require("../../assets/icon.png");

type LoginOtpScreenProps = {
  onLoggedIn: () => void;
  onBack: () => void;
};

type OtpSendResponse = {
  ok?: boolean;
  error?: string;
};

type OtpVerifyResponse = {
  token?: string;
  sessionId?: string;
  error?: string;
};

export function LoginOtpScreen({
  onLoggedIn,
  onBack,
}: LoginOtpScreenProps) {
  const { language } = useI18n();
  const codeInputRef = useRef<TextInput | null>(null);
  const driftPrimary = useRef(new Animated.Value(-24)).current;
  const driftSecondary = useRef(new Animated.Value(18)).current;
  const driftTertiary = useRef(new Animated.Value(-14)).current;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log("[BFZoom][auth] LoginOtpScreen mounted");
    return () => {
      console.log("[BFZoom][auth] LoginOtpScreen unmounted");
    };
  }, []);

  useEffect(() => {
    const animations = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(driftPrimary, {
            toValue: 28,
            duration: 18000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(driftPrimary, {
            toValue: -24,
            duration: 18000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(driftSecondary, {
            toValue: -18,
            duration: 22000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(driftSecondary, {
            toValue: 22,
            duration: 22000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      ),
      Animated.loop(
        Animated.sequence([
          Animated.timing(driftTertiary, {
            toValue: 20,
            duration: 20000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(driftTertiary, {
            toValue: -14,
            duration: 20000,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      ),
    ];

    animations.forEach((animation) => animation.start());
    return () => {
      animations.forEach((animation) => animation.stop());
    };
  }, [driftPrimary, driftSecondary, driftTertiary]);

  const ui = language === "fr"
    ? {
        networkUnknown: "Erreur réseau inconnue",
        genericRetry: "Une erreur est survenue. Réessaie dans quelques secondes.",
        apiReachability:
          "Impossible de joindre l'API. Vérifie que le backend tourne et que l'URL API est correcte",
        serviceUnavailable:
          "Impossible de joindre le service. Vérifie ta connexion puis réessaie.",
        defaultName: "Utilisateur",
        enterValidEmail: "⚠️ Veuillez entrer un email valide.",
        sendError: "Erreur d'envoi",
        codeSent: "✅ Code de vérification envoyé. Vérifie ta boîte mail.",
        authMissing: "❌ Firebase Auth n'est pas configuré.",
        emailAndCodeRequired: "⚠️ Email et code requis.",
        invalidCode: "Code invalide ou expiré.",
        loggedIn: "✅ Identité vérifiée. Connexion réussie !",
        title: "Connexion",
        subtitle:
          "Entre ton email. Si c'est ta premiere fois, ton compte BFZoom sera cree automatiquement apres verification du code.",
        backgroundLines: [
          "Bonjour / Hello / Hola / Oi / Ciao / Guten Tag / Merhaba",
          "Voix traduite / Sous-titres partages / Interpretation live / Temps reel",
          "Francais / English / Espanol / Portugues / Darija / Deutsch / Italiano / Arabic",
        ],
        emailPlaceholder: "Entre ton email...",
        sendCode: "Envoyer le code",
        codePlaceholder: "Code à 6 chiffres",
        verifyCode: "Valider le code",
        editEmail: "Modifier l'email",
        back: "Retour à l'accueil",
      }
    : {
        networkUnknown: "Unknown network error",
        genericRetry: "An error occurred. Try again in a few seconds.",
        apiReachability:
          "Unable to reach the API. Check that the backend is running and that the API URL is correct",
        serviceUnavailable:
          "Unable to reach the service. Check your connection and try again.",
        defaultName: "User",
        enterValidEmail: "Please enter a valid email address.",
        sendError: "Unable to send the code",
        codeSent: "Verification code sent. Check your inbox.",
        authMissing: "Firebase Auth is not configured.",
        emailAndCodeRequired: "Email and code are required.",
        invalidCode: "Invalid or expired code.",
        loggedIn: "Identity verified. Signed in successfully.",
        title: "Sign in",
        subtitle:
          "Enter your email. If this is your first time, your BFZoom account will be created automatically after code verification.",
        backgroundLines: [
          "Hello / Bonjour / Hola / Oi / Ciao / Guten Tag / Merhaba",
          "Translated voice / Shared captions / Live interpretation / Real time",
          "English / Francais / Espanol / Portugues / Darija / Deutsch / Italiano / Arabic",
        ],
        emailPlaceholder: "Enter your email...",
        sendCode: "Send code",
        codePlaceholder: "6-digit code",
        verifyCode: "Verify code",
        editEmail: "Edit email",
        back: "Back to home",
      };

  const normalizedApiBaseUrl = env.apiBaseUrl.trim().replace(/\/+$/, "");

  const formatNetworkError = (error: unknown) => {
    const rawMessage =
      error instanceof Error ? error.message : ui.networkUnknown;
    if (!/network request failed/i.test(rawMessage)) {
      if (__DEV__) return `❌ ${language === "fr" ? "Erreur" : "Error"}: ${rawMessage}`;
      return `❌ ${ui.genericRetry}`;
    }
    if (__DEV__) {
      return (
        `❌ ${ui.apiReachability} ` +
        `(${normalizedApiBaseUrl}).`
      );
    }
    return `❌ ${ui.serviceUnavailable}`;
  };

  const upsertUser = async (uid: string, userEmail: string | null) => {
    if (!db) return;
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    const normalizedEmail = (userEmail || "").trim().toLowerCase();
    await setDoc(
      userRef,
      {
        id: uid,
        email: normalizedEmail,
        emailLower: normalizedEmail,
        name:
          userSnap.exists() && typeof userSnap.data()?.name === "string"
            ? userSnap.data()?.name
            : ui.defaultName,
        online: true,
      },
      { merge: true }
    );
  };

  const handleSendCode = async () => {
    console.log(`[BFZoom][auth] handleSendCode email=${email.trim().toLowerCase()}`);
    if (!email.trim()) {
      setMessage(ui.enterValidEmail);
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${normalizedApiBaseUrl}/api/auth/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      console.log(`[BFZoom][auth] otp_send status=${response.status}`);

      const data = (await response.json()) as OtpSendResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? ui.sendError);
      }

      setStep("code");
      setMessage(`✅ ${ui.codeSent}`);
    } catch (error) {
      setMessage(formatNetworkError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!auth) {
      setMessage(`❌ ${ui.authMissing}`);
      return;
    }
    if (!email.trim() || !code.trim()) {
      setMessage(ui.emailAndCodeRequired);
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${normalizedApiBaseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          currentUid: auth.currentUser && !auth.currentUser.email ? auth.currentUser.uid : undefined,
        }),
      });
      console.log(`[BFZoom][auth] otp_verify status=${response.status}`);
      const data = (await response.json()) as OtpVerifyResponse;
      if (!response.ok || !data.token) {
        throw new Error(data.error ?? ui.invalidCode);
      }

      const result = await signInWithCustomToken(auth, data.token);
      console.log(`[BFZoom][auth] signInWithCustomToken uid=${result.user.uid}`);
      const cleanSessionId = (data.sessionId || "").trim();
      if (cleanSessionId) {
        await AsyncStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, cleanSessionId);
      } else {
        await AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      }
      await upsertUser(result.user.uid, result.user.email);

      setMessage(`✅ ${ui.loggedIn}`);
      console.log("[BFZoom][auth] onLoggedIn callback");
      onLoggedIn();
    } catch (error) {
      console.log(
        `[BFZoom][auth] auth_error=${error instanceof Error ? error.message : "unknown_error"}`
      );
      setMessage(formatNetworkError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View pointerEvents="none" style={styles.backgroundLayer}>
        <View style={styles.backgroundGlowTop} />
        <View style={styles.backgroundGlowBottom} />
        <Animated.Text
          style={[
            styles.subtitleRibbon,
            styles.subtitleRibbonTop,
            { transform: [{ rotate: "-10deg" }, { translateX: driftPrimary }] },
          ]}
        >
          {ui.backgroundLines[0]}
        </Animated.Text>
        <Animated.Text
          style={[
            styles.subtitleRibbon,
            styles.subtitleRibbonMiddle,
            { transform: [{ rotate: "-6deg" }, { translateX: driftSecondary }] },
          ]}
        >
          {ui.backgroundLines[1]}
        </Animated.Text>
        <Animated.Text
          style={[
            styles.subtitleRibbon,
            styles.subtitleRibbonBottom,
            { transform: [{ rotate: "-8deg" }, { translateX: driftTertiary }] },
          ]}
        >
          {ui.backgroundLines[2]}
        </Animated.Text>
      </View>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        contentInsetAdjustmentBehavior="always"
        keyboardShouldPersistTaps="always"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        showsVerticalScrollIndicator
      >
        <View style={styles.card}>
          <View style={styles.brandHeader}>
            <Image source={MOBILE_BRAND_ICON} style={styles.brandLogo} resizeMode="cover" />
            <View style={styles.brandTextBlock}>
              <Text style={styles.brand}>BFZoom</Text>
              <Text style={styles.brandHint}>by Beyond Frontiers</Text>
            </View>
          </View>
          <Text style={styles.title}>{ui.title}</Text>
          <Text style={styles.subtitle}>{ui.subtitle}</Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType={step === "email" ? "send" : "next"}
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (step === "email") {
                void handleSendCode();
                return;
              }
              codeInputRef.current?.focus();
            }}
            placeholder={ui.emailPlaceholder}
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />

          {step === "email" ? (
            <Pressable
              onPress={handleSendCode}
              disabled={loading}
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {language === "fr" ? "✉️ Envoyer le code" : "✉️ Send code"}
                </Text>
              )}
            </Pressable>
          ) : (
            <>
              <TextInput
                ref={codeInputRef}
                value={code}
                onChangeText={setCode}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                returnKeyType="done"
                onSubmitEditing={() => {
                  void handleVerifyCode();
                }}
                placeholder={ui.codePlaceholder}
                placeholderTextColor="#94a3b8"
                style={styles.input}
              />
              <Pressable
                onPress={handleVerifyCode}
                disabled={loading}
                style={[styles.darkButton, loading && styles.buttonDisabled]}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.darkButtonText}>
                    {language === "fr" ? "✅ Valider le code" : "✅ Verify code"}
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => {
                  setStep("email");
                  setCode("");
                  setMessage("");
                }}
                disabled={loading}
                style={styles.ghostButton}
              >
                <Text style={styles.ghostButtonText}>{ui.editEmail}</Text>
              </Pressable>
            </>
          )}

          {message ? <Text style={styles.message}>{message}</Text> : null}

          <Pressable onPress={onBack} disabled={loading} style={styles.backButton}>
            <Text style={styles.backButtonText}>{ui.back}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f4f7fb",
    paddingHorizontal: 16,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  backgroundGlowTop: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    top: -80,
    right: -60,
    backgroundColor: "rgba(56,189,248,0.14)",
  },
  backgroundGlowBottom: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    bottom: -110,
    left: -70,
    backgroundColor: "rgba(37,99,235,0.1)",
  },
  subtitleRibbon: {
    position: "absolute",
    left: -36,
    right: -36,
    color: "rgba(37,99,235,0.12)",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  subtitleRibbonTop: {
    top: 120,
  },
  subtitleRibbonMiddle: {
    top: 300,
    color: "rgba(15,23,42,0.08)",
  },
  subtitleRibbonBottom: {
    top: 520,
    color: "rgba(37,99,235,0.1)",
  },
  scrollContent: {
    flexGrow: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 48,
    paddingBottom: 32,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.94)",
    padding: 16,
    gap: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  brandHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 2,
  },
  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  brandTextBlock: {
    gap: 2,
  },
  brand: {
    color: "#081433",
    fontSize: 24,
    fontWeight: "900",
  },
  brandHint: {
    color: "#2563eb",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  title: {
    color: "#0f172a",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 2,
  },
  subtitle: {
    color: "#475569",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    color: "#0f172a",
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  primaryButton: {
    borderRadius: 10,
    backgroundColor: "#2563eb",
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  darkButton: {
    borderRadius: 10,
    backgroundColor: "#0f172a",
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  darkButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  ghostButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  ghostButtonText: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "600",
  },
  message: {
    color: "#334155",
    fontSize: 13,
    lineHeight: 19,
  },
  backButton: {
    marginTop: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  backButtonText: {
    color: "#475569",
    fontSize: 12,
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
