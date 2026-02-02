"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Copy,
  Check,
  Mic,
  FileText,
  LayoutList,
  Play,
  Loader2,
  Settings2,
  Wifi,
  Briefcase,
  UserCircle2,
  Clock,
  BrainCircuit,
  ChevronRight,
  Trophy,
  RotateCcw,
  CheckCircle2,
} from "lucide-react";

import { callGenerateInterviewQA } from "@/lib/gemini";
import InterviewChat, { SimConfig, InterviewResult } from "@/components/InterviewChat";
import { getRecaptchaToken, warmupRecaptcha } from "@/lib/recaptcha";

// --- TYPES ---
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

type QaPair = { question: string; answer: string };
type ViewMode = "qa" | "simulator";
type SimStep = "config" | "chat" | "result";

// --- ASSETS ---
const RECRUITER_IMAGES = {
  man: "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=400&q=80",
  woman: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80",
};

type PersistedUIV1 = {
  v: 1;
  ts: number;
  viewMode: ViewMode;
  simStep: SimStep;
  activeSimulation: SimConfig | null;
  simConfig: SimConfig;
  simResult: InterviewResult | null;
};

export default function InterviewPage() {
  const { user } = useAuth();

  // --- STATES ---
  const [profile, setProfile] = useState<ProfileLike | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("qa");
  const [simStep, setSimStep] = useState<SimStep>("config");
  const [activeSimulation, setActiveSimulation] = useState<SimConfig | null>(null);

  const [simResult, setSimResult] = useState<InterviewResult | null>(null);

  const [endSignal, setEndSignal] = useState(0);
  const [ending, setEnding] = useState(false);

  const [simConfig, setSimConfig] = useState<SimConfig>({
    jobTitle: "",
    jobDesc: "",
    type: "complet",
    difficulty: "standard",
    recruiter: "man",
  });

  // Q&A
  const [qaLang, setQaLang] = useState<"fr" | "en">("fr");
  const [selectedExpIndex, setSelectedExpIndex] = useState<string>("");
  const [qaLoading, setQaLoading] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaPairs, setQaPairs] = useState<QaPair[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // --- STORAGE KEYS ---
  const uiStorageKey = useMemo(() => (user?.uid ? `acv-interview-ui:${user.uid}` : null), [user?.uid]);
  const sessionStorageKey = useMemo(() => (user?.uid ? `acv-interview-session:${user.uid}` : null), [user?.uid]);

  useEffect(() => {
    warmupRecaptcha().catch(() => {});
  }, []);

  // Fetch profile
  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) {
        setProfile(null);
        setLoadingProfile(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (snap.exists()) {
          const data = snap.data() as ProfileLike;
          setProfile(data);

          if (data.title || data.profileHeadline) {
            setSimConfig((prev) => ({
              ...prev,
              jobTitle: (data.title || data.profileHeadline || "").toString(),
            }));
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingProfile(false);
      }
    };
    fetchProfile();
  }, [user]);

  // Restore UI state AFTER profile loaded (so jobTitle default doesn't override)
  useEffect(() => {
    if (!uiStorageKey) return;
    if (loadingProfile) return;

    try {
      const raw = localStorage.getItem(uiStorageKey);
      if (!raw) return;

      const saved: PersistedUIV1 = JSON.parse(raw);
      if (!saved || saved.v !== 1) return;

      // TTL 24h
      if (saved.ts && Date.now() - saved.ts > 24 * 60 * 60 * 1000) {
        localStorage.removeItem(uiStorageKey);
        return;
      }

      setViewMode(saved.viewMode ?? "qa");
      setSimStep(saved.simStep ?? "config");
      setActiveSimulation(saved.activeSimulation ?? null);
      setSimConfig(saved.simConfig ?? simConfig);
      setSimResult(saved.simResult ?? null);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiStorageKey, loadingProfile]);

  // Save UI state continuously
  useEffect(() => {
    if (!uiStorageKey) return;
    try {
      const payload: PersistedUIV1 = {
        v: 1,
        ts: Date.now(),
        viewMode,
        simStep,
        activeSimulation,
        simConfig,
        simResult,
      };
      localStorage.setItem(uiStorageKey, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [uiStorageKey, viewMode, simStep, activeSimulation, simConfig, simResult]);

  const experiences: ExperienceLike[] = useMemo(() => {
    if (!profile) return [];
    const possible = (profile.experiences as any) ?? (profile.experience as any) ?? [];
    return Array.isArray(possible) ? possible : [];
  }, [profile]);

  // --- Q&A HANDLERS ---
  const handleGenerateQA = async () => {
    if (!profile || !selectedExpIndex) return;
    const index = parseInt(selectedExpIndex, 10);
    if (Number.isNaN(index) || !experiences[index]) {
      setQaError("Expérience invalide.");
      return;
    }
    setQaError(null);
    setQaLoading(true);

    try {
      const recaptchaToken = await getRecaptchaToken("generate_interview_qa");
      const idToken = user ? await user.getIdToken() : undefined;

      const result = await callGenerateInterviewQA({
        profile,
        experienceIndex: index,
        lang: qaLang,
        recaptchaToken,
        idToken,
      });

      const rawQuestions: any[] = Array.isArray(result.questions) ? result.questions : [];
      if (!rawQuestions.length) throw new Error("Aucune question générée.");

      const mapped: QaPair[] = rawQuestions.map((q: any, idx: number) => ({
        question: (q?.question ?? q?.q ?? `Question ${idx + 1}`) + "",
        answer: (q?.answer ?? q?.a ?? "") + "",
      }));

      setQaPairs(mapped);
    } catch (err: any) {
      setQaError(err?.message || "Erreur lors de la génération.");
    } finally {
      setQaLoading(false);
    }
  };

  const copyText = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {}
  };

  // --- SIMULATION FLOW ---
  const startSimulation = () => {
    const title = simConfig.jobTitle.trim();
    if (!title) {
      alert("Veuillez renseigner au moins le poste visé.");
      return;
    }

    setSimResult(null);
    setEnding(false);
    setEndSignal(0);

    const cfg: SimConfig = { ...simConfig, jobTitle: title };
    setActiveSimulation(cfg);
    setSimStep("chat");
    setViewMode("simulator");
  };

  const requestFinishSimulation = () => {
    if (ending) return;
    setEnding(true);
    setEndSignal((s) => s + 1);
  };

  const resetSimulation = () => {
    setSimStep("config");
    setActiveSimulation(null);
    setSimResult(null);
    setEnding(false);
    setEndSignal(0);

    if (uiStorageKey) {
      try {
        localStorage.removeItem(uiStorageKey);
      } catch {}
    }
    if (sessionStorageKey) {
      try {
        localStorage.removeItem(sessionStorageKey);
      } catch {}
    }
  };

  // --- RENDER ---
  if (loadingProfile) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-xl text-center py-20 bg-[var(--bg)] border border-[var(--border)] rounded-2xl shadow-sm mt-10">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-blue-50 text-blue-600 mb-4">
          <FileText className="h-7 w-7" />
        </div>
        <h2 className="text-xl font-bold text-[var(--ink)] mb-2">Profil requis</h2>
        <p className="text-sm text-[var(--muted)] px-6">
          Veuillez remplir votre CV dans l&apos;onglet &quot;Profil&quot; avant d&apos;utiliser l&apos;entraînement.
        </p>
      </div>
    );
  }

  const durationMin =
    simResult && simResult.startedAt && simResult.endedAt
      ? Math.max(1, Math.round((simResult.endedAt - simResult.startedAt) / 60000))
      : null;

  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 relative z-10">
      <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
        {/* HEADER & TABS */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-[var(--border)]">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--ink)]">Entraînement &amp; Simulation</h1>
            <p className="text-sm text-[var(--muted)] mt-1 max-w-lg">
              Préparez-vous avec des questions ciblées ou passez une simulation réaliste.
            </p>
          </div>

          <div className="bg-[var(--bg-soft)] p-1 rounded-xl border border-[var(--border)] inline-flex">
            <button
              onClick={() => {
                setViewMode("qa");
                // ⚠️ on ne reset PAS automatiquement quand on switch, sinon on casse la reprise
                // Si tu veux reset, utilise le bouton "Recommencer" / "Reset" uniquement.
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                viewMode === "qa"
                  ? "bg-[var(--bg)] text-blue-600 shadow-sm border border-[var(--border)]/50"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              <LayoutList className="h-4 w-4" />
              Générateur Q&amp;A
            </button>

            <button
              onClick={() => setViewMode("simulator")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                viewMode === "simulator"
                  ? "bg-[var(--bg)] text-emerald-600 shadow-sm border border-[var(--border)]/50"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              <Mic className="h-4 w-4" />
              Simulateur Vocal
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* ===================== MODE Q&A ===================== */}
          {viewMode === "qa" && (
            <motion.div
              key="qa-view"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid lg:grid-cols-12 gap-8 items-start"
            >
              {/* GAUCHE */}
              <div className="lg:col-span-4 space-y-6">
                <div className="p-5 rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-sm">
                  <div className="flex items-center gap-3 mb-6 pb-4 border-b border-[var(--border)]/50">
                    <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <h3 className="font-semibold text-sm">Paramètres Q&amp;A</h3>
                  </div>

                  <div className="space-y-5">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Langue</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setQaLang("fr")}
                          className={`py-2 text-xs font-medium rounded-lg border transition-all ${
                            qaLang === "fr"
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-[var(--border)] text-[var(--muted)]"
                          }`}
                        >
                          Français 🇫🇷
                        </button>
                        <button
                          onClick={() => setQaLang("en")}
                          className={`py-2 text-xs font-medium rounded-lg border transition-all ${
                            qaLang === "en"
                              ? "border-blue-500 bg-blue-50 text-blue-700"
                              : "border-[var(--border)] text-[var(--muted)]"
                          }`}
                        >
                          English 🇬🇧
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">Expérience Cible</label>
                      <div className="relative">
                        <select
                          value={selectedExpIndex}
                          onChange={(e) => setSelectedExpIndex(e.target.value)}
                          className="w-full appearance-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                          <option value="">Choisir une expérience…</option>
                          {experiences.map((exp, idx) => (
                            <option key={idx} value={idx}>
                              {exp.role || "Poste"} chez {exp.company || "Entreprise"}
                            </option>
                          ))}
                        </select>
                        <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)] rotate-90 pointer-events-none" />
                      </div>
                    </div>

                    <button
                      onClick={handleGenerateQA}
                      disabled={qaLoading || !selectedExpIndex}
                      className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2"
                    >
                      {qaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                      {qaLoading ? "Analyse..." : "Générer les Questions"}
                    </button>

                    {qaError && <div className="p-3 bg-red-50 text-red-600 border border-red-100 rounded-lg text-xs">{qaError}</div>}
                  </div>
                </div>
              </div>

              {/* DROITE */}
              <div className="lg:col-span-8">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg)] min-h-[500px] flex flex-col shadow-sm">
                  <div className="p-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--bg-soft)]/30">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[var(--muted)]" />
                      <span className="text-sm font-semibold">Questions générées</span>
                      <span className="text-xs text-[var(--muted)] bg-[var(--border)]/50 px-2 py-0.5 rounded-full">{qaPairs.length}</span>
                    </div>
                    {qaPairs.length > 0 && (
                      <button
                        onClick={() => copyText(qaPairs.map((q, i) => `Q${i + 1}: ${q.question}\nR: ${q.answer}`).join("\n\n"), -1)}
                        className="text-xs flex items-center gap-1 text-[var(--muted)] hover:text-blue-600 transition-colors"
                      >
                        {copiedIndex === -1 ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copiedIndex === -1 ? "Copié" : "Tout copier"}
                      </button>
                    )}
                  </div>

                  <div className="flex-1 p-6 bg-[var(--bg-page)]/50">
                    {qaLoading ? (
                      <div className="h-full flex flex-col items-center justify-center text-[var(--muted)] gap-4">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                        <p className="text-sm">L&apos;IA analyse votre expérience...</p>
                      </div>
                    ) : qaPairs.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-[var(--muted)] gap-4 opacity-60">
                        <div className="h-16 w-16 rounded-2xl bg-[var(--border)]/30 flex items-center justify-center">
                          <LayoutList className="h-8 w-8" />
                        </div>
                        <p className="text-sm">Sélectionnez une expérience pour commencer</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {qaPairs.map((qa, idx) => (
                          <motion.div
                            key={idx}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                            className="p-5 rounded-xl bg-[var(--bg)] border border-[var(--border)] hover:border-blue-500/30 transition-colors group relative"
                          >
                            <div className="pr-8">
                              <h4 className="text-sm font-bold text-[var(--ink)] mb-2 flex gap-2">
                                <span className="text-blue-500 font-mono text-xs mt-0.5">Q{idx + 1}</span>
                                {qa.question}
                              </h4>
                              <p className="text-xs text-[var(--muted)] leading-relaxed pl-6 border-l-2 border-[var(--border)]">{qa.answer}</p>
                            </div>
                            <button
                              onClick={() => copyText(`Q: ${qa.question}\n\nR: ${qa.answer}`, idx)}
                              className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--muted)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-soft)] transition-all"
                            >
                              {copiedIndex === idx ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ===================== MODE SIMULATEUR ===================== */}
          {viewMode === "simulator" && (
            <motion.div
              key="sim-view"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="w-full"
            >
              {/* --- STEPPER --- */}
              <div className="max-w-2xl mx-auto mb-8 flex items-center justify-between relative">
                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-[var(--border)] -z-10" />
                {[
                  { id: "config" as const, label: "Initialisation", icon: Settings2 },
                  { id: "chat" as const, label: "Entretien", icon: Mic },
                  { id: "result" as const, label: "Bilan", icon: Trophy },
                ].map((step, idx) => {
                  const isActive = simStep === step.id;
                  const isDone = simStep === "result" ? idx < 2 : simStep === "chat" ? idx === 0 : false;

                  return (
                    <div key={step.id} className="flex flex-col items-center gap-2 bg-[var(--bg)] px-2">
                      <div
                        className={`
                          w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all
                          ${isActive ? "border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-500/30" : ""}
                          ${isDone ? "border-emerald-500 bg-emerald-500/10 text-emerald-500" : ""}
                          ${!isActive && !isDone ? "border-[var(--border)] bg-[var(--bg-soft)] text-[var(--muted)]" : ""}
                        `}
                      >
                        {isDone ? <CheckCircle2 className="w-5 h-5" /> : <step.icon className="w-5 h-5" />}
                      </div>
                      <span className={`text-xs font-bold ${isActive ? "text-[var(--ink)]" : "text-[var(--muted)]"}`}>{step.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* STEP 1: CONFIG */}
              {simStep === "config" && (
                <div className="max-w-4xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
                  <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden">
                    <div className="p-8 bg-[var(--bg-page)]/50 border-b border-[var(--border)] text-center">
                      <h2 className="text-2xl font-bold text-[var(--ink)] tracking-tight">Paramètres de la session</h2>
                      <p className="text-sm text-[var(--muted)] mt-1">Configurez le rôle de l&apos;IA avant de commencer.</p>
                    </div>

                    <div className="p-8 grid md:grid-cols-2 gap-10">
                      {/* Left */}
                      <div className="space-y-6">
                        <div className="space-y-3">
                          <label className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider flex items-center gap-2">
                            <Briefcase className="h-3 w-3" /> Poste Visé
                          </label>
                          <input
                            className="w-full h-11 bg-[var(--bg-soft)] border border-[var(--border)] rounded-xl px-4 text-sm text-[var(--ink)] focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all"
                            value={simConfig.jobTitle}
                            onChange={(e) => setSimConfig({ ...simConfig, jobTitle: e.target.value })}
                            placeholder="Ex : Développeur React..."
                          />
                        </div>

                        <div className="space-y-3">
                          <label className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider flex items-center gap-2">
                            <FileText className="h-3 w-3" /> Contexte (Optionnel)
                          </label>
                          <textarea
                            className="w-full bg-[var(--bg-soft)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--ink)] focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all min-h-[140px] resize-none"
                            placeholder="Collez ici une description de poste ou des consignes spécifiques..."
                            value={simConfig.jobDesc}
                            onChange={(e) => setSimConfig({ ...simConfig, jobDesc: e.target.value })}
                          />
                        </div>
                      </div>

                      {/* Right */}
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <label className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider flex items-center gap-2">
                              <Clock className="h-3 w-3" /> Type
                            </label>
                            <div className="relative">
                              <select
                                className="w-full h-11 appearance-none bg-[var(--bg-soft)] border border-[var(--border)] rounded-xl px-3 text-sm text-[var(--ink)] outline-none focus:border-emerald-500 transition-all cursor-pointer"
                                value={simConfig.type}
                                onChange={(e) => setSimConfig({ ...simConfig, type: e.target.value as SimConfig["type"] })}
                              >
                                <option value="complet">Complet</option>
                                <option value="rapide">Flash (10min)</option>
                                <option value="technique">Technique</option>
                                <option value="comportemental">Soft Skills</option>
                              </select>
                              <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)] rotate-90 pointer-events-none" />
                            </div>
                          </div>

                          <div className="space-y-3">
                            <label className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider flex items-center gap-2">
                              <BrainCircuit className="h-3 w-3" /> Difficulté
                            </label>
                            <div className="relative">
                              <select
                                className="w-full h-11 appearance-none bg-[var(--bg-soft)] border border-[var(--border)] rounded-xl px-3 text-sm text-[var(--ink)] outline-none focus:border-emerald-500 transition-all cursor-pointer"
                                value={simConfig.difficulty}
                                onChange={(e) =>
                                  setSimConfig({ ...simConfig, difficulty: e.target.value as SimConfig["difficulty"] })
                                }
                              >
                                <option value="facile">Débutant</option>
                                <option value="standard">Standard</option>
                                <option value="difficile">Expert</option>
                              </select>
                              <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--muted)] rotate-90 pointer-events-none" />
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3">
                          <label className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider flex items-center gap-2">
                            <UserCircle2 className="h-3 w-3" /> Recruteur
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            {(["man", "woman"] as const).map((gender) => (
                              <button
                                key={gender}
                                type="button"
                                onClick={() => setSimConfig({ ...simConfig, recruiter: gender })}
                                className={`relative overflow-hidden flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                                  simConfig.recruiter === gender
                                    ? "bg-emerald-500/5 border-emerald-500 ring-1 ring-emerald-500/20"
                                    : "bg-[var(--bg-soft)] border-[var(--border)] hover:border-[var(--muted)]"
                                }`}
                              >
                                <div className="h-10 w-10 rounded-full bg-white overflow-hidden border border-black/5">
                                  <img src={RECRUITER_IMAGES[gender]} alt={gender} className="w-full h-full object-cover" />
                                </div>
                                <div>
                                  <p className={`text-xs font-bold ${simConfig.recruiter === gender ? "text-emerald-600" : "text-[var(--ink)]"}`}>
                                    {gender === "man" ? "Thomas" : "Sarah"}
                                  </p>
                                  <p className="text-[10px] text-[var(--muted)]">{gender === "man" ? "Direct" : "Bienveillant"}</p>
                                </div>
                                {simConfig.recruiter === gender && (
                                  <div className="absolute top-2 right-2 text-emerald-500">
                                    <Check className="h-3 w-3" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="pt-4 flex gap-3">
                          <button
                            onClick={startSimulation}
                            className="flex-1 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
                          >
                            <span>Lancer l&apos;entretien</span>
                            <div className="bg-white/20 p-1 rounded-md">
                              <ChevronRight className="h-3 w-3" />
                            </div>
                          </button>

                          <button
                            onClick={resetSimulation}
                            className="h-12 px-5 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--ink)] font-bold hover:bg-[var(--bg-soft)]/70 transition"
                            title="Reset total (supprime la reprise)"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: CHAT */}
              {simStep === "chat" && activeSimulation && (
                <div className="h-[calc(100vh-200px)] min-h-[600px] flex flex-col animate-in slide-in-from-right duration-300">
                  <div className="grid lg:grid-cols-3 gap-6 flex-1">
                    {/* LEFT */}
                    <div className="lg:col-span-1 flex flex-col gap-4">
                      <div className="relative flex-1 rounded-3xl overflow-hidden bg-black shadow-2xl border border-[var(--border)]">
                        <img
                          src={activeSimulation.recruiter === "man" ? RECRUITER_IMAGES.man : RECRUITER_IMAGES.woman}
                          alt="Recruteur"
                          className="absolute inset-0 w-full h-full object-cover opacity-80"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />

                        <div className="absolute top-4 left-4 flex gap-2">
                          <div className="px-2 py-1 rounded-full bg-red-500/20 backdrop-blur-md border border-red-500/30 flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                            <span className="text-[10px] font-bold text-red-100 uppercase">En ligne</span>
                          </div>
                        </div>

                        <div className="absolute bottom-6 left-6 right-6">
                          <h3 className="text-white font-bold text-lg">{activeSimulation.recruiter === "man" ? "Thomas" : "Sarah"}</h3>
                          <p className="text-white/70 text-sm mb-4">Recruteur IA • {activeSimulation.jobTitle}</p>
                          <div className="flex items-end gap-1 h-8 opacity-80">
                            {[...Array(5)].map((_, i) => (
                              <motion.div
                                key={i}
                                animate={{ height: ["20%", "80%", "40%"] }}
                                transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.1 }}
                                className="w-1.5 bg-emerald-400 rounded-full"
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={requestFinishSimulation}
                        disabled={ending}
                        className="w-full py-3 rounded-xl bg-red-500/10 text-red-600 border border-red-500/20 text-sm font-bold hover:bg-red-500/20 transition-colors disabled:opacity-60"
                      >
                        {ending ? "Génération du bilan..." : "Terminer l&apos;appel"}
                      </button>
                    </div>

                    {/* RIGHT */}
                    <div className="lg:col-span-2 rounded-3xl border border-[var(--border)] bg-[var(--bg)] overflow-hidden shadow-sm flex flex-col">
                      <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-soft)]/50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Wifi className="h-4 w-4 text-emerald-500" />
                          <span className="text-xs font-medium text-[var(--muted)]">Connexion stable</span>
                        </div>
                        <Settings2 className="h-4 w-4 text-[var(--muted)]" />
                      </div>

                      <div className="flex-1 bg-[var(--bg-page)]/30 relative p-4">
                        <InterviewChat
                          key={`${activeSimulation.jobTitle}-${activeSimulation.type}-${activeSimulation.difficulty}-${activeSimulation.recruiter}`}
                          initialConfig={activeSimulation}
                          endSignal={endSignal}
                          onFinish={(result) => {
                            setSimResult(result);
                            setEnding(false);
                            setSimStep("result");
                          }}
                          autoListen
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: RESULT */}
              {simStep === "result" && (
                <div className="max-w-2xl mx-auto text-center py-20 animate-in zoom-in duration-300">
                  <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
                    <Trophy className="w-12 h-12 text-emerald-600" />
                  </div>

                  <h2 className="text-3xl font-bold text-[var(--ink)] mb-4">Entretien Terminé !</h2>
                  <p className="text-[var(--muted)] mb-8 max-w-md mx-auto">Voici ton bilan. Tu peux recommencer une session quand tu veux.</p>

                  <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-6">
                    <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-soft)]">
                      <p className="text-[10px] text-[var(--muted)] uppercase">Durée</p>
                      <p className="text-xl font-bold text-[var(--ink)]">{durationMin ? `~${durationMin} min` : "—"}</p>
                    </div>
                    <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-soft)]">
                      <p className="text-[10px] text-[var(--muted)] uppercase">Questions</p>
                      <p className="text-xl font-bold text-[var(--ink)]">{simResult?.questionsAsked ?? "—"}</p>
                    </div>
                  </div>

                  <div className="text-left rounded-2xl border border-[var(--border)] bg-[var(--bg)] p-5 max-w-xl mx-auto space-y-3">
                    <div className="text-sm font-semibold text-[var(--ink)]">Bilan</div>

                    {typeof simResult?.finalScore === "number" && (
                      <div className="text-sm">
                        <span className="font-semibold">Note :</span> {Math.round(simResult.finalScore)}/100
                      </div>
                    )}

                    {simResult?.finalDecision && (
                      <div className="text-sm whitespace-pre-line">
                        <span className="font-semibold">Décision probable :</span> {simResult.finalDecision}
                      </div>
                    )}

                    {simResult?.finalSummary && (
                      <div className="text-sm whitespace-pre-line">
                        <span className="font-semibold">Synthèse :</span> {simResult.finalSummary}
                      </div>
                    )}

                    {!simResult && <div className="text-sm text-[var(--muted)]">Aucun bilan disponible.</div>}
                  </div>

                  <div className="flex gap-3 justify-center mt-10">
                    <button onClick={resetSimulation} className="btn-secondary flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" /> Recommencer
                    </button>

                    <button onClick={() => setViewMode("qa")} className="btn-primary flex items-center gap-2">
                      <LayoutList className="w-4 h-4" /> Voir Q&amp;A
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
