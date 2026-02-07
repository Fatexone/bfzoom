"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { signInWithEmailLink, isSignInWithEmailLink } from "firebase/auth";

export default function VerifyAuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [needsEmail, setNeedsEmail] = useState(false);
  const [message, setMessage] = useState("🔄 Vérification de votre session...");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const verifyUser = async (): Promise<void> => {
      const db = getFirestore();

      if (!isSignInWithEmailLink(auth, window.location.href)) {
        setMessage("Lien invalide.");
        return;
      }

      const storedEmail = window.localStorage.getItem("emailForSignIn");
      if (!storedEmail) {
        setNeedsEmail(true);
        setMessage("🔑 Entrez votre email pour confirmer la connexion.");
        return;
      }

      try {
        const result = await signInWithEmailLink(auth, storedEmail, window.location.href);
        const user = result.user;
        if (!user) throw new Error("Connexion impossible.");

        console.log("✅ Connecté :", user.uid);

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          await setDoc(userRef, {
            id: user.uid,
            email: user.email ?? storedEmail,
            name: "Utilisateur",
            online: true,
          });
          console.log("🆕 Profil créé dans Firestore.");
        } else {
          await setDoc(userRef, { online: true }, { merge: true });
          console.log("🔁 Mise à jour du statut (en ligne).");
        }

        window.localStorage.removeItem("emailForSignIn");
        router.push("/dashboard");
      } catch (err) {
        const error = err as { code?: string; message?: string };
        console.error("❌ Erreur de connexion :", error.message ?? error);

        if (error.code === "auth/invalid-action-code") {
          alert("🔒 Lien expiré ou invalide. Redemandez un nouveau lien.");
        } else {
          alert("Erreur d'authentification : " + (error.message ?? "Erreur inconnue"));
        }

        router.push("/");
      }
    };

    verifyUser();
  }, [router]);

  const handleConfirm = async () => {
    if (!email.trim()) {
      setMessage("⚠️ Veuillez entrer votre email.");
      return;
    }
    setLoading(true);
    setMessage("🔄 Connexion en cours...");
    try {
      const result = await signInWithEmailLink(auth, email.trim(), window.location.href);
      const db = getFirestore();
      const user = result.user;
      if (!user) throw new Error("Connexion impossible.");

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          id: user.uid,
          email: user.email ?? email.trim(),
          name: "Utilisateur",
          online: true,
        });
      } else {
        await setDoc(userRef, { online: true }, { merge: true });
      }

      window.localStorage.removeItem("emailForSignIn");
      router.push("/dashboard");
    } catch (err) {
      const error = err as { code?: string; message?: string };
      setMessage("Erreur d'authentification : " + (error.message ?? "Erreur inconnue"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 text-slate-900 px-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-center">
        <p className="text-sm text-slate-700">{message}</p>
        {needsEmail && (
          <div className="mt-4 space-y-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Votre email"
              className="w-full p-2 border border-slate-300 rounded bg-white text-slate-900 placeholder-slate-400"
            />
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="w-full bg-blue-600 text-white p-2 rounded"
            >
              {loading ? "⏳ Connexion..." : "Confirmer"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
