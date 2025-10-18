"use client";
import { useState } from "react";

export default function OpenAIEspace() {
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [userMessage, setUserMessage] = useState("");
  const [aiResponse, setAiResponse] = useState("");

  // ✅ Envoi à OpenAI
  const sendToOpenAI = async () => {
    if (!userMessage.trim()) return;
    const res = await fetch("/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: userMessage }] }),
    });
    const data = await res.json();
    setAiResponse(data.choices[0]?.message?.content || "Pas de réponse.");
  };

  return (
    <div className="bg-gray-800 text-white p-4 rounded-lg shadow-lg w-full max-w-lg">
      {/* ✅ Bouton pour ouvrir/fermer l'IA */}
      <button
        onClick={() => setIsAiOpen(!isAiOpen)}
        className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition"
      >
        {isAiOpen ? "🔽 Masquer le Coach IA" : "🤖 Afficher le Coach IA"}
      </button>

      {/* ✅ Contenu de l'IA Coach */}
      {isAiOpen && (
        <div className="mt-4">
          <h3 className="text-lg font-bold">🤖 Coach IA</h3>
          <input
            className="border p-2 rounded flex-grow bg-gray-900 text-white w-full mb-2"
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="Pose ta question..."
          />
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            onClick={sendToOpenAI}
          >
            Envoyer
          </button>
          {aiResponse && (
            <div className="mt-4 p-2 bg-gray-900 border rounded">
              <p className="text-white font-semibold">Réponse :</p>
              <p>{aiResponse}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
