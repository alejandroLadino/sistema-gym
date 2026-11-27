import { isIsoDate } from "./format";
import { isBlockSet, MAX_BLOCKS, MAX_HOLD_SECONDS, MAX_ROUNDS, setHoldSeconds, type Block, type BlockPlanItem } from "./blocks";
import { bestSet, formatBestSet } from "./progress";
import type { SessionData, SetValue } from "./types";
import type { Target } from "./routines";
import { parseReps, parseWeight, type Parsed } from "./validation";

/** Bloque editable de una serie por bloques (valores como texto). */
export type DraftBlock = { key: string; type: "reps" | "hold"; value: string; weight: string };
/** Secuencia editable: bloques en orden y veces que se repite dentro de la serie. */
export type DraftBlocks = { rounds: string; items: DraftBlock[] };
/** Serie simple (reps/peso) o, si trae `blocks`, serie por bloques. */
export type DraftSet = { key: string; reps: string; weight: string; blocks?: DraftBlocks };
export type DraftExercise = {
  key: string;
  exerciseId: string;
  name: string;
  archived?: boolean;
  /** Meta de la rutina con que se inició la sesión (solo se muestra; no se envía). */
  target?: Target | null;
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

export function blocksToDraft(blocks: Block[] | BlockPlanItem[], rounds: number): DraftBlocks {
  return {
    rounds: String(rounds),
    items: blocks.map((b) => ({
      key: newKey(),
      type: b.type,
      value: String(b.type === "reps" ? b.reps : b.seconds),
      weight: "weight_kg" in b ? weightToInput(b.weight_kg) : "",
    })),
  };
}

export function setsToDraft(sets: SetValue[]): DraftSet[] {
  return sets.map((s) =>
    isBlockSet(s)
      ? { key: newKey(), reps: "", weight: "", blocks: blocksToDraft(s.blocks, s.rounds ?? 1) }
      : { key: newKey(), reps: String(s.reps), weight: weightToInput(s.weight_kg) },
  );
}

export const MAX_ROUNDS_INPUT = MAX_ROUNDS;

/** Valida una secuencia editable y la convierte en serie por bloques. */
export function parseBlocks(input: DraftBlocks): { ok: true; set: SetValue } | { ok: false; error: string; blockErrors: Record<string, string> } {
  const blockErrors: Record<string, string> = {};
  let error: string | null = null;
  const rounds = input.rounds.trim();
  const roundsN = /^\d{1,2}$/.test(rounds) ? Number(rounds) : NaN;
  if (!(roundsN >= 1 && roundsN <= MAX_ROUNDS)) error = `Repetir secuencia: un entero de 1 a ${MAX_ROUNDS}`;
  if (input.items.length === 0) error ??= "Agrega al menos un bloque";
  if (input.items.length > MAX_BLOCKS) error ??= `Máximo ${MAX_BLOCKS} bloques`;
  const blocks: Block[] = [];
  input.items.forEach((b, i) => {
    const weight = parseWeight(b.weight);
    if (b.type === "reps") {
      const reps = parseReps(b.value);
      if (!reps.ok) blockErrors[b.key] = `Bloque ${i + 1}: ${reps.error.toLowerCase()}`;
      else if (!weight.ok) blockErrors[b.key] = `Bloque ${i + 1}: ${weight.error.toLowerCase()}`;
      else blocks.push({ type: "reps", reps: reps.value, weight_kg: weight.value });
    } else {
      const raw = b.value.trim();
      const secs = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
      if (!(secs >= 1 && secs <= MAX_HOLD_SECONDS)) blockErrors[b.key] = `Bloque ${i + 1}: segundos de 1 a ${MAX_HOLD_SECONDS}`;
      else if (!weight.ok) blockErrors[b.key] = `Bloque ${i + 1}: ${weight.error.toLowerCase()}`;
      else blocks.push({ type: "hold", seconds: secs, weight_kg: weight.value });
    }
  });
  if (error || Object.keys(blockErrors).length) {
    return { ok: false, error: error ?? Object.values(blockErrors)[0], blockErrors };
  }
  return { ok: true, set: { reps: null, weight_kg: null, rounds: roundsN, blocks } };
}

/** Copia de una secuencia con claves nuevas (para agregar varias series iguales). */
export function cloneBlocks(b: DraftBlocks): DraftBlocks {
  return { rounds: b.rounds, items: b.items.map((x) => ({ ...x, key: newKey() })) };
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
      target:
        e.target_sets != null || e.target_reps_min != null || e.target_blocks != null
          ? {
              sets: e.target_sets ?? null,
              repsMin: e.target_reps_min ?? null,
              repsMax: e.target_reps_max ?? null,
              blocks: e.target_blocks ?? null,
            }
          : null,
      sets: setsToDraft(e.sets),
    })),
  };
}

export function isSetBlank(set: DraftSet): boolean {
  if (set.blocks) return false;
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
      if (set.blocks) {
        const parsed = parseBlocks(set.blocks);
        if (!parsed.ok) errors.sets[set.key] = parsed.error;
        else sets.push(parsed.set);
        continue;
      }
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
    if (set.blocks) {
      const parsed = parseBlocks(set.blocks);
      if (parsed.ok) valid.push(parsed.set);
      else incomplete = true;
      continue;
    }
    if (isSetBlank(set)) continue;
    const reps = parseReps(set.reps);
    const weight = parseWeight(set.weight);
    if (reps.ok && weight.ok) valid.push({ reps: reps.value, weight_kg: weight.value });
    else incomplete = true;
  }
  if (valid.length === 0) return { count: 0, text: "Sin series registradas", best: null, incomplete };
  const top = bestSet(valid);
  const hold = valid.reduce((sum, s) => sum + setHoldSeconds(s), 0);
  // Solo sostenes (sin bloques de repeticiones): se resume el tiempo.
  const best = top.reps === 0 && hold > 0 ? `${hold} s de sostén` : formatBestSet(top, top.weight_kg !== null);
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
  // Si la última es por bloques, se repite su secuencia (pesos y ciclos incluidos).
  if (last?.blocks) return { key: newKey(), reps: "", weight: "", blocks: cloneBlocks(last.blocks) };
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
