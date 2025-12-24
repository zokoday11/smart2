"use client";

import { API_BASE, tryGetRecaptchaToken } from "@/lib/recaptcha";

type JsonHeaders = Record<string, string>;

function normalizePath(path: string) {
  return (path || "").replace(/^\/+/, "");
}

function buildRecaptchaError(action: string) {
  return new Error(
    `reCAPTCHA indisponible pour l’action "${action}". ` +
      `Vérifie : (1) NEXT_PUBLIC_RECAPTCHA_SITE_KEY, (2) script chargé, (3) adblock, (4) domaine autorisé côté Google.`
  );
}

export async function postJsonWithRecaptcha<T>(
  path: string,
  action: string,
  body: any,
  extraHeaders: JsonHeaders = {}
): Promise<T> {
  const token = await tryGetRecaptchaToken(action);
  if (!token) throw buildRecaptchaError(action);

  const res = await fetch(`${API_BASE}/${normalizePath(path)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Recaptcha-Token": token,
      ...extraHeaders,
    },
    body: JSON.stringify({
      ...body,
      recaptchaToken: token, // ✅ compatible avec ton backend
      recaptchaAction: action,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // si le backend renvoie pas du JSON
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

export async function postBlobWithRecaptcha(
  path: string,
  action: string,
  body: any,
  extraHeaders: JsonHeaders = {}
): Promise<Blob> {
  const token = await tryGetRecaptchaToken(action);
  if (!token) throw buildRecaptchaError(action);

  const res = await fetch(`${API_BASE}/${normalizePath(path)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Recaptcha-Token": token,
      ...extraHeaders,
    },
    body: JSON.stringify({
      ...body,
      recaptchaToken: token,
      recaptchaAction: action,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    const msg =
      (data && (data.error || data.message)) ||
      text ||
      `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return await res.blob();
}
