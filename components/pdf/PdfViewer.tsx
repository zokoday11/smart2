"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

// ✅ Worker pdf.js (Next 14 OK)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

type Props = {
  fileUrl: string | null; // objectURL (Blob) ou URL
  className?: string;
};

export default function PdfViewer({ fileUrl, className }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapW, setWrapW] = useState(900);

  const [numPages, setNumPages] = useState(1);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;

    const ro = new ResizeObserver(() => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 50) setWrapW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // reset quand on change de fichier
    setPage(1);
    setZoom(1);
  }, [fileUrl]);

  const canPrev = page > 1;
  const canNext = page < numPages;

  const width = useMemo(() => {
    // un peu de marge interne
    return Math.max(200, Math.floor(wrapW - 24));
  }, [wrapW]);

  if (!fileUrl) {
    return (
      <div className={`rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 text-[12px] text-[var(--muted)] ${className || ""}`}>
        Aucun aperçu pour l’instant.
      </div>
    );
  }

  return (
    <div ref={wrapRef} className={className}>
      {/* Toolbar custom (pas celle de Chrome) */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <button
            type="button"
            className="btn-secondary !py-1 !px-2 text-[11px]"
            disabled={!canPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ←
          </button>
          <span className="min-w-[80px] text-center">
            Page <span className="font-medium text-[var(--ink)]">{page}</span> / {numPages}
          </span>
          <button
            type="button"
            className="btn-secondary !py-1 !px-2 text-[11px]"
            disabled={!canNext}
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
          >
            →
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !py-1 !px-2 text-[11px]"
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))}
          >
            −
          </button>
          <span className="text-[11px] text-[var(--muted)] w-[54px] text-center">
            {(zoom * 100).toFixed(0)}%
          </span>
          <button
            type="button"
            className="btn-secondary !py-1 !px-2 text-[11px]"
            onClick={() => setZoom((z) => Math.min(2.0, +(z + 0.1).toFixed(2)))}
          >
            +
          </button>

          <button
            type="button"
            className="btn-secondary !py-1 !px-3 text-[11px]"
            onClick={() => setZoom(1)}
          >
            100%
          </button>
        </div>
      </div>

      <div className="mt-2 rounded-xl border border-[var(--border)] bg-white overflow-auto p-3">
        <Document
          file={fileUrl}
          loading={<div className="text-[12px] text-[var(--muted)]">Chargement du PDF…</div>}
          onLoadSuccess={(info) => {
            setNumPages(info.numPages || 1);
            setPage(1);
          }}
          onLoadError={(e) => console.error("PDF load error:", e)}
        >
          <Page
            pageNumber={page}
            width={width}
            scale={zoom}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={<div className="text-[12px] text-[var(--muted)]">Rendu…</div>}
          />
        </Document>
      </div>
    </div>
  );
}
