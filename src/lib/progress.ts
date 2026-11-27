import { setBest, setHoldSeconds, setTotalReps } from "./blocks";
import { formatKg, isIsoDate } from "./format";
import type { SetValue } from "./types";

/** Mejor serie comparable: reps y peso del mismo bloque (o de la serie simple). */
export type BestSet = { reps: number; weight_kg: number | null; bar_only?: boolean };

/** Fila de `get_exercise_progress`: una por sesión con sus series del ejercicio. */
export type ProgressRow = {
  session_id: string;
  session_date: string;
  created_at: string;
  sets: SetValue[];
};

export type SessionStat = {
  id: string;
  date: string;
  createdAt: string;
  sets: SetValue[];
  /** Mejor serie: mayor peso (empate → más reps); sin peso, la de más reps. */
  best: BestSet;
  maxWeight: number | null;
  /** Reps totales (en series por bloques: ciclos × reps de los bloques). */
  totalReps: number;
  /** Segundos de sostén (series por bloques), aparte de las reps. */
  holdSeconds: number;
  /** Cada serie por bloques cuenta como una serie. */
  setCount: number;
  /** Alguna serie o bloque con «Solo barra» (el ejercicio es con peso aunque falte la carga). */
  hasBar: boolean;
  /** Posición entre las sesiones del mismo día (1, 2…) y cuántas hubo. */
  dayIndex: number;
  dayCount: number;
};

const weightOf = (s: SetValue) => (s.weight_kg === null || s.weight_kg === undefined ? null : Number(s.weight_kg));

/**
 * Mayor peso y, si hay empate, más repeticiones. Las series sin peso van después.
 * En una serie por bloques cuenta su mejor bloque de repeticiones (con sus reps).
 */
export function bestSet(sets: SetValue[]): BestSet {
  const candidates = sets.map(setBest).filter((b): b is BestSet => b !== null);
  if (candidates.length === 0) return { reps: 0, weight_kg: null };
  let best = candidates[0];
  for (const s of candidates.slice(1)) {
    const wb = weightOf(best);
    const ws = weightOf(s);
    if (ws !== null && (wb === null || ws > wb || (ws === wb && s.reps > best.reps))) best = s;
    else if (ws === null && wb === null && s.reps > best.reps) best = s;
  }
  return { reps: best.reps, weight_kg: weightOf(best), ...(best.bar_only ? { bar_only: true } : {}) };
}

/** Estadísticas por sesión, de la más antigua a la más reciente (mismo día → por hora de creación). */
export function sessionStats(rows: ProgressRow[]): SessionStat[] {
  const sorted = [...rows]
    .filter((r) => r.sets.length > 0)
    .sort((a, b) => a.session_date.localeCompare(b.session_date) || a.created_at.localeCompare(b.created_at));
  const perDay = new Map<string, number>();
  for (const r of sorted) perDay.set(r.session_date, (perDay.get(r.session_date) ?? 0) + 1);
  const seen = new Map<string, number>();
  return sorted.map((r) => {
    const weights = r.sets
      .map((x) => setBest(x))
      .map((b) => (b ? weightOf(b) : null))
      .filter((w): w is number => w !== null);
    const dayIndex = (seen.get(r.session_date) ?? 0) + 1;
    seen.set(r.session_date, dayIndex);
    return {
      id: r.session_id,
      date: r.session_date,
      createdAt: r.created_at,
      sets: r.sets.map((s) =>
        s.blocks?.length
          ? { reps: null, weight_kg: null, rounds: s.rounds ?? 1, blocks: s.blocks }
          : { reps: s.reps, weight_kg: weightOf(s), ...(s.bar_only ? { bar_only: true } : {}) },
      ),
      best: bestSet(r.sets),
      maxWeight: weights.length ? Math.max(...weights) : null,
      totalReps: r.sets.reduce((sum, s) => sum + setTotalReps(s), 0),
      holdSeconds: r.sets.reduce((sum, s) => sum + setHoldSeconds(s), 0),
      hasBar: r.sets.some((s) => Boolean(s.bar_only) || Boolean(s.blocks?.some((b) => b.bar_only))),
      setCount: r.sets.length,
      dayIndex,
      dayCount: perDay.get(r.session_date) ?? 1,
    };
  });
}

/** Clasificación peso / peso corporal según TODO el historial (no depende del rango). */
export function usesWeight(stats: SessionStat[]): boolean {
  // «Solo barra» sin peso capturado también es un ejercicio con peso (no peso corporal).
  return stats.some((s) => s.maxWeight !== null || s.hasBar);
}

/** Sesiones comparables: con peso registrado si el ejercicio es con peso; todas si es de peso corporal. */
export function comparableSessions(stats: SessionStat[], weighted: boolean): SessionStat[] {
  return weighted ? stats.filter((s) => s.maxWeight !== null) : stats;
}

export function formatBestSet(set: BestSet, weighted: boolean): string {
  const w = weightOf(set);
  if (weighted && w !== null) return `${formatKg(w)} kg × ${set.reps}`;
  if (set.bar_only) return `Solo barra × ${set.reps}`;
  return `${set.reps} reps`;
}

export type Trend = "up" | "down" | "same" | "first";

