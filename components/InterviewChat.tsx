// components/InterviewChat.tsx
"use client";

import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";

// ✅ AJOUT reCAPTCHA
import { tryGetRecaptchaToken } from "@/lib/recaptcha";

type Message = {
  role: "interviewer" | "candidate" | "system";
  text: string;
};

type InterviewMode = "complet" | "rapide" | "technique" | "comportemental";
type Difficulty = "facile" | "standard" | "difficile";
type VoiceProfileId = "femme" | "homme";
type RecruiterGender = "f" | "m";

const INTERVIEW_QUESTION_PLAN: Record<InterviewMode, number> = {
  complet: 8,
  rapide: 4,
  technique: 6,
  comportemental: 6,
};

const VOICE_PROFILES: Record<
  VoiceProfileId,
  { label: string; pitch: number; rate: number }
> = {
  femme: {
    label: "Voix féminine",
    pitch: 1.1,
    rate: 1.0,
  },
  homme: {
    label: "Voix masculine",
    pitch: 0.9,
    rate: 0.98,
  },
};

const AVG_MIN_PER_QUESTION = 1.5;

// ✅ reCAPTCHA action unique attendue côté serveur (Cloud Function + /api/interview)
const RECAPTCHA_ACTION = "interview";

// --- Helper : récup nom côté client (Firebase Auth) ---
const getCandidateNameFromAuth = (user: any): string | null => {
  if (!user) return null;
  const possible =
    user.displayName ||
    user.fullName ||
    user.name ||
    user.email?.split("@")[0] ||
    "";
  const trimmed = (possible || "").toString().trim();
  return trimmed || null;
};

// --- Helper : nettoie & personnalise les questions contenant [Nom du candidat...] ---
const personalizeQuestionClient = (
  raw: string | null | undefined,
  user: any
): string => {
  if (!raw) return "";
  let q = raw;

  const safeName = getCandidateNameFromAuth(user) || "";
  const firstName = safeName.split(" ")[0] || safeName;

  if (safeName) {
    q = q.replace(/\[Nom du candidat[^\]]*\]/gi, safeName);
    q = q.replace(/\[Prénom du candidat[^\]]*\]/gi, firstName);
    q = q.replace(/\[Name of the candidate[^\]]*\]/gi, safeName);
    q = q.replace(/\[First name of the candidate[^\]]*\]/gi, firstName);
  } else {
    q = q.replace(/\[Nom du candidat[^\]]*\]/gi, "");
    q = q.replace(/\[Prénom du candidat[^\]]*\]/gi, "");
    q = q.replace(/\[Name of the candidate[^\]]*\]/gi, "");
    q = q.replace(/\[First name of the candidate[^\]]*\]/gi, "");
  }

  q = q.replace(/\s+,/g, ",");
  q = q.replace(/\s{2,}/g, " ").trim();
  q = q.replace(/^,\s*/, "");
  q = q.replace(/^Bonjour\s*,/i, "Bonjour,");
  q = q.replace(/^Bonjour\s+$/, "Bonjour,");

  return q.trim();
};

