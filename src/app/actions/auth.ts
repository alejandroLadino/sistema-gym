"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { validatePassword } from "@/lib/validation";

export type FormState = { error?: string; message?: string };

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Escribe tu correo y tu contraseña." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    if (error?.code === "user_banned") return { error: "Tu cuenta está desactivada. Contacta al administrador." };
    if (error?.status === 429) return { error: "Demasiados intentos. Espera un momento y vuelve a probar." };
    return { error: "Correo o contraseña incorrectos." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active, must_change_password")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile?.is_active) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Tu cuenta está desactivada. Contacta al administrador." };
  }

  redirect(profile.must_change_password ? "/cambiar-clave" : "/");
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user?.profile?.is_active) redirect("/login");

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const invalid = validatePassword(password);
  if (invalid) return { error: invalid };
  if (password !== confirm) return { error: "Las contraseñas no coinciden." };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") return { error: "La nueva contraseña debe ser distinta de la anterior." };
    if (error.code === "weak_password") return { error: "La contraseña es demasiado débil. Prueba con una más larga." };
    if (error.code === "reauthentication_needed")
      return { error: "Tu proyecto exige reautenticación para cambiar la contraseña. Desactiva «Secure password change» en Supabase." };
    return { error: "No se pudo cambiar la contraseña. Inténtalo de nuevo." };
  }

  // Solo el servidor puede quitar la marca de contraseña temporal.
  const admin = createAdminClient();
  const { error: profileError } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", user.id);
  if (profileError) return { error: "La contraseña cambió, pero no se pudo actualizar tu perfil. Reintenta." };

  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
