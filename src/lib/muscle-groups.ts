import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { MuscleGroup } from "@/lib/types";

/** Catálogo predefinido de grupos musculares (tabla muscle_groups), en orden. */
export const getMuscleGroups = cache(async (): Promise<MuscleGroup[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("muscle_groups").select("id, name, region").order("sort_order");
  return (data ?? []) as MuscleGroup[];
});

/** Columnas de exercises que usa la app. */
export const EXERCISE_COLUMNS = "id, name, muscle_group_id, equipment, notes, archived_at";
