// components/layout/AppHeader.tsx
"use client";

import Link from "next/link";
import { ThemeLangSwitcher } from "@/components/ui/ThemeLangSwitcher";
import { useTranslation } from "react-i18next";

type AppHeaderProps = {
  userEmail?: string | null;
  onOpenSidebar?: () => void; // mobile
  onLogout?: () => void;
  sidebarOpen?: boolean;
};

export function AppHeader({
  userEmail,
  onOpenSidebar,
  onLogout,
  sidebarOpen = false,
}: AppHeaderProps) {
  const { t } = useTranslation("common");

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border)]/70 bg-[var(--bg)]/70 backdrop-blur">
      <div className="mx-auto max-w-6xl px-3 sm:px-4 py-3 flex items-center justify-between gap-3">
        {/* gauche : menu mobile + brand */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Ouvrir la navigation"
            onClick={onOpenSidebar}
            className="md:hidden rounded-full p-2 bg-[var(--bg-soft)] border border-[var(--border)]/80 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/60"
          >
            <div className={`menu-icon1 ${sidebarOpen ? "is-open" : ""}`}>
              <div className="menu-icon1_line-top" />
              <div className="menu-icon1_line-middle">
                <div className="menu-icon1_line-middle-inner" />
              </div>
              <div className="menu-icon1_line-bottom" />
            </div>
          </button>

          <Link href="/app" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-[var(--brand)]/10 border border-[var(--brand)]/40 flex items-center justify-center text-lg">
              ⚡
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-xs font-semibold">
                {t("header.title")}
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                {t("header.space", { defaultValue: "Espace candidat" })}
              </span>
            </div>
          </Link>
        </div>

        {/* droite : langues + thème + email + logout */}
        <div className="flex items-center gap-3">
          <ThemeLangSwitcher />

          {/* Email utilisateur */}
          {userEmail && (
            <span className="hidden sm:inline text-[11px] text-[var(--muted)]">
              {t("header.connected", { defaultValue: "Connecté·e :" })}{" "}
              <span className="font-medium text-[var(--ink)]">
                {userEmail}
              </span>
            </span>
          )}

          {/* Logout */}
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="text-[11px] rounded-full border border-[var(--border)] px-3 py-1 bg-[var(--bg-soft)] hover:border-red-500 hover:text-red-300 transition-colors"
            >
              {t("header.logout")}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
