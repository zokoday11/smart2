// src/lib/polar.ts
import { Polar } from "@polar-sh/sdk";

const server =
  process.env.POLAR_ENV === "production" ? "production" : "sandbox";

if (!process.env.POLAR_ACCESS_TOKEN) {
  throw new Error("POLAR_ACCESS_TOKEN manquant dans .env");
}

// Instance Polar
export const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  // @ts-ignore : selon la version du SDK, server peut être optionnel
  server,
});

// ⚠️ Packs alignés avec ton UI : 20 / 50 / 100 crédits
export type CreditPackId = "20" | "50" | "100";

// ✅ IDs produits liés aux packs, alimentés par tes variables d'env
const PACK_TO_PRODUCT_ID: Record<CreditPackId, string> = {
  "20": process.env.POLAR_PRODUCT_20_ID ?? "",
  "50": process.env.POLAR_PRODUCT_50_ID ?? "",
  "100": process.env.POLAR_PRODUCT_100_ID ?? "",
};

function getProductIdForPack(packId: CreditPackId): string {
  const productId = PACK_TO_PRODUCT_ID[packId];
  if (!productId) {
    throw new Error(
      `Aucun POLAR_PRODUCT_${packId}_ID configuré dans les variables d'env pour le pack "${packId}".`
    );
  }
  return productId;
}

interface CreateCheckoutOptions {
  packId: CreditPackId;
  userId: string;
  email: string;
}

/**
 * Crée un checkout Polar pour un pack de crédits et renvoie l'URL de paiement.
 * Fonctionne autant en sandbox qu'en production (selon POLAR_ENV + les IDs).
 * Cette URL sera utilisée dans l'Embedded Checkout (pop-up dans ton site).
 */
export async function createPolarCheckout(options: CreateCheckoutOptions) {
  const { packId, userId, email } = options;

  const productId = getProductIdForPack(packId);

  const baseAppUrl =
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // 👉 utilisé pour la redirection *si tu laisses Polar rediriger*
  const successUrl = `${baseAppUrl}/app/credits?status=success&pack=${packId}`;
  const returnUrl = `${baseAppUrl}/app/credits?status=cancel`;

  // 👉 très important pour l'Embedded Checkout
  // Polar docs : embed_origin = origin de la page qui intègre le checkout :contentReference[oaicite:1]{index=1}
  const embedOrigin = baseAppUrl; // NEXT_PUBLIC_APP_URL doit être du style https://mon-site.com

  console.log("[Polar] Création checkout", {
    env: process.env.POLAR_ENV,
    packId,
    productId,
    userId,
    email,
    successUrl,
    returnUrl,
    embedOrigin,
  });

  const payload: any = {
    products: [productId],
    success_url: successUrl,
    return_url: returnUrl,
    embed_origin: embedOrigin,
    customer_email: email, // ⚠️ vrai email
    external_customer_id: userId,

    allow_discount_codes: true,
    require_billing_address: false,
    allow_trial: true,
    is_business_customer: false,
  };

  const checkout = await (polar as any).checkouts.create(payload);

  if (!checkout?.url) {
    console.error(
      "[Polar] Checkout créé mais pas d'URL dans la réponse:",
      checkout
    );
    throw new Error("Checkout Polar créé mais URL manquante.");
  }

  console.log("[Polar] Checkout URL:", checkout.url);

  return {
    url: checkout.url as string,
    checkout,
  };
}
