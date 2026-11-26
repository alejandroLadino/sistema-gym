import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SessionEditor } from "@/components/session/SessionEditor";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Exercise, SessionData } from "@/lib/types";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Sesión" };

export default async function SessionPage({ params }: PageProps<"/sesiones/[id]">) {
  const { id } = await params;
  const user = await requireUser();
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  // RLS: si la sesión es de otra persona, la función devuelve null → 404.
  const [{ data: session }, { data: exercises }] = await Promise.all([
    supabase.rpc("get_workout_session", { p_session_id: id }),
    supabase.from("exercises").select("id, name, muscle_group, notes, archived_at").is("archived_at", null).order("name"),
  ]);
  if (!session) notFound();

  return (
    <SessionEditor
      key={id}
      userId={user.id}
      initial={session as SessionData}
      exercises={(exercises ?? []) as Exercise[]}
    />
  );
}
