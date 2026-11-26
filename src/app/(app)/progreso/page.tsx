import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";

export const metadata: Metadata = { title: "Progreso" };

export default async function ProgressIndexPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, notes, archived_at")
    .order("name");
  const exercises = (data ?? []) as Exercise[];
  const active = exercises.filter((e) => !e.archived_at);
  const archived = exercises.filter((e) => e.archived_at);

  return (
    <div className="stack-lg">
      <h1>Progreso</h1>
      <p className="muted">Elige un ejercicio para ver sus series por fecha y la evolución de tu peso máximo.</p>
      {exercises.length === 0 ? (
        <div className="card empty">Aún no tienes ejercicios. Crea uno al registrar tu entrenamiento.</div>
      ) : (
        <>
          <ul className="list">
            {active.map((e) => (
              <li key={e.id}>
                <Link href={`/progreso/${e.id}`} className="link-card">
                  <div className="card row between">
                    <div>
                      <strong>{e.name}</strong>
                      {e.muscle_group ? <div className="muted small">{e.muscle_group}</div> : null}
                    </div>
                    <span className="muted small">Ver ›</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {archived.length ? (
            <details className="disclosure">
              <summary>Archivados ({archived.length})</summary>
              <ul className="list">
                {archived.map((e) => (
                  <li key={e.id}>
                    <Link href={`/progreso/${e.id}`} className="link-card">
                      <div className="card row between"><strong>{e.name}</strong><span className="badge">Archivado</span></div>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
