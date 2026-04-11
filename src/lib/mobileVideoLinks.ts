import { isLivekitInviteId } from "@/lib/livekitInviteLinks";

const MAX_GUEST_NAME_LENGTH = 80;

const normalizeStoreUrl = (value: string | undefined) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
};

export const resolveMobileStoreUrls = () => ({
  ios: normalizeStoreUrl(process.env.NEXT_PUBLIC_IOS_APP_STORE_URL),
  android: normalizeStoreUrl(process.env.NEXT_PUBLIC_ANDROID_PLAY_STORE_URL),
});

export const detectMobileStorePlatform = () => {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android" as const;
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios" as const;
  const maybeNavigator = navigator as Navigator & { maxTouchPoints?: number };
  if (navigator.platform === "MacIntel" && (maybeNavigator.maxTouchPoints || 0) > 1) {
    return "ios" as const;
  }
  return null;
};

export const resolvePreferredMobileStoreUrl = () => {
  const stores = resolveMobileStoreUrls();
  const platform = detectMobileStorePlatform();
  if (platform === "ios") return stores.ios;
  if (platform === "android") return stores.android;
  return stores.ios || stores.android || "";
};

export const buildConferenceMobileAppHref = ({
  inviteId,
  guestName,
}: {
  inviteId?: string | null;
  guestName?: string | null;
} = {}) => {
  const normalizedInviteId = (inviteId || "").trim();
  if (normalizedInviteId && isLivekitInviteId(normalizedInviteId)) {
    const params = new URLSearchParams();
    const normalizedGuestName = (guestName || "").trim().slice(0, MAX_GUEST_NAME_LENGTH);
    if (normalizedGuestName) {
      params.set("guest", normalizedGuestName);
    }
    const query = params.toString();
    return `bfzoom://join/${encodeURIComponent(normalizedInviteId)}${
      query ? `?${query}` : ""
    }`;
  }
  return "bfzoom://conference";
};
