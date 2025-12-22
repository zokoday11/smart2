// types/cv.ts

export type CvSkills = {
  // Compétences métier (finance, RH, IT, marketing, etc.)
  domain?: string[];
  // Outils / logiciels (Excel, Word, PowerPoint, SAP, Canva, etc.)
  tools?: string[];
};

export type CvExperience = {
  company?: string;
  role?: string;
  location?: string;
  dates?: string;
  bullets?: string[];
};

export type CvProfile = {
  fullName?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  contractType?: string;

  // Résumé court du profil (max 3 phrases)
  profileSummary?: string;

  // Ligne compacte pour les langues : "Français (natif) · Anglais (B2 – TOEIC) · ..."
  langLine?: string;

  skills?: CvSkills;

  // Formation courte, lignes prêtes à afficher
  // ex: "2022–2024 · MSc Expert Financier – ESAM, Paris"
  educationShort?: string[];

  // Certifications principales
  certifications?: string[];

  // Centres d'intérêt détaillés
  interests?: string[];

  // Centres d'intérêt sur une seule ligne : "Musique, piano, voyages, ..."
  interestsLine?: string;

  // Expériences détaillées (utile plus tard pour les LM, pitch, etc.)
  experiences?: CvExperience[];
};

export type CvApiResponse = {
  success: boolean;
  profile?: CvProfile;
  error?: string;
};
