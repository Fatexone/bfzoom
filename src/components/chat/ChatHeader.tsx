"use client";

import { User } from "@/types/User";

interface ChatHeaderProps {
  selectedUser: User | null;
  onBack?: () => void; // ✅ Optionnel : fonction de retour si nécessaire
}

export default function ChatHeader({ selectedUser, onBack }: ChatHeaderProps) {
  return (
    <div className="flex items-center justify-between w-full p-4 bg-white shadow-md rounded-lg">
      {/* 🔙 Bouton retour si un utilisateur est sélectionné */}
      {selectedUser && onBack && (
        <button
          onClick={onBack}
          className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400 transition"
        >
          ⬅ Retour
        </button>
      )}

      {/* 🏷️ Nom du contact ou titre du chat */}
      <h1 className="text-2xl font-bold text-blue-600">
        {selectedUser ? `💬 Discussion avec ${selectedUser.name}` : "💬 FatexChat"}
      </h1>
    </div>
  );
}
