"use client";

import { useEffect, useRef } from "react";
import type { RefObject, MutableRefObject } from "react";
import { works } from "@/lib/works";
import { useSliderStore } from "@/store/useSliderStore";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { WebGLEngine } from "@/lib/webgl/WebGLEngine";
import { GALLERY_SNAP_EVENT } from "@/lib/constants";

interface WebGLGalleryProps {
  snapRef: MutableRefObject<number | null>;
  openLightbox?: (index: number) => void;
  cursorRef?: RefObject<HTMLElement | null>;
  crosshairRef?: RefObject<HTMLElement | null>;
  progressRef?: RefObject<HTMLElement | null>;
}

interface GallerySnapDetail {
  index: number;
  offset?: number;
}

export default function WebGLGallery({
  snapRef,
  openLightbox,
  cursorRef,
  progressRef,
}: WebGLGalleryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<WebGLEngine | null>(null);

  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const engine = new WebGLEngine({
      container,
      canvas,
      openLightbox,
      progressEl: progressRef?.current,
      cursorEl: cursorRef?.current || document.getElementById("cursor"),
      isReducedMotion: reducedMotion,
    });
    engineRef.current = engine;

    const onGallerySnap = (event: Event) => {
      const detail = (event as CustomEvent<GallerySnapDetail>).detail;
      if (!detail || !Number.isInteger(detail.index) || !works[detail.index]) return;

      const requestedOffset =
        typeof detail.offset === "number" ? detail.offset : engine.metrics.centers[detail.index];
      engine.syncOffset(requestedOffset);
      useSliderStore.getState().setActiveIndex(detail.index);
      snapRef.current = null;
    };

    window.addEventListener(GALLERY_SNAP_EVENT, onGallerySnap);

    return () => {
      window.removeEventListener(GALLERY_SNAP_EVENT, onGallerySnap);
      engine.destroy();
    };
  }, [cursorRef, openLightbox, progressRef, reducedMotion, snapRef]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full overflow-hidden select-none touch-none z-0"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 w-full h-full block"
      />
    </div>
  );
}
