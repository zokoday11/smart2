// app/app/lm/page.tsx
"use client";

import { logUsage } from "@/lib/logUsage";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { motion } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

// ✅ PDF (génération locale, rendu identique à tes HTML pdfmake)
import { makePdfColors } from "@/lib/pdf/colors";
import { fitOnePage } from "@/lib/pdf/fitOnePage";
import { mergePdfBlobs } from "@/lib/pdf/mergePdfs";
import { downloadBlob } from "@/lib/pdf/pdfmakeClient";
import { buildCvAtsPdf, type CvDocModel } from "@/lib/pdf/templates/cvAts";
import { buildLmStyledPdf, type LmModel } from "@/lib/pdf/templates/letter";

// --- TYPES ---

type CvSkillsSection = { title: string; items: string[] };
type CvSkills = { sections: CvSkillsSection[]; tools: string[] };

type CvExperience = {
  company: string;
  role: string;
  dates: string;
  bullets: string[];
  location?: string;
};

type CvEducation = {
  school: string;
  degree: string;
  dates: string;
  location?: string;
};

type CvProfile = {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  profileSummary: string;

  city?: string;
  address?: string;

  contractType: string;
  contractTypeStandard?: string;
  contractTypeFull?: string;

  primaryDomain?: string;
  secondaryDomains?: string[];
  softSkills?: string[];

  drivingLicense?: string;
  vehicle?: string;

  skills: CvSkills;
  experiences: CvExperience[];
  education: CvEducation[];
  educationShort: string[];
  certs: string;
  langLine: string;
  hobbies: string[];
  updatedAt?: number;
};

type Lang = "fr" | "en";

// 🔗 ENDPOINT (texte IA LM + pitch uniquement)
const LETTER_AND_PITCH_URL =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterAndPitch";

// =============================
// ✅ reCAPTCHA Enterprise (client)
// =============================

const RECAPTCHA_SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "";
let recaptchaLoadPromise: Promise<void> | null = null;

function loadRecaptchaEnterprise(siteKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("reCAPTCHA: window indisponible (SSR)."));
  }
  if ((window as any).grecaptcha?.enterprise) return Promise.resolve();
  if (recaptchaLoadPromise) return recaptchaLoadPromise;

  recaptchaLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-recaptcha-enterprise="true"]'
    ) as HTMLScriptElement | null;

    if (existing) {
      const t = window.setInterval(() => {
        if ((window as any).grecaptcha?.enterprise) {
          window.clearInterval(t);
          resolve();
        }
      }, 50);

      window.setTimeout(() => {
        window.clearInterval(t);
        if (!(window as any).grecaptcha?.enterprise) {
          reject(new Error("reCAPTCHA Enterprise non disponible (timeout)."));
        }
      }, 6000);
      return;
    }

    const s = document.createElement("script");
    s.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(
      siteKey
    )}`;
    s.async = true;
    s.defer = true;
    s.setAttribute("data-recaptcha-enterprise", "true");

    s.onload = () => {
      const t = window.setInterval(() => {
        if ((window as any).grecaptcha?.enterprise) {
          window.clearInterval(t);
          resolve();
        }
      }, 50);

      window.setTimeout(() => {
        window.clearInterval(t);
        if (!(window as any).grecaptcha?.enterprise) {
          reject(new Error("reCAPTCHA Enterprise non disponible (timeout)."));
        }
      }, 6000);
    };

    s.onerror = () =>
      reject(new Error("Impossible de charger reCAPTCHA Enterprise."));
    document.head.appendChild(s);
  });

  return recaptchaLoadPromise;
}

async function getRecaptchaToken(action: string): Promise<string> {
  if (!RECAPTCHA_SITE_KEY) {
    throw new Error("reCAPTCHA: NEXT_PUBLIC_RECAPTCHA_SITE_KEY manquante.");
  }

  await loadRecaptchaEnterprise(RECAPTCHA_SITE_KEY);

  const g = (window as any).grecaptcha;
  if (!g?.enterprise?.ready || !g?.enterprise?.execute) {
    throw new Error(
      "reCAPTCHA Enterprise indisponible (grecaptcha.enterprise manquant)."
    );
  }

  await new Promise<void>((resolve) => g.enterprise.ready(() => resolve()));
  const token = await g.enterprise.execute(RECAPTCHA_SITE_KEY, { action });

  if (!token || typeof token !== "string") {
    throw new Error("reCAPTCHA: token vide.");
  }
  return token;
}

// =============================
// ✅ Helpers (texte & PDF locaux)
// =============================

function safeText(v: any) {
  return String(v ?? "").trim();
}

function buildContactLine(p: CvProfile) {
  const parts: string[] = [];
  if (p.city) parts.push(safeText(p.city));
  if (p.phone) parts.push(safeText(p.phone));
  if (p.email) parts.push(safeText(p.email));
  if (p.linkedin) parts.push(safeText(p.linkedin));
  return parts.filter(Boolean).join(" | ");
}

function categorizeSkills(profile: CvProfile) {
  const cloud: string[] = [];
  const sec: string[] = [];
  const sys: string[] = [];
  const auto: string[] = [];
  const tools: string[] = [];
  const soft: string[] = Array.isArray(profile.softSkills) ? profile.softSkills : [];

  const sections = profile.skills?.sections || [];
  for (const s of sections) {
    const title = (s?.title || "").toLowerCase();
    const items = (s?.items || []).filter(Boolean);

    const pushAll = (arr: string[], vals: string[]) => vals.forEach((x) => arr.push(x));

    if (title.includes("cloud") || title.includes("azure") || title.includes("aws") || title.includes("gcp")) {
      pushAll(cloud, items);
    } else if (title.includes("sécu") || title.includes("secu") || title.includes("security") || title.includes("cyber")) {
      pushAll(sec, items);
    } else if (
      title.includes("réseau") ||
      title.includes("reseau") ||
      title.includes("system") ||
      title.includes("système") ||
      title.includes("sys")
    ) {
      pushAll(sys, items);
    } else if (title.includes("autom") || title.includes("devops") || title.includes("ia") || title.includes("api")) {
      pushAll(auto, items);
    } else {
      pushAll(tools, items);
    }
  }

  const extraTools = Array.isArray(profile.skills?.tools) ? profile.skills.tools : [];
  extraTools.forEach((t) => tools.push(t));

  const uniq = (arr: string[]) => Array.from(new Set(arr.map((x) => safeText(x)).filter(Boolean)));

  return {
    cloud: uniq(cloud),
    sec: uniq(sec),
    sys: uniq(sys),
    auto: uniq(auto),
    tools: uniq(tools),
    soft: uniq(soft),
  };
}

function profileToCvDocModel(profile: CvProfile, params: { targetJob: string; contract: string }): CvDocModel {
  const titleParts: string[] = [];
  if (params.targetJob?.trim()) titleParts.push(params.targetJob.trim());
  if (params.contract?.trim()) titleParts.push(params.contract.trim());
  const title = titleParts.length ? titleParts.join(" — ") : (profile.contractType || "Candidature");

  const skills = categorizeSkills(profile);

  const xp = (profile.experiences || []).map((x) => ({
    company: safeText(x.company),
    city: safeText(x.location || ""),
    role: safeText(x.role),
    dates: safeText(x.dates),
    bullets: Array.isArray(x.bullets) ? x.bullets.map(safeText).filter(Boolean) : [],
  }));

  const educationLines =
    Array.isArray(profile.educationShort) && profile.educationShort.length
      ? profile.educationShort.map(safeText).filter(Boolean)
      : (profile.education || []).map((e) => {
          const a = safeText(e.degree);
          const b = safeText(e.school);
          const c = safeText(e.dates);
          const d = safeText(e.location || "");
          return [a, b, c, d].filter(Boolean).join(" — ");
        });

  return {
    name: safeText(profile.fullName) || safeText(profile.email) || "Candidat",
    title,
    contactLine: buildContactLine(profile),
    profile: safeText(profile.profileSummary),
    skills,
    xp,
    education: educationLines,
    certs: safeText(profile.certs),
    langLine: safeText(profile.langLine),
    hobbies: Array.isArray(profile.hobbies) ? profile.hobbies.map(safeText).filter(Boolean) : [],
  };
}

// --- Pour que l’IA écrive une VRAIE lettre (expériences, résultats, outils) ---
function buildCandidateHighlights(profile: CvProfile) {
  const topXp = (profile.experiences || []).slice(0, 3).map((xp, i) => {
    const bullets = (xp.bullets || []).slice(0, 4).map((b) => `- ${b}`).join("\n");
    return `EXP${i + 1}: ${xp.role} @ ${xp.company} (${xp.dates}${xp.location ? `, ${xp.location}` : ""})
