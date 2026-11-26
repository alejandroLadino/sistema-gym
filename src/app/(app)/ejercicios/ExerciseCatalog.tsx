"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconChevronRight, IconPlus, IconSearch, IconX } from "@/components/icons";
import {
  ALL_GROUPS,
  filterCatalog,
  filtersToSearch,
  groupForNewExercise,
  hasActiveFilters,
  matchesFilters,
  type CatalogFilters,
  type CatalogView,
} from "@/lib/exercise-catalog";
import { muscleGroupName, UNCLASSIFIED, UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { ExerciseSheet, type SavedExercise, type SheetMode } from "./ExerciseSheet";

type Toast = { text: string; show?: Exercise };

type Props = {
  exercises: Exercise[];
  groups: MuscleGroup[];
  initialFilters: CatalogFilters;
};

export function ExerciseCatalog({ exercises, groups, initialFilters }: Props) {
  const router = useRouter();
  const [filters, setFiltersState] = useState<CatalogFilters>(initialFilters);
  const [sheet, setSheet] = useState<SheetMode | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  // Cambios recién guardados, visibles antes de que llegue la lista actualizada del servidor.
  const [overrides, setOverrides] = useState<Record<string, Exercise>>({});
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const items = useMemo(() => {
    const byId = new Map(exercises.map((e) => [e.id, e]));
    for (const [id, e] of Object.entries(overrides)) byId.set(id, e);
    return [...byId.values()];
  }, [exercises, overrides]);

  const visible = filterCatalog(items, groups, filters);
  const activeCount = items.filter((e) => !e.archived_at).length;
  const archivedCount = items.length - activeCount;
  const viewTotal = filters.view === "activos" ? activeCount : archivedCount;
  const hasUnclassified = items.some((e) => !e.muscle_group_id);
  const filtered = hasActiveFilters(filters);

  // Los filtros viven en la URL (sin recargar) para conservarlos al volver.
  const setFilters = useCallback((next: CatalogFilters | ((f: CatalogFilters) => CatalogFilters)) => {
    setFiltersState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      window.history.replaceState(null, "", `/ejercicios${filtersToSearch(value)}`);
      return value;
    });
  }, []);

  const showToast = (t: Toast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), t.show ? 7000 : 4000);
  };
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Resalta y lleva a la vista el ejercicio pedido con «Ver ejercicio».
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(`ej-${highlight}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setHighlight(null), 2500);
    return () => clearTimeout(t);
  }, [highlight, visible.length]);

  function remember(e: Exercise) {
    setOverrides((o) => ({ ...o, [e.id]: e }));
  }

  function afterChange(e: Exercise, text: string) {
    // Si los filtros actuales lo ocultan, se conservan y se ofrece «Ver ejercicio».
    showToast({ text, show: matchesFilters(e, groups, filters) ? undefined : e });
    if (matchesFilters(e, groups, filters)) setHighlight(e.id);
    router.refresh();
  }

  function onSaved(saved: SavedExercise) {
    const e: Exercise = {
      id: saved.id,
      name: saved.name,
      muscle_group_id: saved.muscle_group_id,
      notes: saved.notes,
      archived_at: saved.archived_at,
    };
    remember(e);
    setSheet(null);
    afterChange(e, saved.created ? `«${e.name}» creado` : "Cambios guardados");
  }

  function onArchiveChange(ex: Exercise, archived: boolean) {
    const e = { ...ex, archived_at: archived ? new Date().toISOString() : null };
    remember(e);
    setSheet(null);
    afterChange(e, archived ? `«${e.name}» archivado` : `«${e.name}» restaurado`);
  }

  function showExercise(e: Exercise) {
    setToast(null);
    setFilters({ q: "", group: e.muscle_group_id ?? UNCLASSIFIED, view: e.archived_at ? "archivados" : "activos" });
    setHighlight(e.id);
  }

  const openCreate = () => setSheet({ type: "create", initialGroup: groupForNewExercise(filters) });
  const chips = [
    { id: ALL_GROUPS, label: "Todos" },
    ...groups.map((g) => ({ id: g.id, label: g.name })),
    ...(hasUnclassified ? [{ id: UNCLASSIFIED, label: UNCLASSIFIED_LABEL }] : []),
  ];
  const views: { id: CatalogView; label: string; count: number }[] = [
    { id: "activos", label: "Activos", count: activeCount },
    { id: "archivados", label: "Archivados", count: archivedCount },
  ];

  return (
    <div className="catalog">
      <header className="catalog-head">
        <h1>Ejercicios</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          <IconPlus /> Nuevo ejercicio
        </button>
      </header>

      <div className="catalog-tools">
        <div className="search-field" role="search">
          <span className="search-icon" aria-hidden="true"><IconSearch /></span>
          <input
            className="input"
            type="search"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
            placeholder="Buscar por nombre o grupo"
            aria-label="Buscar ejercicio"
            autoComplete="off"
            enterKeyHint="search"
          />
          {filters.q ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Limpiar búsqueda"
              onClick={() => setFilters((f) => ({ ...f, q: "" }))}
            >
              <IconX />
            </button>
          ) : null}
        </div>

        <div className="chips" role="group" aria-label="Filtrar por grupo muscular">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className="chip-filter"
              aria-pressed={filters.group === c.id}
              onClick={() => setFilters((f) => ({ ...f, group: c.id }))}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="segmented" role="group" aria-label="Vista">
          {views.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={filters.view === v.id}
              onClick={() => setFilters((f) => ({ ...f, view: v.id }))}
            >
              {v.label} <span className="segmented-count">{v.count}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card empty stack" role="status">
          {viewTotal === 0 && !filtered ? (
            filters.view === "activos" ? (
              <>
                <p>Tu catálogo está vacío.</p>
                <button type="button" className="btn btn-primary" onClick={openCreate}>
                  <IconPlus /> Nuevo ejercicio
                </button>
              </>
            ) : (
              <p>No tienes ejercicios archivados.</p>
            )
          ) : (
            <>
              <p>Ningún ejercicio coincide con los filtros.</p>
              <button type="button" className="btn" onClick={() => setFilters((f) => ({ ...f, q: "", group: ALL_GROUPS }))}>
                Limpiar filtros
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className="catalog-list" aria-label="Catálogo de ejercicios">
          {visible.map((e) => {
            const groupName = muscleGroupName(groups, e.muscle_group_id);
            return (
              <li key={e.id} id={`ej-${e.id}`} data-highlight={highlight === e.id || undefined}>
                <button type="button" className="catalog-row" onClick={() => setSheet({ type: "edit", exercise: e })}>
                  <span className="catalog-row-text">
                    <strong>{e.name}</strong>
                    {groupName ? (
                      <span className="muted small">{groupName}</span>
                    ) : (
                      <span className="badge badge-warning">{UNCLASSIFIED_LABEL}</span>
                    )}
                  </span>
                  <span className="catalog-row-chevron" aria-hidden="true"><IconChevronRight /></span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {toast ? (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.show ? (
            <button type="button" className="btn btn-sm" onClick={() => showExercise(toast.show!)}>
              Ver ejercicio
            </button>
          ) : null}
        </div>
      ) : null}

      {sheet ? (
        <ExerciseSheet
          key={sheet.type === "edit" ? sheet.exercise.id : "nuevo"}
          mode={sheet}
          groups={groups}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
          onArchiveChange={onArchiveChange}
        />
      ) : null}
    </div>
  );
}
