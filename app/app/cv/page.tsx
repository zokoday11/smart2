"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import {
  BrainCircuit, Trophy, Loader2, ArrowRight, RefreshCcw,
  FileText, AlertTriangle, Sparkles, Copy, MonitorPlay,
  CheckCircle2, XCircle, HelpCircle, BarChart3
} from "lucide-react";

// --- TYPES ---
type Question = {
  id: number;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation: string;
};

type QuizState = "idle" | "loading" | "playing" | "finished";

// --- MOCK AI GENERATOR (À remplacer par ton appel réel plus tard) ---
const mockGenerateQuiz = async (jobTitle: string): Promise<Question[]> => {
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return [
    {
      id: 1,
      question: `Dans le cadre d'un poste de ${jobTitle}, quelle est la priorité absolue lors d'un incident critique ?`,
      options: [
        "Chercher un coupable",
        "Communiquer et isoler le problème",
        "Éteindre tous les systèmes",
        "Attendre que ça passe"
      ],
      correctAnswer: 1,
      explanation: "La communication et l'endiguement sont les premières étapes pour limiter l'impact."
    },
    {
      id: 2,
      question: "Quel outil de collaboration est le plus adapté pour suivre l'avancement des tâches ?",
      options: ["Excel (local)", "Jira / Trello", "WhatsApp", "Post-it sur l'écran"],
      correctAnswer: 1,
      explanation: "Les outils agiles comme Jira permettent une traçabilité et une collaboration temps réel."
    },
    {
      id: 3,
      question: "Quelle soft skill est la plus valorisée pour ce rôle ?",
      options: ["L'autorité", "L'écoute active", "La vitesse de frappe", "La mémorisation"],
      correctAnswer: 1,
      explanation: "L'écoute active est fondamentale pour comprendre les besoins réels des parties prenantes."
    },
    {
      id: 4,
      question: "Comment gérer un conflit d'équipe ?",
      options: ["Ignorer le conflit", "Médiation factuelle", "Prendre parti immédiatement", "Licencier tout le monde"],
      correctAnswer: 1,
      explanation: "Une approche factuelle et neutre permet de désamorcer les tensions émotionnelles."
    }
  ];
};