export default function InterviewChat() {
  const { user } = useAuth();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  const [jobTitle, setJobTitle] = useState("");
  const [jobDesc, setJobDesc] = useState("");
  const [interviewMode, setInterviewMode] =
    useState<InterviewMode>("complet");
  const [difficulty, setDifficulty] = useState<Difficulty>("standard");

  const [voiceProfile, setVoiceProfile] =
    useState<VoiceProfileId>("femme");
  const [recruiterGender, setRecruiterGender] =
    useState<RecruiterGender>("f");

  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(
    INTERVIEW_QUESTION_PLAN["complet"]
  );

  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [recognitionSupported, setRecognitionSupported] =
    useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  const [finalSummary, setFinalSummary] = useState<string | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [finalDecision, setFinalDecision] = useState<string | null>(null);

  const [typing, setTyping] = useState(false);
  const [typingIndex, setTypingIndex] = useState(0);

  const chatRef = useRef<HTMLDivElement | null>(null);

  // ✅ Helper fetch /api/interview + reCAPTCHA
  const postInterview = async (payload: any) => {
    const recaptchaToken = await tryGetRecaptchaToken(RECAPTCHA_ACTION).catch(
      () => null
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (recaptchaToken) headers["X-Recaptcha-Token"] = recaptchaToken;

    const body = {
      ...payload,
      recaptchaToken: recaptchaToken || undefined,
      recaptchaAction: RECAPTCHA_ACTION,
    };

    const res = await fetch("/api/interview", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const contentType = res.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await res.json().catch(() => null)
      : await res.text().catch(() => "");

    if (!res.ok) {
      const errMsg =
        typeof data === "object" && data
          ? data.error ||
            `HTTP ${res.status}` +
              (data.details ? ` — ${JSON.stringify(data.details)}` : "")
          : typeof data === "string"
          ? data || `HTTP ${res.status}`
          : `HTTP ${res.status}`;

      throw new Error(errMsg);
    }

    return data;
  };

  // --- INIT VOIX (TTS) ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("speechSynthesis" in window) {
      setSpeechSupported(true);
    } else {
      setSpeechSupported(false);
    }
  }, []);

  // --- AUTO-SCROLL DU CHAT ---
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [history, loading]);

  const lastInterviewerIndex =
    history.length > 0
      ? [...history]
          .map((m, i) => ({ m, i }))
          .reverse()
          .find(({ m }) => m.role === "interviewer")?.i ?? -1
      : -1;

  const lastInterviewerMessage =
    lastInterviewerIndex >= 0
      ? history[lastInterviewerIndex]?.text || ""
      : "";

  // --- TYPEWRITER ---
  useEffect(() => {
    if (!typing) return;
    if (lastInterviewerIndex === -1) return;
    const msg = history[lastInterviewerIndex];
    if (!msg) return;

    if (typingIndex >= msg.text.length) {
      setTyping(false);
      return;
    }

    const interval = setInterval(() => {
      setTypingIndex((prev) => prev + 2);
    }, 15);

    return () => clearInterval(interval);
  }, [typing, typingIndex, history, lastInterviewerIndex]);

  // --- BEEP MIC ---
  const playMicBeep = () => {
    try {
      const W = window as any;
      const AudioContext =
        W.AudioContext || W.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 1000;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      setTimeout(() => {
        osc.stop();
        ctx.close();
      }, 120);
    } catch (e) {
      console.warn("Impossible de jouer le beep micro", e);
    }
  };

  // --- PARLER (TTS) ---
  const speak = (text: string) => {
    if (typeof window === "undefined") return;
    const toSpeak = (text || "").trim();
    if (!toSpeak) return;
    if (!("speechSynthesis" in window)) {
      console.warn("speechSynthesis non supporté");
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(toSpeak);
      utterance.lang = "fr-FR";

      const profile = VOICE_PROFILES[voiceProfile];
      if (profile) {
        utterance.pitch = profile.pitch;
        utterance.rate = profile.rate;
      }

      utterance.onstart = () => setAiSpeaking(true);
      utterance.onend = () => setAiSpeaking(false);
      utterance.onerror = (e) => {
        console.error("Erreur TTS:", e);
        setAiSpeaking(false);
      };

      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("Erreur synthèse vocale:", e);
      setAiSpeaking(false);
    }
  };

  // --- PARSE payload backend ---
  const parseInterviewPayload = (raw: any): {
    nextQuestion: string | null;
    shortAnalysis: string | null;
    finalSummary: string | null;
    finalScore: number | null;
  } => {
    let obj: any = raw;

    const tryParseString = (txt: string | null | undefined): any => {
      if (!txt) return null;
      let inner = txt.trim();

      if (inner.startsWith("```")) {
        inner = inner
          .replace(/^```[a-zA-Z]*\s*\n?/, "")
          .replace(/```$/, "")
          .trim();
      }

      try {
        const parsed = JSON.parse(inner);
        return parsed;
      } catch {
        const result: any = {};

        const extractField = (field: string, source: string): string | null => {
          const doubleQuote =
            source.match(
              new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, "s")
            ) ||
            source.match(
              new RegExp(`"${field}"\\s*:\\s*\\"([^"]*)\\"`, "s")
            );
          const singleQuote = source.match(
            new RegExp(`'${field}'\\s*:\\s*'([^']*)'`, "s")
          );
          const m = doubleQuote || singleQuote;
          if (!m) return null;
          return m[1].replace(/\\"/g, '"');
        };

        const nextQ =
          extractField("next_question", inner) ??
          extractField("nextQuestion", inner);
        const shortA =
          extractField("short_analysis", inner) ??
          extractField("shortAnalysis", inner);
        const finalSum =
          extractField("final_summary", inner) ??
          extractField("finalSummary", inner);
        const finalScoreStr =
          extractField("final_score", inner) ??
          extractField("finalScore", inner);

        if (nextQ) result.next_question = nextQ;
        if (shortA) result.short_analysis = shortA;
        if (finalSum) result.final_summary = finalSum;
        if (finalScoreStr) {
          const num = parseFloat(finalScoreStr);
          if (!Number.isNaN(num)) result.final_score = num;
        }

        if (Object.keys(result).length > 0) return result;
        return { next_question: inner };
      }
    };

    if (typeof obj === "string") obj = tryParseString(obj);

    if (obj && typeof obj === "object") {
      if (typeof obj.nextQuestion === "string" && obj.nextQuestion.trim().startsWith("```")) {
        const nested = tryParseString(obj.nextQuestion);
        if (nested && typeof nested === "object") {
          const q = (nested as any).next_question ?? (nested as any).nextQuestion ?? null;
          obj = { ...obj, ...nested, next_question: q ?? obj.next_question, nextQuestion: q ?? obj.nextQuestion };
        }
      }
      if (typeof obj.next_question === "string" && obj.next_question.trim().startsWith("```")) {
        const nested = tryParseString(obj.next_question);
        if (nested && typeof nested === "object") {
          const q = (nested as any).next_question ?? (nested as any).nextQuestion ?? null;
          obj = { ...obj, ...nested, next_question: q ?? obj.next_question, nextQuestion: q ?? obj.nextQuestion };
        }
      }
    }

    const nextQuestionRaw =
      obj?.next_question || obj?.nextQuestion || obj?.question || null;
    const shortAnalysis = obj?.short_analysis || obj?.shortAnalysis || null;
    const finalSummary = obj?.final_summary || obj?.finalSummary || null;
    const finalScoreRaw = obj?.final_score ?? obj?.finalScore ?? null;

    const nextQuestionText =
      typeof nextQuestionRaw === "string" ? nextQuestionRaw.trim() : null;

    let cleanNextQuestion = nextQuestionText;
    if (cleanNextQuestion) {
      cleanNextQuestion = cleanNextQuestion
        .replace(/```[a-zA-Z]*\s*\n?[\s\S]*?```/g, "")
        .trim();
    }

    const scoreNum =
      typeof finalScoreRaw === "number"
        ? finalScoreRaw
        : typeof finalScoreRaw === "string"
        ? parseFloat(finalScoreRaw)
        : null;

    return {
      nextQuestion: cleanNextQuestion,
      shortAnalysis: typeof shortAnalysis === "string" ? shortAnalysis.trim() : null,
      finalSummary: typeof finalSummary === "string" ? finalSummary.trim() : null,
      finalScore: Number.isNaN(scoreNum) ? null : scoreNum,
    };
  };

  // --- START ---
  const startInterview = async () => {
    if (!user) {
      alert("Connecte-toi d'abord pour lancer la simulation.");
      return;
    }

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        const silent = new SpeechSynthesisUtterance(" ");
        silent.volume = 0;
        silent.rate = 1;
        silent.pitch = 1;
        window.speechSynthesis.speak(silent);
      }
    } catch (e) {
      console.warn("Impossible de débloquer TTS", e);
    }

    setLoading(true);
    setHistory([]);
    setFinished(false);
    setFinalSummary(null);
    setFinalScore(null);
    setFinalDecision(null);
    setCurrentQuestionIndex(0);
    setTotalQuestions(INTERVIEW_QUESTION_PLAN[interviewMode]);

    try {
      // ✅ utilise postInterview (avec reCAPTCHA)
      const data = await postInterview({
        action: "start",
        userId: user.uid,
        jobTitle,
        jobDesc,
        interviewMode,
        difficulty,
        channel: "oral",
      });

      const rawFirst =
        (data as any)?.firstQuestion ||
        (data as any)?.first_question ||
        (data as any)?.nextQuestion ||
        (data as any)?.next_question ||
        data;

      const { nextQuestion, shortAnalysis, finalSummary, finalScore } =
        parseInterviewPayload(rawFirst);

      const firstQ = personalizeQuestionClient(
        nextQuestion ||
          "Bonjour ! Pour commencer, pouvez-vous vous présenter en quelques phrases ?",
        user
      );

      setSessionId((data as any)?.sessionId || (data as any)?.session_id || null);
      setStarted(true);
      setCurrentQuestionIndex(1);

      const newHistory: Message[] = [{ role: "interviewer", text: firstQ }];

      if (shortAnalysis) {
        newHistory.push({
          role: "system",
          text: `💭 Ce que pense le recruteur : ${shortAnalysis}`,
        });
      }

      setHistory(newHistory);

      if (finalSummary) {
        setFinalSummary(finalSummary);
        if (finalScore !== null) setFinalScore(finalScore);
        setFinished(true);
      }

      setTypingIndex(0);
      setTyping(true);
      speak(firstQ);
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Erreur lors du démarrage de la simulation.");
      setStarted(false);
      setSessionId(null);
    } finally {
      setLoading(false);
    }
  };

  // --- RÉPONDRE ---
  const sendAnswer = async (text: string) => {
    const answer = text.trim();
    if (!answer) return;

    if (!started || !sessionId) {
      console.warn("Réponse ignorée : entretien non démarré ou sessionId manquant.");
      return;
    }

    setHistory((prev) => [...prev, { role: "candidate", text: answer } as Message]);
    setInput("");
    setLoading(true);

    try {
      // ✅ utilise postInterview (avec reCAPTCHA)
      const data = await postInterview({
        action: "answer",
        userId: user?.uid,
        sessionId,
        userMessage: answer,
        interviewMode,
        difficulty,
      });

      const payload = (() => {
        if (
          (data as any)?.nextQuestion ||
          (data as any)?.next_question ||
          (data as any)?.final_summary ||
          (data as any)?.finalSummary
        ) {
          return parseInterviewPayload(data);
        }
        if ((data as any)?.payload) return parseInterviewPayload((data as any).payload);
        if (typeof data === "string") return parseInterviewPayload(data);
        return parseInterviewPayload(data);
      })();

      const { nextQuestion, shortAnalysis, finalSummary, finalScore } = payload;

      const nextQClean = nextQuestion
        ? personalizeQuestionClient(nextQuestion, user)
        : null;

      setHistory((prev) => {
        const newHistory = [...prev];

        if (shortAnalysis) {
          newHistory.push({
            role: "system",
            text: `💭 Ce que pense le recruteur : ${shortAnalysis}`,
          });
        }

        if (nextQClean && !finalSummary) {
          newHistory.push({ role: "interviewer", text: nextQClean });
        }

        return newHistory;
      });

      if (finalSummary || typeof finalScore === "number") {
        if (finalSummary) setFinalSummary(finalSummary);
        if (typeof finalScore === "number") setFinalScore(finalScore);

        if (typeof finalScore === "number") {
          let decision: string;
          if (finalScore >= 80) {
            decision =
              "Très bon entretien : tu aurais de fortes chances d'être retenu(e) pour le poste. 🎉";
          } else if (finalScore >= 60) {
            decision =
              "Entretien correct : tu pourrais passer à l'étape suivante, mais il y a encore des axes d'amélioration.";
          } else {
            decision =
              "Entretien en dessous des attentes : il faudrait retravailler certains points clés avant de postuler.";
          }
          setFinalDecision(decision);
        }

        setFinished(true);
      }

      if (nextQClean && !finalSummary) {
        setCurrentQuestionIndex((prev) => Math.min(prev + 1, totalQuestions));
        setTypingIndex(0);
        setTyping(true);
        speak(nextQClean);
      }
    } catch (e: any) {
      console.error(e);
      alert(e?.message || "Erreur lors de l'envoi de ta réponse.");
    } finally {
      setLoading(false);
    }
  };

  // --- INIT RECONNAISSANCE VOCALE ---
  useEffect(() => {
    if (typeof window === "undefined") return;

    const w = window as any;
    const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setRecognitionSupported(false);
      recognitionRef.current = null;
      return;
    }

    setRecognitionSupported(true);

    const recognition = new SpeechRecognition();
    recognition.lang = "fr-FR";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      if (text) {
        sendAnswer(text);
      }
    };
    recognition.onend = () => {
      setListening(false);
    };
    recognition.onerror = (e: any) => {
      console.error("Speech recognition error:", e);
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, sessionId]);

  const toggleMic = () => {
    if (!started) {
      alert("Lance d'abord la simulation avant d'utiliser le micro.");
      return;
    }

    if (!recognitionRef.current) {
      alert(
        "La reconnaissance vocale n'est pas disponible sur ce navigateur / appareil (par exemple iOS Safari). Tu peux toujours répondre au clavier."
      );
      return;
    }

    if (listening) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error(e);
      }
    } else {
      setListening(true);
      playMicBeep();
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error(e);
        setListening(false);
      }
    }
  };

  const stopSession = () => {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // ignore
    }
    if (recognitionRef.current && listening) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
    }
    setStarted(false);
    setSessionId(null);
    setHistory([]);
    setListening(false);
    setFinished(false);
    setFinalSummary(null);
    setFinalScore(null);
    setFinalDecision(null);
    setCurrentQuestionIndex(0);
    setTyping(false);
    setTypingIndex(0);
  };

  const progressPercent =
    totalQuestions > 0
      ? Math.min((currentQuestionIndex / totalQuestions) * 100, 100)
      : 0;

  const showConfig = !started || finished;
  const showInterviewPanel = started || finished;

  const stepVisual = !started ? 1 : finished || finalSummary || finalScore !== null ? 3 : 2;

  const questionsLeft = Math.max(totalQuestions - currentQuestionIndex, 0);
  const estimatedMinutesLeft = questionsLeft * AVG_MIN_PER_QUESTION;
  const estimatedMinutesRounded = questionsLeft > 0 ? Math.max(1, Math.round(estimatedMinutesLeft)) : 0;

  return (
    <section className="glass rounded-2xl p-5 space-y-4">
      {/* Titre + intro */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">
          Simulateur d&apos;entretien IA (mode vocal)
        </h2>
        <p className="text-[11px] text-[var(--muted)] max-w-2xl">
          L&apos;IA joue le rôle du recruteur : elle te pose des questions adaptées au poste et à ton profil à l&apos;oral,
          tu réponds à l&apos;oral ou à l&apos;écrit, et elle lit ensuite ses messages à voix haute.
        </p>
      </div>

      <div className="space-y-4">
        {/* STEPPER 1/2/3 */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {[
            { id: 1, label: "Configuration" },
            { id: 2, label: "Entretien" },
            { id: 3, label: "Bilan" },
          ].map((step) => (
            <div key={step.id} className="flex items-center gap-1">
              <div
                className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] ${
                  stepVisual === step.id
                    ? "bg-emerald-500 text-black"
                    : stepVisual > step.id
                    ? "bg-emerald-900/60 text-emerald-200"
                    : "bg-white/5 text-[var(--muted)]"
                }`}
              >
                {step.id}
              </div>
              <span className={stepVisual === step.id ? "text-emerald-300" : "text-[var(--muted)]"}>
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Bloc configuration */}
        {showConfig && (
          <div className="glass p-4 rounded-2xl border border-white/10 space-y-3">
            <p className="text-sm text-[var(--muted)]">
              Configure ton entretien, choisis le type de simulation et le profil du recruteur (voix + apparence),
              puis lance le mode vocal.
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <label className="block text-xs font-medium text-[var(--muted)]">
                  Poste visé
                </label>
                <input
                  className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-sm"
                  placeholder="Ex : Développeur WordPress, Chargé de recrutement..."
                  value={jobTitle}
                  disabled={loading || started}
                  onChange={(e) => setJobTitle(e.target.value)}
                />

                <label className="block text-xs font-medium text-[var(--muted)] mt-2">
                  Descriptif de poste (facultatif)
                </label>
                <textarea
                  className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-xs min-h-[100px]"
                  placeholder="Colle ici l'annonce ou un extrait..."
                  value={jobDesc}
                  disabled={loading || started}
                  onChange={(e) => setJobDesc(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted)]">
                    Type d&apos;entretien
                  </label>
                  <select
                    className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-xs"
                    value={interviewMode}
                    disabled={loading || started}
                    onChange={(e) => setInterviewMode(e.target.value as InterviewMode)}
                  >
                    <option value="complet">Entretien complet (général + motivation + compétences)</option>
                    <option value="rapide">Flash 10 minutes (questions essentielles)</option>
                    <option value="technique">Focalisé compétences / technique</option>
                    <option value="comportemental">Comportemental (soft skills, situations)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--muted)]">
                    Niveau de difficulté
                  </label>
                  <select
                    className="w-full bg-black/20 border border-white/10 rounded-lg p-2 text-xs"
                    value={difficulty}
                    disabled={loading || started}
                    onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                  >
                    <option value="facile">Facile / débutant</option>
                    <option value="standard">Standard</option>
                    <option value="difficile">Exigeant (questions poussées)</option>
                  </select>
                </div>

                <div className="mt-1">
                  <label className="block text-xs font-medium text-[var(--muted)]">
                    Profil du recruteur (voix + apparence)
                  </label>
                  <div className="flex gap-2 mt-1">
                    <button
                      type="button"
                      disabled={loading || started}
                      onClick={() => {
                        setRecruiterGender("m");
                        setVoiceProfile("homme");
                      }}
                      className={`flex-1 text-xs rounded-lg border px-2 py-2 flex items-center justify-center gap-2 ${
                        recruiterGender === "m"
                          ? "border-emerald-400 bg-emerald-500/10"
                          : "border-white/10 bg-black/20"
                      }`}
                    >
                      <span className="text-lg">👨‍💼</span>
                      <span className="text-left">
                        Recruteur homme
                        <br />
                        <span className="text-[10px] text-[var(--muted)]">Voix masculine</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={loading || started}
                      onClick={() => {
                        setRecruiterGender("f");
                        setVoiceProfile("femme");
                      }}
                      className={`flex-1 text-xs rounded-lg border px-2 py-2 flex items-center justify-center gap-2 ${
                        recruiterGender === "f"
                          ? "border-emerald-400 bg-emerald-500/10"
                          : "border-white/10 bg-black/20"
                      }`}
                    >
                      <span className="text-lg">👩‍💼</span>
                      <span className="text-left">
                        Recruteuse femme
                        <br />
                        <span className="text-[10px] text-[var(--muted)]">Voix féminine</span>
                      </span>
                    </button>
                  </div>
                </div>

                <p className="text-[10px] text-[var(--muted)] mt-1">
                  L&apos;entretien durera environ{" "}
                  <span className="font-semibold">{INTERVIEW_QUESTION_PLAN[interviewMode]} questions</span>.
                </p>

                {!recognitionSupported && (
                  <p className="text-[10px] text-[var(--muted)] mt-1">
                    ⚠️ La reconnaissance vocale n&apos;est pas disponible sur ce navigateur / appareil.
                  </p>
                )}

                {!speechSupported && (
                  <p className="text-[10px] text-[var(--muted)] mt-1">
                    ⚠️ La synthèse vocale n&apos;est pas supportée ici.
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={startInterview}
              disabled={loading || !user}
              className="btn-primary w-full mt-2"
              type="button"
            >
              {loading ? "Préparation de la simulation..." : "Lancer la simulation vocale 🎙️"}
            </button>

            {!user && (
              <p className="text-[10px] text-[var(--muted)]">
                Tu dois être connecté pour utiliser le simulateur d&apos;entretien.
              </p>
            )}
          </div>
        )}

        {/* Bloc entretien */}
        {showInterviewPanel && (
          <div className="glass p-4 rounded-2xl border border-white/10 h-[520px] flex flex-col">
            <div className="flex justify-between items-start mb-4 border-b border-white/5 pb-2 gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400/70 to-cyan-500/80 flex items-center justify-center shadow-lg ${
                    aiSpeaking ? "animate-pulse" : ""
                  }`}
                >
                  <span className="text-2xl">{recruiterGender === "f" ? "👩‍💼" : "👨‍💼"}</span>
                </div>
                <div className="text-xs text-[var(--muted)]">
                  <p className="font-semibold">{recruiterGender === "f" ? "Recruteuse IA" : "Recruteur IA"}</p>
                  <p className="text-[11px]">
                    {aiSpeaking ? "Te pose une question..." : finished ? "Entretien terminé" : "Attend ta réponse"}
                  </p>
                  {lastInterviewerMessage && (
                    <button
                      type="button"
                      onClick={() => speak(lastInterviewerMessage)}
                      className="mt-1 inline-flex items-center gap-1 text-[10px] px-2 py-[2px] rounded-full bg-white/5 hover:bg-white/10"
                    >
                      🔊 Réécouter la question
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">En direct</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {finished ? "Entretien terminé" : `Question ${Math.max(1, currentQuestionIndex)} sur ${totalQuestions}`}
                </span>
                <div className="w-32 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 transition-all" style={{ width: `${progressPercent}%` }} />
                </div>

                {!finished && questionsLeft > 0 && (
                  <span className="text-[10px] text-[var(--muted)]">
                    Il reste environ <span className="font-semibold">{questionsLeft} questions</span> (~
                    {estimatedMinutesRounded} min)
                  </span>
                )}

                {finished && (
                  <span className="text-[10px] text-[var(--muted)]">
                    Entretien terminé • Bilan disponible ci-dessous
                  </span>
                )}

                <button onClick={stopSession} className="text-[11px] text-red-400 hover:underline mt-1" type="button">
                  Arrêter l&apos;entretien
                </button>
              </div>
            </div>

            <div ref={chatRef} className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
              {history.map((m, i) => {
                const isLastInterviewer = m.role === "interviewer" && i === lastInterviewerIndex;
                const showText = isLastInterviewer && typing ? m.text.slice(0, typingIndex) : m.text;

                return (
                  <div key={i} className={`flex ${m.role === "candidate" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] p-3 rounded-2xl text-sm ${
                        m.role === "candidate"
                          ? "bg-blue-600/20 text-blue-100 rounded-br-none border border-blue-500/30"
                          : m.role === "interviewer"
                          ? "bg-white/5 text-slate-200 rounded-bl-none border border-white/10"
                          : "bg-white/5 text-[var(--muted)] border border-white/5 text-[11px] italic"
                      }`}
                    >
                      {showText}
                    </div>
                  </div>
                );
              })}

              {loading && (
                <div className="text-xs text-[var(--muted)] flex items-center gap-2">
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  L&apos;IA réfléchit...
                </div>
              )}

              {finished && (finalSummary || finalScore !== null) && (
                <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-[11px] space-y-2">
                  <p className="text-xs font-semibold text-emerald-300">Bilan de l&apos;entretien</p>
                  {typeof finalScore === "number" && (
                    <p>
                      <span className="font-semibold">Note globale :</span> {Math.round(finalScore)}/100
                    </p>
                  )}
                  {finalSummary && (
                    <p className="whitespace-pre-line">
                      <span className="font-semibold">Synthèse :</span> {finalSummary}
                    </p>
                  )}
                  {finalDecision && (
                    <p className="whitespace-pre-line">
                      <span className="font-semibold">Décision probable :</span> {finalDecision}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-white/10 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMic}
                  disabled={!started || loading}
                  type="button"
                  className={`p-3 rounded-full transition-colors flex items-center justify-center ${
                    listening
                      ? "bg-red-500/80 animate-pulse ring-2 ring-red-300/60"
                      : "bg-white/10 hover:bg-white/20"
                  } ${!started || loading ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <span>🎤</span>
                  {listening && (
                    <span className="ml-1 text-[10px] uppercase tracking-widest text-red-100">REC</span>
                  )}
                </button>

                {listening && (
                  <div className="flex gap-[3px] h-4 items-end">
                    <span className="w-[3px] bg-red-100 rounded-sm animate-[ping_0.7s_ease-in-out_infinite]" />
                    <span className="w-[3px] bg-red-200 rounded-sm animate-[ping_0.8s_ease-in-out_infinite]" />
                    <span className="w-[3px] bg-red-300 rounded-sm animate-[ping_0.6s_ease-in-out_infinite]" />
                    <span className="w-[3px] bg-red-200 rounded-sm animate-[ping_0.9s_ease-in-out_infinite]" />
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  className="flex-1 bg-black/20 border border-white/10 rounded-full px-4 text-sm"
                  placeholder={started ? "Parle ou écris ta réponse..." : "Lance la simulation pour commencer l'entretien"}
                  value={input}
                  disabled={!started || loading}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => started && e.key === "Enter" && sendAnswer(input)}
                />
                <button
                  onClick={() => sendAnswer(input)}
                  disabled={!started || loading}
                  type="button"
                  className="p-2 px-4 bg-white/10 rounded-full text-sm hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ➤
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
