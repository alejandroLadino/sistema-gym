import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type CurrentUser = { id: string; email: string; profile: Profile | null };

/** Usuario validado contra Supabase Auth (no solo la cookie) y su perfil. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, must_change_password")
    .eq("id", data.user.id)
    .maybeSingle<Profile>();
  return { id: data.user.id, email: data.user.email ?? "", profile: profile ?? null };
});

/** Sesión iniciada y cuenta activa (puede tener la contraseña temporal pendiente). */
export async function requireSignedIn(): Promise<CurrentUser & { profile: Profile }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.profile || !user.profile.is_active) redirect("/salir?motivo=desactivada");
  return user as CurrentUser & { profile: Profile };
}

/** Acceso completo a la app: activa y sin contraseña temporal pendiente. */
export async function requireUser() {
  const user = await requireSignedIn();
  if (user.profile.must_change_password) redirect("/cambiar-clave");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.profile.role !== "admin") redirect("/");
  return user;
}

/** Para Server Actions: devuelve null en lugar de redirigir. */
export async function getActionUser(opts: { admin?: boolean } = {}) {
  const user = await getCurrentUser();
  if (!user?.profile?.is_active || user.profile.must_change_password) return null;
  if (opts.admin && user.profile.role !== "admin") return null;
  return user as CurrentUser & { profile: Profile };
}
