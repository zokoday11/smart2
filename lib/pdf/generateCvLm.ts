// src/lib/pdf/generateCvLm.ts
import { makePdfColors } from "./colors";
import { fitOnePage } from "./fitOnePage";
import { mergePdfBlobs } from "./mergePdfs";
import { downloadBlob } from "./pdfmakeClient";
import { buildCvAtsPdf, type CvDocModel } from "./templates/cvAts";
import { buildLmStyledPdf, buildLmFallbackPdf, type LmModel } from "./templates/letter";

export async function generateAndDownloadCvLmPdf(params: {
  brandHex: string;
  cv: CvDocModel;
  cvLang: "fr" | "en";
  // LM: soit modèle structuré, soit texte brut
  lm?: LmModel;
  lmTextFallback?: string;
  filename?: string;
}) {
  const colors = makePdfColors(params.brandHex);

  // 1) CV -> fit 1 page
  const cvFit = await fitOnePage((scale) =>
    buildCvAtsPdf(params.cv, params.cvLang, colors, "auto", scale)
  );

  // 2) LM -> fit 1 page
  const lmFit = await fitOnePage((scale) => {
    if (params.lm) return buildLmStyledPdf(params.lm, colors, scale);
    return buildLmFallbackPdf(params.lmTextFallback || "", colors, scale);
  }, { min: 0.85, max: 1.6, iterations: 6, initial: 1.0 });

  // 3) fusion (2 pages)
  const merged = await mergePdfBlobs([cvFit.blob, lmFit.blob]);

  downloadBlob(merged, params.filename || `CV_LM_${new Date().toISOString().slice(0, 10)}.pdf`);
}
