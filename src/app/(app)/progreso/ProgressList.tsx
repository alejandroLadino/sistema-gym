"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconChevronRight, IconSearch, IconX } from "@/components/icons";
import { formatDate } from "@/lib/format";
import { muscleGroupName, UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import type { OverviewSummary } from "@/lib/progress";
import type { MuscleGroup } from "@/lib/types";
import { normalizeSearch } from "@/lib/validation";
import { saveProgressListQuery } from "./list-query";

export type ProgressItem = {
  id: string;
  name: string;
  groupId: string | null;
  archived: boolean;
  summary: OverviewSummary | null;
};

const ALL = "todos";

const TREND_CLASS = { up: "badge badge-success", down: "badge badge-warning", same: "badge", first: "badge" } as const;

function byRecent(a: ProgressItem, b: ProgressItem) {
  const da = a.summary?.lastDate ?? "";
  const db = b.summary?.lastDate ?? "";
  return db.localeCompare(da) || a.name.localeCompare(b.name, "es");
}

export function ProgressList({
  items,
  groups,
  initialQuery,
  initialGroup,
}: {
  items: ProgressItem[];
  groups: MuscleGroup[];
  initialQuery: string;
  initialGroup: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [group, setGroup] = useState(initialGroup);

  // La búsqueda y el grupo viven en la URL y se recuerdan para el botón «‹ Progreso» del detalle.
  const sync = useCallback((nextQ: string, nextGroup: string) => {
    const sp = new URLSearchParams();
    if (nextQ.trim()) sp.set("q", nextQ.trim());
    if (nextGroup !== ALL) sp.set("grupo", nextGroup);
    const search = sp.toString() ? `?${sp}` : "";
    window.history.replaceState(null, "", `/progreso${search}`);
    saveProgressListQuery(search);
  }, []);
  useEffect(() => sync(initialQuery, initialGroup), [sync, initialQuery, initialGroup]);

  const update = (nextQ: string, nextGroup: string) => {
    setQ(nextQ);
    setGroup(nextGroup);
    sync(nextQ, nextGroup);
  };

  const needle = normalizeSearch(q);
  const match = (i: ProgressItem) =>
    (group === ALL || i.groupId === group) && (!needle || normalizeSearch(i.name).includes(needle));

  const withRecords = items.filter((i) => !i.archived && i.summary).sort(byRecent);
  const noRecords = items.filter((i) => !i.archived && !i.summary).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const archived = items.filter((i) => i.archived).sort(byRecent);
  const [shown, shownNo, shownArch] = [withRecords.filter(match), noRecords.filter(match), archived.filter(match)];
  const filtered = Boolean(needle) || group !== ALL;
  const nothing = shown.length + shownNo.length + shownArch.length === 0;

  const row = (i: ProgressItem) => {
    const groupName = muscleGroupName(groups, i.groupId) ?? UNCLASSIFIED_LABEL;
    return (
      <li key={i.id}>
        <Link href={`/progreso/${i.id}`} className="catalog-row progress-row">
          <span className="catalog-row-text">
            <strong>{i.name}</strong>
            <span className="muted small">
              {groupName}
              {i.summary ? ` · ${formatDate(i.summary.lastDate, { year: false })}` : ""}
            </span>
            {i.summary ? (
              <span className="progress-row-result">
                <span className="progress-best">{i.summary.best}</span>
                <span className={TREND_CLASS[i.summary.change.trend]}>{i.summary.change.text}</span>
              </span>
            ) : null}
          </span>
          <span className="catalog-row-chevron" aria-hidden="true"><IconChevronRight /></span>
        </Link>
      </li>
    );
  };

  return (
    <div className="stack">
      <h1>Progreso</h1>
      <p className="muted small" style={{ margin: 0 }}>Tus ejercicios, del más reciente al más antiguo. Toca uno para ver su detalle.</p>

      <div className="search-field" role="search">
        <span className="search-icon" aria-hidden="true"><IconSearch /></span>
        <input
          className="input"
          type="search"
          value={q}
          onChange={(e) => update(e.target.value, group)}
          placeholder="Buscar ejercicio"
          aria-label="Buscar ejercicio"
          autoComplete="off"
          enterKeyHint="search"
        />
        {q ? (
          <button type="button" className="search-clear" aria-label="Limpiar búsqueda" onClick={() => update("", group)}>
            <IconX />
          </button>
        ) : null}
      </div>

      <div className="chips" role="group" aria-label="Filtrar por grupo muscular">
        {[{ id: ALL, name: "Todos" }, ...groups].map((g) => (
          <button key={g.id} type="button" className="chip-filter" aria-pressed={group === g.id} onClick={() => update(q, g.id)}>
            {g.name}
          </button>
        ))}
      </div>

      {nothing ? (
        <div className="card empty stack" role="status">
          {filtered ? (
            <>
              <p>Ningún ejercicio coincide con la búsqueda.</p>
              <button type="button" className="btn" onClick={() => update("", ALL)}>Limpiar filtros</button>
            </>
          ) : (
            <>
              <p>Aún no tienes ejercicios. Crea uno al registrar tu entrenamiento.</p>
              <Link href="/entrenar" className="btn btn-primary">Registrar entrenamiento</Link>
            </>
          )}
        </div>
      ) : null}

      {shown.length ? (
        <ul className="catalog-list" aria-label="Ejercicios con registros">{shown.map(row)}</ul>
      ) : !nothing && !filtered ? (
        <div className="card empty">Aún no registras entrenamientos. Tus resultados aparecerán aquí.</div>
      ) : null}

      {shownNo.length ? (
        <details className="disclosure">
          <summary>Sin registros ({shownNo.length})</summary>
          <ul className="catalog-list" aria-label="Ejercicios sin registros">{shownNo.map(row)}</ul>
        </details>
      ) : null}

      {shownArch.length ? (
        <details className="disclosure">
          <summary>Archivados ({shownArch.length})</summary>
          <ul className="catalog-list" aria-label="Ejercicios archivados">{shownArch.map(row)}</ul>
        </details>
      ) : null}
    </div>
  );
}
