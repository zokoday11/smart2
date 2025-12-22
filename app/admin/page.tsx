// app/admin/page.tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  query,
  orderBy,
  limit,
  deleteDoc,
} from "firebase/firestore";
import Chart from "chart.js/auto";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import { useAuth } from "@/context/AuthContext";

type AdminUser = {
  id: string;
  email: string;
  displayName?: string | null;
  createdAt?: number | null;
  lastLoginAt?: number | null;
  lastSeenAt?: number | null;
  lastSeenPage?: string | null;
  credits?: number;
  blocked?: boolean;
  emailVerified?: boolean;
  provider?: string;

  role?: string | null;

  lastIp?: string | null;
  country?: string | null;
  city?: string | null;

  lastAction?: string | null;
  lastActionAt?: number | null;
  lastDeviceType?: string | null; // "iphone" | "ipad" | "mac" | "mobile" | "tablet" | "desktop" | ...
  lastOs?: string | null;
  lastBrowser?: string | null;

  totalIaCalls?: number | null;
  totalCvGenerated?: number | null;
  totalLmGenerated?: number | null;
  totalDocumentsGenerated?: number | null;

  authFailedCount?: number | null;
};

type UsageLog = {
  id: string;
  userId: string;
  email?: string | null;
  action: string;
  tool?: string | null;
  docType?: string | null;
  eventType?: string | null;
  createdAt?: number | null;

  ip?: string | null;
  country?: string | null;
  city?: string | null;
  path?: string | null;
  creditsDelta?: number | null;

  deviceType?: string | null;
  os?: string | null;
  browser?: string | null;
};

function formatDate(ts?: number | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatRelative(ts?: number | null): string {
  if (!ts) return "Jamais vu·e";
  const now = Date.now();
  const diffMs = now - ts;
  if (diffMs < 0) return "Dans le futur 🤔";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `Il y a ${diffSec}s`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Il y a ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 48) return `Il y a ${diffH} h`;

  const diffJ = Math.floor(diffH / 24);
  return `Il y a ${diffJ} j`;
}

function getPresence(lastSeenAt?: number | null) {
  if (!lastSeenAt) {
    return {
      label: "Jamais vu·e",
      dotClass: "bg-slate-500",
      badgeClass:
        "bg-slate-500/10 text-slate-200 border border-slate-500/40",
    };
  }

  const now = Date.now();
  const diff = now - lastSeenAt;

  if (diff < 2 * 60 * 1000) {
    return {
      label: "En ligne",
      dotClass: "bg-emerald-400",
      badgeClass:
        "bg-emerald-500/10 text-emerald-200 border border-emerald-500/50",
    };
  }

  if (diff < 60 * 60 * 1000) {
    return {
      label: formatRelative(lastSeenAt),
      dotClass: "bg-amber-400",
      badgeClass:
        "bg-amber-500/10 text-amber-200 border border-amber-500/40",
    };
  }

  return {
    label: formatRelative(lastSeenAt),
    dotClass: "bg-slate-400",
    badgeClass:
      "bg-slate-500/10 text-slate-200 border border-slate-500/40",
  };
}

function getCountryFlag(country?: string | null): string {
  if (!country) return "🏳️";
  const c = country.toLowerCase();

  if (c.includes("france")) return "🇫🇷";
  if (c.includes("belgique") || c.includes("belgium")) return "🇧🇪";
  if (c.includes("suisse") || c.includes("switzerland")) return "🇨🇭";
  if (c.includes("canada")) return "🇨🇦";
  if (c.includes("maroc")) return "🇲🇦";
  if (c.includes("tunisie") || c.includes("tunisia")) return "🇹🇳";
  if (c.includes("algérie") || c.includes("algerie")) return "🇩🇿";
  if (c.includes("luxembourg")) return "🇱🇺";

  if (
    c.includes("united states") ||
    c.includes("usa") ||
    c.includes("états-unis") ||
    c.includes("etats-unis")
  )
    return "🇺🇸";
  if (c.includes("spain") || c.includes("espagne")) return "🇪🇸";
  if (c.includes("germany") || c.includes("allemagne")) return "🇩🇪";
  if (c.includes("italy") || c.includes("italie")) return "🇮🇹";
  if (c.includes("portugal")) return "🇵🇹";
  if (c.includes("netherlands") || c.includes("pays-bas")) return "🇳🇱";
  if (
    c.includes("united kingdom") ||
    c.includes("uk") ||
    c.includes("royaume-uni")
  )
    return "🇬🇧";

  return "🌍";
}

