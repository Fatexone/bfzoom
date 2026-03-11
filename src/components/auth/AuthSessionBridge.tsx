"use client";

import { useEffect } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebaseConfig";
import { setAuthGuardCookie } from "@/lib/authGuard";

const ACTIVE_SESSION_STORAGE_KEY = "bfzoom.activeSessionId";
const FORCED_LOGOUT_MESSAGE =
  "Votre compte a ete ouvert sur un autre appareil. Vous avez ete deconnecte de cette session.";

export default function AuthSessionBridge() {
  useEffect(() => {
    let unsubscribeSession: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthGuardCookie(Boolean(user));

      if (unsubscribeSession) {
        unsubscribeSession();
        unsubscribeSession = null;
      }

      if (!user) return;

      unsubscribeSession = onSnapshot(
        doc(db, "users", user.uid),
        async (snapshot) => {
          const remoteSessionId =
            typeof snapshot.data()?.activeSessionId === "string"
              ? snapshot.data()?.activeSessionId.trim()
              : "";
          if (!remoteSessionId) return;

          const localSessionId =
            typeof window !== "undefined"
              ? (window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY) || "").trim()
              : "";

          // Backward compatibility: hydrate local session id for already-connected users.
          if (!localSessionId) {
            if (typeof window !== "undefined") {
              window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, remoteSessionId);
            }
            return;
          }

          if (localSessionId !== remoteSessionId) {
            if (typeof window !== "undefined") {
              window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
              window.setTimeout(() => {
                window.alert(FORCED_LOGOUT_MESSAGE);
              }, 0);
            }
            await signOut(auth).catch(() => {});
          }
        },
        () => {}
      );
    });

    return () => {
      if (unsubscribeSession) {
        unsubscribeSession();
      }
      unsubscribe();
    };
  }, []);

  return null;
}
