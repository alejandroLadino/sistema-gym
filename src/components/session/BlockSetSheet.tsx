"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconPlus, IconTrash } from "@/components/icons";
import { formatSequence, formatStep, MAX_BLOCKS } from "@/lib/blocks";
import { newKey, parseBlocks, type DraftBlock, type DraftBlocks } from "@/lib/session-draft";
import { parseReps, parseWeight } from "@/lib/validation";
import { useVisualViewport } from "@/lib/use-visual-viewport";

type Props = {
  exerciseName: string;
  /** Secuencia inicial (la última usada, la planificada o vacía). */
  initial: DraftBlocks;
  /** Al agregar: cuántas series (por defecto 1). Al editar una serie: null (no se muestra). */
  initialCount: number | null;
  title: string;
  /** Aclaración opcional bajo el título (p. ej., «Secuencia planificada de la rutina»). */
  notice?: string;
  onSubmit: (blocks: DraftBlocks, count: number) => void;
  onClose: () => void;
};

/** Secuencia vacía: el panel ofrece «+ Repeticiones», «+ Sostén» y el atajo «Reps + sostén». */
export const emptyBlocks = (): DraftBlocks => ({ rounds: "1", items: [] });

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Texto de la fila de un paso con lo escrito hasta ahora («7 reps a 40 kg», «Sostener 7 s»). */
function stepLabel(b: DraftBlock): string {
  const raw = b.value.trim();
  const weight = parseWeight(b.weight);
  const w = weight.ok ? weight.value : null;
  if (b.type === "hold") {
    const secs = /^\d{1,4}$/.test(raw) ? Number(raw) : null;
    return secs ? formatStep({ type: "hold", seconds: secs, weight_kg: w }) : "Sostener · faltan los segundos";
  }
  const reps = parseReps(raw);
  return reps.ok ? formatStep({ type: "reps", reps: reps.value, weight_kg: w }) : "Repeticiones · faltan las reps";
}

/**
 * Serie por bloques: pasos en filas compactas y numeradas (se tocan para editar su
 * valor y su peso opcional), «Vueltas por serie» (veces que se repite la secuencia
 * dentro de la serie) y, al agregar, «Series a agregar».
 */
