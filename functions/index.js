"use strict";

/**
 * ✅ Version nettoyée (SANS doublons / SANS commandes terminal dans le JS)
 * ✅ Import v1 explicite (Cloud Functions Gen1)
 * ✅ Option bypass reCAPTCHA en dev/emulator (via env)
 *
 * IMPORTANT :
 * - Utilise Node 18+ (fetch natif)
 * - Ne colle JAMAIS "npm install ..." dans ce fichier
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const JSZip = require("jszip");
const { Polar } = require("@polar-sh/sdk");
const {
  validateEvent,
  WebhookVerificationError,
} = require("@polar-sh/sdk/webhooks");
const {
  RecaptchaEnterpriseServiceClient,
} = require("@google-cloud/recaptcha-enterprise");

// Initialisation Firebase Admin (pour Firestore + auth + callable)
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

// =============================
//  Helper fetch (Node 18+)
// =============================
const fetchFn = globalThis.fetch;
if (!fetchFn) {
  console.warn(
    "⚠️ globalThis.fetch introuvable. Mets Node 18+ dans functions/package.json (engines.node=18)."
  );
}

// =============================
//  reCAPTCHA Enterprise (config + helper)
// =============================
const recaptchaClient = new RecaptchaEnterpriseServiceClient();

function getRecaptchaConfig() {
  const cfg =
    (functions.config &&
      functions.config() &&
      functions.config().recaptcha) ||
    {};

  const projectId = cfg.project_id || process.env.RECAPTCHA_PROJECT_ID || "";
  const siteKey = cfg.site_key || process.env.RECAPTCHA_SITE_KEY || "";
  const thresholdRaw =
    cfg.threshold || process.env.RECAPTCHA_THRESHOLD || "0.5";
  const threshold = Number(thresholdRaw);

  // ✅ Bypass optionnel (dev seulement recommandé)
  // - RECAPTCHA_BYPASS=true
  // - ou functions:config:set recaptcha.bypass=true
  const bypassRaw = cfg.bypass || process.env.RECAPTCHA_BYPASS || "false";
  const bypass = String(bypassRaw).toLowerCase() === "true";

  return {
    projectId,
    siteKey,
    threshold: Number.isFinite(threshold) ? threshold : 0.5,
    bypass,
  };
}

function isEmulator() {
  return (
    process.env.FUNCTIONS_EMULATOR === "true" ||
    !!process.env.FIREBASE_EMULATOR_HUB
  );
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) {
    return xf.split(",")[0].trim();
  }
  const ip =
    req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    "";
  return typeof ip === "string" ? ip : "";
}

/**
 * Vérifie le token reCAPTCHA Enterprise.
 * expectedAction :
 * - si fourni -> vérifie que l'action du token correspond
 * - sinon -> pas de check d'action
 */
async function verifyRecaptchaToken({ token, expectedAction, req }) {
  const { projectId, siteKey, threshold, bypass } = getRecaptchaConfig();

  // ✅ Bypass explicite (utile en local/dev)
  if (bypass && (isEmulator() || process.env.NODE_ENV !== "production")) {
    return { ok: true, bypass: true, score: null, threshold };
  }

  // Si pas configuré, on ne bloque pas (mais on log)
  if (!projectId || !siteKey) {
    console.warn(
      "reCAPTCHA non configuré (recaptcha.project_id / recaptcha.site_key manquants) => vérification bypass."
    );
    return { ok: true, bypass: true, score: null, threshold };
  }

  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

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
      };
    }

    // Action check (si fourni)
    if (
      expectedAction &&
      tokenProps.action &&
      String(tokenProps.action) !== String(expectedAction)
    ) {
      return {
        ok: false,
        reason: "action_mismatch",
        got: tokenProps.action,
        expected: expectedAction,
      };
    }

    const score =
      response &&
      response.riskAnalysis &&
      typeof response.riskAnalysis.score === "number"
        ? response.riskAnalysis.score
        : null;

    if (typeof score === "number" && score < threshold) {
      return {
        ok: false,
        reason: "low_score",
        score,
        threshold,
      };
    }

    return { ok: true, score, threshold };
  } catch (err) {
    console.error("Erreur reCAPTCHA Enterprise:", err);
    return { ok: false, reason: "recaptcha_error" };
  }
}

/**
 * Important sécurité :
 * - expectedAction (passée par l'endpoint) a priorité.
 * - sinon on lit req.body.action (utile pour /recaptchaVerify).
 */
