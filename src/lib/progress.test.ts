import { describe, expect, it } from "vitest";
import {
  addDays,
  bestSet,
  chartPoints,
  compareBest,
  comparableSessions,
  formatBestSet,
  inRange,
  metricOptions,
  periodBest,
  rangeBounds,
  sessionStats,
  usesWeight,
  type ProgressRow,
} from "./progress";

const row = (id: string, date: string, time: string, sets: [number | null, number][]): ProgressRow => ({
  session_id: id,
  session_date: date,
  created_at: `${date}T${time}:00Z`,
  sets: sets.map(([w, r]) => ({ weight_kg: w, reps: r })),
});

describe("mejor serie y estadísticas por sesión", () => {
  it("mayor peso; con empate, más repeticiones; sin peso, más reps", () => {
    expect(bestSet([{ weight_kg: 40, reps: 8 }, { weight_kg: 40, reps: 12 }, { weight_kg: 35, reps: 15 }])).toEqual({ weight_kg: 40, reps: 12 });
    expect(bestSet([{ weight_kg: null, reps: 20 }, { weight_kg: 20, reps: 5 }])).toEqual({ weight_kg: 20, reps: 5 });
    expect(bestSet([{ weight_kg: null, reps: 8 }, { weight_kg: null, reps: 12 }])).toEqual({ weight_kg: null, reps: 12 });
  });

  it("40 kg × 10, 10, 8 y luego 40 kg × 10, 10, 10: mismo máximo y 28 → 30 reps totales", () => {
    const stats = sessionStats([
      row("b", "2026-11-22", "10:00", [[40, 10], [40, 10], [40, 10]]),
      row("a", "2026-11-20", "10:00", [[40, 10], [40, 10], [40, 8]]),
    ]);
    expect(stats.map((s) => [s.id, s.maxWeight, s.totalReps])).toEqual([["a", 40, 28], ["b", 40, 30]]);
    expect(chartPoints(stats, "peso").map((p) => p.value)).toEqual([40, 40]);
    expect(chartPoints(stats, "reps_totales").map((p) => p.value)).toEqual([28, 30]);
    expect(chartPoints(stats, "peso")[0].label).toBe("3 series con 40 kg");
    const [prev, last] = comparableSessions(stats, true).slice(-2);
    expect(compareBest(last.best, prev.best, true)).toEqual({ text: "Sin cambio en peso máximo", trend: "same" });
  });

  it("dos sesiones el mismo día: un punto por sesión, ordenadas por hora", () => {
    const stats = sessionStats([
      row("tarde", "2026-11-22", "18:00", [[42.5, 6]]),
      row("manana", "2026-11-22", "08:00", [[40, 10]]),
    ]);
    expect(stats.map((s) => s.id)).toEqual(["manana", "tarde"]);
    const points = chartPoints(stats, "peso");
    expect(points).toHaveLength(2);
    expect(points[1].label).toBe("1 serie con 42,5 kg · sesión 2 de 2 del día");
  });

  it("ejercicio con peso: la sesión sin carga cuenta en reps totales pero no en peso máximo", () => {
    const stats = sessionStats([row("a", "2026-11-20", "10:00", [[40, 10]]), row("b", "2026-11-21", "10:00", [[null, 15]])]);
    expect(usesWeight(stats)).toBe(true);
    expect(chartPoints(stats, "peso").map((p) => p.id)).toEqual(["a"]);
    expect(chartPoints(stats, "reps_totales").map((p) => p.id)).toEqual(["a", "b"]);
    expect(comparableSessions(stats, true).map((s) => s.id)).toEqual(["a"]);
  });

  it("peso corporal: métricas «Mejor serie» y «Reps totales»", () => {
    const stats = sessionStats([row("a", "2026-11-20", "10:00", [[null, 10], [null, 8]]), row("b", "2026-11-27", "10:00", [[null, 12], [null, 12]])]);
    expect(usesWeight(stats)).toBe(false);
    expect(metricOptions(false).map((m) => m.label)).toEqual(["Mejor serie", "Reps totales"]);
    expect(metricOptions(true).map((m) => m.label)).toEqual(["Peso máximo", "Reps totales"]);
    expect(chartPoints(stats, "mejor_serie").map((p) => [p.value, p.label])).toEqual([[10, "1 serie con 10 reps"], [12, "2 series con 12 reps"]]);
    expect(formatBestSet(stats[1].best, false)).toBe("12 reps");
    expect(compareBest(stats[1].best, stats[0].best, false)).toEqual({ text: "+2 reps vs. sesión anterior", trend: "up" });
  });
});

