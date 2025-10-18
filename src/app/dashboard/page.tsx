"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "@/lib/firebaseConfig";
import { Video, LogOut } from "lucide-react";
import { motion } from "framer-motion";

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Vérification de session utilisateur
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setLoading(false);
      } else {
        router.push("/");
      }
    });
    return () => unsubscribe();
  }, [router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/");
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen text-gray-400 text-lg">
        ⏳ Chargement...
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-gray-950 via-gray-900 to-black text-white px-6">
      {/* --- Éclairage d’arrière-plan --- */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.15),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(34,197,94,0.12),transparent_60%)]" />

      {/* --- En-tête --- */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="z-10 text-center mb-10"
      >
        <h1 className="text-4xl sm:text-5xl font-extrabold mb-2 bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400">
          Bienvenue, {user?.email?.split("@")[0]} 👋
        </h1>
        <p className="text-gray-400 text-sm sm:text-base">
          Prêt pour ta prochaine session de visiocoaching ?
        </p>
      </motion.div>

      {/* --- Bloc principal --- */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="z-10 w-full max-w-md p-8 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl text-center"
      >
        <Video className="w-12 h-12 mx-auto mb-4 text-blue-400" />
        <h2 className="text-2xl font-semibold mb-3">Démarrer une visioconférence</h2>
        <p className="text-gray-400 text-sm mb-6">
          Clique ci-dessous pour créer ou rejoindre une salle en direct.
        </p>

        <button
          onClick={() => router.push("/videoconference")}
          className="w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg hover:shadow-blue-500/30 active:scale-95"
        >
          <Video className="w-5 h-5" /> Démarrer maintenant
        </button>
      </motion.div>

      {/* --- Pied de page --- */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.5 }}
        className="z-10 mt-10 text-center text-gray-400 text-sm"
      >
        <button
          onClick={handleLogout}
          className="flex items-center justify-center gap-2 mx-auto mb-4 text-gray-400 hover:text-white transition font-semibold"
        >
          <LogOut className="w-4 h-4" /> Se déconnecter
        </button>

        <p className="text-xs opacity-70">
          © 2025 Brice Faradji — Plateforme de visiocoaching
        </p>
      </motion.div>
    </div>
  );
}
