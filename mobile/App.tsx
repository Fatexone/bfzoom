import { StatusBar } from "expo-status-bar";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, onSnapshot } from "firebase/firestore";
import { auth } from "./src/services/firebase";
import { db } from "./src/services/firebase";
import { CallScreen } from "./src/screens/CallScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ConferenceLobbyScreen } from "./src/screens/ConferenceLobbyScreen";
import { CoachPracticeScreen } from "./src/screens/CoachPracticeScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { LandingScreen } from "./src/screens/LandingScreen";
import { LoginOtpScreen } from "./src/screens/LoginOtpScreen";
import { env } from "./src/config/env";
import { fetchLiveKitToken } from "./src/services/livekit";
import {
  initializeNotifications,
  registerPushTokenForUser,
  unregisterPushTokenForUser,
} from "./src/services/notifications";
import {
  createVoipCallBridge,
  isVoipCallNativeAvailable,
  type VoipCallBridge,
  type VoipCallIncomingPayload,
} from "./src/services/voipCall";
import {
  endSignalCall,
  startSignalCall,
  subscribeIncomingSignalCalls,
} from "./src/services/callSignal";
import type { LiveKitRole } from "./src/types/livekit";
import type { MobileCallSession } from "./src/types/session";

const ACTIVE_SESSION_STORAGE_KEY = "bfzoom.activeSessionId";
const FORCED_LOGOUT_MESSAGE =
  "Votre compte a ete ouvert sur un autre appareil. Vous avez ete deconnecte de cette session.";

