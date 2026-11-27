"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ProgressChart } from "@/components/ProgressChart";
import { formatStep, isBlockSet } from "@/lib/blocks";
import { formatDate, formatKg, formatSet, todayLocal } from "@/lib/format";
import { UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import {
  chartPoints,
  compareBest,
  comparableSessions,
  defaultMetric,
  formatBestSet,
  inRange,
  metricOptions,
  metricTitle,
  metricUnit,
  periodBest,
  RANGE_OPTIONS,
  rangeBounds,
  sessionStats,
  usesWeight,
  type Metric,
  type ProgressRow,
  type RangeKey,
  type SessionStat,
} from "@/lib/progress";
import { useProgressListHref } from "../list-query";

type Props = {
  exercise: { id: string; name: string; groupName: string | null; archived: boolean };
  rows: ProgressRow[];
  initial: { range: string; from: string; to: string; metric: string };
};

const TREND_CLASS = { up: "badge badge-success", down: "badge badge-warning", same: "badge", first: "badge" } as const;
const noop = () => () => {};

export function ExerciseProgress({ exercise, rows, initial }: Props) {
  const backHref = useProgressListHref();
  // La fecha de hoy es la del dispositivo (no la del servidor).
  const today = useSyncExternalStore(noop, () => todayLocal(), () => null);

  const all = sessionStats(rows);
  // Clasificación peso / peso corporal según todo el historial, no el rango.
  const weighted = usesWeight(all);
  const metrics = metricOptions(weighted);

  const [range, setRange] = useState<RangeKey>(
    RANGE_OPTIONS.some((r) => r.id === initial.range) ? (initial.range as RangeKey) : "todo",
  );
  const [custom, setCustom] = useState({ from: initial.from, to: initial.to });
  const [metric, setMetric] = useState<Metric>(
    metrics.some((m) => m.id === initial.metric) ? (initial.metric as Metric) : defaultMetric(weighted),
  );

  const syncUrl = (next: { range: RangeKey; from: string; to: string; metric: Metric }) => {
    const sp = new URLSearchParams();
    if (next.range !== "todo") sp.set("rango", next.range);
    if (next.range === "custom") {
      if (next.from) sp.set("desde", next.from);
      if (next.to) sp.set("hasta", next.to);
    }
    if (next.metric !== defaultMetric(weighted)) sp.set("metrica", next.metric);
    window.history.replaceState(null, "", `/progreso/${exercise.id}${sp.toString() ? `?${sp}` : ""}`);
  };
  const change = (patch: Partial<{ range: RangeKey; from: string; to: string; metric: Metric }>) => {
    const next = { range, from: custom.from, to: custom.to, metric, ...patch };
    if (patch.range) setRange(patch.range);
    if (patch.from !== undefined || patch.to !== undefined) setCustom({ from: next.from, to: next.to });
    if (patch.metric) setMetric(patch.metric);
    syncUrl(next);
  };

  // Sin la fecha del dispositivo todavía (primer render), «30/90 días» se calculan al montar.
  const bounds =
    today || range === "todo" || range === "custom"
      ? rangeBounds(range, today ?? "9999-12-31", custom)
      : { from: null, to: null };
  const period = all.filter((s) => inRange(s, bounds));
  const comparable = comparableSessions(period, weighted);
  const last = comparable.at(-1) ?? null;
  const previous = comparable.at(-2) ?? null;
  const lastAny = period.at(-1) ?? null;
  const firstEver = comparableSessions(all, weighted).length === 1;
  const lastChange = last && previous ? compareBest(last.best, previous.best, weighted) : last && firstEver ? compareBest(last.best, null, weighted) : null;
  const best = periodBest(comparable, weighted);
  const points = chartPoints(period, metric);
  const history = [...period].reverse();

  const rangeLabel =
    bounds.from || bounds.to
      ? `${bounds.from ? formatDate(bounds.from, { weekday: false }) : "el inicio"} – ${bounds.to ? formatDate(bounds.to, { weekday: false }) : "hoy"}`
      : "todo tu historial";

  return (
    <div className="stack-lg progress-detail">
      <div className="stack" style={{ gap: 6 }}>
        <Link href={backHref} className="back-link">‹ Progreso</Link>
        <h1 style={{ margin: 0 }}>{exercise.name}</h1>
        <div className="row small muted">
          <span>{exercise.groupName ?? UNCLASSIFIED_LABEL} · {weighted ? "Con peso" : "Peso corporal"}</span>
          {exercise.archived ? <span className="badge">Archivado</span> : null}
        </div>
      </div>

      {all.length === 0 ? (
        <div className="card empty stack">
          <p>Aún no registras este ejercicio.</p>
          <Link href="/entrenar" className="btn btn-primary">Registrar entrenamiento</Link>
        </div>
      ) : (
        <>
          <div className="stack" style={{ gap: 8 }}>
            <div className="chips" role="group" aria-label="Período">
              {RANGE_OPTIONS.map((r) => (
                <button key={r.id} type="button" className="chip-filter" aria-pressed={range === r.id} onClick={() => change({ range: r.id })}>
                  {r.label}
                </button>
              ))}
            </div>
            {range === "custom" ? (
              <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <label className="field">
                  <span>Desde</span>
                  <input className="input" type="date" value={custom.from} onChange={(e) => change({ from: e.target.value })} />
                </label>
                <label className="field">
                  <span>Hasta</span>
                  <input className="input" type="date" value={custom.to} onChange={(e) => change({ to: e.target.value })} />
                </label>
              </div>
            ) : null}
          </div>

          {period.length === 0 ? (
            <div className="card empty stack" role="status">
              <p>No hay sesiones entre {rangeLabel}.</p>
              <button type="button" className="btn btn-primary" onClick={() => change({ range: "todo" })}>
                Ver todo el historial
              </button>
            </div>
          ) : (
            <>
              <section className="stat-grid" aria-label="Resumen del período">
                <div className="card stat stat-wide">
                  <span className="stat-label">Última sesión</span>
                  <span className="stat-value">
                    {last ? formatBestSet(last.best, weighted) : lastAny ? formatBestSet(lastAny.best, false) : "—"}
                  </span>
                  <span className="muted small">{formatDate((last ?? lastAny)!.date)}</span>
                  {lastChange ? <span className={TREND_CLASS[lastChange.trend]}>{lastChange.text}</span> : null}
                  {!last && weighted ? <span className="muted small">Sin peso registrado en este período</span> : null}
                </div>
                <div className="card stat">
                  <span className="stat-label">Mejor marca del período</span>
                  <span className="stat-value">{best ? formatBestSet(best.best, weighted) : "—"}</span>
                  {best ? <span className="muted small">{formatDate(best.date, { weekday: false })}</span> : null}
                </div>
                <div className="card stat">
                  <span className="stat-label">Sesiones del período</span>
                  <span className="stat-value">{period.length}</span>
                  <span className="muted small">de {all.length} en total</span>
                </div>
              </section>

              <section className="card stack" aria-label="Gráfica">
                <div className="segmented" role="group" aria-label="Métrica de la gráfica">
                  {metrics.map((m) => (
                    <button key={m.id} type="button" aria-pressed={metric === m.id} onClick={() => change({ metric: m.id })}>
                      {m.label}
                    </button>
                  ))}
                </div>
                {points.length ? (
                  <ProgressChart points={points} unit={metricUnit(metric)} title={metricTitle(metric, weighted)} />
                ) : (
                  <p className="muted" role="status">No hay sesiones con peso en este período. Prueba «Reps totales».</p>
                )}
              </section>

              <section className="stack" aria-label="Series por fecha">
                <h2 style={{ margin: 0 }}>Series por fecha</h2>
                <ul className="history-list">
                  {history.map((s) => (
                    <HistoryItem key={s.id} session={s} weighted={weighted} />
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}

      <Link href={`/ejercicios/${exercise.id}`} className="btn btn-ghost">Editar ejercicio</Link>
    </div>
  );
}

function HistoryItem({ session, weighted }: { session: SessionStat; weighted: boolean }) {
  return (
    <li className="card history-item">
      <div className="row between" style={{ flexWrap: "nowrap", alignItems: "baseline" }}>
        <strong>
          {formatDate(session.date)}
          {session.dayCount > 1 ? <span className="muted small"> · sesión {session.dayIndex} de {session.dayCount}</span> : null}
        </strong>
        <Link href={`/sesiones/${session.id}`} className="small">Ver sesión</Link>
      </div>
      <ol className="history-sets">
        {session.sets.map((set, i) =>
          isBlockSet(set) ? (
            // Serie por bloques: resumen compacto que se abre para ver la secuencia completa.
            <li key={i}>
              <details className="block-set">
                <summary>{formatSet(set)}</summary>
                <ol className="block-set-list">
                  {set.blocks.map((b, j) => (
                    <li key={j}>
                      {j + 1} · {formatStep(b)}
                    </li>
                  ))}
                  <li className="muted">Vueltas por serie: {set.rounds}</li>
                </ol>
              </details>
            </li>
          ) : (
            <li key={i}>{formatSet(set)}</li>
          ),
        )}
      </ol>
      <p className="muted small" style={{ margin: 0 }}>
        {weighted && session.maxWeight !== null ? `Máx. ${formatKg(session.maxWeight)} kg × ${session.best.reps} · ` : ""}
        {session.totalReps} reps totales · {session.setCount} {session.setCount === 1 ? "serie" : "series"}
        {session.holdSeconds > 0 ? ` · ${session.holdSeconds} s de sostén` : ""}
      </p>
    </li>
  );
}
