"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { applyActionCode, sendEmailVerification } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

type Status = "idle" | "processing" | "success" | "error";

function VerifyEmailPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, logout } = useAuth();

  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const oobCode = searchParams.get("oobCode");

  // Cas 1 : on arrive depuis le lien de vérification (oobCode dans l'URL)
  useEffect(() => {
    const verify = async () => {
      if (!oobCode) return;

      setStatus("processing");
      setMessage("Vérification de ton email en cours...");

      try {
        await applyActionCode(auth, oobCode);

        if (auth.currentUser) {
          await auth.currentUser.reload();
        }

        setStatus("success");
        setMessage(
          "Email vérifié avec succès. Tu peux maintenant accéder à ton espace candidat."
        );
      } catch (err) {
        console.error("Erreur de vérification d’email :", err);
        setStatus("error");
        setMessage(
          "Le lien de vérification est invalide ou expiré. Demande un nouveau mail de vérification."
        );
      }
    };

    verify();
  }, [oobCode]);

  const handleResend = async () => {
    if (!user) {
      setStatus("error");
      setMessage(
        "Tu dois d’abord te connecter pour renvoyer l’email de vérification."
      );
      return;
    }

    try {
      setStatus("processing");
      setMessage("Envoi d’un nouvel email de vérification...");
      await sendEmailVerification(user);
      setStatus("success");
      setMessage(
        "Email de vérification renvoyé. Vérifie ta boîte de réception."
      );
    } catch (err) {
      console.error("Erreur renvoi email :", err);
      setStatus("error");
      setMessage(
        "Impossible de renvoyer l’email pour le moment. Réessaie plus tard."
      );
    }
  };

  // 🔁 Bouton pour accéder à l'espace candidat
  const handleGoToApp = async () => {
    if (!user) {
      setStatus("error");
      setMessage(
        "Tu dois être connecté pour accéder à l’espace candidat. Connecte-toi puis reviens ici."
      );
      return;
    }

    try {
      setStatus("processing");
      setMessage("Vérification de l’état de ton email...");

      // on rafraîchit le user pour avoir le bon état de emailVerified
      if (user.reload) {
        await user.reload();
      } else if (auth.currentUser) {
        await auth.currentUser.reload();
      }

      const refreshedUser = auth.currentUser ?? user;

      if (!refreshedUser.emailVerified) {
        setStatus("error");
        setMessage(
          "Ton email n’est toujours pas vérifié. Clique sur le lien dans l’email reçu, puis réessaie."
        );
        return;
      }

      setStatus("idle");
      setMessage(null);
      router.push("/app");
    } catch (err) {
      console.error("Erreur lors du check emailVerified :", err);
      setStatus("error");
      setMessage(
        "Impossible de vérifier l’état de ton email pour le moment. Réessaie dans quelques instants."
      );
    }
  };

  // 🔌 Bouton de déconnexion → redirection vers /login
  const handleLogout = async () => {
    try {
      await logout();
      router.push("/login");
    } catch (err) {
      console.error("Erreur déconnexion :", err);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      {/* fond léger comme les autres pages */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.16),_transparent_55%),radial-gradient(circle_at_bottom,_rgba(94,234,212,0.12),_transparent_55%)]" />

      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-3 sm:px-4">
        {/* NAVBAR HAUT DE PAGE */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--border)]/80 bg-[var(--page)]/90 px-0 py-3 backdrop-blur">
          {/* Logo + retour accueil */}
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--brand)]/40 bg-[var(--brand)]/10 text-lg">
              ⚡
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-semibold">
                Assistant Candidature IA
              </span>
              <span className="text-[10px] text-[var(--muted)]">
                Retour à l&apos;accueil
              </span>
            </div>
          </Link>

          {/* Liens Connexion / Inscription / Déconnexion */}
          <div className="flex items-center gap-2 text-[11px]">
            {!user && (
              <>
                <Link
                  href="/login"
                  className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[var(--muted)] transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--ink)]"
                >
                  Se connecter
                </Link>
                <Link
                  href="/signup"
                  className="rounded-full border border-[var(--brand)]/70 bg-[var(--brand)]/20 px-3 py-1.5 text-[var(--ink)] transition-colors hover:bg-[var(--brand)]/30"
                >
                  S&apos;inscrire
                </Link>
              </>
            )}

            {user && (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-1.5 text-[var(--muted)] transition-colors hover:border-red-500/70 hover:text-red-200"
              >
                Se déconnecter
              </button>
            )}
          </div>
        </header>

        {/* CONTENU PRINCIPAL */}
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="relative w-full max-w-md">
            {/* halo derrière la card */}
            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[32px] bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.25),_transparent_55%)] opacity-80" />

            <div className="glass space-y-5 rounded-2xl border border-[var(--border)]/80 bg-[var(--bg)]/85 px-6 py-6 shadow-[0_22px_50px_rgba(0,0,0,0.55)]">
              {/* badge étape */}
              <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)]/80 bg-[var(--bg-soft)] px-3 py-1 text-[10px] text-[var(--muted)]">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--brand)]/30 text-[9px]">
                  2
                </span>
                <span>Étape 2 · Validation du compte</span>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--brand)]/40 bg-[var(--brand)]/12 text-lg">
                  ✉️
                </div>
                <div className="space-y-1">
                  <h1 className="text-sm font-semibold">
                    Vérifie ton adresse email
                  </h1>
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    Pour sécuriser ton espace candidat et activer les fonctionnalités
                    IA, nous devons vérifier ton adresse email.
                  </p>
                </div>
              </div>

              {message && (
                <div
                  className={[
                    "text-[12px] rounded-lg px-3 py-2 border leading-relaxed",
                    status === "error"
                      ? "border-red-500/60 bg-red-500/5 text-red-200"
                      : status === "success"
                      ? "border-emerald-500/60 bg-emerald-500/5 text-emerald-200"
                      : "border-[var(--border)]/80 bg-[var(--bg-soft)] text-[var(--muted)]",
                  ].join(" ")}
                >
                  {message}
                </div>
              )}

              {!oobCode && (
                <div className="space-y-2">
                  <p className="text-[11px] text-[var(--muted)] leading-relaxed">
                    Nous t’avons envoyé un lien de vérification par email. Clique sur
                    le bouton dans l’email pour valider ton compte, puis reviens sur
                    cette page.
                  </p>
                  <ul className="space-y-1 text-[11px] text-[var(--muted)]">
                    <li>• Vérifie aussi les spams / courriers indésirables</li>
                    <li>• Le lien est valable pendant un temps limité</li>
                  </ul>
                </div>
              )}

              <div className="flex flex-col gap-2 text-[12px]">
                <button
                  type="button"
                  onClick={handleResend}
                  className="w-full rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[var(--muted)] transition-colors hover:border-[var(--brand)]/60 hover:text-[var(--ink)] disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={status === "processing"}
                >
                  Renvoyer l’email de vérification
                </button>

                <button
                  type="button"
                  onClick={handleGoToApp}
                  className="w-full rounded-full border border-[var(--brand)]/70 bg-[var(--brand)]/20 px-3 py-2 text-[var(--ink)] transition-colors hover:bg-[var(--brand)]/30"
                >
                  Accéder à l&apos;espace candidat
                </button>
              </div>

              <p className="text-center text-[10px] text-[var(--muted)]">
                Si tu ne vois pas l’email, pense à vérifier les spams ou l’onglet
                &quot;Promotions&quot; de ta boîte de réception.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Wrapper avec Suspense → obligatoire quand on utilise useSearchParams
 * dans une page client pour que le build Next.js ne plante pas.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">
          Chargement…
        </div>
      }
    >
      <VerifyEmailPageInner />
    </Suspense>
  );
}
