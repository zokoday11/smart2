// src/app/api/polar/checkout/route.ts
// @ts-nocheck
import { NextRequest, NextResponse } from "next/server";
import { createPolarCheckout, CreditPackId } from "@/lib/polar";

// Cette route tourne en mode node en dev / en mode serveur
export const runtime = "nodejs";
// ⚠️ NE PAS mettre `export const dynamic = "force-dynamic"` ici en output: "export"

export async function POST(req: NextRequest) {
  try {
    let body: any = null;
    try {
      body = await req.json();
    } catch (e) {
      console.error("[/api/polar/checkout] Body non JSON ou vide");
      return NextResponse.json(
        {
          ok: false,
          error: "Body JSON invalide pour /api/polar/checkout.",
        },
        { status: 400 }
      );
    }

    const packId = body.packId as CreditPackId | undefined;
    const userId = body.userId as string | undefined;
    const email = body.email as string | undefined;

    console.log("[/api/polar/checkout] body reçu :", body);

    if (!packId || !userId || !email) {
      console.error("[/api/polar/checkout] Paramètres manquants", {
        packId,
        userId,
        email,
      });
      return NextResponse.json(
        {
          ok: false,
          error:
            "Paramètres manquants. Il faut packId ('20' | '50' | '100'), userId et email.",
        },
        { status: 400 }
      );
    }

    // Vérif rapide des variables d'env
    if (!process.env.POLAR_ACCESS_TOKEN) {
      console.error("[/api/polar/checkout] POLAR_ACCESS_TOKEN manquant");
      return NextResponse.json(
        {
          ok: false,
          error: "Config Polar manquante (POLAR_ACCESS_TOKEN).",
        },
        { status: 500 }
      );
    }

    const { url } = await createPolarCheckout({
      packId,
      userId,
      email,
    });

    console.log("[/api/polar/checkout] Checkout créé, URL :", url);

    // Toujours renvoyer du JSON
    return NextResponse.json({ ok: true, url }, { status: 200 });
  } catch (error: any) {
    console.error("[/api/polar/checkout] ERREUR :", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Erreur lors de la création du checkout Polar.",
        detail: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}
