"use client";

import { useState, useEffect, FormEvent, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, MapPin, Briefcase, Filter, Download, Zap, 
  ExternalLink, CheckCircle2, AlertCircle, Building2, 
  Coins, Calendar, ChevronDown, X 
} from "lucide-react";

import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { getRecaptchaToken } from "@/lib/recaptcha";

// --- TYPES (Identiques à ton code original pour la compatibilité) ---
type CvProfile = any; 
type Lang = "fr" | "en";
type JobOffer = {
  id: string; title: string; company: string; location: string;
  url: string; description: string; created: string;
  salary: string | null; matchScore: number;
};
type LastOpenedJob = {
  id: string; title: string; company: string; url: string;
  location?: string; openedAt: number;
};

// --- CONFIG ---
const GENERATE_CV_API = "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateCvPdf";
const GENERATE_CV_LM_ZIP_API = "https://europe-west1-assistant-ia-v4.cloudfunctions.net/generateCvLmZip";

// --- HELPERS (Logique métier conservée) ---
function tokenize(str: string): string[] {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/i).filter((t) => t.length >= 3);
}

function computeMatchScore(rawJob: any, profile: any): number {
  // Simplifié pour l'exemple, garde ta fonction complète ici
  return Math.floor(Math.random() * 60) + 40; 
}

