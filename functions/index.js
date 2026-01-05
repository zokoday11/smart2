// functions/index.js
"use strict";

/**
 * ✅ Smart2 — Firebase Functions (FULL FILE)
 * - Gemini (CV extraction + lettres + pitch + interview + Q&A)
 * - PDF (CV + Lettre)
 * - ZIP (CV+LM)
 * - reCAPTCHA Enterprise (avec bypass si user authentifié sur endpoints sensibles)
 * - Admin (setAdminRole, adminUpdateCredits)
 * - Jobs (Adzuna)
 * - Paiements (Polar checkout + webhook)
 *
 * ⚠️ Pré-requis package.json functions:
 * - engines.node: "18"
 * - deps: firebase-admin, firebase-functions, pdf-lib, jszip, @polar-sh/sdk,
 *         @google-cloud/recaptcha-enterprise
 *
 * ⚠️ Secrets:
 * - GEMINI_API_KEY (runWith secrets)
 *
 * ⚠️ Env/config:
 * - RECAPTCHA_PROJECT_ID / RECAPTCHA_SITE_KEY / RECAPTCHA_THRESHOLD / RECAPTCHA_BYPASS / RECAPTCHA_STRICT_ACTION
 * - ADZUNA_APP_ID / ADZUNA_APP_KEY (ou functions.config().adzuna.*)
 * - POLAR_ACCESS_TOKEN / POLAR_ENV / POLAR_PRODUCT_*_ID / POLAR_PRICE_*_ID
 * - NEXT_PUBLIC_APP_URL ou functions.config().app.base_url
 * - CORS_ALLOW_ORIGINS (csv) ou functions.config().app.cors_allow_origins (csv)
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const JSZip = require("jszip");
const { Polar } = require("@polar-sh/sdk");
const { RecaptchaEnterpriseServiceClient } = require("@google-cloud/recaptcha-enterprise");

// =============================
// Firebase Admin init
// =============================
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// =============================
// Helper fetch (Node 18+)
// =============================
const fetchFn = globalThis.fetch;
if (!fetchFn) {
  console.warn(
    "⚠️ globalThis.fetch introuvable. Mets Node 18+ dans functions/package.json (engines.node=18)."
  );
}

// ======================================================
// ✅ PROMPTS INLINE (LM/PITCH JSON strict + CV TAILOR)
// ======================================================
const TEMPLATE_LETTER_PITCH_FR = `
Tu es un recruteur senior et un coach carrière.

Retourne STRICTEMENT un JSON valide :
{ "coverLetterBody": "string", "pitch": "string" }

RÈGLES LETTRE (coverLetterBody) :
- UNIQUEMENT le CORPS (pas d’en-tête, pas d’objet, pas de formule d’appel, pas de signature).
- 3 à 4 paragraphes (séparés par UNE ligne vide).
- Longueur : 220 à 320 mots.
- Ton professionnel, concret, pas de blabla.
- Utilise explicitement 2 à 3 expériences du candidat (missions / réalisations) AVEC outils/technos déjà présents dans le profil.
- Ne pas inventer (entreprises/outils/chiffres).
- Ne recopie PAS la fiche de poste : pas plus de 10–12 mots identiques d’affilée.
- Ignore totalement les blocs “UI” d’offres copiées/collées (Indeed/LinkedIn) du type :
  “Informations sur le profil”, “Correspondance…”, “Détails de l’emploi”, “Compétences”, “Formation”, etc.
- Base-toi UNIQUEMENT sur le profil candidat + les éléments utiles de la fiche de poste.

RÈGLES PITCH :
- 2 à 4 phrases max.
- Spécifique au poste et à l’entreprise.
- Ne pas inventer.

PROFIL CANDIDAT (source de vérité) :
{{cvText}}

FICHE DE POSTE (ne pas copier, juste s'en inspirer) :
{{jobDescription}}

INTITULÉ : {{jobTitle}}
ENTREPRISE : {{companyName}}
`.trim();

const TEMPLATE_LETTER_PITCH_EN = `
You are a senior recruiter and career coach.

Return STRICTLY valid JSON:
{ "coverLetterBody": "string", "pitch": "string" }

COVER LETTER RULES (coverLetterBody):
- ONLY the BODY (no header, no subject, no greeting, no signature).
- 3 to 4 paragraphs separated by ONE blank line.
- Length: 220 to 320 words.
- Professional, concrete, no fluff.
- Explicitly reference 2 to 3 candidate experiences (impact / responsibilities) using ONLY tools already present in the profile.
- Do not invent facts, companies, tools, numbers.
- Do NOT copy the job description: no more than 10–12 consecutive identical words.
- Ignore any job-board UI fragments pasted from Indeed/LinkedIn such as:
  “Profile information”, “Match between…”, “Job details”, “Skills”, “Education”, etc.
- Use ONLY the candidate profile and the job description (as hints).

PITCH RULES:
- 2 to 4 sentences max.
- Specific to the role and the company.
- Do not invent.

CANDIDATE PROFILE (source of truth):
{{cvText}}

JOB DESCRIPTION (do not copy; use as hints):
{{jobDescription}}

JOB TITLE: {{jobTitle}}
COMPANY: {{companyName}}
`.trim();

const TEMPLATE_CV_TAILOR_FR = `
Tu es un expert CV (recruteur senior).

Retourne STRICTEMENT ce JSON :
{
  "tailoredSummary": "string",
  "tailoredKeySkills": ["string", "..."]
}

RÈGLES :
- tailoredSummary : 3 à 5 lignes max, spécifique au poste.
- tailoredKeySkills : 8 à 14 éléments max, UNIQUEMENT des compétences/outils présents dans le profil candidat.
- Ne pas inventer.
- Base-toi UNIQUEMENT sur le profil candidat + la fiche de poste.

INTITULÉ : {{jobTitle}}
ENTREPRISE : {{companyName}}

FICHE DE POSTE :
{{jobDescription}}

PROFIL CANDIDAT :
{{cvText}}
`.trim();

const TEMPLATE_CV_TAILOR_EN = `
You are a senior recruiter and CV expert.

Return STRICTLY this JSON:
{
  "tailoredSummary": "string",
  "tailoredKeySkills": ["string", "..."]
}

RULES:
- tailoredSummary: 3 to 5 lines max, specific to the job.
- tailoredKeySkills: 8 to 14 items max, ONLY skills/tools that exist in the candidate profile.
- Do not invent.
- Use ONLY the candidate profile and the job description.

JOB TITLE: {{jobTitle}}
COMPANY: {{companyName}}

JOB DESCRIPTION:
{{jobDescription}}

CANDIDATE PROFILE:
{{cvText}}
`.trim();

function normalizeLang(langRaw) {
  const l = String(langRaw || "fr").toLowerCase();
  return l.startsWith("en") ? "en" : "fr";
}

function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    String(vars && Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : "")
  );
}

function buildLetterAndPitchPrompt({ lang, cvText, jobDescription, jobTitle, companyName }) {
  const L = normalizeLang(lang);
  const tpl = L === "en" ? TEMPLATE_LETTER_PITCH_EN : TEMPLATE_LETTER_PITCH_FR;

  return fillTemplate(tpl, {
    cvText: cvText || "",
    jobDescription: sanitizeJobDescription(jobDescription) || "—",
    jobTitle: jobTitle || (L === "en" ? "the role" : "le poste"),
    companyName: companyName || (L === "en" ? "your company" : "votre entreprise"),
  });
}

function buildCvTailorPrompt({ lang, cvText, jobDescription, jobTitle, companyName }) {
  const L = normalizeLang(lang);
  const tpl = L === "en" ? TEMPLATE_CV_TAILOR_EN : TEMPLATE_CV_TAILOR_FR;

  return fillTemplate(tpl, {
    cvText: cvText || "",
    jobDescription: sanitizeJobDescription(jobDescription) || "—",
    jobTitle: jobTitle || (L === "en" ? "the role" : "le poste"),
    companyName: companyName || (L === "en" ? "your company" : "votre entreprise"),
  });
}

// =============================
// ✅ Nettoyage jobDescription (HTML / UI)
// =============================
function decodeHtmlEntities(input) {
  let s = String(input || "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  s = s.replace(/&#(\d+);/g, (_, n) => {
    const code = parseInt(n, 10);
    return Number.isFinite(code) ? String.fromCharCode(code) : "";
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => {
    const code = parseInt(n, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : "";
  });

  return s;
}

function stripHtmlTags(input) {
  let s = String(input || "");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<\/?[^>]+>/g, " ");
  return s;
}

function sanitizeJobDescription(raw) {
  let t = String(raw || "");
  if (!t.trim()) return "";

  t = decodeHtmlEntities(t);
  t = stripHtmlTags(t);

  t = t.replace(/\r/g, "\n");
  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n").trim();

  t = t.replace(/^\s*(description du poste|job description)\s*:?/gim, "").trim();

  const cutPatterns = [
    /informations sur le profil/i,
    /correspondance entre/i,
    /d[ée]tails de l['’]emploi/i,
    /^\s*comp[ée]tences\s*$/im,
    /^\s*formation\s*$/im,
    /avez-vous de l['’]exp[ée]rience/i,
    /^\s*avantages\s*$/im,
    /type d['’]emploi/i,
    /r[ée]mun[ée]ration/i,
    /lieu du poste/i,
    /mutuelle/i,
    /prime/i,
    /accord d['’]int[ée]ressement/i,
  ];

  let cutAt = -1;
  for (const re of cutPatterns) {
    const idx = t.search(re);
    if (idx !== -1) cutAt = cutAt === -1 ? idx : Math.min(cutAt, idx);
  }
  if (cutAt !== -1) t = t.slice(0, cutAt).trim();

  if (t.length > 1600) t = t.slice(0, 1600).trim() + "…";
  return t;
}

// =============================
// ✅ Normalisation lettre : pas de double/triple signature
// =============================
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMarkdownAndBullets(text) {
  let t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";

  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/g, "").trim();
  }

  t = t.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/`([^`]+)`/g, "$1");

  t = t
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s+/, "").trimEnd())
    .join("\n")
    .trim();

  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function looksLikeFullLetter(text, lang) {
  const t = String(text || "").trim();
  if (!t) return false;

  if (lang === "en") {
    return (
      /^dear\s+/i.test(t) ||
      /sincerely,/i.test(t) ||
      /kind regards,/i.test(t) ||
      /best regards,/i.test(t)
    );
  }

  return (
    /^madame,\s+monsieur,/i.test(t) ||
    /^bonjour\s+/i.test(t) ||
    /cordialement,/i.test(t) ||
    /bien cordialement,/i.test(t) ||
    /salutations,/i.test(t)
  );
}

function dedupeClosingBlockAtEnd(text, lang, candidateName) {
  const L = normalizeLang(lang);
  const name = String(candidateName || "").trim();
  if (!text) return "";

  const closing = L === "en" ? "Sincerely," : "Cordialement,";
  const closingEsc = escapeRegExp(closing);

  let t = String(text).replace(/\r/g, "").trim();

  if (name) {
    const nameEsc = escapeRegExp(name);
    t = t.replace(
      new RegExp(`(?:\\n\\s*${closingEsc}\\s*\\n\\s*${nameEsc}\\s*){2,}$`, "i"),
      `\n\n${closing}\n${name}`
    );
  } else {
    t = t.replace(new RegExp(`(?:\\n\\s*${closingEsc}\\s*){2,}$`, "i"), `\n\n${closing}`);
  }

  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function ensureFullLetterFormat({ letter, lang, candidateName }) {
  let t = stripMarkdownAndBullets(letter || "");
  if (!t) return "";

  const L = normalizeLang(lang);
  const name = (candidateName || (L === "en" ? "The candidate" : "Le candidat")).trim();

  if (!looksLikeFullLetter(t, L)) {
    const greeting = L === "en" ? "Dear Hiring Manager," : "Madame, Monsieur,";
    t = `${greeting}\n\n${t}`;
  }

  const closing = L === "en" ? "Sincerely," : "Cordialement,";
  const closingEsc = escapeRegExp(closing);

  const hasClosing = new RegExp(`(?:^|\\n)\\s*${closingEsc}\\s*(?:\\n|$)`, "i").test(t);

  if (!hasClosing) {
    t = `${t}\n\n${closing}\n${name}`;
  } else {
    const lines = t.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().toLowerCase() === closing.toLowerCase()) {
        const next = (lines[i + 1] || "").trim();
        if (!next) lines[i + 1] = name;
        break;
      }
    }
    t = lines.join("\n");
  }

  t = dedupeClosingBlockAtEnd(t, L, name);
  return t;
}

function sanitizeLmBodyOnly(raw, lang, candidateName) {
  const L = normalizeLang(lang);
  const name = String(candidateName || "").trim();
  let t = stripMarkdownAndBullets(raw || "");
  if (!t) return "";

  t = t.replace(/<\/?body>/gi, "").trim();
  t = t.replace(/^\s*(objet|subject)\s*:\s*.*$/gim, "").trim();

  if (L === "fr") {
    t = t.replace(/^\s*madame,\s+monsieur,?\s*/i, "").trim();
    t = t.replace(/^\s*(madame|monsieur)\s*,?\s*(monsieur|madame)?\s*,?\s*$/i, "").trim();
  } else {
    t = t.replace(/^\s*dear\s+.*,\s*/i, "").trim();
  }

  const closings =
    L === "fr"
      ? ["cordialement,", "bien cordialement,", "salutations,", "respectueusement,"]
      : ["sincerely,", "kind regards,", "best regards,"];

  for (const c of closings) {
    const cEsc = escapeRegExp(c);
    t = t.replace(new RegExp(`\\n\\s*${cEsc}[\\s\\S]*$`, "i"), "").trim();
  }

  if (name) {
    const nEsc = escapeRegExp(name);
    t = t.replace(new RegExp(`\\n\\s*${nEsc}\\s*$`, "i"), "").trim();
  }

  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

