"use client";

import { useEffect, useRef, useState } from "react";
import { IconPlus, IconTrash } from "@/components/icons";
import { formatSequence, MAX_BLOCKS } from "@/lib/blocks";
import { newKey, parseBlocks, type DraftBlock, type DraftBlocks } from "@/lib/session-draft";
import { useVisualViewport } from "@/lib/use-visual-viewport";

type Props = {
  exerciseName: string;
  /** Secuencia inicial (la última usada, la planificada o un bloque vacío). */
  initial: DraftBlocks;
  /** Al agregar: cuántas series (por defecto 1). Al editar una serie: null (no se muestra). */
  initialCount: number | null;
  title: string;
  /** Aclaración opcional bajo el título (p. ej., «Secuencia planificada de la rutina»). */
  notice?: string;
  onSubmit: (blocks: DraftBlocks, count: number) => void;
  onClose: () => void;
};

export const emptyBlocks = (): DraftBlocks => ({ rounds: "1", items: [{ key: newKey(), type: "reps", value: "", weight: "" }] });

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Configura una serie por bloques: secuencia ordenada de bloques («Repeticiones» o
 * «Sostener», peso opcional), cuántas veces se repite la secuencia DENTRO de la serie
 * y, al agregar, cuántas series iguales se agregan.
 */
export function BlockSetSheet({ exerciseName, initial, initialCount, title, notice, onSubmit, onClose }: Props) {
  const [items, setItems] = useState<DraftBlock[]>(initial.items.length ? initial.items : emptyBlocks().items);
  const [rounds, setRounds] = useState(initial.rounds || "1");
  const [count, setCount] = useState(String(initialCount ?? 1));
  const [showErrors, setShowErrors] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useVisualViewport(backdropRef);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const adding = initialCount !== null;
  const parsed = parseBlocks({ rounds, items });
  const countN = /^\d{1,2}$/.test(count.trim()) ? Number(count) : NaN;
  const countOk = !adding || (countN >= 1 && countN <= 20);
  const preview = parsed.ok ? formatSequence(parsed.set.blocks!, parsed.set.rounds ?? 1) : null;

  const update = (key: string, patch: Partial<DraftBlock>) => setItems((xs) => xs.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  function submit() {
    if (!parsed.ok || !countOk) {
      setShowErrors(true);
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

        <div className="sheet-body">
          <p className="muted small" style={{ margin: 0 }}>
            {notice ?? `${exerciseName}: arma la secuencia en el orden en que la haces. Deja el peso vacío si no usas carga.`}
          </p>

          <ol className="block-list" aria-label="Secuencia de la serie">
            {items.map((b, i) => {
              const err = showErrors && !parsed.ok ? parsed.blockErrors[b.key] : undefined;
              const n = i + 1;
              return (
                <li key={b.key} className="block-item">
                  <div className="block-item-head">
                    <span className="routine-ex-pos" aria-hidden="true">{n}</span>
                    <div className="segmented" role="group" aria-label={`Tipo del bloque ${n}`}>
                      <button type="button" aria-pressed={b.type === "reps"} onClick={() => update(b.key, { type: "reps" })}>
                        Repeticiones
                      </button>
                      <button type="button" aria-pressed={b.type === "hold"} onClick={() => update(b.key, { type: "hold" })}>
                        Sostener
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      aria-label={`Quitar bloque ${n}`}
                      disabled={items.length === 1}
                      onClick={() => setItems((xs) => xs.filter((x) => x.key !== b.key))}
                    >
                      <IconTrash />
                    </button>
                  </div>
                  <div className="block-item-fields">
                    <label className="field">
                      <span>{b.type === "reps" ? "Reps" : "Segundos"}</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        aria-label={b.type === "reps" ? `Repeticiones del bloque ${n}` : `Segundos del bloque ${n}`}
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
                        placeholder="—"
                        aria-label={`Peso del bloque ${n} (kg, opcional)`}
                        aria-invalid={err ? true : undefined}
                        value={b.weight}
                        onChange={(e) => update(b.key, { weight: e.target.value })}
                      />
                    </label>
                  </div>
                  {err ? <p className="field-error" role="alert" style={{ margin: 0 }}>{err}</p> : null}
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="btn btn-block"
            disabled={items.length >= MAX_BLOCKS}
            onClick={() => {
              const last = items.at(-1);
              setItems((xs) => [...xs, { key: newKey(), type: last?.type ?? "reps", value: last?.value ?? "", weight: last?.weight ?? "" }]);
            }}
          >
            <IconPlus /> Agregar bloque
          </button>

          <div className={adding ? "block-counts" : "block-counts single"}>
            <label className="field">
              <span>Repetir secuencia dentro de la serie</span>
              <input
                className="input"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                value={rounds}
                aria-describedby="bloques-ciclos-ayuda"
                onChange={(e) => setRounds(e.target.value)}
              />
              <span id="bloques-ciclos-ayuda" className="muted small">Veces seguidas que haces toda la secuencia en una serie.</span>
            </label>
            {adding ? (
              <label className="field">
                <span>Cantidad de series</span>
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
                <span id="bloques-series-ayuda" className="muted small">Series iguales que se agregan (descansas entre ellas).</span>
              </label>
            ) : null}
          </div>

          {showErrors && !parsed.ok ? <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{parsed.error}</p> : null}
          {showErrors && !countOk ? <p className="alert alert-error" role="alert" style={{ margin: 0 }}>Cantidad de series: de 1 a 20</p> : null}
          {preview ? (
            <p className="block-preview" aria-live="polite">
              <span className="muted small">{adding ? `${plural(countN >= 1 ? countN : 1, "serie", "series")} de:` : "Serie:"}</span> {preview}
            </p>
          ) : null}
        </div>

        <div className="sheet-foot block-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {adding ? `Agregar ${plural(countOk ? countN : 1, "serie", "series")}` : "Guardar serie"}
          </button>
        </div>
      </div>
    </div>
  );
}
