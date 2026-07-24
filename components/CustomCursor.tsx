"use client";
import { useEffect, useRef } from "react";
import gsap from "gsap";

export default function CustomCursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const xTo = gsap.quickTo(el, "x", { duration: 0.01, ease: "power3" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.01, ease: "power3" });

    const onMove = (e: MouseEvent) => {
      xTo(e.clientX);
      yTo(e.clientY);
    };

    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 w-[12px] h-[12px] rounded-full pointer-events-none z-[9999] 
                 -translate-x-1/2 -translate-y-1/2 mix-blend-difference max-md:hidden
                 bg-[#E8D5B7] shadow-[0_0_20px_rgba(232,213,183,0.4),0_0_60px_rgba(232,213,183,0.1)]"
    />
  );
}