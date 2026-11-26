import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { filtersFromParams } from "@/lib/exercise-catalog";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { ExerciseCatalog } from "./ExerciseCatalog";

export const metadata: Metadata = { title: "Ejercicios" };

/**
 * Catálogo personal. Se carga completo (activos y archivados) y la búsqueda y los
 * filtros se aplican en el dispositivo al escribir, sin esperar al servidor.
 */
export default async function ExercisesPage({ searchParams }: PageProps<"/ejercicios">) {
  await requireUser();
  const supabase = await createClient();
  const [{ data, error }, groups, params] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_COLUMNS).order("name"),
    getMuscleGroups(),
    searchParams,
  ]);

  return (
    <>
      {error ? <p className="alert alert-error">No se pudo cargar tu catálogo. Recarga la página.</p> : null}
      <ExerciseCatalog
        exercises={(data ?? []) as Exercise[]}
        groups={groups}
        initialFilters={filtersFromParams(params, groups)}
      />
    </>
  );
}
