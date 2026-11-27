"use server";

import { getActionUser } from "@/lib/auth";
import { isValidPlan } from "@/lib/blocks";
import { isIsoDate } from "@/lib/format";
import {
  MAX_ROUTINE_EXERCISES,
  MAX_ROUTINE_NAME,
  MAX_TARGET_REPS,
  MAX_TARGET_SETS,
  type RoutinePayload,
} from "@/lib/routines";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";
import { isUuid } from "@/lib/validation";

const NO_ACCESS = "Tu sesión expiró o tu cuenta no tiene acceso. Vuelve a iniciar sesión.";
const NETWORK = "No se pudo guardar. Revisa tu conexión y reintenta.";

const optInt = (v: unknown, max: number) => v === null || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max);

function isValidRoutine(p: RoutinePayload): boolean {
  if (!p || !isUuid(p.id) || typeof p.name !== "string") return false;
  const name = p.name.trim();
  if (!name || name.length > MAX_ROUTINE_NAME) return false;
  if (!Array.isArray(p.exercises) || p.exercises.length === 0 || p.exercises.length > MAX_ROUTINE_EXERCISES) return false;
  if (new Set(p.exercises.map((e) => e.exercise_id)).size !== p.exercises.length) return false;
  return p.exercises.every(
    (e) =>
      isUuid(e.exercise_id) &&
      optInt(e.target_sets, MAX_TARGET_SETS) &&
      optInt(e.target_reps_min, MAX_TARGET_REPS) &&
      optInt(e.target_reps_max, MAX_TARGET_REPS) &&
      (e.target_reps_min === null) === (e.target_reps_max === null) &&
      (e.target_reps_min === null || e.target_reps_min <= (e.target_reps_max as number)) &&
      (e.target_blocks === null || e.target_blocks === undefined || isValidPlan(e.target_blocks)) &&
      (((e.alt_group === null || e.alt_group === undefined) && (e.alt_slot === null || e.alt_slot === undefined)) ||
        (Number.isInteger(e.alt_group) && (e.alt_group as number) >= 1 && (e.alt_group as number) <= 50 && (e.alt_slot === 0 || e.alt_slot === 1))),
  );
}

/** Crea o edita una rutina completa. Idempotente: el id lo genera el cliente. */
export async function saveRoutine(payload: RoutinePayload): Promise<ActionResult<{ id: string }>> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  if (!isValidRoutine(payload)) return { ok: false, error: "Revisa el nombre, los ejercicios y las metas." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_routine", {
    p_routine: {
      ...payload,
      name: payload.name.trim(),
      exercises: payload.exercises.map((e) => ({
        ...e,
        target_blocks: e.target_blocks ?? null,
        alt_group: e.alt_group ?? null,
        alt_slot: e.alt_slot ?? null,
      })),
    },
  });
  if (error || !data) {
    if (error?.code === "42501") return { ok: false, error: "La rutina no existe o no te pertenece." };
    if (error?.code === "23505") return { ok: false, error: "Hay ejercicios repetidos en la rutina." };
    if (error?.code === "23503") return { ok: false, error: "Uno de los ejercicios ya no existe en tu catálogo." };
    if (error?.code === "23514") {
      if (error.hint === "routine_archived_exercise") return { ok: false, error: "Solo puedes agregar ejercicios activos." };
      if (error.hint === "routine_name") return { ok: false, error: "Escribe un nombre para la rutina." };
      return { ok: false, error: "Agrega al menos un ejercicio." };
    }
    return { ok: false, error: NETWORK };
  }
  return { ok: true, data: data as { id: string } };
}

/** Elimina una rutina propia. Las sesiones creadas con ella se conservan. */
export async function deleteRoutine(id: string): Promise<ActionResult> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  if (!isUuid(id)) return { ok: false, error: "Rutina inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("routines").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: "No se pudo eliminar la rutina. Revisa tu conexión y reintenta." };
  if (!data?.length) return { ok: false, error: "La rutina ya no existe o no te pertenece." };
  return { ok: true };
}

/**
 * «Usar rutina»: crea en una sola operación una sesión en curso con fecha `today`,
 * los ejercicios activos en orden, las metas copiadas y cero series. Idempotente por `sessionId`.
 */
export async function startRoutine(
  routineId: string,
  sessionId: string,
  today: string,
): Promise<ActionResult<{ id: string; omitted: string[] }>> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  if (!isUuid(routineId) || !isUuid(sessionId) || !isIsoDate(today)) return { ok: false, error: "No se pudo iniciar la rutina." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_routine_session", {
    p_routine_id: routineId,
    p_session_id: sessionId,
    p_date: today,
  });
  if (error || !data) {
    if (error?.code === "23514") {
      return { ok: false, error: "Todos los ejercicios de esta rutina están archivados. Edita la rutina para usarla." };
    }
    if (error?.code === "42501") return { ok: false, error: "La rutina no existe o no te pertenece." };
    return { ok: false, error: "No se pudo iniciar la rutina. Revisa tu conexión y reintenta." };
  }
  const res = data as { id: string; omitted: string[] };
  return { ok: true, data: { id: res.id, omitted: res.omitted ?? [] } };
}
