"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ActionsMenu } from "@/components/ActionsMenu";
import { IconCheck, IconChevronDown, IconList, IconPencil, IconPlus, IconTrash } from "@/components/icons";
import { blocksToDraft, cloneBlocks, loadOf, newKey, parseDraftSet, type DraftBlocks, type DraftExercise, type DraftSet, type LoadMode } from "@/lib/session-draft";
import { formatDate, formatSet, summarizeSets } from "@/lib/format";
import { altTurns, currentTurnIndex, progressText, registeredSets, stepComplete, stepExerciseKeys, type Step } from "@/lib/guided";
import { isBlockSet } from "@/lib/blocks";
import { formatTarget } from "@/lib/routines";
import { parseReps, parseWeight } from "@/lib/validation";
import type { PreviousSets } from "@/lib/types";
import { BlockSetSheet, emptyBlocks } from "./BlockSetSheet";
import { BarWeightField, LoadPicker } from "./LoadPicker";

type Props = {
  exercises: DraftExercise[];
  steps: Step[];
  index: number;
  previous: Record<string, PreviousSets | null> | undefined;
  prevError: boolean;
  /** Estado de guardado (se muestra arriba, junto a «Ver lista»). */
  status: React.ReactNode;
  onIndexChange: (i: number) => void;
  onAddSet: (exKey: string, set: DraftSet) => void;
  onReplaceSet: (exKey: string, setKey: string, set: DraftSet) => void;
  onSetDone: (exKeys: string[], done: boolean) => void;
  onExit: () => void;
  onFinishSession: () => void;
  finishing: boolean;
  /** «Eliminar entrenamiento» (pide confirmación). */
  onDelete: () => void;
};

/** Tiempo en que un segundo toque de «Registrar serie» / «Guardar y seguir» se ignora. */
const TAP_LOCK_MS = 700;

/**
 * Entrenamiento guiado: una tarjeta grande por paso (ejercicio o pareja alternada) con
 * la meta, «Última vez», las series registradas y la captura de la serie que toca.
 * Trabaja sobre el mismo borrador que la lista: lo registrado aquí se autoguarda igual.
 */
