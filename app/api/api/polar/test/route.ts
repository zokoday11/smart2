// src/app/api/polar/test/route.ts
import { NextResponse } from "next/server";
import { polar } from "@/lib/polar";

export async function GET() {
  try {
    // Appel simple à l'API Polar en prod
    const result = await polar.products.list({});

    // On renvoie directement ce que Polar renvoie,
    // sans essayer de boucler ni de faire des "..."
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("Erreur Polar test (prod):", error);
    return NextResponse.json(
      {
        ok: false,
        message:
          "Erreur d'appel à Polar (prod). Vérifie POLAR_ACCESS_TOKEN si ça persiste.",
        detail: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}
