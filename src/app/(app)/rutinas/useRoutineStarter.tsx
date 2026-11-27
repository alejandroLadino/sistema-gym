"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { startRoutine } from "@/app/actions/routines";
import { inProgressToday, type HomeSession } from "@/lib/home";
import { routineUsage, type Routine } from "@/lib/routines";
import { uuidv4 } from "@/lib/uuid";

/**
 * «Usar rutina» compartido por «Mis rutinas» e Inicio: crea la sesión en curso de
 * hoy (fecha local `today`), sin duplicados por doble toque o reintento; ofrece
 * continuar la sesión en curso, avisa de los ejercicios archivados y bloquea la
 * rutina si todos lo están.
 */
export function useRoutineStarter({ sessions, today }: { sessions: HomeSession[]; today: string }) {
  const router = useRouter();
  const current = inProgressToday(sessions, today);
  const [confirmFor, setConfirmFor] = useState<Routine | null>(null);
  const [blockedFor, setBlockedFor] = useState<Routine | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const busy = useRef(false);
  // Rutina → id de la sesión nueva: un reintento reutiliza el mismo id (sin duplicados).
  const pendingIds = useRef(new Map<string, string>());

  async function start(r: Routine) {
    if (busy.current) return;
    busy.current = true;
    setConfirmFor(null);
    setStarting(r.id);
    setError(null);
    const sessionId = pendingIds.current.get(r.id) ?? uuidv4();
    pendingIds.current.set(r.id, sessionId);
    try {
      const res = await startRoutine(r.id, sessionId, today);
      if (!res.ok) {
        setError({ id: r.id, text: res.error });
        return;
      }
      pendingIds.current.delete(r.id);
      const sp = new URLSearchParams({ rutina: r.name });
      if (res.data.omitted.length) sp.set("omitidos", JSON.stringify(res.data.omitted));
      router.push(`/sesiones/${res.data.id}?${sp}`);
    } catch {
      setError({ id: r.id, text: "Sin conexión con el servidor. Reintenta." });
    } finally {
      busy.current = false;
      setStarting(null);
    }
  }

  function askUse(r: Routine) {
    const usage = routineUsage(r);
    if (!usage.usable) setBlockedFor(r);
    else if (current || usage.omitted.length) setConfirmFor(r);
    else void start(r);
  }

  const confirmUsage = confirmFor ? routineUsage(confirmFor) : null;

  const dialogs = (
    <>
      {confirmFor && confirmUsage ? (
        <div className="sheet-backdrop" onClick={() => setConfirmFor(null)}>
          <div className="sheet stack" role="dialog" aria-modal="true" aria-labelledby="usar-titulo" onClick={(e) => e.stopPropagation()}>
            <h2 id="usar-titulo" style={{ margin: 0 }}>
              {current ? "Ya tienes un entrenamiento en curso hoy" : "Algunos ejercicios están archivados"}
            </h2>
            {current ? (
              <p className="muted" style={{ margin: 0 }}>
                Puedes continuarlo o iniciar otra sesión con «{confirmFor.name}».
              </p>
            ) : null}
            {confirmUsage.omitted.length ? (
              <p className="alert alert-warning" style={{ margin: 0 }}>
                Se omitirán por estar archivados: {confirmUsage.omitted.join(", ")}.
              </p>
            ) : null}
            {current ? (
              <>
                <Link href={`/sesiones/${current.id}`} className="btn btn-primary btn-block">Continuar sesión</Link>
                <button type="button" className="btn btn-block" onClick={() => void start(confirmFor)}>
                  Iniciar otra con esta rutina
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary btn-block" onClick={() => void start(confirmFor)}>
                Iniciar sesión
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirmFor(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}

      {blockedFor ? (
        <div className="sheet-backdrop" onClick={() => setBlockedFor(null)}>
          <div className="sheet stack" role="dialog" aria-modal="true" aria-labelledby="bloqueada-titulo" onClick={(e) => e.stopPropagation()}>
            <h2 id="bloqueada-titulo" style={{ margin: 0 }}>No se puede usar esta rutina</h2>
            <p className="muted" style={{ margin: 0 }}>
              Todos los ejercicios de «{blockedFor.name}» están archivados. Edita la rutina para quitarlos o reemplazarlos.
            </p>
            <Link href={`/rutinas/${blockedFor.id}`} className="btn btn-primary btn-block">Editar rutina</Link>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setBlockedFor(null)}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </>
  );

  return { askUse, starting, error, dialogs };
}