export function GuidedView(props: Props) {
  const { exercises, steps, index, previous, prevError, status, onIndexChange, onExit, onFinishSession, finishing } = props;
  const byKey = useMemo(() => new Map(exercises.map((e) => [e.key, e])), [exercises]);
  const step = steps[Math.min(index, steps.length - 1)];
  const [locked, setLocked] = useState(false);
  const lockUntil = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // Al cambiar de tarjeta, el foco va a su título (lectores de pantalla y teclado).
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [step?.id]);

  if (!step) return null;
  const go = (i: number) => i >= 0 && i < steps.length && onIndexChange(i);

  /** Evita que un doble toque registre dos series o avance dos turnos. */
  const guard = (fn: () => void) => {
    const now = Date.now();
    if (now < lockUntil.current) return;
    lockUntil.current = now + TAP_LOCK_MS;
    setLocked(true);
    window.setTimeout(() => setLocked(false), TAP_LOCK_MS);
    fn();
  };

  const complete = stepComplete(step, byKey);

  const finishStep = (keys: string[]) => {
    props.onSetDone(keys, true);
    // Pasa a la siguiente tarjeta pendiente (si queda alguna).
    const after = steps.findIndex((s, i) => i > index && !stepExerciseKeys(s).every((k) => keys.includes(k) || byKey.get(k)?.done));
    if (after >= 0) onIndexChange(after);
  };

  return (
    <div className="guided">
      <div className="guided-top">
        <button type="button" className="btn btn-sm" onClick={onExit}>
          <IconList /> Ver lista
        </button>
        <span className="guided-count" aria-live="polite">{index + 1} de {steps.length} ejercicios</span>
        {status}
        <ActionsMenu
          label="Acciones del entrenamiento"
          items={[{ label: "Eliminar entrenamiento", icon: <IconTrash />, danger: true, onSelect: props.onDelete }]}
        />
      </div>

      <section
        className="card guided-card"
        data-done={complete || undefined}
        aria-labelledby="guiado-titulo"
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const start = touch.current;
          touch.current = null;
          if (!start) return;
          const t = e.changedTouches[0];
          const dx = t.clientX - start.x;
          const dy = t.clientY - start.y;
          // Deslizar es un atajo: los botones «Anterior / Siguiente» hacen lo mismo.
          if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? index + 1 : index - 1);
        }}
      >
        {step.kind === "single" ? (
          <SingleCard
            key={step.id}
            ex={byKey.get(step.exKey)!}
            prev={previous?.[byKey.get(step.exKey)!.exerciseId]}
            prevError={prevError}
            titleRef={titleRef}
            locked={locked}
            guard={guard}
            onAddSet={props.onAddSet}
            onReplaceSet={props.onReplaceSet}
            onFinish={() => finishStep([step.exKey])}
            onReopen={() => props.onSetDone([step.exKey], false)}
          />
        ) : (
          <AltCard
            key={step.id}
            step={step}
            byKey={byKey}
            previous={previous}
            prevError={prevError}
            titleRef={titleRef}
            locked={locked}
            guard={guard}
            onAddSet={props.onAddSet}
            onReplaceSet={props.onReplaceSet}
            onFinishExercise={(k) => props.onSetDone([k], true)}
            onFinishAll={() => finishStep(stepExerciseKeys(step))}
            onReopen={() => props.onSetDone(stepExerciseKeys(step), false)}
          />
        )}
      </section>

      <nav className="guided-nav" aria-label="Navegar entre ejercicios">
        <button type="button" className="btn" onClick={() => go(index - 1)} disabled={index === 0}>
          <span className="icon-left" aria-hidden="true"><IconChevronDown /></span> Anterior
        </button>
        {index < steps.length - 1 ? (
          <button type="button" className="btn" onClick={() => go(index + 1)}>
            Siguiente <span className="icon-right" aria-hidden="true"><IconChevronDown /></span>
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onFinishSession} disabled={finishing}>
            {finishing ? "Finalizando…" : "Finalizar sesión"}
          </button>
        )}
      </nav>
    </div>
  );
}

// --- Piezas compartidas ---------------------------------------------------------

type CaptureTarget = { exKey: string; setKey: string | null };

/** ¿El ejercicio se registra por bloques? Meta por bloques, su última serie o la de la última vez. */
function usesBlocks(ex: DraftExercise, prev: PreviousSets | null | undefined): boolean {
  if (ex.target?.blocks) return true;
  const last = registeredSets(ex).at(-1);
  if (last) return Boolean(last.blocks);
  return Boolean(prev?.sets.at(-1) && isBlockSet(prev.sets.at(-1)!));
}

/** Valores iniciales de la serie `i`: la última registrada, la de la última vez o la meta. */
function simpleDefaults(ex: DraftExercise, prev: PreviousSets | null | undefined, i: number): { reps: string; weight: string; load: LoadMode } {
  const last = registeredSets(ex).filter((s) => !s.blocks).at(-1);
  if (last) return { reps: last.reps, weight: last.weight, load: loadOf(last) ?? "weight" };
  const p = prev?.sets.filter((s) => !isBlockSet(s));
  const ref = p?.[i] ?? p?.at(-1);
  if (ref) {
    const load: LoadMode = ref.bar_only ? "bar" : ref.bodyweight ? "body" : "weight";
    return { reps: String(ref.reps ?? ""), weight: ref.weight_kg == null || load === "body" ? "" : String(ref.weight_kg).replace(".", ","), load };
  }
  return { reps: ex.target?.repsMin != null ? String(ex.target.repsMin) : "", weight: "", load: "weight" };
}

function blockDefaults(ex: DraftExercise, prev: PreviousSets | null | undefined): DraftBlocks {
  const lastHere = registeredSets(ex).filter((s) => s.blocks).at(-1);
  if (lastHere?.blocks) return cloneBlocks(lastHere.blocks);
  const lastPrev = prev?.sets.filter(isBlockSet).at(-1);
  if (lastPrev) return blocksToDraft(lastPrev.blocks!, lastPrev.rounds ?? 1);
  if (ex.target?.blocks) return blocksToDraft(ex.target.blocks.items, ex.target.blocks.rounds);
  return emptyBlocks();
}

