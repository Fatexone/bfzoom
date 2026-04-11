"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { RotateCcw, Sparkles } from "lucide-react";
import { useUiLocale, type UiLocale } from "@/components/ui/UiLocaleProvider";
import AiPracticeRealtimeWebRtc from "@/components/practice/AiPracticeRealtimeWebRtc";

type AiPracticeRealtimeShellProps = {
  roomId: string;
  locked?: boolean;
  onFallback: () => void;
};

type Copy = {
  title: string;
  subtitle: string;
  fallback: string;
  sourceLanguage: string;
  targetLanguage: string;
  voice: string;
  coachStyle: string;
  instructions: string;
  instructionsPlaceholder: string;
  contextPending: string;
  contextApplied: string;
  applyContext: string;
  betaHint: string;
};

const COPY: Record<UiLocale, Copy> = {
  fr: {
    title: "Realtime web beta",
    subtitle:
      "Conversation vocale directe avec l'IA. Le flow AI Practice classique reste disponible a tout moment.",
    fallback: "Retour au flow classique",
    sourceLanguage: "Langue que tu parles",
    targetLanguage: "Langue a travailler",
    voice: "Voix IA",
    coachStyle: "Style du coach",
    instructions: "Contexte de pratique",
    instructionsPlaceholder:
      "Ex: discussion professionnelle, corrige-moi doucement, garde des reponses courtes.",
    contextPending: "Modifie le contexte puis applique-le. La session repartira proprement avec les nouveaux reglages.",
    contextApplied: "Contexte actif dans la session courante.",
    applyContext: "Appliquer au coach",
    betaHint:
      "Beta isolee au module AI Practice web. Si le micro, l'audio ou les credits posent probleme, BFZoom revient au flow classique.",
  },
  en: {
    title: "Realtime web beta",
    subtitle:
      "Direct voice conversation with the AI. The classic AI Practice flow remains available at any time.",
    fallback: "Back to classic flow",
    sourceLanguage: "Language you speak",
    targetLanguage: "Language to practice",
    voice: "AI voice",
    coachStyle: "Coach style",
    instructions: "Practice context",
    instructionsPlaceholder:
      "Example: business discussion, correct me gently, keep answers short.",
    contextPending: "Change the context, then apply it. The session will restart cleanly with the new settings.",
    contextApplied: "Context currently active in this session.",
    applyContext: "Apply to coach",
    betaHint:
      "Isolated beta for the web AI Practice module. If mic, audio, or credits fail, BFZoom falls back to the classic flow.",
  },
};

const LANGUAGE_OPTIONS = [
  { code: "fr", labelFr: "Francais", labelEn: "French" },
  { code: "en", labelFr: "Anglais", labelEn: "English" },
  { code: "es", labelFr: "Espagnol", labelEn: "Spanish" },
  { code: "ar", labelFr: "Arabe", labelEn: "Arabic" },
  { code: "ar-ma", labelFr: "Darija (Maghreb)", labelEn: "Darija (Maghreb)" },
  { code: "fa", labelFr: "Persan", labelEn: "Persian" },
  { code: "it", labelFr: "Italien", labelEn: "Italian" },
  { code: "ru", labelFr: "Russe", labelEn: "Russian" },
  { code: "zh", labelFr: "Chinois", labelEn: "Chinese" },
] as const;

const VOICE_OPTIONS = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;

const COACH_STYLE_OPTIONS = [
  {
    value: "warm_mentor",
    labelFr: "Mentor chaleureux",
    labelEn: "Warm mentor",
    instruction:
      "Coach style: warm mentor. Be encouraging, grounded, and lightly witty. Keep the learner confident and moving.",
  },
  {
    value: "direct_coach",
    labelFr: "Coach direct",
    labelEn: "Direct coach",
    instruction:
      "Coach style: direct coach. Be sharp, concise, and demanding, but still constructive and respectful.",
  },
  {
    value: "witty_partner",
    labelFr: "Coach witty",
    labelEn: "Witty coach",
    instruction:
      "Coach style: witty practice partner. Be lively, playful, and clever in small touches, without becoming silly or vague.",
  },
] as const;

export default function AiPracticeRealtimeShell({
  roomId,
  locked = false,
  onFallback,
}: AiPracticeRealtimeShellProps) {
  const { locale } = useUiLocale();
  const t = COPY[locale];
  const [sourceLanguage, setSourceLanguage] = useState("fr");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [voice, setVoice] = useState("ash");
  const [draftCoachStyle, setDraftCoachStyle] = useState("warm_mentor");
  const [appliedCoachStyle, setAppliedCoachStyle] = useState("warm_mentor");
  const [draftInstructions, setDraftInstructions] = useState("");
  const [appliedInstructions, setAppliedInstructions] = useState("");

  const activeCoachStyle = useMemo(
    () =>
      COACH_STYLE_OPTIONS.find((option) => option.value === appliedCoachStyle) ??
      COACH_STYLE_OPTIONS[0],
    [appliedCoachStyle]
  );

  const instructionsValue = useMemo(() => {
    const parts = [activeCoachStyle.instruction, appliedInstructions.trim()].filter(Boolean);
    return parts.join("\n");
  }, [activeCoachStyle, appliedInstructions]);

  const hasPendingContextChanges =
    draftCoachStyle !== appliedCoachStyle ||
    draftInstructions.trim() !== appliedInstructions.trim();

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-linear-to-br from-slate-950 via-slate-900 to-cyan-950 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-cyan-300">
            {t.title}
          </p>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">{t.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={onFallback}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t.fallback}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[0.92fr_1.08fr] lg:p-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="min-h-0 rounded-3xl border border-white/10 bg-white/6 p-5 shadow-2xl backdrop-blur-xl"
        >
          <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/8 p-4 text-sm leading-6 text-cyan-50">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
              <Sparkles className="h-3.5 w-3.5" />
              Beta
            </div>
            <p className="mt-2">{t.betaHint}</p>
          </div>

          <div className="mt-5 grid gap-4">
            <label className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <span className="mb-2 block font-semibold text-slate-100">
                {t.sourceLanguage}
              </span>
              <select
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white outline-none"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {locale === "fr" ? option.labelFr : option.labelEn}
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <span className="mb-2 block font-semibold text-slate-100">
                {t.targetLanguage}
              </span>
              <select
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white outline-none"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {locale === "fr" ? option.labelFr : option.labelEn}
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <span className="mb-2 block font-semibold text-slate-100">
                {t.voice}
              </span>
              <select
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white outline-none"
              >
                {VOICE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <span className="mb-2 block font-semibold text-slate-100">
                {t.coachStyle}
              </span>
              <select
                value={draftCoachStyle}
                onChange={(event) => setDraftCoachStyle(event.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white outline-none"
              >
                {COACH_STYLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {locale === "fr" ? option.labelFr : option.labelEn}
                  </option>
                ))}
              </select>
            </label>

            <label className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <span className="mb-2 block font-semibold text-slate-100">
                {t.instructions}
              </span>
              <textarea
                value={draftInstructions}
                onChange={(event) => setDraftInstructions(event.target.value)}
                rows={5}
                placeholder={t.instructionsPlaceholder}
                className="w-full resize-none rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs text-white outline-none placeholder:text-slate-500"
              />
            </label>

            <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
              <p className="leading-6">
                {hasPendingContextChanges ? t.contextPending : t.contextApplied}
              </p>
              <button
                type="button"
                onClick={() => {
                  setAppliedCoachStyle(draftCoachStyle);
                  setAppliedInstructions(draftInstructions.trim());
                }}
                disabled={!hasPendingContextChanges || locked}
                className="mt-3 inline-flex items-center rounded-full border border-cyan-300/50 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-slate-500"
              >
                {t.applyContext}
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="min-h-0"
        >
          <AiPracticeRealtimeWebRtc
            roomId={roomId}
            language={sourceLanguage}
            targetLanguage={targetLanguage}
            transcriptionLanguage={sourceLanguage}
            voice={voice}
            instructions={instructionsValue}
            disabled={locked}
            className="h-full"
            onFallbackRequested={() => {
              onFallback();
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
