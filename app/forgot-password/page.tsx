"use client";

import { useState, FormEvent } from "react";
import Script from "next/script";
import Link from "next/link";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getRecaptchaToken, verifyRecaptcha } from "@/lib/recaptcha";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      // ✅ reCAPTCHA avant envoi reset email
      const action = "PASSWORD_RESET";
      let token = "";
      try {
        token = await getRecaptchaToken(action);
      } catch {
        setError(
          "Sécurité: impossible de valider reCAPTCHA (script bloqué ?). Désactive l'adblock et réessaie."
        );
        return;
      }

      const check = await verifyRecaptcha(token, action);
      if (!check.ok) {
        setError("Demande refusée par sécurité. Réessayez dans quelques secondes.");
        return;
      }

      await sendPasswordResetEmail(auth, email);
      setInfo(
        "Si un compte existe pour cette adresse email, un lien de réinitialisation vient de t'être envoyé. Pense à vérifier tes spams."
      );
    } catch (err: any) {
      console.error("Forgot password error:", err);
      const code = err?.code as string | undefined;

      if (code === "auth/invalid-email") {
        setError("Adresse email invalide.");
      } else {
        setError(
          "Impossible d'envoyer l'email de réinitialisation pour le moment. Réessaie dans quelques instants."
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-900 text-slate-100">
      <Script
        src={`https://www.google.com/recaptcha/enterprise.js?render=${process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}`}
        strategy="afterInteractive"
      />

      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-sky-400 flex items-center justify-center text-[10px] font-semibold text-slate-950 shadow-lg shadow-sky-500/40">
              IA
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                Assistant candidatures
              </span>
              <span className="text-xs font-medium text-slate-100">Mot de passe oublié</span>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-[11px]">
            <Link
              href="/"
              className="px-2 py-1 rounded-full border border-slate-700/80 hover:border-sky-500/80 text-slate-300 hover:text-sky-300 transition-colors"
            >
              ← Accueil
            </Link>
            <Link
              href="/login"
              className="px-3 py-1 rounded-full bg-sky-500/90 text-slate-950 font-medium hover:bg-sky-400 transition-colors"
            >
              Se connecter
            </Link>
            <Link
              href="/signup"
              className="px-3 py-1 rounded-full border border-slate-700/80 text-slate-300 hover:border-sky-500/80 hover:text-sky-300 transition-colors"
            >
              S&apos;inscrire
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="glass max-w-md w-full p-6 sm:p-7 rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl shadow-sky-900/40">
          <div className="mb-4">
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-700 px-3 py-1 mb-2">
              <span className="text-xs">💬</span>
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                Mot de passe oublié
              </span>
            </p>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-50">
              Réinitialiser ton mot de passe
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Entre l&apos;adresse email liée à ton compte. Si elle existe, tu recevras un lien sécurisé.
            </p>
          </div>

          {info && (
            <div className="mb-2 rounded-lg border border-emerald-500/70 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-100">
              {info}
            </div>
          )}

          {error && (
            <div className="mb-2 rounded-lg border border-rose-500/70 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <div>
              <label className="block mb-1 text-xs text-slate-300" htmlFor="email">
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
                placeholder="toi@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed text-xs font-medium text-white px-3 py-2 transition-colors mt-1"
            >
              {submitting ? "Envoi du lien..." : "Envoyer le lien de réinitialisation"}
            </button>
          </form>

          <p className="mt-4 text-[11px] text-slate-400 text-center">
            Tu te souviens de ton mot de passe ?{" "}
            <Link href="/login" className="text-sky-400 hover:text-sky-300 hover:underline font-medium">
              Retour à la connexion
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
