import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { ExerciseForm } from "./ExerciseForm";

export const metadata: Metadata = { title: "Ejercicios" };

/** Quita caracteres con significado especial en filtros de PostgREST / LIKE. */
function sanitizeSearch(value: string) {
  return value.replace(/[\\%_*,()"'.:]/g, " ").replace(/\s+/g, " ").trim();
}

export default async function ExercisesPage({ searchParams }: PageProps<"/ejercicios">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const term = sanitizeSearch(q);
  const showArchived = params.archivados === "1";

  const supabase = await createClient();
  let query = supabase.from("exercises").select("id, name, muscle_group, notes, archived_at").order("name");
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (term) {
    query = query.or(`name.ilike."%${term}%",muscle_group.ilike."%${term}%"`);
  }
  const { data, error } = await query;
  const exercises = (data ?? []) as Exercise[];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Ejercicios</h1>
      </div>

      <form className="row" role="search" action="/ejercicios">
        {showArchived ? <input type="hidden" name="archivados" value="1" /> : null}
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          <span className="sr-only">Buscar ejercicio</span>
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Buscar por nombre o grupo" />
        </label>
        <button className="btn" type="submit">Buscar</button>
      </form>

      <div className="row small">
        <Link href="/ejercicios" className={`badge ${!showArchived ? "badge-primary" : ""}`}>Activos</Link>
        <Link href="/ejercicios?archivados=1" className={`badge ${showArchived ? "badge-primary" : ""}`}>Archivados</Link>
      </div>

      {error ? <p className="alert alert-error">No se pudo cargar tu catálogo.</p> : null}

      {exercises.length === 0 ? (
        <div className="card empty">
          {q ? `No hay ejercicios que coincidan con «${q}».` : showArchived ? "No tienes ejercicios archivados." : "Tu catálogo está vacío."}
        </div>
      ) : (
        <ul className="list">
          {exercises.map((e) => (
            <li key={e.id}>
              <Link href={`/ejercicios/${e.id}`} className="link-card">
                <div className="card row between">
                  <div>
                    <strong>{e.name}</strong>
                    {e.muscle_group ? <div className="muted small">{e.muscle_group}</div> : null}
                  </div>
                  {e.archived_at ? <span className="badge">Archivado</span> : <span className="muted small">Editar ›</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!showArchived ? (
        <section className="card stack">
          <h2>Nuevo ejercicio</h2>
          <ExerciseForm />
        </section>
      ) : null}
    </div>
  );
}
