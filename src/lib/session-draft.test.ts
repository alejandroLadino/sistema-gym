import { describe, expect, it } from "vitest";
import { copyPreviousSets, draftToPayload, nextSet, resolveStoredDraft, sessionToDraft, type Draft, type StoredDraft } from "./session-draft";
import type { SessionData } from "./types";
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
        guided: { started: false, exercise_id: null },
        exercises: [
          { exercise_id: "e0000000-0000-4000-8000-00000000000a", sets: [{ reps: 12, weight_kg: 40 }, { reps: 10, weight_kg: 42.5 }], target: null, completed: false, alt_group: null, alt_slot: null },
          { exercise_id: "e0000000-0000-4000-8000-00000000000b", sets: [{ reps: 8, weight_kg: null }], target: null, completed: false, alt_group: null, alt_slot: null },
        ],
      },
    });
  });

  it("señala series incompletas", () => {
    const bad = draftToPayload(base([{ key: "a", exerciseId: "x", name: "X", sets: [{ key: "1", reps: "", weight: "40" }] }]));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.sets["1"]).toMatch(/repeticiones/i);
  });

  it("una sesión sin ejercicios se puede guardar (en curso); la fecha sigue siendo obligatoria", () => {
    expect(draftToPayload(base([]))).toEqual({
      ok: true,
      payload: { id: "50000000-0000-4000-8000-000000000001", session_date: "2026-11-26", notes: null, guided: { started: false, exercise_id: null }, exercises: [] },
    });
    expect(draftToPayload({ ...base([]), date: "" }).ok).toBe(false);
  });
});

describe("copia local frente a la versión del servidor", () => {
  const session = (finished: boolean, exercises = 1): SessionData => ({
    id: "50000000-0000-4000-8000-000000000001",
    session_date: "2026-11-26",
    notes: null,
    updated_at: "2026-11-26T10:00:00Z",
    finished_at: finished ? "2026-11-26T10:00:00Z" : null,
    exercises: Array.from({ length: exercises }, (_, i) => ({
      exercise_id: `e${i}`, name: `E${i}`, muscle_group: null, archived: false, sets: [{ reps: 10, weight_kg: 40 }],
    })),
  });
  const stored = (exercises: number, editedAt: number, dirty = true): StoredDraft => ({
    ownerId: "u",
    savedOnce: true,
    dirty,
    draft: {
      ...base(Array.from({ length: exercises }, (_, i) => ({ key: `k${i}`, exerciseId: `e${i}`, name: `E${i}`, sets: [] }))),
      editedAt,
    },
  });
  const later = Date.parse("2026-11-26T11:00:00Z");
  const earlier = Date.parse("2026-11-26T09:00:00Z");

  it("sin copia, copia antigua o ya guardada → servidor", () => {
    expect(resolveStoredDraft(session(true), null)).toBe("server");
    expect(resolveStoredDraft(session(true), stored(1, earlier))).toBe("server");
    expect(resolveStoredDraft(session(true), stored(1, later, false))).toBe("server");
  });
  it("cambios locales válidos y más nuevos se recuperan (p. ej., una serie editada)", () => {
    expect(resolveStoredDraft(session(true), stored(1, later))).toBe("local");
    // En curso, quitar el último ejercicio es un cambio válido pendiente de guardar.
    expect(resolveStoredDraft(session(false), stored(0, later))).toBe("local");
  });
  it("copia vacía que contradice una sesión finalizada con ejercicios → conflicto", () => {
    expect(resolveStoredDraft(session(true), stored(0, later))).toBe("conflict");
    expect(resolveStoredDraft(session(true, 0), stored(0, later))).toBe("local");
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
