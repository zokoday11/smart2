// app/api/interview/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  buildPrompt,
  InterviewLevel,
  InterviewChannel,
  HistoryItem,
} from "@/lib/interviewPrompt";
import { verifyUserAndCredits, consumeCredit } from "@/lib/server/credits";

export const runtime = "nodejs";

/**
 * ✅ reCAPTCHA OFF par défaut
 * -> Active uniquement si INTERVIEW_REQUIRE_RECAPTCHA=true
 */
const REQUIRE_RECAPTCHA =
  (process.env.INTERVIEW_REQUIRE_RECAPTCHA || "").toLowerCase().trim() ===
  "true";

// ---- Sessions en mémoire (DEV) ---- //
type InterviewSession = {
  userId: string;
  createdAt: string;
  lastUpdated: string;
  jobDesc: string;
  cvSummary: string;
  mode: string;
  level: InterviewLevel;
  channel: InterviewChannel;
  status: "active" | "completed";
  currentStep: number;
  history: HistoryItem[];
  score?: number | null;
  finalSummary?: string | null;
};

const memorySessions = new Map<string, InterviewSession>();

function createSessionId() {
  try {
    // @ts-ignore
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).slice(2) + "-" + Date.now().toString(36);
  }
}

function purgeOldSessions(maxAgeMs = 1000 * 60 * 60 * 6) {
  const now = Date.now();
  for (const [sid, s] of memorySessions.entries()) {
    const t = Date.parse(s.lastUpdated || s.createdAt);
    if (!Number.isNaN(t) && now - t > maxAgeMs) memorySessions.delete(sid);
  }
}

// ---------------- reCAPTCHA (Enterprise via CF recaptchaVerify) ----------------
type RecaptchaVerifyResult =
  | { ok: true; score?: number }
  | { ok: false; reason: string; score?: number };

