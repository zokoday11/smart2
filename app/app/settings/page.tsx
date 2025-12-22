"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";
import { updateEmail, sendEmailVerification } from "firebase/auth";

export default function SettingsPage() {
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState(user?.email ?? "");
  const [saving, setSaving] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Si pas connecté, on affiche juste un message (et on ne montre pas le reste de la page)
  if (!user) {
    return (
      <div className="max-w-4xl mx-auto glass p-4 text-sm">
        <p className="text-[var(--muted)]">
          Tu dois être connecté pour accéder à tes paramètres.
        </p>
      </div>
    );
  }

  async function handleResendVerification() {
    setError(null);
    setInfo(null);

    // 🔐 Sécurité + typage TS : on revérifie que user existe
    if (!user) {
      setError("Tu dois être connecté pour envoyer un email de vérification.");
      return;
    }

    setSendingVerification(true);
    try {
      await sendEmailVerification(user);
      setInfo(
        `Un nouvel email de validation a été envoyé à ${user.email}. Pense à vérifier tes spams.`
      );
    } catch (err) {
      console.error("Resend verification error:", err);
      setError(
        "Impossible d'envoyer l'email de validation pour le moment. Merci de réessayer plus tard."
      );
    } finally {
      setSendingVerification(false);
    }
  }

  async function handleChangeEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSaving(true);

    // 🔐 Sécurité + typage TS : on revérifie que user existe
    if (!user) {
      setError(
        "Tu dois être connecté pour modifier ton adresse email."
      );
      setSaving(false);
      return;
    }

    try {
      if (!newEmail || newEmail === user.email) {
        setInfo("L'adresse email est déjà à jour.");
        setSaving(false);
        return;
      }

      await updateEmail(user, newEmail);

      try {
        await sendEmailVerification(user);
        setInfo(
          `Ton adresse email a été mise à jour. Un email de validation a été envoyé à ${newEmail}.`
        );
      } catch (e) {
        console.error("sendEmailVerification après updateEmail:", e);
        setInfo(
          `Ton adresse email a été mise à jour en ${newEmail}, mais l'email de validation n'a pas pu être envoyé.`
        );
      }
    } catch (err: any) {
      console.error("Update email error:", err);
      const code = err?.code as string | undefined;

      if (code === "auth/invalid-email") {
        setError("L'adresse email saisie n'est pas valide.");
      } else if (code === "auth/email-already-in-use") {
        setError("Cette adresse email est déjà associée à un autre compte.");
      } else if (code === "auth/requires-recent-login") {
        setError(
          "Pour modifier ton adresse email, merci de te reconnecter puis de réessayer (mesure de sécurité)."
        );
      } else {
        setError(
          "Impossible de mettre à jour l'adresse email pour le moment. Merci de réessayer."
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto glass p-4 sm:p-6 text-sm">
      <h1 className="text-lg font-semibold mb-2">Profil & sécurité</h1>
      <p className="text-xs text-[var(--muted)] mb-4">
        Gère ton adresse email de connexion et le statut de validation de ton compte.
      </p>

      {info && (
        <p className="mb-3 text-xs text-emerald-400 bg-emerald-400/10 border border-emerald-400/40 rounded-md px-3 py-2">
          {info}
        </p>
      )}
      {error && (
        <p className="mb-3 text-xs text-red-400 bg-red-400/10 border border-red-400/40 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div className="space-y-4">
        {/* Statut actuel */}
        <div>
          <h2 className="text-sm font-semibold mb-1">
            Statut de l&apos;adresse email
          </h2>
          <p className="text-xs text-[var(--muted)] mb-1">
            Adresse actuelle :{" "}
            <span className="font-medium text-[var(--ink)]">
              {user.email}
            </span>
          </p>
          <p className="text-xs">
            {user.emailVerified ? (
              <span className="text-emerald-400">
                ✅ Adresse email vérifiée. Ton compte est pleinement activé.
              </span>
            ) : (
              <span className="text-amber-300">
                ⚠️ Adresse email non vérifiée. Certaines fonctionnalités peuvent
                être restreintes tant que tu n&apos;as pas validé ton email.
              </span>
            )}
          </p>

          {!user.emailVerified && (
            <button
              type="button"
              onClick={handleResendVerification}
              disabled={sendingVerification}
              className="btn-secondary mt-2 text-xs"
            >
              {sendingVerification
                ? "Envoi en cours..."
                : "Renvoyer l’email de validation"}
            </button>
          )}
        </div>

        <hr className="border-[var(--border)]/60" />

        {/* Modification de l'email */}
        <div>
          <h2 className="text-sm font-semibold mb-2">
            Modifier mon adresse email
          </h2>
          <p className="text-xs text-[var(--muted)] mb-3">
            Utilise une adresse que tu consultes régulièrement. Pour des raisons
            de sécurité, il est possible que nous te demandions de te reconnecter
            avant de valider le changement.
          </p>

          <form
            onSubmit={handleChangeEmail}
            className="space-y-2 text-sm max-w-sm"
          >
            <div>
              <label className="block mb-1 text-xs" htmlFor="newEmail">
                Nouvelle adresse email
              </label>
              <input
                id="newEmail"
                type="email"
                className="w-full rounded-lg bg-[var(--bg-soft)] border border-[var(--border)] px-3 py-2 text-xs"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="btn-primary mt-1"
            >
              {saving ? "Mise à jour..." : "Mettre à jour l'adresse email"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
