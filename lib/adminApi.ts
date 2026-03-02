// lib/adminApi.ts
import { getFunctions, httpsCallable } from "firebase/functions";
import { db, app } from "@/lib/firebase";
import { doc, updateDoc, deleteDoc, serverTimestamp, setDoc } from "firebase/firestore";

/**
 * Wrapper admin : privilégie les Callable Functions (sécurité prod),
 * et propose un fallback Firestore si tu veux (à éviter en prod si rules strictes).
 */

export type AdminUpdateCreditsParams = {
  userId: string;
  credits: number; // valeur finale
  reason?: string;
};

export type AdminSetRoleParams = {
  uid: string;
  isAdmin: boolean;
};

export async function adminUpdateCreditsCallable(params: AdminUpdateCreditsParams) {
  const functions = getFunctions(app, "europe-west1");
  const fn = httpsCallable(functions, "adminUpdateCredits");
  const res = await fn({
    userId: params.userId,
    credits: params.credits,
    reason: params.reason || "",
  });
  return res.data as any;
}

export async function adminSetAdminRoleCallable(params: AdminSetRoleParams) {
  const functions = getFunctions(app, "europe-west1");
  const fn = httpsCallable(functions, "setAdminRole");
  const res = await fn({
    uid: params.uid,
    isAdmin: params.isAdmin,
  });
  return res.data as any;
}

/**
 * Fallback Firestore (à utiliser uniquement si tes rules autorisent isAdmin).
 * Sinon, fais une function dédiée.
 */
export async function adminToggleBlockedFirestore(userId: string, blocked: boolean) {
  await updateDoc(doc(db, "users", userId), {
    blocked,
    updatedAt: serverTimestamp(),
  });
}

export async function adminDeleteUserDocFirestore(userId: string) {
  // ⚠️ Supprime uniquement le document Firestore, PAS le user Auth.
  await deleteDoc(doc(db, "users", userId));
}

export async function adminSetMaintenanceModeFirestore(enabled: boolean) {
  // Un doc central de settings (à toi de choisir la structure)
  await setDoc(
    doc(db, "settings", "app"),
    { maintenanceMode: enabled, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
