"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { UseLightboxAnimationResult } from "@/hooks/useLightboxAnimation";

interface LightboxProps {
  animation: UseLightboxAnimationResult;
}

export default function Lightbox({ animation }: LightboxProps) {
  const [mounted, setMounted] = useState(false);
  const [hasCustomCursor, setHasCustomCursor] = useState(false);

  useEffect(() => {
    setMounted(true);
    setHasCustomCursor(Boolean(document.getElementById("cursor")));
  }, []);

  const {
    lightboxRef,
    overlayRef,
    crossLeftRef,
    crossRightRef,
    titleRef,
    labelRef,
    counterRef,
    closeRef,
    isOpen,
    closeLightbox,
    handleStageClick,
  } = animation;

  useFocusTrap(lightboxRef, isOpen, closeRef);

  const cursorClass = hasCustomCursor ? "cursor-none" : "";

  const content = (
    <div
      id="lightbox"
      ref={lightboxRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
      aria-hidden={!isOpen}
      tabIndex={-1}
      onClick={handleStageClick}
      className={`fixed left-0 top-0 z-[2000] h-0 w-0 invisible overflow-hidden bg-transparent pointer-events-none ${cursorClass} outline-none max-md:cursor-auto`}
    >
      <div
        ref={overlayRef}
        id="lightbox-overlay"
        className="pointer-events-none absolute inset-0 z-10 [transform:translateZ(0)] will-change-[transform,opacity]"
        style={{
          background:
            "linear-gradient(to top, rgba(0, 0, 0, .62) 0%, transparent 52%, rgba(0, 0, 0, .2) 100%)",
        }}
      />

      <div
        ref={crossLeftRef}
        id="lb-cross-l"
        className="absolute left-[20vw] top-1/2 h-[22px] w-[22px] pointer-events-none z-20 mix-blend-difference text-white [transform:translateZ(0)] will-change-[transform,opacity]"
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 rounded-sm bg-current" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 rounded-sm bg-current" />
      </div>
      <div
        ref={crossRightRef}
        id="lb-cross-r"
        className="absolute right-[20vw] top-1/2 h-[22px] w-[22px] pointer-events-none z-20 mix-blend-difference text-white [transform:translateZ(0)] will-change-[transform,opacity]"
      >
        <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 rounded-sm bg-current" />
        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 rounded-sm bg-current" />
      </div>

      <div
        ref={titleRef}
        id="lightbox-title"
        className="pointer-events-none absolute left-1/2 top-1/2 z-20 whitespace-nowrap text-center font-serif font-light text-white mix-blend-difference select-none [transform:translateZ(0)] will-change-[transform,opacity]"
        style={{
          fontSize: "clamp(2.2rem, 5vw, 4.5rem)",
          letterSpacing: "-0.015em",
          textShadow: "0 4px 24px rgba(0,0,0,0.3)",
        }}
      />
      <div
        ref={labelRef}
        id="lightbox-label"
        className="pointer-events-none absolute left-1/2 z-20 font-mono text-[0.58rem] uppercase tracking-[0.3em] text-white mix-blend-difference select-none [transform:translateZ(0)] will-change-[transform,opacity]"
        style={{
          top: "calc(50% + clamp(2.2rem, 5vw, 4.5rem) * 0.6 + 30px)",
          textShadow: "0 2px 12px rgba(0,0,0,0.3)",
        }}
      />

      <button
        ref={closeRef}
        id="lightbox-close"
        type="button"
        aria-label="Close lightbox"
        onClick={(event) => {
          event.stopPropagation();
          closeLightbox();
        }}
        className={`absolute right-[52px] top-9 z-[30] border-0 bg-transparent p-0 font-mono text-[0.55rem] uppercase tracking-[0.22em] text-white mix-blend-difference ${cursorClass} outline-none hover:opacity-70 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/70 focus-visible:outline-offset-4 max-md:cursor-auto [transform:translateZ(0)] will-change-[transform,opacity]`}
      >
        Close — Esc
      </button>

      <div
        ref={counterRef}
        id="lb-counter"
        className="pointer-events-none absolute bottom-11 left-1/2 z-20 font-mono text-[0.6rem] tracking-[0.18em] text-white mix-blend-difference [transform:translateZ(0)] will-change-[transform,opacity]"
      />
    </div>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
}