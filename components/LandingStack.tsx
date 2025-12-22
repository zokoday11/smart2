"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export default function LandingStack() {
  return (
    <section className="px-4 sm:px-8 pb-10">
      <div className="max-w-6xl mx-auto glass p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
          <div>
            <p className="badge-muted mb-1">
              <span>Stack technique</span>
            </p>
            <h2 className="text-sm sm:text-base font-semibold">
              Une stack moderne pour une expérience fluide
            </h2>
          </div>
          <Link href="/tech" className="text-[11px] text-[var(--brand)] underline">
            Voir les détails techniques
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-xs sm:text-sm">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.2 }}
          >
            <p className="font-semibold mb-1">Frontend · React / Next.js</p>
            <p className="text-[var(--muted)]">
              Framework JavaScript moderne pour construire une interface rapide,
              SEO-friendly et bien routée.
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.2, delay: 0.05 }}
          >
            <p className="font-semibold mb-1">Styling · Tailwind CSS</p>
            <p className="text-[var(--muted)]">
              Un framework utilitaire qui permet de décliner ton design sombre actuel
              dans une grille cohérente et responsive.
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.2, delay: 0.1 }}
          >
            <p className="font-semibold mb-1">Animations · Framer Motion</p>
            <p className="text-[var(--muted)]">
              Des transitions douces et maîtrisées pour donner vie aux cartes,
              modales et panneaux comme dans ton design original.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
