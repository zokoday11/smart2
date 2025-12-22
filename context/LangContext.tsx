"use client";

import { createContext, useContext, useEffect, useState } from "react";

type LangCode =
  | "fr"
  | "en"
  | "es"
  | "de"
  | "pt"
  | "it"
  | "ru"
  | "zh"
  | "ar"
  | "ja";

type LangContextValue = {
  lang: LangCode;
  setLang: (l: LangCode) => void;
};

const LangContext = createContext<LangContextValue | undefined>(undefined);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>("fr");

  useEffect(() => {
    // 1) récupérer la langue du localStorage si dispo
    const stored = typeof window !== "undefined"
      ? (localStorage.getItem("lang") as LangCode | null)
      : null;
    if (stored) {
      setLangState(stored);
      return;
    }

    // 2) sinon essayer de détecter la langue du navigateur
    if (typeof window !== "undefined") {
      const navLang = window.navigator.language.slice(0, 2).toLowerCase();
      const supported: LangCode[] = [
        "fr",
        "en",
        "es",
        "de",
        "pt",
        "it",
        "ru",
        "zh",
        "ar",
        "ja",
      ];
      if (supported.includes(navLang as LangCode)) {
        setLangState(navLang as LangCode);
        localStorage.setItem("lang", navLang);
      }
    }
  }, []);

  const setLang = (l: LangCode) => {
    setLangState(l);
    if (typeof window !== "undefined") {
      localStorage.setItem("lang", l);
    }
  };

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) {
    throw new Error("useLang must be used inside LangProvider");
  }
  return ctx;
}
