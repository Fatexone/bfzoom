"use client";

import { useState } from "react";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { getIdToken } from "firebase/auth";

export default function AddUserPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const db = getFirestore();

  const handleAddUser = async () => {
    if (!email.trim()) {
      setError("❌ Veuillez entrer une adresse e-mail.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError("❌ Vous devez être connecté.");
        setLoading(false);
        return;
      }

      if (currentUser.email === email) {
        setError("❌ Vous ne pouvez pas vous ajouter vous-même.");
        setLoading(false);
        return;
      }

      // Vérifie si ce contact existe déjà dans la liste personnelle
      const contactRef = collection(db, `contacts/${currentUser.uid}/list`);
      const existingContactQuery = query(contactRef, where("email", "==", email));
      const existingSnap = await getDocs(existingContactQuery);

      if (!existingSnap.empty) {
        setError("❌ Ce contact est déjà dans votre liste.");
        setLoading(false);
        return;
      }

      // Vérifie si l'utilisateur avec cet email existe bien dans /users
      const userQuery = query(collection(db, "users"), where("email", "==", email));
      const userSnap = await getDocs(userQuery);

      if (userSnap.empty) {
        const token = await getIdToken(currentUser, true);
        const inviteRes = await fetch("/api/invitations/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email }),
        });
        if (!inviteRes.ok) {
          console.warn("Invitation email failed");
        }
        await addDoc(collection(db, "pending_invites"), {
          email,
          invitedBy: currentUser.uid,
          invitedByEmail: currentUser.email || "",
          createdAt: serverTimestamp(),
        });
        setError(
          "Ce contact n’est pas encore inscrit. Invitation enregistrée."
        );
        setLoading(false);
        return;
      }

      const matchedUser = userSnap.docs[0];
      const contactUid = matchedUser.id;

      // Ajoute le contact dans la liste personnelle
      await addDoc(contactRef, {
        email,
        uid: contactUid,
        addedAt: new Date(),
      });

      alert("✅ Contact ajouté !");
      router.push("/chat");
    } catch (err) {
      console.error(err);
      setError("❌ Erreur lors de l'ajout du contact.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-lg mx-auto min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <h1 className="text-3xl font-bold text-blue-600 mb-6">➕ Ajouter un contact</h1>

      <input
        type="email"
        placeholder="Email du contact"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full p-3 border rounded-lg mb-3"
      />

      <button
        onClick={handleAddUser}
        disabled={loading}
        className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50"
      >
        {loading ? "⏳ Ajout en cours..." : "Ajouter"}
      </button>

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        {error && <p className="text-red-500">{error}</p>}
        <button
          onClick={() => router.push("/chat")}
          className="text-amber-400 hover:text-amber-200"
        >
          ← Retour au chat
        </button>
      </div>
    </div>
  );
}