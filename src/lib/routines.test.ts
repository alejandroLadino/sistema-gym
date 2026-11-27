import { describe, expect, it } from "vitest";
import { formatTarget, move, parseTarget, routineToPayload, routineUsage, type RoutineDraftExercise } from "./routines";

const row = (key: string, exerciseId: string, t: Partial<Pick<RoutineDraftExercise, "sets" | "repsMin" | "repsMax">> = {}): RoutineDraftExercise => ({
  key,
  exerciseId,
  name: key,
  archived: false,
  sets: "",
  repsMin: "",
  repsMax: "",
  ...t,
});

describe("metas", () => {
  it("opcionales, cantidad o rango", () => {
    expect(parseTarget({ sets: "", repsMin: "", repsMax: "" })).toEqual({ ok: true, target: { sets: null, repsMin: null, repsMax: null } });
    expect(parseTarget({ sets: "3", repsMin: "8", repsMax: "12" })).toEqual({ ok: true, target: { sets: 3, repsMin: 8, repsMax: 12 } });
    expect(parseTarget({ sets: "3", repsMin: "10", repsMax: "" })).toEqual({ ok: true, target: { sets: 3, repsMin: 10, repsMax: 10 } });
  });
  it("enteros positivos y mínimo ≤ máximo", () => {
    expect(parseTarget({ sets: "0", repsMin: "", repsMax: "" })).toMatchObject({ ok: false, errors: { sets: expect.any(String) } });
    expect(parseTarget({ sets: "2,5", repsMin: "", repsMax: "" })).toMatchObject({ ok: false });
    expect(parseTarget({ sets: "", repsMin: "-1", repsMax: "" })).toMatchObject({ ok: false, errors: { reps: expect.any(String) } });
    expect(parseTarget({ sets: "", repsMin: "12", repsMax: "8" })).toEqual({
      ok: false,
      errors: { reps: "El mínimo no puede superar el máximo" },
    });
    expect(parseTarget({ sets: "", repsMin: "", repsMax: "8" })).toMatchObject({ ok: false });
  });
  it("formato", () => {
    expect(formatTarget({ sets: 3, repsMin: 8, repsMax: 12 })).toBe("3 × 8–12");
    expect(formatTarget({ sets: 3, repsMin: 10, repsMax: 10 })).toBe("3 × 10");
    expect(formatTarget({ sets: 1, repsMin: null, repsMax: null })).toBe("1 serie");
    expect(formatTarget({ sets: null, repsMin: 8, repsMax: 12 })).toBe("8–12 reps");
    expect(formatTarget({ sets: null, repsMin: null, repsMax: null })).toBeNull();
  });
});

describe("formulario de rutina", () => {
  it("valida nombre, ejercicios, repetidos y metas", () => {
    expect(routineToPayload("r", "  ", [])).toMatchObject({ ok: false, name: expect.any(String), general: expect.any(String) });
    expect(routineToPayload("r", "A", [row("a", "e1"), row("b", "e1")])).toMatchObject({ ok: false, general: "Hay ejercicios repetidos" });
    expect(routineToPayload("r", "A", [row("a", "e1", { repsMin: "12", repsMax: "8" })])).toMatchObject({
      ok: false,
      targets: { a: { reps: expect.any(String) } },
    });
  });
  it("convierte en el orden de la lista", () => {
    expect(routineToPayload("r", " Pecho y tríceps ", [row("a", "e2", { sets: "3", repsMin: "8", repsMax: "12" }), row("b", "e1")])).toEqual({
      ok: true,
      payload: {
        id: "r",
        name: "Pecho y tríceps",
        exercises: [
          { exercise_id: "e2", target_sets: 3, target_reps_min: 8, target_reps_max: 12, target_blocks: null },
          { exercise_id: "e1", target_sets: null, target_reps_min: null, target_reps_max: null, target_blocks: null },
        ],
      },
    });
  });
  it("meta por bloques: secuencia sin pesos, ciclos y series; reemplaza las repeticiones", () => {
    const plan = {
      rounds: "3",
      items: [
        { key: "p1", type: "reps" as const, value: "7" },
        { key: "p2", type: "hold" as const, value: "7" },
      ],
    };
    expect(routineToPayload("r", "Hombro", [{ ...row("a", "e1", { sets: "4", repsMin: "12" }), plan }])).toEqual({
      ok: true,
      payload: {
        id: "r",
        name: "Hombro",
        exercises: [
          {
            exercise_id: "e1",
            target_sets: 4,
            target_reps_min: null,
            target_reps_max: null,
            target_blocks: { rounds: 3, items: [{ type: "reps", reps: 7 }, { type: "hold", seconds: 7 }] },
          },
        ],
      },
    });
    expect(routineToPayload("r", "Hombro", [{ ...row("a", "e1"), plan: { ...plan, rounds: "0" } }])).toMatchObject({
      ok: false,
      targets: { a: { plan: expect.stringMatching(/Repetir secuencia/) } },
    });
  });

  it("reordena y detecta archivados", () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    const ex = (name: string, archived: boolean) => ({
      exercise_id: name, name, muscle_group_id: null, archived, target_sets: null, target_reps_min: null, target_reps_max: null,
    });
    expect(routineUsage({ exercises: [ex("A", true), ex("B", false)] })).toEqual({ omitted: ["A"], usable: true });
    expect(routineUsage({ exercises: [ex("A", true)] })).toEqual({ omitted: ["A"], usable: false });
  });
});
