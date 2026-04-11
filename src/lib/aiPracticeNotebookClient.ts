"use client";

import { getAuthHeader } from "@/lib/authHeader";
import {
  AI_PRACTICE_NOTEBOOK_OPEN_EVENT,
  AI_PRACTICE_NOTEBOOK_UPDATED_EVENT,
  buildAiPracticeNotebookFingerprint,
  type AiPracticeNotebookEntry,
  type AiPracticeNotebookSaveInput,
} from "@/lib/aiPracticeNotebook";

const savedFingerprints = new Set<string>();

const readJson = async (response: Response) => response.json().catch(() => ({}));

const readApiError = async (response: Response) => {
  const payload = await readJson(response);
  return String(payload?.error || "Action impossible pour le moment.");
};

const toFriendlyNotebookClientError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : "";
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Connexion carnet impossible. Recharge la page et reessaie.";
  }
  if (/unauthorized|401/i.test(message)) {
    return "Session expiree. Reconnecte-toi puis reessaie.";
  }
  return message || fallback;
};

export const emitAiPracticeNotebookUpdated = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AI_PRACTICE_NOTEBOOK_UPDATED_EVENT));
};

export const emitAiPracticeNotebookOpen = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AI_PRACTICE_NOTEBOOK_OPEN_EVENT));
};

export const isAiPracticeNotebookFingerprintSaved = (fingerprint: string) =>
  Boolean(fingerprint) && savedFingerprints.has(fingerprint);

export const markAiPracticeNotebookFingerprintSaved = (fingerprint: string) => {
  if (!fingerprint) return;
  savedFingerprints.add(fingerprint);
};

export const clearAiPracticeNotebookFingerprintSaved = (fingerprint: string) => {
  if (!fingerprint) return;
  savedFingerprints.delete(fingerprint);
};

export async function listAiPracticeNotebookEntries(limit = 100) {
  try {
    const response = await fetch(
      `/api/ai-practice/notebook?limit=${Math.max(1, Math.min(limit, 200))}`,
      {
        method: "GET",
        headers: {
          ...(await getAuthHeader()),
        },
        cache: "no-store",
        credentials: "same-origin",
      }
    );

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const payload = (await readJson(response)) as {
      entries?: AiPracticeNotebookEntry[];
    };
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    savedFingerprints.clear();
    for (const entry of entries) {
      markAiPracticeNotebookFingerprintSaved(String(entry.fingerprint || ""));
    }
    return entries;
  } catch (error) {
    throw new Error(
      toFriendlyNotebookClientError(error, "Chargement du carnet impossible pour le moment.")
    );
  }
}

export async function createAiPracticeNotebookEntry(input: AiPracticeNotebookSaveInput) {
  const fingerprint = buildAiPracticeNotebookFingerprint(input);
  try {
    const response = await fetch("/api/ai-practice/notebook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await getAuthHeader()),
      },
      body: JSON.stringify(input),
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const payload = (await readJson(response)) as {
      entry?: AiPracticeNotebookEntry;
      duplicate?: boolean;
      fingerprint?: string;
    };
    emitAiPracticeNotebookUpdated();
    if (!payload.entry) {
      throw new Error("Carnet indisponible.");
    }
    const resolvedFingerprint = String(
      payload.fingerprint || payload.entry.fingerprint || fingerprint
    );
    markAiPracticeNotebookFingerprintSaved(resolvedFingerprint);
    return {
      entry: payload.entry,
      duplicate: Boolean(payload.duplicate),
      fingerprint: resolvedFingerprint,
    };
  } catch (error) {
    throw new Error(
      toFriendlyNotebookClientError(error, "Impossible d'ajouter cette phrase au carnet.")
    );
  }
}

export async function deleteAiPracticeNotebookEntry(entryId: string, fingerprint?: string) {
  try {
    const response = await fetch(`/api/ai-practice/notebook/${encodeURIComponent(entryId)}`, {
      method: "DELETE",
      headers: {
        ...(await getAuthHeader()),
      },
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    clearAiPracticeNotebookFingerprintSaved(String(fingerprint || ""));
    emitAiPracticeNotebookUpdated();
  } catch (error) {
    throw new Error(
      toFriendlyNotebookClientError(error, "Suppression impossible pour le moment.")
    );
  }
}
