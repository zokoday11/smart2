// app/app/assistant-candidature/page.tsx
"use client";

import { logUsage } from "@/lib/logUsage";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

import { getRecaptchaToken } from "@/lib/recaptcha";
import { callGenerateCvPdf, callGenerateLetterAndPitch } from "@/lib/gemini";

import { makePdfColors } from "@/lib/pdf/colors";
import { fitOnePage } from "@/lib/pdf/fitOnePage";
import { mergePdfBlobs } from "@/lib/pdf/mergePdfs";
import { downloadBlob } from "@/lib/pdf/pdfmakeClient";

import type { CvDocModel } from "@/lib/pdf/templates/cvAts";
import { buildCvPdf, getCvTemplates, type CvTemplateId } from "@/lib/pdf/templates/cvTemplates";
import { buildLmStyledPdf, type LmModel } from "@/lib/pdf/templates/letter";

import {
  PenTool,
  Sparkles,
  FileText,
  Briefcase,
  Send,
  Copy,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Download,
  Mail,
  MessageSquareText,
  Loader2,
} from "lucide-react";

// =============================
// TYPES
// =============================
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
  // meta
  title?: string;

  // ident
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
type ViewMode = "cv_lm" | "pitch" | "mail";
type GenerationKind = "cv" | "cv_lm" | "lm" | "pitch";

// =============================
// Helpers (texte & model)
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

