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
import {
  ArrowLeft,
  UserPlus,
  Mail,
  Lock,
  User,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";

// --- VALIDATION MOT DE PASSE ---
function checkPasswordRules(pwd: string) {
  const min = pwd.length >= 8;
  const upper = /[A-Z]/.test(pwd);
  const digit = /[0-9]/.test(pwd);
  const special = /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
  const ok = min && upper && digit && special;
  return { min, upper, digit, special, ok };
}

const TXT = {
  tagline: "Assistant candidatures",
  titleNav: "Inscription",
  back: "Retour",
  login: "Connexion",
  badge: "Inscription",
  title: "Créer un compte",
  subtitle: "Commence en quelques secondes.",
  welcome: (name: string) => `Bienvenue ${name ? name : ""} !`,
  emailAlreadyInUse: "Cet email est déjà utilisé.",
  invalidEmail: "Email invalide.",
  weakPassword: "Mot de passe trop faible.",
  generic: "Erreur. Réessaie.",
  passwordRules: "Le mot de passe ne respecte pas les règles.",
  recaptchaBlocked: "Vérification anti-bot impossible. Réessaie plus tard.",
  recaptchaRefused: "Vérification anti-bot refusée. Réessaie.",
  googleRecaptchaRefused: "Vérification anti-bot refusée (Google).",
  accountExistsDifferentCredential: "Compte déjà existant avec un autre moyen de connexion.",
  googleError: "Inscription Google impossible. Réessaie.",
  firstNameLabel: "Prénom",
  lastNameLabel: "Nom",
  firstNamePlaceholder: "Jean",
  lastNamePlaceholder: "Dupont",
  emailLabel: "Email",
  emailPlaceholder: "exemple@email.com",
  passwordLabel: "Mot de passe",
  passwordPlaceholder: "••••••••",
  pwdMin: "8 caractères",
  pwdUpper: "1 majuscule",
  pwdDigit: "1 chiffre",
  pwdSpecial: "1 caractère spécial",
  submit: "Créer mon compte",
  or: "OU",
  google: "Continuer avec Google",
  already: "Déjà un compte ?",
  goLogin: "Se connecter",
};

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
    if (code === "auth/email-already-in-use") return TXT.emailAlreadyInUse;
    if (code === "auth/invalid-email") return TXT.invalidEmail;
    if (code === "auth/weak-password") return TXT.weakPassword;
    return TXT.generic;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!pwdRules.ok) {
      setError(TXT.passwordRules);
      return;
    }

    setLoading(true);
    try {
      const action = "SIGNUP";
      let token = "";
      try {
        token = await getRecaptchaToken(action);
      } catch {
        setError(TXT.recaptchaBlocked);
        return;
      }

      const check = await verifyRecaptcha(token, action);
      if (!check.ok) {
        setError(TXT.recaptchaRefused);
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const displayName = `${firstName} ${lastName}`.trim() || email;
      if (displayName) await updateProfile(cred.user, { displayName });

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
      const action = "SIGNUP_GOOGLE";
      const token = await getRecaptchaToken(action);
      const check = await verifyRecaptcha(token, action);

      if (!check.ok) {
        setError(TXT.googleRecaptchaRefused);
        return;
      }

      const provider = googleProvider || new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      setInfo(TXT.welcome(user.displayName || ""));
      const redirectTo = searchParams.get("redirect") || "/app";
      router.push(redirectTo);
    } catch (err: any) {
      console.error("Google signup error:", err);
      if (err.code === "auth/account-exists-with-different-credential") {
        setError(TXT.accountExistsDifferentCredential);
      } else {
        setError(TXT.googleError);
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

      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-sky-400 flex items-center justify-center text-[10px] font-semibold text-slate-950 shadow-lg shadow-sky-500/40">
              IA
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{TXT.tagline}</span>
              <span className="text-xs font-medium text-slate-100">{TXT.titleNav}</span>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-[11px]">
            <Link
              href="/"
              className="px-2 py-1 rounded-full border border-slate-700/80 hover:border-sky-500/80 text-slate-300 hover:text-sky-300 transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> {TXT.back}
            </Link>
            <Link
              href="/login"
              className="px-3 py-1 rounded-full bg-sky-500/90 text-slate-950 font-medium hover:bg-sky-400 transition-colors"
            >
              {TXT.login}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="glass max-w-md w-full p-6 sm:p-7 rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl shadow-sky-900/40">
          <div className="mb-6 text-center sm:text-left">
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-700 px-3 py-1 mb-3">
              <UserPlus className="w-3 h-3 text-sky-400" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-300">{TXT.badge}</span>
            </p>
            <h1 className="text-xl font-bold text-slate-50 mb-1">{TXT.title}</h1>
            <p className="text-xs text-slate-400">{TXT.subtitle}</p>
          </div>

          {info && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-xs flex gap-2 items-start">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{info}</span>
            </div>
          )}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-200 text-xs flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 ml-1">{TXT.firstNameLabel}</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl pl-10 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all"
                    placeholder={TXT.firstNamePlaceholder}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 ml-1">{TXT.lastNameLabel}</label>
                <div className="relative">
                  <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl pl-10 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all"
                    placeholder={TXT.lastNamePlaceholder}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 ml-1">{TXT.emailLabel}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl pl-10 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all"
                  placeholder={TXT.emailPlaceholder}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 ml-1">{TXT.passwordLabel}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type={showPwd ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full bg-[#0A0A0B] border rounded-xl pl-10 pr-10 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all ${
                    password && !pwdRules.ok ? "border-rose-500/50" : "border-white/10"
                  }`}
                  placeholder={TXT.passwordPlaceholder}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-2.5 text-slate-500 hover:text-white transition-colors"
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2 pl-1">
                <div className={`flex items-center gap-1.5 text-[10px] ${pwdRules.min ? "text-emerald-400" : "text-slate-500"}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${pwdRules.min ? "bg-emerald-400" : "bg-slate-600"}`} />
                  {TXT.pwdMin}
                </div>
                <div className={`flex items-center gap-1.5 text-[10px] ${pwdRules.upper ? "text-emerald-400" : "text-slate-500"}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${pwdRules.upper ? "bg-emerald-400" : "bg-slate-600"}`} />
                  {TXT.pwdUpper}
                </div>
                <div className={`flex items-center gap-1.5 text-[10px] ${pwdRules.digit ? "text-emerald-400" : "text-slate-500"}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${pwdRules.digit ? "bg-emerald-400" : "bg-slate-600"}`} />
                  {TXT.pwdDigit}
                </div>
                <div className={`flex items-center gap-1.5 text-[10px] ${pwdRules.special ? "text-emerald-400" : "text-slate-500"}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${pwdRules.special ? "bg-emerald-400" : "bg-slate-600"}`} />
                  {TXT.pwdSpecial}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm transition-all shadow-lg shadow-sky-500/20 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : TXT.submit}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{TXT.or}</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <button
            onClick={handleGoogleSignup}
            disabled={loading}
            className="w-full h-11 rounded-xl bg-slate-900 border border-slate-700 hover:border-sky-500/50 text-slate-200 font-medium text-xs flex items-center justify-center gap-2 transition-all hover:bg-slate-800 disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {TXT.google}
          </button>

          <p className="mt-6 text-center text-xs text-slate-500">
            {TXT.already}{" "}
            <Link href="/login" className="text-sky-400 hover:text-sky-300 font-semibold underline decoration-sky-500/30">
              {TXT.goLogin}
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
        <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-slate-500 animate-spin" />
        </div>
      }
    >
      <SignupPageInner />
    </Suspense>
  );
}
