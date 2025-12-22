"use client";

export default function TechPage() {
  return (
    <div className="min-h-screen px-4 sm:px-8 py-8">
      <div className="max-w-4xl mx-auto glass p-6">
        <h1 className="text-xl font-semibold mb-3">Technologies utilisées</h1>
        <p className="text-sm text-[var(--muted)] mb-4">
          Bien que le site lui-même ne liste pas explicitement les technologies de son frontend
          dans le contenu visible, l'analyse du code source et des pratiques courantes pour ce
          type de plateforme moderne suggère fortement l'utilisation de la pile suivante :
        </p>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          <li>
            <span className="font-semibold">Frontend — React / Next.js :</span>{" "}
            Framework JavaScript moderne pour construire l&apos;interface utilisateur,
            avec un routage optimisé et un rendu performant.
          </li>
          <li>
            <span className="font-semibold">Styling — Tailwind CSS :</span>{" "}
            Framework CSS utilitaire permettant de construire rapidement des designs
            réactifs et cohérents.
          </li>
          <li>
            <span className="font-semibold">Animations — Framer Motion :</span>{" "}
            Bibliothèque React dédiée aux animations fluides, transitions interactives
            et gestes avancés.
          </li>
        </ul>
        <p className="text-sm text-[var(--muted)] mt-4">
          Le style sombre, les cartes en verre (glassmorphism) et les transitions rapides
          sont caractéristiques d&apos;une approche basée sur Next.js couplé à Tailwind CSS
          et Framer Motion pour les effets au scroll et à l&apos;interaction.
        </p>
      </div>
    </div>
  );
}
