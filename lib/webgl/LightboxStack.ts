import gsap from "gsap";
import { works } from "@/lib/works";

export interface StackEntry {
  index: number;
  zLayer: number;
}

export class LightboxStack {
  public stack: StackEntry[] = [];
  public maxStack = 5;
  public slideProgress = { current: 1 };
  public lastDir: 1 | -1 = 1;
  public prevIdx: number | null = null;

  public pushSlide(newIndex: number, isReducedMotion = false, dir?: 1 | -1) {
    if (this.stack.length && this.stack[this.stack.length - 1].index === newIndex) {
      return;
    }

    const prevIndex = this.stack.length ? this.stack[this.stack.length - 1].index : newIndex;
    const existingIdx = this.stack.findIndex((s) => s.index === newIndex);

    if (dir !== undefined) {
      this.lastDir = dir;
    } else {
      const N = works.length;
      const diff = (newIndex - prevIndex + N) % N;
      this.lastDir = diff === 1 || diff < N / 2 ? 1 : -1;
    }
    this.prevIdx = prevIndex;

    if (existingIdx !== -1) {
      this.stack.splice(existingIdx, 1);
    }

    this.stack.push({ index: newIndex, zLayer: 50 });

    if (this.stack.length > this.maxStack) {
      this.stack.shift();
    }

    // Re-assign Z layers from bottom to top
    this.stack.forEach((entry, i) => {
      entry.zLayer = 50 - (this.stack.length - 1 - i);
    });

    this.slideProgress.current = 0;
    gsap.to(this.slideProgress, {
      current: 1,
      duration: isReducedMotion ? 0.2 : 0.74,
      ease: "power4.out",
      overwrite: true,
    });
  }

  public reset(initialIndex: number) {
    this.stack = [{ index: initialIndex, zLayer: 50 }];
    this.slideProgress.current = 1;
    this.prevIdx = null;
    this.lastDir = 1;
  }

  public getEntry(index: number): StackEntry | undefined {
    return this.stack.find((s) => s.index === index);
  }

  public isTop(index: number): boolean {
    if (!this.stack.length) return false;
    return this.stack[this.stack.length - 1].index === index;
  }
}
