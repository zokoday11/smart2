// lib/gemini.ts
// Client-side helpers to call Cloud Functions / API routes + handle reCAPTCHA v3.
//
// Prérequis:
// - Définir NEXT_PUBLIC_RECAPTCHA_SITE_KEY (clé site reCAPTCHA v3) dans .env
// - (optionnel) NEXT_PUBLIC_CLOUD_FUNCTIONS_BASE_URL sinon défaut: europe-west1-assistant-ia-v4
//
// Cette lib charge automatiquement le script reCAPTCHA si besoin.

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

export type Language = "fr" | "en";

export type ProfileData = {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  title?: string;
  summary?: string;

  links?: Array<{ label?: string; url: string }>;

  skills?: string[];
  languages?: Array<{ name: string; level?: string }>;

  experiences?: Array<{
    company?: string;
    title?: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
    bullets?: string[];
  }>;

  education?: Array<{
    school?: string;
    degree?: string;
    field?: string;
    startDate?: string;
    endDate?: string;
    location?: string;
    details?: string[];
  }>;

  projects?: Array<{
    name?: string;
    description?: string;
    bullets?: string[];
    links?: Array<{ label?: string; url: string }>;
  }>;

  certifications?: Array<{
    name?: string;
    issuer?: string;
    date?: string;
  }>;
};

export type LetterAndPitchResponse = {
  coverLetter: string;
  pitch: string;
};

export type InterviewQAResponse = {
  questions: Array<{
    question: string;
    expectedPoints?: string[];
    sampleAnswer?: string;
  }>;
  lang: Language;
};

/** --- Config URLs --- */

function stripTrailingSlash(s: string) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

const CF_BASE =
  stripTrailingSlash(
    process.env.NEXT_PUBLIC_CLOUD_FUNCTIONS_BASE_URL ||
      "https://europe-west1-assistant-ia-v4.cloudfunctions.net"
  ) || "https://europe-west1-assistant-ia-v4.cloudfunctions.net";

const URL_EXTRACT_PROFILE = `${CF_BASE}/extractProfile`;
const URL_GENERATE_INTERVIEW_QA = `${CF_BASE}/generateInterviewQA`;
const URL_GENERATE_CV_PDF = `${CF_BASE}/generateCvPdf`;
const URL_GENERATE_CV_LM_ZIP = `${CF_BASE}/generateCvLmZip`;
const URL_GENERATE_LETTER_AND_PITCH_CF = `${CF_BASE}/generateLetterAndPitch`;
const URL_GENERATE_LETTER_PDF = `${CF_BASE}/generateLetterPdf`;

// App Route (Next.js) — si tu utilises /api/letterAndPitch côté serveur
const URL_LETTER_AND_PITCH_API = "/api/letterAndPitch";

/** --- reCAPTCHA v3 loader/token --- */

const SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ||
  process.env.NEXT_PUBLIC_RECAPTCHA_KEY ||
  "";

let recaptchaLoadPromise: Promise<void> | null = null;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function describeRecaptchaLoadFailure() {
  return [
    "Sécurité: impossible de valider reCAPTCHA.",
    "Le script reCAPTCHA n’a pas pu être chargé.",
    "Causes fréquentes: bloqueur de pubs (uBlock/Adblock), DNS filtrant, proxy/corporate, CSP trop stricte, ou réseau qui bloque google.com.",
  ].join(" ");
}

