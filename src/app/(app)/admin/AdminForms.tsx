"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAccount, resetPassword, setAccountActive, type AdminFormState } from "@/app/actions/admin";
import { FormMessage } from "@/components/FormMessage";
import { SubmitButton } from "@/components/SubmitButton";
import type { Profile } from "@/lib/types";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";

function TempPassword({ state }: { state: AdminFormState }) {
  if (!state.password) return null;
  return (
    <div className="alert alert-info stack" role="status" style={{ gap: 4 }}>
      <span className="small">Contraseña temporal (se muestra solo ahora):</span>
      <code style={{ fontSize: "1.15rem", fontWeight: 700, userSelect: "all" }} data-testid="temp-password">{state.password}</code>
    </div>
  );
}

export function CreateAccountForm() {
  const [state, action] = useActionState<AdminFormState, FormData>(createAccount, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.nonce) formRef.current?.reset();
  }, [state.nonce]);

  return (
    <form ref={formRef} action={action} className="form-grid" aria-label="Crear cuenta">
      <FormMessage error={state.error} message={state.message} />
      <TempPassword state={state} />
      <div className="form-grid cols-2">
        <label className="field">
          <span>Correo</span>
          <input className="input" type="email" name="email" required autoComplete="off" inputMode="email" />
        </label>
        <label className="field">
          <span>Nombre (opcional)</span>
          <input className="input" name="full_name" maxLength={120} autoComplete="off" />
        </label>
        <div className="field">
          <label className="field">
            <span>Contraseña inicial</span>
            <input className="input" type="text" name="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="off" placeholder="Vacío = generar una segura" aria-describedby="initial-password-hint" />
          </label>
          <span className="hint" id="initial-password-hint">Se pedirá cambiarla en el primer acceso.</span>
        </div>
        <label className="field">
          <span>Rol</span>
          <select className="input" name="role" defaultValue="user">
            <option value="user">Usuario</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
      </div>
      <SubmitButton pendingText="Creando…">Crear cuenta</SubmitButton>
    </form>
  );
}

export function AccountActions({ account, isSelf }: { account: Profile; isSelf: boolean }) {
  const [resetState, resetAction] = useActionState<AdminFormState, FormData>(resetPassword, {});
  const [activeState, activeAction] = useActionState<AdminFormState, FormData>(setAccountActive, {});
  const resetRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetState.nonce) resetRef.current?.reset();
  }, [resetState.nonce]);

  return (
    <div className="stack">
      <form ref={resetRef} action={resetAction} className="stack" aria-label={`Restablecer contraseña de ${account.email}`}>
        <input type="hidden" name="user_id" value={account.id} />
        <FormMessage error={resetState.error} message={resetState.message} />
        <TempPassword state={resetState} />
        <label className="field">
          <span>Nueva contraseña temporal</span>
          <input className="input" type="text" name="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="off" placeholder="Vacío = generar una segura" />
        </label>
        <SubmitButton className="btn" pendingText="Restableciendo…">Restablecer contraseña</SubmitButton>
      </form>
      <form
        action={activeAction}
        className="stack"
        onSubmit={(e) => {
          if (account.is_active && !window.confirm(`¿Desactivar la cuenta de ${account.email}? Perderá el acceso de inmediato.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="user_id" value={account.id} />
        <input type="hidden" name="active" value={account.is_active ? "false" : "true"} />
        <FormMessage error={activeState.error} message={activeState.message} />
        {isSelf ? (
          <p className="hint">No puedes desactivar tu propia cuenta.</p>
        ) : (
          <SubmitButton className={account.is_active ? "btn btn-danger" : "btn btn-primary"} pendingText="Guardando…">
            {account.is_active ? "Desactivar cuenta" : "Activar cuenta"}
          </SubmitButton>
        )}
      </form>
    </div>
  );
}
