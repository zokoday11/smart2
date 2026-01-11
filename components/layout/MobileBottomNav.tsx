// components/layout/MobileBottomNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";

type Item = {
  href: string;
  icon: string;
  key: string; // i18n key under nav.*
};

const items: Item[] = [
  { href: "/app", icon: "📄", key: "profile" },
  { href: "/app/lm", icon: "✨", key: "coverLetter" },
  { href: "/app/interview", icon: "🎤", key: "interview" },
  { href: "/app/tracker", icon: "📊", key: "tracker" },
  { href: "/app/credits", icon: "⚡", key: "credits" },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { t } = useTranslation("common");

  return (
    <nav
      className={[
        "md:hidden fixed bottom-0 left-0 right-0 z-50",
        "border-t border-[var(--border)]/70 bg-[var(--bg)]/95 backdrop-blur",
        "pb-[env(safe-area-inset-bottom)]",
      ].join(" ")}
      aria-label="Navigation principale"
    >
      <div className="mx-auto max-w-6xl px-2">
        <div className="h-16 grid grid-cols-5 gap-1">
          {items.map((it) => {
            const active =
              pathname === it.href || pathname.startsWith(it.href + "/");

            return (
              <Link
                key={it.href}
                href={it.href}
                className={[
                  "flex flex-col items-center justify-center rounded-xl",
                  "transition-colors border border-transparent",
                  active
                    ? "bg-[var(--bg-soft)] text-[var(--ink)] border-[var(--brand)]/40"
                    : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)]",
                ].join(" ")}
              >
                <span className="text-[18px] leading-none">{it.icon}</span>
                <span className="mt-1 text-[10px] leading-none">
                  {t(`nav.${it.key}`, { defaultValue: it.key })}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
