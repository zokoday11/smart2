"use client";

import { useState, useEffect, FormEvent, useMemo } from "react";
import { motion } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { getRecaptchaToken } from "@/lib/recaptcha";

// --- TYPES PROFIL / CV ---
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

type JobOffer = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  created: string;
  salary: string | null;
  matchScore: number;
};

type LastOpenedJob = {
  id: string;
  title: string;
  company: string;
  url: string;
  location?: string;
  openedAt: number;
};

// --- ENDPOINTS CLOUD FUNCTIONS ---
const GENERATE_CV_API =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateCvPdf";

const GENERATE_CV_LM_ZIP_API =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateCvLmZip";

// --- AUTOCOMPLETE ---
const JOB_SUGGESTIONS = [
  "Kinésithérapeute",
  "Kiné respiratoire",
  "Infirmier",
  "Infirmière",
  "Médecin généraliste",
  "Développeur web",
  "Développeur front-end",
  "Développeur back-end",
  "Product Owner",
  "Chef de projet",
  "Data analyst",
  "Data engineer",
  "Comptable",
  "Chargé de recrutement",
  "Responsable RH",
  "Commercial B2B",
  "Commercial sédentaire",
  "UX designer",
  "Graphiste",
];

const CITY_SUGGESTIONS_FR = [
  "Paris",
  "Lyon",
  "Marseille",
  "Toulouse",
  "Nice",
  "Nantes",
  "Montpellier",
  "Strasbourg",
  "Bordeaux",
  "Lille",
  "Rennes",
  "Reims",
  "Le Havre",
  "Saint-Étienne",
  "Grenoble",
  "Dijon",
  "Angers",
  "Nîmes",
  "Villeurbanne",
  "Clermont-Ferrand",
];

const COUNTRY_CODES = [
  { code: "fr", label: "France" },
  { code: "be", label: "Belgique" },
  { code: "ch", label: "Suisse" },
  { code: "ca", label: "Canada" },
  { code: "gb", label: "Royaume-Uni" },
  { code: "es", label: "Espagne" },
  { code: "de", label: "Allemagne" },
  { code: "it", label: "Italie" },
];

// --- HELPERS ---
function normalize(str: string) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenize(str: string): string[] {
  return normalize(str)
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 3);
}

function extractProfileKeywords(profile: CvProfile | null): string[] {
  if (!profile) return [];
  const tokens: string[] = [];

  if (profile.primaryDomain) tokens.push(profile.primaryDomain);
  if (Array.isArray(profile.secondaryDomains)) tokens.push(...profile.secondaryDomains);
  if (profile.profileSummary) tokens.push(profile.profileSummary);

  if (profile.skills) {
    if (Array.isArray(profile.skills.sections)) {
      profile.skills.sections.forEach((sec) => {
        if (sec?.title) tokens.push(sec.title);
        if (Array.isArray(sec?.items)) tokens.push(...sec.items);
      });
    }
    if (Array.isArray(profile.skills.tools)) tokens.push(...profile.skills.tools);
  }

  if (Array.isArray(profile.softSkills)) tokens.push(...profile.softSkills);

  if (Array.isArray(profile.experiences)) {
    profile.experiences.forEach((exp) => {
      if (exp.role) tokens.push(exp.role);
      if (exp.company) tokens.push(exp.company);
      if (Array.isArray(exp.bullets)) tokens.push(...exp.bullets);
    });
  }

  const dedup = Array.from(
    new Set(tokens.map((t) => String(t)).flatMap((t) => tokenize(t)))
  );

  return dedup.slice(0, 80);
}

