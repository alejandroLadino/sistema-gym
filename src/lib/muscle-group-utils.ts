import type { MuscleGroup } from "./types";

export const MUSCLE_GROUP_ID = /^[a-z_]{1,40}$/;

export function muscleGroupName(groups: MuscleGroup[], id: string | null | undefined): string | null {
  if (!id) return null;
  return groups.find((g) => g.id === id)?.name ?? null;
}

/** Agrupa el catálogo por región conservando su orden (para <optgroup>). */
export function groupByRegion(groups: MuscleGroup[]): { region: string; groups: MuscleGroup[] }[] {
  const out: { region: string; groups: MuscleGroup[] }[] = [];
  for (const g of groups) {
    const last = out.at(-1);
    if (last && last.region === g.region) last.groups.push(g);
    else out.push({ region: g.region, groups: [g] });
  }
  return out;
}

/** Valor de un formulario → id del catálogo o null ("" = sin grupo). */
export function parseMuscleGroupId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value === "string" && MUSCLE_GROUP_ID.test(value)) return { ok: true, value };
  return { ok: false };
}

export const GROUP_REQUIRED = "Selecciona un grupo muscular";
export const NAME_REQUIRED = "Escribe el nombre del ejercicio";
/** Valor de filtro para ejercicios antiguos sin grupo. */
export const UNCLASSIFIED = "sin_clasificar";
export const UNCLASSIFIED_LABEL = "Sin clasificar";

export type ExerciseFieldErrors = { name?: string; muscle_group_id?: string };

/**
 * Valida nombre y grupo de un ejercicio. El grupo es obligatorio y debe existir
 * en el catálogo (`groupIds`).
 */
export function validateExerciseInput(
  input: { name: unknown; muscle_group_id: unknown },
  groupIds: string[],
): { ok: true; value: { name: string; muscle_group_id: string } } | { ok: false; errors: ExerciseFieldErrors } {
  const errors: ExerciseFieldErrors = {};
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (!name) errors.name = NAME_REQUIRED;
  const group = parseMuscleGroupId(input.muscle_group_id);
  if (!group.ok || !group.value || !groupIds.includes(group.value)) errors.muscle_group_id = GROUP_REQUIRED;
  if (errors.name || errors.muscle_group_id) return { ok: false, errors };
  return { ok: true, value: { name, muscle_group_id: (group as { value: string }).value } };
}
