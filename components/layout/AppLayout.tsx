"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";

const navLinks = [
  { href: "/app", label: "Profil CV IA", icon: "📄" },
  { href: "/app/lm", label: "Assistant candidature", icon: "✨" },
  { href: "/app/tracker", label: "Suivi candidatures", icon: "📊" },
  { href: "/app/interview", label: "Préparer entretien", icon: "🎤" },
  { href: "/app/apply", label: "Postuler", icon: "📨" },
  { href: "/app/history", label: "Historique IA", icon: "🕒" },
  { href: "/app/credits", label: "Crédits", icon: "⚡" },
];

export default function UserAppLayout({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ✅ flag pour être sûr qu'on est côté client
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    setClientReady(true);
  }, []);

  // ✅ Crédits utilisateur (Firestorm)
  const [credits, setCredits] = useState<number | null>(null);

  // 🔒 Protection des routes /app : login + email vérifié
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

  // 🛡 Surveillance du doc user : blocage + crédits
  useEffect(() => {
    if (!clientReady) return;
    if (!user) return;

    const ref = doc(db, "users", user.uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as any | undefined;

        // blocage
        if (data?.blocked) {
          logout()
            .catch((e) =>
              console.error("Erreur déconnexion après blocage :", e)
            )
            .finally(() => {
              router.replace("/login?blocked=1");
            });
          return;
        }

        // crédits
        if (typeof data?.credits === "number") {
          setCredits(data.credits);
        } else {
          setCredits(0);
        }
      },
      (err) => {
        console.error("Erreur surveillance utilisateur :", err);
      }
    );

    return () => {
      unsub();
    };
  }, [clientReady, user, logout, router]);

  // ferme le menu mobile au changement de page
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // ⚠️ Tant qu'on n'est pas prêt ou pas autorisé → on ne rend PAS le dashboard
  if (!clientReady || loading || !user || !user.emailVerified) {
    return null;
  }

  const handleLogout = async () => {
    try {
      await logout();
      router.replace("/login");
    } catch (e) {
      console.error("Erreur déconnexion :", e);
    }
  };

  const currentNav = navLinks.find(
    (link) =>
      pathname === link.href || pathname.startsWith(link.href + "/")
  );
  const pageTitle = currentNav?.label ?? "Espace candidat";

  const CreditsBadge =
    credits === null ? null : (
      <div className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] bg-[var(--bg-soft)] border border-[var(--border)]/80 text-[var(--ink)]">
        <span className="text-[13px]">⚡</span>
        <span>
          <span className="font-semibold">{credits}</span> crédits
        </span>
      </div>
    );

  return (
    <div className="min-h-screen flex bg-[var(--bg)] text-[var(--ink)]">
      {/* SIDEBAR DESKTOP */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-soft)]/60">
        <div className="flex items-center gap-2 px-3 py-4 border-b border-[var(--border)]/70">
          <Link href="/app" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-[var(--brand)]/10 border border-[var(--brand)]/40 flex items-center justify-center text-lg">
              ⚡
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold">
                Assistant Candidature IA
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                Espace candidat
              </span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-1 text-[13px] overflow-y-auto">
          {navLinks.map((link) => {
            const active =
              pathname === link.href ||
              pathname.startsWith(link.href + "/");
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
                <span className="w-5 text-center text-[13px]">
                  {link.icon}
                </span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--border)]/70 px-3 py-3 text-[11px] flex flex-col gap-2">
          {/* Badge crédits dans le bas de la sidebar */}
          {CreditsBadge}

          {user?.email && (
            <p className="text-[var(--muted)]">
              Connecté·e :{" "}
              <span className="font-medium text-[var(--ink)]">
                {user.email}
              </span>
            </p>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-[11px] rounded-full border border-[var(--border)] px-3 py-1.5 bg-[var(--bg)] hover:border-red-500 hover:text-red-300 transition-colors"
          >
            Se déconnecter
          </button>
        </div>
      </aside>

      {/* COLONNE CONTENU */}
      <div className="flex-1 flex flex-col relative">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(94,234,212,0.12),_transparent_55%)]" />

        {/* TOPBAR */}
        <header className="sticky top-0 z-30 border-b border-[var(--border)]/80 bg-[var(--bg)]/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-3 sm:px-6 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Ouvrir la navigation"
                onClick={() => setSidebarOpen(true)}
                className="md:hidden rounded-full p-2 bg-[var(--bg-soft)] border border-[var(--border)]/80 shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/60"
              >
                <div className={`menu-icon1 ${sidebarOpen ? "is-open" : ""}`}>
                  <div className="menu-icon1_line-top"></div>
                  <div className="menu-icon1_line-middle">
                    <div className="menu-icon1_line-middle-inner"></div>
                  </div>
                  <div className="menu-icon1_line-bottom"></div>
                </div>
              </button>

              <div className="flex flex-col">
                <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                  Tableau de bord
                </span>
                <span className="text-sm font-semibold">{pageTitle}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Badge crédits visible dans la topbar */}
              {CreditsBadge}

              {user?.email && (
                <span className="hidden sm:inline text-[11px] text-[var(--muted)]">
                  {user.email}
                </span>
              )}
              <button
                type="button"
                onClick={handleLogout}
                className="text-[11px] rounded-full border border-[var(--border)] px-3 py-1.5 bg-[var(--bg-soft)] hover:border-red-500 hover:text-red-300 transition-colors"
              >
                Se déconnecter
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="px-3 sm:px-6 lg:px-8 py-4 lg:py-6">
            <div className="max-w-6xl mx-auto space-y-4">{children}</div>
          </div>
        </main>
      </div>

      {/* MENU MOBILE (DRAWER) */}
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
          className={`absolute left-0 top-0 h-full w-64 bg-[var(--bg)] border-r border-[var(--border)] shadow-xl transform transition-transform ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border)]/80">
            <div className="flex items-center gap-2">
              <div className="menu-icon1">
                <div className="menu-icon1_line-top"></div>
                <div className="menu-icon1_line-middle">
                  <div className="menu-icon1_line-middle-inner"></div>
                </div>
                <div className="menu-icon1_line-bottom"></div>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-semibold">Menu</span>
                <span className="text-[10px] text-[var(--muted)]">
                  Navigation
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

          <nav className="px-2 py-3 flex flex-col gap-1 text-[13px] overflow-y-auto">
            {navLinks.map((link) => {
              const active =
                pathname === link.href ||
                pathname.startsWith(link.href + "/");
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
                  <span className="w-5 text-center text-[13px]">
                    {link.icon}
                  </span>
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-[var(--border)]/70 px-3 py-3 text-[11px] space-y-2">
            {/* Badge crédits aussi dans le menu mobile */}
            {CreditsBadge}

            {user?.email && (
              <p className="mb-1 text-[var(--muted)]">
                Connecté·e :{" "}
                <span className="font-medium text-[var(--ink)]">
                  {user.email}
                </span>
              </p>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full text-[11px] rounded-full border border-[var(--border)] px-3 py-1.5 bg-[var(--bg)] hover:border-red-500 hover:text-red-300 transition-colors"
            >
              Se déconnecter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