describe("comparación y mejor marca", () => {
  it("etiquetas de cambio", () => {
    expect(compareBest({ weight_kg: 45, reps: 8 }, { weight_kg: 40, reps: 10 }, true).text).toBe("+5 kg vs. sesión anterior");
    expect(compareBest({ weight_kg: 37.5, reps: 8 }, { weight_kg: 40, reps: 10 }, true).text).toBe("−2,5 kg vs. sesión anterior");
    expect(compareBest({ weight_kg: null, reps: 8 }, { weight_kg: null, reps: 8 }, false).text).toBe("Sin cambio en reps");
    expect(compareBest({ weight_kg: 40, reps: 8 }, null, true)).toEqual({ text: "Primer registro", trend: "first" });
    expect(formatBestSet({ weight_kg: 42.5, reps: 6 }, true)).toBe("42,5 kg × 6");
  });
  it("mejor marca del período: mayor peso y, con empate, más reps", () => {
    const stats = sessionStats([
      row("a", "2026-11-20", "10:00", [[45, 6]]),
      row("b", "2026-11-21", "10:00", [[45, 8]]),
      row("c", "2026-11-22", "10:00", [[40, 12]]),
    ]);
    expect(periodBest(stats, true)?.id).toBe("b");
    expect(periodBest([], true)).toBeNull();
  });
});

describe("rangos", () => {
  it("30 y 90 días incluyen hoy; personalizado ordena los extremos", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(rangeBounds("30", "2026-11-26", { from: "", to: "" })).toEqual({ from: "2026-10-28", to: null });
    expect(rangeBounds("90", "2026-11-26", { from: "", to: "" })).toEqual({ from: "2026-08-29", to: null });
    expect(rangeBounds("todo", "2026-11-26", { from: "", to: "" })).toEqual({ from: null, to: null });
    expect(rangeBounds("custom", "2026-11-26", { from: "2026-11-20", to: "2026-11-01" })).toEqual({ from: "2026-11-01", to: "2026-11-20" });
    expect(inRange({ date: "2026-11-01" }, { from: "2026-11-01", to: "2026-11-20" })).toBe(true);
    expect(inRange({ date: "2026-10-31" }, { from: "2026-11-01", to: null })).toBe(false);
  });
});

describe("resumen de la lista", () => {
  it("mejor serie de la última sesión comparable y cambio frente a la anterior", async () => {
    const { overviewSummary } = await import("./progress");
    const base = { exercise_id: "e", session_count: 2, last_session_date: "2026-11-22", last_session_id: "b" };
    expect(
      overviewSummary({
        ...base,
        uses_weight: true,
        recent: [
          { session_id: "b", session_date: "2026-11-22", best_set: { weight_kg: 45, reps: 8 }, total_reps: 24, set_count: 3 },
          { session_id: "a", session_date: "2026-11-15", best_set: { weight_kg: 40, reps: 10 }, total_reps: 28, set_count: 3 },
        ],
      }),
    ).toEqual({ lastDate: "2026-11-22", sessionCount: 2, best: "45 kg × 8", change: { text: "+5 kg vs. sesión anterior", trend: "up" } });
    expect(
      overviewSummary({
        ...base,
        session_count: 1,
        uses_weight: false,
        recent: [{ session_id: "b", session_date: "2026-11-22", best_set: { weight_kg: null, reps: 12 }, total_reps: 20, set_count: 2 }],
      }),
    ).toEqual({ lastDate: "2026-11-22", sessionCount: 1, best: "12 reps", change: { text: "Primer registro", trend: "first" } });
  });
});
