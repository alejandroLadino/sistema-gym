#!/usr/bin/env node
// Crea (o promueve) el primer administrador de SISTEMA GYM.
// Uso:  npm run create-admin -- --email admin@tu-gym.com [--name "Nombre"]
// La contraseña se pide por teclado (no queda en el historial). En entornos sin
// terminal interactiva puede pasarse en la variable ADMIN_PASSWORD.
// Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (lee .env.local).
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import readline from "node:readline";
import { parseArgs } from "node:util";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const { values } = parseArgs({
  options: { email: { type: "string" }, name: { type: "string" } },
});

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = values.email?.trim().toLowerCase();

if (!url || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (revisa .env.local).");
  process.exit(1);
}
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Indica un correo válido: npm run create-admin -- --email admin@tu-gym.com");
  process.exit(1);
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

let password = process.env.ADMIN_PASSWORD;
if (!password) {
  if (!process.stdin.isTTY) {
    console.error("Sin terminal interactiva: define ADMIN_PASSWORD para este comando.");
    process.exit(1);
  }
  password = await askHidden("Contraseña del administrador (mín. 8): ");
  const again = await askHidden("Repite la contraseña: ");
  if (password !== again) {
    console.error("Las contraseñas no coinciden.");
    process.exit(1);
  }
}
if (password.length < 8) {
  console.error("La contraseña debe tener al menos 8 caracteres.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const fullName = values.name?.trim() || null;

let userId;
const created = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: fullName ? { full_name: fullName } : {},
  app_metadata: { role: "admin", provisioned: "true" },
});

if (created.error) {
  if (created.error.code !== "email_exists" && !/already/i.test(created.error.message)) {
    console.error("No se pudo crear el usuario:", created.error.message);
    process.exit(1);
  }
  // Ya existe: se promueve a administrador y se le asigna la contraseña indicada.
  const { data: existing, error } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
  if (error || !existing) {
    console.error("El correo ya existe en Auth pero no tiene perfil. ¿Aplicaste las migraciones?");
    process.exit(1);
  }
  userId = existing.id;
  const upd = await admin.auth.admin.updateUserById(userId, {
    password,
    app_metadata: { role: "admin", provisioned: "true" },
    ban_duration: "none",
  });
  if (upd.error) {
    console.error("No se pudo actualizar el usuario:", upd.error.message);
    process.exit(1);
  }
} else {
  userId = created.data.user.id;
}

const { error: profileError } = await admin.from("profiles").upsert({
  id: userId,
  email,
  full_name: fullName,
  role: "admin",
  is_active: true,
  // La eligió quien instala, en privado: no es temporal.
  must_change_password: false,
});
if (profileError) {
  console.error("Usuario creado, pero falló el perfil:", profileError.message);
  process.exit(1);
}

console.log(`Administrador listo: ${email}. Ya puede iniciar sesión.`);
