// lib/pdf/templates/letter.ts
import type { PdfColors } from "../colors";
export type { PdfColors } from "../colors";

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

export function buildLmStyledPdf(lm: LmModel, colors: PdfColors, scale = 1) {
  const bodyParas = splitParas(lm.body);

  const baseFs = 10.5 * scale;
  const nameFs = 12 * scale;

  const brandColor = colors.brand || DEFAULT_COLORS.brand;
  const mutedColor = colors.muted || DEFAULT_COLORS.muted;
  const hairColor = colors.hair || DEFAULT_COLORS.hair;
  const inkColor = colors.ink || DEFAULT_COLORS.ink;

  const rightStack: any[] = [
    { text: lm.service, color: mutedColor },
    { text: lm.companyName, bold: true, color: mutedColor },
    ...(lm.companyAddr ? lm.companyAddr.split(/\n+/).map((l) => ({ text: l })) : []),
  ];

  const hair = {
    canvas: [
      {
        type: "line",
        x1: 0,
        y1: 0,
        x2: 515,
        y2: 0,
        lineWidth: 1,
        lineColor: hairColor,
      },
    ],
    margin: [0, 6, 0, 10],
  };

  const dateLine =
    lm.lang === "en" ? `At ${lm.city}, ${lm.dateStr}` : `À ${lm.city}, le ${lm.dateStr}`;

  return {
    pageSize: "A4",
    pageMargins: [40, 36, 40, 36],
    defaultStyle: {
      font: "Roboto",
      fontSize: baseFs,
      lineHeight: 1.24,
      color: inkColor,
    },
    content: [
      // barre brand
      {
        canvas: [
          { type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 3, lineColor: brandColor },
        ],
        margin: [0, 0, 0, 10],
      },

      // header 2 colonnes
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: lm.name, bold: true, fontSize: nameFs, color: mutedColor },
              ...(lm.contactLines || []).map((t) => ({ text: t })),
            ],
          },
          {
            width: "auto",
            alignment: "right",
            stack: rightStack,
            margin: [0, 28, 0, 0],
          },
        ],
        columnGap: 15,
      },

      hair,

      { text: dateLine, margin: [0, 0, 0, 8] },
      { text: lm.subject, bold: true, color: brandColor, margin: [0, 0, 0, 10] },
      { text: lm.salutation, margin: [0, 0, 0, 8] },

      ...bodyParas.map((p) => ({ text: p, margin: [0, 0, 0, 6] })),

      { text: lm.closing, margin: [0, 12, 0, 2], alignment: "right" },
      { text: lm.signature, bold: true, alignment: "right" },
    ],
  };
}

/**
 * ✅ Fallback qui accepte:
 * - un LmModel (structuré)
 * - OU un string (texte brut) => pour ton appel generateCvLm.ts
 *
 * Exemples:
 * buildLmFallbackPdf(params.lmTextFallback || "", colors, scale)
 * buildLmFallbackPdf(lmModel, colors, scale)
 */
export function buildLmFallbackPdf(text: string, colors: PdfColors, scale?: number): any;
export function buildLmFallbackPdf(lm: LmModel, colors: PdfColors, scale?: number): any;
export function buildLmFallbackPdf(text: string, scale?: number): any;
export function buildLmFallbackPdf(lm: LmModel, scale?: number): any;
export function buildLmFallbackPdf(
  first: string | LmModel,
  second?: PdfColors | number,
  third?: number
) {
  const colors: PdfColors =
    typeof second === "object" && second ? second : DEFAULT_COLORS;

  const scale =
    typeof second === "number" ? second : typeof third === "number" ? third : 1;

  // Si on a un modèle structuré -> on garde le rendu exact
  if (typeof first === "object" && first) {
    return buildLmStyledPdf(first, colors, scale);
  }

  // Sinon texte brut (string)
  const rawText = String(first || "");
  const paras = splitParas(rawText);

  const brandColor = colors.brand || DEFAULT_COLORS.brand;
  const hairColor = colors.hair || DEFAULT_COLORS.hair;
  const inkColor = colors.ink || DEFAULT_COLORS.ink;

  const baseFs = 10.5 * scale;

  return {
    pageSize: "A4",
    pageMargins: [40, 36, 40, 36],
    defaultStyle: {
      font: "Roboto",
      fontSize: baseFs,
      lineHeight: 1.26,
      color: inkColor,
    },
    content: [
      // barre brand
      {
        canvas: [
          { type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 3, lineColor: brandColor },
        ],
        margin: [0, 0, 0, 10],
      },
      // ligne fine
      {
        canvas: [
          { type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: hairColor },
        ],
        margin: [0, 0, 0, 12],
      },
      // texte brut en paragraphes
      ...(paras.length ? paras : [""]).map((p) => ({ text: p, margin: [0, 0, 0, 7] })),
    ],
  };
}
