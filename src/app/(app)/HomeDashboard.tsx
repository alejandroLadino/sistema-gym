"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { repeatSession } from "@/app/actions/sessions";
import { IconCalendar, IconCheck, IconChevronRight, IconList, IconPlus } from "@/components/icons";
import { formatDate, formatLongDate, todayLocal } from "@/lib/format";
import {
  inProgressToday,
  otherInProgress,
  primaryAction,
  recentFinished,
  weekSummary,
  type HomeSession,
} from "@/lib/home";
import { hasUnsavedNewDraft } from "@/lib/session-draft";
import { uuidv4 } from "@/lib/uuid";

type Props = { userId: string; firstName: string; serverToday: string; sessions: HomeSession[] };

const noop = () => () => {};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const DAY_LETTERS = ["L", "M", "X", "J", "V", "S", "D"];
const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function counts(s: HomeSession) {
  return `${plural(s.exercise_count, "ejercicio", "ejercicios")} · ${plural(s.set_count, "serie", "series")}`;
}

export function HomeDashboard({ userId, firstName, serverToday, sessions }: Props) {
  const router = useRouter();
  // «Hoy» es la fecha local del dispositivo; el servidor solo da un valor inicial.
  const today = useSyncExternalStore(noop, () => todayLocal(), () => serverToday);
  const localDraft = useSyncExternalStore(noop, () => hasUnsavedNewDraft(userId), () => false);

  const primary = primaryAction(sessions, today, localDraft);
  const others = otherInProgress(sessions, primary);
  const week = weekSummary(sessions, today);
  const recent = recentFinished(sessions, 3);
  const current = inProgressToday(sessions, today);

  // «Repetir ejercicios»: confirmación si ya hay una sesión en curso hoy; sin duplicados.
  const [confirmFor, setConfirmFor] = useState<HomeSession | null>(null);
  const [repeating, setRepeating] = useState<string | null>(null);
  const [repeatError, setRepeatError] = useState<{ id: string; text: string } | null>(null);
  const busy = useRef(false);
  const pendingIds = useRef(new Map<string, string>()); // origen → id nuevo (reintentos sin duplicar)

  async function doRepeat(source: HomeSession) {
    if (busy.current) return;
    busy.current = true;
    setConfirmFor(null);
    setRepeating(source.id);
    setRepeatError(null);
    const newId = pendingIds.current.get(source.id) ?? uuidv4();
    pendingIds.current.set(source.id, newId);
    try {
      const res = await repeatSession(source.id, newId, today);
      if (!res.ok) {
        setRepeatError({ id: source.id, text: res.error });
        return;
      }
      pendingIds.current.delete(source.id);
      const sp = new URLSearchParams({ repetida: source.session_date });
      if (res.data.omitted.length) sp.set("omitidos", JSON.stringify(res.data.omitted));
      router.push(`/sesiones/${res.data.id}?${sp}`);
    } catch {
      setRepeatError({ id: source.id, text: "Sin conexión con el servidor. Reintenta." });
    } finally {
      busy.current = false;
      setRepeating(null);
    }
  }

  function askRepeat(source: HomeSession) {
    if (current) setConfirmFor(source);
    else void doRepeat(source);
  }

  return (
    <div className="stack-lg home">
      <section className="stack" style={{ gap: 10 }} aria-labelledby="hoy-titulo">
        <h1 style={{ margin: 0 }}>{firstName ? `Hola, ${firstName}` : "Hola"}</h1>

        <div className="card today-card">
          <p className="today-date" id="hoy-titulo">
            <IconCalendar />
            <span>
              <span className="sr-only">Entrenamiento de hoy, </span>
              {capitalize(formatLongDate(today))}
            </span>
          </p>

          {primary.kind === "continue" ? (
            <>
              <p className="today-state">
                <span className="badge badge-warning">En curso</span> {counts(primary.session)}
              </p>
              <Link href={`/sesiones/${primary.session.id}`} className="btn btn-primary btn-lg btn-block">
                Continuar entrenamiento
              </Link>
            </>
          ) : primary.kind === "continue-draft" ? (
            <>
              <p className="today-state">
                <span className="badge badge-warning">En curso</span> Sin guardar en este dispositivo
              </p>
              <Link href="/entrenar" className="btn btn-primary btn-lg btn-block">
                Continuar entrenamiento
              </Link>
            </>
          ) : primary.kind === "review" ? (
            <>
              <p className="today-state">
                <span className="badge badge-success">Finalizado</span> {counts(primary.session)}
              </p>
              <Link href={`/sesiones/${primary.session.id}`} className="btn btn-primary btn-lg btn-block">
                Ver entrenamiento de hoy
              </Link>
              <Link href="/entrenar" className="btn btn-block">
                <IconPlus /> Nueva sesión
              </Link>
            </>
          ) : (
            <>
              <p className="today-state muted">Aún no registras un entrenamiento hoy.</p>
              <Link href="/entrenar" className="btn btn-primary btn-lg btn-block">
                <IconPlus /> Iniciar entrenamiento
              </Link>
            </>
          )}

          {others.length ? (
            <p className="small muted" style={{ margin: 0 }}>
              {others.length === 1 ? "Tienes otra sesión sin finalizar." : `Tienes ${others.length} sesiones más sin finalizar.`}{" "}
              <Link href="/historial">Ver historial</Link>
            </p>
          ) : null}
        </div>
        <Link href="/rutinas" className="card routines-link">
          <span className="routines-link-icon" aria-hidden="true"><IconList /></span>
          <span className="routines-link-text">
            <strong>Mis rutinas</strong>
            <span className="muted small">Empieza con una plantilla de ejercicios</span>
          </span>
          <span className="catalog-row-chevron" aria-hidden="true"><IconChevronRight /></span>
        </Link>
      </section>

      <section className="stack" style={{ gap: 10 }} aria-labelledby="semana-titulo">
        <div className="row between">
          <h2 id="semana-titulo" style={{ margin: 0 }}>Esta semana</h2>
          <span className="muted small">{plural(week.total, "sesión finalizada", "sesiones finalizadas")}</span>
        </div>
        <ol className="week-strip card" aria-label="Días de esta semana">
          {week.days.map((d, i) => {
            const day = Number(d.date.slice(8));
            const status = d.trained ? `entrenado${d.sessions > 1 ? ` (${d.sessions} sesiones)` : ""}` : "sin entrenamiento";
            return (
              <li
                key={d.date}
                className="week-day"
                data-trained={d.trained || undefined}
                data-today={d.isToday || undefined}
                aria-current={d.isToday ? "date" : undefined}
              >
                <span className="sr-only">
                  {DAY_NAMES[i]} {day}
                  {d.isToday ? ", hoy" : ""}: {status}
                </span>
                <span aria-hidden="true" className="week-letter">{DAY_LETTERS[i]}</span>
                <span aria-hidden="true" className="week-dot">{d.trained ? <IconCheck /> : day}</span>
                <span aria-hidden="true" className="week-label">{d.isToday ? "Hoy" : ""}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="stack" style={{ gap: 10 }} aria-labelledby="recientes-titulo">
        <div className="row between">
          <h2 id="recientes-titulo" style={{ margin: 0 }}>Sesiones recientes</h2>
          <Link href="/historial" className="small">Ver historial</Link>
        </div>
        {recent.length === 0 ? (
          <div className="card empty">Aún no tienes sesiones finalizadas.</div>
        ) : (
          <ul className="list" aria-label="Sesiones recientes">
            {recent.map((s) => (
              <li key={s.id} className="card recent-card">
                <Link href={`/sesiones/${s.id}`} className="recent-link">
                  <strong>{formatDate(s.session_date)}</strong>
                  <span className="muted small">{s.muscle_groups.length ? s.muscle_groups.join(" · ") : "Sin ejercicios"}</span>
                  <span className="small">{counts(s)}</span>
                </Link>
                <div className="recent-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => askRepeat(s)}
                    disabled={repeating !== null}
                    aria-label={`Repetir ejercicios de la sesión del ${formatDate(s.session_date)}`}
                  >
                    {repeating === s.id ? "Creando…" : "Repetir ejercicios"}
                  </button>
                </div>
                {repeatError?.id === s.id ? (
                  <p className="alert alert-error" role="alert" style={{ margin: 0 }}>{repeatError.text}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirmFor && current ? (
        <div className="sheet-backdrop" onClick={() => setConfirmFor(null)}>
          <div
            className="sheet stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="repetir-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="repetir-titulo" style={{ margin: 0 }}>Ya tienes un entrenamiento en curso hoy</h2>
            <p className="muted" style={{ margin: 0 }}>
              {counts(current)}. Puedes continuarlo o iniciar otra sesión con los ejercicios del {formatDate(confirmFor.session_date, { weekday: false })}.
            </p>
            <Link href={`/sesiones/${current.id}`} className="btn btn-primary btn-block">
              Continuar entrenamiento
            </Link>
            <button type="button" className="btn btn-block" onClick={() => void doRepeat(confirmFor)}>
              Iniciar otra sesión
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setConfirmFor(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
