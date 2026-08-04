"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE_SELECTOR = "a, button, select, label, [role='button'], [role='link']";
const TEXT_SELECTOR =
  "input:not([type='checkbox']):not([type='radio']):not([type='range']), textarea, [contenteditable='true']";

export function CustomCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cursor = cursorRef.current;
    const precisePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    if (!cursor) return;
    if (!precisePointer.matches || reducedMotion.matches) return;

    const activeCursor: HTMLDivElement = cursor;
    const root = document.documentElement;
    let animationFrame = 0;

    function hideCursor() {
      activeCursor.classList.remove("is-visible", "is-interactive", "is-pressed");
    }

    function handlePointerMove(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const overText = Boolean(target?.closest(TEXT_SELECTOR));
      const interactive = !overText && Boolean(target?.closest(INTERACTIVE_SELECTOR));

      activeCursor.classList.toggle("is-interactive", interactive);
      activeCursor.classList.toggle("is-over-text", overText);
      activeCursor.classList.add("is-visible");

      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        activeCursor.style.setProperty("--cursor-x", `${event.clientX}px`);
        activeCursor.style.setProperty("--cursor-y", `${event.clientY}px`);
      });
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.relatedTarget === null) hideCursor();
    }

    function handlePointerDown() {
      activeCursor.classList.add("is-pressed");
    }

    function handlePointerUp() {
      activeCursor.classList.remove("is-pressed");
    }

    function handleAccessibilityChange() {
      if (reducedMotion.matches || !precisePointer.matches) {
        root.classList.remove("custom-cursor-enabled");
        hideCursor();
      }
    }

    root.classList.add("custom-cursor-enabled");
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerout", handlePointerOut, { passive: true });
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("pointerup", handlePointerUp, { passive: true });
    window.addEventListener("blur", hideCursor);
    precisePointer.addEventListener("change", handleAccessibilityChange);
    reducedMotion.addEventListener("change", handleAccessibilityChange);

    return () => {
      root.classList.remove("custom-cursor-enabled");
      if (animationFrame) cancelAnimationFrame(animationFrame);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("blur", hideCursor);
      precisePointer.removeEventListener("change", handleAccessibilityChange);
      reducedMotion.removeEventListener("change", handleAccessibilityChange);
    };
  }, []);

  return <div aria-hidden="true" className="custom-cursor" ref={cursorRef} />;
}
