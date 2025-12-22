"use client";

import { motion } from "framer-motion";

const features = [
  {
    title: "CV IA optimisé",
    desc: "Importe ton CV PDF, laisse Gemini en extraire le profil et génère un CV optimisé."
  },
  {
    title: "Lettres sur-mesure",
    desc: "Colle une offre, obtiens une lettre adaptée à ton profil et à l'entreprise ciblée."
  },
  {
    title: "Suivi simplifié",
    desc: "Garde une trace de toutes tes candidatures avec un tracker clair et visuel."
  }
];

export default function LandingFeatures() {
  return (
    <section className="px-4 sm:px-8 pb-6">
      <div className="max-w-6xl mx-auto grid gap-3 md:grid-cols-3">
        {features.map((f, idx) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.2, delay: idx * 0.05 }}
            className="glass p-4 text-sm"
          >
            <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
            <p className="text-xs text-[var(--muted)]">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
