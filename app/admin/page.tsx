"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Chart from "chart.js/auto";

import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  DocumentData,
  QueryDocumentSnapshot,
} from "firebase/firestore";

import { useAdminGuard } from "@/hooks/useAdminGuard";
import { useAuth } from "@/context/AuthContext";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Ban,
  Calendar,
  CheckCircle2,
  Coins,
  Crown,
  Download,
  FileStack,
  Globe,
  LayoutDashboard,
  Lock,
  LogOut,
  Minus,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Server,
  Settings,
  ShieldAlert,
  Smartphone,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  X,
} from "lucide-react";

import {
  adminDeleteUserDocFirestore,
  adminSetAdminRoleCallable,
  adminSetMaintenanceModeFirestore,
  adminToggleBlockedFirestore,
  adminUpdateCreditsCallable,
} from "@/lib/adminApi";

/* ---------------- TYPES ---------------- */

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
  lastDeviceType?: string | null;
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
  userId?: string | null;
  email?: string | null;

  // legacy/new formats
  action?: string | null;
  type?: string | null;
  eventType?: string | null;

  docType?: string | null; // cv | lm | other
  tool?: string | null;

  createdAt?: number | null; // ms (preferred)
  createdAtServer?: any;

  ip?: string | null;
  deviceType?: string | null;
  country?: string | null;

  meta?: any;
};

type TabId = "users" | "analytics" | "security" | "settings";

/* ---------------- HELPERS ---------------- */

function safeLower(v: any) {
  return String(v ?? "").toLowerCase();
}

function normalizeDateMs(v: any): number | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate().getTime();
  if (typeof v === "number") return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function formatDate(ms?: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(ms?: number | null) {
  if (!ms) return "Jamais";
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `${minutes} min`;
  if (hours < 24) return `${hours} h`;
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 30) return `${days} j`;
  return formatDate(ms);
}

function getCountryFlag(country?: string | null): string {
  if (!country) return "🌍";
  const c = safeLower(country);
  if (c.includes("france")) return "🇫🇷";
  if (c.includes("belgique")) return "🇧🇪";
  if (c.includes("canada")) return "🇨🇦";
  if (c.includes("maroc")) return "🇲🇦";
  if (c.includes("usa") || c.includes("united states")) return "🇺🇸";
  return "🌍";
}

