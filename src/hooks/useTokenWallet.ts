"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseConfig";

export function useTokenWallet(uid?: string | null) {
  const [balance, setBalance] = useState<number | null>(null);
  const [tier, setTier] = useState<string>("free");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      queueMicrotask(() => {
        setBalance(null);
        setTier("free");
        setLoading(false);
      });
      return;
    }

    const ref = doc(db, "users", uid, "tokens", "wallet");
    const unsub = onSnapshot(
      ref,
      (snapshot) => {
        const data = snapshot.data() ?? {};
        setBalance(typeof data.balance === "number" ? data.balance : 0);
        setTier(typeof data.tier === "string" ? data.tier : "free");
        setLoading(false);
      },
      () => {
        setBalance(0);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [uid]);

  return { balance, tier, loading };
}