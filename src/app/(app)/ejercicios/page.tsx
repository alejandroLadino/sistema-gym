import type { Metadata } from "next";
import Link from "next/link";
import { MuscleGroupSelect } from "@/components/MuscleGroupSelect";
import { requireUser } from "@/lib/auth";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { muscleGroupName, parseMuscleGroupId, UNCLASSIFIED, UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { normalizeSearch } from "@/lib/validation";
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
  const groups = await getMuscleGroups();
  const parsedGroup = parseMuscleGroupId(params.grupo);
  const groupFilter =
    parsedGroup.ok && (parsedGroup.value === UNCLASSIFIED || groups.some((g) => g.id === parsedGroup.value))
      ? parsedGroup.value
      : null;

  const supabase = await createClient();
  let query = supabase.from("exercises").select(EXERCISE_COLUMNS).order("name");
  query = showArchived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (groupFilter === UNCLASSIFIED) query = query.is("muscle_group_id", null);
  else if (groupFilter) query = query.eq("muscle_group_id", groupFilter);
  if (term) {
    // El texto busca en el nombre y también en el nombre del grupo («pecho» → Pecho).
    const needle = normalizeSearch(term);
    const matchingGroups = groups.filter((g) => normalizeSearch(g.name).includes(needle)).map((g) => g.id);
    query = matchingGroups.length
      ? query.or(`name.ilike."%${term}%",muscle_group_id.in.(${matchingGroups.join(",")})`)
      : query.ilike("name", `%${term}%`);
  }
  const [{ data, error }, { count: unclassifiedCount }] = await Promise.all([
    query,
    // Ejercicios antiguos sin grupo: se avisa para clasificarlos.
    supabase.from("exercises").select("id", { count: "exact", head: true }).is("muscle_group_id", null),
  ]);
  const exercises = (data ?? []) as Exercise[];
  const filtered = Boolean(q || groupFilter);

  const tabHref = (archived: boolean) => {
    const sp = new URLSearchParams();
    if (archived) sp.set("archivados", "1");
    if (groupFilter) sp.set("grupo", groupFilter);
    const s = sp.toString();
    return s ? `/ejercicios?${s}` : "/ejercicios";
  };

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Ejercicios</h1>
      </div>

      <form className="card form-grid" role="search" action="/ejercicios" aria-label="Buscar ejercicios">
        {showArchived ? <input type="hidden" name="archivados" value="1" /> : null}
        <label className="field">
          <span>Buscar</span>
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Nombre o grupo muscular" />
        </label>
        <MuscleGroupSelect
          groups={groups}
          name="grupo"
          label="Grupo muscular"
          emptyLabel="Todos los grupos"
          defaultValue={groupFilter}
          extraOptions={unclassifiedCount ? [{ value: UNCLASSIFIED, label: UNCLASSIFIED_LABEL }] : undefined}
        />
        <div className="row">
          <button className="btn btn-primary" type="submit">Buscar</button>
          {filtered ? (
            <Link className="btn btn-ghost" href={showArchived ? "/ejercicios?archivados=1" : "/ejercicios"}>
              Quitar filtros
            </Link>
          ) : null}
        </div>
      </form>

      <div className="row small">
        <Link href={tabHref(false)} className={`badge ${!showArchived ? "badge-primary" : ""}`}>Activos</Link>
        <Link href={tabHref(true)} className={`badge ${showArchived ? "badge-primary" : ""}`}>Archivados</Link>
      </div>

      {error ? <p className="alert alert-error">No se pudo cargar tu catálogo.</p> : null}
      {unclassifiedCount && groupFilter !== UNCLASSIFIED ? (
        <p className="alert alert-warning">
          Tienes {unclassifiedCount} {unclassifiedCount === 1 ? "ejercicio" : "ejercicios"} sin grupo muscular.{" "}
          <Link href={`/ejercicios?grupo=${UNCLASSIFIED}${showArchived ? "&archivados=1" : ""}`}>Ver y clasificar</Link>
        </p>
      ) : null}

      {exercises.length === 0 ? (
        <div className="card empty">
          {filtered
            ? "No hay ejercicios que coincidan con la búsqueda."
            : showArchived
              ? "No tienes ejercicios archivados."
              : "Tu catálogo está vacío."}
        </div>
      ) : (
        <ul className="list">
          {exercises.map((e) => (
            <li key={e.id}>
              <Link href={`/ejercicios/${e.id}`} className="link-card">
                <div className="card row between">
                  <div>
                    <strong>{e.name}</strong>
                    {e.muscle_group_id ? (
                      <div className="muted small">{muscleGroupName(groups, e.muscle_group_id)}</div>
                    ) : (
                      <span className="badge badge-warning">{UNCLASSIFIED_LABEL}</span>
                    )}
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
          <ExerciseForm groups={groups} />
        </section>
      ) : null}
    </div>
  );
}
