import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseEnv } from "@/lib/env";

/**
 * Cliente con service_role. Ignora RLS: úsalo SOLO en acciones del servidor
 * después de comprobar que quien llama es administrador (requireAdmin).
 */
export function createAdminClient() {
  const { url } = publicSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor.");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
