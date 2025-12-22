"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function TopbarUser() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout(); // ou ton signOut(auth) dans le contexte
      router.push("/login");
    } catch (err) {
      console.error("Erreur déconnexion :", err);
    }
  };

  // On privilégie le displayName (Prénom Nom)
  const displayName =
    user?.displayName ||
    (user?.email ? user.email.split("@")[0] : "Utilisateur");

  return (
    <header className="sticky top-0 z-30 bg-[var(--bg)]/90 backdrop-blur-xl border-b border-[var(--border)]/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between gap-4">
        {/* Logo + mini titre à gauche */}
        <Link href="/app" className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brandDark)] shadow-lg shadow-[var(--brand)]/30 flex items-center justify-center text-[11px] font-semibold">
            AI
          </div>
          <div className="hidden sm:flex flex-col leading-tight">
            <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Assistant candidatures
            </span>
            <span className="text-xs font-medium">Espace connecté</span>
          </div>
        </Link>

        {/* À droite : connecté en tant que + bouton déconnexion */}
        <div className="flex items-center gap-3 ml-auto">
          {user && (
            <div className="flex flex-col items-end leading-tight text-[10px] sm:text-[11px]">
              <span className="text-[var(--muted)] hidden sm:inline">
                Connecté·e en tant que
              </span>
              <span className="text-[var(--ink)] font-medium max-w-[160px] truncate">
                {displayName}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center justify-center text-[11px] sm:text-[12px] px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] hover:bg-[var(--bg)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            Se déconnecter
          </button>
        </div>
      </div>
    </header>
  );
}
