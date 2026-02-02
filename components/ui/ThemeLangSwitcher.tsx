// components/ui/ThemeLangSwitcher.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useTranslation } from "react-i18next";
import i18n, { APP_LANG_KEY, AppLang } from "@/lib/i18n";

const LANGS: Array<{ code: AppLang; label: string; flag: string }> = [
  { code: "fr", label: "FR", flag: "🇫🇷" },
  { code: "en", label: "EN", flag: "🇺🇸" },
  { code: "es", label: "ES", flag: "🇪🇸" },
  { code: "de", label: "DE", flag: "🇩🇪" },
  { code: "it", label: "IT", flag: "🇮🇹" },
  { code: "pt", label: "PT", flag: "🇵🇹" },
  { code: "ru", label: "RU", flag: "🇷🇺" },
  { code: "zh", label: "中文", flag: "🇨🇳" },
  { code: "ar", label: "AR", flag: "🇸🇦" },
  { code: "hi", label: "HI", flag: "🇮🇳" },
  { code: "bn", label: "BN", flag: "🇧🇩" },
  { code: "ur", label: "UR", flag: "🇵🇰" },
];

function applyHtmlLangDir(lng: string) {
  const html = document.documentElement;
  const base = (lng || "fr").toLowerCase().split("-")[0];
  html.setAttribute("lang", base);
  html.setAttribute("dir", base.startsWith("ar") ? "rtl" : "ltr");
}

export function ThemeLangSwitcher() {
  const { theme, toggleTheme } = useTheme();
  useTranslation(); // force re-render when lang changes
  const [open, setOpen] = useState(false);

  const currentLang = useMemo<AppLang>(() => {
    const lng = (i18n.resolvedLanguage || i18n.language || "fr")
      .toLowerCase()
      .split("-")[0] as AppLang;
    return lng;
  }, [i18n.resolvedLanguage, i18n.language]);

  useEffect(() => {
    const onClick = () => setOpen(false);
    if (!open) return;
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  const setLang = async (lng: AppLang) => {
    try {
      localStorage.setItem(APP_LANG_KEY, lng); // ✅ keep on refresh
    } catch {}

    try {
      await i18n.changeLanguage(lng);
    } catch {}

    applyHtmlLangDir(lng);
    setOpen(false);
  };

  const current = LANGS.find((l) => l.code === currentLang) ?? LANGS[0];

  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {/* Langues */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2 py-1 text-[11px] bg-[var(--bg-soft)]"
          aria-label="Changer la langue"
        >
          <span>{current.flag}</span>
          <span>{current.label}</span>
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-40 rounded-xl bg-[var(--bg-soft)] border border-[var(--border)]/80 shadow-xl text-[11px] overflow-hidden">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                className={`block w-full text-left px-2 py-1 hover:bg-[var(--bg)] ${
                  l.code === currentLang ? "text-[var(--brand)]" : "text-[var(--muted)]"
                }`}
                onClick={() => setLang(l.code)}
              >
                <span className="inline-flex items-center gap-2">
                  <span>{l.flag}</span>
                  <span>{l.label}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thème */}
      <button
        type="button"
        onClick={toggleTheme}
        className="rounded-full border border-[var(--border)] px-2 py-1 text-[12px] bg-[var(--bg-soft)]"
        aria-label="Changer le thème"
      >
        {theme === "light" ? "🌞" : "🌙"}
      </button>
    </div>
  );
}
