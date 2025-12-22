"use client";

import { auth } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendEmailVerification,
} from "firebase/auth";

export async function signupWithEmail(
  firstName: string,
  lastName: string,
  email: string,
  password: string
) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  await updateProfile(cred.user, {
    displayName: `${firstName} ${lastName}`.trim(),
  });

  // 👉 ICI : on laisse Firebase envoyer son email standard
  await sendEmailVerification(cred.user);

  return cred;
}

export async function loginWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  return signOut(auth);
}
