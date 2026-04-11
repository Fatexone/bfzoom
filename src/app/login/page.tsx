"use client";

import { Suspense, useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { signInWithCustomToken } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { normalizeInternalReturnTo } from "@/lib/creditPacks";

const ACTIVE_SESSION_STORAGE_KEY = "bfzoom.activeSessionId";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 px-6 py-10">
      <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <p className="text-sm text-slate-500">Chargement...</p>
      </div>
    </div>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const initialEmail = (searchParams.get("email") || "").trim().toLowerCase();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const db = getFirestore();
  const mode = searchParams.get("mode") === "signup" ? "signup" : "login";
  const nextHref = normalizeInternalReturnTo(searchParams.get("next"));
  const hasInvite = Boolean((searchParams.get("invite") || "").trim());
  const mobileTopup = searchParams.get("mobileTopup") === "1";
  const pageTitle = mode === "signup" ? "Créer ton compte" : "Connexion";
  const pageSubtitle =
    mode === "signup"
      ? "Entre ton email pour créer ton compte BFZoom. Si cet email existe déjà, tu seras simplement connecté."
      : "Entre ton email pour te connecter. Si cet email n'existe pas encore, ton compte BFZoom sera créé automatiquement.";

  const upsertUser = useCallback(
    async (uid: string, userEmail: string | null) => {
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          id: uid,
          email: userEmail ?? "",
          name: "Utilisateur",
          online: true,
        });
      } else {
        await setDoc(userRef, { online: true }, { merge: true });
      }
    },
    [db]
  );

  const handleSendCode = async (): Promise<void> => {
    if (!email.trim()) {
      setMessage("⚠️ Veuillez entrer un email valide.");
      return;
    }
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "Erreur d'envoi");
      }
      setStep("code");
      setMessage("✅ Code de vérification envoyé. Vérifie ta boîte mail.");
    } catch (err) {
      const error = err as { message?: string };
      setMessage(`❌ Erreur : ${error.message ?? "Erreur inconnue"}`);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = useCallback(async () => {
    if (!email.trim() || !code.trim()) {
      setMessage("⚠️ Email et code requis.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as {
        token?: string;
        sessionId?: string;
        error?: string;
      };
      if (!response.ok || !data.token) {
        throw new Error(data.error ?? "Code invalide ou expiré.");
      }
      const result = await signInWithCustomToken(auth, data.token);
      const cleanSessionId = (data.sessionId || "").trim();
      if (typeof window !== "undefined") {
        if (cleanSessionId) {
          window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, cleanSessionId);
        } else {
          window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
        }
      }
      await upsertUser(result.user.uid, result.user.email);
      setMessage("✅ Identité vérifiée. Connexion réussie !");
      router.push(nextHref ?? "/dashboard");
    } catch (err) {
      const error = err as { message?: string };
      setMessage(`❌ ${error.message ?? "Erreur inconnue"}`);
    } finally {
      setLoading(false);
    }
  }, [code, email, nextHref, router, upsertUser]);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 px-6 py-10">
      <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
        <h1 className="text-2xl font-bold mb-2">🔑 {pageTitle}</h1>
        <p className="mb-4 text-sm text-slate-600">{pageSubtitle}</p>
        {hasInvite ? (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Invitation BFZoom détectée. Vérifie ton email pour continuer.
          </p>
        ) : null}
        {mobileTopup ? (
          <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            Tu finalises un achat de minutes pour ton app iPhone. Connecte-toi ici avec le même
            email que dans l’app, puis BFZoom te renverra automatiquement vers le checkout.
          </p>
        ) : null}

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Entre ton email..."
          className="w-full p-2 border border-slate-300 rounded mb-3 bg-white text-slate-900 placeholder-slate-400"
        />

        {step === "email" ? (
          <button
            onClick={handleSendCode}
            className="w-full bg-blue-600 text-white p-2 rounded"
            disabled={loading}
          >
            {loading ? "⏳ Envoi en cours..." : "✉️ Recevoir le code"}
          </button>
        ) : (
          <>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code à 6 chiffres"
              className="w-full p-2 border border-slate-300 rounded mb-3 bg-white text-slate-900 placeholder-slate-400"
            />
            <button
              onClick={handleVerifyCode}
              className="w-full bg-slate-900 text-white p-2 rounded"
              disabled={loading}
            >
              {loading ? "⏳ Vérification..." : "✅ Valider le code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep("email");
                setCode("");
                setMessage("");
              }}
              className="w-full mt-2 text-sm text-slate-500"
              disabled={loading}
            >
              Modifier l’email
            </button>
          </>
        )}

        {message && <p className="mt-2 text-slate-700">{message}</p>}
      </div>
    </div>
  );
}
