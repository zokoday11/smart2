"use client";

import { useEffect } from "react";
import AOS from "aos";
import "aos/dist/aos.css";

export default function AOSProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    AOS.init({
      duration: 1000, // durée des animations
      once: true,     // n’anime qu’une seule fois
      easing: "ease-out-cubic",
      offset: 60
    });
  }, []);

  return <>{children}</>;
}