async function ensureRecaptchaLoaded(): Promise<void> {
  if (!isBrowser()) {
    throw new Error(
      "reCAPTCHA: appelé côté serveur. Cette fonction doit être utilisée côté navigateur."
    );
  }
  if (!SITE_KEY) {
    throw new Error(
      "reCAPTCHA: NEXT_PUBLIC_RECAPTCHA_SITE_KEY manquant. Ajoute la clé site reCAPTCHA v3 dans .env."
    );
  }
  if (window.grecaptcha) return;

  // Déjà en cours de chargement ?
  if (recaptchaLoadPromise) return recaptchaLoadPromise;

  recaptchaLoadPromise = new Promise<void>((resolve, reject) => {
    // Si un script est déjà présent, attend un peu qu'il expose grecaptcha
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-recaptcha="v3"]'
    );
    if (existing) {
      const t0 = Date.now();
      const tick = () => {
        if (window.grecaptcha) return resolve();
        if (Date.now() - t0 > 8000) return reject(new Error(describeRecaptchaLoadFailure()));
        requestAnimationFrame(tick);
      };
      tick();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(
      SITE_KEY
    )}`;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-recaptcha", "v3");

    const timeout = window.setTimeout(() => {
      reject(new Error(describeRecaptchaLoadFailure()));
    }, 8000);

    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.grecaptcha) resolve();
      else reject(new Error(describeRecaptchaLoadFailure()));
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error(describeRecaptchaLoadFailure()));
    };

    document.head.appendChild(script);
  });

  return recaptchaLoadPromise;
}

async function getRecaptchaToken(action: string): Promise<string> {
  await ensureRecaptchaLoaded();

  return await new Promise<string>((resolve, reject) => {
    const g = window.grecaptcha;
    if (!g) return reject(new Error(describeRecaptchaLoadFailure()));

    try {
      g.ready(() => {
        g.execute(SITE_KEY, { action })
          .then((token) => {
            if (!token) reject(new Error("reCAPTCHA: token vide."));
            else resolve(token);
          })
          .catch((e) =>
            reject(
              new Error(
                `reCAPTCHA: échec execute("${action}"): ${
                  e instanceof Error ? e.message : String(e)
                }`
              )
            )
          );
      });
    } catch (e) {
      reject(
        new Error(
          `reCAPTCHA: erreur interne: ${e instanceof Error ? e.message : String(e)}`
        )
      );
    }
  });
}

/** Expose si tu veux “pré-chauffer” reCAPTCHA au chargement de page */
export async function warmupRecaptcha(): Promise<void> {
  await ensureRecaptchaLoaded();
}

/** --- Fetch helpers --- */

type FetchJsonOptions = {
  timeoutMs?: number;
  headers?: Record<string, string>;
};

async function readErrorBody(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const j = await res.json().catch(() => null);
      if (j && typeof j === "object") {
        const msg =
          (j as any).error ||
          (j as any).message ||
          JSON.stringify(j).slice(0, 2000);
        return msg;
      }
    }
    const t = await res.text().catch(() => "");
    return t || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function fetchJson<T>(
  url: string,
  body: unknown,
  opts: FetchJsonOptions = {}
): Promise<T> {
  const controller = opts.timeoutMs ? new AbortController() : undefined;
  const timer =
    controller && opts.timeoutMs
      ? window.setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.headers || {}),
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    if (!res.ok) {
      const msg = await readErrorBody(res);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }

    return (await res.json()) as T;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

async function fetchBinary(
  url: string,
  body: unknown,
  opts: FetchJsonOptions = {}
): Promise<Blob> {
  const controller = opts.timeoutMs ? new AbortController() : undefined;
  const timer =
    controller && opts.timeoutMs
      ? window.setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.headers || {}),
      },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });

    if (!res.ok) {
      const msg = await readErrorBody(res);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }

    return await res.blob();
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}

/** --- Domain helpers --- */

function buildExperienceJobDescription(profile: ProfileData, experienceIndex: number): {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
} {
  const exp = profile.experiences?.[experienceIndex];

  const jobTitle =
    exp?.title?.trim() ||
    profile.title?.trim() ||
    "Poste (intitulé non renseigné)";

  const companyName =
    exp?.company?.trim() || "Entreprise (non renseignée)";

  const lines: string[] = [];

  if (exp?.title || exp?.company) {
    lines.push(`Expérience ciblée: ${exp?.title || "—"} chez ${exp?.company || "—"}`);
  }
  if (exp?.location) lines.push(`Lieu: ${exp.location}`);
  if (exp?.startDate || exp?.endDate) {
    lines.push(`Période: ${exp?.startDate || "?"} → ${exp?.endDate || "?"}`);
  }
  if (exp?.description) {
    lines.push("");
    lines.push(exp.description);
  }
  if (exp?.bullets?.length) {
    lines.push("");
    lines.push("Points clés:");
    for (const b of exp.bullets) {
      if (b?.trim()) lines.push(`- ${b.trim()}`);
    }
  }

  // Enrichissement léger avec skills/summary
  if (profile.skills?.length) {
    lines.push("");
    lines.push(`Compétences (extrait): ${profile.skills.slice(0, 12).join(", ")}`);
  }
  if (profile.summary?.trim()) {
    lines.push("");
    lines.push(`Résumé candidat: ${profile.summary.trim()}`);
  }

  const jobDescription = lines.join("\n").trim() || "Description non disponible.";

  return { jobTitle, companyName, jobDescription };
}

/** --- Public API --- */

/**
 * Extrait un profil structuré à partir d'un texte (CV / LinkedIn / etc.)
 * Cloud Function: extractProfile (protégée reCAPTCHA)
 */
export async function callExtractProfile(profileText: string): Promise<ProfileData> {
  const recaptchaToken = await getRecaptchaToken("extract_profile");

  return await fetchJson<ProfileData>(
    URL_EXTRACT_PROFILE,
    { text: profileText, recaptchaToken },
    { timeoutMs: 60_000 }
  );
}

/**
 * Génère lettre + pitch via l'API Next.js (/api/letterAndPitch).
 * (Cette route n’est pas protégée reCAPTCHA dans ton contexte actuel.)
 */
export async function callGenerateLetterAndPitch(
  profile: ProfileData,
  jobOffer: {
    companyName: string;
    jobTitle: string;
    jobDescription: string;
    location?: string;
  }
): Promise<LetterAndPitchResponse> {
  return await fetchJson<LetterAndPitchResponse>(
    URL_LETTER_AND_PITCH_API,
    { profile, jobOffer },
    { timeoutMs: 90_000 }
  );
}

/**
 * Variante si tu utilises la Cloud Function generateLetterAndPitch (protégée reCAPTCHA).
 */
export async function callGenerateLetterAndPitchCF(
  profile: ProfileData,
  jobOffer: {
    companyName: string;
    jobTitle: string;
    jobDescription: string;
    location?: string;
  },
  lang: Language = "fr"
): Promise<LetterAndPitchResponse> {
  const recaptchaToken = await getRecaptchaToken("generate_letter_pitch");

  return await fetchJson<LetterAndPitchResponse>(
    URL_GENERATE_LETTER_AND_PITCH_CF,
    { profile, jobOffer, lang, recaptchaToken },
    { timeoutMs: 120_000 }
  );
}

/**
 * Génère une liste de Q/R d’entretien depuis une expérience donnée du profil.
 * Cloud Function: generateInterviewQA (protégée reCAPTCHA)
 */
export async function callGenerateInterviewQA(params: {
  profile: ProfileData;
  experienceIndex: number;
  lang?: Language;
}): Promise<InterviewQAResponse> {
  const { profile, experienceIndex, lang = "fr" } = params;

  const { jobTitle, companyName, jobDescription } = buildExperienceJobDescription(
    profile,
    experienceIndex
  );

  const recaptchaToken = await getRecaptchaToken("generate_interview_qa");

  return await fetchJson<InterviewQAResponse>(
    URL_GENERATE_INTERVIEW_QA,
    {
      profile,
      jobTitle,
      companyName,
      jobDescription,
      lang,
      recaptchaToken,
    },
    { timeoutMs: 120_000 }
  );
}

/**
 * Génère un PDF de CV depuis un JSON de CV (cvJson).
 * Cloud Function: generateCvPdf (protégée reCAPTCHA)
 * Retourne un Blob PDF.
 */
export async function callGenerateCvPdf(cvJson: unknown): Promise<Blob> {
  const recaptchaToken = await getRecaptchaToken("generate_cv_pdf");

  return await fetchBinary(
    URL_GENERATE_CV_PDF,
    { cvJson, recaptchaToken },
    { timeoutMs: 120_000 }
  );
}

/**
 * Génère un ZIP (Latex/LM) à partir d'un cvJson.
 * Cloud Function: generateCvLmZip (protégée reCAPTCHA)
 */
export async function callGenerateCvLmZip(cvJson: unknown): Promise<Blob> {
  const recaptchaToken = await getRecaptchaToken("generate_cv_lm_zip");

  return await fetchBinary(
    URL_GENERATE_CV_LM_ZIP,
    { cvJson, recaptchaToken },
    { timeoutMs: 180_000 }
  );
}

/**
 * Génère un PDF de lettre (cover letter).
 * Cloud Function: generateLetterPdf (protégée reCAPTCHA)
 */
export async function callGenerateLetterPdf(params: {
  letterText: string;
  candidateName?: string;
  jobTitle?: string;
  companyName?: string;
  lang?: Language;
}): Promise<Blob> {
  const {
    letterText,
    candidateName = "",
    jobTitle = "",
    companyName = "",
    lang = "fr",
  } = params;

  const recaptchaToken = await getRecaptchaToken("generate_letter_pdf");

  return await fetchBinary(
    URL_GENERATE_LETTER_PDF,
    { letterText, candidateName, jobTitle, companyName, lang, recaptchaToken },
    { timeoutMs: 120_000 }
  );
}
