// src/lib/credits.ts
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Ajoute des crédits à un utilisateur identifié par son userId (document users/{userId}).
 */
export async function addCreditsToUserById(
  userId: string,
  creditsToAdd: number
): Promise<void> {
  if (!userId) {
    console.error("[credits] userId manquant");
    return;
  }
  if (!creditsToAdd || creditsToAdd <= 0) {
    console.warn("[credits] creditsToAdd <= 0, rien à ajouter", {
      userId,
      creditsToAdd,
    });
    return;
  }

  const ref = doc(db, "users", userId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    console.warn(
      "[credits] Doc user inexistant, création avec crédits initiaux",
      { userId, creditsToAdd }
    );
    await setDoc(ref, {
      credits: creditsToAdd,
      createdAt: new Date(),
    });
    return;
  }

  console.log("[credits] Ajout de crédits par userId", { userId, creditsToAdd });

  await updateDoc(ref, {
    credits: increment(creditsToAdd),
  });
}

/**
 * Ajoute des crédits à (tous) les utilisateurs qui ont cet email.
 * Fallback si on n’a pas externalId dans l’event Polar.
 */
export async function addCreditsToUserByEmail(
  email: string,
  creditsToAdd: number
): Promise<void> {
  if (!email) {
    console.error("[credits] email manquant");
    return;
  }
  if (!creditsToAdd || creditsToAdd <= 0) {
    console.warn("[credits] creditsToAdd <= 0, rien à ajouter", {
      email,
      creditsToAdd,
    });
    return;
  }

  const usersCol = collection(db, "users");
  const q = query(usersCol, where("email", "==", email));
  const qs = await getDocs(q);

  if (qs.empty) {
    console.warn(
      "[credits] Aucun user trouvé avec cet email, création impossible",
      { email, creditsToAdd }
    );
    return;
  }

  console.log(
    "[credits] Ajout de crédits par email (tous les users trouvés)",
    { email, creditsToAdd, count: qs.size }
  );

  const promises: Promise<any>[] = [];
  qs.forEach((docSnap) => {
    promises.push(
      updateDoc(docSnap.ref, {
        credits: increment(creditsToAdd),
      })
    );
  });

  await Promise.all(promises);
}

/**
 * Consomme des crédits pour un utilisateur.
 *
 * Pour être flexible avec ton code existant, cette fonction accepte :
 *  - consumeCredits(userId, 3)
 *  - consumeCredits({ userId: "xxx", amount: 3 })
 *  - consumeCredits({ userId: "xxx", credits: 3 })
 */
export async function consumeCredits(arg1: any, arg2?: any): Promise<void> {
  let userId: string | undefined;
  let toConsume = 0;

  if (typeof arg1 === "string") {
    userId = arg1;
    toConsume = typeof arg2 === "number" ? arg2 : 0;
  } else if (typeof arg1 === "object" && arg1 !== null) {
    userId = arg1.userId || arg1.uid;
    toConsume =
      arg1.amount ?? arg1.credits ?? arg1.count ?? arg1.nb ?? 0;
  }

  if (!userId || !toConsume || toConsume <= 0) {
    console.warn(
      "[credits] consumeCredits appelé sans paramètres valides",
      { arg1, arg2 }
    );
    return;
  }

  const ref = doc(db, "users", userId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    console.warn(
      "[credits] user inexistant pour consumeCredits, aucun débit",
      { userId }
    );
    return;
  }

  console.log("[credits] Consommation de crédits", {
    userId,
    toConsume,
  });

  await updateDoc(ref, {
    credits: increment(-toConsume),
  });
}
