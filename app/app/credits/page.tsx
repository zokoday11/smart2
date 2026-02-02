"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Zap, 
  History, 
  ShieldCheck, 
  CreditCard, 
  ArrowRight, 
  CheckCircle2, 
  Loader2, 
  Sparkles,
  Clock,
  Info
} from "lucide-react";

import { useUserCredits } from "@/hooks/useUserCredits";
import { useAuth } from "@/context/AuthContext";
import { getRecaptchaToken } from "@/lib/recaptcha";
import { useRechargeHistory } from "@/hooks/useRechargeHistory";

// --- TYPES ---
type PackKey = "20" | "50" | "100";

const CREDIT_PACKS: {
  key: PackKey;
  label: string;
  credits: number;
  price: string;
  desc: string;
  color: string;
  popular?: boolean;
}[] = [
  {
    key: "20",
    credits: 20,
    price: "4.99€",
    label: "Pack Découverte",
    desc: "Idéal pour tester les fonctionnalités IA ponctuellement.",
    color: "from-blue-500 to-cyan-500",
  },
  {
    key: "50",
    credits: 50,
    price: "9.99€",
    label: "Pack Boost",
    desc: "Parfait pour une phase active de recherche d'emploi.",
    color: "from-indigo-600 to-blue-600",
    popular: true,
  },
  {
    key: "100",
    credits: 100,
    price: "17.99€",
    label: "Pack Intensif",
    desc: "Pour une préparation complète : CV, lettres et entretiens.",
    color: "from-purple-600 to-indigo-600",
  },
];

const DEFAULT_API_BASE = "https://europe-west1-assistant-ia-v4.cloudfunctions.net";
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, "");

