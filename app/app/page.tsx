"use client";

import { useState, useEffect, useRef, ChangeEvent, FormEvent } from "react";
import { motion } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
} from "firebase/firestore";
import Chart from "chart.js/auto";
import { useAuth } from "@/context/AuthContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { consumeCredits } from "@/lib/credits";
import { logUsage } from "@/lib/userTracking";
import { getRecaptchaToken } from "@/lib/recaptcha";

// --- TYPES ---

type CvSkillsSection = {
  title: string;
  items: string[];
};

type CvSkills = {
  sections: CvSkillsSection[];
  tools: string[];
};

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

type DashboardCounts = {
  totalApps: number;
  cvCount: number;
  lmCount: number;
};

// ✅ Appelle le proxy Next.js (pas la Cloud Function en direct)
const WORKER_URL = "/api/extractProfile";

// --- HELPERS GÉNÉRAUX ---

function getInitials(name?: string) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0][0] || "?").toUpperCase();
  return (
    ((parts[0][0] || "") + (parts[parts.length - 1][0] || "")).toUpperCase()
  );
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
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// 🌐 Drapeaux langues (robuste, ignore natif/bilingue/etc.)
function getFlagEmoji(langPart: string): string {
  if (!langPart) return "🌐";

  const lower = langPart.toLowerCase();

  // On enlève ce qu'il y a entre parenthèses (souvent le niveau)
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
    "maternel",
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

  base = base.trim();
  if (!base) base = lower;

  if (base.match(/\bfrançais\b|\bfrancais\b|\bfrench\b/)) return "🇫🇷";
  if (base.match(/\banglais\b|\benglish\b/)) return "🇬🇧";
  if (base.match(/\bamericain\b|\bétats-unis\b|\busa\b|\bamerican\b/))
    return "🇺🇸";

  if (base.match(/\bespagnol\b|\bspanish\b/)) return "🇪🇸";
  if (base.match(/\ballemand\b|\bgerman\b/)) return "🇩🇪";
  if (base.match(/\bitalien\b|\bitalian\b/)) return "🇮🇹";
  if (base.match(/\bportugais\b|\bportuguese\b/)) return "🇵🇹";
  if (base.match(/\bnéerlandais\b|\bneerlandais\b|\bdutch\b/)) return "🇳🇱";

  if (base.match(/\barabe\b|\barabic\b|\barab\b/)) return "🇸🇦";
  if (base.match(/\bchinois\b|\bmandarin\b|\bchinese\b/)) return "🇨🇳";
  if (base.match(/\brusse\b|\brussian\b/)) return "🇷🇺";
  if (base.match(/\bjaponais\b|\bjapanese\b/)) return "🇯🇵";
  if (base.match(/\bcoréen\b|\bcoreen\b|\bkorean\b/)) return "🇰🇷";
  if (base.match(/\bhindi\b|\bhindou\b/)) return "🇮🇳";
  if (base.match(/\bturc\b|\bturkish\b/)) return "🇹🇷";

  return "🌐";
}

// 🌐 Parse le champ langLine en { flag, text }[]
function parseLangLine(langLine: string): { flag: string; text: string }[] {
  if (!langLine) return [];
  const parts = langLine
    .split("·")
    .join("|")
    .split(",")
    .join("|")
    .split("|")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  return parts.map((part) => ({
    flag: getFlagEmoji(part),
    text: part,
  }));
}

// 🎯 Emoji pour les hobbies
function getHobbyEmoji(hobby: string): string {
  const p = hobby.toLowerCase();
  if (p.includes("football") || p.includes("foot")) return "⚽";
  if (p.includes("basket") || p.includes("basketball")) return "🏀";
  if (p.includes("sport") || p.includes("fitness") || p.includes("gym"))
    return "💪";
  if (p.includes("musique") || p.includes("guitare") || p.includes("piano"))
    return "🎵";
  if (p.includes("lecture") || p.includes("livre")) return "📚";
  if (p.includes("cinéma") || p.includes("cinema") || p.includes("film"))
    return "🎬";
  if (p.includes("jeu vidéo") || p.includes("jeux vidéo") || p.includes("gaming"))
    return "🎮";
  if (p.includes("voyage") || p.includes("travel")) return "✈️";
  if (p.includes("cuisine") || p.includes("cooking")) return "🍳";
  if (p.includes("photo") || p.includes("photographie")) return "📸";
  if (p.includes("dessin") || p.includes("peinture") || p.includes("art"))
    return "🎨";
  if (p.includes("randonnée") || p.includes("rando") || p.includes("hiking"))
    return "🥾";
  return "⭐";
}

// --- RADAR GÉNÉRIQUE (multi-métiers, robuste) ---

type RadarAxisDef = {
  id: string;
  label: string;
  keywords: string[];
};

const DOMAIN_AXES: RadarAxisDef[] = [
  {
    id: "finance",
    label: "Finance & Contrôle",
    keywords: [
      "finance",
      "financier",
      "controle de gestion",
      "contrôle de gestion",
      "controle interne",
      "contrôle interne",
      "audit",
      "conformite",
      "conformité",
      "risque",
      "risques",
      "reporting",
      "budget",
      "bilan",
      "comptable",
      "tresorerie",
      "trésorerie",
      "analyse financiere",
      "analyse financière",
      "cfa",
      "ifrs",
    ],
  },
  {
    id: "it_dev",
    label: "IT & Développement",
    keywords: [
      "developpement",
      "développement",
      "javascript",
      "typescript",
      "python",
      "java",
      "c++",
      "c#",
      "php",
      "go",
      "react",
      "node",
      "angular",
      "vue",
      "api",
      "application",
      "fullstack",
      "frontend",
      "backend",
      "devops",
      "git",
      "docker",
      "kubernetes",
    ],
  },
  {
    id: "cyber",
    label: "Cybersécurité & Réseaux",
    keywords: [
      "cyber",
      "cybersecurite",
      "cybersécurité",
      "pentest",
      "penetration test",
      "vulnerabilite",
      "vulnérabilité",
      "soc",
      "firewall",
      "pare feu",
      "pare-feu",
      "vpn",
      "ids",
      "ips",
      "wireshark",
      "nmap",
      "kali",
      "siem",
      "owasp",
    ],
  },
  {
    id: "data",
    label: "Data & Analytics",
    keywords: [
      "data",
      "donnees",
      "données",
      "sql",
      "power bi",
      "tableau",
      "statistique",
      "statistiques",
      "machine learning",
      "intelligence artificielle",
      "ia ",
      "analyse de donnees",
      "analyse de données",
      "data analyst",
      "data engineer",
      "pandas",
      "numpy",
    ],
  },
  {
    id: "marketing",
    label: "Marketing & Communication",
    keywords: [
      "marketing",
      "communication",
      "social media",
      "réseaux sociaux",
      "reseaux sociaux",
      "seo",
      "sea",
      "content",
      "contenu",
      "campagne",
      "publicite",
      "publicité",
      "branding",
      "influence",
      "community manager",
    ],
  },
  {
    id: "sales",
    label: "Commerce & Vente",
    keywords: [
      "commercial",
      "vente",
      "business developer",
      "account manager",
      "prospection",
      "negociation",
      "négociation",
      "pipeline",
      "portefeuille clients",
      "chiffre d affaires",
      "ca ",
      "b2b",
      "b2c",
    ],
  },
  {
    id: "hr",
    label: "RH & Recrutement",
    keywords: [
      "ressources humaines",
      "rh",
      "recrutement",
      "onboarding",
      "formation",
      "gestion du personnel",
      "talent acquisition",
      "people",
      "paie",
      "gestion des talents",
    ],
  },
  {
    id: "project",
    label: "Gestion de projet",
    keywords: [
      "chef de projet",
      "gestion de projet",
      "project manager",
      "planning",
      "pilotage",
      "agile",
      "scrum",
      "kanban",
      "coordination",
      "roadmap",
      "livrable",
      "livrables",
      "planning",
    ],
  },
  {
    id: "ops",
    label: "Opérations & Logistique",
    keywords: [
      "logistique",
      "supply chain",
      "transport",
      "flux",
      "optimisation des processus",
      "lean",
      "maintenance",
      "production",
      "magasinier",
      "preparation de commandes",
      "exploitation",
    ],
  },
  {
    id: "health",
    label: "Santé & Social",
    keywords: [
      "infirmier",
      "infirmière",
      "aide soignant",
      "aide-soignant",
      "medecin",
      "médecin",
      "paramedical",
      "paramédical",
      "social",
      "accompagnement",
      "patients",
      "soins",
      "assistante sociale",
      "assistant social",
      "ehpad",
    ],
  },
  {
    id: "education",
    label: "Éducation & Formation",
    keywords: [
      "enseignant",
      "professeur",
      "formateur",
      "formatrice",
      "pedagogie",
      "pédagogie",
      "cours",
      "formation",
      "apprentissage",
      "eleves",
      "élèves",
      "etudiants",
      "étudiants",
      "éducation",
    ],
  },
];

