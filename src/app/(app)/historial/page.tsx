import type { Metadata } from "next";
import Link from "next/link";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { SessionListItem, type SessionRow } from "@/components/SessionListItem";
import { requireUser } from "@/lib/auth";
import { readDateRange } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Historial" };

const LIMIT = 200;

export default async function HistoryPage({ searchParams }: PageProps<"/historial">) {
  await requireUser();
  const params = await searchParams;
  const { from, to } = readDateRange(params);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_workout_sessions", {
    p_from: from || null,
    p_to: to || null,
    p_limit: LIMIT,
  });
  const sessions = (data ?? []) as SessionRow[];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Historial</h1>
        <Link href="/entrenar" className="btn btn-primary btn-sm">+ Registrar</Link>
      </div>
      {params.eliminada ? <p className="alert alert-success" role="status">Sesión eliminada.</p> : null}
      <DateRangeFilter action="/historial" from={from} to={to} />
      {error ? <p className="alert alert-error">No se pudo cargar el historial.</p> : null}
      {sessions.length === 0 ? (
        <div className="card empty">{from || to ? "No hay sesiones en ese rango." : "Aún no tienes sesiones registradas."}</div>
      ) : (
        <>
          <p className="muted small">{sessions.length} {sessions.length === 1 ? "sesión" : "sesiones"}. Toca una para verla o corregirla.</p>
          <ul className="list">
            {sessions.map((s) => (
              <li key={s.id}><SessionListItem session={s} /></li>
            ))}
          </ul>
          {sessions.length === LIMIT ? <p className="muted small">Mostrando las {LIMIT} más recientes. Usa el filtro de fechas para ver más.</p> : null}
        </>
      )}
    </div>
  );
}