function sanitizeLmBodyFromModel(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/\r/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?p>/gi, "")
    .replace(/<\/?body>/gi, "")
    .replace(/^\s*<body>\s*$/gim, "")
    .replace(/^\s*<\/body>\s*$/gim, "")
    .replace(/^\s*body\s*$/gim, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/^\s*aperçu\b.*$/gim, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\*+/g, "")
    .replace(/^-{2,}.*$/gmi, "")
    .replace(/^\s*(note|remarque|important|disclaimer|attention|nb)\b.*$/gmi, "")
    .replace(/^\s*objet\s*:.*$/gmi, "")
    .replace(/^\s*(madame|monsieur|dear)[^\n]*$/gmi, "")
    .replace(/[“”«»]/g, "")
    .replace(/^\s*"+|"+\s*$/gm, "")
    .replace(/\s"+/g, " ")
    .replace(/["+]\s*/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// =============================
// ✅ Date FR/EN (timezone Europe/Paris)
// =============================
function formatLetterDateLine({ city, lang }) {
  const L = normalizeLang(lang);
  const tz = "Europe/Paris";
  const d = new Date();

  if (L === "fr") {
    const dateFr = new Intl.DateTimeFormat("fr-FR", {
      timeZone: tz,
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);

    const c = String(city || "").trim();
    return c ? `À ${c}, ${dateFr}` : `Le ${dateFr}`;
  }

  const dateEn = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);

  const c = String(city || "").trim();
  return c ? `${c}, ${dateEn}` : `${dateEn}`;
}

function sanitizeCompanyNameForHeader(companyName) {
  let c = String(companyName || "").replace(/\r/g, "").trim();
  if (!c) return "";
  c = c.replace(/\s+/g, " ").trim();
  c = c.replace(/^(service recrutement|recruitment team)\s*[-:|]?\s*/i, "").trim();
  c = c.replace(/(.+?)\s+\1$/i, "$1").trim();
  return c;
}

function uniqueLines(lines) {
  const out = [];
  const seen = new Set();
  for (const l of lines) {
    const s = String(l || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function composeFullCoverLetterDoc({ profile, jobTitle, companyName, lang, bodyOnly }) {
  const L = normalizeLang(lang);
  const p = profile || {};

  const fullName = String(p.fullName || "").trim() || (L === "en" ? "The candidate" : "Le candidat");
  const phone = String(p.phone || "").trim();
  const email = String(p.email || "").trim();
  const linkedin = String(p.linkedin || "").trim();
  const city = String(p.city || "").trim();

  const compRaw =
    String(companyName || "").trim() || (L === "en" ? "Your company" : "Votre entreprise");
  const comp = sanitizeCompanyNameForHeader(compRaw) || compRaw;

  const role = String(jobTitle || "").trim() || (L === "en" ? "the position" : "le poste");

  const headerLeft = uniqueLines([
    fullName,
    phone ? (L === "en" ? `Phone: ${phone}` : `${phone}`) : "",
    email ? (L === "en" ? `Email: ${email}` : `${email}`) : "",
    linkedin ? `LinkedIn: ${linkedin}` : "",
  ]).join("\n");

  const headerRightLines = uniqueLines([L === "en" ? "Recruitment Team" : "Service Recrutement", comp]);
  const headerRight = headerRightLines.join("\n");

  const dateLine = formatLetterDateLine({ city, lang: L });
  const subjectLine =
    L === "en" ? `Subject: Application for ${role}` : `Objet : Candidature au poste de ${role}`;

  const greeting = L === "en" ? "Dear Hiring Manager," : "Madame, Monsieur,";
  const closing = L === "en" ? "Sincerely," : "Cordialement,";

  const cleanBody = sanitizeLmBodyFromModel(String(bodyOnly || "")).trim();

  let doc = [
    headerLeft,
    "",
    headerRight,
    "",
    dateLine,
    "",
    subjectLine,
    "",
    greeting,
    "",
    cleanBody,
    "",
    closing,
    "",
    fullName,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  doc = dedupeClosingBlockAtEnd(doc, L, fullName);
  return doc;
}

function looksLikeFormattedLetterDoc(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const hasSubject = /(objet\s*:|subject\s*:)/i.test(t);
  const hasGreeting = /(madame,\s+monsieur,|dear\s+)/i.test(t);
  return hasSubject && hasGreeting;
}

// =============================
// reCAPTCHA Enterprise
// =============================
const recaptchaClient = new RecaptchaEnterpriseServiceClient();

function getRecaptchaConfig() {
  const cfg = (functions.config && functions.config() && functions.config().recaptcha) || {};

  const projectId = cfg.project_id || process.env.RECAPTCHA_PROJECT_ID || "";
  const siteKey = cfg.site_key || process.env.RECAPTCHA_SITE_KEY || "";
  const thresholdRaw = cfg.threshold || process.env.RECAPTCHA_THRESHOLD || "0.5";
  const threshold = Number(thresholdRaw);

  const bypassRaw = cfg.bypass || process.env.RECAPTCHA_BYPASS || "false";
  const bypass = String(bypassRaw).toLowerCase() === "true";

  const strictActionRaw = cfg.strict_action || process.env.RECAPTCHA_STRICT_ACTION || "false";
  const strictAction = String(strictActionRaw).toLowerCase() === "true";

  return {
    projectId,
    siteKey,
    threshold: Number.isFinite(threshold) ? threshold : 0.5,
    bypass,
    strictAction,
  };
}

function isEmulator() {
  return process.env.FUNCTIONS_EMULATOR === "true" || !!process.env.FIREBASE_EMULATOR_HUB;
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();

  const ip =
    req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    "";
  return typeof ip === "string" ? ip : "";
}

// =============================
// AUTH helper (HTTP)
// =============================
function getBearerToken(req) {
  const h = req.headers["authorization"] || req.headers["Authorization"] || "";
  const s = typeof h === "string" ? h : Array.isArray(h) ? h[0] : "";
  if (!s) return "";
  if (s.startsWith("Bearer ")) return s.slice(7).trim();
  return "";
}

async function tryFirebaseUser(req) {
  const token = getBearerToken(req);
  if (!token) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email || "" };
  } catch {
    return null;
  }
}

async function requireFirebaseUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    const err = new Error("MISSING_AUTH");
    err.code = "MISSING_AUTH";
    throw err;
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email || "" };
  } catch {
    const err = new Error("INVALID_AUTH");
    err.code = "INVALID_AUTH";
    throw err;
  }
}

/**
 * ✅ PATCH reCAPTCHA : on remonte aussi hostname + action
 */
async function verifyRecaptchaToken({ token, expectedAction, req }) {
  const { projectId, siteKey, threshold, bypass, strictAction } = getRecaptchaConfig();

  // bypass en dev/emulator
  if (bypass && (isEmulator() || process.env.NODE_ENV !== "production")) {
    return { ok: true, bypass: true, score: null, threshold };
  }

  if (!projectId || !siteKey) {
    console.warn("reCAPTCHA non configuré (project_id / site_key manquants) => bypass.");
    return { ok: true, bypass: true, score: null, threshold };
  }

  if (!token) return { ok: false, reason: "missing_token" };

  try {
    const userIp = getClientIp(req);
    const userAgent = String(req.headers["user-agent"] || "");

    const request = {
      parent: `projects/${projectId}`,
      assessment: {
        event: {
          token,
          siteKey,
          expectedAction: expectedAction || undefined,
          userAgent: userAgent || undefined,
          userIpAddress: userIp || undefined,
        },
      },
    };

    const [response] = await recaptchaClient.createAssessment(request);

    const tokenProps = response && response.tokenProperties;

    if (!tokenProps || tokenProps.valid !== true) {
      return {
        ok: false,
        reason: "invalid_token",
        invalidReason: tokenProps ? tokenProps.invalidReason : null,
        hostname: tokenProps ? tokenProps.hostname : null,
        action: tokenProps ? tokenProps.action : null,
      };
    }

    // action mismatch : bloquant seulement si strictAction=true
    if (expectedAction && tokenProps.action && String(tokenProps.action) !== String(expectedAction)) {
      if (strictAction) {
        return {
          ok: false,
          reason: "action_mismatch",
          got: tokenProps.action,
          expected: expectedAction,
          hostname: tokenProps.hostname || null,
          action: tokenProps.action || null,
        };
      }
      console.warn("reCAPTCHA action mismatch (non bloquant):", {
        got: tokenProps.action,
        expected: expectedAction,
      });
    }

    const score =
      response && response.riskAnalysis && typeof response.riskAnalysis.score === "number"
        ? response.riskAnalysis.score
        : null;

    if (typeof score === "number" && score < threshold) {
      return {
        ok: false,
        reason: "low_score",
        score,
        threshold,
        hostname: tokenProps.hostname || null,
        action: tokenProps.action || null,
      };
    }

    return {
      ok: true,
      score,
      threshold,
      hostname: tokenProps.hostname || null,
      action: tokenProps.action || null,
    };
  } catch (err) {
    console.error("Erreur reCAPTCHA Enterprise:", err);
    return { ok: false, reason: "recaptcha_error" };
  }
}

async function enforceRecaptchaOrReturn(req, res, expectedAction) {
  // ✅ Bypass si l'utilisateur est authentifié
  const authed = await tryFirebaseUser(req);
  if (authed && authed.uid) return null;

  const token =
    (req.body && (req.body.recaptchaToken || req.body.token)) ||
    req.headers["x-recaptcha-token"] ||
    req.headers["x-recaptchatoken"] ||
    "";

  const actionFromBody =
    (req.body && (req.body.recaptchaAction || req.body.actionRecaptcha || req.body.action)) || "";

  const action = expectedAction || actionFromBody || "";

  const result = await verifyRecaptchaToken({
    token: typeof token === "string" ? token : String(token),
    expectedAction: typeof action === "string" ? action : String(action),
    req,
  });

  if (!result.ok) return res.status(403).json({ error: "reCAPTCHA failed", details: result });
  return null;
}

// =============================
// CORS
// =============================
function getAllowedOrigins() {
  const raw =
    process.env.CORS_ALLOW_ORIGINS ||
    (functions.config &&
      functions.config() &&
      functions.config().app &&
      functions.config().app.cors_allow_origins) ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowlist = getAllowedOrigins();

  if (origin && allowlist.length > 0) {
    if (allowlist.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }

  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Polar-Signature, polar-signature, X-Recaptcha-Token, x-recaptcha-token"
  );
}

// =============================
// Helpers (profil, contrat)
// =============================
function normalizeString(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferContractTypeStandard(raw) {
  const norm = normalizeString(raw);
  if (!norm) return "";

  if (norm.includes("alternance") || norm.includes("apprentissage")) return "Alternance";
  if (norm.includes("stage") || norm.includes("intern")) return "Stage";
  if (norm.includes("freelance") || norm.includes("independant") || norm.includes("auto-entrepreneur"))
    return "Freelance";
  if (norm.includes("cdd") || norm.includes("duree determinee") || norm.includes("durée determinee"))
    return "CDD";
  if (norm.includes("cdi") || norm.includes("duree indeterminee") || norm.includes("durée indeterminee"))
    return "CDI";
  if (norm.includes("interim") || norm.includes("intérim")) return "Intérim";

  return "";
}

// =============================
// Admin helpers
// =============================
function assertIsAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Tu dois être connecté.");
  }

  const token = context.auth.token || {};
  const isAdmin = token.isAdmin === true || token.email === "aakane0105@gmail.com";

  if (!isAdmin) {
    throw new functions.https.HttpsError("permission-denied", "Accès réservé à l'administrateur.");
  }
}

exports.setAdminRole = functions
  .region("europe-west1")
  .https.onCall(async (data, context) => {
    assertIsAdmin(context);

    const uid = data && data.uid;
    const isAdmin = data && data.isAdmin;

    if (!uid || typeof isAdmin !== "boolean") {
      throw new functions.https.HttpsError("invalid-argument", "uid (string) et isAdmin (boolean) sont requis.");
    }

    await admin.auth().setCustomUserClaims(uid, { isAdmin });
    return { success: true, uid, isAdmin };
  });

exports.adminUpdateCredits = functions
  .region("europe-west1")
  .https.onCall(async (data, context) => {
    assertIsAdmin(context);

    const userId = data && data.userId;
    const credits = data && data.credits;

    if (!userId || typeof credits !== "number") {
      throw new functions.https.HttpsError("invalid-argument", "userId (string) et credits (number) sont requis.");
    }

    const userRef = db.collection("users").doc(userId);
    await userRef.set({ credits, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    return { success: true, userId, credits };
  });

// ======================================================
// ✅ JSON helpers (robuste) — FIX AI_BAD_JSON
// ======================================================
function normalizeSmartQuotes(s) {
  return String(s || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function stripCodeFences(s) {
  let t = String(s || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "");
    t = t.replace(/```$/g, "");
  }
  return t.trim();
}

function extractFirstJsonBlock(s) {
  const text = String(s || "");
  const startIdx = text.search(/[\{\[]/);
  if (startIdx === -1) return null;

  const stack = [];
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      const last = stack.pop();
      if (!last) return null;
      if ((last === "{" && ch !== "}") || (last === "[" && ch !== "]")) return null;
      if (stack.length === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

function repairJsonString(s) {
  let t = normalizeSmartQuotes(s);
  t = t.replace(/,\s*([}\]])/g, "$1");
  return t.trim();
}

function safeJsonParseFromModel(raw) {
  let t = stripCodeFences(raw);
  t = repairJsonString(t);

  try {
    return JSON.parse(t);
  } catch {}

  const extracted = extractFirstJsonBlock(t) || extractFirstJsonBlock(raw);
  if (extracted) {
    const fixed = repairJsonString(stripCodeFences(extracted));
    try {
      return JSON.parse(fixed);
    } catch {}
  }
  return null;
}

// =============================
// Gemini helpers
// =============================
async function callGeminiText(prompt, apiKey, temperature = 0.7, maxOutputTokens = 2400, responseMimeType = null) {
  if (!fetchFn) throw new Error("fetch indisponible. Mets Node 18+.");

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const generationConfig = { temperature, maxOutputTokens };
  if (responseMimeType) generationConfig.response_mime_type = responseMimeType;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig,
  };

  const resp = await fetchFn(endpoint, {
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
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim();

  if (!text) throw new Error("Réponse Gemini (texte) vide");
  return text;
}

async function callGeminiJson(prompt, apiKey, temperature = 0.6, maxOutputTokens = 2200) {
  const raw = await callGeminiText(prompt, apiKey, temperature, maxOutputTokens, "application/json");
  const parsed = safeJsonParseFromModel(raw);
  if (parsed === null || parsed === undefined || typeof parsed !== "object") {
    const err = new Error("AI_BAD_JSON");
    err.code = "AI_BAD_JSON";
    err.raw = raw;
    throw err;
  }
  return parsed;
}

// =============================
// callGeminiWithCv (PDF->JSON)
// =============================
async function callGeminiWithCv(base64Pdf, apiKey) {
  if (!fetchFn) throw new Error("fetch indisponible. Mets Node 18+.");

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: "application/pdf", data: base64Pdf } },
          {
            text: `Lis ce CV et renvoie STRICTEMENT un JSON valide avec exactement ce schéma :

{
  "fullName": string,
  "email": string,
  "phone": string,
  "linkedin": string,
  "profileSummary": string,

  "city": string,
  "address": string,

  "contractType": string,
  "contractTypeStandard": string,
  "contractTypeFull": string,
  "primaryDomain": string,
  "secondaryDomains": string[],
  "skills": {
    "sections": [
      { "title": string, "items": string[] }
    ],
    "tools": string[]
  },
  "softSkills": string[],
  "experiences": [
    { "company": string, "role": string, "dates": string, "bullets": string[] }
  ],
  "education": [
    { "school": string, "degree": string, "dates": string }
  ],
  "educationShort": string[],
  "certs": string,
  "langLine": string,
  "hobbies": string[],

  "drivingLicense": string,
  "vehicle": string
}

RÈGLES IMPORTANTES :
- Ne pas inventer.
- Si une info est absente -> "" ou [].
- RENVOIE UNIQUEMENT ce JSON, sans texte autour.
`.trim(),
          },
        ],
      },
    ],
    generationConfig: { response_mime_type: "application/json" },
  };

  const resp = await fetchFn(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error("Erreur Gemini: " + errorText);
  }

  const data = await resp.json();

  let parsed = null;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof text === "string" && text.trim()) {
    parsed = safeJsonParseFromModel(text);
    if (!parsed) {
      console.error("JSON Gemini invalide dans le champ text:", text);
      throw new Error("JSON Gemini invalide (Parsing text) : " + text);
    }
  } else {
    parsed = data;
  }

  let sectionsRaw = Array.isArray(parsed?.skills?.sections) ? parsed.skills.sections : [];
  let tools = Array.isArray(parsed?.skills?.tools) ? parsed.skills.tools : [];
  let softSkillsArr = Array.isArray(parsed?.softSkills) ? parsed.softSkills : [];

  const softSeen = new Set();
  softSkillsArr = softSkillsArr
    .filter((s) => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (!s || softSeen.has(key)) return false;
      softSeen.add(key);
      return true;
    });

  if (softSkillsArr.length > 0) {
    let idx = sectionsRaw.findIndex(
      (sec) => sec && typeof sec.title === "string" && /soft|transversal|comportement|relationnel/i.test(sec.title)
    );

    if (idx === -1) {
      sectionsRaw.push({ title: "Soft skills", items: softSkillsArr });
    } else {
      const items = Array.isArray(sectionsRaw[idx].items) ? sectionsRaw[idx].items : [];
      const seenLocal = new Set(items.filter((x) => typeof x === "string").map((x) => x.toLowerCase().trim()));
      sectionsRaw[idx].items = [...items, ...softSkillsArr.filter((s) => !seenLocal.has(s.toLowerCase().trim()))];
    }
  }

  const sections = sectionsRaw
    .map((sec) => {
      const seen = new Set();
      const items = Array.isArray(sec.items) ? sec.items : [];
      const cleanItems = [];
      for (const raw of items) {
        if (typeof raw !== "string") continue;
        const trimmed = raw.trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) continue;
        seen.add(key);
        cleanItems.push(trimmed);
      }
      return {
        title: typeof sec.title === "string" ? sec.title.trim() : "",
        items: cleanItems,
      };
    })
    .filter((sec) => sec.title || sec.items.length);

  const cleanTools = [];
  const seenTools = new Set();
  for (const raw of tools) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seenTools.has(key)) continue;
    seenTools.add(key);
    cleanTools.push(trimmed);
  }
  tools = cleanTools;

  const sectionItemSet = new Set();
  sections.forEach((sec) => sec.items.forEach((it) => sectionItemSet.add(String(it).toLowerCase())));
  tools = tools.filter((t) => !sectionItemSet.has(String(t).toLowerCase()));

  const contractTypeFull = parsed?.contractTypeFull || parsed?.contractType || "";
  let contractTypeStandard = parsed?.contractTypeStandard || "";
  if (!contractTypeStandard) contractTypeStandard = inferContractTypeStandard(contractTypeFull);
  const contractTypeFinal = contractTypeStandard || contractTypeFull || "";

  return {
    fullName: parsed?.fullName || "",
    email: parsed?.email || "",
    phone: parsed?.phone || "",
    linkedin: parsed?.linkedin || "",
    profileSummary: parsed?.profileSummary || "",
    city: parsed?.city || "",
    address: parsed?.address || "",
    contractType: contractTypeFinal,
    contractTypeStandard,
    contractTypeFull,
    primaryDomain: parsed?.primaryDomain || "",
    secondaryDomains: Array.isArray(parsed?.secondaryDomains) ? parsed.secondaryDomains : [],
    softSkills: softSkillsArr,
    drivingLicense: parsed?.drivingLicense || "",
    vehicle: parsed?.vehicle || "",
    skills: { sections, tools },
    experiences: Array.isArray(parsed?.experiences) ? parsed.experiences : [],
    education: Array.isArray(parsed?.education) ? parsed.education : [],
    educationShort: Array.isArray(parsed?.educationShort) ? parsed.educationShort : [],
    certs: parsed?.certs || "",
    langLine: parsed?.langLine || "",
    hobbies: Array.isArray(parsed?.hobbies) ? parsed.hobbies : [],
  };
}

// =============================
// Build profile context for IA
// =============================
function buildProfileContextForIA(profile) {
  const p = profile || {};

  let skillsArr;
  if (Array.isArray(p.skills)) {
    skillsArr = p.skills;
  } else if (p.skills && typeof p.skills === "object") {
    skillsArr = [];
    if (Array.isArray(p.skills.sections)) {
      p.skills.sections.forEach((sec) => {
        if (Array.isArray(sec.items)) skillsArr = skillsArr.concat(sec.items);
      });
    }
    if (Array.isArray(p.skills.tools)) skillsArr = skillsArr.concat(p.skills.tools);
  } else {
    skillsArr = [];
  }

  const skillsStr = (skillsArr || []).join(", ");

  const expStr = Array.isArray(p.experiences)
    ? p.experiences
        .map(
          (e) =>
            `${e.role || e.title || ""} chez ${e.company || ""} (${e.dates || ""}): ${(e.bullets || []).join(" ")}`
        )
        .join("; \n")
    : "";

  const eduStr = Array.isArray(p.education)
    ? p.education
        .map((e) => `${e.degree || e.title || ""} - ${e.school || e.institution || ""} (${e.dates || ""})`)
        .join("; \n")
    : "";

  return `Nom: ${p.fullName || p.name || ""}
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

// =============================
// ✅ CV tailoring via IA (optionnel)
// =============================
async function tailorCvForJob({ profile, jobTitle, companyName, jobDescription, lang, apiKey }) {
  try {
    const cvText = buildProfileContextForIA(profile);

    const prompt = buildCvTailorPrompt({
      lang,
      cvText,
      jobTitle,
      companyName,
      jobDescription: sanitizeJobDescription(jobDescription),
    });

    const parsed = await callGeminiJson(prompt, apiKey, 0.4, 1200);

    const tailoredSummary = typeof parsed?.tailoredSummary === "string" ? parsed.tailoredSummary.trim() : "";
    const tailoredKeySkills = Array.isArray(parsed?.tailoredKeySkills)
      ? parsed.tailoredKeySkills
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 14)
      : [];

    return { tailoredSummary, tailoredKeySkills };
  } catch (e) {
    console.warn("tailorCvForJob (IA) failed:", e?.message || e);
    return { tailoredSummary: "", tailoredKeySkills: [] };
  }
}

// =============================
// PDF helpers (CV)
// =============================
async function createSimpleCvPdf(profile, options) {
  const {
    targetJob = "",
    lang = "fr",
    contract = "",
    jobLink = "",
    jobDescription = "",
    tailoredSummary = "",
    tailoredKeySkills = [],
  } = options || {};

  const p = profile || {};
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const marginX = 50;
  let y = height - 60;

  function drawLine(text, size = 11, bold = false) {
    if (!text || y < 50) return;
    const f = bold ? fontBold : font;
    page.drawText(text, { x: marginX, y, size, font: f, color: rgb(0.1, 0.12, 0.16) });
    y -= size + 4;
  }

  function drawParagraph(text, size = 10) {
    if (!text) return;
    const f = font;
    const maxWidth = width - marginX * 2;
    const paragraphs = String(text).split(/\n{2,}/);

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/);
      let line = "";

      for (const w of words) {
        const testLine = line ? line + " " + w : w;
        const testWidth = f.widthOfTextAtSize(testLine, size);
        if (testWidth > maxWidth) {
          if (y < 50) return;
          page.drawText(line, {
            x: marginX,
            y,
            size,
            font: f,
            color: rgb(0.1, 0.12, 0.16),
          });
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

  function drawSectionTitle(title) {
    if (!title || y < 60) return;
    page.drawText(title, {
      x: marginX,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.08, 0.15, 0.45),
    });
    y -= 14;
  }

  function drawBullet(text, size = 9) {
    if (!text || y < 50) return;
    const f = font;
    const bulletX = marginX + 8;
    const maxWidth = width - marginX * 2 - 10;
    const words = String(text).split(/\s+/);
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

  drawLine(p.fullName || "", 16, true);
  const jobLine =
    targetJob || contract || p.contractType || (lang === "en" ? "Target position" : "Poste recherché");
  drawLine(jobLine, 11, false);

  const contactParts = [p.email || "", p.phone || "", p.city || "", p.linkedin || ""].filter(Boolean);
  if (contactParts.length) drawLine(contactParts.join(" · "), 9, false);
  if (jobLink) drawLine((lang === "en" ? "Job link: " : "Lien de l'offre : ") + jobLink, 8, false);

  y -= 6;

  const summaryToUse = tailoredSummary || p.profileSummary;
  if (summaryToUse) {
    drawSectionTitle(lang === "en" ? "Profile" : "Profil");
    drawParagraph(summaryToUse, 9.5);
    y -= 4;
  }

  if (Array.isArray(tailoredKeySkills) && tailoredKeySkills.length) {
    drawSectionTitle(lang === "en" ? "Targeted skills" : "Compétences ciblées");
    drawParagraph(tailoredKeySkills.join(" · "), 9);
    y -= 4;
  }

  if (p.skills && Array.isArray(p.skills.sections) && p.skills.sections.length) {
    drawSectionTitle(lang === "en" ? "Key skills" : "Compétences clés");
    p.skills.sections.forEach((sec) => {
      if (!sec || (!sec.title && !Array.isArray(sec.items))) return;
      if (sec.title) drawLine(sec.title, 9.5, true);
      if (Array.isArray(sec.items)) drawParagraph(sec.items.join(" · "), 9);
      y -= 2;
    });
  }

  if (Array.isArray(p.experiences) && p.experiences.length) {
    drawSectionTitle(lang === "en" ? "Experience" : "Expériences professionnelles");
    p.experiences.forEach((exp) => {
      if (y < 90) return;
      const header = [exp.role, exp.company].filter(Boolean).join(" — ");
      if (header) drawLine(header, 10, true);
      if (exp.dates) drawLine(exp.dates, 8.5, false);
      if (Array.isArray(exp.bullets)) exp.bullets.slice(0, 4).forEach((b) => drawBullet(b, 8.5));
      y -= 4;
    });
  }

  if (Array.isArray(p.education) && p.education.length && y > 80) {
    drawSectionTitle(lang === "en" ? "Education" : "Formation");
    p.education.forEach((ed) => {
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

// =============================
// PDF helper (Lettre)
// =============================
async function createLetterPdf(coverLetterFull, meta) {
  const { jobTitle = "", companyName = "", candidateName = "", lang = "fr" } = meta || {};

  let letterText = String(coverLetterFull || "").trim();
  letterText = dedupeClosingBlockAtEnd(letterText, lang, candidateName);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { width, height } = page.getSize();
  const marginX = 60;
  let y = height - 70;

  function drawLine(text, size = 11, bold = false) {
    if (!text || y < 60) return;
    const f = bold ? fontBold : font;
    page.drawText(text, { x: marginX, y, size, font: f, color: rgb(0.15, 0.17, 0.23) });
    y -= size + 4;
  }

  function drawParagraph(text, size = 11) {
    if (!text) return;
    const f = font;
    const maxWidth = width - marginX * 2;
    const paragraphs = String(text).split(/\n{2,}/);

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

  const alreadyFormatted = looksLikeFormattedLetterDoc(letterText);

  if (!alreadyFormatted) {
    if (candidateName) drawLine(candidateName, 14, true);

    if (jobTitle || companyName) {
      const titleLine =
        lang === "en"
          ? `Application for ${jobTitle || "the position"} – ${companyName || "Company"}`
          : `Candidature : ${jobTitle || "poste"} – ${companyName || "Entreprise"}`;
      drawLine(titleLine, 11, false);
    }

    y -= 10;
  }

  drawParagraph(letterText, 11);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ======================================================
// Fallback lettre/pitch (BODY ONLY)
// ======================================================
function buildFallbackLetterAndPitchBody(profile, jobTitle, companyName, jobDescription, lang) {
  const p = profile || {};
  const companyLabel = companyName || (lang === "en" ? "your company" : "votre entreprise");
  const roleLabel = jobTitle || (lang === "en" ? "the role" : "le poste");
  const experiences = Array.isArray(p.experiences) ? p.experiences : [];

  const flatSkills = [];
  if (p.skills) {
    if (Array.isArray(p.skills)) flatSkills.push(...p.skills);
    else {
      if (Array.isArray(p.skills.sections)) {
        p.skills.sections.forEach((sec) => Array.isArray(sec.items) && flatSkills.push(...sec.items));
      }
      if (Array.isArray(p.skills.tools)) flatSkills.push(...p.skills.tools);
    }
  }

  const mainSkills = flatSkills
    .filter((x) => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join(", ");

  const xp1 = experiences[0];
  const xp2 = experiences[1];

  function xpLineFr(xp) {
    if (!xp) return "";
    const company = xp.company || "";
    const role = xp.role || xp.title || "";
    const dates = xp.dates || "";
    const bullet = Array.isArray(xp.bullets) && xp.bullets.length ? xp.bullets[0] : "";
    const base = [role, company].filter(Boolean).join(" chez ");
    const meta = [dates].filter(Boolean).join(" · ");
    const bulletPart = bullet ? ` (ex: ${bullet})` : "";
    return `${base}${meta ? ` — ${meta}` : ""}${bulletPart}`;
  }

  function xpLineEn(xp) {
    if (!xp) return "";
    const company = xp.company || "";
    const role = xp.role || xp.title || "";
    const dates = xp.dates || "";
    const bullet = Array.isArray(xp.bullets) && xp.bullets.length ? xp.bullets[0] : "";
    const base = [role, company].filter(Boolean).join(" at ");
    const meta = [dates].filter(Boolean).join(" · ");
    const bulletPart = bullet ? ` (e.g. ${bullet})` : "";
    return `${base}${meta ? ` — ${meta}` : ""}${bulletPart}`;
  }

  const jdClean = sanitizeJobDescription(jobDescription || "");
  const hasJd = !!(jdClean && jdClean.trim());

  if (lang === "en") {
    const body = [
      `I am applying for the ${roleLabel} position at ${companyLabel}. My background has given me strong experience with ${
        mainSkills || "security, delivery, and collaboration"
      } and a practical, operational approach.`,
      "",
      xp1 || xp2
        ? `Recently, I worked on concrete projects such as: ${[xpLineEn(xp1), xpLineEn(xp2)].filter(Boolean).join(
            " | "
          )}.`
        : `In my recent roles, I delivered end-to-end tasks with a focus on reliability and security.`,
      "",
      hasJd
        ? `Your needs described in the job posting align with my skills and motivation. I am eager to contribute with pragmatic, maintainable improvements.`
        : `The responsibilities of this role align with my experience and my motivation to contribute.`,
      "",
      `I would be happy to discuss how I can contribute to your projects.`,
    ].join("\n");

    const pitch =
      (p.profileSummary && String(p.profileSummary).trim()) ||
      `Motivated candidate applying for ${roleLabel} at ${companyLabel}, with practical skills in ${
        mainSkills || "security and delivery"
      }.`;

    return { body, pitch };
  }

  const bodyFr = [
    `Je souhaite vous proposer ma candidature au poste de ${roleLabel} au sein de ${companyLabel}. Mon parcours m’a permis de développer une expertise solide sur ${
      mainSkills || "la sécurité, le delivery et la collaboration"
    }, avec une approche orientée résultats.`,
    "",
    xp1 || xp2
      ? `Au cours de mes dernières expériences, j’ai mené des missions concrètes, notamment : ${[
          xpLineFr(xp1),
          xpLineFr(xp2),
        ]
          .filter(Boolean)
          .join(" | ")}.`
      : `Au cours de mes expériences, j’ai pris en charge des missions de bout en bout avec un objectif de fiabilité et de sécurité.`,
    "",
    hasJd
      ? `Les missions décrites dans votre offre font écho à mon parcours : je peux contribuer avec des actions pragmatiques, maintenables et orientées service.`
      : `Les responsabilités associées à ce poste correspondent à mon objectif : contribuer avec des actions pragmatiques et maintenables.`,
    "",
    `Je serais ravi d’échanger pour détailler la manière dont je peux contribuer à vos projets.`,
  ].join("\n");

  const pitchFr =
    (p.profileSummary && String(p.profileSummary).trim()) ||
    `Candidat(e) motivé(e) pour le poste de ${roleLabel} chez ${companyLabel}, avec des compétences en ${
      mainSkills || "sécurité et delivery"
    }.`;

  return { body: bodyFr, pitch: pitchFr };
}

// =============================
// extractProfile (PDF base64) ✅
// =============================
exports.extractProfile = functions
  .runWith({ secrets: ["GEMINI_API_KEY"] })
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json")) return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "extract_profile");
    if (deny) return;

    try {
      const base64Pdf = req.body?.base64Pdf;
      if (!base64Pdf) return res.status(400).json({ error: "Champ 'base64Pdf' manquant." });

      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return res.status(500).json({
          error: "Clé Gemini manquante côté serveur. Configure le secret GEMINI_API_KEY.",
        });
      }

      const profile = await callGeminiWithCv(base64Pdf, GEMINI_API_KEY);
      return res.status(200).json(profile);
    } catch (err) {
      console.error("Erreur analyse CV :", err);
      const msg = String(err?.message || "");
      return res.status(500).json({
        error: msg.startsWith("Erreur Gemini:") ? msg : "Erreur pendant l'analyse du CV.",
      });
    }
  });

// =============================
// generateLetterAndPitch ✅ (IA JSON strict + bodyOnly + lettre format exemple)
// =============================
exports.generateLetterAndPitch = functions
  .runWith({ secrets: ["GEMINI_API_KEY"] })
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "generate_letter_pitch");
    if (deny) return;

    try {
      const body = req.body || {};
      const profile = body.profile;
      const jobDescriptionRaw = body.jobDescription || "";
      const jobTitle = (body.jobTitle || "").toString().trim();
      const companyName = (body.companyName || "").toString().trim();
      const lang = normalizeLang(body.lang || "fr");

      if (!profile) return res.status(400).json({ error: "Champ 'profile' manquant." });
      if (!jobTitle && !jobDescriptionRaw) {
        return res.status(400).json({
          error: "Ajoute au moins l'intitulé du poste ou un extrait de la description.",
        });
      }

      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_API_KEY) {
        return res.status(503).json({
          error: "AI_UNAVAILABLE",
          message: "IA indisponible (GEMINI_API_KEY manquant).",
        });
      }

      const jobDescription = sanitizeJobDescription(jobDescriptionRaw || "");
      const cvText = buildProfileContextForIA(profile);

      const prompt = buildLetterAndPitchPrompt({
        lang,
        cvText,
        jobDescription,
        jobTitle: jobTitle || (lang === "en" ? "the role" : "le poste"),
        companyName: companyName || (lang === "en" ? "your company" : "votre entreprise"),
      });

      let coverLetterBody = "";
      let pitch = "";

      try {
        const parsed = await callGeminiJson(prompt, GEMINI_API_KEY, 0.55, 1800);
        coverLetterBody = typeof parsed?.coverLetterBody === "string" ? parsed.coverLetterBody.trim() : "";
        pitch = typeof parsed?.pitch === "string" ? parsed.pitch.trim() : "";
      } catch (e) {
        console.error("Gemini JSON letter/pitch failed:", e?.message || e);
      }

      if (!coverLetterBody || !pitch) {
        const fb = buildFallbackLetterAndPitchBody(profile, jobTitle, companyName, jobDescription, lang);
        if (!coverLetterBody) coverLetterBody = fb.body;
        if (!pitch) pitch = fb.pitch;
      }

      const cleanedFromModel = sanitizeLmBodyFromModel(coverLetterBody);
      const bodyOnly = sanitizeLmBodyOnly(cleanedFromModel, lang, profile?.fullName || "");

      if (!bodyOnly) {
        return res.status(502).json({ error: "AI_EMPTY", message: "Lettre vide après nettoyage." });
      }

      const coverLetter = composeFullCoverLetterDoc({
        profile,
        jobTitle,
        companyName,
        lang,
        bodyOnly,
      });

      return res.status(200).json({
        lang,
        letterBody: bodyOnly,
        coverLetter,
        pitch,
      });
    } catch (err) {
      console.error("Erreur generateLetterAndPitch:", err);
      return res.status(500).json({ error: err?.message || "Erreur interne." });
    }
  });

// =============================
// Interview (simulation) ✅ IA
// =============================
const INTERVIEW_QUESTION_PLAN = {
  complet: 8,
  rapide: 4,
  technique: 6,
  comportemental: 6,
};

function createInterviewSessionId() {
  return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
}

const interviewSessions = new Map();

function extractInterviewJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  let t = raw.trim();

  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```$/, "").trim();
  }

  const direct = safeJsonParseFromModel(t);
  if (direct && typeof direct === "object") return direct;

  const match = t.match(/\{[\s\S]*\}/);
  if (match) {
    const inner = safeJsonParseFromModel(match[0]);
    if (inner && typeof inner === "object") return inner;
  }
  return null;
}

function buildInterviewPrompt(session, lastUserAnswer) {
  const total = session.totalQuestions || 8;
  const step = session.currentStep || 1;

  const modeLabelMap = {
    complet: "entretien complet (général + motivation + compétences)",
    rapide: "entretien flash (questions essentielles)",
    technique: "entretien focalisé sur les compétences techniques",
    comportemental: "entretien focalisé sur les soft skills / situations",
  };

  const modeLabel = modeLabelMap[session.interviewMode] || "entretien général";

  const historyLines = (session.history || [])
    .map((h) => {
      const who = h.role === "candidate" ? "Candidat" : "Recruteur";
      return `- ${who} : ${h.text}`;
    })
    .join("\n");

  const base = `Tu es un recruteur humain expérimenté qui mène un entretien d'embauche en FRANÇAIS pour le poste suivant :

Intitulé du poste : ${session.jobTitle || "(non précisé)"}
Contexte / description du poste : ${session.jobDesc || "(non précisé)"}

Mode d'entretien : ${modeLabel}.
Niveau de difficulté : ${session.difficulty || "standard"}.

Tu mènes un entretien structuré avec environ ${total} questions maximum.`;

  const histBlock = historyLines
    ? `Historique de l'entretien (questions / réponses) :
${historyLines}`
    : `L'entretien commence, tu vas poser la première question.`;

  const stepInfo = `Nous en sommes à l'étape ${step} sur ${total}.
${lastUserAnswer ? `Dernière réponse du candidat : "${lastUserAnswer}".` : ""}

SI nous ne sommes PAS à la dernière étape (étape < ${total}) :
1) Analyse très brièvement la réponse précédente du candidat (ou son profil au démarrage).
2) Propose la prochaine question d'entretien adaptée au poste.

SI nous SOMMES à la dernière étape (étape >= ${total}) :
1) Fais un bilan synthétique (points forts / axes d'amélioration).
2) Donne un score global sur 100 (final_score).

Ta RÉPONSE DOIT être STRICTEMENT un objet JSON VALIDE, sans aucun texte autour, EXACTEMENT :

{
  "next_question": "string ou null",
  "short_analysis": "string",
  "final_summary": "string ou null",
  "final_score": nombre ou null
}`;

  return `${base}\n\n${histBlock}\n\n${stepInfo}`;
}

exports.interview = functions
  .runWith({ secrets: ["GEMINI_API_KEY"] })
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "interview");
    if (deny) return;

    try {
      const body = req.body || {};
      const action = body.action;

      if (!action)
        return res.status(400).json({ error: "Champ 'action' manquant ('start' ou 'answer')." });

      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

      if (action === "start") {
        const userId = body.userId || "";
        const jobTitle = body.jobTitle || "";
        const jobDesc = sanitizeJobDescription(body.jobDesc || "");
        const interviewMode = body.interviewMode || "complet";
        const difficulty = body.difficulty || "standard";

        if (!userId) return res.status(400).json({ error: "Champ 'userId' manquant." });

        const totalQuestions = INTERVIEW_QUESTION_PLAN[interviewMode] || INTERVIEW_QUESTION_PLAN.complet;
        const sessionId = createInterviewSessionId();
        const nowIso = new Date().toISOString();

        const session = {
          sessionId,
          userId,
          jobTitle,
          jobDesc,
          interviewMode,
          difficulty,
          totalQuestions,
          currentStep: 1,
          history: [],
          createdAt: nowIso,
          updatedAt: nowIso,
          finished: false,
        };

        interviewSessions.set(sessionId, session);

        let nextQuestion = null;
        let shortAnalysis = "";
        let finalSummary = null;
        let finalScore = null;

        try {
          if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY manquante");

          const prompt = buildInterviewPrompt(session, null);
          const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.6, 1200, "application/json");

          const parsed = extractInterviewJson(raw) || {};
          if (typeof parsed.next_question === "string" && parsed.next_question.trim())
            nextQuestion = parsed.next_question.trim();
          if (typeof parsed.short_analysis === "string") shortAnalysis = parsed.short_analysis.trim();
          if (typeof parsed.final_summary === "string" && parsed.final_summary.trim())
            finalSummary = parsed.final_summary.trim();
          if (typeof parsed.final_score === "number" || typeof parsed.final_score === "string") {
            const num = Number(parsed.final_score);
            if (!Number.isNaN(num)) finalScore = num;
          }
        } catch (err) {
          console.error("Erreur Gemini (interview/start):", err);
        }

        if (!nextQuestion) {
          nextQuestion = jobTitle
            ? `Bonjour ! Pour commencer, pouvez-vous vous présenter et m'expliquer pourquoi vous ciblez le poste de ${jobTitle} ?`
            : "Bonjour ! Pour commencer, pouvez-vous vous présenter en quelques phrases ?";
          if (!shortAnalysis)
            shortAnalysis = "Mode dégradé sans analyse IA détaillée (erreur ou quota Gemini).";
        }

        session.history.push({ role: "interviewer", text: nextQuestion, createdAt: nowIso });
        if (finalSummary) session.finished = true;

        session.updatedAt = new Date().toISOString();
        interviewSessions.set(sessionId, session);

        return res.status(200).json({
          sessionId,
          step: session.currentStep,
          totalQuestions: session.totalQuestions,
          next_question: nextQuestion,
          short_analysis: shortAnalysis,
          final_summary: finalSummary,
          final_score: finalScore,
        });
      }

      if (action === "answer") {
        const userId = body.userId || "";
        const sessionId = body.sessionId || "";
        const userMessage = (body.userMessage || "").toString().trim();

        if (!userId || !sessionId || !userMessage) {
          return res.status(400).json({
            error: "Champs 'userId', 'sessionId' ou 'userMessage' manquants.",
          });
        }

        const session = interviewSessions.get(sessionId);
        if (!session) {
          return res.status(404).json({
            error: "Session d'entretien introuvable ou expirée (instance de fonction différente).",
          });
        }

        if (session.userId && session.userId !== userId) {
          return res.status(403).json({ error: "Cette session ne correspond pas à cet utilisateur." });
        }

        session.history.push({
          role: "candidate",
          text: userMessage,
          createdAt: new Date().toISOString(),
        });

        const nextStep = Math.min(
          (session.currentStep || 1) + 1,
          session.totalQuestions || INTERVIEW_QUESTION_PLAN.complet
        );
        session.currentStep = nextStep;

        let nextQuestion = null;
        let shortAnalysis = "";
        let finalSummary = null;
        let finalScore = null;

        try {
          if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY manquante");

          const prompt = buildInterviewPrompt(session, userMessage);
          const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.6, 1200, "application/json");

          const parsed = extractInterviewJson(raw) || {};
          if (typeof parsed.next_question === "string" && parsed.next_question.trim())
            nextQuestion = parsed.next_question.trim();
          if (typeof parsed.short_analysis === "string") shortAnalysis = parsed.short_analysis.trim();
          if (typeof parsed.final_summary === "string" && parsed.final_summary.trim())
            finalSummary = parsed.final_summary.trim();
          if (typeof parsed.final_score === "number" || typeof parsed.final_score === "string") {
            const num = Number(parsed.final_score);
            if (!Number.isNaN(num)) finalScore = num;
          }
        } catch (err) {
          console.error("Erreur Gemini (interview/answer):", err);
        }

        const isLastStep = session.currentStep >= (session.totalQuestions || INTERVIEW_QUESTION_PLAN.complet);

        if (!nextQuestion && !finalSummary) {
          if (isLastStep) {
            nextQuestion = "Merci pour tes réponses, l'entretien est terminé.";
            finalSummary =
              "Mode dégradé : le bilan détaillé n'a pas pu être généré car l'API IA n'était pas disponible.";
          } else {
            nextQuestion =
              "Merci pour ta réponse. Peux-tu me donner un exemple encore plus concret en lien avec ce poste ?";
            shortAnalysis = shortAnalysis || "Mode dégradé sans analyse IA détaillée (erreur ou quota Gemini).";
          }
        }

        if (nextQuestion) {
          session.history.push({
            role: "interviewer",
            text: nextQuestion,
            createdAt: new Date().toISOString(),
          });
        }

        if (finalSummary || isLastStep) session.finished = true;

        session.updatedAt = new Date().toISOString();
        interviewSessions.set(sessionId, session);

        return res.status(200).json({
          sessionId,
          step: session.currentStep,
          totalQuestions: session.totalQuestions,
          next_question: nextQuestion,
          short_analysis: shortAnalysis,
          final_summary: finalSummary,
          final_score: finalScore,
        });
      }

      return res.status(400).json({ error: "Action invalide. Utilise 'start' ou 'answer'." });
    } catch (err) {
      console.error("Erreur interne /interview:", err);
      return res.status(500).json({ error: "Erreur interne lors de la simulation d'entretien." });
    }
  });

// =============================
// generateInterviewQA ✅ IA
// =============================
function buildFallbackQuestions(lang, role, company, city, dates, bullets) {
  const missions = (Array.isArray(bullets) ? bullets : []).filter((b) => typeof b === "string").slice(0, 3);

  if (lang === "en") {
    return [
      {
        question: `Can you describe your role as ${role} at ${company}?`,
        answer: `In my position as ${role} at ${company}${city ? " in " + city : ""}${
          dates ? " (" + dates + ")" : ""
        }, I was responsible for ${missions[0] || "several key tasks related to this role"}.`,
      },
      {
        question: `Tell me about a concrete achievement in this role.`,
        answer: missions[1] ? `One strong achievement was: ${missions[1]}` : `One of my main achievements was delivering key tasks with measurable impact.`,
      },
      {
        question: `Which tools or technologies did you use most often?`,
        answer: missions[2] ? `I regularly used tools/technologies such as: ${missions[2]}.` : `I used the main tools and workflows of the role on a daily basis.`,
      },
    ];
  }

  return [
    {
      question: `Pouvez-vous me décrire votre rôle de ${role} chez ${company} ?`,
      answer: `Dans ce poste de ${role} chez ${company}${city ? " à " + city : ""}${dates ? " (" + dates + ")" : ""}, j'étais principalement en charge de ${
        missions[0] || "missions clés en lien avec le poste (projets, coordination, suivi, etc.)"
      }.`,
    },
    {
      question: `Parlez-moi d'une réalisation concrète dont vous êtes fier(e).`,
      answer: missions[1] ? `Une réalisation marquante : ${missions[1]}` : `Une de mes réalisations majeures a eu un impact positif mesurable sur l'équipe et/ou l'entreprise.`,
    },
    {
      question: `Quels outils ou technologies utilisiez-vous le plus souvent ?`,
      answer: missions[2] ? `J'utilisais notamment ${missions[2]} au quotidien.` : `J'utilisais au quotidien les principaux outils liés à ce poste.`,
    },
  ];
}

exports.generateInterviewQA = functions
  .runWith({ secrets: ["GEMINI_API_KEY"] })
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "generate_interview_qa");
    if (deny) return;

    try {
      const body = req.body || {};
      const profile = body.profile;
      const experienceIndex = body.experienceIndex;
      const lang = normalizeLang(body.lang || "fr");

      if (!profile || !Array.isArray(profile.experiences)) {
        return res.status(400).json({
          error: "Profil ou expériences manquants. Assure-toi d'avoir bien analysé ton CV.",
        });
      }

      const idx = Number.isInteger(experienceIndex) ? experienceIndex : parseInt(experienceIndex, 10);
      if (Number.isNaN(idx) || !profile.experiences[idx])
        return res.status(400).json({ error: "Indice d'expérience invalide." });

      const exp = profile.experiences[idx] || {};
      const role = exp.role || exp.title || (lang === "en" ? "Role" : "Poste");
      const company = exp.company || "";
      const city = exp.city || exp.location || "";
      const dates = exp.dates || "";
      const bullets = Array.isArray(exp.bullets) ? exp.bullets : [];

      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
      const cvText = buildProfileContextForIA(profile);

      if (!GEMINI_API_KEY) {
        const questions = buildFallbackQuestions(lang, role, company, city, dates, bullets);
        return res.status(200).json({ questions, lang });
      }

      const prompt =
        lang === "en"
          ? `You are an interview coach.
Return STRICTLY a JSON array of EXACTLY 3 objects:
[
  { "question": "string", "answer": "string" },
  { "question": "string", "answer": "string" },
  { "question": "string", "answer": "string" }
]

Rules:
- Answers must be concrete, aligned with the missions.
- Do not invent facts.

Context:
- Role: ${role} — ${company} — ${city} — ${dates}
- Missions: ${bullets.join(" ")}
- Candidate profile:
${cvText}`
          : `Tu es un coach d'entretien.
Retourne STRICTEMENT un tableau JSON de EXACTEMENT 3 objets :
[
  { "question": "string", "answer": "string" },
  { "question": "string", "answer": "string" },
  { "question": "string", "answer": "string" }
]

Règles:
- Réponses concrètes, alignées avec les missions.
- Ne pas inventer.

Contexte :
- ${role} — ${company} — ${city} — ${dates}
- Missions : ${bullets.join(" ")}
- Profil candidat :
${cvText}`;

      let questions = null;

      try {
        const parsed = await callGeminiJson(prompt, GEMINI_API_KEY, 0.55, 1200);

        if (Array.isArray(parsed)) {
          questions = parsed
            .map((item) => ({
              question: (item.question || item.q || "").toString().trim(),
              answer: (item.answer || item.a || "").toString().trim(),
            }))
            .filter((qa) => qa.question && qa.answer)
            .slice(0, 3);
        }
      } catch (e) {
        console.error("Erreur Gemini generateInterviewQA:", e);
      }

      if (!questions || questions.length !== 3) {
        questions = buildFallbackQuestions(lang, role, company, city, dates, bullets);
      }

      return res.status(200).json({ questions, lang });
    } catch (err) {
      console.error("Erreur generateInterviewQA:", err);
      return res.status(500).json({ error: "Erreur interne lors de la génération des Q&A." });
    }
  });