function Previous({ prev, error, name }: { prev: PreviousSets | null | undefined; error: boolean; name: string }) {
  if (prev === undefined) return <p className="previous-line muted">{error ? "No se pudo cargar la sesión anterior." : "Buscando tu sesión anterior…"}</p>;
  if (prev === null) return <p className="previous-line muted">Última vez: primer registro</p>;
  return (
    <div className="previous" aria-label={`Última sesión de ${name}`}>
      <p className="previous-line">
        <span className="muted">Última vez · </span>
        {formatDate(prev.session_date, { year: false })}
      </p>
      <p className="previous-summary">{summarizeSets(prev.sets)}</p>
    </div>
  );
}

/**
 * Captura de una serie: simple (carga, peso y reps) o por bloques (abre el panel de
 * bloques; todos los bloques de la serie se capturan en el mismo turno).
 */
function SetCapture({
  ex,
  prev,
  setIndex,
  editing,
  submitLabel,
  locked,
  guard,
  onSubmit,
  onCancelEdit,
}: {
  ex: DraftExercise;
  prev: PreviousSets | null | undefined;
  setIndex: number;
  /** Serie guardada que se corrige (null = serie nueva). */
  editing: DraftSet | null;
  submitLabel: string;
  locked: boolean;
  guard: (fn: () => void) => void;
  onSubmit: (set: DraftSet) => void;
  onCancelEdit: () => void;
}) {
  const [blockMode, setBlockMode] = useState(() => (editing ? Boolean(editing.blocks) : usesBlocks(ex, prev)));
  const defaults = editing && !editing.blocks
    ? { reps: editing.reps, weight: editing.weight, load: loadOf(editing) ?? "weight" }
    : simpleDefaults(ex, prev, setIndex);
  const [reps, setReps] = useState(defaults.reps);
  const [weight, setWeight] = useState(defaults.weight);
  const [load, setLoad] = useState<LoadMode>(defaults.load);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const n = setIndex + 1;

  function submitSimple() {
    const r = parseReps(reps);
    const w = load === "body" ? ({ ok: true, value: null } as const) : parseWeight(weight);
    if (!r.ok || !w.ok) {
      setError(!r.ok ? r.error : !w.ok ? w.error : null);
      return;
    }
    setError(null);
    guard(() => onSubmit({ key: editing?.key ?? newKey(), reps: reps.trim(), weight: load === "body" ? "" : weight.trim(), load }));
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitSimple();
    }
  };

  return (
    <div className="guided-capture" role="group" aria-label={`${editing ? "Corregir" : "Registrar"} serie ${n} de ${ex.name}`}>
      {blockMode ? (
        <>
          <p style={{ margin: 0 }}>
            <strong>Serie {n}</strong> <span className="muted small">· por bloques</span>
          </p>
          <button type="button" className="btn btn-primary btn-lg btn-block" disabled={locked} onClick={() => setSheet(true)}>
            {editing ? <IconPencil /> : <IconPlus />} {editing ? "Corregir bloques" : "Capturar bloques"}
          </button>
          {!editing ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlockMode(false)}>Registrar serie simple</button>
          ) : null}
        </>
      ) : (
        <>
          <p className="guided-capture-title" style={{ margin: 0 }}>
            <strong>{editing ? `Corregir serie ${n}` : `Serie ${n}`}</strong>
            {ex.target?.sets ? <span className="muted small"> de {ex.target.sets}</span> : null}
          </p>
          <LoadPicker value={load} onChange={(m) => { setLoad(m); if (m !== "weight") setWeight(""); }} label={`Carga de la serie ${n} de ${ex.name}`} />
          <div className="guided-fields" data-cols={load === "weight" ? 2 : 1}>
            {load === "weight" ? (
              <label className="field">
                <span>Peso (kg)</span>
                <input
                  className="input input-lg"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="—"
                  aria-label={`Peso serie ${n} de ${ex.name} (kg)`}
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  onKeyDown={onKeyDown}
                  enterKeyHint="next"
                />
              </label>
            ) : null}
            <label className="field">
              <span>Reps</span>
              <input
                className="input input-lg"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="—"
                aria-label={`Repeticiones serie ${n} de ${ex.name}`}
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                onKeyDown={onKeyDown}
                enterKeyHint="done"
              />
            </label>
          </div>
          {load === "bar" ? (
            <BarWeightField value={weight} onChange={setWeight} label={`Peso de la barra serie ${n} de ${ex.name} (kg, opcional)`} />
          ) : null}
          {error ? <p className="field-error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
          <button type="button" className="btn btn-primary btn-lg btn-block" disabled={locked} onClick={submitSimple}>
            {editing ? "Guardar cambios" : submitLabel}
          </button>
          {!editing ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlockMode(true)}>Serie por bloques</button>
          ) : null}
        </>
      )}
      {editing ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancelEdit}>Cancelar corrección</button>
      ) : null}
      {sheet ? (
        <BlockSetSheet
          exerciseName={ex.name}
          initial={editing?.blocks ? cloneBlocks(editing.blocks) : blockDefaults(ex, prev)}
          initialCount={null}
          title={editing ? `Corregir serie ${n}` : `Serie ${n}`}
          submitLabel={editing ? "Guardar cambios" : submitLabel}
          onSubmit={(blocks) => {
            setSheet(false);
            guard(() => onSubmit({ key: editing?.key ?? newKey(), reps: "", weight: "", blocks }));
          }}
          onClose={() => setSheet(false)}
        />
      ) : null}
    </div>
  );
}

