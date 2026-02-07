"use client";

import type { Contact } from "@/types/Contact";
import type { User } from "@/types/User";

export default function ChatGroupManageModal({
  contacts,
  members,
  onClose,
  onAddMembers,
  onRemoveMember,
}: {
  contacts: Contact[];
  members: User[];
  onClose: () => void;
  onAddMembers: (memberIds: string[]) => Promise<void>;
  onRemoveMember: (memberId: string) => Promise<void>;
}) {
  const availableContacts = contacts.filter(
    (contact) => !members.find((member) => member.id === contact.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-gray-950/95 p-6 text-white shadow-2xl">
        <div className="text-lg font-semibold">Gérer le groupe</div>
        <p className="text-sm text-gray-400 mt-1">
          Ajoute ou retire des membres.
        </p>

        <div className="mt-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Membres actuels
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {members.map((member) => {
              const alias =
                contacts.find((contact) => contact.id === member.id)
                  ?.alias?.trim() ||
                member.name ||
                member.id;
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-white truncate">
                      {alias}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{member.email}</p>
                  </div>
                  <button
                    onClick={() => onRemoveMember(member.id)}
                    className="text-xs rounded-lg border border-red-400/40 px-3 py-1 text-red-200 hover:bg-red-500/20"
                  >
                    Retirer
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            Ajouter des contacts
          </div>
          {availableContacts.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-gray-400">
              Aucun contact disponible à ajouter.
            </div>
          ) : (
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {availableContacts.map((contact) => (
                <button
                  key={contact.id}
                  onClick={() => onAddMembers([contact.id])}
                  className="w-full text-left rounded-xl border border-white/10 bg-white/5 px-3 py-2 transition hover:bg-white/10"
                >
                  <p className="text-sm font-semibold text-white truncate">
                    {contact.name || contact.email}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{contact.email}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}