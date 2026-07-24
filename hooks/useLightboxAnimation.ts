"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent, MutableRefObject } from "react";
import gsap from "gsap";
import { works } from "@/lib/works";
import { useSliderStore } from "@/store/useSliderStore";
import { useReducedMotion } from "./useReducedMotion";

const EXPAND_EASE = "expo.inOut";
const FULL_CLIP = "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)";
const MAX_STACKED_SLIDES = 3;
/**
 * Minimum gap between two `goTo` calls. This is intentionally short — the
 * design relies on rapid clicks stacking up to `MAX_STACKED_SLIDES` layered
 * slides — it only exists to swallow duplicate/auto-repeat events (a held
 * arrow key, a double-fired click) rather than to throttle intentional fast
 * navigation.
 */
const NAV_LOCK_MS = 120;
const WHEEL_CLOSE_THRESHOLD = 24;

export type LightboxPhase = "idle" | "opening" | "open" | "sliding" | "closing";

export interface SlideEntry {
  id: number;
  index: number;
  z: 1 | 2;
}

interface SlideDom {
  wrap: HTMLDivElement | null;
  img: HTMLImageElement | null;
}

interface GalleryRect {
  rect: DOMRect;
  objectPosition: string;
}

const asElements = (...nodes: Array<HTMLElement | null>): HTMLElement[] =>
  nodes.filter((node): node is HTMLElement => node !== null);

/** Cached scrollbar width — recomputed on resize, not on every open(). */
let cachedScrollbarWidth: number | null = null;
const getScrollbarWidth = () => {
  if (cachedScrollbarWidth === null) {
    cachedScrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  }
  return cachedScrollbarWidth;
};
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    cachedScrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  });
}

export interface UseLightboxAnimationResult {
  lightboxRef: MutableRefObject<HTMLDivElement | null>;
  stageRef: MutableRefObject<HTMLDivElement | null>;
  overlayRef: MutableRefObject<HTMLDivElement | null>;
  crossLeftRef: MutableRefObject<HTMLDivElement | null>;
  crossRightRef: MutableRefObject<HTMLDivElement | null>;
  titleRef: MutableRefObject<HTMLDivElement | null>;
  labelRef: MutableRefObject<HTMLDivElement | null>;
  counterRef: MutableRefObject<HTMLDivElement | null>;
  closeRef: MutableRefObject<HTMLButtonElement | null>;
  /** Slides currently mounted in the stage, oldest first. */
  slides: SlideEntry[];
  registerSlideWrap: (id: number) => (node: HTMLDivElement | null) => void;
  registerSlideImg: (id: number) => (node: HTMLImageElement | null) => void;
  isOpen: boolean;
  openLightbox: (index: number) => void;
  goTo: (direction: 1 | -1) => void;
  closeLightbox: () => void;
  handleStageClick: (event: MouseEvent<HTMLDivElement>) => void;
}

/**
 * Owns every piece of imperative GSAP/DOM state for the lightbox: the
 * open/close/slide timelines, the small stack of slide elements, and the
 * escape hatches (keyboard, wheel, gallery-sync) around it. The component
 * that consumes this hook stays a plain render of whatever `slides` holds.
 */
