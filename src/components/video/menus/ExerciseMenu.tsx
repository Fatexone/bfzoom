"use client";

import React, { useState } from "react";
import exercisesData from "@/data/exercises.json";
import { motion, AnimatePresence } from "framer-motion";
import { Dumbbell, Flame, Wind, Activity, Zap } from "lucide-react";

/** Icônes fiables (toutes existent dans lucide-react) */
const ICONS: Record<string, React.ReactNode> = {
  boxe: <Zap className="w-5 h-5" />,        // éclairs = punchy
  pilates: <Activity className="w-5 h-5" />, // tracé cardiaque = mouvement contrôlé
  hiit: <Flame className="w-5 h-5" />,       // intensité
  muscu: <Dumbbell className="w-5 h-5" />,   // musculation
  respiration: <Wind className="w-5 h-5" />  // respiration
};

export default function ExerciseMenu() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const toggleCategory = (category: string) => {
    setActiveCategory((prev) => (prev === category ? null : category));
  };

  const categories = Object.keys(exercisesData);

  return (
    <>
      {/* Barre flottante, moderne et responsive */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[96%] sm:w-[640px] bg-black/60 backdrop-blur-md text-white rounded-2xl shadow-xl border border-white/10 flex justify-between sm:justify-around items-center px-2 py-2 sm:px-3 sm:py-3 z-40">
        {categories.map((category) => {
          const isActive = activeCategory === category;
          return (
            <button
              key={category}
              onClick={() => toggleCategory(category)}
              className={`flex-1 mx-1 sm:mx-0 flex flex-col items-center justify-center gap-1 sm:gap-1.5 rounded-xl px-2 py-2 sm:px-3 sm:py-2 transition-all duration-300
                ${isActive ? "bg-blue-600 shadow-md scale-105" : "hover:bg-white/10"}`}
              aria-pressed={isActive}
              aria-label={`Ouvrir ${category}`}
            >
              <span>
                {ICONS[category.toLowerCase()] ?? <Activity className="w-5 h-5" />}
              </span>
              <span className="text-[10px] sm:text-xs font-medium tracking-wide uppercase">
                {category}
              </span>
            </button>
          );
        })}
      </div>

      {/* Panneau coulissant des exercices */}
      <AnimatePresence>
        {activeCategory && (
          <motion.div
            key={activeCategory}
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-24 sm:bottom-24 left-1/2 -translate-x-1/2 w-[96%] sm:w-[560px] bg-white text-gray-900 rounded-2xl shadow-2xl p-4 sm:p-5 z-50 border border-gray-200"
            role="dialog"
            aria-modal="true"
            aria-label={`Exercices ${activeCategory}`}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base sm:text-lg font-bold text-gray-800 uppercase">
                {activeCategory}
              </h3>

              <button
                onClick={() => setActiveCategory(null)}
                className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium transition"
                aria-label="Fermer"
              >
                Fermer
              </button>
            </div>

            <ul className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {exercisesData[activeCategory as keyof typeof exercisesData]?.map(
                (exercise: string, index: number) => (
                  <li
                    key={`${activeCategory}-${index}`}
                    className="px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 text-sm transition"
                  >
                    {exercise}
                  </li>
                )
              )}
            </ul>

            {/* CTA optionnel : démarrer un timer série */}
            <div className="mt-4 sm:mt-5 flex gap-2">
              <button className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition">
                Démarrer la série
              </button>
              <button
                onClick={() => setActiveCategory(null)}
                className="flex-1 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-900 font-semibold transition"
              >
                Annuler
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
