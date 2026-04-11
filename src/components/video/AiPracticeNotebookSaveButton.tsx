"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useUiLocale } from "@/components/ui/UiLocaleProvider";
import {
  isAiPracticeNotebookFingerprintSaved,
  markAiPracticeNotebookFingerprintSaved,
  createAiPracticeNotebookEntry,
  emitAiPracticeNotebookOpen,
} from "@/lib/aiPracticeNotebookClient";
import {
  buildAiPracticeNotebookFingerprint,
  type AiPracticeNotebookSaveInput,
} from "@/lib/aiPracticeNotebook";

const COPY = {
  fr: {
    saving: "Enregistrement...",
    saved: "Deja dans le carnet",
    openNotebook: "Voir le carnet",
    fallbackError: "Impossible d'ajouter cette phrase au carnet.",
  },
  en: {
    saving: "Saving...",
    saved: "Already in notebook",
    openNotebook: "Open notebook",
    fallbackError: "Unable to save this phrase right now.",
  },
} as const;

export default function AiPracticeNotebookSaveButton({
  payload,
  label,
  className,
  disabled = false,
}: {
  payload: AiPracticeNotebookSaveInput | null;
  label: string;
  className: string;
  disabled?: boolean;
}) {
  const { locale } = useUiLocale();
  const t = COPY[locale];
  const [busy, setBusy] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [error, setError] = useState("");
  const fingerprint = useMemo(
    () => (payload ? buildAiPracticeNotebookFingerprint(payload) : ""),
    [payload]
  );
  const isSaved =
    Boolean(fingerprint) &&
    (isAiPracticeNotebookFingerprintSaved(fingerprint) || savedFingerprint === fingerprint);

  const handleClick = async () => {
    if (!payload || disabled || busy || isSaved) return;
    setBusy(true);
    setError("");
    try {
      const result = await createAiPracticeNotebookEntry(payload);
      const nextFingerprint = result.fingerprint || fingerprint;
      if (nextFingerprint) {
        markAiPracticeNotebookFingerprintSaved(nextFingerprint);
        setSavedFingerprint(nextFingerprint);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.fallbackError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={!payload || disabled || busy || isSaved}
        className={className}
      >
        {busy ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t.saving}
          </>
        ) : isSaved ? (
          <>
            <Check className="h-3.5 w-3.5" />
            {t.saved}
          </>
        ) : (
          label
        )}
      </button>
      {isSaved && (
        <button
          type="button"
          onClick={emitAiPracticeNotebookOpen}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-200 transition hover:text-sky-100"
        >
          {t.openNotebook}
        </button>
      )}
      {error && <p className="text-[10px] text-amber-200">{error}</p>}
    </div>
  );
}
