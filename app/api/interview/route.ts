// app/api/interview/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  buildPrompt,
  InterviewLevel,
  InterviewChannel,
  HistoryItem,
} from "@/lib/interviewPrompt";
import {
  verifyUserAndCredits,
  consumeCredit,
} from "@/lib/server/credits";

export const runtime = "nodejs";

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
  return Math.random().toString(36).slice(2);
}

// ---- Handler principal ---- //

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // ---------- DÉMARRER L'ENTRETIEN ---------- //
    if (action === "start") {
      const { userId, jobDesc, cvSummary, mode, channel, level } = body;

      if (!userId) {
        return NextResponse.json(
          { error: "Missing userId" },
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
      } catch (err) {
        console.error("JSON parse error (start):", err, llmResponseText);
        return NextResponse.json(
          { error: "LLM response parse error" },
          { status: 500 }
        );
      }

      const firstQuestion =
        parsed.next_question || "Parlez-moi de vous.";

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

    // ---------- RÉPONDRE À UNE QUESTION ---------- //
    if (action === "answer") {
      const { userId, sessionId, userMessage, channel, step } = body;

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
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }

      if (session.userId !== userId) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }

      const history = Array.isArray(session.history)
        ? [...session.history]
        : [];

      history.push({
        role: "candidate",
        text: userMessage,
        createdAt: new Date().toISOString(),
      });

      const nextStep =
        typeof step === "number"
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
        } catch (err) {
        console.error("JSON parse error (answer):", err, llmResponseText);
        return NextResponse.json(
          { error: "LLM response parse error" },
          { status: 500 }
        );
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

      const nowIso = new Date().toISOString();

      const updated: InterviewSession = {
        ...session,
        history,
        lastUpdated: nowIso,
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

    return NextResponse.json(
      { error: "Unknown action" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Interview API error:", err);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

// ---- APPEL GEMINI ---- //

async function callLLM(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn(
      "[Interview] GEMINI_API_KEY manquant → fallback démo."
    );
    // 👉 ici tu peux renvoyer une réponse “fake” simple
    return JSON.stringify({
      next_question:
        "Mode démo : peux-tu me résumer ton expérience la plus récente en lien avec ce poste ?",
      short_analysis:
        "Mode démo sans Gemini : configure GEMINI_API_KEY pour avoir l’analyse réelle.",
      final_summary: null,
      final_score: null,
    });
  }

  // 🔴 ICI tu choisis le modèle 2.5
  const model =
    process.env.GEMINI_MODEL || "models/gemini-2.5-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    console.error("Gemini error (interview):", resp.status, errorText);

    // Si c’est un 429 (quota dépassé), tu peux retourner un JSON “fallback”
    if (resp.status === 429) {
      console.warn("[Interview] Quota Gemini dépassé → fallback démo.");
      return JSON.stringify({
        next_question:
          "Mode démo (quota dépassé) : peux-tu me raconter un de tes projets dont tu es fièr(e) ?",
        short_analysis:
          "Le quota de l’API Gemini est dépassé. Ceci est un scénario d’entretien simulé.",
        final_summary: null,
        final_score: null,
      });
    }

    throw new Error("Gemini call failed");
  }

  const data = await resp.json();

  const textRaw: string =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("")
      .trim() || "";

  if (!textRaw) {
    throw new Error("Empty Gemini response");
  }

  const text = textRaw.trim();

  // On laisse Gemini renvoyer directement un JSON ; le parse se fait dans le handler
  return text;
}
