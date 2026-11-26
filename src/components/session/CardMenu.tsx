"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconMore, IconTrash } from "@/components/icons";

/** Menú «⋯» de una tarjeta de ejercicio. Por ahora: «Quitar de la sesión». */
export function CardMenu({ exerciseName, onRemove }: { exerciseName: string; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="card-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label={`Acciones de ${exerciseName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <IconMore />
      </button>
      {open ? (
        <div id={menuId} className="card-menu-list" role="menu" aria-label={`Acciones de ${exerciseName}`}>
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            className="card-menu-item danger"
            onClick={() => {
              setOpen(false);
              onRemove();
            }}
          >
            <IconTrash /> Quitar de la sesión
          </button>
        </div>
      ) : null}
    </div>
  );
}
