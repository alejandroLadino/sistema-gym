import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/salir"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Se ejecuta en el servidor antes de cada página o Server Action:
 * renueva la sesión de Supabase y aplica las reglas de acceso.
 * Las páginas y la base de datos (RLS) vuelven a comprobarlas.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return new NextResponse("Configuración incompleta: revisa las variables de entorno de Supabase.", {
      status: 500,
    });
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const redirectTo = (path: string) => {
    const target = request.nextUrl.clone();
    const [p, query] = path.split("?");
    target.pathname = p;
    target.search = query ? `?${query}` : "";
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  const hasAuthCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
  const user = hasAuthCookie ? (await supabase.auth.getUser()).data.user : null;

  if (!user) {
    return isPublic(pathname) ? response : redirectTo("/login");
  }

  if (pathname.startsWith("/salir")) return response;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active, must_change_password")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) return redirectTo("/salir?motivo=desactivada");
  if (pathname === "/login") return redirectTo(profile.must_change_password ? "/cambiar-clave" : "/");
  if (profile.must_change_password && pathname !== "/cambiar-clave") return redirectTo("/cambiar-clave");
  if (pathname.startsWith("/admin") && profile.role !== "admin") return redirectTo("/");

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
};
