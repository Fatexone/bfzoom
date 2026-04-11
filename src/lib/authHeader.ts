import { auth } from "@/lib/firebaseConfig";

type GetAuthHeaderOptions = {
  forceRefresh?: boolean;
};

export async function getAuthHeader(
  options?: GetAuthHeaderOptions
): Promise<Record<string, string>> {
  if (typeof auth.authStateReady === "function") {
    await auth.authStateReady().catch(() => undefined);
  }
  const token = await auth.currentUser?.getIdToken(Boolean(options?.forceRefresh));
  return token ? { Authorization: `Bearer ${token}` } : {};
}
