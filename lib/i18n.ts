// lib/i18n.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Ces imports ne doivent tourner que côté client (SSR safe)
const isClient = typeof window !== "undefined";

export const APP_LANG_KEY = "app_lang_v1";

// ✅ “Top langues” + celles que tu veux absolument (DE/IT)
// (on garde un set cohérent pour ton switcher)
export const SUPPORTED_LANGS = [
  "fr",
  "en",
  "es",
  "de",
  "it",
  "pt",
  "ru",
  "zh",
  "ar",
  "hi",
  "bn",
  "ur",
] as const;

export type AppLang = (typeof SUPPORTED_LANGS)[number];

// Namespaces
export const NAMESPACES = ["common", "landing", "app", "auth", "errors"] as const;

function normalizeToSupported(lngRaw?: string | null): AppLang {
  const raw = (lngRaw || "").trim().toLowerCase();
  if (!raw) return "fr";

  // Ex: "en-US" -> "en"
  const base = raw.split("-")[0];

  // map rapide
  if (base === "zh") return "zh";
  if (base === "pt") return "pt";
  if (base === "fr") return "fr";
  if (base === "en") return "en";
  if (base === "es") return "es";
  if (base === "de") return "de";
  if (base === "it") return "it";
  if (base === "ru") return "ru";
  if (base === "ar") return "ar";
  if (base === "hi") return "hi";
  if (base === "bn") return "bn";
  if (base === "ur") return "ur";

  return "fr";
}

export function getInitialClientLang(): AppLang {
  if (!isClient) return "fr";

  const saved = window.localStorage.getItem(APP_LANG_KEY);
  if (saved) return normalizeToSupported(saved);

  const nav = window.navigator?.language || "fr";
  return normalizeToSupported(nav);
}

// Init i18n (client)
async function initI18nClient() {
  const HttpBackend = (await import("i18next-http-backend")).default;
  const LanguageDetector = (await import("i18next-browser-languagedetector"))
    .default;

  if (i18n.isInitialized) return;

  await i18n
    .use(HttpBackend)
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      supportedLngs: [...SUPPORTED_LANGS],
      fallbackLng: "fr",

      ns: [...NAMESPACES],
      defaultNS: "common",

      debug: false,

      interpolation: { escapeValue: false },

      react: {
        useSuspense: false,
      },

      detection: {
        order: ["localStorage", "navigator", "htmlTag"],
        lookupLocalStorage: APP_LANG_KEY,
        caches: ["localStorage"],
      },

      backend: {
        loadPath: "/locales/{{lng}}/{{ns}}.json",
      },
    });
}

// Init minimal (server safe) : on ne fait rien.
// (Ton gate empêche le rendu SSR des textes traduits => pas de mismatch)
function initI18nServerSafe() {
  if (i18n.isInitialized) return;
  i18n.use(initReactI18next).init({
    lng: "fr",
    fallbackLng: "fr",
    ns: [...NAMESPACES],
    defaultNS: "common",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    resources: {}, // vide côté server
  });
}

if (isClient) {
  // fire-and-forget, le Provider gate attend i18n.changeLanguage()
  initI18nClient().catch(() => {});
} else {
  initI18nServerSafe();
}

export default i18n;
