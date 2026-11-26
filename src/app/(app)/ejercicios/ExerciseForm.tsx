"use client";

import { useActionState, useEffect, useRef } from "react";
import { createExercise, updateExercise, type ExerciseFormState } from "@/app/actions/exercises";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { MuscleGroupSelect } from "@/components/MuscleGroupSelect";
import type { Exercise, MuscleGroup } from "@/lib/types";

export function ExerciseForm({ exercise, groups }: { exercise?: Exercise; groups: MuscleGroup[] }) {
  const [state, action] = useActionState<ExerciseFormState, FormData>(exercise ? updateExercise : createExercise, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.message && !exercise) formRef.current?.reset();
  }, [state, exercise]);

  return (
    <form ref={formRef} action={action} className="form-grid">
      {exercise ? <input type="hidden" name="id" value={exercise.id} /> : null}
      <FormMessage error={state.error} message={state.message} />
      <div className="form-grid cols-2">
        <label className="field">
          <span>Nombre</span>
          <input className="input" name="name" required maxLength={80} defaultValue={exercise?.name} placeholder="Ej.: Press de banca" />
        </label>
        <MuscleGroupSelect groups={groups} defaultValue={exercise?.muscle_group_id} />
      </div>
      <label className="field">
        <span>Notas (opcional)</span>
        <textarea className="input" name="notes" maxLength={1000} defaultValue={exercise?.notes ?? ""} placeholder="Agarre, ajustes de la máquina…" />
      </label>
      <SubmitButton>{exercise ? "Guardar cambios" : "Crear ejercicio"}</SubmitButton>
    </form>
  );
}
