"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteSession, finishSession, getPreviousSets, saveSession } from "@/app/actions/sessions";
import { IconCalendar, IconChevronDown, IconCopy, IconPlus, IconTrash } from "@/components/icons";
import { formatDate, summarizeSets, todayLocal } from "@/lib/format";
import { historyHref } from "@/lib/history-query";
import {
  appendSets,
  clearNewPointer,
  exerciseSummary,
  copyPreviousSets,
  draftToPayload,
  hasNoSets,
  isSetBlank,
  newKey,
  nextSet,
  readNewPointer,
  readStoredDraft,
  removeStoredDraft,
  resolveStoredDraft,
  sessionToDraft,
  writeNewPointer,
  writeStoredDraft,
  type Draft,
  type DraftExercise,
  type DraftSet,
} from "@/lib/session-draft";
import type { Exercise, MuscleGroup, PreviousSets, SessionData } from "@/lib/types";
import { uuidv4 } from "@/lib/uuid";
import { ExercisePicker } from "./ExercisePicker";
import { CardMenu } from "./CardMenu";
import { QuickAddSets, quickRepsInputId } from "./QuickAddSets";

type Status = "empty" | "dirty" | "invalid" | "saving" | "saved" | "error";

type Props = {
  userId: string;
  exercises: Exercise[];
  muscleGroups: MuscleGroup[];
  /** Sesión existente (edición). Sin ella se crea una nueva. */
  initial?: SessionData;
  /** Aviso al abrir (p. ej., sesión creada con «Repetir ejercicios»). */
  initialNotice?: string;
};

const AUTOSAVE_MS = 1200;

const STATUS_TEXT: Record<Status, string> = {
  empty: "Sin ejercicios",
  dirty: "Sin guardar",
  invalid: "Faltan datos",
  saving: "Guardando…",
  saved: "Guardado",
  error: "No se guardó",
};

