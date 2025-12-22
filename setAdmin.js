// setAdmin.js
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

async function main() {
  // 👉 Mets ici l'email EXACT utilisé dans Firebase Authentication
  const email = "aakane0105@gmail.com"; // <--- NE PAS OUBLIER LE GUILLEMET DE FIN

  try {
    // On récupère l'utilisateur via son email
    const userRecord = await admin.auth().getUserByEmail(email);
    console.log("Utilisateur trouvé ✅");
    console.log("UID :", userRecord.uid);
    console.log("Email :", userRecord.email);

    // On lui ajoute le rôle admin
    await admin.auth().setCustomUserClaims(userRecord.uid, { isAdmin: true });

    console.log("✅ isAdmin = true pour :", userRecord.uid);
  } catch (err) {
    console.error("Erreur setAdmin:", err);
  }
}

main();
