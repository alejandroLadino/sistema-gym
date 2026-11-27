import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import type { HomeSession } from "@/lib/home";
import { addDays } from "@/lib/progress";
import type { Routine } from "@/lib/routines";
import { createClient } from "@/lib/supabase/server";
import { RoutineList } from "./RoutineList";

export const metadata: Metadata = { title: "Mis rutinas" };

/** «Mis rutinas»: plantillas personales. Las sesiones en curso permiten ofrecer «Continuar sesión». */
export default async function RoutinesPage({ searchParams }: PageProps<"/rutinas">) {
  await requireUser();
  const sp = await searchParams;
  const supabase = await createClient();
  const serverToday = new Date().toISOString().slice(0, 10);
  const [{ data: routines, error }, { data: sessions }] = await Promise.all([
    supabase.rpc("get_routines", { p_id: null }),
    // Margen de un día: «hoy» se decide en el dispositivo (fecha local).
    supabase.rpc("get_home_sessions", { p_from: addDays(serverToday, -1), p_recent: 0 }),
  ]);
  const saved = typeof sp.guardada === "string" ? sp.guardada.slice(0, 80) : "";
  const notice = saved ? `Rutina «${saved}» guardada.` : sp.eliminada ? "Rutina eliminada. Tus sesiones registradas se conservan." : undefined;

  return (
    <>
      {error ? <p className="alert alert-error">No se pudieron cargar tus rutinas. Recarga la página.</p> : null}
      <RoutineList
        routines={(routines ?? []) as Routine[]}
        sessions={(sessions ?? []) as HomeSession[]}
        serverToday={serverToday}
        notice={notice}
      />
    </>
  );
}
