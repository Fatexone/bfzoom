const normalizeEmail = (value: string) => value.trim().toLowerCase();

const isReviewBypassEnabled = () =>
  (process.env.BFZOOM_ENABLE_APP_REVIEW_BYPASS || "").trim() === "1";

const parseReviewEmails = () =>
  (process.env.BFZOOM_APP_REVIEW_EMAILS || process.env.APPLE_REVIEW_EMAILS || "")
    .split(/[,\s;]+/)
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);

export const isAppReviewEmail = (email: string) => {
  if (!isReviewBypassEnabled()) return false;
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return parseReviewEmails().includes(normalized);
};

export const getAppReviewOtpCode = () =>
  isReviewBypassEnabled()
    ? (process.env.BFZOOM_APP_REVIEW_OTP_CODE || process.env.APPLE_REVIEW_OTP_CODE || "").trim()
    : "";
