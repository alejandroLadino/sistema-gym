import { mondayOf } from "./home";
import { addDays } from "./progress";

/** Fila de `get_training_consistency`. */
export type ConsistencyRow = { total_days: number; recent_days: string[]; active_weeks: string[] };

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
  /**
   * La semana actual aún no tiene entrenamientos: la racha de semanas anteriores se
   * conserva hasta que termine el domingo (se muestra como pendiente).
   */
  pending: boolean;
};

const EMPTY: ConsistencyRow = { total_days: 0, recent_days: [], active_weeks: [] };

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
  const weeks = new Set(data.active_weeks.map((d) => d.slice(0, 10)));

  const thisWeekActive = weeks.has(monday);
  let streak = 0;
  let week = thisWeekActive ? monday : addDays(monday, -7);
  while (weeks.has(week)) {
    streak += 1;
    week = addDays(week, -7);
  }

  return {
    days,
    weekDays: days.filter((d) => d.trained).length,
    totalDays: data.total_days ?? 0,
    streak,
    pending: !thisWeekActive && streak > 0,
  };
}
