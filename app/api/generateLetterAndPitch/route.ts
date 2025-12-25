import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
// Si tu veux consommer des crédits / logs plus tard :
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

/**
 * Initialisation Firebase Admin
 */
function getAdminApp() {
  if (getApps().length) return getApps()[0];

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_ADMIN_PRIVATE_KEY;

  if (projectId && clientEmail && privateKeyRaw) {
    const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  return initializeApp({
    credential: applicationDefault(),
  });
}

/**
 * Vérifie le token Firebase envoyé par le front
 */
async function requireUser(req: NextRequest) {
  getAdminApp();

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing Authorization Bearer token",
    };
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email || "",
    };
  } catch (e) {
    console.error("verifyIdToken error:", e);
    return {
      ok: false as const,
      status: 401,
      error: "Invalid or expired token",
    };
  }
}

/**
 * Construction d’un contexte texte à partir du profil CV
 * (inspiré de ce que tu fais ailleurs)
 */
function buildProfileContext(profile: any): string {
  if (!profile) return "";

  const p = profile || {};

  const experiences = Array.isArray(p.experiences) ? p.experiences : [];
  const education = Array.isArray(p.education) ? p.education : [];
  const skillsSections =
    p.skills && Array.isArray(p.skills.sections) ? p.skills.sections : [];
  const tools = p.skills && Array.isArray(p.skills.tools) ? p.skills.tools : [];

  const xpLines = experiences
    .slice(0, 5)
    .map((xp: any, i: number) => {
      const bullets = Array.isArray(xp.bullets)
        ? xp.bullets.slice(0, 4).map((b: string) => `- ${b}`).join("\n")
        : "";
      return `XP${i + 1} : ${xp.role || xp.title || ""} @ ${xp.company || ""} (${xp.dates || ""})
${bullets}`;
    })
    .join("\n\n");

  const skillLines = skillsSections
    .slice(0, 4)
    .map((s: any) => `${s.title || ""}: ${(Array.isArray(s.items) ? s.items.slice(0, 10) : []).join(", ")}`)
    .join("\n");

  const toolsLine = tools.slice(0, 20).join(", ");

  const eduLines = education
    .slice(0, 4)
    .map(
      (e: any) =>
        `${e.degree || e.title || ""} - ${e.school || e.institution || ""} (${e.dates || ""})`
    )
    .join("\n");

  return `
NOM: ${p.fullName || p.name || ""}
EMAIL: ${p.email || ""}
TITRE: ${p.contractTypeFull || p.contractType || ""}

RÉSUMÉ:
${p.profileSummary || ""}

EXPÉRIENCES:
${xpLines}

COMPÉTENCES:
${skillLines}

OUTILS:
${toolsLine}

FORMATION:
${eduLines}

CERTIFICATIONS:
${p.certs || ""}

LANGUES:
${p.langLine || ""}

SOFT SKILLS:
${Array.isArray(p.softSkills) ? p.softSkills.join(", ") : ""}
`.trim();
}

/**
 * Appel à l’API Gemini (comme dans ton autre route)
 */
async function callGeminiText(
  prompt: string,
  apiKey: string,
  temperature = 0.7,
  maxOutputTokens = 1400
) {
  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("Gemini error:", text);
    throw new Error("Erreur Gemini: " + text);
  }

  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p: any) => (typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim();

  if (!text) throw new Error("Réponse Gemini vide");
  return text;
}

/**
 * Route POST /api/generateLetterAndPitch
 */
export async function POST(req: NextRequest) {
  // 1) Auth Firebase (token envoyé par le front)
  const auth = await requireUser(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  // 2) Lecture du body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const {
    profile,
    jobTitle = "",
    companyName = "",
    jobDescription = "",
    lang = "fr",
    // recaptchaToken, // tu peux le vérifier ici si tu veux
  } = body || {};

  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "Missing profile" },
      { status: 400 }
    );
  }

  const langNorm = String(lang).toLowerCase().startsWith("en") ? "en" : "fr";

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  if (!GEMINI_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "Missing GEMINI_API_KEY server-side" },
      { status: 500 }
    );
  }

  // 3) Contexte pour l’IA
  const profileContext = buildProfileContext(profile);

  // 4) Prompt combiné Lettre + Pitch (JSON strict)
  const prompt =
    langNorm === "en"
      ? `
You are a senior career coach and tech recruiter.

Write TWO things for a job application, using ONLY the information below.

JOB:
- Title: "${jobTitle || "the role"}"
- Company: "${companyName || "the company"}"
- Job description (may include extra instructions from the user):
${jobDescription || "—"}

CANDIDATE PROFILE (source of truth, do not invent):
${profileContext}

TASKS:
1) A strong, concrete COVER LETTER BODY (no header, no address, no signature).
   - 3 to 5 paragraphs.
   - 220 to 320 words.
   - Explicitly use 2–3 experiences, skills, and tools from the profile.
   - Tone: professional, specific, no fluff.
   - Adapt to the job and company.

2) A short ELEVATOR PITCH:
   - 2 to 4 sentences.
   - Can be used orally or in emails / LinkedIn.
   - Direct, impactful, summarising value for this role.

STRICT OUTPUT FORMAT:
Return ONLY valid JSON:
{
  "coverLetter": "...",
  "pitch": "..."
}
`.trim()
      : `
Tu es un coach carrières senior et un recruteur IT.

Rédige DEUX éléments pour une candidature, en utilisant UNIQUEMENT les infos ci-dessous.

POSTE :
- Intitulé : "${jobTitle || "le poste"}"
- Entreprise : "${companyName || "l'entreprise"}"
- Description de l'offre (peut inclure des instructions utilisateur) :
${jobDescription || "—"}

PROFIL CANDIDAT (source de vérité, ne rien inventer) :
${profileContext}

TÂCHES :
1) CORPS de LETTRE DE MOTIVATION :
   - 3 à 5 paragraphes.
   - 220 à 320 mots.
   - Pas d’en-tête, pas d’adresse, pas de signature.
   - Utilise explicitement 2–3 expériences, compétences et outils cités.
   - Ton professionnel, concret, adapté au poste et à l’entreprise.

2) PITCH D’ASCENSEUR :
   - 2 à 4 phrases.
   - Utilisable à l’oral / mail / LinkedIn.
   - Direct, percutant, orienté valeur.

FORMAT DE SORTIE STRICT :
Rends UNIQUEMENT du JSON valide :
{
  "coverLetter": "...",
  "pitch": "..."
}
`.trim();

  try {
    const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.7, 1600);

    // On nettoie les éventuels ```json ``` etc.
    const cleaned = String(raw).replace(/```json|```/gi, "").trim();

    let coverLetter = "";
    let pitch = "";

    try {
      const parsed = JSON.parse(cleaned);
      coverLetter =
        typeof parsed.coverLetter === "string" ? parsed.coverLetter.trim() : "";
      pitch = typeof parsed.pitch === "string" ? parsed.pitch.trim() : "";
    } catch (e) {
      console.warn("JSON parse error on Gemini response, returning raw text:", e);
      // Fallback : tout dans coverLetter
      coverLetter = cleaned;
      pitch = "";
    }

    if (!coverLetter) {
      coverLetter = "Lettre non générée correctement par l'IA.";
    }

    return NextResponse.json(
      {
        ok: true,
        coverLetter,
        pitch,
      },
      { status: 200 }
    );
  } catch (e: any) {
    console.error("generateLetterAndPitch server error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "GENERATION_ERROR",
      },
      { status: 500 }
    );
  }
}
