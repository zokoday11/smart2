// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import {
  validateEvent,
  WebhookVerificationError,
  WebhookHeaders,
} from "@polar-sh/sdk/webhooks";
import {
  addCreditsToUserById,
  addCreditsToUserByEmail,
} from "@/lib/credits";

export const runtime = "nodejs";

// ✅ mapping product_id -> crédits (depuis tes .env)
const PRODUCT_ID_TO_CREDITS: Record<string, number> = {};

if (process.env.POLAR_PRODUCT_20_ID) {
  PRODUCT_ID_TO_CREDITS[process.env.POLAR_PRODUCT_20_ID] = 20;
}
if (process.env.POLAR_PRODUCT_50_ID) {
  PRODUCT_ID_TO_CREDITS[process.env.POLAR_PRODUCT_50_ID] = 50;
}
if (process.env.POLAR_PRODUCT_100_ID) {
  PRODUCT_ID_TO_CREDITS[process.env.POLAR_PRODUCT_100_ID] = 100;
}

// GET juste pour tester depuis le navigateur
export async function GET() {
  return NextResponse.json({
    ok: true,
    env: process.env.POLAR_ENV,
    mappedProducts: PRODUCT_ID_TO_CREDITS,
    message:
      "Endpoint webhook Polar OK. Utilisé en POST par Polar, pas en GET par le navigateur.",
  });
}

// Webhook POST appelé par Polar
export async function POST(req: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error("POLAR_WEBHOOK_SECRET manquant");
    return new NextResponse("Config manquante", { status: 500 });
  }

  // 1) Body brut (texte) pour la vérification de signature
  const body = await req.text();

  // 2) Headers envoyés par Polar
  const headers: WebhookHeaders = {
    "webhook-id": req.headers.get("webhook-id") ?? "",
    "webhook-timestamp": req.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": req.headers.get("webhook-signature") ?? "",
  };

  let event: any;
  try {
    // 3) Vérifier la signature + parser l'event
    event = validateEvent(body, headers, secret);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error("Signature Polar invalide");
      return new NextResponse("Signature invalide", { status: 403 });
    }
    console.error("Erreur webhook Polar:", error);
    return new NextResponse("Erreur interne", { status: 500 });
  }

  console.log("📬 Webhook Polar reçu:", event.type);

  // 4) Gestion des événements
  switch (event.type) {
    case "order.paid": {
      const data = event.data;

      console.log("💰 order.paid data brut:", JSON.stringify(data, null, 2));

      const productId = data.product_id as string | undefined;
      const creditsToAdd =
        (productId && PRODUCT_ID_TO_CREDITS[productId]) ?? 0;

      const externalId: string | undefined =
        (data.customer?.external_id as string | undefined) ?? undefined;
      const email: string | undefined =
        (data.customer?.email as string | undefined) ?? undefined;

      console.log("👤 Client pour crédit:", {
        productId,
        creditsToAdd,
        externalId,
        email,
      });

      if (creditsToAdd > 0) {
        try {
          if (externalId) {
            await addCreditsToUserById(externalId, creditsToAdd);
          } else if (email) {
            await addCreditsToUserByEmail(email, creditsToAdd);
          } else {
            console.warn(
              "⚠️ Aucun externalId ni email dans l'order.paid, impossible de créditer l'utilisateur."
            );
          }
        } catch (e) {
          console.error("Erreur lors de l'ajout de crédits Firestore:", e);
          // On n'échoue pas le webhook : Polar considère le paiement OK
        }
      } else {
        console.log(
          "Produit non mappé dans PRODUCT_ID_TO_CREDITS, aucun crédit ajouté."
        );
      }

      break;
    }

    default:
      console.log("Event non géré explicitement:", event.type);
  }

  // 5) Réponse OK pour Polar
  return NextResponse.json({ received: true });
}
