import { addDays } from "./progress";

/** Fila de `get_home_sessions`. */
export type HomeSession = {
  id: string;
  session_date: string;
  created_at: string;
  finished_at: string | null;
  exercise_count: number;
  set_count: number;
  muscle_groups: string[];
};

const newestFirst = (a: HomeSession, b: HomeSession) =>
  b.session_date.localeCompare(a.session_date) || b.created_at.localeCompare(a.created_at);

export type PrimaryAction =
  | { kind: "continue"; session: HomeSession }
  | { kind: "continue-draft" }
  | { kind: "review"; session: HomeSession }
  | { kind: "start" };

/**
 * Acción principal de «Entrenamiento de hoy», según la fecha local del usuario:
 *  1. la sesión en curso de hoy más reciente → «Continuar entrenamiento»;
 *  2. un borrador local sin guardar (sesión nueva) → «Continuar entrenamiento»;
 *  3. hoy solo hay sesiones finalizadas → «Ver entrenamiento de hoy» (+ «Nueva sesión»);
 *  4. nada → «Iniciar entrenamiento».
 */
export function primaryAction(sessions: HomeSession[], today: string, hasLocalDraft: boolean): PrimaryAction {
  const todays = sessions.filter((s) => s.session_date === today).sort(newestFirst);
  const inProgress = todays.find((s) => !s.finished_at);
  if (inProgress) return { kind: "continue", session: inProgress };
  if (hasLocalDraft) return { kind: "continue-draft" };
  const finished = todays.find((s) => s.finished_at);
  if (finished) return { kind: "review", session: finished };
  return { kind: "start" };
}

/** Sesiones en curso que no son la acción principal (se retoman desde el historial). */
export function otherInProgress(sessions: HomeSession[], primary: PrimaryAction): HomeSession[] {
  const primaryId = primary.kind === "continue" ? primary.session.id : null;
  return sessions.filter((s) => !s.finished_at && s.id !== primaryId).sort(newestFirst);
}

/** Sesión en curso hoy (para ofrecer continuarla antes de repetir otra). */
export function inProgressToday(sessions: HomeSession[], today: string): HomeSession | null {
  return sessions.filter((s) => s.session_date === today && !s.finished_at).sort(newestFirst)[0] ?? null;
}

/** Lunes de la semana de `iso` (semanas de lunes a domingo). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(iso, -((dow + 6) % 7));
}

export type WeekDay = { date: string; trained: boolean; isToday: boolean; sessions: number };

/** Franja de lunes a domingo: días con sesiones finalizadas y total de la semana. */
export function weekSummary(sessions: HomeSession[], today: string): { days: WeekDay[]; total: number } {
  const monday = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const n = sessions.filter((s) => s.session_date === date && s.finished_at).length;
    return { date, trained: n > 0, isToday: date === today, sessions: n };
  });
  return { days, total: days.reduce((sum, d) => sum + d.sessions, 0) };
}

/** Hasta `limit` sesiones finalizadas, de la más reciente a la más antigua. */
export function recentFinished(sessions: HomeSession[], limit = 3): HomeSession[] {
  return sessions.filter((s) => s.finished_at).sort(newestFirst).slice(0, limit);
}
