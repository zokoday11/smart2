"use client";

import { useEffect } from "react";
import PaymentHeader from "./PaymentHeader";

export default function PolarCheckoutModal({ open, url, onClose, onDone }) {
  useEffect(() => {
    if (!open) return;

    function handleMessage(e) {
      // On accepte uniquement les messages venant de NOTRE domaine
      if (e.origin !== window.location.origin) return;

      const data = e.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "POLAR_CHECKOUT_DONE") return;

      onDone?.(data.status);
      onClose?.();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [open, onClose, onDone]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <PaymentHeader onClose={onClose} />

        <div className="h-[80vh] bg-white">
          {url ? (
            <iframe
              title="Polar checkout"
              src={url}
              className="h-full w-full"
              allow="payment *"
            />
          ) : (
            <div className="p-4 text-sm">Chargement…</div>
          )}
        </div>
      </div>
    </div>
  );
}
