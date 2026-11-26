"use client";

import { useActionState } from "react";
import { login, type FormState } from "@/app/actions/auth";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="stack" noValidate>
      {notice && !state.error ? <p className="alert alert-warning" role="status">{notice}</p> : null}
      <FormMessage error={state.error} />
      <label className="field">
        <span>Correo electrónico</span>
        <input className="input" type="email" name="email" autoComplete="email" inputMode="email" required autoFocus />
      </label>
      <label className="field">
        <span>Contraseña</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required />
      </label>
      <SubmitButton className="btn btn-primary btn-block btn-lg" pendingText="Entrando…">
        Entrar
      </SubmitButton>
      <p className="hint">Las cuentas las crea el administrador del gimnasio.</p>
    </form>
  );
}
