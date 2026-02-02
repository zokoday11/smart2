"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { tryGetRecaptchaToken } from "@/lib/recaptcha";

export type SimConfig = {
  jobTitle: string;
  jobDesc: string;
  type: "complet" | "rapide" | "technique" | "comportemental";
  difficulty: "facile" | "standard" | "difficile";
  recruiter: "man" | "woman";
};

export type InterviewMessage = {
  role: "interviewer" | "candidate" | "system";
  text: string;
};

export type InterviewResult = {
  sessionId: string | null;
  history: InterviewMessage[];
  finalSummary: string | null;
  finalScore: number | null;
  finalDecision: string | null;
  startedAt: number;
  endedAt: number;
  questionsAsked: number;
};

type Props = {
  initialConfig?: SimConfig | null;
  onFinish?: (result: InterviewResult) => void;
  endSignal?: number;
  autoListen?: boolean;
};

type InterviewMode = SimConfig["type"];
type Difficulty = SimConfig["difficulty"];
type VoiceProfileId = "femme" | "homme";
type RecruiterGender = "f" | "m";

const INTERVIEW_QUESTION_PLAN: Record<InterviewMode, number> = {
  complet: 8,
  rapide: 4,
  technique: 6,
  comportemental: 6,
};

const VOICE_PROFILES: Record<VoiceProfileId, { label: string; pitch: number; rate: number }> = {
  femme: { label: "Voix féminine", pitch: 1.1, rate: 1.0 },
  homme: { label: "Voix masculine", pitch: 0.9, rate: 0.98 },
};

const AVG_MIN_PER_QUESTION = 1.5;
const RECAPTCHA_ACTION = "interview";

/** ---------- PERSISTENCE ---------- */
const STORAGE_KEY = (uid: string) => `acv-interview-session:${uid}`;

type PersistedSessionV1 = {
  v: 1;
  ts: number;
  cfgKey: string;
  sessionId: string | null;
  history: InterviewMessage[];
  currentQuestionIndex: number;
  started: boolean;
  finished: boolean;
  startedAt: number;
  finalSummary: string | null;
  finalScore: number | null;
  finalDecision: string | null;
};

const makeCfgKey = (cfg: SimConfig) => {
  const desc = (cfg.jobDesc || "").slice(0, 120);
  return `${cfg.jobTitle}||${cfg.type}||${cfg.difficulty}||${cfg.recruiter}||${desc}`;
};

const getCandidateNameFromAuth = (user: any): string | null => {
  if (!user) return null;
  const possible = user.displayName || user.fullName || user.name || user.email?.split("@")[0] || "";
  const trimmed = (possible || "").toString().trim();
  return trimmed || null;
};

