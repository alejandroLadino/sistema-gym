import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { MainNav } from "@/components/MainNav";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const name = user.profile.full_name || user.email;
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand">SISTEMA GYM</Link>
        <div className="topbar-actions">
          <span className="who" title={user.email}>{name}</span>
          <form action={logout}>
            <button type="submit" className="btn btn-sm btn-ghost">Salir</button>
          </form>
        </div>
      </header>
      <MainNav isAdmin={user.profile.role === "admin"} />
      <main className="main">{children}</main>
    </div>
  );
}
