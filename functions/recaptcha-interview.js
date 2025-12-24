"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { RecaptchaEnterpriseServiceClient } = require("@google-cloud/recaptcha-enterprise");

// Init Admin
if (!admin.apps.length) admin.initializeApp();

const recaptchaClient = new RecaptchaEnterpriseServiceClient();

/* ============================
   CORS (Hosting + localhost)
   ============================ */
function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://assistant-ia-v4.web.app",
    "https://assistant-ia-v4.firebaseapp.com",
  ];

  if (allowed.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    // (Option) tu peux mettre ton domaine custom ici si tu en as un
    // res.set("Access-Control-Allow-Origin", "https://tondomaine.com");
  }

  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

/* ============================
   reCAPTCHA config
   ============================ */
function getRecaptchaConfig() {
  const cfg = (functions.config && functions.config() && functions.config().recaptcha) || {};
  const projectId = cfg.project_id || process.env.RECAPTCHA_PROJECT_ID || "";
  const siteKey = cfg.site_key || process.env.RECAPTCHA_SITE_KEY || "";
  const thresholdRaw = cfg.threshold || process.env.RECAPTCHA_THRESHOLD || "0.5";

  const threshold = Number(thresholdRaw);
  return {
    projectId,
    siteKey,
    threshold: Number.isFinite(threshold) ? threshold : 0.5,
  };
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return (
    req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    (req.socket && req.socket.remoteAddress) ||
    ""
  );
}

function normalizeAction(action) {
  return String(action || "").trim().toLowerCase();
}

/**
 * Vérifie un token reCAPTCHA Enterprise
 */
async function verifyRecaptchaToken({ token, expectedAction, req }) {
  const { projectId, siteKey, threshold } = getRecaptchaConfig();

  // Si pas configuré, on ne bloque pas (mais on log)
  if (!projectId || !siteKey) {
    console.warn("[recaptcha] NOT CONFIGURED -> bypass (projectId/siteKey missing)");
    return { ok: true, bypass: true, score: null, threshold };
  }

  if (!token) return { ok: false, reason: "missing_token" };

  const userIp = getClientIp(req);
  const userAgent = String(req.headers["user-agent"] || "");

  const parent = `projects/${projectId}`;

  const [assessment] = await recaptchaClient.createAssessment({
    parent,
    assessment: {
      event: {
        token,
        siteKey,
        expectedAction: expectedAction || undefined,
        userAgent: userAgent || undefined,
        userIpAddress: userIp || undefined,
      },
    },
  });

  const tokenProps = assessment && assessment.tokenProperties;
  if (!tokenProps || tokenProps.valid !== true) {
    return {
      ok: false,
      reason: "invalid_token",
      invalidReason: tokenProps ? tokenProps.invalidReason : null,
    };
  }

  // Action check (reCAPTCHA est case-sensitive)
  if (expectedAction && tokenProps.action && String(tokenProps.action) !== String(expectedAction)) {
    return {
      ok: false,
      reason: "action_mismatch",
      expected: expectedAction,
      got: tokenProps.action,
    };
  }

  const score =
    assessment &&
    assessment.riskAnalysis &&
    typeof assessment.riskAnalysis.score === "number"
      ? assessment.riskAnalysis.score
      : null;

  if (typeof score === "number" && score < threshold) {
    return { ok: false, reason: "low_score", score, threshold };
  }

  return { ok: true, score, threshold };
}

/* ============================
   1) Endpoint public: /recaptchaVerify
   ============================ */
exports.recaptchaVerify = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, reason: "method_not_allowed" });
    }
    if (!req.is("application/json")) {
      return res.status(400).json({ ok: false, reason: "invalid_content_type" });
    }

    try {
      const { token, action } = req.body || {};
      const expectedAction = normalizeAction(action);

      if (!token || !expectedAction) {
        return res.status(400).json({ ok: false, reason: "missing_token_or_action" });
      }

      const r = await verifyRecaptchaToken({ token, expectedAction, req });

      if (!r.ok) {
        return res.status(401).json({ ok: false, reason: r.reason, details: r });
      }

      return res.status(200).json({ ok: true, score: r.score ?? null });
    } catch (e) {
      console.error("recaptchaVerify error:", e);
      return res.status(500).json({ ok: false, reason: "server_error" });
    }
  });

/* ============================
   2) Cloud Function: interview (protégée par reCAPTCHA)
   ============================ */
exports.interview = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(req, res);
    if (req.method === "OPTIONS") return res.status(204).send("");

    if (req.method !== "POST") {
      return res.status(405).json({ error: "method_not_allowed" });
    }
    if (!req.is("application/json")) {
      return res.status(400).json({ error: "invalid_content_type" });
    }

    try {
      const body = req.body || {};

      // ✅ on accepte plusieurs noms côté front
      const token =
        body.recaptchaToken ||
        body.token ||
        (body.recaptcha && body.recaptcha.token) ||
        null;

      // ✅ action: on force une convention stable
      // IMPORTANT : le front doit générer un token avec CETTE action
      const expectedAction = normalizeAction(body.recaptchaAction || body.actionName || "interview");

      if (!token) {
        return res.status(403).json({
          error: "reCAPTCHA failed",
          details: "token_missing_or_invalid",
          expectedAction,
        });
      }

      const r = await verifyRecaptchaToken({ token, expectedAction, req });
      if (!r.ok) {
        return res.status(403).json({
          error: "reCAPTCHA failed",
          details: r.reason,
          score: r.score ?? null,
          expectedAction,
          extra: r,
        });
      }

      // ✅ Ici, tu continues TON code interview (Gemini / sessions / credits etc.)
      // Pour que ça compile direct, je renvoie juste un OK:
      // Remplace cette partie par ton handler actuel (start/answer) si tu l’as déjà ici.

      return res.status(200).json({ ok: true, message: "interview OK", score: r.score ?? null });
    } catch (e) {
      console.error("interview error:", e);
      return res.status(500).json({ error: "internal_error" });
    }
  });
