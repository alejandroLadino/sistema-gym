"use client";

import { useEffect, type RefObject } from "react";

/**
 * Ajusta un contenedor `position: fixed` al área visible real (visualViewport).
 *
 * En Safari para iPhone el teclado no reduce el viewport de diseño: un panel fijado
 * abajo queda detrás del teclado. Con esto, el contenedor ocupa solo la parte
 * visible, de modo que el pie con las acciones queda encima del teclado y el
 * formulario se desplaza dentro del panel.
 */
export function useVisualViewport(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!el || !vv) return;

    const apply = () => {
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
      el.style.bottom = "auto";
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      el.style.top = "";
      el.style.height = "";
      el.style.bottom = "";
    };
  }, [ref]);
}
