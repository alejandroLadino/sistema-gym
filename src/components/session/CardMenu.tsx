"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconChevronDown, IconMore, IconTrash } from "@/components/icons";

export type CardMenuItem = { label: string; icon?: React.ReactNode; onSelect: () => void };

/** Menú «⋯» de una tarjeta de ejercicio: mover (alternativa accesible al arrastre), acciones extra y quitar. */
export function CardMenu({
  exerciseName,
  onRemove,
  onMoveUp,
  onMoveDown,
  extra = [],
}: {
  exerciseName: string;
  onRemove: () => void;
  /** Acciones adicionales (p. ej., «Alternar con otro ejercicio»), antes de «Quitar». */
  extra?: CardMenuItem[];
  /** null: no se puede mover en esa dirección (primero / último). */
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
}) {
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
          {onMoveUp ? (
            <button
              ref={firstItemRef}
              type="button"
              role="menuitem"
              className="card-menu-item"
              onClick={() => {
                setOpen(false);
                onMoveUp();
              }}
            >
              <span className="icon-up" aria-hidden="true"><IconChevronDown /></span> Mover arriba
            </button>
          ) : null}
          {onMoveDown ? (
            <button
              ref={onMoveUp ? undefined : firstItemRef}
              type="button"
              role="menuitem"
              className="card-menu-item"
              onClick={() => {
                setOpen(false);
                onMoveDown();
              }}
            >
              <IconChevronDown /> Mover abajo
            </button>
          ) : null}
          {extra.map((item, i) => (
            <button
              key={item.label}
              ref={!onMoveUp && !onMoveDown && i === 0 ? firstItemRef : undefined}
              type="button"
              role="menuitem"
              className="card-menu-item"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ?? null} {item.label}
            </button>
          ))}
          <button
            ref={onMoveUp || onMoveDown || extra.length ? undefined : firstItemRef}
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
