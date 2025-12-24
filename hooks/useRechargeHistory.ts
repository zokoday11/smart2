"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

export type RechargeHistoryItem = {
  id: string;
  provider?: string;
  orderId?: string | null;
  checkoutId?: string | null;

  creditsAdded?: number;

  // si Polar renvoie des montants en cents (souvent), on stocke tel quel et on affiche /100
  amount?: number | null;
  currency?: string | null;

  status?: string | null;
  eventType?: string | null;

  productIds?: string[];
  priceIds?: string[];

  createdAt?: number; // ms
};

function toMillis(v: unknown): number | undefined {
  if (!v) return undefined;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && (v as any).toMillis) return (v as Timestamp).toMillis();
  return undefined;
}

export function useRechargeHistory(maxItems = 30) {
  const { user } = useAuth();
  const [items, setItems] = useState<RechargeHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setItems([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "users", user.uid, "rechargeHistory"),
      orderBy("createdAt", "desc"),
      limit(maxItems)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            ...data,
            createdAt: toMillis(data.createdAt),
          } as RechargeHistoryItem;
        });
        setItems(list);
        setLoading(false);
      },
      (e) => {
        console.error("useRechargeHistory:", e);
        setError(e?.message || "Erreur chargement historique");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user?.uid, maxItems]);

  return { items, loading, error };
}
