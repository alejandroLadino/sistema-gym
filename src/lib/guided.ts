import { isSetBlank, type DraftExercise, type DraftSet } from "./session-draft";

/**
 * Entrenamiento guiado: la sesión se recorre por «pasos» (tarjetas). Un ejercicio suelto
 * es un paso; una pareja de series alternadas es un solo paso que avanza por turnos.
 * Todo se calcula a partir del borrador (series, completados y parejas), así que la vista
 * de lista y el modo guiado trabajan sobre los mismos datos y, al recargar, la posición
 * dentro de una pareja se recupera sola.
 */
export type Step =
  | { id: string; kind: "single"; exKey: string }
  | { id: string; kind: "alt"; group: number; slots: [string[], string[]] };

/** Series con datos (las filas vacías recién agregadas no cuentan). */
export function registeredSets(ex: DraftExercise): DraftSet[] {
  return ex.sets.filter((s) => !isSetBlank(s));
}

/** «2 de 4 series» si el ejercicio tiene meta de series. */
export function progressText(ex: DraftExercise): string | null {
  const goal = ex.target?.sets ?? null;
  if (goal === null) return null;
  return `${registeredSets(ex).length} de ${goal} ${goal === 1 ? "serie" : "series"}`;
}

/** Pasos en el orden de la lista; una pareja aparece donde está su primer ejercicio. */
export function buildSteps(exercises: DraftExercise[]): Step[] {
  const steps: Step[] = [];
  const seen = new Set<number>();
  for (const ex of exercises) {
    if (!ex.alt) {
      steps.push({ id: ex.key, kind: "single", exKey: ex.key });
      continue;
    }
    if (seen.has(ex.alt.group)) continue;
    seen.add(ex.alt.group);
    const members = exercises.filter((e) => e.alt?.group === ex.alt!.group);
    steps.push({
      id: `alt-${ex.alt.group}`,
      kind: "alt",
      group: ex.alt.group,
      slots: [members.filter((e) => e.alt!.slot === 0).map((e) => e.key), members.filter((e) => e.alt!.slot === 1).map((e) => e.key)],
    });
  }
  return steps;
}

export function stepExerciseKeys(step: Step): string[] {
  return step.kind === "single" ? [step.exKey] : [...step.slots[0], ...step.slots[1]];
}

export type Turn = {
  /** Vuelta (1, 2, …). */
  round: number;
  slot: 0 | 1;
  exKey: string;
  /** Posición de la serie dentro del ejercicio (0 = primera). */
  setIndex: number;
  done: boolean;
};

/**
 * Series que un ejercicio aporta a su turno: si está completado, las que registró; si no,
 * su meta (o las que ya lleva, si superó la meta).
 */
function capacity(ex: DraftExercise): number {
  const n = registeredSets(ex).length;
  return ex.done ? n : Math.max(ex.target?.sets ?? 1, n);
}

/**
 * Turnos de una pareja: Press 1 → Poleas 1 → Press 2 → Poleas 2 … Si un turno tiene más
 * series que el otro, en las últimas vueltas solo aparece el que sigue pendiente. Si un
 * ejercicio se cambió después de registrar series, su sustituto (mismo turno) continúa
 * con las series pendientes.
 */
export function altTurns(step: Extract<Step, { kind: "alt" }>, byKey: Map<string, DraftExercise>): { turns: Turn[]; rounds: number } {
  const slotPlan = step.slots.map((keys) => {
    const ranges: { exKey: string; start: number; cap: number; n: number }[] = [];
    let start = 0;
    for (const k of keys) {
      const ex = byKey.get(k);
      if (!ex) continue;
      const cap = capacity(ex);
      ranges.push({ exKey: k, start, cap, n: registeredSets(ex).length });
      start += cap;
    }
    return { ranges, total: start };
  });
  const rounds = Math.max(slotPlan[0].total, slotPlan[1].total);
  const turns: Turn[] = [];
  for (let r = 1; r <= rounds; r++) {
    for (const slot of [0, 1] as const) {
      const plan = slotPlan[slot];
      if (r > plan.total) continue;
      const range = plan.ranges.find((x) => r - 1 >= x.start && r - 1 < x.start + x.cap)!;
      const setIndex = r - 1 - range.start;
      turns.push({ round: r, slot, exKey: range.exKey, setIndex, done: setIndex < range.n });
    }
  }
  return { turns, rounds };
}

