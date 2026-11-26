"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getActionUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanText, isEmail, isUuid, validatePassword } from "@/lib/validation";

export type AdminFormState = { error?: string; message?: string; password?: string; nonce?: number };

const BAN_FOREVER = "876000h"; // ~100 años

function generatePassword(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

async function adminOrError() {
  const user = await getActionUser({ admin: true });
  return user;
}

export async function createAccount(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await adminOrError();
  if (!actor) return { error: "No tienes permiso para esta acción." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = cleanText(formData.get("full_name"), 120);
  const role = formData.get("role") === "admin" ? "admin" : "user";
  const typed = String(formData.get("password") ?? "");
  const password = typed || generatePassword();

  if (!isEmail(email)) return { error: "Escribe un correo válido." };
  const invalid = validatePassword(password);
  if (invalid) return { error: invalid };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: fullName ? { full_name: fullName } : {},
    app_metadata: { role, provisioned: "true" },
  });
  if (error || !data.user) {
    if (error?.code === "email_exists" || /already/i.test(error?.message ?? ""))
      return { error: "Ya existe una cuenta con ese correo." };
    return { error: `No se pudo crear la cuenta: ${error?.message ?? "error desconocido"}` };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    email,
    full_name: fullName,
    role,
    is_active: true,
    must_change_password: true,
  });
  if (profileError) return { error: `Cuenta creada, pero falló el perfil: ${profileError.message}` };

  revalidatePath("/admin");
  return {
    message: `Cuenta creada para ${email}. Comparte la contraseña temporal por un canal privado; se pedirá cambiarla al entrar.`,
    password,
    nonce: Date.now(),
  };
}

export async function resetPassword(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await adminOrError();
  if (!actor) return { error: "No tienes permiso para esta acción." };

  const userId = formData.get("user_id");
  if (!isUuid(userId)) return { error: "Cuenta inválida." };
  const password = String(formData.get("password") ?? "") || generatePassword();
  const invalid = validatePassword(password);
  if (invalid) return { error: invalid };

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return { error: `No se pudo restablecer: ${error.message}` };

  const { error: profileError } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);
  if (profileError) return { error: `Contraseña cambiada, pero falló el perfil: ${profileError.message}` };

  revalidatePath("/admin");
  return { message: "Contraseña restablecida. Deberá cambiarla en su próximo acceso.", password, nonce: Date.now() };
}

export async function setAccountActive(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const actor = await adminOrError();
  if (!actor) return { error: "No tienes permiso para esta acción." };

  const userId = formData.get("user_id");
  const active = formData.get("active") === "true";
  if (!isUuid(userId)) return { error: "Cuenta inválida." };
  if (userId === actor.id && !active) return { error: "No puedes desactivar tu propia cuenta." };

  const admin = createAdminClient();

  // 1) El perfil: RLS corta el acceso a los datos de inmediato, incluso con sesión abierta.
  const { error: profileError } = await admin.from("profiles").update({ is_active: active }).eq("id", userId);
  if (profileError) return { error: `No se pudo actualizar la cuenta: ${profileError.message}` };

  // 2) Supabase Auth: impide iniciar sesión o renovar el token.
  const { error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? "none" : BAN_FOREVER,
  });
  if (error) {
    return {
      error: `La cuenta quedó ${active ? "activa" : "sin acceso a datos"}, pero Supabase Auth respondió: ${error.message}`,
    };
  }

  revalidatePath("/admin");
  return { message: active ? "Cuenta activada." : "Cuenta desactivada." };
}
