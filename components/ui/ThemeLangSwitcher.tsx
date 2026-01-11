// components/ui/ThemeLangSwitcher.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";

type Lang = "fr" | "en";

const LANGS: { code: Lang; label: string }[] = [
  { code: "fr", label: "FR" },
  { code: "en", label: "EN" },
];

export function ThemeLangSwitcher() {
  const { theme, toggleTheme } = useTheme();
  useTranslation(); // force le re-render quand la langue change
  const [open, setOpen] = useState(false);

  const currentLang = useMemo<Lang>(() => {
    const lng = (i18n.resolvedLanguage || i18n.language || "fr")
      .toLowerCase()
      .slice(0, 2);
    return (lng === "en" ? "en" : "fr") as Lang;
  }, [i18n.resolvedLanguage, i18n.language]);

  // ferme le menu si on clique ailleurs
  useEffect(() => {
    const onClick = () => setOpen(false);
    if (!open) return;
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  const setLang = (lng: Lang) => {
    i18n.changeLanguage(lng);
    setOpen(false);
  };

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
          🌐 <span>{currentLang.toUpperCase()}</span>
        </button>

        {open && (
          <div className="absolute right-0 mt-1 w-20 rounded-xl bg-[var(--bg-soft)] border border-[var(--border)]/80 shadow-xl text-[11px] overflow-hidden">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                className={`block w-full text-left px-2 py-1 hover:bg-[var(--bg)] ${
                  l.code === currentLang
                    ? "text-[var(--brand)]"
                    : "text-[var(--muted)]"
                }`}
                onClick={() => setLang(l.code)}
              >
                {l.label}
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
