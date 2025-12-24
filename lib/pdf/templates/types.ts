// src/lib/pdf/templates/types.ts
export type Lang = "fr" | "en";

export type CvDocModel = {
  name: string;
  title: string;
  contact: string; // "Paris | +33... | mail | linkedin"
  profile: string;

  skills: {
    cloud?: string[];
    sec?: string[];
    sys?: string[];
    auto?: string[];
    tools?: string[];
    soft?: string[];
  };

  xp: Array<{
    company: string;
    city?: string;
    role: string;
    dates: string;
    bullets: string[];
  }>;

  education: string[];
  certs: string;
  langLine: string;
  hobbies?: string[];
};

export type LmModel = {
  lang: Lang;
  name: string;
  contactLines: string[]; // ["Téléphone: ...", "Email: ..."]
  service: string;
  companyName: string;
  companyAddr?: string; // multi-line
  city: string;
  dateStr: string;
  aPrefix: string; // "À " (FR) / "At " (EN)
  subject: string;
  salutation: string;
  body: string; // paragraphes séparés par \n\n
  closing: string;
  signature: string;
};
