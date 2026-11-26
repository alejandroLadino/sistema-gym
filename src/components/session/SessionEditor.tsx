"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteSession, getPreviousSets, saveSession } from "@/app/actions/sessions";
import { IconCopy, IconDown, IconPlus, IconTrash, IconUp } from "@/components/icons";
import { formatDate, formatSet, todayLocal } from "@/lib/format";
import {
  clearNewPointer,
  copyPreviousSets,
  draftToPayload,
  isSetBlank,
  newKey,
  nextSet,
  readNewPointer,
  readStoredDraft,
  removeStoredDraft,
  sessionToDraft,
  writeNewPointer,
  writeStoredDraft,
  type Draft,
  type DraftExercise,
  type DraftSet,
} from "@/lib/session-draft";
import type { Exercise, PreviousSets, SessionData } from "@/lib/types";
import { uuidv4 } from "@/lib/uuid";
import { ExercisePicker } from "./ExercisePicker";

type Status = "empty" | "dirty" | "invalid" | "saving" | "saved" | "error";

type Props = {
  userId: string;
  exercises: Exercise[];
  /** Sesión existente (edición). Sin ella se crea una nueva. */
  initial?: SessionData;
};

const AUTOSAVE_MS = 1200;

const STATUS_TEXT: Record<Status, string> = {
  empty: "Agrega un ejercicio para empezar",
  dirty: "Sin guardar",
  invalid: "Faltan datos",
  saving: "Guardando…",
  saved: "Guardado",
  error: "No se guardó",
};

