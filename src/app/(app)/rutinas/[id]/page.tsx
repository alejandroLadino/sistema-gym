import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { planToDraft, type Routine } from "@/lib/routines";
import { newKey } from "@/lib/session-draft";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { isUuid } from "@/lib/validation";
import { RoutineEditor } from "../RoutineEditor";

export const metadata: Metadata = { title: "Editar rutina" };

export default async function EditRoutinePage({ params }: PageProps<"/rutinas/[id]">) {
  const { id } = await params;
  await requireUser();
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const [{ data: routines }, { data: exercises }, groups] = await Promise.all([
    // RLS: una rutina ajena no aparece → 404.
    supabase.rpc("get_routines", { p_id: id }),
    supabase.from("exercises").select(EXERCISE_COLUMNS).is("archived_at", null).order("name"),
    getMuscleGroups(),
  ]);
  const routine = ((routines ?? []) as Routine[])[0];
  if (!routine) notFound();
  const show = (n: number | null) => (n === null ? "" : String(n));

  return (
    <RoutineEditor
      routineId={routine.id}
      initialName={routine.name}
      initialExercises={routine.exercises.map((e) => ({
        exerciseId: e.exercise_id,
        name: e.name,
        archived: e.archived,
        muscleGroupId: e.muscle_group_id,
        sets: show(e.target_sets),
        repsMin: show(e.target_reps_min),
        // Una cantidad exacta (mín = máx) se muestra solo en «mín».
        repsMax: e.target_reps_max !== null && e.target_reps_max !== e.target_reps_min ? show(e.target_reps_max) : "",
        plan: e.target_blocks ? planToDraft(e.target_blocks, newKey) : null,
        alt: e.alt_group != null && (e.alt_slot === 0 || e.alt_slot === 1) ? { group: e.alt_group, slot: e.alt_slot } : null,
      }))}
      exercises={(exercises ?? []) as Exercise[]}
      muscleGroups={groups}
    />
  );
}
