"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { auth, db } from "@/lib/firebaseConfig";
import {
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  doc,
} from "firebase/firestore";
import { Copy, Mail } from "lucide-react";

const ADMIN_EMAIL = "brice.faradji@gmail.com";

type InviteRecord = {
  id: string;
  email: string;
  invitedBy?: string;
  invitedByEmail?: string;
  createdAt?: { toDate: () => Date };
  invitedAt?: { toDate: () => Date };
  note?: string;
};

export default function AdminInvitationsPage() {
  const [user, setUser] = useState<null | { email: string }>(null);
  const [loading, setLoading] = useState(true);
  const [invites, setInvites] = useState<InviteRecord[]>([]);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((current) => {
      if (current) setUser({ email: current.email ?? "" });
      else setUser(null);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const loadInvites = useMemo(() => async () => {
    const q = query(
      collection(db, "pending_invites"),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    setInvites(
      snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as InviteRecord;
        return { ...data, id: docSnap.id };
      })
    );
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadInvites();
    });
  }, [loadInvites]);

  const inviteLink = (email: string) =>
    `${process.env.NEXT_PUBLIC_APP_URL || "https://www.bfzoom.fr"}/signup?invite=${encodeURIComponent(
      user?.email ?? ""
    )}&target=${encodeURIComponent(email)}`;

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-white">
        Chargement...
      </div>
    );
  }

  if (!user || user.email !== ADMIN_EMAIL) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 text-white">
        <p className="text-lg font-semibold">Accès réservé</p>
        <p>Seul {ADMIN_EMAIL} peut voir cette page.</p>
        <Link href="/login" className="text-amber-400 underline">
          Se connecter
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-linear-to-br from-gray-950 via-gray-900 to-black px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/5 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-amber-200">
              Invitations en attente
            </p>
            <h1 className="text-2xl font-semibold">Admin BFZOOM</h1>
          </div>
          <div className="flex items-center gap-3">
            <Mail className="h-5 w-5 text-white" />
            <p className="text-sm text-gray-300">{invites.length} invites</p>
          </div>
        </header>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Invité par</th>
                  <th className="px-3 py-2">Créé le</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {invites.map((invite) => (
                  <tr key={invite.id} className="hover:bg-white/5">
                    <td className="px-3 py-2 font-semibold text-white">
                      {invite.email}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-300">
                      {invite.invitedByEmail || invite.invitedBy || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-300">
                      {invite.createdAt
                        ? invite.createdAt.toDate().toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            inviteLink(invite.email)
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white hover:border-amber-400/40"
                      >
                        <Copy className="h-3 w-3" />
                        Copier lien
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}