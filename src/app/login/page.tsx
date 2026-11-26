import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Iniciar sesión" };

const NOTICES: Record<string, string> = {
  desactivada: "Tu cuenta está desactivada. Contacta al administrador.",
  salida: "Cerraste sesión.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { motivo } = await searchParams;
  const notice = typeof motivo === "string" ? NOTICES[motivo] : undefined;
  return (
    <main className="auth-page">
      <div className="card auth-card stack">
        <div>
          <div className="brand-big">SISTEMA GYM</div>
          <p className="muted" style={{ textAlign: "center" }}>Inicia sesión para registrar tu entrenamiento</p>
        </div>
        <LoginForm notice={notice} />
      </div>
    </main>
  );
}
