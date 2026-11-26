import { requireUser } from "@/lib/auth";
import type { HomeSession } from "@/lib/home";
import { addDays } from "@/lib/progress";
import { createClient } from "@/lib/supabase/server";
import { HomeDashboard } from "./HomeDashboard";

/**
 * Inicio: arrancar, retomar o revisar el entrenamiento de hoy. Una sola consulta
 * trae la semana, las sesiones en curso y las últimas finalizadas; qué es «hoy» lo
 * decide el dispositivo (fecha local del usuario).
 */
export default async function HomePage() {
  const user = await requireUser();
  const supabase = await createClient();
  // Fecha del servidor (UTC) solo como respaldo; el margen cubre la semana local y los husos horarios.
  const serverToday = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("get_home_sessions", { p_from: addDays(serverToday, -8), p_recent: 3 });
  const firstName = (user.profile.full_name || "").split(" ")[0];

  return (
    <>
      {error ? <p className="alert alert-error">No se pudieron cargar tus sesiones. Recarga la página.</p> : null}
      <HomeDashboard
        userId={user.id}
        firstName={firstName}
        serverToday={serverToday}
        sessions={(data ?? []) as HomeSession[]}
      />
    </>
  );
}
