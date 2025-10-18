"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { signInWithEmailLink, isSignInWithEmailLink } from "firebase/auth";

export default function VerifyAuthPage() {
  const router = useRouter();

  useEffect(() => {
    const verifyUser = async (): Promise<void> => {
      const db = getFirestore();

      if (!isSignInWithEmailLink(auth, window.location.href)) return;

      const email = window.localStorage.getItem("emailForSignIn");
      if (!email) {
        alert("⚠️ Email introuvable. Ouvrez le lien depuis le même navigateur.");
        router.push("/");
        return;
      }

      try {
        const result = await signInWithEmailLink(auth, email, window.location.href);
        const user = result.user;
        if (!user) throw new Error("Connexion impossible.");

        console.log("✅ Connecté :", user.uid);

        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          await setDoc(userRef, {
            id: user.uid,
            email: user.email ?? email,
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

  return <div className="text-center p-6">🔄 Vérification de votre session...</div>;
}
