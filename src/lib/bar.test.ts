import { describe, expect, it } from "vitest";
import { formatSequence, formatStep, setBest } from "./blocks";
import { formatSet, summarizeSets } from "./format";
import { formatBestSet, sessionStats, usesWeight } from "./progress";
import { draftToPayload, nextSet, setsToDraft } from "./session-draft";
import type { SetValue } from "./types";

const barra: SetValue = { reps: 10, weight_kg: null, bar_only: true };
const bloques: SetValue = {
  reps: null,
  weight_kg: null,
  rounds: 1,
  blocks: [
    { type: "reps", reps: 7, weight_kg: 30 },
    { type: "reps", reps: 7, weight_kg: null, bar_only: true },
  ],
};
const row = (sets: SetValue[]) => [{ session_id: "s", session_date: "2026-11-27", created_at: "2026-11-27T10:00:00Z", sets }];

describe("«Solo barra»", () => {
  it("textos de serie, bloques y resumen", () => {
    expect(formatSet(barra)).toBe("Solo barra × 10");
    expect(formatSet({ ...barra, weight_kg: 20 })).toBe("Solo barra (20 kg) × 10");
    expect(formatSet(bloques)).toBe("7 reps a 30 kg → 7 reps · solo barra");
    expect(formatSequence([{ type: "hold", seconds: 7, weight_kg: null, bar_only: true }], 1)).toBe("sostener 7 s · solo barra");
    expect(formatStep({ type: "hold", seconds: 7, weight_kg: null, bar_only: true })).toBe("Sostener 7 s · solo barra");
    expect(summarizeSets([barra, barra, { reps: 8, weight_kg: 40 }])).toBe("2 × 10 · solo barra · 40 kg × 8");
    // Barra y peso corporal son distintos.
    expect(summarizeSets([barra, { reps: 10, weight_kg: null }])).toBe("Solo barra × 10 · 10 reps");
  });

  it("Progreso: cuenta series y reps, excluye la carga desconocida del máximo y no es peso corporal", () => {
    const [s] = sessionStats(row([barra, { reps: 8, weight_kg: 40 }, bloques]));
    expect(s).toMatchObject({ setCount: 3, totalReps: 32, maxWeight: 40, hasBar: true, best: { reps: 8, weight_kg: 40 } });
    const [solo] = sessionStats(row([barra]));
    expect(solo.maxWeight).toBeNull();
    expect(usesWeight([solo])).toBe(true);
    expect(formatBestSet(solo.best, true)).toBe("Solo barra × 10");
    // Con el peso real de la barra registrado, entra en el máximo.
    const [conPeso] = sessionStats(row([{ ...barra, weight_kg: 45 }, { reps: 8, weight_kg: 40 }]));
    expect(conPeso).toMatchObject({ maxWeight: 45, best: { reps: 10, weight_kg: 45, bar_only: true } });
    expect(setBest(bloques)).toEqual({ reps: 7, weight_kg: 30 });
  });

  it("borrador: ida y vuelta, «Agregar serie» y copia conservan la marca", () => {
    const draft = setsToDraft([barra, bloques]);
    expect(draft[0]).toMatchObject({ reps: "10", weight: "", bar: true });
    expect(draft[1].blocks?.items.map((b) => b.bar ?? false)).toEqual([false, true]);
    expect(nextSet([draft[0]])).toMatchObject({ reps: "10", weight: "", bar: true });
    const res = draftToPayload({ id: "x", date: "2026-11-27", notes: "", editedAt: 0, exercises: [{ key: "a", exerciseId: "e", name: "E", sets: draft }] });
    expect(res.ok && res.payload.exercises[0].sets).toEqual([barra, bloques]);
  });
});
