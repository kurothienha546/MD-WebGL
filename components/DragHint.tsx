"use client";
import { useEffect, useState } from "react";

export default function DragHint() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const onDown = () => setGone(true);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("touchstart", onDown);
    };
  }, []);

  return (
    <div
      id="drag-hint"
      className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[150] flex flex-col items-center gap-[10px] pointer-events-none transition-opacity duration-700 ${
        gone ? "opacity-0" : ""
      }`}
      style={{ opacity: gone ? 0 : undefined, animation: gone ? undefined : "fadeIn 1s 2.5s ease forwards" }}
    >
      <div className="flex gap-[10px] text-[#E8D5B7]/60">
        <svg viewBox="0 0 24 24" className="w-4 stroke-current fill-none stroke-[1.5] animate-[nudge_2.2s_infinite_ease-in-out]" style={{ animationDirection: "reverse" }}>
          <path d="M15 19l-7-7 7-7" />
        </svg>
        <svg viewBox="0 0 24 24" className="w-4 stroke-current fill-none stroke-[1.5] animate-[nudge_2.2s_infinite_ease-in-out]">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <span className="font-mono text-[0.7rem] text-[#E8D5B7] tracking-[0.28em] uppercase font-medium drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]">
        Drag to explore
      </span>
    </div>
  );
}