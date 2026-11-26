"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { GROUP_REQUIRED, validateExerciseInput, type ExerciseFieldErrors } from "@/lib/muscle-group-utils";
import { cleanText, isUuid } from "@/lib/validation";

export type ExerciseFormValues = { name: string; muscle_group_id: string; notes: string };
export type ExerciseFormState = {
  error?: string;
  message?: string;
  fieldErrors?: ExerciseFieldErrors;
  /** Lo enviado, para no perderlo cuando el servidor rechaza el formulario. */
  values?: ExerciseFormValues;
};

function formValues(formData: FormData): ExerciseFormValues {
  const text = (k: string) => (typeof formData.get(k) === "string" ? String(formData.get(k)) : "");
  return { name: text("name"), muscle_group_id: text("muscle_group_id"), notes: text("notes") };
}

export type QuickCreateResult =
  | { ok: true; data: Exercise }
  | { ok: false; error: string; fieldErrors?: ExerciseFieldErrors; duplicate?: boolean };

const DUPLICATE = "Ya tienes un ejercicio activo con ese nombre.";
const NO_ACCESS = "Tu sesión expiró o no tienes acceso. Vuelve a iniciar sesión.";
const CHECK_FIELDS = "Revisa los campos marcados.";

/** Valida contra el catálogo real de grupos (servidor). */
async function validate(input: { name: unknown; muscle_group_id: unknown }) {
  const groups = await getMuscleGroups();
  return validateExerciseInput(input, groups.map((g) => g.id));
}

/** Traduce los errores de Postgres a mensajes para el usuario. */
function dbError(code: string | undefined, fallback: string): { error: string; fieldErrors?: ExerciseFieldErrors } {
  if (code === "23505") return { error: DUPLICATE, fieldErrors: { name: DUPLICATE } };
  // 23503: el grupo no existe en el catálogo; 23514/23502: grupo obligatorio (trigger / NOT NULL).
  if (code === "23503" || code === "23514" || code === "23502") {
    return { error: CHECK_FIELDS, fieldErrors: { muscle_group_id: GROUP_REQUIRED } };
  }
  return { error: fallback };
}

export async function createExercise(_prev: ExerciseFormState, formData: FormData): Promise<ExerciseFormState> {
  if (!(await getActionUser())) return { error: NO_ACCESS };
  const res = await validate({ name: formData.get("name"), muscle_group_id: formData.get("muscle_group_id") });
  if (!res.ok) return { error: CHECK_FIELDS, fieldErrors: res.errors, values: formValues(formData) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("exercises")
    .insert({ ...res.value, notes: cleanText(formData.get("notes"), 1000) });
  if (error) return { ...dbError(error.code, "No se pudo crear el ejercicio."), values: formValues(formData) };

  revalidatePath("/ejercicios");
  return { message: `«${res.value.name}» agregado a tu catálogo.` };
}

/** Creación desde el modal «Agregar ejercicio» de la sesión. */
export async function quickCreateExercise(input: { name: string; muscle_group_id: string | null }): Promise<QuickCreateResult> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  const res = await validate(input);
  if (!res.ok) return { ok: false, error: CHECK_FIELDS, fieldErrors: res.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.from("exercises").insert(res.value).select(EXERCISE_COLUMNS).single<Exercise>();
  if (error || !data) {
    const mapped = dbError(error?.code, "No se pudo crear el ejercicio. Revisa tu conexión y reintenta.");
    return { ok: false, ...mapped, duplicate: error?.code === "23505" };
  }
  revalidatePath("/ejercicios");
  return { ok: true, data };
}

export async function updateExercise(_prev: ExerciseFormState, formData: FormData): Promise<ExerciseFormState> {
  if (!(await getActionUser())) return { error: NO_ACCESS };
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Ejercicio inválido." };
  const res = await validate({ name: formData.get("name"), muscle_group_id: formData.get("muscle_group_id") });
  if (!res.ok) return { error: CHECK_FIELDS, fieldErrors: res.errors, values: formValues(formData) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .update({ ...res.value, notes: cleanText(formData.get("notes"), 1000) })
    .eq("id", id)
    .select("id");
  if (error) return { ...dbError(error.code, "No se pudo guardar."), values: formValues(formData) };
  if (!data?.length) return { error: "Ejercicio no encontrado." };

  revalidatePath("/ejercicios");
  revalidatePath(`/ejercicios/${id}`);
  return { message: "Cambios guardados." };
}

export async function setExerciseArchived(formData: FormData) {
  if (!(await getActionUser())) redirect("/login");
  const id = formData.get("id");
  const archive = formData.get("archive") === "true";
  if (!isUuid(id)) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("exercises")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id);
  if (error?.code === "23505") {
    redirect(`/ejercicios/${id}?error=duplicado`);
  }
  revalidatePath("/ejercicios");
  revalidatePath(`/ejercicios/${id}`);
}
