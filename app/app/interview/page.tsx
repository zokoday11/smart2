// app/app/interview/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import {
  callGenerateInterviewQA,
  type GenerateInterviewQAResult,
} from "@/lib/gemini";
import InterviewChat from "@/components/InterviewChat";

type ExperienceLike = {
  company?: string;
  role?: string;
  title?: string;
  city?: string;
  location?: string;
  dates?: string;
  bullets?: string[];
};

type ProfileLike = {
  fullName?: string;
  profileHeadline?: string;
  title?: string;
  city?: string;
  experiences?: ExperienceLike[] | any;
  experience?: ExperienceLike[] | any;
  [key: string]: any;
};

type QaPair = {
  question: string;
  answer: string;
};

export default function InterviewPage() {
  const { user } = useAuth();

  const [profile, setProfile] = useState<ProfileLike | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(
    null
  );

  const [qaLang, setQaLang] = useState<"fr" | "en">("fr");
  const [selectedExpIndex, setSelectedExpIndex] =
    useState<string>("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaPairs, setQaPairs] = useState<QaPair[]>([]);

  const [copiedIndex, setCopiedIndex] = useState<number | null>(
    null
  );

  // Chargement profil CV
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setProfile(null);
        setLoadingProfile(false);
        return;
      }
      try {
        const ref = doc(db, "profiles", user.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setProfile(snap.data() as ProfileLike);
        } else {
          setProfile(null);
        }
      } catch (e) {
        console.error(e);
        setLoadError("Impossible de charger ton profil CV.");
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, [user]);

  // Récupération robuste des expériences
  const experiences: ExperienceLike[] = (() => {
    if (!profile) return [];
    const possible =
      (profile.experiences as any) ??
      (profile.experience as any) ??
      [];
    if (Array.isArray(possible))
      return possible as ExperienceLike[];
    return [];
  })();

  // Reset quand on change de langue ou d'expérience
  useEffect(() => {
    setQaPairs([]);
    setQaError(null);
    setCopiedIndex(null);
  }, [selectedExpIndex, qaLang]);

  const handleGenerateQA = async () => {
    if (!profile) {
      setQaError(
        "Charge d'abord ton CV dans l’onglet Profil."
      );
      return;
    }
    if (!selectedExpIndex) {
      setQaError("Sélectionne d'abord une expérience.");
      return;
    }

    const index = parseInt(selectedExpIndex, 10);
    if (Number.isNaN(index) || !experiences[index]) {
      setQaError("Expérience invalide.");
      return;
    }

    setQaError(null);
    setQaLoading(true);

    try {
      let result: GenerateInterviewQAResult;

      try {
        result = await callGenerateInterviewQA({
          profile,
          experienceIndex: index,
          lang: qaLang,
        });
      } catch (err: any) {
        console.error(
          "Erreur callGenerateInterviewQA:",
          err
        );
        setQaPairs([]);
        setQaError(
          err?.message ||
            "Erreur pendant la génération des questions (appel serveur)."
        );
        return;
      }

      const rawQuestions: any[] = Array.isArray(
        result.questions
      )
        ? result.questions
        : [];

      if (!rawQuestions.length) {
        console.error(
          "Réponse generateInterviewQA inattendue:",
          result
        );
        setQaPairs([]);
        setQaError(
          "L'IA n'a pas renvoyé de questions exploitables. Vérifie que l'expérience contient bien des missions/bullets, ou réessaie plus tard."
        );
        return;
      }

      const mapped: QaPair[] = rawQuestions.map(
        (q: any, idx: number) => ({
          question:
            (q?.question ??
              q?.q ??
              `Question ${idx + 1}`) + "",
          answer: (q?.answer ?? q?.a ?? "") + "",
        })
      );

      setQaPairs(mapped);
      setCopiedIndex(null);
    } catch (err: any) {
      console.error("handleGenerateQA error:", err);
      setQaError(
        err?.message ||
          "Erreur inattendue pendant la génération des questions."
      );
      setQaPairs([]);
    } finally {
      setQaLoading(false);
    }
  };

  const handleCopyOne = async (idx: number) => {
    const qa = qaPairs[idx];
    if (!qa) return;

    const text = `Q: ${qa.question}\n\nR: ${qa.answer}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedIndex(idx);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch (e) {
      console.error(e);
      alert("Impossible de copier automatiquement le texte.");
    }
  };

  const handleCopyAll = async () => {
    if (!qaPairs.length) return;
    const text = qaPairs
      .map(
        (qa, i) =>
          `Q${i + 1}. ${qa.question}\nR${i + 1}. ${
            qa.answer
          }\n`
      )
      .join("\n");

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedIndex(-1);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch (e) {
      console.error(e);
      alert("Impossible de copier automatiquement le texte.");
    }
  };

  // ÉTATS GLOBALS PAGE
  if (loadingProfile) {
    return (
      <div className="max-w-5xl mx-auto glass p-6 rounded-2xl">
        <p className="text-sm text-[var(--muted)]">
          Chargement de ton profil CV...
        </p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-5xl mx-auto glass p-6 rounded-2xl space-y-3">
        {loadError && (
          <p className="text-sm text-[var(--danger)]">
            {loadError}
          </p>
        )}
        <h1 className="text-xl font-semibold">
          Commence par analyser ton CV 📄
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Va dans l&apos;onglet{" "}
          <span className="font-semibold">Profil CV</span> pour
          uploader ton CV. L&apos;IA utilisera ensuite ces
          informations pour générer des questions / réponses et
          simuler des entretiens.
        </p>
      </div>
    );
  }

  // PAGE PRINCIPALE
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header général */}
      <header className="glass rounded-2xl p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold mb-1">
              Préparer ton entretien 🎤
            </h1>
            <p className="text-sm text-[var(--muted)]">
              Utilise l&apos;IA pour générer des questions /
              réponses à partir de ton CV, puis entraîne-toi en
              conditions réelles avec un simulateur d&apos;entretien
              (texte + voix).
            </p>
          </div>
          <div className="text-right text-xs text-[var(--muted)]">
            <p className="font-semibold">
              {profile.fullName || "Profil"}
            </p>
            <p>
              {profile.profileHeadline ||
                profile.title ||
                "Candidat"}
            </p>
            {profile.city && <p>{profile.city}</p>}
          </div>
        </div>
      </header>

      {/* Bloc 1 : Génération Q/R à partir d'une expérience */}
      <section className="glass rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              Questions / Réponses sur une expérience
            </h2>
            <p className="text-xs text-[var(--muted)]">
              Choisis une expérience de ton CV. L&apos;assistant
              générera des questions ciblées (missions, résultats,
              compétences) avec des exemples de réponses.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--muted)]">
              Langue
            </span>
            <select
              value={qaLang}
              onChange={(e) =>
                setQaLang(
                  e.target.value === "en" ? "en" : "fr"
                )
              }
              className="select-brand text-xs"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        {experiences.length === 0 && (
          <p className="text-xs text-[var(--danger)]">
            Ton profil ne contient aucune expérience. Vérifie que
            l&apos;analyse de ton CV a bien détecté tes postes
            (section &quot;experiences&quot; dans le document
            Firestore{" "}
            <code>profiles/{user?.uid}</code>).
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            Expérience
          </label>
          <select
            className="select-brand w-full text-sm"
            value={selectedExpIndex}
            onChange={(e) =>
              setSelectedExpIndex(e.target.value)
            }
          >
            <option value="">
              -- Sélectionne une expérience --
            </option>
            {experiences.map((exp, idx) => {
              const role =
                exp.role || exp.title || "Poste";
              const company =
                exp.company || "Entreprise";
              const dates = exp.dates || "";
              const city =
                exp.city || exp.location || "";
              return (
                <option
                  key={idx}
                  value={idx.toString()}
                >
                  {role} — {company}{" "}
                  {dates && `(${dates})`}{" "}
                  {city && `· ${city}`}
                </option>
              );
            })}
          </select>
        </div>

        {qaError && (
          <p className="text-xs text-[var(--danger)] whitespace-pre-line">
            {qaError}
          </p>
        )}

        <div className="flex justify-center">
          <button
            type="button"
            className="btn-primary min-w-[200px]"
            onClick={handleGenerateQA}
            disabled={qaLoading || !experiences.length}
          >
            {qaLoading
              ? qaLang === "en"
                ? "Generating..."
                : "Génération en cours..."
              : "Générer les questions ✨"}
          </button>
        </div>

        {/* Liste Q&A */}
        <div className="mt-2 p-4 card-soft rounded-xl max-h-[420px] overflow-auto text-sm">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h3 className="text-sm font-semibold">
              Questions d&apos;entretien générées
            </h3>
            <button
              type="button"
              className="btn-secondary text-[11px] px-3 py-1"
              onClick={handleCopyAll}
              disabled={!qaPairs.length}
            >
              {copiedIndex === -1
                ? "Tout copié ✔"
                : "Copier tout"}
            </button>
          </div>

          {qaLoading ? (
            <p className="text-center text-[var(--muted)]">
              {qaLang === "en"
                ? "Generating interview questions..."
                : "Génération des questions en cours..."}
            </p>
          ) : !qaPairs.length ? (
            <p className="text-center text-[var(--muted)]">
              Les questions apparaîtront ici après la
              génération. Utilise-les pour t&apos;entraîner à
              répondre à l&apos;oral (méthode STAR, résultats
              concrets, etc.).
            </p>
          ) : (
            <div className="space-y-4">
              {qaPairs.map((qa, idx) => (
                <div
                  key={idx}
                  className="border border-[var(--border-soft)] rounded-xl p-3 bg-black/20"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="font-semibold text-sm">
                      Q{idx + 1}. {qa.question}
                    </p>
                    <button
                      type="button"
                      className="btn-secondary text-[10px] px-2 py-1"
                      onClick={() =>
                        handleCopyOne(idx)
                      }
                    >
                      {copiedIndex === idx
                        ? "Copié ✔"
                        : "Copier Q/R"}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--muted)] whitespace-pre-line">
                    {qa.answer}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Bloc 2 : Simulateur d'entretien IA (texte + voix) */}
      {/* ⚠️ InterviewChat contient déjà tout le layout (header, glass, etc.) */}
      <InterviewChat />
    </div>
  );
}
