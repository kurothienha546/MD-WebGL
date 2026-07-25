"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent, MutableRefObject } from "react";
import { flushSync } from "react-dom";
import gsap from "gsap";
import { works } from "@/lib/works";
import { useSliderStore } from "@/store/useSliderStore";
import { useReducedMotion } from "./useReducedMotion";

const GALLERY_SNAP_EVENT = "gallery:snap-to-index";
const EXPAND_EASE = "expo.out";
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

const getScrollbarWidth = () =>
  typeof window !== "undefined" ? window.innerWidth - document.documentElement.clientWidth : 0;

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
  snapRef: MutableRefObject<number | null>,
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
  const restoreOffsetRef = useRef<number | null>(null);
  const frontIdRef = useRef<number | null>(null);
  const slideSeqRef = useRef(0);
  const slideDomRef = useRef<Map<number, SlideDom>>(new Map());
  const uiTimelineRef = useRef<gsap.core.Timeline | null>(null);
  /**
   * Whichever timeline is currently animating the lightbox's own geometry
   * (open's expand-from-source, or close's collapse-to-destination). Both
   * openLightbox and closeLightbox kill this before creating their own —
   * without that, interrupting an in-progress open with an immediate close
   * (e.g. click, then Escape before the 0.94s expand finishes) leaves BOTH
   * timelines animating left/top/width/height on the same element at once,
   * and the older one's onComplete still fires and stomps phaseRef back to
   * "open" mid-close. That's what was producing the wrong landing rect.
   */
  const mainTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const lastNavAtRef = useRef(0);
  const crossRotationRef = useRef<[number, number]>([0, 0]);
  const preloadedRef = useRef<Set<string>>(new Set());

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
    const wrap = document.querySelector<HTMLDivElement>(
      `.image-wrap[data-work-index="${index}"]`,
    );
    const first = document.querySelector<HTMLDivElement>(
      `.image-wrap[data-work-index="0"]`,
    );
    if (!wrap || !first) return null;
    return -(wrap.offsetLeft + first.offsetWidth / 2);
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

  const settleGeometry = useCallback(() => {
    const lightbox = lightboxRef.current;
    const frontId = frontIdRef.current;
    const frontImg =
      frontId !== null ? slideDomRef.current.get(frontId)?.img ?? null : null;

    if (lightbox) {
      gsap.set(lightbox, {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }
    if (frontImg) {
      gsap.set(frontImg, { objectPosition: "50% 50%", x: 0, y: 0 });
    }
  }, []);

  const syncGalleryToIndex = useCallback(
    (index: number, offset?: number | null) => {
      const target = document.querySelector<HTMLDivElement>(
        `.image-wrap[data-work-index="${index}"]`,
      );
      const first = document.querySelector<HTMLDivElement>('.image-wrap[data-work-index="0"]');
      if (!target || !first) return;

      gsap.killTweensOf(target);
      gsap.set(target, { x: 0, y: 0, scale: 1 });

      const nextOffset = offset ?? -(target.offsetLeft + first.offsetWidth / 2);
      snapRef.current = nextOffset;
      window.dispatchEvent(new CustomEvent(GALLERY_SNAP_EVENT, { detail: { index, offset: nextOffset } }));
      setActiveIndex(index);
    },
    [setActiveIndex, snapRef],
  );

  const openLightbox = useCallback(
    (index: number) => {
      wasOpenRef.current = true;
      restoreOffsetRef.current = readGalleryOffset(index);
      setActiveIndex(index);
      setLbOpen(true);
      setLbIndex(index);

      const lightbox = lightboxRef.current;
      const stage = stageRef.current;
      if (!lightbox || !stage || !works[index]) return;

      // Interrupting a close (or a previous open) must not leave two
      // timelines fighting over the lightbox's left/top/width/height.
      mainTimelineRef.current?.kill();
      stopUI();

      const source = readGalleryItem(index);
      const rect = source?.rect;
      const startLeft = rect?.left ?? 0;
      const startTop = rect?.top ?? 0;
      const startWidth = rect?.width ?? window.innerWidth;
      const startHeight = rect?.height ?? window.innerHeight;
      const startCrop = source?.objectPosition ?? "50% 50%";
      const text = asElements(titleRef.current, labelRef.current, counterRef.current);
      const crosses = asElements(crossLeftRef.current, crossRightRef.current);
      const scrollbarWidth = getScrollbarWidth();

      document.body.style.overflow = "hidden";
      document.body.style.paddingRight = scrollbarWidth > 0 ? `${scrollbarWidth}px` : "";

      phaseRef.current = "opening";
      currentIndexRef.current = index;
      crossRotationRef.current = [0, 0];

      const id = slideSeqRef.current++;
      frontIdRef.current = id;

      // Mount the first slide synchronously so GSAP can read/animate the
      // real DOM node within this same tick, instead of manufacturing it
      // with document.createElement.
      flushSync(() => {
        setSlides([{ id, index, z: 2 }]);
      });

      const dom = slideDomRef.current.get(id);
      const wrap = dom?.wrap ?? null;
      const img = dom?.img ?? null;
      if (!wrap || !img) return;

      writeInfo(index);
      preloadNeighbors(index);

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

      if (reducedMotionRef.current) {
        gsap.set(lightbox, { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight });
        gsap.set(img, { objectPosition: "50% 50%" });
        const tl = gsap.timeline({
          onComplete: () => {
            phaseRef.current = "open";
            releaseWillChange(lightbox, wrap, img);
          },
        });
        mainTimelineRef.current = tl;
        tl.to([overlayRef.current, ...text, ...crosses, closeRef.current], {
          autoAlpha: 1,
          duration: 0.24,
          ease: "power2.out",
        }, 0);
        return;
      }

      const tl = gsap.timeline({
        onComplete: () => {
          phaseRef.current = "open";
          releaseWillChange(lightbox, wrap, img);
        },
      });
      mainTimelineRef.current = tl;

      tl.to(
        lightbox,
        { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight, duration: 0.94, ease: EXPAND_EASE },
        0,
      )
        .to(img, { objectPosition: "50% 50%", duration: 0.94, ease: EXPAND_EASE }, 0)
        .to(overlayRef.current, { autoAlpha: 1, duration: 0.36, ease: "power2.out" }, 0.54);

      if (text.length) {
        tl.to(text, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07, ease: "power3.out" }, 0.68);
      }
      if (crosses.length) {
        tl.to(crosses, { autoAlpha: 1, scale: 1, duration: 0.46, stagger: 0.06, ease: "power3.out" }, 0.74);
      }
      tl.to(closeRef.current, { autoAlpha: 1, y: 0, duration: 0.36, ease: "power3.out" }, 0.78);
    },
    [preloadNeighbors, readGalleryItem, readGalleryOffset, releaseWillChange, stopUI, writeInfo],
  );

  const goTo = useCallback(
    (direction: 1 | -1) => {
      if (phaseRef.current === "idle" || phaseRef.current === "closing") return;

      const now = performance.now();
      if (now - lastNavAtRef.current < NAV_LOCK_MS) return;
      lastNavAtRef.current = now;

      const stage = stageRef.current;
      if (!stage) return;

      const currentIndex = currentIndexRef.current;
      const nextIndex = (currentIndex + direction + works.length) % works.length;
      const oldId = frontIdRef.current;
      const newId = slideSeqRef.current++;

      phaseRef.current = "sliding";
      currentIndexRef.current = nextIndex;
      frontIdRef.current = newId;
      setLbIndex(nextIndex);
      setActiveIndex(nextIndex);

      // Mount the new slide synchronously (so it's ready to animate this
      // tick) and trim the stack down to MAX_STACKED_SLIDES.
      flushSync(() => {
        setSlides((prev) => {
          const withNew: SlideEntry[] = [
            ...prev.map((s) => ({ ...s, z: 1 as const })),
            { id: newId, index: nextIndex, z: 2 as const },
          ];
          return withNew.length > MAX_STACKED_SLIDES
            ? withNew.slice(withNew.length - MAX_STACKED_SLIDES)
            : withNew;
        });
      });

      const newDom = slideDomRef.current.get(newId);
      const oldDom = oldId !== null ? slideDomRef.current.get(oldId) : undefined;
      const newWrap = newDom?.wrap ?? null;
      const newImg = newDom?.img ?? null;
      if (!newWrap || !newImg) return;

      preloadNeighbors(nextIndex);

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

      const slideTl = gsap.timeline({
        onComplete: () => {
          releaseWillChange(newWrap, newImg, oldDom?.wrap, oldDom?.img);
          if (oldId !== null) {
            setSlides((prev) => prev.filter((s) => s.id !== oldId));
          }
        },
      });

      if (reducedMotionRef.current) {
        gsap.set(newWrap, { clipPath: FULL_CLIP, autoAlpha: 0 });
        slideTl.to(newWrap, { autoAlpha: 1, duration: 0.18, ease: "power1.out" }, 0);
        if (oldDom?.wrap) {
          slideTl.to(oldDom.wrap, { autoAlpha: 0, duration: 0.18, ease: "power1.out" }, 0);
        }
      } else {
        if (oldDom?.img) {
          slideTl.to(oldDom.img, { x: -300 * direction, duration: 0.74, ease: "power4.out" }, 0);
        }
        slideTl
          .to(newWrap, { clipPath: FULL_CLIP, duration: 0.74, ease: "power4.out" }, 0)
          .to(newImg, { x: 0, duration: 0.74, ease: "power4.out" }, 0);
      }

      const uiTl = createUITimeline();
      const text = asElements(titleRef.current, labelRef.current, counterRef.current);
      const crosses = asElements(crossLeftRef.current, crossRightRef.current);

      // Exact +/-90deg accumulation — never re-derived from the rendered
      // rotation — so repeated direction changes can't drift off-axis.
      crossRotationRef.current = [
        crossRotationRef.current[0] + direction * 90,
        crossRotationRef.current[1] + direction * 90,
      ];
      const [leftTarget, rightTarget] = crossRotationRef.current;

      if (reducedMotionRef.current) {
        if (text.length) {
          uiTl.to(text, { autoAlpha: 0, duration: 0.12, ease: "power1.in" }, 0);
        }
        if (crosses.length) {
          gsap.set(crossLeftRef.current, { rotation: leftTarget });
          gsap.set(crossRightRef.current, { rotation: rightTarget });
        }
        uiTl.call(() => writeInfo(nextIndex), [], 0.12);
        if (text.length) {
          uiTl.to(text, { autoAlpha: 1, duration: 0.12, ease: "power1.out" }, 0.12);
        }
      } else {
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
      }

      uiTl.eventCallback("onComplete", () => {
        phaseRef.current = "open";
        uiTimelineRef.current = null;
      });
    },
    [createUITimeline, preloadNeighbors, releaseWillChange, setActiveIndex, setLbIndex, writeInfo],
  );

  const closeLightbox = useCallback(() => {
    if (phaseRef.current === "idle" || phaseRef.current === "closing") return;

    const lightbox = lightboxRef.current;
    const frontId = frontIdRef.current;
    const frontDom = frontId !== null ? slideDomRef.current.get(frontId) : undefined;
    const frontImg = frontDom?.img ?? null;
    if (!lightbox || !frontImg) return;

    // Same reasoning as in openLightbox: without this, an open that's
    // interrupted mid-expand keeps animating lightbox's left/top/width/height
    // in parallel with this close, and its onComplete fires later and stomps
    // phaseRef back to "open".
    mainTimelineRef.current?.kill();

    const index = currentIndexRef.current;
    const text = asElements(titleRef.current, labelRef.current, counterRef.current);
    const crosses = asElements(crossLeftRef.current, crossRightRef.current);
    const fadeTargets = asElements(...text, ...crosses, closeRef.current);

    phaseRef.current = "closing";
    wasOpenRef.current = false;
    setLbOpen(false);

    const trackEl = document.getElementById("image-track");
    const targetWrap = document.querySelector<HTMLDivElement>(`.image-wrap[data-work-index="${index}"]`);
    if (targetWrap) {
      gsap.set(targetWrap, { x: 0, y: 0, scale: 1 });
    }
    if (trackEl) {
      gsap.set(trackEl, { scale: 1 });
    }

    syncGalleryToIndex(index, restoreOffsetRef.current);

    // === FIX #3: Reset mọi clip-path/transform đang lửng lơ trước khi close ===
    const allSlides = Array.from(slideDomRef.current.values());
    allSlides.forEach(({ wrap, img }) => {
      if (wrap) gsap.set(wrap, { clipPath: FULL_CLIP });
      if (img) gsap.set(img, { x: 0, y: 0, objectPosition: "50% 50%" });
    });
    // ================================================================

    const destination = readGalleryItem(index);

    if (trackEl) {
      gsap.set(trackEl, { scale: 0.85 });
    }

    // === FIX #1: Chỉ set geometry, không đụng opacity ===
    settleGeometry();
    // ===================================================

    stopUI();
    const allSlideEls = Array.from(slideDomRef.current.values()).flatMap((d) => asElements(d.wrap, d.img));
    if (allSlideEls.length) gsap.killTweensOf(allSlideEls);

    const tl = gsap.timeline({
      onComplete: () => {
        resetVisuals();
        phaseRef.current = "idle";
      },
    });
    mainTimelineRef.current = tl;

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
  }, [
    readGalleryItem,
    resetVisuals,
    setLbOpen,
    settleGeometry,
    stopUI,
    syncGalleryToIndex,
  ]);

  // One-time visual reset on mount; gsap.context handles teardown on unmount.
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