// src/lib/pdf/pdfmakeClient.ts
let cached: any | null = null;

function buildVfsFromModule(mod: any) {
  if (!mod) return null;

  // Cas classique: { pdfMake: { vfs: {...} } }
  const classic =
    mod?.pdfMake?.vfs ??
    mod?.default?.pdfMake?.vfs ??
    mod?.default?.vfs ??
    mod?.vfs;

  if (classic && typeof classic === "object") return classic;

  // ✅ Ton cas: le module expose directement les fichiers Roboto-*.ttf
  // Ex: { "Roboto-Regular.ttf": "base64...", ..., default: {...} }
  const candidate = typeof mod === "object" ? mod : null;
  if (!candidate) return null;

  const vfs: Record<string, string> = {};

  for (const [k, v] of Object.entries(candidate)) {
    if (k === "default") continue;
    if (!k.toLowerCase().endsWith(".ttf")) continue;
    if (typeof v !== "string") continue;
    vfs[k] = v;
  }

  // Certains bundlers mettent les .ttf dans default
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

  const pdfMakeMod: any = await import("pdfmake/build/pdfmake");
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod;

  const fontsMod: any = await import("pdfmake/build/vfs_fonts");
  const vfs = buildVfsFromModule(fontsMod);

  if (!vfs) {
    console.error("vfs_fonts module keys:", Object.keys(fontsMod || {}));
    console.error("vfs_fonts.default keys:", Object.keys(fontsMod?.default || {}));
    throw new Error("pdfmake vfs_fonts introuvable (vfs).");
  }

  pdfMake.vfs = vfs;

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
  return new Promise((resolve) => pdfMake.createPdf(docDef).getBlob(resolve));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
