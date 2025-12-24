// lib/gemini.ts
"use client";

// Client-side helpers: Cloud Functions / API routes + reCAPTCHA via lib/recaptcha.ts
// ⚠️ Ce fichier ne doit contenir AUCUN JSX/React. Uniquement du TypeScript.

import { getRecaptchaToken } from "@/lib/recaptcha";

export type Language = "fr" | "en";

/** ------ Types domaine ------ */
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
    role?: string; // compat
    location?: string;
    city?: string; // compat
    startDate?: string;
    endDate?: string;
    dates?: string; // compat
    description?: string;
    bullets?: string[];
  }>;
  experience?: any; // compat
  [key: string]: any;
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
    answer?: string;
    a?: string;
    q?: string;
  }>;
  lang: Language;
};

/** Compat : ancienne page importait ce type */
export type GenerateInterviewQAResult = InterviewQAResponse;

/** ------ Config URLs ------ */
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

/** ------ Fetch helpers ------ */
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

/** ------ Domain helpers ------ */
function getExperiencesArray(profile: ProfileData): any[] {
  const a = (profile as any)?.experiences ?? (profile as any)?.experience ?? [];
  return Array.isArray(a) ? a : [];
}

function buildExperienceJobDescription(
  profile: ProfileData,
  experienceIndex: number
): {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  experience: any;
} {
  const experiences = getExperiencesArray(profile);

  if (
    typeof experienceIndex !== "number" ||
    Number.isNaN(experienceIndex) ||
    experienceIndex < 0 ||
    experienceIndex >= experiences.length
  ) {
    throw new Error("Indice d'expérience invalide.");
  }

  const exp = experiences[experienceIndex];

  const jobTitle =
    String(exp?.title || exp?.role || "").trim() ||
    String(profile.title || "").trim() ||
    "Poste (non renseigné)";

  const companyName =
    String(exp?.company || "").trim() || "Entreprise (non renseignée)";

  const lines: string[] = [];
  lines.push(`Expérience ciblée: ${jobTitle} chez ${companyName}`);

  const location = exp?.location || exp?.city || profile.location || "";
  if (location) lines.push(`Lieu: ${String(location)}`);

  const period =
    exp?.dates ||
    ((exp?.startDate || exp?.endDate)
      ? `${exp?.startDate || "?"} → ${exp?.endDate || "?"}`
      : "");
  if (period) lines.push(`Période: ${String(period)}`);

  if (exp?.description) {
    lines.push("");
    lines.push(String(exp.description));
  }

  if (Array.isArray(exp?.bullets) && exp.bullets.length) {
    lines.push("");
    lines.push("Points clés:");
    for (const b of exp.bullets) {
      const t = String(b || "").trim();
      if (t) lines.push(`- ${t}`);
    }
  }

  if (profile.skills?.length) {
    lines.push("");
    lines.push(`Compétences (extrait): ${profile.skills.slice(0, 12).join(", ")}`);
  }

  if (profile.summary?.trim()) {
    lines.push("");
    lines.push(`Résumé candidat: ${profile.summary.trim()}`);
  }

  const jobDescription = lines.join("\n").trim() || "Description non disponible.";
  return { jobTitle, companyName, jobDescription, experience: exp };
}

/** ------ Public API ------ */
export async function callExtractProfile(profileText: string): Promise<ProfileData> {
  const recaptchaToken = await getRecaptchaToken("extract_profile");
  return await fetchJson<ProfileData>(
    URL_EXTRACT_PROFILE,
    { text: profileText, recaptchaToken },
    { timeoutMs: 60_000 }
  );
}

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

/** ✅ Q/R entretien sur une expérience (Cloud Function) */
export async function callGenerateInterviewQA(params: {
  profile: ProfileData;
  experienceIndex: number;
  lang?: Language;
}): Promise<InterviewQAResponse> {
  const { profile, experienceIndex, lang = "fr" } = params;

  const { jobTitle, companyName, jobDescription, experience } =
    buildExperienceJobDescription(profile, experienceIndex);

  const recaptchaToken = await getRecaptchaToken("generate_interview_qa");

  return await fetchJson<InterviewQAResponse>(
    URL_GENERATE_INTERVIEW_QA,
    {
      experienceIndex, // ✅ important
      profile,
      experience,
      jobTitle,
      companyName,
      jobDescription,
      lang,
      recaptchaToken,
    },
    { timeoutMs: 120_000 }
  );
}

export async function callGenerateCvPdf(cvJson: unknown): Promise<Blob> {
  const recaptchaToken = await getRecaptchaToken("generate_cv_pdf");
  return await fetchBinary(
    URL_GENERATE_CV_PDF,
    { cvJson, recaptchaToken },
    { timeoutMs: 120_000 }
  );
}

export async function callGenerateCvLmZip(cvJson: unknown): Promise<Blob> {
  const recaptchaToken = await getRecaptchaToken("generate_cv_lm_zip");
  return await fetchBinary(
    URL_GENERATE_CV_LM_ZIP,
    { cvJson, recaptchaToken },
    { timeoutMs: 180_000 }
  );
}

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
