"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { IconPlus } from "@/components/icons";
import { todayLocal } from "@/lib/format";
import type { HomeSession } from "@/lib/home";
import { formatTarget, routineUsage, targetOfRow, type Routine } from "@/lib/routines";
import { useRoutineStarter } from "./useRoutineStarter";

type Props = { routines: Routine[]; sessions: HomeSession[]; serverToday: string; notice?: string };

const noop = () => () => {};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function RoutineList({ routines, sessions, serverToday, notice }: Props) {
  // «Hoy» es la fecha local del dispositivo.
  const today = useSyncExternalStore(noop, () => todayLocal(), () => serverToday);
  const { askUse, starting, error, dialogs } = useRoutineStarter({ sessions, today });

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
                        {e.alt_group != null ? <span className="muted"> · ⇄ alternada</span> : null}
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

      {dialogs}
    </div>
  );
}
