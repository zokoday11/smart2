// app/api/generateLetterAndPitch/route.ts

import { NextResponse } from "next/server";

const CF_LETTER_AND_PITCH_URL =
  process.env.FUNCTIONS_BASE_URL
    ? `${process.env.FUNCTIONS_BASE_URL}/generateLetterAndPitch`
    : "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterAndPitch";

export async function POST(req: Request) {
  // 1) On récupère le body envoyé par ton front
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
    // 2) On prépare les headers pour la Cloud Function
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // 👉 On propage l'Authorization si ton front en envoie une (idToken Firebase)
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    // 👉 On propage aussi éventuellement le header reCAPTCHA s’il existe
    const recaptchaHeader = req.headers.get("x-recaptcha-token");
    if (recaptchaHeader) {
      headers["X-Recaptcha-Token"] = recaptchaHeader;
    }

    // 3) Appel de la Cloud Function réelle
    const cfRes = await fetch(CF_LETTER_AND_PITCH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const contentType = cfRes.headers.get("content-type") || "";
    const status = cfRes.status;

    // 4) Si la fonction ne renvoie pas du JSON → on renvoie une erreur lisible
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

    // 5) Si la Cloud Function renvoie une erreur HTTP → on la propage
    if (!cfRes.ok) {
      return NextResponse.json(
        json || { error: "Erreur backend generateLetterAndPitch" },
        { status }
      );
    }

    // 6) Succès → on renvoie directement la réponse JSON au front
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