export default function QuizPage() {
  const { user } = useAuth();
  
  // Profil
  const [jobTitle, setJobTitle] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  // Quiz State
  const [status, setStatus] = useState<QuizState>("idle");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load Profile
  useEffect(() => {
    if (!user) { setLoadingProfile(false); return; }
    getDoc(doc(db, "profiles", user.uid)).then(snap => {
      if (snap.exists()) setJobTitle(snap.data().title || null);
      setLoadingProfile(false);
    });
  }, [user]);

  // Actions
  const startQuiz = async () => {
    if (!jobTitle) return;
    setStatus("loading");
    setErrorMsg(null);
    try {
      const data = await mockGenerateQuiz(jobTitle);
      setQuestions(data);
      setCurrentIndex(0);
      setScore(0);
      setIsAnswered(false);
      setSelectedOption(null);
      setStatus("playing");
    } catch (e) {
      console.error(e);
      setErrorMsg("Erreur génération quiz.");
      setStatus("idle");
    }
  };

  const handleAnswer = (idx: number) => {
    if (isAnswered) return;
    setSelectedOption(idx);
    setIsAnswered(true);
    if (idx === questions[currentIndex].correctAnswer) setScore(s => s + 1);
  };

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(c => c + 1);
      setIsAnswered(false);
      setSelectedOption(null);
    } else {
      setStatus("finished");
    }
  };

  const resetQuiz = () => {
    setStatus("idle");
    setQuestions([]);
    setCurrentIndex(0);
    setScore(0);
  };

  if (loadingProfile) return <div className="h-screen flex items-center justify-center bg-[#0A0A0B]"><Loader2 className="w-8 h-8 text-blue-500 animate-spin" /></div>;

  const progress = questions.length > 0 ? ((currentIndex + 1) / questions.length) * 100 : 0;
  const scorePercent = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-slate-200 font-sans p-4 lg:p-8">
       <div className="max-w-6xl mx-auto grid lg:grid-cols-[350px,1fr] gap-6 h-[calc(100vh-4rem)]">
          
          {/* GAUCHE : INFO & STATUT */}
          <div className="flex flex-col gap-4">
             {/* Header Card */}
             <div className="bg-[#16181D] border border-white/10 rounded-2xl p-6 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                        <BrainCircuit className="w-5 h-5 text-white" />
                    </div>
                    <div>
                        <h1 className="font-bold text-white leading-tight">Quiz IA</h1>
                        <p className="text-[10px] text-purple-400 font-mono uppercase tracking-wider">Skill Check</p>
                    </div>
                </div>
                
                <div className="p-3 bg-white/5 rounded-xl border border-white/5 space-y-2">
                   <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cible</p>
                   {jobTitle ? (
                      <div className="flex items-center gap-2 text-sm font-medium text-white">
                         <BriefcaseIcon className="w-4 h-4 text-slate-400" />
                         {jobTitle}
                      </div>
                   ) : (
                      <div className="flex items-center gap-2 text-sm text-yellow-500">
                         <AlertTriangle className="w-4 h-4" /> Aucun poste détecté
                      </div>
                   )}
                </div>
             </div>

             {/* Stats Card (Visible only when playing/finished) */}
             <AnimatePresence>
               {(status === "playing" || status === "finished") && (
                 <motion.div 
                   initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                   className="bg-[#16181D] border border-white/10 rounded-2xl p-6 shadow-lg flex-1"
                 >
                    <div className="flex items-center justify-between mb-4">
                       <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Score actuel</span>
                       <BarChart3 className="w-4 h-4 text-slate-600" />
                    </div>
                    <div className="flex items-baseline gap-2">
                       <span className="text-4xl font-black text-white">{score}</span>
                       <span className="text-sm text-slate-500 font-medium">/ {questions.length}</span>
                    </div>
                    <div className="w-full bg-white/5 rounded-full h-1.5 mt-4 overflow-hidden">
                       <motion.div 
                         className="h-full bg-purple-500" 
                         initial={{ width: 0 }} 
                         animate={{ width: `${(score / questions.length) * 100}%` }} 
                       />
                    </div>
                 </motion.div>
               )}
             </AnimatePresence>
          </div>

          {/* DROITE : ZONE DE JEU */}
          <div className="flex flex-col h-full min-h-0 bg-[#16181D] border border-white/10 rounded-3xl shadow-2xl relative overflow-hidden">
             
             {/* IDLE STATE */}
             {status === "idle" && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6">
                   <div className="w-24 h-24 bg-purple-500/10 rounded-full flex items-center justify-center border border-purple-500/20 mb-4">
                      <Sparkles className="w-10 h-10 text-purple-500" />
                   </div>
                   <div>
                      <h2 className="text-2xl font-bold text-white mb-2">Testez vos connaissances</h2>
                      <p className="text-slate-400 max-w-md mx-auto">
                         L'IA va générer un quiz technique unique basé sur votre poste de <span className="text-white font-semibold">{jobTitle || "..."}</span>.
                      </p>
                   </div>
                   <button 
                     onClick={startQuiz} 
                     disabled={!jobTitle}
                     className="px-8 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold shadow-lg shadow-purple-500/25 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                     <MonitorPlay className="w-4 h-4" /> Démarrer le Quiz
                   </button>
                   {!jobTitle && <p className="text-xs text-red-400 bg-red-500/10 px-3 py-1 rounded-full">Veuillez d'abord compléter votre profil CV.</p>}
                </div>
             )}

             {/* LOADING STATE */}
             {status === "loading" && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                   <Loader2 className="w-12 h-12 text-purple-500 animate-spin" />
                   <p className="text-slate-300 font-medium">L'IA analyse votre profil...</p>
                </div>
             )}

             {/* PLAYING STATE */}
             {status === "playing" && (
                <div className="flex flex-col h-full">
                   {/* Progress Bar Top */}
                   <div className="h-1 w-full bg-white/5">
                      <motion.div 
                        className="h-full bg-purple-500" 
                        initial={{ width: 0 }} 
                        animate={{ width: `${progress}%` }} 
                        transition={{ type: "spring", stiffness: 50 }}
                      />
                   </div>

                   <div className="flex-1 overflow-y-auto p-6 md:p-10 flex flex-col max-w-3xl mx-auto w-full">
                      <div className="mb-8">
                         <span className="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-4">
                            Question {currentIndex + 1}
                         </span>
                         <h3 className="text-xl md:text-2xl font-bold text-white leading-relaxed">
                            {questions[currentIndex].question}
                         </h3>
                      </div>

                      <div className="space-y-3">
                         {questions[currentIndex].options.map((opt, idx) => {
                            let stateClass = "border-white/10 bg-white/5 hover:bg-white/10 text-slate-300";
                            let icon = <div className="w-5 h-5 rounded-full border border-white/20 flex items-center justify-center text-[10px]">{String.fromCharCode(65+idx)}</div>;

                            if (isAnswered) {
                               if (idx === questions[currentIndex].correctAnswer) {
                                  stateClass = "border-green-500/50 bg-green-500/10 text-green-200";
                                  icon = <CheckCircle2 className="w-5 h-5 text-green-500" />;
                               } else if (idx === selectedOption) {
                                  stateClass = "border-red-500/50 bg-red-500/10 text-red-200";
                                  icon = <XCircle className="w-5 h-5 text-red-500" />;
                               } else {
                                  stateClass = "opacity-40 border-white/5 bg-transparent";
                               }
                            } else if (selectedOption === idx) {
                               stateClass = "border-purple-500 bg-purple-500/20 text-white";
                            }

                            return (
                               <button 
                                 key={idx}
                                 onClick={() => handleAnswer(idx)}
                                 disabled={isAnswered}
                                 className={`w-full p-4 rounded-xl border flex items-center gap-4 text-left transition-all ${stateClass}`}
                               >
                                  {icon}
                                  <span className="font-medium text-sm md:text-base">{opt}</span>
                               </button>
                            );
                         })}
                      </div>

                      {/* Explanation Reveal */}
                      <AnimatePresence>
                         {isAnswered && (
                            <motion.div 
                              initial={{ opacity: 0, y: 20 }} 
                              animate={{ opacity: 1, y: 0 }} 
                              className="mt-8 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20"
                            >
                               <div className="flex items-start gap-3">
                                  <HelpCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                                  <div>
                                     <p className="text-xs font-bold text-blue-300 uppercase mb-1">Explication</p>
                                     <p className="text-sm text-slate-300 leading-relaxed">{questions[currentIndex].explanation}</p>
                                  </div>
                               </div>
                               <div className="mt-4 flex justify-end">
                                  <button onClick={nextQuestion} className="px-6 py-2 rounded-lg bg-white text-black font-bold text-sm hover:bg-slate-200 transition-colors flex items-center gap-2">
                                     Suivant <ArrowRight className="w-4 h-4" />
                                  </button>
                               </div>
                            </motion.div>
                         )}
                      </AnimatePresence>
                   </div>
                </div>
             )}

             {/* FINISHED STATE */}
             {status === "finished" && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                   <motion.div 
                     initial={{ scale: 0.8, opacity: 0 }} 
                     animate={{ scale: 1, opacity: 1 }} 
                     className="relative mb-8"
                   >
                      <div className="absolute inset-0 bg-purple-500 blur-[60px] opacity-20" />
                      <div className="relative w-32 h-32 bg-gradient-to-tr from-purple-500 to-indigo-500 rounded-full flex items-center justify-center shadow-2xl border-4 border-[#16181D]">
                         <Trophy className="w-14 h-14 text-white" />
                      </div>
                      <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-[#16181D] border border-white/10 px-4 py-1 rounded-full text-xs font-bold text-white shadow-lg whitespace-nowrap">
                         Score Final
                      </div>
                   </motion.div>

                   <h2 className="text-3xl font-black text-white mb-2">{score} / {questions.length}</h2>
                   <p className="text-slate-400 mb-8 max-w-xs mx-auto">
                      {scorePercent >= 80 ? "Excellent travail ! Vous maîtrisez votre sujet." : 
                       scorePercent >= 50 ? "Bien joué ! Encore quelques efforts pour l'excellence." : 
                       "Continuez à vous entraîner, la maîtrise viendra !"}
                   </p>

                   <div className="flex gap-3">
                      <button onClick={resetQuiz} className="px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold transition-all flex items-center gap-2">
                         <RefreshCcw className="w-4 h-4" /> Recommencer
                      </button>
                      <button onClick={() => { navigator.clipboard.writeText(`J'ai fait ${score}/${questions.length} au quiz ${jobTitle} sur SmartApply !`); alert("Copié !"); }} className="px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold shadow-lg shadow-purple-500/20 transition-all flex items-center gap-2">
                         <Copy className="w-4 h-4" /> Partager
                      </button>
                   </div>
                </div>
             )}

          </div>

       </div>
    </div>
  );
}

// Icon helper
function BriefcaseIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
  );
}