/** «+5 kg vs. sesión anterior», «Sin cambio en peso máximo», «Primer registro»… */
export function compareBest(
  latest: BestSet,
  previous: BestSet | null | undefined,
  weighted: boolean,
): { text: string; trend: Trend } {
  if (!previous) return { text: "Primer registro", trend: "first" };
  if (weighted) {
    const diff = Math.round(((weightOf(latest) ?? 0) - (weightOf(previous) ?? 0)) * 100) / 100;
    if (diff === 0) return { text: "Sin cambio en peso máximo", trend: "same" };
    return { text: `${diff > 0 ? "+" : "−"}${formatKg(Math.abs(diff))} kg vs. sesión anterior`, trend: diff > 0 ? "up" : "down" };
  }
  const diff = latest.reps - previous.reps;
  if (diff === 0) return { text: "Sin cambio en reps", trend: "same" };
  return { text: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} reps vs. sesión anterior`, trend: diff > 0 ? "up" : "down" };
}

/** Mejor marca de un conjunto de sesiones comparables (con su fecha). */
export function periodBest(sessions: SessionStat[], weighted: boolean): SessionStat | null {
  let best: SessionStat | null = null;
  for (const s of sessions) {
    if (!best) {
      best = s;
      continue;
    }
    const a = s.best;
    const b = best.best;
    const better = weighted
      ? (weightOf(a) ?? -1) > (weightOf(b) ?? -1) || ((weightOf(a) ?? -1) === (weightOf(b) ?? -1) && a.reps > b.reps)
      : a.reps > b.reps;
    if (better) best = s;
  }
  return best;
}

// --- Rangos ---------------------------------------------------------------------

export type RangeKey = "30" | "90" | "todo" | "custom";
export const RANGE_OPTIONS: { id: RangeKey; label: string }[] = [
  { id: "30", label: "30 días" },
  { id: "90", label: "90 días" },
  { id: "todo", label: "Todo" },
  { id: "custom", label: "Personalizado" },
];

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Límites inclusivos del rango. «30 días» = hoy y los 29 anteriores. */
export function rangeBounds(
  key: RangeKey,
  today: string,
  custom: { from: string; to: string },
): { from: string | null; to: string | null } {
  if (key === "30") return { from: addDays(today, -29), to: null };
  if (key === "90") return { from: addDays(today, -89), to: null };
  if (key === "custom") {
    let from = isIsoDate(custom.from) ? custom.from : null;
    let to = isIsoDate(custom.to) ? custom.to : null;
    if (from && to && from > to) [from, to] = [to, from];
    return { from, to };
  }
  return { from: null, to: null };
}

export function inRange(stat: { date: string }, bounds: { from: string | null; to: string | null }): boolean {
  return (!bounds.from || stat.date >= bounds.from) && (!bounds.to || stat.date <= bounds.to);
}

// --- Gráfica ----------------------------------------------------------------------

export type Metric = "peso" | "mejor_serie" | "reps_totales";

export function metricOptions(weighted: boolean): { id: Metric; label: string }[] {
  return weighted
    ? [
        { id: "peso", label: "Peso máximo" },
        { id: "reps_totales", label: "Reps totales" },
      ]
    : [
        { id: "mejor_serie", label: "Mejor serie" },
        { id: "reps_totales", label: "Reps totales" },
      ];
}

export function defaultMetric(weighted: boolean): Metric {
  return weighted ? "peso" : "mejor_serie";
}

export type MetricPoint = { id: string; date: string; value: number; label: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Un punto por sesión. «Peso máximo» omite las sesiones sin carga; el detalle
 * indica cuántas series aportan a la métrica.
 */
export function chartPoints(stats: SessionStat[], metric: Metric): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const s of stats) {
    const day = s.dayCount > 1 ? ` · sesión ${s.dayIndex} de ${s.dayCount} del día` : "";
    if (metric === "peso") {
      if (s.maxWeight === null) continue;
      const n = s.sets.filter((x) => {
        const b = setBest(x);
        return b !== null && weightOf(b) === s.maxWeight;
      }).length;
      points.push({ id: s.id, date: s.date, value: s.maxWeight, label: `${plural(n, "serie", "series")} con ${formatKg(s.maxWeight)} kg${day}` });
    } else if (metric === "mejor_serie") {
      const reps = s.sets.map((x) => setBest(x)?.reps ?? 0);
      const max = Math.max(...reps);
      const n = reps.filter((r) => r === max).length;
      points.push({ id: s.id, date: s.date, value: max, label: `${plural(n, "serie", "series")} con ${max} reps${day}` });
    } else {
      points.push({ id: s.id, date: s.date, value: s.totalReps, label: `${plural(s.setCount, "serie", "series")}${day}` });
    }
  }
  return points;
}

export function metricUnit(metric: Metric): "kg" | "reps" {
  return metric === "peso" ? "kg" : "reps";
}

export function metricTitle(metric: Metric, weighted: boolean): string {
  if (metric === "peso") return "Peso máximo por sesión (kg)";
  if (metric === "reps_totales") return "Repeticiones totales por sesión";
  return weighted ? "Mejor serie por sesión (reps)" : "Mejor serie por sesión (reps, peso corporal)";
}

// --- Lista de «Progreso» (resumen por ejercicio) ------------------------------------

/** Fila de `get_progress_overview`. */
export type OverviewRow = {
  exercise_id: string;
  uses_weight: boolean;
  session_count: number;
  last_session_date: string;
  last_session_id: string;
  /** best_set es null si la sesión solo tiene sostenes. */
  recent: { session_id: string; session_date: string; best_set: BestSet | null; total_reps: number; set_count: number }[];
};

export type OverviewSummary = {
  lastDate: string;
  sessionCount: number;
  best: string;
  change: { text: string; trend: Trend };
};

export function overviewSummary(row: OverviewRow): OverviewSummary {
  const [latest, previous] = row.recent;
  return {
    lastDate: row.last_session_date,
    sessionCount: row.session_count,
    best: latest?.best_set ? formatBestSet(latest.best_set, row.uses_weight) : "Sin peso registrado",
    change: latest?.best_set
      ? compareBest(latest.best_set, previous?.best_set, row.uses_weight)
      : { text: "Sin peso registrado", trend: "first" },
  };
}
