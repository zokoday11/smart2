"use client";

import { ReactNode } from "react";
import { motion } from "framer-motion";
import PdfViewer from "./PdfViewer";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  fileUrl: string | null;

  onClose: () => void;

  // ✅ jamais d’auto-download : on télécharge uniquement sur clic
  onDownload: () => void;
  downloadDisabled?: boolean;

  leftPanel?: ReactNode; // ton éditeur (CV ou LM)
};

export default function PdfEditorModal({
  open,
  title,
  subtitle,
  fileUrl,
  onClose,
  onDownload,
  downloadDisabled,
  leftPanel,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="absolute inset-2 sm:inset-4 rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-3 sm:p-4 border-b border-[var(--border)] bg-[var(--bg-soft)]">
          <div>
            <p className="text-[13px] font-semibold text-[var(--ink)]">{title}</p>
            {subtitle ? <p className="text-[11px] text-[var(--muted)]">{subtitle}</p> : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary !py-2 !px-3 text-[12px]"
              onClick={onClose}
            >
              Fermer
            </button>

            <button
              type="button"
              className="btn-primary !py-2 !px-3 text-[12px]"
              disabled={downloadDisabled}
              onClick={onDownload}
            >
              Télécharger
            </button>
          </div>
        </div>

        {/* Body full height */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[440px_1fr]">
          {/* Left editor */}
          <div className="min-h-0 overflow-auto border-b lg:border-b-0 lg:border-r border-[var(--border)] bg-[var(--bg)] p-3 sm:p-4">
            {leftPanel ? (
              leftPanel
            ) : (
              <div className="text-[12px] text-[var(--muted)]">
                Aucun éditeur fourni.
              </div>
            )}
          </div>

          {/* Right preview */}
          <div className="min-h-0 overflow-auto bg-[var(--bg)] p-3 sm:p-4">
            <PdfViewer fileUrl={fileUrl} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
