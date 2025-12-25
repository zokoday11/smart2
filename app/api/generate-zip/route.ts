// app/api/generate-zip/route.ts

import { NextResponse } from "next/server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// ⚠️ Pour typer proprement le cast à la fin
type BodyInitCompat = BodyInit | null | undefined;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  cost: number; // ex 2
  tool: string; // generateCvLmZip
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
        totalDocumentsGenerated: FieldValue.increment(2), // zip = 2 docs (cv + lm)
        totalCvGenerated: FieldValue.increment(1),
        totalLmGenerated: FieldValue.increment(1),
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

async function callGeminiText(
  prompt: string,
  apiKey: string,
  temperature = 0.65,
  maxOutputTokens = 1400
) {
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

function buildFallbackLetterBody(profile: any, jobTitle: string, companyName: string, lang: string) {
  const p = profile || {};
  const primaryDomain = p.primaryDomain || "";
  const summary = p.profileSummary || "";
  const firstExp = Array.isArray(p.experiences) && p.experiences.length ? p.experiences[0] : null;
  const role = firstExp?.role || firstExp?.title || "";
  const company = firstExp?.company || "";
  const years = Array.isArray(p.experiences) && p.experiences.length > 0 ? p.experiences.length : null;

  if (lang === "en") {
    return `I am writing to express my interest in the position of ${jobTitle || "your advertised role"} at ${
      companyName || "your company"
    }. ${summary || ""}

With ${years ? years + " years of experience" : "solid experience"} in ${primaryDomain || "my field"}, I have developed skills relevant to this opportunity.

In my previous experience at ${company || "my last company"}, I contributed to projects and collaborated with different stakeholders.

I would be delighted to discuss how I can contribute to your team.`;
  }

  return `Je vous écris pour vous faire part de mon intérêt pour le poste de ${jobTitle || "..."} au sein de ${
    companyName || "votre entreprise"
  }. ${summary || ""}

Avec ${years ? years + " ans d’expérience" : "une expérience significative"} ${
    primaryDomain ? "dans " + primaryDomain : "dans mon domaine"
  }, j’ai développé des compétences solides en ${role || "gestion de projets, collaboration et suivi d’objectifs"}.

Je serais ravi(e) d’échanger plus en détail lors d’un entretien.`;
}

async function createSimpleCvPdf(profile: any, options: any) {
  const { targetJob = "", lang = "fr", contract = "", jobLink = "", jobDescription = "" } = options || {};

  const p = profile || {};
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const marginX = 50;
  let y = height - 60;

  function drawLine(text: string, size = 11, bold = false) {
    if (!text || y < 50) return;
    const f = bold ? fontBold : font;
    page.drawText(text, { x: marginX, y, size, font: f, color: rgb(0.1, 0.12, 0.16) });
    y -= size + 4;
  }

  function drawParagraph(text: string, size = 10) {
    if (!text) return;
    const f = font;
    const maxWidth = width - marginX * 2;
    const paragraphs = text.split(/\n{2,}/);

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/);
      let line = "";

      for (const w of words) {
        const testLine = line ? line + " " + w : w;
        const testWidth = f.widthOfTextAtSize(testLine, size);
        if (testWidth > maxWidth) {
          if (y < 50) return;
          page.drawText(line, { x: marginX, y, size, font: f, color: rgb(0.1, 0.12, 0.16) });
          y -= size + 3;
          line = w;
        } else {
          line = testLine;
        }
      }

      if (line && y >= 50) {
        page.drawText(line, { x: marginX, y, size, font: f, color: rgb(0.1, 0.12, 0.16) });
        y -= size + 6;
      }
      y -= 2;
    }
  }

  function drawSectionTitle(title: string) {
    if (!title || y < 60) return;
    page.drawText(title, { x: marginX, y, size: 11, font: fontBold, color: rgb(0.08, 0.15, 0.45) });
    y -= 14;
  }

  function drawBullet(text: string, size = 9) {
    if (!text || y < 50) return;
    const f = font;
    const bulletX = marginX + 8;
    const maxWidth = width - marginX * 2 - 10;
    const words = text.split(/\s+/);
    let line = "";
    let firstLine = true;

    for (const w of words) {
      const testLine = line ? line + " " + w : w;
      const testWidth = f.widthOfTextAtSize(testLine, size);
      if (testWidth > maxWidth) {
        if (y < 50) return;
        page.drawText(firstLine ? "• " + line : "  " + line, {
          x: bulletX,
          y,
          size,
          font: f,
          color: rgb(0.1, 0.12, 0.16),
        });
        y -= size + 3;
        line = w;
        firstLine = false;
      } else {
        line = testLine;
      }
    }

    if (line && y >= 50) {
      page.drawText(firstLine ? "• " + line : "  " + line, {
        x: bulletX,
        y,
        size,
        font: f,
        color: rgb(0.1, 0.12, 0.16),
      });
      y -= size + 3;
    }
  }

  // Header
  drawLine(p.fullName || "", 16, true);
  const jobLine = targetJob || contract || p.contractType || (lang === "en" ? "Target position" : "Poste recherché");
  drawLine(jobLine, 11, false);

  const contactParts = [p.email || "", p.phone || "", p.city || "", p.linkedin || ""].filter(Boolean);
  if (contactParts.length) drawLine(contactParts.join(" · "), 9, false);

  if (jobLink) drawLine((lang === "en" ? "Job link: " : "Lien de l'offre : ") + jobLink, 8, false);

  y -= 6;

  if (p.profileSummary) {
    drawSectionTitle(lang === "en" ? "Profile" : "Profil");
    drawParagraph(p.profileSummary, 9.5);
    y -= 4;
  }

  if (p.skills && Array.isArray(p.skills.sections) && p.skills.sections.length) {
    drawSectionTitle(lang === "en" ? "Key skills" : "Compétences clés");
    p.skills.sections.forEach((sec: any) => {
      if (!sec || (!sec.title && !Array.isArray(sec.items))) return;
      if (sec.title) drawLine(sec.title, 9.5, true);
      if (Array.isArray(sec.items)) drawParagraph(sec.items.join(" · "), 9);
      y -= 2;
    });
  }

  if (Array.isArray(p.experiences) && p.experiences.length) {
    drawSectionTitle(lang === "en" ? "Experience" : "Expériences professionnelles");
    p.experiences.forEach((exp: any) => {
      if (y < 90) return;
      const header = [exp.role, exp.company].filter(Boolean).join(" — ");
      if (header) drawLine(header, 10, true);
      if (exp.dates) drawLine(exp.dates, 8.5, false);
      if (Array.isArray(exp.bullets)) exp.bullets.slice(0, 4).forEach((b: string) => drawBullet(b, 8.5));
      y -= 4;
    });
  }

  if (Array.isArray(p.education) && p.education.length && y > 80) {
    drawSectionTitle(lang === "en" ? "Education" : "Formation");
    p.education.forEach((ed: any) => {
      if (y < 60) return;
      const header = [ed.degree, ed.school].filter(Boolean).join(" — ");
      if (header) drawLine(header, 9.5, true);
      if (ed.dates) drawLine(ed.dates, 8.5, false);
      y -= 4;
    });
  }

  if (p.langLine && y > 60) {
    drawSectionTitle(lang === "en" ? "Languages" : "Langues");
    drawParagraph(p.langLine, 9);
  }

  if (Array.isArray(p.hobbies) && p.hobbies.length && y > 60) {
    drawSectionTitle(lang === "en" ? "Interests" : "Centres d'intérêt");
    drawParagraph(p.hobbies.join(" · "), 9);
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function createLetterPdf(coverLetter: string, meta: any) {
  const { jobTitle = "", companyName = "", candidateName = "", lang = "fr" } = meta || {};

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const marginX = 60;
  let y = height - 70;

  function drawLine(text: string, size = 11, bold = false) {
    if (!text || y < 60) return;
    const f = bold ? fontBold : font;
    page.drawText(text, { x: marginX, y, size, font: f, color: rgb(0.15, 0.17, 0.23) });
    y -= size + 4;
  }

  function drawParagraph(text: string, size = 11) {
    if (!text) return;
    const f = font;
    const maxWidth = width - marginX * 2;
    const paragraphs = text.split(/\n{2,}/);

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/);
      let line = "";

      for (const w of words) {
        const testLine = line ? line + " " + w : w;
        const testWidth = f.widthOfTextAtSize(testLine, size);
        if (testWidth > maxWidth) {
          if (y < 60) return;
          page.drawText(line, { x: marginX, y, size, font: f, color: rgb(0.15, 0.17, 0.23) });
          y -= size + 4;
          line = w;
        } else {
          line = testLine;
        }
      }

      if (line && y >= 60) {
        page.drawText(line, { x: marginX, y, size, font: f, color: rgb(0.15, 0.17, 0.23) });
        y -= size + 8;
      }

      y -= 4;
    }
  }

  if (candidateName) drawLine(candidateName, 14, true);

  if (jobTitle || companyName) {
    const titleLine =
      lang === "en"
        ? `Application for ${jobTitle || "the position"} – ${companyName || "Company"}`
        : `Candidature : ${jobTitle || "poste"} – ${companyName || "Entreprise"}`;
    drawLine(titleLine, 11, false);
  }

  y -= 10;
  drawParagraph(coverLetter, 11);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
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
  const targetJob = body?.targetJob || "";
  const langRaw = body?.lang || "fr";
  const contract = body?.contract || "";
  const jobLink = body?.jobLink || "";
  const jobDescription = body?.jobDescription || "";

  const lm = body?.lm || {};
  const companyName = lm?.companyName || "";
  const jobTitle = lm?.jobTitle || targetJob || "";
  const lmJobDescription = lm?.jobDescription || jobDescription || "";
  const lmLangRaw = lm?.lang || langRaw;

  const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";
  const lmLang = String(lmLangRaw).toLowerCase().startsWith("en") ? "en" : "fr";

  if (!profile) return NextResponse.json({ ok: false, error: "Missing profile" }, { status: 400 });

  // ✅ Débit -2 crédits (CV + LM) + log
  try {
    await consumeCreditsAndLog({
      uid: auth.uid,
      email: auth.email,
      cost: 2,
      tool: "generateCvLmZip",
      docType: "other",
      meta: { targetJob, jobTitle, companyName, lang, lmLang },
    });
  } catch (e: any) {
    if (e?.code === "NO_CREDITS" || e?.message === "NO_CREDITS") {
      return NextResponse.json({ ok: false, error: "NO_CREDITS" }, { status: 402 });
    }
    console.error("consumeCreditsAndLog error:", e);
    return NextResponse.json({ ok: false, error: "CREDITS_ERROR" }, { status: 500 });
  }

  // CV PDF
  let cvBuffer: Buffer;
  try {
    cvBuffer = await createSimpleCvPdf(profile, {
      targetJob,
      lang,
      contract,
      jobLink,
      jobDescription,
    });
  } catch (e: any) {
    console.error("CV PDF error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "CV_PDF_ERROR" }, { status: 500 });
  }

  // LM BODY via Gemini
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
  const cvText = buildProfileContextForIA(profile);

  let coverLetterBody = "";

  if (GEMINI_API_KEY) {
    const promptLm =
      lmLang === "en"
        ? `
You are a senior career coach and recruiter.

TASK:
Write ONLY the BODY of a cover letter tailored to the job, using ONLY the provided information (CV + job description).

INPUTS:
- Job title: "${jobTitle || "the role"}"
- Company: "${companyName || "your company"}"
- Job description:
${lmJobDescription || "—"}

- Candidate profile (source of truth):
${cvText}

STRICT RULES:
- Do NOT invent facts (no fake metrics, clients, tools, dates).
- 3 to 5 paragraphs separated by ONE blank line.
- No header, no subject line, no greeting, no signature.
- Output MUST be STRICT JSON only:
{ "body": "..." }
`.trim()
        : `
Tu es un coach carrières senior et recruteur.

MISSION :
Rédige UNIQUEMENT le CORPS d’une lettre de motivation adaptée au poste, basée UNIQUEMENT sur les infos fournies (CV + fiche de poste).

ENTRÉES :
- Intitulé : "${jobTitle || targetJob || "le poste"}"
- Entreprise : "${companyName || "votre entreprise"}"
- Fiche de poste :
${lmJobDescription || "—"}

- Profil candidat :
${cvText}

RÈGLES :
- Ne pas inventer (pas de chiffres/clients/technos non présents).
- 3 à 5 paragraphes séparés par une ligne vide.
- Pas d’en-tête, pas d’objet, pas de salutation, pas de signature.
- Réponds STRICTEMENT en JSON :
{ "body": "..." }
`.trim();

    try {
      const rawLm = await callGeminiText(promptLm, GEMINI_API_KEY, 0.65, 1400);
      const cleaned = String(rawLm).replace(/```json|```/gi, "").trim();
      try {
        const parsed = JSON.parse(cleaned);
        coverLetterBody = typeof parsed.body === "string" ? parsed.body.trim() : "";
      } catch {
        coverLetterBody = String(rawLm || "").trim();
      }
    } catch (e) {
      console.error("Gemini LM error:", e);
    }
  }

  if (!coverLetterBody) {
    coverLetterBody = buildFallbackLetterBody(profile, jobTitle, companyName, lmLang);
  }

  // LM PDF
  let lmBuffer: Buffer;
  try {
    lmBuffer = await createLetterPdf(coverLetterBody, {
      jobTitle,
      companyName,
      candidateName: profile.fullName || "",
      lang: lmLang,
    });
  } catch (e: any) {
    console.error("LM PDF error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "LM_PDF_ERROR" }, { status: 500 });
  }

  // ZIP ✅ (avec cast pour calmer TypeScript)
  try {
    const zip = new JSZip();
    zip.file("cv-ia.pdf", cvBuffer);
    zip.file(lmLang === "en" ? "cover-letter.pdf" : "lettre-motivation.pdf", lmBuffer);

    const zipContent = await zip.generateAsync({ type: "uint8array" });

    return new NextResponse(zipContent as unknown as BodyInitCompat, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="cv-lm-ia.zip"',
        "Content-Length": String(zipContent.byteLength),
      },
    });
  } catch (e: any) {
    console.error("ZIP error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "ZIP_ERROR" }, { status: 500 });
  }
}