/** Índice del turno que toca (el primero sin registrar) o -1 si la pareja terminó. */
export function currentTurnIndex(turns: Turn[]): number {
  return turns.findIndex((t) => !t.done);
}

/** Un paso está completo cuando todos sus ejercicios se marcaron como finalizados. */
export function stepComplete(step: Step, byKey: Map<string, DraftExercise>): boolean {
  return stepExerciseKeys(step).every((k) => byKey.get(k)?.done);
}

/** Paso del modo guiado que contiene el ejercicio guardado como posición (o el primero pendiente). */
export function stepIndexFor(steps: Step[], byKey: Map<string, DraftExercise>, exerciseId: string | null): number {
  if (exerciseId) {
    const i = steps.findIndex((s) => stepExerciseKeys(s).some((k) => byKey.get(k)?.exerciseId === exerciseId));
    if (i >= 0) return i;
  }
  const pending = steps.findIndex((s) => !stepComplete(s, byKey));
  return pending >= 0 ? pending : 0;
}

/** Ejercicios sin terminar al finalizar la sesión: no completados y por debajo de su meta o sin series. */
export function pendingExercises(exercises: DraftExercise[]): { key: string; name: string; text: string }[] {
  return exercises
    .filter((ex) => !ex.done)
    .map((ex) => {
      const n = registeredSets(ex).length;
      const goal = ex.target?.sets ?? null;
      if (n === 0) return { key: ex.key, name: ex.name, text: goal ? `0 de ${goal} series` : "sin series" };
      if (goal !== null && n < goal) return { key: ex.key, name: ex.name, text: `${n} de ${goal} series` };
      return null;
    })
    .filter((x): x is { key: string; name: string; text: string } => x !== null);
}

/** Siguiente número de pareja libre en la sesión o la rutina. */
export function nextAltGroup(items: { alt?: { group: number } | null }[]): number {
  return Math.max(0, ...items.map((e) => e.alt?.group ?? 0)) + 1;
}

export type SwapPlan = {
  /** "replace": el sustituto ocupa el lugar (sin series); "continue": el original se conserva y el sustituto sigue. */
  mode: "replace" | "continue";
  done: number;
  /** Series pendientes según la meta (null sin meta de series). */
  pending: number | null;
};

/** Qué pasará al cambiar el ejercicio, según sus series registradas y su meta. */
export function swapPlan(ex: DraftExercise): SwapPlan {
  const done = registeredSets(ex).length;
  const goal = ex.target?.sets ?? null;
  if (done === 0) return { mode: "replace", done, pending: goal };
  return { mode: "continue", done, pending: goal === null ? null : Math.max(goal - done, 1) };
}

/**
 * Cambia un ejercicio solo en esta sesión. Sin series: el sustituto ocupa su lugar (y su
 * turno si alterna). Con series: el original las conserva y queda completado; el
 * sustituto va justo después, en el mismo turno, para las series pendientes.
 */
export function swapExercise(
  exercises: DraftExercise[],
  targetKey: string,
  substitute: Pick<DraftExercise, "key" | "exerciseId" | "name" | "muscleGroupId" | "target">,
): DraftExercise[] {
  const i = exercises.findIndex((e) => e.key === targetKey);
  if (i < 0 || exercises.some((e) => e.exerciseId === substitute.exerciseId)) return exercises;
  const original = exercises[i];
  const next: DraftExercise = { ...substitute, sets: [], done: false, alt: original.alt ?? null };
  const list = [...exercises];
  if (swapPlan(original).mode === "replace") {
    list[i] = next;
  } else {
    list[i] = { ...original, sets: registeredSets(original), done: true };
    list.splice(i + 1, 0, next);
  }
  return list;
}