function stripTrailingSlash(s: string) {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function getApiBaseServer(): string {
  return stripTrailingSlash(
    process.env.CLOUD_FUNCTIONS_BASE_URL ||
      process.env.API_BASE_URL ||
      "https://europe-west1-assistant-ia-v4.cloudfunctions.net"
  );
}

async function verifyRecaptchaEnterpriseViaCF(
  token: string,
  action: string
): Promise<RecaptchaVerifyResult> {
  const base = getApiBaseServer();
  try {
    const res = await fetch(`${base}/recaptchaVerify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: (action || "").trim() }),
      cache: "no-store",
    });

    const data: any = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        reason: String(data?.reason || data?.error || "recaptcha_failed"),
        score: typeof data?.score === "number" ? data.score : undefined,
      };
    }

    return {
      ok: true,
      score: typeof data?.score === "number" ? data.score : undefined,
    };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "network_error" };
  }
}

// ---- Handler principal ---- //
export async function POST(req: NextRequest) {
  try {
    purgeOldSessions();

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { action } = body as any;

    // ✅ token peut venir de plusieurs endroits (selon ton front)
    const recaptchaToken =
      (body as any)?.recaptchaToken ||
      (body as any)?.token ||
      (body as any)?.recaptcha?.token ||
      null;

    const recaptchaAction =
      (body as any)?.recaptchaAction ||
      (body as any)?.recaptcha?.action ||
      "interview";

    // ✅ reCAPTCHA (optionnel)
    if (REQUIRE_RECAPTCHA) {
      if (!recaptchaToken || typeof recaptchaToken !== "string") {
        return NextResponse.json(
          {
            error: "reCAPTCHA failed",
            details: "token_missing_or_invalid",
            requireRecaptcha: true,
            expectedAction: recaptchaAction,
          },
          { status: 403 }
        );
      }

      const rec = await verifyRecaptchaEnterpriseViaCF(
        recaptchaToken,
        recaptchaAction
      );

      if (!rec.ok) {
        return NextResponse.json(
          {
            error: "reCAPTCHA failed",
            details: rec.reason,
            score: rec.score ?? null,
            requireRecaptcha: true,
            expectedAction: recaptchaAction,
          },
          { status: 403 }
        );
      }
    }

    // ---------- START ---------- //
    if (action === "start") {
      const { userId, jobDesc, cvSummary, mode, channel, level } = body as any;

      if (!userId) {
        return NextResponse.json({ error: "Missing userId" }, { status: 400 });
      }

      const user = await verifyUserAndCredits(userId);
      if (!user) {
        return NextResponse.json(
          { error: "Unauthorized or no credits" },
          { status: 401 }
        );
      }

      const nowIso = new Date().toISOString();
      const safeMode = (mode || "mixed") as string;
      const safeChannel = (channel || "written") as InterviewChannel;
      const safeLevel = (level || "junior") as InterviewLevel;

      const sessionId = createSessionId();

      const sessionData: InterviewSession = {
        userId,
        createdAt: nowIso,
        lastUpdated: nowIso,
        jobDesc: jobDesc || "",
        cvSummary: cvSummary || "",
        mode: safeMode,
        level: safeLevel,
        channel: safeChannel,
        status: "active",
        currentStep: 1,
        history: [],
      };

      memorySessions.set(sessionId, sessionData);

      const prompt = buildPrompt({
        cvSummary: sessionData.cvSummary,
        jobDesc: sessionData.jobDesc,
        mode: sessionData.mode,
        level: sessionData.level,
        channel: sessionData.channel,
        history: [],
        step: 1,
      });

      const llmResponseText = await callLLM(prompt);

      let parsed: any;
      try {
        parsed = JSON.parse(llmResponseText);
      } catch {
        parsed = { next_question: "Parlez-moi de vous.", short_analysis: null };
      }

      const firstQuestion = parsed.next_question || "Parlez-moi de vous.";

      const historyItem: HistoryItem = {
        role: "interviewer",
        text: firstQuestion,
        createdAt: new Date().toISOString(),
      };

      const updatedSession = memorySessions.get(sessionId);
      if (updatedSession) {
        updatedSession.history.push(historyItem);
        updatedSession.currentStep = 1;
        updatedSession.lastUpdated = new Date().toISOString();
        memorySessions.set(sessionId, updatedSession);
      }

      await consumeCredit(userId);

      return NextResponse.json({
        sessionId,
        firstQuestion,
        shortAnalysis: parsed.short_analysis ?? null,
      });
    }

    // ---------- ANSWER ---------- //
    if (action === "answer") {
      const { userId, sessionId, userMessage, channel, step } = body as any;

      if (!userId || !sessionId || !userMessage?.trim()) {
        return NextResponse.json(
          { error: "Missing userId, sessionId or userMessage" },
          { status: 400 }
        );
      }

      const user = await verifyUserAndCredits(userId);
      if (!user) {
        return NextResponse.json(
          { error: "Unauthorized or no credits" },
          { status: 401 }
        );
      }

      const session = memorySessions.get(sessionId);
      if (!session) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }

      if (session.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const history = Array.isArray(session.history) ? [...session.history] : [];

      history.push({
        role: "candidate",
        text: userMessage,
        createdAt: new Date().toISOString(),
      });

      const nextStep =
        typeof step === "number" && Number.isFinite(step)
          ? step
          : (session.currentStep || 1) + 1;

      const prompt = buildPrompt({
        cvSummary: session.cvSummary,
        jobDesc: session.jobDesc,
        mode: session.mode,
        level: (session.level || "junior") as InterviewLevel,
        channel: (channel || session.channel || "written") as InterviewChannel,
        history,
        step: nextStep,
      });

      const llmResponseText = await callLLM(prompt);

      let parsed: any;
      try {
        parsed = JSON.parse(llmResponseText);
      } catch {
        parsed = {
          next_question: "Merci. Peux-tu illustrer avec un exemple concret ?",
          short_analysis: "",
          final_summary: null,
          final_score: null,
        };
      }

      const nextQuestion =
        parsed.next_question || "Merci, l’entretien est terminé.";
      const shortAnalysis = parsed.short_analysis ?? "";
      const isFinal = Boolean(parsed.final_summary);

      history.push({
        role: "interviewer",
        text: nextQuestion,
        createdAt: new Date().toISOString(),
      });

      const updated: InterviewSession = {
        ...session,
        history,
        lastUpdated: new Date().toISOString(),
        currentStep: nextStep,
      };

      if (isFinal) {
        updated.status = "completed";
        updated.score = parsed.final_score ?? null;
        updated.finalSummary = parsed.final_summary ?? null;
      }

      memorySessions.set(sessionId, updated);

      await consumeCredit(userId);

      return NextResponse.json({
        nextQuestion,
        shortAnalysis,
        finalSummary: parsed.final_summary ?? null,
        finalScore: parsed.final_score ?? null,
        isFinal,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Interview API error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ---- APPEL GEMINI ---- //
async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return JSON.stringify({
      next_question:
        "Mode démo : peux-tu me résumer ton expérience la plus récente en lien avec ce poste ?",
      short_analysis:
        "Mode démo sans Gemini : configure GEMINI_API_KEY pour avoir l’analyse réelle.",
      final_summary: null,
      final_score: null,
    });
  }

  const modelRaw = process.env.GEMINI_MODEL || "models/gemini-2.5-flash";
  const model = modelRaw.startsWith("models/") ? modelRaw : `models/${modelRaw}`;
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

  const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }] };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "");
    console.error("Gemini error (interview):", resp.status, errorText);
    return JSON.stringify({
      next_question:
        "Je n'arrive pas à joindre l’IA. Donne-moi : contexte / actions / résultats (STAR).",
      short_analysis: `Fallback Gemini HTTP ${resp.status}`,
      final_summary: null,
      final_score: null,
    });
  }

  const data = await resp.json().catch(() => null);

  const textRaw: string =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("")
      .trim() || "";

  if (!textRaw) {
    return JSON.stringify({
      next_question: "Peux-tu préciser ?",
      short_analysis: "",
      final_summary: null,
      final_score: null,
    });
  }

  return textRaw.trim();
}
