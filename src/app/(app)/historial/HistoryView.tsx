"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { listHistory } from "@/app/actions/sessions";
import { IconChevronRight, IconSearch, IconX } from "@/components/icons";
import { formatDate, todayLocal } from "@/lib/format";
import {
  cursorOf,
  DEFAULT_FILTERS,
  exercisePreview,
  groupByMonth,
  hasActiveFilters,
  HISTORY_RANGES,
  historyBounds,
  historyQueryString,
  MAX_QUERY_LENGTH,
  mergePages,
  readHistoryFilters,
  type HistoryFilters,
  type HistoryRange,
  type HistorySession,
} from "@/lib/history";
import { saveHistoryQuery } from "@/lib/history-query";

type Loaded = {
  key: string;
  status: "ok" | "error";
  sessions: HistorySession[];
  total: number | null;
  hasMore: boolean;
  error?: string;
};

const noop = () => () => {};
const SEARCH_DELAY = 300;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function counts(s: HistorySession) {
  return `${plural(s.exercise_count, "ejercicio", "ejercicios")} · ${plural(s.set_count, "serie", "series")}`;
}

function HistoryCard({ session }: { session: HistorySession }) {
  return (
    <Link href={`/sesiones/${session.id}`} className="card history-card">
      <span className="history-card-text">
        <span className="history-card-top">
          <strong>{capitalize(formatDate(session.session_date, { year: false }))}</strong>
          {session.finished_at === null ? <span className="badge badge-warning">En curso</span> : null}
        </span>
        <span className="history-card-groups">
          {session.muscle_groups.length ? session.muscle_groups.join(" · ") : "Sin grupo muscular"}
        </span>
        <span className="muted small history-card-names">{exercisePreview(session.exercise_names, session.exercise_count)}</span>
        <span className="small">{counts(session)}</span>
      </span>
      <span className="catalog-row-chevron" aria-hidden="true"><IconChevronRight /></span>
    </Link>
  );
}

