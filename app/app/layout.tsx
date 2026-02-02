"use client";

import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { AnimatePresence, motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Target,
  Mic,
  History,
  Zap,
  Settings,
  LogOut,
  ChevronRight,
  Moon,
  Sun,
  Check,
  X,
  Wand2,
  GraduationCap,
  Menu,
  Search,
  Command,
  Bell,
  Globe,
  Briefcase,
  ExternalLink,
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { db, auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";

/**
 * ✅ AMÉLIORATIONS:
 * - Mode Jour/Nuit robuste (class + localStorage + meta theme-color)
 * - Barre de recherche dispo mobile (bouton + overlay)
 * - Langues étendues + menu propre (FR/EN/ES/DE/IT/PT)
 * - Notifications “réelles” côté UI (badge + panel) avec contenu basé sur candidatures
 * - Nav responsive + accessibilité + fermeture via ESC + click outside
 */

// --- CONFIG NAV ---
const NAV_LINKS = [
  { href: "/app", key: "profile", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/app/lm", key: "assistant", label: "Assistant Candidature", icon: Wand2 },
  { href: "/app/tracker", key: "tracker", label: "Suivi Job", icon: Target },
  { href: "/app/interview", key: "interview", label: "Interview IA", icon: Mic },
  { href: "/app/cv", key: "quiz", label: "Quiz & Tests", icon: GraduationCap },
  { href: "/app/history", key: "history", label: "Historique", icon: History },
  { href: "/app/credits", key: "credits", label: "Crédits & Plan", icon: Zap },
] as const;

type AppLang = "fr" | "en" | "es" | "de" | "it" | "pt";

const LANGUAGES: Array<{ code: AppLang; label: string; flag: string }> = [
  { code: "fr", label: "Français", flag: "🇫🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
  { code: "de", label: "Deutsch", flag: "🇩🇪" },
  { code: "it", label: "Italiano", flag: "🇮🇹" },
  { code: "pt", label: "Português", flag: "🇵🇹" },
];

// --- TYPES ---
type ApplicationLite = {
  id: string;
  company?: string;
  jobTitle?: string;
  status?: string;
  jobLink?: string;
  interviewAt?: any;
  createdAt?: any;
};

// --- THEME HELPERS ---
type ThemeMode = "dark" | "light";
const THEME_KEY = "theme_mode_v1";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "dark") root.classList.add("dark");
  else root.classList.remove("dark");

  // optionnel: meta theme-color (mobile chrome)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", mode === "dark" ? "#0A0A0B" : "#F8FAFC");
}

function detectInitialTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(THEME_KEY) as ThemeMode | null;
  if (saved === "dark" || saved === "light") return saved;
  const isSystemDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;
  return isSystemDark ? "dark" : "light";
}

// --- DATE HELPERS ---
function safeToDate(v: any): Date | null {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === "function") return v.toDate();
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

function fmtDateTime(d?: Date | null) {
  if (!d) return "";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// --- APP HEADER ---
interface AppHeaderProps {
  title: string;
  credits: number | null;
  user: any;
  applications: ApplicationLite[];
  onToggleSidebar: () => void;
  handleLogout: () => void;
}

function AppHeader({
  title,
  credits,
  user,
  applications,
  onToggleSidebar,
  handleLogout,
}: AppHeaderProps) {
  const { i18n } = useTranslation();
  const router = useRouter();

  // Theme
  const [theme, setTheme] = useState<ThemeMode>("dark");

  // Menus
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpenDesktop, setSearchOpenDesktop] = useState(false);
  const [searchOpenMobile, setSearchOpenMobile] = useState(false);

  // Refs
  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Init theme
  useEffect(() => {
    const initial = detectInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  };

  const changeLang = (code: AppLang) => {
    i18n.changeLanguage(code);
    setShowLangMenu(false);
  };

  // Close on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (langRef.current && !langRef.current.contains(t)) setShowLangMenu(false);
      if (userRef.current && !userRef.current.contains(t)) setShowUserMenu(false);
      if (notifRef.current && !notifRef.current.contains(t)) setShowNotifs(false);
      if (searchRef.current && !searchRef.current.contains(t)) setSearchOpenDesktop(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowLangMenu(false);
        setShowUserMenu(false);
        setShowNotifs(false);
        setSearchOpenDesktop(false);
        setSearchOpenMobile(false);
      }
      // Ctrl/Cmd+K => open search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpenDesktop(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 🔍 Mixed search (pages + apps)
  const q = searchQuery.trim().toLowerCase();

  const filteredPages = useMemo(() => {
    if (!q) return [];
    return NAV_LINKS.filter((l) => l.label.toLowerCase().includes(q)).slice(0, 6);
  }, [q]);

  const filteredApps = useMemo(() => {
    if (!q) return [];
    return applications
      .filter((app) => {
        const a = (app.company || "").toLowerCase();
        const b = (app.jobTitle || "").toLowerCase();
        return a.includes(q) || b.includes(q);
      })
      .slice(0, 6);
  }, [q, applications]);

  // 🔔 Notifications (simple + utile)
  const now = Date.now();
  const upcomingInterviews = useMemo(() => {
    return applications
      .map((a) => ({ ...a, interviewDate: safeToDate((a as any).interviewAt) }))
      .filter((a) => a.interviewDate && a.interviewDate.getTime() > now)
      .sort((a, b) => a.interviewDate!.getTime() - b.interviewDate!.getTime())
      .slice(0, 5);
  }, [applications, now]);

  const notifs = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      desc?: string;
      href?: string;
      icon: React.ReactNode;
      tone: "info" | "warn";
    }> = [];

    for (const it of upcomingInterviews) {
      items.push({
        id: `interview-${it.id}`,
        title: `Entretien à venir : ${it.company || "Entreprise"}`,
        desc: `${it.jobTitle || "Poste"} • ${fmtDateTime(it.interviewDate)}`,
        href: "/app/tracker",
        icon: <Bell className="h-4 w-4" />,
        tone: "warn",
      });
    }

    // Suggestion / reminder
    items.push({
      id: "tip-1",
      title: "Astuce : optimise ton CV pour une offre",
      desc: "Dans Assistant candidature → colle l’offre → Téléchargement optimisé IA.",
      href: "/app/lm",
      icon: <Wand2 className="h-4 w-4" />,
      tone: "info",
    });

    return items.slice(0, 6);
  }, [upcomingInterviews]);

  const notifCount = notifs.length;

  const SearchResults = ({ onPick }: { onPick: () => void }) => (
    <div className="bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
      {(filteredPages.length > 0 || filteredApps.length > 0) ? (
        <div className="divide-y divide-[var(--border)]/70">
          {filteredPages.length > 0 && (
            <div className="p-2">
              <p className="px-2 py-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                Navigation
              </p>
              {filteredPages.map((link) => (
                <button
                  key={link.key}
                  onClick={() => {
                    router.push(link.href);
                    onPick();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-xs text-[var(--ink)]/90 hover:bg-[var(--bg-soft)] rounded-lg transition-colors text-left"
                >
                  <link.icon className="h-4 w-4 text-[var(--muted)]" />
                  <span className="truncate">{link.label}</span>
                </button>
              ))}
            </div>
          )}

          {filteredApps.length > 0 && (
            <div className="p-2">
              <p className="px-2 py-1 text-[10px] font-bold text-[var(--muted)] uppercase tracking-wider">
                Mes candidatures
              </p>
              {filteredApps.map((app) => (
                <button
                  key={app.id}
                  onClick={() => {
                    router.push("/app/tracker");
                    onPick();
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 text-xs hover:bg-[var(--bg-soft)] rounded-lg transition-colors text-left group"
                >
                  <Briefcase className="h-4 w-4 text-blue-500" />
                  <div className="min-w-0">
                    <div className="truncate">
                      <span className="text-[var(--ink)] font-medium">{app.jobTitle || "Poste"}</span>
                      <span className="text-[var(--muted)] mx-1">chez</span>
                      <span className="text-blue-400 group-hover:underline">{app.company || "Entreprise"}</span>
                    </div>
                    {app.jobLink ? (
                      <div className="text-[10px] text-[var(--muted)] flex items-center gap-1 mt-0.5">
                        <ExternalLink className="h-3 w-3" />
                        Lien offre
                      </div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="p-4 text-center text-xs text-[var(--muted)]">
          Aucun résultat pour &quot;{searchQuery}&quot;
        </div>
      )}
    </div>
  );

  // CSS vars for both themes (keeps your page standalone)
  // You can move this to globals later.
  const ThemeVars = (
    <style jsx global>{`
      :root {
        --bg: #0a0a0b;
        --bg-soft: rgba(255, 255, 255, 0.05);
        --panel: #16181d;
        --ink: #e5e7eb;
        --muted: rgba(148, 163, 184, 0.9);
        --border: rgba(255, 255, 255, 0.08);
        --brand: #3b82f6;
      }
      :root:not(.dark) {
        --bg: #f8fafc;
        --bg-soft: rgba(15, 23, 42, 0.04);
        --panel: #ffffff;
        --ink: #0f172a;
        --muted: rgba(71, 85, 105, 0.85);
        --border: rgba(15, 23, 42, 0.10);
        --brand: #2563eb;
      }
      .custom-scrollbar::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.25);
        border-radius: 999px;
      }
      .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent;
      }
    `}</style>
  );

  return (
    <>
      {ThemeVars}

      <header className="sticky top-0 z-30 w-full border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-xl transition-all">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* LEFT */}
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleSidebar}
              className="md:hidden -ml-2 p-2 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
              aria-label="Ouvrir le menu"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex flex-col">
              <h1 className="text-sm font-semibold text-[var(--ink)] tracking-tight truncate max-w-[45vw] sm:max-w-none">
                {title}
              </h1>
              <span className="text-[10px] text-[var(--muted)] hidden sm:block">
                {user?.email}
              </span>
            </div>
          </div>

          {/* CENTER (Desktop search) */}
          <div className="hidden md:flex items-center justify-center flex-1 max-w-md mx-4 relative" ref={searchRef}>
            <div
              className={[
                "w-full flex items-center justify-between px-3 py-1.5 rounded-lg border bg-[var(--bg-soft)] text-xs transition-all",
                searchOpenDesktop ? "border-[var(--brand)]/50 ring-2 ring-[var(--brand)]/10" : "border-[var(--border)] hover:border-[var(--border)]/80",
              ].join(" ")}
            >
              <div className="flex items-center gap-2 flex-1">
                <Search className="h-3.5 w-3.5 text-[var(--muted)]" />
                <input
                  className="bg-transparent border-none outline-none text-[var(--ink)] w-full placeholder:text-[var(--muted)] h-full py-1"
                  placeholder="Rechercher (pages + candidatures)…"
                  value={searchQuery}
                  onFocus={() => setSearchOpenDesktop(true)}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {!searchOpenDesktop && (
                <div className="flex items-center gap-1 opacity-60 bg-[var(--bg-soft)] px-1.5 rounded text-[10px] border border-[var(--border)]">
                  <Command className="h-3 w-3" />
                  <span>K</span>
                </div>
              )}
            </div>

            <AnimatePresence>
              {searchOpenDesktop && searchQuery.trim() && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute top-full left-0 right-0 mt-2 z-50"
                >
                  <SearchResults onPick={() => setSearchOpenDesktop(false)} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Mobile search button */}
            <button
              onClick={() => setSearchOpenMobile(true)}
              className="md:hidden p-2 rounded-full text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
              aria-label="Rechercher"
            >
              <Search className="h-4 w-4" />
            </button>

            {/* Language */}
            <div className="relative hidden sm:block" ref={langRef}>
              <button
                onClick={() => setShowLangMenu((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
                aria-label="Changer la langue"
              >
                <Globe className="h-4 w-4" />
                <span className="uppercase">{(i18n.language || "fr").slice(0, 2)}</span>
              </button>

              <AnimatePresence>
                {showLangMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: 6 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: 6 }}
                    className="absolute right-0 top-full mt-2 w-44 bg-[var(--panel)] border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden"
                  >
                    <div className="p-1">
                      {LANGUAGES.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => changeLang(lang.code)}
                          className={[
                            "w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors",
                            i18n.language === lang.code
                              ? "bg-[var(--brand)]/10 text-[var(--brand)]"
                              : "text-[var(--ink)]/90 hover:bg-[var(--bg-soft)]",
                          ].join(" ")}
                        >
                          <span className="flex items-center gap-2">
                            <span>{lang.flag}</span>
                            <span>{lang.label}</span>
                          </span>
                          {i18n.language === lang.code && <Check className="h-3.5 w-3.5" />}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Theme */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full text-[var(--muted)] hover:text-[var(--brand)] hover:bg-[var(--bg-soft)] transition-colors"
              aria-label="Basculer le thème"
            >
              {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setShowNotifs((v) => !v)}
                className="relative p-2 rounded-full text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
                aria-label="Notifications"
              >
                <Bell className="h-4 w-4" />
                {notifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] leading-[16px] text-center border border-[var(--bg)]">
                    {Math.min(9, notifCount)}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {showNotifs && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    className="absolute right-0 top-full mt-2 w-[320px] max-w-[85vw] rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden z-50"
                  >
                    <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
                      <p className="text-xs font-bold text-[var(--ink)] uppercase tracking-wider">
                        Notifications
                      </p>
                      <button
                        onClick={() => setShowNotifs(false)}
                        className="p-1 rounded-lg hover:bg-[var(--bg-soft)] text-[var(--muted)] hover:text-[var(--ink)]"
                        aria-label="Fermer"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="max-h-[360px] overflow-auto custom-scrollbar">
                      {notifs.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => {
                            if (n.href) router.push(n.href);
                            setShowNotifs(false);
                          }}
                          className="w-full text-left p-3 hover:bg-[var(--bg-soft)] transition-colors border-b border-[var(--border)] last:border-b-0"
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className={[
                                "mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center border",
                                n.tone === "warn"
                                  ? "bg-amber-500/10 border-amber-500/20 text-amber-500"
                                  : "bg-[var(--brand)]/10 border-[var(--brand)]/20 text-[var(--brand)]",
                              ].join(" ")}
                            >
                              {n.icon}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-[var(--ink)] truncate">
                                {n.title}
                              </p>
                              {n.desc ? (
                                <p className="text-[11px] text-[var(--muted)] mt-0.5 line-clamp-2">
                                  {n.desc}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      ))}
                      {notifs.length === 0 && (
                        <div className="p-4 text-center text-xs text-[var(--muted)]">
                          Rien à signaler.
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Credits */}
            <Link
              href="/app/credits"
              className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--brand)]/10 border border-[var(--brand)]/20 text-[var(--brand)] text-xs font-medium whitespace-nowrap hover:bg-[var(--brand)]/15 transition-colors"
            >
              <Zap className="h-3.5 w-3.5 fill-current" />
              <span>{credits ?? "..."}</span>
            </Link>

            {/* User */}
            <div className="relative" ref={userRef}>
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center gap-2 p-1 pl-2 pr-1 rounded-full border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--bg-soft)] transition-all outline-none"
                aria-label="Menu utilisateur"
              >
                <span className="text-xs font-medium text-[var(--ink)] max-w-[120px] truncate hidden lg:block">
                  {user?.displayName || user?.email}
                </span>
                <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-md ring-2 ring-[var(--bg)]">
                  {(user?.email?.[0] || "U").toUpperCase()}
                </div>
              </button>

              <AnimatePresence>
                {showUserMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl z-50 overflow-hidden"
                  >
                    <div className="p-4 border-b border-[var(--border)] bg-[var(--bg-soft)]">
                      <p className="text-sm font-semibold text-[var(--ink)] truncate">
                        {user?.displayName || "Utilisateur"}
                      </p>
                      <p className="text-xs text-[var(--muted)] truncate">{user?.email}</p>
                    </div>
                    <div className="p-1.5 flex flex-col gap-0.5">
                      <Link
                        href="/app/settings"
                        className="flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-[var(--ink)]/90 hover:bg-[var(--bg-soft)] transition-colors"
                      >
                        <Settings className="h-4 w-4 text-[var(--muted)]" />
                        <span>Paramètres</span>
                      </Link>

                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <LogOut className="h-4 w-4" />
                        <span>Déconnexion</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </header>

      {/* MOBILE SEARCH OVERLAY */}
      <AnimatePresence>
        {searchOpenMobile && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSearchOpenMobile(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] md:hidden"
            />
            <motion.div
              initial={{ y: 20, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              className="fixed left-0 right-0 top-0 z-[70] md:hidden p-3"
            >
              <div className="mx-auto max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl overflow-hidden">
                <div className="p-3 border-b border-[var(--border)] flex items-center gap-2">
                  <Search className="h-4 w-4 text-[var(--muted)]" />
                  <input
                    autoFocus
                    className="flex-1 bg-transparent outline-none text-sm text-[var(--ink)] placeholder:text-[var(--muted)]"
                    placeholder="Rechercher (pages + candidatures)…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <button
                    onClick={() => setSearchOpenMobile(false)}
                    className="p-2 rounded-lg hover:bg-[var(--bg-soft)] text-[var(--muted)] hover:text-[var(--ink)]"
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="p-2">
                  {searchQuery.trim() ? (
                    <SearchResults onPick={() => setSearchOpenMobile(false)} />
                  ) : (
                    <div className="p-4 text-center text-xs text-[var(--muted)]">
                      Tape pour rechercher.
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// --- LAYOUT PRINCIPAL ---
export default function UserAppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [credits, setCredits] = useState<number | null>(null);
  const [applications, setApplications] = useState<ApplicationLite[]>([]);
  const [clientReady, setClientReady] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopExpanded, setDesktopExpanded] = useState(true);

  useEffect(() => setClientReady(true), []);

  // Close drawer on route change
  useEffect(() => setSidebarOpen(false), [pathname]);

  // Fetch user credits + applications for global search
  useEffect(() => {
    if (!clientReady || loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }

    const unsubUser = onSnapshot(doc(db, "users", user.uid), async (snap) => {
      if (!snap.exists()) return;
      const data: any = snap.data();
      if (data?.blocked) {
        await signOut(auth);
        router.replace("/login?blocked=1");
        return;
      }
      setCredits(typeof data?.credits === "number" ? data.credits : 0);
    });

    const qApps = query(
      collection(db, "applications"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubApps = onSnapshot(qApps, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
      setApplications(list);
    });

    return () => {
      unsubUser();
      unsubApps();
    };
  }, [clientReady, loading, user, router]);

  const handleLogout = async () => {
    await signOut(auth);
    router.replace("/login");
  };

  const pageTitle =
    NAV_LINKS.find((l) => pathname === l.href || pathname.startsWith(l.href + "/"))?.label ||
    "Tableau de bord";

  if (!clientReady || loading || !user) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-[var(--brand)] rounded-full border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[var(--bg)] text-[var(--ink)] overflow-hidden font-sans selection:bg-[var(--brand)]/30">
      {/* SIDEBAR (Desktop) */}
      <motion.aside
        initial={false}
        animate={{ width: desktopExpanded ? 260 : 80 }}
        className="hidden md:flex flex-col border-r border-[var(--border)] bg-[var(--panel)] z-40 transition-all duration-300"
      >
        <div className="h-16 flex items-center px-4 border-b border-[var(--border)]">
          <Link href="/app" className="flex items-center gap-3 overflow-hidden">
            <div className="h-9 w-9 min-w-[2.25rem] rounded-xl bg-[var(--brand)]/10 border border-[var(--brand)]/25 flex items-center justify-center text-[var(--brand)] shadow-sm">
              <Zap className="h-4 w-4 fill-current" />
            </div>

            {desktopExpanded && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.08 }}
                className="flex flex-col whitespace-nowrap"
              >
                <span className="text-sm font-bold text-[var(--ink)] tracking-tight">SmartApply</span>
                <span className="text-[10px] text-[var(--muted)]">Suite IA</span>
              </motion.div>
            )}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.key}
                href={link.href}
                className={[
                  "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all border border-transparent",
                  isActive
                    ? "bg-[var(--brand)] text-white shadow-md shadow-[var(--brand)]/20"
                    : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)]",
                ].join(" ")}
                title={!desktopExpanded ? link.label : ""}
              >
                <link.icon
                  className={[
                    "h-5 w-5 flex-shrink-0",
                    isActive ? "text-white" : "text-[var(--muted)] group-hover:text-[var(--ink)]",
                  ].join(" ")}
                />
                {desktopExpanded && (
                  <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="truncate">
                    {link.label}
                  </motion.span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[var(--border)]">
          <button
            onClick={() => setDesktopExpanded((v) => !v)}
            className="w-full flex items-center justify-center p-2 rounded-xl text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] transition-colors"
            aria-label="Réduire/agrandir la sidebar"
          >
            <ChevronRight className={`h-5 w-5 transition-transform ${desktopExpanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </motion.aside>

      {/* CONTENT */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* subtle background */}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.10),_transparent_55%)]" />

        <AppHeader
          title={pageTitle}
          credits={credits}
          user={user}
          applications={applications}
          onToggleSidebar={() => setSidebarOpen(true)}
          handleLogout={handleLogout}
        />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 relative z-10 custom-scrollbar">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>

      {/* MOBILE DRAWER */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed inset-y-0 left-0 w-3/4 max-w-[300px] bg-[var(--panel)] border-r border-[var(--border)] z-50 md:hidden shadow-2xl flex flex-col"
            >
              <div className="h-16 flex items-center justify-between px-5 border-b border-[var(--border)]">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[var(--brand)]/10 border border-[var(--brand)]/25 flex items-center justify-center text-[var(--brand)]">
                    <Zap className="h-4 w-4 fill-current" />
                  </div>
                  <span className="font-bold text-[var(--ink)]">SmartApply</span>
                </div>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 rounded-lg hover:bg-[var(--bg-soft)] text-[var(--muted)] hover:text-[var(--ink)]"
                  aria-label="Fermer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
                {NAV_LINKS.map((link) => {
                  const active = pathname === link.href || pathname.startsWith(link.href + "/");
                  return (
                    <Link
                      key={link.key}
                      href={link.href}
                      onClick={() => setSidebarOpen(false)}
                      className={[
                        "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border border-transparent transition-colors",
                        active
                          ? "bg-[var(--brand)] text-white shadow-lg shadow-[var(--brand)]/20"
                          : "text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)]",
                      ].join(" ")}
                    >
                      <link.icon className="h-5 w-5" />
                      <span className="truncate">{link.label}</span>
                    </Link>
                  );
                })}
              </div>

              <div className="p-4 border-t border-[var(--border)] space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                  <span>Crédits</span>
                  <span className="text-[var(--ink)] font-bold">{credits ?? "—"}</span>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm rounded-xl text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Déconnexion</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
