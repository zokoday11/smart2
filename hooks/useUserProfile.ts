"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

export interface UserProfile {
  id: string;
  email?: string | null;
  displayName?: string | null;
  credits?: number;
  blocked?: boolean;
  ip?: string | null;
  city?: string | null;
  country?: string | null;
  emailVerified?: boolean;
  lastLoginAt?: Date | null;
  lastActiveAt?: Date | null;
}

export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const ref = doc(db, "users", user.uid);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setProfile({
            id: user.uid,
            email: user.email ?? null,
            displayName: user.displayName ?? null,
          });
          setLoading(false);
          return;
        }

        const data = snap.data() as any;

        const lastLoginAt =
          data.lastLoginAt?.toDate?.() &&
          typeof data.lastLoginAt.toDate === "function"
            ? data.lastLoginAt.toDate()
            : null;

        const lastActiveAt =
          data.lastActiveAt?.toDate?.() &&
          typeof data.lastActiveAt.toDate === "function"
            ? data.lastActiveAt.toDate()
            : null;

        const profile: UserProfile = {
          id: snap.id,
          email: data.email ?? user.email ?? null,
          displayName: data.displayName ?? user.displayName ?? null,
          credits:
            typeof data.credits === "number"
              ? data.credits
              : data.credits
              ? Number(data.credits)
              : undefined,
          blocked: data.blocked === true,
          ip: data.ip ?? null,
          city: data.city ?? null,
          country: data.country ?? null,
          emailVerified:
            typeof data.emailVerified === "boolean"
              ? data.emailVerified
              : user.emailVerified ?? false,
          lastLoginAt,
          lastActiveAt,
        };

        setProfile(profile);
        setLoading(false);
      },
      (error) => {
        console.error("Erreur onSnapshot user profile:", error);
        setProfile(null);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [user]);

  return { profile, loading };
}
