import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { onAuthStateChanged, signInWithCustomToken, signOut, type User } from "firebase/auth";
import { I18nProvider, LanguageSwitcher, useI18n } from "./src/i18n";
import { env } from "./src/config/env";
import { auth } from "./src/services/firebase";
import { CallScreen } from "./src/screens/CallScreen";
import { ConferenceLobbyScreen } from "./src/screens/ConferenceLobbyScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { LandingScreen } from "./src/screens/LandingScreen";
import { LoginOtpScreen } from "./src/screens/LoginOtpScreen";
import { PocketInterpreterScreen } from "./src/screens/PocketInterpreterScreen";
import type { MobileCallSession } from "./src/types/session";

type ActiveModule = "home" | "login" | "dashboard" | "conference" | "interpreter";
type AppTargetModule = Exclude<ActiveModule, "login">;

function AppShell() {
  const { language } = useI18n();
  const [session, setSession] = useState<MobileCallSession | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeModule, setActiveModule] = useState<ActiveModule>("home");
  const [loginTargetModule, setLoginTargetModule] = useState<Exclude<ActiveModule, "login">>(
    "dashboard"
  );
  const [conferenceCreateIntent, setConferenceCreateIntent] = useState(false);
  const [deepLinkJoinToken, setDeepLinkJoinToken] = useState("");
  const [deepLinkAutoJoinGuest, setDeepLinkAutoJoinGuest] = useState(false);
  const [dashboardGuestBootstrapPending, setDashboardGuestBootstrapPending] = useState(false);
  const [dashboardGuestBootstrapError, setDashboardGuestBootstrapError] = useState("");
  const [dashboardGuestBootstrapAttempt, setDashboardGuestBootstrapAttempt] = useState(0);
  const hasRegisteredUser = Boolean(currentUser?.email);
  const hasConferenceGuestAccess =
    Boolean(session?.role === "guest") ||
    deepLinkAutoJoinGuest ||
    Boolean(deepLinkJoinToken.trim());

  useEffect(() => {
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      console.log(
        `[BFZoom][auth] onAuthStateChanged hasUser=${Boolean(nextUser)} uid=${nextUser?.uid ?? "none"}`
      );
      setCurrentUser(nextUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    console.log(
      `[BFZoom][nav] activeModule=${activeModule} loginTarget=${loginTargetModule} hasUser=${Boolean(
        currentUser
      )} hasSession=${Boolean(session)}`
    );
  }, [activeModule, currentUser, loginTargetModule, session]);

  useEffect(() => {
    if (activeModule === "dashboard") return;
    if (activeModule !== "conference" && activeModule !== "interpreter") return;
    if (activeModule === "conference" && hasConferenceGuestAccess) return;
    if (hasRegisteredUser) return;
    setLoginTargetModule(activeModule);
    setActiveModule("login");
  }, [activeModule, hasConferenceGuestAccess, hasRegisteredUser]);

  useEffect(() => {
    const authInstance = auth;
    if (activeModule !== "dashboard" || currentUser || !authInstance) {
      setDashboardGuestBootstrapPending(false);
      if (currentUser || activeModule !== "dashboard") {
        setDashboardGuestBootstrapError("");
      }
      return;
    }
    let cancelled = false;
    setDashboardGuestBootstrapPending(true);
    setDashboardGuestBootstrapError("");
    const apiBaseUrl = env.apiBaseUrl.trim().replace(/\/+$/, "");
    if (!apiBaseUrl) {
      setDashboardGuestBootstrapPending(false);
      setDashboardGuestBootstrapError(
        language === "fr"
          ? "Impossible d'ouvrir les packs iPhone pour l'instant."
          : "Unable to open iPhone packs right now."
      );
      return;
    }
    void fetch(`${apiBaseUrl}/api/auth/guest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          token?: string;
          error?: string;
        };
        if (!response.ok || !payload.token) {
          throw new Error(payload.error || "Guest access unavailable.");
        }
        return signInWithCustomToken(authInstance, payload.token);
      })
      .catch((error) => {
        console.log(
          `[BFZoom][auth] anonymous_dashboard_bootstrap_failed=${
            error instanceof Error ? error.message : "unknown_error"
          }`
        );
        if (cancelled) return;
        setDashboardGuestBootstrapError(
          language === "fr"
            ? "L'ouverture des packs sans compte a échoué. Réessaie."
            : "Opening packs without an account failed. Please retry."
        );
      })
      .finally(() => {
        if (!cancelled) setDashboardGuestBootstrapPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeModule, currentUser, dashboardGuestBootstrapAttempt, language]);

  useEffect(() => {
    if (!session) return;
    if (currentUser || session.role === "guest") return;
    setSession(null);
    setActiveModule("home");
  }, [currentUser, session]);

  useEffect(() => {
    if (currentUser || !conferenceCreateIntent) return;
    setConferenceCreateIntent(false);
  }, [conferenceCreateIntent, currentUser]);

  const handleSessionLeave = useCallback(
    (
      endedSession: MobileCallSession,
      nextModule: AppTargetModule = "conference",
      leaveReason?: string
    ) => {
      setSession(null);
      setConferenceCreateIntent(false);
      setDeepLinkAutoJoinGuest(false);
      setDeepLinkJoinToken("");
      setActiveModule(currentUser ? nextModule : "home");

      if (endedSession.role !== "host") return;
      if (leaveReason === "host_room_ended") return;
      const apiBaseUrl = endedSession.apiBaseUrl.trim().replace(/\/+$/, "");
      const roomId = endedSession.roomId.trim();
      if (!apiBaseUrl || !roomId) return;

      void (async () => {
        const freshToken = auth?.currentUser ? await auth.currentUser.getIdToken().catch(() => "") : "";
        const bearerToken = (freshToken || endedSession.bearerToken || "").trim();
        if (!bearerToken) return;
        try {
          await fetch(`${apiBaseUrl}/api/livekit/room/end`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${bearerToken}`,
            },
            body: JSON.stringify({ room: roomId }),
          });
        } catch {}
      })();
    },
    [currentUser]
  );

  useEffect(() => {
    const parseAppTargetFromUrl = (value: string): AppTargetModule | null => {
      try {
        const url = new URL(value);
        const host = url.hostname.trim().toLowerCase();
        const firstSegment = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase() || "";
        const candidate = [host, firstSegment].find(
          (part) =>
            part === "home" ||
            part === "dashboard" ||
            part === "conference" ||
            part === "interpreter"
        );
        return candidate ? (candidate as AppTargetModule) : null;
      } catch {
        return null;
      }
    };

    const parseJoinTokenFromUrl = (value: string) => {
      const raw = value.trim();
      if (!raw) return "";

      try {
        const url = new URL(raw);
        const inviteQuery = (url.searchParams.get("invite") || "").trim();
        if (inviteQuery) return inviteQuery;

        const host = url.hostname.trim().toLowerCase();
        const segments = url.pathname.split("/").filter(Boolean);
        if (host === "join" && segments[0]) {
          return decodeURIComponent(segments[0]);
        }
        const joinIndex = segments.findIndex((segment) => segment === "join");
        if (joinIndex >= 0 && segments[joinIndex + 1]) {
          return decodeURIComponent(segments[joinIndex + 1]);
        }
      } catch {
        const match = raw.match(/\/join\/([^/?#]+)/i);
        if (match?.[1]) {
          return decodeURIComponent(match[1]);
        }
        const inviteQueryMatch = raw.match(/[?&]invite=([^&#]+)/i);
        if (inviteQueryMatch?.[1]) {
          return decodeURIComponent(inviteQueryMatch[1]);
        }
      }

      return "";
    };

    const handleDeepLink = (url: string) => {
      const joinToken = parseJoinTokenFromUrl(url);
      if (joinToken) {
        setDeepLinkJoinToken(joinToken);
        setDeepLinkAutoJoinGuest(true);
        setConferenceCreateIntent(false);
        setActiveModule("conference");
        return;
      }

      const targetModule = parseAppTargetFromUrl(url);
      if (targetModule) {
        setConferenceCreateIntent(false);
        setDeepLinkJoinToken("");
        setDeepLinkAutoJoinGuest(false);
        if (targetModule === "home") {
          setActiveModule("home");
          return;
        }
        if (targetModule === "dashboard") {
          setActiveModule("dashboard");
          return;
        }
        if (currentUser) {
          setActiveModule(targetModule);
        } else {
          setLoginTargetModule(targetModule);
          setActiveModule("login");
        }
        return;
      }
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
  }, [currentUser]);

  const tabItems = useMemo(() => {
    if (!hasRegisteredUser) {
      return [
        { id: "home" as const, label: language === "fr" ? "Accueil" : "Home" },
        { id: "dashboard" as const, label: language === "fr" ? "Packs" : "Packs" },
        { id: "login" as const, label: language === "fr" ? "Connexion" : "Sign in" },
      ];
    }

    return [
      { id: "home" as const, label: language === "fr" ? "Accueil" : "Home" },
      { id: "dashboard" as const, label: "Dashboard" },
      { id: "interpreter" as const, label: "Pocket" },
      { id: "conference" as const, label: language === "fr" ? "Visio" : "Call" },
    ];
  }, [hasRegisteredUser, language]);

  const renderModule = () => {
    switch (activeModule) {
      case "home":
        return (
          <LandingScreen
            onOpenLogin={() => {
              console.log("[BFZoom][nav] landing_onOpenLogin");
              setLoginTargetModule("dashboard");
              setActiveModule("login");
            }}
            onOpenDashboard={() => {
              console.log("[BFZoom][nav] landing_onOpenDashboard");
              setActiveModule("dashboard");
            }}
            onOpenConference={() => {
              console.log(`[BFZoom][nav] landing_onOpenConference hasUser=${Boolean(hasRegisteredUser)}`);
              if (hasRegisteredUser) {
                setConferenceCreateIntent(true);
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
            onContinueAsGuestForPacks={
              loginTargetModule === "dashboard"
                ? () => {
                    setActiveModule("dashboard");
                  }
                : undefined
            }
            onBack={() => setActiveModule("home")}
          />
        );
      case "dashboard":
        if (!currentUser) {
          return (
            <View style={styles.bootstrapCard}>
              {dashboardGuestBootstrapPending ? (
                <>
                  <ActivityIndicator size="small" color="#93c5fd" />
                  <Text style={styles.bootstrapText}>
                    {language === "fr"
                      ? "Ouverture des packs iPhone sans compte..."
                      : "Opening iPhone packs without an account..."}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.bootstrapText}>
                    {dashboardGuestBootstrapError ||
                      (language === "fr"
                        ? "Preparation des achats iPhone..."
                        : "Preparing iPhone purchases...")}
                  </Text>
                  <Pressable
                    style={[styles.bootstrapAction, styles.bootstrapPrimary]}
                    onPress={() => {
                      setDashboardGuestBootstrapAttempt((value) => value + 1);
                    }}
                  >
                    <Text style={styles.bootstrapActionText}>
                      {language === "fr" ? "Réessayer les packs" : "Retry packs"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.bootstrapAction, styles.bootstrapSecondary]}
                    onPress={() => {
                      setLoginTargetModule("dashboard");
                      setActiveModule("login");
                    }}
                  >
                    <Text style={styles.bootstrapSecondaryText}>
                      {language === "fr" ? "Se connecter à la place" : "Sign in instead"}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          );
        }
        return (
          <DashboardScreen
            user={currentUser}
            onOpenLogin={() => {
              setLoginTargetModule("dashboard");
              setActiveModule("login");
            }}
            onOpenInterpreter={() => {
              setActiveModule("interpreter");
            }}
            onOpenConference={() => {
              setConferenceCreateIntent(true);
              setDeepLinkJoinToken("");
              setDeepLinkAutoJoinGuest(false);
              setActiveModule("conference");
            }}
            onSignOut={() => {
              if (!auth) return;
              void signOut(auth).finally(() => {
                setSession(null);
                setConferenceCreateIntent(false);
                setActiveModule("home");
              });
            }}
          />
        );
      case "interpreter":
        if (!currentUser) {
          return (
            <LoginOtpScreen
              onLoggedIn={() => setActiveModule("interpreter")}
              onBack={() => setActiveModule("home")}
            />
          );
        }
        return (
          <PocketInterpreterScreen
            user={currentUser}
            onOpenDashboard={() => {
              setActiveModule("dashboard");
            }}
            onOpenConference={() => {
              setConferenceCreateIntent(true);
              setDeepLinkJoinToken("");
              setDeepLinkAutoJoinGuest(false);
              setActiveModule("conference");
            }}
          />
        );
      case "conference":
        if (!currentUser && !hasConferenceGuestAccess) {
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
            initialJoinToken={deepLinkJoinToken || undefined}
            autoJoinAsGuest={deepLinkAutoJoinGuest}
            onAutoJoinHandled={() => {
              setConferenceCreateIntent(false);
              setDeepLinkAutoJoinGuest(false);
              setDeepLinkJoinToken("");
            }}
            onNeedLogin={() => {
              setLoginTargetModule("conference");
              setActiveModule("login");
            }}
            onJoin={(nextSession) => {
              setConferenceCreateIntent(false);
              setDeepLinkAutoJoinGuest(false);
              setDeepLinkJoinToken("");
              setSession(nextSession);
            }}
          />
        );
      default:
        return null;
    }
  };

  if (session) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <CallScreen
          session={session}
          onLeave={(reason) => {
            handleSessionLeave(session, "conference", reason);
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.root}>
        <View style={styles.topBar}>
          <LanguageSwitcher compact />
        </View>
        <View style={styles.content}>{renderModule()}</View>
        <View style={styles.tabBar}>
          {tabItems.map((item) => {
            const selected = activeModule === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  console.log(`[BFZoom][nav] tab_press target=${item.id}`);
                  if (item.id === "login") {
                    setLoginTargetModule("dashboard");
                  }
                  if (item.id === "conference") {
                    setConferenceCreateIntent(false);
                  }
                  setActiveModule(item.id);
                }}
                style={[styles.tab, selected && styles.tabActive]}
              >
                <Text style={[styles.tabText, selected && styles.tabTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
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
  bootstrapCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
  },
  bootstrapText: {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  bootstrapAction: {
    minWidth: 220,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  bootstrapPrimary: {
    backgroundColor: "#2563eb",
  },
  bootstrapSecondary: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0b1220",
  },
  bootstrapActionText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "800",
  },
  bootstrapSecondaryText: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
  },
  topBar: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    alignItems: "flex-end",
    backgroundColor: "#020617",
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