async function enforceRecaptchaOrReturn(req, res, expectedAction) {
  const token =
    (req.body && (req.body.recaptchaToken || req.body.token)) ||
    req.headers["x-recaptcha-token"] ||
    req.headers["x-recaptchatoken"] ||
    "";

  const actionFromBody =
    (req.body &&
      (req.body.recaptchaAction ||
        req.body.actionRecaptcha ||
        req.body.action)) ||
    "";

  const action = expectedAction || actionFromBody || "";

  const result = await verifyRecaptchaToken({
    token: typeof token === "string" ? token : String(token),
    expectedAction: typeof action === "string" ? action : String(action),
    req,
  });

  if (!result.ok) {
    return res.status(403).json({
      error: "reCAPTCHA failed",
      details: result,
    });
  }
  return null; // ok
}

// =============================
//  CORS
// =============================

// Exemple env: CORS_ALLOW_ORIGINS="https://assistant-ia-v4.web.app,https://assistant-ia-v4.firebaseapp.com,http://localhost:3000"
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

// Pas de credentials côté front -> pas besoin de Allow-Credentials
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
//  HTTPS: recaptchaVerify
// =============================
exports.recaptchaVerify = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, reason: "method_not_allowed" });
    if (!req.is("application/json"))
      return res.status(400).json({ ok: false, reason: "bad_content_type" });

    const token = String(req.body?.token || "");
    const action = String(req.body?.action || "").trim();

    if (!token) return res.status(400).json({ ok: false, reason: "missing_token" });
    if (!action) return res.status(400).json({ ok: false, reason: "missing_action" });

    const result = await verifyRecaptchaToken({
      token,
      expectedAction: action,
      req,
    });

    if (!result.ok) {
      return res.status(403).json({
        ok: false,
        reason: result.reason || "recaptcha_failed",
        score: typeof result.score === "number" ? result.score : undefined,
      });
    }

    return res.status(200).json({
      ok: true,
      score: typeof result.score === "number" ? result.score : undefined,
    });
  });

// =============================
//  Helpers (profil, contrat)
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
  if (
    norm.includes("freelance") ||
    norm.includes("independant") ||
    norm.includes("indépendant") ||
    norm.includes("auto-entrepreneur")
  )
    return "Freelance";
  if (
    norm.includes("cdd") ||
    norm.includes("duree determinee") ||
    norm.includes("durée determinée")
  )
    return "CDD";
  if (
    norm.includes("cdi") ||
    norm.includes("duree indeterminee") ||
    norm.includes("durée indeterminée")
  )
    return "CDI";
  if (norm.includes("interim") || norm.includes("intérim")) return "Intérim";

  return "";
}

// =============================
//  Admin helpers
// =============================
function assertIsAdmin(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Tu dois être connecté."
    );
  }

  const token = context.auth.token || {};
  const isAdmin =
    token.isAdmin === true || token.email === "aakane0105@gmail.com";

  if (!isAdmin) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Accès réservé à l'administrateur."
    );
  }
}

exports.setAdminRole = functions
  .region("europe-west1")
  .https.onCall(async (data, context) => {
    assertIsAdmin(context);

    const uid = data && data.uid;
    const isAdmin = data && data.isAdmin;

    if (!uid || typeof isAdmin !== "boolean") {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "uid (string) et isAdmin (boolean) sont requis."
      );
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
      throw new functions.https.HttpsError(
        "invalid-argument",
        "userId (string) et credits (number) sont requis."
      );
    }

    const userRef = db.collection("users").doc(userId);

    await userRef.set(
      {
        credits,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return { success: true, userId, credits };
  });

// =============================
//  Gemini helpers
// =============================
async function callGeminiText(
  prompt,
  apiKey,
  temperature = 0.7,
  maxOutputTokens = 2400
) {
  if (!fetchFn) throw new Error("fetch indisponible. Mets Node 18+.");

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens },
  };

  const resp = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
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

