"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CvTemplateId, CvTemplateMeta } from "@/lib/pdf/templates/cvTemplates";

type Props = {
  templates: CvTemplateMeta[];
  value: CvTemplateId;
  onChange: (id: CvTemplateId) => void;
};

function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center px-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl"
            initial={{ y: 14, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <p className="text-[12px] text-[var(--muted)]">Choix du template</p>
                <h3 className="text-[14px] font-semibold text-[var(--ink)]">{title}</h3>
              </div>
              <button className="btn-secondary" type="button" onClick={onClose}>
                Fermer
              </button>
            </div>
            <div className="p-4">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TemplateCard({
  t,
  active,
  onPick,
}: {
  t: CvTemplateMeta;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`text-left rounded-xl border p-2 bg-[var(--bg-soft)] transition w-full
      ${active ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20" : "border-[var(--border)] hover:border-[var(--brand)]/50"}`}
    >
      <img
        src={t.previewSrc}
        alt={t.label}
        className="w-full h-[140px] object-cover rounded-lg border border-[var(--border)] bg-white"
      />
      <div className="mt-2">
        <p className="text-[12px] font-semibold text-[var(--ink)] flex items-center justify-between gap-2">
          <span>{t.label}</span>
          {active && (
            <span className="text-[10px] px-2 py-[2px] rounded-full bg-[var(--brand)]/10 text-[var(--brand)] border border-[var(--brand)]/20">
              Sélectionné
            </span>
          )}
        </p>
        <p className="text-[10px] text-[var(--muted)]">{t.description}</p>
      </div>
    </button>
  );
}

export default function CvTemplatePicker({ templates, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = templates.find((t) => t.id === value);

  // ✅ 3 visibles : on force le template sélectionné + 2 autres
  const top3 = useMemo(() => {
    const others = templates.filter((t) => t.id !== value);
    return [selected, ...others.slice(0, 2)].filter(Boolean) as CvTemplateMeta[];
  }, [templates, value, selected]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return templates;
    return templates.filter((t) => {
      const hay = `${t.label} ${t.description} ${t.id}`.toLowerCase();
      return hay.includes(s);
    });
  }, [templates, q]);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {top3.map((t) => (
          <TemplateCard key={t.id} t={t} active={t.id === value} onPick={() => onChange(t.id)} />
        ))}

        {/* ✅ "Voir plus" */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3 hover:border-[var(--brand)]/50 transition flex flex-col items-center justify-center gap-2"
        >
          <span className="w-9 h-9 rounded-xl bg-[var(--brand)]/10 text-[var(--brand)] flex items-center justify-center text-lg">
            +
          </span>
          <div className="text-center">
            <p className="text-[12px] font-semibold text-[var(--ink)]">Voir plus</p>
            <p className="text-[10px] text-[var(--muted)]">Tous les modèles</p>
          </div>
        </button>
      </div>

      <p className="mt-2 text-[10px] text-[var(--muted)]">
        Les images doivent être dans <strong>/public/cv-templates/</strong> (ex:{" "}
        <span className="font-mono">/cv-templates/cv-template-modern.png</span>).
      </p>

      <Modal
        open={open}
        title="Tous les templates CV"
        onClose={() => setOpen(false)}
      >
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-3">
          <input
            className="input w-full sm:max-w-sm bg-[var(--bg)]"
            placeholder="Rechercher un template…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {selected ? (
            <div className="text-[11px] text-[var(--muted)]">
              Sélection actuelle : <span className="font-medium text-[var(--ink)]">{selected.label}</span>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              active={t.id === value}
              onPick={() => {
                onChange(t.id);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}
