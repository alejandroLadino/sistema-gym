import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { IconPlus } from "@/components/icons";
import { SessionListItem, type SessionRow } from "@/components/SessionListItem";

export default async function HomePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_workout_sessions", { p_from: null, p_to: null, p_limit: 5 });
  const sessions = (data ?? []) as SessionRow[];
  const firstName = (user.profile.full_name || "").split(" ")[0];

  return (
    <div className="stack-lg">
      <section className="stack">
        <h1>{firstName ? `Hola, ${firstName}` : "Hola"}</h1>
        <Link href="/entrenar" className="btn btn-primary btn-lg btn-block">
          <IconPlus /> Registrar entrenamiento
        </Link>
        {sessions[0] ? (
          <p className="muted small">Último entrenamiento: {formatDate(sessions[0].session_date)}</p>
        ) : null}
      </section>

      <section className="stack">
        <div className="row between">
          <h2>Sesiones recientes</h2>
          {sessions.length ? <Link href="/historial" className="small">Ver historial</Link> : null}
        </div>
        {sessions.length === 0 ? (
          <div className="card empty">
            <p>Aún no registras entrenamientos.</p>
            <p className="small">Pulsa «Registrar entrenamiento» para empezar.</p>
          </div>
        ) : (
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id}><SessionListItem session={s} /></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
