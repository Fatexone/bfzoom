export type MobileCreditsReturnTarget = "dashboard" | "conference" | "interpreter";

const resolveWebBaseUrl = (apiBaseUrl: string) => {
  const base = (apiBaseUrl || "").trim();
  if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0)/i.test(base)) {
    return "https://www.bfzoom.fr";
  }
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return base.replace(/\/+$/, "");
  }
  return "https://www.bfzoom.fr";
};

export const buildMobileCreditsWebUrl = ({
  apiBaseUrl,
  mobileReturn,
  prefillEmail,
}: {
  apiBaseUrl: string;
  mobileReturn: MobileCreditsReturnTarget;
  prefillEmail?: string | null;
}) => {
  const baseUrl = resolveWebBaseUrl(apiBaseUrl);
  const params = new URLSearchParams();
  params.set("mobileReturn", mobileReturn);
  const safeEmail = (prefillEmail || "").trim();
  if (safeEmail) {
    params.set("prefillEmail", safeEmail);
  }
  return `${baseUrl}/credits?${params.toString()}`;
};
