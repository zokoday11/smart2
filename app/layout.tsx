// app/layout.tsx
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { AuthProvider } from "@/context/AuthContext";
import ActivityTracker from "@/components/ActivityTracker";

export const metadata: Metadata = {
  title: "Assistant Candidatures IA",
  description: "Tableau de bord CV / LM / candidatures",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#020617" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body
        className="
          min-h-screen
          bg-[var(--bg)]
          text-[var(--text)]
          overflow-x-hidden
          antialiased
        "
      >
        <AuthProvider>
          <ActivityTracker />
          <div className="min-h-screen flex flex-col">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
