import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { User } from "firebase/auth";
import { env } from "../config/env";
import { fetchLiveKitToken } from "../services/livekit";
import type { MobileCallSession } from "../types/session";

type CoachPracticeScreenProps = {
  user: User;
  onStart: (session: MobileCallSession) => void;
};

const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, "");
const randomRoomId = () => `coach-${Math.random().toString(36).slice(2, 10)}`;

export function CoachPracticeScreen({ user, onStart }: CoachPracticeScreenProps) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const handleStart = async () => {
    if (starting) return;
    setStarting(true);
    setError("");
    try {
      const apiBaseUrl = normalizeUrl(env.apiBaseUrl);
      const livekitUrl = normalizeUrl(env.livekitUrl);
      if (!apiBaseUrl || !livekitUrl) {
        throw new Error("Configuration service indisponible.");
      }

      const bearerToken = await user.getIdToken(true).catch(() => "");
      if (!bearerToken) {
        throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
      }

      const roomId = randomRoomId();
      const identity = user.uid ? `${user.uid}-coach` : `coach-${Date.now()}`;
      const displayName = user.email || "Coach IA";

      const auth = await fetchLiveKitToken({
        apiBaseUrl,
        payload: {
          room: roomId,
          identity,
          name: displayName,
          role: "guest",
          includeGuestTtsToken: true,
        },
        bearerToken,
      });

      onStart({
        apiBaseUrl,
        livekitUrl,
        roomId,
        role: "guest",
        identity,
        displayName,
        livekitToken: auth.token,
        bearerToken,
        guestTtsToken: auth.guestTtsToken,
        callMode: "audio",
        originModule: "coach",
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Démarrage impossible.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.kicker}>EXERCICE IA</Text>
        <Text style={styles.title}>Coach conversation IA</Text>
        <Text style={styles.subtitle}>
          Mode d'entraînement dédié (hors visioconférence), avec talkie, langues et réponses du partenaire IA.
        </Text>

        <Pressable
          style={[styles.buttonPrimary, starting && styles.buttonDisabled]}
          onPress={() => void handleStart()}
          disabled={starting}
        >
          {starting ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Démarrer l'exercice</Text>
          )}
        </Pressable>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#020617",
    padding: 14,
    justifyContent: "center",
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#0b1220",
    padding: 14,
    gap: 8,
  },
  kicker: {
    color: "#38bdf8",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: "#e2e8f0",
    fontSize: 20,
    fontWeight: "800",
  },
  subtitle: {
    color: "#cbd5e1",
    fontSize: 12,
    lineHeight: 18,
  },
  buttonPrimary: {
    marginTop: 4,
    borderRadius: 10,
    backgroundColor: "#0f766e",
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: "700",
  },
});
