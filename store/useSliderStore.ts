"use client";
import { create } from 'zustand'

interface SliderState {
  activeIndex: number;
  lbOpen: boolean;
  lbIndex: number;
  lbDirection: 1 | -1;
  snapOffset: number | null;
  setActiveIndex: (idx: number) => void;
  setLbOpen: (open: boolean) => void;
  setLbIndex: (idx: number, dir?: 1 | -1) => void;
  setSnapOffset: (offset: number | null) => void;
}

export const useSliderStore = create<SliderState>((set) => ({
  activeIndex: 0,
  lbOpen: false,
  lbIndex: 0,
  lbDirection: 1,
  snapOffset: null,
  setActiveIndex: (idx) => set({ activeIndex: idx }),
  setLbOpen: (open) => set({ lbOpen: open }),
  setLbIndex: (idx, dir = 1) => set({ lbIndex: idx, lbDirection: dir }),
  setSnapOffset: (offset) => set({ snapOffset: offset }),
}));