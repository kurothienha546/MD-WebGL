"use client";
import { useEffect, useRef } from "react";
import CustomCursor from "@/components/CustomCursor";
import Header from "@/components/Header";
import Gallery from "@/components/Gallery";
import Footer from "@/components/Footer";
import DragHint from "@/components/DragHint";
import Lightbox from "@/components/Lightbox";
import { useLightboxAnimation } from "@/hooks/useLightboxAnimation";
import { useSliderStore } from "@/store/useSliderStore";

export default function Home() {
  const activeIndex = useSliderStore((state) => state.activeIndex);
  const snapRef = useRef<number | null>(null);
  const lightbox = useLightboxAnimation(snapRef);

  useEffect(() => {
    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest("nav a, #lightbox-close");
      if (!target) return;
      if (useSliderStore.getState().lbOpen && target.id !== "lightbox-close") return;
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
  }, []);

  return (
    <main className="relative w-full h-screen overflow-hidden bg-bg">
      <CustomCursor />
      <Header />
      <Gallery snapRef={snapRef} openLightbox={lightbox.openLightbox} />
      <DragHint />
      <Footer activeIndex={activeIndex} />
      <Lightbox animation={lightbox} />
    </main>
  );
}