"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { works } from "@/lib/works";

interface FooterProps {
  activeIndex: number;
}

export default function Footer({ activeIndex }: FooterProps) {
  const safeIdx = useMemo(() => {
    if (activeIndex < 0) return 0;
    if (activeIndex >= works.length) return works.length - 1;
    return activeIndex;
  }, [activeIndex]);

  const currentWork = works[safeIdx];
  const formattedIndex = String(safeIdx + 1).padStart(2, "0");
  const formattedTotal = String(works.length).padStart(2, "0");

  return (
    <footer
      className="fixed bottom-0 left-0 right-0 px-[52px] pb-11 flex justify-between items-end z-[200] pointer-events-none max-md:px-6 max-md:pb-6"
      style={{
        opacity: 0,
        animation: "fadeUp 1s .9s cubic-bezier(.23,1,.32,1) forwards",
      }}
    >
      {/* Caption Section */}
      <div className="caption max-w-[340px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={safeIdx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }}
          >
            {/* Label: Sand nhạt */}
            <div className="font-mono text-[0.72rem] text-[#C9B99A] tracking-[0.22em] uppercase mb-[0px]">
              {currentWork.label}
            </div>
            {/* Title: Champagne đậm, leading thoáng để f/g/y không bị cắt */}
            <div
              className="font-serif italic font-light text-[#f3eee6] leading-[1.2] tracking-[-0.015em] truncate"
              style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.7rem)" }}
            >
              {currentWork.title}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Counter Section */}
      <div className="flex items-end gap-[10px]">
        {/* Numerator: Champagne đậm */}
        <div className="relative overflow-hidden h-[3rem] w-[2.5ch] text-[2.4rem] text-[#f3eee6] leading-[3rem] font-serif italic font-light">
          <AnimatePresence mode="popLayout" custom={safeIdx}>
            <motion.div
              key={safeIdx}
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: "0%", opacity: 1 }}
              exit={{ y: "-100%", opacity: 0 }}
              transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
              className="absolute inset-0 leading-[3rem] text-left"
            >
              {formattedIndex}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Denominator: Sand nhạt */}
        <span className="font-mono text-[0.8rem] text-[#C9B99A] tracking-[0.12em] pb-[0.3rem]">
          / {formattedTotal}
        </span>
      </div>
    </footer>
  );
}