"use client";

import type { MutableRefObject, RefObject } from "react";
import { works } from "@/lib/works";
import { useGalleryAnimation } from "@/hooks/useGalleryAnimation";

interface GalleryProps {
  snapRef: MutableRefObject<number | null>;
  openLightbox?: (index: number) => void;
  /**
   * Optional ref to the global custom-cursor element. When omitted, falls
   * back to `document.getElementById("cursor")` for backward compatibility.
   */
  cursorRef?: RefObject<HTMLElement | null>;
}

export default function Gallery({ snapRef, openLightbox, cursorRef }: GalleryProps) {
  const {
    galleryRef,
    trackRef,
    progressRef,
    crosshairRef,
    registerWrap,
    registerImage,
    registerUnderline,
    handleImageLoad,
    handleWrapMouseEnter,
    handleWrapMouseLeave,
    handleWrapKeyDown,
  } = useGalleryAnimation(snapRef, cursorRef, openLightbox);

  return (
    <div ref={galleryRef} className="contents">
      <div
        ref={crosshairRef}
        id="crosshair"
        className="pointer-events-none fixed left-1/2 top-1/2 z-[3000] h-[22px] w-[22px] max-md:hidden"
      >
        <div className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 rounded-sm bg-text" />
        <div className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 rounded-sm bg-text" />
      </div>

      <div
        ref={trackRef}
        id="image-track"
        role="region"
        aria-label="Image gallery"
        aria-roledescription="carousel"
        className="absolute left-1/2 top-1/2 flex touch-none select-none gap-[2.2vmin] will-change-transform"
      >
        {works.map((work, index) => (
          <div
            key={work.src}
            ref={registerWrap(work.src)}
            data-work-index={index}
            role="group"
            aria-roledescription="slide"
            aria-label={work.title}
            tabIndex={0}
            className="image-wrap relative h-[58vmin] w-[40vmin] flex-shrink-0 cursor-none overflow-hidden outline-none max-md:h-[50vmin] max-md:w-[70vmin] max-md:cursor-auto"
            onMouseEnter={handleWrapMouseEnter}
            onMouseLeave={handleWrapMouseLeave}
            onKeyDown={(event) => handleWrapKeyDown(event, index)}
          >
            <img
              ref={registerImage(work.src)}
              className="image block h-full w-full object-cover"
              style={{ objectPosition: "50% 50%", willChange: "transform", transformOrigin: "center center" }}
              src={work.src}
              alt={work.title}
              draggable={false}
              loading={index < 3 ? "eager" : "lazy"}
              onLoad={handleImageLoad}
            />
            <span className="absolute right-4 top-[14px] font-mono text-[0.5rem] text-white/38">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div
              ref={registerUnderline(work.src)}
              className="absolute bottom-0 left-0 right-0 h-[1.5px] opacity-0"
              style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }}
            />
          </div>
        ))}
      </div>

      <div
        ref={progressRef}
        id="progress-bar"
        className="fixed bottom-0 left-0 z-[300] h-[1.5px] w-full origin-left scale-x-0 bg-accent opacity-55"
      />
    </div>
  );
}