"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { archiveExercise, createExercise, updateExercise } from "@/app/actions/exercises";
import { EquipmentSelect } from "@/components/EquipmentSelect";
import { MuscleGroupSelect } from "@/components/MuscleGroupSelect";
import {
  UNCLASSIFIED_LABEL,
  validateExerciseInput,
  type ExerciseFieldErrors,
} from "@/lib/muscle-group-utils";
import type { Exercise, MuscleGroup } from "@/lib/types";
import { useVisualViewport } from "@/lib/use-visual-viewport";

export type SheetMode = { type: "create"; initialGroup: string } | { type: "edit"; exercise: Exercise };

export type SavedExercise = {
  id: string;
  name: string;
  muscle_group_id: string;
  equipment: string | null;
  notes: string | null;
  archived_at: string | null;
  created: boolean;
};

type Props = {
  mode: SheetMode;
  groups: MuscleGroup[];
  onClose: () => void;
  onSaved: (saved: SavedExercise) => void;
  onArchiveChange: (exercise: Exercise, archived: boolean) => void;
};

/** Panel inferior (móvil) / modal centrado (escritorio) para crear o editar un ejercicio. */
export function ExerciseSheet({ mode, groups, onClose, onSaved, onArchiveChange }: Props) {
  const editing = mode.type === "edit" ? mode.exercise : null;
  const [name, setName] = useState(editing?.name ?? "");
  const [groupId, setGroupId] = useState(editing ? (editing.muscle_group_id ?? "") : mode.type === "create" ? mode.initialGroup : "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [equipment, setEquipment] = useState(editing?.equipment ?? "");
  const [errors, setErrors] = useState<ExerciseFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "archive" | null>(null);
  const sending = useRef(false); // evita envíos duplicados por doble toque
  const backdropRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameErrorId = useId();
  const titleId = useId();

  useVisualViewport(backdropRef);

  useEffect(() => {
    nameRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sending.current) onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    const check = validateExerciseInput({ name, muscle_group_id: groupId, equipment }, groups.map((g) => g.id));
    if (!check.ok) {
      setErrors(check.errors);
      setError(null);
      return;
    }
    sending.current = true;
    setBusy("save");
    setErrors({});
    setError(null);
    const fd = new FormData();
    if (editing) fd.set("id", editing.id);
    fd.set("name", check.value.name);
    fd.set("muscle_group_id", check.value.muscle_group_id);
    fd.set("equipment", check.value.equipment ?? "");
    fd.set("notes", notes);
    try {
      const res = editing ? await updateExercise({}, fd) : await createExercise({}, fd);
      if (res.error || !res.exerciseId) {
        // Los campos se conservan: el usuario corrige o reintenta.
        setErrors(res.fieldErrors ?? {});
        setError(res.error ?? "No se pudo guardar. Reintenta.");
        return;
      }
      onSaved({
        id: res.exerciseId,
        name: check.value.name,
        muscle_group_id: check.value.muscle_group_id,
        equipment: check.value.equipment,
        notes: notes.trim() || null,
        archived_at: editing?.archived_at ?? null,
        created: !editing,
      });
    } catch {
      setError("Sin conexión con el servidor. Tus datos siguen aquí; pulsa de nuevo para reintentar.");
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  async function toggleArchive() {
    if (!editing || sending.current) return;
    const archive = !editing.archived_at;
    sending.current = true;
    setBusy("archive");
    setError(null);
    try {
      const res = await archiveExercise(editing.id, archive);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onArchiveChange(editing, archive);
    } catch {
      setError("Sin conexión con el servidor. Reintenta.");
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  const unclassified = editing && !editing.muscle_group_id;

  return (
    <div ref={backdropRef} className="sheet-backdrop" onClick={() => !sending.current && onClose()}>
      <form
        className="sheet form-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        noValidate
      >
        <div className="row between sheet-head">
          <h2 id={titleId}>{editing ? "Editar ejercicio" : "Nuevo ejercicio"}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={Boolean(busy)}>
            Cerrar
          </button>
        </div>

        <div className="sheet-body">
          {error ? <p className="alert alert-error" role="alert">{error}</p> : null}
          {unclassified ? (
            <p className="alert alert-warning">
              Este ejercicio no tiene grupo muscular. Clasifícalo antes de guardar; su historial se conserva.
            </p>
          ) : null}

          <div className="field">
            <label className="field">
              <span>Nombre del ejercicio</span>
              <input
                ref={nameRef}
                className="input"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Ej.: Press de banca"
                autoComplete="off"
                enterKeyHint="next"
                aria-required="true"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? nameErrorId : undefined}
              />
            </label>
            {errors.name ? (
              <span id={nameErrorId} className="field-error" role="alert">{errors.name}</span>
            ) : null}
          </div>

          <MuscleGroupSelect
            groups={groups}
            required
            value={groupId}
            onChange={setGroupId}
            emptyLabel={unclassified ? `${UNCLASSIFIED_LABEL} — selecciona un grupo` : "Selecciona un grupo"}
            error={errors.muscle_group_id}
          />

          <EquipmentSelect value={equipment} onChange={setEquipment} error={errors.equipment} />

          <label className="field">
            <span>Notas (opcional)</span>
            <textarea
              className="input"
              name="notes"
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Agarre, ajustes de la máquina…"
              rows={3}
            />
          </label>

          {editing ? (
            <div className="sheet-secondary">
              <Link href={`/progreso/${editing.id}`} className="btn btn-sm">Ver progreso</Link>
              <button
                type="button"
                className={editing.archived_at ? "btn btn-sm" : "btn btn-sm btn-danger"}
                onClick={toggleArchive}
                disabled={Boolean(busy)}
              >
                {busy === "archive"
                  ? "Guardando…"
                  : editing.archived_at
                    ? "Restaurar ejercicio"
                    : "Archivar ejercicio"}
              </button>
              <p className="hint">
                {editing.archived_at
                  ? "Volverá a aparecer al registrar entrenamientos."
                  : "Archivar lo oculta al registrar entrenamientos; su historial se conserva."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={Boolean(busy)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={Boolean(busy)} aria-busy={busy === "save"}>
            {busy === "save" ? "Guardando…" : editing ? "Guardar cambios" : "Crear ejercicio"}
          </button>
        </div>
      </form>
    </div>
  );
}
