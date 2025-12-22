"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type AppLink = {
  href: string;
  label: string;
  icon?: string;
};

// Liens principaux
const MAIN_LINKS: AppLink[] = [
  { href: "/app", label: "Profil CV IA", icon: "📄" },
  { href: "/app/lm", label: "Assistant candidature", icon: "✨" },
  { href: "/app/tracker", label: "Suivi candidatures", icon: "📊" },
  { href: "/app/interview", label: "Préparer entretien", icon: "🎤" },
  { href: "/app/apply", label: "Postuler", icon: "📨" },
  { href: "/app/history", label: "Historique IA", icon: "🕒" },
  { href: "/app/credits", label: "Crédits", icon: "⚡" },
];

const SETTINGS_LINK: AppLink = {
  href: "/app/settings",
  label: "Paramètres",
  icon: "⚙️",
};

export default function SidebarUser() {
  const pathname = usePathname();

  // Desktop collapse
  const [collapsed, setCollapsed] = useState(false);

  // Mobile sidebar
  const [mobileOpen, setMobileOpen] = useState(false);

  const baseItem =
    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-colors";

  const isLinkActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* === BOUTON HAMBURGER MOBILE === */}
      <button
        className="menu-icon1 md:hidden fixed top-3 left-3 z-50"
        onClick={() => setMobileOpen((o) => !o)}
      >
        <div className="menu-icon1_line-top"></div>
        <div className="menu-icon1_line-middle">
          <div className="menu-icon1_line-middle-inner"></div>
        </div>
        <div className="menu-icon1_line-bottom"></div>
      </button>

      {/* === OVERLAY MOBILE (clic pour fermer) === */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        ></div>
      )}

      {/* === SIDEBAR === */}
      <aside
        className={`
          bg-[var(--bg-soft)]
          border-r border-[var(--border)]/80
          h-screen
          flex flex-col
          sticky top-0
          z-50
          transition-all duration-300

          md:w-[210px] md:relative md:translate-x-0
          ${collapsed ? "md:w-[60px]" : "md:w-[210px]"}
          
          /* Mobile offcanvas */
          fixed top-0 left-0 w-[230px]
          md:static
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Header Desktop (bouton collapse) */}
        <div className="hidden md:flex items-center justify-start px-2 py-3 border-b border-[var(--border)]/70">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Déplier navigation" : "Replier navigation"}
            className="menu-icon1 inline-flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] text-[11px]"
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        {/* Mobile : petit espace en haut */}
        <div className="md:hidden h-[60px]"></div>

        {/* Liens */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-1 overflow-y-auto">
          {MAIN_LINKS.map((link) => {
            const active = isLinkActive(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)} // fermer sidebar mobile
                className={
                  active
                    ? `${baseItem} bg-[var(--bg)] text-[var(--ink)] border border-[var(--brand)]/60`
                    : `${baseItem} text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)]`
                }
              >
                <span className="w-5 text-center text-[12px]">
                  {link.icon ?? "•"}
                </span>
                {!collapsed && <span>{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Paramètres */}
        <div className="px-2 py-3 border-t border-[var(--border)]/70">
          <Link
            href={SETTINGS_LINK.href}
            onClick={() => setMobileOpen(false)}
            className={
              isLinkActive(SETTINGS_LINK.href)
                ? `${baseItem} bg-[var(--bg)] text-[var(--ink)] border border-[var(--brand)]/60`
                : `${baseItem} text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)]`
            }
          >
            <span className="w-5 text-center text-[12px]">
              {SETTINGS_LINK.icon}
            </span>
            {!collapsed && <span>{SETTINGS_LINK.label}</span>}
          </Link>
        </div>
      </aside>
    </>
  );
}
