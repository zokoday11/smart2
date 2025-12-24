"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useRef, useState, UIEvent, useEffect } from "react";
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

  /**
   * ✅ Debug reCAPTCHA (facultatif)
   * Si tu as bien mis le Script enterprise.js dans app/layout.tsx,
   * tu dois voir window.grecaptcha après quelques ms.
   */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const g = (window as any).grecaptcha;
      // console.log("[recaptcha] loaded?", !!g, "enterprise?", !!g?.enterprise);
    }, 1200);
    return () => window.clearTimeout(t);
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

  const scrollToSection =
    (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      const sec = document.getElementById(id);
      if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
    };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] flex flex-col overflow-x-hidden">
      {/* NAVBAR FIXE */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-[var(--bg)]/90 backdrop-blur-xl">
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
            <a
              href="#hero"
              onClick={scrollToSection("hero")}
              className={
                activeSection === "hero"
                  ? `${baseNavLink} bg-[var(--bg-soft)] text-[var(--ink)]`
                  : `${baseNavLink} text-[var(--muted)] hover:text-[var(--ink)]`
              }
            >
              {activeSection === "hero" && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
              )}
              <span>Accueil</span>
            </a>

            <a
              href="#features"
              onClick={scrollToSection("features")}
              className={
                activeSection === "features"
                  ? `${baseNavLink} bg-[var(--bg-soft)] text-[var(--ink)]`
                  : `${baseNavLink} text-[var(--muted)] hover:text-[var(--ink)]`
              }
            >
              {activeSection === "features" && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
              )}
              <span>Fonctionnalités</span>
            </a>

            <a
              href="#how"
              onClick={scrollToSection("how")}
              className={
                activeSection === "how"
                  ? `${baseNavLink} bg-[var(--bg-soft)] text-[var(--ink)]`
                  : `${baseNavLink} text-[var(--muted)] hover:text-[var(--ink)]`
              }
            >
              {activeSection === "how" && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
              )}
              <span>Comment ça marche</span>
            </a>

            <a
              href="#pricing"
              onClick={scrollToSection("pricing")}
              className={
                activeSection === "pricing"
                  ? `${baseNavLink} bg-[var(--bg-soft)] text-[var(--ink)]`
                  : `${baseNavLink} text-[var(--muted)] hover:text-[var(--ink)]`
              }
            >
              {activeSection === "pricing" && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
              )}
              <span>Tarifs</span>
            </a>

            <a
              href="#stack"
              onClick={scrollToSection("stack")}
              className={
                activeSection === "stack"
                  ? `${baseNavLink} bg-[var(--bg-soft)] text-[var(--ink)]`
                  : `${baseNavLink} text-[var(--muted)] hover:text-[var(--ink)]`
              }
            >
              {activeSection === "stack" && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
              )}
              <span>Tech</span>
            </a>

            <a
              href="#faq"
              onClick={scrollToSection("faq")}
              className={
                activeSection === "faq"
                  ? `${baseNavLink} bg-[var(--bg-soft)] text-[var(--ink)]`
                  : `${baseNavLink} text-[var(--muted)] hover:text-[var(--ink)]`
              }
            >
              {activeSection === "faq" && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-[var(--brand)] animate-pulse" />
              )}
              <span>Questions fréquentes</span>
            </a>
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
      <div className="flex-1 pt-14">
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
                    className="glass p-4 border border-[var(--border)]/80 hover:border-[var(--brand)]/60 transition-colors"
                  >
                    <h3 className="text-sm font-semibold mb-1">{f.title}</h3>
                    <p className="text-[11px] sm:text-xs text-[var(--muted)]">{f.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </section>

          {/* HOW */}
          <section
            id="how"
            className="md:snap-start md:min-h-[calc(100vh-3.5rem-2px)] flex items-center px-4 sm:px-8 py-10 md:py-0"
          >
            <div className="max-w-6xl mx-auto grid gap-6 md:grid-cols-[1.1fr,0.9fr] items-start">
              <motion.div {...fadeUp(0)}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)] mb-1">
                  En pratique
                </p>
                <h2 className="text-lg sm:text-xl font-semibold mb-3">
                  3 étapes pour transformer ton process de candidature.
                </h2>
                <p className="text-sm text-[var(--muted)] max-w-xl mb-4">
                  L’objectif : que tu passes moins de temps à lutter avec tes lettres, et plus de temps à préparer tes entretiens.
                </p>

                <ol className="space-y-3 text-sm">
                  <li className="flex gap-3">
                    <span className="mt-0.5 h-6 w-6 rounded-full bg-[var(--brand)]/15 border border-[var(--brand)]/60 text-[10px] flex items-center justify-center">
                      1
                    </span>
                    <div>
                      <p className="font-medium mb-1">Tu importes ton CV & les offres</p>
                      <p className="text-[12px] text-[var(--muted)]">
                        PDF de ton CV, lien d’offre ou texte copié/collé : tout part de ton vrai parcours.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 h-6 w-6 rounded-full bg-[var(--brand)]/15 border border-[var(--brand)]/60 text-[10px] flex items-center justify-center">
                      2
                    </span>
                    <div>
                      <p className="font-medium mb-1">L’IA génère lettres, pitchs & matchs</p>
                      <p className="text-[12px] text-[var(--muted)]">
                        Tu valides, ajustes, c’est toi qui garde le contrôle du ton et des infos.
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-0.5 h-6 w-6 rounded-full bg-[var(--brand)]/15 border border-[var(--brand)]/60 text-[10px] flex items-center justify-center">
                      3
                    </span>
                    <div>
                      <p className="font-medium mb-1">Tu suis tout depuis le dashboard</p>
                      <p className="text-[12px] text-[var(--muted)]">
                        Tableau de bord, statut des candidatures, relances, historique : tout est centralisé.
                      </p>
                    </div>
                  </li>
                </ol>
              </motion.div>

              <motion.div {...fadeUp(0.1)} className="glass p-4 border border-[var(--border)]/80">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-2">
                  Pour qui ?
                </p>
                <ul className="space-y-2 text-[12px] text-[var(--muted)]">
                  <li>• Étudiants & juniors qui veulent des candidatures propres sans y passer leurs nuits.</li>
                  <li>• Profils tech / cybersécurité qui veulent aller droit au but avec un ton pro.</li>
                  <li>• Pros en reconversion ou en veille qui envoient plusieurs candidatures par semaine.</li>
                </ul>
                <div className="mt-4 border-t border-[var(--border)]/70 pt-3 text-[11px]">
                  <p className="text-[var(--muted)] mb-1">Tu n’es pas obligé de tout automatiser.</p>
                  <p>
                    Utilise l’IA comme un accélérateur : tu gardes le contrôle, l’assistant fait le gros du texte.
                  </p>
                </div>
              </motion.div>
            </div>
          </section>

          {/* PRICING */}
          <section
            id="pricing"
            className="md:snap-start md:min-h-[calc(100vh-3.5rem-2px)] flex items-center px-4 sm:px-8 py-10 md:py-0"
          >
            <div className="max-w-6xl mx-auto w-full">
              <motion.div {...fadeUp(0)} className="text-center mb-8 max-w-2xl mx-auto">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)] mb-1">Tarifs</p>
                <h2 className="text-lg sm:text-xl font-semibold mb-2">Des crédits simples, adaptés à ton rythme.</h2>
                <p className="text-sm text-[var(--muted)]">
                  Commence avec les crédits gratuits. Tu ne paies que si l’outil t’aide vraiment.
                </p>
              </motion.div>

              <div className="grid gap-4 md:grid-cols-3">
                <motion.div {...fadeUp(0.05)} className="glass p-4 border border-[var(--border)]/90">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-1">Découverte</p>
                  <h3 className="text-sm font-semibold mb-1">Gratuit • Pour tester</h3>
                  <p className="text-[12px] text-[var(--muted)] mb-3">Idéal pour voir si le flow te convient.</p>
                  <p className="text-2xl font-semibold mb-3">0 €</p>
                  <ul className="text-[11px] text-[var(--muted)] space-y-1.5 mb-4">
                    <li>• X crédits offerts à l’inscription</li>
                    <li>• 2 lettres de motivation IA</li>
                    <li>• 1 pitch d’entretien</li>
                    <li>• Accès au tracker de candidatures</li>
                  </ul>
                  <Link href="/signup" className="btn-secondary w-full text-center text-xs">
                    Commencer gratuitement
                  </Link>
                </motion.div>

                <motion.div
                  {...fadeUp(0.1)}
                  className="glass p-4 border border-[var(--brand)]/80 relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(88,166,255,0.12),_transparent_55%)] pointer-events-none" />
                  <div className="relative">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-1">Plus populaire</p>
                    <h3 className="text-sm font-semibold mb-1">Campagne ciblée</h3>
                    <p className="text-[12px] text-[var(--muted)] mb-3">Pour une vraie recherche active de poste.</p>
                    <p className="text-2xl font-semibold mb-3">
                      19 € <span className="text-[11px] text-[var(--muted)]">/ une fois</span>
                    </p>
                    <ul className="text-[11px] text-[var(--muted)] space-y-1.5 mb-4">
                      <li>• Crédits pour ~25 lettres</li>
                      <li>• Pitchs illimités pour les offres générées</li>
                      <li>• Suivi avancé des candidatures</li>
                      <li>• Priorité sur les améliorations de templates</li>
                    </ul>
                    <Link href="/app/credits" className="btn-primary w-full text-center text-xs">
                      Acheter des crédits
                    </Link>
                  </div>
                </motion.div>

                <motion.div {...fadeUp(0.15)} className="glass p-4 border border-[var(--border)]/90">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-1">Intensif</p>
                  <h3 className="text-sm font-semibold mb-1">Pro / reconversion</h3>
                  <p className="text-[12px] text-[var(--muted)] mb-3">Pour les périodes de candidatures massives.</p>
                  <p className="text-2xl font-semibold mb-3">
                    39 € <span className="text-[11px] text-[var(--muted)]">/ une fois</span>
                  </p>
                  <ul className="text-[11px] text-[var(--muted)] space-y-1.5 mb-4">
                    <li>• Crédits pour ~60 lettres</li>
                    <li>• Pitchs étendus + variantes</li>
                    <li>• Support prioritaire</li>
                    <li>• Idéal pour changer de pays / secteur</li>
                  </ul>
                  <Link href="/app/credits" className="btn-secondary w-full text-center text-xs">
                    Voir ce pack plus tard
                  </Link>
                </motion.div>
              </div>
            </div>
          </section>

          {/* STACK */}
          <section
            id="stack"
            className="md:snap-start md:min-h-[calc(100vh-3.5rem-2px)] flex items-center px-4 sm:px-8 py-10 md:py-0"
          >
            <div className="max-w-6xl mx-auto grid gap-6 md:grid-cols-2">
              <motion.div {...fadeUp(0)}>
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)] mb-1">Sous le capot</p>
                <h2 className="text-lg sm:text-xl font-semibold mb-2">
                  Une stack moderne, optimisée pour la vitesse.
                </h2>
                <p className="text-sm text-[var(--muted)] mb-3">
                  Tu profites d’une interface fluide, sans te soucier de la technique. Mais si ça t’intéresse :
                </p>
                <ul className="text-[12px] text-[var(--muted)] space-y-1.5">
                  <li>
                    • <span className="text-[var(--ink)] font-medium">Next.js</span> pour le frontend & le routing.
                  </li>
                  <li>
                    • <span className="text-[var(--ink)] font-medium">Tailwind CSS</span> pour le design dark moderne.
                  </li>
                  <li>
                    • <span className="text-[var(--ink)] font-medium">Framer Motion</span> pour les animations fluides.
                  </li>
                  <li>
                    • <span className="text-[var(--ink)] font-medium">Firebase</span> pour l’auth sécurisée & le stockage.
                  </li>
                  <li>
                    • <span className="text-[var(--ink)] font-medium">Gemini</span> pour l’analyse de CV & la génération IA.
                  </li>
                </ul>
              </motion.div>

              <motion.div {...fadeUp(0.1)} className="glass p-4 border border-[var(--border)]/80 text-[11px] sm:text-xs">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)] mb-2">
                  Pourquoi c&apos;est important pour toi ?
                </p>
                <p className="text-[var(--muted)] mb-2">
                  Parce que ça veut dire : moins de chargements lents, moins de bugs bizarres, et une interface qui réagit comme un vrai outil pro.
                </p>
                <p className="text-[var(--muted)]">
                  Et si tu es curieux·se côté dev, la structure du projet est pensée pour être lisible, extensible, et déployable facilement sur Firebase Hosting.
                </p>
              </motion.div>
            </div>
          </section>

          {/* FAQ */}
          <section
            id="faq"
            className="md:snap-start md:min-h-[calc(100vh-3.5rem-2px)] flex items-center px-4 sm:px-8 pb-12 pt-10 md:py-0"
          >
            <div className="max-w-4xl mx-auto w-full">
              <motion.div {...fadeUp(0)} className="text-center mb-6">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)] mb-1">Questions fréquentes</p>
                <h2 className="text-lg sm:text-xl font-semibold mb-2">Et si tu te poses encore la question…</h2>
              </motion.div>

              <div className="space-y-3 text-sm">
                <motion.div {...fadeUp(0.05)} className="glass p-3 border border-[var(--border)]/80">
                  <p className="font-medium mb-1">Est-ce que les textes sont vraiment uniques ?</p>
                  <p className="text-[12px] text-[var(--muted)]">
                    Oui, chaque génération est basée sur ton CV, l’offre collée et les paramètres que tu choisis.
                  </p>
                </motion.div>

                <motion.div {...fadeUp(0.1)} className="glass p-3 border border-[var(--border)]/80">
                  <p className="font-medium mb-1">Est-ce que l’outil remplace complètement mon travail ?</p>
                  <p className="text-[12px] text-[var(--muted)]">
                    Non. L’idée est de te donner une base solide (0→80%), puis tu ajustes les derniers 20%.
                  </p>
                </motion.div>

                <motion.div {...fadeUp(0.15)} className="glass p-3 border border-[var(--border)]/80">
                  <p className="font-medium mb-1">Je peux arrêter quand je veux ?</p>
                  <p className="text-[12px] text-[var(--muted)]">
                    Oui, les crédits ne t&apos;engagent pas dans un abonnement. Tu recharges uniquement quand tu en as besoin.
                  </p>
                </motion.div>
              </div>

              <motion.div {...fadeUp(0.2)} className="mt-8 glass p-5 border border-[var(--border)]/90 text-center">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)] mb-2">Prêt à tester ?</p>
                <h3 className="text-base sm:text-lg font-semibold mb-2">
                  Tu peux créer ton compte en 30 secondes et tester avec de vrais cas.
                </h3>
                <p className="text-[12px] text-[var(--muted)] mb-4">
                  Tu gardes la main sur tout, l’IA est là pour accélérer ton travail, pas pour te remplacer.
                </p>
                <div className="flex flex-wrap gap-3 justify-center">
                  <Link href="/signup" className="btn-primary text-xs sm:text-sm">
                    Essayer gratuitement
                  </Link>

                  <button
                    type="button"
                    onClick={handleSmartLoginClick}
                    disabled={navigating}
                    className="btn-secondary text-xs sm:text-sm disabled:opacity-50"
                  >
                    J&apos;ai déjà un compte
                  </button>
                </div>
              </motion.div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
