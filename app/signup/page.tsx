"use client";

import { Suspense, useState, useMemo, FormEvent } from "react";
import Script from "next/script";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  createUserWithEmailAndPassword,
  updateProfile,
  sendEmailVerification,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { getRecaptchaToken, verifyRecaptcha } from "@/lib/recaptcha";

function checkPasswordRules(pwd: string) {
  const min = pwd.length >= 8;
  const upper = /[A-Z]/.test(pwd);
  const digit = /[0-9]/.test(pwd);
  const special = /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
  const ok = min && upper && digit && special;
  return { min, upper, digit, special, ok };
}

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pwdRules = useMemo(() => checkPasswordRules(password), [password]);

  function mapSignupError(err: any) {
    const code = err?.code as string | undefined;

    if (code === "auth/email-already-in-use") {
      return "Cette adresse email est déjà associée à un compte. Veuillez vous connecter.";
    }
    if (code === "auth/invalid-email") {
      return "Adresse email invalide.";
    }
    return "Une erreur est survenue lors de l'inscription. Merci de réessayer.";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!pwdRules.ok) {
      setError(
        "Le mot de passe ne respecte pas les règles de sécurité. Vérifie les critères en dessous du champ."
      );
      return;
    }

    setLoading(true);
    try {
      // ✅ reCAPTCHA avant Firebase Auth
      const action = "SIGNUP";
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
        setError("Inscription refusée par sécurité. Réessayez dans quelques secondes.");
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);

      const displayName = `${firstName} ${lastName}`.trim() || email;
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }

      await sendEmailVerification(cred.user);

      router.push("/login?justSignedUp=1");
    } catch (err: any) {
      console.error("Signup error:", err);
      setError(mapSignupError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignup() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      // ✅ reCAPTCHA avant Firebase Auth (Google)
      const action = "SIGNUP_GOOGLE";
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
        setError("Inscription refusée par sécurité. Réessayez dans quelques secondes.");
        return;
      }

      const provider = googleProvider || new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      const displayName = user.displayName || user.email || "";
      setInfo(`Bienvenue ${displayName} 👋`);

      // (Tu peux aussi respecter redirect si tu veux)
      const redirectTo = searchParams.get("redirect") || "/app";
      router.push(redirectTo);
    } catch (err: any) {
      console.error("Google signup error:", err);
      const code = err?.code as string | undefined;

      if (code === "auth/account-exists-with-different-credential") {
        setError(
          "Un compte existe déjà pour cette adresse email. Veuillez vous connecter avec votre mot de passe habituel."
        );
      } else if (code === "auth/popup-closed-by-user") {
        setError("La fenêtre Google a été fermée avant la fin du processus.");
      } else {
        setError("Impossible de terminer l'inscription avec Google pour le moment.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-900 text-slate-100">
      <Script
        src={`https://www.google.com/recaptcha/enterprise.js?render=${process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}`}
        strategy="afterInteractive"
      />

      {/* NAVBAR */}
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
              <span className="text-xs font-medium text-slate-100">Inscription</span>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-[11px]">
            <Link
              href="/"
              className="px-2 py-1 rounded-full border border-slate-700/80 hover:border-sky-500/80 text-slate-300 hover:text-sky-300 transition-colors"
            >
              ← Retour accueil
            </Link>
            <Link
              href="/login"
              className="px-3 py-1 rounded-full bg-sky-500/90 text-slate-950 font-medium hover:bg-sky-400 transition-colors"
            >
              Se connecter
            </Link>
          </nav>
        </div>
      </header>

      {/* CONTENU */}
      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="glass max-w-md w-full p-6 sm:p-7 rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl shadow-sky-900/40">
          <div className="mb-4">
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-700 px-3 py-1 mb-2">
              <span className="text-xs">✨</span>
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                Inscription
              </span>
            </p>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-50">Créer un compte</h1>
            <p className="text-xs text-slate-400 mt-1">
              Crée ton compte, reçois des crédits de bienvenue et commence à générer tes candidatures.
              Tu devras d&apos;abord{" "}
              <span className="font-semibold text-slate-100">valider ton adresse email</span>.
            </p>
          </div>

          {info && (
            <p className="mb-2 text-xs text-emerald-100 bg-emerald-500/10 border border-emerald-500/40 rounded-md px-3 py-2">
              {info}
            </p>
          )}
          {error && (
            <p className="mb-2 text-xs text-rose-100 bg-rose-500/10 border border-rose-500/40 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block mb-1 text-xs text-slate-300" htmlFor="firstName">
                  Prénom
                </label>
                <input
                  id="firstName"
                  type="text"
                  className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="Jean"
                />
              </div>
              <div>
                <label className="block mb-1 text-xs text-slate-300" htmlFor="lastName">
                  Nom
                </label>
                <input
                  id="lastName"
                  type="text"
                  className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  placeholder="Dupont"
                />
              </div>
            </div>

            <div>
              <label className="block mb-1 text-xs text-slate-300" htmlFor="email">
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="toi@example.com"
              />
            </div>

            <div>
              <label className="block mb-1 text-xs text-slate-300" htmlFor="password">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  autoComplete="new-password"
                  className={`w-full rounded-lg bg-slate-900/80 border px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 pr-16 transition-colors ${
                    password && !pwdRules.ok ? "border-rose-500/70" : "border-slate-700"
                  }`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 text-[11px] text-slate-400 hover:text-slate-200 flex items-center"
                  onClick={() => setShowPwd((v) => !v)}
                >
                  {showPwd ? "Masquer" : "Afficher"}
                </button>
              </div>

              <ul className="mt-2 text-[10px] space-y-0.5">
                <li className={`flex items-center gap-1 ${pwdRules.min ? "text-emerald-400" : "text-rose-400"}`}>
                  <span className="text-[12px]">{pwdRules.min ? "✔" : "•"}</span>
                  <span>Minimum 8 caractères</span>
                </li>
                <li className={`flex items-center gap-1 ${pwdRules.upper ? "text-emerald-400" : "text-rose-400"}`}>
                  <span className="text-[12px]">{pwdRules.upper ? "✔" : "•"}</span>
                  <span>Au moins une majuscule (A-Z)</span>
                </li>
                <li className={`flex items-center gap-1 ${pwdRules.digit ? "text-emerald-400" : "text-rose-400"}`}>
                  <span className="text-[12px]">{pwdRules.digit ? "✔" : "•"}</span>
                  <span>Au moins un chiffre (0-9)</span>
                </li>
                <li
                  className={`flex items-center gap-1 ${
                    pwdRules.special ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  <span className="text-[12px]">{pwdRules.special ? "✔" : "•"}</span>
                  <span>Au moins un caractère spécial (!, @, #, ...)</span>
                </li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed text-xs font-medium text-white px-3 py-2 mt-1 transition-colors"
            >
              {loading ? "Inscription..." : "S'inscrire"}
            </button>
          </form>

          <div className="flex items-center gap-2 my-4">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-[10px] text-slate-500 uppercase tracking-[0.16em]">ou</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <button
            onClick={handleGoogleSignup}
            disabled={loading}
            className="w-full inline-flex items-center justify-center rounded-lg bg-slate-900/80 border border-slate-700 hover:border-sky-500 text-xs font-medium text-slate-100 px-3 py-2.5 transition-colors"
          >
            Continuer avec <span className="font-semibold ml-1">Google</span>
          </button>

          <p className="mt-4 text-[11px] text-center text-slate-400">
            <span>Déjà un compte ? </span>
            <Link href="/login" className="text-sky-400 hover:text-sky-300 font-semibold underline">
              Se connecter
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">
          Chargement de la page d’inscription...
        </div>
      }
    >
      <SignupPageInner />
    </Suspense>
  );
}
