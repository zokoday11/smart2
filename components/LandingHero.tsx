"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export default function LandingHero() {
  return (
    <section className="px-4 sm:px-8 pt-8 pb-6">
      <div className="max-w-6xl mx-auto flex flex-col gap-6 md:flex-row md:items-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex-1"
        >
          <p className="badge-muted mb-3">
            <span className="w-1 h-1 rounded-full bg-emerald-400" />
            <span>IA appliquée aux candidatures</span>
          </p>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-semibold leading-tight mb-3">
            Ton bureau de candidature, piloté par l&apos;IA.
          </h1>
          <p className="text-sm sm:text-base text-[var(--muted)] max-w-xl mb-4">
            Importe ton CV, génère des lettres de motivation ciblées, prépare ton pitch oral
            et suis toutes tes candidatures depuis un seul espace, pensé pour les profils tech
            et cybersécurité.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/signup" className="btn-primary text-xs sm:text-sm">
              Essayer gratuitement
            </Link>
            <Link href="/login" className="btn-secondary text-xs sm:text-sm">
              Se connecter
            </Link>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.05 }}
          className="flex-1"
        >
          <div className="glass p-4 text-xs text-[var(--muted)]">
            <p className="mb-2 text-[11px] uppercase tracking-[0.18em]">
              Aperçu temps réel
            </p>
            <p>
              Un tableau de bord unique pour ton CV, tes LM, ton pitch et ton suivi de
              candidatures. Design inspiré de ton interface actuelle, en Next.js + Tailwind CSS
              + Framer Motion.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
