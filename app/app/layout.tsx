// app/app/layout.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";

import { AppHeader } from "@/components/layout/AppHeader";
import { MobileBottomNav } from "../../components/layout/MobileBottomNav";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { useUserCredits } from "@/hooks/useUserCredits";
import { useTranslation } from "react-i18next";

const navLinks = [
  { href: "/app", key: "profile", icon: "📄" },
  { href: "/app/lm", key: "coverLetter", icon: "✨" },
  { href: "/app/tracker", key: "tracker", icon: "📊" },
  { href: "/app/interview", key: "interview", icon: "🎤" },
  { href: "/app/apply", key: "apply", icon: "📨" },
  { href: "/app/history", key: "history", icon: "🕒" },
  { href: "/app/credits", key: "credits", icon: "⚡" },
] as const;

export default function UserAppLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation("common");

  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [clientReady, setClientReady] = useState(false);
  useEffect(() => setClientReady(true), []);

  const { credits, loading: creditsLoading } = useUserCredits();

  // 🔒 Protection /app
  useEffect(() => {
    if (!clientReady) return;
    if (loading) return;

    if (!user) {
      router.replace("/login");
      return;
    }
    if (!user.emailVerified) {
      router.replace("/auth/verify-email");
      return;
    }
  }, [clientReady, user, loading, router]);

  // 🛡 blocked user
  useEffect(() => {
    if (!clientReady) return;
    if (!user) return;

    const ref = doc(db, "users", user.uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as any | undefined;
        if (data?.blocked) {
          logout()
            .catch((e) => console.error("Erreur déconnexion après blocage :", e))
            .finally(() => router.replace("/login?blocked=1"));
        }
      },
      (err) => console.error("Erreur surveillance blocage utilisateur :", err)
    );

    return () => unsub();
  }, [clientReady, user, logout, router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  if (!clientReady || loading || !user || !user.emailVerified) return null;

  const handleLogout = async () => {
    try {
      await logout();
      router.replace("/login");
    } catch (e) {
      console.error("Erreur déconnexion :", e);
    }
  };

  const currentNav = navLinks.find(
    (link) => pathname === link.href || pathname.startsWith(link.href + "/")
  );
  const pageTitle = currentNav ? t(`nav.${currentNav.key}`) : t("dashboard.title");

  const CreditsBadge =
    creditsLoading || credits === undefined || credits === null ? (
      <div className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--muted)]">
        <span className="text-[13px]">⚡</span>
        <span>{t("common.loading", { defaultValue: "Chargement…" })}</span>
      </div>
    ) : (
      <div className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--ink)]">
        <span className="text-[13px]">⚡</span>
        <span>
          <span className="font-semibold">{credits}</span>{" "}
          {t("dashboard.creditsLabel", { defaultValue: "crédits" })}
        </span>
      </div>
    );

  return (
    // ✅ page bloquée, scroll uniquement dans main
    <div className="h-[100dvh] overflow-hidden flex bg-[var(--bg)] text-[var(--ink)]">
      {/* SIDEBAR DESKTOP */}
      <aside className="hidden md:flex w-60 shrink-0 h-full overflow-hidden flex-col border-r border-[var(--border)] bg-[var(--bg-soft)]/60">
        <div className="flex items-center gap-2 px-3 py-4 border-b border-[var(--border)]/70">
          <Link href="/app" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-[var(--brand)]/10 border border-[var(--brand)]/40 flex items-center justify-center text-lg">
              ⚡
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold">
                {t("header.title", { defaultValue: "Assistant Candidatures IA" })}
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                {t("header.space", { defaultValue: "Espace candidat" })}
              </span>
            </div>
          </Link>
        </div>

        {/* ✅ scroll uniquement sur la nav */}
        <nav className="min-h-0 flex-1 px-2 py-3 space-y-1 text-[13px] overflow-y-auto">
          {navLinks.map((link) => {
            const active = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                className={[
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors border border-transparent",
                  active
                    ? "bg-[var(--bg)] text-[var(--ink)] border-[var(--brand)]/60"
                    : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)]",
                ].join(" ")}
              >
                <span className="w-5 text-center text-[13px]">{link.icon}</span>
                <span>{t(`nav.${link.key}`, { defaultValue: link.key })}</span>
              </Link>
            );
          })}
        </nav>

        {/* ✅ footer collé en bas */}
        <div className="mt-auto border-t border-[var(--border)]/70 px-3 py-3 text-[11px] flex flex-col gap-2">
          {CreditsBadge}

          {user?.email && (
            <p className="text-[var(--muted)]">
              {t("header.connected", { defaultValue: "Connecté·e :" })}{" "}
              <span className="font-medium text-[var(--ink)]">{user.email}</span>
            </p>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-[11px] rounded-full border border-[var(--border)] px-3 py-1.5 bg-[var(--bg)] hover:border-red-500 hover:text-red-300 transition-colors"
          >
            {t("header.logout", { defaultValue: "Se déconnecter" })}
          </button>
        </div>
      </aside>

      {/* COLONNE CONTENU */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(94,234,212,0.12),_transparent_55%)]" />

        <AppHeader
          userEmail={user.email}
          onOpenSidebar={() => setSidebarOpen(true)}
          onLogout={handleLogout}
          sidebarOpen={sidebarOpen}
        />

        {/* ✅ main scrolle, et padding bottom pour la bottom nav mobile */}
        <main className="flex-1 min-h-0 overflow-y-auto pb-24 md:pb-0">
          <div className="px-3 sm:px-6 lg:px-8 py-4 lg:py-6">
            <div className="max-w-6xl mx-auto space-y-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex flex-col">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    {t("dashboard.title", { defaultValue: "Tableau de bord" })}
                  </span>
                  <span className="text-sm font-semibold">{pageTitle}</span>
                </div>
                <div className="flex items-center gap-2">{CreditsBadge}</div>
              </div>

              {children}
            </div>
          </div>
        </main>

        {/* ✅ bottom nav mobile */}
        <MobileBottomNav />
      </div>

      {/* DRAWER MOBILE */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition ${
          sidebarOpen ? "pointer-events-auto" : "pointer-events-none"
        }`}
      >
        <div
          className={`absolute inset-0 bg-black/50 transition-opacity ${
            sidebarOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={() => setSidebarOpen(false)}
        />

        <div
          className={`absolute left-0 top-0 h-full w-72 bg-[var(--bg)] border-r border-[var(--border)] shadow-xl transform transition-transform flex flex-col overflow-hidden ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border)]/80">
            <div className="flex items-center gap-2">
              <div className="menu-icon1">
                <div className="menu-icon1_line-top" />
                <div className="menu-icon1_line-middle">
                  <div className="menu-icon1_line-middle-inner" />
                </div>
                <div className="menu-icon1_line-bottom" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold">
                  {t("common.menu", { defaultValue: "Menu" })}
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  {t("common.navigation", { defaultValue: "Navigation" })}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="text-[11px] rounded-full border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-soft)]"
            >
              ✕
            </button>
          </div>

          <nav className="min-h-0 flex-1 px-2 py-3 flex flex-col gap-1 text-[13px] overflow-y-auto">
            {navLinks.map((link) => {
              const active = pathname === link.href || pathname.startsWith(link.href + "/");
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={[
                    "flex items-center gap-2 rounded-lg px-2 py-2 transition-colors border border-transparent",
                    active
                      ? "bg-[var(--bg-soft)] text-[var(--ink)] border-[var(--brand)]/40"
                      : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)]",
                  ].join(" ")}
                >
                  <span className="w-6 text-center text-[16px]">{link.icon}</span>
                  <span>{t(`nav.${link.key}`, { defaultValue: link.key })}</span>
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto border-t border-[var(--border)]/70 px-3 py-3 text-[11px] space-y-2">
            {CreditsBadge}

            {user?.email && (
              <p className="mb-1 text-[var(--muted)]">
                {t("header.connected", { defaultValue: "Connecté·e :" })}{" "}
                <span className="font-medium text-[var(--ink)]">{user.email}</span>
              </p>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-[11px] rounded-full border border-[var(--border)] px-3 py-1.5 bg-[var(--bg)] hover:border-red-500 hover:text-red-300 transition-colors"
            >
              {t("header.logout", { defaultValue: "Se déconnecter" })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
