"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { quickCreateExercise } from "@/app/actions/exercises";
import { MuscleGroupSelect } from "@/components/MuscleGroupSelect";
import { muscleGroupName } from "@/lib/muscle-group-utils";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { normalizeSearch } from "@/lib/validation";
import { IconPlus } from "@/components/icons";

type Props = {
  exercises: Exercise[];
  muscleGroups: MuscleGroup[];
  inSession: Set<string>;
  onPick: (exercise: Exercise) => void;
  onCreated: (exercise: Exercise) => void;
  onClose: () => void;
};

export function ExercisePicker({ exercises, muscleGroups, inSession, onPick, onCreated, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const q = normalizeSearch(query);
  const filtered = useMemo(
    () =>
      exercises
        .filter((e) => !e.archived_at)
        .filter((e) => !q || normalizeSearch(`${e.name} ${muscleGroupName(muscleGroups, e.muscle_group_id) ?? ""}`).includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    [exercises, muscleGroups, q],
  );
  const exact = exercises.some((e) => !e.archived_at && normalizeSearch(e.name) === q);

  async function create() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await quickCreateExercise({ name, muscle_group_id: muscle || null });
      if (res.ok) onCreated(res.data);
      else setError(res.error);
    } catch {
      setError("No se pudo crear. Revisa tu conexión.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2 id="picker-title" style={{ margin: 0 }}>Agregar ejercicio</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cerrar</button>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>Buscar o escribir un ejercicio nuevo</span>
          <input
            ref={inputRef}
            className="input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (filtered.length === 1) onPick(filtered[0]);
                else if (!exact && query.trim()) void create();
              }
            }}
            placeholder="Ej.: Press de banca"
            autoComplete="off"
            enterKeyHint="search"
          />
        </label>

        {query.trim() && !exact ? (
          <div className="card stack" style={{ marginTop: 12, padding: 12 }}>
            <MuscleGroupSelect groups={muscleGroups} value={muscle} onChange={setMuscle} label="Grupo muscular (opcional)" />
            <button type="button" className="btn btn-primary" onClick={create} disabled={creating}>
              <IconPlus /> {creating ? "Creando…" : `Crear «${query.trim()}»`}
            </button>
            {error ? <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{error}</p> : null}
          </div>
        ) : null}

        <div className="sheet-list" role="list" aria-label="Tu catálogo">
          {filtered.map((e) => (
            <button key={e.id} type="button" role="listitem" className="sheet-item" onClick={() => onPick(e)}>
              <span>
                <strong>{e.name}</strong>
                {e.muscle_group_id ? <span className="muted small"> · {muscleGroupName(muscleGroups, e.muscle_group_id)}</span> : null}
              </span>
              {inSession.has(e.id) ? <span className="badge badge-primary">En la sesión</span> : null}
            </button>
          ))}
          {filtered.length === 0 && !query.trim() ? (
            <p className="empty">Tu catálogo está vacío. Escribe un nombre para crear tu primer ejercicio.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
