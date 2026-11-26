import type { Metadata } from "next";
import { SessionEditor } from "@/components/session/SessionEditor";
import { requireUser } from "@/lib/auth";
import { EXERCISE_COLUMNS, getMuscleGroups } from "@/lib/muscle-groups";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";

export const metadata: Metadata = { title: "Registrar entrenamiento" };

export default async function NewSessionPage({ searchParams }: PageProps<"/entrenar">) {
  const fromHistory = (await searchParams).origen === "historial";
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data }, groups] = await Promise.all([
    supabase.from("exercises").select(EXERCISE_COLUMNS).is("archived_at", null).order("name"),
    getMuscleGroups(),
  ]);
  return (
    <SessionEditor
      userId={user.id}
      exercises={(data ?? []) as Exercise[]}
      muscleGroups={groups}
      initialNotice={fromHistory ? "¿Es un entrenamiento anterior? Toca la fecha, arriba, para elegir el día." : undefined}
    />
  );
}