const personalizeQuestionClient = (raw: string | null | undefined, user: any): string => {
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

const formatMMSS = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

export default function InterviewChat({ initialConfig, onFinish, endSignal, autoListen = true }: Props) {
  const { user } = useAuth();

  const cfg = initialConfig ?? null;
  const canRun = !!cfg;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<InterviewMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);

  // config dérivée
  const jobTitle = cfg?.jobTitle ?? "";
  const jobDesc = cfg?.jobDesc ?? "";
  const interviewMode: InterviewMode = cfg?.type ?? "complet";
  const difficulty: Difficulty = cfg?.difficulty ?? "standard";
  const recruiterGender: RecruiterGender = cfg?.recruiter === "woman" ? "f" : "m";
  const voiceProfile: VoiceProfileId = cfg?.recruiter === "woman" ? "femme" : "homme";

  const totalQuestions = useMemo(() => INTERVIEW_QUESTION_PLAN[interviewMode], [interviewMode]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Speech / mic
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [recognitionSupported, setRecognitionSupported] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);

  // Final
  const [finalSummary, setFinalSummary] = useState<string | null>(null);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [finalDecision, setFinalDecision] = useState<string | null>(null);

  // Typewriter
  const [typing, setTyping] = useState(false);
  const [typingIndex, setTypingIndex] = useState(0);

  // Scroll transcript
  const chatRef = useRef<HTMLDivElement | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const hasStartedRef = useRef(false);
  const endSignalRef = useRef<number | undefined>(undefined);
  const finishingRef = useRef(false);

  const startedAtRef = useRef<number>(0);

  // ---- VISIO (camera) ----
  const [camEnabled, setCamEnabled] = useState(false);
  const camStreamRef = useRef<MediaStream | null>(null);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  const aiVideoSrc = recruiterGender === "f" ? "/videos/recruiter-woman.mp4" : "/videos/recruiter-man.mp4";
  const [aiVideoError, setAiVideoError] = useState(false);

  const cfgKey = useMemo(() => (cfg ? makeCfgKey(cfg) : ""), [cfg]);

  /** ---------- STOP AUDIO / MIC ---------- */
  const stopAllAudio = () => {
    try {
      recognitionRef.current?.abort?.();
    } catch {}
    try {
      recognitionRef.current?.stop?.();
    } catch {}
    setListening(false);

    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {}
    setAiSpeaking(false);
  };

  const stopCamera = () => {
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
    if (userVideoRef.current) {
      userVideoRef.current.srcObject = null;
    }
  };

  const requestCamera = async () => {
    setCamError(null);
    try {
      if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCamError("Caméra non supportée par ce navigateur.");
        return false;
      }

      if (camStreamRef.current) {
        camStreamRef.current.getTracks().forEach((t) => t.stop());
        camStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });

      camStreamRef.current = stream;

      if (userVideoRef.current) {
        userVideoRef.current.srcObject = stream;
        try {
          await userVideoRef.current.play();
        } catch {}
      }
      return true;
    } catch (e: any) {
      setCamError(e?.message || "Impossible d’accéder à la caméra.");
      return false;
    }
  };

  const toggleCamera = async () => {
    if (camEnabled) {
      setCamEnabled(false);
      stopCamera();
      return;
    }
    const ok = await requestCamera();
    setCamEnabled(ok);
  };

  // cleanup audio/cam on hard exits
  useEffect(() => {
    const hardStop = () => {
      stopAllAudio();
      stopCamera();
    };

    const onVis = () => {
      if (document.visibilityState === "hidden") hardStop();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", hardStop);
      window.addEventListener("pagehide", hardStop);
      document.addEventListener("visibilitychange", onVis);
    }

    return () => {
      try {
        window.removeEventListener("beforeunload", hardStop);
        window.removeEventListener("pagehide", hardStop);
        document.removeEventListener("visibilitychange", onVis);
      } catch {}
      hardStop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Helper fetch + reCAPTCHA
  const postInterview = async (payload: any) => {
    const recaptchaToken = await tryGetRecaptchaToken(RECAPTCHA_ACTION).catch(() => null);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
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
          ? data.error || `HTTP ${res.status}` + (data.details ? ` — ${JSON.stringify(data.details)}` : "")
          : typeof data === "string"
          ? data || `HTTP ${res.status}`
          : `HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    return data;
  };

  // Init TTS flag
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSpeechSupported("speechSynthesis" in window);
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    if (!showTranscript) return;
    const el = chatRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [history, loading, showTranscript]);

  const lastInterviewerIndex =
    history.length > 0
      ? [...history]
          .map((m, i) => ({ m, i }))
          .reverse()
          .find(({ m }) => m.role === "interviewer")?.i ?? -1
      : -1;

  const lastInterviewerMessage = lastInterviewerIndex >= 0 ? history[lastInterviewerIndex]?.text || "" : "";

  // Typewriter
  useEffect(() => {
    if (!typing) return;
    if (lastInterviewerIndex === -1) return;
    const msg = history[lastInterviewerIndex];
    if (!msg) return;

    if (typingIndex >= msg.text.length) {
      setTyping(false);
      return;
    }

    const interval = setInterval(() => setTypingIndex((prev) => prev + 2), 15);
    return () => clearInterval(interval);
  }, [typing, typingIndex, history, lastInterviewerIndex]);

  // Beep
  const playMicBeep = () => {
    try {
      const W = window as any;
      const AudioContext = W.AudioContext || W.webkitAudioContext;
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
    } catch {}
  };

  const startMic = () => {
    if (!recognitionRef.current) return false;
    try {
      setListening(true);
      playMicBeep();
      recognitionRef.current.start();
      return true;
    } catch {
      setListening(false);
      return false;
    }
  };

  const stopMic = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch {}
  };

  const speak = (text: string) => {
    if (typeof window === "undefined") return;
    const toSpeak = (text || "").trim();
    if (!toSpeak) return;
    if (!("speechSynthesis" in window)) return;

    try {
      if (listening) stopMic();

      const utterance = new SpeechSynthesisUtterance(toSpeak);
      utterance.lang = "fr-FR";

      const profile = VOICE_PROFILES[voiceProfile];
      if (profile) {
        utterance.pitch = profile.pitch;
        utterance.rate = profile.rate;
      }

      utterance.onstart = () => setAiSpeaking(true);
      utterance.onend = () => {
        setAiSpeaking(false);
        if (autoListen && started && !finished && !finishingRef.current && recognitionSupported) {
          startMic();
        }
      };
      utterance.onerror = () => setAiSpeaking(false);

      try {
        window.speechSynthesis.cancel();
      } catch {}
      window.speechSynthesis.speak(utterance);
    } catch {
      setAiSpeaking(false);
    }
  };

  const parseInterviewPayload = (raw: any) => {
    let obj: any = raw;

    const tryParseString = (txt: string | null | undefined): any => {
      if (!txt) return null;
      let inner = txt.trim();
      if (inner.startsWith("```")) {
        inner = inner.replace(/^```[a-zA-Z]*\s*\n?/, "").replace(/```$/, "").trim();
      }
      try {
        return JSON.parse(inner);
      } catch {
        return { next_question: inner };
      }
    };

    if (typeof obj === "string") obj = tryParseString(obj);

    const nextQuestionRaw = obj?.next_question || obj?.nextQuestion || obj?.question || null;
    const shortAnalysis = obj?.short_analysis || obj?.shortAnalysis || null;
    const finalSummary = obj?.final_summary || obj?.finalSummary || null;
    const finalScoreRaw = obj?.final_score ?? obj?.finalScore ?? null;

    const nextQuestionText = typeof nextQuestionRaw === "string" ? nextQuestionRaw.trim() : null;
    const scoreNum =
      typeof finalScoreRaw === "number"
        ? finalScoreRaw
        : typeof finalScoreRaw === "string"
        ? parseFloat(finalScoreRaw)
        : null;

    return {
      nextQuestion: nextQuestionText || null,
      shortAnalysis: typeof shortAnalysis === "string" ? shortAnalysis.trim() : null,
      finalSummary: typeof finalSummary === "string" ? finalSummary.trim() : null,
      finalScore: Number.isNaN(scoreNum as any) ? null : (scoreNum as any),
    };
  };

  const computeDecision = (score: number | null) => {
    if (typeof score !== "number") return null;
    if (score >= 80) return "Très bon entretien : fortes chances d’être retenu(e). 🎉";
    if (score >= 60) return "Entretien correct : possible suite, mais axes d’amélioration.";
    return "Entretien en dessous des attentes : retravailler des points clés avant de postuler.";
  };

  const emitFinish = (override?: Partial<InterviewResult>) => {
    const endedAt = Date.now();
    const questionsAsked = history.filter((m) => m.role === "interviewer").length;

    const result: InterviewResult = {
      sessionId,
      history,
      finalSummary,
      finalScore,
      finalDecision,
      startedAt: startedAtRef.current || endedAt,
      endedAt,
      questionsAsked,
      ...override,
    };

    onFinish?.(result);
  };

  /** ---------- RESTORE (wait for user!) ---------- */
  useEffect(() => {
    if (!user?.uid || !cfg) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEY(user.uid));
      if (!raw) return;

      const saved: PersistedSessionV1 = JSON.parse(raw);
      if (!saved || saved.v !== 1) return;

      // TTL 12h
      if (saved.ts && Date.now() - saved.ts > 12 * 60 * 60 * 1000) {
        localStorage.removeItem(STORAGE_KEY(user.uid));
        return;
      }

      if (saved.cfgKey !== cfgKey) return;
      if (!saved.sessionId || !saved.started || saved.finished) return;

      setSessionId(saved.sessionId);
      setHistory(Array.isArray(saved.history) ? saved.history : []);
      setCurrentQuestionIndex(saved.currentQuestionIndex || 0);
      setStarted(true);
      setFinished(false);

      setFinalSummary(saved.finalSummary ?? null);
      setFinalScore(typeof saved.finalScore === "number" ? saved.finalScore : null);
      setFinalDecision(saved.finalDecision ?? null);

      startedAtRef.current = saved.startedAt || Date.now();

      // IMPORTANT: prevent auto-start
      hasStartedRef.current = true;
    } catch {
      // ignore
    }
  }, [user?.uid, cfgKey, cfg]);

  /** ---------- SAVE continuously (wait for user!) ---------- */
  useEffect(() => {
    if (!user?.uid || !cfg) return;

    if (!sessionId && history.length === 0 && !started) return;

    const payload: PersistedSessionV1 = {
      v: 1,
      ts: Date.now(),
      cfgKey,
      sessionId,
      history,
      currentQuestionIndex,
      started,
      finished,
      startedAt: startedAtRef.current || Date.now(),
      finalSummary,
      finalScore,
      finalDecision,
    };

    try {
      if (finished) localStorage.removeItem(STORAGE_KEY(user.uid));
      else localStorage.setItem(STORAGE_KEY(user.uid), JSON.stringify(payload));
    } catch {}
  }, [
    user?.uid,
    cfgKey,
    cfg,
    sessionId,
    history,
    currentQuestionIndex,
    started,
    finished,
    finalSummary,
    finalScore,
    finalDecision,
  ]);

  /** ---------- START interview (only when user ready) ---------- */
  const startInterview = async () => {
    if (!cfg) return;
    if (!user?.uid) return; // ✅ critical: do nothing until user exists

    finishingRef.current = false;
    stopAllAudio();

    setLoading(true);
    setHistory([]);
    setFinished(false);
    setFinalSummary(null);
    setFinalScore(null);
    setFinalDecision(null);
    setCurrentQuestionIndex(0);

    startedAtRef.current = Date.now();

    try {
      // unlock TTS best-effort
      try {
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          const silent = new SpeechSynthesisUtterance(" ");
          silent.volume = 0;
          window.speechSynthesis.speak(silent);
        }
      } catch {}

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

      const { nextQuestion, shortAnalysis, finalSummary: fs, finalScore: sc } = parseInterviewPayload(rawFirst);

      const firstQ = personalizeQuestionClient(
        nextQuestion || "Bonjour ! Pour commencer, pouvez-vous vous présenter en quelques phrases ?",
        user
      );

      setSessionId((data as any)?.sessionId || (data as any)?.session_id || null);
      setStarted(true);
      setCurrentQuestionIndex(1);

      const newHistory: InterviewMessage[] = [{ role: "interviewer", text: firstQ }];

      if (shortAnalysis) {
        newHistory.push({ role: "system", text: `💭 Ce que pense le recruteur : ${shortAnalysis}` });
      }

      setHistory(newHistory);

      if (fs) {
        finishingRef.current = true;
        stopAllAudio();
        setFinalSummary(fs);
        if (sc !== null) setFinalScore(sc);
        const dec = computeDecision(sc);
        if (dec) setFinalDecision(dec);
        setFinished(true);
        setTimeout(() => emitFinish({ finalSummary: fs, finalScore: sc, finalDecision: dec }), 0);
        return;
      }

      setTypingIndex(0);
      setTyping(true);
      speak(firstQ);
    } catch (e: any) {
      setHistory([{ role: "system", text: e?.message || "Erreur lors du démarrage." }]);
      setStarted(false);
      setSessionId(null);
      // IMPORTANT: allow retry later
      hasStartedRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  // ✅ Auto-start ONCE only when user ready (this is the real fix)
  useEffect(() => {
    if (!canRun) return;
    if (!cfg) return;

    // wait for auth
    if (!user?.uid) return;

    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    startInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun, user?.uid, cfg?.jobTitle, cfg?.jobDesc, cfg?.type, cfg?.difficulty, cfg?.recruiter]);

  // --- SEND ANSWER ---
  const sendAnswer = async (text: string) => {
    const answer = text.trim();
    if (!answer) return;
    if (!started || !sessionId) return;

    setHistory((prev) => [...prev, { role: "candidate", text: answer }]);
    setInput("");
    setLoading(true);

    try {
      const data = await postInterview({
        action: "answer",
        userId: user?.uid,
        sessionId,
        userMessage: answer,
        interviewMode,
        difficulty,
      });

      const { nextQuestion, shortAnalysis, finalSummary: fs, finalScore: sc } = parseInterviewPayload(data);
      const nextQClean = nextQuestion ? personalizeQuestionClient(nextQuestion, user) : null;

      setHistory((prev) => {
        const newHistory = [...prev];
        if (shortAnalysis) newHistory.push({ role: "system", text: `💭 Ce que pense le recruteur : ${shortAnalysis}` });
        if (nextQClean && !fs) newHistory.push({ role: "interviewer", text: nextQClean });
        return newHistory;
      });

      if (fs || typeof sc === "number") {
        finishingRef.current = true;
        stopAllAudio();

        if (fs) setFinalSummary(fs);
        if (typeof sc === "number") setFinalScore(sc);

        const dec = computeDecision(typeof sc === "number" ? sc : null);
        if (dec) setFinalDecision(dec);

        setFinished(true);

        setTimeout(() => {
          emitFinish({
            finalSummary: fs ?? finalSummary,
            finalScore: typeof sc === "number" ? sc : finalScore,
            finalDecision: dec ?? finalDecision,
          });
        }, 0);

        return;
      }

      if (nextQClean) {
        setCurrentQuestionIndex((prev) => Math.min(prev + 1, totalQuestions));
        setTypingIndex(0);
        setTyping(true);
        speak(nextQClean);
      }
    } catch (e: any) {
      setHistory((prev) => [...prev, { role: "system", text: e?.message || "Erreur lors de l'envoi." }]);
    } finally {
      setLoading(false);
    }
  };

  // --- FINALIZE ---
  const finalizeInterviewNow = async () => {
    if (!started || !sessionId || finished) return;

    finishingRef.current = true;
    stopAllAudio();

    setLoading(true);

    try {
      let data: any = null;
      try {
        data = await postInterview({
          action: "finalize",
          userId: user?.uid,
          sessionId,
          interviewMode,
          difficulty,
        });
      } catch {
        data = await postInterview({
          action: "answer",
          userId: user?.uid,
          sessionId,
          userMessage:
            "Je souhaite terminer l’entretien maintenant. Merci de générer le bilan final (synthèse + note sur 100 + décision probable).",
          interviewMode,
          difficulty,
        });
      }

      const { finalSummary: fs, finalScore: sc } = parseInterviewPayload(data);
      const dec = computeDecision(typeof sc === "number" ? sc : null);

      if (fs) setFinalSummary(fs);
      if (typeof sc === "number") setFinalScore(sc);
      if (dec) setFinalDecision(dec);

      setFinished(true);

      setTimeout(() => {
        emitFinish({
          finalSummary: fs ?? "Bilan non disponible (fin anticipée).",
          finalScore: typeof sc === "number" ? sc : null,
          finalDecision: dec ?? null,
        });
      }, 0);
    } catch (e: any) {
      setHistory((prev) => [...prev, { role: "system", text: e?.message || "Impossible de générer le bilan. Réessaie." }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (endSignal === undefined) return;
    if (endSignalRef.current === undefined) {
      endSignalRef.current = endSignal;
      return;
    }
    if (endSignalRef.current !== endSignal) {
      endSignalRef.current = endSignal;
      finalizeInterviewNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endSignal]);

  // Init SpeechRecognition
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
      const text = event.results?.[0]?.[0]?.transcript || "";
      if (text) sendAnswer(text);
    };

    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, sessionId]);

  const toggleMic = () => {
    if (!started) return;
    if (!recognitionRef.current) {
      alert("Reconnaissance vocale indisponible ici. Tu peux répondre au clavier.");
      return;
    }
    if (aiSpeaking) return;

    if (listening) stopMic();
    else startMic();
  };

  const questionsLeft = Math.max(totalQuestions - currentQuestionIndex, 0);
  const estimatedMinutesRounded = questionsLeft > 0 ? Math.max(1, Math.round(questionsLeft * AVG_MIN_PER_QUESTION)) : 0;

  // Timer
  const totalPlannedSeconds = Math.max(60, Math.round(totalQuestions * AVG_MIN_PER_QUESTION * 60));
  const [remainingSec, setRemainingSec] = useState(totalPlannedSeconds);

  useEffect(() => {
    if (!started || finished) return;
    setRemainingSec(totalPlannedSeconds);

    const t = setInterval(() => {
      const elapsed = Math.floor((Date.now() - (startedAtRef.current || Date.now())) / 1000);
      setRemainingSec(Math.max(0, totalPlannedSeconds - elapsed));
    }, 500);

    return () => clearInterval(t);
  }, [started, finished, totalPlannedSeconds]);

  if (!canRun) {
    return (
      <div className="p-6 text-sm text-[var(--muted)]">
        Configuration manquante. Retourne à l’étape 1 (Initialisation) pour lancer l’entretien.
      </div>
    );
  }

  // If user not ready yet, show a stable loading state (prevents "start at 0")
  if (!user?.uid) {
    return (
      <div className="p-6 text-sm text-[var(--muted)]">
        Chargement de la session… (auth en cours)
      </div>
    );
  }

  const lastInterviewerForSubtitle =
    lastInterviewerIndex >= 0
      ? (() => {
          const m = history[lastInterviewerIndex];
          if (!m) return "";
          return typing ? m.text.slice(0, typingIndex) : m.text;
        })()
      : "";

  return (
    <section className="w-full">
      <div className="rounded-3xl border border-white/10 bg-black/60 overflow-hidden shadow-2xl">
        <div className="relative">
          <div className="absolute left-1/2 -translate-x-1/2 top-3 z-20">
            <div className="px-5 py-2 rounded-full bg-black/60 border border-white/10 backdrop-blur-md text-white text-xl font-semibold tracking-wide">
              {formatMMSS(remainingSec)}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 pt-16">
            <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black">
              {!aiVideoError ? (
                <video
                  className="absolute inset-0 w-full h-full object-cover"
                  src={aiVideoSrc}
                  autoPlay
                  loop
                  muted
                  playsInline
                  onError={() => setAiVideoError(true)}
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
                  <div className={`h-16 w-16 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center ${aiSpeaking ? "animate-pulse" : ""}`}>
                    <span className="text-4xl">{recruiterGender === "f" ? "👩‍💼" : "👨‍💼"}</span>
                  </div>
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20" />

              <div className="absolute left-3 bottom-3 flex items-center gap-2 bg-black/55 border border-white/10 backdrop-blur-md rounded-xl px-3 py-2">
                <span className="text-white/90">🎙️</span>
                <div className="leading-tight">
                  <div className="text-white text-sm font-semibold">Simon</div>
                  <div className="text-white/70 text-xs">Recruteur IA</div>
                </div>
                <div className="ml-2">
                  <span className={`inline-flex h-2 w-2 rounded-full ${aiSpeaking ? "bg-emerald-400 animate-pulse" : "bg-white/30"}`} />
                </div>
              </div>
            </div>

            <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black">
              {camEnabled ? (
                <>
                  <video ref={userVideoRef} className="absolute inset-0 w-full h-full object-cover" autoPlay playsInline muted />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/15" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
                  <div className="text-center">
                    <div className="mx-auto h-16 w-16 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center">
                      <span className="text-3xl">👤</span>
                    </div>
                    <div className="mt-3 text-white/80 text-sm">Caméra désactivée</div>
                    {camError && <div className="mt-1 text-xs text-red-200/90">{camError}</div>}
                  </div>
                </div>
              )}

              <div className="absolute left-3 bottom-3 flex items-center gap-2 bg-black/55 border border-white/10 backdrop-blur-md rounded-xl px-3 py-2">
                <span className="text-white/90">🎤</span>
                <div className="leading-tight">
                  <div className="text-white text-sm font-semibold">Vous</div>
                  <div className="text-white/70 text-xs">{listening ? "Micro: ON" : "Micro: OFF"}</div>
                </div>
                <div className="ml-2">
                  <span className={`inline-flex h-2 w-2 rounded-full ${listening ? "bg-red-400 animate-pulse" : "bg-white/30"}`} />
                </div>
              </div>
            </div>
          </div>

          <div className="px-6 pb-4">
            <div className="text-center text-white/90 text-lg font-medium drop-shadow">{lastInterviewerForSubtitle || (loading ? "…" : "")}</div>
            <div className="mt-2 flex items-center justify-center gap-3 text-xs text-white/60">
              <span>{finished ? "Entretien terminé" : aiSpeaking ? "L’IA parle…" : listening ? "Vous répondez…" : "À vous"}</span>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span>{finished ? "—" : `Question ${Math.max(1, currentQuestionIndex)} / ${totalQuestions}`}</span>
              <span className="h-1 w-1 rounded-full bg-white/30" />
              <span>{questionsLeft > 0 && !finished ? `~${estimatedMinutesRounded} min restantes` : ""}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 bg-black/70">
          <div className="px-4 py-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleMic}
                  disabled={!started || loading || aiSpeaking || finished}
                  type="button"
                  className={`h-12 w-12 rounded-2xl border border-white/10 flex items-center justify-center transition
                    ${listening ? "bg-red-500/70 animate-pulse" : "bg-white/5 hover:bg-white/10"}
                    ${!started || loading || aiSpeaking || finished ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={aiSpeaking ? "Attends la fin de la question" : listening ? "Arrêter le micro" : "Micro"}
                >
                  🎤
                </button>

                <button
                  onClick={toggleCamera}
                  disabled={finished}
                  type="button"
                  className={`h-12 px-5 rounded-2xl border border-white/10 flex items-center justify-center gap-2 transition
                    ${camEnabled ? "bg-blue-600/55" : "bg-white/5 hover:bg-white/10"}
                    ${finished ? "opacity-50 cursor-not-allowed" : ""}`}
                  title={camEnabled ? "Désactiver la caméra" : "Activer la caméra"}
                >
                  <span>📹</span>
                  <span className="text-white/90 text-sm font-semibold">Video</span>
                </button>

                <button
                  type="button"
                  onClick={() => lastInterviewerMessage && speak(lastInterviewerMessage)}
                  disabled={!lastInterviewerMessage}
                  className="h-12 px-5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-white/90 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Réécouter la question"
                >
                  🔊 Réécouter
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!lastInterviewerMessage) return;
                    navigator.clipboard?.writeText(lastInterviewerMessage).catch(() => {});
                  }}
                  disabled={!lastInterviewerMessage}
                  className="h-12 px-5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-white/90 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Copier la question"
                >
                  📋 Copier la question
                </button>

                <button
                  type="button"
                  onClick={() => setShowTranscript((v) => !v)}
                  className="h-12 px-5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-white/90 text-sm font-semibold"
                  title="Afficher / masquer le transcript"
                >
                  {showTranscript ? "🧾 Masquer" : "🧾 Transcript"}
                </button>
              </div>

              <button
                type="button"
                onClick={finalizeInterviewNow}
                disabled={!started || finished || loading}
                className={`h-12 px-8 rounded-2xl border border-red-500/30 bg-red-500/75 hover:bg-red-500/85 transition text-white font-bold
                  ${!started || finished || loading ? "opacity-50 cursor-not-allowed" : ""}`}
                title="Quitter et générer le bilan"
              >
                Quitter
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-center gap-3">
                <input
                  className="flex-1 bg-transparent outline-none text-white placeholder:text-white/40 text-sm"
                  placeholder={started ? "Écris ta réponse (Entrée pour envoyer)..." : "Démarrage en cours..."}
                  value={input}
                  disabled={!started || loading || finished}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => started && e.key === "Enter" && sendAnswer(input)}
                />
                <button
                  onClick={() => sendAnswer(input)}
                  disabled={!started || loading || finished}
                  type="button"
                  className="h-10 px-5 rounded-xl border border-white/10 bg-white/10 hover:bg-white/15 transition text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Envoyer ➤
                </button>
              </div>
            </div>

            {showTranscript && (
              <div className="rounded-2xl border border-white/10 bg-black/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                  <div className="text-white/80 text-sm font-semibold">Transcript</div>
                  <div className="text-white/50 text-xs">{loading ? "L’IA réfléchit…" : finished ? "Terminé" : "En cours"}</div>
                </div>

                <div ref={chatRef} className="max-h-[260px] overflow-y-auto custom-scrollbar p-4 space-y-3">
                  {history.map((m, i) => {
                    const isCandidate = m.role === "candidate";
                    const isSystem = m.role === "system";

                    if (isSystem) {
                      return (
                        <div key={i} className="text-xs text-white/55 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                          {m.text}
                        </div>
                      );
                    }

                    return (
                      <div key={i} className={`flex ${isCandidate ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm border border-white/10
                            ${isCandidate ? "bg-blue-600/20 text-white" : "bg-white/5 text-white/90"}`}
                        >
                          {m.text}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {finished && (finalSummary || finalScore !== null) && (
                  <div className="px-4 py-4 border-t border-white/10 bg-emerald-500/10">
                    <div className="flex items-center justify-between">
                      <div className="text-emerald-200 font-semibold text-sm">Bilan</div>
                      {typeof finalScore === "number" && (
                        <div className="text-xs px-2 py-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-100">
                          {Math.round(finalScore)}/100
                        </div>
                      )}
                    </div>
                    {finalDecision && <div className="mt-2 text-sm text-white/90 whitespace-pre-line">{finalDecision}</div>}
                    {finalSummary && <div className="mt-2 text-sm text-white/80 whitespace-pre-line">{finalSummary}</div>}
                  </div>
                )}
              </div>
            )}

            <div className="text-[11px] text-white/45 flex items-center justify-between">
              <span>
                {!recognitionSupported ? "⚠️ Reconnaissance vocale indisponible (clavier OK)." : ""}
                {!speechSupported ? " ⚠️ Synthèse vocale indisponible." : ""}
              </span>
              <span className="text-white/45">{jobTitle ? `Poste: ${jobTitle}` : ""}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
