"use client";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";

export function DebugI18nTheme() {
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang } = useI18n();

  return (
    <div style={{ position: "fixed", bottom: 12, left: 12, zIndex: 50, padding: 8, background: "rgba(0,0,0,0.6)", color: "white", borderRadius: 10, fontSize: 12 }}>
      <div>theme: {theme}</div>
      <div>lang: {lang}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <button onClick={toggleTheme}>toggle theme</button>
        <button onClick={() => setLang("fr")}>FR</button>
        <button onClick={() => setLang("en")}>EN</button>
      </div>
    </div>
  );
}
