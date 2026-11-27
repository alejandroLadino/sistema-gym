"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { quickCreateExercise } from "@/app/actions/exercises";
import { MuscleGroupSelect } from "@/components/MuscleGroupSelect";
import { IconPlus } from "@/components/icons";
import {
  GROUP_REQUIRED,
  muscleGroupName,
  NAME_REQUIRED,
  UNCLASSIFIED,
  UNCLASSIFIED_LABEL,
  type ExerciseFieldErrors,
} from "@/lib/muscle-group-utils";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { normalizeSearch } from "@/lib/validation";

const ALL = "todos";

type Props = {
  exercises: Exercise[];
  muscleGroups: MuscleGroup[];
  inSession: Set<string>;
  /** Agrega el ejercicio a la sesión. Puede lanzar un error si no se pudo. */
  onPick: (exercise: Exercise) => void | Promise<void>;
  /** Un ejercicio nuevo ya quedó en el catálogo personal. */
  onCreated: (exercise: Exercise) => void;
  onClose: () => void;
  /** Título de la lista (por defecto «Agregar ejercicio»; p. ej., «Reemplazar ejercicio»). */
  title?: string;
  /** Aclaración bajo el título (p. ej., qué se quitará al reemplazar). */
  notice?: string;
  /** Dónde se agrega lo creado: cambia el texto del botón de crear. */
  destination?: "sesión" | "rutina";
};

