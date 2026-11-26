import { describe, expect, it } from "vitest";
import { summarizeSets } from "./format";
import { appendSets, buildQuickSets, draftToPayload, hasNoSets, parseSetCount, type Draft } from "./session-draft";

describe("captura rápida de series", () => {
  it("3 × 10 a 40 kg genera tres filas iguales y editables", () => {
    const res = buildQuickSets({ count: "3", reps: "10", weight: "40" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.sets.map((s) => [s.weight, s.reps])).toEqual([["40", "10"], ["40", "10"], ["40", "10"]]);
    expect(new Set(res.sets.map((s) => s.key)).size).toBe(3);
  });

  it("acepta decimales con coma y peso vacío (peso corporal)", () => {
    const dec = buildQuickSets({ count: "2", reps: "8", weight: "42,5" });
    expect(dec.ok && dec.sets.map((s) => s.weight)).toEqual(["42,5", "42,5"]);
    const bw = buildQuickSets({ count: "3", reps: "12", weight: "" });
    expect(bw.ok && bw.sets.map((s) => [s.weight, s.reps])).toEqual([["", "12"], ["", "12"], ["", "12"]]);
  });

  it("valida cantidad, repeticiones y peso", () => {
    const res = buildQuickSets({ count: "0", reps: "", weight: "40,555" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(Object.keys(res.errors).sort()).toEqual(["count", "reps", "weight"]);
    expect(parseSetCount("21").ok).toBe(false);
    expect(parseSetCount("20")).toEqual({ ok: true, value: 20 });
  });

  it("agrega al final de las series existentes y descarta filas vacías", () => {
    const res = buildQuickSets({ count: "2", reps: "8", weight: "50" });
    if (!res.ok) throw new Error("debía ser válido");
    const out = appendSets(
      [
        { key: "a", reps: "12", weight: "40" },
        { key: "b", reps: "", weight: "" },
      ],
      res.sets,
    );
    expect(out.map((s) => [s.weight, s.reps])).toEqual([["40", "12"], ["50", "8"], ["50", "8"]]);
  });

  it("el resultado se guarda con los valores correctos tras editar una serie", () => {
    const res = buildQuickSets({ count: "3", reps: "10", weight: "40" });
    if (!res.ok) throw new Error("debía ser válido");
    res.sets[2].reps = "8";
    const draft: Draft = {
      id: "50000000-0000-4000-8000-000000000001",
      date: "2026-11-26",
      notes: "",
      editedAt: 0,
      exercises: [{ key: "x", exerciseId: "e0000000-0000-4000-8000-00000000000a", name: "Press", sets: res.sets }],
    };
    const payload = draftToPayload(draft);
    expect(payload.ok && payload.payload.exercises[0].sets).toEqual([
      { reps: 10, weight_kg: 40 },
      { reps: 10, weight_kg: 40 },
      { reps: 8, weight_kg: 40 },
    ]);
  });

  it("detecta un ejercicio vacío", () => {
    expect(hasNoSets([])).toBe(true);
    expect(hasNoSets([{ key: "a", reps: "", weight: "" }])).toBe(true);
    expect(hasNoSets([{ key: "a", reps: "5", weight: "" }])).toBe(false);
  });
});

describe("resumen de la sesión anterior", () => {
  it("agrupa series iguales consecutivas", () => {
    expect(
      summarizeSets([
        { reps: 10, weight_kg: 40 },
        { reps: 10, weight_kg: 40 },
        { reps: 8, weight_kg: 40 },
        { reps: 6, weight_kg: 42.5 },
      ]),
    ).toBe("2 × 10 a 40 kg · 40 kg × 8 · 42,5 kg × 6");
    expect(summarizeSets([{ reps: 10, weight_kg: 40 }, { reps: 10, weight_kg: 40 }, { reps: 10, weight_kg: 40 }])).toBe(
      "3 × 10 a 40 kg",
    );
  });
  it("peso corporal muestra repeticiones", () => {
    expect(summarizeSets([{ reps: 10, weight_kg: null }, { reps: 10, weight_kg: null }, { reps: 8, weight_kg: null }])).toBe(
      "2 × 10 reps · 8 reps",
    );
  });
  it("no agrupa pesos distintos aunque tengan las mismas reps", () => {
    expect(summarizeSets([{ reps: 12, weight_kg: 40 }, { reps: 12, weight_kg: 45 }])).toBe("40 kg × 12 · 45 kg × 12");
  });
});

describe("resumen del ejercicio colapsado", () => {
  it("cuenta las series y resume sus valores", async () => {
    const { exerciseSummary } = await import("./session-draft");
    expect(
      exerciseSummary([
        { key: "1", weight: "10", reps: "12" },
        { key: "2", weight: "10", reps: "12" },
        { key: "3", weight: "10", reps: "12" },
        { key: "4", weight: "15", reps: "12" },
      ]),
    ).toEqual({ count: 4, text: "4 series · 3 × 12 a 10 kg · 15 kg × 12", incomplete: false });
  });
  it("peso corporal, vacío e incompleto", async () => {
    const { exerciseSummary } = await import("./session-draft");
    expect(exerciseSummary([{ key: "1", weight: "", reps: "10" }])).toEqual({ count: 1, text: "1 serie · 10 reps", incomplete: false });
    expect(exerciseSummary([])).toEqual({ count: 0, text: "Sin series", incomplete: false });
    expect(exerciseSummary([{ key: "1", weight: "40", reps: "" }, { key: "2", weight: "40", reps: "8" }])).toEqual({
      count: 2,
      text: "2 series · 40 kg × 8",
      incomplete: true,
    });
  });
});
