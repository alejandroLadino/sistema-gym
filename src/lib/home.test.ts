import { describe, expect, it } from "vitest";
import { inProgressToday, mondayOf, otherInProgress, primaryAction, recentFinished, weekSummary, type HomeSession } from "./home";

const s = (id: string, date: string, time: string, finished: boolean, extra: Partial<HomeSession> = {}): HomeSession => ({
  id,
  session_date: date,
  created_at: `${date}T${time}:00Z`,
  finished_at: finished ? `${date}T${time}:30Z` : null,
  exercise_count: 1,
  set_count: 3,
  muscle_groups: ["Pecho"],
  ...extra,
});

const TODAY = "2026-11-26"; // jueves

describe("acción principal de hoy", () => {
  it("usuario nuevo → Iniciar entrenamiento", () => {
    expect(primaryAction([], TODAY, false)).toEqual({ kind: "start" });
  });
  it("sesión en curso hoy → Continuar; con varias, la de hoy más reciente", () => {
    const list = [s("vieja", "2026-11-24", "10:00", false), s("manana", TODAY, "08:00", false), s("tarde", TODAY, "18:00", false)];
    const p = primaryAction(list, TODAY, false);
    expect(p).toMatchObject({ kind: "continue", session: { id: "tarde" } });
    expect(otherInProgress(list, p).map((x) => x.id)).toEqual(["manana", "vieja"]);
  });
  it("una sesión en curso de otro día no ocupa «hoy»", () => {
    expect(primaryAction([s("ayer", "2026-11-25", "10:00", false)], TODAY, false)).toEqual({ kind: "start" });
  });
  it("borrador local sin guardar → Continuar", () => {
    expect(primaryAction([], TODAY, true)).toEqual({ kind: "continue-draft" });
  });
  it("hoy solo finalizadas → Ver entrenamiento de hoy (la más reciente)", () => {
    const list = [s("a", TODAY, "08:00", true), s("b", TODAY, "18:00", true)];
    expect(primaryAction(list, TODAY, false)).toMatchObject({ kind: "review", session: { id: "b" } });
    expect(inProgressToday(list, TODAY)).toBeNull();
  });
});

describe("esta semana", () => {
  it("lunes a domingo; dos sesiones el mismo día marcan el día una vez y suman dos", () => {
    expect(mondayOf(TODAY)).toBe("2026-11-23");
    expect(mondayOf("2026-11-23")).toBe("2026-11-23");
    expect(mondayOf("2026-11-29")).toBe("2026-11-23"); // domingo
    const week = weekSummary(
      [
        s("l1", "2026-11-23", "08:00", true),
        s("l2", "2026-11-23", "19:00", true),
        s("hoy", TODAY, "08:00", false), // en curso: no cuenta
        s("pasada", "2026-11-22", "08:00", true), // semana anterior
      ],
      TODAY,
    );
    expect(week.days.map((d) => d.date)).toEqual([
      "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29",
    ]);
    expect(week.days.map((d) => d.trained)).toEqual([true, false, false, false, false, false, false]);
    expect(week.days.find((d) => d.isToday)?.date).toBe(TODAY);
    expect(week.total).toBe(2);
  });
});

describe("sesiones recientes", () => {
  it("hasta tres finalizadas, de la más reciente a la más antigua", () => {
    const list = [
      s("a", "2026-11-20", "08:00", true),
      s("b", "2026-11-26", "08:00", true),
      s("c", "2026-11-26", "18:00", true),
      s("d", "2026-11-25", "08:00", false),
      s("e", "2026-11-24", "08:00", true),
    ];
    expect(recentFinished(list).map((x) => x.id)).toEqual(["c", "b", "e"]);
  });
});
