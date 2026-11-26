import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";
import { AccountActions, CreateAccountForm } from "./AdminForms";

export const metadata: Metadata = { title: "Administración" };

export default async function AdminPage() {
  const me = await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name, role, is_active, must_change_password")
    .order("created_at", { ascending: true });
  const accounts = (data ?? []) as Profile[];

  return (
    <div className="stack-lg">
      <h1>Administración</h1>
      <section className="card stack">
        <h2>Nueva cuenta</h2>
        <CreateAccountForm />
      </section>

      <section className="stack">
        <h2>Cuentas ({accounts.length})</h2>
        {error ? <p className="alert alert-error">No se pudieron cargar las cuentas.</p> : null}
        <ul className="list">
          {accounts.map((a) => (
            <li key={a.id} className="card stack" data-testid="account">
              <div className="row between">
                <div style={{ minWidth: 0 }}>
                  <strong style={{ wordBreak: "break-all" }}>{a.email}</strong>
                  {a.full_name ? <div className="muted small">{a.full_name}</div> : null}
                </div>
                <div className="row">
                  <span className={`badge ${a.role === "admin" ? "badge-primary" : ""}`}>{a.role === "admin" ? "Administrador" : "Usuario"}</span>
                  <span className={`badge ${a.is_active ? "badge-success" : "badge-danger"}`}>{a.is_active ? "Activa" : "Desactivada"}</span>
                  {a.must_change_password ? <span className="badge badge-warning">Contraseña temporal</span> : null}
                </div>
              </div>
              <details className="disclosure">
                <summary>Gestionar</summary>
                <AccountActions account={a} isSelf={a.id === me.id} />
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
