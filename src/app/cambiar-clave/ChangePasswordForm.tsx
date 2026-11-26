"use client";

import { useActionState } from "react";
import { changePassword, type FormState } from "@/app/actions/auth";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

export function ChangePasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(changePassword, {});
  return (
    <form action={action} className="stack">
      <FormMessage error={state.error} />
      <div className="field">
        <label className="field">
          <span>Nueva contraseña</span>
          <input className="input" type="password" name="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required autoFocus aria-describedby="password-hint" />
        </label>
        <span className="hint" id="password-hint">Mínimo {MIN_PASSWORD_LENGTH} caracteres. Debe ser distinta de la temporal.</span>
      </div>
      <label className="field">
        <span>Repite la nueva contraseña</span>
        <input className="input" type="password" name="confirm" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
      </label>
      <SubmitButton className="btn btn-primary btn-block btn-lg" pendingText="Guardando…">
        Guardar contraseña
      </SubmitButton>
    </form>
  );
}
