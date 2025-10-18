"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 🎯 Timer moderne et responsive
 * - Totalement autonome
 * - Affichage clair
 * - Adapté mobile / desktop
 */
export default function Timer() {
  const [timeLeft, setTimeLeft] = useState(60);
  const [customTime, setCustomTime] = useState(60);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const intervalRef = useRef<number | null>(null);

  /* 🔄 Gère le compte à rebours */
  useEffect(() => {
    if (!running) return;

    intervalRef.current = window.setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [running]);

  /* 🧨 Stop automatique à 0 */
  useEffect(() => {
    if (timeLeft === 0 && running) setRunning(false);
  }, [timeLeft, running]);

  /* ⚙️ Actions */
  const toggleTimer = () => setRunning((v) => !v);
  const resetTimer = () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    setTimeLeft(customTime);
    setRunning(false);
  };

  return (
    <section
      className="w-full sm:max-w-xl rounded-2xl border border-white/10 bg-black/40 backdrop-blur p-4 sm:p-5"
      aria-label="Minuteur d'exercice"
    >
      {/* 🔘 Bouton ouverture / fermeture */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-xl bg-white/10 hover:bg-white/15 transition px-4 py-2 text-left font-medium"
        aria-expanded={open}
      >
        {open ? "🔽 Masquer le Timer" : "⏳ Afficher le Timer"}
      </button>

      {/* ⏱️ Contenu du timer */}
      {open && (
        <div className="mt-4 space-y-4">
          {/* Saisie de durée */}
          <div className="flex items-center gap-2">
            <label htmlFor="timer-seconds" className="text-sm text-zinc-200">
              Durée (secondes)
            </label>
            <input
              id="timer-seconds"
              type="number"
              min={10}
              max={3600}
              value={customTime}
              onChange={(e) =>
                setCustomTime(
                  Math.max(10, Math.min(3600, Number(e.target.value) || 0))
                )
              }
              className="w-24 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-center"
            />
            <button
              onClick={() => setTimeLeft(customTime)}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 font-semibold"
            >
              Définir
            </button>
          </div>

          {/* Affichage du chrono */}
          <p className="text-4xl sm:text-5xl font-extrabold tabular-nums text-center">
            {timeLeft}s
          </p>

          {/* Contrôles */}
          <div className="flex gap-3 justify-center">
            <button
              onClick={toggleTimer}
              className={`rounded-lg px-5 py-2.5 font-semibold ${
                running
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-green-600 hover:bg-green-700"
              }`}
              aria-pressed={running}
            >
              {running ? "Pause" : "Démarrer"}
            </button>

            <button
              onClick={resetTimer}
              className="rounded-lg bg-zinc-600 hover:bg-zinc-700 px-5 py-2.5 font-semibold"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
