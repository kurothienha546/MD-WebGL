import gsap from "gsap";

export class LightboxStack {
  public slideProgress = { current: 1 };
  public lastDir: 1 | -1 = 1;
  public prevIdx: number | null = null;
  public activeIdx = 0;

  private activeTween: gsap.core.Tween | null = null;

  public pushSlide(newIndex: number, isReducedMotion = false, dir?: 1 | -1) {
    if (this.activeIdx === newIndex) return;

    const prevIndex = this.activeIdx;
    this.prevIdx = prevIndex;
    this.activeIdx = newIndex;

    this.lastDir = dir ?? (newIndex > prevIndex ? 1 : -1);
    this.slideProgress.current = 0;

    // Hủy tween cũ nếu đang chạy dở
    this.activeTween?.kill();

    this.activeTween = gsap.to(this.slideProgress, {
      current: 1,
      duration: isReducedMotion ? 0.2 : 0.74,
      ease: "power4.out",
      onComplete: () => {
        this.activeTween = null;
      },
    });
  }

  public reset(initialIndex: number) {
    this.activeTween?.kill();
    this.activeTween = null;

    this.activeIdx = initialIndex;
    this.slideProgress.current = 1;
    this.prevIdx = null;
    this.lastDir = 1;
  }

  public destroy() {
    this.activeTween?.kill();
    this.activeTween = null;
  }
}