type AppModule = "home" | "login" | "dashboard" | "conference" | "coach" | "chat";
const PROTECTED_MODULES: AppModule[] = ["dashboard", "conference", "coach", "chat"];
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
  const [voipStatus, setVoipStatus] = useState<
    "checking" | "active" | "inactive" | "error" | "unsupported"
  >("checking");
  const [voipMessage, setVoipMessage] = useState("");
  const [pendingChatIdFromNotification, setPendingChatIdFromNotification] = useState("");

  const currentUserRef = useRef<User | null>(null);
  const sessionRef = useRef<MobileCallSession | null>(null);
  const activeVoipCallUUIDRef = useRef("");
  const voipBridgeRef = useRef<VoipCallBridge | null>(null);
  const lastHandledDeepLinkRef = useRef("");
  const lastAuthUidRef = useRef("");
  const activePushTokenRef = useRef("");
  const pushTokenOwnerUidRef = useRef("");

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

    const livekitAuth = await fetchLiveKitToken({
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
      livekitToken: livekitAuth.token,
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
      chatId,
      roomId,
      callUUID,
      skipRemoteNotify,
    }: {
      userId: string;
      label?: string;
      mode: "audio" | "video";
      chatId?: string;
      roomId?: string;
      callUUID?: string;
      skipRemoteNotify?: boolean;
    }) => {
      const targetUid = userId.trim();
      const normalizedChatId = (chatId || "").trim();
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

      const normalizedRoomId = (roomId || "").trim() || randomRoomId("chat");
      const identity = user.uid ? `${user.uid}-caller` : randomIdentity("caller");
      const displayName = user.email || "BFZoom caller";
      const livekitAuth = await fetchLiveKitToken({
        apiBaseUrl,
        payload: {
          room: normalizedRoomId,
          identity,
          name: displayName,
          role: "guest",
        },
        bearerToken,
      });

      const nextSession: MobileCallSession = {
        apiBaseUrl,
        livekitUrl,
        roomId: normalizedRoomId,
        chatId: normalizedChatId || undefined,
        role: "guest",
        identity,
        displayName,
        livekitToken: livekitAuth.token,
        bearerToken,
        callMode: mode,
        originModule: "chat",
      };

      const normalizedCallUUID = (callUUID || "").trim() || randomIdentity("call");

      if (!skipRemoteNotify && normalizedChatId) {
        await startSignalCall({
          chatId: normalizedChatId,
          roomId: normalizedRoomId,
          fromUserId: user.uid,
          targetUserId: targetUid,
          callMode: mode,
          callUUID: normalizedCallUUID,
        });
      }

      if (!skipRemoteNotify) {
        const pushResponse = await fetch(`${apiBaseUrl}/api/voip/call`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearerToken}`,
          },
          body: JSON.stringify({
            targetUid,
            roomId: normalizedRoomId,
            callerName: displayName,
            role: "guest",
            callMode: mode,
            callUUID: normalizedCallUUID,
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
          setVoipMessage(
            `Le destinataire n'a pas pu etre notifie (${pushResponse.status}). ${
              detail || `target=${label || targetUid}`
            }`
          );
        }
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
    const nextUid = currentUser?.uid || "";
    const prevUid = lastAuthUidRef.current;
    const currentToken = activePushTokenRef.current;

    if (prevUid && prevUid !== nextUid && currentToken) {
      void unregisterPushTokenForUser(prevUid, currentToken).catch(() => {});
      activePushTokenRef.current = "";
      pushTokenOwnerUidRef.current = "";
    }

    lastAuthUidRef.current = nextUid;

    if (!nextUid) return;

    void registerPushTokenForUser(nextUid)
      .then((token) => {
        const cleanToken = token.trim();
        if (!cleanToken) return;
        activePushTokenRef.current = cleanToken;
        pushTokenOwnerUidRef.current = nextUid;
      })
      .catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    const openChatFromNotificationData = (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const payload = data as Record<string, unknown>;
      const type = typeof payload.type === "string" ? payload.type.trim() : "";
      if (type !== "chat_message") return;
      const chatId = typeof payload.chatId === "string" ? payload.chatId.trim() : "";
      if (!chatId) return;

      setPendingChatIdFromNotification(chatId);
      if (currentUserRef.current) {
        setActiveModule("chat");
        return;
      }
      setLoginTargetModule("chat");
      setActiveModule("login");
    };

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const data = response?.notification?.request?.content?.data;
        openChatFromNotificationData(data);
      })
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      openChatFromNotificationData(data);
    });

    return () => {
      subscription.remove();
    };
  }, []);

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
    if (!currentUser) return;

    const unsubscribe = subscribeIncomingSignalCalls({
      userId: currentUser.uid,
      onIncoming: (incoming) => {
        if (!incoming) return;
        if (sessionRef.current) return;

        setPendingChatIdFromNotification(incoming.chatId);
        setActiveModule("chat");
      },
    });

    return () => unsubscribe();
  }, [currentUser]);

  useEffect(() => {
    if (!isVoipCallNativeAvailable()) {
      setVoipStatus("unsupported");
      setVoipMessage("Bridge VoIP natif indisponible sur cet appareil.");
      return;
    }

    setVoipStatus("checking");
    setVoipMessage("");

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
        setVoipStatus("error");
        setVoipMessage(message || "Erreur bridge VoIP.");
        console.warn(message);
      },
    });

    voipBridgeRef.current = bridge;
    void bridge
      .start()
      .then(() => {
        setVoipStatus("active");
        setVoipMessage("");
      })
      .catch((error) => {
        setVoipStatus("error");
        setVoipMessage(error instanceof Error ? error.message : "Impossible d'activer la VoIP.");
      });
    return () => {
      bridge.dispose();
      voipBridgeRef.current = null;
      setVoipStatus("inactive");
    };
  }, [joinFromVoipAnswer, registerVoipToken]);

  useEffect(() => {
    if (!currentUser) return;
    const bridge = voipBridgeRef.current;
    if (!bridge) return;
    void bridge
      .getVoipToken()
      .then((token) => {
        if (!token) return Promise.resolve();
        return registerVoipToken(token);
      })
      .catch(() => {});
  }, [currentUser, registerVoipToken]);

  useEffect(() => {
    if (!currentUser || !db || !auth) return;

    let handledMismatch = false;
    const userRef = doc(db, "users", currentUser.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        void (async () => {
          const remoteSessionId =
            typeof snapshot.data()?.activeSessionId === "string"
              ? snapshot.data()?.activeSessionId.trim()
              : "";
          if (!remoteSessionId) return;

          const localSessionId = (await AsyncStorage.getItem(ACTIVE_SESSION_STORAGE_KEY))?.trim() || "";

          // Backward compatibility for users already connected before the session guard.
          if (!localSessionId) {
            await AsyncStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, remoteSessionId);
            return;
          }

          if (!handledMismatch && localSessionId !== remoteSessionId) {
            handledMismatch = true;
            await AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY).catch(() => {});
            Alert.alert("Session fermee", FORCED_LOGOUT_MESSAGE);
            const authInstance = auth;
            if (authInstance) {
              await signOut(authInstance).catch(() => {});
            }
          }
        })();
      },
      () => {}
    );

    return () => unsubscribe();
  }, [currentUser]);

  const tabItems = useMemo(() => {
    if (currentUser) {
      return [
        { id: "home" as AppModule, label: "Accueil" },
        { id: "dashboard" as AppModule, label: "Dashboard" },
        { id: "conference" as AppModule, label: "Conférence" },
        { id: "coach" as AppModule, label: "Exercice IA" },
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
            voipStatus={voipStatus}
            voipMessage={voipMessage}
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
      case "coach":
        if (!currentUser) {
          return (
            <LoginOtpScreen
              onLoggedIn={() => setActiveModule("coach")}
              onBack={() => setActiveModule("home")}
            />
          );
        }
        return (
          <CoachPracticeScreen
            user={currentUser}
            onStart={(nextSession) => {
              setSession(nextSession);
              setActiveModule("coach");
            }}
          />
        );
      case "chat":
        if (!currentUser) {
          return (
            <LoginOtpScreen
              onLoggedIn={() => setActiveModule("chat")}
              onBack={() => setActiveModule("home")}
            />
          );
        }
        return (
          <ChatScreen
            onStartCall={startChatCall}
            initialSelectedChatId={pendingChatIdFromNotification || undefined}
            onInitialSelectedChatIdHandled={() => setPendingChatIdFromNotification("")}
          />
        );
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
                if (session.originModule === "chat" && session.chatId && currentUserRef.current?.uid) {
                  void endSignalCall({
                    chatId: session.chatId,
                    endedBy: currentUserRef.current.uid,
                    reason: "ended",
                  });
                }
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
