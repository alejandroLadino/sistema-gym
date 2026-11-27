import { describe, expect, it } from "vitest";
import { consistency } from "./consistency";

describe("constancia", () => {
  it("usuario nuevo: cero días y semana vacía", () => {
    const c = consistency(null, "2026-11-26");
    expect(c).toMatchObject({ weekDays: 0, totalDays: 0, streak: 0, pending: false });
    expect(c.days.map((d) => d.date)).toEqual([
      "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29",
    ]);
    expect(c.days.filter((d) => d.isToday).map((d) => d.date)).toEqual(["2026-11-26"]);
    expect(c.days.some((d) => d.trained)).toBe(false);
  });

  it("días de la semana actual y total histórico", () => {
    const c = consistency(
      { total_days: 12, recent_days: ["2026-11-26", "2026-11-23", "2026-11-20"], active_weeks: ["2026-11-23", "2026-11-16"] },
      "2026-11-26",
    );
    expect(c.weekDays).toBe(2);
    expect(c.days.filter((d) => d.trained).map((d) => d.date)).toEqual(["2026-11-23", "2026-11-26"]);
    expect(c).toMatchObject({ totalDays: 12, streak: 2, pending: false });
  });

  it("días de descanso dentro de la semana no rompen la racha", () => {
    // Lunes de una semana y domingo de la siguiente: dos semanas seguidas.
    const c = consistency({ total_days: 2, recent_days: ["2026-11-29"], active_weeks: ["2026-11-23", "2026-11-16"] }, "2026-11-29");
    expect(c).toMatchObject({ streak: 2, pending: false, weekDays: 1 });
  });

  it("de domingo a lunes: la semana nueva sin actividad queda pendiente y conserva la racha", () => {
    const row = { total_days: 3, recent_days: ["2026-11-29"], active_weeks: ["2026-11-23", "2026-11-16", "2026-11-09"] };
    expect(consistency(row, "2026-11-29")).toMatchObject({ streak: 3, pending: false }); // domingo
    const lunes = consistency(row, "2026-11-30");
    expect(lunes).toMatchObject({ streak: 3, pending: true, weekDays: 0 });
    expect(lunes.days[0]).toEqual({ date: "2026-11-30", trained: false, isToday: true });
  });

  it("una semana completa sin entrenar corta la racha", () => {
    const row = { total_days: 2, recent_days: [], active_weeks: ["2026-11-16", "2026-11-09"] };
    // Semana del 23/11 sin entrenar; el lunes 30/11 ya no hay racha.
    expect(consistency(row, "2026-11-30")).toMatchObject({ streak: 0, pending: false });
    // Durante la semana del 23/11 todavía estaba pendiente.
    expect(consistency(row, "2026-11-25")).toMatchObject({ streak: 2, pending: true });
  });

  it("semanas futuras no cuentan para la racha", () => {
    expect(consistency({ total_days: 1, recent_days: [], active_weeks: ["2026-12-07"] }, "2026-11-26")).toMatchObject({
      streak: 0,
      pending: false,
    });
  });
});
