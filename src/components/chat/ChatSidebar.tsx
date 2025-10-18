"use client";

import { useEffect, useState } from "react";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  DocumentData,
} from "firebase/firestore";
import Link from "next/link";
import { User } from "@/types/User";
import { acceptInvitation } from "@/app/utils/invitations/acceptInvitation";
import { refuseInvitation } from "@/app/utils/invitations/refuseInvitation";

/* ------------------------- Types locaux ------------------------- */
interface ChatSidebarProps {
  selectedUser: User | null;
  setSelectedUser: (user: User | null) => void;
  currentUser: User | null;
}

interface Invitation {
  id: string;
  fromUid: string;
  fromEmail: string;
}

/* ------------------------- Composant principal ------------------------- */
export default function ChatSidebar({
  selectedUser,
  setSelectedUser,
  currentUser,
}: ChatSidebarProps) {
  const [contacts, setContacts] = useState<User[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [search, setSearch] = useState("");

  /* ------------------------- Effets ------------------------- */
  useEffect(() => {
    if (currentUser?.id) {
      void fetchContacts(currentUser.id);
      void fetchInvitations(currentUser.id);
    }
  }, [currentUser]);

  /* ------------------------- Fonctions principales ------------------------- */

  // 🔹 Récupération des contacts
  const fetchContacts = async (userId: string): Promise<void> => {
    const db = getFirestore();
    const contactsRef = collection(db, `contacts/${userId}/list`);
    const snapshot = await getDocs(contactsRef);
    const fetched: User[] = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as { email?: string };
      if (!data.email) continue;

      const q = query(collection(db, "users"), where("email", "==", data.email));
      const usersSnap = await getDocs(q);
      if (!usersSnap.empty) {
        const matchedDoc = usersSnap.docs[0];
        const matchedUser = matchedDoc.data() as DocumentData;
        fetched.push({
          id: matchedDoc.id,
          email: matchedUser.email ?? "",
          name: matchedUser.name ?? "Sans nom",
          online: matchedUser.online ?? false,
        });
      }
    }

    setContacts(fetched);
  };

  // 🔹 Récupération des invitations
  const fetchInvitations = async (userId: string): Promise<void> => {
    const db = getFirestore();
    const ref = collection(db, `invitations/${userId}/received`);
    const snapshot = await getDocs(ref);

    const result: Invitation[] = snapshot.docs.map((doc) => {
      const data = doc.data() as { fromUid: string; fromEmail: string };
      return {
        id: doc.id,
        fromUid: data.fromUid,
        fromEmail: data.fromEmail,
      };
    });

    setInvitations(result);
  };

  // 🔹 Suppression d’un contact
  const deleteContact = async (email: string, e: React.MouseEvent<HTMLButtonElement>): Promise<void> => {
    e.stopPropagation();
    if (!currentUser) return;

    const db = getFirestore();
    const q = query(
      collection(db, `contacts/${currentUser.id}/list`),
      where("email", "==", email)
    );
    const snapshot = await getDocs(q);

    for (const docSnap of snapshot.docs) {
      await deleteDoc(docSnap.ref);
    }

    await fetchContacts(currentUser.id);
  };

  // 🔹 Accepter une invitation
  const handleAccept = async (fromUid: string): Promise<void> => {
    if (!currentUser) return;
    await acceptInvitation(currentUser.id, fromUid);
    await Promise.all([fetchContacts(currentUser.id), fetchInvitations(currentUser.id)]);
  };

  // 🔹 Refuser une invitation
  const handleRefuse = async (fromUid: string): Promise<void> => {
    if (!currentUser) return;
    await refuseInvitation(currentUser.id, fromUid);
    await fetchInvitations(currentUser.id);
  };

  /* ------------------------- Rendu ------------------------- */
  return (
    <div className="w-80 p-4 bg-gray-100 border-r flex flex-col">
      {/* Profil utilisateur */}
      {currentUser && (
        <div className="mb-4 p-3 bg-blue-200 rounded-lg text-center">
          <p className="font-bold text-blue-900">Connecté en tant que :</p>
          <p className="text-sm text-gray-700">{currentUser.email}</p>
        </div>
      )}

      {/* Rechercher un contact */}
      <h2 className="text-lg font-bold text-center mb-2">👥 Mes contacts</h2>
      <input
        type="text"
        placeholder="Rechercher un contact..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full p-2 border rounded mb-3"
      />

      {/* Liste des contacts */}
      <ul className="flex-grow overflow-y-auto mb-6">
        {contacts
          .filter(
            (user) =>
              user.email.toLowerCase().includes(search.toLowerCase()) ||
              user.name.toLowerCase().includes(search.toLowerCase())
          )
          .map((user) => (
            <li
              key={user.id}
              onClick={() => setSelectedUser(user)}
              className={`p-3 flex items-center justify-between rounded-lg cursor-pointer transition ${
                selectedUser?.id === user.id ? "bg-blue-300" : "hover:bg-blue-100"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`h-3 w-3 rounded-full ${
                    user.online ? "bg-green-500" : "bg-gray-400"
                  }`}
                />
                <div>
                  <span className="text-gray-700">{user.name}</span>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </div>
              </div>

              <button
                onClick={(e) => deleteContact(user.email, e)}
                className="text-red-500 hover:text-red-700 transition"
              >
                🗑️
              </button>
            </li>
          ))}
      </ul>

      {/* Invitations reçues */}
      {invitations.length > 0 && (
        <div className="mb-4">
          <div className="text-lg font-bold text-center mb-2 flex items-center justify-center gap-2">
            🔔 Invitations reçues
            <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {invitations.length}
            </span>
          </div>

          <ul>
            {invitations.map((invitation) => (
              <li key={invitation.id} className="p-2 border rounded-lg mb-2 bg-white shadow">
                <p className="text-sm mb-2">📧 {invitation.fromEmail}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAccept(invitation.fromUid)}
                    className="flex-1 bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600"
                  >
                    ✅ Accepter
                  </button>
                  <button
                    onClick={() => handleRefuse(invitation.fromUid)}
                    className="flex-1 bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                  >
                    ❌ Refuser
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href="/add-user">
        <button className="w-full px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
          ➕ Ajouter un contact
        </button>
      </Link>
    </div>
  );
}
