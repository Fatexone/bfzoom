const INVITE_ID_PATTERN = /^inv_[A-Za-z0-9_-]{8,}$/i;
const DEFAULT_PUBLIC_APP_URL = "https://www.bfzoom.fr";

export const isLivekitInviteId = (value: string) => INVITE_ID_PATTERN.test(value.trim());

export const extractLivekitInviteId = (value: string) => {
  const raw = value.trim();
  if (!raw) return "";
  if (isLivekitInviteId(raw)) return raw;

  try {
    const url = new URL(raw);
    const inviteQuery = (url.searchParams.get("invite") || "").trim();
    if (isLivekitInviteId(inviteQuery)) return inviteQuery;

    const segments = url.pathname.split("/").filter(Boolean);
    const joinIndex = segments.findIndex((segment) => segment === "join");
    const joinToken =
      joinIndex >= 0 && segments[joinIndex + 1]
        ? decodeURIComponent(segments[joinIndex + 1]).trim()
        : "";
    return isLivekitInviteId(joinToken) ? joinToken : "";
  } catch {
    const pathMatch = raw.match(/\/join\/([^/?#]+)/i);
    const pathToken = pathMatch?.[1] ? decodeURIComponent(pathMatch[1]).trim() : "";
    if (isLivekitInviteId(pathToken)) return pathToken;

    const queryMatch = raw.match(/[?&]invite=([^&#]+)/i);
    const queryToken = queryMatch?.[1] ? decodeURIComponent(queryMatch[1]).trim() : "";
    return isLivekitInviteId(queryToken) ? queryToken : "";
  }
};

export const buildCanonicalLivekitInviteUrl = (
  inviteId: string,
  publicAppBaseUrl = DEFAULT_PUBLIC_APP_URL
) => {
  const normalizedInviteId = inviteId.trim();
  if (!isLivekitInviteId(normalizedInviteId)) return "";
  return `${publicAppBaseUrl.replace(/\/+$/, "")}/join/${encodeURIComponent(normalizedInviteId)}`;
};
