"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  ShieldCheck,
  Mail,
  Lock,
  Loader2,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();

  const mapFirebaseError = (code?: string) => {
    switch (code) {
      case "auth/invalid-email":
        return "Adresse email invalide.";
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "Identifiants incorrects.";
      case "auth/user-disabled":
        return "Compte désactivé.";
      case "auth/too-many-requests":
        return "Trop de tentatives. Réessayez plus tard.";
      default:
        return "Erreur de connexion. Veuillez réessayer.";
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      console.log("Admin login success:", cred.user.uid);

      // ✅ Redirection correcte
      router.replace("/admin");
    } catch (err: any) {
      console.error(err);
      setError(mapFirebaseError(err?.code));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setSubmitting(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);

      // ✅ Redirection correcte
      router.replace("/admin");
    } catch (err: any) {
      setError(mapFirebaseError(err?.code));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#020617] relative overflow-hidden px-4 py-12 sm:px-6 lg:px-8">
      {/* Background Effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-red-900/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none"></div>

      {/* Bouton Retour Flottant */}
      <div className="absolute top-6 left-6 z-10">
        <Link
          href="/login"
          className="group flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-xs font-medium text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-3 w-3 group-hover:-translate-x-0.5 transition-transform" />
          Retour au site
        </Link>
      </div>

      <div className="w-full max-w-md z-10">
        {/* En-tête de la carte */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-red-600 to-rose-600 shadow-lg shadow-red-900/50 mb-4">
            <ShieldCheck className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            Portail Administrateur
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Accès sécurisé réservé au personnel autorisé
          </p>
        </div>

        {/* Carte de connexion */}
        <div className="bg-slate-900/60 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          <div className="p-8 space-y-6">
            {/* Gestion des erreurs */}
            {error && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-xs font-medium animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email Input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider ml-1">
                  Email
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-slate-500 group-focus-within:text-red-400 transition-colors" />
                  </div>
                  <input
                    type="email"
                    required
                    disabled={submitting}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="block w-full rounded-xl border border-slate-700/50 bg-slate-950/50 py-3 pl-10 pr-3 text-sm text-white placeholder-slate-500 focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 focus:outline-none transition-all disabled:opacity-50"
                    placeholder="admin@entreprise.com"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider ml-1">
                  Mot de passe
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-500 group-focus-within:text-red-400 transition-colors" />
                  </div>
                  <input
                    type="password"
                    required
                    disabled={submitting}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-xl border border-slate-700/50 bg-slate-950/50 py-3 pl-10 pr-3 text-sm text-white placeholder-slate-500 focus:border-red-500/50 focus:ring-2 focus:ring-red-500/20 focus:outline-none transition-all disabled:opacity-50"
                    placeholder="••••••••••••"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center py-3 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-red-500 transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg shadow-red-900/20"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connexion...
                  </>
                ) : (
                  "Se connecter"
                )}
              </button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-700/50"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-[#0d1226] text-slate-500 uppercase tracking-wider">
                  Ou continuer avec
                </span>
              </div>
            </div>

            {/* Google Button */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={submitting}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-800 hover:border-slate-600 text-slate-200 text-sm font-medium transition-all disabled:opacity-50"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google Workspace
            </button>
          </div>

          {/* Footer Card */}
          <div className="px-8 py-4 bg-slate-950/50 border-t border-white/5 text-center">
            <p className="text-[10px] text-slate-500">
              Système sécurisé et monitoré. Toute tentative d'intrusion sera signalée.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}