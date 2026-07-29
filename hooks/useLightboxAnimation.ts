"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { MouseEvent, MutableRefObject, RefObject } from "react";
import gsap from "gsap";
import { works } from "@/lib/works";
import { useSliderStore } from "@/store/useSliderStore";
import { GALLERY_SNAP_EVENT, NAV_LOCK_MS, WHEEL_CLOSE_THRESHOLD } from "@/lib/constants";

export type LightboxPhase = "idle" | "opening" | "open" | "sliding" | "closing";

const asElements = (...nodes: Array<HTMLElement | null>): HTMLElement[] =>
  nodes.filter((node): node is HTMLElement => node !== null);

export interface UseLightboxAnimationResult {
  lightboxRef: MutableRefObject<HTMLDivElement | null>;
  overlayRef: MutableRefObject<HTMLDivElement | null>;
  crossLeftRef: MutableRefObject<HTMLDivElement | null>;
  crossRightRef: MutableRefObject<HTMLDivElement | null>;
  titleRef: MutableRefObject<HTMLDivElement | null>;
  labelRef: MutableRefObject<HTMLDivElement | null>;
  counterRef: MutableRefObject<HTMLDivElement | null>;
  closeRef: MutableRefObject<HTMLButtonElement | null>;
  isOpen: boolean;
  openLightbox: (index: number) => void;
  goToIndex: (index: number) => void;
  goToDirection: (direction: 1 | -1) => void;
  closeLightbox: () => void;
  handleStageClick: (event: MouseEvent<HTMLDivElement>) => void;
}