/** Lista de series registradas: cada una se toca para corregirla; la que toca queda destacada. */
function SetList({
  rows,
  current,
  onEdit,
  label,
}: {
  rows: { id: string; text: string; label: string; exKey: string; set: DraftSet; editingKey: string | null }[];
  current: string | null;
  onEdit: (exKey: string, set: DraftSet) => void;
  label: string;
}) {
  return (
    <ol className="guided-sets" aria-label={label}>
      {rows.map((r) => (
        <li key={r.id} data-editing={r.editingKey === r.set.key || undefined}>
          <button type="button" className="guided-set" aria-label={`Corregir ${r.label}`} onClick={() => onEdit(r.exKey, r.set)}>
            <span className="guided-set-check" aria-hidden="true"><IconCheck /></span>
            <span>{r.label.replace(/ de .*$/, "")}</span>
            <strong>{r.text}</strong>
          </button>
        </li>
      ))}
      {current ? (
        <li className="guided-set-current" aria-current="step">
          <span className="guided-set-dot" aria-hidden="true" />
          <span>{current}</span>
          <strong>Toca ahora</strong>
        </li>
      ) : null}
    </ol>
  );
}

const describe = (set: DraftSet) => {
  const v = parseDraftSet(set);
  return v ? formatSet(v) : "Faltan datos";
};

function CompletedBanner({ onReopen }: { onReopen: () => void }) {
  return (
    <div className="guided-done" role="status">
      <span className="badge badge-success"><IconCheck /> Completado</span>
      <button type="button" className="btn btn-sm" onClick={onReopen}>Reabrir ejercicio</button>
    </div>
  );
}

// --- Ejercicio suelto -------------------------------------------------------------