function buildCsv(filename: string, headers: string[], rows: any[][]) {
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      r
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sumSafe(nums: Array<number | null | undefined>) {
  return nums.reduce((acc, v) => acc + (typeof v === "number" ? v : 0), 0);
}

/* ---------------- CONSTANTS ---------------- */

const ANALYTICS_RANGES = [
  { id: "7d", label: "7j", days: 7 },
  { id: "30d", label: "30j", days: 30 },
  { id: "90d", label: "90j", days: 90 },
] as const;

const DEVICE_LABEL = (v: string) => {
  const t = safeLower(v);
  if (t.includes("mobile")) return "Mobile";
  if (t.includes("tablet")) return "Tablet";
  return "Desktop";
};

/* ---------------- PAGE ---------------- */

export default function AdminDashboardPage() {
  const { loading, isAdmin } = useAdminGuard();
  const { logout } = useAuth();

  // Data
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>([]);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // UI
  const [activeTab, setActiveTab] = useState<TabId>("users");
  const [search, setSearch] = useState("");

  // Users filters
  const [filterBlocked, setFilterBlocked] = useState<"" | "active" | "blocked">("");
  const [filterProvider, setFilterProvider] = useState<string>("");
  const [filterRole, setFilterRole] = useState<string>(""); // informational only unless you store role in users doc
  const [sortKey, setSortKey] = useState<"createdAt" | "lastSeenAt" | "credits" | "docs">("createdAt");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // User drawer
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userActivity, setUserActivity] = useState<UsageLog[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  // Actions state
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // Credits edit (absolute + delta)
  const [creditsAbs, setCreditsAbs] = useState<string>("");
  const [creditsDelta, setCreditsDelta] = useState<string>("");

  // Analytics range
  const [analyticsRange, setAnalyticsRange] = useState<(typeof ANALYTICS_RANGES)[number]["id"]>("7d");

  // Charts refs
  const lineRef = useRef<HTMLCanvasElement | null>(null);
  const lineInstance = useRef<Chart | null>(null);

  const pieRef = useRef<HTMLCanvasElement | null>(null);
  const pieInstance = useRef<Chart | null>(null);

  /* ----------- FETCH: users + logs + settings ----------- */

  useEffect(() => {
    if (!isAdmin || loading) return;

    // Users realtime
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      const list = snap.docs.map((d) => {
        const data: any = d.data();
        return {
          id: d.id,
          ...data,
          createdAt: normalizeDateMs(data.createdAt),
          lastSeenAt: normalizeDateMs(data.lastSeenAt),
          lastLoginAt: normalizeDateMs(data.lastLoginAt),
        } as AdminUser;
      });

      setUsers(list);
    });

    // Logs realtime (for analytics/security)
    const qLogs = query(collection(db, "usageLogs"), orderBy("createdAt", "desc"), limit(1200));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      const list = snap.docs.map((d) => {
        const data: any = d.data();
        const createdAt =
          typeof data.createdAt === "number"
            ? data.createdAt
            : normalizeDateMs(data.createdAtServer) || normalizeDateMs(data.createdAt) || null;

        return {
          id: d.id,
          ...data,
          createdAt,
          meta: data.meta ?? data.metadata ?? {},
        } as UsageLog;
      });

      setUsageLogs(list);
    });

    // Settings (maintenance)
    const settingsDoc = doc(db, "settings", "app");
    const unsubSettings = onSnapshot(settingsDoc, (snap) => {
      const data: any = snap.data() || {};
      setMaintenanceMode(!!data.maintenanceMode);
    });

    return () => {
      unsubUsers();
      unsubLogs();
      unsubSettings();
    };
  }, [isAdmin, loading]);

  /* ----------- DERIVED ----------- */

  const securityLogs = useMemo(() => {
    return usageLogs.filter((l) => {
      const t = safeLower(l.action || l.type || l.eventType);
      return t.includes("auth_failed") || t.includes("failed") || t.includes("login_failed");
    });
  }, [usageLogs]);

  const kpiTotalCredits = useMemo(() => sumSafe(users.map((u) => u.credits)), [users]);
  const kpiTotalDocs = useMemo(() => sumSafe(users.map((u) => u.totalDocumentsGenerated)), [users]);

  const filteredUsers = useMemo(() => {
    const s = safeLower(search);

    let list = users.filter((u) => {
      const matchSearch =
        !s ||
        safeLower(u.email).includes(s) ||
        safeLower(u.displayName).includes(s) ||
        safeLower(u.id).includes(s);

      if (!matchSearch) return false;

      if (filterBlocked === "active" && u.blocked) return false;
      if (filterBlocked === "blocked" && !u.blocked) return false;

      if (filterProvider && safeLower(u.provider) !== safeLower(filterProvider)) return false;

      // role filter (only if you store it in doc)
      if (filterRole && safeLower(u.role) !== safeLower(filterRole)) return false;

      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      return (va - vb) * dir;
    });

    return list;
  }, [users, search, filterBlocked, filterProvider, filterRole, sortKey, sortDir]);

  const allSelected = useMemo(() => {
    if (filteredUsers.length === 0) return false;
    return filteredUsers.every((u) => selectedIds.includes(u.id));
  }, [filteredUsers, selectedIds]);

  const selectedUsers = useMemo(() => {
    const map = new Map(users.map((u) => [u.id, u]));
    return selectedIds.map((id) => map.get(id)).filter(Boolean) as AdminUser[];
  }, [selectedIds, users]);

  const providerOptions = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      if (u.provider) set.add(u.provider);
    });
    return Array.from(set).slice(0, 12);
  }, [users]);

  const roleOptions = useMemo(() => {
    const set = new Set<string>();
    users.forEach((u) => {
      if (u.role) set.add(u.role);
    });
    return Array.from(set).slice(0, 12);
  }, [users]);

  /* ----------- USER ACTIVITY (last 30 logs) ----------- */

  useEffect(() => {
    if (!selectedUser) return;

    setCreditsAbs(String(selectedUser.credits ?? 0));
    setCreditsDelta("");

    const load = async () => {
      setLoadingActivity(true);
      try {
        // Prefer querying by userId; if you only have email, switch to where("email","==",selectedUser.email)
        const q = query(
          collection(db, "usageLogs"),
          where("userId", "==", selectedUser.id),
          orderBy("createdAt", "desc"),
          limit(30)
        );
        const snap = await getDocs(q);
        const rows = snap.docs.map((d) => {
          const data: any = d.data();
          const createdAt =
            typeof data.createdAt === "number"
              ? data.createdAt
              : normalizeDateMs(data.createdAtServer) || normalizeDateMs(data.createdAt) || null;

          return {
            id: d.id,
            ...data,
            createdAt,
          } as UsageLog;
        });
        setUserActivity(rows);
      } catch (e) {
        // If composite index missing, fallback to email query
        try {
          const q2 = query(
            collection(db, "usageLogs"),
            where("email", "==", selectedUser.email),
            orderBy("createdAt", "desc"),
            limit(30)
          );
          const snap2 = await getDocs(q2);
          const rows2 = snap2.docs.map((d) => {
            const data: any = d.data();
            const createdAt =
              typeof data.createdAt === "number"
                ? data.createdAt
                : normalizeDateMs(data.createdAtServer) || normalizeDateMs(data.createdAt) || null;

            return { id: d.id, ...data, createdAt } as UsageLog;
          });
          setUserActivity(rows2);
        } catch (e2) {
          console.error("Activity load error:", e2);
          setUserActivity([]);
        }
      } finally {
        setLoadingActivity(false);
      }
    };

    load();
  }, [selectedUser]);

  /* ----------- CHARTS ----------- */

  const analyticsDays = useMemo(() => {
    const cfg = ANALYTICS_RANGES.find((r) => r.id === analyticsRange) || ANALYTICS_RANGES[0];
    return cfg.days;
  }, [analyticsRange]);

  const analyticsSeries = useMemo(() => {
    const days = analyticsDays;
    const keys: string[] = [];
    const map: Record<string, { cv: number; lm: number; other: number }> = {};

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10); // YYYY-MM-DD
      keys.push(k);
      map[k] = { cv: 0, lm: 0, other: 0 };
    }

    const minMs = Date.now() - days * 24 * 60 * 60 * 1000;

    usageLogs.forEach((log) => {
      const ms = log.createdAt ?? null;
      if (!ms || ms < minMs) return;
      const day = new Date(ms).toISOString().slice(0, 10);
      if (!map[day]) return;

      const dt = safeLower(log.docType);
      if (dt === "cv") map[day].cv++;
      else if (dt === "lm") map[day].lm++;
      else map[day].other++;
    });

    return { keys, map };
  }, [usageLogs, analyticsDays]);

  useEffect(() => {
    if (activeTab !== "analytics") return;

    // Line chart
    if (lineRef.current) {
      const ctx = lineRef.current.getContext("2d");
      if (ctx) {
        if (lineInstance.current) lineInstance.current.destroy();

        const labels = analyticsSeries.keys.map((k) =>
          new Date(k).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
        );

        lineInstance.current = new Chart(ctx, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "CV",
                data: analyticsSeries.keys.map((k) => analyticsSeries.map[k].cv),
                tension: 0.35,
                fill: true,
              },
              {
                label: "LM",
                data: analyticsSeries.keys.map((k) => analyticsSeries.map[k].lm),
                tension: 0.35,
                fill: true,
              },
              {
                label: "Other",
                data: analyticsSeries.keys.map((k) => analyticsSeries.map[k].other),
                tension: 0.35,
                fill: true,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: { color: "#94a3b8", font: { size: 11 } },
              },
            },
            scales: {
              y: {
                grid: { color: "rgba(255,255,255,0.06)" },
                ticks: { color: "#64748b" },
              },
              x: {
                grid: { display: false },
                ticks: { color: "#64748b" },
              },
            },
          },
        });
      }
    }

    // Pie chart (devices from recent logs)
    if (pieRef.current) {
      const ctx = pieRef.current.getContext("2d");
      if (ctx) {
        if (pieInstance.current) pieInstance.current.destroy();

        const counts = usageLogs.reduce((acc, l) => {
          const dev = DEVICE_LABEL(l.deviceType || "desktop");
          acc[dev] = (acc[dev] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

        pieInstance.current = new Chart(ctx, {
          type: "doughnut",
          data: {
            labels: Object.keys(counts),
            datasets: [
              {
                data: Object.values(counts),
                borderWidth: 0,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { position: "right", labels: { color: "#94a3b8", font: { size: 10 } } },
            },
          },
        });
      }
    }

    return () => {
      if (lineInstance.current) lineInstance.current.destroy();
      if (pieInstance.current) pieInstance.current.destroy();
    };
  }, [activeTab, analyticsSeries, usageLogs]);

  /* ----------- ACTIONS ----------- */

  const notify = (type: "ok" | "err", msg: string) => {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 3500);
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      const idsToRemove = new Set(filteredUsers.map((u) => u.id));
      setSelectedIds((prev) => prev.filter((id) => !idsToRemove.has(id)));
    } else {
      const idsToAdd = filteredUsers.map((u) => u.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...idsToAdd])));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const exportUsersCSV = (onlyFiltered: boolean) => {
    const list = onlyFiltered ? filteredUsers : users;
    const headers = [
      "id",
      "email",
      "displayName",
      "credits",
      "createdAt",
      "lastLoginAt",
      "lastSeenAt",
      "blocked",
      "provider",
      "country",
      "city",
    ];
    const rows = list.map((u) => [
      u.id,
      u.email,
      u.displayName ?? "",
      u.credits ?? 0,
      formatDate(u.createdAt),
      formatDate(u.lastLoginAt),
      formatDate(u.lastSeenAt),
      u.blocked ? "YES" : "NO",
      u.provider ?? "",
      u.country ?? "",
      u.city ?? "",
    ]);

    buildCsv(`users_${onlyFiltered ? "filtered_" : ""}${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  const bulkBlock = async (blocked: boolean) => {
    if (selectedUsers.length === 0) return notify("err", "Aucun utilisateur sélectionné.");
    if (!confirm(`${blocked ? "Bloquer" : "Débloquer"} ${selectedUsers.length} utilisateur(s) ?`)) return;

    setBusy(true);
    try {
      for (const u of selectedUsers) {
        await adminToggleBlockedFirestore(u.id, blocked);
      }
      notify("ok", `OK: ${blocked ? "bloqués" : "débloqués"} (${selectedUsers.length}).`);
    } catch (e) {
      console.error(e);
      notify("err", "Erreur bulk action.");
    } finally {
      setBusy(false);
    }
  };

  const setMaintenance = async (enabled: boolean) => {
    setBusy(true);
    try {
      await adminSetMaintenanceModeFirestore(enabled);
      notify("ok", `Maintenance ${enabled ? "ON" : "OFF"}`);
    } catch (e) {
      console.error(e);
      notify("err", "Erreur maintenance.");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      window.location.href = "/admin/login";
    } catch {}
  };

  /* ----------- USER DRAWER ACTIONS ----------- */

  const updateCreditsAbsolute = async () => {
    if (!selectedUser) return;
    const val = parseInt(creditsAbs, 10);
    if (Number.isNaN(val)) return notify("err", "Crédits invalides.");

    setBusy(true);
    try {
      await adminUpdateCreditsCallable({
        userId: selectedUser.id,
        credits: val,
        reason: "admin_set_absolute",
      });
      notify("ok", `Crédits mis à jour: ${val}`);
    } catch (e) {
      console.error(e);
      notify("err", "Erreur update crédits (callable).");
    } finally {
      setBusy(false);
    }
  };

  const applyCreditsDelta = async (sign: 1 | -1) => {
    if (!selectedUser) return;
    const delta = parseInt(creditsDelta, 10);
    if (Number.isNaN(delta)) return notify("err", "Delta invalide.");
    const current = selectedUser.credits ?? 0;
    const next = Math.max(0, current + sign * delta);

    setBusy(true);
    try {
      await adminUpdateCreditsCallable({
        userId: selectedUser.id,
        credits: next,
        reason: sign === 1 ? "admin_credit_plus" : "admin_credit_minus",
      });
      notify("ok", `Crédits: ${current} → ${next}`);
      setCreditsDelta("");
    } catch (e) {
      console.error(e);
      notify("err", "Erreur delta crédits (callable).");
    } finally {
      setBusy(false);
    }
  };

  const toggleBlockUser = async () => {
    if (!selectedUser) return;
    const next = !selectedUser.blocked;

    setBusy(true);
    try {
      await adminToggleBlockedFirestore(selectedUser.id, next);
      notify("ok", next ? "Utilisateur bloqué." : "Utilisateur débloqué.");
    } catch (e) {
      console.error(e);
      notify("err", "Erreur block/unblock.");
    } finally {
      setBusy(false);
    }
  };

  const toggleAdminRole = async () => {
    if (!selectedUser) return;

    const isAdminNow = safeLower(selectedUser.role) === "admin";
    const next = !isAdminNow;

    if (!confirm(`${next ? "Donner" : "Retirer"} le rôle admin à ${selectedUser.email} ?`)) return;

    setBusy(true);
    try {
      await adminSetAdminRoleCallable({ uid: selectedUser.id, isAdmin: next });
      notify("ok", next ? "Admin role: ON" : "Admin role: OFF");
    } catch (e) {
      console.error(e);
      notify("err", "Erreur role admin (callable).");
    } finally {
      setBusy(false);
    }
  };

  const deleteUserDoc = async () => {
    if (!selectedUser) return;
    if (!confirm("Supprimer définitivement le document Firestore de cet utilisateur ?")) return;

    setBusy(true);
    try {
      await adminDeleteUserDocFirestore(selectedUser.id);
      setSelectedUser(null);
      notify("ok", "Document utilisateur supprimé.");
    } catch (e) {
      console.error(e);
      notify("err", "Erreur suppression doc user.");
    } finally {
      setBusy(false);
    }
  };

  /* ----------- RENDER GUARDS ----------- */

  if (loading) return null;
  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-indigo-500/30">
      {/* TOP TOAST */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-xl border text-xs font-bold shadow-xl ${
              toast.type === "ok"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                : "bg-red-500/10 border-red-500/30 text-red-200"
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER */}
      <header className="sticky top-0 z-30 bg-[#020617]/90 backdrop-blur-md border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <LayoutDashboard className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-extrabold text-white tracking-tight">Admin Console</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <p className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest">
                  {maintenanceMode ? "MAINTENANCE" : "SYSTEM OK"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setMaintenance(!maintenanceMode)}
              disabled={busy}
              className={`flex items-center gap-2 px-3 py-2 rounded-full border text-[10px] font-extrabold uppercase tracking-wider transition-all disabled:opacity-50 ${
                maintenanceMode
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                  : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
              }`}
            >
              <Server className="h-4 w-4" />
              Maintenance {maintenanceMode ? "ON" : "OFF"}
            </button>

            <button
              onClick={handleLogout}
              className="bg-white/5 hover:bg-white/10 text-white p-2 rounded-xl transition-colors border border-white/10"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* BODY */}
      <main className="max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8">
        {/* KPI CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <KpiCard label="Utilisateurs" value={users.length} icon={Users} tone="blue" />
          <KpiCard label="Crédits Totaux" value={kpiTotalCredits} icon={Coins} tone="amber" />
          <KpiCard label="Docs générés" value={kpiTotalDocs} icon={FileStack} tone="emerald" />
          <KpiCard label="Alertes Sécu" value={securityLogs.length} icon={ShieldAlert} tone="red" />
        </div>

        {/* TABS + TOP BAR */}
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
          <div className="flex bg-slate-900/50 p-1 rounded-xl border border-white/10 backdrop-blur-sm">
            <TabButton active={activeTab === "users"} onClick={() => setActiveTab("users")} icon={Users} label="Utilisateurs" />
            <TabButton active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")} icon={BarChart3} label="Analytics" />
            <TabButton active={activeTab === "security"} onClick={() => setActiveTab("security")} icon={ShieldAlert} label="Sécurité" />
            <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")} icon={Settings} label="Settings" />
          </div>

          {/* Right side controls */}
          {activeTab === "users" && (
            <div className="w-full lg:w-auto flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="relative w-full sm:w-72 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                <input
                  type="text"
                  placeholder="Recherche (email, id, nom)..."
                  className="w-full bg-slate-900/50 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <select
                  value={filterBlocked}
                  onChange={(e) => setFilterBlocked(e.target.value as any)}
                  className="bg-slate-900/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="">Statut: all</option>
                  <option value="active">Actifs</option>
                  <option value="blocked">Bloqués</option>
                </select>

                <select
                  value={filterProvider}
                  onChange={(e) => setFilterProvider(e.target.value)}
                  className="bg-slate-900/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="">Provider: all</option>
                  {providerOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>

                <select
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="bg-slate-900/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="">Role: all</option>
                  {roleOptions.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as any)}
                  className="bg-slate-900/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
                >
                  <option value="createdAt">Tri: createdAt</option>
                  <option value="lastSeenAt">Tri: lastSeenAt</option>
                  <option value="credits">Tri: credits</option>
                  <option value="docs">Tri: docs</option>
                </select>

                <button
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-200 hover:bg-white/10"
                  title="Toggle sort direction"
                >
                  {sortDir.toUpperCase()}
                </button>
              </div>
            </div>
          )}

          {activeTab === "analytics" && (
            <div className="flex items-center gap-2 flex-wrap">
              {ANALYTICS_RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setAnalyticsRange(r.id)}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                    analyticsRange === r.id
                      ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-200"
                      : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* TAB: USERS */}
        {activeTab === "users" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Bulk bar */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 backdrop-blur-sm p-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-xs text-slate-400">
                  Résultats: <span className="text-slate-200 font-bold">{filteredUsers.length}</span>{" "}
                  / Total: <span className="text-slate-200 font-bold">{users.length}</span>
                </div>

                <div className="text-xs text-slate-400">
                  Sélection: <span className="text-slate-200 font-bold">{selectedIds.length}</span>
                </div>

                <button
                  onClick={() => exportUsersCSV(true)}
                  className="flex items-center gap-2 text-[10px] font-extrabold text-indigo-300 bg-indigo-500/10 px-3 py-2 rounded-xl border border-indigo-500/20 hover:bg-indigo-500/20 transition-all"
                >
                  <Download className="h-4 w-4" />
                  EXPORT (FILTRÉ)
                </button>

                <button
                  onClick={() => exportUsersCSV(false)}
                  className="flex items-center gap-2 text-[10px] font-extrabold text-slate-200 bg-white/5 px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10 transition-all"
                >
                  <Download className="h-4 w-4" />
                  EXPORT (TOUT)
                </button>

                <button
                  onClick={() => {
                    setSearch("");
                    setFilterBlocked("");
                    setFilterProvider("");
                    setFilterRole("");
                    setSortKey("createdAt");
                    setSortDir("desc");
                    setSelectedIds([]);
                    notify("ok", "Filtres reset.");
                  }}
                  className="flex items-center gap-2 text-[10px] font-extrabold text-slate-200 bg-white/5 px-3 py-2 rounded-xl border border-white/10 hover:bg-white/10 transition-all"
                >
                  <RefreshCcw className="h-4 w-4" />
                  RESET
                </button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  disabled={busy || selectedIds.length === 0}
                  onClick={() => bulkBlock(true)}
                  className="flex items-center gap-2 text-[10px] font-extrabold text-amber-200 bg-amber-500/10 px-3 py-2 rounded-xl border border-amber-500/20 hover:bg-amber-500/20 transition-all disabled:opacity-40"
                >
                  <Ban className="h-4 w-4" />
                  BLOQUER
                </button>

                <button
                  disabled={busy || selectedIds.length === 0}
                  onClick={() => bulkBlock(false)}
                  className="flex items-center gap-2 text-[10px] font-extrabold text-emerald-200 bg-emerald-500/10 px-3 py-2 rounded-xl border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  DÉBLOQUER
                </button>
              </div>
            </div>

            {/* Users table */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 shadow-xl overflow-hidden backdrop-blur-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-950/40 text-[10px] uppercase tracking-wider font-extrabold text-slate-500 border-b border-white/10">
                    <tr>
                      <th className="px-4 py-3 w-[44px]">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="accent-indigo-500"
                        />
                      </th>
                      <th className="px-6 py-3">Utilisateur</th>
                      <th className="px-6 py-3 hidden md:table-cell">Statut</th>
                      <th className="px-6 py-3">Crédits</th>
                      <th className="px-6 py-3 hidden sm:table-cell">Activité</th>
                      <th className="px-6 py-3 text-right">Options</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-white/10">
                    {filteredUsers.map((u) => (
                      <tr
                        key={u.id}
                        className="group hover:bg-white/[0.03] transition-colors"
                        onClick={() => setSelectedUser(u)}
                      >
                        <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(u.id)}
                            onChange={() => toggleSelectOne(u.id)}
                            className="accent-indigo-500"
                          />
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-xl bg-slate-800 flex items-center justify-center text-xs font-extrabold text-white border border-white/10">
                              {(u.email?.[0] || "?").toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate max-w-[220px]">
                                {u.displayName || u.email}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate max-w-[260px] font-mono">
                                {u.id.slice(0, 10)}…
                              </p>
                              <div className="mt-1 flex gap-2 flex-wrap">
                                {u.provider && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-slate-300">
                                    {u.provider}
                                  </span>
                                )}
                                {u.emailVerified && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-200">
                                    Vérifié
                                  </span>
                                )}
                                {safeLower(u.role) === "admin" && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-200 inline-flex items-center gap-1">
                                    <Crown className="h-3 w-3" />
                                    Admin
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4 hidden md:table-cell">
                          {u.blocked ? (
                            <Badge text="Bloqué" tone="red" icon={Ban} />
                          ) : (
                            <Badge text="Actif" tone="emerald" icon={CheckCircle2} />
                          )}
                        </td>

                        <td className="px-6 py-4 font-mono text-slate-200 text-xs">
                          <span className="bg-slate-950/50 border border-white/10 px-2 py-1 rounded-lg">
                            {u.credits ?? 0}
                          </span>
                        </td>

                        <td className="px-6 py-4 text-xs text-slate-400 hidden sm:table-cell">
                          <div className="flex items-center gap-2">
                            <span>{getCountryFlag(u.country)}</span>
                            <span>{formatRelative(u.lastSeenAt)}</span>
                          </div>
                        </td>

                        <td className="px-6 py-4 text-right">
                          <div className="p-2 rounded-lg inline-flex text-slate-600 group-hover:text-indigo-300 group-hover:bg-indigo-500/10 transition-all">
                            <MoreHorizontal className="h-4 w-4" />
                          </div>
                        </td>
                      </tr>
                    ))}

                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center text-slate-500 text-sm">
                          Aucun utilisateur.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB: ANALYTICS */}
        {activeTab === "analytics" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-sm">
                <h3 className="text-sm font-extrabold text-white mb-6 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-indigo-400" />
                  Flux de génération ({ANALYTICS_RANGES.find((r) => r.id === analyticsRange)?.label})
                </h3>
                <div className="h-[320px] w-full">
                  <canvas ref={lineRef} />
                </div>
                <p className="text-[11px] text-slate-500 mt-3">
                  Basé sur <span className="text-slate-300 font-bold">{usageLogs.length}</span> logs (limit 1200).
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-sm flex flex-col">
                <h3 className="text-sm font-extrabold text-white mb-6 flex items-center gap-2">
                  <Smartphone className="h-4 w-4 text-emerald-400" />
                  Appareils (récent)
                </h3>
                <div className="flex-1 flex items-center justify-center">
                  <div className="h-[220px] w-[220px]">
                    <canvas ref={pieRef} />
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* TAB: SECURITY */}
        {activeTab === "security" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="rounded-2xl border border-red-500/25 bg-red-950/10 p-6">
              <h3 className="text-sm font-extrabold text-red-100 mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Journal des Menaces (auth_failed)
              </h3>

              {securityLogs.length === 0 ? (
                <p className="text-xs text-slate-500 italic">Aucune menace détectée récemment.</p>
              ) : (
                <div className="space-y-2">
                  {securityLogs.slice(0, 60).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-red-950/20 border border-red-500/15"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-200">
                          <Lock className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-xs font-extrabold text-red-100">
                            {log.email || log.userId || "Inconnu"}
                          </p>
                          <p className="text-[10px] text-red-200/60 font-mono">
                            {log.action || log.type || log.eventType || "auth_failed"} • {log.id}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-[10px] text-slate-300">{formatRelative(log.createdAt ?? null)}</p>
                        <p className="text-[10px] text-slate-500">{log.ip ? `IP ${log.ip}` : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* TAB: SETTINGS */}
        {activeTab === "settings" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 backdrop-blur-sm">
              <h3 className="text-sm font-extrabold text-white mb-2 flex items-center gap-2">
                <Settings className="h-4 w-4 text-indigo-400" />
                Paramètres
              </h3>
              <p className="text-xs text-slate-500 mb-6">
                Les settings sont stockés dans <span className="font-mono text-slate-300">settings/app</span>.
              </p>

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-950/40 border border-white/10">
                <div>
                  <p className="text-sm font-extrabold text-white flex items-center gap-2">
                    <Server className="h-4 w-4 text-amber-300" />
                    Maintenance mode
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Quand ON, tu peux faire afficher un écran maintenance côté app (selon ton code).
                  </p>
                </div>

                <button
                  disabled={busy}
                  onClick={() => setMaintenance(!maintenanceMode)}
                  className={`px-4 py-2 rounded-xl border text-xs font-extrabold transition-all disabled:opacity-50 ${
                    maintenanceMode
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-200 hover:bg-amber-500/20"
                      : "bg-emerald-500/10 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/20"
                  }`}
                >
                  {maintenanceMode ? "Désactiver" : "Activer"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </main>

      {/* USER DRAWER */}
      <AnimatePresence>
        {selectedUser && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedUser(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#0b1224] border-l border-white/10 shadow-2xl flex flex-col"
            >
              {/* Drawer header */}
              <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between bg-slate-950/40">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-300">
                    <UserCog className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-white text-sm">Gestion Utilisateur</h3>
                    <p className="text-xs text-slate-500 font-mono">ID: {selectedUser.id.slice(0, 10)}…</p>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedUser(null)}
                  className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Drawer content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Identity */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Email</p>
                  <p className="text-sm font-bold text-white break-all">{selectedUser.email}</p>

                  <div className="mt-3 flex gap-2 flex-wrap">
                    <span className="text-[10px] px-2 py-1 rounded-lg bg-slate-900/60 text-slate-300 border border-white/10">
                      {selectedUser.provider || "Email"}
                    </span>

                    {selectedUser.emailVerified && (
                      <span className="text-[10px] px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-200 border border-emerald-500/20">
                        Vérifié
                      </span>
                    )}

                    {safeLower(selectedUser.role) === "admin" && (
                      <span className="text-[10px] px-2 py-1 rounded-lg bg-indigo-500/10 text-indigo-200 border border-indigo-500/20 inline-flex items-center gap-1">
                        <Crown className="h-3 w-3" />
                        Admin
                      </span>
                    )}

                    {selectedUser.blocked && (
                      <span className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 text-red-200 border border-red-500/20 inline-flex items-center gap-1">
                        <Ban className="h-3 w-3" />
                        Bloqué
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-3">
                    Actions rapides
                  </h4>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={toggleBlockUser}
                      disabled={busy}
                      className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50 ${
                        selectedUser.blocked
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/20"
                          : "bg-amber-500/10 border-amber-500/30 text-amber-200 hover:bg-amber-500/20"
                      }`}
                    >
                      {selectedUser.blocked ? <CheckCircle2 className="h-5 w-5" /> : <Ban className="h-5 w-5" />}
                      <span className="text-xs font-extrabold">
                        {selectedUser.blocked ? "Débloquer" : "Bloquer"}
                      </span>
                    </button>

                    <button
                      onClick={toggleAdminRole}
                      disabled={busy}
                      className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/25 text-indigo-200 hover:bg-indigo-500/20 flex flex-col items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                      <Crown className="h-5 w-5" />
                      <span className="text-xs font-extrabold">
                        {safeLower(selectedUser.role) === "admin" ? "Retirer Admin" : "Mettre Admin"}
                      </span>
                    </button>

                    <button
                      onClick={deleteUserDoc}
                      disabled={busy}
                      className="col-span-2 p-3 rounded-2xl bg-red-500/10 border border-red-500/25 text-red-200 hover:bg-red-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                      <Trash2 className="h-5 w-5" />
                      <span className="text-xs font-extrabold">Supprimer Doc Firestore</span>
                    </button>
                  </div>
                </div>

                {/* Credits */}
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-3">
                    Crédits
                  </h4>

                  <div className="space-y-3">
                    <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/10">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Set absolute</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={creditsAbs}
                          onChange={(e) => setCreditsAbs(e.target.value)}
                          className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/30 outline-none"
                        />
                        <button
                          onClick={updateCreditsAbsolute}
                          disabled={busy}
                          className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-extrabold flex items-center gap-2 transition-all disabled:opacity-50"
                          title="Save"
                        >
                          <Save className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-2">
                        Valeur actuelle:{" "}
                        <span className="font-mono text-slate-300">{selectedUser.credits ?? 0}</span>
                      </p>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-950/40 border border-white/10">
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Delta</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={creditsDelta}
                          onChange={(e) => setCreditsDelta(e.target.value)}
                          className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:ring-2 focus:ring-indigo-500/30 outline-none"
                          placeholder="ex: 10"
                        />
                        <button
                          onClick={() => applyCreditsDelta(1)}
                          disabled={busy}
                          className="px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                          title="Plus"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => applyCreditsDelta(-1)}
                          disabled={busy}
                          className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                          title="Minus"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-2">
                        Applique un delta et met à jour via Callable Function.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Technical details */}
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-3">
                    Détails techniques
                  </h4>

                  <div className="bg-slate-950/40 rounded-2xl border border-white/10 p-4 space-y-3">
                    <TechRow icon={Calendar} label="Création" value={formatDate(selectedUser.createdAt)} />
                    <TechRow icon={Activity} label="Dernière vue" value={formatRelative(selectedUser.lastSeenAt)} />
                    <TechRow
                      icon={Monitor}
                      label="Dernier device"
                      value={`${selectedUser.lastDeviceType || "?"} (${selectedUser.lastOs || "?"})`}
                    />
                    <TechRow icon={Globe} label="Dernière IP" value={selectedUser.lastIp || "Inconnue"} />
                    <TechRow icon={Globe} label="Pays / Ville" value={`${selectedUser.country || "?"} / ${selectedUser.city || "?"}`} />
                    <TechRow icon={FileStack} label="Total docs" value={String(selectedUser.totalDocumentsGenerated ?? 0)} />
                    <TechRow icon={FileStack} label="CV générés" value={String(selectedUser.totalCvGenerated ?? 0)} />
                    <TechRow icon={FileStack} label="LM générées" value={String(selectedUser.totalLmGenerated ?? 0)} />
                  </div>
                </div>

                {/* User activity */}
                <div>
                  <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider mb-3">
                    Activité récente (30)
                  </h4>

                  <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                    {loadingActivity ? (
                      <div className="text-xs text-slate-500">Chargement…</div>
                    ) : userActivity.length === 0 ? (
                      <div className="text-xs text-slate-500 italic">Aucun log trouvé.</div>
                    ) : (
                      <div className="space-y-2">
                        {userActivity.map((l) => {
                          const typeLike = (l.action || l.type || l.eventType || l.tool || "event").toString();
                          return (
                            <div
                              key={l.id}
                              className="flex items-center justify-between gap-3 p-3 rounded-xl border border-white/10 bg-white/5"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-200 truncate">
                                  {typeLike}
                                  {l.docType ? <span className="text-slate-500"> • {l.docType}</span> : null}
                                </p>
                                <p className="text-[10px] text-slate-500 font-mono truncate">{l.id}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-[10px] text-slate-400">{formatRelative(l.createdAt ?? null)}</p>
                                {l.ip ? <p className="text-[10px] text-slate-600">IP {l.ip}</p> : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Drawer footer */}
              <div className="p-4 border-t border-white/10 bg-slate-950/40 text-center">
                <p className="text-[10px] text-slate-500">Actions sensibles via Callable Functions recommandé.</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------- UI COMPONENTS ---------------- */

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: any;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 ${
        active ? "bg-indigo-600 text-white shadow-lg shadow-indigo-900/20" : "text-slate-400 hover:text-white"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: any;
  tone: "blue" | "amber" | "emerald" | "red";
}) {
  const toneMap = {
    blue: "border-blue-500/25 bg-blue-500/10 text-blue-200",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    red: "border-red-500/25 bg-red-500/10 text-red-200",
  } as const;

  const toneIcon = {
    blue: "text-blue-300",
    amber: "text-amber-300",
    emerald: "text-emerald-300",
    red: "text-red-300",
  } as const;

  return (
    <div className={`p-5 rounded-2xl border ${toneMap[tone]} flex flex-col justify-between`}>
      <div className="flex justify-between items-start mb-3">
        <div className={`p-2 rounded-xl bg-white/5 border border-white/10 ${toneIcon[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div>
        <p className="text-2xl font-extrabold text-white tracking-tight">{value}</p>
        <p className="text-[10px] font-extrabold uppercase tracking-wider opacity-80">{label}</p>
      </div>
    </div>
  );
}

function Badge({ text, tone, icon: Icon }: { text: string; tone: "red" | "emerald"; icon: any }) {
  const style =
    tone === "red"
      ? "bg-red-500/10 text-red-200 border-red-500/20"
      : "bg-emerald-500/10 text-emerald-200 border-emerald-500/20";

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold border ${style}`}>
      <Icon className="h-3.5 w-3.5" />
      {text}
    </span>
  );
}

function TechRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-2 text-slate-400">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <span className="text-slate-200 font-mono text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}

function getSortValue(u: AdminUser, key: "createdAt" | "lastSeenAt" | "credits" | "docs") {
  if (key === "createdAt") return u.createdAt ?? 0;
  if (key === "lastSeenAt") return u.lastSeenAt ?? 0;
  if (key === "credits") return u.credits ?? 0;
  return u.totalDocumentsGenerated ?? 0;
}