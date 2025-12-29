// src/components/CvTemplatePicker.tsx
"use client";

import Image from "next/image";
import { getCvTemplates, type CvTemplateId } from "@/lib/pdf/templates/cvTemplates";

export function CvTemplatePicker({
  value,
  onChange,
}: {
  value: CvTemplateId;
  onChange: (id: CvTemplateId) => void;
}) {
  const templates = getCvTemplates();

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {templates.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              "text-left rounded-xl border p-3 hover:bg-[var(--bg-soft)] transition",
              selected ? "border-[var(--brand)] ring-2 ring-[var(--brand)]/20" : "border-[var(--border)]",
            ].join(" ")}
          >
            <div className="relative w-full aspect-[4/3] rounded-lg overflow-hidden bg-white border border-[var(--border)]">
              <Image
                src={t.previewSrc}
                alt={t.label}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 50vw, 33vw"
              />
            </div>

            <div className="mt-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-[var(--ink)]">{t.label}</p>
                {selected ? (
                  <span className="text-[10px] px-2 py-1 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] border border-[var(--brand)]/20">
                    Sélectionné
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-1">{t.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
