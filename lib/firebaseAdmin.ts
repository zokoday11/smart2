// lib/firebaseAdmin.ts
import admin from "firebase-admin";

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && rawPrivateKey) {
    const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      console.log("[firebaseAdmin] Initialisé avec les variables d'env");
    } catch (err) {
      console.error("[firebaseAdmin] Erreur d'initialisation :", err);
    }
  } else {
    console.warn(
      "[firebaseAdmin] Variables d'env manquantes. Admin ne sera pas initialisé (OK en DEV)."
    );
  }
}

export default admin;
