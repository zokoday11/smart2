// /lib/gemini.ts
// Client-side helpers to call Firebase Cloud Functions (Gemini / PDF / Interview / reCAPTCHA / Jobs / Polar).
// ✅ Single source of truth: NEXT_PUBLIC_API_BASE_URL
// ✅ Optional emulator: NEXT_PUBLIC_USE_FUNCTIONS_EMULATOR + NEXT_PUBLIC_FUNCTIONS_EMULATOR_URL
// ✅ No runtime "process" usage beyond build-time inlined NEXT_PUBLIC_*.

export type Lang = "fr" | "en";

export type SkillSection = { title: string; items: string[] };
export type SkillsBlock = { sections: SkillSection[]; tools: string[] };

export type Experience = {
  company?: string;
  role?: string;
  title?: string;
  dates?: string;
  city?: string;
  location?: string;
  bullets?: string[];
};

export type Education = {
  school?: string;
  degree?: string;
  dates?: string;
};

export type Profile = {
  fullName?: string;
  name?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  profileSummary?: string;
  summary?: string;

  city?: string;
  address?: string;

  contractType?: string;
  contractTypeStandard?: string;
  contractTypeFull?: string;

  primaryDomain?: string;
  secondaryDomains?: string[];

  skills?: SkillsBlock | string[];
  softSkills?: string[];

  experiences?: Experience[];
  education?: Education[];
  educationShort?: string[];

  certs?: string;
  langLine?: string;
  lang?: string;

  hobbies?: string[];

  drivingLicense?: string;
  vehicle?: string;
};

export type ExtractProfileResult = Profile;

export type GenerateLetterAndPitchResult = {
  lang: Lang;
  letterBody: string; // body only
  coverLetter: string; // fully formatted doc (header/date/objet/salutation/signature)
  pitch: string;
};

export type InterviewQAItem = { question: string; answer: string };

export type GenerateInterviewQAResult = {
  questions: InterviewQAItem[];
  lang: Lang;
};

export type InterviewStartResult = {
  sessionId: string;
  step: number;
  totalQuestions: number;
  next_question: string | null;
  short_analysis: string;
  final_summary: string | null;
  final_score: number | null;
};

export type InterviewAnswerResult = InterviewStartResult;

export type RecaptchaVerifyResult =
  | { ok: true; score?: number; threshold?: number }
  | {
      ok: false;
      reason: string;
      score?: number;
      threshold?: number;
      invalidReason?: string;
    };

type JsonValue = any;

function stripTrailingSlash(u: string) {
  return u.replace(/\/+$/, "");
}

// --- base url selection (prod by default) ---
const BASE_URL = (() => {
  const prod =
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL || // backward compat if still present
    "https://europe-west1-assistant-ia-v4.cloudfunctions.net";

  const useEmu =
    (process.env.NEXT_PUBLIC_USE_FUNCTIONS_EMULATOR || "").trim() === "1";

  const emu =
    process.env.NEXT_PUBLIC_FUNCTIONS_EMULATOR_URL ||
    "http://127.0.0.1:5001/assistant-ia-v4/europe-west1";

  return stripTrailingSlash(useEmu ? emu : prod);
})();

function getFunctionsBaseUrl(): string {
  return BASE_URL;
}

function buildHeaders(opts?: {
  idToken?: string;
  extra?: Record<string, string>;
}): HeadersInit {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts?.extra || {}),
  };
  if (opts?.idToken) h.Authorization = `Bearer ${opts.idToken}`;
  return h;
}

async function parseError(resp: Response): Promise<{ message: string; data?: any }> {
  const ct = resp.headers.get("content-type") || "";
  try {
    if (ct.includes("application/json")) {
      const j = await resp.json();
      const msg =
        (j && (j.message || j.error || j?.details?.reason || j?.details?.error)) ||
        JSON.stringify(j);
      return { message: String(msg), data: j };
    }
    const t = await resp.text();
    return { message: t || `${resp.status} ${resp.statusText}` };
  } catch {
    return { message: `${resp.status} ${resp.statusText}` };
  }
}