export function BlockSetSheet({ exerciseName, initial, initialCount, title, notice, onSubmit, onClose }: Props) {
  const [items, setItems] = useState<DraftBlock[]>(initial.items);
  const [rounds, setRounds] = useState(initial.rounds || "1");
  const [count, setCount] = useState(String(initialCount ?? 1));
  // Paso abierto para editar (solo uno a la vez). Una secuencia nueva abre el primero.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusKey = useRef<string | null>(null);
  useVisualViewport(backdropRef);

  useEffect(() => {
    titleRef.current?.focus();
    bodyRef.current?.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Al abrir un paso nuevo, el foco va a su valor (sin que el encabezado lo tape).
  useEffect(() => {
    const k = focusKey.current;
    if (!k || k !== openKey) return;
    focusKey.current = null;
    const input = document.getElementById(`paso-valor-${k}`) as HTMLInputElement | null;
    input?.focus({ preventScroll: true });
    input?.closest("li")?.scrollIntoView({ block: "nearest" });
  }, [openKey, items]);

  const adding = initialCount !== null;
  const parsed = parseBlocks({ rounds, items });
  const countN = /^\d{1,2}$/.test(count.trim()) ? Number(count) : NaN;
  const countOk = !adding || (countN >= 1 && countN <= 20);
  const sequence = parsed.ok ? formatSequence(parsed.set.blocks!, parsed.set.rounds ?? 1) : null;
  const n = countOk ? countN : 1;

  const update = (key: string, patch: Partial<DraftBlock>) => setItems((xs) => xs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  function add(type: "reps" | "hold") {
    // Un paso nuevo parte del último del mismo tipo (valor y peso), editable.
    const last = [...items].reverse().find((b) => b.type === type);
    const step: DraftBlock = { key: newKey(), type, value: last?.value ?? "", weight: last?.weight ?? "" };
    setItems((xs) => [...xs, step]);
    focusKey.current = step.key;
    setOpenKey(step.key);
  }

  function addPair() {
    // Atajo: un paso de reps seguido de un sostén, ambos editables.
    const reps: DraftBlock = { key: newKey(), type: "reps", value: "", weight: "" };
    const hold: DraftBlock = { key: newKey(), type: "hold", value: "", weight: "" };
    setItems([reps, hold]);
    focusKey.current = reps.key;
    setOpenKey(reps.key);
  }

  function submit() {
    if (!parsed.ok || !countOk) {
      setShowErrors(true);
      // Abre el primer paso con error para corregirlo.
      if (!parsed.ok) {
        const bad = items.find((b) => parsed.blockErrors[b.key]);
        if (bad) setOpenKey(bad.key);
      }
      return;
    }
    onSubmit({ rounds: rounds.trim(), items }, adding ? countN : 1);
  }

  return (
    <div className="sheet-backdrop" ref={backdropRef} onClick={onClose}>
      <div
        className="sheet form-sheet block-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bloques-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between sheet-head">
          <h2 id="bloques-titulo" ref={titleRef} tabIndex={-1}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
        </div>

        <div className="sheet-body" ref={bodyRef}>
          <p className="muted small" style={{ margin: 0 }}>
            {notice ?? `${exerciseName}: agrega los pasos en el orden en que los haces. Toca un paso para cambiarlo.`}
          </p>

          {items.length ? (
            <ol className="step-list" aria-label="Pasos de la serie">
              {items.map((b, i) => {
                const num = i + 1;
                const open = openKey === b.key;
                const err = showErrors && !parsed.ok ? parsed.blockErrors[b.key] : undefined;
                const label = stepLabel(b);
                return (
                  <li key={b.key} className="step" data-open={open || undefined} data-error={err ? true : undefined}>
                    <button
                      type="button"
                      className="step-row"
                      aria-expanded={open}
                      aria-controls={`paso-${b.key}`}
                      aria-label={`Paso ${num}: ${label}`}
                      onClick={() => setOpenKey(open ? null : b.key)}
                    >
                      <span className="step-text" aria-hidden="true">{num} · {label}</span>
                      <span className="step-chevron" aria-hidden="true"><IconChevronDown /></span>
                    </button>
                    {open ? (
                      <div id={`paso-${b.key}`} className="step-edit">
                        <label className="field">
                          <span>{b.type === "reps" ? "Reps" : "Segundos"}</span>
                          <input
                            id={`paso-valor-${b.key}`}
                            className="input"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            enterKeyHint="next"
                            aria-label={b.type === "reps" ? `Repeticiones del paso ${num}` : `Segundos del paso ${num}`}
                            aria-invalid={err ? true : undefined}
                            value={b.value}
                            onChange={(e) => update(b.key, { value: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Peso (kg)</span>
                          <input
                            className="input"
                            inputMode="decimal"
                            autoComplete="off"
                            enterKeyHint="done"
                            placeholder="opcional"
                            aria-label={`Peso del paso ${num} (kg, opcional)`}
                            aria-invalid={err ? true : undefined}
                            value={b.weight}
                            onChange={(e) => update(b.key, { weight: e.target.value })}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          aria-label={`Quitar paso ${num}`}
                          onClick={() => {
                            setItems((xs) => xs.filter((x) => x.key !== b.key));
                            setOpenKey(null);
                          }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    ) : null}
                    {err ? <p className="field-error step-error" role="alert">{err}</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <button type="button" className="btn btn-primary btn-block step-pair" onClick={addPair}>
              <IconPlus /> Reps + sostén
            </button>
          )}

          <div className="step-add">
            <button
              type="button"
              className="btn"
              disabled={items.length >= MAX_BLOCKS}
              aria-label="Agregar paso de repeticiones"
              onClick={() => add("reps")}
            >
              <IconPlus /> Repeticiones
            </button>
            <button
              type="button"
              className="btn"
              disabled={items.length >= MAX_BLOCKS}
              aria-label="Agregar paso de sostén"
              onClick={() => add("hold")}
            >
              <IconPlus /> Sostén
            </button>
          </div>

          <div className={adding ? "block-counts" : "block-counts single"}>
            <label className="field">
              <span>Vueltas por serie</span>
              <input
                className="input"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={rounds}
                aria-describedby="bloques-vueltas-ayuda"
                onChange={(e) => setRounds(e.target.value)}
              />
              <span id="bloques-vueltas-ayuda" className="muted small">Veces seguidas que haces todos los pasos.</span>
            </label>
            {adding ? (
              <label className="field">
                <span>Series a agregar</span>
                <input
                  className="input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={count}
                  aria-invalid={showErrors && !countOk ? true : undefined}
                  aria-describedby="bloques-series-ayuda"
                  onChange={(e) => setCount(e.target.value)}
                />
                <span id="bloques-series-ayuda" className="muted small">Con descanso entre una y otra.</span>
              </label>
            ) : null}
          </div>

          {showErrors && !parsed.ok && !Object.keys(parsed.blockErrors).length ? (
            <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{parsed.error}</p>
          ) : null}
          {showErrors && !countOk ? <p className="alert alert-error" role="alert" style={{ margin: 0 }}>Series a agregar: de 1 a 20</p> : null}
        </div>

        <div className="sheet-foot block-foot">
          <p className="block-preview" aria-live="polite">
            {sequence ? (adding ? `${plural(n, "serie", "series")} de ${sequence}` : sequence) : "Agrega al menos un paso"}
          </p>
          <button type="button" className="btn btn-primary btn-block" onClick={submit}>
            {adding ? `Agregar ${plural(n, "serie", "series")}` : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