// Traduction du path en section lisible
function getPageLabel(path?: string | null): string {
  if (!path) return "Inconnu";
  const [clean] = path.split("?");
  if (!clean) return "Inconnu";

  if (clean === "/" || clean === "/app") return "Accueil (app)";
  if (clean.startsWith("/lm")) return "Lettre de motivation IA";
  if (
    clean.startsWith("/applications") ||
    clean.startsWith("/tracker") ||
    clean.startsWith("/suivi")
  )
    return "Suivi de candidatures";
  if (clean.startsWith("/credits")) return "Page crédits";
  if (clean.startsWith("/login") || clean.startsWith("/signup"))
    return "Connexion / Inscription";
  if (clean.startsWith("/admin")) return "Administration";
  if (clean.startsWith("/profil") || clean.startsWith("/profile"))
    return "Profil candidat";

  return clean;
}

// Affichage lisible du device, avec différenciation iPhone / iPad / macOS
function formatDevice(
  deviceType?: string | null,
  os?: string | null
): string {
  if (!deviceType && !os) return "—";

  let label: string;

  switch (deviceType) {
    case "iphone":
      label = "📱 iPhone";
      break;
    case "ipad":
      label = "📱 iPad";
      break;
    case "mac":
      label = "💻 macOS";
      break;
    case "mobile":
      label = "📱 Mobile";
      break;
    case "tablet":
      label = "📱 Tablette";
      break;
    case "desktop":
      label = "🖥 Desktop";
      break;
    default:
      label = "❓ Appareil";
  }

  if (os) label += ` · ${os}`;

  return label;
}

