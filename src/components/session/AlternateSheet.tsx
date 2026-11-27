"use client";

import { useEffect, useRef, useState } from "react";
import { IconSwap } from "@/components/icons";
import { registeredSets } from "@/lib/guided";
import { MAX_TARGET_SETS } from "@/lib/routines";
import type { DraftExercise } from "@/lib/session-draft";
import { useVisualViewport } from "@/lib/use-visual-viewport";

type Props = {
  exercise: DraftExercise;
  /** Ejercicios de la sesión con los que se puede alternar (sin pareja). */
  candidates: DraftExercise[];
  onConfirm: (partnerKey: string, setsA: number, setsB: number) => void;
  onClose: () => void;
};

/** Series por defecto: la meta, o las ya registradas (mínimo 3). */
const defaultSets = (ex: DraftExercise) => String(ex.target?.sets ?? Math.max(registeredSets(ex).length, 3));

function parseCount(raw: string): number | null {
  const v = raw.trim();
  if (!/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_TARGET_SETS ? n : null;
}

/**
 * «Alternar con otro ejercicio»: elegir la pareja (otro ejercicio de la sesión) y
 * cuántas series se harán de cada uno. Con metas, se usan como punto de partida.
 */
export function AlternateSheet({ exercise, candidates, onConfirm, onClose }: Props) {
  const [partnerKey, setPartnerKey] = useState<string | null>(candidates.length === 1 ? candidates[0].key : null);
  const partner = candidates.find((c) => c.key === partnerKey) ?? null;
  const [setsA, setSetsA] = useState(defaultSets(exercise));
  const [setsB, setSetsB] = useState(partner ? defaultSets(partner) : "3");
  const [error, setError] = useState<string | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useVisualViewport(backdropRef);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function choose(c: DraftExercise) {
    setPartnerKey(c.key);
    setSetsB(defaultSets(c));
    setError(null);
  }

  function confirm() {
    if (!partner) {
      setError("Elige con qué ejercicio alternar");
      return;
    }
    const a = parseCount(setsA);
    const b = parseCount(setsB);
    if (a === null || b === null) {
      setError(`Series: un entero de 1 a ${MAX_TARGET_SETS} para cada ejercicio`);
      return;
    }
    onConfirm(partner.key, a, b);
  }

  return (
    <div className="sheet-backdrop" ref={backdropRef} onClick={onClose}>
      <div className="sheet form-sheet" role="dialog" aria-modal="true" aria-labelledby="alternar-titulo" onClick={(e) => e.stopPropagation()}>
        <div className="row between sheet-head">
          <h2 id="alternar-titulo" ref={titleRef} tabIndex={-1} style={{ margin: 0 }}>Alternar con otro ejercicio</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <div className="sheet-body">
          <p className="muted small" style={{ margin: 0 }}>
            Harás una serie de cada uno por turnos: {exercise.name} 1 → {partner?.name ?? "el otro"} 1 → {exercise.name} 2 …
          </p>
          {candidates.length === 0 ? (
            <p className="alert alert-info" style={{ margin: 0 }}>Agrega otro ejercicio a la sesión para alternarlo con «{exercise.name}».</p>
          ) : (
            <div className="alt-options" role="radiogroup" aria-label={`Alternar ${exercise.name} con`}>
              {candidates.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={partnerKey === c.key}
                  className="sheet-item"
                  onClick={() => choose(c)}
                >
                  <strong>{c.name}</strong>
                  {partnerKey === c.key ? <span className="badge badge-primary">Elegido</span> : null}
                </button>
              ))}
            </div>
          )}
          {partner ? (
            <fieldset className="stack swap-target">
              <legend className="small">Series de cada uno</legend>
              <div className="alt-counts">
                <label className="field">
                  <span>{exercise.name}</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    aria-label={`Series de ${exercise.name}`}
                    value={setsA}
                    onChange={(e) => setSetsA(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>{partner.name}</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    aria-label={`Series de ${partner.name}`}
                    value={setsB}
                    onChange={(e) => setSetsB(e.target.value)}
                  />
                </label>
              </div>
            </fieldset>
          ) : null}
          {error ? <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
        </div>
        <div className="sheet-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={candidates.length === 0}>
            <IconSwap /> Alternar series
          </button>
        </div>
      </div>
    </div>
  );
}
