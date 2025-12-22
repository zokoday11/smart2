// syncAuthUsersToFirestore.js
//
// Script une fois pour toutes : synchronise tous les comptes Firebase Auth
// vers la collection Firestore "users", pour qu'ils apparaissent dans ton admin.

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

function toMillis(str) {
  if (!str) return null;
  const t = Date.parse(str);
  return Number.isNaN(t) ? null : t;
}

async function syncAllUsers(nextPageToken) {
  const result = await admin.auth().listUsers(1000, nextPageToken);

  for (const user of result.users) {
    const uid = user.uid;
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();

    const baseData = {
      email: user.email || null,
      displayName: user.displayName || null,
      emailVerified: user.emailVerified || false,
      provider:
        (user.providerData[0] && user.providerData[0].providerId) ||
        "password",
      createdAt: toMillis(user.metadata.creationTime) || Date.now(),
      lastLoginAt: toMillis(user.metadata.lastSignInTime) || null,
    };

    if (!snap.exists) {
      // Nouveau doc user créé
      await ref.set({
        ...baseData,
        credits: 0,
        blocked: false,
      });
      console.log("✅ Créé doc users pour", uid, baseData.email);
    } else {
      // Doc déjà existant → on ne touche pas aux crédits / blocked
      await ref.set(baseData, { merge: true });
      console.log("🔁 Mis à jour doc users pour", uid, baseData.email);
    }
  }

  if (result.pageToken) {
    await syncAllUsers(result.pageToken);
  }
}

async function main() {
  await syncAllUsers();
  console.log("🎉 Sync terminé");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erreur syncAllUsers:", err);
  process.exit(1);
});