// =============================
// Credits / Logs
// =============================
function getReqPath(req) {
  try {
    return (req.originalUrl || req.path || "") + "";
  } catch {
    return "";
  }
}

async function debitCreditsAndLog({ uid, email, cost, tool, docType, docsGenerated, cvGenerated, lmGenerated, req, meta }) {
  const userRef = db.collection("users").doc(uid);
  const usageRef = db.collection("usageLogs").doc();
  const now = Date.now();
  const ip = getClientIp(req);
  const userAgent = String(req.headers["user-agent"] || "");
  const path = getReqPath(req);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = snap.exists ? snap.data() || {} : {};
    const currentCredits = typeof data.credits === "number" ? data.credits : 0;

    if (currentCredits < cost) {
      const err = new Error("NO_CREDITS");
      err.code = "NO_CREDITS";
      throw err;
    }

    const updates = {
      credits: currentCredits - cost,
      totalIaCalls: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (docsGenerated && docsGenerated > 0) updates.totalDocumentsGenerated = admin.firestore.FieldValue.increment(docsGenerated);
    if (cvGenerated && cvGenerated > 0) updates.totalCvGenerated = admin.firestore.FieldValue.increment(cvGenerated);
    if (lmGenerated && lmGenerated > 0) updates.totalLmGenerated = admin.firestore.FieldValue.increment(lmGenerated);

    tx.set(userRef, updates, { merge: true });

    tx.set(
      usageRef,
      {
        userId: uid,
        email: email || "",
        action: "generate_document",
        docType: docType || "other",
        eventType: "generate",
        tool: tool || null,
        creditsDelta: -cost,
        meta: meta || null,
        path: path || null,
        createdAt: now,
        createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
        ip: ip || null,
        userAgent: userAgent || null,
      },
      { merge: true }
    );
  });
}

