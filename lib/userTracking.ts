// lib/userTracking.ts
import { User } from "firebase/auth";
import {
  collection,
  addDoc,
  doc,
  setDoc,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Infos IP / localisation
 */
type IpInfo = {
  ip: string;
  country: string;
  city: string;
};

// Cache en mémoire pour éviter d'appeler l'API à chaque fois
let ipInfoCache: IpInfo | null = null;
let ipInfoPromise: Promise<IpInfo | null> | null = null;

async function getIpInfo(): Promise<IpInfo | null> {
  if (ipInfoCache) return ipInfoCache;
  if (typeof window === "undefined") return null;

  if (ipInfoPromise) return ipInfoPromise;

  ipInfoPromise = (async () => {
    try {
      // API publique simple, tu peux la changer si besoin
      const res = await fetch("https://ipapi.co/json/");
      if (!res.ok) throw new Error("IP API error");
      const data = await res.json();
      const info: IpInfo = {
        ip: data.ip,
        country: data.country_name,
        city: data.city,
      };
      ipInfoCache = info;
      return info;
    } catch (e) {
      console.error("Erreur getIpInfo:", e);
      return null;
    } finally {
      ipInfoPromise = null;
    }
  })();

  return ipInfoPromise;
}

/**
 * Infos device / OS / navigateur
 * ➜ différencie iPhone / iPad / macOS / Android / Windows…
 */
type DeviceInfo = {
  deviceType: string; // "iphone" | "ipad" | "mac" | "mobile" | "tablet" | "desktop" | "unknown"
  os: string;
  browser: string;
};

function detectDeviceInfo(): DeviceInfo {
  if (typeof navigator === "undefined") {
    return { deviceType: "unknown", os: "unknown", browser: "unknown" };
  }

  const ua = navigator.userAgent || "";
  const lower = ua.toLowerCase();

  let deviceType = "unknown";
  let os = "unknown";
  let browser = "unknown";

  // --- OS + device ---
  if (/iphone/i.test(ua)) {
    deviceType = "iphone";
    os = "iOS";
  } else if (/ipad/i.test(ua)) {
    deviceType = "ipad";
    os = "iPadOS";
  } else if (/android/i.test(ua)) {
    os = "Android";
    deviceType = /mobile/i.test(ua) ? "mobile" : "tablet";
  } else if (/macintosh|mac os x/i.test(ua)) {
    os = "macOS";
    deviceType = "mac";
  } else if (/windows/i.test(ua)) {
    os = "Windows";
    deviceType = "desktop";
  } else if (/linux/i.test(ua)) {
    os = "Linux";
    deviceType = "desktop";
  }

  // --- navigateur ---
  if (lower.includes("edg/")) {
    browser = "Edge";
  } else if (lower.includes("opr/") || lower.includes("opera")) {
    browser = "Opera";
  } else if (lower.includes("firefox")) {
    browser = "Firefox";
  } else if (lower.includes("chrome") && !lower.includes("edge") && !lower.includes("opr")) {
    browser = "Chrome";
  } else if (lower.includes("safari") && !lower.includes("chrome")) {
    browser = "Safari";
  }

  return { deviceType, os, browser };
}

/**
 * Mise à jour du doc "users/{uid}" pour suivre :
 * - dernière activité
 * - dernière page
 * - IP / pays / ville
 * - device / OS / navigateur
 */
export async function updateLastActive(
  user: User,
  extra?: { path?: string; action?: string }
) {
  if (!user) return;

  try {
    const [ipInfo, device] = await Promise.all([
      getIpInfo(),
      Promise.resolve(detectDeviceInfo()),
    ]);

    const ref = doc(db, "users", user.uid);

    const path =
      extra?.path ??
      (typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : null);

    const now = Date.now();

    const payload: any = {
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      lastSeenAt: now,
      lastSeenPage: path,
      lastDeviceType: device.deviceType,
      lastOs: device.os,
      lastBrowser: device.browser,
    };

    if (user.metadata?.lastSignInTime) {
      payload.lastLoginAt = new Date(
        user.metadata.lastSignInTime
      ).getTime();
    }

    if (ipInfo) {
      payload.lastSeenIp = ipInfo.ip;
      payload.lastSeenCountry = ipInfo.country;
      payload.lastSeenCity = ipInfo.city;
    }

    if (extra?.action) {
      payload.lastAction = extra.action;
      payload.lastActionAt = now;
    }

    await setDoc(ref, payload, { merge: true });
  } catch (e) {
    console.error("Erreur updateLastActive:", e);
  }
}

/**
 * Options pour les logs d’usage
 * - action = nom de l’évènement (ex: "lm_generate", "lm_download", "cv_generate")
 * - docType = "lm" | "cv" | "pitch"...
 * - eventType = "generate" | "download" | "view"...
 * - tool = comment tu catégorises ton outil (ex: "lm", "cv", "assistant")
 * - creditsDelta = variation de crédits (ex: -1 quand tu consommes 1 crédit)
 *
 * ➜ grâce à [key: string]: any, tu peux passer
 *    feature, template, lang, contract, targetJob, companyName, etc.
 */
export type LogUsageOptions = {
  tool?: string;
  docType?: "lm" | "cv" | "pitch" | string;
  eventType?: "generate" | "download" | "view" | "auth" | string;
  creditsDelta?: number;
  path?: string;
  meta?: Record<string, any>;
  // pour autoriser des clés libres (feature, template, lang, etc.)
  [key: string]: any;
};

/**
 * Log d’un événement important (appel IA, génération LM/CV, téléchargement…)
 * ➜ crée un doc dans usageLogs
 * ➜ met à jour les compteurs dans users
 *
 * Tous les champs supplémentaires (feature, template, lang, jobTitle, etc.)
 * sont rangés dans log.meta.
 */
export async function logUsage(
  user: User | null,
  action: string,
  options?: LogUsageOptions
) {
  if (!user) return;

  try {
    const [ipInfo, device] = await Promise.all([
      getIpInfo(),
      Promise.resolve(detectDeviceInfo()),
    ]);

    const now = Date.now();

    // On extrait les options "connues" et on met le reste dans `rest`
    const {
      tool,
      docType,
      eventType,
      creditsDelta,
      path: optPath,
      meta,
      ...rest
    } = options ?? {};

    const path =
      optPath ??
      (typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : null);

    // --- 1) Créer un document dans usageLogs ---
    const log: any = {
      userId: user.uid,
      email: user.email ?? null,
      action,
      tool: tool ?? null,
      docType: docType ?? null,
      eventType: eventType ?? null,
      createdAt: now,
      path,
      creditsDelta:
        typeof creditsDelta === "number" ? creditsDelta : null,
      deviceType: device.deviceType,
      os: device.os,
      browser: device.browser,
    };

    if (ipInfo) {
      log.ip = ipInfo.ip;
      log.country = ipInfo.country;
      log.city = ipInfo.city;
    }

    // Fusionne meta + toutes les autres clés libres (feature, template, ...)
    if (meta || Object.keys(rest).length > 0) {
      log.meta = {
        ...(meta || {}),
        ...rest,
      };
    }

    const logsRef = collection(db, "usageLogs");
    await addDoc(logsRef, log);

    // --- 2) Mettre à jour les compteurs dans users/{uid} ---
    const userRef = doc(db, "users", user.uid);

    const update: any = {
      lastSeenAt: now,
      lastSeenPage: path,
      lastDeviceType: device.deviceType,
      lastOs: device.os,
      lastBrowser: device.browser,
    };

    if (ipInfo) {
      update.lastSeenIp = ipInfo.ip;
      update.lastSeenCountry = ipInfo.country;
      update.lastSeenCity = ipInfo.city;
    }

    const inc: any = {};

    // Appels IA
    if (tool) {
      inc.totalIaCalls = increment(1);
    }

    // Documents générés
    if (docType) {
      inc.totalDocumentsGenerated = increment(1);
      if (docType === "lm") {
        inc.totalLmGenerated = increment(1);
      }
      if (docType === "cv") {
        inc.totalCvGenerated = increment(1);
      }
    }

    // Crédits consommés / ajoutés
    if (typeof creditsDelta === "number") {
      inc.credits = increment(creditsDelta);
    }

    Object.assign(update, inc);

    await setDoc(userRef, update, { merge: true });
  } catch (e) {
    console.error("Erreur logUsage:", e);
  }
}
