// lib/i18n.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import common_fr from "@/public/locales/fr/common.json";
import common_en from "@/public/locales/en/common.json";

const supportedLngs = ["fr", "en"] as const;

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector) // détecte langue du navigateur + cache
    .use(initReactI18next)
    .init({
      resources: {
        fr: { common: common_fr },
        en: { common: common_en },
      },
      supportedLngs: [...supportedLngs],
      fallbackLng: "fr",

      defaultNS: "common",
      ns: ["common"],

      interpolation: { escapeValue: false },

      detection: {
        // ordre simple et fiable
        order: ["localStorage", "cookie", "navigator", "htmlTag"],
        caches: ["localStorage", "cookie"],
        lookupLocalStorage: "i18nextLng"
      },

      react: { useSuspense: false }
    });
}

export default i18n;
