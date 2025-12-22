"use client";

import { useUserCredits } from "@/hooks/useUserCredits";

export function CreditsBadge() {
  const { credits, loading } = useUserCredits();

  return (
    <div className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--ink)]">
      <span className="text-[13px]">⚡</span>
      {loading ? (
        <span className="opacity-70">Chargement…</span>
      ) : (
        <span>
          <span className="font-semibold">{credits}</span> crédits
        </span>
      )}
    </div>
  );
}
