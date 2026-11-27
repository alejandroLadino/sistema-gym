import { requireUser } from "@/lib/auth";
import type { ConsistencyRow } from "@/lib/consistency";
import type { HomeSession } from "@/lib/home";
import { getMuscleGroups } from "@/lib/muscle-groups";
import { addDays } from "@/lib/progress";
import type { Routine } from "@/lib/routines";
import { createClient } from "@/lib/supabase/server";
import { HomeDashboard } from "./HomeDashboard";

/**
 * Inicio: arrancar, retomar o revisar el entrenamiento de hoy, la constancia, las
 * rutinas y las sesiones recientes. Qué es «hoy» (y la semana) lo decide el
 * dispositivo con la fecha local; el servidor trae un margen suficiente.
 */
export default async function HomePage() {
  const user = await requireUser();
  const supabase = await createClient();
  // Fecha del servidor (UTC) solo como respaldo; el margen cubre la semana local y los husos horarios.
  const serverToday = new Date().toISOString().slice(0, 10);
  const [{ data, error }, { data: consistency, error: consistencyError }, { data: routines }, groups] = await Promise.all([
    supabase.rpc("get_home_sessions", { p_from: addDays(serverToday, -8), p_recent: 3 }),
    supabase.rpc("get_training_consistency", { p_since: addDays(serverToday, -8) }),
    supabase.rpc("get_routines", { p_id: null }),
    getMuscleGroups(),
  ]);
  const firstName = (user.profile.full_name || "").split(" ")[0];

  return (
    <>
      {error || consistencyError ? <p className="alert alert-error">No se pudieron cargar tus sesiones. Recarga la página.</p> : null}
      <HomeDashboard
        userId={user.id}
        firstName={firstName}
        serverToday={serverToday}
        sessions={(data ?? []) as HomeSession[]}
        consistency={((consistency ?? []) as ConsistencyRow[])[0] ?? null}
        routines={(routines ?? []) as Routine[]}
        muscleGroups={groups}
      />
    </>
  );
}
