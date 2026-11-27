import { describe, expect, it } from "vitest";
import { altTurns, buildSteps, currentTurnIndex, pendingExercises, progressText, stepIndexFor, swapExercise, swapPlan } from "./guided";
import type { DraftExercise, DraftSet } from "./session-draft";

const set = (reps: string, weight = "40"): DraftSet => ({ key: `s${Math.random()}`, reps, weight });
const ex = (key: string, opts: Partial<DraftExercise> = {}): DraftExercise => ({ key, exerciseId: `id-${key}`, name: key, sets: [], ...opts });
const target = (sets: number) => ({ sets, repsMin: 10, repsMax: 10 });

function turnsOf(list: DraftExercise[]) {
  const steps = buildSteps(list);
  const step = steps.find((s) => s.kind === "alt");
  if (!step || step.kind !== "alt") throw new Error("sin pareja");
  return altTurns(step, new Map(list.map((e) => [e.key, e])));
}

describe("modo guiado", () => {
  it("una pareja es un solo paso, en la posición de su primer ejercicio", () => {
    const list = [ex("A"), ex("Press", { alt: { group: 1, slot: 0 } }), ex("B"), ex("Poleas", { alt: { group: 1, slot: 1 } })];
    expect(buildSteps(list).map((s) => s.id)).toEqual(["A", "alt-1", "B"]);
  });

  it("alterna series completas y, con 4 y 3, la cuarta vuelta solo tiene el pendiente", () => {
    const press = ex("Press", { alt: { group: 1, slot: 0 }, target: target(4) });
    const poleas = ex("Poleas", { alt: { group: 1, slot: 1 }, target: target(3) });
    const { turns, rounds } = turnsOf([press, poleas]);
    expect(rounds).toBe(4);
    expect(turns.map((t) => `${t.exKey}${t.round}`)).toEqual(["Press1", "Poleas1", "Press2", "Poleas2", "Press3", "Poleas3", "Press4"]);
    expect(currentTurnIndex(turns)).toBe(0);
  });

  it("retoma en la posición correcta a partir de las series registradas (recarga)", () => {
    const press = ex("Press", { alt: { group: 1, slot: 0 }, target: target(4), sets: [set("10"), set("10")] });
    const poleas = ex("Poleas", { alt: { group: 1, slot: 1 }, target: target(3), sets: [set("12")] });
    const { turns } = turnsOf([press, poleas]);
    const i = currentTurnIndex(turns);
    expect(turns[i]).toMatchObject({ exKey: "Poleas", round: 2, setIndex: 1 });
    expect(turns[i + 1]).toMatchObject({ exKey: "Press", round: 3 });
  });

  it("finalizar un ejercicio con menos series quita sus turnos pendientes", () => {
    const press = ex("Press", { alt: { group: 1, slot: 0 }, target: target(4), sets: [set("10")], done: true });
    const poleas = ex("Poleas", { alt: { group: 1, slot: 1 }, target: target(3), sets: [set("12")] });
    const { turns } = turnsOf([press, poleas]);
    expect(turns.filter((t) => !t.done).map((t) => `${t.exKey}${t.round}`)).toEqual(["Poleas2", "Poleas3"]);
  });

  it("el sustituto de un ejercicio con series toma solo sus turnos pendientes", () => {
    const press = ex("Press", { alt: { group: 1, slot: 0 }, target: target(4), sets: [set("10"), set("10")] });
    const poleas = ex("Poleas", { alt: { group: 1, slot: 1 }, target: target(3), sets: [set("12"), set("12")] });
    expect(swapPlan(press)).toEqual({ mode: "continue", done: 2, pending: 2 });
    const list = swapExercise([press, poleas], "Press", { key: "Manc", exerciseId: "id-Manc", name: "Manc", target: target(2) });
    expect(list.map((e) => e.key)).toEqual(["Press", "Manc", "Poleas"]);
    expect(list[0]).toMatchObject({ done: true, alt: { group: 1, slot: 0 } });
    expect(list[1]).toMatchObject({ sets: [], alt: { group: 1, slot: 0 } });
    const { turns } = turnsOf(list);
    expect(turns.map((t) => `${t.exKey}${t.round}${t.done ? "✓" : ""}`)).toEqual([
      "Press1✓", "Poleas1✓", "Press2✓", "Poleas2✓", "Manc3", "Poleas3", "Manc4",
    ]);
  });

  it("sin series, el sustituto ocupa el mismo lugar y turno", () => {
    const a = ex("Inclinado", { target: target(4), muscleGroupId: "pecho" });
    const list = swapExercise([ex("X"), a, ex("Y")], "Inclinado", { key: "M", exerciseId: "id-M", name: "M", target: target(4) });
    expect(list.map((e) => e.key)).toEqual(["X", "M", "Y"]);
    // Un ejercicio que ya está en la sesión no se agrega dos veces.
    expect(swapExercise(list, "M", { key: "Z", exerciseId: "id-X", name: "X" })).toBe(list);
  });

  it("avance, posición guardada y pendientes al finalizar", () => {
    const a = ex("A", { target: target(4), sets: [set("10"), set("8")] });
    const b = ex("B", { sets: [set("5")], done: true });
    const c = ex("C");
    expect(progressText(a)).toBe("2 de 4 series");
    expect(progressText(c)).toBeNull();
    const steps = buildSteps([a, b, c]);
    const byKey = new Map([a, b, c].map((e) => [e.key, e]));
    expect(stepIndexFor(steps, byKey, "id-C")).toBe(2);
    expect(stepIndexFor(steps, byKey, null)).toBe(0);
    expect(pendingExercises([a, b, c]).map((p) => `${p.name}: ${p.text}`)).toEqual(["A: 2 de 4 series", "C: sin series"]);
  });
});
