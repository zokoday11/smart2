// src/lib/pdf/lmPrompt.ts

type LmPromptParams = {
  lang: "fr" | "en";
  cvText: string; // buildProfileContextForIA(profile)
  jobTitle?: string;
  companyName?: string;
  jobDescription?: string;
  constraints?: {
    minWords?: number; // default 170
    maxWords?: number; // default 240
  };
};

/**
 * Prompt "corps de LM" : domaine-agnostique, basé CV + fiche de poste.
 * Sortie demandée: JSON { "body": "..." } (body = texte brut avec paragraphes séparés par \n\n)
 */
export function buildLmBodyPrompt(p: LmPromptParams): string {
  const lang = p.lang ?? "fr";
  const jobTitle = (p.jobTitle || "").trim();
  const companyName = (p.companyName || "").trim();
  const jobDescription = (p.jobDescription || "").trim();
  const minWords = p.constraints?.minWords ?? 170;
  const maxWords = p.constraints?.maxWords ?? 240;

  const safeJobTitle = jobTitle || (lang === "en" ? "the role" : "le poste");
  const safeCompany = companyName || (lang === "en" ? "your company" : "votre entreprise");
  const safeJD = jobDescription || "—";

  if (lang === "en") {
    return `
You are a senior career coach and recruiter.

TASK:
Write ONLY the BODY of a professional cover letter tailored to the job, using ONLY the candidate info provided.
It must work for ANY domain (tech, admin, sales, healthcare, etc.) by extracting key requirements from the job description and matching them to the candidate profile.

INPUTS:
- Job title: ${safeJobTitle}
- Company: ${safeCompany}
- Job description:
${safeJD}

- Candidate profile (source of truth):
${p.cvText}

STRICT RULES:
- DO NOT invent facts, employers, degrees, tools, dates, metrics.
- If a detail is missing, write generically (e.g., "I have delivered impactful projects") without fake numbers.
- Output MUST be STRICT JSON only:
{ "body": "..." }
- "body" must be plain text with paragraphs separated by ONE blank line (\n\n).
- No header, no address, no subject line, no greeting, no signature, no bullets, no emojis.

CONTENT GUIDANCE (domain-agnostic):
- 3 to 5 short paragraphs.
1) Motivation for ${safeJobTitle} at ${safeCompany} + a credible hook based on the profile.
2) Match 3–5 requirements from the job description to relevant skills/experience from the profile.
3) Mention 1–2 concrete contributions/achievements from the candidate’s experience (only if present), otherwise describe typical contributions.
4) How the candidate will contribute in the first months (methods, collaboration, outcomes).
5) Polite closing inviting to discuss.

LENGTH:
Between ${minWords} and ${maxWords} words.
Return the JSON now.
`.trim();
  }

  // FR
  return `
Tu es un coach carrières senior et recruteur.

MISSION :
Rédige UNIQUEMENT le CORPS d’une lettre de motivation professionnelle, parfaitement adaptée au poste, en utilisant UNIQUEMENT les informations du candidat fournies.
Le prompt doit fonctionner pour TOUS les domaines (tech, administratif, commercial, santé, etc.) : tu extrais les exigences de la fiche de poste et tu les relies au profil.

ENTRÉES :
- Intitulé du poste : ${safeJobTitle}
- Entreprise : ${safeCompany}
- Fiche de poste / description :
${safeJD}

- Profil candidat (source de vérité) :
${p.cvText}

RÈGLES STRICTES :
- N’invente rien (entreprises, diplômes, outils, dates, chiffres).
- Si une info manque, reste générique ("j’ai contribué à des projets à impact") sans métriques inventées.
- Réponds OBLIGATOIREMENT en JSON STRICT, sans texte autour :
{ "body": "..." }
- "body" = texte brut avec paragraphes séparés par UNE ligne vide (\n\n).
- Pas d’en-tête, pas d’adresses, pas d’objet, pas de formule d’appel, pas de signature, pas de listes à puces, pas d’émojis.

DIRECTIVE CONTENU (multi-domaines) :
- 3 à 5 paragraphes courts.
1) Motivation pour ${safeJobTitle} chez ${safeCompany} + accroche crédible basée sur le profil.
2) Fais le lien entre 3–5 attentes de la fiche de poste et les compétences/expériences du CV.
3) Cite 1–2 contributions/réalisations concrètes SI elles existent dans le CV, sinon décris des apports typiques (qualité, rigueur, coordination, relation client, etc.).
4) Explique comment le candidat contribuera dans les premiers mois (méthode, collaboration, résultats).
5) Conclusion polie ouvrant sur un entretien.

LONGUEUR :
Entre ${minWords} et ${maxWords} mots.
Retourne le JSON maintenant.
`.trim();
}
