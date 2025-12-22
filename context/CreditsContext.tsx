"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
// TODO: brancher Firestore pour écouter les crédits en temps réel

interface CreditsContextValue {
  credits: number | null;
}

const CreditsContext = createContext<CreditsContextValue>({
  credits: null
});

export function CreditsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setCredits(null);
      return;
    }
    // TODO: écouter doc Firestore "users/{uid}" et lire le champ credits
  }, [user]);

  return (
    <CreditsContext.Provider value={{ credits }}>
      {children}
    </CreditsContext.Provider>
  );
}

export const useCredits = () => useContext(CreditsContext);
