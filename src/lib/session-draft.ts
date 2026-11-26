import { isIsoDate } from "./format";
import { bestSet, formatBestSet } from "./progress";
import type { SessionData, SetValue } from "./types";
import { parseReps, parseWeight, type Parsed } from "./validation";

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
  // Sin ejercicios también es válido: una sesión en curso puede quedar vacía en el
  // servidor. Finalizar exige al menos uno (editor y base de datos).

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

export const MAX_QUICK_SETS = 20;

export type QuickAddInput = { count: string; reps: string; weight: string };
export type QuickAddErrors = Partial<Record<keyof QuickAddInput, string>>;

/** Cantidad de series de la captura rápida (1 a 20). */
export function parseSetCount(input: string): Parsed<number> {
  const raw = input.trim();
  if (!/^\d{1,2}$/.test(raw)) return { ok: false, error: "Indica cuántas series" };
  const value = Number(raw);
  if (value < 1 || value > MAX_QUICK_SETS) return { ok: false, error: `Entre 1 y ${MAX_QUICK_SETS} series` };
  return { ok: true, value };
}

/**
 * Captura rápida: «3 series × 10 reps a 40 kg» → 3 filas editables.
 * El peso vacío es peso corporal.
 */
export function buildQuickSets(
  input: QuickAddInput,
): { ok: true; sets: DraftSet[] } | { ok: false; errors: QuickAddErrors } {
  const errors: QuickAddErrors = {};
  const count = parseSetCount(input.count);
  const reps = parseReps(input.reps);
  const weight = parseWeight(input.weight);
  if (!count.ok) errors.count = count.error;
  if (!reps.ok) errors.reps = reps.error;
  if (!weight.ok) errors.weight = weight.error;
  if (!count.ok || !reps.ok || !weight.ok) return { ok: false, errors };
  const weightText = weightToInput(weight.value);
  return {
    ok: true,
    sets: Array.from({ length: count.value }, () => ({ key: newKey(), reps: String(reps.value), weight: weightText })),
  };
}

/** Agrega series al final; descarta filas totalmente vacías. */
export function appendSets(current: DraftSet[], added: DraftSet[]): DraftSet[] {
  return [...current.filter((s) => !isSetBlank(s)), ...added];
}

/** Un ejercicio está vacío si no tiene ninguna serie con datos. */
export function hasNoSets(sets: DraftSet[]): boolean {
  return sets.every(isSetBlank);
}

/**
 * Resumen de la tarjeta cerrada: cantidad de series registradas y mejor serie.
 * Con peso: mayor peso y las reps de esa serie (empate → más reps). Peso corporal:
 * la serie con más reps. Las filas vacías o a medias no cuentan (`incomplete`).
 */
export function exerciseSummary(sets: DraftSet[]): { count: number; text: string; best: string | null; incomplete: boolean } {
  const valid: SetValue[] = [];
  let incomplete = false;
  for (const set of sets) {
    if (isSetBlank(set)) continue;
    const reps = parseReps(set.reps);
    const weight = parseWeight(set.weight);
    if (reps.ok && weight.ok) valid.push({ reps: reps.value, weight_kg: weight.value });
    else incomplete = true;
  }
  if (valid.length === 0) return { count: 0, text: "Sin series registradas", best: null, incomplete };
  const top = bestSet(valid);
  const best = formatBestSet(top, top.weight_kg !== null);
  const count = `${valid.length} ${valid.length === 1 ? "serie" : "series"}`;
  return { count: valid.length, text: `${count} · Mejor serie: ${best}`, best, incomplete };
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

/**
 * Qué mostrar al abrir una sesión guardada que también tiene copia local:
 *  - "server": no hay cambios locales más nuevos que el servidor;
 *  - "local": cambios locales válidos más nuevos (se recuperan y se guardan);
 *  - "conflict": la copia local está vacía pero la sesión guardada está finalizada y
 *    tiene ejercicios. El servidor no acepta vaciarla, así que se muestra su versión
 *    y se ofrece descartar la copia.
 */
export function resolveStoredDraft(initial: SessionData, stored: StoredDraft | null): "server" | "local" | "conflict" {
  if (!stored?.dirty || stored.draft.editedAt <= Date.parse(initial.updated_at)) return "server";
  if (initial.finished_at && stored.draft.exercises.length === 0 && initial.exercises.length > 0) return "conflict";
  return "local";
}

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

/** ¿Hay una sesión nueva empezada en este dispositivo que aún no se guardó en el servidor? */
export function hasUnsavedNewDraft(ownerId: string): boolean {
  const id = readNewPointer(ownerId);
  if (!id) return false;
  const stored = readStoredDraft(id, ownerId);
  return Boolean(stored && !stored.savedOnce && stored.draft.exercises.length > 0);
}
