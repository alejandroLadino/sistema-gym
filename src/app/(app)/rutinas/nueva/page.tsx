import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { createClient } from "@/lib/supabase/server";
import type { Exercise, SessionData } from "@/lib/types";
import { isUuid } from "@/lib/validation";
import { RoutineEditor } from "../RoutineEditor";

export const metadata: Metadata = { title: "Nueva rutina" };

/**
 * Nueva rutina. Con ?desde=<sesión> («Guardar como rutina») precarga los ejercicios
 * de esa sesión en su orden, sin metas; los archivados no se precargan (se avisa).
 */
export default async function NewRoutinePage({ searchParams }: PageProps<"/rutinas/nueva">) {
  await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const fromId = typeof sp.desde === "string" && isUuid(sp.desde) ? sp.desde : null;
  const [{ data: exercises }, groups, source] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_COLUMNS).is("archived_at", null).order("name"),
    getMuscleGroups(),
    fromId ? supabase.rpc("get_workout_session", { p_session_id: fromId }) : Promise.resolve({ data: null }),
  ]);
  const catalog = (exercises ?? []) as Exercise[];
  const session = source.data as SessionData | null;

  const byId = new Map(catalog.map((e) => [e.id, e]));
  const initial = (session?.exercises ?? [])
    .filter((e) => !e.archived && byId.has(e.exercise_id))
    .map((e) => ({
      exerciseId: e.exercise_id,
      name: e.name,
      archived: false,
      muscleGroupId: byId.get(e.exercise_id)?.muscle_group_id ?? null,
      sets: "",
      repsMin: "",
      repsMax: "",
    }));
  const skipped = (session?.exercises ?? []).filter((e) => e.archived).map((e) => e.name);
  let notice: string | undefined;
  if (session) {
    notice = `Ejercicios de la sesión del ${formatDate(session.session_date, { weekday: false })}, en su orden. Ponle un nombre y, si quieres, define metas.`;
    if (skipped.length) notice += ` No se incluyó por estar archivado: ${skipped.join(", ")}.`;
  }

  return (
    <RoutineEditor
      routineId={null}
      initialName=""
      initialExercises={initial}
      exercises={catalog}
      muscleGroups={groups}
      notice={notice}
    />
  );
}
