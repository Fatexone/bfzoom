import { auth } from "@/lib/firebaseConfig";
import type { CreditPackId, MobileReturnTarget } from "@/lib/creditPacks";

type StartCreditsCheckoutOptions = {
  pack: CreditPackId;
  returnTo?: string | null;
  mobileReturn?: MobileReturnTarget | null;
};

export async function startCreditsCheckout({
  pack,
  returnTo,
  mobileReturn,
}: StartCreditsCheckoutOptions) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("login_required");
  }

  const idToken = await currentUser.getIdToken(true);
  const response = await fetch("/api/stripe/tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ pack, returnTo, mobileReturn }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };

  if (!response.ok || !data.url) {
    throw new Error(data.error ?? "checkout_error");
  }

  return data.url;
}
