"use server";

import { getActionUser } from "@/lib/auth";
import { isValidBlockSet } from "@/lib/blocks";
import { createClient } from "@/lib/supabase/server";
import { isIsoDate } from "@/lib/format";
import type { SessionPayload } from "@/lib/session-draft";
import type { ActionResult, PreviousSets } from "@/lib/types";
import { isUuid, MAX_REPS, MAX_WEIGHT_KG, normalizeSearch } from "@/lib/validation";
import { MAX_QUERY_LENGTH, type HistoryCursor, type HistorySession } from "@/lib/history";

const FINISHED_NEEDS_EXERCISE =
  "Una sesión finalizada necesita al menos un ejercicio. Reemplázalo o elimina la sesión.";
const FINISH_NEEDS_EXERCISE = "Agrega al menos un ejercicio para finalizar la sesión.";

const NO_ACCESS = "Tu sesión expiró o tu cuenta no tiene acceso. Vuelve a iniciar sesión; lo capturado se conserva en este dispositivo.";

function isValidPayload(p: SessionPayload): boolean {
  if (!p || !isUuid(p.id) || !isIsoDate(p.session_date)) return false;
  if (p.notes !== null && (typeof p.notes !== "string" || p.notes.length > 2000)) return false;
  // Sin ejercicios es válido para una sesión en curso; la base rechaza vaciar una finalizada.
  if (!Array.isArray(p.exercises) || p.exercises.length > 50) return false;
  return p.exercises.every(
    (e) =>
      isUuid(e.exercise_id) &&
      Array.isArray(e.sets) &&
      e.sets.length <= 100 &&
      e.sets.every((s) =>
        // Serie por bloques (secuencia + ciclos) o serie simple.
        s.blocks != null
          ? isValidBlockSet(s)
          : Number.isInteger(s.reps) &&
            (s.reps as number) >= 1 &&
            (s.reps as number) <= MAX_REPS &&
            (s.weight_kg === null ||
              (typeof s.weight_kg === "number" && s.weight_kg >= 0 && s.weight_kg <= MAX_WEIGHT_KG)),
      ),
  );
}

/** Idempotente: el id lo genera el cliente; reintentar actualiza la misma sesión. */
export async function saveSession(payload: SessionPayload): Promise<ActionResult<{ id: string; updated_at: string }>> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  if (!isValidPayload(payload)) return { ok: false, error: "Revisa los datos de la sesión." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_workout_session", { p_session: payload });
  if (error || !data) {
    if (error?.code === "42501") return { ok: false, error: NO_ACCESS };
    if (error?.code === "23503") return { ok: false, error: "Uno de los ejercicios ya no existe en tu catálogo." };
    if (error?.code === "23514") return { ok: false, error: FINISHED_NEEDS_EXERCISE };
    return { ok: false, error: "No se pudo guardar. Revisa tu conexión y reintenta." };
  }
  // Sin revalidatePath: invalidar la caché hace que Next vuelva a renderizar la ruta
  // actual y, tras el primer guardado (la URL ya es /sesiones/[id]), remonte el editor
  // mientras se escribe. Las páginas son dinámicas y se piden frescas al navegar.
  return { ok: true, data: data as { id: string; updated_at: string } };
}

export async function getPreviousSets(
  exerciseIds: string[],
  beforeDate: string,
  excludeSessionId: string | null,
): Promise<ActionResult<Record<string, PreviousSets>>> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  const ids = exerciseIds.filter(isUuid).slice(0, 50);
  if (ids.length === 0 || !isIsoDate(beforeDate)) return { ok: true, data: {} };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_previous_exercise_sets", {
    p_exercise_ids: ids,
    p_before: beforeDate,
    p_exclude_session: isUuid(excludeSessionId) ? excludeSessionId : null,
  });
  if (error) return { ok: false, error: "No se pudo cargar la sesión anterior." };

  const result: Record<string, PreviousSets> = {};
  for (const row of (data ?? []) as (PreviousSets & { exercise_id: string })[]) {
    result[row.exercise_id] = { session_id: row.session_id, session_date: row.session_date, sets: row.sets };
  }
  return { ok: true, data: result };
}

/**
 * Elimina una sesión propia. Solo informa éxito si la base confirma que se borró
 * (RLS devuelve 0 filas si no existe o no es tuya).
 */
