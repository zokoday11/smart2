// lib/server/credits.ts
//
// VERSION DEV SANS FIRESTORE
// --------------------------
// On simule juste des crédits illimités pour tous les utilisateurs.
// Ça évite les erreurs Firebase Admin en local.
// Quand tu voudras brancher Firestore côté serveur, tu pourras
// rétablir la logique avec firebase-admin ici.

type DevUser = {
  id: string;
  credits: number;
};

export async function verifyUserAndCredits(
  userId: string
): Promise<DevUser | null> {
  if (!userId) return null;

  // En DEV : tous les users sont autorisés, avec beaucoup de crédits.
  return {
    id: userId,
    credits: 9999,
  };
}

export async function consumeCredit(
  userId: string,
  amount = 1
): Promise<void> {
  // En DEV : on ne fait rien, on log juste.
  console.log(
    `[DEV][credits] Consommation simulée de ${amount} crédit(s) pour l'utilisateur ${userId}`
  );
}
