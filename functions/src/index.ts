import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import OpenAI from "openai";

if (!getApps().length) {
  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    initializeApp();
  }
}

const getOpenAIClient = () => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OpenAI key is missing. Set OPENAI_API_KEY or configure the secret.");
  }
  return new OpenAI({ apiKey: key });
};
const db = getFirestore();

const COLLECTION = "ai_background_jobs";

export const generateAiBackground = onDocumentCreated(
  {
    document: `${COLLECTION}/{jobId}`,
    secrets: ["OPENAI_API_KEY"],
  },
  async (event) => {
    const docRef = event.data?.ref;
    const prompt = event.data?.data()?.prompt;
    if (!docRef || !prompt) {
      return;
    }

    await docRef.update({
      status: "processing",
      updatedAt: Date.now(),
    });

    try {
      const openai = getOpenAIClient();
      const response = await openai.images.generate({
        model: "dall-e-3",
        prompt: prompt.trim(),
        size: "1024x1024",
        response_format: "url",
      });
      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error("Aucune URL reçue.");
      }
      await docRef.update({
        status: "complete",
        imageUrl,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error("Erreur génération DALL·E :", error);
      await docRef.update({
        status: "error",
        errorMessage: error instanceof Error ? error.message : "Erreur OpenAI.",
        updatedAt: Date.now(),
      });
    }
  }
);
