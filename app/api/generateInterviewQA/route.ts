// app/api/generateInterviewQA/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Petit helper pour récupérer un JSON même si Gemini met des ```json ... ```
function extractJson(text: string): any | null {
  if (!text) return null;

  let t = text.trim();

  // Si Gemini renvoie ```json ... ```
  if (t.startsWith("```")) {
    // retire ```json ou ``` et la dernière ```
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
  }

  // 1ère tentative : parser tout
  try {
    return JSON.parse(t);
  } catch {
    // ignore, on tente plus bas
  }

  // 2ème tentative : chercher le premier bloc {...}
  const match = t.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // toujours pas bon
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { profile, experienceIndex, lang = "fr" } = body;

    if (!profile || typeof experienceIndex !== "number") {
      return NextResponse.json(
        { error: "Missing profile or experienceIndex" },
        { status: 400 }
      );
    }

    const experiences: any[] =
      (profile.experiences as any[]) ||
      (profile.experience as any[]) ||
      [];

    const exp = experiences[experienceIndex];
    if (!exp) {
      return NextResponse.json(
        { error: "Experience not found" },
        { status: 404 }
      );
    }

    const bullets = Array.isArray(exp.bullets)
      ? exp.bullets.join("\n- ")
      : "";

    const prompt = `
Tu es un coach d'entretien. Génère 5 questions d'entretien pour le candidat,
basées sur cette expérience de son CV, avec des réponses de qualité.

Tu dois renvoyer STRICTEMENT un objet JSON valide, sans aucun texte avant ou après.

Format de sortie EXACT :
{
  "questions": [
    {
      "question": "string",
      "answer": "string"
    }
  ]
}

Pas de commentaires, pas de texte hors de cet objet JSON.

Langue : ${lang === "en" ? "anglais" : "français"}.

Expérience :
- Poste : ${exp.role || exp.title || ""}
- Entreprise : ${exp.company || ""}
- Lieu : ${exp.city || exp.location || ""}
- Dates : ${exp.dates || ""}

Missions / résultats :
- ${bullets}
    `.trim();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[generateInterviewQA] GEMINI_API_KEY manquant → mode démo.");
      // Fallback démo simple
      return NextResponse.json({
        questions: [
          {
            question:
              lang === "en"
                ? "Tell me about a challenge in this role and how you handled it."
                : "Parle-moi d’un défi que tu as rencontré sur ce poste et comment tu l’as géré.",
            answer:
              lang === "en"
                ? "Sample answer here…"
                : "Exemple de réponse ici…",
          },
        ],
        lang,
      });
    }

    const model =
      process.env.GEMINI_MODEL || "models/gemini-2.5-flash";

    const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      // >>> IMPORTANT : on force une réponse en JSON pur
      generationConfig: {
        response_mime_type: "application/json",
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(
        "Gemini error (generateInterviewQA):",
        resp.status,
        errorText
      );

      if (resp.status === 429) {
        console.warn(
          "[generateInterviewQA] Quota Gemini dépassé → fallback démo."
        );
        return NextResponse.json({
          questions: [
            {
              question:
                lang === "en"
                  ? "Demo mode (quota exceeded): what did you learn in this experience?"
                  : "Mode démo (quota dépassé) : qu’as-tu appris dans cette expérience ?",
              answer:
                lang === "en"
                  ? "Sample answer here…"
                  : "Exemple de réponse ici…",
            },
          ],
          lang,
        });
      }

      return NextResponse.json(
        { error: "Gemini call failed" },
        { status: 500 }
      );
    }

    const data = await resp.json();

    const textRaw: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text || "")
        .join("")
        .trim() || "";

    if (!textRaw) {
      console.error("Empty Gemini response (generateInterviewQA):", data);
      // On ne jette plus une 500, on renvoie un fallback propre
      return NextResponse.json({
        questions: [
          {
            question:
              lang === "en"
                ? "Based on this experience, what are you most proud of?"
                : "De quoi es-tu le plus fier dans cette expérience ?",
            answer:
              lang === "en"
                ? "Sample answer here…"
                : "Exemple de réponse ici…",
          },
        ],
        lang,
      });
    }

    const parsed = extractJson(textRaw);

    if (!parsed || !Array.isArray(parsed.questions)) {
      console.error(
        "JSON parse error generateInterviewQA: texte non exploitable",
        textRaw
      );
      // Toujours un fallback pour ne plus avoir de 500 côté front
      return NextResponse.json({
        questions: [
          {
            question:
              lang === "en"
                ? "Tell me about this role and your main responsibilities."
                : "Parle-moi de ce poste et de tes principales responsabilités.",
            answer:
              lang === "en"
                ? "Sample answer here…"
                : "Exemple de réponse ici…",
          },
        ],
        lang,
      });
    }

    // On force la langue si absente
    if (!parsed.lang) {
      parsed.lang = lang;
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("generateInterviewQA API error:", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
