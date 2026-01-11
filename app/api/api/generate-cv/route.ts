import { NextResponse } from "next/server";

export const runtime = "nodejs";
// ✅ compatible avec output: "export" : on enlève force-dynamic
// export const dynamic = "force-dynamic";

const UPSTREAM =
  process.env.GENERATE_LETTER_UPSTREAM ||
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterAndPitch";

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const headerRecaptcha = req.headers.get("x-recaptcha-token") || "";

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Body JSON invalide." }, { status: 400 });
    }

    const bodyRecaptcha =
      typeof body?.recaptchaToken === "string" ? body.recaptchaToken : "";
    const recaptcha = headerRecaptcha || bodyRecaptcha;

    const upstreamRes = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: auth } : {}),
        ...(recaptcha ? { "X-Recaptcha-Token": recaptcha } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

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