async function callGeminiWithCv(base64Pdf, apiKey) {
  if (!fetchFn) throw new Error("fetch indisponible. Mets Node 18+.");

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: "application/pdf",
              data: base64Pdf,
            },
          },
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
    try {
      parsed = JSON.parse(text.replace(/```json|```/gi, "").trim());
    } catch (e) {
      console.error("JSON Gemini invalide dans le champ text:", text);
      throw new Error("JSON Gemini invalide (Parsing text) : " + text);
    }
  } else {
    parsed = data;
  }

  // Post-traitement (skills/tools/softskills + contrat)
  let sectionsRaw = Array.isArray(parsed?.skills?.sections)
    ? parsed.skills.sections
    : [];
  let tools = Array.isArray(parsed?.skills?.tools) ? parsed.skills.tools : [];
  let softSkillsArr = Array.isArray(parsed?.softSkills) ? parsed.softSkills : [];

  // Soft skills clean/dedup
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

  // Inject soft skills into sections if needed
  if (softSkillsArr.length > 0) {
    let idx = sectionsRaw.findIndex(
      (sec) =>
        sec &&
        typeof sec.title === "string" &&
        /soft|transversal|comportement|relationnel/i.test(sec.title)
    );

    if (idx === -1) {
      sectionsRaw.push({ title: "Soft skills", items: softSkillsArr });
    } else {
      const items = Array.isArray(sectionsRaw[idx].items)
        ? sectionsRaw[idx].items
        : [];
      const seenLocal = new Set(
        items
          .filter((x) => typeof x === "string")
          .map((x) => x.toLowerCase().trim())
      );
      sectionsRaw[idx].items = [
        ...items,
        ...softSkillsArr.filter((s) => !seenLocal.has(s.toLowerCase().trim())),
      ];
    }
  }

  // Clean sections
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

  // Clean tools
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

  // Dedup tools vs section items
  const sectionItemSet = new Set();
  sections.forEach((sec) =>
    sec.items.forEach((it) => sectionItemSet.add(String(it).toLowerCase()))
  );
  tools = tools.filter((t) => !sectionItemSet.has(String(t).toLowerCase()));

  // Contract
  const contractTypeFull =
    parsed?.contractTypeFull || parsed?.contractType || "";
  let contractTypeStandard = parsed?.contractTypeStandard || "";
  if (!contractTypeStandard) {
    contractTypeStandard = inferContractTypeStandard(contractTypeFull);
  }
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
    secondaryDomains: Array.isArray(parsed?.secondaryDomains)
      ? parsed.secondaryDomains
      : [],

    softSkills: softSkillsArr,
    drivingLicense: parsed?.drivingLicense || "",
    vehicle: parsed?.vehicle || "",

    skills: { sections, tools },

    experiences: Array.isArray(parsed?.experiences) ? parsed.experiences : [],
    education: Array.isArray(parsed?.education) ? parsed.education : [],
    educationShort: Array.isArray(parsed?.educationShort)
      ? parsed.educationShort
      : [],
    certs: parsed?.certs || "",
    langLine: parsed?.langLine || "",
    hobbies: Array.isArray(parsed?.hobbies) ? parsed.hobbies : [],
  };
}

// =============================
//  HTTPS: extractProfile
// =============================
exports.extractProfile = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")
      return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json"))
      return res
        .status(400)
        .json({ error: "Content-Type invalide. Envoie du JSON." });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "extract_profile");
    if (deny) return;

    try {
      const base64Pdf = req.body?.base64Pdf;
      if (!base64Pdf) {
        return res.status(400).json({
          error: "Champ 'base64Pdf' manquant dans le corps JSON.",
        });
      }

      const GEMINI_API_KEY =
        process.env.GEMINI_API_KEY ||
        (functions.config().gemini && functions.config().gemini.key);

      if (!GEMINI_API_KEY) {
        return res.status(500).json({
          error:
            "Clé Gemini manquante côté serveur. Configure GEMINI_API_KEY ou functions.config().gemini.key.",
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
//  Interview (simulation)
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

  try {
    return JSON.parse(t);
  } catch (e) {
    const match = t.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
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
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")
      return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json"))
      return res.status(400).json({
        error: "Content-Type invalide. Envoie du JSON.",
      });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "interview");
    if (deny) return;

    try {
      const body = req.body || {};
      const action = body.action;

      if (!action) {
        return res.status(400).json({
          error: "Champ 'action' manquant ('start' ou 'answer').",
        });
      }

      // START
      if (action === "start") {
        const userId = body.userId || "";
        const jobTitle = body.jobTitle || "";
        const jobDesc = body.jobDesc || "";
        const interviewMode = body.interviewMode || "complet";
        const difficulty = body.difficulty || "standard";

        if (!userId) return res.status(400).json({ error: "Champ 'userId' manquant." });

        const totalQuestions =
          INTERVIEW_QUESTION_PLAN[interviewMode] ||
          INTERVIEW_QUESTION_PLAN.complet;

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
          const GEMINI_API_KEY =
            process.env.GEMINI_API_KEY ||
            (functions.config().gemini && functions.config().gemini.key);

          if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY manquante");

          const prompt = buildInterviewPrompt(session, null);
          const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.6, 1200);

          const parsed = extractInterviewJson(raw) || {};
          if (typeof parsed.next_question === "string" && parsed.next_question.trim()) {
            nextQuestion = parsed.next_question.trim();
          }
          if (typeof parsed.short_analysis === "string") shortAnalysis = parsed.short_analysis.trim();
          if (typeof parsed.final_summary === "string" && parsed.final_summary.trim()) {
            finalSummary = parsed.final_summary.trim();
          }
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
          if (!shortAnalysis) {
            shortAnalysis =
              "Mode dégradé sans analyse IA détaillée (erreur ou quota Gemini).";
          }
        }

        session.history.push({
          role: "interviewer",
          text: nextQuestion,
          createdAt: nowIso,
        });

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

      // ANSWER
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
            error:
              "Session d'entretien introuvable ou expirée (instance de fonction différente).",
          });
        }

        if (session.userId && session.userId !== userId) {
          return res.status(403).json({
            error: "Cette session ne correspond pas à cet utilisateur.",
          });
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
          const GEMINI_API_KEY =
            process.env.GEMINI_API_KEY ||
            (functions.config().gemini && functions.config().gemini.key);

          if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY manquante");

          const prompt = buildInterviewPrompt(session, userMessage);
          const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.6, 1200);

          const parsed = extractInterviewJson(raw) || {};
          if (typeof parsed.next_question === "string" && parsed.next_question.trim()) {
            nextQuestion = parsed.next_question.trim();
          }
          if (typeof parsed.short_analysis === "string") shortAnalysis = parsed.short_analysis.trim();
          if (typeof parsed.final_summary === "string" && parsed.final_summary.trim()) {
            finalSummary = parsed.final_summary.trim();
          }
          if (typeof parsed.final_score === "number" || typeof parsed.final_score === "string") {
            const num = Number(parsed.final_score);
            if (!Number.isNaN(num)) finalScore = num;
          }
        } catch (err) {
          console.error("Erreur Gemini (interview/answer):", err);
        }

        const isLastStep =
          session.currentStep >=
          (session.totalQuestions || INTERVIEW_QUESTION_PLAN.complet);

        if (!nextQuestion && !finalSummary) {
          if (isLastStep) {
            nextQuestion = "Merci pour tes réponses, l'entretien est terminé.";
            finalSummary =
              "Mode dégradé : le bilan détaillé n'a pas pu être généré car l'API IA n'était pas disponible.";
          } else {
            nextQuestion =
              "Merci pour ta réponse. Peux-tu me donner un exemple encore plus concret en lien avec ce poste ?";
            shortAnalysis =
              shortAnalysis ||
              "Mode dégradé sans analyse IA détaillée (erreur ou quota Gemini).";
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

      return res.status(400).json({
        error: "Action invalide. Utilise 'start' ou 'answer'.",
      });
    } catch (err) {
      console.error("Erreur interne /interview:", err);
      return res.status(500).json({
        error: "Erreur interne lors de la simulation d'entretien.",
      });
    }
  });

