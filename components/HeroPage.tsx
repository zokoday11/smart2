// components/HeroPage.tsx (par ex.)
"use client";

import { useI18n } from "@/context/I18nContext";

export default function HeroPage() {
  const { t } = useI18n();

  return (
    <div className="glass rounded-2xl border border-[var(--border)]/80 p-6">
      <h1 className="text-xl font-semibold">{t("heroTitle")}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{t("heroSubtitle")}</p>

      <div className="mt-4 flex gap-2">
        <button className="btn-primary">{t("startFree")}</button>
        <button className="btn-secondary">{t("alreadyHaveAccount")}</button>
      </div>
    </div>
  );
}
