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

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 60_000; // 1 minute

function isProbablyMobile() {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

function isInAppBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Instagram / Facebook / Messenger / LinkedIn / Twitter(X) webviews etc.
  return /FBAN|FBAV|Instagram|Line|LinkedInApp|Twitter|X;/i.test(ua);
}

function shouldUseRedirectFlow() {
  // On ne l’utilise PLUS directement pour Google,
  // mais on le garde si tu veux t’en servir plus tard
  return isProbablyMobile() || isInAppBrowser();
}

function formatRecaptchaDetails(check: any) {
  const reason = String(check?.reason || "unknown");
  const score =
    typeof check?.score === "number" ? `score=${check.score.toFixed(2)}` : null;
  const expected = check?.expected ? `expected=${check.expected}` : null;
  const got = check?.got ? `got=${check.got}` : null;

  const parts = [reason, score, expected, got].filter(Boolean);
  return parts.length ? `(${parts.join(", ")})` : "";
}

// ✅ Utilisé seulement pour email + mot de passe
async function checkRecaptchaOrDegrade(params: {
  action: string;
  emailForLog: string;
  providerForLog: "password" | "google";
  onError: (msg: string) => void;
}) {
  const { action, emailForLog, providerForLog, onError } = params;

  // Sur mobile, si reCAPTCHA ne charge pas à cause d’un bloqueur / webview,
  // on autorise un mode dégradé pour ne pas bloquer l’accès.
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
      onError(
        "⚠️ reCAPTCHA bloquée sur ce navigateur (webview / bloqueur). Connexion en mode dégradé. Si possible, ouvre le site dans Chrome/Safari."
      );
      return { ok: true, degraded: true };
    }

    onError(
      "Sécurité: impossible de valider reCAPTCHA (script bloqué ?). Désactive l’adblock ou ouvre dans Chrome/Safari puis réessaie."
    );
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
      onError(
        `⚠️ reCAPTCHA instable sur mobile. Connexion en mode dégradé. ${details}`.trim()
      );
      return { ok: true, degraded: true };
    }

    onError(`Connexion refusée par sécurité. Réessayez. ${details}`.trim());
    return { ok: false, degraded: false };
  }

  return { ok: true, degraded: false };
}