async function postJson<T = JsonValue>(
  path: string,
  body: any,
  opts?: { idToken?: string }
): Promise<T> {
  const url = `${getFunctionsBaseUrl()}/${path.replace(/^\/+/, "")}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: buildHeaders({ idToken: opts?.idToken }),
    body: JSON.stringify(body ?? {}),
  });

  if (!resp.ok) {
    const err = await parseError(resp);
    throw Object.assign(new Error(err.message), {
      status: resp.status,
      data: err.data,
      url,
    });
  }

  return (await resp.json()) as T;
}

async function postBinary(
  path: string,
  body: any,
  opts?: { idToken?: string }
): Promise<Blob> {
  const url = `${getFunctionsBaseUrl()}/${path.replace(/^\/+/, "")}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: buildHeaders({ idToken: opts?.idToken }),
    body: JSON.stringify(body ?? {}),
  });

  if (!resp.ok) {
    const err = await parseError(resp);
    throw Object.assign(new Error(err.message), {
      status: resp.status,
      data: err.data,
      url,
    });
  }

  const ab = await resp.arrayBuffer();
  const ct = resp.headers.get("content-type") || "application/octet-stream";
  return new Blob([ab], { type: ct });
}

// -----------------------------
// reCAPTCHA (optional)
// -----------------------------
export async function callRecaptchaVerify(args: {
  token: string;
  action: string;
}): Promise<RecaptchaVerifyResult> {
  return await postJson<RecaptchaVerifyResult>("recaptchaVerify", {
    token: args.token,
    action: args.action,
  });
}

// -----------------------------
// Gemini: extract profile from CV PDF base64
// -----------------------------
export async function callExtractProfile(args: {
  base64Pdf: string;
  recaptchaToken?: string;
  idToken?: string;
}): Promise<ExtractProfileResult> {
  return await postJson<ExtractProfileResult>(
    "extractProfile",
    {
      base64Pdf: args.base64Pdf,
      recaptchaToken: args.recaptchaToken,
      action: "extract_profile",
      recaptchaAction: "extract_profile",
    },
    { idToken: args.idToken }
  );
}

// -----------------------------
// Gemini: generate letter + pitch
// -----------------------------
export async function callGenerateLetterAndPitch(args: {
  profile: Profile;
  jobDescription?: string;
  jobTitle?: string;
  companyName?: string;
  lang?: Lang;
  recaptchaToken?: string;
  idToken?: string;
}): Promise<GenerateLetterAndPitchResult> {
  return await postJson<GenerateLetterAndPitchResult>(
    "generateLetterAndPitch",
    {
      profile: args.profile,
      jobDescription: args.jobDescription || "",
      jobTitle: args.jobTitle || "",
      companyName: args.companyName || "",
      lang: args.lang || "fr",
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "generate_letter_pitch",
      action: "generate_letter_pitch",
    },
    { idToken: args.idToken }
  );
}

// -----------------------------
// Gemini: generate interview Q&A
// -----------------------------
export async function callGenerateInterviewQA(args: {
  profile: Profile;
  experienceIndex: number;
  lang?: Lang;
  recaptchaToken?: string;
  idToken?: string;
}): Promise<GenerateInterviewQAResult> {
  return await postJson<GenerateInterviewQAResult>(
    "generateInterviewQA",
    {
      profile: args.profile,
      experienceIndex: args.experienceIndex,
      lang: args.lang || "fr",
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "generate_interview_qa",
      action: "generate_interview_qa",
    },
    { idToken: args.idToken }
  );
}

// -----------------------------
// Interview simulation
// -----------------------------
export async function callInterviewStart(args: {
  userId: string;
  jobTitle?: string;
  jobDesc?: string;
  interviewMode?: "complet" | "rapide" | "technique" | "comportemental";
  difficulty?: "standard" | "difficile";
  recaptchaToken?: string;
  idToken?: string;
}): Promise<InterviewStartResult> {
  return await postJson<InterviewStartResult>(
    "interview",
    {
      action: "start",
      userId: args.userId,
      jobTitle: args.jobTitle || "",
      jobDesc: args.jobDesc || "",
      interviewMode: args.interviewMode || "complet",
      difficulty: args.difficulty || "standard",
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "interview",
    },
    { idToken: args.idToken }
  );
}

