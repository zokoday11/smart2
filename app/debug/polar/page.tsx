// app/debug/polar/page.tsx
"use client";

import { useEffect, useState } from "react";
import type { CreditPackId } from "@/lib/polar";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

type UserProfile = {
  id: string;
  email: string;
  displayName?: string;
  credits?: number;
};

type PackConfig = {
  id: CreditPackId;
  title: string;
  subtitle: string;
  credits: number;
  priceText: string;
  highlight?: boolean;
};

// ✅ Packs alignés avec tes produits Polar : 20 / 50 / 100
const PACKS: PackConfig[] = [
  {
    id: "20",
    title: "Pack 20 crédits",
    subtitle: "≈ 20 crédits",
    credits: 20,
    priceText: "≈ 10 $ (config Polar)",
  },
  {
    id: "50",
    title: "Pack 50 crédits",
    subtitle: "≈ 50 crédits",
    credits: 50,
    priceText: "≈ 25 $ (config Polar)",
    highlight: true,
  },
  {
    id: "100",
    title: "Pack 100 crédits",
    subtitle: "≈ 100 crédits",
    credits: 100,
    priceText: "≈ 40 $ (config Polar)",
  },
];

export default function PolarDebugPage() {
  const [firebaseUser, setFirebaseUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [loadingPack, setLoadingPack] = useState<CreditPackId | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [lastPack, setLastPack] = useState<CreditPackId | null>(null);

  // 🔐 On récupère l'utilisateur Firebase + son doc Firestore ("users/{uid}")
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setLoadingUser(false);
        return;
      }

      try {
        const ref = doc(db, "users", user.uid);
        const snap = await getDoc(ref);
        const data = snap.exists() ? (snap.data() as any) : {};

        const credits =
          typeof data.credits === "number" ? (data.credits as number) : undefined;

        const displayName =
          data.displayName ??
          data.name ??
          data.fullName ??
          user.displayName ??
          undefined;

        const email = user.email ?? data.email ?? "";

        setProfile({
          id: user.uid,
          email,
          displayName,
          credits,
        });
      } catch (err) {
        console.error("[Debug Polar] Erreur chargement profil Firestore :", err);
      } finally {
        setLoadingUser(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleBuy = async (packId: CreditPackId) => {
    try {
      setMessage(null);
      setRawResponse(null);
      setLoadingPack(packId);
      setLastPack(packId);

      if (!profile?.id || !profile.email) {
        setMessage(
          "❌ Impossible de lancer le paiement : utilisateur non connecté ou email manquant."
        );
        return;
      }

      const res = await fetch("/api/polar/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packId,
          userId: profile.id,
          email: profile.email,
        }),
      });

      const data = await res.json();
      console.error("Réponse /api/polar/checkout :", data);
      setRawResponse(data);

      if (!data.ok || !data.url) {
        const msg =
          data.error ||
          data.detail ||
          "❌ Erreur lors de la création du paiement (réponse API).";
        setMessage(msg);
        return;
      }

      // Redirection vers la page de paiement Polar
      window.location.href = data.url;
    } catch (error) {
      console.error("Erreur handleBuy:", error);
      setMessage("❌ Une erreur est survenue côté client.");
    } finally {
      setLoadingPack(null);
    }
  };

  const isLoading = (pack: CreditPackId) => loadingPack === pack;
  const isAuthenticated = !!firebaseUser && !!profile;

  return (
    <main
      style={{
        minHeight: "100vh",
        margin: 0,
        padding: "2rem",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background:
          "radial-gradient(circle at top, #111827 0, #020617 45%, #000 100%)",
        color: "#e5e7eb",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: "960px" }}>
        {/* Header */}
        <header
          style={{
            marginBottom: "1.5rem",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "1.8rem",
                marginBottom: "0.3rem",
                color: "#f9fafb",
              }}
            >
              Mode debug Polar
            </h1>
            <p style={{ margin: 0, color: "#9ca3af", maxWidth: "32rem" }}>
              Cette page te permet de tester les paiements Polar et le crédit
              de l’utilisateur dans Firestore, sans toucher à ton UI principale.
            </p>
          </div>

          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "0.75rem",
              backgroundColor: "rgba(15, 23, 42, 0.85)",
              border: "1px solid rgba(148, 163, 184, 0.4)",
              fontSize: "0.8rem",
              lineHeight: 1.35,
              minWidth: "220px",
            }}
          >
            <div style={{ marginBottom: "0.25rem", fontWeight: 600 }}>
              {loadingUser
                ? "Chargement utilisateur…"
                : isAuthenticated
                ? "Utilisateur connecté"
                : "Aucun utilisateur connecté"}
            </div>

            {isAuthenticated && profile && (
              <>
                {profile.displayName && (
                  <div>
                    <span style={{ color: "#9ca3af" }}>Nom :</span>{" "}
                    <strong>{profile.displayName}</strong>
                  </div>
                )}
                <div>
                  <span style={{ color: "#9ca3af" }}>Email :</span>{" "}
                  <strong>{profile.email}</strong>
                </div>
                <div>
                  <span style={{ color: "#9ca3af" }}>ID :</span>{" "}
                  <code
                    style={{
                      backgroundColor: "rgba(15,23,42,0.9)",
                      padding: "0.1rem 0.3rem",
                      borderRadius: "0.25rem",
                    }}
                  >
                    {profile.id}
                  </code>
                </div>
                {typeof profile.credits === "number" && (
                  <div style={{ marginTop: "0.25rem" }}>
                    <span style={{ color: "#9ca3af" }}>Crédits :</span>{" "}
                    <strong>{profile.credits}</strong>
                  </div>
                )}
              </>
            )}

            {!loadingUser && !isAuthenticated && (
              <div style={{ color: "#f97316", marginTop: "0.3rem" }}>
                Connecte-toi dans l’app pour tester les paiements.
              </div>
            )}
          </div>
        </header>

        {/* Boutons de contrôle */}
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "1.5rem",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            style={{
              padding: "0.5rem 0.9rem",
              borderRadius: "999px",
              border: "1px solid rgba(148, 163, 184, 0.6)",
              backgroundColor: showDetails
                ? "rgba(34, 197, 94, 0.15)"
                : "rgba(15,23,42,0.9)",
              color: showDetails ? "#bbf7d0" : "#e5e7eb",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {showDetails ? "Masquer les détails API" : "Afficher les détails API"}
          </button>

          {lastPack && (
            <button
              type="button"
              onClick={() => handleBuy(lastPack)}
              style={{
                padding: "0.5rem 0.9rem",
                borderRadius: "999px",
                border: "1px solid rgba(148, 163, 184, 0.4)",
                backgroundColor: "rgba(15,23,42,0.9)",
                color: "#e5e7eb",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Relancer le pack testé ({lastPack})
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setRawResponse(null);
            }}
            style={{
              padding: "0.5rem 0.9rem",
              borderRadius: "999px",
              border: "1px solid rgba(55, 65, 81, 0.9)",
              backgroundColor: "transparent",
              color: "#9ca3af",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Effacer les messages
          </button>
        </div>

        {/* Cartes de packs */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          {PACKS.map((pack) => {
            const loading = isLoading(pack.id);
            const disabled = !isAuthenticated || loading;

            return (
              <article
                key={pack.id}
                style={{
                  position: "relative",
                  borderRadius: "1rem",
                  padding: "1.1rem 1.1rem 1rem",
                  background:
                    "linear-gradient(145deg, rgba(15,23,42,0.96), rgba(15,23,42,0.9))",
                  border: pack.highlight
                    ? "1px solid rgba(96, 165, 250, 0.9)"
                    : "1px solid rgba(31, 41, 55, 1)",
                  boxShadow: pack.highlight
                    ? "0 0 0 1px rgba(59,130,246,0.3), 0 18px 40px rgba(15,23,42,0.9)"
                    : "0 14px 35px rgba(15,23,42,0.85)",
                  overflow: "hidden",
                }}
              >
                {pack.highlight && (
                  <div
                    style={{
                      position: "absolute",
                      top: "0.7rem",
                      right: "0.9rem",
                      fontSize: "0.7rem",
                      padding: "0.15rem 0.5rem",
                      borderRadius: "999px",
                      background:
                        "linear-gradient(to right, #2563eb, #22c55e)",
                      color: "#f9fafb",
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    Recommandé
                  </div>
                )}

                <div style={{ marginBottom: "0.75rem" }}>
                  <h2
                    style={{
                      fontSize: "1rem",
                      margin: 0,
                      color: "#f9fafb",
                    }}
                  >
                    {pack.title}
                  </h2>
                  <p
                    style={{
                      margin: "0.15rem 0 0",
                      fontSize: "0.8rem",
                      color: "#9ca3af",
                    }}
                  >
                    {pack.subtitle} • {pack.priceText}
                  </p>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "0.5rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <div style={{ fontSize: "2rem", fontWeight: 700 }}>
                    {pack.credits}
                  </div>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "#9ca3af",
                      fontWeight: 500,
                    }}
                  >
                    crédits
                  </div>
                </div>

                <p
                  style={{
                    margin: 0,
                    fontSize: "0.8rem",
                    color: "#9ca3af",
                    minHeight: "2.4rem",
                  }}
                >
                  Crédits utilisables pour les actions IA (analyse CV,
                  candidatures, etc.).
                </p>

                <div
                  style={{
                    marginTop: "0.9rem",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.75rem",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleBuy(pack.id)}
                    disabled={disabled}
                    style={{
                      flex: 1,
                      padding: "0.55rem 0.8rem",
                      borderRadius: "999px",
                      border: "none",
                      cursor: disabled ? "default" : "pointer",
                      background: pack.highlight
                        ? "linear-gradient(to right, #2563eb, #22c55e)"
                        : "linear-gradient(to right, #4b5563, #1f2937)",
                      color: "#f9fafb",
                      fontSize: "0.85rem",
                      fontWeight: 600,
                      textAlign: "center",
                      opacity: disabled ? 0.5 : 1,
                      transition:
                        "transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease",
                    }}
                  >
                    {loading
                      ? "Redirection..."
                      : isAuthenticated
                      ? "Tester ce pack"
                      : "Connexion requise"}
                  </button>

                  <div
                    style={{
                      fontSize: "0.7rem",
                      color: "#6b7280",
                      textAlign: "right",
                    }}
                  >
                    ID interne :{" "}
                    <code
                      style={{
                        backgroundColor: "rgba(15,23,42,0.9)",
                        padding: "0.15rem 0.35rem",
                        borderRadius: "999px",
                      }}
                    >
                      {pack.id}
                    </code>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        {/* Message d'erreur simple */}
        {message && (
          <div
            style={{
              marginBottom: "1rem",
              padding: "0.75rem 1rem",
              borderRadius: "0.75rem",
              backgroundColor: "rgba(127, 29, 29, 0.4)",
              border: "1px solid rgba(248, 113, 113, 0.7)",
              color: "#fecaca",
              fontSize: "0.85rem",
            }}
          >
            <strong style={{ display: "block", marginBottom: "0.15rem" }}>
              Erreur
            </strong>
            <span>{message}</span>
          </div>
        )}

        {/* Détails API (raw JSON) */}
        {showDetails && rawResponse && (
          <section>
            <h2
              style={{
                fontSize: "0.9rem",
                marginBottom: "0.4rem",
                color: "#e5e7eb",
              }}
            >
              Détails de la dernière réponse API
            </h2>
            <pre
              style={{
                margin: 0,
                padding: "1rem",
                background:
                  "linear-gradient(135deg, rgba(15,23,42,0.98), rgba(15,23,42,0.95))",
                borderRadius: "0.75rem",
                fontSize: "0.78rem",
                overflowX: "auto",
                border: "1px solid rgba(31, 41, 55, 1)",
              }}
            >
{JSON.stringify(rawResponse, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}
