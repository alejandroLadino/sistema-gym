"use client";

import { useState } from "react";
import { IconCheck, IconPlus } from "@/components/icons";
import type { LoadMode } from "@/lib/session-draft";

export const LOAD_OPTIONS: { id: LoadMode; label: string }[] = [
  { id: "weight", label: "Con peso" },
  { id: "bar", label: "Solo barra" },
  { id: "body", label: "Peso corporal" },
];

export const loadLabel = (mode: LoadMode | undefined) =>
  LOAD_OPTIONS.find((o) => o.id === mode)?.label ?? "Sin indicar";

/**
 * Selector compacto de «Carga» (grupo de opciones). Sin valor = registro anterior sin
 * modo: no se marca ninguna opción hasta que la persona elija una.
 */
export function LoadPicker({
  value,
  onChange,
  label,
}: {
  value: LoadMode | undefined;
  onChange: (mode: LoadMode) => void;
  /** Etiqueta accesible del grupo (p. ej., «Carga de la serie 2 de Press»). */
  label: string;
}) {
  return (
    <div className="load-picker-wrap">
      <span className="load-picker-title" aria-hidden="true">Carga</span>
      <div className="load-picker" role="radiogroup" aria-label={label}>
        {LOAD_OPTIONS.map((o) => {
          const checked = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={checked}
              className="load-option"
              onClick={() => onChange(o.id)}
            >
              {checked ? <IconCheck /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * «Solo barra»: el peso de la barra es opcional. Se ofrece como acción secundaria
 * («+ Indicar peso de la barra») y, si se abre o ya tiene valor, muestra el campo.
 * Vacío = carga desconocida.
 */
export function BarWeightField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Etiqueta accesible del campo. */
  label: string;
}) {
  const [open, setOpen] = useState(value.trim() !== "");
  if (!open && value.trim() === "") {
    return (
      <button type="button" className="bar-weight-add" aria-label={`Indicar peso de la barra: ${label}`} onClick={() => setOpen(true)}>
        <IconPlus /> Indicar peso de la barra
      </button>
    );
  }
  return (
    <label className="field bar-weight-field">
      <span>Peso de la barra (kg, opcional)</span>
      <input
        className="input"
        inputMode="decimal"
        autoComplete="off"
        placeholder="—"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={value.trim() === ""}
      />
    </label>
  );
}
