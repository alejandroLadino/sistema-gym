import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { setExerciseArchived } from "@/app/actions/exercises";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/auth";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { muscleGroupName, UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { isUuid } from "@/lib/validation";
import { ExerciseForm } from "../ExerciseForm";

export const metadata: Metadata = { title: "Editar ejercicio" };

export default async function ExercisePage({ params, searchParams }: PageProps<"/ejercicios/[id]">) {
  const { id } = await params;
  const { error } = await searchParams;
  await requireUser();
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const [{ data }, groups] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_COLUMNS).eq("id", id).maybeSingle<Exercise>(),
    getMuscleGroups(),
  ]);
  if (!data) notFound();
  const archived = Boolean(data.archived_at);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{data.name}</h1>
          {data.muscle_group_id ? (
            <div className="muted">{muscleGroupName(groups, data.muscle_group_id)}</div>
          ) : (
            <span className="badge badge-warning">{UNCLASSIFIED_LABEL}</span>
          )}
        </div>
        {archived ? <span className="badge">Archivado</span> : null}
      </div>
      {!data.muscle_group_id ? (
        <p className="alert alert-warning">
          Este ejercicio no tiene grupo muscular. Selecciona uno y guarda para clasificarlo; su historial se conserva.
        </p>
      ) : null}
      <Link href={`/progreso/${data.id}`} className="btn btn-block">Ver progreso e historial</Link>

      <section className="card stack">
        <h2>Datos del ejercicio</h2>
        <ExerciseForm key={data.id + (data.archived_at ?? "")} exercise={data} groups={groups} />
      </section>

      <section className="card stack">
        <h2>{archived ? "Reactivar" : "Archivar"}</h2>
        <p className="muted small">
          {archived
            ? "Volverá a aparecer en tu catálogo y al registrar entrenamientos."
            : "Deja de aparecer al registrar entrenamientos. Su historial y progreso se conservan."}
        </p>
        {error === "duplicado" ? (
          <p className="alert alert-error">Ya tienes un ejercicio activo con este nombre. Renombra uno de los dos.</p>
        ) : null}
        <form action={setExerciseArchived}>
          <input type="hidden" name="id" value={data.id} />
          <input type="hidden" name="archive" value={archived ? "false" : "true"} />
          <SubmitButton className={archived ? "btn btn-primary" : "btn btn-danger"} pendingText="Guardando…">
            {archived ? "Reactivar ejercicio" : "Archivar ejercicio"}
          </SubmitButton>
        </form>
      </section>

      <Link href="/ejercicios">‹ Volver al catálogo</Link>
    </div>
  );
}
