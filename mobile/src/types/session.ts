import type { LiveKitRole } from "./livekit";

export type MobileCallSession = {
  chatId?: string;
  apiBaseUrl: string;
  livekitUrl: string;
  roomId: string;
  role: LiveKitRole;
  identity: string;
  displayName: string;
  livekitToken: string;
  bearerToken?: string;
  guestTtsToken?: string;
  callMode?: "audio" | "video";
  originModule?: "conference" | "chat" | "coach";
};
