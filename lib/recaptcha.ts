"use client";

// lib/recaptcha.ts
export type VerifyResult =
  | { ok: true; score?: number }
  | { ok: false; reason: string; score?: number };

const DEFAULT_API_BASE =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  DEFAULT_API_BASE
).replace(/\/+$/, "");

/**
 * Normalise l'action pour éviter les mismatches (case-sensitive).
 * Choisis une convention et garde-la partout.
 */
function normalizeAction(action: string) {
  return (action || "").trim().toLowerCase();
}

function withTimeout<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(reason)), ms);
    p.then((v) => {
      window.clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      window.clearTimeout(t);
      reject(e);
    });
  });
}

/**
 * ✅ Version "non bloquante" :
 * - retourne un token si possible
 * - sinon retourne null (adblock, script bloqué, timeout, etc.)
 */
export async function tryGetRecaptchaToken(
  action: string
): Promise<string | null> {
  if (typeof window === "undefined") return null;

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) return null;

  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return null;

  const grecaptcha = (window as any).grecaptcha;

  try {
    // ✅ Enterprise
    if (grecaptcha?.enterprise) {
      await withTimeout<void>(
        new Promise<void>((resolve) => grecaptcha.enterprise.ready(resolve)),
        4000,
        "reCAPTCHA Enterprise ready timeout"
      );

      const token = await grecaptcha.enterprise.execute(siteKey, {
        action: normalizedAction,
      });

      return typeof token === "string" && token ? token : null;
    }

    // ✅ Fallback v3 (dev / autre config)
    if (
      typeof grecaptcha?.ready === "function" &&
      typeof grecaptcha?.execute === "function"
    ) {
      await withTimeout<void>(
        new Promise<void>((resolve) => grecaptcha.ready(resolve)),
        4000,
        "reCAPTCHA ready timeout"
      );

      const token = await grecaptcha.execute(siteKey, {
        action: normalizedAction,
      });
      return typeof token === "string" && token ? token : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * ✅ Version "stricte" (compat) : conserve ton ancien comportement
 * (utile si tu veux forcer reCAPTCHA dans certains écrans).
 */
export async function getRecaptchaToken(action: string): Promise<string> {
  const token = await tryGetRecaptchaToken(action);
  if (!token) {
    throw new Error("reCAPTCHA non chargé (script bloqué ? adblock ?)");
  }
  return token;
}

/**
 * Vérifie un token côté serveur (si tu gardes l'endpoint recaptchaVerify).
 */
export async function verifyRecaptcha(
  token: string,
  action: string
): Promise<VerifyResult> {
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
        reason: String(
          data?.reason || data?.details?.reason || "recaptcha_failed"
        ),
        score:
          typeof data?.score === "number"
            ? data.score
            : typeof data?.details?.score === "number"
            ? data.details.score
            : undefined,
      };
    }

    return {
      ok: true,
      score: typeof data?.score === "number" ? data.score : undefined,
    };
  } catch {
    return { ok: false, reason: "network_error" };
  }
}
