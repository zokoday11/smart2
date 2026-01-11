"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useRef, useState, type UIEvent, useEffect, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay },
  viewport: { once: false, amount: 0.4 },
});

const SECTION_IDS: string[] = ["hero", "features", "how", "pricing", "stack", "faq"];

export default function LandingPage() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [activeSection, setActiveSection] = useState<string>("hero");

  // 🔐 état d'auth Firebase
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [navigating, setNavigating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  const handleSmartLoginClick = () => {
    if (navigating) return;
    setNavigating(true);
    if (currentUser) router.push("/app");
    else router.push("/login");
  };

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const maxScroll = el.scrollHeight - el.clientHeight;

    if (maxScroll <= 0) setProgress(0);
    else setProgress((el.scrollTop / maxScroll) * 100);

    const containerRect = el.getBoundingClientRect();
    let closestId: string = activeSection;
    let minDelta = Infinity;

    SECTION_IDS.forEach((id) => {
      const sec = document.getElementById(id) as HTMLElement | null;
      if (!sec) return;
      const rect = sec.getBoundingClientRect();
      const delta = Math.abs(rect.top - containerRect.top);
      if (delta < minDelta) {
        minDelta = delta;
        closestId = id;
      }
    });

    if (closestId !== activeSection) setActiveSection(closestId);
  };

  const baseNavLink =
    "relative inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full transition-colors";

  const scrollToSection = (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const sec = document.getElementById(id);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col overflow-x-hidden">
      {/* Background premium */}
      <div className="hero-bg" />
      <div className="noise" />

      {/* NAVBAR FIXE */}
      <header className="relative z-40 fixed top-0 left-0 right-0 bg-[var(--bg)]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between">
          {/* Logo + titre */}
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-[var(--brand)] to-[var(--brandDark)] shadow-lg shadow-[var(--brand)]/30 flex items-center justify-center text-[11px] font-semibold">
              AI
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Assistant candidatures
              </span>
              <span className="text-xs font-medium">Smart CV · LM · Pitch</span>
            </div>
          </div>

          {/* Liens + CTA */}
          <nav className="hidden sm:flex items-center gap-4 text-[11px]">
            {[
              ["hero", "Accueil"],
              ["features", "Fonctionnalités"],
              ["how", "Comment ça marche"],
              ["pricing", "Tarifs"],
              ["stack", "Tech"],
              ["faq", "Questions fréquentes"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={scrollToSection(id)}
                className={
                  activeSection === id
                    ? `${baseNavLink} bg-[var(--bg-soft)] text-[var(--ink)]`
                    : `${baseNavLink} text-[var(--muted)] hover:text-[var(--ink)]`
                }
              >
                {activeSection === id && (
                  <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
                )}
                <span>{label}</span>
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSmartLoginClick}
              disabled={navigating}
              className="hidden sm:inline-flex text-[11px] text-[var(--muted)] hover:text-[var(--ink)] disabled:opacity-50"
            >
              Se connecter
            </button>

            <Link
              href="/signup"
              className="inline-flex items-center justify-center text-[11px] sm:text-xs px-3 sm:px-4 py-1.5 rounded-full bg-[var(--brand)] hover:bg-[var(--brandDark)] text-white shadow-lg shadow-[var(--brand)]/40 transition-colors"
            >
              Essayer gratuitement
            </Link>
          </div>
        </div>
      </header>

      {/* CONTENU */}
      <div className="relative z-10 flex-1 pt-14">
        {/* Barre de progression */}
        <div className="hidden md:block h-[2px] w-full bg-[var(--border)]/40 sticky top-14 z-30">
          <div
            className="scroll-progress-bar h-full bg-[var(--brand)] transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>

        <main
          ref={scrollRef}
          onScroll={handleScroll}
          className="
            snap-none 
            md:snap-y md:snap-mandatory
            md:h-[calc(100vh-3.5rem-2px)] md:overflow-y-scroll
            scroll-smooth
          "
        >
          {/* HERO */}
          <section
            id="hero"
            className="md:snap-start md:min-h-[calc(100vh-3.5rem-2px)] flex items-center px-4 sm:px-8 py-10 md:py-0"
          >
            <div className="max-w-6xl mx-auto grid gap-8 md:grid-cols-[1.1fr,0.9fr] items-center">
              <motion.div {...fadeUp(0)}>
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1 mb-4">
                  <span className="inline-flex h-4 w-4 rounded-full bg-emerald-400/20 border border-emerald-400/50">
                    <span className="m-auto h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="text-[11px] text-[var(--muted)]">
                    Gagne jusqu&apos;à{" "}
                    <span className="text-[var(--ink)] font-medium">4h par semaine</span>{" "}
                    sur tes candidatures.
                  </span>
                </div>

                <h1 className="text-[1.9rem] sm:text-3xl md:text-[2.6rem] font-semibold leading-tight mb-3">
                  L&apos;assistant IA pour candidater comme un pro,
                  <span className="text-[var(--brand)]"> sans y passer tes soirées.</span>
                </h1>

                <p className="text-sm sm:text-base text-[var(--muted)] max-w-xl mb-5">
                  Importe ton CV, colle une offre d’emploi, laisse l’IA générer une lettre de motivation
                  ciblée, un pitch oral et suis toutes tes candidatures depuis un tableau de bord unique.
                </p>

                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <Link href="/signup" className="btn-primary text-xs sm:text-sm">
                    Essayer gratuitement
                  </Link>

                  <button
                    type="button"
                    onClick={handleSmartLoginClick}
                    disabled={navigating}
                    className="btn-secondary text-xs sm:text-sm disabled:opacity-50"
                  >
                    Se connecter
                  </button>
                </div>

                <p className="text-[11px] text-[var(--muted)]">
                  Aucun CB requise • Crédits offerts à l’inscription • Pensé pour les profils tech & cybersécurité
                </p>
              </motion.div>

              <motion.div {...fadeUp(0.1)} className="relative">
                <div className="glass rounded-2xl p-4 text-[11px] sm:text-xs shadow-2xl shadow-black/60 border border-[var(--border)]/80">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        Aperçu du dashboard
                      </p>
                      <p className="text-xs font-medium mt-1">
                        CV, lettres, pitch & suivi en un coup d&apos;œil.
                      </p>
                    </div>
                    <span className="px-2 py-1 rounded-full bg-emerald-400/10 text-emerald-300 border border-emerald-400/40 text-[10px]">
                      IA activée
                    </span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3 mb-3">
                    <div className="rounded-xl bg-[var(--bg-soft)] border border-[var(--border)]/80 px-3 py-2">
                      <p className="text-[10px] text-[var(--muted)] mb-1">Crédits restants</p>
                      <p className="text-lg font-semibold">124</p>
                      <p className="text-[10px] text-[var(--muted)]">~ 30 lettres + 15 pitchs</p>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-soft)] border border-[var(--border)]/80 px-3 py-2">
                      <p className="text-[10px] text-[var(--muted)] mb-1">Candidatures envoyées</p>
                      <p className="text-lg font-semibold">18</p>
                      <p className="text-[10px] text-[var(--muted)]">5 en entretien 🔥</p>
                    </div>
                    <div className="rounded-xl bg-[var(--bg-soft)] border border-[var(--border)]/80 px-3 py-2">
                      <p className="text-[10px] text-[var(--muted)] mb-1">Temps économisé</p>
                      <p className="text-lg font-semibold">7h / semaine</p>
                      <p className="text-[10px] text-[var(--muted)]">vs candidatures manuelles</p>
                    </div>
                  </div>

                  <div className="rounded-xl bg-gradient-to-br from-[var(--bg-soft)] to-[var(--card-elevated)] border border-[var(--border)]/90 p-3 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-[var(--muted)]">
                      <span>Offre · Ingénieur cybersécurité</span>
                      <span>
                        Match profil :{" "}
                        <span className="text-emerald-300 font-semibold">92%</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-[var(--bg-soft)] overflow-hidden">
                      <div className="h-full w-[92%] bg-gradient-to-r from-emerald-400 to-[var(--brand)]" />
                    </div>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="px-2 py-1 rounded-full bg-emerald-400/10 text-emerald-200 border border-emerald-400/40">
                        LM générée
                      </span>
                      <span className="px-2 py-1 rounded-full bg-[var(--brand)]/10 text-[var(--brand)] border border-[var(--brand)]/40">
                        Pitch prêt
                      </span>
                      <span className="px-2 py-1 rounded-full bg-[var(--bg-soft)] text-[var(--muted)] border border-[var(--border)]/70">
                        Suivi : En cours
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pointer-events-none absolute -inset-10 -z-10 bg-[radial-gradient(circle_at_top,_rgba(88,166,255,0.35),_transparent_60%),radial-gradient(circle_at_bottom,_rgba(16,185,129,0.2),_transparent_55%)] opacity-80" />
              </motion.div>
            </div>
          </section>

          {/* FEATURES */}
          <section
            id="features"
            className="md:snap-start md:min-h-[calc(100vh-3.5rem-2px)] flex items-center px-4 sm:px-8 py-10 md:py-0"
          >
            <div className="max-w-6xl mx-auto w-full">
              <motion.div
                {...fadeUp(0)}
                className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6"
              >
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)] mb-1">
                    Pensé pour ton quotidien
                  </p>
                  <h2 className="text-lg sm:text-xl font-semibold">
                    Tout ce dont tu as besoin pour candidater au calme.
                  </h2>
                </div>
              </motion.div>

              <div className="grid gap-4 md:grid-cols-3">
                {[
                  {
                    title: "CV IA optimisé",
                    desc: "Importe ton CV PDF, l’IA extrait ton profil et te propose une version claire et impactante pour les recruteurs.",
                  },
                  {
                    title: "Lettres ciblées",
                    desc: "Colle une offre d’emploi, l’assistant adapte ta lettre à l’entreprise, au poste et à ton parcours.",
                  },
                  {
                    title: "Pitch d’entretien",
                    desc: "Génère un pitch oral structuré pour te présenter en 30 à 90 secondes en entretien ou en réseautage.",
                  },
                  {
                    title: "Tracker de candidatures",
                    desc: "Garde la main sur tout : qui t’a répondu, où tu en es, quelles relances tu dois faire.",
                  },
                  {
                    title: "Historique IA",
                    desc: "Retrouve facilement tes lettres, tes pitchs et les versions de ton CV, sans te perdre dans les dossiers.",
                  },
                  {
                    title: "Crédits flexibles",
                    desc: "Des packs adaptés à ton rythme : quelques candidatures ciblées ou une vraie campagne d’attaque.",
                  },
                ].map((f, i) => (
                  <motion.div
                    key={f.title}
                    {...fadeUp(0.05 * i)}
                    className="glass card-hover p-4 border border-[var(--border)]/80 hover:border-[var(--brand)]/60 transition-colors"
                  >
                    <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
                    <p className="text-[11px] sm:text-xs text-[var(--muted)]">{f.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* HOW / PRICING / STACK / FAQ */}
          {/* ➜ garde ton code tel quel ici (inchangé) */}
        </main>
      </div>
    </div>
  );
}
