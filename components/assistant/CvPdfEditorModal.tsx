"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CvDocModel } from "@/lib/pdf/templates/cvAts";
import { downloadBlob } from "@/lib/pdf/pdfmakeClient";

type SectionKey = "profile" | "skills" | "xp" | "education" | "certs" | "languages" | "hobbies";

type CvDocModelExt = CvDocModel & {
  __meta?: {
    hide?: Partial<Record<SectionKey, boolean>>;
  };
};

function safeText(v: any) {
  return String(v ?? "").replace(/\u00A0/g, " ").trim();
}

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
          className="fixed inset-0 z-[90] flex items-center justify-center px-2 sm:px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/55" onClick={onClose} />
          <motion.div
            className="relative w-full max-w-6xl h-[92vh] rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden"
            initial={{ y: 14, opacity: 0, scale: 0.99 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.18 }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
              <div>
                <p className="text-[12px] text-[var(--muted)]">Éditeur CV</p>
                <h3 className="text-[14px] font-semibold text-[var(--ink)]">{title}</h3>
              </div>
              <button className="btn-secondary" type="button" onClick={onClose}>
                Fermer
              </button>
            </div>

            <div className="h-[calc(92vh-56px)] grid grid-cols-1 lg:grid-cols-[420px_1fr]">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function CvPdfEditorModal({
  open,
  onClose,
  initialModel,
  title,
  fileName = "cv-ia.pdf",
  templateLabel,
  renderPdf,
  onSaveModel,
}: {
  open: boolean;
  onClose: () => void;
  initialModel: CvDocModel;
  title: string;
  fileName?: string;
  templateLabel?: string;
  renderPdf: (model: CvDocModel) => Promise<{ blob: Blob; bestScale: number }>;
  onSaveModel?: (model: CvDocModel) => void;
}) {
  const [model, setModel] = useState<CvDocModelExt>(initialModel as CvDocModelExt);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [blob, setBlob] = useState<Blob | null>(null);
  const [bestScale, setBestScale] = useState<number | null>(null);

  const [blobUrl, setBlobUrl] = useState<string>("");

  const debounceRef = useRef<any>(null);

  // reset when open/initial changes
  useEffect(() => {
    if (!open) return;
    setModel(initialModel as CvDocModelExt);
  }, [open, initialModel]);

  // revoke old url
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const hide = model.__meta?.hide || {};

  const setHide = (k: SectionKey, v: boolean) => {
    setModel((m) => ({
      ...m,
      __meta: { ...(m.__meta || {}), hide: { ...(m.__meta?.hide || {}), [k]: v } },
    }));
  };

  const regenerate = async (m: CvDocModel) => {
    setErr(null);
    setBusy(true);
    try {
      const out = await renderPdf(m);
      setBlob(out.blob);
      setBestScale(out.bestScale);
      const url = URL.createObjectURL(out.blob);
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch (e: any) {
      setErr(e?.message || "Erreur génération PDF (preview).");
    } finally {
      setBusy(false);
    }
  };

  // ✅ debounce regen on model change (while open)
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      regenerate(model);
    }, 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(model)]);

  // first render when open
  useEffect(() => {
    if (!open) return;
    regenerate(model);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allSkills = useMemo(() => {
    const s: any = (model as any).skills || {};
    const pack = (k: string) => (Array.isArray(s[k]) ? s[k] : []);
    return {
      cloud: pack("cloud"),
      sec: pack("sec"),
      sys: pack("sys"),
      auto: pack("auto"),
      tools: pack("tools"),
      soft: pack("soft"),
    };
  }, [model]);

  const updateSkills = (key: keyof typeof allSkills, next: string[]) => {
    setModel((m: any) => ({
      ...m,
      skills: { ...(m.skills || {}), [key]: next },
    }));
  };

  const removeSkill = (key: keyof typeof allSkills, idx: number) => {
    const arr = [...(allSkills[key] || [])];
    arr.splice(idx, 1);
    updateSkills(key, arr);
  };

  const [skillDraft, setSkillDraft] = useState("");
  const [skillBucket, setSkillBucket] = useState<keyof typeof allSkills>("tools");

  useEffect(() => {
    if (!open) return;
    setSkillDraft("");
    setSkillBucket("tools");
  }, [open]);

  const addSkill = () => {
    const s = safeText(skillDraft);
    if (!s) return;
    const arr = [...(allSkills[skillBucket] || [])];
    arr.push(s);
    updateSkills(skillBucket, arr);
    setSkillDraft("");
  };

  const xp = Array.isArray((model as any).xp) ? ((model as any).xp as any[]) : [];
  const updateXp = (next: any[]) => setModel((m: any) => ({ ...m, xp: next }));

  const edu = Array.isArray((model as any).education) ? ((model as any).education as string[]) : [];
  const updateEdu = (next: string[]) => setModel((m: any) => ({ ...m, education: next }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
    >
      {/* LEFT: controls */}
      <div className="border-r border-[var(--border)] bg-[var(--bg-soft)] overflow-auto">
        <div className="p-4 space-y-3">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] text-[var(--muted)]">Template</p>
                <p className="text-[13px] font-semibold text-[var(--ink)]">{templateLabel || "CV"}</p>
                {bestScale != null && (
                  <p className="text-[11px] text-[var(--muted)] mt-1">Scale: {bestScale.toFixed(2)} (fit 1 page)</p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!blob || busy}
                  onClick={() => blob && downloadBlob(blob, fileName)}
                >
                  {busy ? "Génération…" : "Télécharger"}
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onSaveModel?.(model as CvDocModel)}
                >
                  Enregistrer
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setModel(initialModel as CvDocModelExt)}
                >
                  Réinitialiser
                </button>
              </div>
            </div>

            {err && <p className="mt-2 text-[11px] text-red-400">{err}</p>}
          </div>

          {/* Hide toggles */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="text-[12px] font-semibold text-[var(--ink)] mb-2">Masquer des sections</p>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              {(
                [
                  ["profile", "Profil"],
                  ["skills", "Compétences"],
                  ["education", "Formation"],
                  ["xp", "Expérience"],
                  ["languages", "Langues"],
                  ["certs", "Certifs"],
                  ["hobbies", "Hobbies"],
                ] as Array<[SectionKey, string]>
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!hide[k]}
                    onChange={(e) => setHide(k, e.target.checked)}
                  />
                  <span className="text-[var(--muted)]">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* General */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2">
            <p className="text-[12px] font-semibold text-[var(--ink)]">Infos</p>
            <div>
              <label className="block text-[11px] text-[var(--muted)] mb-1">Nom</label>
              <input
                className="input w-full bg-[var(--bg)]"
                value={safeText((model as any).name)}
                onChange={(e) => setModel((m: any) => ({ ...m, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--muted)] mb-1">Titre</label>
              <input
                className="input w-full bg-[var(--bg)]"
                value={safeText((model as any).title)}
                onChange={(e) => setModel((m: any) => ({ ...m, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-[11px] text-[var(--muted)] mb-1">Ligne contact</label>
              <input
                className="input w-full bg-[var(--bg)]"
                value={safeText((model as any).contactLine)}
                onChange={(e) => setModel((m: any) => ({ ...m, contactLine: e.target.value }))}
              />
            </div>
          </div>

          {/* Profile */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2">
            <p className="text-[12px] font-semibold text-[var(--ink)]">Profil</p>
            <textarea
              className="input textarea w-full bg-[var(--bg)] text-[13px]"
              rows={4}
              value={safeText((model as any).profile)}
              onChange={(e) => setModel((m: any) => ({ ...m, profile: e.target.value }))}
            />
          </div>

          {/* Skills */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[var(--ink)]">Compétences</p>
              <div className="flex items-center gap-2">
                <select
                  className="select-brand bg-[var(--bg-soft)] text-[12px]"
                  value={skillBucket}
                  onChange={(e) => setSkillBucket(e.target.value as any)}
                >
                  <option value="tools">Tools</option>
                  <option value="cloud">Cloud</option>
                  <option value="sec">Sécurité</option>
                  <option value="sys">Systèmes</option>
                  <option value="auto">Auto/DevOps</option>
                  <option value="soft">Soft</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2">
              <input
                className="input flex-1 bg-[var(--bg)]"
                placeholder="Ajouter une compétence…"
                value={skillDraft}
                onChange={(e) => setSkillDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSkill();
                  }
                }}
              />
              <button type="button" className="btn-secondary" onClick={addSkill}>
                Ajouter
              </button>
            </div>

            {(
              [
                ["cloud", "Cloud"],
                ["sec", "Sécurité"],
                ["sys", "Systèmes"],
                ["auto", "Auto/DevOps"],
                ["tools", "Tools"],
                ["soft", "Soft"],
              ] as Array<[keyof typeof allSkills, string]>
            ).map(([k, label]) => (
              <div key={k}>
                <p className="text-[11px] text-[var(--muted)] mb-2">{label}</p>
                <div className="flex flex-wrap gap-2">
                  {(allSkills[k] || []).map((it, idx) => (
                    <button
                      type="button"
                      key={`${k}-${idx}`}
                      className="text-[11px] px-2 py-[2px] rounded-full border border-[var(--border)] bg-[var(--bg-soft)] hover:border-red-400 hover:text-red-400 transition"
                      title="Cliquer pour supprimer"
                      onClick={() => removeSkill(k, idx)}
                    >
                      {it} <span className="ml-1">×</span>
                    </button>
                  ))}
                  {!allSkills[k]?.length && (
                    <span className="text-[11px] text-[var(--muted)]">—</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Experience */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[var(--ink)]">Expériences</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  updateXp([
                    ...xp,
                    { role: "Poste", company: "Entreprise", dates: "2023–2025", city: "", bullets: ["Impact / résultat chiffré"] },
                  ])
                }
              >
                + Ajouter
              </button>
            </div>

            <div className="space-y-3">
              {xp.map((x, i) => (
                <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-semibold text-[var(--ink)]">EXP #{i + 1}</p>
                    <button
                      type="button"
                      className="text-[12px] text-red-400 hover:underline"
                      onClick={() => {
                        const next = [...xp];
                        next.splice(i, 1);
                        updateXp(next);
                      }}
                    >
                      Supprimer
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <label className="block text-[11px] text-[var(--muted)] mb-1">Poste</label>
                      <input
                        className="input w-full bg-[var(--bg)]"
                        value={safeText(x.role)}
                        onChange={(e) => {
                          const next = [...xp];
                          next[i] = { ...next[i], role: e.target.value };
                          updateXp(next);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--muted)] mb-1">Entreprise</label>
                      <input
                        className="input w-full bg-[var(--bg)]"
                        value={safeText(x.company)}
                        onChange={(e) => {
                          const next = [...xp];
                          next[i] = { ...next[i], company: e.target.value };
                          updateXp(next);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--muted)] mb-1">Dates</label>
                      <input
                        className="input w-full bg-[var(--bg)]"
                        value={safeText(x.dates)}
                        onChange={(e) => {
                          const next = [...xp];
                          next[i] = { ...next[i], dates: e.target.value };
                          updateXp(next);
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--muted)] mb-1">Ville</label>
                      <input
                        className="input w-full bg-[var(--bg)]"
                        value={safeText(x.city)}
                        onChange={(e) => {
                          const next = [...xp];
                          next[i] = { ...next[i], city: e.target.value };
                          updateXp(next);
                        }}
                      />
                    </div>
                  </div>

                  <div className="mt-2">
                    <label className="block text-[11px] text-[var(--muted)] mb-1">
                      Bullets (1 ligne = 1 bullet)
                    </label>
                    <textarea
                      className="input textarea w-full bg-[var(--bg)] text-[13px]"
                      rows={4}
                      value={Array.isArray(x.bullets) ? x.bullets.join("\n") : ""}
                      onChange={(e) => {
                        const next = [...xp];
                        next[i] = {
                          ...next[i],
                          bullets: e.target.value
                            .split("\n")
                            .map((l) => l.trim())
                            .filter(Boolean),
                        };
                        updateXp(next);
                      }}
                    />

                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          const next = [...xp];
                          const bullets = Array.isArray(next[i].bullets) ? [...next[i].bullets] : [];
                          bullets.push("Exemple : Automatisation / optimisation → -30% temps de traitement");
                          next[i] = { ...next[i], bullets };
                          updateXp(next);
                        }}
                      >
                        + Exemple
                      </button>

                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          const next = [...xp];
                          const bullets = Array.isArray(next[i].bullets) ? [...next[i].bullets] : [];
                          // nettoyage simple : unique + trim
                          const seen = new Set<string>();
                          const clean = bullets
                            .map((b) => b.trim())
                            .filter(Boolean)
                            .filter((b) => {
                              const k = b.toLowerCase();
                              if (seen.has(k)) return false;
                              seen.add(k);
                              return true;
                            });
                          next[i] = { ...next[i], bullets: clean };
                          updateXp(next);
                        }}
                      >
                        Nettoyer
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!xp.length && <p className="text-[11px] text-[var(--muted)]">Aucune expérience.</p>}
            </div>
          </div>

          {/* Education */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[var(--ink)]">Formation</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => updateEdu([...edu, "Diplôme — École — 2022 — Paris"])}
              >
                + Ajouter
              </button>
            </div>

            <div className="space-y-2">
              {edu.map((line, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input flex-1 bg-[var(--bg)]"
                    value={safeText(line)}
                    onChange={(e) => {
                      const next = [...edu];
                      next[i] = e.target.value;
                      updateEdu(next);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const next = [...edu];
                      next.splice(i, 1);
                      updateEdu(next);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
              {!edu.length && <p className="text-[11px] text-[var(--muted)]">Aucune formation.</p>}
            </div>
          </div>

          {/* Lang / certs / hobbies */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2">
            <p className="text-[12px] font-semibold text-[var(--ink)]">Langues / Certifs / Hobbies</p>

            <div>
              <label className="block text-[11px] text-[var(--muted)] mb-1">Langues (ligne)</label>
              <input
                className="input w-full bg-[var(--bg)]"
                value={safeText((model as any).langLine)}
                onChange={(e) => setModel((m: any) => ({ ...m, langLine: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-[11px] text-[var(--muted)] mb-1">Certifications</label>
              <textarea
                className="input textarea w-full bg-[var(--bg)] text-[13px]"
                rows={2}
                value={safeText((model as any).certs)}
                onChange={(e) => setModel((m: any) => ({ ...m, certs: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-[11px] text-[var(--muted)] mb-1">Hobbies (séparés par virgule)</label>
              <input
                className="input w-full bg-[var(--bg)]"
                value={Array.isArray((model as any).hobbies) ? (model as any).hobbies.join(", ") : ""}
                onChange={(e) =>
                  setModel((m: any) => ({
                    ...m,
                    hobbies: e.target.value
                      .split(",")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </div>
          </div>

          <p className="px-1 pb-3 text-[10px] text-[var(--muted)]">
            💡 Tout ce que tu modifies ici régénère le PDF : tu “édites” ton CV directement depuis ton site.
          </p>
        </div>
      </div>

      {/* RIGHT: preview */}
      <div className="bg-[var(--bg)] overflow-hidden">
        <div className="h-full w-full relative">
          {busy && (
            <div className="absolute inset-0 z-10 bg-white/40 backdrop-blur-[2px] flex items-center justify-center">
              <div className="rounded-full bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[11px] text-[var(--muted)] flex items-center gap-2">
                <span className="inline-flex w-3 h-3 rounded-full border-2 border-[var(--brand)] border-t-transparent animate-spin" />
                <span>Régénération PDF…</span>
              </div>
            </div>
          )}

          {blobUrl ? (
            <iframe title="cv-preview" src={blobUrl} className="w-full h-full" />
          ) : (
            <div className="h-full flex items-center justify-center text-[11px] text-[var(--muted)]">
              Preview PDF…
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
