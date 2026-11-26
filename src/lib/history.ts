import { isIsoDate } from "./format";
import { mondayOf } from "./home";
import { addDays } from "./progress";

/** Fila de `search_workout_sessions`. */
export type HistorySession = {
  id: string;
  session_date: string;
  created_at: string;
  /** null = en curso. */
  finished_at: string | null;
  exercise_count: number;
  set_count: number;
  muscle_groups: string[];
  /** Hasta dos nombres, en el orden de la sesión. */
  exercise_names: string[];
  /** Total que cumple el filtro (solo en la primera página). */
  total_count: number | null;
};

export type HistoryCursor = { date: string; created: string; id: string };

export type HistoryRange = "todo" | "semana" | "mes" | "personalizado";
export const HISTORY_RANGES: { id: HistoryRange; label: string }[] = [
  { id: "todo", label: "Todo" },
  { id: "semana", label: "Esta semana" },
  { id: "mes", label: "Este mes" },
  { id: "personalizado", label: "Personalizado" },
];

export type HistoryFilters = { range: HistoryRange; from: string; to: string; q: string };
export const DEFAULT_FILTERS: HistoryFilters = { range: "todo", from: "", to: "", q: "" };

export const MAX_QUERY_LENGTH = 100;

/** Lee los filtros de la URL (?rango=&desde=&hasta=&q=). Abre en «Todo». */
export function readHistoryFilters(params: Record<string, string | string[] | undefined>): HistoryFilters {
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const rawRange = str("rango");
  const range = HISTORY_RANGES.some((r) => r.id === rawRange) ? (rawRange as HistoryRange) : "todo";
  const custom = range === "personalizado";
  return {
    range,
    from: custom && isIsoDate(str("desde")) ? str("desde") : "",
    to: custom && isIsoDate(str("hasta")) ? str("hasta") : "",
    q: str("q").slice(0, MAX_QUERY_LENGTH),
  };
}

/** Querystring («?rango=…») de los filtros; vacío en «Todo» sin búsqueda. */
export function historyQueryString(f: HistoryFilters): string {
  const sp = new URLSearchParams();
  if (f.range !== "todo") sp.set("rango", f.range);
  if (f.range === "personalizado") {
    if (f.from) sp.set("desde", f.from);
    if (f.to) sp.set("hasta", f.to);
  }
  if (f.q.trim()) sp.set("q", f.q.trim());
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function hasActiveFilters(f: HistoryFilters): boolean {
  return f.range !== "todo" || f.q.trim() !== "";
}

export type Bounds = { from: string | null; to: string | null };

/**
 * Límites inclusivos según la fecha local `today`:
 * semana = lunes a domingo; mes = día 1 al último día. «Personalizado» acepta un
 * solo límite y es inválido si «Desde» es posterior a «Hasta».
 */
export function historyBounds(f: HistoryFilters, today: string): { ok: true; bounds: Bounds } | { ok: false; error: string } {
  switch (f.range) {
    case "semana": {
      const monday = mondayOf(today);
      return { ok: true, bounds: { from: monday, to: addDays(monday, 6) } };
    }
    case "mes": {
      const first = `${today.slice(0, 7)}-01`;
      const [y, m] = today.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return { ok: true, bounds: { from: first, to: last } };
    }
    case "personalizado": {
      const from = isIsoDate(f.from) ? f.from : null;
      const to = isIsoDate(f.to) ? f.to : null;
      if (from && to && from > to) return { ok: false, error: "«Desde» no puede ser posterior a «Hasta»." };
      return { ok: true, bounds: { from, to } };
    }
    default:
      return { ok: true, bounds: { from: null, to: null } };
  }
}

export type MonthGroup = { key: string; label: string; sessions: HistorySession[] };

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** «Noviembre de 2026». */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return capitalize(
    new Intl.DateTimeFormat("es", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1))),
  );
}

/** Agrupa por mes conservando el orden recibido (más reciente primero) y todas las sesiones del día. */
export function groupByMonth(sessions: HistorySession[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const s of sessions) {
    const key = s.session_date.slice(0, 7);
    const last = groups.at(-1);
    if (last?.key === key) last.sessions.push(s);
    else groups.push({ key, label: monthLabel(key), sessions: [s] });
  }
  return groups;
}

/** «Press de banca · Dominadas · +2 más». */
export function exercisePreview(names: string[], total: number): string {
  if (total === 0) return "Sin ejercicios";
  const shown = names.slice(0, 2);
  const rest = total - shown.length;
  return rest > 0 ? `${shown.join(" · ")} · +${rest} más` : shown.join(" · ");
}

/** Une páginas sin repetir sesiones (por si una página se pide dos veces). */
export function mergePages(current: HistorySession[], next: HistorySession[]): HistorySession[] {
  const seen = new Set(current.map((s) => s.id));
  return [...current, ...next.filter((s) => !seen.has(s.id))];
}

export function cursorOf(s: HistorySession): HistoryCursor {
  return { date: s.session_date, created: s.created_at, id: s.id };
}
