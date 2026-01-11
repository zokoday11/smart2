// context/I18nContext.tsx
"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type LangCode = "fr" | "en" | "ar" | "zh";

type I18nContextValue = {
  lang: LangCode;
  setLang: (lang: LangCode) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const LANG_KEY = "acv-lang";

const translations: Record<LangCode, Record<string, string>> = {
  fr: {
    appTitle: "Assistant Candidatures V4",
    heroTitle:
      "L'assistant IA pour candidater comme un pro, sans y passer tes soirées.",
    heroSubtitle:
      "Importe ton CV, colle une offre d’emploi, laisse l’IA générer une lettre ciblée, un pitch oral et suis toutes tes candidatures depuis un tableau de bord unique.",
    startFree: "Essayer gratuitement",
    alreadyHaveAccount: "J'ai déjà un compte",
    logout: "Se déconnecter",
    creditsShort: "Cr.",
  },
  en: {
    appTitle: "Job Application Assistant V4",
    heroTitle:
      "The AI assistant to apply like a pro, without spending your evenings on it.",
    heroSubtitle:
      "Upload your resume, paste a job offer, let the AI generate a tailored cover letter, an interview pitch and track all your applications from one dashboard.",
    startFree: "Start for free",
    alreadyHaveAccount: "I already have an account",
    logout: "Logout",
    creditsShort: "Cr.",
  },
  ar: {
    appTitle: "مساعد التقديم على الوظائف V4",
    heroTitle:
      "مساعدك بالذكاء الاصطناعي للتقديم باحتراف، بدون أن تضيع أمسياتك.",
    heroSubtitle:
      "ارفع سيرتك الذاتية، والصق عرض العمل، ودع الذكاء الاصطناعي يُنشئ رسالة تحفيز موجهة، و«بيتش» للمقابلة، مع تتبع لجميع طلباتك في لوحة تحكم واحدة.",
    startFree: "ابدأ مجانًا",
    alreadyHaveAccount: "لدي حساب بالفعل",
    logout: "تسجيل الخروج",
    creditsShort: "رصيد",
  },
  zh: {
    appTitle: "AI 求职助手 V4",
    heroTitle: "用 AI 像专业人士一样投递，而不用熬夜写材料。",
    heroSubtitle:
      "上传简历、粘贴职位描述，AI 为你生成定制求职信和自我介绍，并在一个看板里跟踪所有投递。",
    startFree: "免费开始",
    alreadyHaveAccount: "我已有账号",
    logout: "退出登录",
    creditsShort: "点数",
  },
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [lang, setLangState] = useState<LangCode>("fr");

  useEffect(() => {
    const stored = localStorage.getItem(LANG_KEY) as LangCode | null;
    if (stored && translations[stored]) {
      setLangState(stored);
      document.documentElement.dir = stored === "ar" ? "rtl" : "ltr";
    }
  }, []);

  const setLang = (next: LangCode) => {
    setLangState(next);
    localStorage.setItem(LANG_KEY, next);
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
  };

  const t = (key: string) => {
    return translations[lang]?.[key] ?? key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return ctx;
};