// =============================
// recaptchaVerify endpoint (pour login etc.)
// =============================
exports.recaptchaVerify = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, reason: "method_not_allowed" });
    if (!req.is("application/json")) return res.status(400).json({ ok: false, reason: "bad_content_type" });

    const token = String(req.body?.token || "");
    const action = String(req.body?.action || "").trim();

    if (!token) return res.status(400).json({ ok: false, reason: "missing_token" });
    if (!action) return res.status(400).json({ ok: false, reason: "missing_action" });

    const result = await verifyRecaptchaToken({ token, expectedAction: action, req });

    if (!result.ok) {
      return res.status(403).json({
        ok: false,
        reason: result.reason || "recaptcha_failed",
        score: typeof result.score === "number" ? result.score : undefined,
        threshold: typeof result.threshold === "number" ? result.threshold : undefined,
        invalidReason: result.invalidReason || null,
        hostname: result.hostname || null,
        action: result.action || null,
        got: result.got || undefined,
        expected: result.expected || undefined,
      });
    }

    return res.status(200).json({
      ok: true,
      score: typeof result.score === "number" ? result.score : undefined,
      threshold: typeof result.threshold === "number" ? result.threshold : undefined,
    });
  });

// =============================
// generateCvPdf (auth + credits + recaptcha) ✅
// =============================
exports.generateCvPdf = functions
  .runWith({ secrets: ["GEMINI_API_KEY"] })
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json")) return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "generate_cv_pdf");
    if (deny) return;

    let authUser = null;
    try {
      authUser = await requireFirebaseUser(req);
    } catch (e) {
      const code = e?.code || e?.message;
      if (code === "MISSING_AUTH") return res.status(401).json({ error: "unauthenticated" });
      return res.status(401).json({ error: "invalid_auth" });
    }

    try {
      const body = req.body || {};
      const profile = body.profile;
      const targetJob = body.targetJob || "";
      const lang = normalizeLang(body.lang || "fr");
      const contract = body.contract || "";
      const jobLink = body.jobLink || "";
      const jobDescription = sanitizeJobDescription(body.jobDescription || "");
      const companyName = body.companyName || "";

      if (!profile) return res.status(400).json({ error: "Champ 'profile' manquant." });

      try {
        await debitCreditsAndLog({
          uid: authUser.uid,
          email: authUser.email,
          cost: 1,
          tool: "generateCvPdf",
          docType: "cv",
          docsGenerated: 1,
          cvGenerated: 1,
          lmGenerated: 0,
          req,
          meta: { targetJob, lang },
        });
      } catch (e) {
        if (e?.code === "NO_CREDITS" || e?.message === "NO_CREDITS")
          return res.status(402).json({ error: "NO_CREDITS" });
        console.error("Débit crédits (CV) error:", e);
        return res.status(500).json({ error: "credits_error" });
      }

      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

      let tailoredSummary = "";
      let tailoredKeySkills = [];

      if (GEMINI_API_KEY && (targetJob || jobDescription)) {
        const t = await tailorCvForJob({
          profile,
          jobTitle: targetJob,
          companyName,
          jobDescription,
          lang,
          apiKey: GEMINI_API_KEY,
        });
        tailoredSummary = t.tailoredSummary || "";
        tailoredKeySkills = t.tailoredKeySkills || [];
      }

      const pdfBuffer = await createSimpleCvPdf(profile, {
        targetJob,
        lang,
        contract,
        jobLink,
        jobDescription,
        tailoredSummary,
        tailoredKeySkills,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="cv-ia.pdf"');
      return res.status(200).send(pdfBuffer);
    } catch (err) {
      console.error("Erreur generateCvPdf:", err);
      return res.status(500).json({ error: err?.message || "Erreur interne." });
    }
  });