function normalizeHex(v: string) {
  const s = safeText(v).trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : "#3b82f6";
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

    if (title.match(/cloud|azure|aws|gcp/)) pushAll(cloud, items);
    else if (title.match(/sécu|secu|security|cyber/)) pushAll(sec, items);
    else if (title.match(/réseau|reseau|system|système|sys/)) pushAll(sys, items);
    else if (title.match(/autom|devops|ia|api/)) pushAll(auto, items);
    else pushAll(tools, items);
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
// LM prompt strict + sanitize
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
  if (profile.phone) contactLines.push(lang === "fr" ? `Téléphone : ${safeText(profile.phone)}` : `Phone: ${safeText(profile.phone)}`);
  if (profile.email) contactLines.push(lang === "fr" ? `Email : ${safeText(profile.email)}` : `Email: ${safeText(profile.email)}`);
  if (profile.linkedin) contactLines.push(lang === "fr" ? `LinkedIn : ${safeText(profile.linkedin)}` : `LinkedIn: ${safeText(profile.linkedin)}`);

  const city = safeText(profile.city) || "Paris";

  // ✅ date stable + timezone Europe/Paris
  const dateStr =
    lang === "fr"
      ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" }).format(new Date())
      : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris" }).format(new Date());

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
// CV editor helpers
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
const textToLines = (t: string) => String(t || "").split(/\r?\n/g).map((x) => x.trim()).filter(Boolean);
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
// Full screen modal
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
      <div className="absolute inset-0 p-2 sm:p-3">
        <div className="h-full w-full rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden flex flex-col">
          <div className="p-2.5 sm:p-3 border-b border-[var(--border)] bg-[var(--bg-soft)] flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-[var(--ink)] truncate">{title}</p>
              <p className="text-[10px] text-[var(--muted)]">ESC pour fermer</p>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={onClose}>
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
// PDF VIEWER via PDF.js CDN
// =============================
let __pdfjsReady = false;
let __pdfjs: any = null;
let __pdfjsLoading: Promise<any> | null = null;

async function ensurePdfJs() {
  if (__pdfjsReady && __pdfjs) return __pdfjs;
  if (__pdfjsLoading) return __pdfjsLoading;

  __pdfjsLoading = (async () => {
    if (typeof window === "undefined") throw new Error("PDF.js doit être chargé côté client.");
    const PDFJS_VERSION = "4.0.379";
    const pdfjs: any = await import(/* webpackIgnore: true */ `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
    __pdfjs = pdfjs;
    __pdfjsReady = true;
    return pdfjs;
  })();

  return __pdfjsLoading;
}

function PdfCanvasViewer({ fileUrl, className }: { fileUrl: string | null; className?: string }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ✅ avoid leaks / overlapping renders
  const loadingTaskRef = useRef<any>(null);
  const renderTaskRef = useRef<any>(null);

  const [pdf, setPdf] = useState<any>(null);
  const [numPages, setNumPages] = useState(1);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.05);
  const [rendering, setRendering] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setErr(null);
      setPdf(null);
      setNumPages(1);
      setPage(1);

      // cleanup previous tasks / doc
      try {
        renderTaskRef.current?.cancel?.();
      } catch {}
      renderTaskRef.current = null;

      try {
        loadingTaskRef.current?.destroy?.();
      } catch {}
      loadingTaskRef.current = null;

      try {
        await pdf?.destroy?.();
      } catch {}

      if (!fileUrl) return;

      try {
        const pdfjs = await ensurePdfJs();
        const task = (pdfjs as any).getDocument({ url: fileUrl });
        loadingTaskRef.current = task;

        const doc = await task.promise;
        if (cancelled) {
          try {
            await doc?.destroy?.();
          } catch {}
          return;
        }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!pdf || !canvasRef.current) return;

      // cancel previous render if any
      try {
        renderTaskRef.current?.cancel?.();
      } catch {}
      renderTaskRef.current = null;

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
        renderTaskRef.current = renderTask;

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
      const pad = 24;
      const w = Math.max(280, wrapRef.current.clientWidth - pad);
      const next = w / viewport1.width;
      setScale(Math.max(0.4, Math.min(2.2, next)));
    } catch {
      // ignore
    }
  };

  return (
    <div className={["h-full min-h-0 flex flex-col", className || ""].join(" ")}>
      <div className="px-2.5 py-2 border-b border-[var(--border)] bg-[var(--bg-soft)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span className="inline-flex items-center gap-1">
            <span className="font-medium text-[var(--ink)]">Page</span>
            <input
              className="input !py-1 !px-2 !text-[11px] w-[56px] bg-[var(--bg)]"
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
          <button type="button" className="btn-secondary !py-1 !px-2.5 text-[11px]" onClick={() => canPrev && setPage((p) => p - 1)} disabled={!canPrev}>
            ←
          </button>
          <button type="button" className="btn-secondary !py-1 !px-2.5 text-[11px]" onClick={() => canNext && setPage((p) => p + 1)} disabled={!canNext}>
            →
          </button>

          <span className="w-[1px] h-5 bg-[var(--border)] mx-1" />

          <button type="button" className="btn-secondary !py-1 !px-2.5 text-[11px]" onClick={() => setScale((s) => Math.max(0.4, Number((s - 0.1).toFixed(2))))}>
            -
          </button>
          <span className="text-[11px] text-[var(--muted)] w-[52px] text-center">{Math.round(scale * 100)}%</span>
          <button type="button" className="btn-secondary !py-1 !px-2.5 text-[11px]" onClick={() => setScale((s) => Math.min(2.2, Number((s + 0.1).toFixed(2))))}>
            +
          </button>

          <button type="button" className="btn-secondary !py-1 !px-2.5 text-[11px]" onClick={fitWidth}>
            Ajuster
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="flex-1 min-h-0 overflow-auto bg-white">
        {err ? (
          <div className="p-4 text-[11px] text-red-400">{err}</div>
        ) : !fileUrl ? (
          <div className="h-full flex items-center justify-center text-[11px] text-[var(--muted)]">Aucun PDF à afficher.</div>
        ) : (
          <div className="p-2.5 flex justify-center">
            <canvas ref={canvasRef} className="shadow-sm border border-black/10 rounded-lg bg-white" />
          </div>
        )}
      </div>
    </div>
  );
}

// =============================
// UI bits (compact)
// =============================
function CyberCard({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={["bg-slate-900/60 border border-white/5 rounded-2xl p-4 backdrop-blur-md shadow-xl", className].join(" ")}>{children}</div>;
}

function CyberSectionTitle({ icon, title, subtitle }: { icon?: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[11px] font-bold text-white uppercase tracking-widest flex items-center gap-2">
        {icon}
        {title}
      </h3>
      {subtitle ? <p className="text-[11px] text-slate-500 mt-1">{subtitle}</p> : null}
    </div>
  );
}

function CyberInput({ label, value, onChange, placeholder, area = false, rows = 4, type = "text" }: any) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">{label}</label>
      {area ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-300 focus:border-blue-500/50 outline-none transition-all resize-none custom-scrollbar placeholder:text-slate-700"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          className="w-full bg-slate-950/50 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-300 focus:border-blue-500/50 outline-none transition-all placeholder:text-slate-700"
        />
      )}
    </div>
  );
}

function CyberPillTabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: Array<{ key: T; label: string; icon?: ReactNode }>;
}) {
  return (
    <div className="flex bg-slate-950 rounded-xl p-1 border border-white/10">
      {items.map((it) => {
        const active = value === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onChange(it.key)}
            className={[
              "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold transition-all",
              active ? "bg-white text-slate-900" : "text-slate-500 hover:text-white hover:bg-white/5",
            ].join(" ")}
          >
            {it.icon}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function CyberCallout({ kind, children }: { kind: "error" | "success" | "info"; children: ReactNode }) {
  const styles =
    kind === "success"
      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-200"
      : kind === "error"
        ? "bg-red-500/10 border-red-500/20 text-red-200"
        : "bg-white/5 border-white/10 text-slate-300";

  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? AlertCircle : MessageSquareText;

  return (
    <div className={["p-3 rounded-xl border flex items-start gap-3", styles].join(" ")}>
      <Icon className="h-4 w-4 mt-0.5 opacity-90" />
      <div className="text-xs leading-relaxed">{children}</div>
    </div>
  );
}

// =============================
// PAGE
// =============================
export default function AssistanceCandidaturePage() {
  // --- profil ---
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [globalLoadingMessage, setGlobalLoadingMessage] = useState<string | null>(null);

  // ✅ Tabs
  const [viewMode, setViewMode] = useState<ViewMode>("cv_lm");

  // ✅ Mobile: switch between CONFIG / PREVIEW to keep “one-screen”
  const [mobilePane, setMobilePane] = useState<"config" | "preview">("config");

  // --- CV ---
  const [cvTargetJob, setCvTargetJob] = useState("");
  const [cvTemplate, setCvTemplate] = useState<CvTemplateId>("ats");
  const [cvLang, setCvLang] = useState<Lang>("fr");
  const [cvContract, setCvContract] = useState("CDI");

  const [cvLoading, setCvLoading] = useState(false);
  const [cvStatus, setCvStatus] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);

  const [pdfBrand, setPdfBrand] = useState("#3b82f6");
  const [cvOfferDescription, setCvOfferDescription] = useState("");
  const [cvUseAiOptimizeOnDownload, setCvUseAiOptimizeOnDownload] = useState(true);

  const [templatesModalOpen, setTemplatesModalOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");

  const [cvSections, setCvSections] = useState<Record<CvSectionKey, boolean>>(DEFAULT_CV_SECTIONS);
  const [cvDraft, setCvDraft] = useState<CvDocModel | null>(null);
  const [cvDraftDirty, setCvDraftDirty] = useState(false);

  const [cvLastBlob, setCvLastBlob] = useState<Blob | null>(null);
  const [cvPreviewUrl, setCvPreviewUrl] = useState<string | null>(null);

  const [cvLmLastBlob, setCvLmLastBlob] = useState<Blob | null>(null);
  const [cvLmPreviewUrl, setCvLmPreviewUrl] = useState<string | null>(null);

  // Fullscreen modals
  const [cvEditorOpen, setCvEditorOpen] = useState(false);
  const [cvLmViewerOpen, setCvLmViewerOpen] = useState(false);
  const [cvMobileView, setCvMobileView] = useState<"edit" | "preview">("edit");

  // --- LM ---
  const [lmLang, setLmLang] = useState<Lang>("fr");
  const [companyName, setCompanyName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobLink, setJobLink] = useState("");

  const [letterBody, setLetterBody] = useState("");
  const [lmLoading, setLmLoading] = useState(false);
  const [lmError, setLmError] = useState<string | null>(null);

  const [lmPdfLoading, setLmPdfLoading] = useState(false);
  const [lmPdfError, setLmPdfError] = useState<string | null>(null);

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
  // Load profile
  // =============================
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserId(null);
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      setUserId(user.uid);

      try {
        const ref = doc(db, "profiles", user.uid);
        const snap = await getDoc(ref);

        if (snap.exists()) {
          const data = snap.data() as any;

          const loadedProfile: CvProfile = {
            title: data.title || "",
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

          // prefill titles
          const detectedTitle = safeText(data.title);
          if (detectedTitle) {
            setCvTargetJob((v) => v || detectedTitle);
            setJobTitle((v) => v || detectedTitle);
          }
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error("Erreur chargement profil Firestore:", e);
      } finally {
        setLoadingProfile(false);
      }
    });

    return () => unsub();
  }, []);

  // =============================
  // Derived
  // =============================
  const miniHeadline = profile?.profileSummary?.split(".")[0] || profile?.contractType || "Analyse ton CV PDF dans « CV IA » pour activer l’assistant.";

  const targetedJob = jobTitle || cvTargetJob || "Poste cible";
  const targetedCompany = companyName || "Entreprise";

  const cvTemplates = useMemo(() => getCvTemplates(), []);
  const colors = useMemo(() => makePdfColors(normalizeHex(pdfBrand)), [pdfBrand]);

  const baseCvModel = useMemo(() => {
    if (!profile) return null;
    return profileToCvDocModel(profile, { targetJob: cvTargetJob, contract: cvContract });
  }, [profile, cvTargetJob, cvContract]);

  useEffect(() => {
    if (!baseCvModel) return;
    if (!cvDraft || !cvDraftDirty) setCvDraft(baseCvModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCvModel]);

  useEffect(() => {
    return () => {
      if (cvPreviewUrl) URL.revokeObjectURL(cvPreviewUrl);
      if (lmPreviewUrl) URL.revokeObjectURL(lmPreviewUrl);
      if (cvLmPreviewUrl) URL.revokeObjectURL(cvLmPreviewUrl);
    };
  }, [cvPreviewUrl, lmPreviewUrl, cvLmPreviewUrl]);

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
  // Build final CV model
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
  // Firestore: auto create
  // =============================
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
      console.error("Erreur création entrée suivi candidature:", e);
    }
  };

  // =============================
  // CV preview (no download)
  // =============================
  const prepareCvPreview = async (): Promise<Blob | null> => {
    if (!profile || !baseCvModel) {
      setCvError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA.");
      return null;
    }

    setCvError(null);
    setCvStatus(null);
    setCvLoading(true);
    setGlobalLoadingMessage("Aperçu CV…");

    try {
      const cvModel = buildFinalCvModel();
      const { blob, bestScale } = await fitOnePage((scale) => buildCvPdf(cvTemplate, cvModel, cvLang, colors, "auto", scale));

      setCvLastBlob(blob);
      const nextUrl = URL.createObjectURL(blob);
      setCvPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });

      setCvStatus(`Aperçu prêt ✅ (scale=${bestScale.toFixed(2)})`);
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

  // =============================
  // Download CV (click)
  // =============================
  const downloadCv = async () => {
    if (!profile || !baseCvModel) {
      setCvError("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA.");
      return;
    }

    if (cvUseAiOptimizeOnDownload && cvOfferDescription.trim()) {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Connecte-toi pour télécharger un CV adapté.");

        setCvError(null);
        setGlobalLoadingMessage("CV adapté à l’offre (IA)…");
        const idToken = await user.getIdToken();
        const recaptchaToken = await getRecaptchaToken("generate_cv_pdf");

        const blob = await callGenerateCvPdf({
          profile: profile as any,
          targetJob: cvTargetJob,
          lang: cvLang,
          contract: cvContract,
          jobLink,
          jobDescription: cvOfferDescription,
          companyName,
          recaptchaToken,
          idToken,
        });

        downloadBlob(blob, "cv-ia-adapte.pdf");
        await autoCreateApplication("cv");

        await logUsage({
          user,
          action: "download_pdf",
          docType: "cv",
          eventType: "cv_download",
          tool: "cloudFunctionGenerateCvPdf",
        });

        return;
      } catch (e: any) {
        setCvError(e?.message || "Impossible d’adapter le CV via IA.");
      } finally {
        setGlobalLoadingMessage(null);
      }
    }

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
  // Letter text (AI)
  // =============================
  const generateCoverLetterText = async (lang: Lang): Promise<string> => {
    if (!profile) throw new Error("Profil manquant.");
    if (!jobTitle && !jobDescription) throw new Error("Ajoute au moins l'intitulé du poste ou un extrait de la description.");

    const user = auth.currentUser;
    if (!user) throw new Error("Vous devez être connecté pour générer une lettre.");

    const idToken = await user.getIdToken();
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

    const res = await callGenerateLetterAndPitch({
      profile: profile as any,
      jobTitle,
      companyName,
      jobDescription: strictPrompt,
      lang,
      recaptchaToken,
      idToken,
    });

    const out = (res.letterBody || res.coverLetter || "").trim();
    const cleaned = sanitizeLM(out);
    if (!cleaned) throw new Error("Lettre vide renvoyée par l'API.");

    const name = safeText(profile.fullName);
    return extractBodyOnly(cleaned, lang, name) || cleaned;
  };

  // =============================
  // LM preview (no download)
  // =============================
  const prepareLmPreview = async (opts?: { ensureText?: boolean }): Promise<Blob | null> => {
    if (!profile) {
      setLmPdfError("Profil manquant.");
      return null;
    }

    setLmPdfError(null);
    setLmPdfLoading(true);
    setGlobalLoadingMessage("Aperçu LM…");

    try {
      let cover = letterBody?.trim();

      if (opts?.ensureText && !cover) {
        setGlobalLoadingMessage("Texte lettre (IA)…");
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

  // Download LM
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
  // CV+LM preview + download
  // =============================
  const prepareCvLmPreview = async (): Promise<Blob | null> => {
    if (!profile || !baseCvModel) {
      setCvError("Aucun profil CV IA détecté.");
      return null;
    }

    setCvError(null);
    setCvStatus(null);
    setCvLoading(true);
    setGlobalLoadingMessage("Aperçu CV+LM…");

    try {
      const cvModel = buildFinalCvModel();
      const cvFit = await fitOnePage((scale) => buildCvPdf(cvTemplate, cvModel, cvLang, colors, "auto", scale));

      let cover = letterBody?.trim();
      if (!cover) {
        setGlobalLoadingMessage("Texte lettre (IA)…");
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
  // Debounced auto preview in editors
  // =============================
  const cvPreviewTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!cvEditorOpen) return;
    if (!cvDraft) return;

    if (cvPreviewTimer.current) window.clearTimeout(cvPreviewTimer.current);
    cvPreviewTimer.current = window.setTimeout(() => {
      prepareCvPreview();
    }, 420);

    return () => {
      if (cvPreviewTimer.current) window.clearTimeout(cvPreviewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvEditorOpen, cvDraft, cvSections, cvTemplate, cvLang, colors]);

  const lmPreviewTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!lmEditorOpen) return;
    if (!letterBody?.trim()) return;

    if (lmPreviewTimer.current) window.clearTimeout(lmPreviewTimer.current);
    lmPreviewTimer.current = window.setTimeout(() => {
      prepareLmPreview({ ensureText: false });
    }, 420);

    return () => {
      if (lmPreviewTimer.current) window.clearTimeout(lmPreviewTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lmEditorOpen, letterBody, lmLang, colors, companyName, jobTitle]);

  // =============================
  // Generate LM (button)
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
    setGlobalLoadingMessage("Lettre (IA)…");

    try {
      const coverLetterBody = await generateCoverLetterText(lmLang);
      setLetterBody(coverLetterBody);
      setLmEditorOpen(true);
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
  // Pitch
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
    setGlobalLoadingMessage("Pitch (IA)…");

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Connecte-toi pour générer un pitch.");
      const token = await user.getIdToken();
      const recaptchaToken = await getRecaptchaToken("generate_letter_pitch");

      const res = await callGenerateLetterAndPitch({
        profile: profile as any,
        jobTitle: effectiveJobTitle,
        companyName,
        jobDescription: effectiveDesc,
        lang: pitchLang,
        recaptchaToken,
        idToken: token,
      });

      const pitch = (res.pitch || "").trim();
      if (!pitch) throw new Error("Pitch vide renvoyé par l'API.");

      setPitchText(pitch);
      await autoCreateApplication("pitch");

      await logUsage({
        user,
        action: "generate_pitch",
        docType: "other",
        eventType: "generate",
        tool: "generateLetterAndPitch",
      });
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
      setTimeout(() => setPitchCopied(false), 1200);
    } catch (e) {
      console.error("Erreur copie pitch:", e);
    }
  };

  // =============================
  // Mail
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
      setTimeout(() => setEmailCopied(false), 1200);
    } catch (e) {
      console.error("Erreur copie email:", e);
    }
  };

  // =============================
  // LocalStorage CV draft (optionnel)
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

  // =============================
  // RENDER
  // =============================
  if (loadingProfile) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#020617] text-slate-200">
        <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#020617] text-slate-200 font-sans selection:bg-blue-500/30 p-3 lg:p-4">
      {/* Minimal CSS (keeps file standalone even if your global classes are missing) */}
      <style jsx global>{`
        :root {
          --bg: #0b1220;
          --bg-soft: rgba(15, 23, 42, 0.72);
          --ink: #e5e7eb;
          --muted: rgba(148, 163, 184, 0.9);
          --border: rgba(148, 163, 184, 0.18);
          --brand: #3b82f6;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 999px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }
        .input {
          border: 1px solid var(--border);
          background: rgba(2, 6, 23, 0.6);
          color: var(--ink);
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 12px;
          outline: none;
        }
        .input:focus {
          border-color: rgba(59, 130, 246, 0.55);
        }
        .textarea {
          resize: none;
        }
        .btn-primary {
          border-radius: 12px;
          background: var(--brand);
          color: white;
          border: 1px solid rgba(59, 130, 246, 0.5);
          padding: 10px 12px;
          font-weight: 800;
          font-size: 12px;
        }
        .btn-primary:hover {
          filter: brightness(1.08);
        }
        .btn-secondary {
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          color: var(--ink);
          border: 1px solid var(--border);
          padding: 10px 12px;
          font-weight: 800;
          font-size: 12px;
        }
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.07);
        }
      `}</style>

      <div className="max-w-7xl mx-auto h-full min-h-0 grid lg:grid-cols-[360px,1fr] gap-4">
        {/* LEFT / CONFIG */}
        <motion.aside initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} className="flex flex-col gap-3 min-h-0">
          {/* Compact header card */}
          <CyberCard className="bg-slate-900/75 p-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/30">
                <PenTool className="text-white h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[16px] font-bold text-white tracking-tight leading-tight truncate">Assistant Candidature</h1>
                <p className="text-[9px] font-mono text-blue-400 uppercase tracking-widest">CV • LM • Pitch • Mail</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2">
              <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
                <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Cible</p>
                <p className="text-[12px] text-slate-200 mt-1 truncate">
                  🎯 <span className="font-semibold">{targetedJob}</span>
                </p>
                <p className="text-[12px] text-slate-200 truncate">
                  🏢 <span className="font-semibold">{targetedCompany}</span>
                </p>
                {miniHeadline ? <p className="mt-2 text-[11px] text-slate-500 line-clamp-2">{miniHeadline}</p> : null}
              </div>

              {globalLoadingMessage ? (
                <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 flex items-center gap-2">
                  <span className="inline-flex w-3.5 h-3.5 rounded-full border-2 border-blue-500/30 border-t-blue-400 animate-spin" />
                  <p className="text-[11px] text-slate-300 font-mono truncate">{globalLoadingMessage}</p>
                </div>
              ) : null}

              {!profile ? (
                <CyberCallout kind="info">
                  Aucun profil CV IA détecté. Passe d’abord par <span className="font-semibold">CV IA</span> pour charger ton profil.
                </CyberCallout>
              ) : null}
            </div>
          </CyberCard>

          {/* Mobile pane switch (one-screen) */}
          <div className="lg:hidden">
            <CyberPillTabs
              value={mobilePane}
              onChange={setMobilePane}
              items={[
                { key: "config", label: "Config", icon: <Briefcase className="h-4 w-4" /> },
                { key: "preview", label: "Aperçu", icon: <FileText className="h-4 w-4" /> },
              ]}
            />
          </div>

          {/* Tabs */}
          <CyberCard className="p-3">
            <CyberPillTabs
              value={viewMode}
              onChange={(v) => {
                setViewMode(v);
                setMobilePane("config");
              }}
              items={[
                { key: "cv_lm", label: "CV + LM", icon: <FileText className="h-4 w-4" /> },
                { key: "pitch", label: "PITCH", icon: <Sparkles className="h-4 w-4" /> },
                { key: "mail", label: "MAIL", icon: <Mail className="h-4 w-4" /> },
              ]}
            />
          </CyberCard>

          {/* Forms (scroll INSIDE) */}
          <CyberCard className={["flex-1 min-h-0 overflow-y-auto custom-scrollbar", mobilePane === "preview" ? "hidden lg:block" : ""].join(" ")}>
            <AnimatePresence mode="wait" initial={false}>
              {viewMode === "cv_lm" && (
                <motion.div
                  key="cv_lm"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="space-y-5"
                >
                  {/* CV CONFIG */}
                  <div>
                    <CyberSectionTitle icon={<Briefcase className="h-4 w-4 text-emerald-400" />} title="CV" subtitle="Aperçu interne + éditeur." />
                    <div className="space-y-3">
                      <CyberInput label="Titre / objectif" value={cvTargetJob} onChange={setCvTargetJob} placeholder="Ex: Ingénieur Cybersécurité" />

                      <CyberInput
                        label="Offre (option IA au téléchargement)"
                        value={cvOfferDescription}
                        onChange={setCvOfferDescription}
                        placeholder="Colle 5–20 lignes (missions, outils, contexte)…"
                        area
                        rows={4}
                      />

                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cvUseAiOptimizeOnDownload}
                          onChange={(e) => setCvUseAiOptimizeOnDownload(e.target.checked)}
                          className="accent-blue-500"
                        />
                        Adapter via IA au téléchargement
                      </label>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Langue</label>
                          <select
                            className="w-full mt-1 bg-slate-950/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-blue-500/50 outline-none"
                            value={cvLang}
                            onChange={(e) => setCvLang(e.target.value as Lang)}
                          >
                            <option value="fr">FR</option>
                            <option value="en">EN</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Contrat</label>
                          <select
                            className="w-full mt-1 bg-slate-950/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-blue-500/50 outline-none"
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

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Couleur PDF</label>
                        <div className="flex items-center gap-2 mt-1">
                          <input type="color" value={normalizeHex(pdfBrand)} onChange={(e) => setPdfBrand(e.target.value)} className="h-9 w-11 rounded-xl border border-white/10 bg-slate-950/50" />
                          <input value={pdfBrand} onChange={(e) => setPdfBrand(e.target.value)} className="flex-1 input" placeholder="#3b82f6" />
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                        <input type="checkbox" checked={cvAutoCreate} onChange={(e) => setCvAutoCreate(e.target.checked)} className="accent-blue-500" />
                        Créer une entrée “Suivi 📌” au téléchargement
                      </label>

                      {/* Templates compact */}
                      <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Modèles</p>
                          <button
                            type="button"
                            onClick={() => setTemplatesModalOpen(true)}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-bold text-slate-200 transition"
                          >
                            + Plus
                          </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {top3Templates.map((t) => {
                            const active = t.id === cvTemplate;
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => setCvTemplate(t.id)}
                                className={[
                                  "rounded-xl border overflow-hidden transition text-left bg-slate-950/40",
                                  active ? "border-blue-500/60 ring-2 ring-blue-500/20" : "border-white/10 hover:border-white/20",
                                ].join(" ")}
                              >
                                <img src={t.previewSrc} alt={t.label} className="w-full h-[70px] object-cover bg-white" loading="lazy" />
                                <div className="p-2">
                                  <p className="text-[10px] font-bold text-slate-200 truncate">{t.label}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={async () => {
                            await prepareCvPreview();
                            setCvMobileView("edit");
                            setCvEditorOpen(true);
                          }}
                          disabled={cvLoading || !profile}
                          className="h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <PenTool className="h-4 w-4" />
                          Éditer
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            await prepareCvLmPreview();
                            setCvLmViewerOpen(true);
                          }}
                          disabled={cvLoading || !profile}
                          className="h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 font-extrabold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <FileText className="h-4 w-4" />
                          2p
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={downloadCv}
                          disabled={cvLoading || !profile}
                          className="h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 font-extrabold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="h-4 w-4" />
                          CV
                        </button>

                        <button
                          type="button"
                          onClick={downloadCvLm}
                          disabled={cvLoading || !profile}
                          className="h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="h-4 w-4" />
                          CV+LM
                        </button>
                      </div>

                      {cvError ? <CyberCallout kind="error">{cvError}</CyberCallout> : null}
                      {cvStatus ? <CyberCallout kind="success">{cvStatus}</CyberCallout> : null}
                    </div>
                  </div>

                  <div className="h-px bg-white/5" />

                  {/* LM CONFIG */}
                  <div>
                    <CyberSectionTitle icon={<FileText className="h-4 w-4 text-blue-400" />} title="Lettre (IA)" subtitle="Génère → édite → PDF." />
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Langue</span>
                        <div className="flex bg-slate-950 rounded-lg p-1 border border-white/10">
                          <button
                            type="button"
                            onClick={() => setLmLang("fr")}
                            className={[
                              "px-3 py-1 rounded-md text-[10px] font-bold transition-all",
                              lmLang === "fr" ? "bg-white text-slate-900" : "text-slate-500 hover:text-white",
                            ].join(" ")}
                          >
                            FR
                          </button>
                          <button
                            type="button"
                            onClick={() => setLmLang("en")}
                            className={[
                              "px-3 py-1 rounded-md text-[10px] font-bold transition-all",
                              lmLang === "en" ? "bg-white text-slate-900" : "text-slate-500 hover:text-white",
                            ].join(" ")}
                          >
                            EN
                          </button>
                        </div>
                      </div>

                      <CyberInput label="Entreprise" value={companyName} onChange={setCompanyName} placeholder="Ex: Thales, Doctolib…" />
                      <CyberInput label="Poste" value={jobTitle} onChange={setJobTitle} placeholder="Ex: Ingénieur Réseaux & Sécurité" />
                      <CyberInput label="Offre (optionnel)" value={jobDescription} onChange={setJobDescription} placeholder="Missions / outils / contexte…" area rows={4} />
                      <CyberInput label="Lien (optionnel)" value={jobLink} onChange={setJobLink} placeholder="https://" type="url" />

                      <button
                        type="button"
                        onClick={() => handleGenerateLetter()}
                        disabled={lmLoading || !profile}
                        className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {lmLoading ? <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {lmLoading ? "GÉNÉRATION..." : "GÉNÉRER"}
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          setLmEditorOpen(true);
                          await prepareLmPreview({ ensureText: true });
                        }}
                        disabled={lmPdfLoading || !profile}
                        className="w-full h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 font-extrabold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <PenTool className="h-4 w-4" />
                        Éditeur LM
                      </button>

                      {lmError ? <CyberCallout kind="error">{lmError}</CyberCallout> : null}
                      {lmPdfError ? <CyberCallout kind="error">{lmPdfError}</CyberCallout> : null}
                    </div>
                  </div>
                </motion.div>
              )}

              {viewMode === "pitch" && (
                <motion.div
                  key="pitch"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="space-y-4"
                >
                  <CyberSectionTitle icon={<Sparkles className="h-4 w-4 text-blue-400" />} title="Pitch" subtitle="2–4 phrases, prêt entretien." />

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Langue</span>
                    <div className="flex bg-slate-950 rounded-lg p-1 border border-white/10">
                      <button
                        type="button"
                        onClick={() => setPitchLang("fr")}
                        className={[
                          "px-3 py-1 rounded-md text-[10px] font-bold transition-all",
                          pitchLang === "fr" ? "bg-white text-slate-900" : "text-slate-500 hover:text-white",
                        ].join(" ")}
                      >
                        FR
                      </button>
                      <button
                        type="button"
                        onClick={() => setPitchLang("en")}
                        className={[
                          "px-3 py-1 rounded-md text-[10px] font-bold transition-all",
                          pitchLang === "en" ? "bg-white text-slate-900" : "text-slate-500 hover:text-white",
                        ].join(" ")}
                      >
                        EN
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleGeneratePitch}
                      disabled={pitchLoading || !profile}
                      className="h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {pitchLoading ? <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Générer
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyPitch}
                      disabled={!pitchText}
                      className="h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 font-extrabold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Copy className="h-4 w-4" />
                      {pitchCopied ? "Copié" : "Copier"}
                    </button>
                  </div>

                  {pitchError ? <CyberCallout kind="error">{pitchError}</CyberCallout> : null}
                </motion.div>
              )}

              {viewMode === "mail" && (
                <motion.div
                  key="mail"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="space-y-4"
                >
                  <CyberSectionTitle icon={<Mail className="h-4 w-4 text-blue-400" />} title="Mail" subtitle="Objet + corps à copier." />

                  <CyberInput label="Entreprise" value={companyName} onChange={setCompanyName} placeholder="Ex: IMOGATE" />
                  <CyberInput label="Poste" value={jobTitle} onChange={setJobTitle} placeholder="Ex: Ingénieur Réseaux & Sécurité" />
                  <CyberInput label="Recruteur (optionnel)" value={recruiterName} onChange={setRecruiterName} placeholder="Ex: Mme Dupont" />

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Ton</label>
                    <select
                      className="w-full mt-1 bg-slate-950/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-blue-500/50 outline-none"
                      value={emailTone}
                      onChange={(e) => setEmailTone(e.target.value as any)}
                    >
                      <option value="standard">Standard</option>
                      <option value="pro">Très pro</option>
                      <option value="court">Court</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={(e: any) => handleGenerateEmail(e)}
                      className="h-10 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2 transition-all"
                    >
                      <Send className="h-4 w-4" />
                      Générer
                    </button>

                    <button
                      type="button"
                      onClick={copyEmailAll}
                      disabled={!subjectPreview || !emailPreview}
                      className="h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 font-extrabold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Copy className="h-4 w-4" />
                      {emailCopied ? "Copié" : "Copier"}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CyberCard>
        </motion.aside>

        {/* RIGHT / PREVIEW */}
        <motion.main
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={[
            "bg-slate-900/30 rounded-3xl border border-white/5 p-3 lg:p-4 relative overflow-hidden flex flex-col min-h-0",
            mobilePane === "config" ? "hidden lg:flex" : "",
          ].join(" ")}
        >
          <AnimatePresence mode="wait" initial={false}>
            {viewMode === "cv_lm" && (
              <motion.div
                key="out_cv_lm"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col h-full min-h-0 gap-3"
              >
                <div className="flex items-center justify-between bg-slate-950/70 p-2.5 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-2 px-2 min-w-0">
                    <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider truncate">Aperçu PDF</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={prepareCvPreview}
                      disabled={cvLoading || !profile}
                      className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
                      title="Régénérer aperçu CV"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={downloadCvLm}
                      disabled={cvLoading || !profile}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-bold text-white shadow-lg transition-colors disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      CV+LM
                    </button>
                  </div>
                </div>

                {globalLoadingMessage ? (
                  <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4">
                    <div className="relative">
                      <div className="h-20 w-20 rounded-full border-4 border-blue-500/20 border-t-blue-500 animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Sparkles className="h-7 w-7 text-blue-400 animate-pulse" />
                      </div>
                    </div>
                    <div className="text-center space-y-1">
                      <h2 className="text-[16px] font-bold text-white tracking-tight">{globalLoadingMessage}</h2>
                      <p className="text-[12px] text-slate-500">Préparation…</p>
                    </div>
                  </div>
                ) : cvLmPreviewUrl || cvPreviewUrl ? (
                  <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border border-white/10 bg-white">
                    <PdfCanvasViewer fileUrl={cvLmPreviewUrl || cvPreviewUrl} className="h-full" />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center opacity-50">
                    <ArrowRight className="h-12 w-12 text-slate-600 mb-3" />
                    <h3 className="text-[16px] font-bold text-white">Génère un aperçu</h3>
                    <p className="text-[12px] text-slate-400 max-w-md mx-auto mt-1">Prépare un aperçu (CV ou CV+LM). Tu verras le rendu ici, sans toolbar Chrome.</p>
                  </div>
                )}
              </motion.div>
            )}

            {viewMode === "pitch" && (
              <motion.div
                key="out_pitch"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col h-full min-h-0 gap-3"
              >
                <div className="flex items-center justify-between bg-slate-950/70 p-2.5 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-2 px-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Pitch</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyPitch}
                    disabled={!pitchText}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold text-slate-200 transition-colors disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {pitchCopied ? "Copié" : "Copier"}
                  </button>
                </div>

                <div className="flex-1 min-h-0 bg-slate-950 border border-white/10 rounded-2xl p-4 text-[13px] leading-relaxed text-slate-300 custom-scrollbar overflow-auto">
                  {pitchLoading ? (
                    <div className="h-full flex items-center justify-center gap-3 text-slate-400">
                      <span className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                      Génération…
                    </div>
                  ) : pitchText ? (
                    <pre className="whitespace-pre-wrap font-sans">{pitchText}</pre>
                  ) : (
                    <div className="h-full flex items-center justify-center text-slate-500">Génère un pitch pour l’afficher ici.</div>
                  )}
                </div>
              </motion.div>
            )}

            {viewMode === "mail" && (
              <motion.div
                key="out_mail"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
                className="flex flex-col h-full min-h-0 gap-3"
              >
                <div className="flex items-center justify-between bg-slate-950/70 p-2.5 rounded-2xl border border-white/10">
                  <div className="flex items-center gap-2 px-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Mail</span>
                  </div>
                  <button
                    type="button"
                    onClick={copyEmailAll}
                    disabled={!subjectPreview || !emailPreview}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-bold text-white shadow-lg transition-colors disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {emailCopied ? "Copié" : "Copier"}
                  </button>
                </div>

                <div className="grid lg:grid-cols-2 gap-3 flex-1 min-h-0">
                  <div className="bg-slate-950 border border-white/10 rounded-2xl p-4 overflow-auto custom-scrollbar">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Objet</p>
                    <div className="mt-2 text-[13px] text-slate-200 whitespace-pre-line">{subjectPreview || "Génère un mail pour voir l’objet."}</div>
                  </div>

                  <div className="bg-slate-950 border border-white/10 rounded-2xl p-4 overflow-auto custom-scrollbar">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Corps</p>
                    <div className="mt-2 text-[13px] text-slate-200 whitespace-pre-line">{emailPreview || "Génère un mail pour voir le corps."}</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.main>
      </div>

      {/* ===========================
          MODALS
          =========================== */}
      <FullScreenModal
        open={cvEditorOpen}
        title="Éditeur CV — plein écran"
        onClose={() => setCvEditorOpen(false)}
        actions={
          <>
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={loadCvDraft} disabled={!userId}>
              Charger
            </button>
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={saveCvDraft} disabled={!userId || !cvDraft}>
              Enregistrer
            </button>
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={clearCvDraft} disabled={!userId}>
              Oublier
            </button>
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={prepareCvPreview} disabled={cvLoading}>
              Régénérer
            </button>
            <button type="button" className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={downloadCv}>
              Télécharger
            </button>
          </>
        }
      >
        <div className="h-full min-h-0">
          <div className="lg:hidden p-2 border-b border-[var(--border)] bg-[var(--bg-soft)] flex gap-2">
            <button type="button" className={`btn-secondary flex-1 !py-2 ${cvMobileView === "edit" ? "!border-[var(--brand)]" : ""}`} onClick={() => setCvMobileView("edit")}>
              Éditer
            </button>
            <button
              type="button"
              className={`btn-secondary flex-1 !py-2 ${cvMobileView === "preview" ? "!border-[var(--brand)]" : ""}`}
              onClick={() => setCvMobileView("preview")}
            >
              Aperçu
            </button>
          </div>

          <div className="h-[calc(100%-48px)] lg:h-full grid grid-cols-1 lg:grid-cols-2 min-h-0">
            <div
              className={`${cvMobileView === "preview" ? "hidden" : ""} lg:block min-h-0 overflow-auto p-3 sm:p-4 border-b lg:border-b-0 lg:border-r border-[var(--border)] custom-scrollbar`}
            >
              {!cvDraft ? (
                <p className="text-[11px] text-[var(--muted)]">Charge ton profil CV IA pour éditer.</p>
              ) : (
                <div className="space-y-3">
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

            <div className={`${cvMobileView === "edit" ? "hidden" : ""} lg:block min-h-0 bg-white border-t lg:border-t-0 lg:border-l border-[var(--border)]`}>
              <PdfCanvasViewer fileUrl={cvPreviewUrl} />
            </div>
          </div>
        </div>
      </FullScreenModal>

      <FullScreenModal
        open={lmEditorOpen}
        title="Éditeur Lettre de motivation — plein écran"
        onClose={() => setLmEditorOpen(false)}
        actions={
          <>
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={() => prepareLmPreview({ ensureText: true })} disabled={lmPdfLoading}>
              Régénérer
            </button>
            <button type="button" className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={downloadLm}>
              Télécharger
            </button>
          </>
        }
      >
        <div className="h-full grid grid-cols-1 lg:grid-cols-2 min-h-0">
          <div className="min-h-0 overflow-auto p-3 sm:p-4 border-b lg:border-b-0 lg:border-r border-[var(--border)] custom-scrollbar">
            <div className="space-y-2">
              <p className="text-[11px] text-[var(--muted)]">Édite le texte → l’aperçu se met à jour automatiquement.</p>
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
                <button type="button" className="btn-primary" onClick={downloadLm}>
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

      <FullScreenModal
        open={cvLmViewerOpen}
        title="Aperçu CV + LM — plein écran (2 pages)"
        onClose={() => setCvLmViewerOpen(false)}
        actions={
          <>
            <button type="button" className="btn-secondary !py-1.5 !px-3 text-[12px]" onClick={prepareCvLmPreview} disabled={cvLoading}>
              Régénérer
            </button>
            <button type="button" className="btn-primary !py-1.5 !px-3 text-[12px]" onClick={downloadCvLm}>
              Télécharger
            </button>
          </>
        }
      >
        <div className="h-full min-h-0">
          <PdfCanvasViewer fileUrl={cvLmPreviewUrl} className="h-full" />
        </div>
      </FullScreenModal>

      {/* Templates modal */}
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

            <div className="p-3 sm:p-4 max-h-[70vh] overflow-auto custom-scrollbar">
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
                      className={`text-left rounded-2xl border p-2 bg-[var(--bg-soft)] transition ${
                        active ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20" : "border-[var(--border)] hover:border-[var(--brand)]/50"
                      }`}
                    >
                      <img src={t.previewSrc} alt={t.label} className="w-full h-[140px] object-cover rounded-xl border border-[var(--border)] bg-white" loading="lazy" />
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
    </div>
  );
}