export function SessionEditor({ userId, exercises, initial }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catalog, setCatalog] = useState<Exercise[]>(exercises);
  const [status, setStatus] = useState<Status>(initial ? "saved" : "empty");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previous, setPrevious] = useState<Record<string, Record<string, PreviousSets | null>>>({});
  const [prevError, setPrevError] = useState(false);

  const draftRef = useRef<Draft | null>(null);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const savedOnce = useRef(Boolean(initial));
  const inFlight = useRef(false);
  const queued = useRef(false);
  const blocked = useRef(false); // tras eliminar/descartar
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);

  // --- Carga inicial: servidor + borrador local --------------------------------
  /* eslint-disable react-hooks/set-state-in-effect -- inicialización en el cliente: fecha local y localStorage */
  useEffect(() => {
    // Solo una vez: un refresco del servidor no debe pisar lo que se está escribiendo.
    if (initialized.current) return;
    initialized.current = true;
    let loaded: Draft;
    let pending = false;
    if (initial) {
      const stored = readStoredDraft(initial.id, userId);
      if (stored?.dirty && stored.draft.editedAt > Date.parse(initial.updated_at)) {
        loaded = stored.draft;
        pending = true;
        setNotice("Recuperamos cambios que no se habían guardado en este dispositivo.");
      } else {
        loaded = sessionToDraft(initial);
        if (stored) removeStoredDraft(initial.id);
      }
    } else {
      const pointer = readNewPointer(userId);
      const stored = pointer ? readStoredDraft(pointer, userId) : null;
      if (stored) {
        loaded = stored.draft;
        pending = stored.dirty;
        savedOnce.current = stored.savedOnce;
        setNotice("Continuamos con tu entrenamiento en curso.");
        if (stored.savedOnce) window.history.replaceState(null, "", `/sesiones/${loaded.id}`);
      } else {
        loaded = { id: uuidv4(), date: todayLocal(), notes: "", exercises: [], editedAt: Date.now() };
        writeNewPointer(loaded.id, userId);
      }
    }
    if (pending) revision.current = 1;
    draftRef.current = loaded;
    setDraft(loaded);
  }, [initial, userId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // --- Guardado -----------------------------------------------------------------
  const save = useCallback(
    async (explicit = false): Promise<boolean> => {
      const current = draftRef.current;
      if (!current || blocked.current) return false;
      if (timer.current) clearTimeout(timer.current);
      if (inFlight.current) {
        queued.current = true;
        return false;
      }
      const result = draftToPayload(current);
      if (!result.ok) {
        if (explicit) setShowErrors(true);
        setStatus(current.exercises.length === 0 ? "empty" : "invalid");
        if (explicit && result.errors.general) setErrorMsg(result.errors.general);
        return false;
      }

      const rev = revision.current;
      inFlight.current = true;
      setStatus("saving");
      setErrorMsg(null);
      let ok = false;
      try {
        const res = await saveSession(result.payload);
        ok = res.ok;
        if (!res.ok) setErrorMsg(res.error);
      } catch {
        setErrorMsg("Sin conexión con el servidor. Lo capturado sigue en este dispositivo.");
      }
      inFlight.current = false;
      if (blocked.current) return false;

      if (ok) {
        savedRevision.current = Math.max(savedRevision.current, rev);
        if (!savedOnce.current) {
          savedOnce.current = true;
          window.history.replaceState(null, "", `/sesiones/${current.id}`);
        }
        clearNewPointer(current.id);
        if (revision.current === savedRevision.current) {
          removeStoredDraft(current.id);
          setStatus("saved");
          setShowErrors(false);
        } else {
          queued.current = true;
        }
      } else {
        setStatus("error");
      }

      if (queued.current) {
        queued.current = false;
        if (ok) void save();
      }
      return ok && revision.current === savedRevision.current;
    },
    [],
  );

  // Persistencia local + autoguardado tras cada cambio.
  useEffect(() => {
    if (!draft || blocked.current) return;
    const dirty = revision.current !== savedRevision.current;
    if (!dirty) return;
    writeStoredDraft({ draft, dirty: true, savedOnce: savedOnce.current, ownerId: userId });
    if (!savedOnce.current) writeNewPointer(draft.id, userId);

    const check = draftToPayload(draft);
    if (!check.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- refleja la validación del borrador
      setStatus(draft.exercises.length === 0 ? "empty" : "invalid");
      return;
    }
    setStatus((s) => (s === "saving" ? s : "dirty"));
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, save, userId]);

  // Reintento automático al recuperar la conexión.
  useEffect(() => {
    const onOnline = () => {
      if (revision.current !== savedRevision.current) void save();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [save]);

  const update = useCallback((fn: (d: Draft) => Draft) => {
    const current = draftRef.current;
    if (!current) return;
    const next = { ...fn(current), editedAt: Date.now() };
    draftRef.current = next;
    revision.current += 1;
    setDraft(next);
  }, []);

  // --- Series de la sesión anterior --------------------------------------------
  const exerciseIds = useMemo(
    () => Array.from(new Set(draft?.exercises.map((e) => e.exerciseId) ?? [])),
    [draft?.exercises],
  );
  const date = draft?.date ?? "";
  const sessionId = draft?.id ?? null;
  const prevForDate = previous[date];
  const missingKey = exerciseIds.filter((id) => !prevForDate || !(id in prevForDate)).join(",");

  useEffect(() => {
    if (!missingKey || !date || !sessionId) return;
    const ids = missingKey.split(",");
    let cancelled = false;
    getPreviousSets(ids, date, sessionId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setPrevError(true);
          return;
        }
        setPrevError(false);
        setPrevious((p) => {
          const forDate = { ...(p[date] ?? {}) };
          for (const id of ids) forDate[id] = res.data[id] ?? null;
          return { ...p, [date]: forDate };
        });
      })
      .catch(() => !cancelled && setPrevError(true));
    return () => {
      cancelled = true;
    };
  }, [missingKey, date, sessionId]);

  // --- Acciones del usuario ------------------------------------------------------
  const addExercise = (exercise: Exercise) => {
    setPickerOpen(false);
    update((d) => ({
      ...d,
      exercises: [
        ...d.exercises,
        { key: newKey(), exerciseId: exercise.id, name: exercise.name, sets: [{ key: newKey(), reps: "", weight: "" }] },
      ],
    }));
  };

  const updateExercise = (key: string, fn: (e: DraftExercise) => DraftExercise) =>
    update((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? fn(e) : e)) }));

  const updateSet = (exKey: string, setKey: string, patch: Partial<DraftSet>) =>
    updateExercise(exKey, (e) => ({ ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) }));

  const moveExercise = (index: number, delta: number) =>
    update((d) => {
      const list = [...d.exercises];
      const target = index + delta;
      if (target < 0 || target >= list.length) return d;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...d, exercises: list };
    });

  const removeExercise = (ex: DraftExercise) => {
    if (ex.sets.some((s) => !isSetBlank(s)) && !window.confirm(`¿Quitar ${ex.name} de esta sesión?`)) return;
    update((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== ex.key) }));
  };

  const copyPrevious = (ex: DraftExercise, prev: PreviousSets) => {
    const hasData = ex.sets.some((s) => !isSetBlank(s));
    if (hasData && !window.confirm("Se añadirán las series anteriores a las que ya escribiste. ¿Continuar?")) return;
    updateExercise(ex.key, (e) => ({ ...e, sets: copyPreviousSets(e.sets, prev.sets) }));
  };

  async function finish() {
    if (!draft) return;
    if (draft.exercises.length === 0 && !savedOnce.current) {
      discard();
      return;
    }
    if (revision.current !== savedRevision.current || status === "error") {
      const ok = await save(true);
      if (!ok) return;
    }
    router.push("/historial");
    router.refresh();
  }

  function discard() {
    if (!draft) return;
    const hasData = draft.exercises.length > 0;
    if (hasData && !window.confirm("¿Descartar este entrenamiento sin guardar?")) return;
    blocked.current = true;
    removeStoredDraft(draft.id);
    clearNewPointer(draft.id);
    router.push("/");
  }

  async function remove() {
    if (!draft || !window.confirm("¿Eliminar esta sesión? No se puede deshacer.")) return;
    blocked.current = true;
    if (timer.current) clearTimeout(timer.current);
    removeStoredDraft(draft.id);
    clearNewPointer(draft.id);
    const fd = new FormData();
    fd.set("id", draft.id);
    await deleteSession(fd);
  }

  if (!draft) {
    return <p className="muted" aria-live="polite">Cargando entrenamiento…</p>;
  }

  const validation = draftToPayload(draft);
  const setErrors = !validation.ok && showErrors ? validation.errors.sets : {};
  const inSession = new Set(exerciseIds);
  const isNew = !savedOnce.current;

  return (
    <div>
      <div className="save-bar">
        <span className="save-status" data-state={status} role="status" aria-live="polite">
          <span className="dot" aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          {status === "error" ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void save(true)}>
              Reintentar
            </button>
          ) : status === "dirty" || status === "invalid" ? (
            <button type="button" className="btn btn-sm" onClick={() => void save(true)}>
              Guardar
            </button>
          ) : null}
          <button type="button" className="btn btn-sm btn-primary" onClick={finish} disabled={status === "saving"}>
            Terminar
          </button>
        </div>
      </div>

      <div className="stack">
        <h1>{isNew ? "Registrar entrenamiento" : "Sesión de entrenamiento"}</h1>
        {notice ? <p className="alert alert-info" role="status">{notice}</p> : null}
        {status === "error" && errorMsg ? (
          <p className="alert alert-error" role="alert">
            {errorMsg} Tus datos siguen aquí; pulsa «Reintentar».
          </p>
        ) : errorMsg && showErrors ? (
          <p className="alert alert-error" role="alert">{errorMsg}</p>
        ) : null}

        <label className="field">
          <span>Fecha del entrenamiento</span>
          <input
            className="input"
            type="date"
            value={draft.date}
            required
            onChange={(e) => e.target.value && update((d) => ({ ...d, date: e.target.value }))}
          />
        </label>

        {draft.exercises.map((ex, index) => {
          const prev = prevForDate?.[ex.exerciseId];
          return (
            <section key={ex.key} className="card exercise-card" aria-label={ex.name}>
              <div className="ex-head">
                <div>
                  <h3>{ex.name}</h3>
                  {ex.archived ? <span className="badge">Archivado</span> : null}
                </div>
                <div className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`Subir ${ex.name}`} onClick={() => moveExercise(index, -1)} disabled={index === 0}>
                    <IconUp />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`Bajar ${ex.name}`} onClick={() => moveExercise(index, 1)} disabled={index === draft.exercises.length - 1}>
                    <IconDown />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon" aria-label={`Quitar ${ex.name}`} onClick={() => removeExercise(ex)}>
                    <IconTrash />
                  </button>
                </div>
              </div>

              <div className="previous" aria-live="polite">
                {prev === undefined ? (
                  <span className="muted">{prevError ? "No se pudo cargar la sesión anterior." : "Buscando tu sesión anterior…"}</span>
                ) : prev === null ? (
                  <span className="muted">Sin registros antes del {formatDate(draft.date, { weekday: false })}.</span>
                ) : (
                  <>
                    <div className="row between">
                      <span>
                        <strong>Anterior:</strong>{" "}
                        <Link href={`/sesiones/${prev.session_id}`}>{formatDate(prev.session_date)}</Link>
                      </span>
                      <button type="button" className="btn btn-sm" onClick={() => copyPrevious(ex, prev)}>
                        <IconCopy /> Copiar series
                      </button>
                    </div>
                    <div className="sets-chips">
                      {prev.sets.map((s, i) => (
                        <span key={i} className="chip">{formatSet(s)}</span>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="set-table">
                {ex.sets.map((set, i) => (
                  <div key={set.key}>
                    <div className="set-row">
                      <span className="num" aria-hidden="true">{i + 1}</span>
                      <label className="field">
                        <span>Peso (kg)</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="—"
                          aria-label={`Peso serie ${i + 1} de ${ex.name} (kg, vacío si es peso corporal)`}
                          aria-invalid={setErrors[set.key] ? true : undefined}
                          value={set.weight}
                          onChange={(e) => updateSet(ex.key, set.key, { weight: e.target.value })}
                          enterKeyHint="next"
                        />
                      </label>
                      <label className="field">
                        <span>Reps</span>
                        <input
                          className="input"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          placeholder="0"
                          aria-label={`Repeticiones serie ${i + 1} de ${ex.name}`}
                          aria-invalid={setErrors[set.key] ? true : undefined}
                          value={set.reps}
                          onChange={(e) => updateSet(ex.key, set.key, { reps: e.target.value })}
                          enterKeyHint="done"
                        />
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        aria-label={`Quitar serie ${i + 1} de ${ex.name}`}
                        onClick={() => updateExercise(ex.key, (e) => ({ ...e, sets: e.sets.filter((s) => s.key !== set.key) }))}
                      >
                        <IconTrash />
                      </button>
                    </div>
                    {setErrors[set.key] ? <div className="set-row"><span /><span className="set-error">{setErrors[set.key]}</span></div> : null}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-block"
                style={{ marginTop: 10 }}
                onClick={() => updateExercise(ex.key, (e) => ({ ...e, sets: [...e.sets, nextSet(e.sets)] }))}
              >
                <IconPlus /> Agregar serie
              </button>
            </section>
          );
        })}

        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setPickerOpen(true)}>
          <IconPlus /> Agregar ejercicio
        </button>

        <details className="disclosure">
          <summary>Notas de la sesión</summary>
          <label className="field">
            <span className="sr-only">Notas</span>
            <textarea
              className="input"
              maxLength={2000}
              value={draft.notes}
              onChange={(e) => update((d) => ({ ...d, notes: e.target.value }))}
              placeholder="Cómo te sentiste, molestias, etc."
            />
          </label>
        </details>

        <div className="row" style={{ marginTop: 8 }}>
          {isNew ? (
            <button type="button" className="btn btn-ghost" onClick={discard}>Descartar</button>
          ) : (
            <button type="button" className="btn btn-danger" onClick={remove}>
              <IconTrash /> Eliminar sesión
            </button>
          )}
        </div>
      </div>

      {pickerOpen ? (
        <ExercisePicker
          exercises={catalog}
          inSession={inSession}
          onClose={() => setPickerOpen(false)}
          onPick={addExercise}
          onCreated={(exercise) => {
            setCatalog((c) => [...c, exercise]);
            addExercise(exercise);
          }}
        />
      ) : null}
    </div>
  );
}
