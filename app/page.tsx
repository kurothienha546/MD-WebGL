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
  const lbOpen = useSliderStore((state) => state.lbOpen);
  const lightbox = useLightboxAnimation();

  useEffect(() => {
    const addHover = (sel: string) => {
      const targets = document.querySelectorAll(sel);
      const onEnter = () => {
        if (lbOpen) return;
        document.getElementById("cursor")?.classList.add("hover");
      };
      const onLeave = () => {
        document.getElementById("cursor")?.classList.remove("hover");
      };

      targets.forEach((el) => {
        el.addEventListener("mouseenter", onEnter);
        el.addEventListener("mouseleave", onLeave);
      });

      return () => {
        targets.forEach((el) => {
          el.removeEventListener("mouseenter", onEnter);
          el.removeEventListener("mouseleave", onLeave);
        });
      };
    };

    const cleanupNav = addHover("nav a");
    const cleanupClose = addHover("#lightbox-close");

    return () => {
      cleanupNav?.();
      cleanupClose?.();
    };
  }, [lbOpen]);

  return (
    <main className="relative w-full h-screen overflow-hidden bg-bg">
      <CustomCursor />
      <Header />
      <Gallery openLightbox={lightbox.openLightbox} />
      <DragHint />
      <Footer activeIndex={activeIndex} />
      <Lightbox animation={lightbox} />
    </main>
  );
}