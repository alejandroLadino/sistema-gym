"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isIsoDate } from "@/lib/format";
import type { SessionPayload } from "@/lib/session-draft";
import type { ActionResult, PreviousSets } from "@/lib/types";
import { isUuid, MAX_REPS, MAX_WEIGHT_KG } from "@/lib/validation";

const NO_ACCESS = "Tu sesión expiró o tu cuenta no tiene acceso. Vuelve a iniciar sesión; lo capturado se conserva en este dispositivo.";

function isValidPayload(p: SessionPayload): boolean {
  if (!p || !isUuid(p.id) || !isIsoDate(p.session_date)) return false;
  if (p.notes !== null && (typeof p.notes !== "string" || p.notes.length > 2000)) return false;
  if (!Array.isArray(p.exercises) || p.exercises.length === 0 || p.exercises.length > 50) return false;
  return p.exercises.every(
    (e) =>
      isUuid(e.exercise_id) &&
      Array.isArray(e.sets) &&
      e.sets.length <= 100 &&
      e.sets.every(
        (s) =>
          Number.isInteger(s.reps) &&
          s.reps >= 1 &&
          s.reps <= MAX_REPS &&
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
    return { ok: false, error: "No se pudo guardar. Revisa tu conexión y reintenta." };
  }
  revalidatePath("/historial");
  revalidatePath("/");
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

export async function deleteSession(formData: FormData) {
  if (!(await getActionUser())) redirect("/login");
  const id = formData.get("id");
  if (!isUuid(id)) return;
  const supabase = await createClient();
  await supabase.from("workout_sessions").delete().eq("id", id);
  revalidatePath("/historial");
  revalidatePath("/");
  redirect("/historial?eliminada=1");
}