export function ExercisePicker({
  exercises,
  muscleGroups,
  inSession,
  onPick,
  onCreated,
  onClose,
  title,
  notice,
  destination = "sesión",
}: Props) {
  const [view, setView] = useState<"list" | "create">("list");
  // Filtro y búsqueda se conservan al volver del formulario de creación.
  const [group, setGroup] = useState<string>(ALL);
  const [query, setQuery] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const picking = useRef(false); // evita agregar dos veces por doble toque

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const active = useMemo(() => exercises.filter((e) => !e.archived_at), [exercises]);
  const hasUnclassified = active.some((e) => !e.muscle_group_id);
  const inGroup = useMemo(
    () =>
      active
        .filter((e) => group === ALL || (group === UNCLASSIFIED ? !e.muscle_group_id : e.muscle_group_id === group))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [active, group],
  );
  const q = normalizeSearch(query);
  const visible = q ? inGroup.filter((e) => normalizeSearch(e.name).includes(q)) : inGroup;
  const groupLabel =
    group === ALL ? null : group === UNCLASSIFIED ? UNCLASSIFIED_LABEL : muscleGroupName(muscleGroups, group);

  async function pick(exercise: Exercise) {
    if (picking.current || inSession.has(exercise.id)) return;
    picking.current = true;
    try {
      await onPick(exercise);
    } finally {
      picking.current = false;
    }
  }

  const chips = [
    { id: ALL, label: "Todos" },
    ...muscleGroups.map((g) => ({ id: g.id, label: g.name })),
    ...(hasUnclassified ? [{ id: UNCLASSIFIED, label: UNCLASSIFIED_LABEL }] : []),
  ];

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between picker-head">
          <h2 id="picker-title" ref={titleRef} tabIndex={-1}>
            {view === "list" ? (title ?? "Agregar ejercicio") : "Crear ejercicio"}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        {notice ? <p className="alert alert-warning" style={{ margin: 0, flex: "none" }}>{notice}</p> : null}

        {view === "list" ? (
          <>
            <div className="chips" role="group" aria-label="Filtrar por grupo muscular">
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip-filter"
                  aria-pressed={group === c.id}
                  onClick={() => setGroup(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <label className="field">
              <span className="sr-only">Buscar ejercicio</span>
              <input
                className="input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={groupLabel ? `Buscar ejercicio en ${groupLabel}` : "Buscar ejercicio"}
                aria-label="Buscar ejercicio"
                autoComplete="off"
                enterKeyHint="search"
              />
            </label>

            <div className="picker-list" role="list" aria-label={groupLabel ? `Ejercicios de ${groupLabel}` : "Tus ejercicios"}>
              {visible.map((e) => {
                const already = inSession.has(e.id);
                return (
                  <div key={e.id} role="listitem">
                    <button type="button" className="sheet-item" disabled={already} onClick={() => void pick(e)}>
                      <span>
                        <strong>{e.name}</strong>
                        {group === ALL ? (
                          <span className="muted small"> · {muscleGroupName(muscleGroups, e.muscle_group_id) ?? UNCLASSIFIED_LABEL}</span>
                        ) : null}
                      </span>
                      {already ? <span className="badge badge-primary">En la {destination}</span> : null}
                    </button>
                  </div>
                );
              })}

              {visible.length === 0 ? (
                <div className="empty picker-empty" role="status">
                  {inGroup.length === 0 ? (
                    <p>
                      {groupLabel
                        ? `Aún no tienes ejercicios de ${groupLabel}.`
                        : "Tu catálogo está vacío. Crea tu primer ejercicio."}
                    </p>
                  ) : (
                    <p>
                      Ningún ejercicio{groupLabel ? ` de ${groupLabel}` : ""} coincide con «{query.trim()}».
                    </p>
                  )}
                  <button type="button" className="btn" onClick={() => setView("create")}>
                    <IconPlus /> Crear ejercicio
                  </button>
                </div>
              ) : null}
            </div>

            <div className="picker-foot">
              <button type="button" className="btn btn-primary btn-block" onClick={() => setView("create")}>
                <IconPlus /> Crear ejercicio
              </button>
            </div>
          </>
        ) : (
          <CreateExerciseForm
            key="crear"
            muscleGroups={muscleGroups}
            catalog={active}
            initialName={query.trim()}
            initialGroup={group === ALL || group === UNCLASSIFIED ? "" : group}
            onCreated={onCreated}
            onPick={onPick}
            onCancel={() => setView("list")}
            destination={destination}
          />
        )}
      </div>
    </div>
  );
}

function CreateExerciseForm({
  muscleGroups,
  catalog,
  initialName,
  initialGroup,
  onCreated,
  onPick,
  onCancel,
  destination,
}: {
  destination: "sesión" | "rutina";
  muscleGroups: MuscleGroup[];
  catalog: Exercise[];
  initialName: string;
  initialGroup: string;
  onCreated: (exercise: Exercise) => void;
  onPick: (exercise: Exercise) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [groupId, setGroupId] = useState(initialGroup);
  const [errors, setErrors] = useState<ExerciseFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ejercicio ya creado cuya incorporación a la sesión falló: se reintenta sin volver a crearlo.
  const [created, setCreated] = useState<Exercise | null>(null);
  const [existing, setExisting] = useState<Exercise | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function addToSession(exercise: Exercise) {
    try {
      await onPick(exercise);
    } catch {
      setCreated(exercise);
      setError("El ejercicio quedó en tu catálogo, pero no se pudo agregar a la sesión.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (created) {
      setError(null);
      await addToSession(created);
      return;
    }
    const clean = name.trim();
    const next: ExerciseFieldErrors = {};
    if (!clean) next.name = NAME_REQUIRED;
    if (!groupId) next.muscle_group_id = GROUP_REQUIRED;
    const dup = clean ? catalog.find((ex) => normalizeSearch(ex.name) === normalizeSearch(clean)) : undefined;
    if (dup) next.name = `Ya tienes «${dup.name}» en tu catálogo.`;
    setErrors(next);
    setExisting(dup ?? null);
    setError(null);
    if (next.name || next.muscle_group_id) return;

    setBusy(true);
    try {
      const res = await quickCreateExercise({ name: clean, muscle_group_id: groupId });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        setError(res.error);
        return;
      }
      onCreated(res.data);
      await addToSession(res.data);
    } catch {
      setError("No se pudo crear el ejercicio. Revisa tu conexión y reintenta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="picker-form" onSubmit={submit} noValidate>
      <div className="picker-list">
        {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
        <div className="field">
          <label className="field">
            <span>Nombre del ejercicio</span>
            <input
              ref={nameRef}
              className="input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setExisting(null);
              }}
              maxLength={80}
              placeholder="Ej.: Press inclinado con mancuernas"
              autoComplete="off"
              disabled={Boolean(created)}
              aria-required="true"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "crear-nombre-error" : undefined}
            />
          </label>
          {errors.name ? (
            <span id="crear-nombre-error" className="field-error" role="alert">{errors.name}</span>
          ) : null}
          {existing ? (
            <button type="button" className="btn btn-sm" onClick={() => void addToSession(existing)}>
              Agregar «{existing.name}» a la sesión
            </button>
          ) : null}
        </div>
        <MuscleGroupSelect
          groups={muscleGroups}
          name="muscle_group_id"
          required
          value={groupId}
          onChange={setGroupId}
          error={errors.muscle_group_id}
        />
      </div>
      <div className="picker-foot">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
          {busy ? "Creando…" : created ? `Reintentar agregar a la ${destination}` : `Crear y agregar a la ${destination}`}
        </button>
      </div>
    </form>
  );
}
