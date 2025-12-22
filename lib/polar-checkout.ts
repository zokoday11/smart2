// src/lib/polar-checkout.ts
import { polar } from "@/lib/polar";

// Mappe les packs utilisés dans ton app vers les Product IDs Polar
// Ici on suppose trois packs : 10, 20, 30 crédits
const PACK_TO_PRODUCT_ID: Record<string, string> = {
  "10": process.env.POLAR_PRODUCT_10_ID || "",
  "20": process.env.POLAR_PRODUCT_20_ID || "",
  "30": process.env.POLAR_PRODUCT_30_ID || "",
};

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://assistant-ia-v4.web.app";

export type CreditPackId = "10" | "20" | "30";

export interface CreateCheckoutOptions {
  customerEmail?: string;
  externalCustomerId?: string; // ex: id utilisateur (Firebase, Supabase, etc.)
}

/**
 * Crée une session de paiement Polar pour un pack donné.
 *
 * @param packId - "10", "20" ou "30" (nombre de crédits du pack)
 * @param opts - infos client (email, id externe)
 */
export async function createPolarCheckout(
  packId: CreditPackId,
  opts?: CreateCheckoutOptions
) {
  const productId = PACK_TO_PRODUCT_ID[packId];

  if (!productId) {
    throw new Error(
      `Pack inconnu côté Polar : "${packId}". Vérifie PACK_TO_PRODUCT_ID dans src/lib/polar-checkout.ts`
    );
  }

  // Polar remplace {CHECKOUT_ID} par l'id réel du checkout
  const successUrl = `${APP_URL}/paiement/success?checkout_id={CHECKOUT_ID}`;
  const returnUrl = `${APP_URL}/paiement/canceled`;

  const checkout = await polar.checkouts.create({
    products: [productId],
    successUrl,
    returnUrl,
    customerEmail: opts?.customerEmail,
    externalCustomerId: opts?.externalCustomerId,
  });

  if (!checkout.url) {
    throw new Error("Polar n'a pas renvoyé d'URL de checkout");
  }

  return { url: checkout.url };
}
