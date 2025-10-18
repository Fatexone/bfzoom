"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebaseConfig";
import { onAuthStateChanged,} from "firebase/auth"; // 🔥 Import correct de `User`

export default function LandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true); 


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log("🕵️ Vérification de l'utilisateur...", user);
      
      setTimeout(() => { // ✅ Ajout d'un délai
        if (user) {
          console.log("🔄 Utilisateur connecté, redirection vers /dashboard...");
          router.push("/dashboard");
        } else {
          console.log("👤 Aucun utilisateur connecté, affichage de la page d'accueil.");
        }
      }, 1500); // 🔄 Attente de 1.5s pour éviter un problème de synchro Firebase
      
      setLoading(false);
    });
  
    return () => unsubscribe();
  }, [router]);
  
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">⏳ Chargement...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-gray-50">
      <h1 className="text-4xl font-bold text-blue-600 mb-4">Bienvenue sur MonApp 🚀</h1>
      <p className="text-lg text-gray-700 max-w-lg">
        Communiquez instantanément avec un chat sécurisé et des visioconférences fluides.  
        Connectez-vous pour commencer !
      </p>

      <div className="mt-6">
        <a href="/login" className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition">
          🔑 Connexion / Inscription
        </a>
      </div>
    </div>
  );
}
