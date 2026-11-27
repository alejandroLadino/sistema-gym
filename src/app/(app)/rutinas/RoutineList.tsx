"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { startRoutine } from "@/app/actions/routines";
import { IconPlus } from "@/components/icons";
import { todayLocal } from "@/lib/format";
import { inProgressToday, type HomeSession } from "@/lib/home";
import { formatTarget, routineUsage, targetOfRow, type Routine } from "@/lib/routines";
import { uuidv4 } from "@/lib/uuid";

type Props = { routines: Routine[]; sessions: HomeSession[]; serverToday: string; notice?: string };

const noop = () => () => {};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function RoutineList({ routines, sessions, serverToday, notice }: Props) {
  const router = useRouter();
  // «Hoy» es la fecha local del dispositivo.
  const today = useSyncExternalStore(noop, () => todayLocal(), () => serverToday);
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

  return (
    <div className="stack routines">
      <Link href="/" className="back-link">‹ Inicio</Link>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h1>Mis rutinas</h1>
        <Link href="/rutinas/nueva" className="btn btn-primary btn-sm">
          <IconPlus /> Nueva rutina
        </Link>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Plantillas para empezar un entrenamiento con tus ejercicios en orden. Las metas son solo una guía.
      </p>
      {notice ? <p className="alert alert-success" role="status" style={{ margin: 0 }}>{notice}</p> : null}

      {routines.length === 0 ? (
        <div className="card empty stack">
          <p style={{ margin: 0 }}>Todavía no tienes rutinas.</p>
          <Link href="/rutinas/nueva" className="btn btn-primary">Crear rutina</Link>
          <p className="small" style={{ margin: 0 }}>
            También puedes guardar una sesión finalizada como rutina desde su menú «⋯».
          </p>
        </div>
      ) : (
        <ul className="list" aria-label="Rutinas">
          {routines.map((r) => {
            const usage = routineUsage(r);
            return (
              <li key={r.id} className="card routine-card" aria-label={r.name}>
                <div className="routine-card-head">
                  <h2>{r.name}</h2>
                  <span className="muted small">{plural(r.exercises.length, "ejercicio", "ejercicios")}</span>
                </div>
                <ol className="routine-card-exercises">
                  {r.exercises.map((e) => {
                    const goal = formatTarget(targetOfRow(e));
                    return (
                      <li key={e.exercise_id}>
                        <span>{e.name}</span>
                        {goal ? <span className="muted"> · {goal}</span> : null}
                        {e.archived ? <span className="badge badge-warning">Archivado</span> : null}
                      </li>
                    );
                  })}
                </ol>
                {usage.omitted.length ? (
                  <p className="small routine-warning" style={{ margin: 0 }}>
                    {usage.usable
                      ? `Se omitirá al usarla: ${usage.omitted.join(", ")} (archivado).`
                      : "Todos sus ejercicios están archivados. Edítala para usarla."}
                  </p>
                ) : null}
                <div className="routine-card-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => askUse(r)}
                    disabled={starting !== null}
                    aria-label={`Usar rutina ${r.name}`}
                  >
                    {starting === r.id ? "Iniciando…" : "Usar rutina"}
                  </button>
                  <Link href={`/rutinas/${r.id}`} className="btn" aria-label={`Editar rutina ${r.name}`}>
                    Editar
                  </Link>
                </div>
                {error?.id === r.id ? <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{error.text}</p> : null}
              </li>
            );
          })}
        </ul>
      )}

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
    </div>
  );
}
