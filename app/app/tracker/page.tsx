"use client";

import { useEffect, useMemo, useState, FormEvent } from "react";
import { motion } from "framer-motion";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  updateDoc,
  Timestamp,
} from "firebase/firestore";

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
  source?: string; // LinkedIn, Indeed, Réseau, etc.
  jobLink?: string;
  createdAt?: Date | null;
  updatedAt?: Date | null;
  lastActionDate?: Date | null;
  notes?: string;
  fromAutoCreate?: boolean; // créé depuis CV IA / LM
  hasCv?: boolean;
  hasLm?: boolean;
  hasPitch?: boolean;
  interviewAt?: Date | null; // 👉 date d'entretien
};

type FilterStatus = "all" | ApplicationStatus;
type IaFilter = "all" | "withCv" | "withLm" | "withPitch";

// --- Helpers dates ---

function formatDate(d?: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatDateTime(d?: Date | null) {
  if (!d) return "Date à préciser";
  return d.toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateToInputValue(d?: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const minute = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

// Convertit le format 'YYYY-MM-DDTHH:MM' du datetime-local en 'yyyymmddTHHMM'
function convertToApiDatetime(isoLocalString: string): string | null {
  if (!isoLocalString) return null;
  // Ex: "2025-11-24T20:00" -> "20251124T2000"
  return isoLocalString.replace(/[-:]/g, "").replace("T", "T");
}

// Label humain pour chaque statut
function statusLabel(status: ApplicationStatus): string {
  switch (status) {
    case "todo":
      return "À envoyer";
    case "sent":
      return "Envoyée";
    case "interview":
      return "Entretien";
    case "offer":
      return "Offre";
    case "rejected":
      return "Refus";
    default:
      return status;
  }
}

// Couleurs tailwind pour le pill de statut
function statusClasses(status: ApplicationStatus): string {
  switch (status) {
    case "todo":
      return "bg-slate-800/80 text-slate-200 border-slate-600/80";
    case "sent":
      return "bg-sky-900/40 text-sky-200 border-sky-500/70";
    case "interview":
      return "bg-amber-900/40 text-amber-200 border-amber-500/70";
    case "offer":
      return "bg-emerald-900/40 text-emerald-200 border-emerald-500/70";
    case "rejected":
      return "bg-rose-900/40 text-rose-200 border-rose-500/70";
    default:
      return "bg-slate-800/80 text-slate-200 border-slate-600/80";
  }
}

export default function TrackerPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingApps, setLoadingApps] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);

  // Pour éviter certains problèmes d'hydratation (pagination)
  const [isMounted, setIsMounted] = useState(false);

  // Filtres
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [iaFilter, setIaFilter] = useState<IaFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Pagination
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Formulaire "nouvelle candidature"
  const [showNewForm, setShowNewForm] = useState(false);
  const [savingNew, setSavingNew] = useState(false);

  const [newCompany, setNewCompany] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newStatus, setNewStatus] = useState<ApplicationStatus>("todo");
  const [newLocation, setNewLocation] = useState("");
  const [newContract, setNewContract] = useState("");
  const [newSource, setNewSource] = useState("");
  const [newJobLink, setNewJobLink] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newInterviewAt, setNewInterviewAt] = useState("");

  // Édition d’une candidature (modale)
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editCompany, setEditCompany] = useState("");
  const [editJobTitle, setEditJobTitle] = useState("");
  const [editStatus, setEditStatus] = useState<ApplicationStatus>("todo");
  const [editLocation, setEditLocation] = useState("");
  const [editContract, setEditContract] = useState("");
  const [editSource, setEditSource] = useState("");
  const [editJobLink, setEditJobLink] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editInterviewAt, setEditInterviewAt] = useState("");
  const [editHasCv, setEditHasCv] = useState(false);
  const [editHasLm, setEditHasLm] = useState(false);
  const [editHasPitch, setEditHasPitch] = useState(false);

  // --- Auth + chargement des candidatures ---

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    let unsubApps: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubApps) {
        unsubApps();
        unsubApps = null;
      }

      if (!user) {
        setUserId(null);
        setUserEmail(null);
        setApplications([]);
        setLoadingAuth(false);
        setLoadingApps(false);
        return;
      }

      setUserId(user.uid);
      setUserEmail(user.email ?? null);
      setLoadingAuth(false);

      const q = query(
        collection(db, "applications"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );

      setLoadingApps(true);
      setAppsError(null);

      unsubApps = onSnapshot(
        q,
        (snap) => {
          const list: Application[] = snap.docs.map((docSnap) => {
            const data = docSnap.data() as any;
            return {
              id: docSnap.id,
              userId: data.userId,
              company: data.company || "",
              jobTitle: data.jobTitle || "",
              status: (data.status as ApplicationStatus) || "todo",
              location: data.location || "",
              contract: data.contract || data.contractType || "",
              source: data.source || "",
              jobLink: data.jobLink || "",
              notes: data.notes || "",
              fromAutoCreate: !!data.fromAutoCreate,
              hasCv: !!data.hasCv,
              hasLm: !!data.hasLm,
              hasPitch: !!data.hasPitch,
              createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : null,
              updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : null,
              lastActionDate: data.lastActionDate?.toDate
                ? data.lastActionDate.toDate()
                : null,
              interviewAt: data.interviewAt?.toDate
                ? data.interviewAt.toDate()
                : null,
            };
          });
          setApplications(list);
          setLoadingApps(false);
        },
        (err) => {
          console.error("Erreur chargement candidatures:", err);
          setAppsError("Impossible de charger tes candidatures pour le moment.");
          setLoadingApps(false);
        }
      );
    });

    return () => {
      if (unsubApps) unsubApps();
      unsubAuth();
    };
  }, []);

  // --- Stats dérivées ---

  const {
    total,
    sentCount,
    interviewCount,
    offerCount,
    todoCount,
    trackedWithCv,
    trackedWithLm,
  } = useMemo(() => {
    const total = applications.length;
    let sentCount = 0;
    let interviewCount = 0;
    let offerCount = 0;
    let todoCount = 0;
    let trackedWithCv = 0;
    let trackedWithLm = 0;

    applications.forEach((app) => {
      if (app.status === "sent") sentCount++;
      if (app.status === "interview") interviewCount++;
      if (app.status === "offer") offerCount++;
      if (app.status === "todo") todoCount++;
      if (app.hasCv) trackedWithCv++;
      if (app.hasLm) trackedWithLm++;
    });

    return {
      total,
      sentCount,
      interviewCount,
      offerCount,
      todoCount,
      trackedWithCv,
      trackedWithLm,
    };
  }, [applications]);

  // Filtres combinés (statut + recherche + IA)
  const filteredApps = useMemo(() => {
    let list = [...applications];

    if (filterStatus !== "all") {
      list = list.filter((a) => a.status === filterStatus);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (a) =>
          a.company.toLowerCase().includes(term) ||
          a.jobTitle.toLowerCase().includes(term)
      );
    }

    if (iaFilter === "withCv") {
      list = list.filter((a) => a.hasCv);
    } else if (iaFilter === "withLm") {
      list = list.filter((a) => a.hasLm);
    } else if (iaFilter === "withPitch") {
      list = list.filter((a) => a.hasPitch);
    }

    return list;
  }, [applications, filterStatus, searchTerm, iaFilter]);

  // Pagination
  const totalPages = Math.max(
    1,
    Math.ceil((filteredApps.length || 1) / itemsPerPage)
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [filterStatus, searchTerm, iaFilter, itemsPerPage]);

  const paginatedApps = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredApps.slice(start, start + itemsPerPage);
  }, [filteredApps, currentPage, itemsPerPage]);

  // Agenda : entretiens à venir
  const upcomingInterviews = useMemo(() => {
    const now = new Date();
    const withDate = applications.filter(
      (a) =>
        a.interviewAt &&
        a.interviewAt.getTime() >= now.getTime()
    );
    withDate.sort(
      (a, b) =>
        (a.interviewAt?.getTime() || 0) - (b.interviewAt?.getTime() || 0)
    );
    return withDate;
  }, [applications]);

  const visibilityLabel = userId ? "Associé à ton compte" : "Invité";

  // --- Création d'une nouvelle candidature (avec interviewAt) ---

  const handleAddApplication = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    if (!newCompany.trim() || !newJobTitle.trim()) {
      return;
    }

    setSavingNew(true);

    try {
      const interviewAtDate = newInterviewAt
        ? new Date(newInterviewAt)
        : null;

      const firestoreData: any = {
        userId,
        company: newCompany.trim(),
        jobTitle: newJobTitle.trim(),
        status: newStatus,
        location: newLocation.trim(),
        contract: newContract.trim(),
        source: newSource.trim(),
        jobLink: newJobLink.trim(),
        notes: newNotes.trim(),
        fromAutoCreate: false,
        hasCv: false,
        hasLm: false,
        hasPitch: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastActionDate: serverTimestamp(),
      };

      if (interviewAtDate) {
        firestoreData.interviewAt = Timestamp.fromDate(interviewAtDate);
      }

      await addDoc(collection(db, "applications"), firestoreData);

      // Optionnel : simulation d'appel API calendrier
      if (newInterviewAt) {
        const start_datetime = convertToApiDatetime(newInterviewAt);
        if (start_datetime) {
          console.log("CALENDAR API: Create Event (New Application)", {
            title: `Entretien - ${newJobTitle.trim()} chez ${newCompany.trim()}`,
            start_datetime,
            duration: "1h",
            location: newLocation.trim(),
            description: `Lien: ${newJobLink.trim()} | Notes: ${newNotes.trim()}`,
          });
        }
      }

      // reset formulaire
      setNewCompany("");
      setNewJobTitle("");
      setNewStatus("todo");
      setNewLocation("");
      setNewContract("");
      setNewSource("");
      setNewJobLink("");
      setNewNotes("");
      setNewInterviewAt("");
      setShowNewForm(false);
    } catch (err) {
      console.error("Erreur ajout candidature:", err);
    } finally {
      setSavingNew(false);
    }
  };

  // --- Edition d'une candidature (modale) ---

  const openEditModal = (app: Application) => {
    setEditingApp(app);
    setEditCompany(app.company || "");
    setEditJobTitle(app.jobTitle || "");
    setEditStatus(app.status || "todo");
    setEditLocation(app.location || "");
    setEditContract(app.contract || "");
    setEditSource(app.source || "");
    setEditJobLink(app.jobLink || "");
    setEditNotes(app.notes || "");
    setEditInterviewAt(dateToInputValue(app.interviewAt || null));
    setEditHasCv(!!app.hasCv);
    setEditHasLm(!!app.hasLm);
    setEditHasPitch(!!app.hasPitch);
  };

  const closeEditModal = () => {
    setEditingApp(null);
  };

  const handleEditApplication = async (e: FormEvent) => {
    e.preventDefault();
    if (!userId || !editingApp) return;

    setEditSaving(true);

    try {
      const interviewAtDate = editInterviewAt
        ? new Date(editInterviewAt)
        : null;

      const updatedFields: any = {
        company: editCompany.trim(),
        jobTitle: editJobTitle.trim(),
        status: editStatus,
        location: editLocation.trim(),
        contract: editContract.trim(),
        source: editSource.trim(),
        jobLink: editJobLink.trim(),
        notes: editNotes.trim(),
        hasCv: editHasCv,
        hasLm: editHasLm,
        hasPitch: editHasPitch,
        updatedAt: serverTimestamp(),
        lastActionDate: serverTimestamp(),
      };

      if (interviewAtDate) {
        updatedFields.interviewAt = Timestamp.fromDate(interviewAtDate);
      } else {
        updatedFields.interviewAt = null;
      }

      await updateDoc(doc(db, "applications", editingApp.id), updatedFields);

      // Optionnel : simulation d'appel API calendrier
      if (editInterviewAt) {
        const start_datetime = convertToApiDatetime(editInterviewAt);
        if (start_datetime) {
          console.log("CALENDAR API: Create/Update Event (Edited Application)", {
            title: `Entretien - ${editJobTitle.trim()} chez ${editCompany.trim()}`,
            start_datetime,
            duration: "1h",
            location: editLocation.trim(),
            description: `Lien: ${editJobLink.trim()} | Notes: ${editNotes.trim()}`,
          });
        }
      }

      setEditingApp(null);
    } catch (err) {
      console.error("Erreur mise à jour candidature:", err);
    } finally {
      setEditSaving(false);
    }
  };

  // --- Pagination buttons ---

  const paginationButtons = useMemo(() => {
    const pages: (number | string)[] = [];
    if (totalPages <= 6) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      const left = Math.max(2, currentPage - 1);
      const right = Math.min(totalPages - 1, currentPage + 1);
      if (left > 2) pages.push("...");
      for (let i = left; i <= right; i++) pages.push(i);
      if (right < totalPages - 1) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  }, [currentPage, totalPages]);

  // --- RENDER ---

  if (!loadingAuth && !userId) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="max-w-2xl mx-auto px-3 sm:px-4 py-8"
      >
        <section className="glass rounded-2xl border border-[var(--border)]/80 p-5 text-center space-y-3">
          <h1 className="text-lg sm:text-xl font-semibold">
            Suivi de candidatures
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Connecte-toi pour voir et suivre toutes tes candidatures (CV + LM
            générés, entretiens, offres…).
          </p>
          <p className="text-xs text-[var(--muted)]">
            Depuis l&apos;assistant de candidature, coche l&apos;option{" "}
            <strong>“Créer une entrée dans le Suivi 📌”</strong> pour qu&apos;une
            ligne soit créée automatiquement ici.
          </p>
        </section>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="max-w-5xl mx-auto px-3 sm:px-4 py-5 sm:py-6 space-y-4"
    >
      {/* HEADER */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="badge-muted flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-[11px] uppercase tracking-wider">
              Suivi de candidatures
            </span>
          </p>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-[2px]">
              Profil IA :{" "}
              <span className="ml-1 font-medium">
                {userEmail || "Connecté"}
              </span>
            </span>
            <span className="inline-flex items-center rounded-full border border-[var(--border)] px-2 py-[2px]">
              Visibilité :{" "}
              <span className="ml-1 font-medium">{visibilityLabel}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-lg sm:text-xl font-semibold">
              Ton tableau de bord de candidatures
            </h1>
            <p className="text-[12px] text-[var(--muted)] max-w-xl">
              Visualise où tu en es sur chaque candidature : envoyée, en
              attente, entretien, offre ou refus. Les candidatures créées
              depuis l&apos;assistant de CV IA apparaissent automatiquement
              ici.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowNewForm((v) => !v)}
            className="btn-primary text-xs sm:text-sm"
          >
            {showNewForm ? "Fermer le formulaire" : "Ajouter une candidature"}
          </button>
        </div>
      </section>

      {/* STATS */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">Total</p>
          <p className="text-lg font-semibold">{total}</p>
        </div>
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">À envoyer</p>
          <p className="text-lg font-semibold">{todoCount}</p>
        </div>
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">Candidatures envoyées</p>
          <p className="text-lg font-semibold">{sentCount}</p>
        </div>
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">Entretiens</p>
          <p className="text-lg font-semibold">{interviewCount}</p>
        </div>
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">Offres</p>
          <p className="text-lg font-semibold">{offerCount}</p>
        </div>
      </section>

      {/* MINI STATS IA (CV / LM liés) */}
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">Candidatures avec CV IA</p>
          <p className="text-lg font-semibold">{trackedWithCv}</p>
          <p className="text-[10px] text-[var(--muted)] mt-0.5">
            Candidatures où tu as coché ou généré un CV IA.
          </p>
        </div>
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">Candidatures avec LM IA</p>
          <p className="text-lg font-semibold">{trackedWithLm}</p>
          <p className="text-[10px] text-[var(--muted)] mt-0.5">
            Candidatures où tu as coché ou généré une lettre IA.
          </p>
        </div>
        <div className="glass border border-[var(--border)]/80 rounded-xl px-3 py-2.5 text-xs">
          <p className="text-[var(--muted)] mb-0.5">Candidatures suivies</p>
          <p className="text-lg font-semibold">{total}</p>
          <p className="text-[10px] text-[var(--muted)] mt-0.5">
            Total de lignes dans ton tracker actuel.
          </p>
        </div>
      </section>

      {/* AGENDA ENTRETIENS À VENIR */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--bg-soft)] border border-[var(--border)] text-sm">
              📅
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-semibold">
                Agenda — Entretiens à venir
              </h2>
              <p className="text-[11px] text-[var(--muted)]">
                Toutes les candidatures avec une date d&apos;entretien future
                apparaissent ici.
              </p>
            </div>
          </div>
          <span className="text-[11px] rounded-full border border-[var(--border)] px-2 py-[2px] text-[var(--muted)]">
            {upcomingInterviews.length} entretien
            {upcomingInterviews.length > 1 ? "s" : ""} à venir
          </span>
        </div>

        {upcomingInterviews.length === 0 ? (
          <p className="text-[12px] text-[var(--muted)]">
            Aucun entretien programmé. Quand tu ajoutes une date d&apos;entretien
            dans une candidature (champ &quot;Date / heure de l&apos;entretien&quot;),
            elle apparaît ici.
          </p>
        ) : (
          <div className="space-y-2 text-[12px]">
            {upcomingInterviews.slice(0, 5).map((app) => (
              <div
                key={app.id}
                className="flex items-start gap-3 rounded-lg border border-[var(--border)]/70 bg-[var(--bg-soft)] px-3 py-2.5"
              >
                <div className="mt-1 text-[18px]">🕒</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {app.jobTitle || "Poste"}{" "}
                    {app.company && (
                      <span className="text-[11px] text-[var(--muted)]">
                        · {app.company}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {formatDateTime(app.interviewAt)}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-[var(--muted)]">
                    {app.location && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-slate-900/70">
                        📍 {app.location}
                      </span>
                    )}
                    {app.source && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-slate-900/70">
                        🌐 {app.source}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FORMULAIRE NOUVELLE CANDIDATURE */}
      {showNewForm && (
        <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base sm:text-lg font-semibold">
              Ajouter une candidature
            </h2>
            {savingNew && (
              <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                <div className="loader" />
                <span>Sauvegarde en cours…</span>
              </div>
            )}
          </div>

          <form
            onSubmit={handleAddApplication}
            className="space-y-3 text-[13px]"
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Entreprise
                </label>
                <input
                  type="text"
                  className="input text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="Ex : IMOGATE"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Intitulé du poste
                </label>
                <input
                  type="text"
                  className="input text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="Ex : Ingénieur Réseaux & Sécurité"
                  value={newJobTitle}
                  onChange={(e) => setNewJobTitle(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Statut
                </label>
                <select
                  className="select-brand text-[var(--ink)] bg-[var(--bg-soft)]"
                  value={newStatus}
                  onChange={(e) =>
                    setNewStatus(e.target.value as ApplicationStatus)
                  }
                >
                  <option value="todo">À envoyer</option>
                  <option value="sent">Envoyée</option>
                  <option value="interview">Entretien</option>
                  <option value="offer">Offre</option>
                  <option value="rejected">Refus</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Contrat (CDI, Stage…)
                </label>
                <input
                  type="text"
                  className="input text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="Ex : CDI, Alternance…"
                  value={newContract}
                  onChange={(e) => setNewContract(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Lieu
                </label>
                <input
                  type="text"
                  className="input text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="Ex : Paris, Remote…"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Source
                </label>
                <input
                  type="text"
                  className="input text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="Ex : LinkedIn, Indeed, Réseau…"
                  value={newSource}
                  onChange={(e) => setNewSource(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Lien de l&apos;offre
                </label>
                <input
                  type="url"
                  className="input text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                  placeholder="https://"
                  value={newJobLink}
                  onChange={(e) => setNewJobLink(e.target.value)}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Date / heure de l&apos;entretien (optionnel)
                </label>
                <input
                  type="datetime-local"
                  className="input text-[var(--ink)] bg-[var(--bg)]"
                  value={newInterviewAt}
                  onChange={(e) => setNewInterviewAt(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] mb-1 text-[var(--muted)]">
                Notes (rappels, contacts, prochaines étapes…)
              </label>
              <textarea
                rows={3}
                className="input textarea text-[var(--ink)] bg-[var(--bg)] placeholder:text-[var(--muted)]"
                placeholder="Ex : Relancer dans 5 jours, entretien technique prévu, contact RH…"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowNewForm(false)}
                className="btn-secondary"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingNew}
                className="btn-primary relative"
              >
                <span>
                  {savingNew ? "Ajout en cours..." : "Enregistrer la candidature"}
                </span>
                <div
                  className={`loader absolute inset-0 m-auto ${
                    savingNew ? "" : "hidden"
                  }`}
                />
              </button>
            </div>
          </form>
        </section>
      )}

      {/* RECHERCHE + FILTRES + LIMITE */}
      <section className="space-y-3">
        {/* Recherche + filtre statut */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <input
              type="text"
              className="input pl-8 text-[12px] bg-[var(--bg)] placeholder:text-[var(--muted)]"
              placeholder="Rechercher par entreprise ou poste…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted)] text-[14px]">
              🔍
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {[
              { key: "all", label: "Toutes" },
              { key: "todo", label: "À envoyer" },
              { key: "sent", label: "Envoyées" },
              { key: "interview", label: "Entretiens" },
              { key: "offer", label: "Offres" },
              { key: "rejected", label: "Refus" },
            ].map((f) => {
              const active = filterStatus === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilterStatus(f.key as FilterStatus)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-[4px] transition-colors ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--ink)]"
                      : "border-[var(--border)]/80 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)]"
                  }`}
                >
                  <span>{f.label}</span>
                  {f.key === "all" && total > 0 && (
                    <span className="text-[10px] opacity-80">({total})</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Filtres IA + limite par page */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap gap-1.5">
            {[
              { key: "all", label: "Toutes" },
              { key: "withCv", label: "Avec CV IA" },
              { key: "withLm", label: "Avec LM IA" },
              { key: "withPitch", label: "Avec Pitch" },
            ].map((f) => {
              const active = iaFilter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setIaFilter(f.key as IaFilter)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-[3px] transition-colors ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--ink)]"
                      : "border-[var(--border)]/80 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)]"
                  }`}
                >
                  <span>{f.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[var(--muted)]">Par page :</span>
            <select
              className="border border-[var(--border)] bg-[var(--bg-soft)] rounded-full px-2 py-[3px] text-[11px]"
              value={itemsPerPage}
              onChange={(e) => setItemsPerPage(Number(e.target.value))}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>

        {/* État de chargement / erreurs */}
        {loadingApps && (
          <div className="glass border border-[var(--border)]/80 rounded-xl p-4 flex items-center gap-3 text-[13px] text-[var(--muted)]">
            <div className="loader" />
            <span>Chargement de tes candidatures…</span>
          </div>
        )}

        {appsError && (
          <div className="glass border border-rose-500/60 rounded-xl p-3 text-[12px] text-rose-200">
            {appsError}
          </div>
        )}

        {!loadingApps && !appsError && filteredApps.length === 0 && (
          <div className="glass border border-[var(--border)]/80 rounded-xl p-4 text-center text-[13px] text-[var(--muted)]">
            <p className="mb-1">Aucune candidature à afficher pour ce filtre.</p>
            <p className="text-[11px]">
              Ajoute une candidature manuellement ou coche l&apos;option{" "}
              <strong>“Créer une entrée dans le Suivi 📌”</strong> dans
              l&apos;assistant de CV IA.
            </p>
          </div>
        )}

        {/* Liste des candidatures */}
        <div className="space-y-2">
          {paginatedApps.map((app) => (
            <div
              key={app.id}
              className="glass border border-[var(--border)]/80 rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
            >
              {/* Colonne gauche */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-medium text-[14px] truncate">
                    {app.jobTitle || "Poste sans intitulé"}
                  </p>
                  {app.company && (
                    <span className="text-[11px] text-[var(--muted)]">
                      · {app.company}
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap gap-1.5 text-[10.5px] text-[var(--muted)]">
                  {app.location && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-slate-900/70">
                      📍 {app.location}
                    </span>
                  )}
                  {app.contract && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-slate-900/70">
                      📄 {app.contract}
                    </span>
                  )}
                  {app.source && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-slate-900/70">
                      🌐 {app.source}
                    </span>
                  )}
                  {app.fromAutoCreate && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full bg-[var(--brand)]/15 text-[var(--brand)] border border-[var(--brand)]/50">
                      🤖 Depuis CV IA
                    </span>
                  )}
                </div>

                <div className="mt-1 text-[11px] text-[var(--muted)] flex flex-wrap gap-2">
                  <span>
                    Créée : <strong>{formatDate(app.createdAt)}</strong>
                  </span>
                  {app.lastActionDate && (
                    <span>
                      Dernière action :{" "}
                      <strong>{formatDate(app.lastActionDate)}</strong>
                    </span>
                  )}
                  {app.interviewAt && (
                    <span>
                      Entretien :{" "}
                      <strong>{formatDateTime(app.interviewAt)}</strong>
                    </span>
                  )}
                </div>

                {app.notes && (
                  <p className="mt-1 text-[11px] text-[var(--muted)] line-clamp-2">
                    {app.notes}
                  </p>
                )}

                {app.jobLink && (
                  <a
                    href={app.jobLink}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--brand)] hover:underline"
                  >
                    Voir l&apos;offre
                    <span aria-hidden>↗</span>
                  </a>
                )}
              </div>

              {/* Colonne droite : statut + badges IA + bouton éditer */}
              <div className="flex flex-col items-end gap-1 min-w-[170px]">
                <span
                  className={`inline-flex items-center justify-center px-2 py-[3px] text-[11px] border rounded-full ${statusClasses(
                    app.status
                  )}`}
                >
                  {statusLabel(app.status)}
                </span>

                <div className="flex flex-wrap justify-end gap-1 text-[10px] text-[var(--muted)] mt-1">
                  {app.hasCv && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border border-[var(--border)] bg-[var(--bg-soft)]">
                      ✅ CV IA
                    </span>
                  )}
                  {app.hasLm && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border border-[var(--border)] bg-[var(--bg-soft)]">
                      ✉️ LM IA
                    </span>
                  )}
                  {app.hasPitch && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full border border-[var(--border)] bg-[var(--bg-soft)]">
                      🎙️ Pitch
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => openEditModal(app)}
                  className="mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-[2px] text-[10px] text-[var(--muted)] hover:border-[var(--brand)] hover:text-[var(--brand)] transition-colors"
                >
                  <span className="text-[12px]">✏️</span>
                  <span>Modifier</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* PAGINATION */}
        {filteredApps.length > 0 && isMounted && (
          <div className="max-w-5xl mx-auto mt-4 flex justify-center items-center gap-2 text-[11px]">
            <button
              type="button"
              className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg)]"
              onClick={() =>
                setCurrentPage((p) => (p > 1 ? p - 1 : p))
              }
              disabled={currentPage === 1}
            >
              Précédent
            </button>

            {paginationButtons.map((p, idx) =>
              typeof p === "number" ? (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setCurrentPage(p)}
                  className={`px-2.5 py-1 rounded-full border text-[11px] ${
                    p === currentPage
                      ? "border-[var(--brand)] bg-[var(--brand)]/20"
                      : "border-[var(--border)] bg-[var(--bg-soft)] hover:bg-[var(--bg)]"
                  }`}
                >
                  {p}
                </button>
              ) : (
                <span key={idx} className="px-2 py-1">
                  …
                </span>
              )
            )}

            <button
              type="button"
              className="px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--bg)]"
              onClick={() =>
                setCurrentPage((p) =>
                  p < totalPages ? p + 1 : p
                )
              }
              disabled={currentPage === totalPages}
            >
              Suivant
            </button>

            <div className="ml-4 text-[var(--muted)]">
              Page {currentPage} sur {totalPages}
            </div>
          </div>
        )}
      </section>

      {/* MODALE EDIT CANDIDATURE */}
      {editingApp && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-3">
          <motion.form
            onSubmit={handleEditApplication}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            className="w-full max-w-lg rounded-2xl bg-[var(--bg)] border border-[var(--border)] shadow-xl p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-semibold">
                Modifier la candidature
              </h3>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-full px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--bg-soft)]"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 max-h-[70vh] overflow-auto pr-1 text-[13px]">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Entreprise
                  </label>
                  <input
                    type="text"
                    className="input text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editCompany}
                    onChange={(e) => setEditCompany(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Intitulé du poste
                  </label>
                  <input
                    type="text"
                    className="input text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editJobTitle}
                    onChange={(e) => setEditJobTitle(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Statut
                  </label>
                  <select
                    className="select-brand text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editStatus}
                    onChange={(e) =>
                      setEditStatus(e.target.value as ApplicationStatus)
                    }
                  >
                    <option value="todo">À envoyer</option>
                    <option value="sent">Envoyée</option>
                    <option value="interview">Entretien</option>
                    <option value="offer">Offre</option>
                    <option value="rejected">Refus</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Contrat
                  </label>
                  <input
                    type="text"
                    className="input text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editContract}
                    onChange={(e) => setEditContract(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Lieu
                  </label>
                  <input
                    type="text"
                    className="input text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Source
                  </label>
                  <input
                    type="text"
                    className="input text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editSource}
                    onChange={(e) => setEditSource(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Lien de l&apos;offre
                  </label>
                  <input
                    type="url"
                    className="input text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editJobLink}
                    onChange={(e) => setEditJobLink(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] mb-1 text-[var(--muted)]">
                    Date / heure de l&apos;entretien
                  </label>
                  <input
                    type="datetime-local"
                    className="input text-[var(--ink)] bg-[var(--bg-soft)]"
                    value={editInterviewAt}
                    onChange={(e) => setEditInterviewAt(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] mb-1 text-[var(--muted)]">
                  Notes
                </label>
                <textarea
                  rows={3}
                  className="input textarea text-[var(--ink)] bg-[var(--bg-soft)]"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-3 text-[11px]">
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3 w-3 rounded border-[var(--border)] bg-[var(--bg)]"
                    checked={editHasCv}
                    onChange={(e) => setEditHasCv(e.target.checked)}
                  />
                  <span>CV IA associé</span>
                </label>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3 w-3 rounded border-[var(--border)] bg-[var(--bg)]"
                    checked={editHasLm}
                    onChange={(e) => setEditHasLm(e.target.checked)}
                  />
                  <span>LM IA associée</span>
                </label>
                <label className="inline-flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-3 w-3 rounded border-[var(--border)] bg-[var(--bg)]"
                    checked={editHasPitch}
                    onChange={(e) => setEditHasPitch(e.target.checked)}
                  />
                  <span>Pitch IA associé</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeEditModal}
                className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--bg)] transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="inline-flex items-center justify-center rounded-lg bg-[var(--brand)] hover:bg-[var(--brandDark)] px-3 py-1.5 text-[12px] font-medium text-white transition-colors relative"
              >
                <span>
                  {editSaving ? "Enregistrement..." : "Enregistrer"}
                </span>
                <div
                  className={`loader absolute inset-0 m-auto ${
                    editSaving ? "" : "hidden"
                  }`}
                />
              </button>
            </div>
          </motion.form>
        </div>
      )}
    </motion.div>
  );
}
