import { describe, expect, it } from "vitest";
import {
  ALL_GROUPS,
  DEFAULT_FILTERS,
  filterCatalog,
  filtersFromParams,
  filtersToSearch,
  groupForNewExercise,
  hasActiveFilters,
  matchesFilters,
} from "./exercise-catalog";
import type { Exercise } from "./types";

const groups = [
  { id: "pecho", name: "Pecho", region: "Tren superior" },
  { id: "espalda", name: "Espalda", region: "Tren superior" },
  { id: "biceps", name: "Bíceps", region: "Tren superior" },
];
const ex = (id: string, name: string, g: string | null, archived = false): Exercise => ({
  id,
  name,
  muscle_group_id: g,
  notes: null,
  archived_at: archived ? "2026-11-01T00:00:00Z" : null,
});
const catalog = [
  ex("1", "Press de banca", "pecho"),
  ex("2", "Aperturas", "pecho"),
  ex("3", "Remo con barra", "espalda"),
  ex("4", "Curl martillo", "biceps"),
  ex("5", "Pullover", "pecho", true),
  ex("6", "Remo antiguo", null),
];

describe("filtrado del catálogo", () => {
  it("combina vista, grupo y texto", () => {
    expect(filterCatalog(catalog, groups, DEFAULT_FILTERS).map((e) => e.name)).toEqual([
      "Aperturas",
      "Curl martillo",
      "Press de banca",
      "Remo antiguo",
      "Remo con barra",
    ]);
    expect(filterCatalog(catalog, groups, { q: "", group: "pecho", view: "activos" }).map((e) => e.id)).toEqual(["2", "1"]);
    expect(filterCatalog(catalog, groups, { q: "", group: "pecho", view: "archivados" }).map((e) => e.id)).toEqual(["5"]);
    expect(filterCatalog(catalog, groups, { q: "remo", group: "espalda", view: "activos" }).map((e) => e.id)).toEqual(["3"]);
  });
  it("busca sin tildes ni mayúsculas, también por el nombre del grupo", () => {
    expect(filterCatalog(catalog, groups, { ...DEFAULT_FILTERS, q: "BICEPS" }).map((e) => e.id)).toEqual(["4"]);
    expect(filterCatalog(catalog, groups, { ...DEFAULT_FILTERS, q: "  apertu " }).map((e) => e.id)).toEqual(["2"]);
  });
  it("filtra los ejercicios sin clasificar", () => {
    expect(filterCatalog(catalog, groups, { ...DEFAULT_FILTERS, group: "sin_clasificar" }).map((e) => e.id)).toEqual(["6"]);
  });
  it("detecta si un ejercicio queda oculto por los filtros", () => {
    expect(matchesFilters(ex("9", "Dominadas", "espalda"), groups, { q: "", group: "pecho", view: "activos" })).toBe(false);
    expect(matchesFilters(ex("9", "Dominadas", "espalda"), groups, DEFAULT_FILTERS)).toBe(true);
  });
});

describe("filtros en la URL y precarga del grupo", () => {
  it("lee y escribe los parámetros", () => {
    const f = filtersFromParams({ q: "press", grupo: "pecho", archivados: "1" }, groups);
    expect(f).toEqual({ q: "press", group: "pecho", view: "archivados" });
    expect(filtersToSearch(f)).toBe("?q=press&grupo=pecho&archivados=1");
    expect(filtersFromParams({ grupo: "inventado" }, groups).group).toBe(ALL_GROUPS);
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe("");
  });
  it("precarga el grupo filtrado, no «Todos» ni «Sin clasificar»", () => {
    expect(groupForNewExercise({ ...DEFAULT_FILTERS, group: "pecho" })).toBe("pecho");
    expect(groupForNewExercise(DEFAULT_FILTERS)).toBe("");
    expect(groupForNewExercise({ ...DEFAULT_FILTERS, group: "sin_clasificar" })).toBe("");
  });
  it("sabe si hay filtros activos", () => {
    expect(hasActiveFilters(DEFAULT_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, q: "x" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULT_FILTERS, view: "archivados" })).toBe(false);
  });
});

describe("equipo en el catálogo", () => {
  it("la búsqueda encuentra por equipo y ordena las variantes", async () => {
    const { filterCatalog, DEFAULT_FILTERS } = await import("./exercise-catalog");
    const { exerciseLabel } = await import("./equipment");
    const ex = (id: string, equipment: string | null) => ({
      id, name: "Press de banca plano", muscle_group_id: "pecho", equipment, notes: null, archived_at: null,
    });
    const list = [ex("m", "mancuernas"), ex("b", "barra"), ex("x", null)];
    expect(filterCatalog(list, [], { ...DEFAULT_FILTERS, q: "mancuernas" }).map((e) => e.id)).toEqual(["m"]);
    expect(filterCatalog(list, [], DEFAULT_FILTERS).map((e) => e.id)).toEqual(["x", "b", "m"]);
    expect(list.map(exerciseLabel)).toEqual(["Press de banca plano · Mancuernas", "Press de banca plano · Barra", "Press de banca plano"]);
  });
});
