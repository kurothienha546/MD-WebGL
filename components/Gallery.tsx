"use client";

import { useRef } from "react";
import type { MutableRefObject, RefObject } from "react";
import WebGLGallery from "./WebGLGallery";

interface GalleryProps {
  snapRef: MutableRefObject<number | null>;
  openLightbox?: (index: number) => void;
  cursorRef?: RefObject<HTMLElement | null>;
}

export default function Gallery({ snapRef, openLightbox, cursorRef }: GalleryProps) {
  const crosshairRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);

  return (
    <div className="contents">
      <div
        ref={crosshairRef}
        id="crosshair"
        className="pointer-events-none fixed left-1/2 top-1/2 z-[3000] h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 max-md:hidden"
      >
        <div className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 rounded-sm bg-text" />
        <div className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 rounded-sm bg-text" />
      </div>

      <WebGLGallery
        snapRef={snapRef}
        openLightbox={openLightbox}
        cursorRef={cursorRef}
        crosshairRef={crosshairRef}
        progressRef={progressRef}
      />

      <div
        ref={progressRef}
        id="progress-bar"
        className="fixed bottom-0 left-0 z-[300] h-[1.5px] w-full origin-left scale-x-0 bg-accent opacity-55 transition-opacity duration-300"
      />
    </div>
  );
}