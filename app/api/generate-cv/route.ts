import { NextResponse } from "next/server";
import { getApps, initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
  cost: number; // ex 1
  tool: string; // "generateCvPdf"
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
  const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";

  if (!profile) return NextResponse.json({ ok: false, error: "Missing profile" }, { status: 400 });

  // ✅ Débit -1 crédit + log
  try {
    await consumeCreditsAndLog({
      uid: auth.uid,
      email: auth.email,
      cost: 1,
      tool: "generateCvPdf",
      docType: "cv",
      meta: { targetJob, lang },
    });
  } catch (e: any) {
    if (e?.code === "NO_CREDITS" || e?.message === "NO_CREDITS") {
      return NextResponse.json({ ok: false, error: "NO_CREDITS" }, { status: 402 });
    }
    console.error("consumeCreditsAndLog error:", e);
    return NextResponse.json({ ok: false, error: "CREDITS_ERROR" }, { status: 500 });
  }

  // Génération PDF
  try {
    const pdfBuffer = await createSimpleCvPdf(profile, {
      targetJob,
      lang,
      contract,
      jobLink,
      jobDescription,
    });

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="cv-ia.pdf"',
      },
    });
  } catch (e: any) {
    console.error("generate-cv error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "GEN_CV_ERROR" }, { status: 500 });
  }
}
