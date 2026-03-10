"use client";

import { useRouter } from "next/navigation";

type UpgradeModalProps = {
  onClose: () => void;
  title?: string;
  message?: string;
  ctaLabel?: string;
};

export default function UpgradeModal({
  onClose,
  title = "Passe en Premium",
  message = "Débloque les résumés IA et la correction illimitée.",
  ctaLabel = "Passer Premium",
}: UpgradeModalProps) {
  const router = useRouter();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gray-950/95 p-6 text-white shadow-2xl">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-gray-300">{message}</p>
        <ul className="mt-4 space-y-2 text-sm text-gray-200">
          <li>• Traduction illimitée</li>
          <li>• Correction + coaching linguistique</li>
          <li>• Résumés & actions illimités</li>
        </ul>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Plus tard
          </button>
          <button
            onClick={() => {
              onClose();
              router.push("/pricing");
            }}
            className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
          >
              {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}