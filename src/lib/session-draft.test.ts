import { describe, expect, it } from "vitest";
import { copyPreviousSets, draftToPayload, nextSet, sessionToDraft, type Draft } from "./session-draft";
import { formatDate, formatSet, isIsoDate, todayLocal } from "./format";
import { uuidv4 } from "./uuid";

const base = (exercises: Draft["exercises"]): Draft => ({
  id: "50000000-0000-4000-8000-000000000001",
  date: "2026-11-26",
  notes: "  ",
  editedAt: 0,
  exercises,
});

describe("draftToPayload", () => {
  it("convierte series con decimales y peso corporal; ignora filas vacías", () => {
    const res = draftToPayload(
      base([
        {
          key: "a",
          exerciseId: "e0000000-0000-4000-8000-00000000000a",
          name: "Press de banca",
          sets: [
            { key: "1", reps: "12", weight: "40" },
            { key: "2", reps: "10", weight: "42,5" },
            { key: "3", reps: "", weight: "" },
          ],
        },
        { key: "b", exerciseId: "e0000000-0000-4000-8000-00000000000b", name: "Dominadas", sets: [{ key: "4", reps: "8", weight: "" }] },
      ]),
    );
    expect(res).toEqual({
      ok: true,
      payload: {
        id: "50000000-0000-4000-8000-000000000001",
        session_date: "2026-11-26",
        notes: null,
        exercises: [
          { exercise_id: "e0000000-0000-4000-8000-00000000000a", sets: [{ reps: 12, weight_kg: 40 }, { reps: 10, weight_kg: 42.5 }] },
          { exercise_id: "e0000000-0000-4000-8000-00000000000b", sets: [{ reps: 8, weight_kg: null }] },
        ],
      },
    });
  });

  it("señala series incompletas y sesiones vacías", () => {
    const bad = draftToPayload(base([{ key: "a", exerciseId: "x", name: "X", sets: [{ key: "1", reps: "", weight: "40" }] }]));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.sets["1"]).toMatch(/repeticiones/i);
    const empty = draftToPayload(base([]));
    expect(empty.ok).toBe(false);
  });
});

describe("series", () => {
  it("copiar la sesión anterior reemplaza filas vacías", () => {
    const out = copyPreviousSets([{ key: "x", reps: "", weight: "" }], [
      { reps: 12, weight_kg: 40 },
      { reps: 10, weight_kg: 45.5 },
      { reps: 15, weight_kg: null },
    ]);
    expect(out.map((s) => [s.weight, s.reps])).toEqual([["40", "12"], ["45,5", "10"], ["", "15"]]);
  });
  it("agregar serie repite la última", () => {
    const s = nextSet([{ key: "x", reps: "8", weight: "50" }]);
    expect([s.weight, s.reps]).toEqual(["50", "8"]);
  });
  it("sessionToDraft conserva el orden", () => {
    const d = sessionToDraft({
      id: "s",
      session_date: "2026-11-19",
      notes: null,
      updated_at: "2026-11-19T10:00:00Z",
      exercises: [{ exercise_id: "e", name: "Press", muscle_group: null, archived: false, sets: [{ reps: 12, weight_kg: 40 }, { reps: 8, weight_kg: 50 }] }],
    });
    expect(d.exercises[0].sets.map((s) => s.weight)).toEqual(["40", "50"]);
  });
});

describe("formato", () => {
  it("formatea series", () => {
    expect(formatSet({ reps: 12, weight_kg: 40 })).toBe("40 kg × 12");
    expect(formatSet({ reps: 10, weight_kg: 47.25 })).toBe("47,25 kg × 10");
    expect(formatSet({ reps: 15, weight_kg: null })).toBe("15 reps");
  });
  it("fechas sin desfase de zona horaria", () => {
    expect(formatDate("2026-11-19")).toMatch(/19/);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(todayLocal(new Date(2026, 10, 26, 23, 59))).toBe("2026-11-26");
  });
  it("uuid v4", () => {
    expect(uuidv4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
