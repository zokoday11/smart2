"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  FileText,
  Sparkles,
  Mail,
  Wand2,
  Download,
  Copy,
  Trash2,
  Search,
  Filter,
  Calendar,
  ExternalLink,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

/**
 * ✅ Ce composant lit l'historique d'activité depuis Firestore.
 * Il supporte 2 schémas:
 * 1) collectionGroup "usage" (recommandé) ou "logs" / "history"
 * 2) collection "usage" ou "history" avec champ userId
 *
 * 👉 Adapte les noms de collections dans COLLECTION_CANDIDATES si nécessaire.
 */

// ---------------------------
// Types
// ---------------------------
type ActivityType =
  | "cv_generate"
  | "cv_download"
  | "lm_generate"
  | "lm_download"
  | "pitch_generate"
  | "mail_generate"
  | "other";

type ActivityItem = {
  id: string;
  userId: string;
  createdAt: Date;
  type: ActivityType;
  title: string;
  summary?: string;

  // optional details
  jobTitle?: string;
  companyName?: string;
  lang?: "fr" | "en";
  template?: string;
  brandColor?: string;

  // optional artifacts
  outputUrl?: string; // ex: Storage URL
  copiedText?: string;
};

// ---------------------------
// Helpers UI
// ---------------------------
function fmtDate(d: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function typeMeta(t: ActivityType) {
  switch (t) {
    case "cv_generate":
      return { label: "CV généré", icon: Wand2, pill: "bg-blue-500/15 text-blue-300 border-blue-500/20" };
    case "cv_download":
      return { label: "CV téléchargé", icon: Download, pill: "bg-blue-500/10 text-blue-200 border-blue-500/15" };
    case "lm_generate":
      return { label: "Lettre générée", icon: FileText, pill: "bg-purple-500/15 text-purple-300 border-purple-500/20" };
    case "lm_download":
      return { label: "Lettre téléchargée", icon: Download, pill: "bg-purple-500/10 text-purple-200 border-purple-500/15" };
    case "pitch_generate":
      return { label: "Pitch généré", icon: Sparkles, pill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" };
    case "mail_generate":
      return { label: "Mail généré", icon: Mail, pill: "bg-amber-500/15 text-amber-200 border-amber-500/20" };
    default:
      return { label: "Activité", icon: Activity, pill: "bg-white/10 text-slate-200 border-white/10" };
  }
}

function coerceDate(v: any): Date {
  if (!v) return new Date(0);
  if (v instanceof Date) return v;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v === "number") return new Date(v);
  return new Date(String(v));
}

// Essayez d'abord ces collections (adapte si besoin)
const COLLECTION_CANDIDATES = [
  // collectionGroup (si tu as users/{uid}/usage/{id})
  { kind: "collectionGroup" as const, name: "usage" },
  { kind: "collectionGroup" as const, name: "logs" },
  { kind: "collectionGroup" as const, name: "history" },

  // collections root (si tu as usage/{id} avec userId)
  { kind: "collection" as const, name: "usage" },
  { kind: "collection" as const, name: "logs" },
  { kind: "collection" as const, name: "history" },
];

// ---------------------------
// Page
// ---------------------------
export default function HistoryPage() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [qText, setQText] = useState("");
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");

  // UI
  const [selected, setSelected] = useState<ActivityItem | null>(null);

  // Fetch
  useEffect(() => {
    let alive = true;

    const run = async () => {
      if (!user) {
        setLoading(false);
        setItems([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const uid = user.uid;

        // 🔎 On essaye plusieurs schémas, le premier qui renvoie des résultats gagne
        let found: ActivityItem[] | null = null;

        for (const c of COLLECTION_CANDIDATES) {
          try {
            let qs;

            if (c.kind === "collectionGroup") {
              // users/{uid}/usage/{doc} => il faut un champ userId OU bien un chemin parent
              // Ici on filtre par userId (recommandé)
              qs = query(
                collection(db as any, c.name) as any, // fallback types
                where("userId", "==", uid),
                orderBy("createdAt", "desc"),
                limit(200)
              );
            } else {
              qs = query(
                collection(db, c.name),
                where("userId", "==", uid),
                orderBy("createdAt", "desc"),
                limit(200)
              );
            }

            const snap = await getDocs(qs as any);
            if (!snap.empty) {
              const rows: ActivityItem[] = snap.docs.map((d) => {
                const data: any = d.data();

                // normalisation
                const action = String(data.action || data.eventType || data.type || "other");

                // mapping action -> ActivityType
                const mappedType: ActivityType =
                  action.includes("cv") && action.includes("download")
                    ? "cv_download"
                    : action.includes("cv")
                    ? "cv_generate"
                    : action.includes("lm") && action.includes("download")
                    ? "lm_download"
                    : action.includes("lm") || action.includes("letter")
                    ? "lm_generate"
                    : action.includes("pitch")
                    ? "pitch_generate"
                    : action.includes("mail")
                    ? "mail_generate"
                    : "other";

                const createdAt = coerceDate(data.createdAt || data.timestamp || data.time || data.created || data.serverTimestamp);

                // title/summary
                const title =
                  data.title ||
                  data.docType ||
                  (mappedType === "cv_generate"
                    ? "Génération de CV"
                    : mappedType === "lm_generate"
                    ? "Génération de lettre"
                    : mappedType === "pitch_generate"
                    ? "Génération de pitch"
                    : mappedType === "mail_generate"
                    ? "Génération de mail"
                    : mappedType === "cv_download"
                    ? "Téléchargement CV"
                    : mappedType === "lm_download"
                    ? "Téléchargement lettre"
                    : "Activité");

                const summary =
                  data.summary ||
                  data.message ||
                  data.promptPreview ||
                  (data.jobTitle ? `Poste: ${data.jobTitle}` : undefined);

                return {
                  id: d.id,
                  userId: uid,
                  createdAt,
                  type: mappedType,
                  title: String(title),
                  summary: summary ? String(summary) : undefined,
                  jobTitle: data.jobTitle || data.targetJob || data.role,
                  companyName: data.companyName || data.company,
                  lang: data.lang,
                  template: data.template || data.cvTemplate,
                  brandColor: data.brandColor || data.pdfBrand,
                  outputUrl: data.outputUrl || data.fileUrl || data.pdfUrl,
                  copiedText: data.copiedText || data.text,
                };
              });

              found = rows;
              break;
            }
          } catch (e) {
            // on ignore l'erreur pour tenter la prochaine collection
          }
        }

        if (!alive) return;

        setItems(found ?? []);
        if (!found) {
          setError(
            "Aucun historique trouvé (ou la collection Firestore n'est pas encore branchée). " +
              "Vérifie que tu logs bien un document avec userId + createdAt."
          );
        }
      } catch (e: any) {
        console.error(e);
        if (!alive) return;
        setError(e?.message || "Erreur lors du chargement de l'historique.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };

    run();
    return () => {
      alive = false;
    };
  }, [user]);

  // Filtered list
  const filtered = useMemo(() => {
    const text = qText.trim().toLowerCase();
    return items.filter((it) => {
      const okType = typeFilter === "all" ? true : it.type === typeFilter;
      if (!okType) return false;
      if (!text) return true;

      const hay = [
        it.title,
        it.summary,
        it.jobTitle,
        it.companyName,
        it.lang,
        it.template,
        fmtDate(it.createdAt),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(text);
    });
  }, [items, qText, typeFilter]);

  const totals = useMemo(() => {
    const byType: Record<string, number> = {};
    for (const it of items) byType[it.type] = (byType[it.type] || 0) + 1;
    return {
      total: items.length,
      cv: (byType["cv_generate"] || 0) + (byType["cv_download"] || 0),
      lm: (byType["lm_generate"] || 0) + (byType["lm_download"] || 0),
      pitch: byType["pitch_generate"] || 0,
      mail: byType["mail_generate"] || 0,
    };
  }, [items]);

  // Actions
  const openItem = (it: ActivityItem) => setSelected(it);

  const copyText = async (it: ActivityItem) => {
    const txt =
      it.copiedText ||
      [it.title, it.summary, it.jobTitle && `Poste: ${it.jobTitle}`, it.companyName && `Entreprise: ${it.companyName}`]
        .filter(Boolean)
        .join("\n");
    try {
      await navigator.clipboard.writeText(txt);
      alert("Copié !");
    } catch {
      alert("Copie impossible.");
    }
  };

  // --- UI ---
  if (!user) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center bg-[#0A0A0B] text-slate-200">
        <div className="max-w-md text-center bg-[#16181D] border border-white/10 rounded-2xl p-6">
          <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-3" />
          <p className="text-sm text-slate-300">Connecte-toi pour voir ton historique d’activité.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-slate-200 font-sans px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
      {/* Global classes (si tu n'as pas déjà dans ton app) */}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 999px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.04);
        }
        .input {
          height: 44px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 0 12px;
          outline: none;
          color: rgba(226, 232, 240, 0.95);
        }
        .input:focus {
          border-color: rgba(59, 130, 246, 0.55);
          box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
        }
        .btn {
          height: 44px;
          border-radius: 14px;
          font-weight: 800;
          font-size: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: background 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
        }
        .btn:hover {
          transform: translateY(-1px);
        }
        .btn-primary {
          background: #2563eb;
          border-color: rgba(255, 255, 255, 0.08);
          box-shadow: 0 20px 40px rgba(37, 99, 235, 0.18);
        }
        .btn-primary:hover {
          background: #3b82f6;
        }
        .btn-ghost {
          background: rgba(255, 255, 255, 0.06);
        }
        .btn-ghost:hover {
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>

      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
        {/* HEADER */}
        <div className="bg-[#16181D] border border-white/10 p-4 sm:p-6 rounded-2xl shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-white">History</h1>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  Ton activité sur le site : générations IA, téléchargements, mails, pitch, etc.
                </p>
              </div>
            </div>

            {/* KPIs */}
            <div className="flex flex-wrap gap-2">
              <div className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-[11px] text-slate-200">
                Total: <span className="font-extrabold text-white">{totals.total}</span>
              </div>
              <div className="px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-200">
                CV: <span className="font-extrabold">{totals.cv}</span>
              </div>
              <div className="px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-200">
                Lettres: <span className="font-extrabold">{totals.lm}</span>
              </div>
              <div className="px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-200">
                Pitch: <span className="font-extrabold">{totals.pitch}</span>
              </div>
              <div className="px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-200">
                Mail: <span className="font-extrabold">{totals.mail}</span>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="mt-4 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                className="input w-full pl-10"
                placeholder="Rechercher: poste, entreprise, type, date..."
                value={qText}
                onChange={(e) => setQText(e.target.value)}
              />
            </div>
            <div className="relative sm:w-[240px]">
              <Filter className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <select
                className="input w-full pl-10 appearance-none"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
              >
                <option value="all">Tous les types</option>
                <option value="cv_generate">CV (génération)</option>
                <option value="cv_download">CV (téléchargement)</option>
                <option value="lm_generate">Lettre (génération)</option>
                <option value="lm_download">Lettre (téléchargement)</option>
                <option value="pitch_generate">Pitch (génération)</option>
                <option value="mail_generate">Mail (génération)</option>
                <option value="other">Autre</option>
              </select>
            </div>
          </div>
        </div>

        {/* CONTENT */}
        <div className="grid lg:grid-cols-12 gap-4 sm:gap-6">
          {/* LIST */}
          <div className="lg:col-span-7">
            <div className="bg-[#16181D] border border-white/10 rounded-2xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Activité</span>
                </div>
                {loading ? (
                  <span className="text-xs text-slate-500 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">{filtered.length} résultat(s)</span>
                )}
              </div>

              <div className="max-h-[65vh] overflow-auto custom-scrollbar">
                {loading ? (
                  <div className="p-8 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center">
                    <AlertTriangle className="w-8 h-8 text-yellow-400 mx-auto mb-3" />
                    <p className="text-sm text-slate-300">Aucune activité à afficher.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {items.length === 0 ? "Commence par générer un CV / lettre / pitch." : "Change les filtres ou la recherche."}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-white/10">
                    {filtered.map((it) => {
                      const meta = typeMeta(it.type);
                      const Icon = meta.icon;
                      return (
                        <li key={it.id}>
                          <button
                            onClick={() => openItem(it)}
                            className={`w-full text-left p-4 hover:bg-white/5 transition-colors flex gap-3 ${
                              selected?.id === it.id ? "bg-white/5" : ""
                            }`}
                          >
                            <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                              <Icon className="w-5 h-5 text-slate-200" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-white truncate">{it.title}</p>
                                  <p className="text-xs text-slate-400 truncate">
                                    {it.summary || (it.jobTitle ? `Poste: ${it.jobTitle}` : "—")}
                                  </p>
                                </div>
                                <span className={`shrink-0 px-2 py-1 rounded-full border text-[10px] font-extrabold ${meta.pill}`}>
                                  {meta.label}
                                </span>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500">
                                <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10">
                                  {fmtDate(it.createdAt)}
                                </span>
                                {it.companyName && (
                                  <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10 truncate max-w-[180px]">
                                    {it.companyName}
                                  </span>
                                )}
                                {it.lang && (
                                  <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10">
                                    {it.lang.toUpperCase()}
                                  </span>
                                )}
                                {it.template && (
                                  <span className="px-2 py-1 rounded-full bg-white/5 border border-white/10">
                                    Template: {it.template}
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* DETAILS */}
          <div className="lg:col-span-5">
            <div className="bg-[#16181D] border border-white/10 rounded-2xl overflow-hidden shadow-lg">
              <div className="p-4 border-b border-white/10 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Détails</span>
                {selected ? (
                  <span className="text-xs text-slate-500">{fmtDate(selected.createdAt)}</span>
                ) : (
                  <span className="text-xs text-slate-500">Sélectionne un item</span>
                )}
              </div>

              <AnimatePresence mode="wait">
                {!selected ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="p-6 text-center"
                  >
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                      <CheckCircle2 className="w-8 h-8 text-slate-400" />
                    </div>
                    <p className="text-sm text-slate-300">Clique sur une activité à gauche.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Tu verras ici le résumé, les paramètres (langue, template), et les actions (copie, lien…).
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key={selected.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="p-5 sm:p-6 space-y-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        {(() => {
                          const M = typeMeta(selected.type);
                          const Icon = M.icon;
                          return <Icon className="w-6 h-6 text-white" />;
                        })()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-base font-extrabold text-white leading-snug">{selected.title}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {selected.summary || "—"}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {selected.jobTitle && (
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Poste</p>
                          <p className="text-slate-200 mt-1">{selected.jobTitle}</p>
                        </div>
                      )}
                      {selected.companyName && (
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Entreprise</p>
                          <p className="text-slate-200 mt-1">{selected.companyName}</p>
                        </div>
                      )}
                      {selected.lang && (
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Langue</p>
                          <p className="text-slate-200 mt-1">{selected.lang.toUpperCase()}</p>
                        </div>
                      )}
                      {selected.template && (
                        <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Template</p>
                          <p className="text-slate-200 mt-1">{selected.template}</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        className="btn btn-ghost w-full"
                        onClick={() => copyText(selected)}
                      >
                        <Copy className="w-4 h-4" /> Copier
                      </button>

                      {selected.outputUrl ? (
                        <a
                          className="btn btn-primary w-full"
                          href={selected.outputUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="w-4 h-4" /> Ouvrir
                        </a>
                      ) : (
                        <button className="btn btn-primary w-full" disabled>
                          <ExternalLink className="w-4 h-4" /> Ouvrir
                        </button>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500">
                      ⚙️ Pour enrichir cette page, logge aussi : <span className="text-slate-300">jobTitle, companyName, lang, template, outputUrl</span>.
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* DEV NOTE (optional) */}
        <div className="text-[11px] text-slate-600">
          💡 Si tu veux que l’historique soit “tout ce qu’on fait sur le site”, il faut centraliser tes logs Firestore :
          <span className="text-slate-400"> userId + createdAt + action/eventType + docType + (jobTitle/companyName/template/lang)</span>.
        </div>
      </div>
    </div>
  );
}
