"use client";

import { useEffect, useRef, useState } from "react";
import { getPreviousSets } from "@/app/actions/sessions";
import { IconSwap } from "@/components/icons";
import { formatDate, summarizeSets } from "@/lib/format";
import type { SwapPlan } from "@/lib/guided";
import { formatTarget, parseTarget, type Target } from "@/lib/routines";
import type { DraftExercise } from "@/lib/session-draft";
import type { Exercise, PreviousSets } from "@/lib/types";
import { useVisualViewport } from "@/lib/use-visual-viewport";

type Props = {
  original: DraftExercise;
  substitute: Exercise;
  plan: SwapPlan;
  /** Ejercicio con el que alterna el original (si pertenece a una pareja). */
  partnerName: string | null;
  date: string;
  sessionId: string;
  onConfirm: (target: Target | null) => void;
  /** Volver a la lista para elegir otro ejercicio. */
  onBack: () => void;
  onClose: () => void;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Confirmación de «Cambiar ejercicio»: explica qué pasará, muestra «Última vez» del
 * sustituto y, si el original tiene meta, permite aplicarla (ajustable) al sustituto.
 * El cambio es solo en esta sesión; la rutina guardada no cambia.
 */
export function SwapSheet({ original, substitute, plan, partnerName, date, sessionId, onConfirm, onBack, onClose }: Props) {
  const goal = original.target ?? null;
  const alternating = Boolean(original.alt);
  const defaultSets = plan.pending ?? goal?.sets ?? null;
  const [apply, setApply] = useState(Boolean(goal) || alternating);
  const [sets, setSets] = useState(defaultSets === null ? "" : String(defaultSets));
  const [repsMin, setRepsMin] = useState(goal?.repsMin != null && !goal.blocks ? String(goal.repsMin) : "");
  const [repsMax, setRepsMax] = useState(
    goal?.repsMax != null && !goal.blocks && goal.repsMax !== goal.repsMin ? String(goal.repsMax) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [prev, setPrev] = useState<PreviousSets | null | undefined>(undefined);
  const [prevError, setPrevError] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirming = useRef(false);
  useVisualViewport(backdropRef);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    getPreviousSets([substitute.id], date, sessionId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) setPrevError(true);
        else setPrev(res.data[substitute.id] ?? null);
      })
      .catch(() => !cancelled && setPrevError(true));
    return () => {
      cancelled = true;
    };
  }, [substitute.id, date, sessionId]);

  const explanation =
    plan.mode === "replace"
      ? `«${substitute.name}» ocupará el lugar de «${original.name}»${alternating && partnerName ? ` y su turno en las series alternadas con «${partnerName}»` : ""}.`
      : `«${original.name}» conserva ${plan.done === 1 ? "su serie registrada" : `sus ${plan.done} series registradas`} y queda completado. ` +
        `«${substitute.name}» se usará para las series pendientes${plan.pending ? ` (${plural(plan.pending, "serie", "series")})` : ""}` +
        (alternating && partnerName ? `, solo en los turnos pendientes de «${original.name}» con «${partnerName}».` : ".");

  function confirm() {
    if (confirming.current) return;
    let target: Target | null = null;
    if (apply) {
      const parsed = parseTarget({ sets, repsMin: goal?.blocks ? "" : repsMin, repsMax: goal?.blocks ? "" : repsMax });
      if (!parsed.ok) {
        setError([parsed.errors.sets, parsed.errors.reps].filter(Boolean).join(". "));
        return;
      }
      if (alternating && parsed.target.sets === null) {
        setError("Indica cuántas series harás en las series alternadas");
        return;
      }
      target = { ...parsed.target, blocks: goal?.blocks ?? null };
      if (target.sets === null && target.repsMin === null && !target.blocks) target = null;
    }
    confirming.current = true;
    onConfirm(target);
  }

  return (
    <div className="sheet-backdrop" ref={backdropRef} onClick={onClose}>
      <div className="sheet form-sheet swap-sheet" role="dialog" aria-modal="true" aria-labelledby="cambiar-titulo" onClick={(e) => e.stopPropagation()}>
        <div className="row between sheet-head">
          <h2 id="cambiar-titulo" ref={titleRef} tabIndex={-1} style={{ margin: 0 }}>Cambiar ejercicio</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <div className="sheet-body">
          <div className="swap-from-to" aria-label={`De ${original.name} a ${substitute.name}`}>
            <span className="muted small">Actual</span>
            <strong>{original.name}</strong>
            <span className="swap-arrow" aria-hidden="true"><IconSwap /></span>
            <span className="muted small">Nuevo</span>
            <strong>{substitute.name}</strong>
          </div>
          <p className="badge badge-primary" style={{ alignSelf: "flex-start", margin: 0 }}>Solo en esta sesión</p>
          <p className="alert alert-info" role="status" style={{ margin: 0 }}>{explanation} Tu rutina guardada no cambia.</p>

          <div className="previous" aria-label={`Última sesión de ${substitute.name}`}>
            {prev === undefined ? (
              <p className="previous-line muted">{prevError ? "No se pudo cargar la sesión anterior." : "Buscando tu sesión anterior…"}</p>
            ) : prev === null ? (
              <p className="previous-line muted">Última vez: primer registro</p>
            ) : (
              <>
                <p className="previous-line">
                  <span className="muted">Última vez · </span>
                  {formatDate(prev.session_date, { year: false })}
                </p>
                <p className="previous-summary">{summarizeSets(prev.sets)}</p>
              </>
            )}
          </div>

          {goal || alternating ? (
            <fieldset className="swap-target stack">
              <legend className="small">Meta para «{substitute.name}»</legend>
              {goal && !alternating ? (
                <label className="check-row">
                  <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
                  <span>Aplicar la meta de «{original.name}»{formatTarget(goal) ? ` (${formatTarget(goal)})` : ""}</span>
                </label>
              ) : null}
              {apply ? (
                <div className="routine-targets">
                  <label className="field">
                    <span>Series</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      placeholder="—"
                      aria-label={`Series de ${substitute.name}`}
                      value={sets}
                      onChange={(e) => setSets(e.target.value)}
                    />
                  </label>
                  {goal?.blocks ? null : (
                    <>
                      <span className="routine-times" aria-hidden="true">×</span>
                      <label className="field">
                        <span>Reps</span>
                        <input
                          className="input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          placeholder="mín"
                          aria-label={`Repeticiones mínimas de ${substitute.name}`}
                          value={repsMin}
                          onChange={(e) => setRepsMin(e.target.value)}
                        />
                      </label>
                      <span className="routine-times" aria-hidden="true">–</span>
                      <label className="field">
                        <span>Hasta</span>
                        <input
                          className="input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          placeholder="máx"
                          aria-label={`Repeticiones máximas de ${substitute.name}`}
                          value={repsMax}
                          onChange={(e) => setRepsMax(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                </div>
              ) : null}
              {goal?.blocks && apply ? <p className="muted small" style={{ margin: 0 }}>Secuencia: {formatTarget({ blocks: goal.blocks })}</p> : null}
              {error ? <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
            </fieldset>
          ) : null}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn btn-ghost" onClick={onBack}>Elegir otro</button>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            <IconSwap /> Cambiar ejercicio
          </button>
        </div>
      </div>
    </div>
  );
}
