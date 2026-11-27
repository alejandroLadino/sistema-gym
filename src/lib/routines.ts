/** Meta opcional de un ejercicio: series y repeticiones (cantidad o rango). */
export type Target = { sets: number | null; repsMin: number | null; repsMax: number | null };

/** Ejercicio de una rutina tal como lo devuelve `get_routines`. */
export type RoutineExerciseRow = {
  exercise_id: string;
  name: string;
  muscle_group_id: string | null;
  archived: boolean;
  target_sets: number | null;
  target_reps_min: number | null;
  target_reps_max: number | null;
};

export type Routine = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  exercises: RoutineExerciseRow[];
};

/** Lo que espera `save_routine`. */
export type RoutinePayload = {
  id: string;
  name: string;
  exercises: { exercise_id: string; target_sets: number | null; target_reps_min: number | null; target_reps_max: number | null }[];
};

export const MAX_ROUTINE_NAME = 80;
export const MAX_ROUTINE_EXERCISES = 50;
export const MAX_TARGET_SETS = 20;
export const MAX_TARGET_REPS = 1000;

/** Fila editable del formulario de rutina (los números como texto). */
export type RoutineDraftExercise = {
  key: string;
  exerciseId: string;
  name: string;
  archived: boolean;
  sets: string;
  repsMin: string;
  repsMax: string;
};

export type TargetErrors = Partial<Record<"sets" | "reps", string>>;

function parsePositive(raw: string, max: number): number | null | "invalid" {
  const value = raw.trim();
  if (value === "") return null;
  if (!/^\d{1,4}$/.test(value)) return "invalid";
  const n = Number(value);
  return n >= 1 && n <= max ? n : "invalid";
}

/**
 * Valida la meta: series y repeticiones son enteros positivos y opcionales.
 * Repeticiones: solo «mín» = cantidad exacta; «mín» y «máx» = rango (mín ≤ máx).
 */
export function parseTarget(input: { sets: string; repsMin: string; repsMax: string }):
  | { ok: true; target: Target }
  | { ok: false; errors: TargetErrors } {
  const errors: TargetErrors = {};
  const sets = parsePositive(input.sets, MAX_TARGET_SETS);
  const min = parsePositive(input.repsMin, MAX_TARGET_REPS);
  const max = parsePositive(input.repsMax, MAX_TARGET_REPS);
  if (sets === "invalid") errors.sets = `Series: un entero de 1 a ${MAX_TARGET_SETS}`;
  if (min === "invalid" || max === "invalid") errors.reps = `Repeticiones: enteros de 1 a ${MAX_TARGET_REPS}`;
  else if (min === null && max !== null) errors.reps = "Indica también el mínimo de repeticiones";
  else if (min !== null && max !== null && min > max) errors.reps = "El mínimo no puede superar el máximo";
  if (Object.keys(errors).length) return { ok: false, errors };
  const repsMin = min as number | null;
  const repsMax = (max as number | null) ?? repsMin;
  return { ok: true, target: { sets: sets as number | null, repsMin, repsMax } };
}

/** «3 × 8–12», «3 × 10», «3 series», «8–12 reps»; null sin meta. */
export function formatTarget(t: Partial<Target> | null | undefined): string | null {
  if (!t) return null;
  const sets = t.sets ?? null;
  const min = t.repsMin ?? null;
  const max = t.repsMax ?? min;
  const reps = min === null ? null : max !== null && max !== min ? `${min}–${max}` : `${min}`;
  if (sets !== null && reps !== null) return `${sets} × ${reps}`;
  if (sets !== null) return `${sets} ${sets === 1 ? "serie" : "series"}`;
  if (reps !== null) return `${reps} reps`;
  return null;
}

export function targetOfRow(r: { target_sets: number | null; target_reps_min: number | null; target_reps_max: number | null }): Target {
  return { sets: r.target_sets, repsMin: r.target_reps_min, repsMax: r.target_reps_max };
}

/** Valida el formulario completo y lo convierte en lo que espera `save_routine`. */
export function routineToPayload(
  id: string,
  name: string,
  exercises: RoutineDraftExercise[],
):
  | { ok: true; payload: RoutinePayload }
  | { ok: false; name?: string; general?: string; targets: Record<string, TargetErrors> } {
  const targets: Record<string, TargetErrors> = {};
  let nameError: string | undefined;
  let general: string | undefined;
  const clean = name.trim();
  if (!clean) nameError = "Escribe un nombre para la rutina";
  else if (clean.length > MAX_ROUTINE_NAME) nameError = `Máximo ${MAX_ROUTINE_NAME} caracteres`;
  if (exercises.length === 0) general = "Agrega al menos un ejercicio";
  else if (exercises.length > MAX_ROUTINE_EXERCISES) general = `Máximo ${MAX_ROUTINE_EXERCISES} ejercicios`;
  else if (new Set(exercises.map((e) => e.exerciseId)).size !== exercises.length) general = "Hay ejercicios repetidos";

  const rows: RoutinePayload["exercises"] = [];
  for (const ex of exercises) {
    const parsed = parseTarget(ex);
    if (!parsed.ok) targets[ex.key] = parsed.errors;
    else
      rows.push({
        exercise_id: ex.exerciseId,
        target_sets: parsed.target.sets,
        target_reps_min: parsed.target.repsMin,
        target_reps_max: parsed.target.repsMax,
      });
  }
  if (nameError || general || Object.keys(targets).length) return { ok: false, name: nameError, general, targets };
  return { ok: true, payload: { id, name: clean, exercises: rows } };
}

/** Mueve un elemento una posición (−1 arriba, +1 abajo). */
export function move<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Ejercicios que se omitirán al usar la rutina (archivados) y si queda alguno activo. */
export function routineUsage(r: Pick<Routine, "exercises">): { omitted: string[]; usable: boolean } {
  const omitted = r.exercises.filter((e) => e.archived).map((e) => e.name);
  return { omitted, usable: r.exercises.some((e) => !e.archived) };
}
