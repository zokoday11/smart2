// src/hooks/useAdminGuard.ts
"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import type { User } from "firebase/auth";
import { useAuth } from "@/context/AuthContext";

// 👉 Emails qui sont admin "hardcodés" en plus du custom claim isAdmin
const ADMIN_EMAILS = ["aakane0105@gmail.com"];

export type UseAdminGuardResult = {
  loading: boolean;
  isAdmin: boolean;
  user: User | null;
};

export function useAdminGuard(): UseAdminGuardResult {
  const { user, loading, isAdmin: isAdminFromContext } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // fallback : si jamais le claim n'est pas encore set, mais que l'email est dans la whitelist
  const email = (user?.email || "").toLowerCase();
  const hasAdminEmail = ADMIN_EMAILS.includes(email);

  const isAdmin = isAdminFromContext || hasAdminEmail;

  useEffect(() => {
    if (loading) return;

    const onAdminRoute = pathname?.startsWith("/admin");

    // Pas connecté et route /admin → renvoie vers /admin/login
    if (!user && onAdminRoute) {
      router.push("/admin/login");
      return;
    }

    // Connecté mais pas admin et route /admin (hors /admin/login) → renvoie vers /
    if (
      user &&
      !isAdmin &&
      onAdminRoute &&
      pathname !== "/admin/login"
    ) {
      router.push("/");
    }
  }, [user, loading, isAdmin, pathname, router]);

  return { loading, isAdmin, user };
}