export function useLightboxAnimation(
): UseLightboxAnimationResult {
  const lbOpen = useSliderStore((state) => state.lbOpen);
  const lbIndex = useSliderStore((state) => state.lbIndex);
  const setActiveIndex = useSliderStore((state) => state.setActiveIndex);
  const setLbIndex = useSliderStore((state) => state.setLbIndex);
  const setLbOpen = useSliderStore((state) => state.setLbOpen);

  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const crossLeftRef = useRef<HTMLDivElement | null>(null);
  const crossRightRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const counterRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const [slides, setSlides] = useState<SlideEntry[]>([]);

  const phaseRef = useRef<LightboxPhase>("idle");
  const currentIndexRef = useRef(lbIndex);
  const wasOpenRef = useRef(false);
  const openSourceRectRef = useRef<GalleryRect | null>(null);
  const frontIdRef = useRef<number | null>(null);
  const slideSeqRef = useRef(0);
  const slideDomRef = useRef<Map<number, SlideDom>>(new Map());
  const uiTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const openTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const slideTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const closeTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const openTimelineSeqRef = useRef(0);
  const slideTimelineSeqRef = useRef(0);
  const closeTimelineSeqRef = useRef(0);
  const uiTimelineSeqRef = useRef(0);
  const lastNavAtRef = useRef(0);
  const crossRotationRef = useRef<[number, number]>([0, 0]);
  const preloadedRef = useRef<Set<string>>(new Set());
  const pendingOpenSlideRef = useRef<{ id: number; index: number } | null>(null);
  const pendingSlideRef = useRef<{ id: number; index: number; oldId: number | null; direction: 1 | -1 } | null>(null);

  const wrapCallbacksRef = useRef(new Map<number, (node: HTMLDivElement | null) => void>());
  const imgCallbacksRef = useRef(new Map<number, (node: HTMLImageElement | null) => void>());

  const cleanupIfDetached = useCallback((id: number) => {
    const entry = slideDomRef.current.get(id);
    if (entry && entry.wrap === null && entry.img === null) {
      slideDomRef.current.delete(id);
      wrapCallbacksRef.current.delete(id);
      imgCallbacksRef.current.delete(id);
    }
  }, []);

  const registerSlideWrap = useCallback(
    (id: number) => {
      let cb = wrapCallbacksRef.current.get(id);
      if (!cb) {
        cb = (node) => {
          const entry = slideDomRef.current.get(id) ?? { wrap: null, img: null };
          entry.wrap = node;
          slideDomRef.current.set(id, entry);
          if (node === null) cleanupIfDetached(id);
        };
        wrapCallbacksRef.current.set(id, cb);
      }
      return cb;
    },
    [cleanupIfDetached],
  );

  const registerSlideImg = useCallback(
    (id: number) => {
      let cb = imgCallbacksRef.current.get(id);
      if (!cb) {
        cb = (node) => {
          const entry = slideDomRef.current.get(id) ?? { wrap: null, img: null };
          entry.img = node;
          slideDomRef.current.set(id, entry);
          if (node === null) cleanupIfDetached(id);
        };
        imgCallbacksRef.current.set(id, cb);
      }
      return cb;
    },
    [cleanupIfDetached],
  );

  const releaseWillChange = useCallback((...targets: Array<Element | null | undefined>) => {
    const valid = targets.filter((t): t is Element => Boolean(t));
    if (valid.length) gsap.set(valid, { willChange: "auto" });
  }, []);

  const preloadNeighbors = useCallback((index: number) => {
    const neighbors = [works[(index + 1) % works.length], works[(index - 1 + works.length) % works.length]];
    neighbors.forEach((work) => {
      if (!work || preloadedRef.current.has(work.src)) return;
      preloadedRef.current.add(work.src);
      const preloadImg = new Image();
      preloadImg.src = work.src;
    });
  }, []);

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

  const startOpenAnimation = useCallback(
    (slideId: number, index: number) => {
      const lightbox = lightboxRef.current;
      const stage = stageRef.current;
      const dom = slideDomRef.current.get(slideId);
      const wrap = dom?.wrap ?? null;
      const img = dom?.img ?? null;
      if (!lightbox || !stage || !wrap || !img || !works[index]) return;

      openTimelineSeqRef.current += 1;
      const token = openTimelineSeqRef.current;
      openTimelineRef.current?.kill();
      stopUI();

      const source = openSourceRectRef.current;
      const rect = source?.rect;
      const startLeft = rect?.left ?? 0;
      const startTop = rect?.top ?? 0;
      const startWidth = rect?.width ?? window.innerWidth;
      const startHeight = rect?.height ?? window.innerHeight;
      const startCrop = source?.objectPosition ?? "50% 50%";
      const text = asElements(titleRef.current, labelRef.current, counterRef.current);
      const crosses = asElements(crossLeftRef.current, crossRightRef.current);

      preloadNeighbors(index);

      const work = works[index];
      if (work) {
        if (titleRef.current) titleRef.current.textContent = work.title;
        if (labelRef.current) labelRef.current.textContent = work.label;
        if (counterRef.current) {
          counterRef.current.textContent = `${String(index + 1).padStart(2, "0")} — ${String(
            works.length,
          ).padStart(2, "0")}`;
        }
      }

      gsap.set(lightbox, {
        autoAlpha: 1,
        pointerEvents: "auto",
        willChange: "left, top, width, height",
        left: startLeft,
        top: startTop,
        width: startWidth,
        height: startHeight,
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
      });
      gsap.set(wrap, { autoAlpha: 1, clipPath: FULL_CLIP, willChange: "clip-path, transform" });
      gsap.set(img, { autoAlpha: 1, objectPosition: startCrop, willChange: "transform" });
      gsap.set(overlayRef.current, { autoAlpha: 0 });
      gsap.set(titleRef.current, { autoAlpha: 0, xPercent: -50, yPercent: -50, y: 34 });
      gsap.set([labelRef.current, counterRef.current], { autoAlpha: 0, xPercent: -50, y: 28 });
      gsap.set(crosses, { autoAlpha: 0, yPercent: -50, scale: 0.86, rotation: 0 });
      gsap.set(closeRef.current, { autoAlpha: 0, y: 10 });

      const timeline = gsap.timeline({
        onComplete: () => {
          if (openTimelineSeqRef.current !== token) return;
          openTimelineRef.current = null;
          phaseRef.current = "open";
          releaseWillChange(lightbox, wrap, img);
          openSourceRectRef.current = null;
        },
      });
      openTimelineRef.current = timeline;

      if (reducedMotionRef.current) {
        gsap.set(lightbox, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
        gsap.set(img, { objectPosition: "50% 50%" });
        timeline.to([overlayRef.current, ...text, ...crosses, closeRef.current], {
          autoAlpha: 1,
          duration: 0.24,
          ease: "power2.out",
        }, 0);
        return;
      }

      timeline
        .to(
          lightbox,
          { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, duration: 0.94, ease: EXPAND_EASE },
          0,
        )
        .to(img, { objectPosition: "50% 50%", duration: 0.94, ease: EXPAND_EASE }, 0)
        .to(overlayRef.current, { autoAlpha: 1, duration: 0.36, ease: "power2.out" }, 0.54);

      if (text.length) {
        timeline.to(text, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07, ease: "power3.out" }, 0.68);
      }
      if (crosses.length) {
        timeline.to(crosses, { autoAlpha: 1, scale: 1, duration: 0.46, stagger: 0.06, ease: "power3.out" }, 0.74);
      }
      timeline.to(closeRef.current, { autoAlpha: 1, y: 0, duration: 0.36, ease: "power3.out" }, 0.78);
    },
    [preloadNeighbors, releaseWillChange, stopUI],
  );

  const startSlideAnimation = useCallback(
    (slideId: number, index: number, oldId: number | null, direction: 1 | -1) => {
      const stage = stageRef.current;
      const newDom = slideDomRef.current.get(slideId);
      const oldDom = oldId !== null ? slideDomRef.current.get(oldId) : undefined;
      const newWrap = newDom?.wrap ?? null;
      const newImg = newDom?.img ?? null;
      if (!stage || !newWrap || !newImg) return;

      slideTimelineSeqRef.current += 1;
      const token = slideTimelineSeqRef.current;
      slideTimelineRef.current?.kill();
      stopUI();

      preloadNeighbors(index);

      const startClip =
        direction > 0
          ? "polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)"
          : "polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)";

      gsap.set(newWrap, { autoAlpha: 1, clipPath: startClip, willChange: "clip-path" });
      gsap.set(newImg, {
        autoAlpha: 1,
        objectPosition: "50% 50%",
        x: reducedMotionRef.current ? 0 : direction * 300,
        y: 0,
        willChange: "transform",
      });

      if (oldDom?.img) {
        gsap.set(oldDom.img, { objectPosition: "50% 50%", x: 0, y: 0, willChange: "transform" });
      }

      const slideTimeline = gsap.timeline({
        onComplete: () => {
          if (slideTimelineSeqRef.current !== token) return;
          slideTimelineRef.current = null;
          releaseWillChange(newWrap, newImg, oldDom?.wrap, oldDom?.img);
          if (oldId !== null) {
            setSlides((prev) => prev.filter((s) => s.id !== oldId));
          }
        },
      });
      slideTimelineRef.current = slideTimeline;

      if (reducedMotionRef.current) {
        gsap.set(newWrap, { clipPath: FULL_CLIP, autoAlpha: 0 });
        slideTimeline.to(newWrap, { autoAlpha: 1, duration: 0.18, ease: "power1.out" }, 0);
        if (oldDom?.wrap) {
          slideTimeline.to(oldDom.wrap, { autoAlpha: 0, duration: 0.18, ease: "power1.out" }, 0);
        }
      } else {
        if (oldDom?.img) {
          slideTimeline.to(oldDom.img, { x: -300 * direction, duration: 0.74, ease: "power4.out" }, 0);
        }
        slideTimeline
          .to(newWrap, { clipPath: FULL_CLIP, duration: 0.74, ease: "power4.out" }, 0)
          .to(newImg, { x: 0, duration: 0.74, ease: "power4.out" }, 0);
      }

      const uiToken = ++uiTimelineSeqRef.current;
      const uiTimeline = createUITimeline();
      const text = asElements(titleRef.current, labelRef.current, counterRef.current);
      const crosses = asElements(crossLeftRef.current, crossRightRef.current);

      crossRotationRef.current = [
        crossRotationRef.current[0] + direction * 90,
        crossRotationRef.current[1] + direction * 90,
      ];
      const [leftTarget, rightTarget] = crossRotationRef.current;

      if (reducedMotionRef.current) {
        if (text.length) {
          uiTimeline.to(text, { autoAlpha: 0, duration: 0.12, ease: "power1.in" }, 0);
        }
        if (crosses.length) {
          gsap.set(crossLeftRef.current, { rotation: leftTarget });
          gsap.set(crossRightRef.current, { rotation: rightTarget });
        }
        uiTimeline.call(() => {
          const nextWork = works[index];
          if (nextWork) {
            if (titleRef.current) titleRef.current.textContent = nextWork.title;
            if (labelRef.current) labelRef.current.textContent = nextWork.label;
            if (counterRef.current) {
              counterRef.current.textContent = `${String(index + 1).padStart(2, "0")} — ${String(
                works.length,
              ).padStart(2, "0")}`;
            }
          }
        }, [], 0.12);
        if (text.length) {
          uiTimeline.to(text, { autoAlpha: 1, duration: 0.12, ease: "power1.out" }, 0.12);
        }
      } else {
        if (text.length) {
          uiTimeline.to(
            text,
            { autoAlpha: 0, y: -36 * direction, duration: 0.28, stagger: 0.04, ease: "power2.in" },
            0,
          );
        }
        if (crosses.length) {
          uiTimeline.to(crossLeftRef.current, { rotation: leftTarget, duration: 0.74, ease: "power4.out" }, 0);
          uiTimeline.to(crossRightRef.current, { rotation: rightTarget, duration: 0.74, ease: "power4.out" }, 0);
        }

        uiTimeline.call(() => {
          const nextWork = works[index];
          if (nextWork) {
            if (titleRef.current) titleRef.current.textContent = nextWork.title;
            if (labelRef.current) labelRef.current.textContent = nextWork.label;
            if (counterRef.current) {
              counterRef.current.textContent = `${String(index + 1).padStart(2, "0")} — ${String(
                works.length,
              ).padStart(2, "0")}`;
            }
          }
        }, [], 0.24);

        if (text.length) {
          uiTimeline
            .set(text, { autoAlpha: 0, y: 36 * direction }, 0.24)
            .to(text, { autoAlpha: 1, y: 0, duration: 0.48, stagger: 0.06, ease: "power3.out" }, 0.32);
        }
      }

      uiTimeline.eventCallback("onComplete", () => {
        if (uiTimelineSeqRef.current !== uiToken) return;
        uiTimelineRef.current = null;
        phaseRef.current = "open";
      });
    },
    [createUITimeline, preloadNeighbors, releaseWillChange],
  );

  const cancelOpenTimeline = useCallback(() => {
    openTimelineSeqRef.current += 1;
    openTimelineRef.current?.kill();
    openTimelineRef.current = null;
  }, []);

  const cancelSlideTimeline = useCallback(() => {
    slideTimelineSeqRef.current += 1;
    slideTimelineRef.current?.kill();
    slideTimelineRef.current = null;
  }, []);

  const cancelCloseTimeline = useCallback(() => {
    closeTimelineSeqRef.current += 1;
    closeTimelineRef.current?.kill();
    closeTimelineRef.current = null;
  }, []);

  const cancelAllTimelines = useCallback(() => {
    cancelOpenTimeline();
    cancelSlideTimeline();
    cancelCloseTimeline();
    uiTimelineSeqRef.current += 1;
    uiTimelineRef.current?.kill();
    uiTimelineRef.current = null;
  }, [cancelCloseTimeline, cancelOpenTimeline, cancelSlideTimeline]);

  /** @param index Index into `works` whose gallery-grid geometry we want to read. */
  const readGalleryItem = useCallback((index: number): GalleryRect | null => {
    const wrap = document.querySelector<HTMLDivElement>(
      `.image-wrap[data-work-index="${index}"]`,
    );
    const image = wrap?.querySelector<HTMLImageElement>(".image");
    if (!wrap || !image) return null;
    return {
      rect: wrap.getBoundingClientRect(),
      objectPosition: image.style.objectPosition || "50% 50%",
    };
  }, []);

  const readGalleryOffset = useCallback((index: number): number | null => {
    const wrap = document.querySelector<HTMLDivElement>(`.image-wrap[data-work-index="${index}"]`);
    if (!wrap) return null;
    return wrap.getBoundingClientRect().left - wrap.offsetLeft - window.innerWidth / 2;
  }, []);

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

    document.body.style.overflow = "";
    document.body.style.paddingRight = "";

    setSlides([]);
    frontIdRef.current = null;
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
      scale: 0.86,
      rotation: 0,
    });
    gsap.set(titleRef.current, { autoAlpha: 0, xPercent: -50, yPercent: -50, y: 34 });
    gsap.set([labelRef.current, counterRef.current], { autoAlpha: 0, xPercent: -50, y: 28 });
    gsap.set(closeRef.current, { autoAlpha: 0, y: 10 });
  }, []);

  const settleUI = useCallback(() => {
    const text = asElements(titleRef.current, labelRef.current, counterRef.current);
    const crosses = asElements(crossLeftRef.current, crossRightRef.current);
    const lightbox = lightboxRef.current;
    const frontId = frontIdRef.current;
    const frontImg = frontId !== null ? slideDomRef.current.get(frontId)?.img ?? null : null;

    if (lightbox) {
      gsap.set(lightbox, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
    }
    if (frontImg) {
      gsap.set(frontImg, { objectPosition: "50% 50%", x: 0, y: 0 });
    }

    writeInfo(currentIndexRef.current);
    gsap.set(overlayRef.current, { autoAlpha: 1 });
    gsap.set(text, { autoAlpha: 1, y: 0 });
    gsap.set(crosses, { autoAlpha: 1, yPercent: -50, scale: 1 });
    gsap.set(closeRef.current, { autoAlpha: 1, y: 0 });
  }, [writeInfo]);

  const openLightbox = useCallback(
    (index: number) => {
      const lightbox = lightboxRef.current;
      const stage = stageRef.current;
      if (!lightbox || !stage || !works[index]) return;

      cancelAllTimelines();

      const source = readGalleryItem(index);
      openSourceRectRef.current = source;
      const scrollbarWidth = getScrollbarWidth();

      document.body.style.overflow = "hidden";
      document.body.style.paddingRight = scrollbarWidth > 0 ? `${scrollbarWidth}px` : "";

      wasOpenRef.current = true;
      phaseRef.current = "opening";
      currentIndexRef.current = index;
      setActiveIndex(index);
      setLbOpen(true);
      setLbIndex(index);
      crossRotationRef.current = [0, 0];

      const id = slideSeqRef.current++;
      frontIdRef.current = id;
      pendingOpenSlideRef.current = { id, index };
      setSlides([{ id, index, z: 2 }]);
    },
    [cancelAllTimelines, readGalleryItem, setActiveIndex, setLbIndex, setLbOpen],
  );

  const goTo = useCallback(
    (direction: 1 | -1) => {
      if (phaseRef.current === "idle" || phaseRef.current === "closing") return;

      const now = performance.now();
      if (now - lastNavAtRef.current < NAV_LOCK_MS) return;
      lastNavAtRef.current = now;

      const stage = stageRef.current;
      if (!stage) return;

      cancelAllTimelines();

      const currentIndex = currentIndexRef.current;
      const nextIndex = (currentIndex + direction + works.length) % works.length;
      const oldId = frontIdRef.current;
      const newId = slideSeqRef.current++;

      phaseRef.current = "sliding";
      currentIndexRef.current = nextIndex;
      frontIdRef.current = newId;
      setLbIndex(nextIndex);
      setActiveIndex(nextIndex);

      pendingSlideRef.current = {
        id: newId,
        index: nextIndex,
        oldId,
        direction,
      };

      setSlides((prev) => {
        const withNew: SlideEntry[] = [
          ...prev.map((s) => ({ ...s, z: 1 as const })),
          { id: newId, index: nextIndex, z: 2 as const },
        ];
        return withNew.length > MAX_STACKED_SLIDES
          ? withNew.slice(withNew.length - MAX_STACKED_SLIDES)
          : withNew;
      });
    },
    [cancelAllTimelines, setActiveIndex, setLbIndex],
  );

  const closeLightbox = useCallback(() => {
    if (phaseRef.current === "idle" || phaseRef.current === "closing") return;

    const lightbox = lightboxRef.current;
    const frontId = frontIdRef.current;
    const frontDom = frontId !== null ? slideDomRef.current.get(frontId) : undefined;
    const frontImg = frontDom?.img ?? null;
    if (!lightbox || !frontImg) return;

    cancelAllTimelines();

    const index = currentIndexRef.current;
    const text = asElements(titleRef.current, labelRef.current, counterRef.current);
    const crosses = asElements(crossLeftRef.current, crossRightRef.current);
    const fadeTargets = asElements(...text, ...crosses, closeRef.current);

    phaseRef.current = "closing";
    wasOpenRef.current = false;
    setLbOpen(false);

    const destination = openSourceRectRef.current ?? readGalleryItem(index);

    stopUI();
    const allSlideEls = Array.from(slideDomRef.current.values()).flatMap((d) => asElements(d.wrap, d.img));
    if (allSlideEls.length) gsap.killTweensOf(allSlideEls);

    const token = ++closeTimelineSeqRef.current;
    const tl = gsap.timeline({
      onComplete: () => {
        if (closeTimelineSeqRef.current !== token) return;
        closeTimelineRef.current = null;
        resetVisuals();
        phaseRef.current = "idle";
      },
    });
    closeTimelineRef.current = tl;

    if (reducedMotionRef.current) {
      if (destination) {
        gsap.set(lightbox, {
          left: destination.rect.left,
          top: destination.rect.top,
          width: destination.rect.width,
          height: destination.rect.height,
        });
        gsap.set(frontImg, { objectPosition: destination.objectPosition });
      }
      tl.to([overlayRef.current, ...fadeTargets], { autoAlpha: 0, duration: 0.16, ease: "power2.out" }, 0).to(
        lightbox,
        { autoAlpha: 0, duration: 0.16, ease: "power2.out" },
        0,
      );
      return;
    }

    if (text.length) {
      tl.to(text, { autoAlpha: 0, y: -16, duration: 0.18, stagger: 0.02, ease: "power2.in" }, 0);
    }
    const restFade = fadeTargets.filter((t) => !text.includes(t));
    if (restFade.length) {
      tl.to(restFade, { autoAlpha: 0, scale: 0.9, duration: 0.18, stagger: 0.03, ease: "power2.in" }, 0);
    }
    tl.to(overlayRef.current, { autoAlpha: 0, duration: 0.22, ease: "power2.out" }, 0);

    if (destination) {
      tl.to(
        lightbox,
        {
          left: destination.rect.left,
          top: destination.rect.top,
          width: destination.rect.width,
          height: destination.rect.height,
          duration: 0.78,
          ease: EXPAND_EASE,
        },
        0.1,
      ).to(frontImg, { objectPosition: destination.objectPosition, duration: 0.78, ease: EXPAND_EASE }, 0.1);
    } else {
      // Smoother fallback than an abrupt cut: fade + settle toward center.
      tl.to(
        lightbox,
        { autoAlpha: 0, scale: 0.92, transformOrigin: "50% 50%", duration: 0.34, ease: "power2.out" },
        0.1,
      );
    }
  }, [cancelAllTimelines, readGalleryItem, resetVisuals, setLbOpen, stopUI]);

  // One-time visual reset on mount; gsap.context handles teardown on unmount.
  useLayoutEffect(() => {
    const lightbox = lightboxRef.current;
    if (!lightbox) return;
    const ctx = gsap.context(() => resetVisuals(), lightbox);
    return () => {
      stopUI();
      cancelAllTimelines();
      ctx.revert();
    };
  }, [cancelAllTimelines, resetVisuals, stopUI]);

  useLayoutEffect(() => {
    if (phaseRef.current === "opening" && pendingOpenSlideRef.current) {
      const pending = pendingOpenSlideRef.current;
      const dom = slideDomRef.current.get(pending.id);
      if (dom?.wrap && dom?.img) {
        pendingOpenSlideRef.current = null;
        startOpenAnimation(pending.id, pending.index);
        return;
      }
    }

    if (phaseRef.current === "sliding" && pendingSlideRef.current) {
      const pending = pendingSlideRef.current;
      const dom = slideDomRef.current.get(pending.id);
      if (dom?.wrap && dom?.img) {
        pendingSlideRef.current = null;
        startSlideAnimation(pending.id, pending.index, pending.oldId, pending.direction);
      }
    }
  }, [slides, startOpenAnimation, startSlideAnimation]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current === "idle") return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowRight") goTo(1);
      if (event.key === "ArrowLeft") goTo(-1);
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
  }, [closeLightbox, goTo]);

  const handleStageClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (phaseRef.current === "idle" || phaseRef.current === "closing") return;
      if ((event.target as HTMLElement).closest("#lightbox-close")) return;
      goTo(event.clientX > window.innerWidth / 2 ? 1 : -1);
    },
    [goTo],
  );

  return {
    lightboxRef,
    stageRef,
    overlayRef,
    crossLeftRef,
    crossRightRef,
    titleRef,
    labelRef,
    counterRef,
    closeRef,
    slides,
    registerSlideWrap,
    registerSlideImg,
    isOpen: lbOpen,
    openLightbox,
    goTo,
    closeLightbox,
    handleStageClick,
  };
}