export async function callInterviewAnswer(args: {
  userId: string;
  sessionId: string;
  userMessage: string;
  recaptchaToken?: string;
  idToken?: string;
}): Promise<InterviewAnswerResult> {
  return await postJson<InterviewAnswerResult>(
    "interview",
    {
      action: "answer",
      userId: args.userId,
      sessionId: args.sessionId,
      userMessage: args.userMessage,
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "interview",
    },
    { idToken: args.idToken }
  );
}

// -----------------------------
// PDF endpoints (return Blob)
// -----------------------------
export async function callGenerateCvPdf(args: {
  profile: Profile;
  targetJob?: string;
  lang?: Lang;
  contract?: string;
  jobLink?: string;
  jobDescription?: string;
  companyName?: string;
  recaptchaToken?: string;
  idToken: string; // required
}): Promise<Blob> {
  return await postBinary(
    "generateCvPdf",
    {
      profile: args.profile,
      targetJob: args.targetJob || "",
      lang: args.lang || "fr",
      contract: args.contract || "",
      jobLink: args.jobLink || "",
      jobDescription: args.jobDescription || "",
      companyName: args.companyName || "",
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "generate_cv_pdf",
      action: "generate_cv_pdf",
    },
    { idToken: args.idToken }
  );
}

export async function callGenerateCvLmZip(args: {
  profile: Profile;
  targetJob?: string;
  lang?: Lang;
  contract?: string;
  jobLink?: string;
  jobDescription?: string;
  lm: {
    jobTitle?: string;
    companyName?: string;
    jobDescription?: string;
    lang?: Lang;
  };
  recaptchaToken?: string;
  idToken: string;
}): Promise<Blob> {
  return await postBinary(
    "generateCvLmZip",
    {
      profile: args.profile,
      targetJob: args.targetJob || "",
      lang: args.lang || "fr",
      contract: args.contract || "",
      jobLink: args.jobLink || "",
      jobDescription: args.jobDescription || "",
      lm: args.lm || {},
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "generate_cv_lm_zip",
      action: "generate_cv_lm_zip",
    },
    { idToken: args.idToken }
  );
}

export async function callGenerateLetterPdf(args: {
  coverLetter: string;
  jobTitle?: string;
  companyName?: string;
  candidateName?: string;
  lang?: Lang;
  recaptchaToken?: string;
  idToken?: string;
}): Promise<Blob> {
  return await postBinary(
    "generateLetterPdf",
    {
      coverLetter: args.coverLetter,
      jobTitle: args.jobTitle || "",
      companyName: args.companyName || "",
      candidateName: args.candidateName || "",
      lang: args.lang || "fr",
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "generate_letter_pdf",
      action: "generate_letter_pdf",
    },
    { idToken: args.idToken }
  );
}

// -----------------------------
// Jobs search (Adzuna proxy)
// -----------------------------
export type JobItem = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  created: string;
  salary: string | null;
};

export type JobsSearchResult = { jobs: JobItem[] };

export async function callJobsSearch(args: {
  query?: string;
  location?: string;
  page?: number;
  recaptchaToken?: string;
  idToken?: string;
}): Promise<JobsSearchResult> {
  return await postJson<JobsSearchResult>(
    "jobs",
    {
      query: args.query || "",
      location: args.location || "",
      page: typeof args.page === "number" ? args.page : 1,
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "jobs_search",
      action: "jobs_search",
    },
    { idToken: args.idToken }
  );
}

// -----------------------------
// Polar checkout
// -----------------------------
export type PolarCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function callPolarCheckout(args: {
  packId: "20" | "50" | "100" | string;
  userId: string;
  email: string;
  recaptchaToken?: string;
  idToken?: string;
}): Promise<PolarCheckoutResult> {
  return await postJson<PolarCheckoutResult>(
    "polarCheckout",
    {
      packId: args.packId,
      userId: args.userId,
      email: args.email,
      recaptchaToken: args.recaptchaToken,
      recaptchaAction: "polar_checkout",
      action: "polar_checkout",
    },
    { idToken: args.idToken }
  );
}
