import { Renderer, Camera, Transform, Plane } from "ogl";
import gsap from "gsap";
import { works } from "@/lib/works";
import { CardMesh } from "./CardMesh";
import { LightboxStack } from "./LightboxStack";
import { ThumbnailDock } from "./ThumbnailDock";
import {
  WHEEL_MULTIPLIER,
  SETTLE_EPSILON_PX,
  IDLE_EASE,
  DRAG_EASE,
  RESIZE_DEBOUNCE_MS,
  DRAG_MOVE_THRESHOLD_PX,
  CLICK_DISTANCE_THRESHOLD_PX,
} from "@/lib/constants";

export interface WebGLEngineOptions {
  container: HTMLDivElement;
  canvas: HTMLCanvasElement;
  openLightbox?: (index: number) => void;
  progressEl?: HTMLElement | null;
  cursorEl?: HTMLElement | null;
  isReducedMotion?: boolean;
  onActiveIndexChange?: (index: number) => void;
  onLightboxStateChange?: (open: boolean, index: number) => void;
}

export class WebGLEngine {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private openLightboxCb?: (index: number) => void;
  private progressEl?: HTMLElement | null;
  private cursorEl?: HTMLElement | null;
  private onActiveIndexChangeCb?: (index: number) => void;
  private onLightboxStateChangeCb?: (open: boolean, index: number) => void;

  public isReducedMotion = false;
  public renderer: Renderer;
  public camera: Camera;
  public scene: Transform;
  public planeGeometry: Plane;
  public cardMeshes: CardMesh[] = [];
  public lightboxStack: LightboxStack;
  public thumbnailDock: ThumbnailDock;

  public geometryBaseW = 0;
  public geometryBaseH = 0;

  // Pure Internal Lightbox State
  public lbOpen = false;
  public lbIndex = 0;
  public lbDirection: 1 | -1 = 1;

  // Physics state
  public targetOffset = 0;
  public currentOffset = 0;
  public velocity = 0;
  private _lastOffsetForVelocity = 0;
  private _lastFrameTime = 0;
  public activeIndex = 0;
  public isDragging = false;
  public dragStart = { pointerId: -1, startX: 0, startOffset: 0, didMove: false };
  public motionActive = false;

  public lbProgress = { current: 0 };
  public previousLbOpen = false;
  public previousLbIdx = -1;

  public metrics = {
    cardWidth: 0,
    cardHeight: 0,
    gap: 0,
    stepDistance: 0,
    minOffset: 0,
    maxOffset: 0,
    screenWidth: 0,
    screenHeight: 0,
    centers: [] as number[],
  };

  private animFrameId: number | null = null;
  private resizeTimer?: ReturnType<typeof setTimeout>;
  private resizeObserver?: ResizeObserver;
  private tickerFunc: () => void;

  private handleResize?: () => void;
  private onPointerDown?: (event: PointerEvent) => void;
  private onPointerMove?: (event: PointerEvent) => void;
  private onPointerUp?: (event: PointerEvent) => void;
  private onPointerCancel?: (event: PointerEvent) => void;
  private onWheel?: (event: WheelEvent) => void;
  private onContextLost?: (event: Event) => void;
  private onContextRestored?: (event: Event) => void;
  private onVisibilityChange?: () => void;

  private lastProgressScale = -1;
  private pointerHistory: Array<{ x: number; time: number }> = [];