${bullets}`;
  });

  const skillLines = (profile.skills?.sections || [])
    .slice(0, 4)
    .map((s) => `${s.title}: ${(s.items || []).slice(0, 10).join(", ")}`);

  const tools = (profile.skills?.tools || []).slice(0, 18);

  return `
CANDIDATE_NAME: ${profile.fullName}
SUMMARY: ${profile.profileSummary}

TOP_EXPERIENCES:
${topXp.join("\n\n")}

KEY_SKILLS:
${skillLines.join("\n")}

TOOLS:
${tools.join(", ")}

CERTS: ${profile.certs}
LANGS: ${profile.langLine}
`.trim();
}

function buildJobDescWithInstructions(args: {
  jobDescription: string;
  lang: Lang;
  jobTitle: string;
  companyName: string;
  jobLink: string;
  profile: CvProfile;
}) {
  const base = (args.jobDescription || "").trim();

  const instrFR = `
---
INSTRUCTIONS IMPORTANTES (à respecter):
- Rédige une lettre de motivation PERSONNALISÉE et crédible.
- Utilise explicitement 2 à 3 expériences ci-dessous (réalisations / responsabilités).
- Mets en avant compétences + outils pertinents pour le poste.
- Adapte le discours à l'entreprise "${args.companyName}" et au poste "${args.jobTitle}".
- Ton: professionnel, concret, pas de blabla.
- Longueur: 220 à 320 mots (≈ 1 page A4).
- Structure: 3 à 4 paragraphes.
- Termine par une phrase d’appel à entretien.
- IMPORTANT: Retourne UNIQUEMENT le CORPS de la lettre (pas d’en-tête, pas d’adresse, pas de signature).

OFFRE_URL: ${args.jobLink || "(non fournie)"}

PROFIL (à utiliser):
${buildCandidateHighlights(args.profile)}
`.trim();

  const instrEN = `
---
IMPORTANT INSTRUCTIONS:
- Write a REAL, tailored cover letter (credible, specific).
- Explicitly use 2–3 experiences below (achievements/responsibilities).
- Highlight relevant skills + tools for the role.
- Adapt to company "${args.companyName}" and role "${args.jobTitle}".
- Tone: professional, concrete, no fluff.
- Length: 220–320 words (~1 A4 page).
- Structure: 3–4 paragraphs.
- End with a clear interview call-to-action.
- IMPORTANT: Return ONLY the BODY (no header, no address, no signature).

JOB_URL: ${args.jobLink || "(not provided)"}

