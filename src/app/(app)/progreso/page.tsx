import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { overviewSummary, type OverviewRow } from "@/lib/progress";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { ProgressList, type ProgressItem } from "./ProgressList";

export const metadata: Metadata = { title: "Progreso" };

/** Lista de progreso: un resumen por ejercicio calculado en una sola consulta agrupada. */
export default async function ProgressIndexPage({ searchParams }: PageProps<"/progreso">) {
  await requireUser();
  const supabase = await createClient();
  const [{ data: exercises }, { data: overview, error }, groups, params] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_COLUMNS).order("name"),
    supabase.rpc("get_progress_overview"),
    getMuscleGroups(),
    searchParams,
  ]);

  const summaries = new Map(((overview ?? []) as OverviewRow[]).map((r) => [r.exercise_id, overviewSummary(r)]));
  const items: ProgressItem[] = ((exercises ?? []) as Exercise[]).map((e) => ({
    id: e.id,
    name: e.name,
    groupId: e.muscle_group_id,
    archived: Boolean(e.archived_at),
    summary: summaries.get(e.id) ?? null,
  }));

  const q = typeof params.q === "string" ? params.q.slice(0, 80) : "";
  const g = typeof params.grupo === "string" && groups.some((x) => x.id === params.grupo) ? params.grupo : "todos";

  return (
    <>
      {error ? <p className="alert alert-error">No se pudo calcular tu progreso. Recarga la página.</p> : null}
      <ProgressList items={items} groups={groups} initialQuery={q} initialGroup={g} />
    </>
  );
}
