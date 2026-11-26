"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { createExercise, updateExercise, type ExerciseFormState } from "@/app/actions/exercises";
import { FormMessage } from "@/components/FormMessage";
import { MuscleGroupSelect } from "@/components/MuscleGroupSelect";
import { SubmitButton } from "@/components/SubmitButton";
import { UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import type { Exercise, MuscleGroup } from "@/lib/types";

export function ExerciseForm({ exercise, groups }: { exercise?: Exercise; groups: MuscleGroup[] }) {
  const [state, action] = useActionState<ExerciseFormState, FormData>(exercise ? updateExercise : createExercise, {});
  const formRef = useRef<HTMLFormElement>(null);
  const nameErrorId = useId();

  useEffect(() => {
    if (state.message && !exercise) formRef.current?.reset();
  }, [state, exercise]);

  // Tras un rechazo, el formulario conserva lo escrito (React lo reinicia tras cada envío).
  const values = state.values;
  const unclassified = exercise && !exercise.muscle_group_id;

  return (
    // noValidate: la validación la hace el servidor y muestra el mensaje junto a cada campo.
    <form ref={formRef} action={action} className="form-grid" noValidate>
      {exercise ? <input type="hidden" name="id" value={exercise.id} /> : null}
      <FormMessage error={state.error} message={state.message} />
      <div className="form-grid cols-2">
        <div className="field">
          <label className="field">
            <span>Nombre</span>
            <input
              className="input"
              name="name"
              required
              maxLength={80}
              defaultValue={values?.name ?? exercise?.name}
              placeholder="Ej.: Press de banca"
              aria-invalid={state.fieldErrors?.name ? true : undefined}
              aria-describedby={state.fieldErrors?.name ? nameErrorId : undefined}
            />
          </label>
          {state.fieldErrors?.name ? (
            <span id={nameErrorId} className="field-error" role="alert">{state.fieldErrors.name}</span>
          ) : null}
        </div>
        <MuscleGroupSelect
          key={values?.muscle_group_id ?? "inicial"}
          groups={groups}
          required
          emptyLabel={unclassified ? `${UNCLASSIFIED_LABEL} — selecciona un grupo` : "Selecciona un grupo"}
          defaultValue={values?.muscle_group_id ?? exercise?.muscle_group_id}
          error={state.fieldErrors?.muscle_group_id}
        />
      </div>
      <label className="field">
        <span>Notas (opcional)</span>
        <textarea
          className="input"
          name="notes"
          maxLength={1000}
          defaultValue={values?.notes ?? exercise?.notes ?? ""}
          placeholder="Agarre, ajustes de la máquina…"
        />
      </label>
      <SubmitButton>{exercise ? "Guardar cambios" : "Crear ejercicio"}</SubmitButton>
    </form>
  );
}