export async function deleteSession(id: string): Promise<ActionResult> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  if (!isUuid(id)) return { ok: false, error: "Sesión inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("workout_sessions").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: "No se pudo eliminar la sesión. Revisa tu conexión y reintenta." };
  if (!data?.length) return { ok: false, error: "La sesión ya no existe o no te pertenece." };
  // Sin revalidatePath: refrescar la ruta actual remontaría el editor de la sesión
  // borrada (404) antes de salir. Inicio e Historial se cargan frescos al navegar.
  return { ok: true };
}

/** Marca la sesión como finalizada. Idempotente: repetirlo conserva la primera fecha. */
export async function finishSession(id: string): Promise<ActionResult> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  if (!isUuid(id)) return { ok: false, error: "Sesión inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("finish_workout_session", { p_session_id: id });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_ACCESS };
    if (error.code === "23514") return { ok: false, error: FINISH_NEEDS_EXERCISE };
    return { ok: false, error: "No se pudo finalizar la sesión. Revisa tu conexión y reintenta." };
  }
  return { ok: true };
}

/**
 * «Repetir ejercicios»: crea una sesión con fecha `today` y los ejercicios de la
 * sesión elegida, en el mismo orden y sin series (por capturar). La sesión original
 * no se modifica. Los ejercicios archivados se omiten. Idempotente por `newId`.
 */
export async function repeatSession(
  sourceId: string,
  newId: string,
  today: string,
): Promise<ActionResult<{ id: string; omitted: string[] }>> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  if (!isUuid(sourceId) || !isUuid(newId) || sourceId === newId || !isIsoDate(today)) {
    return { ok: false, error: "No se pudo repetir la sesión." };
  }
  const supabase = await createClient();
  const { data: source } = await supabase.rpc("get_workout_session", { p_session_id: sourceId });
  const session = source as { exercises: { exercise_id: string; name: string; archived: boolean }[] } | null;
  if (!session) return { ok: false, error: "La sesión no existe o no te pertenece." };

  const kept = session.exercises.filter((e) => !e.archived);
  const omitted = session.exercises.filter((e) => e.archived).map((e) => e.name);
  if (kept.length === 0) {
    return { ok: false, error: "Todos los ejercicios de esa sesión están archivados. Restaura alguno para repetirla." };
  }
  const { error } = await supabase.rpc("save_workout_session", {
    p_session: {
      id: newId,
      session_date: today,
      notes: null,
      exercises: kept.map((e) => ({ exercise_id: e.exercise_id, sets: [] })),
    },
  });
  if (error) {
    if (error.code === "42501") return { ok: false, error: NO_ACCESS };
    return { ok: false, error: "No se pudo crear la sesión. Revisa tu conexión y reintenta." };
  }
  return { ok: true, data: { id: newId, omitted } };
}

const HISTORY_PAGE = 30;

/**
 * Una página del historial filtrado (rango + búsqueda por ejercicio). La búsqueda
 * se hace en la base sobre todo el historial, no solo sobre lo ya cargado.
 */
export async function listHistory(input: {
  from: string | null;
  to: string | null;
  q: string;
  cursor: HistoryCursor | null;
}): Promise<ActionResult<{ sessions: HistorySession[]; total: number | null; hasMore: boolean }>> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  const from = input.from && isIsoDate(input.from) ? input.from : null;
  const to = input.to && isIsoDate(input.to) ? input.to : null;
  const q = typeof input.q === "string" ? normalizeSearch(input.q).slice(0, MAX_QUERY_LENGTH) : "";
  const c = input.cursor;
  const cursor =
    c && isIsoDate(c.date) && isUuid(c.id) && typeof c.created === "string" && !Number.isNaN(Date.parse(c.created)) ? c : null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_workout_sessions", {
    p_from: from,
    p_to: to,
    p_query: q || null,
    p_before_date: cursor?.date ?? null,
    p_before_created: cursor?.created ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: HISTORY_PAGE + 1,
  });
  if (error) return { ok: false, error: "No se pudo cargar el historial. Reintenta." };
  const rows = (data ?? []) as HistorySession[];
  return {
    ok: true,
    data: {
      sessions: rows.slice(0, HISTORY_PAGE),
      total: cursor ? null : (rows[0]?.total_count ?? 0),
      hasMore: rows.length > HISTORY_PAGE,
    },
  };
}
