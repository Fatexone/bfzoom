"use client";

import { db } from "@/lib/firebaseConfig";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

type CreditType = "improve" | "summary";

const LIMITS: Record<CreditType, number> = {
  improve: 30,
  summary: 10,
};

const getMonthKey = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const usageRef = (uid: string) => doc(db, `users/${uid}/ai_usage/usage`);
const userRef = (uid: string) => doc(db, "users", uid);

const isPremium = async (uid: string) => {
  const snap = await getDoc(userRef(uid));
  if (!snap.exists()) return false;
  const data = snap.data() as { plan?: string; isPremium?: boolean };
  return data?.isPremium === true || data?.plan === "premium";
};

export const getUsage = async (uid: string) => {
  const ref = usageRef(uid);
  const snap = await getDoc(ref);
  const monthKey = getMonthKey();

  if (!snap.exists()) {
    const base = { monthKey, improveUsed: 0, summaryUsed: 0 };
    await setDoc(ref, { ...base, updatedAt: serverTimestamp() });
    return base;
  }

  const data = snap.data() as {
    monthKey?: string;
    improveUsed?: number;
    summaryUsed?: number;
  };

  if (data.monthKey !== monthKey) {
    const reset = { monthKey, improveUsed: 0, summaryUsed: 0 };
    await setDoc(ref, { ...reset, updatedAt: serverTimestamp() }, { merge: true });
    return reset;
  }

  return {
    monthKey,
    improveUsed: data.improveUsed ?? 0,
    summaryUsed: data.summaryUsed ?? 0,
  };
};

export const canUseCredit = async (uid: string, type: CreditType) => {
  if (await isPremium(uid)) {
    return { ok: true, remaining: Infinity, limit: Infinity };
  }
  const usage = await getUsage(uid);
  const used = type === "improve" ? usage.improveUsed : usage.summaryUsed;
  const limit = LIMITS[type];
  return { ok: used < limit, remaining: Math.max(limit - used, 0), limit };
};

export const incrementCredit = async (uid: string, type: CreditType) => {
  const ref = usageRef(uid);
  const usage = await getUsage(uid);
  const field = type === "improve" ? "improveUsed" : "summaryUsed";
  const nextValue = (type === "improve" ? usage.improveUsed : usage.summaryUsed) + 1;
  await updateDoc(ref, { [field]: nextValue, updatedAt: serverTimestamp() });
};

export const getLimits = () => LIMITS;