// =============================
//  Build profile context
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
            `${e.role || e.title || ""} chez ${e.company || ""} (${e.dates || ""}): ${(
              e.bullets || []
            ).join(" ")}`
        )
        .join("; \n")
    : "";

  const eduStr = Array.isArray(p.education)
    ? p.education
        .map(
          (e) =>
            `${e.degree || e.title || ""} - ${e.school || e.institution || ""} (${e.dates || ""})`
        )
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

// =============================
//  PDF helpers
// =============================
async function createSimpleCvPdf(profile, options) {
  const {
    targetJob = "",
    lang = "fr",
    contract = "",
    jobLink = "",
    jobDescription = "",
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
    page.drawText(text, {
      x: marginX,
      y,
      size,
      font: f,
      color: rgb(0.1, 0.12, 0.16),
    });
    y -= size + 4;
  }

  function drawParagraph(text, size = 10) {
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
  const jobLine =
    targetJob ||
    contract ||
    p.contractType ||
    (lang === "en" ? "Target position" : "Poste recherché");
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

async function createLetterPdf(coverLetter, meta) {
  const { jobTitle = "", companyName = "", candidateName = "", lang = "fr" } = meta || {};

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

// =============================
//  HTTPS: generateLetterAndPitch
// =============================
function buildFallbackLetterAndPitch(profile, jobTitle, companyName, jobDescription, lang) {
  const p = profile || {};
  const name = p.fullName || "";
  const city = p.city || "";
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
      coverLetter: `Dear ${companyName || "Hiring Manager"},

I am writing to express my interest in the position of ${jobTitle || "your advertised role"}. With ${
        years ? years + " years of experience" : "solid experience"
      } in ${primaryDomain || "my field"}, I have developed strong skills relevant to this opportunity.

In my previous experience at ${company || "my last company"}, I contributed to projects with measurable impact and collaborated with different stakeholders.

I would be delighted to discuss how I can contribute to your team.

Best regards,
${name || ""}${city ? "\n" + city : ""}`,
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
    coverLetter: `Madame, Monsieur,

Je vous écris pour vous faire part de mon intérêt pour le poste de ${jobTitle || "..."} au sein de ${
      companyName || "votre entreprise"
    }. Avec ${years ? years + " ans d’expérience" : "une expérience significative"} ${
      primaryDomain ? "dans " + primaryDomain : "dans mon domaine"
    }, j’ai développé des compétences solides en ${
      role || "gestion de projets, collaboration et suivi d’objectifs"
    }.

Je serais ravi(e) d’échanger plus en détail lors d’un entretien.

Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.

${name || ""}${city ? "\n" + city : ""}`,
  };
}

exports.generateLetterAndPitch = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "generate_letter_pitch");
    if (deny) return;

    try {
      const body = req.body || {};
      const profile = body.profile;
      const jobDescription = body.jobDescription || "";
      const jobTitle = body.jobTitle || "";
      const companyName = body.companyName || "";
      const langRaw = body.lang || "fr";
      const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";

      if (!profile) return res.status(400).json({ error: "Champ 'profile' manquant." });
      if (!jobTitle && !jobDescription)
        return res.status(400).json({
          error: "Ajoute au moins l'intitulé du poste ou un extrait de la description.",
        });

      const GEMINI_API_KEY =
        process.env.GEMINI_API_KEY ||
        (functions.config().gemini && functions.config().gemini.key);

      const cvText = buildProfileContextForIA(profile);

      if (!GEMINI_API_KEY) {
        const fb = buildFallbackLetterAndPitch(profile, jobTitle, companyName, jobDescription, lang);
        return res.status(200).json({ coverLetter: fb.coverLetter, pitch: fb.pitch, lang });
      }

      const prompt =
        lang === "en"
          ? `You are a career coach.
Return STRICTLY valid JSON:
{ "coverLetter": "string", "pitch": "string" }

CANDIDATE PROFILE:
${cvText}

JOB DESCRIPTION / HINTS:
${jobDescription || "—"}`
          : `Tu es un coach carrières.
Retourne STRICTEMENT un JSON valide :
{ "coverLetter": "string", "pitch": "string" }

PROFIL CANDIDAT :
${cvText}

DESCRIPTION DU POSTE / INDICES :
${jobDescription || "—"}`;

      let coverLetter = "";
      let pitch = "";

      try {
        const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.7, 2400);
        const cleaned = raw.replace(/```json|```/gi, "").trim();
        let parsed = null;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = { coverLetter: cleaned, pitch: "" };
        }
        coverLetter = typeof parsed.coverLetter === "string" ? parsed.coverLetter.trim() : "";
        pitch = typeof parsed.pitch === "string" ? parsed.pitch.trim() : "";
      } catch (err) {
        console.error("Erreur Gemini generateLetterAndPitch:", err);
      }

      if (!coverLetter || !pitch) {
        const fb = buildFallbackLetterAndPitch(profile, jobTitle, companyName, jobDescription, lang);
        if (!coverLetter) coverLetter = fb.coverLetter;
        if (!pitch) pitch = fb.pitch;
      }

      return res.status(200).json({ coverLetter, pitch, lang });
    } catch (err) {
      console.error("Erreur generateLetterAndPitch:", err);
      return res.status(500).json({ error: err?.message || "Erreur interne." });
    }
  });

