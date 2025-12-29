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
  bgSoft?: string;
  white?: string;
};

export type CvTemplateMeta = {
  id: CvTemplateId;
  label: string;
  description: string;
  previewSrc: string; // ex: "/cv-templates/cv-template-modern.png"
};

export function getCvTemplates(): CvTemplateMeta[] {
  return [
    { id: "ats", label: "ATS (Standard)", description: "Focus lecture machine, 1 colonne.", previewSrc: "/cv-templates/cv-template-ats.png" },
    { id: "classic", label: "Classic (Sidebar)", description: "Colonne latérale + icônes, structure pro.", previewSrc: "/cv-templates/cv-template-classic.png" },
    { id: "modern", label: "Modern (Design)", description: "Header dynamique, profil en carte, motifs + icônes.", previewSrc: "/cv-templates/cv-template-modern.png" },
    { id: "minimalist", label: "Minimalist", description: "Épuré premium, lignes fines + typographie.", previewSrc: "/cv-templates/cv-template-minimalist.png" },
    { id: "creative", label: "Creative", description: "Cartes / blocs, look portfolio dynamique.", previewSrc: "/cv-templates/cv-template-creative.png" },
    { id: "elegant", label: "Elegant", description: "Style premium, détails soignés, timeline légère.", previewSrc: "/cv-templates/cv-template-elegant.png" },
    { id: "tech", label: "Tech (Dark)", description: "Sidebar sombre, vibe engineering/IT, icônes.", previewSrc: "/cv-templates/cv-template-tech.png" },
    { id: "pro_max", label: "Pro Max", description: "Ultra premium : motifs, cartes, badges + flags langues.", previewSrc: "/cv-templates/cv-template-pro-max.png" },
  ];
}

// ----------------------
// DESIGN KIT : SVG ICONS & FLAGS
// ----------------------

const svgWrap = (inner: string, viewBox = "0 0 24 24") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`;

const ICONS = {
  user: (c: string) =>
    svgWrap(
      `<path fill="${c}" d="M12 12c2.76 0 5-2.24 5-5S14.76 2 12 2 7 4.24 7 7s2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z"/>`
    ),
  calendar: (c: string) =>
    svgWrap(
      `<path fill="${c}" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z"/>`
    ),
  pin: (c: string) =>
    svgWrap(
      `<path fill="${c}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>`
    ),
  cap: (c: string) =>
    svgWrap(
      `<path fill="${c}" d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zM5 13.18v2.81c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2v-2.81l-7 3.82-7-3.82z"/>`
    ),
  medal: (c: string) =>
    svgWrap(
      `<path fill="${c}" d="M12 2l3 7h7l-5.6 4.1L18.8 20 12 15.8 5.2 20l2.4-6.9L2 9h7z"/>`
    ),
  globe: (c: string) =>
    svgWrap(
      `<path fill="${c}" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm7.93 9h-3.18c-.12-2.19-.75-4.2-1.73-5.74A8.03 8.03 0 0 1 19.93 11zM12 4c1.4 1.77 2.28 4.07 2.45 7H9.55C9.72 8.07 10.6 5.77 12 4zM4.07 13h3.18c.12 2.19.75 4.2 1.73 5.74A8.03 8.03 0 0 1 4.07 13zm3.18-2H4.07A8.03 8.03 0 0 1 9 5.26C8 6.8 7.37 8.81 7.25 11zM12 20c-1.4-1.77-2.28-4.07-2.45-7h4.9C14.28 15.93 13.4 18.23 12 20zm3.02-1.26c.98-1.54 1.61-3.55 1.73-5.74h3.18a8.03 8.03 0 0 1-4.91 5.74z"/>`
    ),
};

function detectLangCode(label: string) {
  const s = safeText(label).toLowerCase();

  // FR
  if (/(français|francais|french|\bfr\b)/i.test(s)) return "fr";
  // EN
  if (/(anglais|english|\ben\b|\buk\b|\bus\b)/i.test(s)) return "en";
  // ES
  if (/(espagnol|spanish|\bes\b)/i.test(s)) return "es";
  // DE
  if (/(allemand|german|\bde\b)/i.test(s)) return "de";
  // IT
  if (/(italien|italian|\bit\b)/i.test(s)) return "it";
  // PT
  if (/(portugais|portuguese|\bpt\b)/i.test(s)) return "pt";
  // AR
  if (/(arabe|arabic|\bar\b)/i.test(s)) return "ar";
  // ZH
  if (/(chinois|mandarin|chinese|\bzh\b)/i.test(s)) return "zh";

  return "xx";
}

