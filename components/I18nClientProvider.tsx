// components/I18nClientProvider.tsx
"use client";

import "@/lib/i18n"; // initialise i18n une fois
import { ReactNode, useEffect } from "react";
import i18n from "@/lib/i18n";

export default function I18nClientProvider({ children }: { children: ReactNode }) {
  // Optionnel : mettre <html lang> et RTL
  useEffect(() => {
    const apply = (lng: string) => {
      document.documentElement.lang = lng;
      document.documentElement.dir = lng === "ar" ? "rtl" : "ltr";
    };

    apply(i18n.language);
    i18n.on("languageChanged", apply);
    return () => {
      i18n.off("languageChanged", apply);
    };
  }, []);

  return <>{children}</>;
}
