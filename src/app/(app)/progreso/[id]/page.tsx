import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { ProgressChart, type ChartPoint } from "@/components/ProgressChart";
import { requireUser } from "@/lib/auth";
import { formatDate, formatKg, formatSet } from "@/lib/format";
import { readDateRange } from "@/lib/search-params";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { muscleGroupName, UNCLASSIFIED_LABEL } from "@/lib/muscle-group-utils";
import { createClient } from "@/lib/supabase/server";
import type { Exercise, SetValue } from "@/lib/types";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Progreso" };

type Row = {
  session_id: string;
  session_date: string;
  max_weight_kg: number | null;
  max_reps: number;
  total_reps: number;
  sets: SetValue[];
};

export default async function ExerciseProgressPage({ params, searchParams }: PageProps<"/progreso/[id]">) {
  const { id } = await params;
  await requireUser();
  if (!isUuid(id)) notFound();
  const { from, to } = readDateRange(await searchParams);

  const supabase = await createClient();
  const [{ data: exercise }, groups] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_COLUMNS).eq("id", id).maybeSingle<Exercise>(),
    getMuscleGroups(),
  ]);
  if (!exercise) notFound();

  const { data, error } = await supabase.rpc("get_exercise_progress", {
    p_exercise_id: id,
    p_from: from || null,
    p_to: to || null,
  });
  const rows = ((data ?? []) as Row[]).map((r) => ({
    ...r,
    max_weight_kg: r.max_weight_kg === null ? null : Number(r.max_weight_kg),
  }));

  const weighted = rows.filter((r) => r.max_weight_kg !== null);
  const usesWeight = weighted.length > 0;
  const points: ChartPoint[] = usesWeight
    ? weighted.map((r) => ({ date: r.session_date, value: r.max_weight_kg as number, label: `${r.sets.length} series` }))
    : rows.map((r) => ({ date: r.session_date, value: r.max_reps, label: `${r.total_reps} reps en total` }));

  const best = usesWeight ? Math.max(...weighted.map((r) => r.max_weight_kg as number)) : Math.max(0, ...rows.map((r) => r.max_reps));
  const latest = rows.at(-1);
  const action = `/progreso/${id}`;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{exercise.name}</h1>
          <div className="row small muted">
            <span>{muscleGroupName(groups, exercise.muscle_group_id) ?? UNCLASSIFIED_LABEL}</span>
            {exercise.archived_at ? <span className="badge">Archivado</span> : null}
          </div>
        </div>
        <Link href={`/ejercicios/${id}`} className="btn btn-sm">Editar</Link>
      </div>

      <DateRangeFilter action={action} from={from} to={to} />
      {error ? <p className="alert alert-error">No se pudo cargar el progreso.</p> : null}

      {rows.length === 0 ? (
        <div className="card empty">{from || to ? "No hay registros en ese rango." : "Aún no registras este ejercicio."}</div>
      ) : (
        <>
          <div className="row" style={{ gap: 12 }}>
            <div className="card" style={{ flex: 1, minWidth: 140 }}>
              <div className="muted small">{usesWeight ? "Peso máximo" : "Máx. repeticiones"}</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{usesWeight ? `${formatKg(best)} kg` : best}</div>
            </div>
            <div className="card" style={{ flex: 1, minWidth: 140 }}>
              <div className="muted small">Sesiones</div>
              <div style={{ fontSize: "1.6rem", fontWeight: 800 }}>{rows.length}</div>
              {latest ? <div className="muted small">Última: {formatDate(latest.session_date, { weekday: false })}</div> : null}
            </div>
          </div>

          <section className="card">
            <ProgressChart
              points={points}
              unit={usesWeight ? "kg" : "reps"}
              title={usesWeight ? "Peso máximo por sesión (kg)" : "Repeticiones máximas por sesión (peso corporal)"}
            />
          </section>

          <section className="card stack">
            <h2>Series por fecha</h2>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Series</th>
                    <th scope="col">{usesWeight ? "Máx." : "Total"}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].reverse().map((r) => (
                    <tr key={r.session_id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link href={`/sesiones/${r.session_id}`}>{formatDate(r.session_date, { weekday: false })}</Link>
                      </td>
                      <td>
                        <ol style={{ margin: 0, paddingLeft: 18 }}>
                          {r.sets.map((s, i) => (
                            <li key={i}>{formatSet(s)}</li>
                          ))}
                        </ol>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {usesWeight
                          ? r.max_weight_kg !== null ? `${formatKg(r.max_weight_kg)} kg` : "—"
                          : `${r.total_reps} reps`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