// =============================
//  HTTPS: generateInterviewQA
// =============================
function buildFallbackQuestions(lang, role, company, city, dates, bullets) {
  const missions = (Array.isArray(bullets) ? bullets : [])
    .filter((b) => typeof b === "string")
    .slice(0, 3);

  if (lang === "en") {
    return [
      {
        question: `Can you describe your role as ${role} at ${company}?`,
        answer: `In my position as ${role} at ${company}${city ? " in " + city : ""}${dates ? " (" + dates + ")" : ""}, I was responsible for ${
          missions[0] || "several key tasks related to this role"
        }.`,
      },
      {
        question: `Tell me about a concrete achievement in this role.`,
        answer: missions[1]
          ? `One strong achievement was: ${missions[1]}`
          : `One of my main achievements was delivering key tasks with measurable impact.`,
      },
      {
        question: `Which tools or technologies did you use most often?`,
        answer: missions[2]
          ? `I regularly used tools/technologies such as ${missions[2]}.`
          : `I used the main tools and workflows of the role on a daily basis.`,
      },
    ];
  }

  return [
    {
      question: `Pouvez-vous me décrire votre rôle de ${role} chez ${company} ?`,
      answer: `Dans ce poste de ${role} chez ${company}${city ? " à " + city : ""}${dates ? " (" + dates + ")" : ""}, j'étais principalement en charge de ${
        missions[0] ||
        "plusieurs missions clés en lien avec le poste (projets, coordination, suivi, etc.)"
      }.`,
    },
    {
      question: `Parlez-moi d'une réalisation concrète dont vous êtes fier(e).`,
      answer: missions[1]
        ? `Une réalisation marquante : ${missions[1]}`
        : `Une de mes réalisations majeures a eu un impact positif mesurable sur l'équipe et/ou l'entreprise.`,
    },
    {
      question: `Quels outils ou technologies utilisiez-vous le plus souvent ?`,
      answer: missions[2]
        ? `J'utilisais notamment ${missions[2]} au quotidien.`
        : `J'utilisais au quotidien les principaux outils liés à ce poste.`,
    },
  ];
}

