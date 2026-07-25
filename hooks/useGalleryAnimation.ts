"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, MutableRefObject, RefObject } from "react";
import gsap from "gsap";
import { works } from "@/lib/works";
import { useSliderStore } from "@/store/useSliderStore";
import { useReducedMotion } from "./useReducedMotion";
import { useCursorState } from "./useCursorState";

const GALLERY_SNAP_EVENT = "gallery:snap-to-index";

// --- drag / click ---
/** Pointer movement beyond this, during a drag, flips didMove to true. */
const DRAG_MOVE_THRESHOLD_PX = 5;
/** At pointer-up, total displacement under this counts as a click, not a drag. */
const CLICK_DISTANCE_THRESHOLD_PX = 6;

// --- chase / settle physics ---
const WHEEL_MULTIPLIER = 0.6;
/** Below this distance-to-target, the per-frame chase snaps to exact value. */
const SETTLE_EPSILON_PX = 0.08;
const IDLE_EASE = 0.04;
const DRAG_EASE = 0.01;

const RESIZE_DEBOUNCE_MS = 100;

// --- entrance ---
const ENTRANCE_CARD_DURATION = 0.88;
const ENTRANCE_CARD_STAGGER = 0.09;
const ENTRANCE_CARD_START = 0.04;
const ENTRANCE_CROSSHAIR_DURATION = 0.48;
const ENTRANCE_CROSSHAIR_START = 0.82;

// --- crosshair show/hide with lightbox ---
const CROSSHAIR_HIDE_DURATION = 0.18;
const CROSSHAIR_SHOW_DURATION = 0.42;
const CROSSHAIR_HIDDEN_SCALE = 0.9;
const SPATIAL_SHIFT_DURATION = 0.94;
const SPATIAL_SHIFT_OPACITY = 0.28;
const SPATIAL_SHIFT_SCALE_STEP = 0.07;

// --- active underline ---
const UNDERLINE_DURATION = 0.32;
const UNDERLINE_ACTIVE_OPACITY = 0.5;

export interface TrackMetrics {
  min: number;
  max: number;
  centers: number[];
}

interface DragState {
  pointerId: number;
  startX: number;
  startOffset: number;
  didMove: boolean;
}

interface GallerySnapDetail {
  index: number;
  offset?: number;
}

const initialMetrics: TrackMetrics = { min: 0, max: 0, centers: [] };

function createNodeRegistrar<T extends HTMLElement>(
  nodes: Map<string, T>,
  callbacks: Map<string, (node: T | null) => void>,
): (key: string) => (node: T | null) => void {
  return (key: string) => {
    let cb = callbacks.get(key);
    if (!cb) {
      cb = (node) => {
        if (node) nodes.set(key, node);
        else nodes.delete(key);
      };
      callbacks.set(key, cb);
    }
    return cb;
  };
}

export interface UseGalleryAnimationResult {
  galleryRef: MutableRefObject<HTMLDivElement | null>;
  trackRef: MutableRefObject<HTMLDivElement | null>;
  progressRef: MutableRefObject<HTMLDivElement | null>;
  crosshairRef: MutableRefObject<HTMLDivElement | null>;
  registerWrap: (key: string) => (node: HTMLDivElement | null) => void;
  registerImage: (key: string) => (node: HTMLImageElement | null) => void;
  registerUnderline: (key: string) => (node: HTMLDivElement | null) => void;
  handleImageLoad: () => void;
  handleWrapMouseEnter: () => void;
  handleWrapMouseLeave: () => void;
  handleWrapKeyDown: (event: KeyboardEvent<HTMLDivElement>, index: number) => void;
}

/**
 * Owns every piece of imperative state for the draggable gallery track:
 * measurement, the per-frame chase-to-target physics, the discrete
 * settle-to-center tween, entrance animation, and the pointer/wheel/keyboard
 * input handlers around it. `Gallery.tsx` just renders whatever this
 * returns.
 */
