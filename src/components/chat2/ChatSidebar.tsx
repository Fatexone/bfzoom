"use client";

import { useState } from "react";
import { doc, deleteField, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";
import type { Chat } from "@/types/Chat";
import type { Contact } from "@/types/Contact";
import type { User } from "@/types/User";
import { MessageSquare, MoreHorizontal, Users } from "lucide-react";

export default function ChatSidebar({
  chats,
  contacts,
  selectedChatId,
  onSelectChat,
  onStartDirectChat,
  onCreateGroup,
  onCreateContact,
  userMap,
  currentUserId,
  mode,
  onModeChange,
  unreadMap,
  isPremium,
  roleLabel,
  currentUserName,
  currentUserEmail,
  onQuickCall,
  onQuickAction,
  onSummarizeChat,
  onRequestDeleteChat,
  summaryLoading,
  hasMoreChats,
  onLoadMoreChats,
}: {
  chats: Chat[];
  contacts: Contact[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onStartDirectChat: (userId: string) => void;
  onCreateGroup: () => void;
  onCreateContact: () => void;
  userMap: Record<string, User>;
  currentUserId: string;
  mode: "chats" | "contacts";
  onModeChange: (mode: "chats" | "contacts") => void;
  unreadMap: Record<string, boolean>;
  isPremium?: boolean;
  roleLabel?: string;
  currentUserName?: string;
  currentUserEmail?: string;
  onQuickCall?: (chatId: string, type: "audio" | "video") => void;
  onQuickAction?: (
    chatId: string,
    action: "voice" | "photo" | "video" | "file"
  ) => void;
  onSummarizeChat?: (chatId: string) => void;
  onRequestDeleteChat?: (chatId: string) => void;
  summaryLoading?: boolean;
  hasMoreChats?: boolean;
  onLoadMoreChats?: () => void;
}) {
  const [openQuickMenu, setOpenQuickMenu] = useState<string | null>(null);

  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);
  const [aliasError, setAliasError] = useState<string | null>(null);

  const openAliasEditor = (contact: Contact) => {
    setEditingContactId(contact.contactDocId ?? contact.id);
    setAliasDraft(contact.alias ?? contact.name ?? contact.email ?? "");
    setAliasError(null);
  };

  const cancelAliasEdit = () => {
    setEditingContactId(null);
    setAliasDraft("");
    setAliasError(null);
  };

  const saveAlias = async () => {
    if (!currentUserId || !editingContactId) return;
    setSavingAlias(true);
    try {
      const contactRef = doc(
        db,
        `contacts/${currentUserId}/list`,
        editingContactId
      );
      const trimmed = aliasDraft.trim();
      if (!trimmed) {
        await updateDoc(contactRef, { alias: deleteField() });
      } else {
        await updateDoc(contactRef, { alias: trimmed });
      }
      cancelAliasEdit();
    } catch (error) {
      console.error("Alias update failed:", error);
      setAliasError("Impossible de mettre à jour l’alias.");
    } finally {
      setSavingAlias(false);
    }
  };


  return (
    <aside className="w-full md:w-80 border-r border-white/10 bg-white/5 backdrop-blur-xl">
      <div className="border-b border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-1">
          {currentUserEmail && (
            <p className="text-xs text-gray-400">{currentUserEmail}</p>
          )}
          <p className="text-lg font-semibold text-white">
            {currentUserName || "Utilisateur"}
          </p>
          {roleLabel && (
            <span className="text-[11px] uppercase tracking-wide text-amber-200">
              {roleLabel}
            </span>
          )}
        </div>
      </div>
      <div className="p-4 border-b border-white/10">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onModeChange("chats")}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              mode === "chats"
                ? "bg-amber-600 text-white"
                : "bg-white/10 text-gray-200 hover:bg-white/20"
            }`}
          >
            Discussions
          </button>
          <button
            onClick={() => onModeChange("contacts")}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              mode === "contacts"
                ? "bg-emerald-600 text-white"
                : "bg-white/10 text-gray-200 hover:bg-white/20"
            }`}
          >
            Contacts
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={onCreateGroup}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            ➕ Nouveau groupe
          </button>
          <button
            onClick={onCreateContact}
            className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            👤 Nouveau contact
          </button>
        </div>
      </div>
      {mode === "chats" ? (
        <div className="p-3 space-y-2">
          {chats.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
              Aucune discussion pour le moment.
            </div>
          ) : (
            chats.map((chat) => {
              const otherId =
                chat.type === "direct"
                  ? chat.participants.find((id) => id !== currentUserId)
                  : null;
              const otherUser = otherId ? userMap[otherId] : null;
              const title =
                chat.type === "group"
                  ? chat.title || "Groupe"
                  : otherUser?.name || otherUser?.email || "Discussion";
              const quickMenuLabel = chat.type === "group" ? "Groupe" : "Contact";
              const contactEmail = otherUser?.email;
              const canDeleteChat = chat.createdBy === currentUserId;

              return (
                <div key={chat.id} className="space-y-1">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectChat(chat.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelectChat(chat.id);
                      }
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                      selectedChatId === chat.id
                        ? "border-amber-400/60 bg-amber-500/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center">
                        {chat.type === "group" ? (
                          <Users className="h-4 w-4 text-emerald-200" />
                        ) : (
                          <MessageSquare className="h-4 w-4 text-amber-200" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white truncate">
                            {title}
                          </p>
                          {unreadMap[chat.id] && (
                            <span className="h-2 w-2 rounded-full bg-amber-400" />
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenQuickMenu((prev) =>
                          prev === chat.id ? null : chat.id
                        );
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-white/10"
                    >
                      <MoreHorizontal className="h-3 w-3" />
                    </button>
                  </div>
                  {openQuickMenu === chat.id && (
                    <div className="relative">
                      <div className="absolute right-4 z-10 mt-1 flex w-48 flex-col gap-2 rounded-2xl border border-white/10 bg-black/90 p-3 text-xs text-white shadow-2xl">
                        <div className="space-y-1 rounded-xl border border-white/10 bg-white/5 p-2 text-[10px] uppercase tracking-wide text-amber-200">
                          <p>{quickMenuLabel}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 p-2">
                          <p className="text-sm font-semibold text-white truncate">
                            {title}
                          </p>
                          {contactEmail && (
                            <p className="text-[10px] text-gray-400 break-words">
                              {contactEmail}
                            </p>
                          )}
                        </div>
                        {onSummarizeChat && (
                          <button
                            onClick={() => {
                              setOpenQuickMenu(null);
                              onSummarizeChat(chat.id);
                            }}
                            disabled={summaryLoading}
                            className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/20 px-3 py-2 text-[11px] font-semibold text-white hover:bg-amber-500/30 disabled:opacity-50"
                          >
                            Résumé & actions
                          </button>
                        )}
                        {onQuickAction && (
                          <>
                            <button
                              onClick={() => {
                                setOpenQuickMenu(null);
                                onQuickAction?.(chat.id, "voice");
                              }}
                              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white hover:bg-white/10"
                            >
                              🎙️ Note vocale
                            </button>
                            <button
                              onClick={() => {
                                setOpenQuickMenu(null);
                                onQuickAction?.(chat.id, "video");
                              }}
                              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white hover:bg-white/10"
                            >
                              📷 Vidéo / Photo
                            </button>
                            <button
                              onClick={() => {
                                setOpenQuickMenu(null);
                                onQuickAction?.(chat.id, "file");
                              }}
                              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white hover:bg-white/10"
                            >
                              📎 Joindre un fichier
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => {
                            setOpenQuickMenu(null);
                            onQuickCall?.(chat.id, "video");
                          }}
                          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white hover:bg-white/10"
                        >
                          🎥 Appel vidéo
                        </button>
                        <button
                          onClick={() => {
                            setOpenQuickMenu(null);
                            onQuickCall?.(chat.id, "audio");
                          }}
                          className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] font-semibold text-white hover:bg-white/10"
                        >
                          📞 Appel audio
                        </button>
                        {onRequestDeleteChat && (
                          <button
                            onClick={() => {
                              setOpenQuickMenu(null);
                              onRequestDeleteChat(chat.id);
                            }}
                            disabled={!canDeleteChat}
                            title={
                              canDeleteChat
                                ? "Supprimer cette discussion"
                                : "Tu n’es pas autorisé·e"
                            }
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[11px] font-semibold transition ${
                              canDeleteChat
                                ? "border-red-400/40 bg-red-500/20 text-red-100 hover:bg-red-500/30"
                                : "border-white/20 bg-white/5 text-white/50"
                            }`}
                          >
                            Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="p-3 space-y-2">
          {contacts.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
              Aucun contact pour le moment.
            </div>
          ) : (
            contacts.map((contact) => {
              const displayName =
                (contact.alias?.trim() ? contact.alias : null) ||
                contact.name ||
                contact.email ||
                "Contact";
              return (
                <div key={contact.id} className="space-y-2">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => onStartDirectChat(contact.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onStartDirectChat(contact.id);
                      }
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-3 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white truncate">
                        {displayName}
                      </p>
                      <p className="text-xs text-gray-300 truncate">
                        {contact.email}
                      </p>
                    </div>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        openAliasEditor(contact);
                      }}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-semibold text-white transition hover:bg-white/10"
                    >
                      ✏️
                    </button>
                  </div>
                  {editingContactId === (contact.contactDocId ?? contact.id) && (
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-100">
                      <label className="text-[11px] text-gray-400">
                        Alias personnel
                      </label>
                      <div className="mt-1 flex gap-2">
                        <input
                          value={aliasDraft}
                          onChange={(event) => setAliasDraft(event.target.value)}
                          className="flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
                          placeholder="Ex : Marine (alias privé)"
                        />
                        <button
                          onClick={saveAlias}
                          disabled={savingAlias}
                          className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-60"
                        >
                          {savingAlias ? "Enregistrement..." : "Sauver"}
                        </button>
                        <button
                          onClick={cancelAliasEdit}
                          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white transition hover:bg-white/10"
                        >
                          Annuler
                        </button>
                      </div>
                      {aliasError && (
                        <p className="mt-1 text-[11px] text-rose-300">
                          {aliasError}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </aside>
  );
}