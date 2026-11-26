import type { Metadata } from "next";
import { logout } from "@/app/actions/auth";
import { requireSignedIn } from "@/lib/auth";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export default async function ChangePasswordPage() {
  const user = await requireSignedIn();
  const forced = user.profile.must_change_password;
  return (
    <main className="auth-page">
      <div className="card auth-card stack">
        <div>
          <h1>Cambia tu contraseña</h1>
          <p className="muted">
            {forced
              ? "Entraste con una contraseña temporal. Elige una nueva para continuar."
              : `Cuenta: ${user.email}`}
          </p>
        </div>
        <ChangePasswordForm />
        <form action={logout}>
          <button className="btn btn-ghost btn-block" type="submit">Cerrar sesión</button>
        </form>
      </div>
    </main>
  );
}
