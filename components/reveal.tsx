"use client";

import { useEffect, useRef, useState } from "react";

/* Scroll-reveal wrapper: fades + slides its children in the first time they
   enter the viewport. Honors prefers-reduced-motion (handled in CSS). */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ob = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          ob.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    ob.observe(el);
    return () => ob.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={`reveal ${shown ? "reveal-in" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
