import { describe, expect, it } from "vitest";
import {
  distinctPlans,
  formatPlan,
  formatSequence,
  formatSetTotals,
  formatStep,
  isValidBlockSet,
  planOfSet,
  setBest,
  setHoldSeconds,
  setTotalReps,
  type Block,
} from "./blocks";
import { summarizeSets, formatSet } from "./format";
import { sessionStats } from "./progress";
import { formatTarget } from "./routines";
import { draftToPayload, exerciseSummary, nextSet, parseBlocks, setsToDraft, type DraftSet } from "./session-draft";
import type { SetValue } from "./types";

const smith: SetValue = {
  reps: null,
  weight_kg: null,
  rounds: 1,
  blocks: [
    { type: "reps", reps: 7, weight_kg: 40 },
    { type: "reps", reps: 7, weight_kg: 35 },
    { type: "reps", reps: 7, weight_kg: 30 },
  ],
};
const laterales: SetValue = {
  reps: null,
  weight_kg: null,
  rounds: 3,
  blocks: [
    { type: "reps", reps: 7, weight_kg: null },
    { type: "hold", seconds: 7, weight_kg: null },
  ],
};

describe("series por bloques", () => {
  it("resúmenes compactos", () => {
    expect(formatSet(smith)).toBe("7 reps a 40 kg → 7 a 35 kg → 7 a 30 kg");
    expect(formatSet(laterales)).toBe("(7 reps → sostener 7 s) × 3");
    const holdConPeso: Block[] = [{ type: "hold", seconds: 30, weight_kg: 12.5 }];
    expect(formatSequence(holdConPeso, 2)).toBe("sostener 30 s a 12,5 kg × 2");
    expect(summarizeSets([smith, smith, smith, smith])).toBe("4 series: 7 reps a 40 kg → 7 a 35 kg → 7 a 30 kg");
    expect(summarizeSets([{ reps: 10, weight_kg: 40 }, laterales])).toBe("40 kg × 10 · (7 reps → sostener 7 s) × 3");
  });

  it("Smith inclinado: 4 series, 84 reps y máximo 40 kg × 7", () => {
    const [s] = sessionStats([{ session_id: "s", session_date: "2026-11-27", created_at: "2026-11-27T10:00:00Z", sets: [smith, smith, smith, smith] }]);
    expect(s).toMatchObject({ setCount: 4, totalReps: 84, holdSeconds: 0, maxWeight: 40, best: { reps: 7, weight_kg: 40 } });
  });

  it("Elevaciones laterales: 4 series, 84 reps y 84 s de sostén", () => {
    expect(setTotalReps(laterales)).toBe(21);
    expect(setHoldSeconds(laterales)).toBe(21);
    const [s] = sessionStats([
      { session_id: "s", session_date: "2026-11-27", created_at: "2026-11-27T10:00:00Z", sets: [laterales, laterales, laterales, laterales] },
    ]);
    expect(s).toMatchObject({ setCount: 4, totalReps: 84, holdSeconds: 84, maxWeight: null, best: { reps: 7, weight_kg: null } });
  });

  it("totales por serie y formato de pasos", () => {
    expect(formatSetTotals(laterales)).toBe("21 reps · 21 s de sostén");
    expect(formatSetTotals(smith)).toBe("21 reps · de 30 a 40 kg");
    expect(formatSetTotals({ ...smith, blocks: [{ type: "reps", reps: 7, weight_kg: 40 }] })).toBe("7 reps · a 40 kg");
    expect(formatStep({ type: "hold", seconds: 7, weight_kg: null })).toBe("Sostener 7 s");
    expect(formatStep({ type: "reps", reps: 7, weight_kg: 37.5 })).toBe("7 reps a 37,5 kg");
  });

  it("la mejor serie usa el bloque de mayor peso con sus reps", () => {
    const s: SetValue = {
      reps: null,
      weight_kg: null,
      rounds: 2,
      blocks: [
        { type: "reps", reps: 12, weight_kg: 30 },
        { type: "hold", seconds: 10, weight_kg: 80 },
        { type: "reps", reps: 5, weight_kg: 42.5 },
      ],
    };
    expect(setBest(s)).toEqual({ reps: 5, weight_kg: 42.5 });
    expect(setBest({ reps: null, weight_kg: null, rounds: 1, blocks: [{ type: "hold", seconds: 5, weight_kg: null }] })).toBeNull();
  });

  it("validación y estructuras distintas", () => {
    expect(isValidBlockSet(smith)).toBe(true);
    expect(isValidBlockSet({ ...smith, rounds: 0 })).toBe(false);
    expect(isValidBlockSet({ ...smith, blocks: [{ type: "reps", reps: 7, weight_kg: 40.125 }] })).toBe(false);
    expect(isValidBlockSet({ ...smith, reps: 3 })).toBe(false);
    expect(planOfSet(laterales)).toEqual({ rounds: 3, items: [{ type: "reps", reps: 7 }, { type: "hold", seconds: 7 }] });
    expect(distinctPlans([smith, laterales, smith, { reps: 8, weight_kg: 20 }]).map((p) => [formatPlan(p.plan), p.count])).toEqual([
      ["7 reps → 7 reps → 7 reps", 2],
      ["(7 reps → sostener 7 s) × 3", 1],
    ]);
    expect(formatTarget({ sets: 4, repsMin: null, repsMax: null, blocks: planOfSet(laterales) })).toBe("4 series: (7 reps → sostener 7 s) × 3");
  });
});

describe("borrador con series por bloques", () => {
  it("ida y vuelta: borrador → payload, con decimales y ciclos", () => {
    const draft = setsToDraft([{ reps: 10, weight_kg: 40 }, { ...smith, blocks: [{ type: "reps", reps: 7, weight_kg: 42.5 }, ...smith.blocks!.slice(1)] }]);
    expect(draft[1].blocks?.items.map((b) => b.weight)).toEqual(["42,5", "35", "30"]);
    const res = draftToPayload({ id: "x", date: "2026-11-27", notes: "", editedAt: 0, exercises: [{ key: "a", exerciseId: "e", name: "E", sets: draft }] });
    expect(res.ok && res.payload.exercises[0].sets).toEqual([
      { reps: 10, weight_kg: 40 },
      { reps: null, weight_kg: null, rounds: 1, blocks: [{ type: "reps", reps: 7, weight_kg: 42.5 }, smith.blocks![1], smith.blocks![2]] },
    ]);
  });

  it("errores por bloque y por ciclos", () => {
    const [set] = setsToDraft([laterales]);
    const bad = { ...set.blocks!, rounds: "0", items: [{ ...set.blocks!.items[0], value: "" }, set.blocks!.items[1]] };
    const res = parseBlocks(bad);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/Vueltas por serie/);
      expect(Object.values(res.blockErrors)[0]).toMatch(/Paso 1/);
    }
  });

  it("resumen del ejercicio, «Agregar serie» repite la secuencia y no hay filas vacías", () => {
    const sets: DraftSet[] = setsToDraft([smith, smith]);
    expect(exerciseSummary(sets).text).toBe("2 series · Mejor serie: 40 kg × 7");
    const next = nextSet(sets);
    expect(next.blocks?.items.map((b) => [b.type, b.value, b.weight])).toEqual([["reps", "7", "40"], ["reps", "7", "35"], ["reps", "7", "30"]]);
    expect(next.blocks?.items[0].key).not.toBe(sets[1].blocks?.items[0].key);
    expect(exerciseSummary(setsToDraft([laterales])).text).toBe("1 serie · Mejor serie: 7 reps");
  });
});
