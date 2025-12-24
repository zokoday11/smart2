// lib/pdf/colors.ts
export type PdfColors = {
  brand: string;
  brandDark: string;
  ink: string;
  muted: string;
  border: string;
  bgSoft: string;
  hair: string; // ✅ requis par letter.ts
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function normalizeHex(hex: string) {
  let h = (hex || "").trim();
  if (!h.startsWith("#")) h = `#${h}`;
  if (h.length === 4) {
    // #RGB -> #RRGGBB
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return "#2563eb";
  return h.toLowerCase();
}

function hexToRgb(hex: string) {
  const h = normalizeHex(hex).slice(1);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const to = (x: number) =>
    clamp(Math.round(x), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function darken(hex: string, amount = 28) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r - amount, g - amount, b - amount);
}

export function makePdfColors(brandHex: string): PdfColors {
  const brand = normalizeHex(brandHex);
  return {
    brand,
    brandDark: darken(brand, 28),

    ink: "#0f172a", // slate-900
    muted: "#475569", // slate-600
    border: "#e2e8f0", // slate-200
    bgSoft: "#f1f5f9", // slate-100
    hair: "#cbd5e1", // slate-300 (ligne fine)
  };
}
