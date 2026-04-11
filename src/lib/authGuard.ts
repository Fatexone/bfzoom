export const AUTH_GUARD_COOKIE = "bfz_auth";
export const AUTH_GUARD_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const AUTH_PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/videoconference",
  "/chat",
  "/practice",
] as const;

export const isProtectedPathname = (pathname: string) =>
  AUTH_PROTECTED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

export const setAuthGuardCookie = (authenticated: boolean) => {
  if (typeof document === "undefined") return;

  if (authenticated) {
    document.cookie = `${AUTH_GUARD_COOKIE}=1; Path=/; Max-Age=${AUTH_GUARD_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
    return;
  }

  document.cookie = `${AUTH_GUARD_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
};
