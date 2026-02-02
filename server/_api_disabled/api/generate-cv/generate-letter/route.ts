import { NextResponse } from "next/server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

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

async function requireUser(req: Request) {
  getAdminApp();

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return { ok: false as const, status: 401, error: "Missing Authorization Bearer token" };
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    return { ok: true as const, uid: decoded.uid, email: decoded.email || "" };
  } catch (e) {
    console.error("verifyIdToken error:", e);
    return { ok: false as const, status: 401, error: "Invalid token" };
  }
}

async function consumeCreditsAndLog(params: {
  uid: string;
  email: string;
  cost: number;
  tool: string;
  docType: "cv" | "lm" | "other";
  meta?: any;
}) {
  getAdminApp();
  const db = getFirestore();

  const userRef = db.collection("users").doc(params.uid);
  const usageRef = db.collection("usageLogs").doc();
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() || {} : {};
    const currentCredits = typeof data.credits === "number" ? data.credits : 0;

    if (currentCredits < params.cost) {
      const err: any = new Error("NO_CREDITS");
      err.code = "NO_CREDITS";
      throw err;
    }

    tx.set(
      userRef,
      {
        credits: currentCredits - params.cost,
        totalIaCalls: FieldValue.increment(1),
        totalDocumentsGenerated: FieldValue.increment(params.docType === "cv" || params.docType === "lm" ? 1 : 0),
        totalCvGenerated: FieldValue.increment(params.docType === "cv" ? 1 : 0),
        totalLmGenerated: FieldValue.increment(params.docType === "lm" ? 1 : 0),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      usageRef,
      {
        userId: params.uid,
        email: params.email || "",
        action: "generate_document",
        docType: params.docType,
        eventType: "generate",
        tool: params.tool,
        creditsDelta: -params.cost,
        meta: params.meta || null,
        createdAt: now,
        createdAtServer: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });
}

function buildProfileContextForIA(profile: any) {
  const p = profile || {};

  let skillsArr: any[] = [];
  if (Array.isArray(p.skills)) {
    skillsArr = p.skills;
  } else if (p.skills && typeof p.skills === "object") {
    if (Array.isArray(p.skills.sections)) {
      p.skills.sections.forEach((sec: any) => {
        if (Array.isArray(sec.items)) skillsArr = skillsArr.concat(sec.items);
      });
    }
    if (Array.isArray(p.skills.tools)) skillsArr = skillsArr.concat(p.skills.tools);
  }

  const skillsStr = (skillsArr || []).join(", ");

  const expStr = Array.isArray(p.experiences)
    ? p.experiences
        .map(
          (e: any) =>
            `${e.role || e.title || ""} chez ${e.company || ""} (${e.dates || ""}): ${(e.bullets || []).join(" ")}`
        )
        .join("; \n")
    : "";

  const eduStr = Array.isArray(p.education)
    ? p.education
        .map((e: any) => `${e.degree || e.title || ""} - ${e.school || e.institution || ""} (${e.dates || ""})`)
        .join("; \n")
    : "";

  return `Nom: ${p.fullName || p.name || ""}
Titre: ${p.profileHeadline || p.title || ""}
Contact: ${p.email || ""} | ${p.phone || ""} | ${p.linkedin || ""} | ${p.city || ""}
Résumé de profil: ${p.profileSummary || p.summary || ""}
Compétences: ${skillsStr}
Expériences: 
${expStr}
Formations: 
${eduStr}
Certifications: ${p.certs || ""}
Langues: ${p.langLine || p.lang || ""}`.trim();
}

async function callGeminiText(prompt: string, apiKey: string, temperature = 0.7, maxOutputTokens = 2400) {
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error("Erreur Gemini (texte): " + errorText);
  }

  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((p: any) => (typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim();

  if (!text) throw new Error("Réponse Gemini (texte) vide");
  return text;
}

function buildFallbackLetterAndPitch(profile: any, jobTitle: string, companyName: string, jobDescription: string, lang: string) {
  const p = profile || {};
  const name = p.fullName || "";
  const primaryDomain = p.primaryDomain || "";
  const summary = p.profileSummary || "";
  const firstExp = Array.isArray(p.experiences) && p.experiences.length ? p.experiences[0] : null;
  const role = firstExp?.role || firstExp?.title || "";
  const company = firstExp?.company || "";
  const years = Array.isArray(p.experiences) && p.experiences.length > 0 ? p.experiences.length : null;

  if (lang === "en") {
    return {
      pitch:
        summary ||
        `I am ${name || "a candidate"} with ${years ? years + " years of experience" : "solid experience"} in ${
          primaryDomain || "my field"
        }, motivated by the ${jobTitle || "role"} at ${companyName || "your company"}.`,
      coverLetter: `I am writing to express my interest in the position of ${jobTitle || "your advertised role"}. With ${
        years ? years + " years of experience" : "solid experience"
      } in ${primaryDomain || "my field"}, I have developed strong skills relevant to this opportunity.

In my previous experience at ${company || "my last company"}, I contributed to projects with measurable impact and collaborated with different stakeholders.

I would be delighted to discuss how I can contribute to your team.`,
    };
  }

  return {
    pitch:
      summary ||
      `Je suis ${name || "un(e) candidat(e)"} avec ${
        years ? years + " ans d’expérience" : "une solide expérience"
      } ${primaryDomain ? "dans " + primaryDomain : ""}, motivé(e) par le poste de ${
        jobTitle || "votre poste"
      } chez ${companyName || "votre entreprise"}.`,
    coverLetter: `Je vous écris pour vous faire part de mon intérêt pour le poste de ${jobTitle || "..."} au sein de ${
      companyName || "votre entreprise"
    }. Avec ${years ? years + " ans d’expérience" : "une expérience significative"} ${
      primaryDomain ? "dans " + primaryDomain : "dans mon domaine"
    }, j’ai développé des compétences solides en ${role || "gestion de projets, collaboration et suivi d’objectifs"}.

Je serais ravi(e) d’échanger plus en détail lors d’un entretien.`,
  };
}

export async function POST(req: Request) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const profile = body?.profile;
  const jobDescription = body?.jobDescription || "";
  const jobTitle = body?.jobTitle || "";
  const companyName = body?.companyName || "";
  const langRaw = body?.lang || "fr";
  const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";

  if (!profile) return NextResponse.json({ ok: false, error: "Missing profile" }, { status: 400 });
  if (!jobTitle && !jobDescription) {
    return NextResponse.json(
      { ok: false, error: "Ajoute au moins l'intitulé du poste ou un extrait de la description." },
      { status: 400 }
    );
  }

  // ✅ Débit -1 crédit + log
  try {
    await consumeCreditsAndLog({
      uid: auth.uid,
      email: auth.email,
      cost: 1,
      tool: "generateLetterAndPitch",
      docType: "lm",
      meta: { jobTitle, companyName, lang },
    });
  } catch (e: any) {
    if (e?.code === "NO_CREDITS" || e?.message === "NO_CREDITS") {
      return NextResponse.json({ ok: false, error: "NO_CREDITS" }, { status: 402 });
    }
    console.error("consumeCreditsAndLog error:", e);
    return NextResponse.json({ ok: false, error: "CREDITS_ERROR" }, { status: 500 });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

  const cvText = buildProfileContextForIA(profile);

  if (!GEMINI_API_KEY) {
    const fb = buildFallbackLetterAndPitch(profile, jobTitle, companyName, jobDescription, lang);
    return NextResponse.json({ ok: true, coverLetter: fb.coverLetter, pitch: fb.pitch, lang }, { status: 200 });
  }

  const prompt =
    lang === "en"
      ? `You are a senior career coach and recruiter.

Return STRICTLY valid JSON:
{ "coverLetter": "string", "pitch": "string" }

COVER LETTER RULES:
- "coverLetter" must be ONLY the BODY (no header, no subject, no greeting, no signature).
- 3 to 5 short paragraphs separated by a blank line.
- Do not invent facts, companies, tools, numbers.
- Use ONLY the candidate profile and the job description.

CANDIDATE PROFILE (source of truth):
${cvText}

JOB DESCRIPTION:
${jobDescription || "—"}

JOB TITLE: ${jobTitle || "the role"}
COMPANY: ${companyName || "your company"}`
      : `Tu es un coach carrières senior et recruteur.

Retourne STRICTEMENT un JSON valide :
{ "coverLetter": "string", "pitch": "string" }

RÈGLES LETTRE :
- "coverLetter" = UNIQUEMENT le CORPS (pas d’en-tête, pas d’objet, pas de formule d’appel, pas de signature).
- 3 à 5 paragraphes séparés par une ligne vide.
- Ne pas inventer (entreprises/outils/chiffres).
- Utilise UNIQUEMENT le profil candidat + la fiche de poste.

PROFIL CANDIDAT (source de vérité) :
${cvText}

FICHE DE POSTE :
${jobDescription || "—"}

INTITULÉ : ${jobTitle || "le poste"}
ENTREPRISE : ${companyName || "votre entreprise"}`;

  let coverLetter = "";
  let pitch = "";

  try {
    const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.7, 2200);
    const cleaned = String(raw).replace(/```json|```/gi, "").trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { coverLetter: cleaned, pitch: "" };
    }

    coverLetter = typeof parsed.coverLetter === "string" ? parsed.coverLetter.trim() : "";
    pitch = typeof parsed.pitch === "string" ? parsed.pitch.trim() : "";
  } catch (e) {
    console.error("Gemini generateLetterAndPitch error:", e);
  }

  if (!coverLetter || !pitch) {
    const fb = buildFallbackLetterAndPitch(profile, jobTitle, companyName, jobDescription, lang);
    if (!coverLetter) coverLetter = fb.coverLetter;
    if (!pitch) pitch = fb.pitch;
  }

  return NextResponse.json({ ok: true, coverLetter, pitch, lang }, { status: 200 });
}
