// components/BlockedOverlay.tsx
"use client";

import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";

/**
 * Affiche un overlay pleine page si le user est marqué "blocked" dans Firestore.
 * Résultat : impossible de cliquer / utiliser l'app.
 */
export default function BlockedOverlay() {
  const { user } = useAuth();
  const { profile, loading } = useUserProfile();

  // pas connecté ou encore en chargement -> pas d'overlay
  if (!user || loading) return null;

  if (!profile?.blocked) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="max-w-md w-full glass border border-red-500/40 rounded-2xl p-6 text-center">
        <h2 className="text-lg font-semibold mb-2 text-red-100">
          Accès bloqué
        </h2>
        <p className="text-xs text-[var(--muted)] mb-4">
          Ton compte a été temporairement bloqué par l&apos;administration.
          Tu ne peux plus utiliser l&apos;assistant tant que le blocage est
          actif.
        </p>
        <p className="text-[11px] text-[var(--muted)] mb-4">
          Si tu penses qu&apos;il s&apos;agit d&apos;une erreur, contacte le
          support ou l&apos;administrateur.
        </p>
        <p className="text-[10px] text-[var(--muted)]/70">
          ID utilisateur :{" "}
          <span className="font-mono">
            {profile.id.slice(0, 8)}…
          </span>
        </p>
      </div>
    </div>
  );
}