// =============================
// generateCvLmZip ✅ (auth + credits + recaptcha)
// =============================
exports.generateCvLmZip = functions
  .runWith({ secrets: ["GEMINI_API_KEY"] })
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json")) return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "generate_cv_lm_zip");
    if (deny) return;

    let authUser = null;
    try {
      authUser = await requireFirebaseUser(req);
    } catch (e) {
      const code = e?.code || e?.message;
      if (code === "MISSING_AUTH") return res.status(401).json({ error: "unauthenticated" });
      return res.status(401).json({ error: "invalid_auth" });
    }

    try {
      const body = req.body || {};
      const profile = body.profile;
      const targetJob = body.targetJob || "";
      const lang = normalizeLang(body.lang || "fr");
      const contract = body.contract || "";
      const jobLink = body.jobLink || "";
      const jobDescription = sanitizeJobDescription(body.jobDescription || "");
      const lm = body.lm || {};

      if (!profile) return res.status(400).json({ error: "Champ 'profile' manquant." });

      try {
        await debitCreditsAndLog({
          uid: authUser.uid,
          email: authUser.email,
          cost: 2,
          tool: "generateCvLmZip",
          docType: "other",
          docsGenerated: 2,
          cvGenerated: 1,
          lmGenerated: 1,
          req,
          meta: { targetJob, lang },
        });
      } catch (e) {
        if (e?.code === "NO_CREDITS" || e?.message === "NO_CREDITS")
          return res.status(402).json({ error: "NO_CREDITS" });
        console.error("Débit crédits (ZIP) error:", e);
        return res.status(500).json({ error: "credits_error" });
      }

      const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

      let tailoredSummary = "";
      let tailoredKeySkills = [];
      if (GEMINI_API_KEY && (targetJob || jobDescription)) {
        const t = await tailorCvForJob({
          profile,
          jobTitle: targetJob,
          companyName: lm.companyName || "",
          jobDescription: sanitizeJobDescription(lm.jobDescription || jobDescription || ""),
          lang,
          apiKey: GEMINI_API_KEY,
        });
        tailoredSummary = t.tailoredSummary || "";
        tailoredKeySkills = t.tailoredKeySkills || [];
      }

      const cvBuffer = await createSimpleCvPdf(profile, {
        targetJob,
        lang,
        contract,
        jobLink,
        jobDescription,
        tailoredSummary,
        tailoredKeySkills,
      });

      if (!GEMINI_API_KEY) {
        return res.status(500).json({
          error: "Clé Gemini manquante côté serveur. Configure le secret GEMINI_API_KEY.",
        });
      }

      const companyName = lm.companyName || "";
      const jobTitle = lm.jobTitle || targetJob || "";
      const lmJobDescription = sanitizeJobDescription(lm.jobDescription || jobDescription || "");
      const lmLang = normalizeLang(lm.lang || lang);

      const cvText = buildProfileContextForIA(profile);
      const prompt = buildLetterAndPitchPrompt({
        lang: lmLang,
        cvText,
        jobDescription: lmJobDescription,
        jobTitle: jobTitle || (lmLang === "en" ? "the role" : "le poste"),
        companyName: companyName || (lmLang === "en" ? "your company" : "votre entreprise"),
      });

      let parsed = null;
      try {
        parsed = await callGeminiJson(prompt, GEMINI_API_KEY, 0.55, 1800);
      } catch (e) {
        console.error("Erreur Gemini JSON (ZIP LM):", e);
      }

      let coverBody = parsed && typeof parsed.coverLetterBody === "string" ? parsed.coverLetterBody : "";
      coverBody = sanitizeLmBodyOnly(sanitizeLmBodyFromModel(coverBody), lmLang, profile.fullName || "");
      if (!coverBody) {
        const fb = buildFallbackLetterAndPitchBody(profile, jobTitle, companyName, lmJobDescription, lmLang);
        coverBody = fb.body;
      }

      const coverLetterFull = composeFullCoverLetterDoc({
        profile,
        jobTitle,
        companyName,
        lang: lmLang,
        bodyOnly: coverBody,
      });

      const lmBuffer = await createLetterPdf(coverLetterFull, {
        jobTitle,
        companyName,
        candidateName: profile.fullName || "",
        lang: lmLang,
      });

      const zip = new JSZip();
      zip.file("cv-ia.pdf", cvBuffer);
      zip.file(lmLang === "en" ? "cover-letter.pdf" : "lettre-motivation.pdf", lmBuffer);

      const zipContent = await zip.generateAsync({ type: "nodebuffer" });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="cv-lm-ia.zip"');
      return res.status(200).send(zipContent);
    } catch (err) {
      console.error("Erreur generateCvLmZip:", err);
      return res.status(500).json({ error: err?.message || "Erreur interne." });
    }
  });

