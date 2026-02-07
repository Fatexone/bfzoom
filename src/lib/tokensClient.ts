import { auth } from "@/lib/firebaseConfig";

type TokenUsePayload = {
  tokens?: number;
  type?: string;
  context?: string;
};

export async function consumeAiTokens(payload: TokenUsePayload) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Session expirée");
  }

  const idToken = await currentUser.getIdToken(true);
  const response = await fetch("/api/tokens/use", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error ?? "Tokens request failed");
  }

  return response.json();
}