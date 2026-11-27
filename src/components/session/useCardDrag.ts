"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/**
 * Reordenar tarjetas por arrastre desde un tirador (Pointer Events: Safari en iPhone,
 * Android y escritorio).
 *  - Táctil: se activa al mantener presionado el tirador ~250 ms; si el dedo se mueve
 *    antes, no se activa. El tirador usa `touch-action: none`; fuera de él el scroll es normal.
 *  - Mouse: se activa al mover el puntero unos píxeles con el botón presionado.
 *  - Durante el arrastre la tarjeta sigue al dedo, las demás se desplazan para abrir el
 *    hueco donde quedará y la página se desplaza sola cerca de los bordes.
 *  - Al soltar se llama a `onDrop(clave, índiceFinal)`. Escape, `pointercancel` o perder
 *    el foco de la ventana cancelan sin cambiar el orden.
 */

export const LONG_PRESS_MS = 250;
const MOVE_TOLERANCE = 10;
const EDGE = 72;
const MAX_SPEED = 16;

type Measure = { key: string; top: number; height: number };

export type DragState = {
  key: string;
  from: number;
  target: number;
  /** Desplazamiento de la tarjeta arrastrada (px, coordenadas del documento). */
  dy: number;
  /** Alto de la tarjeta arrastrada más la separación entre tarjetas. */
  slot: number;
  /** Hueco donde quedará (relativo a la lista) para dibujar el marcador. */
  slotTop: number;
  slotHeight: number;
};

/** Índice final de la tarjeta según el centro arrastrado (entre las demás). */
export function dropIndex(measures: Measure[], from: number, center: number): number {
  let target = 0;
  measures.forEach((m, i) => {
    if (i !== from && m.top + m.height / 2 < center) target += 1;
  });
  return target;
}

/** Desplazamiento de una tarjeta no arrastrada para abrir el hueco. */
export function shiftFor(index: number, from: number, target: number, slot: number): number {
  if (index === from) return 0;
  if (from < target && index > from && index <= target) return -slot;
  if (target < from && index >= target && index < from) return slot;
  return 0;
}

