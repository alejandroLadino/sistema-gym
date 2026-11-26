import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Cierra la sesión local (se usa al detectar una cuenta desactivada). */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  const motivo = request.nextUrl.searchParams.get("motivo") === "desactivada" ? "desactivada" : "salida";
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?motivo=${motivo}`;
  return NextResponse.redirect(url);
}
