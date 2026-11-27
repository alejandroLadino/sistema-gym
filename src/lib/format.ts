import { formatSequence, isBlockSet } from "./blocks";
import { formatKg } from "./format-number";
import type { SetValue } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Fecha local del dispositivo en formato YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoToUtcDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "jue, 19 nov 2026" — sin desplazamientos por zona horaria. */
export function formatDate(iso: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const { weekday = true, year = true } = opts;
  return new Intl.DateTimeFormat("es", {
    timeZone: "UTC",
    weekday: weekday ? "short" : undefined,
    day: "numeric",
    month: "short",
    year: year ? "numeric" : undefined,
  }).format(isoToUtcDate(iso));
}

/** «jueves, 26 de noviembre». */
export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    isoToUtcDate(iso),
  );
}

export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat("es", { timeZone: "UTC", day: "numeric", month: "short" }).format(
    isoToUtcDate(iso),
  );
}

export { formatKg };

/** "40 kg × 12", "12 reps" (peso corporal) o la secuencia de una serie por bloques. */
export function formatSet(set: SetValue): string {
  if (isBlockSet(set)) return formatSequence(set.blocks, set.rounds ?? 1);
  if (set.weight_kg === null || set.weight_kg === undefined) return `${set.reps} reps`;
  return `${formatKg(Number(set.weight_kg))} kg × ${set.reps}`;
}

export function formatSets(sets: SetValue[]): string {
  return sets.map(formatSet).join(" · ");
}

/**
 * Resumen compacto: agrupa series consecutivas iguales.
 * [40×10, 40×10, 40×8, 42,5×6] → "2 × 10 a 40 kg · 40 kg × 8 · 42,5 kg × 6"
 * Peso corporal: [10, 10, 8] → "2 × 10 reps · 8 reps"
 * Por bloques: 4 iguales → "4 series: (7 reps → sostener 7 s) × 3"
 */
export function summarizeSets(sets: SetValue[]): string {
  const groups: { set: SetValue; key: string; count: number }[] = [];
  for (const set of sets) {
    const w = set.weight_kg === null || set.weight_kg === undefined ? null : Number(set.weight_kg);
    const normalized: SetValue = isBlockSet(set)
      ? { reps: null, weight_kg: null, rounds: set.rounds ?? 1, blocks: set.blocks }
      : { reps: set.reps, weight_kg: w };
    const key = JSON.stringify(normalized);
    const last = groups.at(-1);
    if (last && last.key === key) last.count += 1;
    else groups.push({ set: normalized, key, count: 1 });
  }
  return groups
    .map(({ set, count }) => {
      if (count === 1) return formatSet(set);
      if (isBlockSet(set)) return `${count} series: ${formatSet(set)}`;
      if (set.weight_kg === null) return `${count} × ${set.reps} reps`;
      return `${count} × ${set.reps} a ${formatKg(set.weight_kg)} kg`;
    })
    .join(" · ");
}
