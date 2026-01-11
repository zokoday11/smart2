// components/ui/Starfield.tsx
"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";

type Star = {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  speed: number;
};

export const Starfield = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let stars: Star[] = [];
    let animationId: number;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      createStars();
    };

    const createStars = () => {
      const count = Math.floor((width * height) / 9000);
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          radius: Math.random() * 1.4 + 0.3,
          alpha: Math.random(),
          speed: Math.random() * 0.4 + 0.05,
        });
      }
    };

    const draw = () => {
      const isLight = theme === "light";

      // ✅ on efface seulement → fond TRANSPARENT
      ctx.clearRect(0, 0, width, height);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      for (const star of stars) {
        star.alpha += star.speed * 0.01;
        if (star.alpha > 1) star.alpha = 0.2;

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        ctx.fillStyle = isLight
          ? `rgba(37, 99, 235, ${star.alpha})`
          : `rgba(129, 140, 248, ${star.alpha})`;
        ctx.fill();
      }

      ctx.restore();
      animationId = requestAnimationFrame(draw);
    };

    window.addEventListener("resize", resize);
    resize();
    draw();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      className="starry-background"
    />
  );
};
