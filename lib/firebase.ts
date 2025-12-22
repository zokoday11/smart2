"use client";

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// ✅ Ta config Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCNb2cU0yhUeBGOk-8IK3TGNbjL6wSYMRs",
  authDomain: "assistant-ia-v4.firebaseapp.com",
  projectId: "assistant-ia-v4",
  storageBucket: "assistant-ia-v4.firebasestorage.app",
  messagingSenderId: "500826253198",
  appId: "1:500826253198:web:4bc5bd2402d7dd286326df",
  measurementId: "G-61HCNNZBTN",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
// ✅ Functions dans la même région que tes Cloud Functions
export const functions = getFunctions(app, "europe-west1");

// ✅ Provider Google (pour popup)
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account",
});

export { app };
