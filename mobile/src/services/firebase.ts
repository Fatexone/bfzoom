import { getApp, getApps, initializeApp } from "firebase/app";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FirebaseAuth from "firebase/auth";
import {
  getAuth,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { env } from "../config/env";

const firebaseConfig = {
  apiKey: env.firebase.apiKey,
  authDomain: env.firebase.authDomain,
  projectId: env.firebase.projectId,
  storageBucket: env.firebase.storageBucket,
  messagingSenderId: env.firebase.messagingSenderId,
  appId: env.firebase.appId,
  measurementId: env.firebase.measurementId || undefined,
};

const hasFirebaseConfig =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

const app = hasFirebaseConfig
  ? getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)
  : null;

let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

const reactNativePersistence = (
  FirebaseAuth as typeof FirebaseAuth & {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => unknown;
  }
).getReactNativePersistence?.(AsyncStorage);

if (app) {
  try {
    authInstance = initializeAuth(
      app,
      reactNativePersistence
        ? {
            persistence: reactNativePersistence as NonNullable<
              Parameters<typeof initializeAuth>[1]
            >["persistence"],
          }
        : undefined
    );
  } catch (error) {
    console.warn(
      error instanceof Error
        ? `[firebase] initializeAuth fallback to getAuth: ${error.message}`
        : "[firebase] initializeAuth fallback to getAuth."
    );
    authInstance = getAuth(app);
  }
  try {
    firestoreInstance = initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    firestoreInstance = getFirestore(app);
  }
  storageInstance = getStorage(app);
}

export const auth = authInstance;
export const db = firestoreInstance;
export const storage = storageInstance;
export const firebaseConfigured = hasFirebaseConfig;
