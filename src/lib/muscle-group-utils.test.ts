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