PROFILE (use it):
${buildCandidateHighlights(args.profile)}
`.trim();

  const injected = args.lang === "fr" ? instrFR : instrEN;
  if (!base) return injected;
  return `${base}\n\n${injected}`;
}

function extractBodyFromLetterText(letterText: string, lang: Lang, fullName: string) {
  const raw = safeText(letterText);
  if (!raw) return "";

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return raw;

  const first = lines[0].toLowerCase();
  const isGreeting =
    (lang === "fr" && (first.startsWith("madame") || first.startsWith("bonjour"))) ||
    (lang === "en" && (first.startsWith("dear") || first.startsWith("hello")));

  if (isGreeting) lines.shift();

  while (lines.length) {
    const last = lines[lines.length - 1].toLowerCase();
    if (
      last.includes("cordialement") ||
      last.includes("bien cordialement") ||
      last.includes("salutations") ||
      last.includes("sincerely") ||
      last.includes("best regards") ||
      last.includes("kind regards")
    ) {
      lines.pop();
      continue;
    }
    if (fullName && last.includes(fullName.toLowerCase())) {
      lines.pop();
      continue;
    }
    break;
  }

  const body = lines.join("\n\n").trim();
  return body || raw;
}

function buildLmModel(profile: CvProfile, lang: Lang, companyName: string, jobTitle: string, letterText: string): LmModel {
  const name = safeText(profile.fullName) || "Candidat";
  const contactLines: string[] = [];
  if (profile.phone) contactLines.push(lang === "fr" ? `Téléphone : ${safeText(profile.phone)}` : `Phone: ${safeText(profile.phone)}`);
  if (profile.email) contactLines.push(lang === "fr" ? `Email : ${safeText(profile.email)}` : `Email: ${safeText(profile.email)}`);
  if (profile.linkedin) contactLines.push(lang === "fr" ? `LinkedIn : ${safeText(profile.linkedin)}` : `LinkedIn: ${safeText(profile.linkedin)}`);

  const city = safeText(profile.city) || "Paris";
  const dateStr =
    lang === "fr"
      ? new Date().toLocaleDateString("fr-FR")
      : new Date().toLocaleDateString("en-GB");

  const subject =
    lang === "fr"
      ? `Objet : Candidature – ${jobTitle || "poste"}`
      : `Subject: Application – ${jobTitle || "role"}`;

  const salutation = lang === "fr" ? "Madame, Monsieur," : "Dear Hiring Manager,";
  const closing = lang === "fr" ? "Cordialement," : "Sincerely,";

  const body = extractBodyFromLetterText(letterText, lang, name);

  return {
    lang,
    name,
    contactLines,
    service: lang === "fr" ? "Service Recrutement" : "Recruitment Team",
    companyName: safeText(companyName) || (lang === "fr" ? "Entreprise" : "Company"),
    companyAddr: "",
    city,
    dateStr,
    subject,
    salutation,
    body: body || safeText(letterText),
    closing,
    signature: name,
  };
}

// =============================
// PAGE
// =============================

export default function AssistanceCandidaturePage() {
  // --- PROFIL CV IA ---
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Bandeau global "IA en cours"
  const [globalLoadingMessage, setGlobalLoadingMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserId(null);
        setUserEmail(null);
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      setUserId(user.uid);
      setUserEmail(user.email ?? null);

      try {
        const ref = doc(db, "profiles", user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data() as any;

          const loadedProfile: CvProfile = {
            fullName: data.fullName || "",
            email: data.email || "",
            phone: data.phone || "",
            linkedin: data.linkedin || "",
            profileSummary: data.profileSummary || "",
            city: data.city || "",
            address: data.address || "",
            contractType: data.contractType || data.contractTypeStandard || "",
            contractTypeStandard: data.contractTypeStandard || "",
            contractTypeFull: data.contractTypeFull || "",
            primaryDomain: data.primaryDomain || "",
            secondaryDomains: Array.isArray(data.secondaryDomains) ? data.secondaryDomains : [],
            softSkills: Array.isArray(data.softSkills) ? data.softSkills : [],
            drivingLicense: data.drivingLicense || "",
            vehicle: data.vehicle || "",
            skills: {
              sections: Array.isArray(data.skills?.sections) ? data.skills.sections : [],
              tools: Array.isArray(data.skills?.tools) ? data.skills.tools : [],
            },
            experiences: Array.isArray(data.experiences) ? data.experiences : [],
            education: Array.isArray(data.education) ? data.education : [],
            educationShort: Array.isArray(data.educationShort) ? data.educationShort : [],
            certs: data.certs || "",
            langLine: data.langLine || "",
            hobbies: Array.isArray(data.hobbies) ? data.hobbies : [],
            updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : undefined,
          };

          setProfile(loadedProfile);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error("Erreur chargement profil Firestore (assistance):", e);
      } finally {
        setLoadingProfile(false);
      }
    });

    return () => unsub();
  }, []);

  // --- ÉTATS CV IA ---
  const [cvTargetJob, setCvTargetJob] = useState("");
  const [cvTemplate, setCvTemplate] = useState("ats");
  const [cvLang, setCvLang] = useState<Lang>("fr");
  const [cvContract, setCvContract] = useState("CDI");
  const [cvJobLink, setCvJobLink] = useState("");
  const [cvJobDesc, setCvJobDesc] = useState("");
  const [cvAutoCreate, setCvAutoCreate] = useState(true);

  const [cvLoading, setCvLoading] = useState(false);
  const [cvZipLoading, setCvZipLoading] = useState(false);
  const [cvStatus, setCvStatus] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);

  // ✅ Couleur PDF (rouge par défaut)
  const [pdfBrand, setPdfBrand] = useState("#ef4444"); // 🔴 rouge

  // --- ÉTATS LETTRE DE MOTIVATION ---
  const [lmLang, setLmLang] = useState<Lang>("fr");
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobLink, setJobLink] = useState("");
  const [letterText, setLetterText] = useState("");
  const [lmLoading, setLmLoading] = useState(false);
  const [lmError, setLmError] = useState<string | null>(null);
  const [letterCopied, setLetterCopied] = useState(false);
  const [lmPdfLoading, setLmPdfLoading] = useState(false);
  const [lmPdfError, setLmPdfError] = useState<string | null>(null);

  // --- ÉTATS PITCH ---
  const [pitchLang, setPitchLang] = useState<Lang>("fr");
  const [pitchText, setPitchText] = useState("");
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchError, setPitchError] = useState<string | null>(null);
  const [pitchCopied, setPitchCopied] = useState(false);

  // --- MAIL ---
  const [recruiterName, setRecruiterName] = useState("");
  const [emailPreview, setEmailPreview] = useState("");
  const [subjectPreview, setSubjectPreview] = useState("");

  // --- DERIVÉS ---
  const visibilityLabel = userId ? "Associé à ton compte" : "Invité";

  const miniHeadline =
    profile?.profileSummary?.split(".")[0] ||
    profile?.contractType ||
    "Analyse ton CV PDF dans l’onglet « CV IA » pour activer l’assistant.";

  const profileName = profile?.fullName || userEmail || "Profil non détecté";

  const targetedJob = jobTitle || cvTargetJob || "Poste cible non renseigné";
  const targetedCompany = companyName || "Entreprise non renseignée";

  // --- Auto create /applications ---
  type GenerationKind = "cv" | "cv_lm" | "lm" | "pitch";

  const autoCreateApplication = async (kind: GenerationKind) => {
    if (!cvAutoCreate) return;
    if (!userId || !profile) return;

    try {
      const appsRef = collection(db, "applications");
      await addDoc(appsRef, {
        userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        company: companyName || "",
        jobTitle: jobTitle || cvTargetJob || "",
        jobLink: jobLink || cvJobLink || "",
        status: "draft",
        source: "Assistant candidature IA",
        hasCv: kind === "cv" || kind === "cv_lm",
        hasLm: kind === "lm" || kind === "cv_lm",
        hasPitch: kind === "pitch",
        langCv: cvLang,
        langLm: lmLang,
        langPitch: pitchLang,
      });
    } catch (e) {
      console.error("Erreur création entrée suivi de candidature :", e);
    }
  };

  // =============================
  // ✅ Génération IA (lettre / pitch)
  // =============================

  const generateCoverLetterText = async (lang: Lang): Promise<string> => {
    if (!profile) throw new Error("Profil manquant.");
    if (!jobTitle && !jobDescription) {
      throw new Error("Ajoute au moins l'intitulé du poste ou un extrait de la description.");
    }

    const recaptchaToken = await getRecaptchaToken("generate_letter_pitch");

    // ✅ injection pour forcer une VRAIE lettre (expériences, outils, concret)
    const enrichedJobDescription = buildJobDescWithInstructions({
      jobDescription,
      lang,
      jobTitle,
      companyName,
      jobLink,
      profile,
    });

    const resp = await fetch(LETTER_AND_PITCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile,
        jobTitle,
        companyName,
        jobDescription: enrichedJobDescription,
        lang,
        recaptchaToken,
      }),
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = (json && json.error) || "Erreur pendant la génération de la lettre de motivation.";
      throw new Error(msg);
    }

    const coverLetter = typeof json.coverLetter === "string" ? json.coverLetter.trim() : "";
    if (!coverLetter) throw new Error("Lettre vide renvoyée par l'API.");
    return coverLetter;
  };

  // =============================
  // ✅ PDF locaux (CV + LM)
  // =============================

  const colors = useMemo(() => makePdfColors(pdfBrand), [pdfBrand]);

  const handleGenerateCv = async () => {
    if (!profile) {
      setCvError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF.");
      return;
    }

    setCvError(null);
    setCvStatus(null);
    setCvLoading(true);
    setGlobalLoadingMessage("Mise en page du CV (1 page)…");

    try {
      if (cvTemplate !== "ats") {
        setCvStatus("Note : génération locale disponible en ATS (sobre) pour le moment.");
      }

      const cvModel: CvDocModel = profileToCvDocModel(profile, {
        targetJob: cvTargetJob,
        contract: cvContract,
      });

      const { blob, bestScale } = await fitOnePage((scale) =>
        buildCvAtsPdf(cvModel, cvLang, colors, "auto", scale)
      );

      downloadBlob(blob, "cv-ia.pdf");
      setCvStatus(`CV généré (1 page) ✅ (scale=${bestScale.toFixed(2)})`);

      await autoCreateApplication("cv");

      if (auth.currentUser) {
        await logUsage({
          user: auth.currentUser,
          action: "generate_document",
          docType: "cv",
          eventType: "generate",
          tool: "clientPdfMakeCv",
        });
      }
    } catch (err: any) {
      console.error("Erreur génération CV locale:", err);
      setCvError(err?.message || "Impossible de générer le CV pour le moment.");
    } finally {
      setCvLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  const handleGenerateCvLmPdf = async () => {
    if (!profile) {
      setCvError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF.");
      return;
    }

    setCvError(null);
    setCvStatus(null);
    setCvZipLoading(true);
    setGlobalLoadingMessage("Mise en page CV + lettre (1 page + 1 page)…");

    try {
      // 1) CV
      const cvModel: CvDocModel = profileToCvDocModel(profile, {
        targetJob: cvTargetJob,
        contract: cvContract,
      });

      const cvFit = await fitOnePage((scale) =>
        buildCvAtsPdf(cvModel, cvLang, colors, "auto", scale)
      );

      // 2) Lettre : si pas encore générée -> IA
      let cover = letterText?.trim();
      if (!cover) {
        setGlobalLoadingMessage("Génération du texte de la lettre (IA)…");
        cover = await generateCoverLetterText(lmLang);
        setLetterText(cover);
      }

      const lmModel: LmModel = buildLmModel(profile, lmLang, companyName, jobTitle, cover);

      const lmFit = await fitOnePage(
        (scale) => buildLmStyledPdf(lmModel, colors, scale),
        { min: 0.85, max: 1.6, iterations: 7, initial: 1.0 }
      );

      // 3) Fusion -> 2 pages
      const merged = await mergePdfBlobs([cvFit.blob, lmFit.blob]);
      downloadBlob(merged, "cv-lm-ia.pdf");

      setCvStatus("CV (1 page) + LM (1 page) générés ✅ (PDF 2 pages)");
      await autoCreateApplication("cv_lm");

      if (auth.currentUser) {
        await logUsage({
          user: auth.currentUser,
          action: "generate_document",
          docType: "cv",
          eventType: "generate",
          tool: "clientPdfMakeCvLm",
        });
        await logUsage({
          user: auth.currentUser,
          action: "generate_document",
          docType: "lm",
          eventType: "generate",
          tool: "clientPdfMakeCvLm",
          creditsDelta: 0,
        });
      }
    } catch (err: any) {
      console.error("Erreur génération CV+LM locale:", err);
      setCvError(err?.message || "Impossible de générer CV + LM pour le moment.");
    } finally {
      setCvZipLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  // --- ACTIONS LETTRE ---
  const handleGenerateLetter = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!profile) {
      setLmError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF.");
      return;
    }
    if (!jobTitle && !jobDescription) {
      setLmError("Ajoute au moins l'intitulé du poste ou un extrait de la description.");
      return;
    }

    setLmError(null);
    setLmPdfError(null);
    setPitchError(null);
    setLmLoading(true);
    setLetterCopied(false);
    setGlobalLoadingMessage("L’IA rédige ta lettre de motivation…");

    try {
      const coverLetter = await generateCoverLetterText(lmLang);
      setLetterText(coverLetter);

      await autoCreateApplication("lm");

      if (auth.currentUser) {
        await logUsage({
          user: auth.currentUser,
          action: "generate_document",
          docType: "lm",
          eventType: "generate",
          tool: "generateLetterAndPitch",
        });
      }
    } catch (err: any) {
      console.error("Erreur generateLetter:", err);
      setLmError(err?.message || "Impossible de générer la lettre de motivation pour le moment.");
    } finally {
      setLmLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  // ✅ PDF LM local (auto-génère si texte vide)
  const handleDownloadLetterPdf = async () => {
    if (!profile) {
      setLmPdfError("Profil manquant.");
      return;
    }
    if (!jobTitle && !jobDescription && !letterText) {
      setLmPdfError("Renseigne au moins le poste ou colle un extrait d’offre, puis génère/télécharge.");
      return;
    }

    setLmPdfError(null);
    setLmPdfLoading(true);
    setGlobalLoadingMessage("Mise en forme PDF (lettre 1 page)…");

    try {
      let cover = letterText?.trim();
      if (!cover) {
        setGlobalLoadingMessage("Génération du texte de la lettre (IA)…");
        cover = await generateCoverLetterText(lmLang);
        setLetterText(cover);
      }

      const lmModel: LmModel = buildLmModel(profile, lmLang, companyName, jobTitle, cover);

      const { blob } = await fitOnePage(
        (scale) => buildLmStyledPdf(lmModel, colors, scale),
        { min: 0.85, max: 1.6, iterations: 7, initial: 1.0 }
      );

      downloadBlob(blob, "lettre-motivation.pdf");

      if (auth.currentUser) {
        await logUsage({
          user: auth.currentUser,
          action: "download_pdf",
          docType: "other",
          eventType: "lm_pdf_download",
          tool: "clientPdfMakeLm",
        });
      }
    } catch (err: any) {
      console.error("Erreur LM PDF (local):", err);
      setLmPdfError(err?.message || "Impossible de générer le PDF pour le moment.");
    } finally {
      setLmPdfLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  const handleCopyLetter = async () => {
    if (!letterText) return;
    try {
      await navigator.clipboard.writeText(letterText);
      setLetterCopied(true);
      setTimeout(() => setLetterCopied(false), 1500);
    } catch (e) {
      console.error("Erreur copie LM:", e);
    }
  };

  // --- PITCH ---
  const handleGeneratePitch = async () => {
    if (!profile) {
      setPitchError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF.");
      return;
    }

    const effectiveJobTitle = jobTitle || cvTargetJob || "Candidature cible";
    const effectiveDesc = jobDescription || cvJobDesc || "";

    setPitchError(null);
    setPitchLoading(true);
    setPitchCopied(false);
    setGlobalLoadingMessage("L’IA prépare ton pitch d’ascenseur…");

    try {
      const recaptchaToken = await getRecaptchaToken("generate_letter_pitch");

      const resp = await fetch(LETTER_AND_PITCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          jobTitle: effectiveJobTitle,
          companyName,
          jobDescription: effectiveDesc,
          lang: pitchLang,
          recaptchaToken,
        }),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok) {
        const msg = (json && json.error) || "Erreur pendant la génération du pitch.";
        throw new Error(msg);
      }

      const pitch = typeof json.pitch === "string" ? json.pitch.trim() : "";
      if (!pitch) throw new Error("Pitch vide renvoyé par l'API.");

      setPitchText(pitch);
      await autoCreateApplication("pitch");

      if (auth.currentUser) {
        await logUsage({
          user: auth.currentUser,
          action: "generate_pitch",
          docType: "other",
          eventType: "generate",
          tool: "generateLetterAndPitch",
        });
      }
    } catch (err: any) {
      console.error("Erreur generatePitch:", err);
      setPitchError(err?.message || "Impossible de générer le pitch pour le moment.");
    } finally {
      setPitchLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  const handleCopyPitch = async () => {
    if (!pitchText) return;
    try {
      await navigator.clipboard.writeText(pitchText);
      setPitchCopied(true);
      setTimeout(() => setPitchCopied(false), 1500);
    } catch (e) {
      console.error("Erreur copie pitch:", e);
    }
  };

  // --- MAIL ---
  const buildEmailContent = () => {
    const name = profile?.fullName || "Je";
    const subject = `Candidature – ${jobTitle || "poste"} – ${name}`;
    const recruiter = recruiterName.trim() || "Madame, Monsieur";

    const body = `Bonjour ${recruiter},