// =============================
// generateLetterPdf ✅ (recaptcha)
// =============================
exports.generateLetterPdf = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json")) return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "generate_letter_pdf");
    if (deny) return;

    try {
      const body = req.body || {};
      const coverLetterRaw = (body.coverLetter || "").toString().trim();
      const jobTitle = (body.jobTitle || "").toString().trim();
      const companyName = (body.companyName || "").toString().trim();
      const candidateName = (body.candidateName || "").toString().trim();
      const lang = normalizeLang(body.lang || "fr");

      if (!coverLetterRaw) return res.status(400).json({ error: "Champ 'coverLetter' manquant ou vide." });

      const coverLetterFull = looksLikeFormattedLetterDoc(coverLetterRaw)
        ? coverLetterRaw
        : ensureFullLetterFormat({ letter: coverLetterRaw, lang, candidateName });

      const pdfBuffer = await createLetterPdf(coverLetterFull, {
        jobTitle,
        companyName,
        candidateName,
        lang,
      });

      const safeJob = jobTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const filename =
        (lang === "en" ? "cover-letter" : "lettre-motivation") + (safeJob ? `-${safeJob}` : "") + ".pdf";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(pdfBuffer);
    } catch (err) {
      console.error("Erreur generateLetterPdf:", err);
      return res.status(500).json({ error: "Erreur interne lors de la génération du PDF." });
    }
  });

