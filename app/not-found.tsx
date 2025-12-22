"use client";

import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

export default function NotFound() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--ink)] px-4">
      <div className="glass max-w-md w-full p-6 border border-[var(--border)]/80 text-center">
        <h1 className="text-xl font-semibold mb-2">Page introuvable</h1>
        <p className="text-sm text-[var(--muted)] mb-4">
          Le lien que tu as suivi est invalide ou cette page n&apos;existe pas.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/" className="btn-secondary text-xs sm:text-sm">
            Retour à l&apos;accueil
          </Link>
          {user && (
            <Link href="/app" className="btn-primary text-xs sm:text-sm">
              Aller au dashboard
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