export default function CreditsPage() {
  const { user } = useAuth();
  const { credits, loading, error } = useUserCredits();
  const { items: recharges, loading: rechargesLoading } = useRechargeHistory(30);

  const [buyLoading, setBuyLoading] = useState<PackKey | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [creditsBeforePurchase, setCreditsBeforePurchase] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // --- ACTIONS ---
  const handleBuy = async (pack: PackKey) => {
    try {
      setBuyError(null);
      if (!user?.uid || !user.email) return setBuyError("Veuillez vous connecter.");

      setBuyLoading(pack);
      setCreditsBeforePurchase(credits ?? 0);

      const recaptchaToken = await getRecaptchaToken("polar_checkout");
      const res = await fetch(`${API_BASE}/polarCheckout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack, userId: user.uid, email: user.email, recaptchaToken }),
      });

      const data = await res.json();
      if (!res.ok || !data?.url) throw new Error(data?.error || "Erreur de paiement.");

      const fullUrl = `${data.url}${data.url.includes("?") ? "&" : "?"}embed=true&embed_origin=${encodeURIComponent(window.location.origin)}`;
      setEmbedUrl(fullUrl);
    } catch (e: any) {
      setBuyError(e.message);
      setBuyLoading(null);
    }
  };

  // Fermeture auto quand les crédits sont reçus
  useEffect(() => {
    if (embedUrl && creditsBeforePurchase !== null && credits !== null && credits > creditsBeforePurchase) {
      setEmbedUrl(null);
      setBuyLoading(null);
      setShowSuccessAnimation(true);
      setTimeout(() => setShowSuccessAnimation(false), 5000);
    }
  }, [credits, embedUrl, creditsBeforePurchase]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
      
      {/* NOTIFICATION SUCCÈS */}
      <AnimatePresence>
        {showSuccessAnimation && (
          <motion.div 
            initial={{ y: -50, opacity: 0 }} 
            animate={{ y: 0, opacity: 1 }} 
            exit={{ y: -50, opacity: 0 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
          >
            <div className="bg-emerald-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
              <Sparkles className="w-5 h-5 fill-yellow-400" />
              <span className="font-bold text-sm">Crédits ajoutés avec succès !</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER & BALANCE */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Crédits IA</h1>
          <p className="text-gray-500 text-sm max-w-md">
            Utilisez vos crédits pour propulser vos candidatures avec nos outils d'analyse et de génération intelligente.
          </p>
        </div>

        <div className="relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition"></div>
          <div className="relative bg-[var(--bg)] border border-[var(--border)] p-4 rounded-2xl flex items-center gap-4 min-w-[200px]">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600">
              <Zap className="w-6 h-6 fill-blue-600" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Solde Actuel</div>
              <div className="text-2xl font-black text-[var(--ink)]">
                {loading ? "..." : credits} <span className="text-xs font-medium text-gray-400">⚡</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* PACKS SECTION */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-blue-500" />
          <h2 className="text-lg font-bold">Rechargement sécurisé</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {CREDIT_PACKS.map((pack) => (
            <motion.div
              key={pack.key}
              whileHover={{ y: -5 }}
              className={`relative bg-[var(--bg)] border border-[var(--border)] rounded-3xl p-6 flex flex-col justify-between shadow-sm transition-all ${pack.popular ? 'ring-2 ring-blue-500/50' : ''}`}
            >
              {pack.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-tighter">
                  Le plus populaire
                </div>
              )}

              <div className="space-y-4">
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${pack.color} flex items-center justify-center text-white shadow-lg`}>
                  <Zap className="w-6 h-6 fill-current" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{pack.label}</h3>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{pack.desc}</p>
                </div>
                <div className="flex items-baseline gap-1 pt-2">
                  <span className="text-3xl font-black">{pack.price}</span>
                  <span className="text-xs text-gray-400">pour {pack.credits} crédits</span>
                </div>
              </div>

              <button
                onClick={() => handleBuy(pack.key)}
                disabled={!!buyLoading}
                className={`mt-8 w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                  pack.popular 
                    ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20' 
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                } disabled:opacity-50`}
              >
                {buyLoading === pack.key ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>Recharger <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </motion.div>
          ))}
        </div>
        
        <div className="flex flex-col md:flex-row items-center justify-center gap-6 text-[10px] text-gray-400 uppercase font-bold tracking-widest pt-4">
          <div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Transaction SSL 256-bit</div>
          <div className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-emerald-500" /> Propulsé par Stripe & Polar</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-500" /> Aucun abonnement</div>
        </div>
      </section>

      {/* HISTORIQUE */}
      <section className="bg-[var(--bg-soft)] rounded-3xl border border-[var(--border)] overflow-hidden">
        <div className="p-6 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-gray-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Historique des transactions</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50/50 text-gray-400 text-[10px] font-black uppercase tracking-widest">
              <tr>
                <th className="px-6 py-4">Date & Heure</th>
                <th className="px-6 py-4">Pack</th>
                <th className="px-6 py-4">Crédits</th>
                <th className="px-6 py-4">Montant</th>
                <th className="px-6 py-4">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rechargesLoading ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">Chargement de l'historique...</td></tr>
              ) : recharges.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">Aucune transaction trouvée.</td></tr>
              ) : (
                recharges.map((r) => (
                  <tr key={r.id} className="hover:bg-white/50 transition-colors">
                    <td className="px-6 py-4 text-gray-600 flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 opacity-40" />
                      {r.createdAt ? new Date(r.createdAt).toLocaleString("fr-FR", { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td className="px-6 py-4 font-semibold">Pack {r.creditsAdded}</td>
                    <td className="px-6 py-4"><span className="text-emerald-600 font-bold">+{r.creditsAdded} ⚡</span></td>
                    <td className="px-6 py-4 font-medium">{(Number(r.amount) / 100).toFixed(2)} {String(r.currency).toUpperCase()}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase ${
                        r.status === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {r.status || 'pending'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* INFOS FOOTER */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100 text-blue-700 text-xs">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <p className="leading-relaxed">
          <strong>Comment ça marche ?</strong> Un crédit correspond à une action IA majeure (Analyse CV, lettre de motivation, etc.). Vos crédits n'expirent jamais. En cas de problème lors du paiement, contactez le support.
        </p>
      </div>

      {/* IFRAME MODAL (Paiement) */}
      <AnimatePresence>
        {embedUrl && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }} 
              animate={{ scale: 1, y: 0 }}
              className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[650px] max-h-full"
            >
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold">Paiement Sécurisé</h3>
                    <p className="text-[10px] text-gray-400 uppercase tracking-tighter">Propulsé par Polar & Stripe</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setEmbedUrl(null); setBuyLoading(null); }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <iframe
                ref={iframeRef}
                src={embedUrl}
                className="w-full flex-1 border-0"
                title="Polar Checkout"
                allow="payment *; publickey-credentials-get *"
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const X = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);