// =============================
// jobs (Adzuna)
// =============================
exports.jobs = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json")) return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    const deny = await enforceRecaptchaOrReturn(req, res, "jobs_search");
    if (deny) return;

    try {
      if (!fetchFn) throw new Error("fetch indisponible. Mets Node 18+.");

      const body = req.body || {};
      const query = (body.query || "").toString().trim();
      const location = (body.location || "").toString().trim();
      const pageRaw = body.page;

      if (!query && !location) {
        return res.status(400).json({ error: "Ajoute au moins un mot-clé (query) ou un lieu (location)." });
      }

      const ADZUNA_APP_ID = (functions.config().adzuna && functions.config().adzuna.app_id) || process.env.ADZUNA_APP_ID;
      const ADZUNA_APP_KEY = (functions.config().adzuna && functions.config().adzuna.app_key) || process.env.ADZUNA_APP_KEY;

      if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) return res.status(500).json({ error: "Clés Adzuna manquantes côté serveur." });

      const page =
        typeof pageRaw === "number" && pageRaw > 0
          ? pageRaw
          : parseInt(pageRaw, 10) > 0
          ? parseInt(pageRaw, 10)
          : 1;

      const params = new URLSearchParams();
      params.set("app_id", ADZUNA_APP_ID);
      params.set("app_key", ADZUNA_APP_KEY);
      params.set("results_per_page", "20");
      params.set("content-type", "application/json");
      if (query) params.set("what", query);
      if (location) params.set("where", location);

      const url = `https://api.adzuna.com/v1/api/jobs/fr/search/${page}?${params.toString()}`;

      const resp = await fetchFn(url, { method: "GET", headers: { Accept: "application/json" } });
      if (!resp.ok) {
        const textErr = await resp.text();
        console.error("Erreur Adzuna:", resp.status, textErr);
        return res.status(500).json({ error: "Erreur lors de l'appel à l'API Adzuna." });
      }

      const data = await resp.json();
      const results = Array.isArray(data.results) ? data.results : [];

      const jobs = results.map((job, index) => {
        const salaryMin = job.salary_min || 0;
        const salaryMax = job.salary_max || 0;
        const hasSalary = salaryMin > 0 || salaryMax > 0;

        return {
          id: job.id || `job-${index}`,
          title: job.title || "Offre sans titre",
          company: job.company && job.company.display_name ? job.company.display_name : "Entreprise non renseignée",
          location: job.location && job.location.display_name ? job.location.display_name : "Lieu non précisé",
          url: job.redirect_url || "",
          description: job.description || "",
          created: job.created || "",
          salary: hasSalary ? `${salaryMin.toLocaleString("fr-FR")} – ${salaryMax.toLocaleString("fr-FR")} €` : null,
        };
      });

      return res.status(200).json({ jobs });
    } catch (err) {
      console.error("Erreur /jobs:", err);
      return res.status(500).json({ error: "Erreur interne lors de la recherche d'offres (Adzuna /jobs)." });
    }
  });

// =============================
// Polar checkout + webhook
// =============================
const POLAR_ACCESS_TOKEN_BOOT =
  process.env.POLAR_ACCESS_TOKEN || (functions.config().polar && functions.config().polar.access_token);

