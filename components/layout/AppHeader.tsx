"use client";

import { ReactNode } from "react";
import { Menu, Bell, Search, Command } from "lucide-react";

interface AppHeaderProps {
  title: string;
  description?: string;
  creditsBadge?: ReactNode;
  userBadge?: ReactNode; // Le bouton avatar/profil
  onToggleSidebar: () => void;
}

export function AppHeader({
  title,
  description,
  creditsBadge,
  userBadge,
  onToggleSidebar,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-[var(--border)]/50 bg-[var(--bg)]/80 backdrop-blur-xl transition-all">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* GAUCHE : Toggle Mobile + Titre */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="md:hidden -ml-2 p-2 rounded-lg text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg-soft)] transition-colors"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="flex flex-col">
            <h1 className="text-sm font-semibold text-[var(--ink)] tracking-tight">
              {title}
            </h1>
            {description && (
              <span className="text-[10px] text-[var(--muted)] hidden sm:block">
                {description}
              </span>
            )}
          </div>
        </div>

        {/* CENTRE : Barre de recherche fake (Optionnel pour effet "App") */}
        <div className="hidden md:flex items-center justify-center flex-1 max-w-md mx-4">
          <button className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-soft)]/50 text-[var(--muted)] text-xs hover:border-[var(--border)]/80 hover:bg-[var(--bg-soft)] transition-all group">
            <div className="flex items-center gap-2">
              <Search className="h-3.5 w-3.5 group-hover:text-[var(--ink)]" />
              <span>Rechercher...</span>
            </div>
            <div className="flex items-center gap-1 opacity-50">
              <Command className="h-3 w-3" />
              <span>K</span>
            </div>
          </button>
        </div>

        {/* DROITE : Actions */}
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Credits Badge */}
          <div className="hidden sm:block">
            {creditsBadge}
          </div>

          {/* Notifications */}
          <button className="relative p-2 rounded-full text-[var(--muted)] hover:bg-[var(--bg-soft)] hover:text-[var(--ink)] transition-colors">
            <Bell className="h-4 w-4" />
            <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-red-500 border-2 border-[var(--bg)]" />
          </button>

          {/* Séparateur */}
          <div className="h-6 w-px bg-[var(--border)]" />

          {/* User Menu Trigger */}
          {userBadge}
        </div>
      </div>
    </header>
  );
}