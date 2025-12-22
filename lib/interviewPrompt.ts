// lib/interviewPrompt.ts

// Canal de l'entretien : écrit (chat) ou oral (avec micro + TTS plus tard)
export type InterviewChannel = "written" | "oral";

// Niveau de difficulté / séniorité
export type InterviewLevel = "junior" | "intermediate" | "senior";

// Élément d'historique échangé pendant l'entretien
export type HistoryItem = {
  role: "interviewer" | "candidate";
  text: string;
  createdAt?: string; // <-- IMPORTANT pour ne plus avoir createdAt en rouge
  analysis?: string | null;
};

export type BuildPromptArgs = {
  cvSummary: string;
  jobDesc: string;
  mode: string; // "mixed" | "tech" | "rh" | "hard" etc.
  level: InterviewLevel;
  channel: InterviewChannel;
  history: HistoryItem[];
  step: number;
};

/**
 * Construit le prompt envoyé à Gemini pour générer :
 * - la prochaine question
 * - l'analyse rapide de la réponse précédente
 * - le résumé final + score quand l'IA estime avoir assez d'informations
 */
export function buildPrompt({
  cvSummary,
  jobDesc,
  mode,
  level,
  channel,
  history,
  step,
}: BuildPromptArgs): string {
  const historyText =
    history.length === 0
      ? "Aucun échange pour le moment (début d'entretien)."
      : history
          .map((h) => {
            const who =
              h.role === "interviewer" ? "INTERVIEWER" : "CANDIDAT";
            return `- [${who}] ${h.text}`;
          })
          .join("\n");

  let modeDescription = "";
  switch (mode) {
    case "tech":
      modeDescription =
        "Pose principalement des questions techniques (cloud, sécurité, réseau, etc.).";
      break;
    case "rh":
      modeDescription =
        "Pose surtout des questions RH, motivation, soft-skills, culture d'entreprise.";
      break;
    case "hard":
      modeDescription =
        "Sois très exigeant, avec des questions difficiles, de relance et de mise en situation.";
      break;
    default:
      modeDescription =
        "Mélange de questions techniques et RH/motivation.";
  }

  let levelDescription = "";
  switch (level) {
    case "junior":
      levelDescription =
        "Considère un profil plutôt junior : évalue le potentiel, la motivation et les bases techniques.";
      break;
    case "intermediate":
      levelDescription =
        "Considère un profil intermédiaire : quelques années d'expérience, autonomie moyenne.";
      break;
    case "senior":
      levelDescription =
        "Considère un profil senior : forte expertise, autonomie, leadership possible.";
      break;
  }

  const channelDescription =
    channel === "oral"
      ? "Le candidat répond à l'oral. Les questions doivent être plutôt courtes, conversationnelles, comme dans un vrai échange vocal."
      : "Le candidat répond à l'écrit via un chat. Tu peux poser des questions un peu plus détaillées mais reste concis.";

  return `
Tu joues le rôle d'un recruteur humain qui fait passer un entretien d'embauche en français.

Contexte candidat (résumé de CV) :
${cvSummary || "Non renseigné."}

Contexte poste (fiche de poste / offre) :
${jobDesc || "Non renseigné."}

Mode d'entretien : ${mode}
${modeDescription}

Niveau d'entretien : ${level}
${levelDescription}

Canal : ${channel}
${channelDescription}

Étape actuelle de l'entretien : ${step}
Historique des échanges (du plus ancien au plus récent) :
${historyText}

OBJECTIF :
- Poser des questions pertinentes par rapport au poste et au profil.
- Être honnête et exigeant sur la compatibilité avec la fiche de poste.
- Quand tu estimes avoir assez d'informations, produire un résumé final détaillé + un score global de compatibilité sur 100.

⚠️ TRÈS IMPORTANT : FORMAT DE RÉPONSE OBLIGATOIRE ⚠️
Tu dois répondre STRICTEMENT en JSON valide, sans texte autour, sans Markdown, sans commentaires, sans \`\`\`.

Format exact attendu :

{
  "next_question": string | null,
  "short_analysis": string | null,
  "final_summary": string | null,
  "final_score": number | null
}

Règles :
- Tant que l'entretien continue :
  - "next_question" = la prochaine question à poser au candidat (en français).
  - "short_analysis" = une analyse très courte (2-3 phrases max) de la dernière réponse du candidat.
  - "final_summary" = null
  - "final_score" = null
- Quand tu estimes que l'entretien est terminé :
  - "next_question" = null
  - "short_analysis" = une courte phrase de conclusion si tu veux
  - "final_summary" = un résumé structuré de la performance du candidat, points forts / points faibles, recommandation (oui / non / à voir).
  - "final_score" = un nombre entier de 0 à 100 représentant la compatibilité globale avec la fiche de poste.

Ta réponse DOIT être un JSON pur, directement parsable par JSON.parse en JavaScript.
  `.trim();
}
