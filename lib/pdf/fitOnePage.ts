// src/lib/pdf/fitOnePage.ts
import { PDFDocument } from "pdf-lib";
import { pdfMakeToBlob } from "./pdfmakeClient";

export async function countPdfPages(blob: Blob): Promise<number> {
  const ab = await blob.arrayBuffer();
  const pdf = await PDFDocument.load(ab);
  return pdf.getPageCount();
}

export async function fitOnePage(
  buildDoc: (scale: number) => any,
  opts?: { min?: number; max?: number; iterations?: number; initial?: number }
): Promise<{ blob: Blob; bestScale: number }> {
  const min = opts?.min ?? 0.8;
  const max = opts?.max ?? 1.6;
  const iterations = opts?.iterations ?? 8;
  const initial = opts?.initial ?? 1.0;

  let low = min;
  let high = max;

  // test initial
  let bestBlob: Blob | null = null;
  let bestScale = initial;

  let testBlob = await pdfMakeToBlob(buildDoc(initial));
  let pages = await countPdfPages(testBlob);

  if (pages > 1) {
    high = initial;
  } else {
    bestBlob = testBlob;
    low = initial;
  }

  for (let i = 0; i < iterations; i++) {
    const mid = +(((low + high) / 2)).toFixed(3);
    const blob = await pdfMakeToBlob(buildDoc(mid));
    const n = await countPdfPages(blob);

    if (n > 1) {
      high = mid - 0.01;
    } else {
      bestBlob = blob;
      bestScale = mid;
      low = mid + 0.01;
    }
    if (high - low < 0.01) break;
  }

  if (!bestBlob) {
    bestBlob = await pdfMakeToBlob(buildDoc(min));
    bestScale = min;
  }

  return { blob: bestBlob, bestScale };
}
