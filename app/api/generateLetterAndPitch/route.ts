// app/api/generateLetterAndPitch/route.ts

import { NextResponse } from "next/server";

const CF_LETTER_AND_PITCH_URL =
  process.env.FUNCTIONS_BASE_URL
    ? `${process.env.FUNCTIONS_BASE_URL}/generateLetterAndPitch`
    : "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterAndPitch";

export async function POST(req: Request) {
  // 1) Récupération du body JSON
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Corps JSON invalide." },
      { status: 400 }
    );
  }

  try {
    // 2) Préparation des headers pour la Cloud Function
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // On propage l'Authorization si le front en envoie une (idToken Firebase éventuel)
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    // On propage aussi le token reCAPTCHA en header si présent
    const recaptchaHeader =
      req.headers.get("x-recaptcha-token") ||
      req.headers.get("X-Recaptcha-Token");
    if (recaptchaHeader) {
      headers["X-Recaptcha-Token"] = recaptchaHeader;
    }

    // 3) Appel de la Cloud Function réelle
    const cfRes = await fetch(CF_LETTER_AND_PITCH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const status = cfRes.status;
    const contentType = cfRes.headers.get("content-type") || "";

    // 4) Si ce n’est pas du JSON, on renvoie un message explicite
    if (!contentType.includes("application/json")) {
      const text = await cfRes.text().catch(() => "");
      return NextResponse.json(
        {
          error:
            "La Cloud Function generateLetterAndPitch ne renvoie pas de JSON.",
          status,
          rawBody: text.slice(0, 500),
        },
        { status: status || 500 }
      );
    }

    const json = await cfRes.json().catch(() => null);

    // 5) Propager proprement l’erreur backend
    if (!cfRes.ok) {
      return NextResponse.json(
        json || { error: "Erreur backend generateLetterAndPitch" },
        { status }
      );
    }

    // 6) Succès → renvoyer le JSON directement au front
    return NextResponse.json(json, { status });
  } catch (e: any) {
    console.error("Erreur proxy /api/generateLetterAndPitch :", e);
    return NextResponse.json(
      {
        error:
          "Erreur interne dans la route Next /api/generateLetterAndPitch (proxy).",
        details: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}
