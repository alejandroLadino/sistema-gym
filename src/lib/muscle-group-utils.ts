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
