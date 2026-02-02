// components/I18nClientProvider.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import i18n, { APP_LANG_KEY, SUPPORTED_LANGS, getInitialClientLang } from "@/lib/i18n";

function applyHtmlLangDir(lng: string) {
  const html = document.documentElement;

  const base = (lng || "fr").toLowerCase().split("-")[0];
  html.setAttribute("lang", base);

  const isRTL = base.startsWith("ar");
  html.setAttribute("dir", isRTL ? "rtl" : "ltr");
}

export default function I18nClientProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      const target = getInitialClientLang();

      // sécurité
      const safe =
        (SUPPORTED_LANGS as readonly string[]).includes(target) ? target : "fr";

      // stocke si pas déjà (ça stabilise le refresh)
      try {
        localStorage.setItem(APP_LANG_KEY, safe);
      } catch {}

      // change language (attendre => pas de mismatch)
      try {
        await i18n.changeLanguage(safe);
      } catch {}

      applyHtmlLangDir(safe);

      if (mounted) setReady(true);
    };

    run();

    return () => {
      mounted = false;
    };
  }, []);

  // ✅ Gate : empêche tout SSR/hydration mismatch lié à la langue
  if (!ready) return null;

  return <>{children}</>;
}