function LoginPageInner() {
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

  // ✅ Affiche le message si compte bloqué (depuis AuthContext)
  useEffect(() => {
    if (!blocked) return;
    setInfo(null);
    setError(
      "Votre compte est bloqué. Si vous pensez que c’est une erreur, contactez l’administrateur."
    );
  }, [blocked]);

  // ✅ Redirection auto si déjà connecté (mais PAS si blocked, ni pendant submit)
  useEffect(() => {
    if (loading) return;
    if (blocked) return;
    if (!user) return;
    if (submitting) return;

    const redirectTo = searchParams.get("redirect") || "/app";
    router.replace(redirectTo);
  }, [loading, blocked, user, searchParams, router, submitting]);

  // ✅ Message query params
  useEffect(() => {
    const justSignedUp = searchParams.get("justSignedUp");
    const blockedParam = searchParams.get("blocked");

    if (blockedParam === "1") {
      setInfo(null);
      setError(
        "Votre compte a été bloqué par l’administrateur. Si vous pensez que c’est une erreur, contactez le support."
      );
    } else if (justSignedUp === "1") {
      setError(null);
      setInfo(
        "Votre compte a bien été créé. Pensez à valider votre adresse email avant votre première connexion."
      );
    }
  }, [searchParams]);

  // ✅ Recharge lock depuis localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedAttempts = window.localStorage.getItem("loginAttempts");
    const storedLockEnd = window.localStorage.getItem("loginLockEnd");
    const now = Date.now();

    if (storedAttempts) {
      const a = parseInt(storedAttempts, 10);
      if (!Number.isNaN(a)) setAttempts(a);
    }

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

  // ✅ Timer lock
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

  // ✅ Finalise le login Google quand on revient de signInWithRedirect()
  useEffect(() => {
    if (typeof window === "undefined") return;

    (async () => {
      try {
        setSubmitting(true);
        const result = await getRedirectResult(auth);
        if (!result) return;

        const u = result.user;

        // Vérif blocage Firestore
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        const data = snap.data() as any | undefined;

        if (data?.blocked) {
          await auth.signOut();
          setError(
            "Votre compte est bloqué. Si vous pensez que c’est une erreur, contactez l’administrateur."
          );
          return;
        }

        const displayName = u.displayName || u.email || "";
        setInfo(`Bienvenue ${displayName} 👋`);

        const redirectTo = searchParams.get("redirect") || "/app";
        router.replace(redirectTo);
      } catch (err: any) {
        // Important: getRedirectResult peut throw si rien / annulé selon environnements
        console.error("getRedirectResult error:", err);
      } finally {
        setSubmitting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  //  LOGIN EMAIL / PASSWORD
  // -------------------------
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (isLocked) return;

    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      // ✅ reCAPTCHA avant Firebase Auth (avec fallback mobile)
      const cap = await checkRecaptchaOrDegrade({
        action: "login",
        emailForLog: email,
        providerForLog: "password",
        onError: (msg) => setInfo(msg),
      });
      if (!cap.ok) return;

      const cred = await signInWithEmailAndPassword(auth, email, password);

      // Vérif blocage Firestore
      const ref = doc(db, "users", cred.user.uid);
      const snap = await getDoc(ref);
      const data = snap.data() as any | undefined;

      if (data?.blocked) {
        await auth.signOut();
        setError(
          "Votre compte est bloqué. Si vous pensez que c’est une erreur, contactez l’administrateur."
        );
        return;
      }

      // ✅ Reset lock
      setAttempts(0);
      setIsLocked(false);
      setLockEnd(null);
      setLockRemaining(0);
      window.localStorage.removeItem("loginAttempts");
      window.localStorage.removeItem("loginLockEnd");

      const redirectTo = searchParams.get("redirect") || "/app";
      router.replace(redirectTo);
    } catch (err: any) {
      console.error("Erreur login:", err);

      const code = err?.code as string | undefined;

      logAuthFailed({
        email,
        provider: "password",
        errorCode: code,
        errorMessage: err?.message,
      });

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

      if (code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("Email ou mot de passe incorrect. Vérifiez vos identifiants puis réessayez.");
      } else if (code === "auth/too-many-requests") {
        setError(
          "Trop de tentatives échouées. Blocage temporaire côté serveur. Réessayez dans quelques minutes ou réinitialisez votre mot de passe."
        );
      } else if (code === "auth/network-request-failed") {
        setError("Problème de connexion réseau. Vérifiez votre connexion Internet.");
      } else {
        setError("Impossible de vous connecter pour le moment. Réessayez dans quelques instants.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------
  //  LOGIN GOOGLE (SIMPLIFIÉ)
  // -------------------------
  const handleGoogleLogin = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      const provider = googleProvider || new GoogleAuthProvider();

      // ✅ NO reCAPTCHA pour Google → on évite le combo redirect + enterprise qui casse sur mobile

      // 1) On tente TOUJOURS le popup (desktop + mobile)
      try {
        const result = await signInWithPopup(auth, provider);
        const u = result.user;

        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        const data = snap.data() as any | undefined;

        if (data?.blocked) {
          await auth.signOut();
          setError(
            "Votre compte est bloqué. Si vous pensez que c’est une erreur, contactez l’administrateur."
          );
          return;
        }

        const displayName = u.displayName || u.email || "";
        setInfo(`Bienvenue ${displayName} 👋`);

        const redirectTo = searchParams.get("redirect") || "/app";
        router.replace(redirectTo);
      } catch (err: any) {
        const code = err?.code as string | undefined;

        // 2) Popup bloquée → fallback redirect (tous devices)
        if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
          await signInWithRedirect(auth, provider);
          return;
        }

        throw err;
      }
    } catch (err: any) {
      console.error("Google login error:", err);
      const code = err?.code as string | undefined;

      logAuthFailed({
        email,
        provider: "google",
        errorCode: code,
        errorMessage: err?.message,
      });

      if (code === "auth/account-exists-with-different-credential") {
        setError(
          "Un compte existe déjà pour cette adresse email avec une autre méthode. Essayez avec votre mot de passe habituel."
        );
      } else if (code === "auth/popup-closed-by-user") {
        setError("La fenêtre Google a été fermée avant la fin du processus.");
      } else if (code === "auth/network-request-failed") {
        setError("Problème de connexion réseau. Vérifiez votre connexion Internet.");
      } else {
        setError("Impossible de vous connecter avec Google pour le moment.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const attemptsLeft = Math.max(0, MAX_ATTEMPTS - attempts);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">
        Chargement…
      </div>
    );
  }

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
                Assistant candidatures
              </span>
              <span className="text-xs font-medium text-slate-100">Connexion</span>
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
              href="/signup"
              className="px-3 py-1 rounded-full bg-sky-500/90 text-slate-950 font-medium hover:bg-sky-400 transition-colors"
            >
              S&apos;inscrire
            </Link>
          </nav>
        </div>
      </header>

      {/* CONTENU */}
      <main className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="glass max-w-md w-full p-6 sm:p-7 rounded-2xl border border-slate-800 bg-slate-950/80 shadow-2xl shadow-sky-900/40">
          <div className="mb-4">
            <p className="inline-flex items-center gap-2 rounded-full bg-slate-900/80 border border-slate-700 px-3 py-1 mb-2">
              <span className="text-xs">🔐</span>
              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-300">
                Connexion
              </span>
            </p>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-50">
              Connexion à votre espace
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Connectez-vous pour accéder à votre tableau de bord, votre CV IA et vos candidatures.
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

          {isLocked && lockRemaining > 0 && (
            <div className="mb-3 rounded-lg border border-amber-500/70 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
              <span className="font-semibold">Votre compte est temporairement bloqué.</span>{" "}
              Trop de tentatives échouées. Réessayez dans environ {lockRemaining} seconde
              {lockRemaining > 1 ? "s" : ""} ou utilisez{" "}
              <span className="font-semibold">« Mot de passe oublié »</span>.
            </div>
          )}

          {!isLocked && attempts > 0 && attemptsLeft > 0 && (
            <p className="mb-2 text-[10px] text-slate-400">
              Tentative échouée. Il vous reste{" "}
              <span className="font-semibold">{attemptsLeft}</span> tentative
              {attemptsLeft > 1 ? "s" : ""} avant le blocage temporaire.
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-3 text-sm">
            <div>
              <label className="block mb-1 text-xs text-slate-300">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500"
                placeholder="vous@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting || isLocked}
              />
            </div>

            <div>
              <label className="block mb-1 text-xs text-slate-300">Mot de passe</label>
              <div className="relative">
                <input
                  type={showPwd ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 pr-16"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting || isLocked}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute inset-y-0 right-2 flex items-center text-[11px] text-slate-400 hover:text-slate-200"
                >
                  {showPwd ? "Masquer" : "Afficher"}
                </button>
              </div>
              <div className="mt-1 flex justify-between items-center">
                <Link
                  href="/forgot-password"
                  className="text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || isLocked}
              className="w-full inline-flex items-center justify-center rounded-lg bg-sky-500 hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed text-xs font-medium text-white px-3 py-2 transition-colors mt-1"
            >
              {isLocked ? "Compte temporairement bloqué" : submitting ? "Connexion..." : "Se connecter"}
            </button>
          </form>

          <div className="flex items-center gap-2 my-4">
            <div className="h-px flex-1 bg-slate-800" />
            <span className="text-[10px] text-slate-500 uppercase tracking-[0.16em]">
              ou
            </span>
            <div className="h-px flex-1 bg-slate-800" />
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={submitting}
            className="w-full inline-flex items-center justify-center rounded-lg bg-slate-900/80 border border-slate-700 hover:border-sky-500 text-xs font-medium text-slate-100 px-3 py-2.5 transition-colors"
          >
            Continuer avec <span className="font-semibold ml-1">Google</span>
          </button>

          <p className="mt-4 text-[11px] text-slate-400 text-center">
            Pas encore de compte ?{" "}
            <Link
              href="/signup"
              className="text-sky-400 hover:text-sky-300 hover:underline font-medium"
            >
              Créer un compte
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">
          Chargement…
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}
