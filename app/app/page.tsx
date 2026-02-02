"use client";

import React, { useEffect, useMemo, useRef, useState, ChangeEvent, FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Chart from "chart.js/auto";

// Firebase
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, collection, query, where, onSnapshot } from "firebase/firestore";

// Contexts / services
import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { consumeCredits } from "@/lib/credits";
import { logUsage } from "@/lib/userTracking";
import { getRecaptchaToken } from "@/lib/recaptcha";

// Icons
import {
  Zap,
  FileText,
  Mail,
  Phone,
  Linkedin,
  MapPin,
  Briefcase,
  Car,
  BadgeCheck,
  Languages,
  Sparkles,
  Upload,
  ChevronRight,
  Info,
  PencilLine,
  X,
  Plus,
  Trash2,
  Save,
  Download,
  ArrowUp,
  ArrowDown,
  ShieldCheck,
  Cpu,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

// ✅ Proxy Next.js
const WORKER_URL = "/api/extractProfile";

/* =========================
   TYPES
========================= */
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

type DashboardCounts = { totalApps: number; cvCount: number; lmCount: number };

type ActiveModal = "infos" | "skills" | "experience" | "education" | "languages" | "hobbies" | null;

type ExperienceDraft = { company: string; role: string; dates: string; bulletsText: string; location?: string };
type EducationDraft = { school: string; degree: string; dates: string; location: string };
type LanguageDraft = { language: string; level: string };

/* =========================
   CONSTANTES / OPTIONS
========================= */
const LANGUAGE_OPTIONS = [
  "Français",
  "Anglais",
  "Espagnol",
  "Allemand",
  "Italien",
  "Portugais",
  "Néerlandais",
  "Arabe",
  "Russe",
  "Chinois (Mandarin)",
  "Japonais",
  "Coréen",
  "Hindi",
  "Turc",
];

const LANGUAGE_LEVEL_OPTIONS = [
  "Natif / Bilingue (C2)",
  "Courant (C1)",
  "Intermédiaire (B2)",
  "Opérationnel (B1)",
  "Débutant (A2 - A1)",
];

const CONTRACT_TYPE_OPTIONS = ["CDI", "CDD", "Intérim", "Alternance", "Stage", "Freelance", "Temps plein", "Temps partiel"];

const CERTIFICATION_OPTIONS = [
  "TOEIC",
  "TOEFL",
  "IELTS",
  "CCNA",
  "CCNP",
  "CompTIA Security+",
  "CompTIA Network+",
  "AWS Cloud Practitioner",
  "AWS Solutions Architect Associate",
  "Azure AZ-900",
  "Azure AZ-104",
  "Azure AZ-500",
  "Azure SC-900",
  "Azure MS-900",
  "Google Cloud Digital Leader",
  "PMI PMP",
  "Prince2 Foundation",
  "Prince2 Practitioner",
  "ITIL Foundation",
  "CFA Niveau 1",
  "AMF",
  "Tosa Excel",
];

const HOBBY_OPTIONS = [
  "Voyage",
  "Lecture",
  "Musique",
  "Piano",
  "Guitare",
  "Sport (Football)",
  "Sport (Basketball)",
  "Fitness / Musculation",
  "Course à pied",
  "Randonnée",
  "Natation",
  "Cinéma",
  "Séries",
  "Jeux vidéo",
  "Photographie",
  "Cuisine",
  "Pâtisserie",
  "Dessin",
  "Peinture",
  "Art digital",
  "Bénévolat",
  "Entrepreneuriat",
  "Technologie / veille tech",
  "Échecs",
  "Podcasts",
];

/* =========================
   HELPERS UI / TEXT
========================= */
function getInitials(name?: string) {
  if (!name) return "IA";
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return "IA";
  if (parts.length === 1) return (parts[0][0] || "I").toUpperCase();
  return (((parts[0][0] || "I") + (parts[parts.length - 1][0] || "A")).toUpperCase()).slice(0, 2);
}

function formatUpdatedAt(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function normalizeText(str: string): string {
  return (str || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getFlagEmoji(langPart: string): string {
  if (!langPart) return "🌐";
  const lower = langPart.toLowerCase();
  let base = lower.replace(/\(.*?\)/g, " ").trim();

  const levelWords = [
    "natif",
    "bilingue",
    "courant",
    "intermédiaire",
    "intermediaire",
    "débutant",
    "debutant",
    "langue maternelle",
    "maternelle",
    "c1",
    "c2",
    "b1",
    "b2",
    "a1",
    "a2",
  ];

  levelWords.forEach((w) => {
    base = base.replace(new RegExp("\\b" + w + "\\b", "g"), " ");
  });

  base = base.trim() || lower;

  if (base.match(/\bfrançais\b|\bfrancais\b|\bfrench\b/)) return "🇫🇷";
  if (base.match(/\banglais\b|\benglish\b/)) return "🇬🇧";
  if (base.match(/\bamericain\b|\bétats-unis\b|\busa\b|\bamerican\b/)) return "🇺🇸";
  if (base.match(/\bespagnol\b|\bspanish\b/)) return "🇪🇸";
  if (base.match(/\ballemand\b|\bgerman\b/)) return "🇩🇪";
  if (base.match(/\bitalien\b|\bitalian\b/)) return "🇮🇹";
  if (base.match(/\bportugais\b|\bportuguese\b/)) return "🇵🇹";
  if (base.match(/\bnéerlandais\b|\bdutch\b/)) return "🇳🇱";
  if (base.match(/\barabe\b|\barabic\b/)) return "🇸🇦";
  if (base.match(/\bchinois\b|\bmandarin\b|\bchinese\b/)) return "🇨🇳";
  if (base.match(/\brusse\b|\brussian\b/)) return "🇷🇺";
  if (base.match(/\bjaponais\b|\bjapanese\b/)) return "🇯🇵";
  if (base.match(/\bcoréen\b|\bcoreen\b|\bkorean\b/)) return "🇰🇷";
  if (base.match(/\bhindi\b/)) return "🇮🇳";
  if (base.match(/\bturc\b|\bturkish\b/)) return "🇹🇷";

  return "🌐";
}

function parseLangLine(langLine: string): { flag: string; text: string }[] {
  if (!langLine) return [];
  const parts = langLine
    .split("·")
    .join("|")
    .split(",")
    .join("|")
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  return parts.map((part) => ({ flag: getFlagEmoji(part), text: part }));
}

function getHobbyEmoji(hobby: string): string {
  const p = hobby.toLowerCase();
  if (p.includes("football") || p.includes("foot")) return "⚽";
  if (p.includes("basket")) return "🏀";
  if (p.includes("sport") || p.includes("fitness") || p.includes("gym")) return "💪";
  if (p.includes("musique") || p.includes("guitare") || p.includes("piano")) return "🎵";
  if (p.includes("lecture") || p.includes("livre")) return "📚";
  if (p.includes("cinéma") || p.includes("cinema") || p.includes("film")) return "🎬";
  if (p.includes("jeu") || p.includes("gaming")) return "🎮";
  if (p.includes("voyage") || p.includes("travel")) return "✈️";
  if (p.includes("cuisine") || p.includes("cooking")) return "🍳";
  if (p.includes("photo")) return "📸";
  if (p.includes("dessin") || p.includes("peinture") || p.includes("art")) return "🎨";
  if (p.includes("randonnée") || p.includes("rando") || p.includes("hiking")) return "🥾";
  return "⭐";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (!base64) reject(new Error("Encodage base64 invalide."));
      else resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================
   RADAR (multi-domaines)
========================= */
type RadarAxisDef = { id: string; label: string; keywords: string[] };

const DOMAIN_AXES: RadarAxisDef[] = [
  { id: "finance", label: "Finance & Contrôle", keywords: ["finance", "audit", "ifrs", "budget", "reporting", "tresorerie", "trésorerie", "controle de gestion", "contrôle de gestion"] },
  { id: "it_dev", label: "IT & Développement", keywords: ["react", "next", "typescript", "javascript", "python", "api", "node", "git", "docker", "kubernetes", "devops"] },
  { id: "cyber", label: "Cybersécurité & Réseaux", keywords: ["cyber", "pentest", "soc", "siem", "owasp", "vpn", "firewall", "nmap", "kali", "wireshark"] },
  { id: "data", label: "Data & Analytics", keywords: ["data", "sql", "power bi", "tableau", "pandas", "numpy", "machine learning", "ia", "analyse de données"] },
  { id: "marketing", label: "Marketing & Communication", keywords: ["seo", "sea", "community", "social media", "branding", "campagne", "communication"] },
  { id: "sales", label: "Commerce & Vente", keywords: ["commercial", "vente", "prospection", "negociation", "pipeline", "account manager", "business developer", "b2b"] },
  { id: "hr", label: "RH & Recrutement", keywords: ["rh", "recrutement", "talent acquisition", "paie", "gestion du personnel", "onboarding"] },
  { id: "project", label: "Gestion de projet", keywords: ["chef de projet", "agile", "scrum", "kanban", "roadmap", "planning", "pilotage"] },
];

const SOFT_SKILLS_KEYWORDS = [
  "communication",
  "travail en equipe",
  "collaboration",
  "autonomie",
  "rigoureux",
  "organise",
  "adaptabilite",
  "gestion du stress",
  "leadership",
  "esprit d analyse",
  "empathie",
  "relationnel",
];

function countHits(keywords: string[], text: string): number {
  let hits = 0;
  for (const k of keywords) if (text.includes(normalizeText(k))) hits++;
  return hits;
}

function scaleScore(hits: number): number {
  if (hits <= 0) return 3;
  if (hits === 1) return 5;
  if (hits === 2) return 7;
  if (hits === 3) return 9;
  return 10;
}

function buildRadarData(profile: CvProfile | null) {
  const defaultLabels = ["Analyse", "Organisation", "Outils", "Apprentissage", "Soft skills"];
  if (!profile) return { labels: defaultLabels, data: [3, 3, 3, 3, 3] };

  const rawText =
    JSON.stringify(profile.skills?.sections || []) +
    JSON.stringify(profile.skills?.tools || []) +
    JSON.stringify(profile.experiences || []) +
    JSON.stringify(profile.education || []) +
    (profile.profileSummary || "") +
    (profile.certs || "") +
    (profile.langLine || "");

  const lower = normalizeText(rawText);

  // Si domaines fournis, on les privilégie ; sinon top 4 par hits.
  const ids = new Set<string>();
  if (profile.primaryDomain) ids.add(profile.primaryDomain);
  (profile.secondaryDomains || []).forEach((d) => d && ids.add(d));

  let relevant = Array.from(ids)
    .map((id) => DOMAIN_AXES.find((a) => a.id === id))
    .filter(Boolean) as RadarAxisDef[];

  if (!relevant.length) {
    relevant = DOMAIN_AXES
      .map((axis) => ({ axis, hits: countHits(axis.keywords, lower) }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 4)
      .map((x) => x.axis);
  }

  const softHits = countHits(SOFT_SKILLS_KEYWORDS, lower) + Math.min(4, Math.floor((profile.softSkills?.length || 0) / 2));
  const softScore = scaleScore(softHits);

  if (!relevant.length) {
    const generic = [
      scaleScore(countHits(["analyse", "diagnostic"], lower)),
      scaleScore(countHits(["processus", "organisation"], lower)),
      scaleScore(countHits(["outil", "logiciel", "technique"], lower)),
      scaleScore(countHits(["apprentissage", "formation", "veille"], lower)),
    ];
    return { labels: defaultLabels, data: [...generic, softScore] };
  }

  const labels = relevant.map((r) => r.label).concat("Soft skills");
  const data = relevant.map((r) => scaleScore(countHits(r.keywords, lower))).concat(softScore);

  return { labels, data };
}

/* =========================
   NAV
========================= */
type NavItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const navItems: NavItem[] = [
  { id: "infos-personnelles", label: "Dashboard", icon: Cpu },
  { id: "competences", label: "Expertise", icon: Sparkles },
  { id: "experience", label: "Expériences", icon: Briefcase },
  { id: "formation", label: "Formations", icon: BadgeCheck },
  { id: "langues", label: "Langues", icon: Languages },
  { id: "hobbies", label: "Loisirs", icon: Sparkles },
];

/* =========================
   UI ATOMS
========================= */
function KpiItem({ label, value, sub, icon: Icon, color }: any) {
  return (
    <div className="p-5 rounded-[1.5rem] bg-slate-900/50 border border-white/5 backdrop-blur-md">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg bg-white/5 ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-mono font-bold text-white">{value}</p>
      <p className="text-[10px] text-slate-600 mt-1 uppercase font-bold tracking-tighter">{sub}</p>
    </div>
  );
}

function SectionWrapper({ id, title, icon: Icon, children, onEdit }: any) {
  return (
    <section id={id} className="p-8 rounded-[2rem] bg-slate-900/40 border border-white/5 relative group">
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-blue-600/10 border border-blue-600/20">
            <Icon className="h-6 w-6 text-blue-500" />
          </div>
          <h3 className="text-2xl font-black text-white tracking-tighter italic">{title}</h3>
        </div>
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-2 rounded-xl bg-white/5 border border-white/10 opacity-0 group-hover:opacity-100 transition-all text-blue-400 hover:bg-blue-600 hover:text-white"
          >
            <PencilLine className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-12 border-2 border-dashed border-white/5 rounded-3xl text-center">
      <p className="text-sm text-slate-600 italic font-mono uppercase tracking-widest">{text}</p>
    </div>
  );
}

function Toast({ text, tone = "info" }: { text: string; tone?: "info" | "success" | "error" }) {
  const toneCls =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-50"
      : tone === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-50"
      : "border-blue-500/30 bg-blue-500/10 text-blue-50";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[200] px-4 py-3 rounded-2xl border ${toneCls} backdrop-blur-xl shadow-xl`}
    >
      <div className="flex items-center gap-2 text-sm">
        {tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : tone === "error" ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
        <span className="font-medium">{text}</span>
      </div>
    </motion.div>
  );
}

/* =========================
   PAGE
========================= */
export default function FullProfilCVIAPageMerged() {
  const { user } = useAuth();
  const { profile: accountProfile, loading: loadingAccountProfile } = useUserProfile();
  const remainingCredits = accountProfile?.credits ?? 0;
  const isBlocked = accountProfile?.blocked === true;

  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [loadingProfileFromDb, setLoadingProfileFromDb] = useState(true);

  const [dashboardCounts, setDashboardCounts] = useState<DashboardCounts>({ totalApps: 0, cvCount: 0, lmCount: 0 });
  const [loadingCounts, setLoadingCounts] = useState(true);

  // Upload states
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI
  const [activeSection, setActiveSection] = useState<string>("infos-personnelles");
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  // Toast
  const [toast, setToast] = useState<{ text: string; tone?: "info" | "success" | "error" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = (text: string, tone: "info" | "success" | "error" = "info") => {
    setToast({ text, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  // Radar
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // ====== Modals drafts ======
  const [infosDraft, setInfosDraft] = useState({
    fullName: "",
    email: "",
    phone: "",
    linkedin: "",
    contractType: "",
    profileSummary: "",
    drivingLicense: "",
    vehicle: "",
    address: "",
  });

  const [skillsSectionsText, setSkillsSectionsText] = useState("");
  const [skillsToolsText, setSkillsToolsText] = useState("");

  const [experiencesDraft, setExperiencesDraft] = useState<ExperienceDraft[]>([]);
  const [educationDrafts, setEducationDrafts] = useState<EducationDraft[]>([]);
  const [certsList, setCertsList] = useState<string[]>([]);
  const [certInput, setCertInput] = useState("");

  const [languagesDraft, setLanguagesDraft] = useState<LanguageDraft[]>([]);
  const [hobbiesList, setHobbiesList] = useState<string[]>([]);
  const [hobbyInput, setHobbyInput] = useState("");

  // ====== scroll spy (IntersectionObserver) ======
  useEffect(() => {
    const ids = navItems.map((n) => n.id);
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0))[0];
        if (best?.target?.id) setActiveSection(best.target.id);
      },
      { threshold: [0.2, 0.35, 0.5], rootMargin: "-20% 0px -65% 0px" }
    );

    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // ====== Load auth + profile realtime + applications stats realtime ======
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let unsubApps: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (unsubProfile) unsubProfile();
      if (unsubApps) unsubApps();

      if (!fbUser) {
        setProfile(null);
        setLoadingProfileFromDb(false);
        setDashboardCounts({ totalApps: 0, cvCount: 0, lmCount: 0 });
        setLoadingCounts(false);
        return;
      }

      // Profil realtime
      setLoadingProfileFromDb(true);
      const ref = doc(db, "profiles", fbUser.uid);
      unsubProfile = onSnapshot(
        ref,
        (snap) => {
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
          setLoadingProfileFromDb(false);
        },
        () => setLoadingProfileFromDb(false)
      );

      // Apps stats realtime
      setLoadingCounts(true);
      const q = query(collection(db, "applications"), where("userId", "==", fbUser.uid));
      unsubApps = onSnapshot(
        q,
        (snap) => {
          let totalApps = 0;
          let cvCount = 0;
          let lmCount = 0;
          snap.docs.forEach((d) => {
            const data = d.data() as any;
            totalApps++;
            if (data.hasCv) cvCount++;
            if (data.hasLm) lmCount++;
          });
          setDashboardCounts({ totalApps, cvCount, lmCount });
          setLoadingCounts(false);
        },
        () => setLoadingCounts(false)
      );
    });

    return () => {
      if (unsubProfile) unsubProfile();
      if (unsubApps) unsubApps();
      unsubAuth();
    };
  }, []);

  // ====== Save helpers ======
  const saveProfileToDb = async (p: CvProfile) => {
    if (!user) return;
    const ref = doc(db, "profiles", user.uid);
    await setDoc(ref, { ...p, ownerUid: user.uid, ownerEmail: user.email ?? null, updatedAt: Date.now() }, { merge: true });
  };

  // ====== Radar chart render ======
  useEffect(() => {
    if (!radarCanvasRef.current) return;

    const ctx = radarCanvasRef.current.getContext("2d");
    if (!ctx) return;

    const existing = Chart.getChart(radarCanvasRef.current as any);
    if (existing) existing.destroy();

    const { labels, data } = buildRadarData(profile);

    const chart = new Chart(ctx, {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "Niveau estimé",
            data,
            backgroundColor: "rgba(59, 130, 246, 0.18)",
            borderColor: "rgba(59, 130, 246, 0.85)",
            borderWidth: 2,
            pointBackgroundColor: "rgba(59, 130, 246, 1)",
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
        scales: {
          r: {
            beginAtZero: true,
            min: 0,
            max: 10,
            ticks: { stepSize: 2, showLabelBackdrop: false, display: false },
            grid: { color: "rgba(255, 255, 255, 0.08)" },
            angleLines: { color: "rgba(255, 255, 255, 0.08)" },
            pointLabels: { font: { size: 11 }, color: "rgba(226, 232, 240, 0.7)" },
          },
        },
        plugins: { legend: { display: false } },
      },
    });

    return () => chart.destroy();
  }, [profile]);

  // ====== Upload handlers ======
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.includes("pdf")) {
      setError("Merci d'importer un CV au format PDF.");
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return setError("Choisis d'abord un CV au format PDF.");
    if (!user) return setError("Tu dois être connecté pour analyser ton CV.");
    if (loadingAccountProfile) return setError("Ton profil utilisateur charge, réessaie dans un instant.");
    if (isBlocked) return setError("Ton compte est bloqué. Contacte l'administrateur.");

    const cost = 1;
    if (remainingCredits < cost) return setError("Tu n'as plus assez de crédits pour analyser un CV.");

    setError(null);
    setUploading(true);

    try {
      await logUsage(user, "cv_analyze", { fileName: file.name, fileSize: file.size, feature: "cv-profile-merged" });

      const base64Pdf = await fileToBase64(file);
      const idToken = await user.getIdToken();
      const recaptchaToken = await getRecaptchaToken("extract_profile");

      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
          "X-Recaptcha-Token": recaptchaToken,
        },
        body: JSON.stringify({
          base64Pdf,
          meta: { fileName: file.name, fileSize: file.size, feature: "cv-profile-merged" },
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      // ✅ On consomme le crédit après un OK
      await consumeCredits(user.uid, cost);

      const now = Date.now();
      const rawProfile = json?.profile ?? json;

      const receivedProfile: CvProfile = {
        fullName: rawProfile.fullName || "",
        email: rawProfile.email || user.email || "",
        phone: rawProfile.phone || "",
        linkedin: rawProfile.linkedin || "",
        profileSummary: rawProfile.profileSummary || "",
        city: rawProfile.city || "",
        address: rawProfile.address || "",
        contractType: rawProfile.contractType || rawProfile.contractTypeStandard || "",
        contractTypeStandard: rawProfile.contractTypeStandard || "",
        contractTypeFull: rawProfile.contractTypeFull || "",
        primaryDomain: rawProfile.primaryDomain || "",
        secondaryDomains: Array.isArray(rawProfile.secondaryDomains) ? rawProfile.secondaryDomains : [],
        softSkills: Array.isArray(rawProfile.softSkills) ? rawProfile.softSkills : [],
        drivingLicense: rawProfile.drivingLicense || "",
        vehicle: rawProfile.vehicle || "",
        skills: {
          sections: Array.isArray(rawProfile.skills?.sections) ? rawProfile.skills.sections : [],
          tools: Array.isArray(rawProfile.skills?.tools) ? rawProfile.skills.tools : [],
        },
        experiences: Array.isArray(rawProfile.experiences) ? rawProfile.experiences : [],
        education: Array.isArray(rawProfile.education) ? rawProfile.education : [],
        educationShort: Array.isArray(rawProfile.educationShort) ? rawProfile.educationShort : [],
        certs: rawProfile.certs || "",
        langLine: rawProfile.langLine || "",
        hobbies: Array.isArray(rawProfile.hobbies) ? rawProfile.hobbies : [],
        updatedAt: now,
      };

      setProfile(receivedProfile);
      await saveProfileToDb(receivedProfile);
      showToast("CV analysé et profil mis à jour ✅", "success");
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Impossible d'analyser ton CV pour le moment.");
      showToast("Erreur d'analyse du CV", "error");
    } finally {
      setUploading(false);
    }
  };

  /* =========================
     NOUVEAU : Profil Strength + Checklist
  ========================= */
  const profileStrength = useMemo(() => {
    if (!profile) return { score: 0, filled: 0, total: 10 };

    const checks = [
      !!profile.fullName?.trim(),
      !!(profile.email || user?.email)?.trim(),
      !!profile.phone?.trim(),
      !!profile.linkedin?.trim(),
      !!profile.profileSummary?.trim(),
      !!profile.contractType?.trim(),
      (profile.skills?.sections?.length || 0) > 0 || (profile.skills?.tools?.length || 0) > 0,
      (profile.experiences?.length || 0) > 0,
      (profile.education?.length || 0) > 0 || !!profile.certs?.trim(),
      !!profile.langLine?.trim(),
    ];

    const filled = checks.filter(Boolean).length;
    const total = checks.length;
    const score = Math.round((filled / total) * 100);
    return { score, filled, total };
  }, [profile, user?.email]);

  const checklist = useMemo(() => {
    if (!profile) {
      return [
        { label: "Analyser ton CV", modal: null as ActiveModal, action: "upload" as const },
      ];
    }

    const items: { label: string; modal: ActiveModal; ok: boolean }[] = [
      { label: "Compléter tes infos (email/tel/LinkedIn)", modal: "infos", ok: !!(profile.email && profile.phone && profile.linkedin) },
      { label: "Ajouter un résumé de profil", modal: "infos", ok: !!profile.profileSummary?.trim() },
      { label: "Renseigner tes compétences & outils", modal: "skills", ok: (profile.skills?.sections?.length || 0) > 0 || (profile.skills?.tools?.length || 0) > 0 },
      { label: "Ajouter au moins une expérience", modal: "experience", ok: (profile.experiences?.length || 0) > 0 },
      { label: "Ajouter formation / certifs", modal: "education", ok: (profile.education?.length || 0) > 0 || !!profile.certs?.trim() },
      { label: "Ajouter tes langues", modal: "languages", ok: !!profile.langLine?.trim() },
      { label: "Ajouter tes loisirs", modal: "hobbies", ok: (profile.hobbies?.length || 0) > 0 },
    ];

    return items;
  }, [profile]);

  /* =========================
     MODAL OPENERS
  ========================= */
  const openInfosModal = () => {
    if (!profile) return;
    setInfosDraft({
      fullName: profile.fullName || "",
      email: profile.email || user?.email || "",
      phone: profile.phone || "",
      linkedin: profile.linkedin || "",
      contractType: profile.contractType || profile.contractTypeStandard || "",
      profileSummary: profile.profileSummary || "",
      drivingLicense: profile.drivingLicense || "",
      vehicle: profile.vehicle || "",
      address: profile.address || profile.city || "",
    });
    setActiveModal("infos");
  };

  const openSkillsModal = () => {
    if (!profile) return;
    const sectionsText = (profile.skills.sections || [])
      .map((sec) => `${sec.title}: ${sec.items.join(", ")}`)
      .join("\n");
    const toolsText = (profile.skills.tools || []).join(", ");
    setSkillsSectionsText(sectionsText);
    setSkillsToolsText(toolsText);
    setActiveModal("skills");
  };

  const openExperienceModal = () => {
    if (!profile) return;
    const drafts: ExperienceDraft[] =
      profile.experiences?.map((exp) => ({
        company: exp.company || "",
        role: exp.role || "",
        dates: exp.dates || "",
        bulletsText: (exp.bullets || []).join("\n"),
        location: exp.location || "",
      })) || [];
    if (drafts.length === 0) drafts.push({ company: "", role: "", dates: "", bulletsText: "" });
    setExperiencesDraft(drafts);
    setActiveModal("experience");
  };

  const openEducationModal = () => {
    if (!profile) return;
    const drafts: EducationDraft[] =
      Array.isArray(profile.education) && profile.education.length > 0
        ? profile.education.map((edu) => ({
            school: edu.school || "",
            degree: edu.degree || "",
            dates: edu.dates || "",
            location: (edu.location || "") as string,
          }))
        : [{ school: "", degree: "", dates: "", location: "" }];

    setEducationDrafts(drafts);

    const list =
      profile.certs
        ?.split(/[,\n]/)
        .map((c) => c.trim())
        .filter(Boolean) || [];

    setCertsList(list);
    setCertInput("");
    setActiveModal("education");
  };

  const openLanguagesModal = () => {
    if (!profile) return;
    const parsed = parseLangLine(profile.langLine || "");
    let drafts: LanguageDraft[] = [];

    if (parsed.length > 0) {
      drafts = parsed.map((p) => {
        const txt = p.text;
        const match = txt.match(/^(.*?)\s*\((.*)\)$/);
        if (match) return { language: match[1].trim(), level: match[2].trim() };
        return { language: txt, level: "" };
      });
    }

    if (drafts.length === 0) drafts = [{ language: "", level: "" }];
    setLanguagesDraft(drafts);
    setActiveModal("languages");
  };

  const openHobbiesModal = () => {
    if (!profile) return;
    setHobbiesList(profile.hobbies || []);
    setHobbyInput("");
    setActiveModal("hobbies");
  };

  /* =========================
     REORDER (NEW)
  ========================= */
  const moveItem = <T,>(arr: T[], from: number, to: number) => {
    const copy = [...arr];
    const item = copy.splice(from, 1)[0];
    copy.splice(to, 0, item);
    return copy;
  };

  /* =========================
     MODAL SAVE
  ========================= */
  const handleModalSave = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!profile || !activeModal) {
      setActiveModal(null);
      return;
    }

    let updated: CvProfile = { ...profile };

    if (activeModal === "infos") {
      updated = {
        ...profile,
        fullName: infosDraft.fullName.trim(),
        email: infosDraft.email.trim(),
        phone: infosDraft.phone.trim(),
        linkedin: infosDraft.linkedin.trim(),
        contractType: infosDraft.contractType.trim(),
        profileSummary: infosDraft.profileSummary.trim(),
        drivingLicense: infosDraft.drivingLicense.trim(),
        vehicle: infosDraft.vehicle.trim(),
        address: infosDraft.address.trim(),
        city: infosDraft.address.trim().split(",")[0].trim() || profile.city || "",
      };
    }

    if (activeModal === "skills") {
      const sections: CvSkillsSection[] = skillsSectionsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [titlePart, itemsPart] = line.split(":");
          const title = (titlePart || "Compétences").trim();
          const items = itemsPart
            ? itemsPart.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
          return { title, items };
        });

      const tools = skillsToolsText.split(",").map((t) => t.trim()).filter(Boolean);
      updated = { ...profile, skills: { sections, tools } };
    }

    if (activeModal === "experience") {
      const experiences: CvExperience[] = experiencesDraft
        .map((d) => ({
          company: d.company.trim(),
          role: d.role.trim(),
          dates: d.dates.trim(),
          location: (d.location || "").trim(),
          bullets: d.bulletsText.split("\n").map((b) => b.trim()).filter(Boolean),
        }))
        .filter((exp) => exp.company || exp.role || exp.dates || exp.bullets.length > 0);

      updated = { ...profile, experiences };
    }

    if (activeModal === "education") {
      const education: CvEducation[] = educationDrafts
        .map((d) => ({
          school: d.school.trim(),
          degree: d.degree.trim(),
          dates: d.dates.trim(),
          location: d.location.trim(),
        }))
        .filter((ed) => ed.school || ed.degree || ed.dates || (ed.location ?? "").length);

      const educationShort = education.map((ed) => {
        const parts: string[] = [];
        if (ed.dates) parts.push(ed.dates);

        let main = "";
        if (ed.degree && ed.school) main = `${ed.degree} – ${ed.school}`;
        else if (ed.degree) main = ed.degree;
        else if (ed.school) main = ed.school;

        if (main) parts.push(main);
        if (ed.location) {
          if (parts.length > 1) parts[parts.length - 1] = `${parts[parts.length - 1]} (${ed.location})`;
          else parts.push(`(${ed.location})`);
        }
        return parts.join(" · ");
      });

      updated = { ...profile, education, educationShort, certs: certsList.join(", ") };
    }

    if (activeModal === "languages") {
      const cleaned = languagesDraft
        .map((l) => ({ language: l.language.trim(), level: l.level.trim() }))
        .filter((l) => l.language.length > 0);

      const langLine = cleaned.map((l) => (l.level ? `${l.language} (${l.level})` : `${l.language}`)).join(" · ");
      updated = { ...profile, langLine };
    }

    if (activeModal === "hobbies") {
      updated = { ...profile, hobbies: hobbiesList.map((h) => h.trim()).filter(Boolean) };
    }

    setProfile(updated);
    await saveProfileToDb(updated);
    setActiveModal(null);
    showToast("Modifications sauvegardées ✅", "success");
  };

  const updatedLabel =
    profile?.updatedAt ? `Profil mis à jour le ${formatUpdatedAt(profile.updatedAt)}` : profile ? "Profil non encore enregistré" : "";

  const langDisplay = parseLangLine(profile?.langLine || "");

  // Export
  const handleExport = () => {
    if (!profile) return;
    downloadJson(`profil-${(profile.fullName || "candidat").replace(/\s+/g, "-").toLowerCase()}.json`, profile);
    showToast("Export JSON prêt ✅", "success");
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-300 font-sans">
      {/* MOBILE TOPBAR */}
      <div className="lg:hidden sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-white/5 p-4 flex justify-between items-center">
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <Cpu className="h-5 w-5 text-blue-500" /> Profil IA
        </h1>
        <div className="flex items-center gap-2 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
          <Zap className="h-3 w-3 text-yellow-400" />
          <span className="text-xs font-mono font-bold text-white">{loadingAccountProfile ? "…" : remainingCredits}</span>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:flex gap-8">
        {/* SIDEBAR */}
        <aside className="hidden lg:block w-64 shrink-0">
          <div className="sticky top-8 space-y-6">
            <div className="p-6 rounded-3xl bg-gradient-to-b from-slate-900 to-slate-950 border border-white/5 shadow-2xl">
              <div className="h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center text-2xl font-bold text-white mb-4 shadow-lg shadow-blue-900/40">
                {getInitials(profile?.fullName || user?.email || "")}
              </div>
              <h2 className="text-white font-bold text-lg truncate">{profile?.fullName || "Utilisateur"}</h2>
              <p className="text-xs text-slate-500 font-mono mt-1 uppercase tracking-tighter">
                Status: {user ? "Connecté" : "Invité"} {loadingProfileFromDb ? "· Sync..." : ""}
              </p>

              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Profile Strength</span>
                  <span className="text-white font-bold">{profileStrength.score}%</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white/5 overflow-hidden border border-white/5">
                  <div className="h-full bg-blue-500" style={{ width: `${profileStrength.score}%` }} />
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  {profileStrength.filled}/{profileStrength.total} éléments complétés · {updatedLabel}
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleExport}
                  disabled={!profile}
                  className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  Export
                </button>
                <button
                  onClick={() => openInfosModal()}
                  disabled={!profile}
                  className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white border border-blue-500/30 disabled:opacity-50"
                >
                  Edit
                </button>
              </div>
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`flex items-center justify-between px-4 py-3 rounded-2xl transition-all duration-200 group ${
                    activeSection === item.id
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                      : "text-slate-500 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm font-semibold">{item.label}</span>
                  </div>
                  <ChevronRight className={`h-3 w-3 transition-transform ${activeSection === item.id ? "rotate-90" : "group-hover:translate-x-1"}`} />
                </a>
              ))}
            </nav>

            {/* NEW: Checklist */}
            <div className="p-4 rounded-2xl bg-slate-900/30 border border-white/5">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">À compléter</span>
              </div>

              <div className="space-y-2">
                {checklist.map((it: any, idx: number) => {
                  if (it.action === "upload") {
                    return (
                      <button
                        key={idx}
                        onClick={() => document.getElementById("file-input-hidden")?.click()}
                        className="w-full text-left px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-xs text-slate-200"
                      >
                        • {it.label}
                      </button>
                    );
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => it.ok ? null : setActiveModal(it.modal)}
                      className={`w-full text-left px-3 py-2 rounded-xl border text-xs ${
                        it.ok
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-100"
                          : "bg-white/5 border-white/10 hover:bg-white/10 text-slate-200"
                      }`}
                      title={it.ok ? "OK" : "Cliquer pour compléter"}
                    >
                      {it.ok ? "✓" : "•"} {it.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/30 border border-white/5">
              <div className="flex items-center gap-3 mb-3">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Confidentialité</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Données chiffrées · utilisées pour optimiser tes candidatures via IA.
              </p>
            </div>
          </div>
        </aside>

        {/* MAIN */}
        <main className="flex-1 space-y-8">
          {/* KPI ROW */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiItem label="Crédits IA" value={loadingAccountProfile ? "…" : remainingCredits} sub="Disponibles" icon={Zap} color="text-yellow-400" />
            <KpiItem label="CV générés" value={loadingCounts ? "…" : dashboardCounts.cvCount} sub="Depuis candidatures" icon={FileText} color="text-blue-400" />
            <KpiItem label="Force Profil" value={`${profileStrength.score}%`} sub="Score global" icon={Sparkles} color="text-purple-400" />
            <KpiItem label="Candidatures" value={loadingCounts ? "…" : dashboardCounts.totalApps} sub="Suivies" icon={Briefcase} color="text-emerald-400" />
          </section>

          {/* HERO + RADAR */}
          <section id="infos-personnelles" className="grid lg:grid-cols-[1fr,350px] gap-6">
            <motion.div
              className="p-8 rounded-[2rem] bg-slate-900/50 border border-white/10 shadow-2xl relative overflow-hidden"
              whileHover={{ borderColor: "rgba(59, 130, 246, 0.3)" }}
            >
              <div className="relative z-10">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-3xl font-black text-white tracking-tighter">
                      {profile?.fullName || "Configure ton identité"}
                    </h3>
                    <p className="text-blue-400 font-mono text-sm mt-2 uppercase tracking-widest flex items-center gap-2">
                      <Cpu className="h-4 w-4" /> {profile?.contractType || "Recherche active"}
                    </p>
                    <p className="mt-2 text-xs text-slate-500 font-mono">
                      {loadingProfileFromDb ? "Synchronisation..." : updatedLabel}
                    </p>
                  </div>

                  <button
                    onClick={openInfosModal}
                    disabled={!profile}
                    className="p-3 rounded-2xl bg-white/5 hover:bg-blue-600 hover:text-white transition-all border border-white/10 disabled:opacity-50"
                  >
                    <PencilLine className="h-5 w-5" />
                  </button>
                </div>

                <p className="mt-6 text-slate-400 text-sm leading-relaxed max-w-2xl line-clamp-3">
                  {profile?.profileSummary || "Importe ton CV PDF pour générer ton profil IA automatiquement."}
                </p>

                <div className="mt-10 flex flex-wrap gap-4 items-center">
                  <div className="flex-1 min-w-[240px]">
                    <label className="flex items-center gap-4 p-4 rounded-2xl border-2 border-dashed border-white/10 hover:border-blue-500/50 hover:bg-blue-500/5 transition-all cursor-pointer group">
                      <input
                        id="file-input-hidden"
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      <div className="p-2 rounded-lg bg-white/5 group-hover:bg-blue-500 group-hover:text-white transition-colors">
                        <Upload className="h-5 w-5" />
                      </div>
                      <span className="text-sm font-semibold truncate">
                        {file ? file.name : "Glisser / choisir ton CV (PDF)"}
                      </span>
                    </label>
                  </div>

                  <button
                    onClick={handleUpload}
                    disabled={!file || uploading || loadingAccountProfile || isBlocked || remainingCredits <= 0}
                    className="h-14 px-8 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg shadow-blue-900/40 transition-all disabled:opacity-50 flex items-center gap-3"
                  >
                    {uploading ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                        <Cpu className="h-5 w-5" />
                      </motion.div>
                    ) : (
                      <Zap className="h-5 w-5" />
                    )}
                    {uploading ? "Analyse..." : isBlocked ? "Compte bloqué" : remainingCredits <= 0 ? "Plus de crédits" : "Analyser l'Expertise"}
                  </button>
                </div>

                {error && (
                  <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                    {error}
                  </div>
                )}
              </div>
              <div className="absolute -right-20 -top-20 h-64 w-64 bg-blue-600/10 rounded-full blur-[100px]" />
            </motion.div>

            <div className="p-8 rounded-[2rem] bg-slate-900 border border-white/5 flex flex-col items-center">
              <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-8 flex items-center gap-2">
                <Sparkles className="h-3 w-3" /> Skill_Matrix.v3
              </h4>
              <div className="w-full h-64">
                <canvas ref={radarCanvasRef} />
              </div>
              <div className="mt-8 grid grid-cols-2 gap-2 w-full">
                <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Profil</p>
                  <p className="text-white font-mono font-bold">{profileStrength.score}%</p>
                </div>
                <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-center">
                  <p className="text-[10px] text-slate-500 uppercase font-bold">Crédits</p>
                  <p className="text-white font-mono font-bold">{loadingAccountProfile ? "…" : remainingCredits}</p>
                </div>
              </div>
            </div>
          </section>

          {/* INFOS KEY */}
          <SectionWrapper id="infos" title="Informations clés" icon={Info} onEdit={openInfosModal}>
            {profile ? (
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <InfoRow icon={Mail} label="Email" value={profile.email || user?.email || "—"} />
                <InfoRow icon={Phone} label="Téléphone" value={profile.phone || "—"} />
                <InfoRow icon={Linkedin} label="LinkedIn" value={profile.linkedin || "—"} />
                <InfoRow icon={MapPin} label="Adresse" value={profile.address || profile.city || "—"} />
                <InfoRow icon={Briefcase} label="Contrat" value={profile.contractType || "—"} />
                <InfoRow
                  icon={Car}
                  label="Permis / Véhicule"
                  value={`${profile.drivingLicense || "—"}${profile.vehicle ? ` · ${profile.vehicle}` : ""}`}
                />
              </div>
            ) : (
              <EmptyState text={loadingProfileFromDb ? "Chargement du profil..." : "Aucun profil. Analyse un CV pour commencer."} />
            )}
          </SectionWrapper>

          {/* EXPERIENCE */}
          <SectionWrapper id="experience" title="Parcours Professionnel" icon={Briefcase} onEdit={openExperienceModal}>
            <div className="space-y-4">
              {profile?.experiences?.length ? (
                profile.experiences.map((exp, i) => (
                  <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-blue-500/30 transition-all relative">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-white font-bold text-lg">{exp.role || "Poste"}</h4>
                        <p className="text-blue-400 font-semibold">{exp.company || "Entreprise"}</p>
                        {exp.location && <p className="text-xs text-slate-500 mt-1">{exp.location}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-slate-800 px-3 py-1 rounded-full h-fit border border-white/10 uppercase">
                          {exp.dates || "—"}
                        </span>
                      </div>
                    </div>

                    {!!exp.bullets?.length && (
                      <ul className="mt-4 space-y-2">
                        {exp.bullets.map((b, j) => (
                          <li key={j} className="text-sm text-slate-400 flex items-start gap-3">
                            <div className="h-1.5 w-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              ) : (
                <EmptyState text="Aucune expérience ajoutée." />
              )}
            </div>
          </SectionWrapper>

          {/* SKILLS + LANGUAGES */}
          <div className="grid md:grid-cols-2 gap-6">
            <SectionWrapper id="competences" title="Expertise" icon={Sparkles} onEdit={openSkillsModal}>
              {profile?.skills ? (
                <div className="space-y-6">
                  {!!profile.skills.sections?.length && (
                    <div className="space-y-5">
                      {profile.skills.sections.map((sec, i) => (
                        <div key={i} className="space-y-3">
                          <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest">{sec.title}</p>
                          <div className="flex flex-wrap gap-2">
                            {sec.items.map((item, j) => (
                              <span key={j} className="px-3 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs font-medium text-blue-300">
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!profile.skills.tools?.length && (
                    <div className="pt-4 border-t border-white/5">
                      <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-3">Outils</p>
                      <div className="flex flex-wrap gap-2">
                        {profile.skills.tools.map((tool, idx) => (
                          <span key={idx} className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-medium text-slate-300">
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState text="Aucune compétence renseignée." />
              )}
            </SectionWrapper>

            <SectionWrapper id="langues" title="Langues & Communication" icon={Languages} onEdit={openLanguagesModal}>
              <div className="grid gap-4">
                {langDisplay.length ? (
                  langDisplay.map((lang, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5">
                      <div className="flex items-center gap-4">
                        <span className="text-2xl">{lang.flag}</span>
                        <span className="font-bold text-white">{lang.text}</span>
                      </div>
                      <BadgeCheck className="h-5 w-5 text-blue-500" />
                    </div>
                  ))
                ) : (
                  <EmptyState text="Aucune langue renseignée." />
                )}
              </div>
            </SectionWrapper>
          </div>

          {/* FORMATION */}
          <SectionWrapper id="formation" title="Formations & Certifications" icon={BadgeCheck} onEdit={openEducationModal}>
            {profile ? (
              <div className="space-y-6">
                {profile.educationShort?.length ? (
                  <div className="space-y-2">
                    {profile.educationShort.map((l, idx) => (
                      <div key={idx} className="p-4 rounded-2xl bg-white/5 border border-white/5 text-sm text-slate-300">
                        {l}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState text="Aucune formation renseignée." />
                )}

                {profile.certs?.trim() ? (
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                    <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-2">Certifications</p>
                    <p className="text-sm text-slate-200">{profile.certs}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState text="Aucun profil chargé." />
            )}
          </SectionWrapper>

          {/* HOBBIES */}
          <SectionWrapper id="hobbies" title="Loisirs & Centres d'intérêt" icon={Sparkles} onEdit={openHobbiesModal}>
            {profile?.hobbies?.length ? (
              <div className="flex flex-wrap gap-2">
                {profile.hobbies.map((h) => (
                  <span key={h} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-slate-200">
                    <span>{getHobbyEmoji(h)}</span>
                    <span>{h}</span>
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState text="Aucun loisir renseigné." />
            )}
          </SectionWrapper>
        </main>
      </div>

      {/* MODAL ENGINE */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl"
              onClick={() => setActiveModal(null)}
            />
            <motion.form
              onSubmit={handleModalSave}
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-3xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-white/5 flex justify-between items-center bg-slate-900">
                <div>
                  <h3 className="text-2xl font-bold text-white tracking-tighter capitalize flex items-center gap-3">
                    <PencilLine className="h-6 w-6 text-blue-500" />
                    {activeModal === "infos" && "Modifier informations"}
                    {activeModal === "skills" && "Modifier compétences"}
                    {activeModal === "experience" && "Modifier expériences"}
                    {activeModal === "education" && "Modifier formation"}
                    {activeModal === "languages" && "Modifier langues"}
                    {activeModal === "hobbies" && "Modifier loisirs"}
                  </h3>
                  <p className="text-xs text-slate-500 uppercase font-mono mt-1">Section_Update // {activeModal}</p>
                </div>
                <button type="button" onClick={() => setActiveModal(null)} className="p-2 hover:bg-white/5 rounded-full">
                  <X />
                </button>
              </div>

              <div className="p-8 overflow-y-auto custom-scrollbar space-y-6">
                {/* INFOS */}
                {activeModal === "infos" && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field label="Nom complet">
                        <input className={inputCls} value={infosDraft.fullName} onChange={(e) => setInfosDraft((p) => ({ ...p, fullName: e.target.value }))} />
                      </Field>
                      <Field label="Email">
                        <input className={inputCls} value={infosDraft.email} onChange={(e) => setInfosDraft((p) => ({ ...p, email: e.target.value }))} />
                      </Field>
                      <Field label="Téléphone">
                        <input className={inputCls} value={infosDraft.phone} onChange={(e) => setInfosDraft((p) => ({ ...p, phone: e.target.value }))} />
                      </Field>
                      <Field label="LinkedIn">
                        <input className={inputCls} value={infosDraft.linkedin} onChange={(e) => setInfosDraft((p) => ({ ...p, linkedin: e.target.value }))} />
                      </Field>
                      <Field label="Contrat recherché">
                        <input list="contract-type-options" className={inputCls} value={infosDraft.contractType} onChange={(e) => setInfosDraft((p) => ({ ...p, contractType: e.target.value }))} />
                        <datalist id="contract-type-options">
                          {CONTRACT_TYPE_OPTIONS.map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                      </Field>
                      <Field label="Adresse">
                        <input className={inputCls} placeholder="Ex : 12 rue Exemple, 75000 Paris" value={infosDraft.address} onChange={(e) => setInfosDraft((p) => ({ ...p, address: e.target.value }))} />
                      </Field>
                      <Field label="Permis">
                        <input className={inputCls} placeholder="Ex : Permis B" value={infosDraft.drivingLicense} onChange={(e) => setInfosDraft((p) => ({ ...p, drivingLicense: e.target.value }))} />
                      </Field>
                      <Field label="Véhicule">
                        <input className={inputCls} placeholder="Ex : Véhiculé" value={infosDraft.vehicle} onChange={(e) => setInfosDraft((p) => ({ ...p, vehicle: e.target.value }))} />
                      </Field>
                    </div>

                    <Field label="Résumé de profil">
                      <textarea rows={5} className={textareaCls} value={infosDraft.profileSummary} onChange={(e) => setInfosDraft((p) => ({ ...p, profileSummary: e.target.value }))} />
                    </Field>
                  </div>
                )}

                {/* SKILLS */}
                {activeModal === "skills" && (
                  <div className="space-y-6">
                    <Field label="Sections (1 ligne = 1 section) · Format : Titre: item1, item2">
                      <textarea rows={6} className={textareaCls} value={skillsSectionsText} onChange={(e) => setSkillsSectionsText(e.target.value)} placeholder={"Ex:\nIT: React, Next.js, TypeScript\nCloud: AWS, Azure"} />
                    </Field>
                    <Field label="Outils / logiciels (virgules)">
                      <textarea rows={3} className={textareaCls} value={skillsToolsText} onChange={(e) => setSkillsToolsText(e.target.value)} placeholder="VS Code, Docker, Jira..." />
                    </Field>
                  </div>
                )}

                {/* EXPERIENCE (NEW: reorder) */}
                {activeModal === "experience" && (
                  <div className="space-y-4">
                    {experiencesDraft.map((exp, idx) => (
                      <div key={idx} className="p-5 rounded-[2rem] bg-white/5 border border-white/10 relative space-y-4">
                        <div className="absolute top-4 right-4 flex gap-2">
                          <button
                            type="button"
                            onClick={() => idx > 0 && setExperiencesDraft((p) => moveItem(p, idx, idx - 1))}
                            className="p-2 rounded-full hover:bg-white/5 text-slate-300"
                            title="Monter"
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => idx < experiencesDraft.length - 1 && setExperiencesDraft((p) => moveItem(p, idx, idx + 1))}
                            className="p-2 rounded-full hover:bg-white/5 text-slate-300"
                            title="Descendre"
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExperiencesDraft((p) => p.filter((_, i) => i !== idx))}
                            className="p-2 rounded-full hover:bg-red-500/10 text-red-300"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <Field label="Entreprise">
                            <input className={inputCls} value={exp.company} onChange={(e) => setExperiencesDraft((p) => p.map((x, i) => (i === idx ? { ...x, company: e.target.value } : x)))} />
                          </Field>
                          <Field label="Poste">
                            <input className={inputCls} value={exp.role} onChange={(e) => setExperiencesDraft((p) => p.map((x, i) => (i === idx ? { ...x, role: e.target.value } : x)))} />
                          </Field>
                          <Field label="Dates">
                            <input className={inputCls} placeholder="Ex : 2022 - Présent" value={exp.dates} onChange={(e) => setExperiencesDraft((p) => p.map((x, i) => (i === idx ? { ...x, dates: e.target.value } : x)))} />
                          </Field>
                          <Field label="Lieu (optionnel)">
                            <input className={inputCls} placeholder="Paris, FR" value={exp.location || ""} onChange={(e) => setExperiencesDraft((p) => p.map((x, i) => (i === idx ? { ...x, location: e.target.value } : x)))} />
                          </Field>
                        </div>

                        <Field label="Missions (1 par ligne)">
                          <textarea rows={4} className={textareaCls} value={exp.bulletsText} onChange={(e) => setExperiencesDraft((p) => p.map((x, i) => (i === idx ? { ...x, bulletsText: e.target.value } : x)))} />
                        </Field>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => setExperiencesDraft((p) => [...p, { company: "", role: "", dates: "", bulletsText: "" }])}
                      className="w-full py-4 border-2 border-dashed border-white/10 rounded-2xl text-slate-300 hover:border-blue-500 hover:text-blue-300 font-bold flex items-center justify-center gap-2"
                    >
                      <Plus className="h-5 w-5" /> Ajouter une expérience
                    </button>
                  </div>
                )}

                {/* EDUCATION (NEW: reorder) */}
                {activeModal === "education" && (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      {educationDrafts.map((edu, idx) => (
                        <div key={idx} className="p-5 rounded-[2rem] bg-white/5 border border-white/10 relative space-y-4">
                          <div className="absolute top-4 right-4 flex gap-2">
                            <button
                              type="button"
                              onClick={() => idx > 0 && setEducationDrafts((p) => moveItem(p, idx, idx - 1))}
                              className="p-2 rounded-full hover:bg-white/5 text-slate-300"
                              title="Monter"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => idx < educationDrafts.length - 1 && setEducationDrafts((p) => moveItem(p, idx, idx + 1))}
                              className="p-2 rounded-full hover:bg-white/5 text-slate-300"
                              title="Descendre"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                            {educationDrafts.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setEducationDrafts((p) => p.filter((_, i) => i !== idx))}
                                className="p-2 rounded-full hover:bg-red-500/10 text-red-300"
                                title="Supprimer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="Diplôme">
                              <input className={inputCls} value={edu.degree} onChange={(e) => setEducationDrafts((p) => p.map((x, i) => (i === idx ? { ...x, degree: e.target.value } : x)))} />
                            </Field>
                            <Field label="École">
                              <input className={inputCls} value={edu.school} onChange={(e) => setEducationDrafts((p) => p.map((x, i) => (i === idx ? { ...x, school: e.target.value } : x)))} />
                            </Field>
                            <Field label="Lieu">
                              <input className={inputCls} value={edu.location} onChange={(e) => setEducationDrafts((p) => p.map((x, i) => (i === idx ? { ...x, location: e.target.value } : x)))} />
                            </Field>
                            <Field label="Dates">
                              <input className={inputCls} placeholder="Ex : 2022–2024" value={edu.dates} onChange={(e) => setEducationDrafts((p) => p.map((x, i) => (i === idx ? { ...x, dates: e.target.value } : x)))} />
                            </Field>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setEducationDrafts((p) => [...p, { school: "", degree: "", dates: "", location: "" }])}
                      className="w-full py-4 border-2 border-dashed border-white/10 rounded-2xl text-slate-300 hover:border-blue-500 hover:text-blue-300 font-bold flex items-center justify-center gap-2"
                    >
                      <Plus className="h-5 w-5" /> Ajouter une formation
                    </button>

                    {/* Certifications */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase ml-2">Certifications (auto-complétion)</p>
                      <div className="flex gap-2">
                        <input
                          list="certification-options"
                          className={inputCls}
                          placeholder="Ex : Azure AZ-900..."
                          value={certInput}
                          onChange={(e) => setCertInput(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const val = certInput.trim();
                            if (!val) return;
                            if (!certsList.includes(val)) setCertsList((p) => [...p, val]);
                            setCertInput("");
                          }}
                          className="px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
                        >
                          Ajouter
                        </button>
                        <datalist id="certification-options">
                          {CERTIFICATION_OPTIONS.map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                      </div>

                      {!!certsList.length && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {certsList.map((cert) => (
                            <span key={cert} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs">
                              {cert}
                              <button type="button" onClick={() => setCertsList((p) => p.filter((x) => x !== cert))} className="text-slate-400 hover:text-red-300">
                                ✕
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* LANGUAGES */}
                {activeModal === "languages" && (
                  <div className="space-y-4">
                    {languagesDraft.map((lang, idx) => {
                      const flag = lang.language.trim() ? getFlagEmoji(lang.language) : "🌐";
                      return (
                        <div key={idx} className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-start gap-3">
                          <div className="text-2xl w-10 text-center pt-2">{flag}</div>
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <Field label="Langue">
                              <input
                                list="language-options"
                                className={inputCls}
                                value={lang.language}
                                onChange={(e) => setLanguagesDraft((p) => p.map((x, i) => (i === idx ? { ...x, language: e.target.value } : x)))}
                              />
                            </Field>
                            <Field label="Niveau">
                              <select
                                className={selectCls}
                                value={lang.level}
                                onChange={(e) => setLanguagesDraft((p) => p.map((x, i) => (i === idx ? { ...x, level: e.target.value } : x)))}
                              >
                                <option value="">Sélectionner</option>
                                {LANGUAGE_LEVEL_OPTIONS.map((lvl) => (
                                  <option key={lvl} value={lvl} className="bg-slate-900">
                                    {lvl}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          </div>

                          {languagesDraft.length > 1 && (
                            <button type="button" onClick={() => setLanguagesDraft((p) => p.filter((_, i) => i !== idx))} className="p-2 rounded-full hover:bg-red-500/10 text-red-300">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}

                    <datalist id="language-options">
                      {LANGUAGE_OPTIONS.map((l) => (
                        <option key={l} value={l} />
                      ))}
                    </datalist>

                    <button
                      type="button"
                      onClick={() => setLanguagesDraft((p) => [...p, { language: "", level: "" }])}
                      className="w-full py-4 border-2 border-dashed border-white/10 rounded-2xl text-slate-300 hover:border-blue-500 hover:text-blue-300 font-bold flex items-center justify-center gap-2"
                    >
                      <Plus className="h-5 w-5" /> Ajouter une langue
                    </button>
                  </div>
                )}

                {/* HOBBIES */}
                {activeModal === "hobbies" && (
                  <div className="space-y-3">
                    <Field label="Ajouter un loisir (auto-complétion)">
                      <div className="flex gap-2">
                        <input list="hobby-options" className={inputCls} value={hobbyInput} onChange={(e) => setHobbyInput(e.target.value)} placeholder="Voyage, Lecture..." />
                        <button
                          type="button"
                          onClick={() => {
                            const val = hobbyInput.trim();
                            if (!val) return;
                            if (!hobbiesList.includes(val)) setHobbiesList((p) => [...p, val]);
                            setHobbyInput("");
                          }}
                          className="px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold"
                        >
                          Ajouter
                        </button>
                        <datalist id="hobby-options">
                          {HOBBY_OPTIONS.map((h) => (
                            <option key={h} value={h} />
                          ))}
                        </datalist>
                      </div>
                    </Field>

                    {!!hobbiesList.length ? (
                      <div className="flex flex-wrap gap-2">
                        {hobbiesList.map((h) => (
                          <span key={h} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs">
                            <span>{getHobbyEmoji(h)}</span>
                            <span>{h}</span>
                            <button type="button" onClick={() => setHobbiesList((p) => p.filter((x) => x !== h))} className="text-slate-400 hover:text-red-300">
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <EmptyState text="Aucun loisir ajouté pour le moment." />
                    )}
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-white/5 flex justify-end gap-3 bg-slate-900">
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="px-5 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-200 font-bold hover:bg-white/10"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-5 py-3 rounded-2xl bg-blue-600 border border-blue-500/30 text-white font-bold hover:bg-blue-500 flex items-center gap-2"
                >
                  <Save className="h-5 w-5" /> Enregistrer
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>{toast && <Toast text={toast.text} tone={toast.tone} />}</AnimatePresence>
    </div>
  );
}

/* =========================
   SMALL COMPONENTS
========================= */
function InfoRow({ icon: Icon, label, value }: any) {
  return (
    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center gap-3">
      <div className="p-2 rounded-xl bg-white/5 border border-white/10">
        <Icon className="h-4 w-4 text-slate-300" />
      </div>
      <div className="flex-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
        <p className="text-sm text-white break-all">{value}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-slate-500 uppercase ml-2">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none placeholder:text-slate-500";
const textareaCls =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none resize-none placeholder:text-slate-500";
const selectCls =
  "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none";
