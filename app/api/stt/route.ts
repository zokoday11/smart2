import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Nettoie le nom du modèle si nécessaire
function getModelName(envValue: string | undefined, fallback: string): string {
  const raw = (envValue || fallback).trim();
  // On accepte "gemini-2.5-flash" ou "models/gemini-2.5-flash"
  return raw.replace(/^models\//, "");
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Aucun fichier audio reçu (champ 'audio' manquant)." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");
    const mimeType = file.type || "audio/webm";

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error("[/api/stt] GEMINI_API_KEY manquant.");
      return NextResponse.json(
        { error: "GEMINI_API_KEY manquant côté serveur." },
        { status: 500 }
      );
    }

    // Modèle audio (configurable via env)
    const configuredModel = getModelName(
      process.env.GEMINI_STT_MODEL,
      "gemini-2.5-flash"
    );

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${configuredModel}:generateContent?key=${apiKey}`;

    const prompt =
      "Transcris mot à mot l'audio suivant en texte. " +
      "Réponds uniquement par la transcription, sans guillemets ni commentaire.";

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64,
              },
            },
          ],
        },
      ],
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const status = resp.status;
    const bodyText = await resp.text().catch(() => "");

    if (!resp.ok) {
      console.error("Erreur Gemini STT:", status, bodyText);

      if (status === 429) {
        return NextResponse.json(
          {
            error:
              "Quota Gemini STT dépassé. Réessaie un peu plus tard.",
          },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: `Erreur Gemini (${status})` },
        { status: 500 }
      );
    }

    let data: any;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return NextResponse.json(
        { error: "Réponse invalide de Gemini (JSON)" },
        { status: 500 }
      );
    }

    const transcript: string =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text || "")
        .join("")
        .trim() || "";

    return NextResponse.json({ transcript });
  } catch (err) {
    console.error("Erreur interne /api/stt:", err);
    return NextResponse.json(
      { error: "Erreur interne sur /api/stt" },
      { status: 500 }
    );
  }
}
