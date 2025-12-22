"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

type CreditsState = {
  credits: number;
  loading: boolean;
  error: string | null;
};

export function useUserCredits(): CreditsState {
  const { user } = useAuth();
  const [credits, setCredits] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // reset à chaque changement d'user
    setError(null);

    if (!user?.uid) {
      setCredits(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    const ref = doc(db, "users", user.uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : {};
        const value = typeof data?.credits === "number" ? data.credits : 0;

        setCredits(value);
        setLoading(false);
      },
      (err) => {
        console.error("Erreur Firestore (credits):", err);
        setError("Impossible de charger les crédits.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user?.uid]);

  return { credits, loading, error };
}
