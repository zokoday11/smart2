"use client";

import React, { useEffect, useMemo, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

// Icons
import {
  Briefcase,
  Calendar,
  MapPin,
  Globe,
  FileText,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  X,
  ExternalLink,
  Edit3,
  Trash2,
  ChevronRight,
  Zap,
  Send,
  ChevronLeft,
  Filter,
  Loader2,
} from "lucide-react";

// --- TYPES ---
type ApplicationStatus = "todo" | "sent" | "interview" | "offer" | "rejected";

type Application = {
  id: string;
  userId: string;
  company: string;
  jobTitle: string;
  status: ApplicationStatus;

  location?: string;
  contract?: string;
  source?: string;
  jobLink?: string;

  createdAt?: Date | null;
  updatedAt?: Date | null;
  lastActionDate?: Date | null;

  notes?: string;

  fromAutoCreate?: boolean;
  hasCv?: boolean;
  hasLm?: boolean;
  hasPitch?: boolean;

  interviewAt?: Date | null;
};

type AppDraft = Partial<Omit<Application, "createdAt" | "updatedAt" | "lastActionDate" | "interviewAt">> & {
  id?: string;
  interviewAt?: string; // datetime-local string
  status?: ApplicationStatus;
};

// --- CONSTANTS ---
const ITEMS_PER_PAGE = 6;
const VALID_STATUSES: ApplicationStatus[] = ["todo", "sent", "interview", "offer", "rejected"];

const STATUS_CONFIG: Record<
  ApplicationStatus,
  { label: string; color: string; border: string; bg: string; icon: any }
> = {
  todo: { label: "À faire", color: "text-slate-400", border: "border-slate-500/20", bg: "bg-slate-500/10", icon: Clock },
  sent: { label: "Envoyée", color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/10", icon: Send },
  interview: { label: "Entretien", color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/10", icon: Calendar },
  offer: { label: "Offre", color: "text-emerald-400", border: "border-emerald-500/20", bg: "bg-emerald-500/10", icon: CheckCircle2 },
  rejected: { label: "Refus", color: "text-red-400", border: "border-red-500/20", bg: "bg-red-500/10", icon: X },
};

// --- HELPERS ---
const safeText = (v: any) => String(v ?? "").trim();

const formatDate = (d?: Date | null) =>
  d ? d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "—";

const formatDateTime = (d?: Date | null) =>
  d
    ? d.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

const toInputDateTimeLocal = (d?: Date | null) => {
  if (!d) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const parseDateTimeLocal = (v?: string) => {
  const s = safeText(v);
  if (!s) return null;
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
};

const StatusBadge = ({ status }: { status: string }) => {
  const safeStatus = (VALID_STATUSES.includes(status as ApplicationStatus) ? status : "todo") as ApplicationStatus;
  const conf = STATUS_CONFIG[safeStatus];
  const Icon = conf.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${conf.border} ${conf.bg} ${conf.color}`}
    >
      <Icon className="w-3 h-3" />
      {conf.label}
    </span>
  );
};

const KpiCard = ({ title, value, icon: Icon, color }: any) => (
  <div className="bg-[#16181D] border border-white/5 p-4 rounded-2xl flex items-center justify-between shadow-lg">
    <div>
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{title}</p>
      <p className="text-2xl font-mono font-bold text-white mt-1">{value}</p>
    </div>
    <div className={`p-2.5 rounded-xl bg-white/5 ${color}`}>
      <Icon className="w-5 h-5" />
    </div>
  </div>
);

const InputGroup = ({ label, children }: any) => (
  <div className="space-y-1.5">
    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1 tracking-wider">{label}</label>
    {children}
  </div>
);

function normalizeStatus(raw: any): ApplicationStatus {
  return VALID_STATUSES.includes(raw as ApplicationStatus) ? (raw as ApplicationStatus) : "todo";
}

function appFromFirestore(id: string, data: any): Application {
  return {
    id,
    userId: data.userId,
    company: data.company || "",
    jobTitle: data.jobTitle || "",
    status: normalizeStatus(data.status),

    location: data.location || "",
    contract: data.contract || "",
    source: data.source || "",
    jobLink: data.jobLink || "",

    notes: data.notes || "",

    fromAutoCreate: !!data.fromAutoCreate,
    hasCv: !!data.hasCv,
    hasLm: !!data.hasLm,
    hasPitch: !!data.hasPitch,

    createdAt: data.createdAt?.toDate?.() ?? null,
    updatedAt: data.updatedAt?.toDate?.() ?? null,
    lastActionDate: data.lastActionDate?.toDate?.() ?? null,
    interviewAt: data.interviewAt?.toDate?.() ?? null,
  };
}

// --- MAIN PAGE ---
export default function TrackerPage() {
  const [user, setUser] = useState<User | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [currentPage, setCurrentPage] = useState(1);

  // Slide-over (Edit/Create)
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [draft, setDraft] = useState<AppDraft>({ status: "todo" });
  const [isSaving, setIsSaving] = useState(false);

  // Init Data
  useEffect(() => {
    let unsubApps: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u ?? null);

      // cleanup previous listener
      if (unsubApps) {
        unsubApps();
        unsubApps = null;
      }

      if (!u) {
        setApps([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const qRef = query(
        collection(db, "applications"),
        where("userId", "==", u.uid),
        orderBy("createdAt", "desc")
      );

      unsubApps = onSnapshot(
        qRef,
        (snap) => {
          const list = snap.docs.map((d) => appFromFirestore(d.id, d.data()));
          setApps(list);
          setLoading(false);
        },
        (err) => {
          console.error("onSnapshot applications error:", err);
          setLoading(false);
        }
      );
    });

    return () => {
      if (unsubApps) unsubApps();
      unsubAuth();
    };
  }, []);

  // Filter Logic
  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((a) => {
      const hay = `${a.company} ${a.jobTitle}`.toLowerCase();
      const matchSearch = !q || hay.includes(q);
      const matchStatus = statusFilter === "all" || a.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [apps, search, statusFilter]);

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredApps.length / ITEMS_PER_PAGE));
  const paginatedApps = filteredApps.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  // Stats
  const stats = useMemo(() => {
    const total = apps.length;
    const interview = apps.filter((a) => a.status === "interview").length;
    const offer = apps.filter((a) => a.status === "offer").length;
    const active = apps.filter((a) => ["sent", "interview", "offer"].includes(a.status)).length;
    return { total, interview, offer, active };
  }, [apps]);

  const nextInterviews = useMemo(() => {
    const now = new Date();
    return apps
      .filter((a) => a.interviewAt && a.interviewAt.getTime() > now.getTime())
      .sort((a, b) => (a.interviewAt!.getTime() - b.interviewAt!.getTime()))
      .slice(0, 3);
  }, [apps]);

  // Actions
  const closePanel = () => setIsPanelOpen(false);

  const openCreate = () => {
    setDraft({ status: "todo", company: "", jobTitle: "", interviewAt: "" });
    setIsPanelOpen(true);
  };

  const openEdit = (app: Application) => {
    setDraft({
      id: app.id,
      company: app.company,
      jobTitle: app.jobTitle,
      status: app.status,
      location: app.location || "",
      contract: app.contract || "",
      source: app.source || "",
      jobLink: app.jobLink || "",
      notes: app.notes || "",
      hasCv: !!app.hasCv,
      hasLm: !!app.hasLm,
      hasPitch: !!app.hasPitch,
      interviewAt: app.interviewAt ? toInputDateTimeLocal(app.interviewAt) : "",
    });
    setIsPanelOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const company = safeText(draft.company);
    const jobTitle = safeText(draft.jobTitle);
    if (!company || !jobTitle) return;

    setIsSaving(true);

    try {
      const interviewDate = parseDateTimeLocal(draft.interviewAt);
      const payload: any = {
        userId: user.uid,
        company,
        jobTitle,
        status: normalizeStatus(draft.status || "todo"),
        location: safeText(draft.location),
        contract: safeText(draft.contract),
        source: safeText(draft.source),
        jobLink: safeText(draft.jobLink),
        notes: safeText(draft.notes),

        hasCv: !!draft.hasCv,
        hasLm: !!draft.hasLm,
        hasPitch: !!draft.hasPitch,

        interviewAt: interviewDate ? Timestamp.fromDate(interviewDate) : null,
        updatedAt: serverTimestamp(),
      };

      if (draft.id) {
        await updateDoc(doc(db, "applications", draft.id), payload);
      } else {
        await addDoc(collection(db, "applications"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      closePanel();
    } catch (err) {
      console.error("Save application error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const ok = window.confirm("Supprimer cette candidature ?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "applications", id));
      if (draft.id === id) closePanel();
    } catch (err) {
      console.error("Delete application error:", err);
    }
  };

  // Pagination component
  const Pagination = () => {
    if (totalPages <= 1) return null;

    const getPageNumbers = () => {
      const pages: Array<number | "..."> = [];
      const delta = 1;

      pages.push(1);

      const rangeStart = Math.max(2, currentPage - delta);
      const rangeEnd = Math.min(totalPages - 1, currentPage + delta);

      if (rangeStart > 2) pages.push("...");
      for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
      if (rangeEnd < totalPages - 1) pages.push("...");

      if (totalPages > 1) pages.push(totalPages);
      return pages;
    };

    return (
      <div className="flex items-center justify-center gap-2 mt-8 pt-4 border-t border-white/5">
        <button
          type="button"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage === 1}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Page précédente"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1">
          {getPageNumbers().map((p, idx) =>
            p === "..." ? (
              <span key={`dots-${idx}`} className="text-slate-600 text-xs px-2">
                ...
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => setCurrentPage(Number(p))}
                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                  currentPage === p
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
                aria-current={currentPage === p ? "page" : undefined}
              >
                {p}
              </button>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          disabled={currentPage === totalPages}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Page suivante"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="flex items-center gap-3 text-blue-500 font-mono text-sm">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping" />
          CHARGEMENT...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-slate-200 font-sans selection:bg-blue-500/30 p-4 lg:p-8">
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap");
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .glass-panel {
          background: rgba(22, 24, 29, 0.7);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
      `}</style>

      <div className="max-w-7xl mx-auto space-y-8">
        {/* HEADER & KPI */}
        <header className="space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                <Briefcase className="h-6 w-6 text-blue-500" />
                SUIVI CANDIDATURES
              </h1>
              <p className="text-xs text-slate-500 font-mono mt-1 uppercase tracking-widest">
                Dashboard // {user?.email || "—"}
              </p>
            </div>

            <button
              type="button"
              onClick={openCreate}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-900/20 flex items-center gap-2 transition-all hover:scale-105"
            >
              <Plus className="h-4 w-4" /> Nouvelle Candidature
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Suivi" value={stats.total} icon={FileText} color="text-slate-400" />
            <KpiCard title="En Cours" value={stats.active} icon={Zap} color="text-blue-400" />
            <KpiCard title="Entretiens" value={stats.interview} icon={Calendar} color="text-amber-400" />
            <KpiCard title="Offres" value={stats.offer} icon={CheckCircle2} color="text-emerald-400" />
          </div>
        </header>

        {/* MAIN LAYOUT */}
        <div className="grid lg:grid-cols-[1fr,340px] gap-8">
          {/* LISTE */}
          <section className="flex flex-col min-h-[600px]">
            {/* TOOLBAR */}
            <div className="sticky top-4 z-20 glass-panel p-2 rounded-2xl flex flex-col sm:flex-row gap-3 items-center justify-between shadow-xl mb-4">
              <div className="flex items-center bg-slate-950/50 border border-white/10 rounded-xl px-3 py-2.5 w-full sm:w-auto flex-1 max-w-md">
                <Search className="h-4 w-4 text-slate-500 mr-2" />
                <input
                  className="bg-transparent border-none outline-none text-sm text-white w-full placeholder:text-slate-600"
                  placeholder="Rechercher une entreprise, un poste..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="flex gap-1 overflow-x-auto pb-1 sm:pb-0 w-full sm:w-auto custom-scrollbar">
                {(["all", "todo", "sent", "interview", "offer", "rejected"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${
                      statusFilter === s
                        ? "bg-white text-slate-900 shadow-md"
                        : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    }`}
                  >
                    {s === "all" ? "Tout" : STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* LIST */}
            <div className="flex-1 space-y-3">
              <AnimatePresence mode="popLayout">
                {paginatedApps.map((app) => (
                  <motion.div
                    key={app.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    onClick={() => openEdit(app)}
                    className="group relative bg-[#16181D] border border-white/5 hover:border-blue-500/30 rounded-2xl p-5 transition-all cursor-pointer hover:shadow-lg hover:shadow-black/50"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") openEdit(app);
                    }}
                  >
                    <div className="flex justify-between items-start mb-3 gap-4">
                      <div className="min-w-0">
                        <h3 className="font-bold text-white text-lg truncate">{app.jobTitle}</h3>
                        <p className="text-sm text-blue-400 font-medium flex flex-wrap items-center gap-2 mt-0.5">
                          <span className="truncate">{app.company}</span>
                          {app.location ? (
                            <span className="text-slate-600 text-xs font-normal flex items-center gap-1">
                              • <MapPin className="h-3 w-3" /> {app.location}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <StatusBadge status={app.status} />
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500 font-mono flex-wrap">
                      <span>AJOUTÉ LE {formatDate(app.createdAt)}</span>
                      {app.interviewAt ? (
                        <span className="text-amber-400 flex items-center gap-1.5 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                          <Calendar className="h-3 w-3" />
                          {formatDateTime(app.interviewAt)}
                        </span>
                      ) : null}
                    </div>

                    <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                      {app.jobLink ? (
                        <a
                          href={app.jobLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors border border-transparent hover:border-white/10"
                          aria-label="Ouvrir l'offre"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : null}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openEdit(app);
                        }}
                        className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-blue-400 transition-colors border border-transparent hover:border-white/10"
                        aria-label="Modifier"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* IA Badges */}
                    <div className="absolute top-4 right-20 sm:top-auto sm:bottom-4 sm:right-4 flex gap-1.5 justify-end pointer-events-none">
                      {app.hasCv ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          CV
                        </span>
                      ) : null}
                      {app.hasLm ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          LM
                        </span>
                      ) : null}
                      {app.hasPitch ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          PITCH
                        </span>
                      ) : null}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {filteredApps.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-white/5 rounded-2xl flex flex-col items-center gap-4">
                  <div className="p-4 rounded-full bg-white/5">
                    <Filter className="w-6 h-6 text-slate-500" />
                  </div>
                  <p className="text-sm text-slate-500 font-mono uppercase">Aucune candidature trouvée</p>
                </div>
              ) : null}
            </div>

            <Pagination />
          </section>

          {/* SIDEBAR */}
          <aside className="space-y-6">
            <div className="glass-panel rounded-3xl p-6 sticky top-24">
              <h3 className="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2 mb-6">
                <Calendar className="h-4 w-4 text-amber-500" />
                Agenda Entretiens
              </h3>

              <div className="space-y-3">
                {nextInterviews.length > 0 ? (
                  nextInterviews.map((app) => (
                    <div
                      key={app.id}
                      onClick={() => openEdit(app)}
                      className="p-3.5 rounded-xl bg-white/5 border border-white/5 hover:border-amber-500/30 hover:bg-white/10 cursor-pointer transition-all group"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openEdit(app);
                      }}
                    >
                      <div className="flex justify-between items-start mb-1.5">
                        <span className="text-amber-400 font-mono text-xs font-bold bg-amber-500/10 px-1.5 py-0.5 rounded">
                          {app.interviewAt ? formatDateTime(app.interviewAt).split(" ")[0] : ""}{" "}
                          <span className="text-amber-200/60 ml-1">
                            {app.interviewAt ? formatDateTime(app.interviewAt).split(" ")[1] : ""}
                          </span>
                        </span>
                        <ChevronRight className="h-3 w-3 text-slate-600 group-hover:text-white" />
                      </div>
                      <p className="font-bold text-sm text-white line-clamp-1">{app.company}</p>
                      <p className="text-xs text-slate-500 line-clamp-1">{app.jobTitle}</p>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-6">
                    <p className="text-xs text-slate-600 italic">Aucun entretien à venir.</p>
                    <p className="text-[10px] text-slate-700 mt-1">C'est calme... trop calme.</p>
                  </div>
                )}
              </div>

              <div className="mt-8 pt-6 border-t border-white/5">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Statistiques</h3>

                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-400">Entretiens / Candidatures</span>
                      <span className="text-white font-mono">
                        {stats.interview}/{stats.total}
                      </span>
                    </div>
                    <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-amber-500 h-full"
                        style={{ width: `${(stats.interview / (stats.total || 1)) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1.5">
                      <span className="text-slate-400">CV Optimisés IA</span>
                      <span className="text-white font-mono">{apps.filter((a) => a.hasCv).length}</span>
                    </div>
                    <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-500 h-full"
                        style={{ width: `${(apps.filter((a) => a.hasCv).length / (apps.length || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* SLIDE-OVER EDIT PANEL */}
      <AnimatePresence>
        {isPanelOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closePanel}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed right-0 top-0 h-full w-full max-w-lg bg-[#0F1115] border-l border-white/10 shadow-2xl z-50 flex flex-col"
              role="dialog"
              aria-modal="true"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-[#16181D]">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  {draft.id ? <Edit3 className="w-5 h-5 text-blue-500" /> : <Plus className="w-5 h-5 text-emerald-500" />}
                  {draft.id ? "Modifier Candidature" : "Nouvelle Candidature"}
                </h2>

                <button
                  type="button"
                  onClick={closePanel}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  aria-label="Fermer"
                >
                  <X className="h-5 w-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {/* STATUS SELECTOR */}
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Statut Actuel</label>

                  <div className="grid grid-cols-5 gap-2 p-1.5 bg-[#0A0A0B] rounded-2xl border border-white/5">
                    {(Object.keys(STATUS_CONFIG) as ApplicationStatus[]).map((s) => {
                      const isActive = draft.status === s;
                      const conf = STATUS_CONFIG[s];
                      const Icon = conf.icon;

                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, status: s }))}
                          className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl transition-all relative ${
                            isActive ? "bg-white/10 text-white shadow-md" : "text-slate-600 hover:text-slate-300 hover:bg-white/5"
                          }`}
                          title={conf.label}
                        >
                          <Icon className={`h-5 w-5 ${isActive ? conf.color.split(" ")[0] : "currentColor"}`} />
                          {isActive ? (
                            <div className={`absolute -bottom-1 w-1 h-1 rounded-full ${conf.color.split(" ")[0].replace("text", "bg")}`} />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="text-center">
                    {draft.status ? (
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full border ${STATUS_CONFIG[draft.status].color} ${STATUS_CONFIG[draft.status].bg} ${STATUS_CONFIG[draft.status].border}`}
                      >
                        {STATUS_CONFIG[draft.status].label}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-5">
                  <InputGroup label="Entreprise">
                    <input
                      required
                      className="cyber-input"
                      value={draft.company || ""}
                      onChange={(e) => setDraft((p) => ({ ...p, company: e.target.value }))}
                      placeholder="Ex: Google"
                    />
                  </InputGroup>

                  <InputGroup label="Poste">
                    <input
                      required
                      className="cyber-input"
                      value={draft.jobTitle || ""}
                      onChange={(e) => setDraft((p) => ({ ...p, jobTitle: e.target.value }))}
                      placeholder="Ex: Frontend Dev"
                    />
                  </InputGroup>

                  <div className="grid grid-cols-2 gap-4">
                    <InputGroup label="Lieu">
                      <input
                        className="cyber-input"
                        value={draft.location || ""}
                        onChange={(e) => setDraft((p) => ({ ...p, location: e.target.value }))}
                        placeholder="Paris"
                      />
                    </InputGroup>
                    <InputGroup label="Contrat">
                      <input
                        className="cyber-input"
                        value={draft.contract || ""}
                        onChange={(e) => setDraft((p) => ({ ...p, contract: e.target.value }))}
                        placeholder="CDI"
                      />
                    </InputGroup>
                  </div>

                  <InputGroup label="Lien de l'offre">
                    <div className="relative">
                      <Globe className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
                      <input
                        className="cyber-input pl-10"
                        value={draft.jobLink || ""}
                        onChange={(e) => setDraft((p) => ({ ...p, jobLink: e.target.value }))}
                        placeholder="https://..."
                      />
                    </div>
                  </InputGroup>

                  {/* DATE ENTRETIEN */}
                  <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/10 space-y-2">
                    <label className="text-[10px] font-bold text-amber-500 uppercase flex items-center gap-2">
                      <Calendar className="h-3.5 w-3.5" /> Date d'entretien
                    </label>
                    <input
                      type="datetime-local"
                      className="cyber-input bg-black/20 border-amber-500/20 text-amber-100 focus:border-amber-500"
                      value={draft.interviewAt || ""}
                      onChange={(e) => setDraft((p) => ({ ...p, interviewAt: e.target.value }))}
                    />
                  </div>

                  <InputGroup label="Notes & Rappels">
                    <textarea
                      rows={5}
                      className="cyber-input resize-none leading-relaxed"
                      value={draft.notes || ""}
                      onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))}
                      placeholder="Contact RH, questions à poser, étapes suivantes..."
                    />
                  </InputGroup>

                  {/* IA TOGGLES */}
                  <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Documents générés</p>
                    <div className="flex gap-4">
                      {([
                        ["hasCv", "CV"],
                        ["hasLm", "Lettre"],
                        ["hasPitch", "Pitch"],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 cursor-pointer group select-none">
                          <div
                            className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                              (draft as any)[key]
                                ? "bg-blue-600 border-blue-600"
                                : "border-slate-600 bg-transparent group-hover:border-slate-400"
                            }`}
                          >
                            {(draft as any)[key] ? <CheckCircle2 className="h-3.5 w-3.5 text-white" /> : null}
                          </div>
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={!!(draft as any)[key]}
                            onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.checked }))}
                          />
                          <span className={`text-xs font-bold ${(draft as any)[key] ? "text-white" : "text-slate-400"} group-hover:text-white`}>
                            {label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </form>

              <div className="p-6 border-t border-white/10 bg-[#16181D] flex gap-3">
                {draft.id ? (
                  <button
                    type="button"
                    onClick={() => handleDelete(draft.id!)}
                    className="p-3.5 rounded-xl bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                ) : null}

                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-3.5 shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  {isSaving ? "Sauvegarde..." : "Enregistrer"}
                </button>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <style jsx>{`
        .cyber-input {
          width: 100%;
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 0.75rem;
          padding: 0.75rem 1rem;
          font-size: 0.875rem;
          color: white;
          outline: none;
          transition: all 0.2s;
        }
        .cyber-input:focus {
          border-color: #3b82f6;
          background: rgba(15, 23, 42, 0.9);
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
        }
      `}</style>
    </div>
  );
}
