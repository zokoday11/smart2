"use client";

import { Suspense, useState, useEffect, FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth, googleProvider, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";
import { logAuthFailed } from "@/lib/logAuthFailed";
import { getRecaptchaToken, verifyRecaptcha } from "@/lib/recaptcha";
import {
  ArrowLeft,
  LogIn,
  Mail,
  Lock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// --- CONFIG & HELPERS ---
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 60_000;

function isProbablyMobile() {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|LinkedInApp|Twitter|X;/i.test(ua);
}

function shouldUseRedirectFlow() {
  return isProbablyMobile() || isInAppBrowser();
}

function formatRecaptchaDetails(check: any) {
  const reason = String(check?.reason || "unknown");
  const score = typeof check?.score === "number" ? `score=${check.score.toFixed(2)}` : null;
  const parts = [reason, score].filter(Boolean);
  return parts.length ? `(${parts.join(", ")})` : "";
}

async function checkRecaptchaOrDegrade(params: {
  action: string;
  emailForLog: string;
  providerForLog: "password" | "google";
  onError: (msg: string) => void;
  t: (k: string, opt?: any) => string;
}) {
  const { action, emailForLog, providerForLog, onError, t } = params;
  const allowDegraded = shouldUseRedirectFlow();

  let token = "";
  try {
    token = await getRecaptchaToken(action);
  } catch (e: any) {
    logAuthFailed({
      email: emailForLog,
      provider: providerForLog,
      errorCode: "recaptcha:token_error",
      errorMessage: e?.message || "getRecaptchaToken failed",
    });

    if (allowDegraded) {
      onError(t("auth.login.messages.recaptchaDegraded"));
      return { ok: true, degraded: true };
    }

    onError(t("auth.login.messages.recaptchaBlocked"));
    return { ok: false, degraded: false };
  }

  const check: any = await verifyRecaptcha(token, action);
  if (!check.ok) {
    const details = formatRecaptchaDetails(check);
    logAuthFailed({
      email: emailForLog,
      provider: providerForLog,
      errorCode: `recaptcha:${check.reason}`,
      errorMessage: `score=${check.score ?? "?"}`,
    });

    if (allowDegraded && (check.reason === "timeout" || check.reason === "unavailable")) {
      return { ok: true, degraded: true };
    }

    onError(t("auth.login.messages.recaptchaRefused", { details }));
    return { ok: false, degraded: false };
  }

  return { ok: true, degraded: false };
}

function mapLoginError(t: (k: string, opt?: any) => string, err: any) {
  const code = err?.code;
  if (code === "auth/wrong-password" || code === "auth/user-not-found") return t("auth.login.errors.invalidCredentials");
  if (code === "auth/too-many-requests") return t("auth.login.errors.tooManyRequests");
  return t("auth.login.errors.generic");
}

function LoginPageInner() {
  const { t } = useTranslation(["common", "auth"]);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, blocked } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [attempts, setAttempts] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [lockEnd, setLockEnd] = useState<number | null>(null);
  const [lockRemaining, setLockRemaining] = useState(0);

  useEffect(() => {
    if (blocked) {
      setInfo(null);
      setError(t("auth.login.messages.accountBlocked"));
    }
  }, [blocked, t]);

  useEffect(() => {
    if (!loading && !blocked && user && !submitting) {
      const redirectTo = searchParams.get("redirect") || "/app";
      router.replace(redirectTo);
    }
  }, [loading, blocked, user, searchParams, router, submitting]);

  useEffect(() => {
    const justSignedUp = searchParams.get("justSignedUp");
    const blockedParam = searchParams.get("blocked");

    if (blockedParam === "1") {
      setInfo(null);
      setError(t("auth.login.messages.blockedByAdmin"));
    } else if (justSignedUp === "1") {
      setError(null);
      setInfo(t("auth.login.messages.accountCreated"));
    }
  }, [searchParams, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedAttempts = window.localStorage.getItem("loginAttempts");
    const storedLockEnd = window.localStorage.getItem("loginLockEnd");
    const now = Date.now();

    if (storedAttempts) setAttempts(parseInt(storedAttempts, 10) || 0);

    if (storedLockEnd) {
      const end = parseInt(storedLockEnd, 10);
      if (!Number.isNaN(end) && end > now) {
        setIsLocked(true);
        setLockEnd(end);
        setLockRemaining(Math.ceil((end - now) / 1000));
      } else {
        window.localStorage.removeItem("loginAttempts");
        window.localStorage.removeItem("loginLockEnd");
      }
    }
  }, []);

  useEffect(() => {
    if (!isLocked || !lockEnd) return;
    const id = window.setInterval(() => {
      const diff = lockEnd - Date.now();
      if (diff <= 0) {
        setIsLocked(false);
        setAttempts(0);
        setLockEnd(null);
        setLockRemaining(0);
        window.localStorage.removeItem("loginAttempts");
        window.localStorage.removeItem("loginLockEnd");
        window.clearInterval(id);
      } else {
        setLockRemaining(Math.ceil(diff / 1000));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [isLocked, lockEnd]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    (async () => {
      try {
        setSubmitting(true);
        const result = await getRedirectResult(auth);
        if (!result) return;

        const u = result.user;
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);

        if (snap.data()?.blocked) {
          await auth.signOut();
          setError(t("auth.login.messages.accountBlockedShort"));
          return;
        }

        setInfo(t("auth.login.messages.welcome", { name: u.displayName || u.email || "" }));
        const redirectTo = searchParams.get("redirect") || "/app";
        router.replace(redirectTo);
      } catch (err: any) {
        console.error("Redirect login error:", err);
      } finally {
        setSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      const cap = await checkRecaptchaOrDegrade({
        action: "login",
        emailForLog: email,
        providerForLog: "password",
        onError: (msg) => setInfo(msg),
        t,
      });
      if (!cap.ok) return;

      const cred = await signInWithEmailAndPassword(auth, email, password);
      const snap = await getDoc(doc(db, "users", cred.user.uid));

      if (snap.data()?.blocked) {
        await auth.signOut();
        setError(t("auth.login.messages.accountBlockedShort"));
        return;
      }

      setAttempts(0);
      setIsLocked(false);
      window.localStorage.removeItem("loginAttempts");
      window.localStorage.removeItem("loginLockEnd");

      const redirectTo = searchParams.get("redirect") || "/app";
      router.replace(redirectTo);
    } catch (err: any) {
      logAuthFailed({ email, provider: "password", errorCode: err.code, errorMessage: err.message });

      setAttempts((prev) => {
        const next = prev + 1;
        window.localStorage.setItem("loginAttempts", String(next));
        if (next >= MAX_ATTEMPTS) {
          const end = Date.now() + LOCK_DURATION_MS;
          setIsLocked(true);
          setLockEnd(end);
          setLockRemaining(Math.ceil(LOCK_DURATION_MS / 1000));
          window.localStorage.setItem("loginLockEnd", String(end));
        }
        return next;
      });

      setError(mapLoginError(t, err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const provider = googleProvider || new GoogleAuthProvider();
      try {
        const result = await signInWithPopup(auth, provider);
        const snap = await getDoc(doc(db, "users", result.user.uid));
        if (snap.data()?.blocked) {
          await auth.signOut();
          setError(t("auth.login.messages.accountBlockedShort"));
          return;
        }
        const redirectTo = searchParams.get("redirect") || "/app";
        router.replace(redirectTo);
      } catch (e: any) {
        if (e.code === "auth/popup-blocked") {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw e;
      }
    } catch (err: any) {
      logAuthFailed({ email, provider: "google", errorCode: err.code, errorMessage: err.message });
      setError(t("auth.login.errors.google"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-950 via-slate-950/95 to-slate-900 text-slate-100">
      {/* NAVBAR */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-500 to-sky-400 flex items-center justify-center text-[10px] font-semibold text-slate-950 shadow-lg shadow-sky-500/40">
              IA
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-400">
                {t("common.app.tagline", "Assistant candidatures")}
              </span>
              <span className="text-xs font-medium text-slate-100">{t("auth.login.nav.title")}</span>
            </div>
          </div>
          <nav className="flex items-center gap-2 text-[11px]">
            <Link
              href="/"
              className="px-2 py-1 rounded-full border border-slate-700/80 hover:border-sky-500/80 text-slate-300 hover:text-sky-300 transition-colors flex items-center gap-1"
            >
              <ArrowLeft className="w-3 h-3" /> {t("auth.login.nav.back")}
            </Link>
            <Link href="/signup" className="px-3 py-1 rounded-full bg-sky-500/90 text-slate-950 font-medium hover:bg-sky-400 transition-colors">
              {t("auth.login.nav.signup")}
            </Link>
          </nav>
        </div>
      </header>

      {/* CONTENU */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="glass max-w-md w-full p-6 sm:p-7 rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl shadow-sky-900/40">
          <div className="mb-6 text-center sm:text-left">
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-700 px-3 py-1 mb-3">
              <LogIn className="w-3 h-3 text-sky-400" />
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-300">{t("auth.login.badge")}</span>
            </p>
            <h1 className="text-xl font-bold text-slate-50 mb-1">{t("auth.login.title")}</h1>
            <p className="text-xs text-slate-400">{t("auth.login.subtitle")}</p>
          </div>

          {/* MESSAGES */}
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
          {isLocked && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex gap-2 items-start">
              <Lock className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{t("auth.login.messages.locked", { seconds: lockRemaining })}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300 ml-1">{t("auth.login.form.email.label")}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl pl-10 pr-3 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all"
                  placeholder={t("auth.login.form.email.placeholder")}
                  disabled={submitting || isLocked}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center ml-1">
                <label className="text-xs font-medium text-slate-300">{t("auth.login.form.password.label")}</label>
                <Link href="/forgot-password" className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                  {t("auth.login.form.password.forgot")}
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-2.5 w-4 h-4 text-slate-500" />
                <input
                  type={showPwd ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#0A0A0B] border border-white/10 rounded-xl pl-10 pr-10 py-2 text-xs text-white placeholder:text-slate-600 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none transition-all"
                  placeholder={t("auth.login.form.password.placeholder")}
                  disabled={submitting || isLocked}
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-2.5 text-slate-500 hover:text-white transition-colors">
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || isLocked}
              className="w-full h-11 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm transition-all shadow-lg shadow-sky-500/20 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("auth.login.form.submit")}
            </button>
          </form>

          <div className="flex items-center gap-3 my-5">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{t("auth.login.or")}</span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <button
            onClick={handleGoogleLogin}
            disabled={submitting}
            className="w-full h-11 rounded-xl bg-slate-900 border border-slate-700 hover:border-sky-500/50 text-slate-200 font-medium text-xs flex items-center justify-center gap-2 transition-all hover:bg-slate-800 disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {t("auth.login.google")}
          </button>

          <p className="mt-6 text-center text-xs text-slate-500">
            {t("auth.login.footer.newHere")}{" "}
            <Link href="/signup" className="text-sky-400 hover:text-sky-300 font-semibold underline decoration-sky-500/30">
              {t("auth.login.footer.createAccount")}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center"><Loader2 className="w-6 h-6 text-slate-500 animate-spin" /></div>}>
      <LoginPageInner />
    </Suspense>
  );
}
