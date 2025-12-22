"use client";

import { useEffect, useRef, useState } from "react";
import { useUserCredits } from "@/hooks/useUserCredits";
import { useAuth } from "@/context/AuthContext";
import { getRecaptchaToken } from "@/lib/recaptcha";

type PackKey = "20" | "50" | "100";

const CREDIT_PACKS: {
  key: PackKey;
  label: string;
  credits: number;
  desc: string;
}[] = [
  {
    key: "20",
    credits: 20,
    label: "Pack Découverte",
    desc: "Idéal pour tester les fonctionnalités IA.",
  },
  {
    key: "50",
    credits: 50,
    label: "Pack Boost",
    desc: "Parfait pour une phase active de recherche.",
  },
  {
    key: "100",
    credits: 100,
    label: "Pack Intensif",
    desc: "Pour candidatures + entretiens à fond.",
  },
];

// ⚙️ Base de l'API :
// - en prod : Cloud Functions
// - en dev : tu peux override avec NEXT_PUBLIC_API_BASE_URL dans .env.local
const DEFAULT_API_BASE =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net";

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, "");

export default function CreditsPage() {
  const { user } = useAuth();
  const { credits, loading, error } = useUserCredits();

  const [buyLoading, setBuyLoading] = useState<PackKey | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  // 👉 URL d’embed du checkout Polar (quand non null, on affiche la popup)
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // 🎉 Animation / bandeau succès dans la page
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);

  // Pour info, si un jour tu veux savoir quel pack a été démarré
  const [lastPack, setLastPack] = useState<PackKey | null>(null);

  // Message global en haut de page (success / cancel)
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // ✅ IMPORTANT (Option B) :
  // on mémorise le solde AVANT l’achat, puis on ferme automatiquement la popup
  // dès que credits > soldeAvant (webhook OK -> Firestore se met à jour)
  const [creditsBeforePurchase, setCreditsBeforePurchase] = useState<number | null>(
    null
  );

  const triggerSuccessClose = (message?: string) => {
    setEmbedUrl(null);
    setBuyLoading(null);
    setLastPack(null);
    setCreditsBeforePurchase(null);

    setShowSuccessAnimation(true);
    window.setTimeout(() => setShowSuccessAnimation(false), 4000);

    setStatusMessage(
      message ||
        "✅ Paiement confirmé ! Tes crédits ont été ajoutés à ton compte."
    );
  };

  const handleBuy = async (pack: PackKey) => {
    try {
      setBuyError(null);
      setStatusMessage(null);

      if (!user?.uid || !user.email) {
        setBuyError("Tu dois être connecté pour recharger tes crédits.");
        return;
      }

      setBuyLoading(pack);
      setLastPack(pack);

      // On capture le solde actuel pour détecter l’augmentation après webhook
      if (typeof credits === "number") {
        setCreditsBeforePurchase(credits);
      } else {
        setCreditsBeforePurchase(0);
      }

      // 👉 Appel à ta Cloud Function HTTPS : /polarCheckout
      const endpoint = `${API_BASE}/polarCheckout`;

      // ✅ reCAPTCHA token
      let recaptchaToken = "";
      try {
        recaptchaToken = await getRecaptchaToken("polar_checkout");
      } catch {
        setBuyError(
          "Sécurité: impossible de valider reCAPTCHA (script bloqué ?). Désactive l'adblock et réessaie."
        );
        setBuyLoading(null);
        setCreditsBeforePurchase(null);
        return;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId: pack, // "20" | "50" | "100"
          userId: user.uid, // pour externalCustomerId
          email: user.email, // pour customerEmail
          recaptchaToken, // ✅ ajouté
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      let data: any = null;

      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        console.error(
          "[Credits] Réponse non JSON de /polarCheckout :",
          text.slice(0, 300)
        );
        throw new Error(
          "Le serveur de paiement a renvoyé une réponse invalide (HTML). Vérifie la fonction polarCheckout."
        );
      }

      if (!res.ok || !data?.url) {
        console.error("Erreur API /polarCheckout :", data);
        throw new Error(data?.error || "Impossible de créer le paiement Polar.");
      }

      // 👉 On ajoute les params d’embed : embed=true & embed_origin=...
      const origin = window.location.origin;
      const urlBase = data.url as string;
      const sep = urlBase.includes("?") ? "&" : "?";
      const fullEmbedUrl = `${urlBase}${sep}embed=true&embed_origin=${encodeURIComponent(
        origin
      )}`;

      setEmbedUrl(fullEmbedUrl); // ouvre la popup
    } catch (e: any) {
      console.error("Erreur checkout Polar (iframe) :", e);
      setBuyError(
        e?.message ||
          "Erreur lors de la création du paiement. Essaie à nouveau dans quelques instants."
      );
      setBuyLoading(null);
      setCreditsBeforePurchase(null);
    }
  };

  // 🔐 (Option A / bonus) : si un jour Polar redirige l’iframe vers ton domaine,
  // on peut fermer via status=success. Mais actuellement l’iframe reste chez Polar,
  // donc ça ne marche pas (cross-origin).
  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const win = iframe.contentWindow;
      if (!win) return;

      const href = win.location.href; // accessible seulement si même origine

      if (href.includes("/app/credits") && href.includes("status=success")) {
        triggerSuccessClose(
          "✅ Paiement confirmé ! Tes crédits vont se mettre à jour dans quelques instants."
        );
      }

      if (href.includes("/app/credits") && href.includes("status=cancel")) {
        setEmbedUrl(null);
        setBuyLoading(null);
        setLastPack(null);
        setCreditsBeforePurchase(null);
        setStatusMessage("Paiement annulé.");
      }
    } catch {
      // cross-origin -> normal
    }
  };

  // ✅ LA FERMETURE AUTO (Option B) :
  // Dès que les crédits augmentent après l’achat, on ferme la popup.
  useEffect(() => {
    if (!embedUrl) return;
    if (creditsBeforePurchase === null) return;
    if (loading) return;
    if (typeof credits !== "number") return;

    if (credits > creditsBeforePurchase) {
      triggerSuccessClose("✅ Paiement confirmé ! Tes crédits ont été ajoutés.");
    }
  }, [credits, loading, embedUrl, creditsBeforePurchase]);

  const closeModal = () => {
    setEmbedUrl(null);
    setBuyLoading(null);
    setLastPack(null);
    setCreditsBeforePurchase(null);
  };

  // Si on arrive sur /app/credits?status=success dans la page normale (sans iframe)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const status = url.searchParams.get("status");

    if (status === "success") {
      setStatusMessage("✅ Paiement confirmé ! Tes crédits ont été pris en compte.");
      setShowSuccessAnimation(true);
      setTimeout(() => setShowSuccessAnimation(false), 4000);
    } else if (status === "cancel") {
      setStatusMessage("Paiement annulé.");
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Animation succès flottante */}
      {showSuccessAnimation && (
        <div className="fixed top-4 left-1/2 z-40 -translate-x-1/2">
          <div className="rounded-full border border-emerald-400/70 bg-emerald-500/10 px-4 py-2 shadow-lg backdrop-blur flex items-center gap-2 animate-[fadeInOut_4s_ease-in-out]">
            <span className="text-lg">⚡</span>
            <span className="text-[13px] text-emerald-200">
              Crédits ajoutés à ton compte !
            </span>
          </div>
        </div>
      )}

      {/* Titre + résumé */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-[var(--ink)]">
            Crédits IA
          </h1>
          <p className="text-[12px] text-[var(--muted)]">
            Utilise tes crédits pour analyser ton CV, générer des lettres de motivation,
            des pitchs, et préparer tes entretiens.
          </p>
        </div>

        {/* Petit récap du solde */}
        <div className="inline-flex flex-col items-end gap-1">
          <span className="text-[11px] text-[var(--muted)]">Solde actuel</span>
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] bg-[var(--bg-soft)] border border-[var(--border)]/80">
            <span className="text-[15px]">⚡</span>
            {loading ? (
              <span className="text-[var(--muted)]">Chargement…</span>
            ) : (
              <span className="font-semibold text-[var(--ink)]">{credits} crédits</span>
            )}
          </div>
        </div>
      </div>

      {statusMessage && <p className="text-[12px] text-emerald-400">{statusMessage}</p>}
      {error && <p className="text-[12px] text-red-400">{error}</p>}

      {/* Packs de rechargement */}
      <section className="glass border border-[var(--border)]/80 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">
              Recharger mes crédits
            </h2>
            <p className="text-[12px] text-[var(--muted)]">
              Choisis un pack ci-dessous pour ajouter des crédits à ton compte.
              Paiement sécurisé via Polar.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("credit-packs");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="btn-primary text-[12px] px-3 py-1.5"
          >
            Ajouter du crédit
          </button>
        </div>

        <div
          id="credit-packs"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-2"
        >
          {CREDIT_PACKS.map((pack) => (
            <div
              key={pack.key}
              className="card-soft border border-[var(--border)]/80 rounded-2xl p-3 sm:p-4 flex flex-col justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-semibold text-[var(--ink)]">
                    {pack.label}
                  </h3>
                  <span className="inline-flex items-center rounded-full px-2 py-[2px] text-[11px] bg-[var(--bg)] border border-[var(--border)]/80">
                    ⚡ {pack.credits} crédits
                  </span>
                </div>
                <p className="text-[12px] text-[var(--muted)]">{pack.desc}</p>
              </div>

              <div className="mt-3 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => handleBuy(pack.key)}
                  disabled={buyLoading === pack.key}
                  className="btn-primary w-full text-[12px] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {buyLoading === pack.key ? (
                    <>
                      <span className="loader" />
                      <span>Ouverture du paiement…</span>
                    </>
                  ) : (
                    <>
                      <span>Recharger</span>
                      <span className="text-[13px]">→</span>
                    </>
                  )}
                </button>
                <span className="text-[10px] text-[var(--muted)] text-center">
                  Paiement unique, pas d’abonnement.
                </span>
              </div>
            </div>
          ))}
        </div>

        {buyError && <p className="text-[12px] text-red-400">{buyError}</p>}
      </section>

      {/* Explication d’usage */}
      <section className="text-[11px] text-[var(--muted)] space-y-1">
        <p>
          1 crédit ≈ 1 action IA (analyse CV, génération de lettre, pitch, Q&A entretien…).
        </p>
        <p>
          Ton solde est mis à jour automatiquement après chaque achat dès que le paiement est confirmé
          (via le webhook Polar).
        </p>
      </section>

      {/* 🔥 POPUP CHECKOUT POLAR EN IFRAME */}
      {embedUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="relative w-full max-w-lg h-[520px] sm:h-[580px] bg-[var(--bg)] border border-[var(--border)]/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]/70 bg-[var(--bg-soft)]/80">
              <div className="flex flex-col">
                <span className="text-[12px] font-semibold text-[var(--ink)]">
                  Paiement sécurisé
                </span>
                <span className="text-[11px] text-[var(--muted)]">
                  Transaction gérée par Polar (Stripe)
                </span>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="text-[11px] rounded-full border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg)]"
              >
                ✕
              </button>
            </div>

            <iframe
              ref={iframeRef}
              src={embedUrl}
              onLoad={handleIframeLoad}
              className="flex-1 w-full border-0"
              title="Paiement Polar"
              allow="payment *; publickey-credentials-get *"
            />
          </div>
        </div>
      )}
    </div>
  );
}
