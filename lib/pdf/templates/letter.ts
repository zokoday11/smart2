// lib/pdf/templates/letter.ts
import type { PdfColors } from "../colors";
export type { PdfColors } from "../colors";

import type { CvTemplateId } from "./cvTemplates"; // ✅ pour matcher thème CV

export type LmModel = {
  lang: "fr" | "en";
  name: string;
  contactLines: string[];
  service: string;
  companyName: string;
  companyAddr?: string;
  city: string;
  dateStr: string;
  subject: string;
  salutation: string;
  body: string; // corps uniquement
  closing: string;
  signature: string;
};

function splitParas(text: string) {
  return (text || "")
    .replace(/\n{3,}/g, "\n\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const DEFAULT_COLORS: PdfColors = {
  brand: "#2563eb",
  brandDark: "#1e40af",
  ink: "#0f172a",
  muted: "#475569",
  border: "#e2e8f0",
  bgSoft: "#f1f5f9",
  hair: "#cbd5e1",
};

function safeText(v: any) {
  return String(v ?? "").replace(/\u00A0/g, " ").trim();
}

function pickColor(colors: PdfColors, key: keyof PdfColors, fallback: string) {
  const v = colors?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function rgbToHex(r: number, g: number, b: number) {
  const to = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}
function mixHex(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

function themeUsesHeaderBand(theme: CvTemplateId) {
  return theme === "modern" || theme === "pro_max" || theme === "tech";
}

function themeHeaderBg(theme: CvTemplateId, brand: string) {
  if (theme === "tech") return "#0b1220";
  if (theme === "pro_max") return brand; // on fera dégradé via background
  if (theme === "modern") return brand;
  return brand;
}

function themeBackground(theme: CvTemplateId, brand: string, pageSize: any, scale: number) {
  const w = pageSize?.width ?? 595;
  const h = pageSize?.height ?? 842;

  if (theme === "pro_max") {
    const brand2 = mixHex(brand, "#ffffff", 0.35);
    const bands = Array.from({ length: 18 }).map((_, i) => ({
      type: "rect",
      x: (w / 18) * i,
      y: 0,
      w: w / 18 + 1,
      h: 140 * scale,
      color: mixHex(brand, brand2, i / 17),
      opacity: 0.96,
    }));

    const dots = Array.from({ length: 180 }).map((_, i) => {
      const cols = 18;
      const x = 18 + (i % cols) * 30;
      const y = 16 + Math.floor(i / cols) * 14;
      return { type: "ellipse", x, y, r1: 1.4, r2: 1.4, color: "#ffffff", opacity: 0.35 };
    });

    return [
      { canvas: bands },
      { canvas: dots },
      { canvas: [{ type: "rect", x: 0, y: h - 10, w, h: 10, color: brand }] },
    ];
  }

  if (theme === "modern") {
    const headerH = 130 * scale;
    const dots = Array.from({ length: 96 }).map((_, i) => {
      const cols = 12;
      const x = w - 36 - (i % cols) * 18;
      const y = 18 + Math.floor(i / cols) * 14;
      return { type: "ellipse", x, y, r1: 1.4, r2: 1.4, color: "#ffffff", opacity: 0.25 };
    });

    return [
      { canvas: [{ type: "rect", x: 0, y: 0, w, h: headerH, color: brand }] },
      { canvas: dots },
      { canvas: [{ type: "rect", x: 0, y: h - 10, w, h: 10, color: brand }] },
    ];
  }

  if (theme === "tech") {
    return [
      { canvas: [{ type: "rect", x: 0, y: 0, w, h: 95 * scale, color: "#0b1220" }] },
      { canvas: [{ type: "rect", x: 0, y: 95 * scale, w, h: 4 * scale, color: brand }] },
    ];
  }

  if (theme === "minimalist" || theme === "elegant") {
    return [{ canvas: [{ type: "rect", x: 0, y: 0, w, h: 6 * scale, color: brand }] }];
  }

  // ats / classic / creative : sobre
  return [];
}

/**
 * ✅ LM stylée avec thème (optionnel) — compatible avec tes appels existants
 * buildLmStyledPdf(lm, colors, scale)
 * buildLmStyledPdf(lm, colors, scale, cvTemplate)
 */
export function buildLmStyledPdf(
  lm: LmModel,
  colors: PdfColors,
  scale = 1,
  theme: CvTemplateId = "ats"
) {
  const bodyParas = splitParas(lm.body);

  const brandColor = pickColor(colors, "brand", DEFAULT_COLORS.brand);
  const mutedColor = pickColor(colors, "muted", DEFAULT_COLORS.muted);
  const borderColor = pickColor(colors, "border", DEFAULT_COLORS.border);
  const hairColor = pickColor(colors, "hair", DEFAULT_COLORS.hair);
  const inkColor = pickColor(colors, "ink", DEFAULT_COLORS.ink);

  const baseFs = 10.5 * scale;
  const nameFs = 12 * scale;

  const dateLine =
    lm.lang === "en"
      ? `At ${safeText(lm.city)}, ${safeText(lm.dateStr)}`
      : `À ${safeText(lm.city)}, le ${safeText(lm.dateStr)}`;

  const rightStack: any[] = [
    { text: safeText(lm.service), color: mutedColor },
    { text: safeText(lm.companyName), bold: true, color: mutedColor },
    ...(lm.companyAddr ? safeText(lm.companyAddr).split(/\n+/).map((l) => ({ text: l })) : []),
  ];

  const leftMargin = 40 * scale;
  const rightMargin = 40 * scale;
  const bottomMargin = 36 * scale;
  const topMargin = themeUsesHeaderBand(theme) ? 110 * scale : 36 * scale;

  const pageW = 595;
  const lineW = pageW - leftMargin - rightMargin;

  const headerOnBand = themeUsesHeaderBand(theme);
  const headerNameColor = headerOnBand ? "#ffffff" : mutedColor;
  const headerMetaColor = headerOnBand ? "#ffffff" : inkColor;
  const headerMetaOpacity = headerOnBand ? 0.92 : 1;

  const brandBar = headerOnBand
    ? null
    : {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: lineW, y2: 0, lineWidth: 3 * scale, lineColor: brandColor }],
        margin: [0, 0, 0, 10 * scale],
      };

  const hair = {
    canvas: [
      { type: "line", x1: 0, y1: 0, x2: lineW, y2: 0, lineWidth: 1, lineColor: hairColor },
    ],
    margin: [0, 6 * scale, 0, 10 * scale],
  };

  const headerBlock = {
    columns: [
      {
        width: "*",
        stack: [
          { text: safeText(lm.name), bold: true, fontSize: nameFs, color: headerNameColor },
          ...(lm.contactLines || []).map((t) => ({
            text: safeText(t),
            color: headerMetaColor,
            opacity: headerMetaOpacity,
            fontSize: 9.6 * scale,
          })),
        ],
      },
      {
        width: "auto",
        alignment: "right",
        stack: rightStack.map((x) => ({
          ...x,
          color: headerOnBand ? "#ffffff" : x.color,
          opacity: headerMetaOpacity,
          fontSize: 9.6 * scale,
        })),
        margin: [0, 28 * scale, 0, 0],
      },
    ],
    columnGap: 15 * scale,
    margin: [0, headerOnBand ? -78 * scale : 0, 0, 0],
  };

  return {
    pageSize: "A4",
    pageMargins: [leftMargin, topMargin, rightMargin, bottomMargin],
    background: (currentPage: number, pageSize: any) => {
      if (currentPage !== 1) return null;
      return themeBackground(theme, themeHeaderBg(theme, brandColor), pageSize, scale);
    },
    defaultStyle: {
      font: "Roboto",
      fontSize: baseFs,
      lineHeight: 1.24,
      color: inkColor,
    },
    content: [
      ...(brandBar ? [brandBar] : []),

      headerBlock,

      headerOnBand
        ? {
            canvas: [
              {
                type: "line",
                x1: 0,
                y1: 0,
                x2: lineW,
                y2: 0,
                lineWidth: 1,
                lineColor: mixHex(borderColor, "#ffffff", 0.25),
              },
            ],
            margin: [0, 10 * scale, 0, 12 * scale],
          }
        : hair,

      { text: dateLine, margin: [0, 0, 0, 8 * scale], color: mutedColor },
      { text: safeText(lm.subject), bold: true, color: brandColor, margin: [0, 0, 0, 10 * scale] },
      { text: safeText(lm.salutation), margin: [0, 0, 0, 8 * scale] },

      ...bodyParas.map((p) => ({ text: p, margin: [0, 0, 0, 6 * scale] })),

      { text: safeText(lm.closing), margin: [0, 12 * scale, 0, 2 * scale], alignment: "right" },
      { text: safeText(lm.signature), bold: true, alignment: "right" },
    ],
  };
}

/**
 * ✅ Fallback qui accepte:
 * - un LmModel (structuré)
 * - OU un string (texte brut)
 *
 * + optionnel: theme pour matcher CV
 */
export function buildLmFallbackPdf(text: string, colors: PdfColors, scale?: number, theme?: CvTemplateId): any;
export function buildLmFallbackPdf(lm: LmModel, colors: PdfColors, scale?: number, theme?: CvTemplateId): any;
export function buildLmFallbackPdf(text: string, scale?: number, theme?: CvTemplateId): any;
export function buildLmFallbackPdf(lm: LmModel, scale?: number, theme?: CvTemplateId): any;
export function buildLmFallbackPdf(
  first: string | LmModel,
  second?: PdfColors | number,
  third?: number | CvTemplateId,
  fourth?: CvTemplateId
) {
  const colors: PdfColors = typeof second === "object" && second ? second : DEFAULT_COLORS;

  const scale = typeof second === "number" ? second : typeof third === "number" ? third : 1;

  const theme: CvTemplateId =
    (typeof third === "string" ? third : typeof fourth === "string" ? fourth : "ats") as CvTemplateId;

  // Si on a un modèle structuré -> rendu exact (thémé)
  if (typeof first === "object" && first) {
    return buildLmStyledPdf(first, colors, scale, theme);
  }

  // Sinon texte brut (string) — fallback simple mais avec background du thème
  const rawText = String(first || "");
  const paras = splitParas(rawText);

  const brandColor = pickColor(colors, "brand", DEFAULT_COLORS.brand);
  const hairColor = pickColor(colors, "hair", DEFAULT_COLORS.hair);
  const inkColor = pickColor(colors, "ink", DEFAULT_COLORS.ink);

  const leftMargin = 40 * scale;
  const rightMargin = 40 * scale;
  const bottomMargin = 36 * scale;
  const topMargin = themeUsesHeaderBand(theme) ? 90 * scale : 36 * scale;

  const pageW = 595;
  const lineW = pageW - leftMargin - rightMargin;

  const baseFs = 10.5 * scale;

  return {
    pageSize: "A4",
    pageMargins: [leftMargin, topMargin, rightMargin, bottomMargin],
    background: (currentPage: number, pageSize: any) => {
      if (currentPage !== 1) return null;
      return themeBackground(theme, themeHeaderBg(theme, brandColor), pageSize, scale);
    },
    defaultStyle: {
      font: "Roboto",
      fontSize: baseFs,
      lineHeight: 1.26,
      color: inkColor,
    },
    content: [
      ...(themeUsesHeaderBand(theme)
        ? []
        : [
            {
              canvas: [
                { type: "line", x1: 0, y1: 0, x2: lineW, y2: 0, lineWidth: 3 * scale, lineColor: brandColor },
              ],
              margin: [0, 0, 0, 10 * scale],
            },
          ]),

      {
        canvas: [{ type: "line", x1: 0, y1: 0, x2: lineW, y2: 0, lineWidth: 1, lineColor: hairColor }],
        margin: [0, 0, 0, 12 * scale],
      },

      ...(paras.length ? paras : [""]).map((p) => ({ text: p, margin: [0, 0, 0, 7 * scale] })),
    ],
  };
}
