// Fichier : lib/auth.ts

// Vous devez vous assurer que ces imports sont valides dans votre structure
import { auth } from "@/lib/firebase"; // Import de l'instance d'authentification Firebase
import { signInWithCustomToken, UserCredential } from "firebase/auth";

// 👉 Login via LinkedIn
// idToken ici est le Custom Token Firebase généré par votre Cloud Function.
export async function loginWithLinkedInIdToken(idToken: string): Promise<UserCredential> {
  console.log(
    "[auth] Tentative de connexion via Custom Token LinkedIn...",
    idToken
  );

  try {
    // 1. Utilisez le Custom Token pour connecter l'utilisateur Firebase.
    const credential = await signInWithCustomToken(auth, idToken);
    
    console.log("[auth] Connexion LinkedIn réussie:", credential.user.uid);
    
    // Le Custom Token est échangé contre une session utilisateur complète.
    return credential; 
    
  } catch (error) {
    console.error("[auth] Erreur lors de la connexion via Custom Token:", error);
    throw new Error("Impossible de se connecter à Firebase avec le Custom Token fourni.");
  }
}