export function useLightboxAnimation(
  _snapRef: MutableRefObject<number | null>,
  outerCrosshairRef?: RefObject<HTMLElement | null>,
): UseLightboxAnimationResult {
  const lbOpen = useSliderStore((state) => state.lbOpen);
  const lbIndex = useSliderStore((state) => state.lbIndex);
  const setActiveIndex = useSliderStore((state) => state.setActiveIndex);
  const setLbIndex = useSliderStore((state) => state.setLbIndex);
  const setLbOpen = useSliderStore((state) => state.setLbOpen);

  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const crossLeftRef = useRef<HTMLDivElement | null>(null);
  const crossRightRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const counterRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const phaseRef = useRef<LightboxPhase>("idle");
  const currentIndexRef = useRef(lbIndex);

  const uiTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const mainTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const lastNavAtRef = useRef(0);
  const crossRotationRef = useRef<[number, number]>([0, 0]);
  const preloadedRef = useRef<Set<string>>(new Set());

  const getOuterCrosshair = useCallback((): HTMLElement | null => {
    return (
      outerCrosshairRef?.current ??
      (typeof document !== "undefined" ? document.getElementById("crosshair") : null)
    );
  }, [outerCrosshairRef]);

  const releaseWillChange = useCallback((...targets: Array<Element | null | undefined>) => {
    const valid = targets.filter((t): t is Element => Boolean(t));
    if (valid.length) gsap.set(valid, { willChange: "auto" });
  }, []);

  const preloadAllImages = useCallback(() => {
    works.forEach((work) => {
      if (!work || preloadedRef.current.has(work.src)) return;
      preloadedRef.current.add(work.src);
      const preloadImg = new Image();
      preloadImg.src = work.src;
    });
  }, []);

  useEffect(() => {
    preloadAllImages();
  }, [preloadAllImages]);

  const getUITargets = useCallback(
    () =>
      asElements(
        overlayRef.current,
        crossLeftRef.current,
        crossRightRef.current,
        titleRef.current,
        labelRef.current,
        counterRef.current,
        closeRef.current,
      ),
    [],
  );

  const stopUI = useCallback(() => {
    uiTimelineRef.current?.kill();
    uiTimelineRef.current = null;
    const targets = getUITargets();
    if (targets.length) gsap.killTweensOf(targets);
  }, [getUITargets]);

  const createUITimeline = useCallback(() => {
    stopUI();
    const timeline = gsap.timeline();
    uiTimelineRef.current = timeline;
    return timeline;
  }, [stopUI]);

  const writeInfo = useCallback((index: number) => {
    const work = works[index];
    if (!work) return;
    if (titleRef.current) titleRef.current.textContent = work.title;
    if (labelRef.current) labelRef.current.textContent = work.label;
    if (counterRef.current) {
      counterRef.current.textContent = `${String(index + 1).padStart(2, "0")} — ${String(
        works.length,
      ).padStart(2, "0")}`;
    }
  }, []);

  const resetVisuals = useCallback(() => {
    const lightbox = lightboxRef.current;
    if (!lightbox) return;

    crossRotationRef.current = [0, 0];

    gsap.set(lightbox, {
      autoAlpha: 0,
      pointerEvents: "none",
      willChange: "auto",
      left: 0,
      top: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    });
    gsap.set(overlayRef.current, { autoAlpha: 0 });
    gsap.set([crossLeftRef.current, crossRightRef.current], {
      autoAlpha: 0,
      yPercent: -50,
      scale: 0.5,
      rotation: 0,
    });
    gsap.set(titleRef.current, { autoAlpha: 0, xPercent: -50, yPercent: -50, y: 34 });
    gsap.set([labelRef.current, counterRef.current], { autoAlpha: 0, xPercent: -50, y: 28 });
    gsap.set(closeRef.current, { autoAlpha: 0, y: 10 });

    const outerCrosshair = getOuterCrosshair();
    if (outerCrosshair && phaseRef.current === "idle") {
      gsap.set(outerCrosshair, { autoAlpha: 1, scale: 1, xPercent: -50, yPercent: -50 });
    }
  }, [getOuterCrosshair]);

  const syncGalleryToIndex = useCallback(
    (index: number, offset?: number | null) => {
      window.dispatchEvent(new CustomEvent(GALLERY_SNAP_EVENT, { detail: { index, offset } }));
      setActiveIndex(index);
    },
    [setActiveIndex],
  );

  const navigateTo = useCallback(
    (nextIndex: number, direction: 1 | -1) => {
      if (phaseRef.current === "idle" || phaseRef.current === "closing") return;

      const now = performance.now();
      if (now - lastNavAtRef.current < NAV_LOCK_MS) return;

      const currentIndex = currentIndexRef.current;
      if (nextIndex === currentIndex) return;
      lastNavAtRef.current = now;

      phaseRef.current = "sliding";
      currentIndexRef.current = nextIndex;
      setLbIndex(nextIndex, direction);
      setActiveIndex(nextIndex);
      syncGalleryToIndex(nextIndex);

      preloadAllImages();

      const uiTl = createUITimeline();
      const text = asElements(titleRef.current, labelRef.current, counterRef.current);
      const crosses = asElements(crossLeftRef.current, crossRightRef.current);

      crossRotationRef.current = [
        crossRotationRef.current[0] + direction * 90,
        crossRotationRef.current[1] + direction * 90,
      ];
      const [leftTarget, rightTarget] = crossRotationRef.current;

      if (text.length) {
        uiTl.to(
          text,
          { autoAlpha: 0, y: -36 * direction, duration: 0.28, stagger: 0.04, ease: "power2.in" },
          0,
        );
      }
      if (crosses.length) {
        uiTl.to(crossLeftRef.current, { rotation: leftTarget, duration: 0.74, ease: "power4.out" }, 0);
        uiTl.to(crossRightRef.current, { rotation: rightTarget, duration: 0.74, ease: "power4.out" }, 0);
      }

      uiTl.call(() => writeInfo(nextIndex), [], 0.24);

      if (text.length) {
        uiTl
          .set(text, { autoAlpha: 0, y: 36 * direction }, 0.24)
          .to(text, { autoAlpha: 1, y: 0, duration: 0.48, stagger: 0.06, ease: "power3.out" }, 0.32);
      }

      uiTl.eventCallback("onComplete", () => {
        phaseRef.current = "open";
        uiTimelineRef.current = null;
      });
    },
    [createUITimeline, preloadAllImages, setActiveIndex, setLbIndex, syncGalleryToIndex, writeInfo],
  );

  const goToIndex = useCallback(
    (index: number) => {
      const currentIndex = currentIndexRef.current;
      if (index === currentIndex) return;
      const direction: 1 | -1 = index > currentIndex ? 1 : -1;
      navigateTo(index, direction);
    },
    [navigateTo],
  );

  const goToDirection = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = currentIndexRef.current;
      const nextIndex = (currentIndex + direction + works.length) % works.length;
      navigateTo(nextIndex, direction);
    },
    [navigateTo],
  );

  const openLightbox = useCallback(
    (index: number) => {
      if (phaseRef.current === "open" || phaseRef.current === "sliding") {
        goToIndex(index);
        return;
      }
      setActiveIndex(index);
      setLbOpen(true);
      setLbIndex(index, 1);

      const lightbox = lightboxRef.current;
      if (!lightbox || !works[index]) return;

      mainTimelineRef.current?.kill();
      stopUI();

      const text = asElements(titleRef.current, labelRef.current, counterRef.current);
      const crosses = asElements(crossLeftRef.current, crossRightRef.current);
      const outerCrosshair = getOuterCrosshair();

      phaseRef.current = "opening";
      currentIndexRef.current = index;
      crossRotationRef.current = [0, 0];

      writeInfo(index);
      preloadAllImages();

      gsap.set(lightbox, {
        autoAlpha: 1,
        pointerEvents: "auto",
        force3D: true,
        left: 0,
        top: 0,
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        scale: 1,
        rotation: 0,
      });

      gsap.set(overlayRef.current, { autoAlpha: 0 });
      gsap.set(titleRef.current, { autoAlpha: 0, xPercent: -50, yPercent: -50, y: 34 });
      gsap.set([labelRef.current, counterRef.current], { autoAlpha: 0, xPercent: -50, y: 28 });
      gsap.set(crosses, { autoAlpha: 0, yPercent: -50, scale: 0, rotation: 0 });
      gsap.set(closeRef.current, { autoAlpha: 0, y: 10 });

      const tl = gsap.timeline({
        onComplete: () => {
          phaseRef.current = "open";
          releaseWillChange(lightbox);
        },
      });
      mainTimelineRef.current = tl;

      // Outer crosshair shrinks down neatly to scale: 0 simultaneously as 2 lightbox inner crosshairs appear
      if (outerCrosshair) {
        tl.to(
          outerCrosshair,
          { scale: 0, autoAlpha: 0, xPercent: -50, yPercent: -50, duration: 0.35, ease: "expo.out" },
          0.1,
        );
      }

      tl.to(overlayRef.current, { autoAlpha: 1, duration: 0.36, ease: "power2.out" }, 0.2);

      if (text.length) {
        tl.to(text, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07, ease: "power3.out" }, 0.3);
      }
      if (crosses.length) {
        tl.fromTo(
          crosses,
          { autoAlpha: 0, scale: 0, yPercent: -50, rotation: 0 },
          { autoAlpha: 1, scale: 1, duration: 0.55, stagger: 0.06, ease: "expo.out" },
          0.1,
        );
      }
      tl.to(closeRef.current, { autoAlpha: 1, y: 0, duration: 0.36, ease: "power3.out" }, 0.4);
    },
    [getOuterCrosshair, goToIndex, preloadAllImages, releaseWillChange, setActiveIndex, setLbIndex, setLbOpen, stopUI, writeInfo],
  );

  const closeLightbox = useCallback(() => {
    if (phaseRef.current === "idle" || phaseRef.current === "closing") return;

    const lightbox = lightboxRef.current;
    if (!lightbox) return;

    mainTimelineRef.current?.kill();

    const index = currentIndexRef.current;
    const text = asElements(titleRef.current, labelRef.current, counterRef.current);
    const crosses = asElements(crossLeftRef.current, crossRightRef.current);
    const outerCrosshair = getOuterCrosshair();
    const fadeTargets = asElements(...text, ...crosses, closeRef.current);

    phaseRef.current = "closing";
    setLbOpen(false);

    syncGalleryToIndex(index);
    stopUI();

    const tl = gsap.timeline({
      onComplete: () => {
        releaseWillChange(lightbox);
        resetVisuals();
        phaseRef.current = "idle";
      },
    });
    mainTimelineRef.current = tl;

    if (text.length) {
      tl.to(text, { autoAlpha: 0, y: -16, duration: 0.18, stagger: 0.02, ease: "power2.in" }, 0);
    }
    const restFade = fadeTargets.filter((t) => !text.includes(t));
    if (restFade.length) {
      tl.to(restFade, { autoAlpha: 0, scale: 0.5, duration: 0.18, stagger: 0.03, ease: "power2.in" }, 0);
    }

    // Outer crosshair expands back from scale: 0 -> 1 without fade (autoAlpha: 1) using expo.out ease
    if (outerCrosshair) {
      gsap.set(outerCrosshair, { autoAlpha: 1 });
      tl.fromTo(
        outerCrosshair,
        { scale: 0, xPercent: -50, yPercent: -50 },
        { scale: 1, xPercent: -50, yPercent: -50, duration: 0.95, ease: "expo.out" },
        0.1,
      );
    }

    tl.to(overlayRef.current, { autoAlpha: 0, duration: 0.2, ease: "power2.in" }, 0);
    tl.to(lightbox, { autoAlpha: 0, duration: 0.25, ease: "power2.in" }, 0.1);
  }, [getOuterCrosshair, releaseWillChange, resetVisuals, setLbOpen, stopUI, syncGalleryToIndex]);

  // Landing intro animation for outer gallery crosshair (scale pop with expo.out)
  useLayoutEffect(() => {
    const outerCrosshair = getOuterCrosshair();
    if (!outerCrosshair) return;

    gsap.set(outerCrosshair, { autoAlpha: 1 });
    gsap.fromTo(
      outerCrosshair,
      { scale: 0, xPercent: -50, yPercent: -50 },
      {
        scale: 1,
        xPercent: -50,
        yPercent: -50,
        duration: 0.95,
        ease: "expo.out",
        delay: 0.1,
      },
    );
  }, [getOuterCrosshair]);

  useLayoutEffect(() => {
    const lightbox = lightboxRef.current;
    if (!lightbox) return;
    const ctx = gsap.context(() => resetVisuals(), lightbox);
    return () => {
      stopUI();
      mainTimelineRef.current?.kill();
      ctx.revert();
    };
  }, [resetVisuals, stopUI]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current === "idle") return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowRight") goToDirection(1);
      if (event.key === "ArrowLeft") goToDirection(-1);
    };
    const onWheel = (event: WheelEvent) => {
      if (phaseRef.current === "idle" || event.deltaY <= WHEEL_CLOSE_THRESHOLD) return;
      closeLightbox();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("wheel", onWheel);
    };
  }, [closeLightbox, goToDirection]);

  const handleStageClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (phaseRef.current === "idle" || phaseRef.current === "closing") return;
      if ((event.target as HTMLElement).closest("#lightbox-close")) return;
      goToDirection(event.clientX > window.innerWidth / 2 ? 1 : -1);
    },
    [goToDirection],
  );

  return {
    lightboxRef,
    overlayRef,
    crossLeftRef,
    crossRightRef,
    titleRef,
    labelRef,
    counterRef,
    closeRef,
    isOpen: lbOpen,
    openLightbox,
    goToIndex,
    goToDirection,
    closeLightbox,
    handleStageClick,
  };
}