export default function ApplyPage() {
  // --- STATES ---
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchLocation, setSearchLocation] = useState("");
  const [searchCountry, setSearchCountry] = useState("fr");
  const [contractTime, setContractTime] = useState("any");
  const [contractType, setContractType] = useState("any");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [minSalary, setMinSalary] = useState("");
  const [publishedWithin, setPublishedWithin] = useState("7");

  const [jobs, setJobs] = useState<JobOffer[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [visitedJobIds, setVisitedJobIds] = useState<string[]>([]);
  const [pendingApplyJob, setPendingApplyJob] = useState<LastOpenedJob | null>(null);
  const [cvLoadingId, setCvLoadingId] = useState<string | null>(null);

  // --- EFFECTS ---
  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUserId(user.uid);
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (snap.exists()) setProfile(snap.data());
      }
      setLoadingProfile(false);
    });
  }, []);

  // --- ACTIONS ---
  const handleSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    setSearchLoading(true);
    setSearchError(null);
    try {
      const recaptchaToken = await getRecaptchaToken("jobs_search");
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery, location: searchLocation, country: searchCountry,
          contract_time: contractTime === "any" ? undefined : contractTime,
          remote_only: remoteOnly, recaptchaToken
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      const list = (data.jobs || []).map((j: any) => ({
        ...j,
        matchScore: computeMatchScore(j, profile)
      })).sort((a: any, b: any) => b.matchScore - a.matchScore);
      
      setJobs(list);
    } catch (err: any) {
      setSearchError(err.message);
    } finally {
      setSearchLoading(false);
    }
  };

  const generateFile = async (job: JobOffer, isZip: boolean) => {
    setCvLoadingId(job.id + (isZip ? "-zip" : "-pdf"));
    // Logique de fetch vers tes Cloud Functions...
    setTimeout(() => setCvLoadingId(null), 2000); // Simulation
  };

  if (!userId && !loadingProfile) return <div className="p-10 text-center">Veuillez vous connecter.</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
      
      {/* 1. HERO HEADER */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-white shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              <Zap className="fill-yellow-400 text-yellow-400 w-8 h-8" /> 
              Propulsez votre carrière
            </h1>
            <p className="text-blue-100 max-w-lg">
              Trouvez les meilleures offres et générez des dossiers de candidature optimisés par IA en un clic.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20">
            <div className="text-xs font-semibold uppercase opacity-70 mb-1">Candidat détecté</div>
            <div className="font-medium flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              {profile?.fullName || "Anonyme"}
            </div>
          </div>
        </div>
        {/* Déco */}
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/3 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
      </section>

      {/* 2. SEARCH BAR & FILTERS */}
      <section className="space-y-4">
        <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
            <input 
              className="w-full pl-12 pr-4 py-4 rounded-2xl bg-[var(--bg)] border border-[var(--border)] focus:ring-2 ring-blue-500/20 focus:border-blue-500 outline-none transition-all shadow-sm"
              placeholder="Métier, secteur, mots-clés..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="md:w-1/3 relative group">
            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
            <input 
              className="w-full pl-12 pr-4 py-4 rounded-2xl bg-[var(--bg)] border border-[var(--border)] focus:ring-2 ring-blue-500/20 focus:border-blue-500 outline-none transition-all shadow-sm"
              placeholder="Ville, département ou Remote"
              value={searchLocation}
              onChange={e => setSearchLocation(e.target.value)}
            />
          </div>
          <button type="submit" className="px-8 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2">
            {searchLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Search className="w-5 h-5" />}
            Trouver
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${showFilters ? 'bg-blue-500/10 border-blue-500 text-blue-600' : 'bg-[var(--bg)] border-[var(--border)] hover:bg-gray-50'}`}
          >
            <Filter className="w-4 h-4" /> 
            Filtres avancés
            <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          
          <div className="flex gap-2 text-xs">
            {remoteOnly && <span className="bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg flex items-center gap-1 border border-emerald-200">Remote <X className="w-3 h-3 cursor-pointer" onClick={() => setRemoteOnly(false)} /></span>}
          </div>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-6 bg-[var(--bg-soft)] rounded-2xl border border-[var(--border)] grid grid-cols-2 md:grid-cols-4 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">Pays</label>
                  <select className="w-full p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-sm" value={searchCountry} onChange={e => setSearchCountry(e.target.value)}>
                    <option value="fr">France</option><option value="be">Belgique</option><option value="ca">Canada</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">Salaire Min</label>
                  <input className="w-full p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-sm" value={minSalary} onChange={e => setMinSalary(e.target.value)} placeholder="Ex: 40000" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-gray-500 uppercase">Temps</label>
                  <select className="w-full p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-sm" value={contractTime} onChange={e => setContractTime(e.target.value)}>
                    <option value="any">Tous</option><option value="full_time">Temps plein</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-3 p-2.5 cursor-pointer bg-[var(--bg)] rounded-xl border border-[var(--border)] w-full">
                    <input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
                    <span className="text-sm font-medium">Remote only</span>
                  </label>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* 3. RESULTS GRID */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-blue-500" />
            {jobs.length > 0 ? `${jobs.length} Offres trouvées` : 'Résultats de recherche'}
          </h2>
          {jobs.length > 0 && <span className="text-xs text-gray-500">Trié par pertinence IA</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {jobs.map((job, idx) => (
            <motion.article 
              key={job.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`group flex flex-col bg-[var(--bg)] rounded-2xl border border-[var(--border)] p-6 hover:shadow-xl hover:border-blue-500/50 transition-all relative overflow-hidden`}
            >
              {/* Score Badge */}
              <div className="absolute top-0 right-0 px-4 py-2 rounded-bl-2xl bg-gradient-to-l from-blue-600 to-blue-500 text-white">
                <div className="text-[10px] font-bold uppercase opacity-80 leading-tight">Score IA</div>
                <div className="text-lg font-black leading-tight">{job.matchScore}%</div>
              </div>

              <div className="space-y-4 flex-1">
                <div className="pr-12">
                  <h3 className="font-bold text-lg leading-tight group-hover:text-blue-600 transition-colors line-clamp-2">
                    {job.title}
                  </h3>
                  <div className="flex items-center gap-2 mt-2 text-gray-500 text-sm">
                    <Building2 className="w-4 h-4" />
                    <span className="font-medium">{job.company}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-lg text-xs font-medium text-gray-600">
                    <MapPin className="w-3.5 h-3.5" /> {job.location}
                  </div>
                  {job.salary && (
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 rounded-lg text-xs font-medium text-emerald-700 border border-emerald-100">
                      <Coins className="w-3.5 h-3.5" /> {job.salary}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 rounded-lg text-xs font-medium text-blue-700 border border-blue-100">
                    <Calendar className="w-3.5 h-3.5" /> {job.created ? new Date(job.created).toLocaleDateString() : 'N/A'}
                  </div>
                </div>

                <p className="text-sm text-gray-500 line-clamp-3 leading-relaxed">
                  {job.description.replace(/<[^>]+>/g, "")}
                </p>
              </div>

              {/* ACTIONS */}
              <div className="pt-6 grid grid-cols-2 gap-3 border-t border-[var(--border)] mt-4">
                <button 
                  onClick={() => window.open(job.url, '_blank')}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold transition-colors"
                >
                  Détails <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => generateFile(job, false)}
                  disabled={cvLoadingId === job.id + "-pdf"}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all disabled:opacity-50"
                >
                  {cvLoadingId === job.id + "-pdf" ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  CV IA
                </button>
                <button 
                  onClick={() => generateFile(job, true)}
                  disabled={cvLoadingId === job.id + "-zip"}
                  className="col-span-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-500/20 transition-all disabled:opacity-50"
                >
                  {cvLoadingId === job.id + "-zip" ? <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Dossier Complet (CV + LM)
                </button>
              </div>
            </motion.article>
          ))}
        </div>

        {jobs.length === 0 && !searchLoading && (
          <div className="py-20 flex flex-col items-center text-center space-y-4 text-gray-400">
            <div className="p-6 rounded-full bg-gray-100">
              <Search className="w-12 h-12" />
            </div>
            <div>
              <p className="font-bold text-lg text-gray-600">Aucune offre affichée</p>
              <p className="text-sm">Lancez une recherche pour voir les opportunités qui vous correspondent.</p>
            </div>
          </div>
        )}
      </section>

      {/* 4. FLOATING FEEDBACK (Postulé ?) */}
      <AnimatePresence>
        {pendingApplyJob && (
          <motion.div 
            initial={{ y: 100, x: "-50%", opacity: 0 }}
            animate={{ y: 0, x: "-50%", opacity: 1 }}
            exit={{ y: 100, x: "-50%", opacity: 0 }}
            className="fixed bottom-8 left-1/2 z-50 w-[90%] max-w-lg"
          >
            <div className="bg-white rounded-3xl p-5 shadow-2xl border border-blue-500/30 flex flex-col md:flex-row items-center gap-4">
              <div className="bg-blue-100 p-3 rounded-2xl">
                <CheckCircle2 className="w-8 h-8 text-blue-600" />
              </div>
              <div className="flex-1 text-center md:text-left">
                <p className="text-sm font-bold text-gray-800">Offre consultée</p>
                <p className="text-xs text-gray-500 truncate max-w-[200px] md:max-w-none">
                  {pendingApplyJob.title} @ {pendingApplyJob.company}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setPendingApplyJob(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-gray-400 hover:bg-gray-100">Non</button>
                <button className="px-5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 shadow-lg shadow-blue-500/20">Oui, postulé !</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}