export function HistoryView({ initial, deleted }: { initial: HistoryFilters; deleted: boolean }) {
  // «Hoy» es la fecha local del dispositivo (vacía durante el render del servidor).
  const today = useSyncExternalStore(noop, () => todayLocal(), () => "");
  // Los filtros salen de la URL del router: al volver con «atrás» Next reutiliza la
  // página en caché (renderizada con la URL original) y `initial` no los refleja.
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<HistoryFilters>(() =>
    searchParams ? readHistoryFilters(Object.fromEntries(searchParams)) : initial,
  );
  const [qInput, setQInput] = useState(filters.q);
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const boundsResult = historyBounds(filters, today || "2000-01-01");
  const bounds = boundsResult.ok ? boundsResult.bounds : null;
  const q = filters.q.trim();
  // Identifica la consulta actual: si cambia, lo cargado deja de ser válido.
  const key = today && bounds ? JSON.stringify([bounds.from, bounds.to, q, reload]) : "";
  const current = loaded && loaded.key === key ? loaded : null;
  const loading = Boolean(key) && !current;

  // Los filtros viven en la URL (sobreviven a «atrás» y a recargar) y se recuerdan
  // para volver desde el editor de sesiones.
  useEffect(() => {
    const search = historyQueryString(filters);
    window.history.replaceState(null, "", `/historial${search}`);
    saveHistoryQuery(search);
  }, [filters]);
  const apply = setFilters;

  useEffect(() => {
    if (!key || !bounds) return;
    let cancelled = false;
    listHistory({ from: bounds.from, to: bounds.to, q, cursor: null })
      .then((res) => {
        if (cancelled) return;
        setLoaded(
          res.ok
            ? { key, status: "ok", ...res.data }
            : { key, status: "error", sessions: [], total: null, hasMore: false, error: res.error },
        );
      })
      .catch(() => {
        if (!cancelled)
          setLoaded({ key, status: "error", sessions: [], total: null, hasMore: false, error: "Sin conexión con el servidor. Reintenta." });
      });
    return () => {
      cancelled = true;
    };
    // `bounds` y `q` están contenidos en `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Al volver con «atrás» desde la caché del navegador, recarga para mostrar las correcciones.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setReload((n) => n + 1);
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  function changeQuery(value: string) {
    setQInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setFilters((prev) => ({ ...prev, q: value })), value ? SEARCH_DELAY : 0);
  }

  function changeRange(range: HistoryRange) {
    apply({ ...filters, range, from: range === "personalizado" ? filters.from : "", to: range === "personalizado" ? filters.to : "" });
  }

  function clearFilters() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setQInput("");
    apply(DEFAULT_FILTERS);
  }

  async function loadMore() {
    if (!current || !bounds || loadingMore || !current.hasMore) return;
    const last = current.sessions.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await listHistory({ from: bounds.from, to: bounds.to, q, cursor: cursorOf(last) });
      if (res.ok) {
        setLoaded((prev) =>
          prev && prev.key === current.key
            ? { ...prev, sessions: mergePages(prev.sessions, res.data.sessions), hasMore: res.data.hasMore }
            : prev,
        );
      } else {
        setLoaded((prev) => (prev && prev.key === current.key ? { ...prev, error: res.error } : prev));
      }
    } catch {
      setLoaded((prev) => (prev && prev.key === current.key ? { ...prev, error: "Sin conexión con el servidor. Reintenta." } : prev));
    } finally {
      setLoadingMore(false);
    }
  }

  const active = hasActiveFilters(filters);
  const groups = current?.status === "ok" ? groupByMonth(current.sessions) : [];

  return (
    <div className="stack history">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Historial</h1>
        <Link href="/entrenar?origen=historial" className="btn btn-primary btn-sm">+ Registrar sesión</Link>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        ¿Entrenaste otro día? Al registrar, toca la fecha de la sesión para cambiarla.
      </p>
      {deleted ? <p className="alert alert-success" role="status">Sesión eliminada.</p> : null}

      <div className="search-field" role="search">
        <span className="search-icon" aria-hidden="true"><IconSearch /></span>
        <input
          className="input"
          type="search"
          value={qInput}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(e) => changeQuery(e.target.value)}
          placeholder="Buscar por ejercicio"
          aria-label="Buscar por ejercicio"
          autoComplete="off"
          enterKeyHint="search"
        />
        {qInput ? (
          <button type="button" className="search-clear" aria-label="Limpiar búsqueda" onClick={() => changeQuery("")}>
            <IconX />
          </button>
        ) : null}
      </div>

      <div className="chips" role="group" aria-label="Período">
        {HISTORY_RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className="chip-filter"
            aria-pressed={filters.range === r.id}
            onClick={() => changeRange(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {filters.range === "personalizado" ? (
        <div className="stack" style={{ gap: 6 }}>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label className="field">
              <span>Desde</span>
              <input
                className="input"
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                aria-invalid={!boundsResult.ok || undefined}
                onChange={(e) => apply({ ...filters, from: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Hasta</span>
              <input
                className="input"
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                aria-invalid={!boundsResult.ok || undefined}
                onChange={(e) => apply({ ...filters, to: e.target.value })}
              />
            </label>
          </div>
          {boundsResult.ok ? (
            <p className="muted small" style={{ margin: 0 }}>Puedes dejar vacío uno de los dos límites.</p>
          ) : (
            <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{boundsResult.error}</p>
          )}
        </div>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {current?.status === "ok" && current.total !== null ? plural(current.total, "sesión", "sesiones") : ""}
      </div>

      {!boundsResult.ok ? null : loading ? (
        <p className="muted" role="status">Cargando sesiones…</p>
      ) : current?.status === "error" ? (
        <div className="card stack">
          <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{current.error}</p>
          <button type="button" className="btn" onClick={() => setReload((n) => n + 1)}>Reintentar</button>
        </div>
      ) : current && current.sessions.length === 0 ? (
        active ? (
          <div className="card empty stack" role="status">
            <p style={{ margin: 0 }}>No encontramos sesiones con estos filtros.</p>
            <button type="button" className="btn" onClick={clearFilters}>Limpiar filtros</button>
          </div>
        ) : (
          <div className="card empty stack" role="status">
            <p style={{ margin: 0 }}>Todavía no tienes sesiones.</p>
            <Link href="/entrenar" className="btn btn-primary">+ Registrar sesión</Link>
          </div>
        )
      ) : current ? (
        <>
          {current.total !== null ? (
            <p className="muted small" style={{ margin: 0 }}>
              {plural(current.total, "sesión", "sesiones")}. Toca una para verla o corregirla.
            </p>
          ) : null}
          {groups.map((g) => (
            <section key={g.key} className="history-month" aria-labelledby={`mes-${g.key}`}>
              <h2 id={`mes-${g.key}`} className="history-month-title">{g.label}</h2>
              <ul className="list">
                {g.sessions.map((s) => (
                  <li key={s.id}><HistoryCard session={s} /></li>
                ))}
              </ul>
            </section>
          ))}
          {current.error ? <p className="alert alert-error" role="alert">{current.error}</p> : null}
          {current.hasMore ? (
            <button type="button" className="btn btn-block" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? "Cargando…" : "Cargar más sesiones"}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