export function SessionEditor({ userId, exercises, muscleGroups, initial, initialNotice }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [catalog, setCatalog] = useState<Exercise[]>(exercises);
  const [status, setStatus] = useState<Status>(initial ? "saved" : "empty");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  /** Finalizada (persistido en el servidor). Corregir una sesión finalizada no la reabre. */
  const [finished, setFinished] = useState(Boolean(initial?.finished_at));
  const [finishing, setFinishing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previous, setPrevious] = useState<Record<string, Record<string, PreviousSets | null>>>({});
  const [prevError, setPrevError] = useState(false);
  /** Captura rápida abierta en ejercicios que ya tienen series (en los vacíos siempre se muestra). */
  const [quickOpen, setQuickOpen] = useState<Record<string, boolean>>({});
  /** Copia local vacía que contradice la sesión finalizada guardada (se muestra la del servidor). */
  const [localConflict, setLocalConflict] = useState(false);
  /** Diálogo al quitar el único ejercicio de una sesión finalizada. */
  const [lastExercise, setLastExercise] = useState<DraftExercise | null>(null);
  /** Ejercicio que se reemplaza con el selector (null = el selector agrega). */
  const [replaceTarget, setReplaceTarget] = useState<DraftExercise | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Ejercicios colapsados (solo muestran nombre y resumen). */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const draftRef = useRef<Draft | null>(null);
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const savedOnce = useRef(Boolean(initial));
  const inFlight = useRef(false);
  const queued = useRef(false);
  const blocked = useRef(false); // tras eliminar/descartar
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialized = useRef(false);
  /** Tarjeta recién agregada que hay que llevar a la vista. */
  const scrollTarget = useRef<string | null>(null);

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
      const source = resolveStoredDraft(initial, stored);
      if (source === "local" && stored) {
        loaded = stored.draft;
        pending = true;
        setNotice("Recuperamos cambios que no se habían guardado en este dispositivo.");
      } else {
        loaded = sessionToDraft(initial);
        // La copia en conflicto se conserva hasta que la persona la descarte.
        if (source === "conflict") setLocalConflict(true);
        else if (stored) removeStoredDraft(initial.id);
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
    // El aviso de «Repetir ejercicios» llega por la URL: se limpia para que no reaparezca al recargar.
    if (initialNotice) window.history.replaceState(null, "", window.location.pathname);
    // Al entrar a una sesión, todas las tarjetas empiezan cerradas.
    setCollapsed(Object.fromEntries(loaded.exercises.map((e) => [e.key, true])));
  }, [initial, userId, initialNotice]);
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
      // Una sesión nueva sin ejercicios no se crea en el servidor; una ya guardada
      // (en curso) sí puede quedar vacía.
      if (!savedOnce.current && current.exercises.length === 0) {
        setStatus("empty");
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

    if (!savedOnce.current && draft.exercises.length === 0) {
      setStatus("empty");
      return;
    }
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
    // Doble toque o reintento: un ejercicio ya presente no se agrega otra vez.
    if (draftRef.current?.exercises.some((e) => e.exerciseId === exercise.id)) return;
    // El nuevo ejercicio queda abierto (y a la vista); los demás se colapsan.
    const existing = draftRef.current?.exercises ?? [];
    setCollapsed(Object.fromEntries(existing.map((e) => [e.key, true])));
    const key = newKey();
    scrollTarget.current = key;
    update((d) => ({
      ...d,
      exercises: [...d.exercises, { key, exerciseId: exercise.id, name: exercise.name, sets: [] }],
    }));
  };

  /** Reemplaza un ejercicio (sesión finalizada): el nuevo ocupa su lugar, sin series. */
  const replaceExercise = (target: DraftExercise, exercise: Exercise) => {
    setPickerOpen(false);
    setReplaceTarget(null);
    if (target.exerciseId === exercise.id) return;
    const key = newKey();
    scrollTarget.current = key;
    setCollapsed((c) => ({ ...c, [key]: false }));
    update((d) => ({
      ...d,
      exercises: d.exercises.map((e) =>
        e.key === target.key ? { key, exerciseId: exercise.id, name: exercise.name, sets: [] } : e,
      ),
    }));
  };

  const closePicker = () => {
    setPickerOpen(false);
    setReplaceTarget(null); // cancelar el reemplazo deja la sesión intacta
  };

  // Lleva a la vista la tarjeta recién agregada si quedó fuera de pantalla (sin abrir el teclado).
  useEffect(() => {
    const key = scrollTarget.current;
    if (!key || !draft) return;
    scrollTarget.current = null;
    const el = document.getElementById(`tarjeta-${key}`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const head = document.querySelector(".session-head")?.getBoundingClientRect().bottom ?? 0;
    if (rect.top < head || rect.bottom > window.innerHeight) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [draft]);

  const toggleCollapsed = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const updateExercise = (key: string, fn: (e: DraftExercise) => DraftExercise) =>
    update((d) => ({ ...d, exercises: d.exercises.map((e) => (e.key === key ? fn(e) : e)) }));

  const updateSet = (exKey: string, setKey: string, patch: Partial<DraftSet>) =>
    updateExercise(exKey, (e) => ({ ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...s, ...patch } : s)) }));

  /** Quita el ejercicio solo de esta sesión (sigue en el catálogo y en otras sesiones). */
  const removeExercise = (ex: DraftExercise) => {
    // Sesión finalizada: no puede quedar vacía. Se pregunta ANTES de tocar el borrador.
    if (finished && (draftRef.current?.exercises.length ?? 0) <= 1) {
      setLastExercise(ex);
      return;
    }
    const n = exerciseSummary(ex.sets).count;
    if (
      n > 0 &&
      !window.confirm(
        `¿Quitar «${ex.name}» de esta sesión? Se descartarán sus ${n} ${n === 1 ? "serie registrada" : "series registradas"}. ` +
          "El ejercicio seguirá en tu catálogo y en tus otras sesiones.",
      )
    )
      return;
    update((d) => ({ ...d, exercises: d.exercises.filter((e) => e.key !== ex.key) }));
  };

  /** Copia la última sesión con sus valores originales. Solo se ofrece con el ejercicio vacío. */
  const copyPrevious = (ex: DraftExercise, prev: PreviousSets) => {
    updateExercise(ex.key, (e) => (hasNoSets(e.sets) ? { ...e, sets: copyPreviousSets(e.sets, prev.sets) } : e));
    setQuickOpen((q) => ({ ...q, [ex.key]: false }));
  };

  const focusQuickReps = (exKey: string) =>
    requestAnimationFrame(() => document.getElementById(quickRepsInputId(exKey))?.focus());

  const addQuickSets = (ex: DraftExercise, sets: DraftSet[]) => {
    updateExercise(ex.key, (e) => ({ ...e, sets: appendSets(e.sets, sets) }));
    setQuickOpen((q) => ({ ...q, [ex.key]: false }));
  };

  /** «Agregar serie»: repite la última fila; con el ejercicio vacío abre la captura rápida. */
  const addOneSet = (ex: DraftExercise) => {
    if (hasNoSets(ex.sets)) {
      focusQuickReps(ex.key);
      return;
    }
    updateExercise(ex.key, (e) => ({ ...e, sets: [...e.sets.filter((s) => !isSetBlank(s)), nextSet(e.sets)] }));
  };

  const openQuick = (ex: DraftExercise) => {
    setQuickOpen((q) => ({ ...q, [ex.key]: true }));
    focusQuickReps(ex.key);
  };

  async function finish() {
    if (!draft) return;
    if (draft.exercises.length === 0 && !savedOnce.current) {
      discard();
      return;
    }
    if (finishing) return;
    if (draft.exercises.length === 0) {
      setErrorMsg("Agrega al menos un ejercicio para finalizar la sesión.");
      setShowErrors(true);
      return;
    }
    if (revision.current !== savedRevision.current || status === "error") {
      const ok = await save(true);
      if (!ok) return;
    }
    if (!finished) {
      setFinishing(true);
      try {
        const res = await finishSession(draft.id);
        if (!res.ok) {
          setErrorMsg(res.error);
          setShowErrors(true);
          return;
        }
        setFinished(true);
      } catch {
        setErrorMsg("Sin conexión con el servidor. Tu entrenamiento está guardado; pulsa «Finalizar sesión» de nuevo.");
        setShowErrors(true);
        return;
      } finally {
        setFinishing(false);
      }
    }
    router.push(historyHref());
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

  /** Elimina la sesión; el éxito solo se muestra cuando el servidor lo confirma. */
  async function remove() {
    if (!draft || deleting || !window.confirm("¿Eliminar esta sesión? No se puede deshacer.")) return;
    setLastExercise(null);
    setDeleting(true);
    // Mientras tanto no se autoguarda (no debe recrearla).
    blocked.current = true;
    if (timer.current) clearTimeout(timer.current);
    let ok = false;
    try {
      const res = await deleteSession(draft.id);
      ok = res.ok;
      if (!res.ok) setErrorMsg(res.error);
    } catch {
      setErrorMsg("Sin conexión con el servidor. La sesión no se eliminó; reintenta.");
    }
    if (!ok) {
      blocked.current = false;
      setShowErrors(true);
      setDeleting(false);
      return;
    }
    removeStoredDraft(draft.id);
    clearNewPointer(draft.id);
    const href = historyHref();
    router.push(`${href}${href.includes("?") ? "&" : "?"}eliminada=1`);
  }

  function discardLocalCopy() {
    if (!draft) return;
    removeStoredDraft(draft.id);
    setLocalConflict(false);
    setNotice("Copia local descartada. Esta es la versión guardada de la sesión.");
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
      <header className="session-head">
        <div className="session-head-row">
          <h1>Sesión de entrenamiento</h1>
          <button type="button" className="btn btn-sm btn-primary" onClick={finish} disabled={status === "saving" || finishing}>
            {finishing ? "Finalizando…" : finished ? "Listo" : "Finalizar sesión"}
          </button>
        </div>
        <div className="session-head-row">
          <label className="date-control">
            <IconCalendar />
            <span className="date-control-text">{formatDate(draft.date)}</span>
            <input
              className="date-control-input"
              type="date"
              aria-label="Fecha del entrenamiento"
              value={draft.date}
              required
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {}
              }}
              onChange={(e) => e.target.value && update((d) => ({ ...d, date: e.target.value }))}
            />
          </label>
          <div className="session-head-status">
            {finished ? <span className="badge badge-success">Finalizada</span> : null}
            <span className="save-status" data-state={status} role="status" aria-live="polite">
              <span className="dot" aria-hidden="true" />
              <span>{STATUS_TEXT[status]}</span>
            </span>
            {status === "error" ? (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void save(true)}>
                Reintentar
              </button>
            ) : status === "dirty" || status === "invalid" ? (
              <button type="button" className="btn btn-sm" onClick={() => void save(true)}>
                Guardar
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="stack">
        {notice ? <p className="alert alert-info" role="status">{notice}</p> : null}
        {localConflict ? (
          <div className="alert alert-warning stack" role="status" style={{ gap: 8 }}>
            <p style={{ margin: 0 }}>
              En este dispositivo había una copia sin ejercicios que no coincide con esta sesión finalizada. Se muestra la
              versión guardada.
            </p>
            <button type="button" className="btn btn-sm" onClick={discardLocalCopy}>
              Descartar copia local
            </button>
          </div>
        ) : null}
        {status === "error" && errorMsg ? (
          <p className="alert alert-error" role="alert">
            {errorMsg} Tus datos siguen aquí; pulsa «Reintentar».
          </p>
        ) : errorMsg && showErrors ? (
          <p className="alert alert-error" role="alert">{errorMsg}</p>
        ) : null}
        {draft.exercises.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Agrega tu primer ejercicio para empezar a registrar series.</p>
        ) : null}

        {draft.exercises.map((ex) => {
          const prev = prevForDate?.[ex.exerciseId];
          const empty = hasNoSets(ex.sets);
          const showQuick = empty || Boolean(quickOpen[ex.key]);
          const lastSet = ex.sets.filter((st) => !isSetBlank(st)).at(-1);
          const summary = exerciseSummary(ex.sets);
          const hasErrors = ex.sets.some((st) => setErrors[st.key]);
          // Con errores visibles, el ejercicio se abre para poder corregirlos.
          const isCollapsed = Boolean(collapsed[ex.key]) && !hasErrors;
          const bodyId = `ejercicio-${ex.key}`;
          return (
            <section
              key={ex.key}
              id={`tarjeta-${ex.key}`}
              className="card exercise-card"
              aria-label={ex.name}
              data-collapsed={isCollapsed || undefined}
            >
              <div className="ex-head">
                <button
                  type="button"
                  className="ex-toggle"
                  aria-expanded={!isCollapsed}
                  aria-controls={bodyId}
                  aria-label={`${isCollapsed ? "Expandir" : "Colapsar"} ${ex.name}`}
                  aria-describedby={`${bodyId}-resumen`}
                  onClick={() => toggleCollapsed(ex.key)}
                >
                  <span className="ex-chevron" aria-hidden="true"><IconChevronDown /></span>
                  <span className="ex-title">
                    <h3>{ex.name}</h3>
                    <span id={`${bodyId}-resumen`} className="ex-summary" hidden={!isCollapsed}>
                      {summary.text}
                      {summary.incomplete ? <span className="badge badge-warning">Faltan datos</span> : null}
                    </span>
                    {ex.archived ? <span className="badge">Archivado</span> : null}
                  </span>
                </button>
                <CardMenu exerciseName={ex.name} onRemove={() => removeExercise(ex)} />
              </div>

              {!isCollapsed ? (
                <div id={bodyId}>
                  <PreviousSummary
                    prev={prev}
                    loadError={prevError}
                    exerciseName={ex.name}
                    canCopy={empty}
                    onCopy={(p) => copyPrevious(ex, p)}
                  />

                  {ex.sets.length ? (
                    <div className="set-table" role="group" aria-label={`Series de ${ex.name}`}>
                      <div className="set-row set-head" aria-hidden="true">
                        <span>Serie</span>
                        <span>Peso (kg)</span>
                        <span>Reps</span>
                        <span />
                      </div>
                      {ex.sets.map((set, i) => (
                        <div key={set.key}>
                          <div className="set-row">
                            <span className="num">{i + 1}</span>
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
                            <input
                              className="input"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              placeholder="—"
                              aria-label={`Repeticiones serie ${i + 1} de ${ex.name}`}
                              aria-invalid={setErrors[set.key] ? true : undefined}
                              value={set.reps}
                              onChange={(e) => updateSet(ex.key, set.key, { reps: e.target.value })}
                              enterKeyHint="done"
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              aria-label={`Quitar serie ${i + 1} de ${ex.name}`}
                              onClick={() => updateExercise(ex.key, (e) => ({ ...e, sets: e.sets.filter((s) => s.key !== set.key) }))}
                            >
                              <IconTrash />
                            </button>
                          </div>
                          {setErrors[set.key] ? <p className="set-error">Serie {i + 1}: {setErrors[set.key]}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {showQuick ? (
                    <QuickAddSets
                      key={`${ex.key}-${ex.sets.length}`}
                      exerciseKey={ex.key}
                      exerciseName={ex.name}
                      defaults={lastSet ? { reps: lastSet.reps, weight: lastSet.weight } : undefined}
                      onAdd={(sets) => addQuickSets(ex, sets)}
                      onCancel={empty ? undefined : () => setQuickOpen((q) => ({ ...q, [ex.key]: false }))}
                    />
                  ) : null}

                  <div className="set-actions">
                    <button type="button" className="btn" onClick={() => addOneSet(ex)}>
                      <IconPlus /> Agregar serie
                    </button>
                    {!showQuick ? (
                      <button type="button" className="btn" onClick={() => openQuick(ex)}>
                        Varias series
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}

        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => setPickerOpen(true)}>
          <IconPlus /> Agregar ejercicio
        </button>

        <details className="disclosure notes">
          <summary>
            Notas de la sesión
            {draft.notes.trim() ? <span className="notes-preview">{draft.notes.trim()}</span> : null}
          </summary>
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
            <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={deleting}>
              <IconTrash /> {deleting ? "Eliminando…" : "Eliminar sesión"}
            </button>
          )}
        </div>
      </div>

      {lastExercise ? (
        <div className="sheet-backdrop" onClick={() => setLastExercise(null)}>
          <div
            className="sheet stack"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ultimo-ejercicio-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="ultimo-ejercicio-titulo" style={{ margin: 0 }}>Esta sesión necesita al menos un ejercicio</h2>
            <p className="muted" style={{ margin: 0 }}>
              La sesión está finalizada y «{lastExercise.name}» es su único ejercicio. Puedes reemplazarlo por otro o
              eliminar la sesión completa.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                setReplaceTarget(lastExercise);
                setLastExercise(null);
                setPickerOpen(true);
              }}
            >
              Reemplazar ejercicio
            </button>
            <button type="button" className="btn btn-danger btn-block" onClick={() => void remove()} disabled={deleting}>
              {deleting ? "Eliminando…" : "Eliminar sesión"}
            </button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setLastExercise(null)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {pickerOpen ? (
        <ExercisePicker
          exercises={catalog}
          muscleGroups={muscleGroups}
          inSession={inSession}
          title={replaceTarget ? "Reemplazar ejercicio" : undefined}
          notice={replaceTarget ? replaceNotice(replaceTarget) : undefined}
          onClose={closePicker}
          onPick={(exercise) => (replaceTarget ? replaceExercise(replaceTarget, exercise) : addExercise(exercise))}
          onCreated={(exercise) => setCatalog((c) => (c.some((x) => x.id === exercise.id) ? c : [...c, exercise]))}
        />
      ) : null}
    </div>
  );
}

function PreviousSummary({
  prev,
  loadError,
  exerciseName,
  canCopy,
  onCopy,
}: {
  prev: PreviousSets | null | undefined;
  loadError: boolean;
  exerciseName: string;
  canCopy: boolean;
  onCopy: (prev: PreviousSets) => void;
}) {
  if (prev === undefined) {
    return (
      <p className="previous-line muted" aria-live="polite">
        {loadError ? "No se pudo cargar la sesión anterior." : "Buscando tu sesión anterior…"}
      </p>
    );
  }
  if (prev === null) {
    return <p className="previous-line muted">Primer registro</p>;
  }
  return (
    <div className="previous" aria-label={`Última sesión de ${exerciseName}`}>
      <p className="previous-line">
        <span className="muted">Última vez · </span>
        <Link href={`/sesiones/${prev.session_id}`}>{formatDate(prev.session_date, { year: false })}</Link>
      </p>
      <p className="previous-summary">{summarizeSets(prev.sets)}</p>
      {canCopy ? (
        <button type="button" className="btn btn-sm" onClick={() => onCopy(prev)}>
          <IconCopy /> Copiar última sesión
        </button>
      ) : null}
    </div>
  );
}

function replaceNotice(ex: DraftExercise): string {
  const n = exerciseSummary(ex.sets).count;
  const series = n === 0 ? "" : ` y sus ${n} ${n === 1 ? "serie registrada" : "series registradas"}`;
  return `Elige el ejercicio que ocupará el lugar de «${ex.name}». Se quitará «${ex.name}»${series} de esta sesión; seguirá en tu catálogo y en tus otras sesiones.`;
}
