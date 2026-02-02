"use client";

import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Zap,
  FileText,
  Mic,
  BarChart3,
  ShieldCheck,
  ChevronDown,
  Search,
  Bell,
  MoreHorizontal,
  Briefcase,
  PenTool,
  LayoutDashboard,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeLangSwitcher } from "@/components/ui/ThemeLangSwitcher";

// --- ANIMATION HELPERS ---
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 20 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-50px" },
  transition: { duration: 0.5, delay, ease: "easeOut" },
});

export default function LandingPage() {
  const { t } = useTranslation("common");

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [navigating, setNavigating] = useState(false);
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Parallax Hero
  const { scrollY } = useScroll();
  const heroY = useTransform(scrollY, [0, 500], [0, 150]);
  const heroOpacity = useTransform(scrollY, [0, 400], [1, 0]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setCurrentUser(user));
    return () => unsub();
  }, []);

  const handleSmartLogin = () => {
    if (navigating) return;
    setNavigating(true);
    router.push(currentUser ? "/app" : "/login");
  };

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div
      ref={scrollRef}
      className="min-h-screen bg-[var(--bg)] text-[var(--ink)] selection:bg-[var(--brand)]/30 selection:text-[var(--ink)] overflow-x-hidden transition-colors duration-300"
    >
      {/* --- NAVBAR --- */}
      <nav className="fixed top-0 inset-x-0 z-50 h-16 border-b border-[var(--border)] bg-[var(--bg)]/80 backdrop-blur-md transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Zap className="w-4 h-4 text-white fill-white" />
            </div>
            <span className="font-bold tracking-tight text-[var(--ink)]">{t("landing.brand")}</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-[var(--muted)]">
            <button
              onClick={() => scrollTo("features")}
              className="hover:text-[var(--ink)] transition-colors"
            >
              {t("landing.nav.features")}
            </button>
            <button
              onClick={() => scrollTo("process")}
              className="hover:text-[var(--ink)] transition-colors"
            >
              {t("landing.nav.process")}
            </button>
            <button
              onClick={() => scrollTo("pricing")}
              className="hover:text-[var(--ink)] transition-colors"
            >
              {t("landing.nav.pricing")}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Switch Lang + Theme */}
            <ThemeLangSwitcher />

            <button
              onClick={handleSmartLogin}
              className="hidden sm:block text-sm font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              {t("landing.nav.login")}
            </button>

            <Link
              href="/signup"
              className="group relative px-5 py-2 rounded-full bg-[var(--ink)] text-[var(--bg)] text-sm font-bold overflow-hidden transition-all hover:opacity-90"
            >
              <span className="relative z-10 flex items-center gap-2">
                {t("landing.nav.tryFree")}
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="relative pt-32 pb-16">
        {/* --- HERO SECTION --- */}
        <section className="relative px-4 max-w-7xl mx-auto mb-32">
          {/* Background Glows */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none opacity-50" />

          <motion.div
            style={{ y: heroY, opacity: heroOpacity }}
            className="relative z-10 text-center flex flex-col items-center"
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400 text-xs font-medium mb-6"
            >
              <Sparkles className="w-3 h-3" />
              {t("landing.hero.badge")}
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-5xl md:text-7xl font-bold tracking-tight mb-6 max-w-4xl leading-[1.1] text-[var(--ink)]"
            >
              {t("landing.hero.titleLine1")} <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-400">
                {t("landing.hero.titleGradient")}
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-lg md:text-xl text-[var(--muted)] max-w-2xl mb-10 leading-relaxed"
            >
              {t("landing.hero.subtitle")}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto"
            >
              {/* BOUTON 1 */}
              <Link
                href="/signup"
                className="w-full sm:w-auto h-12 px-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all shadow-lg shadow-blue-500/25 flex items-center justify-center gap-2"
              >
                {t("landing.hero.ctaPrimary")}
                <ArrowRight className="w-4 h-4" />
              </Link>

              {/* BOUTON 2 */}
              <button
                onClick={handleSmartLogin}
                className="w-full sm:w-auto h-12 px-8 rounded-xl bg-[var(--bg-soft)] hover:opacity-95 border border-[var(--border)] text-[var(--ink)] font-medium transition-all flex items-center justify-center gap-2 group"
              >
                <FileText className="w-4 h-4 text-[var(--muted)] group-hover:text-[var(--ink)] transition-colors" />
                {t("landing.hero.ctaSecondary")}
              </button>
            </motion.div>

            {/* DASHBOARD PREVIEW MOCKUP */}
            <motion.div
              initial={{ opacity: 0, y: 40, rotateX: 10 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              transition={{ delay: 0.6, duration: 0.8 }}
              className="mt-16 w-full max-w-5xl rounded-2xl border border-[var(--border)] bg-[var(--bg-soft)] shadow-2xl overflow-hidden relative group perspective-1000"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-transparent to-transparent z-20 pointer-events-none"></div>

              <div className="grid grid-cols-[200px_1fr] h-[550px] opacity-90">
                {/* Sidebar Mockup */}
                <div className="border-r border-[var(--border)] bg-[var(--bg-soft)] p-4 flex flex-col gap-6">
                  <div className="flex items-center gap-3 px-2">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500"></div>
                    <div className="space-y-1">
                      <div className="h-2 w-16 bg-black/20 dark:bg-white/20 rounded"></div>
                      <div className="h-1.5 w-10 bg-black/10 dark:bg-white/10 rounded"></div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-500 text-xs font-medium">
                      <LayoutDashboard className="w-3.5 h-3.5" /> {t("landing.mock.dashboard")}
                    </div>

                    {[
                      { icon: FileText, label: t("landing.mock.cvs") },
                      { icon: Briefcase, label: t("landing.mock.apps") },
                      { icon: PenTool, label: t("landing.mock.letters") },
                      { icon: BarChart3, label: t("landing.mock.stats") },
                    ].map((item, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-default"
                      >
                        <item.icon className="w-3.5 h-3.5" />
                        <div className="h-2 w-12 bg-black/10 dark:bg-white/10 rounded"></div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-auto p-3 rounded-xl bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-[var(--border)]">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-3 h-3 text-indigo-400" />
                      <span className="text-[10px] font-bold text-indigo-300">
                        {t("landing.mock.proMode")}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full w-2/3 bg-indigo-500"></div>
                    </div>
                  </div>
                </div>

                {/* Main Content Mockup */}
                <div className="bg-transparent p-6 flex flex-col gap-6 relative">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-lg text-[var(--ink)]">
                        {t("landing.mock.hello")}
                      </h3>
                      <p className="text-[var(--muted)] text-xs">
                        {t("landing.mock.subtitle")}
                      </p>
                    </div>
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center border border-[var(--border)]">
                        <Search className="w-3.5 h-3.5 text-[var(--muted)]" />
                      </div>
                      <div className="w-8 h-8 rounded-full bg-black/5 dark:bg-white/5 flex items-center justify-center border border-[var(--border)] relative">
                        <Bell className="w-3.5 h-3.5 text-[var(--muted)]" />
                        <div className="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full border border-[var(--bg-soft)]"></div>
                      </div>
                    </div>
                  </div>

                  <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-900/10 to-indigo-900/10 border border-blue-500/20 relative overflow-hidden">
                    <div className="relative z-10 flex justify-between items-start">
                      <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-[10px] font-bold uppercase tracking-wider border border-blue-500/20">
                          <Zap className="w-3 h-3" /> {t("landing.mock.assistantActive")}
                        </div>
                        <h4 className="text-xl font-bold text-[var(--ink)]">{t("landing.mock.readyToApply")}</h4>
                        <div className="h-8 w-64 bg-[var(--bg)]/40 rounded-lg border border-[var(--border)] flex items-center px-3 text-xs text-[var(--muted)]">
                          {t("landing.mock.placeholder")}
                        </div>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/40">
                        <ArrowRight className="w-5 h-5 text-white" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 rounded-xl bg-[var(--bg-soft)] border border-[var(--border)] space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="w-8 h-8 rounded bg-black/5 dark:bg-white/10 flex items-center justify-center">
                          <Briefcase className="w-4 h-4 text-[var(--muted)]" />
                        </div>
                        <MoreHorizontal className="w-4 h-4 text-[var(--muted)]" />
                      </div>
                      <div>
                        <div className="h-2 w-16 bg-black/20 dark:bg-white/20 rounded mb-1.5"></div>
                        <div className="h-1.5 w-24 bg-black/10 dark:bg-white/10 rounded"></div>
                      </div>
                      <div className="pt-2 border-t border-[var(--border)] flex items-center gap-2">
                        <div className="w-16 h-1 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                          <div className="w-3/4 h-full bg-emerald-500"></div>
                        </div>
                        <span className="text-[10px] text-emerald-500 font-bold">
                          {t("landing.mock.match")}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--bg-soft)] border border-[var(--border)] space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="w-8 h-8 rounded bg-black/5 dark:bg-white/10 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-[var(--muted)]" />
                        </div>
                        <div className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 text-[10px] font-bold">
                          V3
                        </div>
                      </div>
                      <div>
                        <div className="h-2 w-20 bg-black/20 dark:bg-white/20 rounded mb-1.5"></div>
                        <div className="h-1.5 w-12 bg-black/10 dark:bg-white/10 rounded"></div>
                      </div>
                      <div className="pt-2 border-t border-[var(--border)] flex gap-1">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-1 w-1 rounded-full bg-[var(--muted)]"></div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-[var(--bg-soft)] border border-[var(--border)] space-y-3">
                      <div className="flex justify-between items-start">
                        <div className="w-8 h-8 rounded bg-black/5 dark:bg-white/10 flex items-center justify-center">
                          <Mic className="w-4 h-4 text-[var(--muted)]" />
                        </div>
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                      </div>
                      <div className="flex items-end gap-0.5 h-8 opacity-50">
                        {[4, 8, 6, 3, 9, 5, 7, 4, 6, 3].map((h, i) => (
                          <div
                            key={i}
                            style={{ height: `${h * 10}%` }}
                            className="w-1 bg-black/30 dark:bg-white/40 rounded-full"
                          />
                        ))}
                      </div>
                      <div className="text-[10px] text-[var(--muted)] text-center">
                        {t("landing.mock.generatingPitch")}
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 rounded-xl bg-[var(--bg-soft)] border border-[var(--border)] p-4 space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="h-2 w-24 bg-black/10 dark:bg-white/10 rounded"></div>
                      <div className="h-2 w-8 bg-black/5 dark:bg-white/5 rounded"></div>
                    </div>
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      >
                        <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center text-blue-500 font-bold text-xs">
                          G
                        </div>
                        <div className="space-y-1 flex-1">
                          <div className="h-1.5 w-20 bg-black/20 dark:bg-white/20 rounded"></div>
                          <div className="h-1 w-12 bg-black/10 dark:bg-white/10 rounded"></div>
                        </div>
                        <div className="px-2 py-1 rounded bg-green-500/10 text-green-600 dark:text-green-500 text-[10px]">
                          {t("landing.mock.sent")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* --- FEATURES --- */}
        <section id="features" className="max-w-7xl mx-auto px-4 py-24">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-[var(--ink)]">
              {t("landing.features.title")}
            </h2>
            <p className="text-[var(--muted)] max-w-2xl mx-auto">
              {t("landing.features.subtitle")}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 (Large) */}
            <motion.div
              {...fadeUp(0)}
              whileHover={{ y: -5 }}
              className="md:col-span-2 rounded-3xl bg-gradient-to-br from-blue-900/10 to-[var(--bg-soft)] border border-[var(--border)] p-8 relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:opacity-20 transition-opacity">
                <FileText className="w-64 h-64 text-blue-500" />
              </div>
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center mb-4 text-blue-400">
                  <Sparkles className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold mb-2 text-[var(--ink)]">
                  {t("landing.features.f1.title")}
                </h3>
                <p className="text-[var(--muted)] max-w-sm">
                  {t("landing.features.f1.desc")}
                </p>
              </div>
            </motion.div>

            {/* Feature 2 */}
            <motion.div
              {...fadeUp(0.1)}
              whileHover={{ y: -5 }}
              className="rounded-3xl bg-[var(--bg-soft)] border border-[var(--border)] p-8 group"
            >
              <div className="w-12 h-12 rounded-xl bg-emerald-600/20 flex items-center justify-center mb-4 text-emerald-500">
                <Mic className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-[var(--ink)]">{t("landing.features.f2.title")}</h3>
              <p className="text-[var(--muted)] text-sm">{t("landing.features.f2.desc")}</p>
            </motion.div>

            {/* Feature 3 */}
            <motion.div
              {...fadeUp(0.15)}
              whileHover={{ y: -5 }}
              className="rounded-3xl bg-[var(--bg-soft)] border border-[var(--border)] p-8 group"
            >
              <div className="w-12 h-12 rounded-xl bg-purple-600/20 flex items-center justify-center mb-4 text-purple-500">
                <BarChart3 className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold mb-2 text-[var(--ink)]">{t("landing.features.f3.title")}</h3>
              <p className="text-[var(--muted)] text-sm">{t("landing.features.f3.desc")}</p>
            </motion.div>

            {/* Feature 4 (Large) */}
            <motion.div
              {...fadeUp(0.2)}
              whileHover={{ y: -5 }}
              className="md:col-span-2 rounded-3xl bg-gradient-to-bl from-indigo-900/10 to-[var(--bg-soft)] border border-[var(--border)] p-8 relative overflow-hidden group"
            >
              <div className="absolute top-0 right-0 p-10 opacity-10 group-hover:opacity-20 transition-opacity">
                <ShieldCheck className="w-64 h-64 text-indigo-500" />
              </div>
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-xl bg-indigo-600/20 flex items-center justify-center mb-4 text-indigo-500">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold mb-2 text-[var(--ink)]">{t("landing.features.f4.title")}</h3>
                <p className="text-[var(--muted)] max-w-sm">{t("landing.features.f4.desc")}</p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* --- HOW IT WORKS --- */}
        <section id="process" className="max-w-5xl mx-auto px-4 py-24">
          <h2 className="text-3xl md:text-4xl font-bold mb-16 text-center text-[var(--ink)]">
            {t("landing.process.title")}
          </h2>

          <div className="relative border-l border-[var(--border)] ml-6 md:ml-12 space-y-16">
            {[
              {
                step: "01",
                title: t("landing.process.s1.title"),
                desc: t("landing.process.s1.desc"),
              },
              {
                step: "02",
                title: t("landing.process.s2.title"),
                desc: t("landing.process.s2.desc"),
              },
              {
                step: "03",
                title: t("landing.process.s3.title"),
                desc: t("landing.process.s3.desc"),
              },
            ].map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                className="relative pl-12"
              >
                <div className="absolute -left-[25px] top-0 w-12 h-12 rounded-full bg-[var(--bg)] border border-blue-500/50 flex items-center justify-center text-blue-500 font-bold shadow-[0_0_15px_rgba(59,130,246,0.2)]">
                  {item.step}
                </div>
                <h3 className="text-2xl font-bold mb-2 text-[var(--ink)]">{item.title}</h3>
                <p className="text-[var(--muted)] text-lg leading-relaxed max-w-xl">
                  {item.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* --- PRICING --- */}
        <section
          id="pricing"
          className="max-w-7xl mx-auto px-4 py-24 bg-black/5 dark:bg-white/[0.02] border-y border-[var(--border)]"
        >
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-[var(--ink)]">
              {t("landing.pricing.title")}
            </h2>
            <p className="text-[var(--muted)]">{t("landing.pricing.subtitle")}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                title: t("landing.pricing.p1.title"),
                price: t("landing.pricing.p1.price"),
                desc: t("landing.pricing.p1.desc"),
                features: [
                  t("landing.pricing.p1.f1"),
                  t("landing.pricing.p1.f2"),
                  t("landing.pricing.p1.f3"),
                ],
              },
              {
                title: t("landing.pricing.p2.title"),
                price: t("landing.pricing.p2.price"),
                desc: t("landing.pricing.p2.desc"),
                features: [
                  t("landing.pricing.p2.f1"),
                  t("landing.pricing.p2.f2"),
                  t("landing.pricing.p2.f3"),
                  t("landing.pricing.p2.f4"),
                ],
                popular: true,
              },
              {
                title: t("landing.pricing.p3.title"),
                price: t("landing.pricing.p3.price"),
                desc: t("landing.pricing.p3.desc"),
                features: [
                  t("landing.pricing.p3.f1"),
                  t("landing.pricing.p3.f2"),
                  t("landing.pricing.p3.f3"),
                  t("landing.pricing.p3.f4"),
                ],
              },
            ].map((plan, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -10 }}
                className={`relative p-8 rounded-3xl border flex flex-col ${
                  plan.popular
                    ? "bg-gradient-to-b from-blue-900/10 to-[var(--bg-soft)] border-blue-500/40 shadow-2xl shadow-blue-900/10"
                    : "bg-[var(--bg-soft)] border-[var(--border)]"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-blue-600 text-white text-xs font-bold uppercase tracking-wider rounded-full">
                    {t("landing.pricing.popular")}
                  </div>
                )}
                <h3 className="text-lg font-medium text-[var(--muted)] mb-2">{plan.title}</h3>
                <div className="text-4xl font-bold mb-2 text-[var(--ink)]">{plan.price}</div>
                <p className="text-sm text-[var(--muted)] mb-8">{plan.desc}</p>

                <ul className="space-y-4 mb-8 flex-1">
                  {plan.features.map((feat, j) => (
                    <li key={j} className="flex items-center gap-3 text-sm text-[var(--ink)]">
                      <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      {feat}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={handleSmartLogin}
                  className={`w-full py-3 rounded-xl font-bold transition-all ${
                    plan.popular
                      ? "bg-blue-600 hover:bg-blue-500 text-white"
                      : "bg-black/5 dark:bg-white/10 hover:opacity-90 text-[var(--ink)] border border-[var(--border)]"
                  }`}
                >
                  {t("landing.pricing.choose")}
                </button>
              </motion.div>
            ))}
          </div>
        </section>

        {/* --- FAQ --- */}
        <section id="faq" className="max-w-3xl mx-auto px-4 py-24">
          <h2 className="text-3xl font-bold mb-12 text-center text-[var(--ink)]">{t("landing.faq.title")}</h2>
          <div className="space-y-4">
            {[
              { q: t("landing.faq.q1"), a: t("landing.faq.a1") },
              { q: t("landing.faq.q2"), a: t("landing.faq.a2") },
              { q: t("landing.faq.q3"), a: t("landing.faq.a3") },
            ].map((item, i) => (
              <details
                key={i}
                className="group bg-[var(--bg-soft)] rounded-2xl border border-[var(--border)] overflow-hidden"
              >
                <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                  <span className="font-medium text-[var(--ink)]">{item.q}</span>
                  <ChevronDown className="w-5 h-5 text-[var(--muted)] transition-transform group-open:rotate-180" />
                </summary>
                <div className="px-6 pb-6 text-[var(--muted)] text-sm leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* --- CTA FINAL --- */}
        <section className="px-4 py-24 text-center">
          <div className="max-w-4xl mx-auto bg-gradient-to-b from-blue-900/20 to-[var(--bg-soft)] border border-blue-500/20 rounded-[3rem] p-12 relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full bg-[radial-gradient(circle_at_center,_rgba(59,130,246,0.12),_transparent_70%)] pointer-events-none" />

            <h2 className="text-3xl md:text-5xl font-bold mb-6 relative z-10 text-[var(--ink)]">
              {t("landing.cta.title")}
            </h2>
            <p className="text-lg text-[var(--muted)] mb-10 max-w-2xl mx-auto relative z-10">
              {t("landing.cta.subtitle")}
            </p>

            <Link
              href="/signup"
              className="relative z-10 px-8 py-4 bg-[var(--ink)] text-[var(--bg)] text-lg font-bold rounded-full hover:opacity-90 transition-all inline-block"
            >
              {t("landing.cta.button")}
            </Link>
          </div>
        </section>
      </main>

      {/* --- FOOTER --- */}
      <footer className="border-t border-[var(--border)] bg-black/5 dark:bg-black/20 text-[var(--muted)] py-12 px-4 text-center text-sm">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Zap className="w-4 h-4" />
          <span className="font-bold text-[var(--ink)]">{t("landing.footer.brand")}</span>
        </div>
        <p>
          &copy; {new Date().getFullYear()} {t("landing.footer.rights")}
        </p>
      </footer>
    </div>
  );
}