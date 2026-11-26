"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult, Exercise } from "@/lib/types";
import { EXERCISE_COLUMNS } from "@/lib/muscle-groups";
import { parseMuscleGroupId } from "@/lib/muscle-group-utils";
import { cleanText, isUuid } from "@/lib/validation";

export type ExerciseFormState = { error?: string; message?: string };

const DUPLICATE = "Ya tienes un ejercicio activo con ese nombre.";
const BAD_GROUP = "Elige un grupo muscular de la lista.";
const NO_ACCESS = "Tu sesión expiró o no tienes acceso. Vuelve a iniciar sesión.";

function readExerciseForm(formData: FormData) {
  const group = parseMuscleGroupId(formData.get("muscle_group_id"));
  return {
    values: {
      name: cleanText(formData.get("name"), 80),
      muscle_group_id: group.ok ? group.value : null,
      notes: cleanText(formData.get("notes"), 1000),
    },
    groupOk: group.ok,
  };
}

function exerciseError(code: string | undefined, fallback: string) {
  if (code === "23505") return DUPLICATE;
  if (code === "23503") return BAD_GROUP;
  return fallback;
}

export async function createExercise(_prev: ExerciseFormState, formData: FormData): Promise<ExerciseFormState> {
  if (!(await getActionUser())) return { error: NO_ACCESS };
  const { values, groupOk } = readExerciseForm(formData);
  if (!values.name) return { error: "Escribe el nombre del ejercicio." };
  if (!groupOk) return { error: BAD_GROUP };

  const supabase = await createClient();
  const { error } = await supabase.from("exercises").insert(values);
  if (error) return { error: exerciseError(error.code, "No se pudo crear el ejercicio.") };

  revalidatePath("/ejercicios");
  return { message: `«${values.name}» agregado a tu catálogo.` };
}

/** Creación rápida desde «Registrar entrenamiento». */
export async function quickCreateExercise(input: {
  name: string;
  muscle_group_id?: string | null;
}): Promise<ActionResult<Exercise>> {
  if (!(await getActionUser())) return { ok: false, error: NO_ACCESS };
  const name = input.name?.trim().slice(0, 80);
  if (!name) return { ok: false, error: "Escribe el nombre del ejercicio." };
  const group = parseMuscleGroupId(input.muscle_group_id);
  if (!group.ok) return { ok: false, error: BAD_GROUP };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exercises")
    .insert({ name, muscle_group_id: group.value })
    .select(EXERCISE_COLUMNS)
    .single<Exercise>();
  if (error || !data) {
    return { ok: false, error: exerciseError(error?.code, "No se pudo crear el ejercicio.") };
  }
  revalidatePath("/ejercicios");
  return { ok: true, data };
}

export async function updateExercise(_prev: ExerciseFormState, formData: FormData): Promise<ExerciseFormState> {
  if (!(await getActionUser())) return { error: NO_ACCESS };
  const id = formData.get("id");
  if (!isUuid(id)) return { error: "Ejercicio inválido." };
  const { values, groupOk } = readExerciseForm(formData);
  if (!values.name) return { error: "Escribe el nombre del ejercicio." };
  if (!groupOk) return { error: BAD_GROUP };

  const supabase = await createClient();
  const { data, error } = await supabase.from("exercises").update(values).eq("id", id).select("id");
  if (error) return { error: exerciseError(error.code, "No se pudo guardar.") };
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
