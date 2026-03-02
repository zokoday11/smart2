"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  QueryDocumentSnapshot,
  DocumentData,
  onSnapshot,
  where,
} from "firebase/firestore";
import { useAdminGuard } from "@/hooks/useAdminGuard";
import {
  FileText,
  Zap,
  LogIn,
  AlertCircle,
  Search,
  X,
  ChevronRight,
  Activity,
  Database,
  Copy,
  Download,
  RefreshCcw,
  Radio,
  Filter,
  Clock3,
} from "lucide-react";

// ---------------- TYPES ----------------

type UsageLogRow = {
  id: string;
  userId: string;
  email?: string | null;
  action?: string | null;
  type?: string | null; // fallback
  eventType?: string | null;
  docType?: string | null;
  tool?: string | null;
  path?: string | null;
  createdAtMs?: number | null;
  meta?: any;
};

// ---------------- HELPERS ----------------

function normalizeDateMs(v: any): number | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate().getTime();
  if (typeof v === "number") return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function formatDateTime(ms?: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeLower(s: any) {
  return String(s ?? "").toLowerCase();
}

function copyToClipboard(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {}
}

function getLogIcon(typeLike: string) {
  const t = safeLower(typeLike);
  if (t.includes("error") || t.includes("fail")) return <AlertCircle className="h-4 w-4 text-red-400" />;
  if (t.includes("login") || t.includes("auth")) return <LogIn className="h-4 w-4 text-emerald-400" />;
  if (t.includes("ai") || t.includes("generate")) return <Zap className="h-4 w-4 text-amber-400" />;
  if (t.includes("cv") || t.includes("lm")) return <FileText className="h-4 w-4 text-blue-400" />;
  return <Activity className="h-4 w-4 text-slate-400" />;
}

function getLogColor(typeLike: string) {
  const t = safeLower(typeLike);
  if (t.includes("error") || t.includes("fail")) return "bg-red-500/10 border-red-500/20 text-red-200";
  if (t.includes("login") || t.includes("auth")) return "bg-emerald-500/10 border-emerald-500/20 text-emerald-200";
  if (t.includes("ai") || t.includes("generate")) return "bg-amber-500/10 border-amber-500/20 text-amber-200";
  if (t.includes("cv") || t.includes("lm")) return "bg-blue-500/10 border-blue-500/20 text-blue-200";
  return "bg-slate-500/10 border-slate-500/20 text-slate-200";
}

function buildDownloadJson(filename: string, obj: any) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------- COMPONENT ----------------

const PAGE_SIZE = 200;

const PRESET_RANGES = [
  { id: "24h", label: "24h", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "7j", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "30d", label: "30j", ms: 30 * 24 * 60 * 60 * 1000 },
  { id: "all", label: "Tout", ms: null as number | null },
];

export default function AdminLogsPage() {
  const { loading, isAdmin } = useAdminGuard();

  const [logs, setLogs] = useState<UsageLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [selectedLog, setSelectedLog] = useState<UsageLogRow | null>(null);

  // UI filters
  const [search, setSearch] = useState("");
  const [realtime, setRealtime] = useState(false);

  const [rangeId, setRangeId] = useState<"24h" | "7d" | "30d" | "all">("7d");
  const [typeChips, setTypeChips] = useState<string[]>([]); // multi-select
  const [docTypeFilter, setDocTypeFilter] = useState<string>(""); // cv/lm/other
  const [toolFilter, setToolFilter] = useState<string>(""); // generateCvPdf etc.
  const [eventTypeFilter, setEventTypeFilter] = useState<string>(""); // generate, auth_failed, etc.

  // pagination
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);

  // Build query constraints for server-side filtering (range only)
  const rangeStartMs = useMemo(() => {
    const preset = PRESET_RANGES.find((r) => r.id === rangeId);
    if (!preset || !preset.ms) return null;
    return Date.now() - preset.ms;
  }, [rangeId]);

  const fetchPage = async (reset = false) => {
    setLoadingLogs(true);
    try {
      const col = collection(db, "usageLogs");
      const constraints: any[] = [orderBy("createdAt", "desc"), limit(PAGE_SIZE)];

      if (rangeStartMs) {
        // serverTimestamp stored in createdAtServer ? -> toi tu as createdAt (number) + createdAtServer
        // Ici on filtre sur createdAt (number) si tu le remplis, sinon enlève where.
        constraints.unshift(where("createdAt", ">=", rangeStartMs));
      }

      let q = query(col, ...constraints);

      if (!reset && lastDoc) {
        q = query(col, ...constraints, startAfter(lastDoc));
      }

      const snap = await getDocs(q);

      const rows: UsageLogRow[] = snap.docs.map((d) => {
        const data: any = d.data();
        const createdAtMs =
          typeof data.createdAt === "number"
            ? data.createdAt
            : normalizeDateMs(data.createdAtServer) || normalizeDateMs(data.createdAt) || null;

        return {
          id: d.id,
          userId: data.userId ?? "—",
          email: data.email ?? null,
          action: data.action ?? null,
          type: data.type ?? null,
          eventType: data.eventType ?? data.event_type ?? null,
          docType: data.docType ?? null,
          tool: data.tool ?? null,
          path: data.path ?? null,
          createdAtMs,
          meta: data.meta ?? data.metadata ?? {},
        };
      });

      const newLast = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
      setLastDoc(newLast);

      if (reset) setLogs(rows);
      else setLogs((prev) => [...prev, ...rows]);

      setHasMore(snap.docs.length === PAGE_SIZE);
    } catch (e) {
      console.error("Erreur fetch logs:", e);
    } finally {
      setLoadingLogs(false);
    }
  };

  // realtime listener (optional)
  useEffect(() => {
    if (!isAdmin || loading) return;
    if (!realtime) return;

    setLoadingLogs(true);

    const col = collection(db, "usageLogs");
    const constraints: any[] = [orderBy("createdAt", "desc"), limit(PAGE_SIZE)];

    if (rangeStartMs) constraints.unshift(where("createdAt", ">=", rangeStartMs));

    const q = query(col, ...constraints);

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: UsageLogRow[] = snap.docs.map((d) => {
          const data: any = d.data();
          const createdAtMs =
            typeof data.createdAt === "number"
              ? data.createdAt
              : normalizeDateMs(data.createdAtServer) || normalizeDateMs(data.createdAt) || null;

          return {
            id: d.id,
            userId: data.userId ?? "—",
            email: data.email ?? null,
            action: data.action ?? null,
            type: data.type ?? null,
            eventType: data.eventType ?? data.event_type ?? null,
            docType: data.docType ?? null,
            tool: data.tool ?? null,
            path: data.path ?? null,
            createdAtMs,
            meta: data.meta ?? data.metadata ?? {},
          };
        });

        setLogs(rows);
        setLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
        setHasMore(false); // realtime = on ne pagine pas ici
        setLoadingLogs(false);
      },
      (err) => {
        console.error("Realtime logs error:", err);
        setLoadingLogs(false);
      }
    );

    return () => unsub();
  }, [isAdmin, loading, realtime, rangeStartMs]);

  // initial fetch / range changes
  useEffect(() => {
    if (!isAdmin || loading) return;
    if (realtime) return;
    setLastDoc(null);
    setHasMore(true);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, loading, rangeStartMs, realtime]);

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      const t = (l.type || l.action || l.eventType || "").trim();
      if (t) set.add(t);
    });
    return Array.from(set).slice(0, 20);
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const s = safeLower(search);

    return logs.filter((l) => {
      const typeLike = (l.type || l.action || l.eventType || "").trim();

      // local filters
      if (typeChips.length > 0 && !typeChips.includes(typeLike)) return false;
      if (docTypeFilter && safeLower(l.docType) !== safeLower(docTypeFilter)) return false;
      if (toolFilter && safeLower(l.tool) !== safeLower(toolFilter)) return false;
      if (eventTypeFilter && safeLower(l.eventType) !== safeLower(eventTypeFilter)) return false;

      if (!s) return true;

      return (
        safeLower(typeLike).includes(s) ||
        safeLower(l.email).includes(s) ||
        safeLower(l.userId).includes(s) ||
        safeLower(l.id).includes(s) ||
        safeLower(l.path).includes(s) ||
        safeLower(JSON.stringify(l.meta)).includes(s)
      );
    });
  }, [logs, search, typeChips, docTypeFilter, toolFilter, eventTypeFilter]);

  if (loading) return null;
  if (!isAdmin) return null;

  const exportFiltered = () => {
    const payload = filteredLogs.map((l) => ({
      ...l,
      createdAt: l.createdAtMs ? new Date(l.createdAtMs).toISOString() : null,
    }));
    buildDownloadJson(`usageLogs_${new Date().toISOString().slice(0, 10)}.json`, payload);
  };

  const resetFilters = () => {
    setSearch("");
    setTypeChips([]);
    setDocTypeFilter("");
    setToolFilter("");
    setEventTypeFilter("");
    setRangeId("7d");
  };

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-slate-200 font-sans">
      {/* HEADER */}
      <div className="sticky top-0 z-20 bg-[#0A0A0B]/80 backdrop-blur-xl border-b border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Database className="h-5 w-5 text-indigo-400" />
                Audit Logs
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Logs système (filtrage local + pagination). Realtime optionnel.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Realtime toggle */}
              <button
                onClick={() => setRealtime((v) => !v)}
                className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                  realtime
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                    : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                }`}
              >
                <Radio className="h-4 w-4" />
                Realtime {realtime ? "ON" : "OFF"}
              </button>

              <button
                onClick={exportFiltered}
                className="px-3 py-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-indigo-200 text-xs font-bold flex items-center gap-2 hover:bg-indigo-500/20 transition-all"
              >
                <Download className="h-4 w-4" />
                Export JSON
              </button>

              <button
                onClick={resetFilters}
                className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-300 text-xs font-bold flex items-center gap-2 hover:bg-white/10 transition-all"
              >
                <RefreshCcw className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>

          {/* Filters row */}
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search (email, uid, type, path, json...)"
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none transition-all placeholder:text-slate-600"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Range */}
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-slate-500" />
              <div className="flex gap-2">
                {PRESET_RANGES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRangeId(r.id as any)}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold transition-all ${
                      rangeId === r.id
                        ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-200"
                        : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Extra selects */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Filter className="h-4 w-4" />
                Filtres :
              </div>

              <select
                value={docTypeFilter}
                onChange={(e) => setDocTypeFilter(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none"
              >
                <option value="">docType (all)</option>
                <option value="cv">cv</option>
                <option value="lm">lm</option>
                <option value="other">other</option>
              </select>

              <input
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                placeholder="tool (ex: generateCvPdf)"
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
              />

              <input
                value={eventTypeFilter}
                onChange={(e) => setEventTypeFilter(e.target.value)}
                placeholder="eventType (ex: auth_failed)"
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* Type chips */}
          {availableTypes.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {availableTypes.map((t) => {
                const active = typeChips.includes(t);
                return (
                  <button
                    key={t}
                    onClick={() =>
                      setTypeChips((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
                    }
                    className={`px-3 py-1.5 rounded-full border text-[11px] font-bold transition-all ${
                      active
                        ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-200"
                        : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* CONTENT */}
      <main className="p-6">
        <div className="max-w-7xl mx-auto">
          <div className="rounded-2xl border border-white/10 bg-[#12131A] shadow-sm overflow-hidden">
            {loadingLogs ? (
              <div className="p-12 text-center text-slate-400">
                <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full mx-auto mb-2" />
                Chargement...
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-slate-400">Aucun résultat.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-black/30 text-slate-400 text-xs uppercase tracking-wider font-bold">
                    <tr>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Utilisateur</th>
                      <th className="px-6 py-3 hidden md:table-cell">Meta</th>
                      <th className="px-6 py-3 text-right">Détails</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {filteredLogs.map((log) => {
                      const typeLike = (log.type || log.action || log.eventType || "—").trim();
                      return (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedLog(log)}
                          className="group hover:bg-white/[0.03] transition-colors cursor-pointer"
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-slate-400 text-xs font-mono">
                            {formatDateTime(log.createdAtMs)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${getLogColor(
                                typeLike
                              )}`}
                            >
                              {getLogIcon(typeLike)}
                              {typeLike}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="font-medium text-white">{log.email || "Anonyme"}</span>
                              <span className="text-[10px] text-slate-500 font-mono">{(log.userId || "—").slice(0, 10)}…</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 hidden md:table-cell text-xs text-slate-400">
                            <div className="line-clamp-1 font-mono opacity-80">
                              {JSON.stringify(log.meta || {}).slice(0, 140)}
                              {JSON.stringify(log.meta || {}).length > 140 ? "…" : ""}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <button className="p-2 rounded-lg text-slate-500 hover:text-indigo-300 hover:bg-white/5 transition-colors">
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!realtime && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Affichage : {filteredLogs.length} / {logs.length} (page size {PAGE_SIZE})
              </p>
              <button
                disabled={loadingLogs || !hasMore}
                onClick={() => fetchPage(false)}
                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-slate-200 text-xs font-bold hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {hasMore ? "Charger plus" : "Fin"}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* SLIDE-OVER DETAIL PANEL */}
      <AnimatePresence>
        {selectedLog && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLog(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-[#0B0C10] border-l border-white/10 shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                <div>
                  <h3 className="font-bold text-white text-lg">Détail du Log</h3>
                  <p className="text-xs text-slate-500 font-mono">{selectedLog.id}</p>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  <InfoBox label="Date" value={formatDateTime(selectedLog.createdAtMs)} />
                  <InfoBox
                    label="Type"
                    value={(selectedLog.type || selectedLog.action || selectedLog.eventType || "—").trim()}
                  />
                  <InfoBox label="UID" value={selectedLog.userId || "—"} mono />
                  <InfoBox label="Email" value={selectedLog.email || "—"} />
                  <InfoBox label="docType" value={selectedLog.docType || "—"} />
                  <InfoBox label="tool" value={selectedLog.tool || "—"} />
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => copyToClipboard(selectedLog.id)}
                    className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 text-xs font-bold text-slate-200 hover:bg-white/10 flex items-center gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy Log ID
                  </button>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(selectedLog.meta || {}, null, 2))}
                    className="px-3 py-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 text-xs font-bold text-indigo-200 hover:bg-indigo-500/20 flex items-center gap-2"
                  >
                    <Copy className="h-4 w-4" />
                    Copy JSON
                  </button>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
                    <Activity className="h-4 w-4 text-indigo-400" />
                    Métadonnées (JSON)
                  </h4>
                  <pre className="bg-[#0f172a] text-slate-200 p-4 rounded-xl text-xs font-mono overflow-x-auto border border-white/10 leading-relaxed">
                    {JSON.stringify(selectedLog.meta || {}, null, 2)}
                  </pre>
                </div>
              </div>

              <div className="p-4 border-t border-white/10 bg-white/5 text-center">
                <p className="text-[10px] text-slate-500">Audit log système.</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function InfoBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="p-3 rounded-xl bg-white/5 border border-white/10">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xs text-white ${mono ? "font-mono break-all" : "break-words"}`}>{value}</p>
    </div>
  );
}
