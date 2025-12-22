"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  onIdTokenChanged,
  signOut,
  type User,
  getIdTokenResult,
} from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

type AuthContextType = {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  blocked: boolean;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  blocked: false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (firebaseUser) => {
      setLoading(true);

      // Déconnecté
      if (!firebaseUser) {
        setUser(null);
        setIsAdmin(false);
        // IMPORTANT: on ne force pas blocked=false ici,
        // comme ça si un compte vient d’être rejeté car bloqué,
        // la page /login peut garder le message.
        setLoading(false);
        return;
      }

      // 1) ✅ Vérif Firestore AVANT d’exposer user
      try {
        const ref = doc(db, "users", firebaseUser.uid);
        const snap = await getDoc(ref);
        const data = snap.data() as any | undefined;

        if (data?.blocked) {
          // 🔒 Compte bloqué : on rejette la session AVANT toute redirection / rendu /app
          setBlocked(true);
          setUser(null);
          setIsAdmin(false);
          setLoading(false);

          try {
            await signOut(auth);
          } catch (e) {
            console.error("Erreur signOut (blocked):", e);
          }
          return;
        }

        // Compte OK → on reset blocked
        setBlocked(false);
      } catch (e) {
        // 🔐 Par sécurité + pour éviter le flash,
        // si la vérif Firestore plante, on refuse la session.
        console.error("Erreur vérification blocked:", e);

        setBlocked(true);
        setUser(null);
        setIsAdmin(false);
        setLoading(false);

        try {
          await signOut(auth);
        } catch (err) {
          console.error("Erreur signOut (firestore check failed):", err);
        }
        return;
      }

      // 2) ✅ Admin claims (après validation blocked)
      try {
        const tokenResult = await getIdTokenResult(firebaseUser, true);
        const claims = tokenResult.claims || {};
        const adminFlag =
          claims.isAdmin === true || claims.email === "aakane0105@gmail.com";
        setIsAdmin(adminFlag);
      } catch (e) {
        console.error("Erreur récupération des custom claims:", e);
        setIsAdmin(false);
      }

      // 3) ✅ On expose user seulement maintenant
      setUser(firebaseUser);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const logout = async () => {
    // logout volontaire => on efface le statut blocked UI
    setBlocked(false);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, blocked, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
