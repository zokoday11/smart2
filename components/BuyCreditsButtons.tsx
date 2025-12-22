// src/components/BuyCreditsButtons.tsx
"use client";

import { useState } from "react";

type CreditPackId = "10" | "20" | "30";

interface BuyCreditsButtonsProps {
  user: {
    id: string;
    email: string;
  };
}

export function BuyCreditsButtons({ user }: BuyCreditsButtonsProps) {
  const [loadingPack, setLoadingPack] = useState<CreditPackId | null>(null);

  const handleBuy = async (packId: CreditPackId) => {
    try {
      setLoadingPack(packId);

      const res = await fetch("/api/polar/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId,
          email: user.email,
          userId: user.id,
        }),
      });

      const data = await res.json();

      if (!data.ok || !data.url) {
        console.error("Erreur réponse API Polar:", data);
        alert("Erreur lors de la création du paiement.");
        return;
      }

      // Redirection vers la page de paiement Polar
      window.location.href = data.url;
    } catch (error) {
      console.error("Erreur handleBuy:", error);
      alert("Une erreur est survenue.");
    } finally {
      setLoadingPack(null);
    }
  };

  const isLoading = (pack: CreditPackId) => loadingPack === pack;

  return (
    <div className="flex flex-col gap-3">
      <button onClick={() => handleBuy("10")} disabled={isLoading("10")}>
        {isLoading("10") ? "Redirection..." : "Acheter 10 crédits"}
      </button>
      <button onClick={() => handleBuy("20")} disabled={isLoading("20")}>
        {isLoading("20") ? "Redirection..." : "Acheter 20 crédits"}
      </button>
      <button onClick={() => handleBuy("30")} disabled={isLoading("30")}>
        {isLoading("30") ? "Redirection..." : "Acheter 30 crédits"}
      </button>
    </div>
  );
}
