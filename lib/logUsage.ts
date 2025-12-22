// src/lib/logUsage.ts
import {
  addDoc,
  collection,
  doc,
  updateDoc,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { User } from "firebase/auth";

export type UsageDocType = "lm" | "cv" | "other";

interface LogUsageOptions {
  user: User;
  action: string;      // ex: "generate_document", "download_document"
  docType?: UsageDocType; // "lm" | "cv" | "other"
  eventType?: string;  // ex: "generate", "download"
  tool?: string;       // ex: "generateLetterAndPitch", "generateCvPdf"
  creditsDelta?: number; // ex: -1 si tu consommes 1 crédit
  path?: string;       // path courant (optionnel)
}

/**
 * Log d'usage IA côté client :
 * - crée un document dans "usageLogs"
 * - met à jour les compteurs dans "users/{uid}"
 *
 * → Permet à ton admin d'afficher :
 *   - LM générées (logs) : docType = "lm"
 *   - CV générés (logs) : docType = "cv"
 *   - totalIaCalls, totalDocumentsGenerated, totalLmGenerated, totalCvGenerated
 */
export async function logUsage(options: LogUsageOptions) {
  const {
    user,
    action,
    docType = "other",
    eventType,
    tool,
    creditsDelta,
  } = options;

  try {
    const now = Date.now();
    const path =
      options.path ||
      (typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "");

    // 1) LOG dans usageLogs
    await addDoc(collection(db, "usageLogs"), {
      userId: user.uid,
      email: user.email ?? "",
      action,         // ex: "generate_document"
      docType,        // "lm" | "cv" | "other"
      eventType: eventType ?? null, // ex: "generate"
      tool: tool ?? null,           // ex: "generateCvPdf"

      creditsDelta: typeof creditsDelta === "number" ? creditsDelta : null,

      path,
      createdAt: now, // number → ton admin new Date(createdAt)

      ip: null,
      country: null,
      city: null,
      deviceType: null,
      os: null,
      browser: null,
    });

    // 2) Mise à jour des compteurs dans users/{uid}
    const userRef = doc(db, "users", user.uid);

    const updates: Record<string, any> = {
      totalIaCalls: increment(1),
    };

    // Document IA → compteur global
    if (docType === "lm" || docType === "cv") {
      updates.totalDocumentsGenerated = increment(1);
    }

    if (docType === "lm") {
      updates.totalLmGenerated = increment(1);
    }
    if (docType === "cv") {
      updates.totalCvGenerated = increment(1);
    }

    if (typeof creditsDelta === "number" && creditsDelta !== 0) {
      updates.credits = increment(creditsDelta);
    }

    await updateDoc(userRef, updates);
  } catch (err) {
    console.error("Erreur logUsage:", err);
    // on ne bloque JAMAIS l'utilisateur si le log plante
  }
}