Je me permets de vous adresser ma candidature pour le poste de ${jobTitle || "..."} au sein de ${
      companyName || "votre entreprise"
    }.

Vous trouverez ci-joint mon CV ainsi que ma lettre de motivation.
Mon profil correspond particulièrement à vos attentes sur ce poste, et je serais ravi(e) d'échanger avec vous pour en discuter de vive voix.

Je reste bien entendu disponible pour tout complément d'information.

Cordialement,

${name}
`;

    setSubjectPreview(subject);
    setEmailPreview(body);
  };

  const handleGenerateEmail = (e: FormEvent) => {
    e.preventDefault();
    buildEmailContent();
  };

  // --- RENDER ---
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="max-w-3xl mx-auto px-3 sm:px-4 py-5 sm:py-6 space-y-4"
    >
      {/* Bandeau global IA */}
      {globalLoadingMessage && (
        <div className="mb-2 rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 px-3 py-1.5 text-[11px] flex items-center gap-2 text-[var(--muted)]">
          <span className="inline-flex w-3 h-3 rounded-full border-2 border-[var(--brand)] border-t-transparent animate-spin" />
          <span>{globalLoadingMessage}</span>
        </div>
      )}

      {/* HEADER */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="badge-muted flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
              Assistant de candidature IA
            </span>
          </p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-[2px]">
              Profil IA :{" "}
              <span className="ml-1 font-medium">
                {loadingProfile ? "Chargement…" : profile ? "Détecté ✅" : "Non détecté"}
              </span>
            </span>
            <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-[2px]">
              Visibilité : <span className="ml-1 font-medium">{visibilityLabel}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-lg sm:text-xl font-semibold">Prépare ta candidature avec ton CV IA</h1>
            <p className="text-[12px] text-[var(--muted)] max-w-xl">
              Génère un <strong>CV 1 page</strong>, une <strong>lettre de motivation</strong> (1 page), un{" "}
              <strong>pitch</strong> et un <strong>mail</strong>.
            </p>
          </div>

          <div className="w-full sm:w-[220px] rounded-2xl border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 text-[11px]">
            <p className="text-[var(--muted)] mb-1">Résumé du profil</p>
            <p className="font-semibold text-[var(--ink)] leading-tight">{profileName}</p>
            <p className="mt-0.5 text-[var(--muted)] line-clamp-2">{miniHeadline}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {[
            "Cible le poste",
            "Génère CV & LM",
            "Prépare ton pitch",
            "Génère ton mail",
          ].map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-soft)] border border-[var(--border)] px-2 py-[3px]"
            >
              <span className="w-4 h-4 rounded-full bg-[var(--brand)]/10 flex items-center justify-center text-[10px] text-[var(--brand)]">
                {i + 1}
              </span>
              <span>{t}</span>
            </span>
          ))}
        </div>
      </section>

      {/* ÉTAPE 1 : CV */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
              Étape 1
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-[var(--ink)]">CV IA – 1 page A4</h2>
              <p className="text-[11px] text-[var(--muted)]">
                Génération locale (PDF) – rendu identique aux templates HTML.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 text-[13px]">
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Titre / objectif du CV</label>
            <input
              id="cvTargetJob"
              type="text"
              className="input w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
              placeholder="Ex : Ingénieur Cybersécurité"
              value={cvTargetJob}
              onChange={(e) => setCvTargetJob(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Modèle</label>
              <select
                id="cvTemplate"
                className="select-brand w-full text-[var(--ink)] bg-[var(--bg-soft)]"
                value={cvTemplate}
                onChange={(e) => setCvTemplate(e.target.value)}
              >
                <option value="ats">ATS (sobre) ✅</option>
                <option value="design">Design (CLOUD)</option>
                <option value="magazine">Magazine</option>
                <option value="classic">Classique</option>
                <option value="modern">Moderne</option>
                <option value="minimalist">Minimaliste</option>
                <option value="academic">Académique</option>
              </select>
              {cvTemplate !== "ats" && (
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  Génération locale disponible en <strong>ATS</strong> pour l’instant.
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Langue</label>
              <select
                id="cvLang"
                className="select-brand w-full text-[var(--ink)] bg-[var(--bg-soft)]"
                value={cvLang}
                onChange={(e) => setCvLang(e.target.value as Lang)}
              >
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Contrat visé</label>
              <select
                id="cvContract"
                className="select-brand w-full text-[var(--ink)] bg-[var(--bg-soft)]"
                value={cvContract}
                onChange={(e) => setCvContract(e.target.value)}
              >
                <option value="CDI">CDI</option>
                <option value="CDD">CDD</option>
                <option value="Alternance">Alternance</option>
                <option value="Stage">Stage</option>
                <option value="Freelance">Freelance</option>
              </select>
            </div>

            {/* ✅ COULEUR PDF */}
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Couleur PDF (CV + LM)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={pdfBrand}
                  onChange={(e) => setPdfBrand(e.target.value)}
                  className="h-9 w-12 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]"
                  aria-label="Couleur du PDF"
                />
                <input
                  type="text"
                  value={pdfBrand}
                  onChange={(e) => setPdfBrand(e.target.value)}
                  className="input flex-1 text-[var(--ink)] bg-[var(--bg)]"
                  placeholder="#ef4444"
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                Par défaut : <strong>rouge</strong> (#ef4444).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Lien de l&apos;offre (optionnel)
              </label>
              <input
                id="cvJobLink"
                type="url"
                className="input w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                placeholder="https://"
                value={cvJobLink}
                onChange={(e) => setCvJobLink(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Extraits de l&apos;offre (optionnel)
              </label>
              <textarea
                id="cvJD"
                rows={3}
                className="input textarea w-full text-[13px] text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                placeholder="Colle quelques missions / outils / mots-clés de l’offre."
                value={cvJobDesc}
                onChange={(e) => setCvJobDesc(e.target.value)}
              />
            </div>
          </div>

          <div className="pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-[12px]">
              <input
                id="autoCreateSwitch"
                type="checkbox"
                className="toggle-checkbox"
                checked={cvAutoCreate}
                onChange={(e) => setCvAutoCreate(e.target.checked)}
              />
              <span className="text-[var(--muted)]">
                Créer automatiquement une entrée dans le <strong>Suivi 📌</strong> à chaque génération.
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            id="generateCvBtn"
            type="button"
            onClick={handleGenerateCv}
            disabled={cvLoading || !profile}
            className="btn-primary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>{cvLoading ? "Génération du CV..." : "Générer le CV (PDF) — 1 page"}</span>
            <div id="cvBtnSpinner" className={`loader absolute inset-0 m-auto ${cvLoading ? "" : "hidden"}`} />
          </button>

          <button
            id="generateCvLmPdfBtn"
            type="button"
            onClick={handleGenerateCvLmPdf}
            disabled={cvZipLoading || !profile}
            className="btn-secondary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>{cvZipLoading ? "Génération PDF..." : "CV + LM (PDF) — 2 pages"}</span>
            <div id="cvLmZipBtnSpinner" className={`loader absolute inset-0 m-auto ${cvZipLoading ? "" : "hidden"}`} />
          </button>
        </div>

        <div className="mt-2 p-2.5 rounded-md border border-dashed border-[var(--border)]/70 text-[11px] text-[var(--muted)]">
          {cvStatus ? (
            <p className="text-center text-emerald-400 text-[12px]">{cvStatus}</p>
          ) : (
            <p className="text-center">
              Génération locale : téléchargement direct (CV 1 page, ou CV+LM 2 pages).
            </p>
          )}
          {cvError && <p className="mt-1 text-center text-red-400 text-[12px]">{cvError}</p>}
        </div>
      </section>

      {/* ÉTAPE 2 : LM */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="rounded-md bg-[var(--bg-soft)] border border-dashed border-[var(--border)]/70 px-3 py-2 text-[11px] text-[var(--muted)] flex flex-wrap gap-2 justify-between">
          <span>
            🎯 Poste ciblé : <span className="font-medium text-[var(--ink)]">{targetedJob}</span>
          </span>
          <span>
            🏢 <span className="font-medium text-[var(--ink)]">{targetedCompany}</span>
          </span>
        </div>

        <form onSubmit={handleGenerateLetter} className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
                Étape 2
              </span>
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-[var(--brand)]">Lettre de motivation IA</h3>
                <p className="text-[11px] text-[var(--muted)]">
                  La lettre est générée en s’appuyant sur <strong>tes expériences</strong> (et outils), puis exportée en PDF (1 page).
                </p>
              </div>
            </div>
            <select
              id="lmLang"
              className="select-brand w-[105px] text-[12px] text-[var(--ink)] bg-[var(--bg-soft)]"
              value={lmLang}
              onChange={(e) => setLmLang(e.target.value as Lang)}
            >
              <option value="fr">FR</option>
              <option value="en">EN</option>
            </select>
          </div>

          <div className="space-y-3 text-[13px]">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Nom de l&apos;entreprise</label>
                <input
                  id="companyName"
                  type="text"
                  className="input w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="Ex : IMOGATE"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Intitulé du poste</label>
                <input
                  id="jobTitle"
                  type="text"
                  className="input w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="Ex : Ingénieur Réseaux & Sécurité"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Extraits de l&apos;offre (optionnel)</label>
              <textarea
                id="jobDescription"
                rows={3}
                className="input textarea w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                placeholder="Colle quelques missions / outils / contexte de l’offre."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Lien de l&apos;offre (optionnel)</label>
              <input
                id="jobLink"
                type="url"
                className="input w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                placeholder="https://"
                value={jobLink}
                onChange={(e) => setJobLink(e.target.value)}
              />
            </div>

            {lmError && <p className="text-[11px] text-red-400">{lmError}</p>}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                id="generateCoverLetterBtn"
                type="submit"
                disabled={lmLoading || !profile}
                className="btn-primary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span>{lmLoading ? "Génération de la LM..." : "Générer la lettre"}</span>
                <div id="lmBtnSpinner" className={`loader absolute inset-0 m-auto ${lmLoading ? "" : "hidden"}`} />
              </button>

              <button
                id="downloadLetterPdfBtn"
                type="button"
                onClick={handleDownloadLetterPdf}
                disabled={lmPdfLoading || !profile}
                className="btn-secondary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span>{lmPdfLoading ? "Création du PDF..." : "Télécharger en PDF (1 page)"}</span>
                <div className={`loader absolute inset-0 m-auto ${lmPdfLoading ? "" : "hidden"}`} />
              </button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                id="copyLetterBtn"
                type="button"
                onClick={handleCopyLetter}
                disabled={!letterText}
                className="btn-secondary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span>{letterCopied ? "Texte copié ✅" : "Copier le texte"}</span>
              </button>
            </div>

            {lmPdfError && <p className="text-[11px] text-red-400">{lmPdfError}</p>}
          </div>
        </form>

        <div className="mt-2 p-3 card-soft rounded-md border border-dashed border-[var(--brand)]/50">
          <p className="text-[11px] text-[var(--muted)] mb-1 text-center">
            Dernière lettre générée (tu peux l&apos;adapter avant envoi ou PDF).
          </p>
          <div className="letter-pre text-[13px] text-[var(--ink)] overflow-auto max-h-[220px] whitespace-pre-line">
            {letterText ? (
              <p>{letterText}</p>
            ) : (
              <p className="text-center text-[var(--muted)]">Lance une génération pour voir ici le texte de la LM IA.</p>
            )}
          </div>
        </div>
      </section>

      {/* ÉTAPE 3 : PITCH */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="rounded-md bg-[var(--bg-soft)] border border-dashed border-[var(--border)]/70 px-3 py-2 text-[11px] text-[var(--muted)] flex flex-wrap gap-2 justify-between">
          <span>
            🎯 Poste ciblé : <span className="font-medium text-[var(--ink)]">{targetedJob}</span>
          </span>
          <span>🧩 Utilise ce pitch pour mails, LinkedIn et entretiens.</span>
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
              Étape 3
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[var(--brand)]">Pitch d&apos;ascenseur</h3>
              <p className="text-[11px] text-[var(--muted)]">
                Résumé percutant de 2–4 phrases pour te présenter en 30–40 secondes.
              </p>
            </div>
          </div>
          <select
            id="pitchLang"
            className="select-brand w-[105px] text-[12px] text-[var(--ink)] bg-[var(--bg-soft)]"
            value={pitchLang}
            onChange={(e) => setPitchLang(e.target.value as Lang)}
          >
            <option value="fr">FR</option>
            <option value="en">EN</option>
          </select>
        </div>

        {pitchError && <p className="text-[11px] text-red-400">{pitchError}</p>}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            id="generatePitchBtn"
            type="button"
            onClick={handleGeneratePitch}
            disabled={pitchLoading || !profile}
            className="btn-primary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>{pitchLoading ? "Génération du pitch..." : "Générer le pitch"}</span>
            <div id="pitchBtnSpinner" className={`loader absolute inset-0 m-auto ${pitchLoading ? "" : "hidden"}`} />
          </button>
          <button
            id="copyPitchBtn"
            type="button"
            onClick={handleCopyPitch}
            disabled={!pitchText}
            className="btn-secondary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>{pitchCopied ? "Pitch copié ✅" : "Copier le pitch"}</span>
          </button>
        </div>

        <div className="mt-2 p-3 card-soft rounded-md text-[13px] text-[var(--ink)] whitespace-pre-line">
          {pitchText ? (
            <p>{pitchText}</p>
          ) : (
            <p className="text-center text-[11px] text-[var(--muted)]">
              Après génération, ton pitch apparaîtra ici.
            </p>
          )}
        </div>
      </section>

      {/* ÉTAPE 4 : MAIL */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
              Étape 4
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[var(--brand)]">Mail de candidature</h3>
              <p className="text-[11px] text-[var(--muted)] max-w-xl">
                Génère un <strong>objet</strong> et un <strong>corps de mail</strong> à copier.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleGenerateEmail} className="grid md:grid-cols-2 gap-4 text-sm mt-1">
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Nom de l&apos;entreprise</label>
            <input
              className="input w-full"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Ex : IMOGATE"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Intitulé du poste</label>
            <input
              className="input w-full"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Ex : Ingénieur Réseaux & Sécurité"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Nom du recruteur (optionnel)</label>
            <input
              className="input w-full"
              value={recruiterName}
              onChange={(e) => setRecruiterName(e.target.value)}
              placeholder="Ex : Mme Dupont"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button type="submit" className="btn-primary min-w-[200px]">
              Générer le mail
            </button>
          </div>
        </form>

        <div className="grid md:grid-cols-2 gap-4 mt-3 text-sm">
          <div className="card-soft rounded-xl p-4 border border-[var(--border-soft)]">
            <h4 className="font-semibold text-sm mb-2">Objet</h4>
            <div className="text-xs text-[var(--muted)] whitespace-pre-line">
              {subjectPreview || "L'objet généré apparaîtra ici."}
            </div>
          </div>
          <div className="card-soft rounded-xl p-4 border border-[var(--border-soft)]">
            <h4 className="font-semibold text-sm mb-2">Corps du mail</h4>
            <div className="text-xs text-[var(--muted)] whitespace-pre-line max-h-64 overflow-auto">
              {emailPreview || "Le texte du mail apparaîtra ici après génération."}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-[var(--muted)] mt-3">
          📌 Copie-colle l&apos;objet et le texte, puis joins le CV et la lettre PDF.
        </p>
      </section>
    </motion.div>
  );
}