if (!POLAR_ACCESS_TOKEN_BOOT) {
  console.warn("⚠️ POLAR_ACCESS_TOKEN manquant. Les paiements ne fonctionneront pas.");
}

exports.polarCheckout = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

    const deny = await enforceRecaptchaOrReturn(req, res, "polar_checkout");
    if (deny) return;

    try {
      const body = req.body || {};
      const packId = body.packId;
      const userId = body.userId;
      const email = body.email;

      if (!packId || !userId || !email) {
        return res.status(400).json({
          ok: false,
          error: "Paramètres manquants : packId, userId et email sont obligatoires.",
        });
      }

      const polarAccessToken =
        process.env.POLAR_ACCESS_TOKEN || (functions.config().polar && functions.config().polar.access_token);

      const polarEnv = process.env.POLAR_ENV || (functions.config().polar && functions.config().polar.env) || "sandbox";

      const product20 =
        process.env.POLAR_PRODUCT_20_ID || (functions.config().polar && functions.config().polar.product_20_id);
      const product50 =
        process.env.POLAR_PRODUCT_50_ID || (functions.config().polar && functions.config().polar.product_50_id);
      const product100 =
        process.env.POLAR_PRODUCT_100_ID || (functions.config().polar && functions.config().polar.product_100_id);

      if (!polarAccessToken) return res.status(500).json({ ok: false, error: "Configuration Polar manquante côté serveur." });

      const server = polarEnv === "production" ? "production" : "sandbox";
      const polar = new Polar({ accessToken: polarAccessToken, server });

      const mapPackToProduct = { "20": product20, "50": product50, "100": product100 };
      const productId = mapPackToProduct[String(packId)];

      if (!productId) {
        return res.status(400).json({
          ok: false,
          error: `Pack invalide ou productId non configuré pour "${packId}".`,
        });
      }

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ||
        (functions.config().app && functions.config().app.base_url) ||
        "https://assistant-ia-v4.web.app";

      const successUrl = `${baseUrl}/app/credits?status=success`;
      const returnUrl = `${baseUrl}/app/credits?status=cancel`;

      const payload = {
        products: [productId],
        success_url: successUrl,
        return_url: returnUrl,
        customer_email: email,
        external_customer_id: userId,
        allow_discount_codes: true,
        require_billing_address: false,
        allow_trial: true,
        is_business_customer: false,
        metadata: { firebase_uid: String(userId), pack_id: String(packId), app: "assistant-ia-v4" },
      };

      const checkout = await polar.checkouts.create(payload);

      if (!checkout || !checkout.url) return res.status(500).json({ ok: false, error: "Checkout Polar créé mais URL manquante." });

      try {
        const checkoutId = checkout.id ? String(checkout.id) : null;
        const customerId = checkout.customer_id ? String(checkout.customer_id) : null;
        const productPriceId = checkout.product_price_id || checkout.productPriceId || null;

        if (checkoutId) {
          await db.collection("polar_checkouts").doc(checkoutId).set(
            {
              userId: String(userId),
              email: String(email),
              packId: String(packId),
              productId: String(productId),
              productPriceId: productPriceId ? String(productPriceId) : null,
              customerId: customerId ? String(customerId) : null,
              env: server,
              status: checkout.status || null,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        if (customerId) {
          await db.collection("polar_customers").doc(customerId).set(
            { userId: String(userId), email: String(email), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
      } catch (e) {
        console.warn("Impossible d'écrire le mapping polar_checkouts:", e);
      }

      return res.status(200).json({ ok: true, url: checkout.url });
    } catch (err) {
      console.error("Erreur polarCheckout:", err);
      return res.status(500).json({ ok: false, error: "Erreur interne lors de la création du checkout Polar." });
    }
  });

function deepFindByKey(obj, keyNames) {
  if (!obj || typeof obj !== "object") return null;
  const keys = Array.isArray(keyNames) ? keyNames : [keyNames];

  for (const k of Object.keys(obj)) {
    const lower = k.toLowerCase();
    const found = keys.find((target) => lower === target.toLowerCase());
    if (found) {
      const val = obj[k];
      if (val !== undefined && val !== null && val !== "") return val;
    }
    const child = obj[k];
    if (child && typeof child === "object") {
      const result = deepFindByKey(child, keys);
      if (result !== null && result !== undefined) return result;
    }
  }
  return null;
}

function deepCollectByKey(obj, keyNames, acc = []) {
  if (!obj || typeof obj !== "object") return acc;
  const keys = Array.isArray(keyNames) ? keyNames : [keyNames];

  for (const k of Object.keys(obj)) {
    const lower = k.toLowerCase();
    const isMatch = keys.some((target) => lower === target.toLowerCase());
    const val = obj[k];

    if (isMatch) {
      if (val !== undefined && val !== null && val !== "") acc.push(val);
    }

    if (val && typeof val === "object") deepCollectByKey(val, keyNames, acc);
  }
  return acc;
}

function inferCreditsFromText(text) {
  if (!text || typeof text !== "string") return 0;
  const m = text.match(/(\d+)\s*credits?/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  if ([20, 50, 100].includes(n)) return n;
  return 0;
}

exports.polarWebhook = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Méthode non autorisée" });

    try {
      const event = req.body || {};
      console.log("Webhook Polar reçu :", JSON.stringify(event, null, 2));

      if (!event || !event.type) return res.status(400).json({ ok: false, error: "Event Polar invalide (type manquant)." });
      if (event.type !== "order.paid") return res.status(200).json({ ok: true, ignored: true });

      const product20 =
        process.env.POLAR_PRODUCT_20_ID || (functions.config().polar && functions.config().polar.product_20_id);
      const product50 =
        process.env.POLAR_PRODUCT_50_ID || (functions.config().polar && functions.config().polar.product_50_id);
      const product100 =
        process.env.POLAR_PRODUCT_100_ID || (functions.config().polar && functions.config().polar.product_100_id);

      const price20 =
        process.env.POLAR_PRICE_20_ID || (functions.config().polar && functions.config().polar.price_20_id);
      const price50 =
        process.env.POLAR_PRICE_50_ID || (functions.config().polar && functions.config().polar.price_50_id);
      const price100 =
        process.env.POLAR_PRICE_100_ID || (functions.config().polar && functions.config().polar.price_100_id);

      const CREDITS_BY_PRODUCT_ID = {};
      if (product20) CREDITS_BY_PRODUCT_ID[String(product20)] = 20;
      if (product50) CREDITS_BY_PRODUCT_ID[String(product50)] = 50;
      if (product100) CREDITS_BY_PRODUCT_ID[String(product100)] = 100;

      const CREDITS_BY_PRICE_ID = {};
      if (price20) CREDITS_BY_PRICE_ID[String(price20)] = 20;
      if (price50) CREDITS_BY_PRICE_ID[String(price50)] = 50;
      if (price100) CREDITS_BY_PRICE_ID[String(price100)] = 100;

      const data = event.data || {};
      const priceIds = deepCollectByKey(data, ["product_price_id", "productPriceId"]).map(String);
      const productIds = deepCollectByKey(data, ["product_id", "productId"]).map(String);

      let creditsToAdd = 0;

      for (const pid of priceIds) {
        if (CREDITS_BY_PRICE_ID[pid]) {
          creditsToAdd = CREDITS_BY_PRICE_ID[pid];
          break;
        }
      }
      if (!creditsToAdd) {
        for (const id of productIds) {
          if (CREDITS_BY_PRODUCT_ID[id]) {
            creditsToAdd = CREDITS_BY_PRODUCT_ID[id];
            break;
          }
        }
      }
      if (!creditsToAdd) {
        const labels = deepCollectByKey(data, ["label", "description", "name"])
          .filter((x) => typeof x === "string")
          .map((x) => x.trim());
        for (const t of labels) {
          const n = inferCreditsFromText(t);
          if (n) {
            creditsToAdd = n;
            break;
          }
        }
      }

      if (!creditsToAdd) {
        return res.status(200).json({
          ok: true,
          ignored: true,
          reason: "credits introuvables",
          found: { priceIds, productIds },
        });
      }

      let userId =
        deepFindByKey(data, ["external_customer_id", "customer_external_id"]) ||
        deepFindByKey(data, ["firebase_uid", "firebaseUid"]) ||
        (deepFindByKey(data, ["custom_field_data"]) || {})?.firebase_uid ||
        null;

      if (userId && typeof userId !== "string") userId = String(userId);

      if (!userId) {
        const customerId = deepFindByKey(data, ["customer_id", "customerId"]) || null;
        if (customerId) {
          const snap = await db.collection("polar_customers").doc(String(customerId)).get();
          if (snap.exists) userId = String((snap.data() || {}).userId || "");
        }
      }

      if (!userId) {
        const checkoutId = deepFindByKey(data, ["checkout_id", "checkoutId"]) || null;
        if (checkoutId) {
          const snap = await db.collection("polar_checkouts").doc(String(checkoutId)).get();
          if (snap.exists) userId = String((snap.data() || {}).userId || "");
        }
      }

      if (!userId) {
        const email = deepFindByKey(data, ["customer_email", "email"]) || null;
        if (email && typeof email === "string") {
          try {
            const u = await admin.auth().getUserByEmail(email);
            if (u?.uid) userId = u.uid;
          } catch (e) {
            console.warn("Fallback email->uid impossible:", e);
          }
        }
      }

      if (!userId) return res.status(200).json({ ok: true, ignored: true, reason: "userId introuvable" });

      const orderId = (data && (data.id || data.order_id || data.orderId)) || event.id || null;
      const ledgerRef = orderId ? db.collection("polar_orders").doc(String(orderId)) : null;

      await db.runTransaction(async (tx) => {
        if (ledgerRef) {
          const ledgerSnap = await tx.get(ledgerRef);
          if (ledgerSnap.exists) return;
        }

        const userRef = db.collection("users").doc(userId);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        const currentCredits = typeof userData.credits === "number" ? userData.credits : 0;

        const newCredits = currentCredits + creditsToAdd;

        tx.set(userRef, { credits: newCredits, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

        if (ledgerRef) {
          tx.set(ledgerRef, {
            processed: true,
            userId,
            creditsAdded: creditsToAdd,
            productIds,
            priceIds,
            eventType: event.type,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        const rechargeId = orderId ? String(orderId) : `${event.type}_${Date.now()}`;
        const rechargeRef = db.collection("users").doc(userId).collection("rechargeHistory").doc(rechargeId);

        tx.set(
          rechargeRef,
          {
            provider: "polar",
            orderId: orderId ? String(orderId) : null,
            checkoutId: deepFindByKey(data, ["checkout_id", "checkoutId"]) || null,
            creditsAdded: creditsToAdd,
            productIds,
            priceIds,
            amount: deepFindByKey(data, ["amount", "price_amount", "total_amount"]) || null,
            currency: deepFindByKey(data, ["currency", "price_currency"]) || null,
            status: deepFindByKey(data, ["status", "payment_status"]) || null,
            eventType: event.type,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        console.log(`Crédits ajoutés: +${creditsToAdd} (total=${newCredits}) userId=${userId}`);
      });

      return res.status(200).json({ ok: true, processed: true });
    } catch (err) {
      console.error("Erreur polarWebhook:", err);
      return res.status(500).json({ ok: false, error: "Erreur interne lors du traitement du webhook Polar." });
    }
  });
