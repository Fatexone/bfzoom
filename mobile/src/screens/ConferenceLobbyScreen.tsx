import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { User } from "firebase/auth";
import { useI18n } from "../i18n";
import { env } from "../config/env";
import { fetchLiveKitToken, redeemLiveKitInvite } from "../services/livekit";
import type { MobileCallSession } from "../types/session";
import { extractLivekitInviteId } from "../utils/livekitInviteLinks";

type ConferenceLobbyScreenProps = {
  user: User | null;
  defaultCreateHost?: boolean;
  initialJoinToken?: string;
  autoJoinAsGuest?: boolean;
  onAutoJoinHandled?: () => void;
  onNeedLogin: () => void;
  onJoin: (session: MobileCallSession) => void;
};

type AllowlistStatus = "idle" | "loading" | "allowed" | "denied" | "error";
type LobbyAction = "create" | "joinGuest" | null;

const MOBILE_BRAND_ICON = require("../../assets/icon.png");

const buildRandomSuffix = () =>
  `${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
const generateRoomId = () => `room-${buildRandomSuffix()}`;
const buildIdentity = (prefix: string) => `${prefix}-${buildRandomSuffix()}`;
const sanitizeIdentityBase = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
const buildUserScopedIdentity = (prefix: string, userId?: string | null) => {
  const base = sanitizeIdentityBase(String(userId || ""));
  return base ? `${prefix}-${base}-${buildRandomSuffix()}` : buildIdentity(prefix);
};

const getReadableActionError = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message) return fallback;
  return message;
};

export function ConferenceLobbyScreen({
  user,
  defaultCreateHost = false,
  initialJoinToken,
  autoJoinAsGuest = false,
  onAutoJoinHandled,
  onNeedLogin,
  onJoin,
}: ConferenceLobbyScreenProps) {
  const { language } = useI18n();
  const [roomId, setRoomId] = useState("");
  const [allowlistStatus, setAllowlistStatus] = useState<AllowlistStatus>("idle");
  const [allowlistError, setAllowlistError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<LobbyAction>(null);
  const [actionError, setActionError] = useState("");
  const [manualJoinOpen, setManualJoinOpen] = useState(false);

  const ui = useMemo(
    () =>
      language === "fr"
        ? {
            hostStatusNeedLogin: "connecte-toi",
            hostStatusAllowed: "autorise",
            hostStatusLoading: "verification...",
            hostStatusDenied: "non autorise",
            hostStatusUnavailable: "indisponible",
            hostStatusPending: "en attente",
            mobileApiMissing: "Configuration API mobile absente.",
            verifyHostRightsFailed: "Impossible de verifier les droits pour le moment.",
            hostUnauthorized: "Ton compte n'est pas autorise a creer une room.",
            verifyRightsUnavailable: "Impossible de verifier tes droits pour le moment.",
            signInToHost: "Connecte-toi pour rejoindre en tant qu'hote.",
            checkingRights: "Verification des droits en cours...",
            serviceUnavailable: "Service indisponible temporairement. Reessaie dans quelques secondes.",
            actionUnavailable: "Action impossible pour le moment. Reessaie.",
            enterRoomCode: "Colle une invitation BFZoom valide.",
            autoJoinFailed: "Impossible de rejoindre l'invitation pour le moment.",
            brandSignature: "by Beyond Frontiers",
            title: "Rooms BFZoom",
            subtitle:
              "Cree une room si tu es hote. Les invites rejoignent ensuite en general directement via leur lien BFZoom.",
            hostAccess: "Acces hote",
            creating: "Creation...",
            createRoom: "Creer une room",
            joinRoom: "J'ai un lien d'invitation",
            joinRoomSummary: "Option de secours si le lien BFZoom ne s'ouvre pas automatiquement.",
            roomCode: "Invitation BFZoom",
            connecting: "Connexion...",
            joinAsGuest: "Ouvrir l'invitation",
            joinHint: "Colle un lien BFZoom ou un identifiant d'invitation commencant par inv_.",
          }
        : {
            hostStatusNeedLogin: "sign in",
            hostStatusAllowed: "allowed",
            hostStatusLoading: "checking...",
            hostStatusDenied: "not allowed",
            hostStatusUnavailable: "unavailable",
            hostStatusPending: "pending",
            mobileApiMissing: "Mobile API configuration is missing.",
            verifyHostRightsFailed: "Unable to verify host access right now.",
            hostUnauthorized: "Your account is not allowed to create a room.",
            verifyRightsUnavailable: "Unable to verify your access right now.",
            signInToHost: "Sign in to join as host.",
            checkingRights: "Checking access rights...",
            serviceUnavailable: "Service temporarily unavailable. Try again in a few seconds.",
            actionUnavailable: "Action unavailable right now. Try again.",
            enterRoomCode: "Paste a valid BFZoom invite.",
            autoJoinFailed: "Unable to join the invite right now.",
            brandSignature: "by Beyond Frontiers",
            title: "BFZoom rooms",
            subtitle:
              "Create a room if you are the host. Guests usually join directly from their BFZoom invite link.",
            hostAccess: "Host access",
            creating: "Creating...",
            createRoom: "Create a room",
            joinRoom: "I have an invite link",
            joinRoomSummary: "Fallback option if the BFZoom link does not open automatically.",
            roomCode: "BFZoom invite",
            connecting: "Connecting...",
            joinAsGuest: "Open invite",
            joinHint: "Paste a BFZoom link or an invite id starting with inv_.",
          },
    [language]
  );

  const autoCreateHostRef = useRef(false);
  const autoGuestJoinHandledRef = useRef(false);
  const actionInFlightRef = useRef(false);

  const normalizedApiBaseUrl = useMemo(
    () => env.apiBaseUrl.trim().replace(/\/+$/, ""),
    []
  );
  const normalizedLivekitUrl = useMemo(
    () => env.livekitUrl.trim().replace(/\/+$/, ""),
    []
  );

  const hostStatusLabel = useMemo(() => {
    if (!user) return ui.hostStatusNeedLogin;
    if (allowlistStatus === "allowed") return ui.hostStatusAllowed;
    if (allowlistStatus === "loading") return ui.hostStatusLoading;
    if (allowlistStatus === "denied") return ui.hostStatusDenied;
    if (allowlistStatus === "error") return ui.hostStatusUnavailable;
    return ui.hostStatusPending;
  }, [allowlistStatus, ui, user]);

  const hostStatusColorStyle = useMemo(() => {
    if (!user || allowlistStatus === "idle") return styles.statusValueMuted;
    if (allowlistStatus === "allowed") return styles.statusValueOk;
    if (allowlistStatus === "loading") return styles.statusValueWarn;
    if (allowlistStatus === "denied") return styles.statusValueBad;
    return styles.statusValueWarn;
  }, [allowlistStatus, user]);
  const hasInviteJoinContext = useMemo(() => {
    const candidate = (initialJoinToken || roomId).trim();
    return Boolean(extractLivekitInviteId(candidate));
  }, [initialJoinToken, roomId]);

  const checkAllowlist = useCallback(async () => {
    if (!user) {
      setAllowlistStatus("idle");
      setAllowlistError("");
      return;
    }
    if (!normalizedApiBaseUrl) {
      setAllowlistStatus("error");
      setAllowlistError(ui.mobileApiMissing);
      return;
    }
    setAllowlistStatus("loading");
    setAllowlistError("");
    try {
      const token = await user.getIdToken(true);
      const response = await fetch(`${normalizedApiBaseUrl}/api/auth/allowlist`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = (await response.json().catch(() => ({}))) as {
        allowed?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || ui.verifyHostRightsFailed);
      }
      if (data.allowed) {
        setAllowlistStatus("allowed");
      } else {
        setAllowlistStatus("denied");
        setAllowlistError(ui.hostUnauthorized);
      }
    } catch (error) {
      setAllowlistStatus("error");
      setAllowlistError(
        __DEV__ && error instanceof Error && error.message.trim()
          ? error.message
          : ui.verifyRightsUnavailable
      );
    }
  }, [normalizedApiBaseUrl, ui, user]);

  useEffect(() => {
    void checkAllowlist();
  }, [checkAllowlist]);

  const joinAsHost = useCallback(
    async (targetRoomId: string) => {
      if (!user) {
        onNeedLogin();
        throw new Error(ui.signInToHost);
      }
      if (allowlistStatus !== "allowed") {
        if (allowlistStatus === "loading") {
          throw new Error(ui.checkingRights);
        }
        throw new Error(allowlistError || ui.hostUnauthorized);
      }
      if (!normalizedApiBaseUrl || !normalizedLivekitUrl) {
        throw new Error(ui.serviceUnavailable);
      }

      const bearerToken = await user.getIdToken(true);
      const identity = buildUserScopedIdentity("host", user.uid);
      const displayName = user.email || "Host BFZoom";
      const livekitAuth = await fetchLiveKitToken({
        apiBaseUrl: normalizedApiBaseUrl,
        payload: {
          room: targetRoomId,
          identity,
          name: displayName,
          role: "host",
          includeGuestTtsToken: true,
        },
        bearerToken,
      });

      onJoin({
        apiBaseUrl: normalizedApiBaseUrl,
        livekitUrl: normalizedLivekitUrl,
        roomId: targetRoomId,
        role: "host",
        identity,
        displayName,
        livekitToken: livekitAuth.token,
        bearerToken,
        guestTtsToken: livekitAuth.guestTtsToken,
      });
    },
    [
      allowlistError,
      allowlistStatus,
      normalizedApiBaseUrl,
      normalizedLivekitUrl,
      onJoin,
      onNeedLogin,
      ui,
      user,
    ]
  );

  const joinAsGuestWithInvite = useCallback(
    async (inviteId: string) => {
      if (!normalizedApiBaseUrl || !normalizedLivekitUrl) {
        throw new Error(ui.serviceUnavailable);
      }
      const bearerToken = user ? await user.getIdToken().catch(() => "") : "";
      const identity = buildUserScopedIdentity("guest", user?.uid);
      const displayName = user?.email || "Guest BFZoom";
      const inviteAuth = await redeemLiveKitInvite({
        apiBaseUrl: normalizedApiBaseUrl,
        inviteId,
        identity,
        name: displayName,
        bearerToken,
      });

      onJoin({
        apiBaseUrl: normalizedApiBaseUrl,
        livekitUrl: normalizedLivekitUrl,
        roomId: inviteAuth.room,
        role: "guest",
        identity,
        displayName,
        livekitToken: inviteAuth.token,
        bearerToken: bearerToken || undefined,
        guestTtsToken: inviteAuth.guestTtsToken,
      });
    },
    [normalizedApiBaseUrl, normalizedLivekitUrl, onJoin, ui, user]
  );

  const runAction = useCallback(
    async (kind: Exclude<LobbyAction, null>, action: () => Promise<void>) => {
      if (actionInFlightRef.current) return;
      actionInFlightRef.current = true;
      setActionLoading(true);
      setActiveAction(kind);
      setActionError("");
      try {
        await action();
      } catch (error) {
        setActionError(getReadableActionError(error, ui.actionUnavailable));
      } finally {
        actionInFlightRef.current = false;
        setActionLoading(false);
        setActiveAction(null);
      }
    },
    [ui.actionUnavailable]
  );

  const handleCreateRoom = useCallback(
    () =>
      runAction("create", async () => {
        const nextRoomId = generateRoomId();
        setRoomId("");
        await joinAsHost(nextRoomId);
      }),
    [joinAsHost, runAction]
  );

  const handleJoinGuest = useCallback(
    () =>
      runAction("joinGuest", async () => {
        const inviteId = extractLivekitInviteId(roomId);
        if (!inviteId) throw new Error(ui.enterRoomCode);
        await joinAsGuestWithInvite(inviteId);
      }),
    [joinAsGuestWithInvite, roomId, runAction, ui.enterRoomCode]
  );

  useEffect(() => {
    if (!defaultCreateHost) return;
    if (autoJoinAsGuest || hasInviteJoinContext) return;
    if (autoCreateHostRef.current) return;
    if (allowlistStatus === "loading" || allowlistStatus === "idle") return;
    autoCreateHostRef.current = true;
    void handleCreateRoom();
  }, [allowlistStatus, autoJoinAsGuest, defaultCreateHost, handleCreateRoom, hasInviteJoinContext]);

  useEffect(() => {
    const normalizedInitialJoinToken = initialJoinToken?.trim() || "";
    if (!normalizedInitialJoinToken) return;
    setManualJoinOpen(true);
    setRoomId((current) =>
      current === normalizedInitialJoinToken ? current : normalizedInitialJoinToken
    );
  }, [initialJoinToken]);

  useEffect(() => {
    if (!autoJoinAsGuest) {
      autoGuestJoinHandledRef.current = false;
      actionInFlightRef.current = false;
      return;
    }
    if (actionLoading) return;

    const targetJoinToken = (initialJoinToken || roomId).trim();
    if (!targetJoinToken) return;
    if (autoGuestJoinHandledRef.current) return;
    const inviteId = extractLivekitInviteId(targetJoinToken);
    if (!inviteId) {
      autoGuestJoinHandledRef.current = true;
      setActionError(ui.enterRoomCode);
      onAutoJoinHandled?.();
      return;
    }

    autoGuestJoinHandledRef.current = true;
    actionInFlightRef.current = true;
    setActionLoading(true);
    setActiveAction("joinGuest");
    setActionError("");
    void joinAsGuestWithInvite(inviteId)
      .catch((error) => {
        setActionError(getReadableActionError(error, ui.autoJoinFailed));
      })
      .finally(() => {
        actionInFlightRef.current = false;
        setActionLoading(false);
        setActiveAction(null);
        onAutoJoinHandled?.();
      });
  }, [
    actionLoading,
    autoJoinAsGuest,
    initialJoinToken,
    joinAsGuestWithInvite,
    onAutoJoinHandled,
    roomId,
    ui,
  ]);

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <Image source={MOBILE_BRAND_ICON} style={styles.brandLogo} resizeMode="cover" alt="" />
          <View style={styles.brandTextBlock}>
            <Text style={styles.brand}>BFZoom</Text>
            <Text style={styles.brandHint}>{ui.brandSignature}</Text>
          </View>
        </View>
        <Text style={styles.title}>{ui.title}</Text>
        <Text style={styles.subtitle}>{ui.subtitle}</Text>

        <View style={styles.statusWrap}>
          <Text style={styles.statusLine}>
            {ui.hostAccess}: <Text style={[styles.statusValue, hostStatusColorStyle]}>{hostStatusLabel}</Text>
          </Text>
          {allowlistError ? <Text style={styles.statusError}>{allowlistError}</Text> : null}
        </View>

        <Pressable
          onPress={handleCreateRoom}
          disabled={actionLoading || allowlistStatus === "loading"}
          style={[styles.buttonPrimary, (actionLoading || allowlistStatus === "loading") && styles.buttonDisabled]}
        >
          <View style={styles.buttonContent}>
            {actionLoading && activeAction === "create" ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : null}
            <Text style={styles.buttonText}>
              {actionLoading && activeAction === "create" ? ui.creating : ui.createRoom}
            </Text>
          </View>
        </Pressable>

        <View style={styles.joinCard}>
          <Pressable
            style={styles.joinHeader}
            onPress={() => setManualJoinOpen((current) => !current)}
          >
            <View style={styles.joinHeaderTextBlock}>
              <Text style={styles.joinTitle}>{ui.joinRoom}</Text>
              <Text style={styles.joinSummary}>{ui.joinRoomSummary}</Text>
            </View>
            <Text style={styles.joinToggle}>{manualJoinOpen ? "−" : "+"}</Text>
          </Pressable>
          {manualJoinOpen ? (
            <View style={styles.joinBody}>
              <Text style={styles.label}>{ui.roomCode}</Text>
              <TextInput
                value={roomId}
                onChangeText={setRoomId}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://www.bfzoom.fr/join/inv_xxx"
                placeholderTextColor="#64748b"
                style={styles.input}
              />
              <Text style={styles.joinHint}>{ui.joinHint}</Text>

              <View style={styles.actions}>
                <Pressable
                  onPress={handleJoinGuest}
                  disabled={actionLoading}
                  style={[styles.buttonDark, actionLoading && styles.buttonDisabled]}
                >
                  <View style={styles.buttonContent}>
                    {actionLoading && activeAction === "joinGuest" ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : null}
                    <Text style={styles.buttonText}>
                      {actionLoading && activeAction === "joinGuest" ? ui.connecting : ui.joinAsGuest}
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 28,
    backgroundColor: "#020617",
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: "#1e293b",
    borderRadius: 16,
    backgroundColor: "#0b1220",
    padding: 14,
    gap: 12,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandLogo: {
    width: 42,
    height: 42,
    borderRadius: 12,
  },
  brandTextBlock: {
    gap: 2,
  },
  brand: {
    color: "#f8fafc",
    fontSize: 26,
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
  subtitle: {
    color: "#cbd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  statusWrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#0f172a",
    padding: 10,
    gap: 4,
  },
  statusLine: {
    color: "#cbd5e1",
    fontSize: 12,
  },
  statusValue: {
    fontWeight: "800",
  },
  statusValueMuted: {
    color: "#94a3b8",
  },
  statusValueOk: {
    color: "#86efac",
  },
  statusValueWarn: {
    color: "#fcd34d",
  },
  statusValueBad: {
    color: "#fca5a5",
  },
  statusError: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 17,
  },
  joinCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    backgroundColor: "#0f172a",
    padding: 12,
    gap: 10,
  },
  joinHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  joinHeaderTextBlock: {
    flex: 1,
    gap: 4,
  },
  joinTitle: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "800",
  },
  joinSummary: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 17,
  },
  joinToggle: {
    color: "#94a3b8",
    fontSize: 22,
    fontWeight: "500",
    lineHeight: 22,
  },
  joinBody: {
    gap: 10,
    paddingTop: 4,
  },
  label: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    backgroundColor: "#020617",
    color: "#e2e8f0",
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
  },
  joinHint: {
    color: "#94a3b8",
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    gap: 8,
  },
  buttonPrimary: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#38bdf8",
    backgroundColor: "#0c4a6e",
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDark: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  actionError: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 17,
  },
});