const DOMAIN_CORE_KEYWORDS: Record<string, string[]> = {
  finance: [
    "comptable",
    "controle de gestion",
    "contrôle de gestion",
    "controle interne",
    "contrôle interne",
    "audit",
    "bilan",
    "compte de resultat",
    "compte de résultat",
    "tresorerie",
    "trésorerie",
    "analyse financiere",
    "analyse financière",
    "cfa",
    "ifrs",
  ],
  it_dev: [
    "developpement",
    "développement",
    "javascript",
    "typescript",
    "python",
    "java",
    "c++",
    "c#",
    "php",
    "react",
    "node",
    "angular",
    "vue",
    "fullstack",
    "frontend",
    "backend",
    "devops",
    "docker",
    "kubernetes",
  ],
  cyber: [
    "pentest",
    "penetration test",
    "wireshark",
    "nmap",
    "kali",
    "ids",
    "ips",
    "soc",
    "siem",
    "owasp",
    "firewall",
    "pare feu",
    "pare-feu",
  ],
  data: [
    "data analyst",
    "data engineer",
    "power bi",
    "tableau",
    "sql",
    "pandas",
    "numpy",
    "machine learning",
    "intelligence artificielle",
  ],
  marketing: [
    "seo",
    "sea",
    "community manager",
    "social media",
    "campagne",
    "branding",
    "communication digitale",
  ],
  sales: [
    "business developer",
    "account manager",
    "commercial",
    "prospection",
    "negociation",
    "négociation",
    "pipeline",
  ],
  hr: [
    "ressources humaines",
    "rh",
    "recrutement",
    "talent acquisition",
    "gestion de la paie",
    "gestion du personnel",
  ],
  project: [
    "chef de projet",
    "project manager",
    "scrum master",
    "agile",
    "gestion de projet",
  ],
  ops: ["supply chain", "logistique", "exploitation", "maintenance", "production"],
  health: ["infirmier", "infirmière", "medecin", "médecin", "aide soignant", "aide-soignant", "soins", "patients"],
  education: ["enseignant", "professeur", "formateur", "formatrice", "pedagogie", "pédagogie", "eleves", "élèves", "etudiants", "étudiants"],
};

const SOFT_SKILLS_KEYWORDS = [
  "communication",
  "travail en equipe",
  "travail en équipe",
  "collaboration",
  "autonome",
  "autonomie",
  "rigoureux",
  "rigoureuse",
  "organise",
  "organisé",
  "organisee",
  "organisée",
  "adaptabilite",
  "adaptabilité",
  "gestion du stress",
  "leadership",
  "esprit d analyse",
  "esprit d'analyse",
  "empathie",
  "relationnel",
];

function countHits(keywords: string[], text: string): number {
  let hits = 0;
  for (const k of keywords) {
    const normK = normalizeText(k);
    if (text.includes(normK)) hits++;
  }
  return hits;
}

function scaleScore(hits: number): number {
  if (hits <= 0) return 3;
  if (hits === 1) return 5;
  if (hits === 2) return 7;
  if (hits === 3) return 9;
  return 10;
}

// 🔎 construit les données du radar à partir du profil (générique multi-métiers)
function buildRadarData(profile: CvProfile | null) {
  const defaultLabels = [
    "Analyse / Résolution",
    "Organisation & Processus",
    "Outils & Tech",
    "Apprentissage",
    "Soft skills",
  ];

  if (!profile) {
    return { labels: defaultLabels, data: [3, 3, 3, 3, 3] };
  }

  const rawText =
    JSON.stringify(profile.skills.sections || "") +
    JSON.stringify(profile.skills.tools || "") +
    JSON.stringify(profile.experiences || "") +
    JSON.stringify(profile.education || "") +
    (profile.profileSummary || "") +
    (profile.contractType || "") +
    (profile.certs || "") +
    (profile.langLine || "");

  const lower = normalizeText(rawText);

  const aiDomainIds: string[] = [];
  if (profile.primaryDomain && profile.primaryDomain !== "autre") {
    aiDomainIds.push(profile.primaryDomain);
  }
  if (Array.isArray(profile.secondaryDomains)) {
    for (const d of profile.secondaryDomains) {
      if (d && d !== "autre" && !aiDomainIds.includes(d)) {
        aiDomainIds.push(d);
      }
    }
  }

  let relevant: {
    axis: RadarAxisDef;
    totalHits: number;
    coreHits: number;
    score: number;
  }[] = [];

  if (aiDomainIds.length > 0) {
    relevant = aiDomainIds
      .map((id) => {
        const axis = DOMAIN_AXES.find((a) => a.id === id);
        if (!axis) return null;

        const totalHits = countHits(axis.keywords, lower);
        const coreKeywords = DOMAIN_CORE_KEYWORDS[axis.id] || axis.keywords;
        const coreHits = countHits(coreKeywords, lower);

        const rawHits = Math.max(totalHits, coreHits);
        const score = scaleScore(rawHits);

        return { axis, totalHits, coreHits, score };
      })
      .filter(
        (
          x
        ): x is {
          axis: RadarAxisDef;
          totalHits: number;
          coreHits: number;
          score: number;
        } => !!x
      );
  } else {
    const domainScores = DOMAIN_AXES.map((axis) => {
      const totalHits = countHits(axis.keywords, lower);
      const coreKeywords = DOMAIN_CORE_KEYWORDS[axis.id] || axis.keywords;
      const coreHits = countHits(coreKeywords, lower);

      const isRelevant = coreHits > 0 && totalHits > 0;
      const score = isRelevant ? scaleScore(totalHits) : 0;

      return { axis, totalHits, coreHits, isRelevant, score };
    });

    relevant = domainScores
      .filter((d) => d.isRelevant)
      .sort((a, b) => b.totalHits - a.totalHits)
      .slice(0, 4) as any;
  }

  let softHits = countHits(SOFT_SKILLS_KEYWORDS, lower);
  const softSkillsCount = Array.isArray(profile.softSkills)
    ? profile.softSkills.length
    : 0;

  if (softSkillsCount > 0) {
    softHits += Math.min(4, Math.floor(softSkillsCount / 2));
  }

  const softScore = scaleScore(softHits);

  if (!relevant.length) {
    const generic = [
      scaleScore(countHits(["analyse", "diagnostic"], lower)),
      scaleScore(countHits(["processus", "organisation"], lower)),
      scaleScore(countHits(["outil", "logiciel", "technique"], lower)),
      scaleScore(countHits(["apprentissage", "formation", "veille"], lower)),
    ];
    return {
      labels: defaultLabels,
      data: [...generic, softScore],
    };
  }

  const labels = relevant.map((r) => r.axis.label).concat("Soft skills");
  const data = relevant.map((r) => r.score).concat(softScore);

  console.debug(
    "[Radar IA] Domaines retenus :",
    relevant.map((r) => ({
      id: r.axis.id,
      label: r.axis.label,
      hits: r.totalHits,
      score: r.score,
    })),
    "SoftSkillsCount:",
    softSkillsCount,
    "SoftScore:",
    softScore
  );

  return { labels, data };
}

