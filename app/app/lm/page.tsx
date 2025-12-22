"use client";

import { logUsage } from "@/lib/logUsage";
import { useEffect, useState, FormEvent } from "react";
import { motion } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

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

type Lang = "fr" | "en";

// 🔗 ENDPOINTS CLOUD FUNCTIONS
const LETTER_AND_PITCH_URL =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterAndPitch";

const GENERATE_CV_API =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateCvPdf";

const GENERATE_CV_LM_ZIP_API =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateCvLmZip";

const GENERATE_LM_PDF_API =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateLetterPdf";

export default function AssistanceCandidaturePage() {
  // --- PROFIL CV IA ---

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Bandeau global "IA en cours"
  const [globalLoadingMessage, setGlobalLoadingMessage] = useState<
    string | null
  >(null);

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
            contractType:
              data.contractType || data.contractTypeStandard || "",
            contractTypeStandard: data.contractTypeStandard || "",
            contractTypeFull: data.contractTypeFull || "",
            primaryDomain: data.primaryDomain || "",
            secondaryDomains: Array.isArray(data.secondaryDomains)
              ? data.secondaryDomains
              : [],
            softSkills: Array.isArray(data.softSkills)
              ? data.softSkills
              : [],
            drivingLicense: data.drivingLicense || "",
            vehicle: data.vehicle || "",
            skills: {
              sections: Array.isArray(data.skills?.sections)
                ? data.skills.sections
                : [],
              tools: Array.isArray(data.skills?.tools)
                ? data.skills.tools
                : [],
            },
            experiences: Array.isArray(data.experiences)
              ? data.experiences
              : [],
            education: Array.isArray(data.education)
              ? data.education
              : [],
            educationShort: Array.isArray(data.educationShort)
              ? data.educationShort
              : [],
            certs: data.certs || "",
            langLine: data.langLine || "",
            hobbies: Array.isArray(data.hobbies) ? data.hobbies : [],
            updatedAt:
              typeof data.updatedAt === "number"
                ? data.updatedAt
                : undefined,
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

  // --- ÉTATS CV IA (1 page) ---

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

  // --- MAIL DE CANDIDATURE (objet + corps) ---

  const [recruiterName, setRecruiterName] = useState("");
  const [emailPreview, setEmailPreview] = useState("");
  const [subjectPreview, setSubjectPreview] = useState("");

  // --- DERIVÉS POUR AFFICHAGE HEADER & BANDEAUX ---

  const visibilityLabel = userId ? "Associé à ton compte" : "Invité";

  const miniHeadline =
    profile?.profileSummary?.split(".")[0] ||
    profile?.contractType ||
    "Analyse ton CV PDF dans l’onglet « CV IA » pour activer l’assistant.";

  const profileName = profile?.fullName || userEmail || "Profil non détecté";

  const targetedJob =
    jobTitle || cvTargetJob || "Poste cible non renseigné";
  const targetedCompany = companyName || "Entreprise non renseignée";

  // --- HELPER : création auto dans /applications ---

  type GenerationKind = "cv" | "cv_lm" | "lm" | "pitch";

  const autoCreateApplication = async (kind: GenerationKind) => {
    // Si la case n'est pas cochée -> on ne fait rien
    if (!cvAutoCreate) return;
    if (!userId || !profile) return;

    try {
      const appsRef = collection(db, "applications");
      await addDoc(appsRef, {
        userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Infos poste : on prend d'abord ce qui vient de l'étape LM, sinon Etape CV
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
      // On ne bloque pas l’UX si le suivi plante
    }
  };

  // --- ACTIONS CV ---

  const handleGenerateCv = async () => {
    if (!profile) {
      setCvError(
        "Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF."
      );
      return;
    }

    setCvError(null);
    setCvStatus(null);
    setCvLoading(true);
    setGlobalLoadingMessage("L’IA prépare ton CV 1 page…");

    try {
      const res = await fetch(GENERATE_CV_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          targetJob: cvTargetJob,
          template: cvTemplate,
          lang: cvLang,
          contract: cvContract,
          jobLink: cvJobLink,
          jobDescription: cvJobDesc,
          autoCreate: cvAutoCreate,
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

      setCvStatus("CV généré et téléchargé avec succès 🎉");

      // 👉 Création automatique dans /applications
      await autoCreateApplication("cv");

      // 📣 LOG L'USAGE du CV (1 docType = "cv")
      if (auth.currentUser) {
        await logUsage({
          user: auth.currentUser,
          action: "generate_document",
          docType: "cv",
          eventType: "generate",
          tool: "generateCvPdf",
          // creditsDelta: -1, // à activer si tu gères les crédits ici
        });
      }
    } catch (err: any) {
      console.error("Erreur génération CV:", err);
      setCvError(
        err?.message || "Impossible de générer le CV pour le moment."
      );
    } finally {
      setCvLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  const handleGenerateCvLmZip = async () => {
    if (!profile) {
      setCvError(
        "Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF."
      );
      return;
    }

    setCvError(null);
    setCvStatus(null);
    setCvZipLoading(true);
    setGlobalLoadingMessage("L’IA prépare ton CV + lettre de motivation…");

    try {
      const res = await fetch(GENERATE_CV_LM_ZIP_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          targetJob: cvTargetJob,
          template: cvTemplate,
          lang: cvLang,
          contract: cvContract,
          jobLink: cvJobLink,
          jobDescription: cvJobDesc,
          autoCreate: cvAutoCreate,
          lm: {
            companyName,
            jobTitle,
            jobDescription,
            jobLink,
            lang: lmLang,
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          text || "Erreur serveur lors de la génération du ZIP CV + LM."
        );
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

      setCvStatus("CV + LM générés et téléchargés dans un ZIP 🎉");

      // 👉 Création auto dans /applications (CV + LM)
      await autoCreateApplication("cv_lm");

      // 📣 LOG L'USAGE du ZIP (CV + LM)
      if (auth.currentUser) {
        // 1) côté stats CV
        await logUsage({
          user: auth.currentUser,
          action: "generate_document",
          docType: "cv",
          eventType: "generate_zip",
          tool: "generateCvLmZip",
        });
        // 2) côté stats LM (sans retoucher les crédits)
        await logUsage({
          user: auth.currentUser,
          action: "generate_document",
          docType: "lm",
          eventType: "generate_zip",
          tool: "generateCvLmZip",
          creditsDelta: 0,
        });
      }
    } catch (err: any) {
      console.error("Erreur génération ZIP CV + LM:", err);
      setCvError(
        err?.message ||
          "Impossible de générer le ZIP CV + LM pour le moment."
      );
    } finally {
      setCvZipLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  // --- ACTIONS LETTRE DE MOTIVATION ---

  const handleGenerateLetter = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!profile) {
      setLmError(
        "Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF."
      );
      return;
    }

    if (!jobTitle && !jobDescription) {
      setLmError(
        "Ajoute au moins l'intitulé du poste ou un extrait de la description."
      );
      return;
    }

    setLmError(null);
    setLmPdfError(null);
    setPitchError(null);
    setLmLoading(true);
    setLetterCopied(false);
    setGlobalLoadingMessage("L’IA rédige ta lettre de motivation…");

    try {
      const resp = await fetch(LETTER_AND_PITCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          jobTitle,
          companyName,
          jobDescription,
          lang: lmLang,
        }),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok) {
        const msg =
          (json && json.error) ||
          "Erreur pendant la génération de la lettre de motivation.";
        throw new Error(msg);
      }

      const coverLetter =
        typeof json.coverLetter === "string" ? json.coverLetter.trim() : "";

      setLetterText(coverLetter);

      // 👉 Création auto dans /applications (LM seule)
      await autoCreateApplication("lm");

      // 📣 LOG L'USAGE de la LM (génération texte)
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
      setLmError(
        err?.message ||
          "Impossible de générer la lettre de motivation pour le moment."
      );
    } finally {
      setLmLoading(false);
      setGlobalLoadingMessage(null);
    }
  };

  const handleDownloadLetterPdf = async () => {
    if (!letterText) {
      setLmPdfError(
        "Génère d'abord la lettre, puis tu pourras la télécharger en PDF."
      );
      return;
    }

    setLmPdfError(null);
    setLmPdfLoading(true);
    setGlobalLoadingMessage("L’IA met en forme ta lettre en PDF…");

    try {
      const resp = await fetch(GENERATE_LM_PDF_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coverLetter: letterText,
          jobTitle,
          companyName,
          candidateName: profile?.fullName || "",
          lang: lmLang,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(
          text || "Erreur serveur lors de la génération du PDF de la lettre."
        );
      }

      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lettre-motivation.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      // 📣 LOG L'USAGE du téléchargement PDF de la LM
      if (auth.currentUser) {
        await logUsage({
          user: auth.currentUser,
          action: "download_pdf",
          docType: "other",
          eventType: "lm_pdf_download",
          tool: "generateLetterPdf",
        });
      }
    } catch (err: any) {
      console.error("Erreur téléchargement LM PDF:", err);
      setLmPdfError(
        err?.message || "Impossible de générer le PDF pour le moment."
      );
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

  // --- ACTIONS PITCH ---

  const handleGeneratePitch = async () => {
    if (!profile) {
      setPitchError(
        "Aucun profil CV IA détecté. Va d'abord dans l'onglet CV IA pour analyser ton CV PDF."
      );
      return;
    }

    const effectiveJobTitle =
      jobTitle || cvTargetJob || "Candidature cible";
    const effectiveDesc = jobDescription || cvJobDesc || "";

    setPitchError(null);
    setPitchLoading(true);
    setPitchCopied(false);
    setGlobalLoadingMessage("L’IA prépare ton pitch d’ascenseur…");

    try {
      const resp = await fetch(LETTER_AND_PITCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          jobTitle: effectiveJobTitle,
          companyName,
          jobDescription: effectiveDesc,
          lang: pitchLang,
        }),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok) {
        const msg =
          (json && json.error) ||
          "Erreur pendant la génération du pitch.";
        throw new Error(msg);
      }

      const pitch =
        typeof json.pitch === "string" ? json.pitch.trim() : "";

      if (!pitch) {
        throw new Error("Pitch vide renvoyé par l'API.");
      }

      setPitchText(pitch);

      // 👉 Création auto dans /applications (pitch)
      await autoCreateApplication("pitch");

      // 📣 LOG L'USAGE du Pitch
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
      setPitchError(
        err?.message || "Impossible de générer le pitch pour le moment."
      );
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

  // --- ACTIONS MAIL DE CANDIDATURE ---

  const buildEmailContent = () => {
    const name = profile?.fullName || "Je";
    const subject = `Candidature – ${jobTitle || "poste"} – ${name}`;
    const recruiter =
      recruiterName.trim() || "Madame, Monsieur";

    const body = `Bonjour ${recruiter},

Je me permets de vous adresser ma candidature pour le poste de ${
      jobTitle || "..."
    } au sein de ${companyName || "votre entreprise"}.

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
      {/* Bandeau global de chargement IA */}
      {globalLoadingMessage && (
        <div className="mb-2 rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 px-3 py-1.5 text-[11px] flex items-center gap-2 text-[var(--muted)]">
          <span className="inline-flex w-3 h-3 rounded-full border-2 border-[var(--brand)] border-t-transparent animate-spin" />
          <span>{globalLoadingMessage}</span>
        </div>
      )}

      {/* HEADER MOBILE-FIRST */}
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
                {loadingProfile
                  ? "Chargement…"
                  : profile
                  ? "Détecté ✅"
                  : "Non détecté"}
              </span>
            </span>
            <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-[2px]">
              Visibilité :{" "}
              <span className="ml-1 font-medium">{visibilityLabel}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-lg sm:text-xl font-semibold">
              Prépare ta candidature avec ton CV IA
            </h1>
            <p className="text-[12px] text-[var(--muted)] max-w-xl">
              À partir de ton profil CV IA, génère un{" "}
              <strong>CV 1 page</strong>, une{" "}
              <strong>lettre de motivation personnalisée</strong>, un{" "}
              <strong>pitch d&apos;ascenseur</strong> et un{" "}
              <strong>mail de candidature</strong> prêts à être envoyés.
            </p>
          </div>

          {/* Mini résumé profil */}
          <div className="w-full sm:w-[220px] rounded-2xl border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5 text-[11px]">
            <p className="text-[var(--muted)] mb-1">Résumé du profil</p>
            <p className="font-semibold text-[var(--ink)] leading-tight">
              {profileName}
            </p>
            <p className="mt-0.5 text-[var(--muted)] line-clamp-2">
              {miniHeadline}
            </p>
          </div>
        </div>

        {/* 4 étapes */}
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-soft)] border border-[var(--border)] px-2 py-[3px]">
            <span className="w-4 h-4 rounded-full bg-[var(--brand)]/10 flex items-center justify-center text-[10px] text-[var(--brand)]">
              1
            </span>
            <span>Cible le poste (titre, entreprise, offre)</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-soft)] border border-[var(--border)] px-2 py-[3px]">
            <span className="w-4 h-4 rounded-full bg-[var(--brand)]/10 flex items-center justify-center text-[10px] text-[var(--brand)]">
              2
            </span>
            <span>Génère CV 1 page &amp; LM</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-soft)] border border-[var(--border)] px-2 py-[3px]">
            <span className="w-4 h-4 rounded-full bg-[var(--brand)]/10 flex items-center justify-center text-[10px] text-[var(--brand)]">
              3
            </span>
            <span>Finalise ton pitch pour l’entretien</span>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-soft)] border border-[var(--border)] px-2 py-[3px]">
            <span className="w-4 h-4 rounded-full bg-[var(--brand)]/10 flex items-center justify-center text-[10px] text-[var(--brand)]">
              4
            </span>
            <span>Génère ton mail de candidature</span>
          </span>
        </div>
      </section>

      {/* ÉTAPE 1 : CV IA */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
              Étape 1
            </span>
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-[var(--ink)]">
                CV IA – 1 page A4
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                PDF compact, lisible par les ATS, généré à partir de ton
                profil.
              </p>
            </div>
          </div>
        </div>

        {/* Inputs CV */}
        <div className="space-y-3 text-[13px]">
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Titre / objectif du CV
            </label>
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
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Modèle
              </label>
              <select
                id="cvTemplate"
                className="select-brand w-full text-[var(--ink)] bg-[var(--bg-soft)]"
                value={cvTemplate}
                onChange={(e) => setCvTemplate(e.target.value)}
              >
                <option value="ats">ATS (sobre)</option>
                <option value="design">Design (CLOUD)</option>
                <option value="magazine">Magazine</option>
                <option value="classic">Classique</option>
                <option value="modern">Moderne</option>
                <option value="minimalist">Minimaliste</option>
                <option value="academic">Académique</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Langue
              </label>
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
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Contrat visé
              </label>
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
                Créer automatiquement une entrée dans le{" "}
                <strong>Suivi 📌</strong> à chaque génération (CV, LM, pitch).
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
            <span>
              {cvLoading ? "Génération du CV..." : "Générer le CV (PDF)"}
            </span>
            <div
              id="cvBtnSpinner"
              className={`loader absolute inset-0 m-auto ${
                cvLoading ? "" : "hidden"
              }`}
            />
          </button>
          <button
            id="generateCvLmZipBtn"
            type="button"
            onClick={handleGenerateCvLmZip}
            disabled={cvZipLoading || !profile}
            className="btn-secondary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>
              {cvZipLoading ? "Génération ZIP..." : "CV + LM (ZIP)"}
            </span>
            <div
              id="cvLmZipBtnSpinner"
              className={`loader absolute inset-0 m-auto ${
                cvZipLoading ? "" : "hidden"
              }`}
            />
          </button>
        </div>

        <div className="mt-2 p-2.5 rounded-md border border-dashed border-[var(--border)]/70 text-[11px] text-[var(--muted)]">
          {cvStatus ? (
            <p className="text-center text-emerald-400 text-[12px]">
              {cvStatus}
            </p>
          ) : (
            <p className="text-center">
              Le CV est directement téléchargé en PDF. Ce bloc affiche le
              résultat de la génération.
            </p>
          )}
          {cvError && (
            <p className="mt-1 text-center text-red-400 text-[12px]">
              {cvError}
            </p>
          )}
        </div>
      </section>

      {/* ÉTAPE 2 : LETTRE DE MOTIVATION */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4">
        {/* Bandeau rappel du poste ciblé */}
        <div className="rounded-md bg-[var(--bg-soft)] border border-dashed border-[var(--border)]/70 px-3 py-2 text-[11px] text-[var(--muted)] flex flex-wrap gap-2 justify-between">
          <span>
            🎯 Poste ciblé :{" "}
            <span className="font-medium text-[var(--ink)]">
              {targetedJob}
            </span>
          </span>
          <span>
            🏢{" "}
            <span className="font-medium text-[var(--ink)]">
              {targetedCompany}
            </span>
          </span>
        </div>

        <form onSubmit={handleGenerateLetter} className="space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
                Étape 2
              </span>
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-[var(--brand)]">
                  Lettre de motivation IA
                </h3>
                <p className="text-[11px] text-[var(--muted)]">
                  Génère un texte personnalisé à partir de ton profil et de
                  l&apos;offre, puis exporte-le en PDF.
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
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                  Nom de l&apos;entreprise
                </label>
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
                <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                  Intitulé du poste
                </label>
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
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Extraits de l&apos;offre (optionnel)
              </label>
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
              <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
                Lien de l&apos;offre (optionnel)
              </label>
              <input
                id="jobLink"
                type="url"
                className="input w-full text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                placeholder="https://"
                value={jobLink}
                onChange={(e) => setJobLink(e.target.value)}
              />
            </div>

            {lmError && (
              <p className="text-[11px] text-red-400">{lmError}</p>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <button
                id="generateCoverLetterBtn"
                type="submit"
                disabled={lmLoading || !profile}
                className="btn-primary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span>
                  {lmLoading
                    ? "Génération de la LM..."
                    : "Générer la lettre"}
                </span>
                <div
                  id="lmBtnSpinner"
                  className={`loader absolute inset-0 m-auto ${
                    lmLoading ? "" : "hidden"
                  }`}
                />
              </button>

              <button
                id="downloadLetterPdfBtn"
                type="button"
                onClick={handleDownloadLetterPdf}
                disabled={!letterText || lmPdfLoading}
                className="btn-secondary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span>
                  {lmPdfLoading
                    ? "Création du PDF..."
                    : "Télécharger en PDF"}
                </span>
                <div
                  className={`loader absolute inset-0 m-auto ${
                    lmPdfLoading ? "" : "hidden"
                  }`}
                />
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
                <span>
                  {letterCopied ? "Texte copié ✅" : "Copier le texte"}
                </span>
              </button>
            </div>

            {lmPdfError && (
              <p className="text-[11px] text-red-400">{lmPdfError}</p>
            )}
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
              <p className="text-center text-[var(--muted)]">
                Lance une génération pour voir ici le texte de la LM IA.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ÉTAPE 3 : PITCH */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-3">
        {/* Bandeau rappel du poste ciblé */}
        <div className="rounded-md bg-[var(--bg-soft)] border border-dashed border-[var(--border)]/70 px-3 py-2 text-[11px] text-[var(--muted)] flex flex-wrap gap-2 justify-between">
          <span>
            🎯 Poste ciblé :{" "}
            <span className="font-medium text-[var(--ink)]">
              {targetedJob}
            </span>
          </span>
          <span>🧩 Utilise ce pitch pour mails, LinkedIn et entretiens.</span>
        </div>

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
              Étape 3
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[var(--brand)]">
                Pitch d&apos;ascenseur
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                Résumé percutant de 2–4 phrases pour te présenter en 30–40
                secondes.
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

        {pitchError && (
          <p className="text-[11px] text-red-400">{pitchError}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <button
            id="generatePitchBtn"
            type="button"
            onClick={handleGeneratePitch}
            disabled={pitchLoading || !profile}
            className="btn-primary relative flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>
              {pitchLoading
                ? "Génération du pitch..."
                : "Générer le pitch"}
            </span>
            <div
              id="pitchBtnSpinner"
              className={`loader absolute inset-0 m-auto ${
                pitchLoading ? "" : "hidden"
              }`}
            />
          </button>
          <button
            id="copyPitchBtn"
            type="button"
            onClick={handleCopyPitch}
            disabled={!pitchText}
            className="btn-secondary flex-1 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span>
              {pitchCopied ? "Pitch copié ✅" : "Copier le pitch"}
            </span>
          </button>
        </div>

        <div className="mt-2 p-3 card-soft rounded-md text-[13px] text-[var(--ink)] whitespace-pre-line">
          {pitchText ? (
            <p>{pitchText}</p>
          ) : (
            <p className="text-center text-[11px] text-[var(--muted)]">
              Après génération, ton pitch apparaîtra ici. Tu pourras ensuite le
              réutiliser dans tes mails, sur LinkedIn ou en entretien.
            </p>
          )}
        </div>
      </section>

      {/* ÉTAPE 4 : MAIL DE CANDIDATURE */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center text-[10px] px-2 py-[2px] rounded-full bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
              Étape 4
            </span>
            <div>
              <h3 className="text-base sm:text-lg font-semibold text-[var(--brand)]">
                Mail de candidature prêt à envoyer
              </h3>
              <p className="text-[11px] text-[var(--muted)] max-w-xl">
                Utilise les mêmes informations que ta lettre (entreprise, poste)
                pour générer un <strong>objet</strong> et un{" "}
                <strong>corps de mail</strong> à copier dans ton client mail ou
                sur un jobboard.
              </p>
            </div>
          </div>
        </div>

        <form
          onSubmit={handleGenerateEmail}
          className="grid md:grid-cols-2 gap-4 text-sm mt-1"
        >
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Nom de l&apos;entreprise
            </label>
            <input
              className="input w-full"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Ex : IMOGATE"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Intitulé du poste
            </label>
            <input
              className="input w-full"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Ex : Ingénieur Réseaux & Sécurité"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--muted)] mb-1">
              Nom du recruteur (optionnel)
            </label>
            <input
              className="input w-full"
              value={recruiterName}
              onChange={(e) => setRecruiterName(e.target.value)}
              placeholder="Ex : Mme Dupont"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              className="btn-primary min-w-[200px]"
            >
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
            <h4 className="font-semibold text-sm mb-2">
              Corps du mail
            </h4>
            <div className="text-xs text-[var(--muted)] whitespace-pre-line max-h-64 overflow-auto">
              {emailPreview ||
                "Le texte du mail apparaîtra ici après génération."}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-[var(--muted)] mt-3">
          📌 Copie-colle l&apos;objet et le texte dans ton client mail ou dans
          un formulaire &quot;Postuler&quot;, puis joins le CV et la lettre
          PDF générés dans les étapes précédentes.
        </p>
      </section>
    </motion.div>
  );
}
