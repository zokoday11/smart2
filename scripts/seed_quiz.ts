import { initializeApp } from "firebase/app";
import {
  getFirestore,
  addDoc,
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

// ✅ Mets tes variables firebase ici (ou via env)
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY!,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.FIREBASE_PROJECT_ID!,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.FIREBASE_APP_ID!,
};

async function run() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  // 1) Crée un quiz
  const quizRef = await addDoc(collection(db, "quizzes"), {
    title: "Quiz Général - Soft Skills & Process",
    description: "Communication, priorités, outils et collaboration",
    targets: ["general", "support", "devops", "frontend", "backend"],
    published: true,
    createdAt: serverTimestamp(),
  });

  const quizId = quizRef.id;

  // 2) Ajoute les questions dans subcollection
  const questions = [
    {
      order: 1,
      question: "Quelle est la priorité absolue lors d'un incident critique ?",
      options: [
        "Chercher un coupable",
        "Communiquer et isoler le problème",
        "Éteindre tous les systèmes",
        "Attendre",
      ],
      correctAnswer: 1,
      explanation: "Communication + endiguement limitent l'impact.",
    },
    {
      order: 2,
      question: "Quel outil est le plus adapté pour suivre l'avancement des tâches ?",
      options: ["Excel local", "Jira / Trello", "WhatsApp", "Post-it sur l'écran"],
      correctAnswer: 1,
      explanation: "Jira/Trello permettent traçabilité + collaboration.",
    },
    {
      order: 3,
      question: "Quelle soft skill est la plus valorisée ?",
      options: ["Autorité", "Écoute active", "Vitesse de frappe", "Mémorisation"],
      correctAnswer: 1,
      explanation: "Comprendre le besoin réel évite les erreurs.",
    },
    {
      order: 4,
      question: "Comment gérer un conflit d'équipe ?",
      options: ["Ignorer", "Médiation factuelle", "Prendre parti", "Licencier tout le monde"],
      correctAnswer: 1,
      explanation: "Factuel + neutre = baisse de tension.",
    },
  ];

  for (const q of questions) {
    const qRef = doc(db, "quizzes", quizId, "questions", String(q.order));
    await setDoc(qRef, q);
  }

  console.log("✅ Seed OK — quizId:", quizId);
}

run().catch(console.error);
