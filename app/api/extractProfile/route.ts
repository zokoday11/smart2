import { NextResponse } from "next/server";

const UPSTREAM =
  process.env.EXTRACT_PROFILE_UPSTREAM ||
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/extractProfile";

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const recaptcha = req.headers.get("x-recaptcha-token") || "";

  const body = await req.json().catch(() => null);

  if (!body || !body.base64Pdf) {
    return NextResponse.json(
      { error: "Champ 'base64Pdf' manquant." },
      { status: 400 }
    );
  }

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

  const text = await upstreamRes.text();
  const contentType =
    upstreamRes.headers.get("content-type") || "application/json";

  return new NextResponse(text, {
    status: upstreamRes.status,
    headers: { "Content-Type": contentType },
  });
}
