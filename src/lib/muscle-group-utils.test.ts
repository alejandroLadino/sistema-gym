import { describe, expect, it } from "vitest";
import { groupByRegion, muscleGroupName, parseMuscleGroupId } from "./muscle-group-utils";

const groups = [
  { id: "pecho", name: "Pecho", region: "Tren superior" },
  { id: "biceps", name: "Bíceps", region: "Tren superior" },
  { id: "abdomen", name: "Abdomen", region: "Tronco" },
  { id: "gluteos", name: "Glúteos", region: "Tren inferior" },
];

describe("grupos musculares", () => {
  it("acepta solo ids del formato del catálogo", () => {
    expect(parseMuscleGroupId("pecho")).toEqual({ ok: true, value: "pecho" });
    expect(parseMuscleGroupId("cuerpo_completo")).toEqual({ ok: true, value: "cuerpo_completo" });
    expect(parseMuscleGroupId("")).toEqual({ ok: true, value: null });
    expect(parseMuscleGroupId(null)).toEqual({ ok: true, value: null });
    expect(parseMuscleGroupId("PECHO ").ok).toBe(false);
    expect(parseMuscleGroupId("pecho'); drop table x;--").ok).toBe(false);
  });
  it("devuelve el nombre por id", () => {
    expect(muscleGroupName(groups, "biceps")).toBe("Bíceps");
    expect(muscleGroupName(groups, null)).toBeNull();
    expect(muscleGroupName(groups, "desconocido")).toBeNull();
  });
  it("agrupa por región conservando el orden", () => {
    expect(groupByRegion(groups).map((g) => [g.region, g.groups.map((x) => x.id)])).toEqual([
      ["Tren superior", ["pecho", "biceps"]],
      ["Tronco", ["abdomen"]],
      ["Tren inferior", ["gluteos"]],
    ]);
  });
});

describe("validación de ejercicios (grupo obligatorio)", () => {
  it("exige nombre y un grupo del catálogo", async () => {
    const { validateExerciseInput } = await import("./muscle-group-utils");
    const ids = ["pecho", "espalda"];
    expect(validateExerciseInput({ name: "  Press  ", muscle_group_id: "pecho" }, ids)).toEqual({
      ok: true,
      value: { name: "Press", muscle_group_id: "pecho" },
    });
    expect(validateExerciseInput({ name: "Press", muscle_group_id: "" }, ids)).toEqual({
      ok: false,
      errors: { muscle_group_id: "Selecciona un grupo muscular" },
    });
    expect(validateExerciseInput({ name: "Press", muscle_group_id: null }, ids).ok).toBe(false);
    // Formato válido pero inexistente en el catálogo.
    expect(validateExerciseInput({ name: "Press", muscle_group_id: "piernas" }, ids).ok).toBe(false);
    expect(validateExerciseInput({ name: "", muscle_group_id: "pecho" }, ids)).toEqual({
      ok: false,
      errors: { name: "Escribe el nombre del ejercicio" },
    });
  });
});
