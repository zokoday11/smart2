// components/ActivityTracker.tsx
"use client";

import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { updateLastActive } from "@/lib/userTracking";

/**
 * Composant invisible qui met à jour lastActiveAt
 * toutes les 60 secondes tant que l'utilisateur est connecté.
 * On en profite pour envoyer:
 *  - la page actuelle (path)
 *  - le device (iPhone / iPad / macOS / etc.)
 *  - l’IP + pays + ville (via userTracking)
 */
export default function ActivityTracker() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const tick = () => {
      if (!user || cancelled) return;

      const path =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : undefined;

      updateLastActive(user, {
        path,
        action: "heartbeat",
      });
    };

    // première mise à jour immédiate
    tick();
    const id = setInterval(tick, 60_000); // toutes les 60 secondes

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user]);

  return null;
}
