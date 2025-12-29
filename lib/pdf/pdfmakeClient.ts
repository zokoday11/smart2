"use client";

import pdfMakeMod from "pdfmake/build/pdfmake";
import pdfFontsMod from "pdfmake/build/vfs_fonts";

let cached: any | null = null;

function buildVfsFromModule(mod: any) {
  if (!mod) return null;

  const classic =
    mod?.pdfMake?.vfs ??
    mod?.default?.pdfMake?.vfs ??
    mod?.default?.vfs ??
    mod?.vfs;

  if (classic && typeof classic === "object") return classic;

  const candidate = typeof mod === "object" ? mod : null;
  if (!candidate) return null;

  const vfs: Record<string, string> = {};

  for (const [k, v] of Object.entries(candidate)) {
    if (k === "default") continue;
    if (!k.toLowerCase().endsWith(".ttf")) continue;
    if (typeof v !== "string") continue;
    vfs[k] = v;
  }

  const def = candidate?.default;
  if (def && typeof def === "object") {
    for (const [k, v] of Object.entries(def)) {
      if (!k.toLowerCase().endsWith(".ttf")) continue;
      if (typeof v !== "string") continue;
      vfs[k] = v;
    }
  }

  return Object.keys(vfs).length ? vfs : null;
}

export async function getPdfMake() {
  if (cached) return cached;

  const pdfMake = (pdfMakeMod as any).default ?? (pdfMakeMod as any);
  const vfs = buildVfsFromModule(pdfFontsMod);

  if (!vfs) {
    console.error("vfs_fonts module keys:", Object.keys((pdfFontsMod as any) || {}));
    console.error("vfs_fonts.default keys:", Object.keys((pdfFontsMod as any)?.default || {}));
    throw new Error("pdfmake vfs_fonts introuvable (vfs).");
  }

  // injecte vfs une seule fois
  if (!pdfMake.vfs) pdfMake.vfs = vfs;

  pdfMake.fonts = {
    Roboto: {
      normal: "Roboto-Regular.ttf",
      bold: "Roboto-Medium.ttf",
      italics: "Roboto-Italic.ttf",
      bolditalics: "Roboto-MediumItalic.ttf",
    },
  };

  cached = pdfMake;
  return pdfMake;
}

export async function pdfMakeToBlob(docDef: any): Promise<Blob> {
  const pdfMake = await getPdfMake();
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(docDef).getBlob((blob: Blob) => resolve(blob));
    } catch (e) {
      reject(e);
    }
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