function SingleCard({
  ex,
  prev,
  prevError,
  titleRef,
  locked,
  guard,
  onAddSet,
  onReplaceSet,
  onFinish,
  onReopen,
}: {
  ex: DraftExercise;
  prev: PreviousSets | null | undefined;
  prevError: boolean;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  locked: boolean;
  guard: (fn: () => void) => void;
  onAddSet: (exKey: string, set: DraftSet) => void;
  onReplaceSet: (exKey: string, setKey: string, set: DraftSet) => void;
  onFinish: () => void;
  onReopen: () => void;
}) {
  const [editing, setEditing] = useState<CaptureTarget | null>(null);
  const sets = registeredSets(ex);
  const goal = ex.target?.sets ?? null;
  const editSet = editing?.setKey ? sets.find((s) => s.key === editing.setKey) ?? null : null;
  const editIndex = editSet ? sets.indexOf(editSet) : sets.length;
  const target = formatTarget(ex.target);
  const progress = progressText(ex);

  return (
    <div className="stack guided-body">
      <div className="guided-head">
        <h2 id="guiado-titulo" ref={titleRef} tabIndex={-1}>{ex.name}</h2>
        {target || progress ? (
          <p className="guided-meta" style={{ margin: 0 }}>
            {target ? <span className="ex-goal">Meta: {target}</span> : null}
            {progress ? <span className="guided-progress">{progress}</span> : null}
          </p>
        ) : null}
      </div>
      <Previous prev={prev} error={prevError} name={ex.name} />
      {ex.done ? <CompletedBanner onReopen={onReopen} /> : null}
      {!ex.done || editSet ? (
        <SetCapture
          key={`${ex.key}-${editSet?.key ?? `nueva-${sets.length}`}`}
          ex={ex}
          prev={prev}
          setIndex={editIndex}
          editing={editSet}
          submitLabel="Registrar serie"
          locked={locked}
          guard={guard}
          onCancelEdit={() => setEditing(null)}
          onSubmit={(set) => {
            if (editSet) {
              onReplaceSet(ex.key, editSet.key, set);
              setEditing(null);
            } else onAddSet(ex.key, set);
          }}
        />
      ) : null}
      {sets.length || !ex.done ? (
        <SetList
          label={`Series de ${ex.name}`}
          rows={sets.map((s, i) => ({ id: s.key, exKey: ex.key, set: s, text: describe(s), label: `Serie ${i + 1} de ${ex.name}`, editingKey: editSet?.key ?? null }))}
          current={!ex.done && !editSet ? `Serie ${sets.length + 1}${goal ? ` de ${goal}` : ""}` : null}
          onEdit={(exKey, set) => setEditing({ exKey, setKey: set.key })}
        />
      ) : null}
      {!ex.done ? (
        <button type="button" className="btn btn-block" onClick={onFinish}>
          <IconCheck /> Finalizar ejercicio
        </button>
      ) : null}
    </div>
  );
}

// --- Series alternadas -----------------------------------------------------------------

