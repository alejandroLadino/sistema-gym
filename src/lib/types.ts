import type { Block, BlockPlan } from "./blocks";

export type Role = "admin" | "user";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  must_change_password: boolean;
};

export type MuscleGroup = {
  id: string;
  name: string;
  region: string;
};

export type Exercise = {
  id: string;
  name: string;
  muscle_group_id: string | null;
  /** Equipo (Mancuernas, Barra…); null = sin indicar (ejercicios anteriores). */
  equipment?: string | null;
  notes: string | null;
  archived_at: string | null;
};

/**
 * Serie simple (reps y peso opcional) o por bloques (`blocks` + `rounds`; entonces
 * `reps` y `weight_kg` son null).
 */
export type SetValue = {
  reps: number | null;
  weight_kg: number | null;
  rounds?: number | null;
  blocks?: Block[] | null;
  /** «Solo barra» (series simples): distingue la barra de peso corporal o de un peso sin capturar. */
  bar_only?: boolean;
  /** «Peso corporal» elegido explícitamente (un peso vacío sin marca es un registro sin indicar). */
  bodyweight?: boolean;
};

export type SessionData = {
  id: string;
  session_date: string;
  notes: string | null;
  updated_at: string;
  /** null = en curso; fecha = finalizada. */
  finished_at?: string | null;
  /** Modo guiado: cuándo se inició (null = no se inició) y en qué ejercicio quedó. */
  guided_started_at?: string | null;
  guided_exercise_id?: string | null;
  exercises: {
    exercise_id: string;
    name: string;
    muscle_group: string | null;
    muscle_group_id?: string | null;
    archived: boolean;
    /** Metas copiadas de la rutina al iniciar la sesión (solo referencia). */
    target_sets?: number | null;
    target_reps_min?: number | null;
    target_reps_max?: number | null;
    target_blocks?: BlockPlan | null;
    /** Marcado como finalizado («✓ Completado»). */
    completed?: boolean;
    /** Series alternadas: pareja (alt_group) y turno dentro de ella (alt_slot 0 o 1). */
    alt_group?: number | null;
    alt_slot?: number | null;
    sets: SetValue[];
  }[];
};

export type PreviousSets = { session_id: string; session_date: string; sets: SetValue[] };

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };
