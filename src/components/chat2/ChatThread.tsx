"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Chat, ChatMessage } from "@/types/Chat";
import { Trash, Users } from "lucide-react";

const RTL_LANGUAGE_CODES = new Set(["ar", "fa", "he"]);

const formatVoiceDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

const sanitizeLanguageCode = (value?: string | null) => {
  if (!value || typeof value !== "string") return "";
  return value.trim().toLowerCase().slice(0, 8);
};

const isRtlLanguageCode = (value?: string) => {
  if (!value) return false;
  return RTL_LANGUAGE_CODES.has(value.trim().toLowerCase());
};

const toLanguageLabel = (code: string, fallback: string) => {
  if (!code) return fallback;
  return code.length === 2 ? code.toUpperCase() : code;
};

const maskEmail = (value?: string) => {
  if (!value) return "";
  const trimmed = value.trim();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(1, local.length - visible.length))}${domain}`;
};

export default function ChatThread({
  chat,
  messages,
  currentUserId,
  title,
  directEmail,
  canManage,
  onManage,
  onSummarize,
  summary,
  actions,
  summaryLoading,
  summaryError,
  onClearSummary,
  isPremium,
  onDelete,
  canDelete,
  onRequestContactList,
  onDeleteMessage,
  hideHeader,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  chat: Chat | null;
  messages: ChatMessage[];
  currentUserId: string;
  title: string;
  directEmail?: string;
  canManage?: boolean;
  onManage?: () => void;
  onSummarize?: () => void;
  summary?: string;
  actions?: string[];
  summaryLoading?: boolean;
  summaryError?: string | null;
  onClearSummary?: () => void;
  isPremium?: boolean;
  onDelete?: () => void;
  canDelete?: boolean;
  onRequestContactList?: () => void;
  onDeleteMessage?: (messageId: string) => Promise<void>;
  hideHeader?: boolean;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showOriginalByMessage, setShowOriginalByMessage] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (autoScroll) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, autoScroll]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 60;
      setAutoScroll(atBottom);
    };
    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    if (messages.length === 0) {
      setShowOriginalByMessage({});
      return;
    }
    setShowOriginalByMessage((current) => {
      const knownIds = new Set(messages.map((message) => message.id));
      let changed = false;
      const next: Record<string, boolean> = {};
      Object.entries(current).forEach(([messageId, visible]) => {
        if (knownIds.has(messageId)) {
          next[messageId] = visible;
          return;
        }
        changed = true;
      });
      return changed ? next : current;
    });
  }, [messages]);

  const handleJumpToBottom = () => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setAutoScroll(true);
  };

  const toggleMessageLanguage = (messageId: string) => {
    setShowOriginalByMessage((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  const shouldShowNewBadge = !autoScroll && messages.length > 0;

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center text-gray-300">
        <div className="space-y-3 text-center">
          <p>Sélectionne une discussion pour commencer.</p>
          {onRequestContactList && (
            <button
              onClick={onRequestContactList}
              className="rounded-full border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/20"
            >
              Ouvrir les contacts
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {!hideHeader && (
        <div className="border-b border-white/10 bg-white/5 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {chat.type === "group" && (
                <div className="rounded-full bg-emerald-500/20 p-2 text-emerald-200">
                  <Users className="h-4 w-4" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold text-white">{title}</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-gray-300">
                    {chat.type === "group" ? "Groupe" : "Privé"}
                  </span>
                  {chat.type === "direct" && directEmail ? (
                    <span className="rounded-full border border-slate-600/60 bg-slate-900/40 px-2 py-0.5 text-[10px] text-slate-300">
                      {maskEmail(directEmail)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isPremium && (
                <span className="rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                  Premium
                </span>
              )}
              {onSummarize && (
                <button
                  onClick={onSummarize}
                  className="rounded-lg border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500/30"
                  disabled={summaryLoading}
                >
                  {summaryLoading ? "Résumé..." : "Résumé & Actions"}
                </button>
              )}
              {chat.type === "group" && canManage && onManage && (
                <button
                  onClick={onManage}
                  className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                >
                  Gérer
                </button>
              )}
              {canDelete && onDelete && (
                <button
                  onClick={onDelete}
                  className="flex items-center gap-1 rounded-lg border border-red-400/40 bg-red-500/20 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/30"
                >
                  <Trash className="h-3 w-3" />
                  Supprimer
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {hideHeader && (
        <div className="border-b border-white/10 bg-white/5 px-6 py-2">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="text-xs text-gray-400">
            {chat.type === "group" ? "Groupe" : "Discussion privée"}
          </p>
          {chat.type === "direct" && directEmail ? (
            <p className="text-xs text-slate-400 break-all">{maskEmail(directEmail)}</p>
          ) : null}
        </div>
      )}

      <div
        ref={containerRef}
        className="chat-scroll relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-6 py-4"
      >
        <div className="flex min-h-full flex-col gap-3 pr-1">
            {loading && messages.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                Chargement des messages...
              </div>
            )}

            {!loading && hasMore && (
              <div className="flex justify-center">
                <button
                  onClick={onLoadMore}
                  disabled={loadingMore || !onLoadMore}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
                >
                  {loadingMore ? "Chargement..." : "Charger les messages précédents"}
                </button>
              </div>
            )}

            {messages.length === 0 && !loading ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
                Aucun message pour le moment.
              </div>
            ) : (
              messages.map((msg) => {
                const isMe = msg.senderId === currentUserId;
                const originalText =
                  typeof msg.originalText === "string" ? msg.originalText.trim() : "";
                const translatedText = typeof msg.text === "string" ? msg.text.trim() : "";
                const sourceLang = sanitizeLanguageCode(
                  typeof msg.sourceLanguage === "string" ? msg.sourceLanguage : undefined
                );
                const targetLang = sanitizeLanguageCode(
                  typeof msg.targetLanguage === "string" ? msg.targetLanguage : undefined
                );
                const hasDualText =
                  Boolean(originalText) &&
                  Boolean(translatedText) &&
                  originalText !== translatedText;
                const showOriginal = Boolean(showOriginalByMessage[msg.id]) && hasDualText;
                const visibleText = showOriginal
                  ? originalText || translatedText
                  : translatedText || originalText;
                const visibleLanguageCode = sanitizeLanguageCode(
                  showOriginal ? sourceLang : targetLang
                );
                const rtlMessage = isRtlLanguageCode(visibleLanguageCode);
                const sourceLabel = toLanguageLabel(sourceLang, "AUTO");
                const targetLabel = toLanguageLabel(targetLang, "CIBLE");

                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`group relative max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-lg ${
                        isMe ? "bg-amber-400/95 text-black" : "bg-slate-800/80 text-white"
                      }`}
                    >
                      {!isMe && (
                        <div className="mb-1 text-xs font-semibold text-amber-200">
                          {msg.senderName}
                        </div>
                      )}

                      {isMe && onDeleteMessage && (
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm("Supprimer ce message pour tout le monde ?")
                            ) {
                              void onDeleteMessage(msg.id);
                            }
                          }}
                          aria-label="Supprimer ce message"
                          className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/15 text-red-200 opacity-0 transition hover:bg-black/25 hover:text-red-100 focus:opacity-100 group-hover:opacity-100"
                        >
                          <Trash className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {msg.type === "image" && msg.attachment?.url ? (
                        <div className="space-y-2">
                          <Image
                            src={msg.attachment.url}
                            alt={msg.attachment.name || "Image"}
                            className="max-h-64 w-full rounded-lg border border-white/10 object-contain"
                            width={640}
                            height={360}
                            unoptimized
                          />
                          <div className="text-xs text-white/70">{msg.attachment.name}</div>
                        </div>
                      ) : msg.type === "file" && msg.attachment?.url ? (
                        msg.attachment.contentType?.startsWith("video/") ? (
                          <video
                            controls
                            playsInline
                            src={msg.attachment.url}
                            className="max-h-64 w-full rounded-lg border border-white/10 object-cover"
                          />
                        ) : (
                          <a
                            href={msg.attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
                          >
                            📎 {msg.attachment.name || "Fichier"}
                          </a>
                        )
                      ) : msg.type === "voice" && msg.voiceNote?.url ? (
                        <div className="space-y-2">
                          <audio controls src={msg.voiceNote.url} className="w-full" />
                          <p className="text-[10px] text-white/70">
                            {formatVoiceDuration(msg.voiceNote.duration)}
                          </p>
                        </div>
                      ) : msg.type === "text" ? (
                        <div className="space-y-2">
                          {hasDualText && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                  isMe
                                    ? "border-black/20 bg-black/10 text-black/80"
                                    : "border-sky-300/30 bg-sky-500/10 text-sky-100"
                                }`}
                              >
                                {sourceLabel} → {targetLabel}
                              </span>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                  isMe
                                    ? "border-black/20 bg-black/5 text-black/70"
                                    : "border-white/10 bg-white/5 text-white/70"
                                }`}
                              >
                                {showOriginal ? "Original" : "Traduit"}
                              </span>
                            </div>
                          )}
                          <p
                            className={`whitespace-pre-wrap wrap-break-word leading-relaxed ${
                              rtlMessage ? "text-right [direction:rtl]" : ""
                            }`}
                          >
                            {visibleText}
                          </p>
                          {hasDualText && (
                            <button
                              type="button"
                              onClick={() => toggleMessageLanguage(msg.id)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:opacity-90 ${
                                isMe
                                  ? "border-black/20 bg-black/10 text-black/80"
                                  : "border-white/15 bg-white/5 text-white/80"
                              }`}
                            >
                              {showOriginal ? "Voir traduit" : "Voir original"}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p>Message non supporté.</p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
        </div>

        {shouldShowNewBadge && (
          <button
            onClick={handleJumpToBottom}
            className="absolute bottom-4 right-6 rounded-full border border-white/20 bg-amber-500/20 px-3 py-1 text-[11px] font-semibold text-amber-100 shadow-lg backdrop-blur"
          >
            Nouveaux messages ↓
          </button>
        )}
        </div>

      {(summary || summaryError || (actions && actions.length > 0)) && (
        <div className="px-6 pb-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-100">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-amber-200">
                Résumé & actions
              </p>
              {onClearSummary && (
                <button
                  onClick={onClearSummary}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Effacer
                </button>
              )}
            </div>
            {summaryError && <p className="mt-2 text-xs text-red-300">{summaryError}</p>}
            {!summary && !summaryError && (
              <p className="mt-2 text-xs text-gray-300">
                Clique sur “Résumé & Actions” pour transformer la discussion en plan
                clair.
              </p>
            )}
            {summary && <p className="mt-2 text-sm text-white">{summary}</p>}
            {actions && actions.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-emerald-100">
                {actions.map((action, index) => (
                  <li key={`${action}-${index}`} className="flex gap-2">
                    <span>•</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
