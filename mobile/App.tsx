import { StatusBar } from "expo-status-bar";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "./src/services/firebase";
import { CallScreen } from "./src/screens/CallScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ConferenceLobbyScreen } from "./src/screens/ConferenceLobbyScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { LandingScreen } from "./src/screens/LandingScreen";
import { LoginOtpScreen } from "./src/screens/LoginOtpScreen";
import { TrainingScreen } from "./src/screens/TrainingScreen";
import { env } from "./src/config/env";
import { fetchLiveKitToken } from "./src/services/livekit";
import { initializeNotifications, registerPushTokenForUser } from "./src/services/notifications";
import {
  createVoipCallBridge,
  isVoipCallNativeAvailable,
  type VoipCallBridge,
  type VoipCallIncomingPayload,
} from "./src/services/voipCall";
import type { LiveKitRole } from "./src/types/livekit";
import type { MobileCallSession } from "./src/types/session";

type AppModule = "home" | "login" | "dashboard" | "conference" | "training" | "chat";
const PROTECTED_MODULES: AppModule[] = ["dashboard", "conference", "training", "chat"];
const normalizeUrl = (value: string) => value.trim().replace(/\/+$/, "");
const randomIdentity = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const randomRoomId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
const parseConferenceLink = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsedUrl = new URL(trimmed);
    const scheme = parsedUrl.protocol.replace(":", "").toLowerCase();
    const host = parsedUrl.hostname.toLowerCase();
    const path = parsedUrl.pathname.toLowerCase();
    const hostAndPath = `${host}${path}`;
    const isJoinPath = path === "/join" || path.startsWith("/join/");
    const isConferenceLink =
      scheme === "bfzoom"
        ? hostAndPath.includes("videoconference")
        : path.startsWith("/videoconference") ||
          hostAndPath.includes("videoconference") ||
          isJoinPath;
    if (!isConferenceLink) return null;

    const roomFromQuery = (parsedUrl.searchParams.get("room") || "").trim();
    const roomFromJoinPath = isJoinPath
      ? decodeURIComponent(parsedUrl.pathname.split("/").filter(Boolean)[1] || "").trim()
      : "";
    const roomId = roomFromQuery || roomFromJoinPath;
    if (!roomId) return null;
    return {
      roomId,
      host: parsedUrl.searchParams.get("host") === "1",
    };
  } catch {
    const looksConference =
      /videoconference/i.test(trimmed) || /\/join\//i.test(trimmed) || /^bfzoom:\/\//i.test(trimmed);
    if (!looksConference) return null;
    const queryIndex = trimmed.indexOf("?");
    const query = queryIndex >= 0 ? trimmed.slice(queryIndex + 1) : "";
    const params = new URLSearchParams(query);
    const roomFromQuery = (params.get("room") || "").trim();
    const joinMatch = trimmed.match(/\/join\/([^/?#]+)/i);
    const roomFromJoinPath = joinMatch?.[1] ? decodeURIComponent(joinMatch[1]).trim() : "";
    const roomId = roomFromQuery || roomFromJoinPath;
    if (!roomId) return null;
    return {
      roomId,
      host: params.get("host") === "1",
    };
  }
};

export default function App() {
  const [session, setSession] = useState<MobileCallSession | null>(null);
  const [activeModule, setActiveModule] = useState<AppModule>("home");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loginTargetModule, setLoginTargetModule] = useState<AppModule>("dashboard");
  const [conferenceCreateIntent, setConferenceCreateIntent] = useState(false);
  const [activeVoipCallUUID, setActiveVoipCallUUID] = useState("");
  const [deepLinkRoomId, setDeepLinkRoomId] = useState("");
  const [deepLinkAutoJoinGuest, setDeepLinkAutoJoinGuest] = useState(false);

  const currentUserRef = useRef<User | null>(null);
  const sessionRef = useRef<MobileCallSession | null>(null);
  const activeVoipCallUUIDRef = useRef("");
  const voipBridgeRef = useRef<VoipCallBridge | null>(null);
  const lastHandledDeepLinkRef = useRef("");

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    activeVoipCallUUIDRef.current = activeVoipCallUUID;
  }, [activeVoipCallUUID]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const endActiveVoipCall = useCallback((reason = "ended") => {
    const callUUID = activeVoipCallUUIDRef.current;
    if (!callUUID) return;
    activeVoipCallUUIDRef.current = "";
    setActiveVoipCallUUID("");
    void voipBridgeRef.current?.endCall(callUUID, reason).catch(() => {});
  }, []);

  const registerVoipToken = useCallback(async (token: string) => {
    const voipToken = token.trim();
    const user = currentUserRef.current;
    if (!voipToken || !user) return;

    const bearerToken = await user.getIdToken().catch(() => "");
    if (!bearerToken) return;

    const apiBaseUrl = normalizeUrl(env.apiBaseUrl);
    if (!apiBaseUrl) return;

    try {
      const response = await fetch(`${apiBaseUrl}/api/voip/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          token: voipToken,
          platform: "ios",
        }),
      });

      if (response.status === 404 || response.status === 405) {
        return;
      }
      if (!response.ok) {
        throw new Error(`VoIP token registration failed (${response.status})`);
      }
    } catch (error) {
      console.warn(
        error instanceof Error
          ? error.message
          : "VoIP token registration failed."
      );
    }
  }, []);

  const joinFromVoipAnswer = useCallback(async (payload: VoipCallIncomingPayload) => {
    const roomId = payload.roomId.trim();
    if (!roomId) throw new Error("Incoming call payload missing roomId.");

    const role: LiveKitRole = payload.role === "host" ? "host" : "guest";
    const user = currentUserRef.current;
    const apiBaseUrl = normalizeUrl(payload.apiBaseUrl || env.apiBaseUrl);
    const livekitUrl = normalizeUrl(payload.livekitUrl || env.livekitUrl);
    if (!apiBaseUrl) throw new Error("Missing API base URL for incoming call.");
    if (!livekitUrl) throw new Error("Missing LiveKit URL for incoming call.");

    const identity =
      payload.identity?.trim() ||
      (user?.uid ? `${user.uid}-${role}` : randomIdentity(role));
    const displayName =
      payload.displayName?.trim() ||
      user?.email ||
      payload.callerName?.trim() ||
      "BFZoom Guest";
    const bearerToken =
      payload.bearerToken?.trim() ||
      (user ? await user.getIdToken().catch(() => "") : "");

    const livekitToken = await fetchLiveKitToken({
      apiBaseUrl,
      payload: {
        room: roomId,
        identity,
        name: displayName,
        role,
      },
      bearerToken,
    });

    const nextSession: MobileCallSession = {
      apiBaseUrl,
      livekitUrl,
      roomId,
      role,
      identity,
      displayName,
      livekitToken,
      bearerToken: bearerToken || undefined,
      callMode: payload.callMode || "audio",
      originModule: "conference",
    };

    setConferenceCreateIntent(false);
    setSession(nextSession);
    setActiveModule("conference");
    setActiveVoipCallUUID(payload.callUUID);
    activeVoipCallUUIDRef.current = payload.callUUID;
    void voipBridgeRef.current?.reportConnected(payload.callUUID).catch(() => {});
  }, []);

  const startChatCall = useCallback(
    async ({
      userId,
      label,
      mode,
    }: {
      userId: string;
      label?: string;
      mode: "audio" | "video";
    }) => {
      const targetUid = userId.trim();
      if (!targetUid) {
        throw new Error("Contact introuvable.");
      }

      const user = currentUserRef.current;
      if (!user) {
        setLoginTargetModule("chat");
        setActiveModule("login");
        throw new Error("Connecte-toi pour lancer un appel.");
      }

      const apiBaseUrl = normalizeUrl(env.apiBaseUrl);
      const livekitUrl = normalizeUrl(env.livekitUrl);
      if (!apiBaseUrl) {
        throw new Error("API BFZoom indisponible.");
      }
      if (!livekitUrl) {
        throw new Error("LiveKit URL manquante.");
      }

      const bearerToken = await user.getIdToken(true).catch(() => "");
      if (!bearerToken) {
        throw new Error("Session expirée. Reconnecte-toi.");
      }

      const roomId = randomRoomId("chat");
      const identity = user.uid ? `${user.uid}-caller` : randomIdentity("caller");
      const displayName = user.email || "BFZoom caller";
      const livekitToken = await fetchLiveKitToken({
        apiBaseUrl,
        payload: {
          room: roomId,
          identity,
          name: displayName,
          role: "guest",
        },
        bearerToken,
      });

      const nextSession: MobileCallSession = {
        apiBaseUrl,
        livekitUrl,
        roomId,
        role: "guest",
        identity,
        displayName,
        livekitToken,
        bearerToken,
        callMode: mode,
        originModule: "chat",
      };

      const callUUID = randomIdentity("call");
      const pushResponse = await fetch(`${apiBaseUrl}/api/voip/call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          targetUid,
          roomId,
          callerName: displayName,
          role: "guest",
          callMode: mode,
          callUUID,
          apiBaseUrl,
          livekitUrl,
        }),
      });

      if (!pushResponse.ok) {
        const raw = await pushResponse.text().catch(() => "");
        let detail = raw.trim();
        if (detail.startsWith("{")) {
          try {
            const parsed = JSON.parse(detail) as { error?: string; detail?: string };
            detail = (parsed.detail || parsed.error || "").trim() || detail;
          } catch {}
        }
        throw new Error(
          `Notification d'appel impossible (${pushResponse.status}). ${
            detail || `target=${label || targetUid}`
          }`
        );
      }

      setConferenceCreateIntent(false);
      setDeepLinkAutoJoinGuest(false);
      setDeepLinkRoomId("");
      setSession(nextSession);
      setActiveModule("chat");
    },
    []
  );

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    initializeNotifications();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    void registerPushTokenForUser(currentUser.uid).catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    const handleDeepLink = (url: string) => {
      if (!url) return;
      if (lastHandledDeepLinkRef.current === url) return;
      const parsed = parseConferenceLink(url);
      if (!parsed) return;

      lastHandledDeepLinkRef.current = url;
      setDeepLinkRoomId(parsed.roomId);
      // For shared links we always default to guest join to avoid host allowlist lock.
      setDeepLinkAutoJoinGuest(true);
      setConferenceCreateIntent(false);
      setLoginTargetModule("conference");
      setActiveModule(currentUserRef.current ? "conference" : "login");
    };

    void Linking.getInitialURL()
      .then((url) => {
        if (url) handleDeepLink(url);
      })
      .catch(() => {});

    const sub = Linking.addEventListener("url", ({ url }) => {
      handleDeepLink(url);
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!currentUser && PROTECTED_MODULES.includes(activeModule)) {
      setLoginTargetModule(activeModule);
      setActiveModule("login");
    }
  }, [activeModule, currentUser]);

  useEffect(() => {
    if (currentUser || !session) return;
    endActiveVoipCall("ended");
    setSession(null);
    setActiveModule("login");
  }, [currentUser, endActiveVoipCall, session]);

  useEffect(() => {
    if (!currentUser && conferenceCreateIntent) {
      setConferenceCreateIntent(false);
    }
  }, [conferenceCreateIntent, currentUser]);

  useEffect(() => {
    if (!isVoipCallNativeAvailable()) return;

    const bridge = createVoipCallBridge({
      onToken: (token) => {
        void registerVoipToken(token);
      },
      onCallAnswered: (payload) => {
        void joinFromVoipAnswer(payload).catch((error) => {
          void voipBridgeRef.current
            ?.endCall(payload.callUUID, "failed")
            .catch(() => {});
          console.warn(
            error instanceof Error
              ? error.message
              : "Unable to join room after CallKit answer."
          );
        });
      },
      onCallEnded: (payload) => {
        if (payload.callUUID !== activeVoipCallUUIDRef.current) return;
        activeVoipCallUUIDRef.current = "";
        setActiveVoipCallUUID("");
        setSession(null);
        if (!currentUserRef.current) {
          setActiveModule("login");
          return;
        }
        setActiveModule(sessionRef.current?.originModule || "conference");
      },
      onError: (message) => {
        console.warn(message);
      },
    });

    voipBridgeRef.current = bridge;
    void bridge.start().catch(() => {});
    return () => {
      bridge.dispose();
      voipBridgeRef.current = null;
    };
  }, [joinFromVoipAnswer, registerVoipToken]);

  useEffect(() => {
    if (!currentUser) return;
    const bridge = voipBridgeRef.current;
    if (!bridge) return;
    void bridge
      .getVoipToken()
      .then((token) => {
        if (token) {
          return registerVoipToken(token);
        }
      })
      .catch(() => {});
  }, [currentUser, registerVoipToken]);

  const tabItems = useMemo(() => {
    if (currentUser) {
      return [
        { id: "home" as AppModule, label: "Accueil" },
        { id: "dashboard" as AppModule, label: "Dashboard" },
        { id: "conference" as AppModule, label: "Conférence" },
        { id: "training" as AppModule, label: "Training" },
        { id: "chat" as AppModule, label: "Chat" },
      ];
    }
    return [
      { id: "home" as AppModule, label: "Accueil" },
      { id: "login" as AppModule, label: "Connexion" },
    ];
  }, [currentUser]);

  const renderModule = () => {
    switch (activeModule) {
      case "home":
        return (
          <LandingScreen
            onOpenLogin={() => {
              setLoginTargetModule("dashboard");
              setActiveModule("login");
            }}
            onOpenConference={() => {
              if (currentUser) {
                setActiveModule("conference");
                return;
              }
              setLoginTargetModule("conference");
              setActiveModule("login");
            }}
            onOpenTraining={() => {
              if (currentUser) {
                setActiveModule("training");
                return;
              }
              setLoginTargetModule("training");
              setActiveModule("login");
            }}
            onOpenChat={() => {
              if (currentUser) {
                setActiveModule("chat");
                return;
              }
              setLoginTargetModule("chat");
              setActiveModule("login");
            }}
          />
        );
      case "login":
        return (
          <LoginOtpScreen
            onLoggedIn={() => {
              setActiveModule(loginTargetModule);
            }}
            onBack={() => setActiveModule("home")}
          />
        );
      case "dashboard":
        if (!currentUser) {
          return (
            <LoginOtpScreen
              onLoggedIn={() => setActiveModule("dashboard")}
              onBack={() => setActiveModule("home")}
            />
          );
        }
        return (
          <DashboardScreen
            user={currentUser}
            onCreateRoom={() => {
              setConferenceCreateIntent(true);
              setActiveModule("conference");
            }}
            onTraining={() => setActiveModule("training")}
            onChat={() => setActiveModule("chat")}
            onSignOut={() => {
              if (!auth) return;
              void signOut(auth).finally(() => {
                setActiveModule("home");
              });
            }}
          />
        );
      case "conference":
        if (!currentUser) {
          return (
            <LoginOtpScreen
              onLoggedIn={() => setActiveModule("conference")}
              onBack={() => setActiveModule("home")}
            />
          );
        }
        return (
          <ConferenceLobbyScreen
            user={currentUser}
            defaultCreateHost={conferenceCreateIntent}
            initialRoomId={deepLinkRoomId || undefined}
            autoJoinAsGuest={deepLinkAutoJoinGuest}
            onAutoJoinHandled={() => {
              setDeepLinkAutoJoinGuest(false);
              setDeepLinkRoomId("");
            }}
            onNeedLogin={() => setActiveModule("login")}
            onJoin={(nextSession) => {
              setConferenceCreateIntent(false);
              setDeepLinkAutoJoinGuest(false);
              setDeepLinkRoomId("");
              setSession(nextSession);
            }}
          />
        );
      case "training":
        if (!currentUser) {
          return (
            <LoginOtpScreen
              onLoggedIn={() => setActiveModule("training")}
              onBack={() => setActiveModule("home")}
            />
          );
        }
        return <TrainingScreen />;
      case "chat":
        if (!currentUser) {
          return (
            <LoginOtpScreen
              onLoggedIn={() => setActiveModule("chat")}
              onBack={() => setActiveModule("home")}
            />
          );
        }
        return <ChatScreen onStartCall={startChatCall} />;
      default:
        return (
          <LandingScreen
            onOpenLogin={() => {
              setLoginTargetModule("dashboard");
              setActiveModule("login");
            }}
            onOpenConference={() => {
              if (currentUser) {
                setActiveModule("conference");
                return;
              }
              setLoginTargetModule("conference");
              setActiveModule("login");
            }}
            onOpenTraining={() => {
              if (currentUser) {
                setActiveModule("training");
                return;
              }
              setLoginTargetModule("training");
              setActiveModule("login");
            }}
            onOpenChat={() => {
              if (currentUser) {
                setActiveModule("chat");
                return;
              }
              setLoginTargetModule("chat");
              setActiveModule("login");
            }}
          />
        );
    }
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.root}>
          {session ? (
            <CallScreen
              session={session}
              onLeave={() => {
                endActiveVoipCall("ended");
                setSession(null);
                setActiveModule(session.originModule || "conference");
              }}
            />
          ) : (
            <>
              <View style={styles.content}>{renderModule()}</View>
              <View style={styles.tabBar}>
                {tabItems.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => setActiveModule(item.id)}
                    style={[styles.tab, activeModule === item.id && styles.tabActive]}
                  >
                    <Text style={[styles.tabText, activeModule === item.id && styles.tabTextActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#020617",
  },
  root: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#1e293b",
    backgroundColor: "#020617",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  tab: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tabActive: {
    borderColor: "#38bdf8",
    backgroundColor: "#082f49",
  },
  tabText: {
    color: "#cbd5e1",
    fontSize: 11,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#e2e8f0",
  },
});
