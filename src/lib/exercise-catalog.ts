import { muscleGroupName, UNCLASSIFIED } from "./muscle-group-utils";
import type { Exercise, MuscleGroup } from "./types";
import { normalizeSearch } from "./validation";

export const ALL_GROUPS = "todos";
export type CatalogView = "activos" | "archivados";
export type CatalogFilters = { q: string; group: string; view: CatalogView };

export const DEFAULT_FILTERS: CatalogFilters = { q: "", group: ALL_GROUPS, view: "activos" };

/** ¿El ejercicio pasa los filtros? La búsqueda mira el nombre y el nombre del grupo. */
export function matchesFilters(exercise: Exercise, groups: MuscleGroup[], filters: CatalogFilters): boolean {
  const archived = Boolean(exercise.archived_at);
  if (filters.view === "activos" ? archived : !archived) return false;
  if (filters.group === UNCLASSIFIED) {
    if (exercise.muscle_group_id) return false;
  } else if (filters.group !== ALL_GROUPS && exercise.muscle_group_id !== filters.group) {
    return false;
  }
  const q = normalizeSearch(filters.q);
  if (!q) return true;
  const text = normalizeSearch(`${exercise.name} ${muscleGroupName(groups, exercise.muscle_group_id) ?? ""}`);
  return text.includes(q);
}

export function filterCatalog(exercises: Exercise[], groups: MuscleGroup[], filters: CatalogFilters): Exercise[] {
  return exercises
    .filter((e) => matchesFilters(e, groups, filters))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return Boolean(filters.q.trim()) || filters.group !== ALL_GROUPS;
}

/** Lee los filtros de la URL (?q=&grupo=&archivados=1). */
export function filtersFromParams(
  params: Record<string, string | string[] | undefined>,
  groups: MuscleGroup[],
): CatalogFilters {
  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const g = typeof params.grupo === "string" ? params.grupo : "";
  const group = g === UNCLASSIFIED || groups.some((x) => x.id === g) ? g : ALL_GROUPS;
  return { q, group, view: params.archivados === "1" ? "archivados" : "activos" };
}

export function filtersToSearch(filters: CatalogFilters): string {
  const sp = new URLSearchParams();
  if (filters.q.trim()) sp.set("q", filters.q.trim());
  if (filters.group !== ALL_GROUPS) sp.set("grupo", filters.group);
  if (filters.view === "archivados") sp.set("archivados", "1");
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Grupo a precargar al crear: el filtrado, salvo «Todos» o «Sin clasificar». */
export function groupForNewExercise(filters: CatalogFilters): string {
  return filters.group === ALL_GROUPS || filters.group === UNCLASSIFIED ? "" : filters.group;
}