// Items pour la navigation rapide
const navItems = [
  { id: "infos-personnelles", label: "Infos & CV" },
  { id: "competences", label: "Compétences & Outils" },
  { id: "experience", label: "Expérience" },
  { id: "formation", label: "Formation & Certifs" },
  { id: "langues", label: "Langues" },
  { id: "hobbies", label: "Centres d'intérêt" },
];

type ActiveModal =
  | "infos"
  | "skills"
  | "experience"
  | "education"
  | "languages"
  | "hobbies"
  | null;

type ExperienceDraft = {
  company: string;
  role: string;
  dates: string;
  bulletsText: string;
};

type EducationDraft = {
  school: string;
  degree: string;
  dates: string;
  location: string;
};

type LanguageDraft = {
  language: string;
  level: string;
};

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

const CONTRACT_TYPE_OPTIONS = [
  "CDI",
  "CDD",
  "Intérim",
  "Alternance",
  "Stage",
  "Freelance",
  "Temps plein",
  "Temps partiel",
  "Indépendant",
  "Contrat pro",
];

// --- COMPOSANT PRINCIPAL ---

export default function DashboardPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);

  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loadingProfileFromDb, setLoadingProfileFromDb] =
    useState<boolean>(true);

  const [dashboardCounts, setDashboardCounts] = useState<DashboardCounts>({
    totalApps: 0,
    cvCount: 0,
    lmCount: 0,
  });
  const [loadingCounts, setLoadingCounts] = useState<boolean>(true);

  // --- ÉTATS MODALES ---

  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

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

  const [experiencesDraft, setExperiencesDraft] = useState<ExperienceDraft[]>(
    []
  );

  const [educationDrafts, setEducationDrafts] = useState<EducationDraft[]>([]);
  const [certsList, setCertsList] = useState<string[]>([]);
  const [certInput, setCertInput] = useState("");

  const [languagesDraft, setLanguagesDraft] = useState<LanguageDraft[]>([]);
  const [hobbiesList, setHobbiesList] = useState<string[]>([]);
  const [hobbyInput, setHobbyInput] = useState("");

  const { user } = useAuth();
  const { profile: accountProfile, loading: loadingAccountProfile } =
    useUserProfile();
  const remainingCredits = accountProfile?.credits ?? 0;
  const isBlocked = accountProfile?.blocked === true;

  // 🔐 Auth + chargement du profil Firestore + stats candidatures
  useEffect(() => {
    let unsubApps: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubApps) {
        unsubApps();
        unsubApps = null;
      }

      if (!user) {
        setUserId(null);
        setUserEmail(null);
        setProfile(null);
        setLoadingProfileFromDb(false);
        setDashboardCounts({ totalApps: 0, cvCount: 0, lmCount: 0 });
        setLoadingCounts(false);
        return;
      }

      setUserId(user.uid);
      setUserEmail(user.email ?? null);

      // --- Chargement du profil
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
            secondaryDomains: Array.isArray(data.secondaryDomains)
              ? data.secondaryDomains
              : [],
            softSkills: Array.isArray(data.softSkills) ? data.softSkills : [],
            drivingLicense: data.drivingLicense || "",
            vehicle: data.vehicle || "",
            skills: {
              sections: Array.isArray(data.skills?.sections)
                ? data.skills.sections
                : [],
              tools: Array.isArray(data.skills?.tools) ? data.skills.tools : [],
            },
            experiences: Array.isArray(data.experiences) ? data.experiences : [],
            education: Array.isArray(data.education) ? data.education : [],
            educationShort: Array.isArray(data.educationShort)
              ? data.educationShort
              : [],
            certs: data.certs || "",
            langLine: data.langLine || "",
            hobbies: Array.isArray(data.hobbies) ? data.hobbies : [],
            updatedAt:
              typeof data.updatedAt === "number" ? data.updatedAt : undefined,
          };

          setProfile(loadedProfile);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error("Erreur chargement profil Firestore:", e);
      } finally {
        setLoadingProfileFromDb(false);
      }

      // --- Stats candidatures
      setLoadingCounts(true);

      const q = query(
        collection(db, "applications"),
        where("userId", "==", user.uid)
      );

      unsubApps = onSnapshot(
        q,
        (snap) => {
          let totalApps = 0;
          let cvCount = 0;
          let lmCount = 0;

          snap.docs.forEach((docSnap) => {
            const data = docSnap.data() as any;
            totalApps++;
            if (data.hasCv) cvCount++;
            if (data.hasLm) lmCount++;
          });

          setDashboardCounts({ totalApps, cvCount, lmCount });
          setLoadingCounts(false);
        },
        (err) => {
          console.error("Erreur chargement stats dashboard:", err);
          setLoadingCounts(false);
        }
      );
    });

    return () => {
      if (unsubApps) unsubApps();
      unsubAuth();
    };
  }, []);

  // 💾 sauvegarde du profil en base (Firestore)
  const saveProfileToDb = async (p: CvProfile) => {
    if (!userId) return;
    const ref = doc(db, "profiles", userId);
    const payload = {
      ...p,
      ownerUid: userId,
      ownerEmail: userEmail ?? null,
      updatedAt: Date.now(),
    };
    await setDoc(ref, payload, { merge: true });
  };

  // 🎯 Radar Chart
  useEffect(() => {
    if (!radarCanvasRef.current || !profile) return;

    const ctx = radarCanvasRef.current.getContext("2d");
    if (!ctx) return;

    const existingChart = Chart.getChart(radarCanvasRef.current as any);
    if (existingChart) {
      existingChart.destroy();
    }

    const { labels, data } = buildRadarData(profile);

    const chartInstance = new Chart(ctx, {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "Niveau estimé",
            data,
            backgroundColor: "rgba(56, 189, 248, 0.25)",
            borderColor: "rgba(56, 189, 248, 0.9)",
            borderWidth: 2,
            pointBackgroundColor: "rgba(56, 189, 248, 1)",
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            min: 0,
            max: 10,
            ticks: {
              stepSize: 2,
              showLabelBackdrop: false,
              display: false,
            },
            grid: {
              color: "rgba(148, 163, 184, 0.35)",
            },
            angleLines: {
              color: "rgba(148, 163, 184, 0.35)",
            },
            pointLabels: {
              font: { size: 11 },
              color: "#e5e7eb",
            },
          },
        },
        plugins: {
          legend: { display: false },
        },
      },
    });

    return () => {
      chartInstance.destroy();
    };
  }, [profile]);

  // --- UPLOAD CV ---

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

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Impossible de lire le fichier."));
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        if (!base64) {
          reject(new Error("Encodage base64 invalide."));
        } else {
          resolve(base64);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleUpload = async () => {
    if (!file) {
      setError("Choisis d'abord un CV au format PDF.");
      return;
    }

    if (!user) {
      setError("Tu dois être connecté pour analyser ton CV.");
      return;
    }

    if (loadingAccountProfile) {
      setError(
        "Ton profil utilisateur est en cours de chargement, réessaie dans un instant."
      );
      return;
    }

    if (isBlocked) {
      setError(
        "Ton compte est bloqué. Contacte l'administrateur pour en savoir plus."
      );
      return;
    }

    const cost = 1; // 💰 coût d'une analyse de CV
    if (remainingCredits < cost) {
      setError(
        "Tu n'as plus assez de crédits pour analyser un CV. Contacte l'administrateur."
      );
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // 1) Consommation des crédits (transaction Firestore)
      await consumeCredits(user.uid, cost);

      // 2) Log d'usage
      await logUsage(user, "cv_analyze", {
        fileName: file.name,
        fileSize: file.size,
        feature: "dashboard-cv-upload",
      });

      // 3) Appel via l'API Next.js (✅ auth + recaptcha)
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
          meta: {
            fileName: file.name,
            fileSize: file.size,
            feature: "dashboard-cv-upload",
          },
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
        if (res.status === 401 || msg === "unauthenticated") {
          throw new Error("unauthenticated");
        }
        throw new Error(msg);
      }

      const now = Date.now();
      const rawProfile = json?.profile ?? json;

      const receivedProfile: CvProfile = {
        fullName: rawProfile.fullName || "",
        email: rawProfile.email || "",
        phone: rawProfile.phone || "",
        linkedin: rawProfile.linkedin || "",
        profileSummary: rawProfile.profileSummary || "",
        city: rawProfile.city || "",
        address: rawProfile.address || "",
        contractType:
          rawProfile.contractType || rawProfile.contractTypeStandard || "",
        contractTypeStandard: rawProfile.contractTypeStandard || "",
        contractTypeFull: rawProfile.contractTypeFull || "",
        primaryDomain: rawProfile.primaryDomain || "",
        secondaryDomains: Array.isArray(rawProfile.secondaryDomains)
          ? rawProfile.secondaryDomains
          : [],
        softSkills: Array.isArray(rawProfile.softSkills)
          ? rawProfile.softSkills
          : [],
        drivingLicense: rawProfile.drivingLicense || "",
        vehicle: rawProfile.vehicle || "",
        skills: {
          sections: Array.isArray(rawProfile.skills?.sections)
            ? rawProfile.skills.sections
            : [],
          tools: Array.isArray(rawProfile.skills?.tools)
            ? rawProfile.skills.tools
            : [],
        },
        experiences: Array.isArray(rawProfile.experiences)
          ? rawProfile.experiences
          : [],
        education: Array.isArray(rawProfile.education)
          ? rawProfile.education
          : [],
        educationShort: Array.isArray(rawProfile.educationShort)
          ? rawProfile.educationShort
          : [],
        certs: rawProfile.certs || "",
        langLine: rawProfile.langLine || "",
        hobbies: Array.isArray(rawProfile.hobbies) ? rawProfile.hobbies : [],
        updatedAt: now,
      };

      setProfile(receivedProfile);

      if (userId) {
        await saveProfileToDb(receivedProfile);
      }
    } catch (err: any) {
      console.error(err);
      if (err instanceof Error) {
        if (err.message === "unauthenticated") {
          setError("Session expirée. Déconnecte-toi / reconnecte-toi puis réessaie.");
        } else if (err.message === "NOT_ENOUGH_CREDITS" || err.message === "NO_CREDITS") {
          setError(
            "Tu n'as plus assez de crédits pour analyser un CV. Contacte l'administrateur."
          );
        } else if (err.message === "USER_BLOCKED") {
          setError(
            "Ton compte est bloqué. Contacte l'administrateur pour en savoir plus."
          );
        } else if (err.message === "USER_DOC_NOT_FOUND") {
          setError(
            "Profil utilisateur introuvable dans la base. Contacte l'administrateur."
          );
        } else {
          setError(err.message || "Impossible d'analyser ton CV pour le moment.");
        }
      } else {
        setError("Impossible d'analyser ton CV pour le moment.");
      }
    } finally {
      setUploading(false);
    }
  };

  // --- MODALES : OUVERTURE ---

  const openInfosModal = () => {
    if (!profile) return;
    setInfosDraft({
      fullName: profile.fullName,
      email: profile.email || userEmail || "",
      phone: profile.phone || "",
      linkedin: profile.linkedin || "",
      contractType:
        profile.contractType || profile.contractTypeStandard || "",
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
      })) || [];

    if (drafts.length === 0) {
      drafts.push({ company: "", role: "", dates: "", bulletsText: "" });
    }

    setExperiencesDraft(drafts);
    setActiveModal("experience");
  };

  const addExperienceDraft = () => {
    setExperiencesDraft((prev) => [
      ...prev,
      { company: "", role: "", dates: "", bulletsText: "" },
    ]);
  };

  const updateExperienceDraft = (
    index: number,
    field: keyof ExperienceDraft,
    value: string
  ) => {
    setExperiencesDraft((prev) =>
      prev.map((exp, i) =>
        i === index
          ? {
              ...exp,
              [field]: value,
            }
          : exp
      )
    );
  };

  const openEducationModal = () => {
    if (!profile) return;

    const drafts: EducationDraft[] =
      Array.isArray(profile.education) && profile.education.length > 0
        ? profile.education.map((edu) => ({
            school: edu.school || "",
            degree: edu.degree || "",
            dates: edu.dates || "",
            location: (edu as any).location || "",
          }))
        : [
            {
              school: "",
              degree: "",
              dates: "",
              location: "",
            },
          ];

    setEducationDrafts(drafts);

    const list =
      profile.certs
        ?.split(/[,\n]/)
        .map((c: string) => c.trim())
        .filter((c: string) => c.length > 0) || [];
    setCertsList(list);
    setCertInput("");

    setActiveModal("education");
  };

  const addEducationDraft = () => {
    setEducationDrafts((prev) => [
      ...prev,
      { school: "", degree: "", dates: "", location: "" },
    ]);
  };

  const updateEducationDraft = (
    index: number,
    field: keyof EducationDraft,
    value: string
  ) => {
    setEducationDrafts((prev) =>
      prev.map((edu, i) =>
        i === index
          ? {
              ...edu,
              [field]: value,
            }
          : edu
      )
    );
  };

  const openLanguagesModal = () => {
    if (!profile) return;

    const parsed = parseLangLine(profile.langLine || "");
    let drafts: LanguageDraft[] = [];

    if (parsed.length > 0) {
      drafts = parsed.map((p) => {
        const txt = p.text;
        const match = txt.match(/^(.*?)\s*\((.*)\)$/);
        if (match) {
          return {
            language: match[1].trim(),
            level: match[2].trim(),
          };
        }
        return {
          language: txt,
          level: "",
        };
      });
    }

    if (drafts.length === 0) {
      drafts = [{ language: "", level: "" }];
    }

    setLanguagesDraft(drafts);
    setActiveModal("languages");
  };

  const openHobbiesModal = () => {
    if (!profile) return;
    setHobbiesList(profile.hobbies || []);
    setHobbyInput("");
    setActiveModal("hobbies");
  };

  // --- MODALES : SAUVEGARDE ---

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
        city:
          infosDraft.address.trim().split(",")[0].trim() ||
          profile.city ||
          "",
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
            ? itemsPart
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [];
          return { title, items };
        });

      const tools = skillsToolsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      updated = {
        ...profile,
        skills: {
          sections,
          tools,
        },
      };
    }

    if (activeModal === "experience") {
      const experiences: CvExperience[] = experiencesDraft
        .map((d) => ({
          company: d.company.trim(),
          role: d.role.trim(),
          dates: d.dates.trim(),
          bullets: d.bulletsText
            .split("\n")
            .map((b) => b.trim())
            .filter(Boolean),
        }))
        .filter(
          (exp) =>
            exp.company || exp.role || exp.dates || exp.bullets.length > 0
        );

      updated = {
        ...profile,
        experiences,
      };
    }

    if (activeModal === "education") {
      const education: CvEducation[] = educationDrafts
        .map((d) => ({
          school: d.school.trim(),
          degree: d.degree.trim(),
          dates: d.dates.trim(),
          location: d.location.trim(),
        }))
        .filter(
          (e) => e.school || e.degree || e.dates || (e.location ?? "").length
        );

      const educationShort = education.map((e) => {
        const parts: string[] = [];
        if (e.dates) parts.push(e.dates);
        let main = "";
        if (e.degree && e.school) main = `${e.degree} – ${e.school}`;
        else if (e.degree) main = e.degree;
        else if (e.school) main = e.school;
        if (main) parts.push(main);
        if (e.location) {
          if (parts.length > 1) {
            parts[parts.length - 1] = `${parts[parts.length - 1]} (${e.location})`;
          } else {
            parts.push(`(${e.location})`);
          }
        }
        return parts.join(" · ");
      });

      const certsJoined = certsList.join(", ");

      updated = {
        ...profile,
        education,
        educationShort,
        certs: certsJoined,
      };
    }

    if (activeModal === "languages") {
      const cleaned = languagesDraft
        .map((l) => ({
          language: l.language.trim(),
          level: l.level.trim(),
        }))
        .filter((l) => l.language.length > 0);

      const langLine = cleaned
        .map((l) => (l.level ? `${l.language} (${l.level})` : `${l.language}`))
        .join(" · ");

      updated = {
        ...profile,
        langLine,
      };
    }

    if (activeModal === "hobbies") {
      const hobbies = hobbiesList
        .map((h) => h.trim())
        .filter((h) => h.length > 0);
      updated = {
        ...profile,
        hobbies,
      };
    }

    setProfile(updated);
    if (userId) {
      await saveProfileToDb(updated);
    }
    setActiveModal(null);
  };

  const handleModalCancel = () => {
    setActiveModal(null);
  };

  const headline =
    profile?.profileSummary?.split(".")[0] ||
    (profile?.contractType
      ? profile.contractType
      : "Profil en cours de configuration");

  const updatedLabel = profile?.updatedAt
    ? `Profil mis à jour le ${formatUpdatedAt(profile.updatedAt)}`
    : "Profil non encore enregistré";

  const langDisplay = parseLangLine(profile?.langLine || "");
  const visibilityLabel = userId ? "Associé à ton compte" : "Invité";

  // --- RENDER ---

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="max-w-6xl mx-auto px-3 sm:px-4 py-5 sm:py-6 space-y-5"
    >
      {/* 1. VUE D'ENSEMBLE + STATS */}
      <section className="space-y-4">
        <div>
          <p className="badge-muted mb-2 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[11px] uppercase tracking-wider text-[var(--muted)]">
              Vue d&apos;ensemble
            </span>
          </p>
          <h1 className="text-xl sm:text-2xl font-semibold">
            Ton tableau de bord de candidatures
          </h1>
          <p className="text-xs sm:text-sm text-[var(--muted)] mt-1 max-w-xl">
            Accède rapidement à ton CV IA et à toutes les infos qui serviront à
            générer ton CV, tes lettres de motivation et ton pitch.
          </p>
        </div>

        {/* STATS CARDS */}
        <div className="grid gap-3 md:grid-cols-4">
          {/* Crédits */}
          <div className="glass p-4 rounded-2xl border border-[var(--border)]/80">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-1">
              Crédits restants
            </p>
            <p className="text-2xl font-semibold">
              {loadingAccountProfile ? "…" : remainingCredits}
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              Utilisés pour analyser ton CV et générer des contenus.
            </p>
          </div>

          {/* CV générés */}
          <div className="glass p-4 rounded-2xl border border-[var(--border)]/80">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-1">
              CV générés
            </p>
            <p className="text-2xl font-semibold">
              {loadingCounts ? "…" : dashboardCounts.cvCount}
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              Nombre de candidatures où un <strong>CV IA</strong> est associé
              (coché ou généré).
            </p>
          </div>

          {/* LM IA générées */}
          <div className="glass p-4 rounded-2xl border border-[var(--border)]/80">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-1">
              LM IA générées
            </p>
            <p className="text-2xl font-semibold">
              {loadingCounts ? "…" : dashboardCounts.lmCount}
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              Nombre de candidatures avec une <strong>lettre IA</strong>{" "}
              associée.
            </p>
          </div>

          {/* Candidatures suivies */}
          <div className="glass p-4 rounded-2xl border border-[var(--border)]/80">
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-1">
              Candidatures suivies
            </p>
            <p className="text-2xl font-semibold">
              {loadingCounts ? "…" : dashboardCounts.totalApps}
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              Total de lignes dans ton{" "}
              <strong>tracker de candidatures</strong>.
            </p>
          </div>
        </div>
      </section>

      {/* 2. HEADER PROFIL + MON CV + RADAR */}
      <header
        id="infos-personnelles"
        className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row gap-4 md:items-stretch"
      >
        {/* Colonne gauche : identité, résumé, CV, infos clés */}
        <div className="flex flex-col flex-1 gap-3">
          {/* Identité */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-[var(--bg-soft)] border border-[var(--border)] text-base sm:text-lg font-semibold">
              {getInitials(profile?.fullName || userEmail || "")}
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h2 className="text-base sm:text-lg font-semibold">
                  {profile?.fullName || "Ton profil candidat"}
                </h2>
                {userEmail && (
                  <span className="rounded-full border border-[var(--border)] px-2 py-[2px] text-[10px] text-[var(--muted)]">
                    Connecté·e en tant que{" "}
                    <span className="font-medium text-[11px] text-white">
                      {userEmail}
                    </span>
                  </span>
                )}
              </div>
              <p className="text-[12px] text-[var(--muted)] line-clamp-2">
                {headline}
              </p>
              {(profile?.address || profile?.city) && (
                <p className="text-[11px] text-[var(--muted)]">
                  {profile.address || profile.city}
                </p>
              )}
              <p className="text-[11px] text-[var(--muted)]">{updatedLabel}</p>
            </div>
          </div>

          {/* Mon CV */}
          <section className="rounded-xl border border-[var(--border)]/80 bg-[var(--bg-soft)] p-3 sm:p-3.5 flex flex-col md:flex-row gap-3 md:items-center">
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-[2px] text-[11px]">
                  Mon CV
                </span>
                <p className="text-[11px] text-[var(--muted)]">
                  {profile
                    ? "Ton CV a été analysé et ton profil est sauvegardé."
                    : "Aucun CV analysé pour le moment."}
                </p>
              </div>
              {loadingProfileFromDb && (
                <p className="text-[11px] text-[var(--muted)]">
                  Chargement de ton profil sauvegardé...
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center md:ml-auto">
              <label className="flex-1 cursor-pointer">
                <div className="w-full rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[12px] text-[var(--muted)] hover:border-[var(--brand)]/80 hover:bg-[var(--bg-soft)] transition-colors">
                  {file ? (
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{file.name}</span>
                      <span className="text-[11px] text-[var(--muted)]">
                        {(file.size / 1024 / 1024).toFixed(2)} Mo
                      </span>
                    </div>
                  ) : (
                    <span>Choisir un CV (PDF)</span>
                  )}
                </div>
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>

              <button
                type="button"
                onClick={handleUpload}
                disabled={
                  uploading ||
                  !file ||
                  loadingAccountProfile ||
                  isBlocked ||
                  remainingCredits <= 0
                }
                className="sm:w-[160px] inline-flex items-center justify-center rounded-lg bg-[var(--brand)] hover:bg-[var(--brandDark)] disabled:opacity-60 disabled:cursor-not-allowed text-[13px] font-medium text-white px-3 py-2 transition-colors"
              >
                {uploading
                  ? "Analyse en cours..."
                  : isBlocked
                  ? "Compte bloqué"
                  : remainingCredits <= 0
                  ? "Plus de crédits"
                  : "Analyser / Mettre à jour"}
              </button>
            </div>
          </section>

          {/* Informations clés */}
          {profile && (
            <div className="rounded-xl border border-[var(--border)]/60 bg-[var(--bg-soft)] p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[var(--muted)] font-medium">
                  Informations clés
                </p>
                <button
                  type="button"
                  onClick={openInfosModal}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                >
                  <span className="text-[13px]">✏️</span>
                  <span>Modifier / ajouter</span>
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 text-[12px]">
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Email</p>
                  <p className="font-medium">
                    {profile.email || userEmail || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Téléphone</p>
                  <p className="font-medium">{profile.phone || "—"}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">LinkedIn</p>
                  <p className="font-medium break-all">
                    {profile.linkedin || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Adresse</p>
                  <p className="font-medium line-clamp-2">
                    {profile.address || profile.city || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Contrat recherché
                  </p>
                  <p className="font-medium line-clamp-2">
                    {profile.contractType || "Non renseigné"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Permis de conduire
                  </p>
                  <p className="font-medium">
                    {profile.drivingLicense || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[var(--muted)]">Véhicule</p>
                  <p className="font-medium">{profile.vehicle || "—"}</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-1 w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-100">
              {error}
            </div>
          )}

          {/* Visibilité */}
          <div className="text-[11px] text-[var(--muted)]">
            Visibilité :{" "}
            <span className="font-medium text-[var(--text)]">
              {visibilityLabel}
            </span>
          </div>
        </div>

        {/* Colonne droite : RADAR */}
        <div className="md:w-[320px] lg:w-[360px] flex-shrink-0">
          <div className="rounded-2xl bg-[var(--bg-soft)] border border-[var(--border)]/80 px-3 py-3 sm:p-4 h-full flex flex-col">
            <p className="text-[11px] text-[var(--muted)] mb-2">
              Radar de compétences estimé
            </p>
            <div className="relative flex-1 min-h-[210px]">
              <canvas
                id="skillsRadarChart"
                ref={radarCanvasRef}
                className="w-full h-full"
              />
            </div>
          </div>
        </div>
      </header>

      {/* 3. CONTENU PRINCIPAL : NAV GAUCHE + SECTIONS */}
      <div className="lg:grid lg:grid-cols-[220px,1fr] gap-4 sm:gap-5">
        {/* Sidebar navigation */}
        <aside className="mb-3 lg:mb-0">
          <motion.nav
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="glass border border-[var(--border)]/80 rounded-2xl py-3 text-[12px] sticky top-20 lg:top-24"
          >
            <p className="px-3 pb-1 text-[11px] text-[var(--muted)]">
              Navigation rapide
            </p>
            <ul className="space-y-0.5">
              {navItems.map((item, idx) => (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + idx * 0.05 }}
                >
                  <a
                    href={`#${item.id}`}
                    className="flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-soft)] text-[12px] rounded-md transition-colors"
                  >
                    <span>{item.label}</span>
                    <motion.span
                      whileHover={{ x: 2 }}
                      className="text-[10px] text-[var(--muted)]"
                    >
                      ↗
                    </motion.span>
                  </a>
                </motion.li>
              ))}
            </ul>
          </motion.nav>
        </aside>

        {/* Main content */}
        <main className="space-y-4 sm:space-y-5">
          {/* Compétences */}
          {profile?.skills && (
            <section
              id="competences"
              className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <h2 className="text-sm sm:text-base font-semibold">
                  Compétences &amp; Outils
                </h2>
                <button
                  type="button"
                  onClick={openSkillsModal}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                >
                  <span className="text-[13px]">✏️</span>
                  <span>Modifier / ajouter</span>
                </button>
              </div>

              {profile.skills.sections?.length > 0 && (
                <div className="space-y-4">
                  {profile.skills.sections.map((section, idx) => (
                    <div key={idx} className="space-y-1">
                      <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                        {section.title}
                      </p>
                      <div className="flex flex-wrap gap-2 text-[12px]">
                        {section.items.map((s, i) => (
                          <span key={i} className="badge">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {profile.skills.tools?.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-[var(--border)]/80">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                    Outils / logiciels
                  </p>
                  <div className="flex flex-wrap gap-2 text-[12px]">
                    {profile.skills.tools.map((tool, idx) => (
                      <span key={idx} className="badge">
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Expérience */}
          {profile?.experiences?.length ? (
            <section
              id="experience"
              className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-sm sm:text-base font-semibold">
                  Expériences principales
                </h2>
                <button
                  type="button"
                  onClick={openExperienceModal}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                >
                  <span className="text-[13px]">✏️</span>
                  <span>Modifier / ajouter</span>
                </button>
              </div>

              <ul className="space-y-3 text-[12px]">
                {profile.experiences.map((exp, idx) => (
                  <li
                    key={idx}
                    className="rounded-lg bg-[var(--bg-soft)] border border-[var(--border)]/70 px-3 py-3"
                  >
                    <p className="font-medium">
                      {exp.role || "Poste"} · {exp.company || "Entreprise"}
                    </p>
                    <p className="text-[11px] text-[var(--muted)]">
                      {exp.dates || ""}
                    </p>
                    {exp.bullets?.length > 0 && (
                      <ul className="mt-1 list-disc list-inside space-y-0.5">
                        {exp.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Formation & certifs */}
          {profile && (profile.educationShort?.length || profile.certs) && (
            <section
              id="formation"
              className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-sm sm:text-base font-semibold">
                  Formation &amp; Certifications
                </h2>
                <button
                  type="button"
                  onClick={openEducationModal}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                >
                  <span className="text-[13px]">✏️</span>
                  <span>Modifier / ajouter</span>
                </button>
              </div>

              {profile?.educationShort?.length ? (
                <div>
                  <ul className="space-y-1.5 text-[12px]">
                    {profile.educationShort.map((line, idx) => (
                      <li key={idx}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {profile?.certs && (
                <div>
                  <p className="text-[11px] text-[var(--muted)] mb-1">
                    Certifications
                  </p>
                  <p className="text-[12px]">{profile.certs}</p>
                </div>
              )}
            </section>
          )}

          {/* Langues */}
          {profile && (
            <section
              id="langues"
              className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <h2 className="text-sm sm:text-base font-semibold">Langues</h2>
                <button
                  type="button"
                  onClick={openLanguagesModal}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                >
                  <span className="text-[13px]">✏️</span>
                  <span>Modifier / ajouter</span>
                </button>
              </div>
              {langDisplay.length > 0 ? (
                <div className="flex flex-wrap gap-x-6 gap-y-3 text-[13px]">
                  {langDisplay.map((lang, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="text-2xl">{lang.flag}</span>
                      <span className="font-medium text-[var(--text)]">
                        {lang.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--muted)]">
                  Aucune langue renseignée pour le moment.
                </p>
              )}
            </section>
          )}

          {/* Hobbies */}
          {profile && (
            <section
              id="hobbies"
              className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-sm sm:text-base font-semibold">
                  Centres d&apos;intérêt
                </h2>
                <button
                  type="button"
                  onClick={openHobbiesModal}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                >
                  <span className="text-[13px]">✏️</span>
                  <span>Modifier / ajouter</span>
                </button>
              </div>
              {profile.hobbies?.length ? (
                <div className="flex flex-wrap gap-2 text-[12px]">
                  {profile.hobbies.map((hobby) => (
                    <span
                      key={hobby}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-[3px]"
                    >
                      <span>{getHobbyEmoji(hobby)}</span>
                      <span>{hobby}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[var(--muted)]">
                  Aucun centre d&apos;intérêt renseigné pour le moment.
                </p>
              )}
            </section>
          )}
        </main>
      </div>

      {/* Message si aucun profil */}
      {!profile && !loadingProfileFromDb && (
        <div className="text-center p-10 glass border border-[var(--border)]/80 rounded-2xl">
          <h3 className="text-lg font-semibold mb-2">
            Aucun profil enregistré ou analysé
          </h3>
          <p className="text-[13px] text-[var(--muted)]">
            Veuille uploader un CV PDF dans le header ci-dessus pour initialiser
            ton profil candidat IA.
          </p>
        </div>
      )}

      {/* --- MODALE GÉNÉRIQUE D'ÉDITION --- */}
      {activeModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-3">
          <motion.form
            onSubmit={handleModalSave}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            className="w-full max-w-lg rounded-2xl bg-[var(--bg)] border border-[var(--border)] shadow-xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-semibold">
                {activeModal === "infos" && "Modifier tes informations clés"}
                {activeModal === "skills" && "Modifier tes compétences & outils"}
                {activeModal === "experience" &&
                  "Modifier tes expériences principales"}
                {activeModal === "education" &&
                  "Modifier ta formation & tes certifications"}
                {activeModal === "languages" && "Modifier tes langues"}
                {activeModal === "hobbies" && "Modifier tes centres d’intérêt"}
              </h3>
              <button
                type="button"
                onClick={handleModalCancel}
                className="rounded-full px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--bg-soft)]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-auto pr-1">
              {/* INFOS */}
              {activeModal === "infos" && (
                <>
                  <div className="grid sm:grid-cols-2 gap-3 text-[12px]">
                    <div>
                      <label className="text-[11px] text-[var(--muted)]">
                        Nom complet
                      </label>
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        value={infosDraft.fullName}
                        onChange={(e) =>
                          setInfosDraft((p) => ({
                            ...p,
                            fullName: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--muted)]">
                        Email
                      </label>
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        value={infosDraft.email}
                        onChange={(e) =>
                          setInfosDraft((p) => ({
                            ...p,
                            email: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--muted)]">
                        Téléphone
                      </label>
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        value={infosDraft.phone}
                        onChange={(e) =>
                          setInfosDraft((p) => ({
                            ...p,
                            phone: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--muted)]">
                        LinkedIn
                      </label>
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        value={infosDraft.linkedin}
                        onChange={(e) =>
                          setInfosDraft((p) => ({
                            ...p,
                            linkedin: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--muted)]">
                        Permis (ex : Permis B)
                      </label>
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        value={infosDraft.drivingLicense}
                        onChange={(e) =>
                          setInfosDraft((p) => ({
                            ...p,
                            drivingLicense: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[var(--muted)]">
                        Véhicule (ex : Véhiculé)
                      </label>
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        value={infosDraft.vehicle}
                        onChange={(e) =>
                          setInfosDraft((p) => ({
                            ...p,
                            vehicle: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[11px] text-[var(--muted)]">
                        Adresse (ville, code postal, etc.)
                      </label>
                      <input
                        className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        placeholder="Ex : 12 rue Exemple, 75000 Paris"
                        value={infosDraft.address}
                        onChange={(e) =>
                          setInfosDraft((p) => ({
                            ...p,
                            address: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="text-[12px]">
                    <label className="text-[11px] text-[var(--muted)]">
                      Contrat recherché
                    </label>
                    <input
                      list="contract-type-options"
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                      placeholder="Ex : CDI, Alternance, Stage, Freelance..."
                      value={infosDraft.contractType}
                      onChange={(e) =>
                        setInfosDraft((p) => ({
                          ...p,
                          contractType: e.target.value,
                        }))
                      }
                    />
                    <datalist id="contract-type-options">
                      {CONTRACT_TYPE_OPTIONS.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div className="text-[12px]">
                    <label className="text-[11px] text-[var(--muted)]">
                      Résumé de profil / Pitch
                    </label>
                    <textarea
                      rows={4}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)] resize-vertical"
                      value={infosDraft.profileSummary}
                      onChange={(e) =>
                        setInfosDraft((p) => ({
                          ...p,
                          profileSummary: e.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              )}

              {/* COMPÉTENCES */}
              {activeModal === "skills" && (
                <>
                  <div className="text-[12px] space-y-1">
                    <label className="text-[11px] text-[var(--muted)]">
                      Sections de compétences
                    </label>
                    <p className="text-[11px] text-[var(--muted)]">
                      Format conseillé : une ligne par section. Exemple :
                      <br />
                      <span className="italic">
                        &quot;Compétences analytiques : Analyse financière,
                        Reporting, Budget&quot;
                      </span>
                    </p>
                    <textarea
                      rows={5}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)] resize-vertical"
                      value={skillsSectionsText}
                      onChange={(e) => setSkillsSectionsText(e.target.value)}
                    />
                  </div>
                  <div className="text-[12px] space-y-1">
                    <label className="text-[11px] text-[var(--muted)]">
                      Outils / logiciels (séparés par des virgules)
                    </label>
                    <textarea
                      rows={2}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)] resize-vertical"
                      value={skillsToolsText}
                      onChange={(e) => setSkillsToolsText(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* EXPÉRIENCE */}
              {activeModal === "experience" && (
                <div className="space-y-3 text-[12px]">
                  {experiencesDraft.map((exp, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-[var(--border)]/70 bg-[var(--bg-soft)] p-3 space-y-2"
                    >
                      <div className="grid sm:grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-[var(--muted)]">
                            Poste
                          </label>
                          <input
                            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                            value={exp.role}
                            onChange={(e) =>
                              updateExperienceDraft(idx, "role", e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[var(--muted)]">
                            Entreprise
                          </label>
                          <input
                            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                            value={exp.company}
                            onChange={(e) =>
                              updateExperienceDraft(
                                idx,
                                "company",
                                e.target.value
                              )
                            }
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[var(--muted)]">
                            Dates
                          </label>
                          <input
                            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                            value={exp.dates}
                            onChange={(e) =>
                              updateExperienceDraft(
                                idx,
                                "dates",
                                e.target.value
                              )
                            }
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[11px] text-[var(--muted)]">
                          Missions / Réalisations (une par ligne)
                        </label>
                        <textarea
                          rows={3}
                          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)] resize-vertical"
                          value={exp.bulletsText}
                          onChange={(e) =>
                            updateExperienceDraft(
                              idx,
                              "bulletsText",
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addExperienceDraft}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                  >
                    <span className="text-[14px]">＋</span>
                    <span>Ajouter une expérience</span>
                  </button>
                </div>
              )}

              {/* FORMATION & CERTIFS */}
              {activeModal === "education" && (
                <>
                  <div className="space-y-3 text-[12px]">
                    {educationDrafts.map((edu, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-[var(--border)]/70 bg-[var(--bg-soft)] p-3 space-y-2"
                      >
                        <div className="grid sm:grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-[var(--muted)]">
                              Diplôme
                            </label>
                            <input
                              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                              value={edu.degree}
                              onChange={(e) =>
                                updateEducationDraft(
                                  idx,
                                  "degree",
                                  e.target.value
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-[var(--muted)]">
                              École / Université
                            </label>
                            <input
                              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                              value={edu.school}
                              onChange={(e) =>
                                updateEducationDraft(
                                  idx,
                                  "school",
                                  e.target.value
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-[var(--muted)]">
                              Lieu (optionnel)
                            </label>
                            <input
                              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                              value={edu.location}
                              onChange={(e) =>
                                updateEducationDraft(
                                  idx,
                                  "location",
                                  e.target.value
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-[var(--muted)]">
                              Dates
                            </label>
                            <input
                              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                              placeholder="Ex : 2022–2024"
                              value={edu.dates}
                              onChange={(e) =>
                                updateEducationDraft(
                                  idx,
                                  "dates",
                                  e.target.value
                                )
                              }
                            />
                          </div>
                        </div>
                        {educationDrafts.length > 1 && (
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() =>
                                setEducationDrafts((prev) =>
                                  prev.filter((_, i) => i !== idx)
                                )
                              }
                              className="text-[11px] text-[var(--muted)] hover:text-red-400"
                            >
                              Supprimer cette formation
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={addEducationDraft}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                    >
                      <span className="text-[14px]">＋</span>
                      <span>Ajouter une formation</span>
                    </button>
                  </div>

                  {/* Certifications */}
                  <div className="text-[12px] space-y-2 pt-3">
                    <label className="text-[11px] text-[var(--muted)]">
                      Certifications (avec auto-complétion)
                    </label>
                    <div className="flex gap-2">
                      <input
                        list="certification-options"
                        className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                        placeholder="Ex : Tosa Excel, Azure AZ-900..."
                        value={certInput}
                        onChange={(e) => setCertInput(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = certInput.trim();
                          if (!val) return;
                          if (!certsList.includes(val)) {
                            setCertsList((prev) => [...prev, val]);
                          }
                          setCertInput("");
                        }}
                        className="rounded-md bg-[var(--brand)] hover:bg-[var(--brandDark)] px-3 py-1.5 text-[12px] text-white"
                      >
                        Ajouter
                      </button>
                      <datalist id="certification-options">
                        {CERTIFICATION_OPTIONS.map((c) => (
                          <option key={c} value={c} />
                        ))}
                      </datalist>
                    </div>

                    {certsList.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1">
                        {certsList.map((cert) => (
                          <span
                            key={cert}
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-[2px] text-[11px]"
                          >
                            {cert}
                            <button
                              type="button"
                              onClick={() =>
                                setCertsList((prev) =>
                                  prev.filter((c) => c !== cert)
                                )
                              }
                              className="text-[10px] text-[var(--muted)] hover:text-red-400"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* LANGUES */}
              {activeModal === "languages" && (
                <div className="text-[12px] space-y-3">
                  <p className="text-[11px] text-[var(--muted)]">
                    Ajoute tes langues avec leur niveau. Tu peux choisir dans la
                    liste ou taper manuellement.
                  </p>
                  {languagesDraft.map((lang, idx) => {
                    const flag =
                      lang.language.trim() !== ""
                        ? getFlagEmoji(lang.language)
                        : "🌐";
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded-lg border border-[var(--border)]/70 bg-[var(--bg-soft)] px-2.5 py-2"
                      >
                        <span className="text-xl w-7 text-center">{flag}</span>
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] text-[var(--muted)]">
                              Langue
                            </label>
                            <input
                              list="language-options"
                              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                              value={lang.language}
                              onChange={(e) =>
                                setLanguagesDraft((prev) =>
                                  prev.map((l, i) =>
                                    i === idx
                                      ? { ...l, language: e.target.value }
                                      : l
                                  )
                                )
                              }
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-[var(--muted)]">
                              Niveau
                            </label>
                            <select
                              className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                              value={lang.level}
                              onChange={(e) =>
                                setLanguagesDraft((prev) =>
                                  prev.map((l, i) =>
                                    i === idx
                                      ? { ...l, level: e.target.value }
                                      : l
                                  )
                                )
                              }
                            >
                              <option value="">Sélectionner un niveau</option>
                              {LANGUAGE_LEVEL_OPTIONS.map((lvl) => (
                                <option key={lvl} value={lvl}>
                                  {lvl}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        {languagesDraft.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setLanguagesDraft((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="ml-1 text-[11px] text-[var(--muted)] hover:text-red-400"
                          >
                            ✕
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
                    onClick={() =>
                      setLanguagesDraft((prev) => [
                        ...prev,
                        { language: "", level: "" },
                      ])
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[11px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                  >
                    <span className="text-[14px]">＋</span>
                    <span>Ajouter une langue</span>
                  </button>
                </div>
              )}

              {/* HOBBIES */}
              {activeModal === "hobbies" && (
                <div className="text-[12px] space-y-2">
                  <label className="text-[11px] text-[var(--muted)]">
                    Centres d&apos;intérêt (avec auto-complétion)
                  </label>
                  <div className="flex gap-2">
                    <input
                      list="hobby-options"
                      className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--brand)]"
                      placeholder="Ex : Voyage, Football, Lecture..."
                      value={hobbyInput}
                      onChange={(e) => setHobbyInput(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = hobbyInput.trim();
                        if (!val) return;
                        if (!hobbiesList.includes(val)) {
                          setHobbiesList((prev) => [...prev, val]);
                        }
                        setHobbyInput("");
                      }}
                      className="rounded-md bg-[var(--brand)] hover:bg-[var(--brandDark)] px-3 py-1.5 text-[12px] text-white"
                    >
                      Ajouter
                    </button>
                    <datalist id="hobby-options">
                      {HOBBY_OPTIONS.map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                  </div>

                  {hobbiesList.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {hobbiesList.map((hobby) => (
                        <span
                          key={hobby}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-[2px] text-[11px]"
                        >
                          <span>{getHobbyEmoji(hobby)}</span>
                          <span>{hobby}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setHobbiesList((prev) =>
                                prev.filter((h) => h !== hobby)
                              )
                            }
                            className="text-[10px] text-[var(--muted)] hover:text-red-400"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[var(--muted)] mt-1">
                      Aucun centre d&apos;intérêt ajouté pour le moment.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleModalCancel}
                className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--bg)] transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg bg-[var(--brand)] hover:bg-[var(--brandDark)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors"
              >
                Enregistrer
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </motion.div>
  );
}
