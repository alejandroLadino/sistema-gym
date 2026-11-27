import { mondayOf } from "./home";
import { addDays } from "./progress";

/** Fila de `get_training_consistency`. */
export type ConsistencyRow = {
  total_days: number;
  recent_days: string[];
  active_weeks: string[];
  /** Días entrenados de cada semana activa (mismo orden que `active_weeks`). */
  active_week_days?: number[];
};

/** La racha semanal se muestra a partir de esta cantidad de semanas seguidas. */
export const MIN_STREAK_WEEKS = 2;

export type ConsistencyDay = { date: string; trained: boolean; isToday: boolean };

export type Consistency = {
  /** Lunes a domingo de la semana local actual. */
  days: ConsistencyDay[];
  /** Días entrenados esta semana. */
  weekDays: number;
  /** Días entrenados en todo el historial. */
  totalDays: number;
  /** Semanas seguidas con al menos un día entrenado. */
  streak: number;
  /** Días entrenados durante la racha actual (lo que acumula el fueguito). */
  streakDays: number;
  /**
   * La semana actual aún no tiene entrenamientos: la racha de semanas anteriores se
   * conserva hasta que termine el domingo (se muestra como pendiente).
   */
  pending: boolean;
};

const EMPTY: ConsistencyRow = { total_days: 0, recent_days: [], active_weeks: [], active_week_days: [] };

/**
 * Indicadores de constancia con la fecha local `today`. Una semana (lunes a domingo)
 * cuenta si tiene al menos un día entrenado; los días de descanso dentro de la semana
 * no rompen la racha. Las semanas posteriores a la actual se ignoran.
 */
export function consistency(row: ConsistencyRow | null | undefined, today: string): Consistency {
  const data = row ?? EMPTY;
  const monday = mondayOf(today);
  const trainedDays = new Set(data.recent_days.map((d) => d.slice(0, 10)));
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { date, trained: trainedDays.has(date), isToday: date === today };
  });
  const weekDays = new Map<string, number>();
  data.active_weeks.forEach((d, i) => weekDays.set(d.slice(0, 10), data.active_week_days?.[i] ?? 1));
  const weeks = new Set(weekDays.keys());

  const thisWeekActive = weeks.has(monday);
  let streak = 0;
  let streakDays = 0;
  let week = thisWeekActive ? monday : addDays(monday, -7);
  while (weeks.has(week)) {
    streak += 1;
    streakDays += weekDays.get(week) ?? 0;
    week = addDays(week, -7);
  }

  return {
    days,
    weekDays: days.filter((d) => d.trained).length,
    totalDays: data.total_days ?? 0,
    streak,
    streakDays,
    pending: !thisWeekActive && streak > 0,
  };
}
