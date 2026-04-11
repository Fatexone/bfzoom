export type RoomAccessMode = "allowlist" | "authenticated";

const normalizeRoomAccessMode = (value?: string | null): RoomAccessMode => {
  const normalized = (value || "authenticated").trim().toLowerCase();
  if (normalized === "allowlist") {
    return "allowlist";
  }
  return "authenticated";
};

export const getRoomAccessMode = (): RoomAccessMode =>
  normalizeRoomAccessMode(process.env.BFZOOM_ROOM_ACCESS_MODE);

export const canUseRoomFeatures = (_allowlisted: boolean) => {
  // BFZoom now keeps room creation/calls available for authenticated users.
  // Translation availability is enforced separately by minutes/premium entitlement.
  return true;
};
