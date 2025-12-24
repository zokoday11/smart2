// src/lib/pdf/templates/cvAts.ts
import type { PdfColors } from "../colors";

export type CvDocModel = {
  name: string;
  title: string;
  contactLine: string;
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
  certs?: string;
  langLine?: string;
  hobbies?: string[];
};

function stripMd(s: string) {
  return String(s || "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

function cleanBullet(s: string) {
  return stripMd(s).replace(/^[•\-–]\s*/, "").trim();
}

function smartCompactProfile(profile: string, est: number) {
  const p = stripMd(profile);
  // petit “compact” si beaucoup de contenu (même idée que ton HTML auto) :contentReference[oaicite:3]{index=3}
  if (est > 3600 && p.length > 420) return p.slice(0, 420).replace(/\s+\S*$/, "…");
  if (est > 3000 && p.length > 480) return p.slice(0, 480).replace(/\s+\S*$/, "…");
  return p;
}

// CV A4 1 page — style auto/compact/expanded + scale (zoom global)
export function buildCvAtsPdf(
  cv: CvDocModel,
  lang: "fr" | "en",
  colors: PdfColors,
  styleMode: "auto" | "compact" | "expanded" = "auto",
  scale = 1
) {
  const est =
    (cv.profile?.length || 0) +
    (cv.certs?.length || 0) +
    (cv.langLine?.length || 0) +
    (cv.hobbies || []).join(" ").length +
    (cv.education || []).join(" ").length +
    (cv.xp || [])
      .map((x) => (x.role || "") + (x.company || "") + (x.city || "") + (x.dates || "") + (x.bullets || []).join(" "))
      .join(" ").length +
    Object.values(cv.skills || {})
      .flat()
      .join(" ").length;

  let fontSize: number, headSize: number, titleSize: number, lineH: number, margins: number[];

  if (styleMode === "compact") {
    fontSize = 9.0; headSize = 18.0; titleSize = 11.8; lineH = 1.04; margins = [16, 12, 16, 12];
  } else if (styleMode === "expanded") {
    fontSize = 11.4; headSize = 22.5; titleSize = 15.2; lineH = 1.26; margins = [30, 26, 30, 28];
  } else {
    if (est < 1900) { fontSize = 11.4; headSize = 22.5; titleSize = 15.2; lineH = 1.26; margins = [30, 26, 30, 28]; }
    else if (est < 2200) { fontSize = 11.1; headSize = 22.0; titleSize = 14.8; lineH = 1.22; margins = [28, 24, 28, 26]; }
    else if (est < 2600) { fontSize = 10.8; headSize = 21.2; titleSize = 14.4; lineH = 1.18; margins = [26, 22, 26, 24]; }
    else if (est < 3000) { fontSize = 10.5; headSize = 20.6; titleSize = 14.0; lineH = 1.15; margins = [24, 20, 24, 22]; }
    else if (est < 3400) { fontSize = 10.1; headSize = 19.8; titleSize = 13.4; lineH = 1.12; margins = [22, 18, 22, 18]; }
    else if (est < 3800) { fontSize = 9.8; headSize = 19.2; titleSize = 12.8; lineH = 1.08; margins = [20, 16, 20, 16]; }
    else if (est < 4300) { fontSize = 9.4; headSize = 18.6; titleSize = 12.4; lineH = 1.06; margins = [18, 14, 18, 14]; }
    else { fontSize = 9.0; headSize = 18.0; titleSize = 11.8; lineH = 1.04; margins = [16, 12, 16, 12]; }
  }

  // zoom global
  fontSize = +(fontSize * scale).toFixed(2);
  headSize = +(headSize * scale).toFixed(2);
  titleSize = +(titleSize * scale).toFixed(2);
  lineH = +(1 + (lineH - 1) * (0.8 + 0.2 * scale)).toFixed(3);
  margins = margins.map((m) => Math.max(12, Math.round(m * (0.95 + 0.05 * scale))));

  const profileText = smartCompactProfile(cv.profile, est);

  const H = (t: string) => ({
    text: t,
    color: colors.brand,
    bold: true,
    fontSize: Math.max(10.6, fontSize + 0.6),
    margin: [0, 6, 0, 3],
  });

  const thin = {
    canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.7, lineColor: colors.border }],
    margin: [0, 2, 0, 6],
  };

  const s = cv.skills || {};
  const skillsGrid = {
    columns: [
      {
        width: "*",
        stack: [
          { text: lang === "fr" ? "Architecture & Cloud" : "Architecture & Cloud", bold: true, color: colors.muted, margin: [0, 0, 0, 1] },
          { text: (s.cloud || []).join(", "), alignment: "justify" },

          { text: lang === "fr" ? "Cybersécurité" : "Cybersecurity", bold: true, color: colors.muted, margin: [0, 5, 0, 1] },
          { text: (s.sec || []).join(", "), alignment: "justify" },

          { text: lang === "fr" ? "Soft skills" : "Soft skills", bold: true, color: colors.muted, margin: [0, 5, 0, 1] },
          { text: (s.soft || []).join(", "), alignment: "justify" },
        ],
      },
      {
        width: "*",
        stack: [
          { text: lang === "fr" ? "Systèmes & Réseaux" : "Systems & Networks", bold: true, color: colors.muted, margin: [0, 0, 0, 1] },
          { text: (s.sys || []).join(", "), alignment: "justify" },

          { text: lang === "fr" ? "Automatisation & Outils (IA/API)" : "Automation & Tools (AI/API)", bold: true, color: colors.muted, margin: [0, 5, 0, 1] },
          { text: ([...(s.auto || []), ...(s.tools || [])]).join(", "), alignment: "justify" },
        ],
      },
    ],
    columnGap: 14,
  };

  function xpBlock(x: CvDocModel["xp"][number]) {
    const header = {
      text: `${x.company}${x.city ? " — " + x.city : ""} — ${x.role} | ${x.dates}`,
      margin: [0, 0.5, 0, 1],
      bold: true,
    };
    const bullets = (x.bullets || []).map((b) => ({
      text: `- ${cleanBullet(b)}`,
      margin: [0, 0, 0, 0.4],
      alignment: "justify",
    }));
    return [header, ...bullets];
  }

  const content: any[] = [
    { text: cv.name, fontSize: headSize, bold: true, alignment: "center", margin: [0, 0, 0, 0] },
    { text: cv.title, fontSize: titleSize, color: colors.brand, bold: true, alignment: "center", margin: [0, 1, 0, 3] },
    { text: stripMd(cv.contactLine), bold: true, margin: [0, 0, 0, 4], alignment: "center" },
    thin,

    H(lang === "fr" ? "Profil" : "Profile"),
    { text: profileText, margin: [0, 0, 0, 2], alignment: "justify" },

    H(lang === "fr" ? "Compétences clés" : "Key Skills"),
    skillsGrid,

    H(lang === "fr" ? "Expériences professionnelles" : "Professional Experience"),
    ...(cv.xp || []).flatMap(xpBlock),

    H(lang === "fr" ? "Formation" : "Education"),
    { ul: (cv.education || []).map((e) => stripMd(e)), margin: [0, 0, 0, 1] },

    H(lang === "fr" ? "Certifications" : "Certifications"),
    { text: stripMd(cv.certs || ""), margin: [0, 0, 0, 1], alignment: "justify" },

    H(lang === "fr" ? "Langues" : "Languages"),
    { text: stripMd(cv.langLine || "") },
  ];

  if (Array.isArray(cv.hobbies) && cv.hobbies.length) {
    content.push(H(lang === "fr" ? "Centres d’intérêt / Hobbies" : "Interests"));
    content.push({ text: cv.hobbies.join(" • "), margin: [0, 0, 0, 1] });
  }

  return {
    pageSize: "A4",
    pageMargins: margins,
    defaultStyle: { font: "Roboto", fontSize, lineHeight: lineH, color: colors.ink },
    content,
  };
}
