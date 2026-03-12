import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { arrayRemove, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { auth } from "./firebase";
import { env } from "../config/env";

let notificationsConfigured = false;
export const MISSED_CALL_NOTIFICATION_TYPE = "missed_call";
export const MISSED_CALL_CATEGORY_ID = "bfzoom_missed_call";
export const MISSED_CALL_RECALL_ACTION_ID = "recall_audio";
export const INCOMING_CALL_NOTIFICATION_TYPE = "incoming_call";
export const INCOMING_CALL_CATEGORY_ID = "bfzoom_incoming_call";
export const INCOMING_CALL_ACCEPT_ACTION_ID = "incoming_call_accept";
export const INCOMING_CALL_DECLINE_ACTION_ID = "incoming_call_decline";

const getProjectId = () => {
  const expoExtra = (Constants.expoConfig?.extra || {}) as {
    eas?: { projectId?: string };
  };
  const fromExpoConfig = expoExtra.eas?.projectId || "";
  const fromEasConfig = ((Constants as unknown as { easConfig?: { projectId?: string } }).easConfig
    ?.projectId || "") as string;
  return (fromExpoConfig || fromEasConfig).trim();
};

export const initializeNotifications = () => {
  if (notificationsConfigured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  void Notifications.setNotificationCategoryAsync(MISSED_CALL_CATEGORY_ID, [
    {
      identifier: MISSED_CALL_RECALL_ACTION_ID,
      buttonTitle: "Rappeler audio",
      options: {
        opensAppToForeground: true,
      },
    },
  ]).catch(() => {});
  void Notifications.setNotificationCategoryAsync(INCOMING_CALL_CATEGORY_ID, [
    {
      identifier: INCOMING_CALL_ACCEPT_ACTION_ID,
      buttonTitle: "Répondre",
      options: {
        opensAppToForeground: true,
      },
    },
    {
      identifier: INCOMING_CALL_DECLINE_ACTION_ID,
      buttonTitle: "Refuser",
      options: {
        isDestructive: true,
      },
    },
  ]).catch(() => {});
  notificationsConfigured = true;
};

export const registerPushTokenForUser = async (userId: string) => {
  if (!db || !userId.trim()) return "";
  if (!Device.isDevice) return "";

  const current = await Notifications.getPermissionsAsync();
  let finalStatus = current.status;
  if (finalStatus !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }
  if (finalStatus !== "granted") return "";

  const projectId = getProjectId();
  const tokenResponse = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync();
  const token = tokenResponse.data?.trim() || "";
  if (!token) return "";

  const currentUser = auth?.currentUser;
  const bearerToken = currentUser ? await currentUser.getIdToken().catch(() => "") : "";
  const apiBaseUrl = env.apiBaseUrl.trim().replace(/\/+$/, "");

  if (apiBaseUrl && bearerToken) {
    const response = await fetch(`${apiBaseUrl}/api/notifications/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(raw || `Push token registration failed (${response.status}).`);
    }

    return token;
  }

  await setDoc(
    doc(db, "users", userId),
    {
      mobilePushTokens: [token],
      lastPushTokenAt: serverTimestamp(),
    },
    { merge: true }
  );
  return token;
};

export const unregisterPushTokenForUser = async (userId: string, token: string) => {
  if (!db) return;
  const cleanUserId = userId.trim();
  const cleanToken = token.trim();
  if (!cleanUserId || !cleanToken) return;

  await setDoc(
    doc(db, "users", cleanUserId),
    {
      mobilePushTokens: arrayRemove(cleanToken),
      lastPushTokenRemovedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const notifyLocalMessage = async ({
  title,
  body,
  data,
}: {
  title: string;
  body: string;
  data?: Record<string, string>;
}) => {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: "default",
    },
    trigger: null,
  });
};

export const notifyLocalMissedCall = async ({
  peerUserId,
  peerLabel,
  mode,
  callUUID,
}: {
  peerUserId: string;
  peerLabel: string;
  mode: "audio" | "video";
  callUUID: string;
}) => {
  const cleanPeerUserId = peerUserId.trim();
  if (!cleanPeerUserId) return;

  const cleanPeerLabel = peerLabel.trim() || "Contact";
  const cleanCallUUID = callUUID.trim().toLowerCase();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Appel manque · ${cleanPeerLabel}`,
      body:
        mode === "video"
          ? "Tu as un appel video manque. Appuie pour rappeler en audio."
          : "Tu as un appel audio manque. Appuie pour rappeler.",
      sound: "default",
      categoryIdentifier: MISSED_CALL_CATEGORY_ID,
      data: {
        type: MISSED_CALL_NOTIFICATION_TYPE,
        action: "recall_audio",
        peerUserId: cleanPeerUserId,
        peerLabel: cleanPeerLabel,
        mode,
        callUUID: cleanCallUUID,
      },
    },
    trigger: null,
  });
};

export const notifyLocalIncomingCall = async ({
  peerLabel,
  mode,
  chatId,
  roomId,
}: {
  peerLabel: string;
  mode: "audio" | "video";
  chatId?: string;
  roomId?: string;
}) => {
  const cleanPeerLabel = peerLabel.trim() || "Contact";
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Appel entrant · ${cleanPeerLabel}`,
      body: mode === "video" ? "Appel video entrant." : "Appel audio entrant.",
      sound: "default",
      data: {
        type: "incoming_call",
        chatId: (chatId || "").trim(),
        roomId: (roomId || "").trim(),
        mode,
      },
    },
    trigger: null,
  });
};
