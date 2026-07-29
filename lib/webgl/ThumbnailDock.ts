import { works } from "@/lib/works";

export interface DockMetrics {
  thumbWidth: number;
  thumbHeight: number;
  thumbGap: number;
  dockY: number;
  dockSlotsX: number[];
  totalDockWidth: number;
  marginRight: number;
  marginBottom: number;
}

export class ThumbnailDock {
  public metrics: DockMetrics = {
    thumbWidth: 0,
    thumbHeight: 0,
    thumbGap: 0,
    dockY: 0,
    dockSlotsX: [],
    totalDockWidth: 0,
    marginRight: 0,
    marginBottom: 0,
  };

  public updateMetrics(sw: number, sh: number) {
    if (typeof window === "undefined") return;

    const isMobile = sw < 768;
    const N = works.length;

    // Compact 16:9 thumbnail dock sized to fit neatly in bottom-right without colliding with bottom-center counter
    const thumbHeight = isMobile ? Math.min(sw, sh) * 0.04 : Math.min(sw, sh) * 0.045;
    const thumbWidth = thumbHeight * (16 / 9);
    const thumbGap = isMobile ? 3 : 4;

    const totalDockWidth = N * thumbWidth + (N - 1) * thumbGap;
    const marginRight = isMobile ? 12 : Math.min(sw, sh) * 0.035;
    const marginBottom = isMobile ? 16 : Math.min(sw, sh) * 0.038;

    const dockRightmost = sw / 2 - marginRight;
    const dockLeftmost = dockRightmost - totalDockWidth;
    const dockY = -sh / 2 + marginBottom + thumbHeight / 2;

    const dockSlotsX = works.map((_, i) => dockLeftmost + i * (thumbWidth + thumbGap) + thumbWidth / 2);

    this.metrics = {
      thumbWidth,
      thumbHeight,
      thumbGap,
      dockY,
      dockSlotsX,
      totalDockWidth,
      marginRight,
      marginBottom,
    };
  }

  public getSlotAtPointer(clickX: number, clickY: number, sw: number, sh: number): number {
    const webglX = clickX - sw / 2;
    const webglY = sh / 2 - clickY;
    const { thumbWidth, thumbHeight, dockY, dockSlotsX } = this.metrics;

    let clickedIndex = -1;
    dockSlotsX.forEach((slotX, i) => {
      const left = slotX - thumbWidth / 2;
      const right = slotX + thumbWidth / 2;
      const bottom = dockY - thumbHeight / 2;
      const top = dockY + thumbHeight / 2;

      if (webglX >= left && webglX <= right && webglY >= bottom && webglY <= top) {
        clickedIndex = i;
      }
    });

    return clickedIndex;
  }
}
