// src/lib/firebaseConfig.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  // facultatif — ne mets pas "!" ici pour éviter les crash si absent
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    experimentalForceLongPolling: true,
  });
} catch {
  firestoreInstance = getFirestore(app);
}
export const db = firestoreInstance;
export const storage = getStorage(app);
export default app;

if (typeof window !== "undefined") {
  interface BfzoomWindow extends Window {
    __bfzoomAuth?: typeof auth;
    __bfzoomApp?: typeof app;
  }
  (window as BfzoomWindow).__bfzoomAuth = auth;
  (window as BfzoomWindow).__bfzoomApp = app;
}