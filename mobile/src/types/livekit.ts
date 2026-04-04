export type LiveKitRole = "host" | "guest";

export type LiveKitTokenRequest = {
  room: string;
  identity: string;
  name?: string;
  role: LiveKitRole;
  includeGuestTtsToken?: boolean;
};
