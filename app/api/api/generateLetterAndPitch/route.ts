// app/api/generateLetterAndPitch/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CF_LETTER_AND_PITCH_URL =
  process.env.FUNCTIONS_BASE_URL
    ? `${process.env.FUNCTIONS_BASE_URL}/generateLetterAndPitch`
    : "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterAndPitch";

// --------------------
// Helpers (server)
// --------------------
function safeText(v: any) {
  return String(v ?? "").trim();
}

function cleanGeneratedLetter(raw: string): string {
  if (!raw) return "";
  let txt = String(raw);

  txt = txt.replace(/<\/?body[^>]*>/gi, "");
  txt = txt.replace(/<\/?html[^>]*>/gi, "");
  txt = txt.replace(/<\/?head[^>]*>[\s\S]*?<\/head>/gi, "");
  txt = txt.replace(/<\/?[^>]+>/g, "");

  return txt.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractBodyFromLetterText(letterText: string, lang: "fr" | "en", fullName?: string) {
  const raw = safeText(letterText);
  if (!raw) return "";

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return raw;

  const first = lines[0].toLowerCase();
  const isGreeting =
    (lang === "fr" && (first.startsWith("madame") || first.startsWith("bonjour"))) ||
    (lang === "en" && (first.startsWith("dear") || first.startsWith("hello")));

  if (isGreeting) lines.shift();

  while (lines.length) {
    const last = lines[lines.length - 1].toLowerCase();

    if (
      last.includes("cordialement") ||
      last.includes("bien cordialement") ||
      last.includes("salutations") ||
      last.includes("sincerely") ||
      last.includes("best regards") ||
      last.includes("kind regards")
    ) {
      lines.pop();
      continue;
    }

    if (fullName && last.includes(fullName.toLowerCase())) {
      lines.pop();
      continue;
    }

    break;
  }

  return lines.join("\n\n").trim() || raw;
}

// --------------------
// Route
// --------------------
export async function POST(req: Request) {
  // 1) Parse JSON
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide." }, { status: 400 });
  }

  try {
    // 2) Headers vers Cloud Function
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const authHeader = req.headers.get("authorization");
    if (authHeader) headers["Authorization"] = authHeader;

    // ✅ reCAPTCHA : body OU header (front envoie souvent dans le body)
    const recaptchaFromHeader =
      req.headers.get("x-recaptcha-token") || req.headers.get("X-Recaptcha-Token");

    const recaptchaFromBody = typeof body?.recaptchaToken === "string" ? body.recaptchaToken.trim() : "";

    const recaptchaToken = recaptchaFromBody || recaptchaFromHeader || "";
    if (recaptchaToken) headers["X-Recaptcha-Token"] = recaptchaToken;

    // optionnel mais propre : ne pas forward le token dans le body si la CF attend un header
    if (body && "recaptchaToken" in body) delete body.recaptchaToken;

    // 3) Timeout (évite req qui pend)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    const cfRes = await fetch(CF_LETTER_AND_PITCH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    const status = cfRes.status;
    const contentType = cfRes.headers.get("content-type") || "";

    // 4) Si pas JSON -> erreur explicite
    if (!contentType.includes("application/json")) {
      const text = await cfRes.text().catch(() => "");
      return NextResponse.json(
        {
          error: "La Cloud Function generateLetterAndPitch ne renvoie pas de JSON.",
          status,
          rawBody: text.slice(0, 800),
        },
        { status: status || 500 }
      );
    }

    const json = await cfRes.json().catch(() => null);

    // 5) Propager erreur backend CF
    if (!cfRes.ok) {
      return NextResponse.json(json || { error: "Erreur backend generateLetterAndPitch" }, { status });
    }

    // 6) ✅ Normalisation : garantir letterBody côté front
    // - si la CF renvoie déjà letterBody : on le clean
    // - sinon fallback coverLetter -> on extrait un body propre
    const lang = (body?.lang === "en" ? "en" : "fr") as "fr" | "en";
    const fullName = safeText(body?.profile?.fullName);

    const apiLetterBody = typeof json?.letterBody === "string" ? json.letterBody : "";
    const apiCoverLetter = typeof json?.coverLetter === "string" ? json.coverLetter : "";

    const cleanedPrimary = cleanGeneratedLetter(apiLetterBody || apiCoverLetter);
    const bodyOnly = extractBodyFromLetterText(cleanedPrimary, lang, fullName);

    const out = {
      ...json,
      // ✅ on force un champ stable
      letterBody: bodyOnly || cleanedPrimary || "",
      // (optionnel) on garde coverLetter intact si tu l’utilises ailleurs
      coverLetter: typeof json?.coverLetter === "string" ? json.coverLetter : apiCoverLetter || "",
    };

    return NextResponse.json(out, { status });
  } catch (e: any) {
    const isAbort = e?.name === "AbortError";
    console.error("Erreur proxy /api/generateLetterAndPitch :", e);

    return NextResponse.json(
      {
        error: isAbort
          ? "Timeout lors de l'appel à generateLetterAndPitch."
          : "Erreur interne dans la route Next /api/generateLetterAndPitch (proxy).",
        details: e?.message ?? String(e),
      },
      { status: isAbort ? 504 : 500 }
    );
  }
}
