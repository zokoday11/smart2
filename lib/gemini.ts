// lib/gemini.ts (ou le fichier équivalent chez toi)
import { auth } from "@/lib/firebase";
import { getRecaptchaToken } from "@/lib/recaptcha";

export type GenerateLetterAndPitchPayload = {
  profile: any;
  jobDescription: string;
  jobTitle?: string;
  companyName?: string;
  lang?: "fr" | "en";
};

export type GenerateLetterAndPitchResult = {
  coverLetter: string;
  pitch: string;
  lang?: string;
};

export async function callGenerateLetterAndPitch(
  payload: GenerateLetterAndPitchPayload
): Promise<GenerateLetterAndPitchResult> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Tu dois être connecté pour générer la lettre.");
  }

  // 🔐 Récupérer un vrai ID token Firebase
  const idToken = await user.getIdToken(true);

  // 🛡️ reCAPTCHA côté client
  const recaptchaToken = await getRecaptchaToken("generate_letter_pitch");

  const res = await fetch("/api/generateLetterAndPitch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,        // ✅ LE POINT CLÉ
      "x-recaptcha-token": recaptchaToken,       // si tu veux le lire côté CF / backend
    },
    body: JSON.stringify({
      ...payload,
      recaptchaToken,
    }),
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    console.error("Erreur HTTP generateLetterAndPitch:", res.status, text);
    throw new Error(json?.error || "Erreur generateLetterAndPitch");
  }

  if (!json || typeof json !== "object") {
    throw new Error("Réponse generateLetterAndPitch invalide.");
  }

  const coverLetter =
    typeof json.coverLetter === "string" ? json.coverLetter : "";
  const pitch = typeof json.pitch === "string" ? json.pitch : "";

  return {
    coverLetter,
    pitch,
    lang: json.lang || payload.lang || "fr",
  };
}
