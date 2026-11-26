import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { muscleGroupName } from "@/lib/muscle-group-utils";
import type { ProgressRow } from "@/lib/progress";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { isUuid } from "@/lib/validation";
import { ExerciseProgress } from "./ExerciseProgress";

export const metadata: Metadata = { title: "Progreso" };

/**
 * Detalle de progreso. Se carga todo el historial del ejercicio: la clasificación
 * peso / peso corporal no depende del rango, y los rangos se aplican al instante.
 */
export default async function ExerciseProgressPage({ params, searchParams }: PageProps<"/progreso/[id]">) {
  const { id } = await params;
  await requireUser();
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data: exercise }, groups, { data: rows, error }, sp] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_COLUMNS).eq("id", id).maybeSingle<Exercise>(),
    getMuscleGroups(),
    supabase.rpc("get_exercise_progress", { p_exercise_id: id, p_from: null, p_to: null }),
    searchParams,
  ]);
  if (!exercise) notFound();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  return (
    <>
      {error ? <p className="alert alert-error">No se pudo cargar el historial. Recarga la página.</p> : null}
      <ExerciseProgress
        exercise={{
          id: exercise.id,
          name: exercise.name,
          groupName: muscleGroupName(groups, exercise.muscle_group_id),
          archived: Boolean(exercise.archived_at),
        }}
        rows={(rows ?? []) as ProgressRow[]}
        initial={{ range: str("rango"), from: str("desde"), to: str("hasta"), metric: str("metrica") }}
      />
    </>
  );
}