export default function AdminDashboardPage() {
  const { loading, isAdmin } = useAdminGuard();
  const { logout } = useAuth();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCredits, setEditingCredits] = useState<
    Record<string, string>
  >({});
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>(
    {}
  );

  const [activeTab, setActiveTab] = useState<"users" | "logs">("users");

  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // 🔎 nouveau : filtre sur les logs (tous / seulement auth_failed)
  const [logFilter, setLogFilter] = useState<"all" | "auth_failed">("all");

  // Chart.js pour les logs
  const logsChartRef = useRef<HTMLCanvasElement | null>(null);
  const [logsChart, setLogsChart] = useState<Chart | null>(null);

  // --- USERS SUB ---
  useEffect(() => {
    if (!isAdmin) {
      setUsers([]);
      setLoadingUsers(false);
      return;
    }

    setLoadingUsers(true);

    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: AdminUser[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            email: data.email || "—",
            displayName: data.displayName || null,
            createdAt:
              typeof data.createdAt === "number" ? data.createdAt : null,
            lastLoginAt:
              typeof data.lastLoginAt === "number"
                ? data.lastLoginAt
                : null,
            lastSeenAt:
              typeof data.lastSeenAt === "number" ? data.lastSeenAt : null,
            lastSeenPage: data.lastSeenPage || null,
            credits:
              typeof data.credits === "number"
                ? data.credits
                : data.credits ?? 0,
            blocked: !!data.blocked,
            emailVerified: !!data.emailVerified,
            provider: data.provider || "",

            role: data.role || (data.isAdmin ? "admin" : "user"),

            lastIp: data.lastSeenIp || null,
            country: data.lastSeenCountry || null,
            city: data.lastSeenCity || null,
            lastAction: data.lastAction || null,
            lastActionAt:
              typeof data.lastActionAt === "number"
                ? data.lastActionAt
                : null,
            lastDeviceType: data.lastDeviceType || null,
            lastOs: data.lastOs || null,
            lastBrowser: data.lastBrowser || null,

            totalIaCalls:
              typeof data.totalIaCalls === "number"
                ? data.totalIaCalls
                : null,
            totalCvGenerated:
              typeof data.totalCvGenerated === "number"
                ? data.totalCvGenerated
                : null,
            totalLmGenerated:
              typeof data.totalLmGenerated === "number"
                ? data.totalLmGenerated
                : null,
            totalDocumentsGenerated:
              typeof data.totalDocumentsGenerated === "number"
                ? data.totalDocumentsGenerated
                : null,
            authFailedCount:
              typeof data.authFailedCount === "number"
                ? data.authFailedCount
                : null,
          };
        });

        list.sort((a, b) => {
          const ta = a.createdAt || 0;
          const tb = b.createdAt || 0;
          return tb - ta;
        });

        setUsers(list);
        setLoadingUsers(false);
        setError(null);
      },
      (err) => {
        console.error("Erreur onSnapshot(users):", err);
        setError("Impossible de charger les utilisateurs.");
        setLoadingUsers(false);
      }
    );

    return () => {
      unsub();
    };
  }, [isAdmin]);

  // --- USAGE LOGS SUB ---
  useEffect(() => {
    if (!isAdmin || activeTab !== "logs") {
      setUsageLogs([]);
      setLoadingLogs(false);
      return;
    }

    setLoadingLogs(true);

    const qLogs = query(
      collection(db, "usageLogs"),
      orderBy("createdAt", "desc"),
      limit(200)
    );

    const unsub = onSnapshot(
      qLogs,
      (snap) => {
        const list: UsageLog[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            userId: data.userId,
            email: data.email ?? null,
            action: data.action || "—",
            tool: data.tool ?? null,
            docType: data.docType ?? null,
            eventType: data.eventType ?? null,
            createdAt:
              typeof data.createdAt === "number"
                ? data.createdAt
                : null,
            ip: data.ip ?? null,
            country: data.country ?? null,
            city: data.city ?? null,
            path: data.path ?? null,
            creditsDelta:
              typeof data.creditsDelta === "number"
                ? data.creditsDelta
                : null,
            deviceType: data.deviceType ?? null,
            os: data.os ?? null,
            browser: data.browser ?? null,
          };
        });

        setUsageLogs(list);
        setLoadingLogs(false);
      },
      (err) => {
        console.error("Erreur onSnapshot(usageLogs):", err);
        setLoadingLogs(false);
      }
    );

    return () => {
      unsub();
    };
  }, [isAdmin, activeTab]);

  // --- CHARTS SUR LES LOGS (LM / CV par jour) ---
  useEffect(() => {
    if (activeTab !== "logs") return;
    if (!logsChartRef.current) return;

    const ctx = logsChartRef.current.getContext("2d");
    if (!ctx) return;

    if (logsChart) {
      logsChart.destroy();
    }

    if (usageLogs.length === 0) {
      setLogsChart(null);
      return;
    }

    const byDate: Record<
      string,
      { total: number; lm: number; cv: number }
    > = {};

    usageLogs.forEach((log) => {
      if (!log.createdAt) return;
      const d = new Date(log.createdAt);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD

      if (!byDate[key]) {
        byDate[key] = { total: 0, lm: 0, cv: 0 };
      }

      byDate[key].total += 1;

      if (log.docType === "lm") {
        byDate[key].lm += 1;
      } else if (log.docType === "cv") {
        byDate[key].cv += 1;
      }
    });

    const labels = Object.keys(byDate).sort();
    const totalData = labels.map((k) => byDate[k].total);
    const lmData = labels.map((k) => byDate[k].lm);
    const cvData = labels.map((k) => byDate[k].cv);

    const chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Total appels IA",
            data: totalData,
            borderWidth: 2,
            tension: 0.3,
          },
          {
            label: "LM générées",
            data: lmData,
            borderWidth: 2,
            tension: 0.3,
          },
          {
            label: "CV générés",
            data: cvData,
            borderWidth: 2,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: {
              color: "#e5e7eb",
              font: { size: 11 },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#9ca3af", font: { size: 10 } },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
          y: {
            ticks: { color: "#9ca3af", font: { size: 10 } },
            grid: { color: "rgba(55,65,81,0.4)" },
          },
        },
      },
    });

    setLogsChart(chart);

    return () => {
      chart.destroy();
    };
  }, [usageLogs, activeTab]);

  // --- ACTIONS ADMIN ---

  const handleSaveCredits = async (u: AdminUser) => {
    const raw = editingCredits[u.id];
    if (raw == null) return;

    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      alert("Merci de saisir un nombre valide.");
      return;
    }

    try {
      setUpdatingIds((prev) => ({ ...prev, [u.id]: true }));
      const ref = doc(db, "users", u.id);
      await updateDoc(ref, { credits: parsed });
    } catch (e) {
      console.error("Erreur update credits:", e);
      alert("Erreur en mettant à jour les crédits.");
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [u.id]: false }));
    }
  };

  const handleToggleBlocked = async (u: AdminUser) => {
    try {
      setUpdatingIds((prev) => ({ ...prev, [u.id]: true }));
      const ref = doc(db, "users", u.id);
      await updateDoc(ref, { blocked: !u.blocked });
    } catch (e) {
      console.error("Erreur toggle blocked:", e);
      alert("Erreur en mettant à jour le statut de blocage.");
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [u.id]: false }));
    }
  };

  const handleDeleteUser = async (u: AdminUser) => {
    const sure = window.confirm(
      `Supprimer l'utilisateur ${u.email} de Firestore ?\n\n(Le compte Auth ne sera pas supprimé automatiquement.)`
    );
    if (!sure) return;

    try {
      setUpdatingIds((prev) => ({ ...prev, [u.id]: true }));
      const ref = doc(db, "users", u.id);
      await deleteDoc(ref);
    } catch (e) {
      console.error("Erreur delete user:", e);
      alert("Erreur lors de la suppression de l'utilisateur.");
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [u.id]: false }));
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      window.location.href = "/login";
    } catch (e) {
      console.error("Erreur logout:", e);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-300">
        Vérification des droits admin…
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const totalCredits = users.reduce(
    (sum, u) => sum + (u.credits ?? 0),
    0
  );
  const blockedCount = users.filter((u) => u.blocked).length;
  const totalDocs = users.reduce(
    (sum, u) => sum + (u.totalDocumentsGenerated ?? 0),
    0
  );

  const lmTotal = users.reduce(
    (sum, u) => sum + (u.totalLmGenerated ?? 0),
    0
  );
  const cvTotal = users.reduce(
    (sum, u) => sum + (u.totalCvGenerated ?? 0),
    0
  );

  const suspiciousLogs = usageLogs.filter(
    (l) => l.action === "auth_failed"
  ).length;

  // 🔎 on applique le filtre pour le tableau
  const filteredLogs =
    logFilter === "auth_failed"
      ? usageLogs.filter((l) => l.action === "auth_failed")
      : usageLogs;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-3 sm:px-6 py-5">
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        {/* HEADER */}
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-center justify-between gap-3"
        >
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-[3px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[11px] uppercase tracking-[0.18em] text-sky-100/80">
                Espace admin
              </span>
            </p>
            <h1 className="mt-2 text-xl sm:text-2xl font-semibold text-white">
              Tableau de bord administrateur
            </h1>
            <p className="text-xs sm:text-sm text-slate-300/80 mt-1 max-w-xl">
              Vue globale sur les comptes, la localisation des utilisateurs,
              les documents IA générés et les appels à l&apos;assistant.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-200"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Admin connecté</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-900 px-3 py-1.5 text-[12px] font-medium hover:bg-white transition-colors"
            >
              <span>Se déconnecter</span>
              <span className="text-[13px]">↩</span>
            </button>
          </div>
        </motion.header>

        {/* TABS */}
        <div className="flex items-center gap-2 border-b border-slate-800/80">
          <button
            type="button"
            onClick={() => setActiveTab("users")}
            className={`relative px-3 py-2 text-[12px] sm:text-[13px] ${
              activeTab === "users"
                ? "text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Utilisateurs
            {activeTab === "users" && (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-sky-400" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("logs")}
            className={`relative px-3 py-2 text-[12px] sm:text-[13px] ${
              activeTab === "logs"
                ? "text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Logs IA
            {activeTab === "logs" && (
              <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-sky-400" />
            )}
          </button>
        </div>

        {/* ONGLET UTILISATEURS */}
        {activeTab === "users" && (
          <>
            {/* STATS RAPIDES */}
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm shadow-sky-500/5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                  Utilisateurs
                </p>
                <p className="text-2xl font-semibold text-white">
                  {loadingUsers ? "…" : users.length}
                </p>
                <p className="text-[11px] text-slate-400">
                  Nombre total de comptes dans{" "}
                  <code className="text-sky-300">users</code>.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm shadow-sky-500/5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                  Utilisateurs bloqués
                </p>
                <p className="text-2xl font-semibold text-white">
                  {loadingUsers ? "…" : blockedCount}
                </p>
                <p className="text-[11px] text-slate-400">
                  Comptes avec{" "}
                  <code className="text-sky-300">blocked = true</code>.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm shadow-sky-500/5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                  Crédits totaux
                </p>
                <p className="text-2xl font-semibold text-white">
                  {loadingUsers ? "…" : totalCredits}
                </p>
                <p className="text-[11px] text-slate-400">
                  Somme de tous les crédits utilisateurs.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-sm shadow-sky-500/5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                  Docs IA générés
                </p>
                <p className="text-2xl font-semibold text-white">
                  {loadingUsers ? "…" : totalDocs}
                </p>
                <p className="text-[11px] text-slate-400">
                  LM: {lmTotal} · CV: {cvTotal}
                </p>
              </div>
            </div>

            {/* TABLE UTILISATEURS */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 sm:p-5 shadow-inner shadow-black/40">
              <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-white">
                  Liste des utilisateurs
                </h2>
                {loadingUsers && (
                  <span className="text-[11px] text-slate-400">
                    Chargement…
                  </span>
                )}
              </div>

              {error && (
                <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-100">
                  {error}
                </div>
              )}

              {!loadingUsers && users.length === 0 && !error && (
                <p className="text-[12px] text-slate-400">
                  Aucun utilisateur trouvé dans{" "}
                  <code className="text-sky-300">users</code>.
                  <br />
                  Vérifie que ta fonction{" "}
                  <code className="text-sky-300">upsertUserOnLogin</code> est
                  bien appelée après chaque connexion.
                </p>
              )}

              {users.length > 0 && (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-[11px] sm:text-[12px] border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="text-left py-2 pr-3">Utilisateur</th>
                        <th className="text-left py-2 pr-3 hidden sm:table-cell">
                          Localisation / Appareil
                        </th>
                        <th className="text-left py-2 pr-3">Crédits</th>
                        <th className="text-left py-2 pr-3">Statut</th>
                        <th className="text-left py-2 pr-3 hidden md:table-cell">
                          Dernier login
                        </th>
                        <th className="text-left py-2 pr-3 hidden lg:table-cell">
                          Dernière activité
                        </th>
                        <th className="text-left py-2 pl-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => {
                        const isUpdating = !!updatingIds[u.id];
                        const creditsValue =
                          editingCredits[u.id] ?? String(u.credits ?? 0);
                        const presence = getPresence(u.lastSeenAt);

                        const flag = getCountryFlag(u.country);
                        const pageLabel = getPageLabel(u.lastSeenPage);

                        return (
                          <tr
                            key={u.id}
                            className="border-b border-slate-800/70 hover:bg-slate-900/60"
                          >
                            {/* Utilisateur */}
                            <td className="py-2 pr-3 align-top">
                              <div className="flex flex-col gap-0.5">
                                <span className="font-medium text-[13px] text-white">
                                  {u.email}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  UID: {u.id}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {u.displayName || "—"}{" "}
                                  <span className="ml-1">
                                    {u.provider || "password"}
                                    {u.emailVerified
                                      ? " · ✅ vérifié"
                                      : " · ⚠️ non vérifié"}
                                  </span>
                                </span>
                                {u.role && (
                                  <span className="inline-flex w-fit mt-0.5 rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-[1px] text-[10px] text-sky-200">
                                    Rôle : {u.role}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Localisation + device + page */}
                            <td className="py-2 pr-3 align-top hidden sm:table-cell">
                              <div className="flex flex-col gap-0.5 text-slate-200">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-lg">{flag}</span>
                                  <span>
                                    {u.city || u.country
                                      ? `${u.city ?? ""}${
                                          u.city && u.country ? " · " : ""
                                        }${u.country ?? ""}`
                                      : "—"}
                                  </span>
                                </div>
                                {u.lastIp && (
                                  <span className="text-[10px] text-slate-400">
                                    IP: {u.lastIp}
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-400">
                                  {formatDevice(u.lastDeviceType, u.lastOs)}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Section: {pageLabel}
                                </span>
                                {u.lastSeenPage && (
                                  <span className="text-[10px] text-slate-500 line-clamp-1">
                                    Path: {u.lastSeenPage}
                                  </span>
                                )}
                                {u.lastBrowser && (
                                  <span className="text-[10px] text-slate-500">
                                    Navigateur: {u.lastBrowser}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Crédits */}
                            <td className="py-2 pr-3 align-top min-w-[90px]">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  className="w-20 rounded-md border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-100 outline-none focus:ring-1 focus:ring-sky-500"
                                  value={creditsValue}
                                  onChange={(e) =>
                                    setEditingCredits((prev) => ({
                                      ...prev,
                                      [u.id]: e.target.value,
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSaveCredits(u)}
                                  disabled={isUpdating}
                                  className="rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] text-slate-100 hover:border-sky-500 hover:text-sky-300 disabled:opacity-60"
                                >
                                  {isUpdating ? "…" : "OK"}
                                </button>
                              </div>
                            </td>

                            {/* Statut / IA */}
                            <td className="py-2 pr-3 align-top">
                              <div className="flex flex-col gap-1">
                                <span
                                  className={
                                    "inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[10px] " +
                                    presence.badgeClass
                                  }
                                >
                                  <span
                                    className={
                                      "w-1.5 h-1.5 rounded-full " +
                                      presence.dotClass
                                    }
                                  />
                                  <span>{presence.label}</span>
                                </span>
                                <span
                                  className={
                                    u.blocked
                                      ? "text-[10px] text-red-300"
                                      : "text-[10px] text-emerald-300"
                                  }
                                >
                                  {u.blocked ? "Bloqué" : "Autorisé"}
                                </span>

                                {(u.totalIaCalls ||
                                  u.totalCvGenerated ||
                                  u.totalLmGenerated) && (
                                  <span className="text-[10px] text-sky-300">
                                    IA: {u.totalIaCalls ?? 0} · CV:{" "}
                                    {u.totalCvGenerated ?? 0} · LM:{" "}
                                    {u.totalLmGenerated ?? 0}
                                  </span>
                                )}

                                {u.authFailedCount &&
                                  u.authFailedCount > 0 && (
                                    <span className="text-[10px] text-red-300">
                                      ⚠ {u.authFailedCount} tentatives login
                                      échouées
                                    </span>
                                  )}

                                {u.lastAction && (
                                  <span className="text-[10px] text-slate-400 line-clamp-1">
                                    Dernière action: {u.lastAction}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Dernier login */}
                            <td className="py-2 pr-3 align-top hidden md:table-cell text-slate-200">
                              {formatDate(u.lastLoginAt)}
                            </td>

                            {/* Dernière activité */}
                            <td className="py-2 pr-3 align-top hidden lg:table-cell text-slate-200">
                              {formatDate(u.lastSeenAt)}
                              <div className="text-[10px] text-slate-400">
                                {formatRelative(u.lastSeenAt)}
                              </div>
                            </td>

                            {/* Actions */}
                            <td className="py-2 pl-3 align-top">
                              <div className="flex flex-col gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleToggleBlocked(u)}
                                  disabled={isUpdating}
                                  className={
                                    "inline-flex items-center justify-center rounded-full px-2.5 py-1 text-[10px] border " +
                                    (u.blocked
                                      ? "border-emerald-400/70 text-emerald-200 hover:bg-emerald-500/10"
                                      : "border-red-400/70 text-red-200 hover:bg-red-500/10")
                                  }
                                >
                                  {isUpdating
                                    ? "…"
                                    : u.blocked
                                    ? "Débloquer"
                                    : "Bloquer"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(u)}
                                  disabled={isUpdating}
                                  className="inline-flex items-center justify-center rounded-full px-2.5 py-1 text-[10px] border border-slate-700 text-slate-300 hover:border-red-500 hover:text-red-300 disabled:opacity-60"
                                >
                                  Supprimer
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ONGLET LOGS */}
        {activeTab === "logs" && (
          <div className="space-y-4">
            {/* STATS + COURBE */}
            <div className="grid gap-3 lg:grid-cols-[2fr,1fr]">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 sm:p-5 shadow-inner shadow-black/40">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <h2 className="text-sm sm:text-base font-semibold text-white">
                    Activité IA (LM / CV)
                  </h2>
                  {loadingLogs && (
                    <span className="text-[11px] text-slate-400">
                      Chargement…
                    </span>
                  )}
                </div>
                <div className="relative h-[220px] sm:h-[260px]">
                  <canvas ref={logsChartRef} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-inner shadow-black/40">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                    LM générées (logs)
                  </p>
                  <p className="text-2xl font-semibold text-white">
                    {usageLogs.filter((l) => l.docType === "lm").length}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Nombre d&apos;événements avec <code>docType = "lm"</code>.
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-inner shadow-black/40">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400 mb-1">
                    Tentatives suspectes
                  </p>
                  <p className="text-2xl font-semibold text-white">
                    {suspiciousLogs}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Logs avec <code>action = "auth_failed"</code> (échecs de
                    connexion). À logger côté Auth sur chaque erreur de login.
                  </p>
                </div>
              </div>
            </div>

            {/* TABLE DES LOGS */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 sm:p-5 shadow-inner shadow-black/40">
              <div className="flex items-center justify-between mb-3 gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-white">
                  Logs d&apos;usage IA (derniers 200)
                </h2>
                <div className="flex items-center gap-2">
                  {/* Filtre logs vs auth_failed */}
                  <div className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/80 p-1">
                    <button
                      type="button"
                      onClick={() => setLogFilter("all")}
                      className={
                        "px-2.5 py-0.5 rounded-full text-[10px] " +
                        (logFilter === "all"
                          ? "bg-sky-500 text-slate-900"
                          : "text-slate-300 hover:text-white")
                      }
                    >
                      Tous
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogFilter("auth_failed")}
                      className={
                        "px-2.5 py-0.5 rounded-full text-[10px] " +
                        (logFilter === "auth_failed"
                          ? "bg-red-500 text-slate-900"
                          : "text-slate-300 hover:text-white")
                      }
                    >
                      Échecs de connexion
                    </button>
                  </div>

                  {loadingLogs && (
                    <span className="text-[11px] text-slate-400">
                      Chargement…
                    </span>
                  )}
                </div>
              </div>

              {usageLogs.length === 0 && !loadingLogs && (
                <p className="text-[12px] text-slate-400">
                  Aucun log d&apos;usage trouvé. Vérifie que{" "}
                  <code className="text-sky-300">logUsage()</code> est bien
                  appelé quand tu génères / télécharges LM & CV, et que tu
                  loggues aussi les erreurs de connexion avec{" "}
                  <code className="text-sky-300">action = "auth_failed"</code>.
                </p>
              )}

              {usageLogs.length > 0 && filteredLogs.length === 0 && (
                <p className="text-[12px] text-slate-400">
                  Aucun log pour ce filtre. Il n&apos;y a pas (encore) de
                  logs avec <code>action = "auth_failed"</code>.
                </p>
              )}

              {filteredLogs.length > 0 && (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-[11px] sm:text-[12px] border-collapse">
                    <thead>
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="text-left py-2 pr-3">Date</th>
                        <th className="text-left py-2 pr-3">User</th>
                        <th className="text-left py-2 pr-3">Action</th>
                        <th className="text-left py-2 pr-3 hidden md:table-cell">
                          Crédit
                        </th>
                        <th className="text-left py-2 pr-3 hidden sm:table-cell">
                          Localisation / Appareil
                        </th>
                        <th className="text-left py-2 pl-3 hidden lg:table-cell">
                          Page
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.map((log) => {
                        const flag = getCountryFlag(log.country);
                        const deviceLabel = formatDevice(
                          log.deviceType ?? undefined,
                          log.os ?? undefined
                        );
                        const pageLabel = getPageLabel(log.path ?? undefined);

                        const isSuspicious = log.action === "auth_failed";

                        return (
                          <tr
                            key={log.id}
                            className={
                              "border-b border-slate-800/70 hover:bg-slate-900/60 " +
                              (isSuspicious ? "bg-red-900/10" : "")
                            }
                          >
                            <td className="py-2 pr-3 align-top text-slate-200">
                              <div className="flex flex-col">
                                <span>{formatDate(log.createdAt)}</span>
                                <span className="text-[10px] text-slate-400">
                                  {formatRelative(log.createdAt ?? null)}
                                </span>
                              </div>
                            </td>
                            <td className="py-2 pr-3 align-top">
                              <div className="flex flex-col">
                                <span className="text-slate-100">
                                  {log.email || "—"}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  UID: {log.userId}
                                </span>
                              </div>
                            </td>
                            <td className="py-2 pr-3 align-top">
                              <div className="flex flex-col gap-0.5">
                                <span
                                  className={
                                    "text-slate-100 " +
                                    (log.action === "auth_failed"
                                      ? "text-red-300"
                                      : "")
                                  }
                                >
                                  {log.action}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {log.docType || "—"}{" "}
                                  {log.eventType
                                    ? `· ${log.eventType}`
                                    : ""}
                                </span>
                                {log.tool && (
                                  <span className="inline-flex w-fit rounded-full border border-sky-500/50 bg-sky-500/10 px-2 py-[1px] text-[10px] text-sky-200">
                                    {log.tool}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pr-3 align-top hidden md:table-cell text-slate-200">
                              {log.creditsDelta != null ? (
                                <span
                                  className={
                                    log.creditsDelta < 0
                                      ? "text-red-300"
                                      : log.creditsDelta > 0
                                      ? "text-emerald-300"
                                      : "text-slate-200"
                                  }
                                >
                                  {log.creditsDelta > 0 ? "+" : ""}
                                  {log.creditsDelta}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-2 pr-3 align-top hidden sm:table-cell text-slate-200">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-lg">{flag}</span>
                                  <span>
                                    {log.city || log.country
                                      ? `${log.city ?? ""}${
                                          log.city && log.country ? " · " : ""
                                        }${log.country ?? ""}`
                                      : "—"}
                                  </span>
                                </div>
                                {log.ip && (
                                  <span className="text-[10px] text-slate-400">
                                    IP: {log.ip}
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-400">
                                  {deviceLabel}
                                </span>
                                {log.browser && (
                                  <span className="text-[10px] text-slate-500">
                                    Navigateur: {log.browser}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 pl-3 align-top hidden lg:table-cell text-slate-200">
                              <span className="text-[11px] text-slate-300 line-clamp-1">
                                Section: {pageLabel}
                              </span>
                              {log.path && (
                                <div className="text-[10px] text-slate-500 line-clamp-1">
                                  Path: {log.path}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
