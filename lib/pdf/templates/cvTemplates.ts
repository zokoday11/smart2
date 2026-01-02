// src/lib/pdf/templates/cvTemplates.ts
import { buildCvAtsPdf, type CvDocModel } from "@/lib/pdf/templates/cvAts";

export type Lang = "fr" | "en";

export type CvTemplateId =
  | "ats"
  | "classic"
  | "modern"
  | "minimalist"
  | "creative"
  | "elegant"
  | "tech"
  | "pro_max";

export type PdfColorsLike = Record<string, string | undefined> & {
  brand?: string;
  ink?: string;
  muted?: string;
  line?: string;
  bg?: string;
  bgSoft?: string;
  white?: string;
};

export type CvTemplateMeta = {
  id: CvTemplateId;
  label: string;
  description: string;
  previewSrc: string; // ex: "/cv-templates/cv-template-modern.png"
  badge?: string;
};

// ----------------------------------------------------
// Liste des templates disponibles (UI)
// ----------------------------------------------------

export const CV_TEMPLATES: CvTemplateMeta[] = [
  {
    id: "ats",
    label: "ATS (Standard)",
    description: "Template 1 colonne très lisible, optimisé pour les ATS.",
    previewSrc: "/cv-templates/cv-template-ats.png",
    badge: "Recommandé",
  },
  {
    id: "classic",
    label: "Classic (Sidebar)",
    description: "Colonne latérale, structure pro et lisible.",
    previewSrc: "/cv-templates/cv-template-classic.png",
  },
  {
    id: "modern",
    label: "Modern (Design)",
    description: "Header moderne, blocs aérés, idéal profils tech/produit.",
    previewSrc: "/cv-templates/cv-template-modern.png",
  },
  {
    id: "minimalist",
    label: "Minimalist",
    description: "CV ultra épuré, typographie clean, parfait pour cabinets.",
    previewSrc: "/cv-templates/cv-template-minimalist.png",
  },
  {
    id: "creative",
    label: "Creative",
    description: "Mise en page en cartes / blocs, look plus dynamique.",
    previewSrc: "/cv-templates/cv-template-creative.png",
  },
  {
    id: "elegant",
    label: "Elegant",
    description: "Style plus premium, hiérarchie douce, très corporate.",
    previewSrc: "/cv-templates/cv-template-elegant.png",
  },
  {
    id: "tech",
    label: "Tech (Dark)",
    description: "Palette sombre, vibe engineering / cybersécurité.",
    previewSrc: "/cv-templates/cv-template-tech.png",
  },
  {
    id: "pro_max",
    label: "Pro Max",
    description: "Version premium inspirée des CV design (header fort, cartes).",
    previewSrc: "/cv-templates/cv-template-pro-max.png",
    badge: "Nouveau",
  },
];

// utilisé par l’UI
export function getCvTemplates(): CvTemplateMeta[] {
  return CV_TEMPLATES;
}

// ----------------------------------------------------
// Helpers génériques
// ----------------------------------------------------

