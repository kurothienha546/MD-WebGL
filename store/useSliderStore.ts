"use client";
import { create } from 'zustand'

interface SliderState {
  activeIndex: number;
  lbOpen: boolean;
  lbIndex: number;
  snapOffset: number | null;
  setActiveIndex: (idx: number) => void;
  setLbOpen: (open: boolean) => void;
  setLbIndex: (idx: number) => void;
  setSnapOffset: (offset: number | null) => void;
}

export const useSliderStore = create<SliderState>((set) => ({
  activeIndex: 0,
  lbOpen: false,
  lbIndex: 0,
  snapOffset: null,
  setActiveIndex: (idx) => set({ activeIndex: idx }),
  setLbOpen: (open) => set({ lbOpen: open }),
  setLbIndex: (idx) => set({ lbIndex: idx }),
  setSnapOffset: (offset) => set({ snapOffset: offset }),
}));