function AltCard({
  step,
  byKey,
  previous,
  prevError,
  titleRef,
  locked,
  guard,
  onAddSet,
  onReplaceSet,
  onFinishExercise,
  onFinishAll,
  onReopen,
}: {
  step: Extract<Step, { kind: "alt" }>;
  byKey: Map<string, DraftExercise>;
  previous: Record<string, PreviousSets | null> | undefined;
  prevError: boolean;
  titleRef: React.RefObject<HTMLHeadingElement | null>;
  locked: boolean;
  guard: (fn: () => void) => void;
  onAddSet: (exKey: string, set: DraftSet) => void;
  onReplaceSet: (exKey: string, setKey: string, set: DraftSet) => void;
  onFinishExercise: (exKey: string) => void;
  onFinishAll: () => void;
  onReopen: () => void;
}) {
  const [editing, setEditing] = useState<CaptureTarget | null>(null);
  const { turns, rounds } = altTurns(step, byKey);
  const ci = currentTurnIndex(turns);
  const current = ci >= 0 ? turns[ci] : null;
  const next = ci >= 0 ? turns.slice(ci + 1).find((t) => !t.done) ?? null : null;
  const allDone = stepComplete(step, byKey);
  const members = stepExerciseKeys(step).map((k) => byKey.get(k)!).filter(Boolean);
  const names = [step.slots[0], step.slots[1]].map((keys) => keys.map((k) => byKey.get(k)?.name).filter(Boolean).join(" / "));

  const editEx = editing ? byKey.get(editing.exKey) ?? null : null;
  const editSet = editEx && editing?.setKey ? registeredSets(editEx).find((s) => s.key === editing.setKey) ?? null : null;
  const active = editSet ? editEx! : current ? byKey.get(current.exKey)! : null;
  const activeIndex = editSet ? registeredSets(editEx!).indexOf(editSet) : current?.setIndex ?? 0;
  const activeRound = editSet ? turns.find((t) => t.exKey === editEx!.key && t.setIndex === activeIndex)?.round ?? current?.round ?? 1 : current?.round ?? rounds;

  const doneRows = turns
    .filter((t) => t.done)
    .map((t) => {
      const ex = byKey.get(t.exKey)!;
      const set = registeredSets(ex)[t.setIndex];
      return {
        id: `${t.exKey}-${t.setIndex}`,
        exKey: ex.key,
        set,
        text: describe(set),
        label: `Vuelta ${t.round} · ${ex.name}, serie ${t.setIndex + 1} de ${ex.name}`,
        editingKey: editSet?.key ?? null,
      };
    });

  return (
    <div className="stack guided-body">
      <div className="guided-head">
        <p className="guided-meta" style={{ margin: 0 }}>
          <span className="alt-badge">⇄ Series alternadas</span>
          {active ? <span className="guided-round">Vuelta {activeRound} de {rounds}</span> : null}
        </p>
        <h2 id="guiado-titulo" ref={titleRef} tabIndex={-1}>{active ? active.name : names.join(" + ")}</h2>
        {active ? (
          <p className="guided-meta" style={{ margin: 0 }}>
            {formatTarget(active.target) ? <span className="ex-goal">Meta: {formatTarget(active.target)}</span> : null}
            {progressText(active) ? <span className="guided-progress">{progressText(active)}</span> : null}
            <span className="muted small">con {names.filter((n) => n !== active.name && !n.split(" / ").includes(active.name)).join(" / ")}</span>
          </p>
        ) : null}
      </div>
      {active ? <Previous prev={previous?.[active.exerciseId]} error={prevError} name={active.name} /> : null}
      {allDone ? <CompletedBanner onReopen={onReopen} /> : null}


      {active && (editSet || !allDone) ? (
        <SetCapture
          key={`${active.key}-${editSet?.key ?? `nueva-${activeIndex}`}`}
          ex={active}
          prev={previous?.[active.exerciseId]}
          setIndex={activeIndex}
          editing={editSet}
          submitLabel="Guardar y seguir"
          locked={locked}
          guard={guard}
          onCancelEdit={() => setEditing(null)}
          onSubmit={(set) => {
            if (editSet) {
              // Corregir no duplica la serie ni avanza el turno.
              onReplaceSet(active.key, editSet.key, set);
              setEditing(null);
            } else onAddSet(active.key, set);
          }}
        />
      ) : null}

      {!allDone && !editSet ? (
        <p className="guided-next muted" style={{ margin: 0 }}>
          {current ? (next ? `Sigue: ${byKey.get(next.exKey)!.name} · vuelta ${next.round}` : "Es el último turno.") : "Registraste todas las vueltas."}
        </p>
      ) : null}

      <SetList
        label={`Series alternadas de ${names.join(" y ")}`}
        rows={doneRows}
        current={current && !editSet ? `Vuelta ${current.round} · ${byKey.get(current.exKey)!.name}` : null}
        onEdit={(exKey, set) => setEditing({ exKey, setKey: set.key })}
      />
      {!allDone ? (
        current && !editSet ? (
          <button type="button" className="btn btn-block" onClick={() => onFinishExercise(current.exKey)}>
            <IconCheck /> Finalizar ejercicio
          </button>
        ) : !current ? (
          <button type="button" className="btn btn-primary btn-block" onClick={onFinishAll}>
            <IconCheck /> Finalizar series alternadas
          </button>
        ) : null
      ) : null}
      {members.some((m) => m.done) && !allDone ? (
        <p className="muted small" style={{ margin: 0 }}>
          Completado: {members.filter((m) => m.done).map((m) => m.name).join(", ")}
        </p>
      ) : null}
    </div>
  );
}
