"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import CustomCursor from "@/components/CustomCursor";
import Header from "@/components/Header";
import Gallery from "@/components/Gallery";
import Footer from "@/components/Footer";
import DragHint from "@/components/DragHint";
import Lightbox from "@/components/Lightbox";
import { useLightboxAnimation } from "@/hooks/useLightboxAnimation";

export default function Home() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lbOpen, setLbOpen] = useState(false);
  const snapRef = useRef<number | null>(null);

  const handleActiveIndexChange = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const handleLightboxStateChange = useCallback((open: boolean) => {
    setLbOpen(open);
  }, []);

  const lightbox = useLightboxAnimation(
    snapRef,
    undefined,
    handleActiveIndexChange,
    handleLightboxStateChange
  );

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest("nav a, #lightbox-close");
      if (!target) return;
      if (lbOpen && target.id !== "lightbox-close") return;
      document.getElementById("cursor")?.classList.add("hover");
    };

    const onOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest("nav a, #lightbox-close");
      if (!target) return;
      document.getElementById("cursor")?.classList.remove("hover");
    };

    window.addEventListener("mouseover", onOver);
    window.addEventListener("mouseout", onOut);

    return () => {
      window.removeEventListener("mouseover", onOver);
      window.removeEventListener("mouseout", onOut);
    };
  }, [lbOpen]);

  return (
    <main className="relative w-full h-screen overflow-hidden bg-bg">
      <CustomCursor />
      <Header lbOpen={lbOpen} />
      <Gallery
        snapRef={snapRef}
        openLightbox={lightbox.openLightbox}
        engineRef={lightbox.engineRef}
        onActiveIndexChange={handleActiveIndexChange}
        onLightboxStateChange={handleLightboxStateChange}
      />
      <DragHint />
      <Footer activeIndex={activeIndex} lbOpen={lbOpen} />
      <Lightbox animation={lightbox} />
    </main>
  );
}