// lib/recaptcha.ts
"use client";

/**
 * ✅ Single source of truth reCAPTCHA (v3 standard ou Enterprise)
 * - Loader robuste (script injecté si absent + attente réelle de grecaptcha)
 * - tryGetRecaptchaToken(): non bloquant => retourne null si adblock/timeout…
 * - getRecaptchaToken(): strict => throw si impossible
 * - verifyRecaptcha(): optionnel via endpoint CF /recaptchaVerify (Enterprise côté serveur)
 *
 * Notes :
 * - Côté Cloud Functions, tes endpoints acceptent le token via body.recaptchaToken|token
 *   OU via header "x-recaptcha-token".
 * - L’action est normalisée côté client, et envoyée au /recaptchaVerify (optionnel).
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

const DEFAULT_API_BASE = "https://europe-west1-assistant-ia-v4.cloudfunctions.net";

export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE).replace(
  /\/+$/,
  ""
);

const SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ||
  process.env.NEXT_PUBLIC_RECAPTCHA_KEY ||
  "";

const USE_ENTERPRISE =
  (process.env.NEXT_PUBLIC_RECAPTCHA_ENTERPRISE || "").toLowerCase().trim() === "true";

/**
 * Optionnel : certains environnements bloquent google.com mais autorisent recaptcha.net
 * (même si, souvent, les deux sont filtrés). Tu peux forcer via env si besoin.
 */
const USE_RECAPTCHA_NET =
  (process.env.NEXT_PUBLIC_RECAPTCHA_USE_NET || "").toLowerCase().trim() === "true";

let recaptchaLoadPromise: Promise<void> | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function normalizeAction(action: string): string {
  return (action || "").trim().toLowerCase();
}

function describeRecaptchaLoadFailure(): string {
  return [
    "Sécurité: impossible de valider reCAPTCHA.",
    "Le script reCAPTCHA n’a pas pu être chargé ou est bloqué.",
    "Causes fréquentes: bloqueur de pubs, DNS filtrant, proxy/corporate, CSP trop stricte, ou réseau qui bloque google.com.",
  ].join(" ");
}

function getScriptSelector(): string {
  return USE_ENTERPRISE ? 'script[data-recaptcha="enterprise"]' : 'script[data-recaptcha="v3"]';
}

function getScriptSrc(): string {
  const host = USE_RECAPTCHA_NET ? "https://www.recaptcha.net" : "https://www.google.com";
  const base = USE_ENTERPRISE
    ? `${host}/recaptcha/enterprise.js`
    : `${host}/recaptcha/api.js`;
  return `${base}?render=${encodeURIComponent(SITE_KEY)}`;
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
 * ✅ Loader robuste :
 * - injecte le script si absent
 * - attend que grecaptcha soit réellement dispo
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
    const selector = getScriptSelector();
    const existing = document.querySelector<HTMLScriptElement>(selector);

    const waitUntil = (timeoutMs: number) => {
      const t0 = Date.now();

      const tick = () => {
        if (hasUsableRecaptcha()) return resolve();
        if (Date.now() - t0 > timeoutMs) return reject(new Error(describeRecaptchaLoadFailure()));

        // requestAnimationFrame peut être throttlé en onglet inactif, on mixe avec setTimeout.
        window.setTimeout(tick, 50);
      };

      tick();
    };

    // Script déjà présent => on attend juste l'exposition de grecaptcha
    if (existing) {
      waitUntil(12_000);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.setAttribute("data-recaptcha", USE_ENTERPRISE ? "enterprise" : "v3");
    script.src = getScriptSrc();

    const timeout = window.setTimeout(() => {
      reject(new Error(describeRecaptchaLoadFailure()));
    }, 15_000);

    script.onload = () => {
      window.clearTimeout(timeout);
      waitUntil(10_000);
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

    return typeof token === "string" && token.trim() ? token : null;
  } catch {
    return null;
  }
}

/** Version stricte */
export async function getRecaptchaToken(action: string): Promise<string> {
  const token = await tryGetRecaptchaToken(action);
  if (!token) throw new Error(describeRecaptchaLoadFailure());
  return token;
}

/** Précharge le script (utile au mount) */
export async function warmupRecaptcha(): Promise<void> {
  await ensureRecaptchaLoaded();
}

/**
 * Helper pratique pour tes appels Cloud Functions:
 * - met le token en header (tes CF le lisent via x-recaptcha-token)
 * - ou tu peux aussi le mettre dans le body (recaptchaToken)
 */
export function buildRecaptchaHeaders(token: string | null): HeadersInit {
  if (!token) return {};
  return {
    "X-Recaptcha-Token": token,
    "x-recaptcha-token": token,
  };
}

/** Vérif optionnelle via endpoint /recaptchaVerify (serveur) */
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
      const score =
        typeof data?.score === "number"
          ? data.score
          : typeof data?.details?.score === "number"
            ? data.details.score
            : undefined;

      return {
        ok: false,
        reason: String(data?.reason || data?.details?.reason || "recaptcha_failed"),
        score,
      };
    }

    return { ok: true, score: typeof data?.score === "number" ? data.score : undefined };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}
