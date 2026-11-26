"use client";

import { useState } from "react";
import { IconPlus } from "@/components/icons";
import { buildQuickSets, parseSetCount, type DraftSet, type QuickAddErrors } from "@/lib/session-draft";

type Props = {
  /** Clave del ejercicio en el borrador: hace únicos los ids de los campos. */
  exerciseKey: string;
  exerciseName: string;
  /** Valores iniciales de reps y peso (p. ej., los de la última serie). */
  defaults?: { reps: string; weight: string };
  onAdd: (sets: DraftSet[]) => void;
  onCancel?: () => void;
};

export const DEFAULT_QUICK_COUNT = "3";

export function quickRepsInputId(exerciseKey: string) {
  return `quick-reps-${exerciseKey}`;
}

/** «3 series × 10 reps a 40 kg» en una sola acción. */
export function QuickAddSets({ exerciseKey, exerciseName, defaults, onAdd, onCancel }: Props) {
  const [count, setCount] = useState(DEFAULT_QUICK_COUNT);
  const [reps, setReps] = useState(defaults?.reps ?? "");
  const [weight, setWeight] = useState(defaults?.weight ?? "");
  const [errors, setErrors] = useState<QuickAddErrors>({});

  const parsedCount = parseSetCount(count);
  const label = parsedCount.ok
    ? `Agregar ${parsedCount.value} ${parsedCount.value === 1 ? "serie" : "series"}`
    : "Agregar series";

  function submit() {
    const res = buildQuickSets({ count, reps, weight });
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    setErrors({});
    onAdd(res.sets);
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  const errorList = [errors.count, errors.reps, errors.weight].filter(Boolean);

  return (
    <div className="quick-add" role="group" aria-label={`Captura rápida de series de ${exerciseName}`}>
      <div className="quick-add-fields">
        <label className="field">
          <span>Series</span>
          <input
            className="input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            aria-label={`Cantidad de series de ${exerciseName}`}
            aria-invalid={errors.count ? true : undefined}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="next"
          />
        </label>
        <label className="field">
          <span>Reps</span>
          <input
            id={quickRepsInputId(exerciseKey)}
            className="input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            placeholder="—"
            aria-label={`Repeticiones por serie de ${exerciseName}`}
            aria-invalid={errors.reps ? true : undefined}
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="next"
          />
        </label>
        <label className="field">
          <span>Peso (kg)</span>
          <input
            className="input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="—"
            aria-label={`Peso por serie de ${exerciseName} (kg, vacío si es peso corporal)`}
            aria-invalid={errors.weight ? true : undefined}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            onKeyDown={onKeyDown}
            enterKeyHint="done"
          />
        </label>
      </div>
      {errorList.length ? (
        <p className="quick-add-error" role="alert">{errorList.join(" · ")}</p>
      ) : (
        <p className="hint quick-add-hint">Deja el peso vacío si es peso corporal.</p>
      )}
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={submit}>
          <IconPlus /> {label}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
      </div>
    </div>
  );
}