export function useCardDrag({
  keys,
  cardId,
  listId,
  onDrop,
}: {
  keys: string[];
  /** id del contenedor de las tarjetas (referencia para el marcador del hueco). */
  listId: string;
  /** id del elemento DOM de cada tarjeta. */
  cardId: (key: string) => string;
  onDrop: (key: string, to: number) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const measures = useRef<Measure[]>([]);
  const start = useRef<{ key: string; pointerId: number; x: number; y: number; docY: number; type: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastClientY = useRef(0);
  const raf = useRef<number | null>(null);
  const handleEl = useRef<HTMLElement | null>(null);
  const onDropRef = useRef(onDrop);
  const keysRef = useRef(keys);
  const listTop = useRef(0);
  useEffect(() => {
    onDropRef.current = onDrop;
    keysRef.current = keys;
  });

  const setBoth = (d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const stopLoop = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const end = useCallback((commit: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stopLoop();
    const d = dragRef.current;
    const s = start.current;
    const el = handleEl.current;
    // Primero se limpia el estado: soltar la captura dispara «lostpointercapture».
    start.current = null;
    handleEl.current = null;
    setBoth(null);
    document.documentElement.classList.remove("is-dragging-card");
    if (s && el?.hasPointerCapture?.(s.pointerId)) el.releasePointerCapture(s.pointerId);
    if (commit && d && d.target !== d.from) onDropRef.current(d.key, d.target);
  }, []);

  /** Recalcula la posición con el último puntero (también tras el scroll automático). */
  const recompute = useCallback(() => {
    const d = dragRef.current;
    const s = start.current;
    if (!d || !s) return;
    const docY = lastClientY.current + window.scrollY;
    const dy = docY - s.docY;
    const m = measures.current;
    const dragged = m[d.from];
    const target = dropIndex(m, d.from, dragged.top + dragged.height / 2 + dy);
    const slotTop =
      (target <= d.from ? m[target].top : m[target].top + m[target].height - dragged.height) - listTop.current;
    if (target !== d.target || dy !== d.dy) setBoth({ ...d, dy, target, slotTop });
  }, []);

  /** Desplaza la página cerca de los bordes (encabezado fijo arriba, barra inferior abajo). */
  const autoScroll = useCallback(() => {
    const y = lastClientY.current;
    const head = document.querySelector(".session-head")?.getBoundingClientRect().bottom ?? 0;
    const nav = document.querySelector(".bottom-nav") as HTMLElement | null;
    const navRect = nav?.getBoundingClientRect();
    const bottomLimit = navRect && navRect.top > window.innerHeight / 2 ? navRect.top : window.innerHeight;
    let v = 0;
    if (y < head + EDGE) v = -MAX_SPEED * Math.min(1, (head + EDGE - y) / EDGE);
    else if (y > bottomLimit - EDGE) v = MAX_SPEED * Math.min(1, (y - (bottomLimit - EDGE)) / EDGE);
    if (v !== 0) {
      const before = window.scrollY;
      window.scrollBy(0, v);
      if (window.scrollY !== before) recompute();
    }
  }, [recompute]);

  const activate = useCallback(() => {
    const s = start.current;
    if (!s) return;
    const scrollY = window.scrollY;
    listTop.current = (document.getElementById(listId)?.getBoundingClientRect().top ?? 0) + scrollY;
    measures.current = keysRef.current.map((k) => {
      const r = document.getElementById(cardId(k))?.getBoundingClientRect();
      return { key: k, top: (r?.top ?? 0) + scrollY, height: r?.height ?? 0 };
    });
    const from = keysRef.current.indexOf(s.key);
    if (from < 0) return;
    const m = measures.current;
    const gap = m.length > 1 ? Math.max(0, m[1].top - (m[0].top + m[0].height)) : 12;
    document.documentElement.classList.add("is-dragging-card");
    setBoth({
      key: s.key,
      from,
      target: from,
      dy: 0,
      slot: m[from].height + gap,
      slotTop: m[from].top - listTop.current,
      slotHeight: m[from].height,
    });
    try {
      navigator.vibrate?.(8);
    } catch {}
    const tick = () => {
      autoScroll();
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [cardId, listId, autoScroll]);

  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && end(false);
    const onBlur = () => end(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [drag, end]);

  useEffect(() => () => end(false), [end]);

  const handleProps = (key: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || start.current) return;
      handleEl.current = e.currentTarget;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      start.current = { key, pointerId: e.pointerId, x: e.clientX, y: e.clientY, docY: e.clientY + window.scrollY, type: e.pointerType };
      lastClientY.current = e.clientY;
      if (e.pointerType !== "mouse") timer.current = setTimeout(activate, LONG_PRESS_MS);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || e.pointerId !== s.pointerId) return;
      lastClientY.current = e.clientY;
      if (!dragRef.current) {
        const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
        if (s.type === "mouse") {
          if (moved > 4) activate();
        } else if (moved > MOVE_TOLERANCE) {
          // Se movió antes de completar la presión larga: no es un arrastre.
          end(false);
        }
        return;
      }
      e.preventDefault();
      recompute();
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      if (start.current && e.pointerId === start.current.pointerId) end(true);
    },
    onPointerCancel: () => end(false),
    onLostPointerCapture: () => {
      if (dragRef.current) end(false);
    },
    onContextMenu: (e: ReactMouseEvent) => e.preventDefault(),
  });

  const styleFor = (key: string, index: number): CSSProperties | undefined => {
    if (!drag) return undefined;
    if (key === drag.key) return { transform: `translateY(${drag.dy}px)` };
    const shift = shiftFor(index, drag.from, drag.target, drag.slot);
    return shift ? { transform: `translateY(${shift}px)` } : undefined;
  };

  return { drag, handleProps, styleFor, cancel: () => end(false) };
}