exports.generateInterviewQA = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "generate_interview_qa");
    if (deny) return;

    try {
      const body = req.body || {};
      const profile = body.profile;
      const experienceIndex = body.experienceIndex;
      const langRaw = body.lang || "fr";
      const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";

      if (!profile || !Array.isArray(profile.experiences)) {
        return res.status(400).json({
          error: "Profil ou expériences manquants. Assure-toi d'avoir bien analysé ton CV.",
        });
      }

      const idx = Number.isInteger(experienceIndex)
        ? experienceIndex
        : parseInt(experienceIndex, 10);

      if (Number.isNaN(idx) || !profile.experiences[idx]) {
        return res.status(400).json({ error: "Indice d'expérience invalide." });
      }

      const exp = profile.experiences[idx] || {};
      const role = exp.role || exp.title || (lang === "en" ? "Role" : "Poste");
      const company = exp.company || "";
      const city = exp.city || exp.location || "";
      const dates = exp.dates || "";
      const bullets = Array.isArray(exp.bullets) ? exp.bullets : [];

      const GEMINI_API_KEY =
        process.env.GEMINI_API_KEY ||
        (functions.config().gemini && functions.config().gemini.key);

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

Contexte :
- ${role} — ${company} — ${city} — ${dates}
- Missions : ${bullets.join(" ")}
- Profil candidat :
${cvText}`;

      let questions = null;

      try {
        const raw = await callGeminiText(prompt, GEMINI_API_KEY, 0.7, 1200);
        const cleaned = raw.replace(/```json|```/gi, "").trim();

        let parsed = null;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          parsed = null;
        }

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
//  HTTPS: generateCvPdf
// =============================
exports.generateCvPdf = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "generate_cv_pdf");
    if (deny) return;

    try {
      const body = req.body || {};
      const profile = body.profile;
      const targetJob = body.targetJob || "";
      const langRaw = body.lang || "fr";
      const contract = body.contract || "";
      const jobLink = body.jobLink || "";
      const jobDescription = body.jobDescription || "";
      const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";

      if (!profile) return res.status(400).json({ error: "Champ 'profile' manquant." });

      const pdfBuffer = await createSimpleCvPdf(profile, {
        targetJob,
        lang,
        contract,
        jobLink,
        jobDescription,
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
//  HTTPS: generateCvLmZip
// =============================
exports.generateCvLmZip = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "generate_cv_lm_zip");
    if (deny) return;

    try {
      const body = req.body || {};
      const profile = body.profile;
      const targetJob = body.targetJob || "";
      const langRaw = body.lang || "fr";
      const contract = body.contract || "";
      const jobLink = body.jobLink || "";
      const jobDescription = body.jobDescription || "";
      const lm = body.lm || {};

      const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";

      if (!profile) return res.status(400).json({ error: "Champ 'profile' manquant." });

      const cvBuffer = await createSimpleCvPdf(profile, {
        targetJob,
        lang,
        contract,
        jobLink,
        jobDescription,
      });

      const GEMINI_API_KEY =
        process.env.GEMINI_API_KEY ||
        (functions.config().gemini && functions.config().gemini.key);

      if (!GEMINI_API_KEY) {
        return res.status(500).json({
          error:
            "Clé Gemini manquante côté serveur. Configure GEMINI_API_KEY ou functions.config().gemini.key.",
        });
      }

      const companyName = lm.companyName || "";
      const jobTitle = lm.jobTitle || targetJob || "";
      const lmJobDescription = lm.jobDescription || jobDescription || "";
      const lmLangRaw = lm.lang || lang;
      const lmLang = String(lmLangRaw).toLowerCase().startsWith("en") ? "en" : "fr";

      const cvText = buildProfileContextForIA(profile);

      const promptLm =
        lmLang === "en"
          ? `You are a career coach.
Produce ONLY a professional cover letter in ENGLISH for "${jobTitle || "role"}" at "${companyName || "the company"}".
Return ONLY the letter body as plain text.

CANDIDATE PROFILE:
${cvText}

JOB DESCRIPTION:
${lmJobDescription || "—"}`
          : `Tu es un coach carrières.
Produis UNIQUEMENT une lettre de motivation en FRANÇAIS pour "${jobTitle || "cible"}" chez "${companyName || "l'entreprise"}".
Retourne UNIQUEMENT le corps en texte brut.

PROFIL CANDIDAT :
${cvText}

DESCRIPTION DU POSTE :
${lmJobDescription || "—"}`;

      const rawLm = await callGeminiText(promptLm, GEMINI_API_KEY, 0.7, 2400);
      const coverLetterText = rawLm.trim();

      const lmBuffer = await createLetterPdf(coverLetterText, {
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
//  HTTPS: generateLetterPdf
// =============================
exports.generateLetterPdf = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "generate_letter_pdf");
    if (deny) return;

    try {
      const body = req.body || {};
      const coverLetter = (body.coverLetter || "").toString().trim();
      const jobTitle = (body.jobTitle || "").toString().trim();
      const companyName = (body.companyName || "").toString().trim();
      const candidateName = (body.candidateName || "").toString().trim();
      const langRaw = body.lang || "fr";
      const lang = String(langRaw).toLowerCase().startsWith("en") ? "en" : "fr";

      if (!coverLetter) {
        return res.status(400).json({
          error: "Champ 'coverLetter' manquant ou vide.",
        });
      }

      const pdfBuffer = await createLetterPdf(coverLetter, {
        jobTitle,
        companyName,
        candidateName,
        lang,
      });

      const safeJob = jobTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      const filename =
        (lang === "en" ? "cover-letter" : "lettre-motivation") +
        (safeJob ? `-${safeJob}` : "") +
        ".pdf";

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.status(200).send(pdfBuffer);
    } catch (err) {
      console.error("Erreur generateLetterPdf:", err);
      return res.status(500).json({ error: "Erreur interne lors de la génération du PDF." });
    }
  });

// =============================
//  HTTPS: jobs (Adzuna)
// =============================
exports.jobs = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (!req.is("application/json"))
      return res.status(400).json({ error: "Content-Type invalide. Envoie du JSON." });

    // ✅ reCAPTCHA
    const deny = await enforceRecaptchaOrReturn(req, res, "jobs_search");
    if (deny) return;

    try {
      if (!fetchFn) throw new Error("fetch indisponible. Mets Node 18+.");

      const body = req.body || {};
      const query = (body.query || "").toString().trim();
      const location = (body.location || "").toString().trim();
      const pageRaw = body.page;

      if (!query && !location) {
        return res.status(400).json({
          error: "Ajoute au moins un mot-clé (query) ou un lieu (location).",
        });
      }

      const ADZUNA_APP_ID =
        (functions.config().adzuna && functions.config().adzuna.app_id) ||
        process.env.ADZUNA_APP_ID;
      const ADZUNA_APP_KEY =
        (functions.config().adzuna && functions.config().adzuna.app_key) ||
        process.env.ADZUNA_APP_KEY;

      if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
        return res.status(500).json({
          error: "Clés Adzuna manquantes côté serveur.",
        });
      }

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
          company:
            job.company && job.company.display_name
              ? job.company.display_name
              : "Entreprise non renseignée",
          location:
            job.location && job.location.display_name
              ? job.location.display_name
              : "Lieu non précisé",
          url: job.redirect_url || "",
          description: job.description || "",
          created: job.created || "",
          salary: hasSalary
            ? `${salaryMin.toLocaleString("fr-FR")} – ${salaryMax.toLocaleString("fr-FR")} €`
            : null,
        };
      });

      return res.status(200).json({ jobs });
    } catch (err) {
      console.error("Erreur /jobs:", err);
      return res.status(500).json({
        error: "Erreur interne lors de la recherche d'offres (Adzuna /jobs).",
      });
    }
  });

// =============================
//  Polar checkout + webhook
// =============================
const POLAR_ACCESS_TOKEN_BOOT =
  process.env.POLAR_ACCESS_TOKEN ||
  (functions.config().polar && functions.config().polar.access_token);

if (!POLAR_ACCESS_TOKEN_BOOT) {
  console.warn(
    "⚠️ POLAR_ACCESS_TOKEN manquant. Les paiements ne fonctionneront pas."
  );
}

exports.polarCheckout = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST")
      return res.status(405).json({ error: "Méthode non autorisée" });

    // ✅ reCAPTCHA
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
        process.env.POLAR_ACCESS_TOKEN ||
        (functions.config().polar && functions.config().polar.access_token);

      const polarEnv =
        process.env.POLAR_ENV ||
        (functions.config().polar && functions.config().polar.env) ||
        "sandbox";

      const product20 =
        process.env.POLAR_PRODUCT_20_ID ||
        (functions.config().polar && functions.config().polar.product_20_id);
      const product50 =
        process.env.POLAR_PRODUCT_50_ID ||
        (functions.config().polar && functions.config().polar.product_50_id);
      const product100 =
        process.env.POLAR_PRODUCT_100_ID ||
        (functions.config().polar && functions.config().polar.product_100_id);

      if (!polarAccessToken) {
        return res.status(500).json({
          ok: false,
          error: "Configuration Polar manquante côté serveur.",
        });
      }

      const server = polarEnv === "production" ? "production" : "sandbox";

      const polar = new Polar({
        accessToken: polarAccessToken,
        // @ts-ignore selon version du SDK
        server,
      });

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
        metadata: {
          firebase_uid: String(userId),
          pack_id: String(packId),
          app: "assistant-ia-v4",
        },
      };

      const checkout = await polar.checkouts.create(payload);

      if (!checkout || !checkout.url) {
        return res.status(500).json({
          ok: false,
          error: "Checkout Polar créé mais URL manquante.",
        });
      }

      // mapping checkoutId -> userId
      try {
        const checkoutId = checkout.id ? String(checkout.id) : null;
        const customerId = checkout.customer_id ? String(checkout.customer_id) : null;
        const productPriceId = checkout.product_price_id || checkout.productPriceId || null;

        if (checkoutId) {
          await db
            .collection("polar_checkouts")
            .doc(checkoutId)
            .set(
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
          await db
            .collection("polar_customers")
            .doc(customerId)
            .set(
              {
                userId: String(userId),
                email: String(email),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
        }
      } catch (e) {
        console.warn("Impossible d'écrire le mapping polar_checkouts:", e);
      }

      return res.status(200).json({ ok: true, url: checkout.url });
    } catch (err) {
      console.error("Erreur polarCheckout:", err);
      return res.status(500).json({
        ok: false,
        error: "Erreur interne lors de la création du checkout Polar.",
      });
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

    if (val && typeof val === "object") deepCollectByKey(val, keys, acc);
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
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Méthode non autorisée" });
    }

    try {
      // ⚠️ Validation signature désactivée (tu peux réactiver plus tard avec validateEvent)
      const event = req.body || {};
      console.log("Webhook Polar reçu :", JSON.stringify(event, null, 2));

      if (!event || !event.type) {
        return res.status(400).json({ ok: false, error: "Event Polar invalide (type manquant)." });
      }

      if (event.type !== "order.paid") {
        return res.status(200).json({ ok: true, ignored: true });
      }

      const product20 =
        process.env.POLAR_PRODUCT_20_ID ||
        (functions.config().polar && functions.config().polar.product_20_id);
      const product50 =
        process.env.POLAR_PRODUCT_50_ID ||
        (functions.config().polar && functions.config().polar.product_50_id);
      const product100 =
        process.env.POLAR_PRODUCT_100_ID ||
        (functions.config().polar && functions.config().polar.product_100_id);

      const price20 =
        process.env.POLAR_PRICE_20_ID ||
        (functions.config().polar && functions.config().polar.price_20_id);
      const price50 =
        process.env.POLAR_PRICE_50_ID ||
        (functions.config().polar && functions.config().polar.price_50_id);
      const price100 =
        process.env.POLAR_PRICE_100_ID ||
        (functions.config().polar && functions.config().polar.price_100_id);

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
        if (CREDITS_BY_PRICE_ID[pid]) { creditsToAdd = CREDITS_BY_PRICE_ID[pid]; break; }
      }
      if (!creditsToAdd) {
        for (const id of productIds) {
          if (CREDITS_BY_PRODUCT_ID[id]) { creditsToAdd = CREDITS_BY_PRODUCT_ID[id]; break; }
        }
      }
      if (!creditsToAdd) {
        const labels = deepCollectByKey(data, ["label", "description", "name"])
          .filter((x) => typeof x === "string")
          .map((x) => x.trim());
        for (const t of labels) {
          const n = inferCreditsFromText(t);
          if (n) { creditsToAdd = n; break; }
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

      if (!userId) {
        return res.status(200).json({ ok: true, ignored: true, reason: "userId introuvable" });
      }

      const orderId = (data && (data.id || data.order_id || data.orderId)) || event.id || null;
      const ledgerRef = orderId ? db.collection("polar_orders").doc(String(orderId)) : null;

      await db.runTransaction(async (tx) => {
        if (ledgerRef) {
          const ledgerSnap = await tx.get(ledgerRef);
          if (ledgerSnap.exists) return; // pas de double crédit
        }

        const userRef = db.collection("users").doc(userId);
        const userSnap = await tx.get(userRef);
        const userData = userSnap.exists ? userSnap.data() || {} : {};
        const currentCredits = typeof userData.credits === "number" ? userData.credits : 0;

        const newCredits = currentCredits + creditsToAdd;

        tx.set(
          userRef,
          { credits: newCredits, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );

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

        console.log(`Crédits ajoutés: +${creditsToAdd} (total=${newCredits}) userId=${userId}`);
      });

      return res.status(200).json({ ok: true, processed: true });
    } catch (err) {
      console.error("Erreur polarWebhook:", err);
      return res.status(500).json({
        ok: false,
        error: "Erreur interne lors du traitement du webhook Polar.",
      });
    }
  });
