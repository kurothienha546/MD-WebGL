"use client";
import { useRef, useEffect, useCallback } from "react";
import gsap from "gsap";

const EASE_DRAG = 0.18;
const EASE_RELEASE = 0.08;

export function useDrag(
  count: number,
  wrapRefs: React.MutableRefObject<HTMLDivElement[]>,
  imgRefs: React.MutableRefObject<HTMLImageElement[]>,
  trackRef: React.RefObject<HTMLDivElement | null>,
  progressRef: React.RefObject<HTMLDivElement | null>,
  enabledRef: React.MutableRefObject<boolean>,
  onIndexChange: (idx: number) => void,
  onClickItem: (idx: number) => void,
  snapRef?: React.MutableRefObject<number | null>
) {
  const maxOffset = useRef(0);
  const minOffset = useRef(0);
  const targetOffset = useRef(0);
  const currentOffset = useRef(0);
  const prevOffset = useRef(0);
  const isDragging = useRef(false);
  const didMove = useRef(false);
  const mouseDownAt = useRef(0);
  const dragStartX = useRef(0);
  const rafId = useRef<number>(0);
  const lastIdx = useRef(0);

  const objPctAt = useCallback((offset: number) => {
    if (minOffset.current === maxOffset.current) return 100;
    return 100 * (1 - (offset - maxOffset.current) / (minOffset.current - maxOffset.current));
  }, []);

  const syncObjPos = useCallback((offset: number) => {
    const pct = objPctAt(offset);
    for (const img of imgRefs.current) {
      if (img) img.style.objectPosition = pct + "% center";
    }
  }, [objPctAt, imgRefs]);

  const progressPct = useCallback((offset: number) => {
    if (minOffset.current === maxOffset.current) return 0;
    return 100 * (offset - maxOffset.current) / (minOffset.current - maxOffset.current);
  }, []);

  const centerOffset = useCallback((idx: number) => {
    const wrap = wrapRefs.current[idx];
    const first = wrapRefs.current[0];
    if (!wrap || !first) return 0;
    return -(wrap.offsetLeft + first.offsetWidth / 2);
  }, [wrapRefs]);

  const closestIdx = useCallback(() => {
    const cx = window.innerWidth / 2;
    let minD = Infinity;
    let best = 0;
    for (let i = 0; i < wrapRefs.current.length; i++) {
      const r = wrapRefs.current[i]?.getBoundingClientRect();
      if (!r) continue;
      const d = Math.abs((r.left + r.right) / 2 - cx);
      if (d < minD) { minD = d; best = i; }
    }
    return best;
  }, [wrapRefs]);

  const computeOffsets = useCallback(() => {
    if (!wrapRefs.current.length || !wrapRefs.current[0]) return;
    const imgW = wrapRefs.current[0].offsetWidth;
    const last = wrapRefs.current[wrapRefs.current.length - 1];
    maxOffset.current = -(imgW / 2);
    minOffset.current = -(last.offsetLeft + imgW / 2);

    const clamp = (v: number) => Math.max(minOffset.current, Math.min(maxOffset.current, v));
    targetOffset.current = clamp(isNaN(targetOffset.current) ? maxOffset.current : targetOffset.current);
    currentOffset.current = clamp(isNaN(currentOffset.current) ? maxOffset.current : currentOffset.current);
    prevOffset.current = targetOffset.current;

    if (trackRef.current) {
      gsap.set(trackRef.current, { x: currentOffset.current });
    }
    syncObjPos(currentOffset.current);
  }, [wrapRefs, trackRef, syncObjPos]);

  useEffect(() => {
    const loop = () => {
      if (snapRef && snapRef.current !== null) {
        const v = snapRef.current;
        currentOffset.current = targetOffset.current = prevOffset.current = v;
        snapRef.current = null;
        if (trackRef.current) gsap.set(trackRef.current, { x: v });
        syncObjPos(v);
      }
      const ease = isDragging.current ? EASE_DRAG : EASE_RELEASE;
      currentOffset.current += (targetOffset.current - currentOffset.current) * ease;
      if (Math.abs(currentOffset.current - targetOffset.current) < 0.08) {
        currentOffset.current = targetOffset.current;
      }

      if (trackRef.current) {
        // Tối ưu hóa render bằng GSAP x transform thay vì style string thuần
        gsap.set(trackRef.current, { x: currentOffset.current });
      }
      syncObjPos(currentOffset.current);

      if (progressRef.current) {
        progressRef.current.style.width = Math.max(0, Math.min(100, progressPct(currentOffset.current))) + "%";
      }

      if (enabledRef.current) {
        const idx = closestIdx();
        if (idx !== lastIdx.current) {
          lastIdx.current = idx;
          onIndexChange(idx);
        }
      }

      rafId.current = requestAnimationFrame(loop);
    };
    rafId.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId.current);
  }, [closestIdx, onIndexChange, progressPct, syncObjPos, trackRef, progressRef, enabledRef, snapRef]);

  useEffect(() => {
    const handle = () => computeOffsets();
    requestAnimationFrame(handle);
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, [computeOffsets]);

  useEffect(() => {
    const onDown = (x: number) => {
      if (!enabledRef.current) return;
      isDragging.current = true;
      mouseDownAt.current = x;
      dragStartX.current = x;
      didMove.current = false;
      const cursor = document.getElementById("cursor");
      cursor?.classList.add("drag");
      cursor?.classList.remove("hover");
      const label = document.getElementById("cursor-label");
      if (label) label.style.opacity = "1";
    };

    const onMove = (x: number) => {
      if (!isDragging.current) return;
      if (Math.abs(x - dragStartX.current) > 5) didMove.current = true;
      targetOffset.current = Math.max(minOffset.current, Math.min(maxOffset.current, prevOffset.current + (x - mouseDownAt.current)));
    };

    const onUp = (x: number, y: number) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      prevOffset.current = targetOffset.current;
      const cursor = document.getElementById("cursor");
      cursor?.classList.remove("drag");
      const label = document.getElementById("cursor-label");
      if (label) label.style.opacity = "0";

      if (!didMove.current || Math.abs(x - dragStartX.current) < 6) {
        const el = document.elementFromPoint(x, y);
        if (!el) return;
        const wrap = (el as HTMLElement).closest(".image-wrap") as HTMLDivElement | null;
        if (!wrap) return;
        const idx = wrapRefs.current.indexOf(wrap);
        if (idx >= 0) onClickItem(idx);
      }
    };

    const isTrackTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(element?.closest("#image-track"));
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!isTrackTarget(e.target)) return;
      onDown(e.clientX);
    };
    const onMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const onMouseUp = (e: MouseEvent) => onUp(e.clientX, e.clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (!isTrackTarget(e.target)) return;
      onDown(e.touches[0].clientX);
    };
    const onTouchMove = (e: TouchEvent) => onMove(e.touches[0].clientX);
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      onUp(t.clientX, t.clientY);
    };

    const onWheel = (e: WheelEvent) => {
      if (!enabledRef.current) return;
      targetOffset.current = Math.max(minOffset.current, Math.min(maxOffset.current, targetOffset.current - e.deltaY * 0.6));
      prevOffset.current = targetOffset.current;
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
    };
  }, [wrapRefs, enabledRef, onClickItem]);

  const snapToIndex = useCallback((idx: number) => {
    const co = centerOffset(idx);
    currentOffset.current = targetOffset.current = prevOffset.current = co;
    if (trackRef.current) gsap.set(trackRef.current, { x: co });
    syncObjPos(co);
    lastIdx.current = idx;
    onIndexChange(idx);
  }, [centerOffset, onIndexChange, syncObjPos, trackRef]);

  return { computeOffsets, snapToIndex, currentOffset };
}