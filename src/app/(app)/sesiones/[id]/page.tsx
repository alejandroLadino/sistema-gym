import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SessionEditor } from "@/components/session/SessionEditor";
import { requireUser } from "@/lib/auth";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { formatDate, isIsoDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Exercise, SessionData } from "@/lib/types";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Sesión" };

/**
 * Aviso tras «Repetir ejercicios» (?repetida=AAAA-MM-DD) o «Usar rutina» (?rutina=Nombre),
 * con los ejercicios omitidos por archivados (&omitidos=["…"]).
 */
function repeatNotice(sp: Record<string, string | string[] | undefined>): string | undefined {
  const from = typeof sp.repetida === "string" && isIsoDate(sp.repetida) ? sp.repetida : null;
  const routine = typeof sp.rutina === "string" && sp.rutina.trim() ? sp.rutina.trim().slice(0, 80) : null;
  if (!from && !routine) return undefined;
  let omitted: string[] = [];
  try {
    const parsed = typeof sp.omitidos === "string" ? JSON.parse(sp.omitidos) : [];
    if (Array.isArray(parsed)) omitted = parsed.filter((x): x is string => typeof x === "string").slice(0, 20);
  } catch {}
  const base = routine
    ? `Sesión nueva con la rutina «${routine}». Registra tus series; las metas y la última vez son solo referencia.`
    : `Sesión nueva con los ejercicios del ${formatDate(from!, { weekday: false })}. Registra tus series; las anteriores se muestran como referencia.`;
  return omitted.length
    ? `${base} Se ${omitted.length === 1 ? "omitió" : "omitieron"} por estar ${omitted.length === 1 ? "archivado" : "archivados"}: ${omitted.join(", ")}.`
    : base;
}

export default async function SessionPage({ params, searchParams }: PageProps<"/sesiones/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  // RLS: si la sesión es de otra persona, la función devuelve null → 404.
  const [{ data: session }, { data: exercises }, groups] = await Promise.all([
    supabase.rpc("get_workout_session", { p_session_id: id }),
    supabase.from("exercises").select(EXERCISE_COLUMNS).is("archived_at", null).order("name"),
    getMuscleGroups(),
  ]);
  if (!session) notFound();

  return (
    <SessionEditor
      key={id}
      userId={user.id}
      initial={session as SessionData}
      exercises={(exercises ?? []) as Exercise[]}
      muscleGroups={groups}
      initialNotice={repeatNotice(sp)}
    />
  );
}
