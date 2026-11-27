"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { deleteRoutine, saveRoutine } from "@/app/actions/routines";
import { IconChevronDown, IconPlus, IconTrash } from "@/components/icons";
import { ExercisePicker } from "@/components/session/ExercisePicker";
import { muscleGroupName, UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import { formatPlan, type BlockPlan } from "@/lib/blocks";
import { move, planToDraft, routineToPayload, type RoutineDraftExercise, type RoutineDraftPlan, type TargetErrors } from "@/lib/routines";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { uuidv4 } from "@/lib/uuid";

type Props = {
  /** null = rutina nueva. */
  routineId: string | null;
  initialName: string;
  initialExercises: (Omit<RoutineDraftExercise, "key"> & {
    muscleGroupId: string | null;
    /** «Guardar como rutina»: estructuras por bloques distintas de la sesión (para elegir una). */
    planOptions?: { plan: BlockPlan; count: number }[];
  })[];
  exercises: Exercise[];
  muscleGroups: MuscleGroup[];
  /** Aviso al abrir (p. ej., ejercicios archivados que no se precargaron). */
  notice?: string;
};

type Row = RoutineDraftExercise & { muscleGroupId: string | null; planOptions?: { plan: BlockPlan; count: number }[] };

let counter = 0;
const key = () => `r${Date.now().toString(36)}${++counter}`;

export function RoutineEditor({ routineId, initialName, initialExercises, exercises, muscleGroups, notice }: Props) {
  const router = useRouter();
  // Rutina nueva: el id lo genera el cliente para que guardar dos veces no la duplique.
  const [id] = useState(() => routineId ?? uuidv4());
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState<Row[]>(() => initialExercises.map((e) => ({ ...e, key: key() })));
  const [catalog, setCatalog] = useState<Exercise[]>(exercises);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<Row | null>(null);
  const [errors, setErrors] = useState<{ name?: string; general?: string; targets: Record<string, TargetErrors> }>({ targets: {} });
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);
  const isNew = routineId === null;

  const update = (k: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));
    // Al corregir una meta, su error deja de mostrarse hasta volver a guardar.
    setErrors((e) => (e.targets[k] ? { ...e, targets: { ...e.targets, [k]: {} } } : e));
  };

  const updatePlan = (k: string, fn: (p: RoutineDraftPlan) => RoutineDraftPlan | null) =>
    setRows((rs) => rs.map((r) => (r.key === k && r.plan ? { ...r, plan: fn(r.plan) } : r)));

  const pick = (exercise: Exercise) => {
    setPickerOpen(false);
    const target = replaceTarget;
    setReplaceTarget(null);
    const row: Row = {
      key: key(),
      exerciseId: exercise.id,
      name: exercise.name,
      archived: false,
      muscleGroupId: exercise.muscle_group_id,
      sets: target?.sets ?? "",
      repsMin: target?.repsMin ?? "",
      repsMax: target?.repsMax ?? "",
      plan: target?.plan ?? null,
    };
    setRows((rs) => {
      // Un ejercicio no se repite dentro de la rutina (doble toque incluido).
      if (rs.some((r) => r.exerciseId === exercise.id)) return rs;
      return target ? rs.map((r) => (r.key === target.key ? row : r)) : [...rs, row];
    });
  };

  async function save() {
    if (busy.current) return;
    setServerError(null);
    const res = routineToPayload(id, name, rows);
    if (!res.ok) {
      setErrors({ name: res.name, general: res.general, targets: res.targets });
      return;
    }
    setErrors({ targets: {} });
    busy.current = true;
    setSaving(true);
    try {
      const out = await saveRoutine(res.payload);
      if (!out.ok) {
        setServerError(out.error);
        return;
      }
      router.push(`/rutinas?guardada=${encodeURIComponent(res.payload.name)}`);
    } catch {
      setServerError("Sin conexión con el servidor. Tu rutina no se guardó; reintenta.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew || busy.current) return;
    if (!window.confirm(`¿Eliminar la rutina «${initialName}»? Las sesiones que ya registraste con ella se conservarán.`)) return;
    busy.current = true;
    setDeleting(true);
    setServerError(null);
    try {
      const out = await deleteRoutine(id);
      if (!out.ok) {
        setServerError(out.error);
        return;
      }
      router.push("/rutinas?eliminada=1");
    } catch {
      setServerError("Sin conexión con el servidor. La rutina no se eliminó; reintenta.");
    } finally {
      busy.current = false;
      setDeleting(false);
    }
  }

  return (
    <div className="stack routine-editor">
      <Link href="/rutinas" className="back-link">‹ Mis rutinas</Link>
      <h1 style={{ margin: 0 }}>{isNew ? "Nueva rutina" : "Editar rutina"}</h1>
      {notice ? <p className="alert alert-info" role="status" style={{ margin: 0 }}>{notice}</p> : null}

      <label className="field">
        <span>Nombre</span>
        <input
          className="input"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej.: Pecho y tríceps"
          aria-invalid={errors.name ? true : undefined}
          autoComplete="off"
        />
        {errors.name ? <span className="field-error">{errors.name}</span> : null}
      </label>

      <div className="stack" style={{ gap: 4 }}>
        <h2 style={{ margin: 0 }}>Ejercicios</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Ordénalos como los harás. La meta es opcional: series y repeticiones (una cantidad o un rango, p. ej., 8–12).
        </p>
      </div>
      {errors.general ? <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{errors.general}</p> : null}

      {rows.length === 0 ? (
        <div className="card empty">Agrega al menos un ejercicio de tu catálogo.</div>
      ) : (
        <ol className="list routine-list" aria-label="Ejercicios de la rutina">
          {rows.map((r, i) => {
            const err = errors.targets[r.key] ?? {};
            const group = muscleGroupName(muscleGroups, r.muscleGroupId) ?? UNCLASSIFIED_LABEL;
            return (
              <li key={r.key} className="card routine-ex" aria-label={`${i + 1}. ${r.name}`}>
                <div className="routine-ex-head">
                  <span className="routine-ex-pos" aria-hidden="true">{i + 1}</span>
                  <span className="routine-ex-title">
                    <strong>{r.name}</strong>
                    <span className="muted small">{group}</span>
                    {r.archived ? <span className="badge badge-warning">Archivado</span> : null}
                  </span>
                  <span className="routine-ex-order">
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={`Subir ${r.name}`}
                      disabled={i === 0}
                      onClick={() => setRows((rs) => move(rs, i, -1))}
                    >
                      <span className="icon-up" aria-hidden="true"><IconChevronDown /></span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-icon"
                      aria-label={`Bajar ${r.name}`}
                      disabled={i === rows.length - 1}
                      onClick={() => setRows((rs) => move(rs, i, 1))}
                    >
                      <IconChevronDown />
                    </button>
                  </span>
                </div>

                {r.archived ? (
                  <div className="alert alert-warning stack" style={{ gap: 8, margin: 0 }}>
                    <p style={{ margin: 0 }}>Este ejercicio está archivado: se omitirá al usar la rutina.</p>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setReplaceTarget(r);
                          setPickerOpen(true);
                        }}
                      >
                        Reemplazar
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                        Quitar
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="routine-targets">
                  <label className="field">
                    <span>Series</span>
                    <input
                      className="input"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      placeholder="—"
                      aria-label={`Series objetivo de ${r.name}`}
                      aria-invalid={err.sets ? true : undefined}
                      value={r.sets}
                      onChange={(e) => update(r.key, { sets: e.target.value })}
                    />
                  </label>
                  {r.plan ? null : (
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
                          aria-label={`Repeticiones mínimas de ${r.name}`}
                          aria-invalid={err.reps ? true : undefined}
                          value={r.repsMin}
                          onChange={(e) => update(r.key, { repsMin: e.target.value })}
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
                          aria-label={`Repeticiones máximas de ${r.name}`}
                          aria-invalid={err.reps ? true : undefined}
                          value={r.repsMax}
                          onChange={(e) => update(r.key, { repsMax: e.target.value })}
                        />
                      </label>
                    </>
                  )}
                </div>
                {err.sets || err.reps ? (
                  <p className="field-error" role="alert" style={{ margin: 0 }}>{[err.sets, err.reps].filter(Boolean).join(". ")}</p>
                ) : null}

                {r.planOptions && r.planOptions.length > 1 ? (
                  <label className="field">
                    <span>Estructura de referencia</span>
                    <select
                      className="input"
                      aria-label={`Estructura de referencia de ${r.name}`}
                      defaultValue="0"
                      onChange={(e) => {
                        const opt = r.planOptions![Number(e.target.value)];
                        update(r.key, { plan: planToDraft(opt.plan, key), sets: String(opt.count) });
                      }}
                    >
                      {r.planOptions.map((o, j) => (
                        <option key={j} value={j}>
                          {formatPlan(o.plan)} ({o.count} {o.count === 1 ? "serie" : "series"})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {r.plan ? (
                  <div className="routine-plan stack" style={{ gap: 8 }}>
                    <div className="row between">
                      <strong className="small">Secuencia por bloques</strong>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Quitar secuencia de ${r.name}`}
                        onClick={() => update(r.key, { plan: null })}
                      >
                        Quitar secuencia
                      </button>
                    </div>
                    <ol className="block-list">
                      {r.plan.items.map((b, j) => (
                        <li key={b.key} className="block-item routine-plan-item">
                          <div className="block-item-head">
                            <span className="routine-ex-pos" aria-hidden="true">{j + 1}</span>
                            <div className="segmented" role="group" aria-label={`Tipo del bloque ${j + 1} de ${r.name}`}>
                              <button type="button" aria-pressed={b.type === "reps"} onClick={() => updatePlan(r.key, (p) => ({ ...p, items: p.items.map((x) => (x.key === b.key ? { ...x, type: "reps" } : x)) }))}>
                                Repeticiones
                              </button>
                              <button type="button" aria-pressed={b.type === "hold"} onClick={() => updatePlan(r.key, (p) => ({ ...p, items: p.items.map((x) => (x.key === b.key ? { ...x, type: "hold" } : x)) }))}>
                                Sostener
                              </button>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              aria-label={`Quitar bloque ${j + 1} de ${r.name}`}
                              disabled={r.plan!.items.length === 1}
                              onClick={() => updatePlan(r.key, (p) => ({ ...p, items: p.items.filter((x) => x.key !== b.key) }))}
                            >
                              <IconTrash />
                            </button>
                          </div>
                          <input
                            className="input"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            placeholder={b.type === "reps" ? "reps" : "segundos"}
                            aria-label={`${b.type === "reps" ? "Repeticiones" : "Segundos"} del bloque ${j + 1} de ${r.name}`}
                            value={b.value}
                            onChange={(e) => updatePlan(r.key, (p) => ({ ...p, items: p.items.map((x) => (x.key === b.key ? { ...x, value: e.target.value } : x)) }))}
                          />
                        </li>
                      ))}
                    </ol>
                    <div className="row">
                      <button
                        type="button"
                        className="btn btn-sm"
                        aria-label={`Agregar bloque a ${r.name}`}
                        onClick={() => updatePlan(r.key, (p) => ({ ...p, items: [...p.items, { key: key(), type: p.items.at(-1)?.type ?? "reps", value: p.items.at(-1)?.value ?? "" }] }))}
                      >
                        <IconPlus /> Agregar bloque
                      </button>
                    </div>
                    <label className="field">
                      <span>Repetir secuencia dentro de la serie</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        aria-label={`Repetir secuencia de ${r.name}`}
                        value={r.plan.rounds}
                        onChange={(e) => updatePlan(r.key, (p) => ({ ...p, rounds: e.target.value }))}
                      />
                    </label>
                    <p className="muted small" style={{ margin: 0 }}>
                      Sin pesos: al usar la rutina se proponen los de la última vez.
                    </p>
                    {err.plan ? <p className="field-error" role="alert" style={{ margin: 0 }}>{err.plan}</p> : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm routine-plan-add"
                    onClick={() => update(r.key, { plan: { rounds: "1", items: [{ key: key(), type: "reps", value: r.repsMin }] } })}
                  >
                    <IconPlus /> Definir secuencia por bloques
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-ghost btn-sm routine-remove"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  aria-label={`Quitar ${r.name} de la rutina`}
                >
                  <IconTrash /> Quitar
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <button
        type="button"
        className="btn btn-block"
        onClick={() => {
          setReplaceTarget(null);
          setPickerOpen(true);
        }}
      >
        <IconPlus /> Agregar ejercicio
      </button>

      {serverError ? <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{serverError}</p> : null}

      <div className="routine-actions">
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => void save()} disabled={saving || deleting}>
          {saving ? "Guardando…" : "Guardar rutina"}
        </button>
        {!isNew ? (
          <button type="button" className="btn btn-danger btn-block" onClick={() => void remove()} disabled={saving || deleting}>
            <IconTrash /> {deleting ? "Eliminando…" : "Eliminar rutina"}
          </button>
        ) : null}
      </div>

      {pickerOpen ? (
        <ExercisePicker
          exercises={catalog}
          muscleGroups={muscleGroups}
          inSession={new Set(rows.map((r) => r.exerciseId))}
          title={replaceTarget ? "Reemplazar ejercicio" : undefined}
          notice={replaceTarget ? `Elige el ejercicio que ocupará el lugar de «${replaceTarget.name}» en la rutina.` : undefined}
          destination="rutina"
          onClose={() => {
            setPickerOpen(false);
            setReplaceTarget(null);
          }}
          onPick={pick}
          onCreated={(exercise) => setCatalog((c) => (c.some((x) => x.id === exercise.id) ? c : [...c, exercise]))}
        />
      ) : null}
    </div>
  );
}
