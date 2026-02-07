"use client";

import { useState } from "react";
import type { Contact } from "@/types/Contact";

export default function ChatGroupModal({
  contacts,
  onClose,
  onCreate,
}: {
  contacts: Contact[];
  onClose: () => void;
  onCreate: (title: string, memberIds: string[]) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (selected.length === 0) return;
    setCreating(true);
    try {
      await onCreate(title, selected);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-gray-950/95 p-6 text-white shadow-2xl">
        <div className="text-lg font-semibold">Créer un groupe</div>
        <p className="text-sm text-gray-400 mt-1">
          Choisis un nom et au moins un contact.
        </p>

        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Nom du groupe"
          className="mt-4 w-full rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
        />

        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">
          {contacts.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
              Aucun contact disponible.
            </div>
          ) : (
            contacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => toggle(contact.id)}
                className={`w-full text-left rounded-xl border px-3 py-3 transition ${
                  selected.includes(contact.id)
                    ? "border-emerald-400/60 bg-emerald-500/10"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <p className="text-sm font-semibold text-white truncate">
                  {contact.alias?.trim() || contact.name || contact.email}
                </p>
                <p className="text-xs text-gray-300 truncate">{contact.email}</p>
              </button>
            ))
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Annuler
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || selected.length === 0}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {creating ? "Création..." : "Créer"}
          </button>
        </div>
      </div>
    </div>
  );
}