  constructor(options: WebGLEngineOptions) {
    const {
      container,
      canvas,
      openLightbox,
      progressEl,
      cursorEl,
      isReducedMotion,
      onActiveIndexChange,
      onLightboxStateChange
    } = options;

    this.container = container;
    this.canvas = canvas;
    this.openLightboxCb = openLightbox;
    this.progressEl = progressEl;
    this.cursorEl = cursorEl;
    this.isReducedMotion = !!isReducedMotion;
    this.onActiveIndexChangeCb = onActiveIndexChange;
    this.onLightboxStateChangeCb = onLightboxStateChange;

    this._lastOffsetForVelocity = 0;
    this._lastFrameTime = 0;
    this.lightboxStack = new LightboxStack();
    this.thumbnailDock = new ThumbnailDock();

    this.updateMetrics();
    const { screenWidth, screenHeight, cardWidth, cardHeight, stepDistance } = this.metrics;

    this.geometryBaseW = cardWidth;
    this.geometryBaseH = cardHeight;

    this.renderer = new Renderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });
    this.renderer.setSize(screenWidth, screenHeight);

    const gl = this.renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    this.camera = new Camera(gl, { near: -1000, far: 1000 });
    this.camera.orthographic({
      left: -screenWidth / 2,
      right: screenWidth / 2,
      top: screenHeight / 2,
      bottom: -screenHeight / 2,
    });
    this.camera.position.z = 10;

    this.scene = new Transform();

    this.planeGeometry = new Plane(gl, {
      width: cardWidth,
      height: cardHeight,
      widthSegments: 20,
      heightSegments: 20,
    });

    // Create CardMeshes & load textures
    works.forEach((work, i) => {
      const baseX = i * stepDistance;
      const card = new CardMesh({
        gl,
        geometry: this.planeGeometry,
        parent: this.scene,
        index: i,
        src: work.src,
        cardWidth,
        cardHeight,
        baseX,
      });
      card.loadTexture();
      this.cardMeshes.push(card);
    });

    this.tickerFunc = () => this.tickPhysics();
    this.bindEvents();
    this.startRenderLoop();
  }

  public setLightboxState(open: boolean, index: number = this.lbIndex, direction: 1 | -1 = 1) {
    this.lbOpen = open;
    this.lbIndex = index;
    this.lbDirection = direction;
    this.onLightboxStateChangeCb?.(open, index);
  }

  public updateMetrics() {
    if (typeof window === "undefined") return;

    const sw = window.innerWidth;
    const sh = window.innerHeight;
    const isMobile = sw < 768;

    const cardWidth = isMobile ? sw * 0.7 : Math.min(sw, sh) * 0.4;
    const cardHeight = isMobile ? Math.min(sw, sh) * 0.5 : Math.min(sw, sh) * 0.58;
    const gap = Math.min(sw, sh) * 0.022;
    const stepDistance = cardWidth + gap;

    const centers = works.map((_, i) => -i * stepDistance);
    const maxOffset = centers[0] ?? 0;
    const minOffset = centers[centers.length - 1] ?? 0;

    this.thumbnailDock.updateMetrics(sw, sh);

    this.metrics = {
      cardWidth,
      cardHeight,
      gap,
      stepDistance,
      minOffset,
      maxOffset,
      screenWidth: sw,
      screenHeight: sh,
      centers,
    };
  }

  private clampOffset(val: number) {
    const { minOffset, maxOffset } = this.metrics;
    return Math.max(minOffset, Math.min(maxOffset, val));
  }

  private beginMotion() {
    if (this.motionActive) return;
    this.motionActive = true;
    gsap.ticker.add(this.tickerFunc);
  }

  private stopMotion() {
    if (this.motionActive) {
      this.motionActive = false;
      gsap.ticker.remove(this.tickerFunc);
    }
  }

  public setMotionTarget(offset: number) {
    this.targetOffset = this.clampOffset(offset);
    this.beginMotion();
  }

  public syncOffset(offset: number) {
    const synced = this.clampOffset(offset);
    this.stopMotion();
    this.isDragging = false;
    this.currentOffset = synced;
    this.targetOffset = synced;
    this._lastOffsetForVelocity = synced;
  }

  public onStoreStateChange(lbOpen: boolean, lbIdx: number, lbDir: 1 | -1 = 1) {
    if (this.previousLbOpen !== lbOpen) {
      this.previousLbOpen = lbOpen;
      this.previousLbIdx = lbIdx;
      this.stopMotion();

      if (lbOpen) {
        this.lightboxStack.reset(lbIdx);
        gsap.to(this.lbProgress, {
          current: 1,
          duration: this.isReducedMotion ? 0.2 : 0.85,
          ease: "expo.out",
          overwrite: true,
        });
      } else {
        gsap.to(this.lbProgress, {
          current: 0,
          duration: this.isReducedMotion ? 0.2 : 0.65,
          ease: "power3.inOut",
          overwrite: true,
        });
      }
    } else if (lbOpen && this.previousLbIdx !== lbIdx) {
      this.previousLbIdx = lbIdx;
      this.lightboxStack.pushSlide(lbIdx, this.isReducedMotion, lbDir);
    }
  }

  private tickPhysics() {
    const diff = this.targetOffset - this.currentOffset;
    const absDiff = Math.abs(diff);

    // Disable SETTLE_EPSILON_PX settling during active drag to eliminate drag micro-snap jitter
    if (!this.isDragging && absDiff < SETTLE_EPSILON_PX) {
      if (this.currentOffset !== this.targetOffset) {
        this.currentOffset = this.targetOffset;
      }
      this.stopMotion();
      return;
    }

    let ease = this.isDragging ? DRAG_EASE : this.isReducedMotion ? 1 : IDLE_EASE;
    if (!this.isDragging && absDiff < 1.0) {
      ease = Math.max(ease, 0.22);
    }

    this.currentOffset += diff * ease;
    this.updateProgressAndActive();
  }

  private updateProgressAndActive() {
    const { minOffset, maxOffset, centers } = this.metrics;
    if (!centers.length) return;

    const clamped = this.currentOffset;

    // Update Progress bar
    const progress = minOffset === maxOffset ? 0 : (100 * (clamped - maxOffset)) / (minOffset - maxOffset);
    if (this.progressEl) {
      const newScale = Math.max(0, Math.min(1, progress / 100));
      if (Math.abs(newScale - this.lastProgressScale) > 0.001) {
        this.progressEl.style.transform = `scaleX(${newScale})`;
        this.lastProgressScale = newScale;
      }
    }

    // Nearest index
    let nearestIndex = 0;
    let nearestDist = Number.POSITIVE_INFINITY;
    centers.forEach((center, i) => {
      const d = Math.abs(clamped - center);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIndex = i;
      }
    });

    if (this.activeIndex !== nearestIndex) {
      this.activeIndex = nearestIndex;
      this.onActiveIndexChangeCb?.(nearestIndex);
    }
  }

  private startRenderLoop() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);

    const draw = (time: number) => {
      // Velocity computation across frame ticks
      const dt = this._lastFrameTime ? Math.min((time - this._lastFrameTime) / 1000, 0.1) : 0.016;
      this._lastFrameTime = time;

      const offsetDelta = this.currentOffset - this._lastOffsetForVelocity;
      const instantV = offsetDelta / Math.max(dt, 0.001);
      this.velocity += (instantV - this.velocity) * 0.12;
      this._lastOffsetForVelocity = this.currentOffset;

      const lbIsOpen = this.lbOpen;
      const lbIdx = this.lbIndex;
      const lbDir = this.lbDirection;

      this.onStoreStateChange(lbIsOpen, lbIdx, lbDir);

      const { screenWidth, screenHeight, cardWidth, cardHeight, stepDistance } = this.metrics;
      const { thumbWidth, thumbHeight, dockY, dockSlotsX } = this.thumbnailDock.metrics;

      const baseW = this.geometryBaseW || cardWidth || 1;
      const baseH = this.geometryBaseH || cardHeight || 1;

      const scaleX = cardWidth / baseW;
      const scaleY = cardHeight / baseH;

      const fullScaleX = screenWidth / baseW;
      const fullScaleY = screenHeight / baseH;

      const dockScaleX = thumbWidth / baseW;
      const dockScaleY = thumbHeight / baseH;

      const lbProg = this.lbProgress.current;
      const slideProg = this.lightboxStack.slideProgress.current;
      const lastDir = this.lightboxStack.lastDir;
      const prevIdx = this.lightboxStack.prevIdx;

      this.cardMeshes.forEach((card, i) => {
      const cardV = Math.min(Math.max(this.velocity * (1 - lbProg), -10), 10);
      card.setVelocity(cardV);

        if (lbProg > 0.001) {
          const baseX = i * stepDistance;
          const galleryX = baseX + this.currentOffset;
          const dockX = dockSlotsX[i] ?? 0;

          const galleryParallax = galleryX / (screenWidth * 0.5);
          const blendParallax = galleryParallax * (1 - lbProg);

          if (i === lbIdx) {
            const slideOffsetX = lastDir * (1 - slideProg) * screenWidth;
            const targetX_full = slideOffsetX;
            const targetY_full = 0;

            const targetX = galleryX * (1 - lbProg) + targetX_full * lbProg;
            const targetY = 0 * (1 - lbProg) + targetY_full * lbProg;
            const targetScaleX = scaleX * (1 - lbProg) + fullScaleX * lbProg;
            const targetScaleY = scaleY * (1 - lbProg) + fullScaleY * lbProg;

            card.setTransform(targetX, targetY, 50 * lbProg, targetScaleX, targetScaleY, 1.0, blendParallax);
          } else if (i === prevIdx && slideProg < 0.999) {
            const slideOffsetX = -lastDir * slideProg * screenWidth;
            const targetX_full = slideOffsetX;
            const targetY_full = 0;

            const targetX = galleryX * (1 - lbProg) + targetX_full * lbProg;
            const targetY = 0 * (1 - lbProg) + targetY_full * lbProg;
            const targetScaleX = scaleX * (1 - lbProg) + fullScaleX * lbProg;
            const targetScaleY = scaleY * (1 - lbProg) + fullScaleY * lbProg;

            card.setTransform(targetX, targetY, 45 * lbProg, targetScaleX, targetScaleY, 1.0, blendParallax);
          } else {
            const targetX = galleryX * (1 - lbProg) + dockX * lbProg;
            const targetY = 0 * (1 - lbProg) + dockY * lbProg;
            const targetScaleX = scaleX * (1 - lbProg) + dockScaleX * lbProg;
            const targetScaleY = scaleY * (1 - lbProg) + dockScaleY * lbProg;

            const isCurrentDockSlot = i === lbIdx;
            const targetOpacity = isCurrentDockSlot ? 0.35 : 1.0;

            card.setTransform(targetX, targetY, 30 * lbProg, targetScaleX, targetScaleY, targetOpacity, blendParallax);
          }
        } else {
          const baseX = i * stepDistance;
          const meshX = baseX + this.currentOffset;
          const parallaxX = meshX / (screenWidth * 0.5);

          card.setTransform(meshX, 0, 0, scaleX, scaleY, 1.0, parallaxX);
        }
      });

      this.renderer.render({ scene: this.scene, camera: this.camera });
      this.animFrameId = requestAnimationFrame(draw);
    };

    this.animFrameId = requestAnimationFrame(draw);
  }

  private bindEvents() {
    this.handleResize = () => {
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.updateMetrics();
        const { cardWidth, cardHeight, stepDistance, screenWidth, screenHeight } = this.metrics;

        this.renderer.setSize(screenWidth, screenHeight);
        this.camera.orthographic({
          left: -screenWidth / 2,
          right: screenWidth / 2,
          top: screenHeight / 2,
          bottom: -screenHeight / 2,
        });
        this.camera.updateMatrixWorld();

        this.cardMeshes.forEach((card, i) => {
          card.updateSize(cardWidth, cardHeight, i * stepDistance + this.currentOffset);
        });
      }, RESIZE_DEBOUNCE_MS);
    };

    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);

    // Pointer events with Pointer Capture safety
    this.onPointerDown = (event: PointerEvent) => {
      if (this.lbOpen || event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, input, textarea, #lightbox")) return;

      try {
        this.container.setPointerCapture(event.pointerId);
      } catch { }

      this.stopMotion();
      this.targetOffset = this.currentOffset;
      this.isDragging = true;
      this.dragStart = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startOffset: this.currentOffset,
        didMove: false,
      };

      this.pointerHistory = [{ x: event.clientX, time: performance.now() }];

      this.beginMotion();
      this.cursorEl?.classList.add("drag");
      this.cursorEl?.classList.remove("hover");
    };

    this.onPointerMove = (event: PointerEvent) => {
      if (this.isDragging && this.dragStart.pointerId === event.pointerId) {
        const now = performance.now();
        this.pointerHistory.push({ x: event.clientX, time: now });
        this.pointerHistory = this.pointerHistory.filter((pt) => now - pt.time < 80);

        const delta = event.clientX - this.dragStart.startX;
        if (Math.abs(delta) > DRAG_MOVE_THRESHOLD_PX) this.dragStart.didMove = true;

        this.targetOffset = this.clampOffset(this.dragStart.startOffset + delta);
        this.beginMotion();
        return;
      }

      if (this.lbOpen) {
        const clickX = event.clientX;
        const clickY = event.clientY;
        const { screenWidth, screenHeight } = this.metrics;

        const slotIndex = this.thumbnailDock.getSlotAtPointer(clickX, clickY, screenWidth, screenHeight);
        const lbIdx = this.lbIndex;

        if (slotIndex !== -1 && slotIndex !== lbIdx) {
          this.cursorEl?.classList.add("hover");
        } else {
          this.cursorEl?.classList.remove("hover");
        }
        return;
      }

      const clickX = event.clientX;
      const clickY = event.clientY;
      const { cardWidth, cardHeight, stepDistance, screenWidth, screenHeight } = this.metrics;
      const top = screenHeight / 2 - cardHeight / 2;
      const bottom = screenHeight / 2 + cardHeight / 2;

      let isOverCard = false;
      if (clickY >= top && clickY <= bottom) {
        works.forEach((_, i) => {
          const baseX = i * stepDistance;
          const meshX = baseX + this.currentOffset;
          const left = screenWidth / 2 + meshX - cardWidth / 2;
          const right = screenWidth / 2 + meshX + cardWidth / 2;
          if (clickX >= left && clickX <= right) isOverCard = true;
        });
      }

      if (isOverCard) this.cursorEl?.classList.add("hover");
      else this.cursorEl?.classList.remove("hover");
    };

    this.onPointerUp = (event: PointerEvent) => {
      try {
        if (this.container.hasPointerCapture?.(event.pointerId)) {
          this.container.releasePointerCapture(event.pointerId);
        }
      } catch { }

      const lbOpen = this.lbOpen;
      const lbIdx = this.lbIndex;

      if (lbOpen) {
        const clickX = event.clientX;
        const clickY = event.clientY;
        const { screenWidth, screenHeight } = this.metrics;

        const clickedDockIndex = this.thumbnailDock.getSlotAtPointer(clickX, clickY, screenWidth, screenHeight);

        if (clickedDockIndex !== -1 && clickedDockIndex !== lbIdx) {
          if (this.openLightboxCb) {
            this.openLightboxCb(clickedDockIndex);
          }
          return;
        }
      }

      if (!this.isDragging || this.dragStart.pointerId !== event.pointerId) return;
      this.isDragging = false;
      this.cursorEl?.classList.remove("drag");

      const isClick = !this.dragStart.didMove || Math.abs(event.clientX - this.dragStart.startX) < CLICK_DISTANCE_THRESHOLD_PX;

      if (isClick) {
        const clickX = event.clientX;
        const clickY = event.clientY;
        const { cardWidth, cardHeight, stepDistance, screenWidth, screenHeight } = this.metrics;
        const top = screenHeight / 2 - cardHeight / 2;
        const bottom = screenHeight / 2 + cardHeight / 2;

        let clickedIndex = -1;
        if (clickY >= top && clickY <= bottom) {
          works.forEach((_, i) => {
            const baseX = i * stepDistance;
            const meshX = baseX + this.currentOffset;
            const left = screenWidth / 2 + meshX - cardWidth / 2;
            const right = screenWidth / 2 + meshX + cardWidth / 2;
            if (clickX >= left && clickX <= right) clickedIndex = i;
          });
        }

        const targetIndex = clickedIndex !== -1 ? clickedIndex : this.activeIndex;
        if (this.openLightboxCb) this.openLightboxCb(targetIndex);
      } else {
        // --- TRƯỢT QUÁN TÍNH TỰ DO (NO SNAP) ---
        let velocity = 0;
        if (this.pointerHistory.length >= 2) {
          const first = this.pointerHistory[0];
          const last = this.pointerHistory[this.pointerHistory.length - 1];
          const dt = (last.time - first.time) / 1000;
          if (dt > 0.001) {
            velocity = (last.x - first.x) / dt;
          }
        }

        const MOMENTUM_MULTIPLIER = 0.20;
        const maxGlide = this.metrics.stepDistance * 1.5;
        const glideDelta = Math.min(Math.max(velocity * MOMENTUM_MULTIPLIER, -maxGlide), maxGlide);

        this.setMotionTarget(this.currentOffset + glideDelta);
      }
    };

    this.onPointerCancel = (event: PointerEvent) => {
      try {
        if (this.container.hasPointerCapture?.(event.pointerId)) {
          this.container.releasePointerCapture(event.pointerId);
        }
      } catch { }

      if (this.isDragging && this.dragStart.pointerId === event.pointerId) {
        this.isDragging = false;
        this.cursorEl?.classList.remove("drag");
      }
    };

    this.onWheel = (event: WheelEvent) => {
      if (this.lbOpen) return;
      this.setMotionTarget(this.targetOffset - event.deltaY * WHEEL_MULTIPLIER);
    };

    // Context Loss & Recovery
    this.onContextLost = (event: Event) => {
      event.preventDefault();
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
    };

    this.onContextRestored = () => {
      if (!this.animFrameId) {
        this._lastFrameTime = 0;
        this.startRenderLoop();
      }
    };

    // Tab Visibility Recovery
    this.onVisibilityChange = () => {
      if (document.hidden) {
        if (this.animFrameId) {
          cancelAnimationFrame(this.animFrameId);
          this.animFrameId = null;
        }
      } else {
        if (!this.animFrameId) {
          this._lastFrameTime = 0;
          this.startRenderLoop();
        }
      }
    };

    this.container.addEventListener("pointerdown", this.onPointerDown);
    this.container.addEventListener("pointermove", this.onPointerMove);
    this.container.addEventListener("pointerup", this.onPointerUp);
    this.container.addEventListener("pointercancel", this.onPointerCancel);
    this.container.addEventListener("wheel", this.onWheel, { passive: true });

    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  public destroy() {
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeObserver?.disconnect();

    if (this.canvas) {
      if (this.onContextLost) this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
      if (this.onContextRestored) this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    }

    if (typeof document !== "undefined" && this.onVisibilityChange) {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }

    if (this.container) {
      if (this.onPointerDown) this.container.removeEventListener("pointerdown", this.onPointerDown);
      if (this.onPointerMove) this.container.removeEventListener("pointermove", this.onPointerMove);
      if (this.onPointerUp) this.container.removeEventListener("pointerup", this.onPointerUp);
      if (this.onPointerCancel) this.container.removeEventListener("pointercancel", this.onPointerCancel);
      if (this.onWheel) this.container.removeEventListener("wheel", this.onWheel);
    }

    this.stopMotion();

    this.cardMeshes.forEach((card) => {
      card.destroy();
    });

    try {
      (this.planeGeometry as any)?.remove?.();
    } catch { }

    const gl = this.renderer?.gl;
    const loseContext = gl?.getExtension("WEBGL_lose_context");
    if (loseContext) loseContext.loseContext();
  }
}
