// src/lib/logAuthFailed.ts
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface LogAuthFailedParams {
  email?: string;
  provider?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Détection OS / device / navigateur à partir du userAgent
 */
function parseUserAgent(uaRaw: string | null | undefined) {
  const ua = (uaRaw ?? "").toLowerCase();

  let deviceType: string | null = null;
  let os: string | null = null;
  let browser: string | null = null;

  // --- Device ---
  if (ua.includes("iphone")) {
    deviceType = "iphone";
  } else if (ua.includes("ipad")) {
    deviceType = "ipad";
  } else if (ua.includes("android") && ua.includes("mobile")) {
    deviceType = "mobile";
  } else if (ua.includes("android")) {
    deviceType = "tablet";
  } else if (ua.includes("macintosh") || ua.includes("mac os x")) {
    deviceType = "desktop";
  } else if (ua.includes("windows")) {
    deviceType = "desktop";
  } else {
    deviceType = "desktop";
  }

  // --- OS ---
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) {
    os = "iOS";
  } else if (ua.includes("android")) {
    os = "Android";
  } else if (ua.includes("mac os x") || ua.includes("macintosh")) {
    os = "macOS";
  } else if (ua.includes("windows nt")) {
    os = "Windows";
  } else if (ua.includes("linux")) {
    os = "Linux";
  }

  // --- Navigateur ---
  if (ua.includes("safari") && !ua.includes("chrome") && !ua.includes("crios")) {
    browser = "Safari";
  } else if (
    (ua.includes("chrome") || ua.includes("crios")) &&
    !ua.includes("edge") &&
    !ua.includes("edg/")
  ) {
    browser = "Chrome";
  } else if (ua.includes("firefox") || ua.includes("fxios")) {
    browser = "Firefox";
  } else if (ua.includes("edg/")) {
    browser = "Edge";
  } else if (ua.includes("opera") || ua.includes("opr/")) {
    browser = "Opera";
  }

  return { deviceType, os, browser };
}

/**
 * Récupère l'IP + ville + pays via un petit service public
 * (tu peux changer pour ton propre endpoint si tu veux).
 */
async function fetchIpInfo() {
  if (typeof window === "undefined") return null;

  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) return null;
    const json: any = await res.json();

    return {
      ip: json.ip || null,
      country: json.country_name || null,
      city: json.city || null,
    };
  } catch {
    return null;
  }
}

/**
 * Log d'une tentative de connexion échouée (auth_failed)
 * → écrit dans la collection "usageLogs"
 * → enrichi avec IP, pays, ville, device, OS, navigateur, path
 */
export async function logAuthFailed(params: LogAuthFailedParams) {
  try {
    const ua =
      typeof window !== "undefined"
        ? window.navigator.userAgent || ""
        : "";

    const path =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "";

    const { deviceType, os, browser } = parseUserAgent(ua);

    const geo = await fetchIpInfo();

    await addDoc(collection(db, "usageLogs"), {
      action: "auth_failed",
      userId: null, // pas connecté
      email: params.email || "",
      provider: params.provider || "password",
      errorCode: params.errorCode || "",
      errorMessage: params.errorMessage || "",

      // contexte technique
      ua,
      path,
      deviceType: deviceType ?? null,
      os: os ?? null,
      browser: browser ?? null,

      // géoloc basique
      ip: geo?.ip ?? null,
      country: geo?.country ?? null,
      city: geo?.city ?? null,

      createdAt: serverTimestamp(),
    });
  } catch (e) {
    // On ne bloque pas l'utilisateur si le log plante
    console.error("Erreur logAuthFailed:", e);
  }
}