function computeMatchScore(
  rawJob: any,
  profile: CvProfile | null,
  searchQuery: string,
  searchLocation: string,
  remoteOnly: boolean
): number {
  const title = rawJob.title || "";
  const company =
    (rawJob.company && rawJob.company.display_name) || rawJob.company || "";
  const description = rawJob.description || "";
  const loc =
    (rawJob.location && rawJob.location.display_name) || rawJob.location || "";

  const jobText = `${title} ${company} ${description} ${loc}`;
  const jobTokens = new Set(tokenize(jobText));

  const profileTokens = extractProfileKeywords(profile);
  const queryTokens = tokenize(searchQuery);
  const locationTokens = tokenize(searchLocation);

  const allKeywords = Array.from(new Set([...profileTokens, ...queryTokens]));

  let overlap = 0;
  for (const kw of allKeywords) {
    if (jobTokens.has(kw)) overlap += 1;
  }

  const baseDenom = Math.max(5, allKeywords.length || 5);
  let score = (overlap / baseDenom) * 100;

  if (locationTokens.length) {
    for (const lt of locationTokens) {
      if (jobTokens.has(lt)) {
        score += 10;
        break;
      }
    }
  }

  if (remoteOnly) {
    const jobNorm = normalize(jobText);
    if (/remote|teletravail|home\s*office|hybride/.test(jobNorm)) score += 10;
    else score -= 15;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreBadgeClass(score: number): string {
  if (score >= 75) return "bg-emerald-500/15 text-emerald-300 border-emerald-400/60";
  if (score >= 50) return "bg-amber-500/15 text-amber-300 border-amber-400/60";
  if (score >= 30) return "bg-yellow-500/10 text-yellow-200 border-yellow-400/40";
  return "bg-red-500/10 text-red-200 border-red-400/40";
}

// --- PAGE ---
export default function ApplyPage() {
  // AUTH & PROFIL CV
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

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
          const loaded: CvProfile = {
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
          setProfile(loaded);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error("Erreur chargement profil pour Apply:", e);
      } finally {
        setLoadingProfile(false);
      }
    });

    return () => unsub();
  }, []);

  const profileName = profile?.fullName || userEmail || "Profil non détecté";

  // RECHERCHE D’OFFRES
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLocation, setSearchLocation] = useState("");
  const [searchCountry, setSearchCountry] = useState("fr");
  const [contractTime, setContractTime] = useState<"any" | "full_time" | "part_time">("any");
  const [contractType, setContractType] = useState<"any" | "permanent" | "contract">("any");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [minSalary, setMinSalary] = useState("");
  const [maxSalary, setMaxSalary] = useState("");
  const [publishedWithin, setPublishedWithin] = useState<"any" | "1" | "3" | "7" | "30">("7");

  const [jobs, setJobs] = useState<JobOffer[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [maxDisplay, setMaxDisplay] = useState(30);

  // VISITES / DÉJÀ CONSULTÉES
  const [visitedJobIds, setVisitedJobIds] = useState<string[]>([]);
  const [pendingApplyJob, setPendingApplyJob] = useState<LastOpenedJob | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawVisited = window.localStorage.getItem("visitedJobIds");
      if (rawVisited) {
        const arr = JSON.parse(rawVisited);
        if (Array.isArray(arr)) setVisitedJobIds(arr);
      }

      const rawLast = window.localStorage.getItem("lastOpenedJob");
      if (rawLast) {
        const obj = JSON.parse(rawLast) as LastOpenedJob;
        if (obj && obj.id && obj.title && obj.company) setPendingApplyJob(obj);
      }
    } catch (e) {
      console.error("Erreur lecture localStorage Apply:", e);
    }
  }, []);

  const markJobVisited = (job: JobOffer) => {
    if (typeof window === "undefined") return;

    setVisitedJobIds((prev) => {
      const set = new Set(prev);
      set.add(job.id);
      const arr = Array.from(set);
      window.localStorage.setItem("visitedJobIds", JSON.stringify(arr));
      return arr;
    });

    const last: LastOpenedJob = {
      id: job.id,
      title: job.title,
      company: job.company,
      url: job.url,
      location: job.location,
      openedAt: Date.now(),
    };
    window.localStorage.setItem("lastOpenedJob", JSON.stringify(last));
    setPendingApplyJob(last);
  };

  const clearPendingApplyJob = () => {
    if (typeof window !== "undefined") window.localStorage.removeItem("lastOpenedJob");
    setPendingApplyJob(null);
  };

  // AUTOCOMPLETE
  const jobAutocomplete = useMemo(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return [];
    const lower = normalize(q);
    return JOB_SUGGESTIONS.filter((s) => normalize(s).startsWith(lower)).slice(0, 8);
  }, [searchQuery]);

  const cityAutocomplete = useMemo(() => {
    const q = searchLocation.trim();
    if (q.length < 2) return [];
    const lower = normalize(q);
    return CITY_SUGGESTIONS_FR.filter((s) => normalize(s).startsWith(lower)).slice(0, 8);
  }, [searchLocation]);

  // /api/jobs
  const handleSearchJobs = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() && !searchLocation.trim()) {
      alert("Saisis au moins un mot-clé ou une localisation.");
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    setJobs([]);
    setMaxDisplay(30);

    try {
      const recaptchaToken = await getRecaptchaToken("jobs_search");

      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery.trim(),
          location: searchLocation.trim(),
          country: searchCountry.trim() || "fr",
          contract_time: contractTime === "any" ? undefined : contractTime,
          contract_type: contractType === "any" ? undefined : contractType,
          remote_only: remoteOnly,
          salary_min: minSalary ? Number(minSalary) || undefined : undefined,
          salary_max: maxSalary ? Number(maxSalary) || undefined : undefined,
          max_days_old: publishedWithin === "any" ? undefined : Number(publishedWithin),
          page: 1,
          results_per_page: 100,
          recaptchaToken,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const textErr = await res.text();
        console.error("Réponse non JSON /api/jobs:", textErr);
        throw new Error("Réponse serveur invalide (jobs).");
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur lors de la recherche d'offres.");

      const rawList: any[] = data.jobs || data.results || [];

      let list: JobOffer[] = rawList.map((j, index) => {
        const id =
          j.id?.toString() ??
          j.adref?.toString() ??
          `job_${index}_${Math.random().toString(36).slice(2)}`;

        const title = j.title || "";
        const company = (j.company && j.company.display_name) || j.company || "";
        const location = (j.location && j.location.display_name) || j.location || "";
        const url = j.url || j.redirect_url || "";
        const description = j.description || "";
        const created = j.created || "";

        const salary =
          j.salary_min && j.salary_max
            ? `${Math.round(j.salary_min)} - ${Math.round(j.salary_max)} €`
            : j.salary_min
              ? `≥ ${Math.round(j.salary_min)} €`
              : null;

        const matchScore = computeMatchScore(j, profile, searchQuery, searchLocation, remoteOnly);

        return { id, title, company, location, url, description, created, salary, matchScore };
      });

      if (remoteOnly) {
        list = list.filter((job) => {
          const txt = normalize(`${job.title} ${job.description} ${job.location}`);
          return /remote|teletravail|home\s*office|hybride/.test(txt);
        });
      }

      list.sort((a, b) => b.matchScore - a.matchScore);
      setJobs(list);

      if (!list.length) setSearchError("Aucune offre trouvée pour ces critères.");
    } catch (err: any) {
      console.error(err);
      setSearchError(err.message || "Erreur lors de la recherche d'offres, réessaie plus tard.");
    } finally {
      setSearchLoading(false);
    }
  };

  // SUIVI candidature après visite
  const createApplicationFromJob = async (job: LastOpenedJob) => {
    if (!userId || !job) return;
    try {
      const appsRef = collection(db, "applications");
      await addDoc(appsRef, {
        userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        company: job.company,
        jobTitle: job.title,
        jobLink: job.url,
        location: job.location || "",
        status: "applied",
        source: "Adzuna / Apply",
      });
    } catch (e) {
      console.error("Erreur création suivi candidature depuis Apply:", e);
    }
  };

  const handleAnswerApplied = async (applied: boolean) => {
    if (!pendingApplyJob) {
      clearPendingApplyJob();
      return;
    }
    if (applied) await createApplicationFromJob(pendingApplyJob);
    clearPendingApplyJob();
  };

  // Génération CV / ZIP
  const [cvJobLoadingId, setCvJobLoadingId] = useState<string | null>(null);
  const [cvLmJobLoadingId, setCvLmJobLoadingId] = useState<string | null>(null);

  const [cvLang] = useState<Lang>("fr");
  const [lmLang] = useState<Lang>("fr");

  const generateCvForJob = async (job: JobOffer) => {
    if (!profile) {
      alert("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF.");
      return;
    }

    setCvJobLoadingId(job.id);
    try {
      const recaptchaToken = await getRecaptchaToken("generate_cv_pdf");

      const res = await fetch(GENERATE_CV_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          targetJob: job.title,
          template: "ats",
          lang: cvLang,
          contract: profile.contractType || "",
          jobLink: job.url,
          jobDescription: job.description,
          recaptchaToken,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Erreur serveur lors de la génération du CV.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cv-ia.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("Erreur génération CV pour offre:", e);
      alert(e?.message || "Impossible de générer le CV pour cette offre.");
    } finally {
      setCvJobLoadingId(null);
    }
  };

  const generateCvLmForJob = async (job: JobOffer) => {
    if (!profile) {
      alert("Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF.");
      return;
    }

    setCvLmJobLoadingId(job.id);
    try {
      const recaptchaToken = await getRecaptchaToken("generate_cv_lm_zip");

      const res = await fetch(GENERATE_CV_LM_ZIP_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          targetJob: job.title,
          template: "ats",
          lang: cvLang,
          contract: profile.contractType || "",
          jobLink: job.url,
          jobDescription: job.description,
          lm: {
            companyName: job.company,
            jobTitle: job.title,
            jobDescription: job.description,
            jobLink: job.url,
            lang: lmLang,
          },
          recaptchaToken,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Erreur serveur lors de la génération du ZIP CV + LM.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cv-lm-ia.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      console.error("Erreur génération CV+LM pour offre:", e);
      alert(e?.message || "Impossible de générer le CV + LM pour cette offre.");
    } finally {
      setCvLmJobLoadingId(null);
    }
  };

  // RENDER
  if (!userId && !loadingProfile) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="glass rounded-2xl p-6 space-y-3">
          <h1 className="text-xl font-semibold">Postuler à des offres</h1>
          <p className="text-sm text-[var(--muted)]">
            Connecte-toi pour rechercher des offres, générer ton CV/LM et suivre tes candidatures.
          </p>
        </div>
      </div>
    );
  }

  const displayedJobs = jobs.slice(0, maxDisplay);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="max-w-5xl mx-auto px-4 py-6 space-y-6"
    >
      {pendingApplyJob && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-md w-full px-3">
          <div className="rounded-2xl bg-[var(--bg)] border border-[var(--border)] shadow-lg px-4 py-3 text-xs flex flex-col gap-2">
            <p className="text-[var(--muted)]">
              Tu viens de consulter{" "}
              <span className="font-semibold text-[var(--ink)]">{pendingApplyJob.title}</span> chez{" "}
              <span className="font-semibold text-[var(--ink)]">{pendingApplyJob.company}</span>. As-tu postulé ?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1 rounded-full text-[11px] bg-white/5 hover:bg-white/10"
                onClick={() => handleAnswerApplied(false)}
              >
                Non
              </button>
              <button
                className="px-3 py-1 rounded-full text-[11px] bg-emerald-500/80 hover:bg-emerald-500 text-black font-medium"
                onClick={() => handleAnswerApplied(true)}
              >
                Oui, ajouter au suivi
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="glass rounded-2xl p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Recherche & candidatures</h1>
            <p className="text-sm text-[var(--muted)] max-w-xl">
              1) Cherche des offres, 2) génère CV + LM en 1 clic, 3) postule et mets à jour ton suivi.
            </p>
          </div>
          <div className="text-[11px] rounded-full border border-[var(--border)] px-3 py-1 bg-[var(--bg-soft)]">
            Profil CV IA :{" "}
            <span className="font-medium">
              {loadingProfile ? "Chargement…" : profile ? profileName : "Non détecté"}
            </span>
          </div>
        </div>
      </header>

      <section className="glass rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">1. Rechercher des offres (Adzuna)</h2>
          <span className="text-[11px] text-[var(--muted)]">
            API via <code>/api/jobs</code>
          </span>
        </div>

        <form onSubmit={handleSearchJobs} className="grid md:grid-cols-4 gap-3 text-sm">
          <div className="md:col-span-2 relative">
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Métier / secteur
            </label>
            <input
              className="input w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ex : kiné, développeur web, data…"
            />
            {jobAutocomplete.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[11px] max-h-40 overflow-auto">
                {jobAutocomplete.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="w-full text-left px-2 py-1 hover:bg-white/5"
                    onClick={() => setSearchQuery(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Ville / zone
            </label>
            <input
              className="input w-full"
              value={searchLocation}
              onChange={(e) => setSearchLocation(e.target.value)}
              placeholder="Ex : Paris, Lyon, remote…"
            />
            {cityAutocomplete.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] text-[11px] max-h-40 overflow-auto">
                {cityAutocomplete.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="w-full text-left px-2 py-1 hover:bg-white/5"
                    onClick={() => setSearchLocation(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Pays
            </label>
            <select className="input w-full" value={searchCountry} onChange={(e) => setSearchCountry(e.target.value)}>
              {COUNTRY_CODES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Temps de travail
            </label>
            <select
              className="input w-full"
              value={contractTime}
              onChange={(e) => setContractTime(e.target.value as any)}
            >
              <option value="any">Indifférent</option>
              <option value="full_time">Temps plein</option>
              <option value="part_time">Temps partiel</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Type de contrat
            </label>
            <select
              className="input w-full"
              value={contractType}
              onChange={(e) => setContractType(e.target.value as any)}
            >
              <option value="any">Indifférent</option>
              <option value="permanent">CDI / permanent</option>
              <option value="contract">CDD / contract</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Salaire min (€/an)
            </label>
            <input className="input w-full" value={minSalary} onChange={(e) => setMinSalary(e.target.value)} placeholder="Ex : 30000" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Salaire max (€/an)
            </label>
            <input className="input w-full" value={maxSalary} onChange={(e) => setMaxSalary(e.target.value)} placeholder="Ex : 50000" />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Offres publiées depuis
            </label>
            <select className="input w-full" value={publishedWithin} onChange={(e) => setPublishedWithin(e.target.value as any)}>
              <option value="any">Peu importe</option>
              <option value="1">24 heures</option>
              <option value="3">3 jours</option>
              <option value="7">7 jours</option>
              <option value="30">30 jours</option>
            </select>
          </div>

          <div className="flex flex-col justify-between gap-2">
            <label className="flex items-center gap-2 text-[11px] text-[var(--muted)] mt-1">
              <input
                type="checkbox"
                className="h-3.5 w-3.5"
                checked={remoteOnly}
                onChange={(e) => setRemoteOnly(e.target.checked)}
              />
              <span>Télétravail / remote uniquement</span>
            </label>

            <label className="block text-[11px] font-medium text-[var(--muted)]">Nb max à afficher</label>
            <select className="input w-full text-[11px]" value={maxDisplay} onChange={(e) => setMaxDisplay(Number(e.target.value))}>
              <option value={20}>20</option>
              <option value={30}>30</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>

          <div className="flex items-end md:justify-end md:col-span-2">
            <button type="submit" className="btn-primary w-full md:w-auto" disabled={searchLoading}>
              {searchLoading ? "Recherche en cours..." : "Chercher des offres"}
            </button>
          </div>
        </form>

        <div className="space-y-1 text-[11px] text-[var(--muted)] mt-1">
          <p>
            💡 Résultats triés par <strong>score de match</strong> avec ton profil.
          </p>
          {searchError && <p className="text-red-400 text-[11px]">{searchError}</p>}
          {!!jobs.length && (
            <p>
              {jobs.length} offre(s) trouvée(s) – {displayedJobs.length} affichée(s).
            </p>
          )}
        </div>

        <div className="mt-3 space-y-3 max-h-[420px] overflow-auto custom-scrollbar">
          {displayedJobs.map((job, index) => {
            const visited = visitedJobIds.includes(job.id);
            const createdDate = job.created ? new Date(job.created) : null;
            const rank = index + 1;

            return (
              <article
                key={job.id}
                className={`rounded-xl border p-3 text-sm transition-colors ${
                  visited
                    ? "border-[var(--border)] bg-white/5"
                    : "border-[var(--border-soft)] bg-black/20 hover:border-emerald-400/70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-[13px]">{job.title}</h3>
                      <span className={`text-[10px] px-2 py-[2px] rounded-full border ${scoreBadgeClass(job.matchScore)}`}>
                        Match : <span className="font-semibold">{job.matchScore}%</span>
                      </span>
                      {rank <= 3 && (
                        <span className="text-[10px] px-2 py-[2px] rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/40">
                          Top {rank}
                        </span>
                      )}
                      {visited && (
                        <span className="text-[10px] px-2 py-[2px] rounded-full bg-white/10 text-[var(--muted)] border border-[var(--border)]/60">
                          Déjà consultée
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--muted)]">
                      {job.company} • {job.location}
                    </p>
                    {job.salary && <p className="text-[11px] text-emerald-200 mt-1">Salaire estimé : {job.salary}</p>}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    {createdDate && (
                      <span className="text-[10px] text-[var(--muted)]">
                        Publié le {createdDate.toLocaleDateString("fr-FR")}
                      </span>
                    )}

                    <div className="flex flex-wrap justify-end gap-1.5">
                      {job.url && (
                        <button
                          type="button"
                          className="text-[11px] px-2 py-1 rounded-full bg-white/10 hover:bg-white/20"
                          onClick={() => {
                            markJobVisited(job);
                            window.open(job.url, "_blank", "noopener,noreferrer");
                          }}
                        >
                          Ouvrir l&apos;offre ↗
                        </button>
                      )}

                      <button
                        type="button"
                        className="text-[11px] px-2 py-1 rounded-full bg-[var(--bg)] border border-[var(--border)] hover:border-emerald-400/70"
                        onClick={() => generateCvForJob(job)}
                        disabled={cvJobLoadingId === job.id}
                      >
                        {cvJobLoadingId === job.id ? "CV..." : "CV 1 page"}
                      </button>

                      <button
                        type="button"
                        className="text-[11px] px-2 py-1 rounded-full bg-[var(--bg)] border border-[var(--border)] hover:border-emerald-400/70"
                        onClick={() => generateCvLmForJob(job)}
                        disabled={cvLmJobLoadingId === job.id}
                      >
                        {cvLmJobLoadingId === job.id ? "CV + LM..." : "CV + LM (ZIP)"}
                      </button>
                    </div>
                  </div>
                </div>

                {job.description && (
                  <p className="text-[11px] text-[var(--muted)] mt-2 line-clamp-3">
                    {job.description.replace(/<[^>]+>/g, "")}
                  </p>
                )}
              </article>
            );
          })}

          {!searchLoading && !jobs.length && !searchError && (
            <p className="text-xs text-[var(--muted)]">
              Aucun résultat pour l&apos;instant. Lance une recherche.
            </p>
          )}
        </div>

        {jobs.length > displayedJobs.length && (
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              className="text-[11px] px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-[var(--border)]"
              onClick={() => setMaxDisplay((m) => Math.min(m + 30, jobs.length))}
            >
              Afficher +30 offres (actuellement {displayedJobs.length}/{jobs.length})
            </button>
          </div>
        )}
      </section>
    </motion.div>
  );
}
