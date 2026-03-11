import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { signInWithCustomToken } from "firebase/auth";
import { env } from "../config/env";
import { auth, db } from "../services/firebase";

const ACTIVE_SESSION_STORAGE_KEY = "bfzoom.activeSessionId";

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

export function LoginOtpScreen({ onLoggedIn, onBack }: LoginOtpScreenProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const normalizedApiBaseUrl = env.apiBaseUrl.trim().replace(/\/+$/, "");

  const formatNetworkError = (error: unknown) => {
    const rawMessage =
      error instanceof Error ? error.message : "Erreur réseau inconnue";
    if (!/network request failed/i.test(rawMessage)) {
      if (__DEV__) return `❌ Erreur : ${rawMessage}`;
      return "❌ Une erreur est survenue. Réessaie dans quelques secondes.";
    }
    if (__DEV__) {
      return (
        "❌ Impossible de joindre l'API. Vérifie que le backend tourne et que l'URL API est correcte " +
        `(${normalizedApiBaseUrl}).`
      );
    }
    return "❌ Impossible de joindre le service. Vérifie ta connexion puis réessaie.";
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
            : "Utilisateur",
        online: true,
      },
      { merge: true }
    );
  };

  const handleSendCode = async () => {
    if (!email.trim()) {
      setMessage("⚠️ Veuillez entrer un email valide.");
      return;
    }
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${normalizedApiBaseUrl}/api/auth/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = (await response.json()) as OtpSendResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Erreur d'envoi");
      }

      setStep("code");
      setMessage("✅ Code de vérification envoyé. Vérifie ta boîte mail.");
    } catch (error) {
      setMessage(formatNetworkError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!auth) {
      setMessage("❌ Firebase Auth n'est pas configuré.");
      return;
    }
    if (!email.trim() || !code.trim()) {
      setMessage("⚠️ Email et code requis.");
      return;
    }
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${normalizedApiBaseUrl}/api/auth/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      });
      const data = (await response.json()) as OtpVerifyResponse;
      if (!response.ok || !data.token) {
        throw new Error(data.error ?? "Code invalide ou expiré.");
      }

      const result = await signInWithCustomToken(auth, data.token);
      const cleanSessionId = (data.sessionId || "").trim();
      if (cleanSessionId) {
        await AsyncStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, cleanSessionId);
      } else {
        await AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
      }
      await upsertUser(result.user.uid, result.user.email);

      setMessage("✅ Identité vérifiée. Connexion réussie !");
      onLoggedIn();
    } catch (error) {
      setMessage(formatNetworkError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>🔑 Connexion</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Entre ton email..."
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
              <Text style={styles.primaryButtonText}>✉️ Envoyer le code</Text>
            )}
          </Pressable>
        ) : (
          <>
            <TextInput
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              placeholder="Code à 6 chiffres"
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
                <Text style={styles.darkButtonText}>✅ Valider le code</Text>
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
              <Text style={styles.ghostButtonText}>Modifier l’email</Text>
            </Pressable>
          </>
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Pressable onPress={onBack} disabled={loading} style={styles.backButton}>
          <Text style={styles.backButtonText}>Retour à l'accueil</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 16,
    backgroundColor: "#ffffff",
    padding: 16,
    gap: 10,
  },
  title: {
    color: "#0f172a",
    fontSize: 26,
    fontWeight: "800",
    marginBottom: 2,
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
