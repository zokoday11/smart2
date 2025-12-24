// lib/recaptcha.ts
"use client";

/**
 * ✅ Single source of truth reCAPTCHA (v3 standard ou Enterprise)
 * - Loader robuste (si script pas encore chargé)
 * - tryGetRecaptchaToken(): non bloquant => retourne null si adblock/timeout…
 * - getRecaptchaToken(): strict => throw si impossible
 * - verifyRecaptcha(): optionnel via ton endpoint CF /recaptchaVerify (Enterprise)
 */

declare global {
  interface Window {
    grecaptcha?: GrecaptchaRoot;
  }
}

type GrecaptchaClient = {
  ready?: (cb: () => void) => void;
  execute: (siteKey: string, opts: { action: string }) => Promise<string>;
};

type GrecaptchaRoot = GrecaptchaClient & {
  enterprise?: GrecaptchaClient;
};

export type VerifyResult =
  | { ok: true; score?: number }
  | { ok: false; reason: string; score?: number };

const DEFAULT_API_BASE =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net";

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE
).replace(/\/+$/, "");

const SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ||
  process.env.NEXT_PUBLIC_RECAPTCHA_KEY ||
  "";

const USE_ENTERPRISE =
  (process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE || "")
    .toLowerCase()
    .trim() === "true";

let recaptchaLoadPromise: Promise<void> | null = null;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function normalizeAction(action: string) {
  return (action || "").trim().toLowerCase();
}

function describeRecaptchaLoadFailure() {
  return [
    "Sécurité: impossible de valider reCAPTCHA.",
    "Le script reCAPTCHA n’a pas pu être chargé ou est bloqué.",
    "Causes fréquentes: bloqueur de pubs, DNS filtrant, proxy/corporate, CSP trop stricte, ou réseau qui bloque google.com.",
  ].join(" ");
}

function hasUsableRecaptcha(): boolean {
  const g = window.grecaptcha;
  if (!g) return false;

  if (USE_ENTERPRISE) {
    return Boolean(g.enterprise && typeof g.enterprise.execute === "function");
  }

  return typeof g.execute === "function";
}

function pickRecaptchaClient(): GrecaptchaClient | null {
  const g = window.grecaptcha;
  if (!g) return null;

  if (USE_ENTERPRISE) {
    if (g.enterprise && typeof g.enterprise.execute === "function") return g.enterprise;
    return null;
  }

  if (typeof g.execute === "function") return g;
  return null;
}

/**
 * ✅ Loader robuste:
 * - attend que grecaptcha soit réellement dispo (poll)
 * - retentable (reset promise en cas d’échec)
 */
async function ensureRecaptchaLoaded(): Promise<void> {
  if (!isBrowser()) {
    throw new Error("reCAPTCHA: appelé côté serveur (SSR).");
  }
  if (!SITE_KEY) {
    throw new Error("reCAPTCHA: NEXT_PUBLIC_RECAPTCHA_SITE_KEY manquant.");
  }
  if (hasUsableRecaptcha()) return;
  if (recaptchaLoadPromise) return recaptchaLoadPromise;

  recaptchaLoadPromise = new Promise<void>((resolve, reject) => {
    const selector = USE_ENTERPRISE
      ? 'script[data-recaptcha="enterprise"]'
      : 'script[data-recaptcha="v3"]';

    const existing = document.querySelector<HTMLScriptElement>(selector);

    const pollUntilReady = (ms: number) => {
      const t0 = Date.now();
      const tick = () => {
        if (hasUsableRecaptcha()) return resolve();
        if (Date.now() - t0 > ms) return reject(new Error(describeRecaptchaLoadFailure()));
        requestAnimationFrame(tick);
      };
      tick();
    };

    // Script déjà présent => on attend juste l'exposition de grecaptcha
    if (existing) {
      pollUntilReady(10_000);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.setAttribute("data-recaptcha", USE_ENTERPRISE ? "enterprise" : "v3");

    const base = USE_ENTERPRISE
      ? "https://www.google.com/recaptcha/enterprise.js"
      : "https://www.google.com/recaptcha/api.js";

    script.src = `${base}?render=${encodeURIComponent(SITE_KEY)}`;

    const timeout = window.setTimeout(() => {
      reject(new Error(describeRecaptchaLoadFailure()));
    }, 12_000);

    script.onload = () => {
      window.clearTimeout(timeout);
      pollUntilReady(8_000);
    };

    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error(describeRecaptchaLoadFailure()));
    };

    document.head.appendChild(script);
  }).catch((e) => {
    recaptchaLoadPromise = null; // ✅ retentable
    throw e;
  });

  return recaptchaLoadPromise;
}

/**
 * ✅ Non bloquant :
 * - retourne un token si possible
 * - sinon null (adblock, script bloqué, timeout…)
 */
export async function tryGetRecaptchaToken(action: string): Promise<string | null> {
  if (!isBrowser()) return null;
  if (!SITE_KEY) return null;

  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return null;

  try {
    await ensureRecaptchaLoaded();
    const client = pickRecaptchaClient();
    if (!client) return null;

    const token = await new Promise<string>((resolve, reject) => {
      const runExecute = () => {
        client
          .execute(SITE_KEY, { action: normalizedAction })
          .then((t) => resolve(t))
          .catch(reject);
      };

      try {
        if (typeof client.ready === "function") client.ready(runExecute);
        else runExecute();
      } catch (e) {
        reject(e);
      }
    });

    return typeof token === "string" && token ? token : null;
  } catch {
    return null;
  }
}

/** Version stricte */
export async function getRecaptchaToken(action: string): Promise<string> {
  const token = await tryGetRecaptchaToken(action);
  if (!token) {
    throw new Error(describeRecaptchaLoadFailure());
  }
  return token;
}

export async function warmupRecaptcha(): Promise<void> {
  await ensureRecaptchaLoaded();
}

/** Vérif optionnelle via endpoint /recaptchaVerify */
export async function verifyRecaptcha(token: string, action: string): Promise<VerifyResult> {
  const normalizedAction = normalizeAction(action);

  if (!token) return { ok: false, reason: "missing_token" };
  if (!normalizedAction) return { ok: false, reason: "missing_action" };

  try {
    const res = await fetch(`${API_BASE}/recaptchaVerify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action: normalizedAction }),
      cache: "no-store",
    });

    const data: any = await res.json().catch(() => ({}));

    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        reason: String(data?.reason || data?.details?.reason || "recaptcha_failed"),
        score: typeof data?.score === "number"
          ? data.score
          : typeof data?.details?.score === "number"
            ? data.details.score
            : undefined,
      };
    }

    return { ok: true, score: typeof data?.score === "number" ? data.score : undefined };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}
