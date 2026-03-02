"use client";

import { useTheme } from "@/context/ThemeContext";
import { Moon, Sun } from "lucide-react";

export function ThemeLangSwitcher() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] text-[var(--ink)] hover:opacity-90 transition-all"
      aria-label="Changer le thème"
      title="Changer le thème"
    >
      {theme === "dark" ? (
        <>
          <Moon className="w-4 h-4" />
          <span className="text-xs font-medium">Sombre</span>
        </>
      ) : (
        <>
          <Sun className="w-4 h-4" />
          <span className="text-xs font-medium">Clair</span>
        </>
      )}
    </button>
  );
}
