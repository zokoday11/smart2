// app/app/assistant-candidature/page.tsx
"use client";

import { logUsage } from "@/lib/logUsage";
import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

import { getRecaptchaToken } from "@/lib/recaptcha";

import { makePdfColors } from "@/lib/pdf/colors";
import { fitOnePage } from "@/lib/pdf/fitOnePage";
import { mergePdfBlobs } from "@/lib/pdf/mergePdfs";
import { downloadBlob } from "@/lib/pdf/pdfmakeClient";

import type { CvDocModel } from "@/lib/pdf/templates/cvAts";
import { buildCvPdf, getCvTemplates, type CvTemplateId } from "@/lib/pdf/templates/cvTemplates";

import { buildLmStyledPdf, type LmModel } from "@/lib/pdf/templates/letter";

// 🔗 ENDPOINT LOCAL (Proxy Next.js)
const LETTER_AND_PITCH_URL = "/api/generateLetterAndPitch";

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

// =============================
// ✅ Helpers (texte & PDF)
// =============================
function safeText(v: any) {
  return String(v ?? "").replace(/\u00A0/g, " ").trim();
}
function normalizeSpaces(s: string) {
  return safeText(s).replace(/[ \t]+/g, " ").trim();
}
function sanitizeCompanyHeaderName(name: string) {
  let s = safeText(name);
  if (!s) return "";
  s = s.replace(/^(service recrutement|recruitment team)\s*[-:|]?\s*/i, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/(.+?)\s+\1$/i, "$1").trim();
  return s;
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
  const title = titleParts.length > 0 ? titleParts.join(" — ") : profile.contractType || "Candidature";

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

// =============================
// ✅ “CERVEAU” LM : prompt strict + sanitize
// =============================
function buildProfileContext(profile: CvProfile) {
  const fullName = safeText(profile.fullName);
  const summary = safeText(profile.profileSummary);

  const sections = Array.isArray(profile.skills?.sections) ? profile.skills.sections : [];
  const tools = Array.isArray(profile.skills?.tools) ? profile.skills.tools : [];

  const skillsLines = sections
    .filter((s) => s && (s.title || (Array.isArray(s.items) && s.items.length)))
    .slice(0, 8)
    .map((s) => {
      const title = normalizeSpaces(s.title || "Compétences");
      const items = Array.isArray(s.items) ? s.items.map(safeText).filter(Boolean).slice(0, 18) : [];
      return `- ${title}: ${items.join(", ")}`.trim();
    })
    .filter(Boolean);

  const toolsLine = tools.map(safeText).filter(Boolean).slice(0, 25).join(", ");

  const experiences = Array.isArray(profile.experiences) ? profile.experiences : [];
  const xpLines = experiences.slice(0, 5).map((xp, idx) => {
    const role = normalizeSpaces(xp?.role || "");
    const company = normalizeSpaces(xp?.company || "");
    const dates = normalizeSpaces(xp?.dates || "");
    const location = normalizeSpaces(xp?.location || "");
    const bullets = Array.isArray(xp?.bullets) ? xp.bullets.map(safeText).filter(Boolean).slice(0, 6) : [];

    const header = `EXP${idx + 1}: ${role}${company ? ` — ${company}` : ""}${dates ? ` (${dates})` : ""}${location ? ` — ${location}` : ""}`.trim();
    const bulletBlock = bullets.length ? bullets.map((b) => `  • ${b}`).join("\n") : "  • (détails non fournis)";
    return `${header}\n${bulletBlock}`;
  });

  const educationShort = Array.isArray(profile.educationShort) ? profile.educationShort.map(safeText).filter(Boolean) : [];
  const education = Array.isArray(profile.education) ? profile.education : [];

  const eduLines =
    educationShort.length
      ? educationShort.slice(0, 6)
      : education
          .slice(0, 6)
          .map((e) => [e?.degree, e?.school, e?.dates, e?.location].map(safeText).filter(Boolean).join(" — "))
          .filter(Boolean);

  const certs = safeText(profile.certs);
  const langLine = safeText(profile.langLine);
  const soft = Array.isArray(profile.softSkills) ? profile.softSkills.map(safeText).filter(Boolean).slice(0, 12) : [];

  return [
    `CANDIDAT: ${fullName || "(nom non fourni)"}`,
    summary ? `RESUME: ${summary}` : `RESUME: (non fourni)`,
    "",
    "COMPETENCES (sections):",
    skillsLines.length ? skillsLines.join("\n") : "- (non fournies)",
    "",
    `OUTILS: ${toolsLine || "(non fournis)"}`,
    soft.length ? `SOFT SKILLS: ${soft.join(", ")}` : "",
    "",
    "EXPERIENCES:",
    xpLines.length ? xpLines.join("\n\n") : "(non fournies)",
    "",
    "FORMATION:",
    eduLines.length ? eduLines.map((l) => `- ${l}`).join("\n") : "- (non fournie)",
    "",
    certs ? `CERTIFICATIONS: ${certs}` : "",
    langLine ? `LANGUES: ${langLine}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildLmPrompt(args: {
  lang: Lang;
  jobTitle: string;
  companyName: string;
  profileContext: string;
  jobDescription: string;
  jobLink: string;
}) {
  const L = args.lang === "en" ? "en" : "fr";
  const title = normalizeSpaces(args.jobTitle || "");
  const company = normalizeSpaces(args.companyName || "");
  const jd = safeText(args.jobDescription || "");
  const link = safeText(args.jobLink || "");

  if (L === "en") {
    return `
Role: You are an expert recruitment assistant.
Task: Write ONLY the BODY text (no header, no address, no date, no subject line, no signature) of a professional, clear, punchy cover letter.

Format constraints:
- Output plain text (no Markdown, no HTML).
- 3 to 5 short, impactful paragraphs.
- Align to the role of "${title || "the role"}" at "${company || "the company"}".
- Do NOT copy/paste the job description.
- Do NOT list tools/skills as a raw catalog; integrate them naturally into sentences.
- Tone: professional, confident, concrete, results-oriented.
- Avoid generic fluff. Avoid invented experience.
- Target length: ~320–450 words.

JOB_URL: ${link || "(not provided)"}

Candidate data:
${args.profileContext || "(no candidate context provided)"}

Job offer hints:
${jd || "(no job description provided)"}

Language: English
`.trim();
  }

  return `
Rôle : Tu es un assistant expert en recrutement.
Tâche : Rédige UNIQUEMENT le CORPS du texte (sans en-tête, sans adresse, sans date, sans objet, sans signature) d’une lettre de motivation professionnelle, claire et percutante.

Contraintes de format :
- Rendu en texte brut (sans Markdown, sans HTML).
- 3 à 5 paragraphes courts et impactants.
- Aligne le discours sur le poste "${title || "le poste"}" chez "${company || "l’entreprise"}".
- Ne copie pas mot pour mot le descriptif du poste.
- N’énumère pas les outils/skills en catalogue : intègre-les naturellement dans des phrases.
- Ton professionnel, déterminé, concret, orienté résultats.
- Pas de blabla générique. N’invente aucune expérience.
- Longueur cible : ~320–450 mots.

OFFRE_URL: ${link || "(non fournie)"}

Données du candidat :
${args.profileContext || "(contexte candidat non fourni)"}

Détails de l’offre (indices) :
${jd || "(description de poste non fournie)"}

Langue de rédaction : Français
`.trim();
}

function sanitizeLM(raw: string): string {
  if (!raw) return "";
  let txt = String(raw);

  txt = txt.replace(/^\uFEFF/, "").replace(/\u200B/g, "");
  txt = txt.replace(/```[\s\S]*?```/g, " ");
  txt = txt.replace(/<\/?body[^>]*>/gi, "\n");
  txt = txt.replace(/<\/?html[^>]*>/gi, "\n");
  txt = txt.replace(/<\/?head[^>]*>[\s\S]*?<\/head>/gi, "\n");
  txt = txt.replace(/<\/?[^>]+>/g, "");

  txt = txt.replace(/^#{1,6}\s+/gm, "");
  txt = txt.replace(/\*\*(.*?)\*\*/g, "$1");
  txt = txt.replace(/__(.*?)__/g, "$1");
  txt = txt.replace(/\*(.*?)\*/g, "$1");
  txt = txt.replace(/_(.*?)_/g, "$1");

  txt = txt
    .split(/\r?\n/)
    .filter((line) => {
      const l = line.trim();
      if (!l) return true;
      return !/^(note|remarque|explication|instruction|exemple)\s*[:\-]/i.test(l);
    })
    .join("\n");

  txt = txt.replace(/^\s*[-•*]\s+/gm, "");
  txt = txt.replace(/\r\n/g, "\n");
  txt = txt.replace(/[ \t]+\n/g, "\n");
  txt = txt.replace(/\n{3,}/g, "\n\n");
  txt = txt.trim();

  return txt;
}

function extractBodyOnly(text: string, lang: Lang, fullName: string) {
  const raw = sanitizeLM(text);
  if (!raw) return "";

  const L = lang === "en" ? "en" : "fr";
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  while (lines.length && /^(objet|subject)\s*:/i.test(lines[0])) lines.shift();

  if (lines.length) {
    const first = lines[0].toLowerCase();
    const isGreeting =
      (L === "fr" && (first.startsWith("madame") || first.startsWith("monsieur") || first.startsWith("bonjour"))) ||
      (L === "en" && (first.startsWith("dear") || first.startsWith("hello")));
    if (isGreeting) lines.shift();
  }

  const name = safeText(fullName).toLowerCase();
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
    if (name && last.includes(name)) {
      lines.pop();
      continue;
    }
    break;
  }

  return lines.join("\n\n").trim();
}

function buildLmModel(profile: CvProfile, lang: Lang, companyNameInput: string, jobTitle: string, letterBodyOnly: string): LmModel {
  const name = safeText(profile.fullName) || "Candidat";

  const contactLines: string[] = [];
  if (profile.phone)
    contactLines.push(lang === "fr" ? `Téléphone : ${safeText(profile.phone)}` : `Phone: ${safeText(profile.phone)}`);
  if (profile.email) contactLines.push(lang === "fr" ? `Email : ${safeText(profile.email)}` : `Email: ${safeText(profile.email)}`);
  if (profile.linkedin)
    contactLines.push(lang === "fr" ? `LinkedIn : ${safeText(profile.linkedin)}` : `LinkedIn: ${safeText(profile.linkedin)}`);

  const city = safeText(profile.city) || "Paris";
  const dateStr = lang === "fr" ? new Date().toLocaleDateString("fr-FR") : new Date().toLocaleDateString("en-GB");

  const subject = lang === "fr" ? `Objet : Candidature – ${jobTitle || "poste"}` : `Subject: Application – ${jobTitle || "role"}`;
  const salutation = lang === "fr" ? "Madame, Monsieur," : "Dear Hiring Manager,";
  const closing = lang === "fr" ? "Cordialement," : "Sincerely,";

  const cleaned = sanitizeLM(letterBodyOnly);
  const bodyOnly = extractBodyOnly(cleaned, lang, name) || cleaned;

  return {
    lang,
    name,
    contactLines,
    service: lang === "fr" ? "Service Recrutement" : "Recruitment Team",
    companyName: sanitizeCompanyHeaderName(companyNameInput) || (lang === "fr" ? "Entreprise" : "Company"),
    companyAddr: "",
    city,
    dateStr,
    subject,
    salutation,
    body: bodyOnly,
    closing,
    signature: name,
  };
}

// =============================
// ✅ Edition CV (draft)
// =============================
type CvSectionKey = "profile" | "xp" | "education" | "skills" | "certs" | "languages" | "hobbies";

const DEFAULT_CV_SECTIONS: Record<CvSectionKey, boolean> = {
  profile: true,
  xp: true,
  education: true,
  skills: true,
  certs: true,
  languages: true,
  hobbies: true,
};

const splitList = (s: string) =>
  String(s || "")
    .split(/[,\n;|•]+/g)
    .map((x) => x.trim())
    .filter(Boolean);

const joinList = (arr: string[]) => (Array.isArray(arr) ? arr.filter(Boolean).join(", ") : "");

const textToLines = (t: string) =>
  String(t || "")
    .split(/\r?\n/g)
    .map((x) => x.trim())
    .filter(Boolean);

const linesToText = (lines: string[]) => (Array.isArray(lines) ? lines.filter(Boolean).join("\n") : "");

const bulletsToText = (bullets: string[]) => linesToText(Array.isArray(bullets) ? bullets : []);
const textToBullets = (t: string) => textToLines(t);

function emptySkillsLike(base: any) {
  const keys = ["cloud", "sec", "sys", "auto", "tools", "soft"];
  const out: any = {};
  for (const k of keys) out[k] = [];
  if (!base) return out;
  for (const k of Object.keys(base)) {
    if (Array.isArray(base[k])) out[k] = [];
  }
  return out;
}

// =============================
// ✅ Full screen modal
// =============================
function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}

function FullScreenModal({
  open,
  title,
  onClose,
  actions,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute inset-0 p-2 sm:p-4">
        <div className="h-full w-full rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden flex flex-col">
          <div className="p-3 sm:p-4 border-b border-[var(--border)] bg-[var(--bg-soft)] flex items-center justify-between gap-2">
            <div>
              <p className="text-[13px] font-semibold text-[var(--ink)]">{title}</p>
              <p className="text-[10px] text-[var(--muted)]">ESC pour fermer</p>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={onClose}>
                Fermer
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0">{children}</div>
        </div>
      </div>
    </div>
  );
}

// =============================
// ✅ PDF VIEWER (sans toolbar Chrome)
// Requiert: npm i pdfjs-dist
// =============================
let __pdfjsReady = false;
let __pdfjs: any = null;

async function ensurePdfJs() {
  if (__pdfjsReady && __pdfjs) return __pdfjs;

  // ✅ pdfjs v4+ : chemin correct = pdf.mjs (pas build/pdf)
  const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
  __pdfjs = pdfjs;

  // ✅ Worker via CDN (évite les soucis Next/Webpack avec pdf.worker.min.mjs)
  const v = (pdfjs as any).version || "4.0.379";
  (pdfjs as any).GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${v}/build/pdf.worker.min.mjs`;

  __pdfjsReady = true;
  return pdfjs;
}

function PdfCanvasViewer({
  fileUrl,
  className,
}: {
  fileUrl: string | null;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [pdf, setPdf] = useState<any>(null);
  const [numPages, setNumPages] = useState(1);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [rendering, setRendering] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // load doc
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setErr(null);
      setPdf(null);
      setNumPages(1);
      setPage(1);

      if (!fileUrl) return;

      try {
        const pdfjs = await ensurePdfJs();
        // ✅ Correction syntaxe getDocument
        const task = (pdfjs as any).getDocument({ url: fileUrl });
        const doc = await task.promise;
        if (cancelled) return;
        setPdf(doc);
        setNumPages(doc.numPages || 1);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || "Impossible d’ouvrir le PDF.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  // render page
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!pdf || !canvasRef.current) return;
      setRendering(true);

      try {
        const p = await pdf.getPage(page);
        if (cancelled) return;

        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const viewport = p.getViewport({ scale });

        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context indisponible.");

        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const renderTask = p.render({ canvasContext: ctx, viewport });
        await renderTask.promise;

        if (!cancelled) setErr(null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Erreur rendu PDF.");
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdf, page, scale]);

  const canPrev = page > 1;
  const canNext = page < numPages;

  const fitWidth = async () => {
    if (!pdf || !wrapRef.current) return;
    try {
      const p = await pdf.getPage(page);
      const viewport1 = p.getViewport({ scale: 1 });
      const pad = 24; // marge intérieure
      const w = Math.max(320, wrapRef.current.clientWidth - pad);
      const next = w / viewport1.width;
      setScale(Math.max(0.4, Math.min(2.2, next)));
    } catch {
      // ignore
    }
  };

  return (
    <div className={["h-full min-h-0 flex flex-col", className || ""].join(" ")}>
      <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-soft)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-[var(--ink)]">Page</span>
            <input
              className="input !py-1 !px-2 !text-[11px] w-[58px] bg-[var(--bg)]"
              value={String(page)}
              onChange={(e) => {
                const n = Number(e.target.value || "1");
                if (!Number.isFinite(n)) return;
                setPage(Math.max(1, Math.min(numPages, Math.floor(n))));
              }}
            />
            <span>/ {numPages}</span>
          </span>

          {rendering && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-flex w-3 h-3 rounded-full border-2 border-[var(--brand)] border-t-transparent animate-spin" />
              rendu…
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 text-[11px]"
            onClick={() => canPrev && setPage((p) => p - 1)}
            disabled={!canPrev}
          >
            ←
          </button>
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 text-[11px]"
            onClick={() => canNext && setPage((p) => p + 1)}
            disabled={!canNext}
          >
            →
          </button>

          <span className="w-[1px] h-5 bg-[var(--border)] mx-1" />

          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 text-[11px]"
            onClick={() => setScale((s) => Math.max(0.4, Number((s - 0.1).toFixed(2))))}
          >
            -
          </button>
          <span className="text-[11px] text-[var(--muted)] w-[54px] text-center">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 text-[11px]"
            onClick={() => setScale((s) => Math.min(2.2, Number((s + 0.1).toFixed(2))))}
          >
            +
          </button>

          <button type="button" className="btn-secondary !py-1.5 !px-3 text-[11px]" onClick={fitWidth}>
            Ajuster largeur
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="flex-1 min-h-0 overflow-auto bg-white">
        {err ? (
          <div className="p-4 text-[11px] text-red-400">{err}</div>
        ) : !fileUrl ? (
          <div className="h-full flex items-center justify-center text-[11px] text-[var(--muted)]">Aucun PDF à afficher.</div>
        ) : (
          <div className="p-3 flex justify-center">
            <canvas ref={canvasRef} className="shadow-sm border border-black/10 rounded-lg bg-white" />
          </div>
        )}
      </div>
    </div>
  );
}

// =============================
// PAGE
// =============================
export default function AssistanceCandidaturePage() {
  // --- PROFIL ---
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

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

  // --- CV ---
  const [cvTargetJob, setCvTargetJob] = useState("");
  const [cvTemplate, setCvTemplate] = useState<CvTemplateId>("ats");
  const [cvLang, setCvLang] = useState<Lang>("fr");
  const [cvContract, setCvContract] = useState("CDI");

  const [cvLoading, setCvLoading] = useState(false);
  const [cvStatus, setCvStatus] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);

  // ✅ Couleur PDF (CV + LM)
  const [pdfBrand, setPdfBrand] = useState("#ef4444");

  // Templates
  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");

  // Draft + sections
  const [cvSections, setCvSections] = useState<Record<CvSectionKey, boolean>>(DEFAULT_CV_SECTIONS);
  const [cvDraft, setCvDraft] = useState<CvDocModel | null>(null);
  const [cvDraftDirty, setCvDraftDirty] = useState(false);

  // Preview blobs (no auto download)
  const [cvLastBlob, setCvLastBlob] = useState<Blob | null>(null);
  const [cvPreviewUrl, setCvPreviewUrl] = useState<string | null>(null);

  const [cvLmLastBlob, setCvLmLastBlob] = useState<Blob | null>(null);
  const [cvLmPreviewUrl, setCvLmPreviewUrl] = useState<string | null>(null);

  // Fullscreen modals
  const [cvEditorOpen, setCvEditorOpen] = useState(false);
  const [cvLmViewerOpen, setCvLmViewerOpen] = useState(false);

  // --- LM ---
  const [lmLang, setLmLang] = useState<Lang>("fr");
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobLink, setJobLink] = useState("");

  const [letterBody, setLetterBody] = useState("");
  const [lmLoading, setLmLoading] = useState(false);
  const [lmError, setLmError] = useState<string | null>(null);

  const [lmPdfError, setLmPdfError] = useState<string | null>(null);
  const [lmPdfLoading, setLmPdfLoading] = useState(false);

  const [lmLastBlob, setLmLastBlob] = useState<Blob | null>(null);
  const [lmPreviewUrl, setLmPreviewUrl] = useState<string | null>(null);
  const [lmEditorOpen, setLmEditorOpen] = useState(false);

  // --- PITCH ---
  const [pitchLang, setPitchLang] = useState<Lang>("fr");
  const [pitchText, setPitchText] = useState("");
  const [pitchLoading, setPitchLoading] = useState(false);
  const [pitchError, setPitchError] = useState<string | null>(null);
  const [pitchCopied, setPitchCopied] = useState(false);

  // --- MAIL ---
  const [recruiterName, setRecruiterName] = useState("");
  const [emailTone, setEmailTone] = useState<"standard" | "court" | "pro">("standard");
  const [emailPreview, setEmailPreview] = useState("");
  const [subjectPreview, setSubjectPreview] = useState("");
  const [emailCopied, setEmailCopied] = useState(false);

  // --- Auto create
  const [cvAutoCreate, setCvAutoCreate] = useState(true);

  // =============================
  // ✅ Derived
  // =============================
  const visibilityLabel = userId ? "Associé à ton compte" : "Invité";
  const profileName = profile?.fullName || userEmail || "Profil non détecté";
  const miniHeadline =
    profile?.profileSummary?.split(".")[0] || profile?.contractType || "Analyse ton CV PDF dans « CV IA » pour activer l’assistant.";

  const targetedJob = jobTitle || cvTargetJob || "Poste cible non renseigné";
  const targetedCompany = companyName || "Entreprise non renseignée";

  const cvTemplates = useMemo(() => getCvTemplates(), []);
  const colors = useMemo(() => makePdfColors(pdfBrand), [pdfBrand]);

  const baseCvModel = useMemo(() => {
    if (!profile) return null;
    return profileToCvDocModel(profile, { targetJob: cvTargetJob, contract: cvContract });
  }, [profile, cvTargetJob, cvContract]);

  // sync draft tant que pas dirty
  useEffect(() => {
    if (!baseCvModel) return;
    if (!cvDraft || !cvDraftDirty) setCvDraft(baseCvModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCvModel]);

  // cleanup URLs
  useEffect(() => {
    return () => {
      if (cvPreviewUrl) URL.revokeObjectURL(cvPreviewUrl);
      if (lmPreviewUrl) URL.revokeObjectURL(lmPreviewUrl);
      if (cvLmPreviewUrl) URL.revokeObjectURL(cvLmPreviewUrl);
    };
  }, [cvPreviewUrl, lmPreviewUrl, cvLmPreviewUrl]);

  // top3 + modal
  const top3Templates = useMemo(() => {
    const all = cvTemplates || [];
    const first = all.slice(0, 3);
    if (cvTemplate && !first.some((t) => t.id === cvTemplate)) {
      const sel = all.find((t) => t.id === cvTemplate);
      if (sel) return [first[0], first[1], sel].filter(Boolean);
    }
    return first;
  }, [cvTemplates, cvTemplate]);

  const filteredTemplates = useMemo(() => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return cvTemplates;
    return cvTemplates.filter((t) => (t.label + " " + t.description).toLowerCase().includes(q));
  }, [cvTemplates, templateSearch]);

  // =============================
  // ✅ LocalStorage draft
  // =============================
  const cvStorageKey = useMemo(() => {
    if (!userId) return null;
    return `cvDraft:${userId}:${cvTemplate}:${cvLang}`;
  }, [userId, cvTemplate, cvLang]);

  const saveCvDraft = () => {
    if (!cvStorageKey || !cvDraft) return;
    const payload = { cvDraft, cvSections, pdfBrand };
    localStorage.setItem(cvStorageKey, JSON.stringify(payload));
  };

  const loadCvDraft = () => {
    if (!cvStorageKey) return;
    const raw = localStorage.getItem(cvStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.cvDraft) {
        setCvDraft(parsed.cvDraft);
        setCvDraftDirty(true);
      }
      if (parsed?.cvSections) setCvSections(parsed.cvSections);
      if (parsed?.pdfBrand) setPdfBrand(parsed.pdfBrand);
    } catch {
      // ignore
    }
  };

  const clearCvDraft = () => {
    if (!cvStorageKey) return;
    localStorage.removeItem(cvStorageKey);
  };

  // auto load if exists and not dirty
  useEffect(() => {
    if (!cvStorageKey) return;
    if (!profile) return;
    if (cvDraftDirty) return;
    const raw = localStorage.getItem(cvStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.cvDraft) {
        setCvDraft(parsed.cvDraft);
        setCvDraftDirty(true);
      }
      if (parsed?.cvSections) setCvSections(parsed.cvSections);
      if (parsed?.pdfBrand) setPdfBrand(parsed.pdfBrand);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvStorageKey, profile]);

  // =============================
  // ✅ Build final model
  // =============================
  const buildFinalCvModel = () => {
    const m = (cvDraft || baseCvModel) as CvDocModel;
    return {
      ...m,
      profile: cvSections.profile ? m.profile : "",
      xp: cvSections.xp ? m.xp : [],
      education: cvSections.education ? m.education : [],
      skills: cvSections.skills ? m.skills : (emptySkillsLike((m as any).skills) as any),
      certs: cvSections.certs ? m.certs : "",
      langLine: cvSections.languages ? m.langLine : "",
      hobbies: cvSections.hobbies ? m.hobbies : [],
    } as CvDocModel;
  };

  // =============================
  // ✅ Firestore: create application (on DOWNLOAD only)
  // =============================
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
        jobLink: jobLink || "",
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
  // ✅ PREVIEW CV (NO DOWNLOAD)
  // =============================
  const prepareCvPreview = async (): Promise<Blob | null> => {
    if (!profile || !baseCvModel) {
      setCvError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA.");
      return null;
    }

    setCvError(null);
    setCvStatus(null);
    setCvLoading(true);
    setGlobalLoadingMessage("Préparation aperçu CV (1 page)…");

    try {
      const cvModel = buildFinalCvModel();
      const { blob, bestScale } = await fitOnePage((scale) =>
        buildCvPdf(cvTemplate, cvModel, cvLang, colors, "auto", scale)
      );

      setCvLastBlob(blob);

      const nextUrl = URL.createObjectURL(blob);
      setCvPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });

      setCvStatus(`Aperçu CV prêt ✅ (scale=${bestScale.toFixed(2)})`);
      return blob;
    } catch (err: any) {
      console.error("Erreur preview CV:", err);
      setCvError(err?.message || "Impossible de générer l’aperçu CV.");
      return null;
    } finally {
      setCvLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  // ✅ Download CV (USER CLICK ONLY)
  const downloadCv = async () => {
    const blob = cvLastBlob ?? (await prepareCvPreview());
    if (!blob) return;

    downloadBlob(blob, "cv-ia.pdf");
    await autoCreateApplication("cv");

    if (auth.currentUser) {
      await logUsage({
        user: auth.currentUser,
        action: "download_pdf",
        docType: "cv",
        eventType: "cv_download",
        tool: "clientPdfMakeCv",
      });
    }
  };

  // =============================
  // ✅ Generate letter text (AI)
  // =============================
  const generateCoverLetterText = async (lang: Lang): Promise<string> => {
    if (!profile) throw new Error("Profil manquant.");
    if (!jobTitle && !jobDescription) {
      throw new Error("Ajoute au moins l'intitulé du poste ou un extrait de la description.");
    }

    const user = auth.currentUser;
    if (!user) throw new Error("Vous devez être connecté pour générer une lettre.");

    const token = await user.getIdToken();
    const recaptchaToken = await getRecaptchaToken("generate_letter_pitch");

    const profileContext = buildProfileContext(profile);
    const strictPrompt = buildLmPrompt({
      lang,
      jobTitle,
      companyName,
      profileContext,
      jobDescription,
      jobLink,
    });

    const resp = await fetch(LETTER_AND_PITCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        profile,
        jobTitle,
        companyName,
        jobDescription: strictPrompt,
        lang,
        recaptchaToken,
      }),
    });

    const json = await resp.json().catch(() => null);
    if (!resp.ok) {
      const msg = (json && json.error) || "Erreur pendant la génération de la lettre de motivation.";
      throw new Error(msg);
    }

    const apiLetterBody = typeof json?.letterBody === "string" ? json.letterBody.trim() : "";
    const apiCoverLetter = typeof json?.coverLetter === "string" ? json.coverLetter.trim() : "";

    const out = apiLetterBody || apiCoverLetter;
    const cleaned = sanitizeLM(out);

    if (!cleaned) throw new Error("Lettre vide renvoyée par l'API.");

    const name = safeText(profile.fullName);
    const bodyOnly = extractBodyOnly(cleaned, lang, name);
    return bodyOnly || cleaned;
  };

  // =============================
  // ✅ PREVIEW LM (NO DOWNLOAD)
  // =============================
  const prepareLmPreview = async (opts?: { ensureText?: boolean }): Promise<Blob | null> => {
    if (!profile) {
      setLmPdfError("Profil manquant.");
      return null;
    }

    setLmPdfError(null);
    setLmLoading(false);
    setLmPdfLoading(true);
    setGlobalLoadingMessage("Préparation aperçu LM (1 page)…");

    try {
      let cover = letterBody?.trim();

      if (opts?.ensureText && !cover) {
        setGlobalLoadingMessage("Génération du texte de la lettre (IA)…");
        cover = await generateCoverLetterText(lmLang);
        setLetterBody(cover);
      }

      if (!cover) throw new Error("Texte de lettre vide. Génère ou colle un texte.");

      const lmModel: LmModel = buildLmModel(profile, lmLang, companyName, jobTitle, cover);

      const { blob } = await fitOnePage((scale) => buildLmStyledPdf(lmModel, colors as any, scale), {
        min: 0.85,
        max: 1.6,
        iterations: 7,
        initial: 1.0,
      });

      setLmLastBlob(blob);
      const nextUrl = URL.createObjectURL(blob);
      setLmPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });

      return blob;
    } catch (err: any) {
      console.error("Erreur preview LM:", err);
      setLmPdfError(err?.message || "Impossible de générer l’aperçu LM.");
      return null;
    } finally {
      setLmPdfLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  // ✅ Download LM (USER CLICK ONLY)
  const downloadLm = async () => {
    const blob = lmLastBlob ?? (await prepareLmPreview({ ensureText: true }));
    if (!blob) return;

    downloadBlob(blob, "lettre-motivation.pdf");
    await autoCreateApplication("lm");

    if (auth.currentUser) {
      await logUsage({
        user: auth.currentUser,
        action: "download_pdf",
        docType: "lm",
        eventType: "lm_download",
        tool: "clientPdfMakeLm",
      });
    }
  };

  // =============================
  // ✅ PREVIEW CV+LM merged (NO DOWNLOAD)
  // =============================
  const prepareCvLmPreview = async (): Promise<Blob | null> => {
    if (!profile || !baseCvModel) {
      setCvError("Aucun profil CV IA détecté.");
      return null;
    }

    setCvError(null);
    setCvStatus(null);
    setCvLoading(true);
    setGlobalLoadingMessage("Préparation aperçu CV + LM (2 pages)…");

    try {
      // CV
      const cvModel = buildFinalCvModel();
      const cvFit = await fitOnePage((scale) => buildCvPdf(cvTemplate, cvModel, cvLang, colors, "auto", scale));

      // LM (ensure text)
      let cover = letterBody?.trim();
      if (!cover) {
        setGlobalLoadingMessage("Génération du texte de la lettre (IA)…");
        cover = await generateCoverLetterText(lmLang);
        setLetterBody(cover);
      }
      const lmModel: LmModel = buildLmModel(profile, lmLang, companyName, jobTitle, cover);
      const lmFit = await fitOnePage((scale) => buildLmStyledPdf(lmModel, colors as any, scale), {
        min: 0.85,
        max: 1.6,
        iterations: 7,
        initial: 1.0,
      });

      // merge
      const merged = await mergePdfBlobs([cvFit.blob, lmFit.blob]);
      setCvLmLastBlob(merged);

      const nextUrl = URL.createObjectURL(merged);
      setCvLmPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });

      setCvStatus("Aperçu CV+LM prêt ✅ (2 pages)");
      return merged;
    } catch (err: any) {
      console.error("Erreur preview CV+LM:", err);
      setCvError(err?.message || "Impossible de générer l’aperçu CV+LM.");
      return null;
    } finally {
      setCvLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  // ✅ Download CV+LM (USER CLICK ONLY)
  const downloadCvLm = async () => {
    const blob = cvLmLastBlob ?? (await prepareCvLmPreview());
    if (!blob) return;

    downloadBlob(blob, "cv-lm-ia.pdf");
    await autoCreateApplication("cv_lm");

    if (auth.currentUser) {
      await logUsage({
        user: auth.currentUser,
        action: "download_pdf",
        docType: "cv",
        eventType: "cv_lm_download",
        tool: "clientPdfMakeCvLm",
      });
    }
  };

  // =============================
  // ✅ CV editor: debounce auto preview
  // =============================
  const cvPreviewTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!cvEditorOpen) return;
    if (!cvDraft) return;

    if (cvPreviewTimer.current) window.clearTimeout(cvPreviewTimer.current);
    cvPreviewTimer.current = window.setTimeout(() => {
      prepareCvPreview();
    }, 450);

    return () => {
      if (cvPreviewTimer.current) window.clearTimeout(cvPreviewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvEditorOpen, cvDraft, cvSections, cvTemplate, cvLang, colors]);

  // =============================
  // ✅ LM editor: debounce auto preview
  // =============================
  const lmPreviewTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!lmEditorOpen) return;
    if (!letterBody?.trim()) return;

    if (lmPreviewTimer.current) window.clearTimeout(lmPreviewTimer.current);
    lmPreviewTimer.current = window.setTimeout(() => {
      prepareLmPreview({ ensureText: false });
    }, 450);

    return () => {
      if (lmPreviewTimer.current) window.clearTimeout(lmPreviewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lmEditorOpen, letterBody, lmLang, colors, companyName, jobTitle]);

  // =============================
  // ✅ Generate LM text (button)
  // =============================
  const handleGenerateLetter = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!profile) {
      setLmError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA.");
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
    setGlobalLoadingMessage("L’IA rédige ta lettre de motivation…");

    try {
      const coverLetterBody = await generateCoverLetterText(lmLang);
      setLetterBody(coverLetterBody);
      setLmEditorOpen(true); // ✅ ouvre l’éditeur plein écran
      await prepareLmPreview({ ensureText: false });
    } catch (err: any) {
      console.error("Erreur generateLetter:", err);
      setLmError(err?.message || "Impossible de générer la lettre de motivation.");
    } finally {
      setLmLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  // =============================
  // ✅ Pitch
  // =============================
  const handleGeneratePitch = async () => {
    if (!profile) {
      setPitchError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA.");
      return;
    }

    const effectiveJobTitle = jobTitle || cvTargetJob || "Candidature cible";
    const effectiveDesc = jobDescription || "";

    setPitchError(null);
    setPitchLoading(true);
    setPitchCopied(false);
    setGlobalLoadingMessage("L’IA prépare ton pitch d’ascenseur…");

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Connecte-toi pour générer un pitch.");
      const token = await user.getIdToken();
      const recaptchaToken = await getRecaptchaToken("generate_letter_pitch");

      const resp = await fetch(LETTER_AND_PITCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
      if (!resp.ok) throw new Error((json && json.error) || "Erreur pendant la génération du pitch.");

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
      setPitchError(err?.message || "Impossible de générer le pitch.");
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

  // =============================
  // ✅ Mail (plus propre + ton au choix)
  // =============================
  const buildEmailContent = () => {
    const name = profile?.fullName || "";
    const recruiter = recruiterName.trim();
    const greeting = recruiter ? `Bonjour ${recruiter},` : "Bonjour,";

    const job = jobTitle || "le poste";
    const company = companyName || "votre entreprise";

    const subject = `Candidature – ${job} – ${name || "Candidat"}`;

    let body = "";

    if (emailTone === "court") {
      body = `${greeting}

Je vous contacte pour vous proposer ma candidature au poste de ${job} chez ${company}.
Vous trouverez en pièces jointes mon CV et ma lettre de motivation.

Je suis disponible pour un échange à votre convenance.

Cordialement,
${name || "—"}
`;
    } else if (emailTone === "pro") {
      body = `${greeting}

Je me permets de vous soumettre ma candidature au poste de ${job} au sein de ${company}.
Au regard de mon parcours, je peux apporter une contribution concrète sur les sujets clés du poste (mise en œuvre, amélioration continue, fiabilisation et travail transverse).

Vous trouverez en pièces jointes mon CV ainsi que ma lettre de motivation.
Je serais ravi(e) d’échanger avec vous afin de préciser ma motivation et mes disponibilités.

Bien cordialement,
${name || "—"}
`;
    } else {
      body = `${greeting}

Je vous adresse ma candidature pour le poste de ${job} au sein de ${company}.
Vous trouverez en pièces jointes mon CV et ma lettre de motivation.

Je reste à votre disposition pour un échange et vous remercie par avance pour votre retour.

Cordialement,
${name || "—"}
`;
    }

    setSubjectPreview(subject);
    setEmailPreview(body);
  };

  const handleGenerateEmail = (e: FormEvent) => {
    e.preventDefault();
    buildEmailContent();
  };

  const copyEmailAll = async () => {
    const text = `Objet: ${subjectPreview}\n\n${emailPreview}`;
    try {
      await navigator.clipboard.writeText(text);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 1500);
    } catch (e) {
      console.error("Erreur copie email:", e);
    }
  };

  // =============================
  // UI
  // =============================
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="max-w-3xl mx-auto px-3 sm:px-4 py-5 sm:py-6 space-y-4"
    >
      {/* Bandeau global */}
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
            <span className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Assistant de candidature IA</span>
          </p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-[2px]">
              Profil IA :{" "}
              <span className="ml-1 font-medium">{loadingProfile ? "Chargement…" : profile ? "Détecté ✅" : "Non détecté"}</span>
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
              Prévisualise et édite avant de télécharger : <strong>CV</strong>, <strong>lettre</strong>, <strong>pitch</strong>,{" "}
              <strong>mail</strong>. <span className="font-medium">Aucun téléchargement automatique.</span>
            </p>
          </div>

          <div className="w-full sm:w-[220px] rounded-2xl border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 text-[11px]">
            <p className="text-[var(--muted)] mb-1">Résumé du profil</p>
            <p className="font-semibold text-[var(--ink)] leading-tight">{profileName}</p>
            <p className="mt-0.5 text-[var(--muted)] line-clamp-2">{miniHeadline}</p>
          </div>
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
              <h2 className="text-base sm:text-lg font-semibold text-[var(--ink)]">CV IA – Aperçu + Édition + Téléchargement</h2>
              <p className="text-[11px] text-[var(--muted)]">Le PDF s’affiche sans toolbar Chrome (viewer interne).</p>
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

          {/* Templates top3 + modal */}
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Modèle (top 3)</label>
                <p className="text-[10px] text-[var(--muted)]">
                  Clique un modèle. Pour tous les modèles → <span className="font-medium">Plus</span>.
                </p>
              </div>

              <button type="button" onClick={() => setTemplatesModalOpen(true)} className="btn-secondary !py-1.5 !px-3 text-[11px]">
                + Plus
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {top3Templates.map((t) => {
                const active = t.id === cvTemplate;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCvTemplate(t.id)}
                    className={`text-left rounded-2xl border p-2 bg-[var(--bg-soft)] transition
                      ${active ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20" : "border-[var(--border)] hover:border-[var(--brand)]/50"}`}
                  >
                    <img
                      src={t.previewSrc}
                      alt={t.label}
                      className="w-full h-[150px] object-cover rounded-xl border border-[var(--border)] bg-white"
                      loading="lazy"
                    />
                    <div className="mt-2">
                      <p className="text-[12px] font-semibold text-[var(--ink)] flex items-center justify-between gap-2">
                        <span>{t.label}</span>
                        {active && (
                          <span className="text-[10px] px-2 py-[2px] rounded-full bg-[var(--brand)]/10 text-[var(--brand)] border border-[var(--brand)]/20">
                            Sélectionné
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-[var(--muted)] line-clamp-2">{t.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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
          </div>

          {/* Couleur */}
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Couleur PDF (CV + LM)</label>
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
                Créer automatiquement une entrée dans le <strong>Suivi 📌</strong> lors des <strong>téléchargements</strong>.
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <button
            type="button"
            onClick={async () => {
              await prepareCvPreview();
              setCvEditorOpen(true);
            }}
            disabled={cvLoading || !profile}
            className="btn-primary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {cvLoading ? "Préparation..." : "Ouvrir l’éditeur CV (plein écran)"}
          </button>

          <button
            type="button"
            onClick={async () => {
              await prepareCvLmPreview();
              setCvLmViewerOpen(true);
            }}
            disabled={cvLoading || !profile}
            className="btn-secondary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {cvLoading ? "Préparation..." : "Préparer aperçu CV + LM (2 pages)"}
          </button>
        </div>

        {/* Status + preview inline (SANS iframe) */}
        <div className="mt-2 p-2.5 rounded-md border border-dashed border-[var(--border)]/70 text-[11px] text-[var(--muted)]">
          {cvStatus ? (
            <p className="text-center text-emerald-400 text-[12px]">{cvStatus}</p>
          ) : (
            <p className="text-center">Prépare un aperçu, vérifie dans l’éditeur, puis télécharge.</p>
          )}
          {cvError && <p className="mt-1 text-center text-red-400 text-[12px]">{cvError}</p>}

          {/* CV preview actions */}
          {cvPreviewUrl && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-[var(--border)] bg-[var(--bg-soft)]">
                <p className="text-[11px] text-[var(--muted)]">Aperçu CV prêt (sans toolbar Chrome)</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary !py-1 !px-3 text-[11px]" onClick={() => setCvEditorOpen(true)}>
                    Ouvrir l’éditeur
                  </button>
                  <button type="button" className="btn-primary !py-1 !px-3 text-[11px]" onClick={downloadCv} disabled={!cvLastBlob}>
                    Télécharger
                  </button>
                </div>
              </div>
              <div className="p-3 text-[11px] text-[var(--muted)]">Ouvre l’éditeur pour modifier et vérifier avant téléchargement.</div>
            </div>
          )}

          {/* CV+LM preview actions */}
          {cvLmPreviewUrl && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-[var(--border)] bg-[var(--bg-soft)]">
                <p className="text-[11px] text-[var(--muted)]">Aperçu CV + LM prêt (2 pages)</p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary !py-1 !px-3 text-[11px]" onClick={() => setCvLmViewerOpen(true)}>
                    Ouvrir l’aperçu
                  </button>
                  <button type="button" className="btn-primary !py-1 !px-3 text-[11px]" onClick={downloadCvLm} disabled={!cvLmLastBlob}>
                    Télécharger
                  </button>
                </div>
              </div>
              <div className="p-3 text-[11px] text-[var(--muted)]">Vérifie le PDF 2 pages avant de télécharger.</div>
            </div>
          )}
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
                <p className="text-[11px] text-[var(--muted)]">Génère → édite → prévisualise → télécharge (thème = CV).</p>
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
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Nom de l'entreprise</label>
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
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Extraits de l'offre (optionnel)</label>
              <textarea
                id="jobDescription"
                rows={3}
                className="input textarea w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                placeholder="Colle quelques missions / outils / contexte."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Lien de l'offre (optionnel)</label>
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
            {lmPdfError && <p className="text-[11px] text-red-400">{lmPdfError}</p>}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button type="submit" disabled={lmLoading || !profile} className="btn-primary flex-1 disabled:opacity-60 disabled:cursor-not-allowed">
                {lmLoading ? "Génération..." : "Générer la lettre (IA) + ouvrir éditeur"}
              </button>

              <button
                type="button"
                onClick={async () => {
                  setLmEditorOpen(true);
                  await prepareLmPreview({ ensureText: true });
                }}
                disabled={lmPdfLoading || !profile}
                className="btn-secondary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {lmPdfLoading ? "Préparation..." : "Ouvrir éditeur LM (aperçu)"}
              </button>
            </div>
          </div>
        </form>
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
              <h3 className="text-base sm:text-lg font-semibold text-[var(--brand)]">Pitch d'ascenseur</h3>
              <p className="text-[11px] text-[var(--muted)]">Résumé percutant de 2–4 phrases.</p>
            </div>
          </div>
          <select
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
          <button type="button" onClick={handleGeneratePitch} disabled={pitchLoading || !profile} className="btn-primary flex-1 disabled:opacity-60 disabled:cursor-not-allowed">
            {pitchLoading ? "Génération..." : "Générer le pitch"}
          </button>
          <button type="button" onClick={handleCopyPitch} disabled={!pitchText} className="btn-secondary flex-1 disabled:opacity-60 disabled:cursor-not-allowed">
            {pitchCopied ? "Copié ✅" : "Copier"}
          </button>
        </div>

        <div className="mt-2 p-3 card-soft rounded-md text-[13px] text-[var(--ink)] whitespace-pre-line">
          {pitchText ? <p>{pitchText}</p> : <p className="text-center text-[11px] text-[var(--muted)]">Après génération, ton pitch apparaîtra ici.</p>}
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
              <p className="text-[11px] text-[var(--muted)]">Objet + corps à copier, propre (ton au choix).</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleGenerateEmail} className="grid md:grid-cols-2 gap-4 text-sm mt-1">
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Nom de l'entreprise</label>
            <input className="input w-full" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Ex : IMOGATE" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Intitulé du poste</label>
            <input className="input w-full" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Ex : Ingénieur Réseaux & Sécurité" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Nom du recruteur (optionnel)</label>
            <input className="input w-full" value={recruiterName} onChange={(e) => setRecruiterName(e.target.value)} placeholder="Ex : Mme Dupont" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Ton</label>
            <select className="select-brand w-full bg-[var(--bg-soft)]" value={emailTone} onChange={(e) => setEmailTone(e.target.value as any)}>
              <option value="standard">Standard</option>
              <option value="pro">Très pro</option>
              <option value="court">Court</option>
            </select>
          </div>

          <div className="md:col-span-2 flex justify-end gap-2">
            <button type="submit" className="btn-primary min-w-[180px]">
              Générer
            </button>
            <button type="button" className="btn-secondary min-w-[180px]" onClick={copyEmailAll} disabled={!subjectPreview || !emailPreview}>
              {emailCopied ? "Copié ✅" : "Copier objet + mail"}
            </button>
          </div>
        </form>

        <div className="grid md:grid-cols-2 gap-4 mt-3 text-sm">
          <div className="card-soft rounded-xl p-4 border border-[var(--border-soft)]">
            <h4 className="font-semibold text-sm mb-2">Objet</h4>
            <div className="text-xs text-[var(--muted)] whitespace-pre-line">{subjectPreview || "L'objet généré apparaîtra ici."}</div>
          </div>
          <div className="card-soft rounded-xl p-4 border border-[var(--border-soft)]">
            <h4 className="font-semibold text-sm mb-2">Corps du mail</h4>
            <div className="text-xs text-[var(--muted)] whitespace-pre-line max-h-64 overflow-auto">
              {emailPreview || "Le texte du mail apparaîtra ici après génération."}
            </div>
          </div>
        </div>
      </section>

      {/* =============== MODAL CV FULLSCREEN =============== */}
      <FullScreenModal
        open={cvEditorOpen}
        title="Éditeur CV — plein écran"
        onClose={() => setCvEditorOpen(false)}
        actions={
          <>
            <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={loadCvDraft} disabled={!userId}>
              Charger
            </button>
            <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={saveCvDraft} disabled={!userId || !cvDraft}>
              Enregistrer
            </button>
            <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={clearCvDraft} disabled={!userId}>
              Oublier
            </button>
            <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={prepareCvPreview} disabled={cvLoading}>
              Régénérer aperçu
            </button>
            <button type="button" className="btn-primary !py-2 !px-3 text-[12px]" onClick={downloadCv} disabled={!cvLastBlob}>
              Télécharger
            </button>
          </>
        }
      >
        <div className="h-full grid grid-cols-1 lg:grid-cols-2 min-h-0">
          {/* LEFT: editor */}
          <div className="min-h-0 overflow-auto p-3 sm:p-4 border-b lg:border-b-0 lg:border-r border-[var(--border)]">
            {!cvDraft ? (
              <p className="text-[11px] text-[var(--muted)]">Charge ton profil CV IA pour éditer.</p>
            ) : (
              <div className="space-y-3">
                {/* Sections */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3">
                  <p className="text-[11px] font-medium text-[var(--muted)] mb-2">Sections à afficher</p>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--muted)]">
                    {(
                      [
                        ["profile", "Profil"],
                        ["xp", "Expérience"],
                        ["education", "Formation"],
                        ["skills", "Compétences"],
                        ["certs", "Certifications"],
                        ["languages", "Langues"],
                        ["hobbies", "Hobbies"],
                      ] as Array<[CvSectionKey, string]>
                    ).map(([k, label]) => (
                      <label key={k} className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={cvSections[k]} onChange={(e) => setCvSections((prev) => ({ ...prev, [k]: e.target.checked }))} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Quick fields */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Nom</label>
                    <input
                      className="input w-full"
                      value={(cvDraft as any).name || ""}
                      onChange={(e) => {
                        setCvDraftDirty(true);
                        setCvDraft((prev) => (prev ? ({ ...prev, name: e.target.value } as any) : prev));
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Titre</label>
                    <input
                      className="input w-full"
                      value={(cvDraft as any).title || ""}
                      onChange={(e) => {
                        setCvDraftDirty(true);
                        setCvDraft((prev) => (prev ? ({ ...prev, title: e.target.value } as any) : prev));
                      }}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Contact line</label>
                  <input
                    className="input w-full"
                    value={(cvDraft as any).contactLine || ""}
                    onChange={(e) => {
                      setCvDraftDirty(true);
                      setCvDraft((prev) => (prev ? ({ ...prev, contactLine: e.target.value } as any) : prev));
                    }}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Profil</label>
                  <textarea
                    rows={4}
                    className="input textarea w-full"
                    value={(cvDraft as any).profile || ""}
                    onChange={(e) => {
                      setCvDraftDirty(true);
                      setCvDraft((prev) => (prev ? ({ ...prev, profile: e.target.value } as any) : prev));
                    }}
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Certifications</label>
                    <textarea
                      rows={3}
                      className="input textarea w-full"
                      value={(cvDraft as any).certs || ""}
                      onChange={(e) => {
                        setCvDraftDirty(true);
                        setCvDraft((prev) => (prev ? ({ ...prev, certs: e.target.value } as any) : prev));
                      }}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Langues</label>
                    <textarea
                      rows={3}
                      className="input textarea w-full"
                      value={(cvDraft as any).langLine || ""}
                      onChange={(e) => {
                        setCvDraftDirty(true);
                        setCvDraft((prev) => (prev ? ({ ...prev, langLine: e.target.value } as any) : prev));
                      }}
                    />
                  </div>
                </div>

                {/* Skills */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Compétences – tools (virgules)</label>
                    <textarea
                      rows={3}
                      className="input textarea w-full"
                      value={joinList(((cvDraft as any).skills?.tools || []) as string[])}
                      onChange={(e) => {
                        const tools = splitList(e.target.value);
                        setCvDraftDirty(true);
                        setCvDraft((prev) => {
                          if (!prev) return prev;
                          const skills = { ...(prev as any).skills, tools };
                          return { ...(prev as any), skills };
                        });
                      }}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Compétences – cloud</label>
                    <textarea
                      rows={3}
                      className="input textarea w-full"
                      value={joinList(((cvDraft as any).skills?.cloud || []) as string[])}
                      onChange={(e) => {
                        const cloud = splitList(e.target.value);
                        setCvDraftDirty(true);
                        setCvDraft((prev) => {
                          if (!prev) return prev;
                          const skills = { ...(prev as any).skills, cloud };
                          return { ...(prev as any), skills };
                        });
                      }}
                    />
                  </div>
                </div>

                {/* Education */}
                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Formation (1 ligne = 1 entrée)</label>
                  <textarea
                    rows={4}
                    className="input textarea w-full"
                    value={linesToText(((cvDraft as any).education || []) as string[])}
                    onChange={(e) => {
                      setCvDraftDirty(true);
                      const education = textToLines(e.target.value);
                      setCvDraft((prev) => (prev ? ({ ...prev, education } as any) : prev));
                    }}
                  />
                </div>

                {/* Experiences */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[11px] font-medium text-[var(--muted)]">Expériences</p>
                    <button
                      type="button"
                      className="btn-secondary !py-1 !px-3 text-[11px]"
                      onClick={() => {
                        setCvDraftDirty(true);
                        setCvDraft((prev) => {
                          if (!prev) return prev;
                          const xp = Array.isArray((prev as any).xp) ? ([...(prev as any).xp] as any[]) : [];
                          xp.unshift({ company: "", role: "", dates: "", city: "", bullets: [] });
                          return { ...(prev as any), xp };
                        });
                      }}
                    >
                      + Ajouter
                    </button>
                  </div>

                  <div className="space-y-2">
                    {(((cvDraft as any).xp || []) as any[]).map((x, idx) => (
                      <details key={idx} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2">
                        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--ink)]">
                          {(x.role || "Rôle")} — {(x.company || "Entreprise")}{" "}
                          <span className="text-[10px] text-[var(--muted)]">#{idx + 1}</span>
                        </summary>

                        <div className="mt-2 space-y-2">
                          <div className="grid sm:grid-cols-2 gap-2">
                            <input
                              className="input w-full"
                              placeholder="Rôle"
                              value={x.role || ""}
                              onChange={(e) => {
                                setCvDraftDirty(true);
                                setCvDraft((prev) => {
                                  if (!prev) return prev;
                                  const xp = [...((prev as any).xp || [])];
                                  xp[idx] = { ...xp[idx], role: e.target.value };
                                  return { ...(prev as any), xp };
                                });
                              }}
                            />
                            <input
                              className="input w-full"
                              placeholder="Entreprise"
                              value={x.company || ""}
                              onChange={(e) => {
                                setCvDraftDirty(true);
                                setCvDraft((prev) => {
                                  if (!prev) return prev;
                                  const xp = [...((prev as any).xp || [])];
                                  xp[idx] = { ...xp[idx], company: e.target.value };
                                  return { ...(prev as any), xp };
                                });
                              }}
                            />
                          </div>

                          <div className="grid sm:grid-cols-2 gap-2">
                            <input
                              className="input w-full"
                              placeholder="Dates (ex: 2022–2024)"
                              value={x.dates || ""}
                              onChange={(e) => {
                                setCvDraftDirty(true);
                                setCvDraft((prev) => {
                                  if (!prev) return prev;
                                  const xp = [...((prev as any).xp || [])];
                                  xp[idx] = { ...xp[idx], dates: e.target.value };
                                  return { ...(prev as any), xp };
                                });
                              }}
                            />
                            <input
                              className="input w-full"
                              placeholder="Ville / Lieu"
                              value={x.city || ""}
                              onChange={(e) => {
                                setCvDraftDirty(true);
                                setCvDraft((prev) => {
                                  if (!prev) return prev;
                                  const xp = [...((prev as any).xp || [])];
                                  xp[idx] = { ...xp[idx], city: e.target.value };
                                  return { ...(prev as any), xp };
                                });
                              }}
                            />
                          </div>

                          <textarea
                            rows={4}
                            className="input textarea w-full"
                            placeholder={"Bullets (1 ligne = 1 bullet)\n- Exemple: Mise en place MFA\n- Exemple: Durcissement AD"}
                            value={bulletsToText(x.bullets || [])}
                            onChange={(e) => {
                              const bullets = textToBullets(e.target.value);
                              setCvDraftDirty(true);
                              setCvDraft((prev) => {
                                if (!prev) return prev;
                                const xp = [...((prev as any).xp || [])];
                                xp[idx] = { ...xp[idx], bullets };
                                return { ...(prev as any), xp };
                              });
                            }}
                          />

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn-secondary !py-1 !px-3 text-[11px]"
                              onClick={() => {
                                setCvDraftDirty(true);
                                setCvDraft((prev) => {
                                  if (!prev) return prev;
                                  const xp = [...((prev as any).xp || [])];
                                  if (idx > 0) [xp[idx - 1], xp[idx]] = [xp[idx], xp[idx - 1]];
                                  return { ...(prev as any), xp };
                                });
                              }}
                            >
                              ↑ Monter
                            </button>

                            <button
                              type="button"
                              className="btn-secondary !py-1 !px-3 text-[11px]"
                              onClick={() => {
                                setCvDraftDirty(true);
                                setCvDraft((prev) => {
                                  if (!prev) return prev;
                                  const xp = [...((prev as any).xp || [])];
                                  if (idx < xp.length - 1) [xp[idx + 1], xp[idx]] = [xp[idx], xp[idx + 1]];
                                  return { ...(prev as any), xp };
                                });
                              }}
                            >
                              ↓ Descendre
                            </button>

                            <button
                              type="button"
                              className="btn-secondary !py-1 !px-3 text-[11px] border-red-500/40 text-red-300 hover:border-red-500"
                              onClick={() => {
                                setCvDraftDirty(true);
                                setCvDraft((prev) => {
                                  if (!prev) return prev;
                                  const xp = [...((prev as any).xp || [])];
                                  xp.splice(idx, 1);
                                  return { ...(prev as any), xp };
                                });
                              }}
                            >
                              Supprimer
                            </button>
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>

                {/* Hobbies */}
                <div>
                  <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">Hobbies (virgules)</label>
                  <input
                    className="input w-full"
                    value={joinList(((cvDraft as any).hobbies || []) as string[])}
                    onChange={(e) => {
                      const hobbies = splitList(e.target.value);
                      setCvDraftDirty(true);
                      setCvDraft((prev) => (prev ? ({ ...prev, hobbies } as any) : prev));
                    }}
                  />
                </div>

                {/* Reset */}
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => {
                    if (!baseCvModel) return;
                    setCvDraft(baseCvModel);
                    setCvDraftDirty(false);
                    setCvSections(DEFAULT_CV_SECTIONS);
                  }}
                >
                  Réinitialiser au profil IA
                </button>
              </div>
            )}
          </div>

          {/* RIGHT: preview (PDF.js canvas) */}
          <div className="min-h-0 bg-white border-t lg:border-t-0 lg:border-l border-[var(--border)]">
            <PdfCanvasViewer fileUrl={cvPreviewUrl} />
          </div>
        </div>
      </FullScreenModal>

      {/* =============== MODAL LM FULLSCREEN =============== */}
      <FullScreenModal
        open={lmEditorOpen}
        title="Éditeur Lettre de motivation — plein écran"
        onClose={() => setLmEditorOpen(false)}
        actions={
          <>
            <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={() => prepareLmPreview({ ensureText: true })} disabled={lmPdfLoading}>
              Régénérer aperçu
            </button>
            <button type="button" className="btn-primary !py-2 !px-3 text-[12px]" onClick={downloadLm} disabled={!lmLastBlob}>
              Télécharger
            </button>
          </>
        }
      >
        <div className="h-full grid grid-cols-1 lg:grid-cols-2 min-h-0">
          <div className="min-h-0 overflow-auto p-3 sm:p-4 border-b lg:border-b-0 lg:border-r border-[var(--border)]">
            <div className="space-y-2">
              <p className="text-[11px] text-[var(--muted)]">Édite le texte → l’aperçu se met à jour automatiquement (debounce).</p>

              <label className="block text-[11px] font-medium text-[var(--muted)]">Texte (corps uniquement)</label>
              <textarea
                rows={18}
                className="input textarea w-full text-[13px] text-[var(--ink)] bg-[var(--bg)]"
                value={letterBody}
                onChange={(e) => setLetterBody(e.target.value)}
                placeholder="Colle / modifie ici…"
              />

              {lmPdfError && <p className="text-[11px] text-red-400">{lmPdfError}</p>}

              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-secondary" onClick={() => prepareLmPreview({ ensureText: false })} disabled={lmPdfLoading}>
                  Régénérer
                </button>
                <button type="button" className="btn-primary" onClick={downloadLm} disabled={!lmLastBlob}>
                  Télécharger
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 bg-white border-t lg:border-t-0 lg:border-l border-[var(--border)]">
            <PdfCanvasViewer fileUrl={lmPreviewUrl} />
          </div>
        </div>
      </FullScreenModal>

      {/* =============== MODAL CV+LM VIEWER =============== */}
      <FullScreenModal
        open={cvLmViewerOpen}
        title="Aperçu CV + LM — plein écran (2 pages)"
        onClose={() => setCvLmViewerOpen(false)}
        actions={
          <>
            <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={prepareCvLmPreview} disabled={cvLoading}>
              Régénérer aperçu
            </button>
            <button type="button" className="btn-primary !py-2 !px-3 text-[12px]" onClick={downloadCvLm} disabled={!cvLmLastBlob}>
              Télécharger
            </button>
          </>
        }
      >
        <div className="h-full min-h-0">
          <PdfCanvasViewer fileUrl={cvLmPreviewUrl} className="h-full" />
        </div>
      </FullScreenModal>

      {/* Modal templates */}
      {templatesModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3" aria-modal="true" role="dialog">
          <div className="absolute inset-0 bg-black/60" onClick={() => setTemplatesModalOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.18 }}
            className="relative w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden"
          >
            <div className="p-3 sm:p-4 border-b border-[var(--border)] bg-[var(--bg-soft)] flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[13px] font-semibold text-[var(--ink)]">Choisir un modèle</p>
                <p className="text-[10px] text-[var(--muted)]">Recherche + sélection instantanée</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="input !py-2 !text-[12px] w-[220px]"
                  placeholder="Rechercher (ex: pro, ats, tech)"
                />
                <button type="button" className="btn-secondary !py-2 !px-3 text-[12px]" onClick={() => setTemplatesModalOpen(false)}>
                  Fermer
                </button>
              </div>
            </div>

            <div className="p-3 sm:p-4 max-h-[70vh] overflow-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredTemplates.map((t) => {
                  const active = t.id === cvTemplate;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setCvTemplate(t.id);
                        setTemplatesModalOpen(false);
                        setTemplateSearch("");
                      }}
                      className={`text-left rounded-2xl border p-2 bg-[var(--bg-soft)] transition
                        ${active ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20" : "border-[var(--border)] hover:border-[var(--brand)]/50"}`}
                    >
                      <img
                        src={t.previewSrc}
                        alt={t.label}
                        className="w-full h-[150px] object-cover rounded-xl border border-[var(--border)] bg-white"
                        loading="lazy"
                      />
                      <div className="mt-2">
                        <p className="text-[12px] font-semibold text-[var(--ink)] flex items-center justify-between gap-2">
                          <span>{t.label}</span>
                          {active && (
                            <span className="text-[10px] px-2 py-[2px] rounded-full bg-[var(--brand)]/10 text-[var(--brand)] border border-[var(--brand)]/20">
                              Sélectionné
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-[var(--muted)] line-clamp-2">{t.description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {!filteredTemplates.length && <p className="text-center text-[11px] text-[var(--muted)] py-8">Aucun modèle trouvé.</p>}
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}