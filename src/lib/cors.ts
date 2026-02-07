const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.bfzoom.fr",
  "https://bfzoom.fr",
  "https://app.bfzoom.fr",
  "https://dev.bfzoom.fr",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
] as const;

const DEFAULT_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
const DEFAULT_HEADERS = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  "Accept",
];

const normalizeForSet = (value?: string | null) => {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return cleaned.replace(/\/$/, "").toLowerCase();
};

const extraOrigins = process.env.NEXT_PUBLIC_CORS_ORIGINS
  ? process.env.NEXT_PUBLIC_CORS_ORIGINS.split(",").map(normalizeForSet).filter(Boolean)
  : [];

const explicitAppOrigin = normalizeForSet(process.env.NEXT_PUBLIC_APP_URL);

const ALLOWED_ORIGINS_SET = new Set(
  [
    ...DEFAULT_ALLOWED_ORIGINS.map(normalizeForSet).filter(Boolean),
    explicitAppOrigin,
    ...extraOrigins,
  ].filter(Boolean)
);

const joinList = (items: string[]) => items.join(", ");

export const getAllowedOrigin = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = normalizeForSet(value);
  if (!normalized) return null;
  return ALLOWED_ORIGINS_SET.has(normalized) ? value.trim() : null;
};

const ensureVaryHasOrigin = (headers: Headers) => {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", "Origin");
    return;
  }
  const tokens = existing.split(",").map((token) => token.trim().toLowerCase());
  if (!tokens.includes("origin")) {
    headers.set("Vary", `${existing}, Origin`);
  }
};

export const addCorsHeaders = (headers: Headers, origin: string) => {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", joinList(DEFAULT_METHODS));
  headers.set("Access-Control-Allow-Headers", joinList(DEFAULT_HEADERS));
  headers.set("Access-Control-Allow-Credentials", "true");
  ensureVaryHasOrigin(headers);
};