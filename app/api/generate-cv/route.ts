import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// URL de ta Cloud Function Google
const UPSTREAM =
  process.env.GENERATE_LETTER_UPSTREAM ||
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterAndPitch";

export async function POST(req: Request) {
  try {
    // 1. Récupération des headers (Auth + Recaptcha)
    const auth = req.headers.get("authorization") || "";
    const headerRecaptcha = req.headers.get("x-recaptcha-token") || "";

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Body JSON invalide." }, { status: 400 });
    }

    // 2. Support recaptcha dans header OU body
    const bodyRecaptcha =
      typeof body?.recaptchaToken === "string" ? body.recaptchaToken : "";
    const recaptcha = headerRecaptcha || bodyRecaptcha;

    // 3. Appel Cloud Function (Server-to-Server)
    const upstreamRes = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}), // On transmet le token
        ...(recaptcha ? { "X-Recaptcha-Token": recaptcha } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    // 4. Renvoi de la réponse
    const contentType =
      upstreamRes.headers.get("content-type") || "application/json";
    const text = await upstreamRes.text();

    return new NextResponse(text, {
      status: upstreamRes.status,
      headers: { "Content-Type": contentType },
    });
  } catch (e: any) {
    console.error("API /generateLetterAndPitch error:", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}