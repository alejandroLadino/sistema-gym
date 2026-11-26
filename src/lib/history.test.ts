import { describe, expect, it } from "vitest";
import {
  exercisePreview,
  groupByMonth,
  hasActiveFilters,
  historyBounds,
  historyQueryString,
  mergePages,
  readHistoryFilters,
  type HistorySession,
} from "./history";

const s = (id: string, date: string): HistorySession => ({
  id,
  session_date: date,
  created_at: `${date}T10:00:00Z`,
  finished_at: `${date}T11:00:00Z`,
  exercise_count: 1,
  set_count: 3,
  muscle_groups: ["Pecho"],
  exercise_names: ["Press de banca"],
  total_count: null,
});

const TODAY = "2026-11-26"; // jueves

describe("filtros en la URL", () => {
  it("abre en «Todo» y descarta valores inválidos", () => {
    expect(readHistoryFilters({})).toEqual({ range: "todo", from: "", to: "", q: "" });
    expect(readHistoryFilters({ rango: "año", desde: "2026-11-01" })).toEqual({ range: "todo", from: "", to: "", q: "" });
    expect(readHistoryFilters({ rango: "personalizado", desde: "2026-02-30", hasta: "2026-11-20", q: "press" })).toEqual({
      range: "personalizado",
      from: "",
      to: "2026-11-20",
      q: "press",
    });
  });
  it("ida y vuelta por la URL", () => {
    const f = { range: "personalizado" as const, from: "2026-11-01", to: "", q: " press " };
    expect(historyQueryString(f)).toBe("?rango=personalizado&desde=2026-11-01&q=press");
    expect(readHistoryFilters(Object.fromEntries(new URLSearchParams(historyQueryString(f).slice(1))))).toEqual({
      ...f,
      q: "press",
    });
    expect(historyQueryString({ range: "todo", from: "", to: "", q: "" })).toBe("");
    expect(hasActiveFilters({ range: "todo", from: "", to: "", q: "  " })).toBe(false);
    expect(hasActiveFilters({ range: "semana", from: "", to: "", q: "" })).toBe(true);
  });
});

describe("rangos con la fecha local", () => {
  const f = (range: "todo" | "semana" | "mes" | "personalizado", from = "", to = "") => ({ range, from, to, q: "" });
  it("Todo, Esta semana (lunes a domingo) y Este mes", () => {
    expect(historyBounds(f("todo"), TODAY)).toEqual({ ok: true, bounds: { from: null, to: null } });
    expect(historyBounds(f("semana"), TODAY)).toEqual({ ok: true, bounds: { from: "2026-11-23", to: "2026-11-29" } });
    expect(historyBounds(f("mes"), TODAY)).toEqual({ ok: true, bounds: { from: "2026-11-01", to: "2026-11-30" } });
    expect(historyBounds(f("mes"), "2028-02-10")).toEqual({ ok: true, bounds: { from: "2028-02-01", to: "2028-02-29" } });
  });
  it("Personalizado con un solo límite y validación", () => {
    expect(historyBounds(f("personalizado", "2026-11-01"), TODAY)).toEqual({ ok: true, bounds: { from: "2026-11-01", to: null } });
    expect(historyBounds(f("personalizado", "", "2026-11-01"), TODAY)).toEqual({ ok: true, bounds: { from: null, to: "2026-11-01" } });
    expect(historyBounds(f("personalizado", "2026-11-20", "2026-11-01"), TODAY)).toMatchObject({ ok: false });
  });
});

describe("lista", () => {
  it("agrupa por mes y conserva las sesiones del mismo día", () => {
    const groups = groupByMonth([s("a", "2026-11-26"), s("b", "2026-11-26"), s("c", "2026-10-31"), s("d", "2025-11-02")]);
    expect(groups.map((g) => [g.label, g.sessions.map((x) => x.id)])).toEqual([
      ["Noviembre de 2026", ["a", "b"]],
      ["Octubre de 2026", ["c"]],
      ["Noviembre de 2025", ["d"]],
    ]);
  });
  it("previsualiza hasta dos ejercicios", () => {
    expect(exercisePreview([], 0)).toBe("Sin ejercicios");
    expect(exercisePreview(["Press"], 1)).toBe("Press");
    expect(exercisePreview(["Press", "Remo"], 2)).toBe("Press · Remo");
    expect(exercisePreview(["Press", "Remo"], 5)).toBe("Press · Remo · +3 más");
  });
  it("las páginas no repiten sesiones", () => {
    expect(mergePages([s("a", "2026-11-26")], [s("a", "2026-11-26"), s("b", "2026-11-20")]).map((x) => x.id)).toEqual(["a", "b"]);
  });
});
