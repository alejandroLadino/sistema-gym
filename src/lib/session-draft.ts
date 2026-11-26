import { isIsoDate } from "./format";
import type { SessionData, SetValue } from "./types";
import { parseReps, parseWeight } from "./validation";

export type DraftSet = { key: string; reps: string; weight: string };
export type DraftExercise = {
  key: string;
  exerciseId: string;
  name: string;
  archived?: boolean;
  sets: DraftSet[];
};
export type Draft = {
  id: string;
  date: string;
  notes: string;
  exercises: DraftExercise[];
  /** Marca de tiempo local de la última edición. */
  editedAt: number;
};

export type SessionPayload = {
  id: string;
  session_date: string;
  notes: string | null;
  exercises: { exercise_id: string; sets: SetValue[] }[];
};

export type DraftErrors = {
  general?: string;
  /** clave de la serie → mensaje */
  sets: Record<string, string>;
};

let counter = 0;
export function newKey(): string {
  counter += 1;
  return `k${Date.now().toString(36)}${counter}`;
}

export function weightToInput(weight: number | null): string {
  if (weight === null || weight === undefined) return "";
  return String(Number(weight)).replace(".", ",");
}

export function setsToDraft(sets: SetValue[]): DraftSet[] {
  return sets.map((s) => ({ key: newKey(), reps: String(s.reps), weight: weightToInput(s.weight_kg) }));
}

export function sessionToDraft(session: SessionData): Draft {
  return {
    id: session.id,
    date: session.session_date,
    notes: session.notes ?? "",
    editedAt: Date.parse(session.updated_at) || 0,
    exercises: session.exercises.map((e) => ({
      key: newKey(),
      exerciseId: e.exercise_id,
      name: e.name,
      archived: e.archived,
      sets: setsToDraft(e.sets),
    })),
  };
}

export function isSetBlank(set: DraftSet): boolean {
  return set.reps.trim() === "" && set.weight.trim() === "";
}

/**
 * Convierte el borrador en lo que espera save_workout_session.
 * Las series completamente vacías se ignoran (filas recién agregadas).
 */
export function draftToPayload(
  draft: Draft,
): { ok: true; payload: SessionPayload } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = { sets: {} };

  if (!isIsoDate(draft.date)) errors.general = "Elige una fecha válida.";
  if (draft.exercises.length === 0) errors.general ??= "Agrega al menos un ejercicio.";

  const exercises = draft.exercises.map((ex) => {
    const sets: SetValue[] = [];
    for (const set of ex.sets) {
      if (isSetBlank(set)) continue;
      const reps = parseReps(set.reps);
      const weight = parseWeight(set.weight);
      if (!reps.ok) errors.sets[set.key] = reps.error;
      else if (!weight.ok) errors.sets[set.key] = weight.error;
      else sets.push({ reps: reps.value, weight_kg: weight.value });
    }
    return { exercise_id: ex.exerciseId, sets };
  });

  if (errors.general || Object.keys(errors.sets).length > 0) return { ok: false, errors };

  return {
    ok: true,
    payload: {
      id: draft.id,
      session_date: draft.date,
      notes: draft.notes.trim() || null,
      exercises,
    },
  };
}

/** Copia las series de la sesión anterior: reemplaza filas vacías, si no, añade. */
export function copyPreviousSets(current: DraftSet[], previous: SetValue[]): DraftSet[] {
  const filled = current.filter((s) => !isSetBlank(s));
  return [...filled, ...setsToDraft(previous)];
}

/** Nueva serie: repite la última para registrar con un solo toque. */
export function nextSet(sets: DraftSet[]): DraftSet {
  const last = sets.at(-1);
  return { key: newKey(), reps: last?.reps ?? "", weight: last?.weight ?? "" };
}

// --- Persistencia local (localStorage) -------------------------------------

const PREFIX = "sistema-gym:borrador:";
const NEW_POINTER = "sistema-gym:borrador-nuevo";

export type StoredDraft = { draft: Draft; dirty: boolean; savedOnce: boolean; ownerId: string };

export function draftStorageKey(id: string) {
  return PREFIX + id;
}

export function readStoredDraft(id: string, ownerId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftStorageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.ownerId !== ownerId || parsed.draft?.id !== id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredDraft(value: StoredDraft) {
  try {
    localStorage.setItem(draftStorageKey(value.draft.id), JSON.stringify(value));
  } catch {
    // Sin almacenamiento local (modo privado): el autoguardado en servidor sigue funcionando.
  }
}

export function removeStoredDraft(id: string) {
  try {
    localStorage.removeItem(draftStorageKey(id));
  } catch {}
}

/** Sesión nueva en curso que aún no tiene URL propia. */
export function readNewPointer(ownerId: string): string | null {
  try {
    const raw = localStorage.getItem(NEW_POINTER);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id: string; ownerId: string };
    return parsed.ownerId === ownerId ? parsed.id : null;
  } catch {
    return null;
  }
}

export function writeNewPointer(id: string, ownerId: string) {
  try {
    localStorage.setItem(NEW_POINTER, JSON.stringify({ id, ownerId }));
  } catch {}
}

export function clearNewPointer(id?: string) {
  try {
    if (id) {
      const raw = localStorage.getItem(NEW_POINTER);
      if (raw && (JSON.parse(raw) as { id: string }).id !== id) return;
    }
    localStorage.removeItem(NEW_POINTER);
  } catch {}
}
