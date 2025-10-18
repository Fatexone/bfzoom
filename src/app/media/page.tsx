"use client";

import { useState, useEffect, useReducer, useRef } from "react";

interface MediaMessage {
  id: number;
  file: string;
  type: "image" | "video";
  timeLeft: number | null;
}

type Action =
  | { type: "ADD_MEDIA"; payload: MediaMessage }
  | { type: "TICK" }
  | { type: "REMOVE_MEDIA"; payload: number };

const mediaReducer = (state: MediaMessage[], action: Action): MediaMessage[] => {
  switch (action.type) {
    case "ADD_MEDIA":
      return [...state, action.payload];
    case "TICK":
      return state
        .map((msg) =>
          msg.timeLeft !== null && msg.timeLeft > 0
            ? { ...msg, timeLeft: msg.timeLeft - 1 }
            : msg
        )
        .filter((msg) => msg.timeLeft !== 0);
    case "REMOVE_MEDIA":
      return state.filter((msg) => msg.id !== action.payload);
    default:
      return state;
  }
};

export default function MediaPage() {
  const [mediaMessages, dispatch] = useReducer(mediaReducer, []);
  const [pendingMedia, setPendingMedia] = useState<MediaMessage | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: "TICK" }), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    const fileURL = URL.createObjectURL(uploadedFile);
    const fileType: "image" | "video" = uploadedFile.type.startsWith("image") ? "image" : "video";

    setPendingMedia({
      id: Date.now(),
      file: fileURL,
      type: fileType,
      timeLeft: selectedDuration,
    });
  };

  const validateFile = (): void => {
    if (!pendingMedia) return;
    dispatch({ type: "ADD_MEDIA", payload: pendingMedia });
    setPendingMedia(null);
    setSelectedDuration(null);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto min-h-screen flex flex-col items-center justify-center bg-gray-100">
      <h1 className="text-4xl font-bold mb-6 text-center text-blue-600">📸 Partage Médias</h1>

      {/* Choix durée + upload */}
      <div className="mb-4 w-full max-w-lg">
        <div className="flex flex-col gap-4">
          <div className="flex gap-2 items-center">
            <label className="text-gray-600">⌛ Durée :</label>
            <select
              value={
                selectedDuration !== null && !isNaN(selectedDuration)
                  ? selectedDuration.toString()
                  : ""
              }
              onChange={(e) => {
                const val = e.target.value === "" ? null : Number(e.target.value);
                setSelectedDuration(val);
              }}
              className="border p-2 rounded"
            >
              <option value="">⏳ Choisissez un temps de diffusion</option>
              <option value={10}>10s</option>
              <option value={60}>1 min</option>
              <option value={300}>10 min</option>
              <option value={1800}>30 min</option>
            </select>
          </div>

          <input
            type="file"
            accept="image/*,video/*"
            onChange={handleFileUpload}
            disabled={selectedDuration === null}
            className={`mb-4 p-2 border rounded-lg ${
              selectedDuration === null ? "opacity-50 cursor-not-allowed" : ""
            }`}
          />
        </div>
      </div>

      {/* Liste des médias */}
      <div className="w-full max-w-lg h-80 bg-white shadow-lg rounded-lg p-4 overflow-y-auto border border-gray-300 relative">
        {pendingMedia && (
          <div className="relative p-3 mb-3 rounded-lg shadow-md bg-yellow-100 text-center border-2 border-yellow-400">
            {pendingMedia.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pendingMedia.file} alt="Image en attente" className="max-w-full rounded-lg" />
            ) : (
              <video src={pendingMedia.file} controls className="max-w-full rounded-lg" />
            )}
            <div className="mt-2 flex justify-center gap-4">
              <button
                onClick={validateFile}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition"
              >
                ✅ Valider
              </button>
              <button
                onClick={() => setPendingMedia(null)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
              >
                ❌ Annuler
              </button>
            </div>
          </div>
        )}

        {mediaMessages.length === 0 ? (
          <p className="text-gray-400 text-center">Aucun média partagé...</p>
        ) : (
          mediaMessages.map((msg) => (
            <div key={msg.id} className="relative p-3 mb-3 rounded-lg shadow-md bg-blue-100 text-center">
              {msg.type === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={msg.file} alt="Image partagée" className="max-w-full rounded-lg" />
              ) : (
                <video src={msg.file} controls className="max-w-full rounded-lg" />
              )}
              {msg.timeLeft !== null && msg.timeLeft > 0 && (
                <div className="text-xs text-gray-500 mt-2">⏳ {msg.timeLeft}s</div>
              )}
              <button
                className="absolute top-2 right-2 text-red-500 text-lg hover:text-red-700 transition"
                onClick={() => dispatch({ type: "REMOVE_MEDIA", payload: msg.id })}
              >
                ❌
              </button>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <button
        onClick={() => (window.location.href = "/chat")}
        className="mt-4 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition"
      >
        💬 Revenir aux messages textes
      </button>
    </div>
  );
}