function flagSvg(code: string) {
  // flags simplifiés (lisibles en petit)
  switch (code) {
    case "fr":
      return svgWrap(
        `<rect width="24" height="16" fill="#fff"/>
         <rect width="8" height="16" x="0" fill="#0055A4"/>
         <rect width="8" height="16" x="16" fill="#EF4135"/>
         <rect x="0.5" y="0.5" width="23" height="15" rx="2" ry="2" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
        "0 0 24 16"
      );
    case "en":
      // UK-ish (simplifié)
      return svgWrap(
        `<rect width="24" height="16" fill="#0A3D91"/>
         <path d="M0 0 L24 16 M24 0 L0 16" stroke="#fff" stroke-width="3"/>
         <path d="M0 0 L24 16 M24 0 L0 16" stroke="#D40000" stroke-width="1.5"/>
         <rect x="10" y="0" width="4" height="16" fill="#fff"/>
         <rect x="0" y="6" width="24" height="4" fill="#fff"/>
         <rect x="10.8" y="0" width="2.4" height="16" fill="#D40000"/>
         <rect x="0" y="6.8" width="24" height="2.4" fill="#D40000"/>
         <rect x="0.5" y="0.5" width="23" height="15" rx="2" ry="2" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
        "0 0 24 16"
      );
    case "es":
      return svgWrap(
        `<rect width="24" height="16" fill="#AA151B"/>
         <rect y="4" width="24" height="8" fill="#F1BF00"/>
         <rect x="0.5" y="0.5" width="23" height="15" rx="2" ry="2" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
        "0 0 24 16"
      );
    case "de":
      return svgWrap(
        `<rect width="24" height="16" fill="#000"/>
         <rect y="5.33" width="24" height="5.33" fill="#D00"/>
         <rect y="10.66" width="24" height="5.34" fill="#FFCE00"/>
         <rect x="0.5" y="0.5" width="23" height="15" rx="2" ry="2" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
        "0 0 24 16"
      );
    case "it":
      return svgWrap(
        `<rect width="24" height="16" fill="#fff"/>
         <rect width="8" height="16" x="0" fill="#009246"/>
         <rect width="8" height="16" x="16" fill="#CE2B37"/>
         <rect x="0.5" y="0.5" width="23" height="15" rx="2" ry="2" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
        "0 0 24 16"
      );
    case "pt":
      return svgWrap(
        `<rect width="24" height="16" fill="#D40000"/>
         <rect width="10" height="16" x="0" fill="#006600"/>
         <rect x="0.5" y="0.5" width="23" height="15" rx="2" ry="2" fill="none" stroke="#cbd5e1" stroke-width="1"/>`,
        "0 0 24 16"
      );
    default:
      // fallback “badge”
      return svgWrap(
        `<rect width="24" height="16" rx="2" ry="2" fill="#f1f5f9" stroke="#cbd5e1" stroke-width="1"/>
         <circle cx="8" cy="8" r="3" fill="#94a3b8"/>
         <rect x="12" y="5" width="9" height="6" rx="1.5" fill="#cbd5e1"/>`,
        "0 0 24 16"
      );
  }
}

function getFlag(label: string) {
  return flagSvg(detectLangCode(label));
}

// ----------------------
// HELPERS & RENDERING
// ----------------------

function normLang(lang: any): Lang {
  return String(lang || "fr").toLowerCase().startsWith("en") ? "en" : "fr";
}

function pick(colors: PdfColorsLike | undefined, key: keyof PdfColorsLike, fallback: string) {
  const v = colors?.[key];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function safeText(v: any) {
  return String(v ?? "").replace(/\u00A0/g, " ").trim();
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "").trim();
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return { r, g, b };
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number) {
  const to = (x: number) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function mixHex(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.r + (B.r - A.r) * t, A.g + (B.g - A.g) * t, A.b + (B.b - A.b) * t);
}

function uniq(arr: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const s = safeText(x);
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function joinDot(items: string[], max = 18) {
  return uniq(items).slice(0, max).join(" · ");
}

function dotsBar(level: number, scale: number, fill: string, empty: string) {
  const canvas: any[] = [];
  for (let i = 0; i < 5; i++) {
    canvas.push({
      type: "ellipse",
      x: i * 7 * scale,
      y: 3 * scale,
      r1: 2.2 * scale,
      r2: 2.2 * scale,
      color: i < level ? fill : empty,
    });
  }
  return { canvas, width: 35 * scale };
}

function splitLangLine(langLine: string) {
  // ✅ FIX : support aussi "|", retours ligne, etc.
  return safeText(langLine)
    .split(/[\n,;|]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inferLangLevel(label: string) {
  const s = label.toLowerCase();
  // 5
  if (/(natif|native|bilingue|expert|c2|c1)/i.test(s)) return 5;
  // 4
  if (/(courant|fluent|b2)/i.test(s)) return 4;
  // 3
  if (/(interm|intermediate|b1)/i.test(s)) return 3;
  // 2
  if (/(a2|débutant|debutant|beginner)/i.test(s)) return 2;
  return 3;
}

function renderLanguages(langLine: string, scale: number, brand: string, line: string, ink: string, muted: string) {
  const items = splitLangLine(langLine);
  if (!items.length) return [{ text: "—", fontSize: 9 * scale, color: muted }];

  return items.map((it) => {
    const level = inferLangLevel(it);
    return {
      columns: [
        { svg: getFlag(it), width: 14 * scale, margin: [0, 2 * scale, 6 * scale, 0] },
        { text: it, fontSize: 9 * scale, color: ink, width: "*" },
        dotsBar(level, scale, brand, line),
      ],
      margin: [0, 0, 0, 5 * scale],
    };
  });
}

function sectionTitle(text: string, scale: number, color: string, iconSvg?: string) {
  const label = safeText(text).toUpperCase();
  return {
    columns: iconSvg
      ? [
          { svg: iconSvg, width: 12 * scale, margin: [0, 1 * scale, 6 * scale, 0] },
          { text: label, fontSize: 10 * scale, bold: true, color, letterSpacing: 0.5 },
        ]
      : [{ text: label, fontSize: 10 * scale, bold: true, color, letterSpacing: 0.5 }],
    margin: [0, 12 * scale, 0, 8 * scale],
  };
}

function hr(scale: number, color: string, width = 515) {
  return {
    canvas: [{ type: "line", x1: 0, y1: 0, x2: width, y2: 0, lineWidth: 1, lineColor: color }],
    margin: [0, 8 * scale, 0, 8 * scale],
  };
}

/** Card pdfmake propre (padding via layout) */
function card(scale: number, fill: string, border: string, stack: any[], pad = 12) {
  const p = pad * scale;
  return {
    table: { widths: ["*"], body: [[{ stack, fillColor: fill }]] },
    layout: {
      hLineWidth: () => 1,
      vLineWidth: () => 1,
      hLineColor: () => border,
      vLineColor: () => border,
      paddingLeft: () => p,
      paddingRight: () => p,
      paddingTop: () => p,
      paddingBottom: () => p,
    },
  };
}

function renderXp(model: CvDocModel, scale: number, ink: string, muted: string, brand: string) {
  const xp: any[] = Array.isArray((model as any).xp) ? (model as any).xp : [];
  if (!xp.length) return [{ text: "—", fontSize: 9 * scale, color: muted }];

  return xp.slice(0, 4).map((x) => {
    const role = safeText(x?.role);
    const company = safeText(x?.company);
    const dates = safeText(x?.dates);
    const city = safeText(x?.city);
    const bullets = Array.isArray(x?.bullets) ? x.bullets.map(safeText).filter(Boolean).slice(0, 4) : [];

    return {
      stack: [
        { text: [role, company].filter(Boolean).join(" — ") || "—", fontSize: 10.3 * scale, bold: true, color: ink, margin: [0, 0, 0, 2 * scale] },
        {
          columns: [
            dates
              ? { columns: [{ svg: ICONS.calendar(muted), width: 10 * scale, margin: [0, 1 * scale, 4 * scale, 0] }, { text: dates, fontSize: 8.6 * scale, color: muted }], width: "*" }
              : { text: "", width: "*" },
            city
              ? { columns: [{ svg: ICONS.pin(muted), width: 10 * scale, margin: [0, 1 * scale, 4 * scale, 0] }, { text: city, fontSize: 8.6 * scale, color: muted }], width: "auto" }
              : null,
          ].filter(Boolean),
          margin: [0, 0, 0, 3 * scale],
        },
        bullets.length
          ? { ul: bullets.map((b: string) => ({ text: b, fontSize: 9 * scale, color: ink })), margin: [0, 0, 0, 8 * scale] }
          : { canvas: [{ type: "line", x1: 0, y1: 0, x2: 60 * scale, y2: 0, lineWidth: 2, lineColor: mixHex(brand, "#ffffff", 0.25) }], margin: [0, 3 * scale, 0, 10 * scale] },
      ],
    };
  });
}

function renderEducation(model: CvDocModel, scale: number, ink: string, muted: string) {
  const edu = Array.isArray((model as any).education) ? (model as any).education : [];
  if (!edu.length) return [{ text: "—", fontSize: 9 * scale, color: muted }];
  return edu.slice(0, 3).map((line) => ({ text: safeText(line), fontSize: 9.2 * scale, color: ink, margin: [0, 0, 0, 4 * scale] }));
}

function renderSkillsCompact(model: CvDocModel, scale: number, muted: string) {
  const s: any = (model as any).skills || {};
  const all = [
    ...((Array.isArray(s.cloud) ? s.cloud : []) as string[]),
    ...((Array.isArray(s.sec) ? s.sec : []) as string[]),
    ...((Array.isArray(s.sys) ? s.sys : []) as string[]),
    ...((Array.isArray(s.auto) ? s.auto : []) as string[]),
    ...((Array.isArray(s.tools) ? s.tools : []) as string[]),
  ];
  const txt = joinDot(all, 22);
  return txt ? { text: txt, fontSize: 9 * scale, color: muted, lineHeight: 1.2 } : { text: "—", fontSize: 9 * scale, color: muted };
}

// ----------------------
// TEMPLATE BUILDERS
// ----------------------

function buildClassic(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const brand = pick(colors, "brand", "#ef4444");
  const ink = pick(colors, "ink", "#111827");
  const muted = pick(colors, "muted", "#6b7280");
  const line = pick(colors, "line", "#e5e7eb");
  const bgSoft = pick(colors, "bgSoft", "#f3f4f6");
  const white = pick(colors, "white", "#ffffff");

  const leftW = 185 * scale;

  return {
    pageSize: "A4",
    pageMargins: [34 * scale, 28 * scale, 34 * scale, 24 * scale],
    content: [
      {
        columns: [
          {
            width: leftW,
            stack: [
              { canvas: [{ type: "rect", x: 0, y: 0, w: leftW, h: 780, color: bgSoft, r: 12 * scale }] },
              {
                stack: [
                  { text: safeText((model as any).name), fontSize: 17 * scale, bold: true, color: ink, margin: [14 * scale, -760, 12 * scale, 2 * scale] },
                  (model as any).title ? { text: safeText((model as any).title), fontSize: 9.8 * scale, color: muted, margin: [14 * scale, 0, 12 * scale, 8 * scale] } : null,
                  (model as any).contactLine ? { text: safeText((model as any).contactLine), fontSize: 8.6 * scale, color: muted, margin: [14 * scale, 0, 12 * scale, 10 * scale] } : null,

                  sectionTitle(normLang(lang) === "en" ? "Skills" : "Compétences", scale, brand, ICONS.globe(brand)),
                  { ...renderSkillsCompact(model, scale, muted), margin: [14 * scale, -6 * scale, 12 * scale, 8 * scale] },

                  sectionTitle("Certifications", scale, brand, ICONS.medal(brand)),
                  {
                    text: safeText((model as any).certs) || "—",
                    fontSize: 9 * scale,
                    color: muted,
                    margin: [14 * scale, -6 * scale, 12 * scale, 8 * scale],
                  },

                  sectionTitle(normLang(lang) === "en" ? "Languages" : "Langues", scale, brand, ICONS.globe(brand)),
                  {
                    stack: renderLanguages(safeText((model as any).langLine), scale, brand, line, ink, muted),
                    margin: [14 * scale, -6 * scale, 12 * scale, 0],
                  },
                ].filter(Boolean),
              },
            ],
          },
          {
            width: "*",
            stack: [
              // petit accent
              { canvas: [{ type: "rect", x: 0, y: 0, w: 14 * scale, h: 14 * scale, color: brand, r: 3 * scale }], margin: [0, 0, 0, 6 * scale] },

              (model as any).profile
                ? card(scale, white, line, [
                    { text: normLang(lang) === "en" ? "PROFILE" : "PROFIL", fontSize: 8.8 * scale, bold: true, color: brand, margin: [0, 0, 0, 4 * scale] },
                    { text: safeText((model as any).profile), fontSize: 9.5 * scale, color: ink, lineHeight: 1.25 },
                  ])
                : null,

              hr(scale, line, 320),

              sectionTitle(normLang(lang) === "en" ? "Experience" : "Expérience", scale, brand, ICONS.calendar(brand)),
              { stack: renderXp(model, scale, ink, muted, brand) },

              hr(scale, line, 320),

              sectionTitle(normLang(lang) === "en" ? "Education" : "Formation", scale, brand, ICONS.cap(brand)),
              { stack: renderEducation(model, scale, ink, muted) },
            ].filter(Boolean),
          },
        ],
        columnGap: 18 * scale,
      },
    ],
  } as any;
}

function buildModern(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const brand = pick(colors, "brand", "#ef4444");
  const ink = pick(colors, "ink", "#0f172a");
  const muted = pick(colors, "muted", "#64748b");
  const line = pick(colors, "line", "#e2e8f0");
  const bgSoft = pick(colors, "bgSoft", "#f8fafc");
  const white = pick(colors, "white", "#ffffff");

  const headerH = 132 * scale;
  const rightW = 178 * scale;

  return {
    pageSize: "A4",
    pageMargins: [34 * scale, 28 * scale, 34 * scale, 24 * scale],
    background: (currentPage: number, pageSize: any) => {
      if (currentPage !== 1) return null;
      const w = pageSize?.width ?? 595;
      return [
        // header band
        { canvas: [{ type: "rect", x: 0, y: 0, w, h: headerH, color: brand }] },
        // dot motif (léger)
        {
          canvas: Array.from({ length: 64 }).map((_, i) => {
            const x = (w - 40) - (i % 8) * 18;
            const y = 18 + Math.floor(i / 8) * 14;
            return { type: "ellipse", x, y, r1: 1.5, r2: 1.5, color: mixHex("#ffffff", brand, 0.85), opacity: 0.25 };
          }),
        },
        // bottom border
        { canvas: [{ type: "rect", x: 0, y: pageSize?.height - 10, w, h: 10, color: brand }] },
      ];
    },
    content: [
      // Header texts
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: safeText((model as any).name), fontSize: 22 * scale, bold: true, color: "#ffffff" },
              (model as any).title ? { text: safeText((model as any).title), fontSize: 10.5 * scale, color: "#ffffff", opacity: 0.95, margin: [0, 4 * scale, 0, 0] } : null,
              (model as any).contactLine ? { text: safeText((model as any).contactLine), fontSize: 9 * scale, color: "#ffffff", opacity: 0.9, margin: [0, 8 * scale, 0, 0] } : null,
            ].filter(Boolean),
          },
          {
            width: 60 * scale,
            stack: [
              // badge carré (pseudo photo)
              {
                canvas: [
                  { type: "rect", x: 0, y: 0, w: 60 * scale, h: 60 * scale, color: mixHex("#ffffff", brand, 0.92), r: 12 * scale },
                  { type: "ellipse", x: 30 * scale, y: 30 * scale, r1: 18 * scale, r2: 18 * scale, color: "#ffffff", opacity: 0.35 },
                ],
              },
            ],
          },
        ],
        columnGap: 14 * scale,
        margin: [0, 0, 0, 16 * scale],
      },

      // ✅ Profil card mieux lisible (ton point)
      (model as any).profile
        ? {
            ...card(scale, white, line, [
              {
                columns: [
                  { svg: ICONS.user(brand), width: 12 * scale, margin: [0, 1 * scale, 6 * scale, 0] },
                  { text: normLang(lang) === "en" ? "PROFILE" : "PROFIL", fontSize: 9.3 * scale, bold: true, color: brand, letterSpacing: 0.3 },
                ],
                margin: [0, 0, 0, 4 * scale],
              },
              { text: safeText((model as any).profile), fontSize: 9.8 * scale, color: ink, lineHeight: 1.28 },
            ]),
            margin: [0, 0, 0, 10 * scale],
          }
        : null,

      {
        columns: [
          {
            width: "*",
            stack: [
              sectionTitle(normLang(lang) === "en" ? "Experience" : "Expérience", scale, brand, ICONS.calendar(brand)),
              { stack: renderXp(model, scale, ink, muted, brand) },

              hr(scale, line, 330),

              sectionTitle(normLang(lang) === "en" ? "Education" : "Formation", scale, brand, ICONS.cap(brand)),
              { stack: renderEducation(model, scale, ink, muted) },
            ],
          },
          {
            width: rightW,
            margin: [18 * scale, 0, 0, 0],
            stack: [
              sectionTitle(normLang(lang) === "en" ? "Skills" : "Compétences", scale, ink, ICONS.globe(ink)),
              renderSkillsCompact(model, scale, muted),
              hr(scale, line, rightW),

              sectionTitle("Certifications", scale, ink, ICONS.medal(ink)),
              { text: safeText((model as any).certs) || "—", fontSize: 9 * scale, color: muted },
              hr(scale, line, rightW),

              sectionTitle(normLang(lang) === "en" ? "Languages" : "Langues", scale, ink, ICONS.globe(ink)),
              { stack: renderLanguages(safeText((model as any).langLine), scale, brand, line, ink, muted) },
            ],
          },
        ],
      },
    ].filter(Boolean),
  } as any;
}

function buildMinimalist(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const brand = pick(colors, "brand", "#ef4444");
  const ink = pick(colors, "ink", "#0f172a");
  const muted = pick(colors, "muted", "#64748b");
  const line = pick(colors, "line", "#e2e8f0");

  return {
    pageSize: "A4",
    pageMargins: [40 * scale, 34 * scale, 40 * scale, 28 * scale],
    content: [
      { text: safeText((model as any).name), fontSize: 21 * scale, bold: true, color: ink, margin: [0, 0, 0, 2 * scale] },
      (model as any).title ? { text: safeText((model as any).title), fontSize: 10.5 * scale, color: muted, margin: [0, 0, 0, 4 * scale] } : null,
      (model as any).contactLine ? { text: safeText((model as any).contactLine), fontSize: 9 * scale, color: muted, margin: [0, 0, 0, 8 * scale] } : null,
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: brand }], margin: [0, 2 * scale, 0, 10 * scale] },

      (model as any).profile ? { text: safeText((model as any).profile), fontSize: 9.6 * scale, color: muted, lineHeight: 1.25, margin: [0, 0, 0, 6 * scale] } : null,

      sectionTitle(normLang(lang) === "en" ? "Skills" : "Compétences", scale, ink),
      renderSkillsCompact(model, scale, muted),

      sectionTitle(normLang(lang) === "en" ? "Experience" : "Expérience", scale, ink),
      { stack: renderXp(model, scale, ink, muted, brand) },

      sectionTitle(normLang(lang) === "en" ? "Education" : "Formation", scale, ink),
      { stack: renderEducation(model, scale, ink, muted) },

      sectionTitle(normLang(lang) === "en" ? "Languages" : "Langues", scale, ink),
      { stack: renderLanguages(safeText((model as any).langLine), scale, brand, line, ink, muted) },
    ].filter(Boolean),
  } as any;
}

function buildCreative(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const brand = pick(colors, "brand", "#ef4444");
  const ink = pick(colors, "ink", "#0f172a");
  const muted = pick(colors, "muted", "#64748b");
  const line = pick(colors, "line", "#e2e8f0");
  const bgSoft = pick(colors, "bgSoft", "#f8fafc");
  const white = pick(colors, "white", "#ffffff");

  const cardTitle = (t: string) => ({ text: t, fontSize: 10 * scale, bold: true, color: ink, margin: [0, 0, 0, 6 * scale] });

  return {
    pageSize: "A4",
    pageMargins: [34 * scale, 28 * scale, 34 * scale, 24 * scale],
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: safeText((model as any).name), fontSize: 19 * scale, bold: true, color: ink },
              (model as any).title ? { text: safeText((model as any).title), fontSize: 10.5 * scale, color: muted, margin: [0, 2 * scale, 0, 2 * scale] } : null,
              (model as any).contactLine ? { text: safeText((model as any).contactLine), fontSize: 9 * scale, color: muted } : null,
            ].filter(Boolean),
          },
          {
            width: 120 * scale,
            stack: [{ canvas: [{ type: "rect", x: 0, y: 0, w: 120 * scale, h: 12 * scale, color: brand, r: 6 * scale }] }],
          },
        ],
        margin: [0, 0, 0, 10 * scale],
      },

      (model as any).profile
        ? { ...card(scale, white, line, [{ text: safeText((model as any).profile), fontSize: 9.4 * scale, color: muted, lineHeight: 1.25 }]), margin: [0, 0, 0, 10 * scale] }
        : null,

      {
        columns: [
          {
            width: 230 * scale,
            stack: [
              card(scale, bgSoft, line, [
                cardTitle(normLang(lang) === "en" ? "Skills" : "Compétences"),
                renderSkillsCompact(model, scale, muted),
              ]),
              { text: " ", margin: [0, 8 * scale, 0, 0] },
              card(scale, bgSoft, line, [
                cardTitle(normLang(lang) === "en" ? "Languages" : "Langues"),
                { stack: renderLanguages(safeText((model as any).langLine), scale, brand, line, ink, muted) },
              ]),
              { text: " ", margin: [0, 8 * scale, 0, 0] },
              card(scale, bgSoft, line, [
                cardTitle("Certifications"),
                { text: safeText((model as any).certs) || "—", fontSize: 9 * scale, color: muted },
              ]),
            ],
          },
          {
            width: "*",
            stack: [
              card(scale, white, line, [
                cardTitle(normLang(lang) === "en" ? "Experience" : "Expérience"),
                { stack: renderXp(model, scale, ink, muted, brand) },
              ]),
              { text: " ", margin: [0, 8 * scale, 0, 0] },
              card(scale, white, line, [
                cardTitle(normLang(lang) === "en" ? "Education" : "Formation"),
                { stack: renderEducation(model, scale, ink, muted) },
              ]),
            ],
          },
        ],
        columnGap: 14 * scale,
      },
    ].filter(Boolean),
  } as any;
}

function buildElegant(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const brand = pick(colors, "brand", "#ef4444");
  const ink = pick(colors, "ink", "#0f172a");
  const muted = pick(colors, "muted", "#64748b");
  const line = pick(colors, "line", "#e2e8f0");

  return {
    pageSize: "A4",
    pageMargins: [40 * scale, 34 * scale, 40 * scale, 28 * scale],
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: safeText((model as any).name), fontSize: 21 * scale, bold: true, color: ink, margin: [0, 0, 0, 2 * scale] },
              (model as any).title ? { text: safeText((model as any).title), fontSize: 10.5 * scale, color: muted } : null,
              (model as any).contactLine ? { text: safeText((model as any).contactLine), fontSize: 9 * scale, color: muted, margin: [0, 4 * scale, 0, 0] } : null,
            ].filter(Boolean),
          },
          {
            width: 120 * scale,
            stack: [
              {
                canvas: [
                  { type: "rect", x: 0, y: 2 * scale, w: 120 * scale, h: 2 * scale, color: brand, r: 1 * scale },
                  { type: "rect", x: 28 * scale, y: 10 * scale, w: 92 * scale, h: 2 * scale, color: brand, r: 1 * scale, opacity: 0.35 },
                ],
              },
            ],
          },
        ],
        margin: [0, 0, 0, 10 * scale],
      },

      (model as any).profile ? { text: safeText((model as any).profile), fontSize: 9.6 * scale, color: muted, lineHeight: 1.28, margin: [0, 0, 0, 10 * scale] } : null,

      sectionTitle(normLang(lang) === "en" ? "Experience" : "Expérience", scale, brand, ICONS.calendar(brand)),
      { stack: renderXp(model, scale, ink, muted, brand) },

      hr(scale, line, 515),

      {
        columns: [
          {
            width: "*",
            stack: [
              sectionTitle(normLang(lang) === "en" ? "Skills" : "Compétences", scale, brand, ICONS.globe(brand)),
              renderSkillsCompact(model, scale, muted),
              hr(scale, line, 300),
              sectionTitle("Certifications", scale, brand, ICONS.medal(brand)),
              { text: safeText((model as any).certs) || "—", fontSize: 9.2 * scale, color: muted },
            ],
          },
          {
            width: 210 * scale,
            stack: [
              sectionTitle(normLang(lang) === "en" ? "Education" : "Formation", scale, brand, ICONS.cap(brand)),
              { stack: renderEducation(model, scale, ink, muted) },
              hr(scale, line, 210),
              sectionTitle(normLang(lang) === "en" ? "Languages" : "Langues", scale, brand, ICONS.globe(brand)),
              { stack: renderLanguages(safeText((model as any).langLine), scale, brand, line, ink, muted) },
            ],
          },
        ],
        columnGap: 16 * scale,
      },
    ].filter(Boolean),
  } as any;
}

function buildTech(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const brand = pick(colors, "brand", "#ef4444");
  const ink = pick(colors, "ink", "#0f172a");
  const muted = pick(colors, "muted", "#64748b");
  const line = pick(colors, "line", "#e2e8f0");

  const sidebar = "#0b1220";
  const sidebarText = "#ffffff";
  const leftW = 185 * scale;

  return {
    pageSize: "A4",
    pageMargins: [32 * scale, 28 * scale, 32 * scale, 24 * scale],
    content: [
      {
        columns: [
          {
            width: leftW,
            stack: [
              { canvas: [{ type: "rect", x: 0, y: 0, w: leftW, h: 780, color: sidebar, r: 12 * scale }] },
              {
                stack: [
                  { text: safeText((model as any).name), fontSize: 16.5 * scale, bold: true, color: sidebarText, margin: [14 * scale, -760, 12 * scale, 3 * scale] },
                  (model as any).title ? { text: safeText((model as any).title), fontSize: 9.5 * scale, color: sidebarText, opacity: 0.9, margin: [14 * scale, 0, 12 * scale, 8 * scale] } : null,
                  (model as any).contactLine ? { text: safeText((model as any).contactLine), fontSize: 8.6 * scale, color: sidebarText, opacity: 0.85, margin: [14 * scale, 0, 12 * scale, 10 * scale] } : null,

                  {
                    text: (normLang(lang) === "en" ? "SKILLS" : "COMPÉTENCES"),
                    fontSize: 9.2 * scale,
                    bold: true,
                    color: brand,
                    margin: [14 * scale, 0, 12 * scale, 6 * scale],
                    letterSpacing: 0.8,
                  },
                  { ...renderSkillsCompact(model, scale, sidebarText), margin: [14 * scale, 0, 12 * scale, 10 * scale] },

                  {
                    text: (normLang(lang) === "en" ? "LANGUAGES" : "LANGUES"),
                    fontSize: 9.2 * scale,
                    bold: true,
                    color: brand,
                    margin: [14 * scale, 0, 12 * scale, 6 * scale],
                    letterSpacing: 0.8,
                  },
                  {
                    stack: renderLanguages(safeText((model as any).langLine), scale, brand, mixHex(line, "#000000", 0.35), sidebarText, sidebarText),
                    margin: [14 * scale, 0, 12 * scale, 8 * scale],
                  },

                  {
                    text: "CERTIFS",
                    fontSize: 9.2 * scale,
                    bold: true,
                    color: brand,
                    margin: [14 * scale, 0, 12 * scale, 6 * scale],
                    letterSpacing: 0.8,
                  },
                  { text: safeText((model as any).certs) || "—", fontSize: 8.8 * scale, color: sidebarText, opacity: 0.9, margin: [14 * scale, 0, 12 * scale, 0] },
                ].filter(Boolean),
              },
            ],
          },
          {
            width: "*",
            stack: [
              { canvas: [{ type: "rect", x: 0, y: 0, w: 16 * scale, h: 16 * scale, color: brand, r: 3 * scale }], margin: [0, 0, 0, 6 * scale] },

              (model as any).profile ? { text: safeText((model as any).profile), fontSize: 9.4 * scale, color: muted, lineHeight: 1.25, margin: [0, 0, 0, 10 * scale] } : null,

              sectionTitle(normLang(lang) === "en" ? "Experience" : "Expérience", scale, ink, ICONS.calendar(ink)),
              { stack: renderXp(model, scale, ink, muted, brand) },

              hr(scale, line, 320),

              sectionTitle(normLang(lang) === "en" ? "Education" : "Formation", scale, ink, ICONS.cap(ink)),
              { stack: renderEducation(model, scale, ink, muted) },
            ].filter(Boolean),
          },
        ],
        columnGap: 16 * scale,
      },
    ],
  } as any;
}

function buildProMax(model: CvDocModel, lang: Lang, colors: PdfColorsLike, scale: number) {
  const brand = pick(colors, "brand", "#ef4444");
  const brand2 = mixHex(brand, "#ffffff", 0.35); // pseudo "dégradé"
  const ink = pick(colors, "ink", "#0f172a");
  const muted = pick(colors, "muted", "#64748b");
  const line = pick(colors, "line", "#e2e8f0");
  const bgSoft = pick(colors, "bgSoft", "#f8fafc");
  const white = pick(colors, "white", "#ffffff");

  const headerH = 148 * scale;
  const rightW = 182 * scale;

  const headerGradientBands = Array.from({ length: 18 }).map((_, i) => ({
    type: "rect",
    x: (i * 34) as any,
    y: 0,
    w: 34,
    h: headerH,
    color: mixHex(brand, brand2, i / 17),
    opacity: 0.95,
  }));

  return {
    pageSize: "A4",
    pageMargins: [34 * scale, 28 * scale, 34 * scale, 24 * scale],
    background: (currentPage: number, pageSize: any) => {
      if (currentPage !== 1) return null;
      const w = pageSize?.width ?? 595;
      const h = pageSize?.height ?? 842;
      return [
        // header pseudo-grad
        { canvas: headerGradientBands.map((b) => ({ ...b, w: (w / 18) + 1, x: (b.x as number) * (w / (18 * 34)) })) },
        // big soft circle motif
        { canvas: [{ type: "ellipse", x: w - 70, y: 64, r1: 90, r2: 90, color: "#ffffff", opacity: 0.18 }] },
        { canvas: [{ type: "ellipse", x: w - 40, y: 86, r1: 62, r2: 62, color: "#ffffff", opacity: 0.12 }] },
        // bottom border
        { canvas: [{ type: "rect", x: 0, y: h - 10, w, h: 10, color: brand }] },
      ];
    },
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: safeText((model as any).name), fontSize: 24 * scale, bold: true, color: "#ffffff" },
              (model as any).title ? { text: safeText((model as any).title), fontSize: 11 * scale, color: "#ffffff", opacity: 0.95, margin: [0, 4 * scale, 0, 0] } : null,
              (model as any).contactLine ? { text: safeText((model as any).contactLine), fontSize: 9.2 * scale, color: "#ffffff", opacity: 0.9, margin: [0, 10 * scale, 0, 0] } : null,
            ].filter(Boolean),
          },
          {
            width: 62 * scale,
            stack: [
              {
                canvas: [
                  { type: "rect", x: 0, y: 0, w: 62 * scale, h: 62 * scale, color: mixHex("#ffffff", brand, 0.9), r: 14 * scale },
                  { type: "ellipse", x: 31 * scale, y: 31 * scale, r1: 20 * scale, r2: 20 * scale, color: "#ffffff", opacity: 0.25 },
                ],
              },
            ],
          },
        ],
        columnGap: 14 * scale,
        margin: [0, 0, 0, 16 * scale],
      },

      // Profile Card (premium)
      (model as any).profile
        ? {
            ...card(scale, white, line, [
              {
                columns: [
                  { svg: ICONS.user(brand), width: 12 * scale, margin: [0, 1 * scale, 6 * scale, 0] },
                  { text: (normLang(lang) === "en" ? "PROFILE" : "PROFIL") + " — Pro Max", fontSize: 9.3 * scale, bold: true, color: brand, letterSpacing: 0.3 },
                ],
                margin: [0, 0, 0, 4 * scale],
              },
              { text: safeText((model as any).profile), fontSize: 9.9 * scale, color: ink, lineHeight: 1.3 },
            ]),
            margin: [0, 0, 0, 12 * scale],
          }
        : null,

      {
        columns: [
          {
            width: "*",
            stack: [
              // Experience card
              {
                ...card(scale, white, line, [
                  sectionTitle(normLang(lang) === "en" ? "Experience" : "Expérience", scale, brand, ICONS.calendar(brand)),
                  { stack: renderXp(model, scale, ink, muted, brand) },
                ]),
                margin: [0, 0, 0, 10 * scale],
              },

              // Education card
              card(scale, white, line, [
                sectionTitle(normLang(lang) === "en" ? "Education" : "Formation", scale, brand, ICONS.cap(brand)),
                { stack: renderEducation(model, scale, ink, muted) },
              ]),
            ],
          },
          {
            width: rightW,
            margin: [18 * scale, 0, 0, 0],
            stack: [
              // Skills (dark badge)
              {
                table: { widths: ["*"], body: [[{ stack: [sectionTitle(normLang(lang) === "en" ? "Skills" : "Compétences", scale, "#ffffff", ICONS.globe("#ffffff")), renderSkillsCompact(model, scale, "#cbd5e1")], fillColor: "#0b1220" }]] },
                layout: {
                  hLineWidth: () => 0,
                  vLineWidth: () => 0,
                  paddingLeft: () => 12 * scale,
                  paddingRight: () => 12 * scale,
                  paddingTop: () => 12 * scale,
                  paddingBottom: () => 12 * scale,
                },
                margin: [0, 0, 0, 10 * scale],
              },

              card(scale, bgSoft, line, [
                sectionTitle("Certifications", scale, ink, ICONS.medal(ink)),
                { text: safeText((model as any).certs) || "—", fontSize: 9.2 * scale, color: muted },
              ]),

              { text: " ", margin: [0, 8 * scale, 0, 0] },

              card(scale, bgSoft, line, [
                sectionTitle(normLang(lang) === "en" ? "Languages" : "Langues", scale, ink, ICONS.globe(ink)),
                { stack: renderLanguages(safeText((model as any).langLine), scale, brand, line, ink, muted) },
              ]),
            ],
          },
        ],
      },
    ].filter(Boolean),
  } as any;
}

// ----------------------
// PUBLIC API
// ----------------------
export function buildCvPdf(
  templateId: CvTemplateId,
  model: CvDocModel,
  lang: Lang,
  colors: PdfColorsLike,
  layout: "auto" | "tight" | "spacious" = "auto",
  scale = 1
) {
  const L = normLang(lang);

  // ATS -> ton template existant
  if (templateId === "ats") {
    return buildCvAtsPdf(model, L, colors as any, layout, scale);
  }

  // layout = ajustement global
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
      return buildModern(model, L, colors, s);
  }
}
