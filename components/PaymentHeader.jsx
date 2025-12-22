"use client";

import { useEffect } from "react";

export default function PaymentHeader({ onClose, autoCloseMs = 0 }) {
  useEffect(() => {
    if (!autoCloseMs) return;
    const t = setTimeout(() => onClose?.(), autoCloseMs);
    return () => clearTimeout(t);
  }, [autoCloseMs, onClose]);

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]/70 bg-[var(--bg-soft)]/80">
      <div className="flex flex-col">
        <span className="text-[12px] font-semibold text-[var(--ink)]">
          Paiement sécurisé
        </span>
        <span className="text-[11px] text-[var(--muted)]">
          Transaction gérée par Polar (Stripe)
        </span>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="text-[11px] rounded-full border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg)]"
        aria-label="Fermer"
      >
        ✕
      </button>
    </div>
  );
}
