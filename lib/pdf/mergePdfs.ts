// src/lib/pdf/mergePdfs.ts
import { PDFDocument } from "pdf-lib";

/**
 * Merge plusieurs PDFs (Blob) en un seul PDF (Blob).
 * Compatible Next.js / TS: évite le type Uint8Array<ArrayBufferLike> non accepté par BlobPart.
 */
export async function mergePdfBlobs(blobs: Blob[]): Promise<Blob> {
  const merged = await PDFDocument.create();

  for (const b of blobs) {
    const ab = await b.arrayBuffer();
    const pdf = await PDFDocument.load(ab);

    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  const bytes = await merged.save();

  // ✅ Cast sûr pour BlobPart (ArrayBuffer-backed)
  const safeBytes = new Uint8Array(bytes);

  return new Blob([safeBytes], { type: "application/pdf" });
}
