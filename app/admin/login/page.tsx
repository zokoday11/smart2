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

export default function AdminLoginPage() {
  // Simples états de formulaire et de soumission
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
        return "Email ou mot de passe incorrect.";
      case "auth/user-disabled":
        return "Ce compte a été désactivé. Contacte l’administrateur.";
      case "auth/popup-closed-by-user":
        return "Connexion annulée.";
      default:
        return "Impossible de te connecter. Réessaie dans un instant.";
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      console.log("Admin login success (email/password):", cred.user.uid);

      // Redirection vers le dashboard admin (à adapter si besoin)
      router.push("/admin/dashboard");
    } catch (err: any) {
      console.error(err);
      const msg = mapFirebaseError(err?.code);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setSubmitting(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account",
      });

      const result = await signInWithPopup(auth, provider);
      console.log("Admin login success (Google):", result.user.uid);

      // Redirection vers le dashboard admin (à adapter si besoin)
      router.push("/admin/dashboard");
    } catch (err: any) {
      console.error(err);
      const msg = mapFirebaseError(err?.code);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Navbar (Minimal Admin Header) */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-red-500 to-red-400 flex items-center justify-center text-[10px] font-semibold text-slate-950 shadow-lg shadow-red-500/40">
              AD
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Accès réservé
              </span>
              <span className="text-xs font-medium text-slate-100">
                Administration
              </span>
            </div>
          </div>
          <Link
            href="/login" // Lien de retour vers la connexion utilisateur classique
            className="px-2 py-1 rounded-full border border-slate-700/80 hover:border-red-500/80 text-slate-300 hover:text-red-300 transition-colors text-[11px]"
          >
            ← Retour Client
          </Link>
        </div>
      </header>

      {/* CONTENU PRINCIPAL - Centré */}
      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="glass max-w-sm w-full p-6 sm:p-7 rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl shadow-red-900/40">
          <div className="mb-5">
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-700 px-3 py-1 mb-2">
              <span className="text-xs text-red-400">🚨</span>
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                Accès Admin
              </span>
            </p>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-50">
              Connexion administrateur
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Veuillez utiliser vos identifiants de sécurité.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-500/70 bg-red-500/10 px-3 py-2 text-[11px] text-red-100">
              {error}
            </div>
          )}

          {/* FORMULAIRE */}
          <form onSubmit={handleSubmit} className="space-y-4 text-sm">
            <div>
              <label className="block mb-1 text-xs text-slate-300">
                Email
              </label>
              <input
                type="email"
                required
                className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div>
              <label className="block mb-1 text-xs text-slate-300">
                Mot de passe
              </label>
              <input
                type="password"
                required
                className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              {/* Le lien "Mot de passe oublié ?" est intentionnellement omis ici */}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-xs font-medium text-white px-3 py-2 transition-colors mt-2"
            >
              {submitting ? "Connexion en cours..." : "Se connecter"}
            </button>
          </form>

          {/* Séparateur */}
          <div className="flex items-center gap-3 my-4">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-[10px] text-slate-500 uppercase tracking-[0.18em]">
              ou
            </span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          {/* BOUTON GOOGLE */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900/80 hover:bg-slate-900 disabled:opacity-60 disabled:cursor-not-allowed border border-slate-700 px-3 py-2 text-xs font-medium text-slate-100 transition-colors"
          >
            {/* Icône Google minimaliste (SVG) */}
            <span className="w-4 h-4 rounded-sm bg-white flex items-center justify-center">
              <span className="text-[11px] font-bold text-slate-900">G</span>
            </span>
            <span>
              {submitting
                ? "Connexion en cours..."
                : "Se connecter avec Google"}
            </span>
          </button>
        </div>
      </main>
    </div>
  );
}
