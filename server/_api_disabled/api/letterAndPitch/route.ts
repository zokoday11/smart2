// app/api/letterAndPitch/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getModelPath(envValue: string | undefined, fallback: string): string {
  const raw = (envValue || fallback).trim();
  return raw.startsWith("models/") ? raw : `models/${raw}`;
}

// Base Cloud Functions pour vérifier reCAPTCHA côté serveur
const DEFAULT_API_BASE =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net";
const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  DEFAULT_API_BASE
).replace(/\/+$/, "");

async function verifyRecaptchaServer(token: string, action: string) {
  const res = await fetch(`${API_BASE}/recaptchaVerify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action: (action || "").trim().toLowerCase() }),
    cache: "no-store",
  });

  const data: any = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.ok === true, data };
}

// Helper: enlève ```json ... ``` si besoin
function extractJson(text: string): any | null {
  if (!text) return null;
  let t = text.trim();

  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
  }

  try {
    return JSON.parse(t);
  } catch {
    const match = t.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      profile,
      jobTitle = "",
      companyName = "",
      jobDescription = "",
      lang = "fr",
      recaptchaToken,
    } = body || {};

    // ✅ Vérif reCAPTCHA (anti-bypass)
    const check = await verifyRecaptchaServer(
      String(recaptchaToken || ""),
      "generate_letter_pitch"
    );
    if (!check.ok) {
      return NextResponse.json(
        { error: "reCAPTCHA refusé", details: check.data },
        { status: 403 }
      );
    }

    if (!profile) {
      return NextResponse.json({ error: "Missing profile" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[letterAndPitch] GEMINI_API_KEY manquant → mode démo.");
      return NextResponse.json({
        coverLetter:
          lang === "en"
            ? "Demo mode: here would be a tailored cover letter based on your CV and the job description."
            : "Mode démo : ici apparaîtrait une lettre de motivation personnalisée à partir de ton CV et de l'offre.",
        pitch:
          lang === "en"
            ? "Demo mode: here would be a short elevator pitch summarizing your profile for this job."
            : "Mode démo : ici apparaîtrait un court pitch d’ascenseur résumant ton profil pour ce poste.",
        lang,
      });
    }

    const model = getModelPath(process.env.GEMINI_MODEL, "gemini-2.5-flash");
    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

    const profileJson = JSON.stringify(profile ?? {}).slice(0, 20000);

    const prompt = `
Tu es un assistant expert en candidatures.

À partir :
- du profil CV du candidat (en JSON),
- du poste visé (intitulé, entreprise),
- et d'éventuels extraits d'annonce,

tu dois produire :
1) une lettre de motivation complète (1 page max) prête à être envoyée,
2) un pitch d'ascenseur de 2 à 4 phrases pour se présenter rapidement.

Langue de sortie : ${lang === "en" ? "anglais" : "français"}.

Réponds STRICTEMENT au format JSON suivant, sans aucun texte avant ou après :

{
  "coverLetter": "string",
  "pitch": "string",
  "lang": "fr"
}

Où "lang" est "fr" ou "en".

Profil CV (JSON) :
${profileJson}

Informations sur le poste :
- Intitulé : ${jobTitle}
- Entreprise : ${companyName}
- Description / extraits d'annonce : ${jobDescription}
`.trim();

    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "");
      console.error("Gemini error (letterAndPitch):", resp.status, errorText);

      if (resp.status === 429) {
        return NextResponse.json({
          coverLetter:
            lang === "en"
              ? "Demo mode (quota exceeded): here is a short sample cover letter. Please try again later when the quota is reset."
              : "Mode démo (quota dépassé) : voici un exemple de lettre. Réessaie plus tard quand le quota sera réinitialisé.",
          pitch:
            lang === "en"
              ? "Demo mode (quota exceeded): here is a sample elevator pitch."
              : "Mode démo (quota dépassé) : voici un exemple de pitch d’ascenseur.",
          lang,
        });
      }

      return NextResponse.json({ error: "Gemini call failed" }, { status: 500 });
    }

    const data = await resp.json().catch(() => null);

    const textRaw: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text || "")
        .join("")
        .trim() || "";

    if (!textRaw) {
      console.error("Empty Gemini response (letterAndPitch):", data);
      return NextResponse.json({
        coverLetter:
          lang === "en"
            ? "Based on your experience and this role, explain in 3–4 paragraphs why you are a good fit."
            : "En te basant sur ton expérience et ce poste, explique en 3–4 paragraphes pourquoi tu es un bon profil.",
        pitch:
          lang === "en"
            ? "Summarize your profile in 2–3 sentences as if you were introducing yourself at the start of an interview."
            : "Résume ton profil en 2–3 phrases comme si tu te présentais en début d’entretien.",
        lang,
      });
    }

    const parsed = extractJson(textRaw);

    const coverLetter =
      typeof parsed?.coverLetter === "string" ? parsed.coverLetter.trim() : "";
    const pitch =
      typeof parsed?.pitch === "string" ? parsed.pitch.trim() : "";
    const outLang = typeof parsed?.lang === "string" ? parsed.lang : lang;

    if (!coverLetter && !pitch) {
      console.error("letterAndPitch: JSON non exploitable, texte brut :", textRaw);
      return NextResponse.json({
        coverLetter:
          lang === "en"
            ? "Based on your CV and this job, write a motivation letter explaining why you are a good match."
            : "À partir de ton CV et de cette offre, rédige une lettre de motivation expliquant pourquoi tu corresponds au poste.",
        pitch:
          lang === "en"
            ? "Give a short pitch (2–4 sentences) summarizing your profile for this job."
            : "Donne un court pitch (2–4 phrases) résumant ton profil pour ce poste.",
        lang,
      });
    }

    return NextResponse.json({ coverLetter, pitch, lang: outLang });
  } catch (err) {
    console.error("letterAndPitch API error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