function normLang(lang: Lang): Lang {
  return lang === "en" ? "en" : "fr";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeText(v: unknown): string {
  return String(v ?? "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function pick(colors: PdfColorsLike | undefined, key: keyof PdfColorsLike, fallback: string): string {
  if (!colors) return fallback;
  const v = colors[key];
  return typeof v === "string" && v ? v : fallback;
}

function joinDot(list: string[] | undefined, maxChars = 80): string {
  const arr = Array.isArray(list)
    ? list.map((s: string) => safeText(s)).filter(Boolean)
    : [];

  if (!arr.length) return "—";

  const out: string[] = [];
  let used = 0;

  for (const item of arr) {
    const extra = (out.length ? 3 : 0) + item.length; // " • "
    if (out.length && used + extra > maxChars) break;
    out.push(item);
    used += extra;
  }

  return out.join(" • ");
}

function hr(scale: number, color: string) {
  return {
    canvas: [
      {
        type: "line",
        x1: 0,
        y1: 0,
        x2: 515,
        y2: 0,
        lineWidth: 0.6,
        lineColor: color,
      },
    ],
    margin: [0, 4 * scale, 0, 4 * scale],
  };
}

function sectionTitle(label: string, scale: number, color: string) {
  return {
    text: label,
    fontSize: 10.5 * scale,
    bold: true,
    color,
    margin: [0, 4 * scale, 0, 3 * scale],
  };
}

function collectSkills(model: CvDocModel): string[] {
  const s: any = (model as any).skills || {};
  const keys = ["cloud", "sec", "sys", "auto", "tools", "soft"];
  const out: string[] = [];

  for (const key of keys) {
    const value = s[key];
    if (Array.isArray(value)) {
      for (const item of value as string[]) {
        const txt = safeText(item);
        if (txt) out.push(txt);
      }
    }
  }

  return out;
}

function renderXp(model: CvDocModel, scale: number, ink: string, muted: string) {
  const xpRaw: unknown = (model as any).xp;
  const xpArr: CvDocModel["xp"] = Array.isArray(xpRaw) ? (xpRaw as CvDocModel["xp"]) : [];

  if (!xpArr.length) {
    return [
      {
        text: "—",
        fontSize: 9 * scale,
        color: muted,
      },
    ];
  }

  return xpArr.map((x: CvDocModel["xp"][number]) => {
    const titleParts: string[] = [];
    if (x.role) titleParts.push(safeText(x.role));
    if (x.company) titleParts.push(safeText(x.company));
    const title = titleParts.join(" — ") || "—";

    const metaParts: string[] = [];
    if (x.city) metaParts.push(safeText(x.city));
    if (x.dates) metaParts.push(safeText(x.dates));
    const meta = metaParts.join(" • ");

    const bulletsRaw: unknown = x.bullets;
    const bullets: string[] = Array.isArray(bulletsRaw)
      ? (bulletsRaw as string[]).map((b: string) => safeText(b)).filter(Boolean)
      : [];

    const stack: any[] = [
      {
        text: title,
        fontSize: 9.8 * scale,
        bold: true,
        color: ink,
        margin: [0, 0, 0, 1.5 * scale],
      },
    ];

    if (meta) {
      stack.push({
        text: meta,
        fontSize: 9 * scale,
        color: muted,
        margin: [0, 0, 0, 2 * scale],
      });
    }

    if (bullets.length) {
      stack.push({
        ul: bullets,
        fontSize: 9 * scale,
        color: ink,
        margin: [0, 0, 0, 4 * scale],
      });
    }

    return { stack };
  });
}

function renderEducation(model: CvDocModel, scale: number, ink: string, muted: string) {
  const eduRaw: unknown = (model as any).education;
  let eduArr: string[] = [];

  if (Array.isArray(eduRaw)) {
    eduArr = (eduRaw as unknown as string[]).map((v: string) => safeText(v)).filter(Boolean);
  } else {
    const one = safeText(eduRaw);
    if (one) {
      eduArr = one
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean);
    }
  }

  if (!eduArr.length) {
    return [
      {
        text: "—",
        fontSize: 9 * scale,
        color: muted,
      },
    ];
  }

  return eduArr.slice(0, 4).map((line: string) => ({
    text: line,
    fontSize: 9 * scale,
    color: ink,
    margin: [0, 0, 0, 4 * scale],
  }));
}

// ----------------------------------------------------
// Base docDefinition
// ----------------------------------------------------

function baseDocDefinition(
  _model: CvDocModel,
  colors: PdfColorsLike,
  scale: number,
  pageMargins: [number, number, number, number]
) {
  const brand = pick(colors, "brand", "#2563eb");
  const ink = pick(colors, "ink", "#111827");
  const muted = pick(colors, "muted", "#6b7280");
  const line = pick(colors, "line", "#e5e7eb");
  const bgSoft = pick(colors, "bgSoft", "#f3f4f6");
  const white = pick(colors, "white", "#ffffff");

  return {
    pageSize: "A4",
    pageMargins,
    defaultStyle: { font: "Roboto", fontSize: 10 * scale, color: ink },
    styles: {
      name: { fontSize: 18 * scale, bold: true, color: ink },
      title: { fontSize: 11 * scale, bold: true, color: brand },
      contact: { fontSize: 9 * scale, color: muted },
      section: { fontSize: 10.5 * scale, bold: true, color: ink },
      small: { fontSize: 9 * scale, color: muted },
    },
    _palette: { brand, ink, muted, line, bgSoft, white },
    content: [] as any[],
  } as any;
}

// ----------------------------------------------------
// Templates
// ----------------------------------------------------

function buildClassic(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const L = normLang(lang);
  const brand = pick(colors, "brand", "#ef4444");
  const ink = pick(colors, "ink", "#111827");
  const muted = pick(colors, "muted", "#6b7280");
  const line = pick(colors, "line", "#e5e7eb");

  const doc = baseDocDefinition(model, colors, scale, [
    34 * scale,
    30 * scale,
    34 * scale,
    26 * scale,
  ]);

  const leftWidth = 170 * scale;

  const skills = collectSkills(model);

  (doc.content as any[]).push({
    columns: [
      {
        width: leftWidth,
        stack: [
          {
            text: safeText(model.name),
            style: "name",
          },
          {
            text: safeText((model as any).title),
            style: "title",
            margin: [0, 2 * scale, 0, 0],
          },
          {
            text: safeText((model as any).contactLine ?? (model as any).contact),
            style: "contact",
            margin: [0, 6 * scale, 0, 8 * scale],
          },
          hr(scale, line),

          sectionTitle(L === "en" ? "Skills" : "Compétences", scale, ink),
          {
            text: joinDot(skills, 120),
            fontSize: 9 * scale,
            color: muted,
            margin: [0, 2 * scale, 0, 6 * scale],
          },

          sectionTitle(L === "en" ? "Languages" : "Langues", scale, ink),
          {
            text: safeText((model as any).langLine),
            fontSize: 9 * scale,
            color: muted,
            margin: [0, 2 * scale, 0, 6 * scale],
          },

          sectionTitle(L === "en" ? "Interests" : "Centres d’intérêt", scale, ink),
          {
            text: joinDot((model as any).hobbies as string[] | undefined, 120),
            fontSize: 9 * scale,
            color: muted,
            margin: [0, 2 * scale, 0, 0],
          },
        ],
      },
      {
        width: "*",
        stack: [
          sectionTitle(L === "en" ? "Profile" : "Profil", scale, ink),
          {
            text: safeText((model as any).profile),
            fontSize: 9.5 * scale,
            color: ink,
            margin: [0, 2 * scale, 0, 8 * scale],
            alignment: "justify",
          },

          hr(scale, line),

          sectionTitle(L === "en" ? "Experience" : "Expérience professionnelle", scale, ink),
          {
            stack: renderXp(model, scale, ink, muted),
          },

          hr(scale, line),

          sectionTitle(L === "en" ? "Education" : "Formation", scale, ink),
          {
            stack: renderEducation(model, scale, ink, muted),
          },

          sectionTitle(L === "en" ? "Certifications" : "Certifications", scale, ink),
          {
            text: safeText((model as any).certs),
            fontSize: 9 * scale,
            color: ink,
            margin: [0, 2 * scale, 0, 0],
          },
        ],
      },
    ],
    columnGap: 18 * scale,
  });

  return doc;
}

function buildModern(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const L = normLang(lang);
  const brand = pick(colors, "brand", "#2563eb");
  const ink = pick(colors, "ink", "#0f172a");
  const muted = pick(colors, "muted", "#6b7280");
  const line = pick(colors, "line", "#e5e7eb");
  const bgSoft = pick(colors, "bgSoft", "#eff6ff");

  const doc = baseDocDefinition(model, colors, scale, [
    30 * scale,
    28 * scale,
    30 * scale,
    28 * scale,
  ]);

  const skills = collectSkills(model);

  (doc.content as any[]).push(
    {
      // Header bande colorée
      table: {
        widths: ["*", "*"],
        body: [
          [
            {
              stack: [
                {
                  text: safeText(model.name),
                  fontSize: 20 * scale,
                  bold: true,
                  color: ink,
                },
                {
                  text: safeText((model as any).title),
                  fontSize: 11 * scale,
                  bold: true,
                  color: brand,
                  margin: [0, 2 * scale, 0, 0],
                },
              ],
            },
            {
              stack: [
                {
                  text: safeText((model as any).contactLine ?? (model as any).contact),
                  fontSize: 9 * scale,
                  color: muted,
                  alignment: "right",
                },
                {
                  text: safeText((model as any).langLine),
                  fontSize: 9 * scale,
                  color: muted,
                  alignment: "right",
                  margin: [0, 2 * scale, 0, 0],
                },
              ],
            },
          ],
        ],
      },
      layout: "noBorders",
      fillColor: bgSoft,
      margin: [-6 * scale, -6 * scale, -6 * scale, 10 * scale],
    },

    {
      columns: [
        {
          width: "*",
          stack: [
            sectionTitle(L === "en" ? "Profile" : "Profil", scale, ink),
            {
              text: safeText((model as any).profile),
              fontSize: 9.5 * scale,
              color: ink,
              margin: [0, 2 * scale, 0, 6 * scale],
              alignment: "justify",
            },

            sectionTitle(L === "en" ? "Experience" : "Expérience", scale, ink),
            {
              stack: renderXp(model, scale, ink, muted),
            },
          ],
        },
        {
          width: 180 * scale,
          margin: [16 * scale, 0, 0, 0],
          stack: [
            sectionTitle(L === "en" ? "Key Skills" : "Compétences clés", scale, ink),
            {
              text: joinDot(skills, 140),
              fontSize: 9 * scale,
              color: muted,
              margin: [0, 2 * scale, 0, 6 * scale],
            },

            sectionTitle(L === "en" ? "Education" : "Formation", scale, ink),
            {
              stack: renderEducation(model, scale, ink, muted),
            },

            sectionTitle(L === "en" ? "Certifications" : "Certifications", scale, ink),
            {
              text: safeText((model as any).certs),
              fontSize: 9 * scale,
              color: muted,
              margin: [0, 2 * scale, 0, 6 * scale],
            },

            sectionTitle(L === "en" ? "Interests" : "Centres d’intérêt", scale, ink),
            {
              text: joinDot((model as any).hobbies as string[] | undefined, 140),
              fontSize: 9 * scale,
              color: muted,
            },
          ],
        },
      ],
      columnGap: 18 * scale,
    }
  );

  return doc;
}

function buildMinimalist(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const L = normLang(lang);
  const ink = pick(colors, "ink", "#111827");
  const muted = pick(colors, "muted", "#6b7280");
  const line = pick(colors, "line", "#e5e7eb");

  const doc = baseDocDefinition(model, colors, scale, [
    40 * scale,
    32 * scale,
    40 * scale,
    32 * scale,
  ]);

  const skills = collectSkills(model);

  (doc.content as any[]).push(
    {
      text: safeText(model.name),
      fontSize: 20 * scale,
      bold: true,
      color: ink,
      margin: [0, 0, 0, 2 * scale],
    },
    {
      text: safeText((model as any).title),
      fontSize: 11 * scale,
      color: muted,
      margin: [0, 0, 0, 4 * scale],
    },
    {
      text: safeText((model as any).contactLine ?? (model as any).contact),
      fontSize: 9 * scale,
      color: muted,
      margin: [0, 0, 0, 8 * scale],
    },
    hr(scale, line),
    sectionTitle(L === "en" ? "Profile" : "Profil", scale, ink),
    {
      text: safeText((model as any).profile),
      fontSize: 9.5 * scale,
      color: ink,
      margin: [0, 2 * scale, 0, 6 * scale],
      alignment: "justify",
    },
    sectionTitle(L === "en" ? "Experience" : "Expérience", scale, ink),
    {
      stack: renderXp(model, scale, ink, muted),
      margin: [0, 0, 0, 4 * scale],
    },
    sectionTitle(L === "en" ? "Education" : "Formation", scale, ink),
    {
      stack: renderEducation(model, scale, ink, muted),
    },
    sectionTitle(L === "en" ? "Skills" : "Compétences", scale, ink),
    {
      text: joinDot(skills, 160),
      fontSize: 9 * scale,
      color: muted,
      margin: [0, 2 * scale, 0, 4 * scale],
    },
    sectionTitle(L === "en" ? "Languages" : "Langues", scale, ink),
    {
      text: safeText((model as any).langLine),
      fontSize: 9 * scale,
      color: muted,
      margin: [0, 2 * scale, 0, 4 * scale],
    },
    sectionTitle(L === "en" ? "Interests" : "Centres d’intérêt", scale, ink),
    {
      text: joinDot((model as any).hobbies as string[] | undefined, 160),
      fontSize: 9 * scale,
      color: muted,
    }
  );

  return doc;
}

// pour l’instant, on réutilise les layouts existants
function buildCreative(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  // Style plus "design" : on réutilise Modern (tu pourras raffiner plus tard)
  return buildModern(model, lang, colors, scale);
}

function buildElegant(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  // Style premium mais sobre : on part du Classic
  return buildClassic(model, lang, colors, scale);
}

function buildTech(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  // Palette plus sombre pour un look "tech"
  const overridden: PdfColorsLike = {
    ...colors,
    brand: colors.brand || "#22c55e",
    ink: colors.ink || "#f9fafb",
    muted: colors.muted || "#94a3b8",
    bgSoft: colors.bgSoft || "#020617",
    line: colors.line || "#1e293b",
  };
  return buildModern(model, lang, overridden, scale);
}

function buildProMax(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  // Version "premium" basée sur Modern, avec léger zoom
  const overridden: PdfColorsLike = {
    ...colors,
    brand: colors.brand || "#0ea5e9",
  };
  const boostedScale = clamp(scale * 1.02, 0.75, 1.6);
  return buildModern(model, lang, overridden, boostedScale);
}

// ----------------------------------------------------
// Public API
// ----------------------------------------------------

export function buildCvPdf(
  templateId: CvTemplateId,
  model: CvDocModel,
  lang: Lang,
  colors: PdfColorsLike,
  layout: "auto" | "tight" | "spacious" = "auto",
  scale = 1
) {
  const L = normLang(lang);

  // mapping layout -> styleMode attendu par buildCvAtsPdf
  const styleMode: "auto" | "compact" | "expanded" =
    layout === "tight" ? "compact" : layout === "spacious" ? "expanded" : "auto";

  // ATS = ton template existant
  if (templateId === "ats") {
    return buildCvAtsPdf(model, L, colors as any, styleMode, scale);
  }

  // ajustement global de l’échelle selon layout
  const mul = layout === "tight" ? 0.92 : layout === "spacious" ? 1.08 : 1.0;
  const s = clamp(scale * mul, 0.75, 1.6);

  switch (templateId) {
    case "classic":
      return buildClassic(model, L, colors, s);
    case "modern":
      return buildModern(model, L, colors, s);
    case "minimalist":
      return buildMinimalist(model, L, colors, s);
    case "creative":
      return buildCreative(model, L, colors, s);
    case "elegant":
      return buildElegant(model, L, colors, s);
    case "tech":
      return buildTech(model, L, colors, s);
    case "pro_max":
      return buildProMax(model, L, colors, s);
    default:
      // fallback safe
      return buildClassic(model, L, colors, s);
  }
}
