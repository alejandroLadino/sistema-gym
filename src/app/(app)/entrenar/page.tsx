import type { Metadata } from "next";
import { SessionEditor } from "@/components/session/SessionEditor";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Exercise } from "@/lib/types";

export const metadata: Metadata = { title: "Registrar entrenamiento" };

export default async function NewSessionPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("exercises")
    .select("id, name, muscle_group, notes, archived_at")
    .is("archived_at", null)
    .order("name");
  return <SessionEditor userId={user.id} exercises={(data ?? []) as Exercise[]} />;
}
