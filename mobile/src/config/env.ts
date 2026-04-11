import { NativeModules } from "react-native";

const trimSlash = (value: string) => value.replace(/\/+$/, "");

const defaultApiBaseUrl = "http://localhost:3000";
const defaultPublicApiBaseUrl = "https://www.bfzoom.fr";
const defaultPublicJoinBaseUrl = "https://www.bfzoom.fr";
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

const isPrivateIpv4Host = (host: string) => {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
  return false;
};

const parseBaseUrl = (value: string) => {
  const match = value.match(/^(https?:\/\/)([^/:]+)(:\d+)?(\/.*)?$/i);
  if (!match) return null;
  return {
    protocol: match[1],
    host: match[2],
    port: match[3] ?? "",
    path: match[4] ?? "",
  };
};

const getMetroHost = () => {
  const scriptUrl = (NativeModules.SourceCode?.scriptURL as string | undefined) ?? "";
  const match = scriptUrl.match(/^https?:\/\/([^/:]+)(:\d+)?\//i);
  return match?.[1] ?? "";
};

const resolveApiBaseUrl = (rawUrl: string) => {
  const normalized = trimSlash(rawUrl);
  const parsed = parseBaseUrl(normalized);
  if (!parsed) return normalized;

  const shouldFollowMetroHost = localHosts.has(parsed.host) || isPrivateIpv4Host(parsed.host);
  if (!shouldFollowMetroHost) return normalized;

  const metroHost = getMetroHost();
  if (!metroHost || localHosts.has(metroHost)) {
    // Production/TestFlight has no Metro host; never keep localhost there.
    return defaultPublicApiBaseUrl;
  }

  return trimSlash(`${parsed.protocol}${metroHost}${parsed.port}${parsed.path}`);
};

const resolvePublicJoinBaseUrl = (rawUrl: string) => {
  const normalized = trimSlash(rawUrl || defaultPublicJoinBaseUrl);
  const parsed = parseBaseUrl(normalized);
  if (!parsed) return defaultPublicJoinBaseUrl;
  if (localHosts.has(parsed.host) || isPrivateIpv4Host(parsed.host)) {
    return defaultPublicJoinBaseUrl;
  }
  return normalized;
};

export const env = {
  apiBaseUrl: resolveApiBaseUrl(
    (process.env.EXPO_PUBLIC_API_BASE_URL || defaultApiBaseUrl).trim()
  ),
  publicJoinBaseUrl: resolvePublicJoinBaseUrl(
    (process.env.EXPO_PUBLIC_JOIN_BASE_URL || defaultPublicJoinBaseUrl).trim()
  ),
  livekitUrl: trimSlash((process.env.EXPO_PUBLIC_LIVEKIT_URL || "").trim()),
  realtimeUrl: trimSlash((process.env.EXPO_PUBLIC_REALTIME_URL || "").trim()),
  firebase: {
    apiKey: (process.env.EXPO_PUBLIC_FIREBASE_API_KEY || "").trim(),
    authDomain: (process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || "").trim(),
    projectId: (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || "").trim(),
    storageBucket: (process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || "").trim(),
    messagingSenderId: (
      process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || ""
    ).trim(),
    appId: (process.env.EXPO_PUBLIC_FIREBASE_APP_ID || "").trim(),
    measurementId: (process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID || "").trim(),
  },
};
