"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import {
  sendSignInLinkToEmail,
  signInWithEmailLink,
  isSignInWithEmailLink,
} from "firebase/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // ✅ Connexion via lien magique
  const handleSignIn = useCallback(async (emailToUse: string) => {
    try {
      console.log("🕵️ Tentative de connexion :", emailToUse);
      await signInWithEmailLink(auth, emailToUse, window.location.href);
      console.log("✅ Connexion réussie, redirection...");
      setTimeout(() => router.push("/chat"), 1500);
      window.localStorage.removeItem("emailForSignIn");
      setMessage("🎉 Connexion réussie !");
    } catch (err) {
      const error = err as { message?: string };
      setMessage(`❌ Erreur de connexion : ${error.message ?? "Erreur inconnue"}`);
    }
  }, [router]);

  // 📩 Vérifie si l'utilisateur revient via le lien magique
  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      console.log("🔍 Lien magique détecté...");
      const storedEmail = window.localStorage.getItem("emailForSignIn");
      if (!storedEmail) {
        const emailFromUser = prompt("🔑 Entre ton email pour confirmer la connexion :");
        if (emailFromUser) handleSignIn(emailFromUser);
      } else {
        handleSignIn(storedEmail);
      }
    }
  }, [handleSignIn]);

  // ✅ Envoi du lien magique
  const handleSendEmail = async (): Promise<void> => {
    if (!email.trim()) {
      setMessage("⚠️ Veuillez entrer un email valide.");
      return;
    }
    setLoading(true);
    setMessage("");

    const actionCodeSettings = {
      url: `${window.location.origin}/auth/verify`,
      handleCodeInApp: true,
    };

    try {
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem("emailForSignIn", email);
      setMessage("✅ Lien de connexion envoyé à ton email !");
    } catch (err) {
      const error = err as { message?: string };
      setMessage(`❌ Erreur : ${error.message ?? "Erreur inconnue"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">🔑 Connexion</h1>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Entre ton email..."
        className="w-full p-2 border rounded mb-2"
      />

      <button
        onClick={handleSendEmail}
        className="w-full bg-blue-500 text-white p-2 rounded"
        disabled={loading}
      >
        {loading ? "⏳ Envoi en cours..." : "✉️ Envoyer le lien de connexion"}
      </button>

      {message && <p className="mt-2 text-gray-700">{message}</p>}
    </div>
  );
}