export function useGalleryAnimation(
  snapRef: MutableRefObject<number | null>,
  cursorRef?: RefObject<HTMLElement | null>,
  openLightbox?: (index: number) => void,
): UseGalleryAnimationResult {
  const lbOpen = useSliderStore((state) => state.lbOpen);
  const setActiveIndex = useSliderStore((state) => state.setActiveIndex);

  const reducedMotion = useReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const cursor = useCursorState(cursorRef);

  // Zustand actions are stable references — only the *state* (lbOpen) needs
  // ref-mirroring so pointer/wheel handlers (created once) can read its
  // current value without becoming a dependency.
  const lbOpenRef = useRef(lbOpen);
  useLayoutEffect(() => {
    lbOpenRef.current = lbOpen;
  });

  const galleryRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const crosshairRef = useRef<HTMLDivElement | null>(null);

  const wrapNodesRef = useRef(new Map<string, HTMLDivElement>());
  const imageNodesRef = useRef(new Map<string, HTMLImageElement>());
  const underlineNodesRef = useRef(new Map<string, HTMLDivElement>());
  const wrapCallbacksRef = useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const imageCallbacksRef = useRef(new Map<string, (node: HTMLImageElement | null) => void>());
  const underlineCallbacksRef = useRef(new Map<string, (node: HTMLDivElement | null) => void>());

  const registerWrap = useCallback(
    createNodeRegistrar(wrapNodesRef.current, wrapCallbacksRef.current),
    [],
  );
  const registerImage = useCallback(
    createNodeRegistrar(imageNodesRef.current, imageCallbacksRef.current),
    [],
  );
  const registerUnderline = useCallback(
    createNodeRegistrar(underlineNodesRef.current, underlineCallbacksRef.current),
    [],
  );

  /** Images in `works` order, refreshed only on measurement — not per-frame. */
  const orderedImagesRef = useRef<HTMLImageElement[]>([]);

  const metricsRef = useRef<TrackMetrics>(initialMetrics);
  const currentOffsetRef = useRef(0);
  const targetOffsetRef = useRef(0);
  const cropPercentRef = useRef(Infinity);
  const activeIndexRef = useRef(useSliderStore.getState().activeIndex);
  const hasMeasuredRef = useRef(false);
  const dragRef = useRef<DragState | null>(null);
  const entranceTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const previousLbOpenRef = useRef(lbOpen);
  const initiallyOpenRef = useRef(lbOpen);
  const isInViewRef = useRef(true);
  const motionActiveRef = useRef(false);

  const tickRef = useRef<() => void>(() => { });
  const stableTickRef = useRef(() => tickRef.current());

  const setActive = useCallback(
    (index: number) => {
      if (activeIndexRef.current === index) return;
      activeIndexRef.current = index;
      setActiveIndex(index);
    },
    [setActiveIndex],
  );

  const clampOffset = useCallback((value: number) => {
    const { min, max } = metricsRef.current;
    return Math.max(min, Math.min(max, value));
  }, []);

  const applyWillChange = useCallback(() => {
    if (trackRef.current) gsap.set(trackRef.current, { willChange: "transform" });
  }, []);

  const releaseWillChange = useCallback(() => {
    if (trackRef.current) gsap.set(trackRef.current, { willChange: "auto" });
  }, []);

  const stopMotion = useCallback(() => {
    if (motionActiveRef.current) {
      motionActiveRef.current = false;
      gsap.ticker.remove(stableTickRef.current);
    }
    releaseWillChange();
  }, [releaseWillChange]);

  const beginMotion = useCallback(() => {
    applyWillChange();
    if (motionActiveRef.current) return;
    motionActiveRef.current = true;
    gsap.ticker.add(stableTickRef.current);
  }, [applyWillChange]);

  const setMotionTarget = useCallback(
    (offset: number) => {
      targetOffsetRef.current = clampOffset(offset);
      beginMotion();
    },
    [beginMotion, clampOffset],
  );

  /**
   * Applies `offset` to the track: clamps it, positions the track via GSAP,
   * updates the object-position parallax and progress bar, and updates the
   * active index from whichever center is nearest. Called every ticker
   * frame, so it reads from cached arrays rather than re-querying the DOM.
   */
  const renderOffset = useCallback(
    (offset: number) => {
      const nextOffset = clampOffset(offset);
      const { min, max, centers } = metricsRef.current;
      const track = trackRef.current;

      currentOffsetRef.current = nextOffset;
      if (track) gsap.set(track, { x: nextOffset });

      if (!centers.length) return;

      const objectPosition = min === max ? 100 : 100 * (1 - (nextOffset - max) / (min - max));
      if (Math.abs(objectPosition - cropPercentRef.current) > 0.01) {
        cropPercentRef.current = objectPosition;
        if (orderedImagesRef.current.length) {
          gsap.set(orderedImagesRef.current, { objectPosition: `${objectPosition.toFixed(3)}% 50%` });
        }
      }

      const progress = min === max ? 0 : (100 * (nextOffset - max)) / (min - max);
      if (progressRef.current) {
        gsap.set(progressRef.current, { scaleX: Math.max(0, Math.min(1, progress / 100)) });
      }

      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      centers.forEach((center, index) => {
        const distance = Math.abs(nextOffset - center);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });
      setActive(nearestIndex);
    },
    [clampOffset, setActive],
  );

  const syncMotionToOffset = useCallback(
    (offset: number) => {
      const synchronizedOffset = clampOffset(offset);
      stopMotion();
      dragRef.current = null;
      currentOffsetRef.current = synchronizedOffset;
      targetOffsetRef.current = synchronizedOffset;
      renderOffset(synchronizedOffset);
    },
    [clampOffset, renderOffset, stopMotion],
  );

  /**
   * Re-reads each wrap's `offsetLeft`/`offsetWidth` and recomputes centers.
   * Bails out (leaving the previous metrics untouched) until every item in
   * `works` has registered a node and the first one has a non-zero width —
   * `handleImageLoad` retries this once assets finish loading.
   */
  const measureLayout = useCallback(
    (requestedOffset?: number) => {
      const orderedWraps = works
        .map((work) => wrapNodesRef.current.get(work.src))
        .filter((node): node is HTMLDivElement => Boolean(node));
      if (orderedWraps.length !== works.length) return;

      const first = orderedWraps[0];
      if (!first || !first.offsetWidth) return;

      const firstWidth = first.offsetWidth;
      const centers = orderedWraps.map((wrap) => -(wrap.offsetLeft + firstWidth / 2));
      const max = centers[0] ?? 0;
      const min = centers[centers.length - 1] ?? 0;

      metricsRef.current = { min, max, centers };
      orderedImagesRef.current = works
        .map((work) => imageNodesRef.current.get(work.src))
        .filter((node): node is HTMLImageElement => Boolean(node));

      const nextOffset = requestedOffset ?? (hasMeasuredRef.current ? targetOffsetRef.current : max);

      hasMeasuredRef.current = true;
      targetOffsetRef.current = clampOffset(nextOffset);
      renderOffset(targetOffsetRef.current);
    },
    [clampOffset, renderOffset],
  );

  const handleImageLoad = useCallback(() => {
    if (!hasMeasuredRef.current) measureLayout();
  }, [measureLayout]);

  const stepToIndex = useCallback(
    (index: number) => {
      const center = metricsRef.current.centers[index];
      if (center === undefined) return;
      setActive(index);
      setMotionTarget(center);
    },
    [setActive, setMotionTarget],
  );

  const openItem = useCallback(
    (index: number) => {
      if (lbOpenRef.current || !works[index] || !openLightbox) return;
      openLightbox(index);
    },
    [openLightbox],
  );

  // Kept fresh every render; `stableTickRef` (registered with gsap.ticker)
  // never changes identity and just calls whatever this currently points to.
  tickRef.current = () => {
    const diff = targetOffsetRef.current - currentOffsetRef.current;
    if (Math.abs(diff) < SETTLE_EPSILON_PX) {
      if (currentOffsetRef.current !== targetOffsetRef.current) {
        currentOffsetRef.current = targetOffsetRef.current;
        renderOffset(currentOffsetRef.current);
      }
      if (!dragRef.current) stopMotion();
      return;
    }

    // Only the idle chase (wheel/settle-driven) goes instant under reduced
    // motion — active drag-tracking is direct manipulation, not "animation".
    const ease = dragRef.current ? DRAG_EASE : reducedMotionRef.current ? 1 : IDLE_EASE;
    currentOffsetRef.current += diff * ease;
    renderOffset(currentOffsetRef.current);
  };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (lbOpenRef.current || event.button !== 0) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, input, textarea, #lightbox")) return;

      stopMotion();
      targetOffsetRef.current = currentOffsetRef.current;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startOffset: currentOffsetRef.current,
        didMove: false,
      };
      beginMotion();
      cursor.addClass("drag");
      cursor.removeClass("hover");
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const delta = event.clientX - drag.startX;
      if (Math.abs(delta) > DRAG_MOVE_THRESHOLD_PX) drag.didMove = true;

      targetOffsetRef.current = clampOffset(drag.startOffset + delta);
      beginMotion();
    };

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      dragRef.current = null;
      cursor.removeClass("drag");

      const elAtPoint = document.elementFromPoint(event.clientX, event.clientY);
      if (elAtPoint?.closest(".image-wrap")) cursor.addClass("hover");

      const isClick =
        !drag.didMove || Math.abs(event.clientX - drag.startX) < CLICK_DISTANCE_THRESHOLD_PX;

      if (isClick) {
        const wrap = elAtPoint?.closest(".image-wrap") as HTMLDivElement | null;
        const index = Number(wrap?.dataset.workIndex);
        if (Number.isInteger(index)) openItem(index);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      cursor.removeClass("drag");
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [beginMotion, clampOffset, cursor, openItem, stopMotion]);

  // Entrance animation — runs once on mount only.
  useLayoutEffect(() => {
    const scope = galleryRef.current;
    const track = trackRef.current;
    if (!scope || !track) return;

    const context = gsap.context(() => {
      const cards = works
        .map((work) => wrapNodesRef.current.get(work.src))
        .filter((node): node is HTMLDivElement => Boolean(node));
      const underlines = Array.from(underlineNodesRef.current.values());

      gsap.set(track, { x: 0, yPercent: -50 });
      gsap.set(progressRef.current, { scaleX: 0, transformOrigin: "left center" });
      gsap.set(crosshairRef.current, { autoAlpha: 0, xPercent: -50, yPercent: -50, scale: 0.9 });
      gsap.set(underlines, { opacity: 0 });

      if (reducedMotionRef.current) {
        gsap.set(cards, { autoAlpha: 1, y: 0 });
        if (!initiallyOpenRef.current) {
          gsap.to(crosshairRef.current, {
            autoAlpha: 1,
            scale: 1,
            duration: ENTRANCE_CROSSHAIR_DURATION,
            ease: "power3.out",
          });
        }
        return;
      }

      gsap.set(cards, { autoAlpha: 0, y: 24 });

      const entrance = gsap.timeline({ defaults: { ease: "power3.out" } });
      entrance.to(
        cards,
        { autoAlpha: 1, y: 0, duration: ENTRANCE_CARD_DURATION, stagger: ENTRANCE_CARD_STAGGER },
        ENTRANCE_CARD_START,
      );
      if (!initiallyOpenRef.current) {
        entrance.to(
          crosshairRef.current,
          { autoAlpha: 1, scale: 1, duration: ENTRANCE_CROSSHAIR_DURATION },
          ENTRANCE_CROSSHAIR_START,
        );
      }
      entranceTimelineRef.current = entrance;
    }, scope);

    return () => {
      entranceTimelineRef.current?.kill();
      entranceTimelineRef.current = null;
      context.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measurement + debounced resize, observing the track itself rather than
  // the whole document.
  useLayoutEffect(() => {
    measureLayout();

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const debouncedMeasure = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => measureLayout(), RESIZE_DEBOUNCE_MS);
    };

    const track = trackRef.current;
    const resizeObserver =
      track && typeof ResizeObserver !== "undefined" ? new ResizeObserver(debouncedMeasure) : null;
    if (track && resizeObserver) resizeObserver.observe(track);
    window.addEventListener("resize", debouncedMeasure);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", debouncedMeasure);
    };
  }, [measureLayout]);

  // Tracks whether the track is anywhere near the viewport, so the window
  // wheel listener doesn't hijack scrolling on unrelated parts of the page.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) isInViewRef.current = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (lbOpenRef.current || !hasMeasuredRef.current || !isInViewRef.current) return;
      setMotionTarget(targetOffsetRef.current - event.deltaY * WHEEL_MULTIPLIER);
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [setMotionTarget]);

  useEffect(() => {
    const onGallerySnap = (event: Event) => {
      const detail = (event as CustomEvent<GallerySnapDetail>).detail;
      if (!detail || !Number.isInteger(detail.index) || !works[detail.index]) return;

      const requestedOffset =
        typeof detail.offset === "number" ? detail.offset : metricsRef.current.centers[detail.index];
      syncMotionToOffset(requestedOffset);
      measureLayout(requestedOffset);
      setActive(detail.index);
      snapRef.current = null;
    };

    window.addEventListener(GALLERY_SNAP_EVENT, onGallerySnap);
    return () => window.removeEventListener(GALLERY_SNAP_EVENT, onGallerySnap);
  }, [measureLayout, setActive, snapRef, syncMotionToOffset]);

  useEffect(() => {
    if (previousLbOpenRef.current === lbOpen) return;
    previousLbOpenRef.current = lbOpen;

    dragRef.current = null;
    stopMotion();

    const crosshair = crosshairRef.current;
    const track = trackRef.current;

    if (crosshair) {
      gsap.killTweensOf(crosshair);
      gsap.to(crosshair, {
        autoAlpha: lbOpen ? 0 : 1,
        scale: lbOpen ? CROSSHAIR_HIDDEN_SCALE : 1,
        duration: lbOpen ? CROSSHAIR_HIDE_DURATION : CROSSHAIR_SHOW_DURATION,
        ease: "power3.out",
      });
    }

    if (track) {
      gsap.killTweensOf(track);
      gsap.to(track, {
        scale: lbOpen ? 0.85 : 1,
        opacity: lbOpen ? 0.25 : 1,
        duration: 0.94,
        ease: "expo.out",
        transformOrigin: "50% 50%",
      });
    }

    const activeIndex = useSliderStore.getState().activeIndex;
    const cardEntries = works
      .map((work, index) => ({ index, node: wrapNodesRef.current.get(work.src) ?? null }))
      .filter((entry): entry is { index: number; node: HTMLDivElement } => Boolean(entry.node));

    cardEntries.forEach(({ index, node }) => {
      gsap.killTweensOf(node);

      if (lbOpen) {
        if (index === activeIndex) {
          gsap.set(node, { x: 0, y: 0, scale: 1, opacity: 0 });
          return;
        }

        const distance = Math.max(1, Math.abs(index - activeIndex));
        const direction = index < activeIndex ? -1 : 1;
        gsap.to(node, {
          x: `${direction * (8 + distance * 2.5)}vw`,
          y: `${(distance + 1) * 2.5}vh`,
          scale: Math.max(0.48, 1 - distance * SPATIAL_SHIFT_SCALE_STEP),
          opacity: SPATIAL_SHIFT_OPACITY,
          duration: SPATIAL_SHIFT_DURATION,
          ease: "expo.out",
          transformOrigin: "50% 50%",
        });
        return;
      }

      if (index === activeIndex) {
        gsap.set(node, { x: 0, y: 0, scale: 1, opacity: 0 });
        gsap.to(node, {
          opacity: 1,
          duration: 0.1,
          delay: SPATIAL_SHIFT_DURATION - 0.05,
          ease: "power1.out",
          overwrite: "auto",
        });
        return;
      }

      gsap.to(node, {
        x: 0,
        y: 0,
        scale: 1,
        opacity: 1,
        duration: SPATIAL_SHIFT_DURATION,
        ease: "expo.out",
        clearProps: "transform",
      });
    });

    return () => {
      if (crosshair) gsap.killTweensOf(crosshair);
      if (track) gsap.killTweensOf(track);
      cardEntries.forEach(({ node }) => gsap.killTweensOf(node));
    };
  }, [lbOpen, stopMotion]);

  // Drives both the underline opacity and the wrap's "active" class straight
  // from the store, outside React's render cycle. `renderOffset` can update
  // activeIndex many times a second mid-drag; subscribing directly (instead
  // of selecting activeIndex in the component and re-rendering the whole
  // list on every change) keeps that hot path from forcing React work.
  useEffect(() => {
    const applyActive = (activeIndex: number) => {
      works.forEach((work, index) => {
        const isActive = index === activeIndex;
        wrapNodesRef.current.get(work.src)?.classList.toggle("active", isActive);
        const underline = underlineNodesRef.current.get(work.src);
        if (underline) {
          gsap.to(underline, {
            opacity: isActive ? UNDERLINE_ACTIVE_OPACITY : 0,
            duration: UNDERLINE_DURATION,
            ease: "power2.out",
            overwrite: "auto",
          });
        }
      });
    };

    applyActive(useSliderStore.getState().activeIndex);
    return useSliderStore.subscribe((state, prevState) => {
      if (state.activeIndex !== prevState.activeIndex) applyActive(state.activeIndex);
    });
  }, []);

  // Safety net: stop any in-flight tween/ticker on unmount.
  useEffect(() => {
    return () => {
      stopMotion();
    };
  }, [stopMotion]);

  const handleWrapMouseEnter = useCallback(() => {
    if (!lbOpenRef.current) cursor.addClass("hover");
  }, [cursor]);

  const handleWrapMouseLeave = useCallback(() => {
    cursor.removeClass("hover");
  }, [cursor]);

  const handleWrapKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, index: number) => {
      if (lbOpenRef.current) return;

      if (event.key === "Enter") {
        event.preventDefault();
        openItem(index);
        return;
      }

      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();

      const direction = event.key === "ArrowRight" ? 1 : -1;
      const nextIndex = (index + direction + works.length) % works.length;
      stepToIndex(nextIndex);

      const nextWork = works[nextIndex];
      const nextNode = nextWork ? wrapNodesRef.current.get(nextWork.src) : undefined;
      nextNode?.focus();
    },
    [openItem, stepToIndex],
  );

  return {
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
  };
}
