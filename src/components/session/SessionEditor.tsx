"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteSession, finishSession, getPreviousSets, saveSession } from "@/app/actions/sessions";
import { ActionsMenu } from "@/components/ActionsMenu";
import { IconCalendar, IconCheck, IconChevronDown, IconCopy, IconGrip, IconList, IconPencil, IconPlay, IconPlus, IconSwap, IconTrash } from "@/components/icons";
import { formatSequence, formatSetTotals, formatStep, isBlockSet, sameShape, type BlockPlan } from "@/lib/blocks";
import { formatDate, summarizeSets, todayLocal } from "@/lib/format";
import { historyHref } from "@/lib/history-query";
import { formatTarget, type Target } from "@/lib/routines";
import {
  buildSteps,
  nextAltGroup,
  pendingExercises,
  progressText,
  registeredSets,
  stepExerciseKeys,
  stepIndexFor,
  swapExercise,
  swapPlan,
} from "@/lib/guided";
import {
  appendSets,
  blocksToDraft,
  loadOf,
  cloneBlocks,
  parseBlocks,
  type DraftBlocks,
  clearNewPointer,
  exerciseSummary,
  copyPreviousSets,
  draftToPayload,
  hasNoSets,
  isSetBlank,
  newKey,
  nextSet,
  normalizeAlt,
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
import { useCardDrag } from "./useCardDrag";
import { BlockSetSheet, emptyBlocks } from "./BlockSetSheet";
import { BarWeightField, LoadPicker, loadLabel } from "./LoadPicker";
import { QuickAddSets, quickRepsInputId } from "./QuickAddSets";
import { GuidedView } from "./GuidedView";
import { SwapSheet } from "./SwapSheet";
import { AlternateSheet } from "./AlternateSheet";

/** Vista abierta en este dispositivo (lista o guiado) para volver a ella al recargar. */
const VIEW_PREFIX = "sistema-gym:vista:";
function readView(id: string): "list" | "guided" {
  try {
    return localStorage.getItem(VIEW_PREFIX + id) === "guided" ? "guided" : "list";
  } catch {
    return "list";
  }
}
function writeView(id: string, view: "list" | "guided") {
  try {
    if (view === "guided") localStorage.setItem(VIEW_PREFIX + id, "guided");
    else localStorage.removeItem(VIEW_PREFIX + id);
  } catch {}
}

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
  /** Serie cuya carga se está editando (selector bajo la fila). */
  const [loadEdit, setLoadEdit] = useState<string | null>(null);
  /** Panel de serie por bloques: agregar (con cantidad) o editar una serie concreta. */
  const [blockSheet, setBlockSheet] = useState<{
    exKey: string;
    exerciseName: string;
    setKey: string | null;
    initial: DraftBlocks;
    count: number | null;
    title: string;
    notice?: string;
  } | null>(null);
  /** Copia local vacía que contradice la sesión finalizada guardada (se muestra la del servidor). */
  const [localConflict, setLocalConflict] = useState(false);
  /** Diálogo al quitar el único ejercicio de una sesión finalizada. */
  const [lastExercise, setLastExercise] = useState<DraftExercise | null>(null);
  /** Ejercicio que se reemplaza con el selector (null = el selector agrega). */
  const [replaceTarget, setReplaceTarget] = useState<DraftExercise | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Ejercicios colapsados (solo muestran nombre y resumen). */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  /** Lista de ejercicios o entrenamiento guiado (misma sesión). */
  const [view, setView] = useState<"list" | "guided">("list");
  /** «Cambiar ejercicio»: elegir el sustituto y confirmar. */
  const [swap, setSwap] = useState<{ target: DraftExercise; substitute: Exercise | null } | null>(null);
  /** «Alternar con otro ejercicio». */
  const [altFor, setAltFor] = useState<DraftExercise | null>(null);
  /** Resumen de ejercicios pendientes antes de finalizar (modo guiado iniciado). */
  const [finishSummary, setFinishSummary] = useState(false);

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
    // Al recargar en modo guiado se vuelve a él (la posición viene de la sesión).
    if (loaded.guided?.started && loaded.exercises.length && !initial?.finished_at && readView(loaded.id) === "guided") setView("guided");
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
      exercises: [...d.exercises, { key, exerciseId: exercise.id, name: exercise.name, muscleGroupId: exercise.muscle_group_id, sets: [] }],
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
        e.key === target.key
          ? { key, exerciseId: exercise.id, name: exercise.name, muscleGroupId: exercise.muscle_group_id, alt: e.alt ?? null, sets: [] }
          : e,
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
    update((d) => ({ ...d, exercises: normalizeAlt(d.exercises.filter((e) => e.key !== ex.key)) }));
  };

  /** Copia la última sesión con sus valores originales. Solo se ofrece con el ejercicio vacío. */
  const copyPrevious = (ex: DraftExercise, prev: PreviousSets) => {
    updateExercise(ex.key, (e) => (hasNoSets(e.sets) ? { ...e, sets: copyPreviousSets(e.sets, prev.sets) } : e));
    setQuickOpen((q) => ({ ...q, [ex.key]: false }));
  };

  const focusQuickReps = (exKey: string) =>
    requestAnimationFrame(() => document.getElementById(quickRepsInputId(exKey))?.focus());

  /** Secuencia de la última vez con la misma forma (para tomar sus pesos al cargar un plan). */
  const planWithLastWeights = (plan: BlockPlan, prev: PreviousSets | null | undefined): DraftBlocks => {
    const match = prev?.sets.filter(isBlockSet).find((st) => sameShape(st.blocks!, plan.items));
    const draft = blocksToDraft(plan.items, plan.rounds);
    if (match) draft.items = draft.items.map((b, i) => ({ ...b, weight: blocksToDraft(match.blocks!, 1).items[i].weight }));
    return draft;
  };

  /** «Agregar serie por bloques»: parte de la última secuencia del ejercicio, la de la última vez o el plan. */
  const openBlocks = (ex: DraftExercise) => {
    const prev = prevForDate?.[ex.exerciseId];
    const lastHere = [...ex.sets].reverse().find((st) => st.blocks);
    const lastPrev = prev?.sets.filter(isBlockSet).at(-1);
    const initial = lastHere?.blocks
      ? cloneBlocks(lastHere.blocks)
      : lastPrev
        ? blocksToDraft(lastPrev.blocks!, lastPrev.rounds ?? 1)
        : ex.target?.blocks
          ? planWithLastWeights(ex.target.blocks, prev)
          : emptyBlocks();
    setBlockSheet({ exKey: ex.key, exerciseName: ex.name, setKey: null, initial, count: 1, title: "Serie por bloques" });
  };

  /** Carga la secuencia planificada por la rutina para registrar lo que realmente se hizo. */
  const loadPlan = (ex: DraftExercise, plan: BlockPlan) => {
    setBlockSheet({
      exKey: ex.key,
      exerciseName: ex.name,
      setKey: null,
      initial: planWithLastWeights(plan, prevForDate?.[ex.exerciseId]),
      count: ex.target?.sets ?? 1,
      title: "Secuencia planificada",
      notice: "Ajusta reps, segundos y pesos a lo que realmente hiciste. Solo cuentan las series que agregues.",
    });
  };

  const editBlockSet = (ex: DraftExercise, set: DraftSet, n: number) => {
    if (!set.blocks) return;
    setBlockSheet({ exKey: ex.key, exerciseName: ex.name, setKey: set.key, initial: cloneBlocks(set.blocks), count: null, title: `Editar serie ${n}` });
  };

  const submitBlocks = (blocks: DraftBlocks, count: number) => {
    const sheet = blockSheet;
    if (!sheet) return;
    setBlockSheet(null);
    if (sheet.setKey) {
      // Solo cambia esa serie; las demás quedan igual.
      updateExercise(sheet.exKey, (e) => ({ ...e, sets: e.sets.map((st) => (st.key === sheet.setKey ? { ...st, blocks } : st)) }));
      return;
    }
    const added = Array.from({ length: count }, () => ({ key: newKey(), reps: "", weight: "", blocks: cloneBlocks(blocks) }));
    updateExercise(sheet.exKey, (e) => ({ ...e, sets: appendSets(e.sets, added) }));
    setQuickOpen((q) => ({ ...q, [sheet.exKey]: false }));
  };

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

  async function finish(confirmed = false) {
    if (!draft) return;
    // Modo guiado iniciado y ejercicios sin terminar: primero un resumen para confirmar.
    if (!confirmed && !finished && draft.guided?.started && draft.exercises.length && pendingExercises(draft.exercises).length) {
      setFinishSummary(true);
      return;
    }
    setFinishSummary(false);
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
        writeView(draft.id, "list");
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

  /** «Guardar como rutina» (sesión finalizada): guarda lo pendiente y abre la plantilla precargada. */
  async function saveAsRoutine() {
    if (!draft) return;
    if (revision.current !== savedRevision.current || status === "error") {
      const ok = await save(true);
      if (!ok) return;
    }
    router.push(`/rutinas/nueva?desde=${draft.id}`);
  }

  function discardLocalCopy() {
    if (!draft) return;
    removeStoredDraft(draft.id);
    setLocalConflict(false);
    setNotice("Copia local descartada. Esta es la versión guardada de la sesión.");
  }

  // --- Reordenar ejercicios (arrastre o «Mover arriba/abajo») -----------------------
  const [moveMsg, setMoveMsg] = useState("");
  /**
   * Mueve un ejercicio por su clave estable a la posición `to`. Usa el borrador más
   * reciente (conserva series, bloques, metas y cambios pendientes) y el autoguardado.
   */
  const moveExercise = useCallback(
    (key: string, to: number) => {
      const current = draftRef.current;
      if (!current) return;
      const from = current.exercises.findIndex((e) => e.key === key);
      if (from < 0 || to < 0 || to >= current.exercises.length || from === to) return;
      const name = current.exercises[from].name;
      update((d) => {
        const list = [...d.exercises];
        const i = list.findIndex((e) => e.key === key);
        const [item] = list.splice(i, 1);
        list.splice(to, 0, item);
        return { ...d, exercises: list };
      });
      setMoveMsg(`${name} movido a la posición ${to + 1} de ${current.exercises.length}.`);
    },
    [update],
  );
  const exerciseKeys = draft?.exercises.map((e) => e.key) ?? [];
  const reorder = useCardDrag({ keys: exerciseKeys, cardId: (k) => `tarjeta-${k}`, listId: "lista-ejercicios", onDrop: moveExercise });

  // --- Entrenamiento guiado (mismo borrador que la lista) ---------------------------
  const steps = useMemo(() => buildSteps(draft?.exercises ?? []), [draft?.exercises]);
  const byKey = useMemo(() => new Map((draft?.exercises ?? []).map((e) => [e.key, e])), [draft?.exercises]);
  const guidedIndex = stepIndexFor(steps, byKey, draft?.guided?.exerciseId ?? null);

  const openView = (next: "list" | "guided") => {
    setView(next);
    if (draftRef.current) writeView(draftRef.current.id, next);
    window.scrollTo({ top: 0 });
  };

  /** «Iniciar / Continuar entrenamiento»: guarda que se inició y la posición. */
  const startGuided = () => {
    const current = draftRef.current;
    if (!current || current.exercises.length === 0) return;
    if (!current.guided?.started) {
      const first = steps[stepIndexFor(steps, byKey, null)];
      const exerciseId = first ? (byKey.get(stepExerciseKeys(first)[0])?.exerciseId ?? null) : null;
      update((d) => ({ ...d, guided: { started: true, exerciseId } }));
    }
    openView("guided");
  };

  const setGuidedIndex = (i: number) => {
    const step = steps[i];
    if (!step) return;
    const exerciseId = byKey.get(stepExerciseKeys(step)[0])?.exerciseId ?? null;
    if (exerciseId === draftRef.current?.guided?.exerciseId) return;
    update((d) => ({ ...d, guided: { started: true, exerciseId } }));
  };

  /** Registrar una serie: se agrega al final (las filas vacías se descartan). */
  const addRegisteredSet = (exKey: string, set: DraftSet) =>
    updateExercise(exKey, (e) => ({ ...e, sets: [...registeredSets(e), set] }));

  /** Corregir una serie guardada: se reemplaza en su lugar (no se duplica). */
  const replaceRegisteredSet = (exKey: string, setKey: string, set: DraftSet) =>
    updateExercise(exKey, (e) => ({ ...e, sets: e.sets.map((s) => (s.key === setKey ? { ...set, key: setKey } : s)) }));

  const setExercisesDone = (keys: string[], done: boolean) =>
    update((d) => ({ ...d, exercises: d.exercises.map((e) => (keys.includes(e.key) ? { ...e, done } : e)) }));

  /** Confirma «Cambiar ejercicio» (solo en esta sesión). */
  const confirmSwap = (target: Target | null) => {
    const current = swap;
    if (!current?.substitute) return;
    const sub = current.substitute;
    setSwap(null);
    const key = newKey();
    const wasGuidedHere = draftRef.current?.guided?.exerciseId === current.target.exerciseId;
    const mode = swapPlan(current.target).mode;
    update((d) => ({
      ...d,
      exercises: swapExercise(d.exercises, current.target.key, {
        key,
        exerciseId: sub.id,
        name: sub.name,
        muscleGroupId: sub.muscle_group_id,
        target,
      }),
      // En modo guiado, si el sustituto ocupa el lugar, la posición pasa a él.
      guided: d.guided && wasGuidedHere && mode === "replace" ? { ...d.guided, exerciseId: sub.id } : d.guided,
    }));
    setCollapsed((c) => ({ ...c, [key]: false }));
    if (view === "list") scrollTarget.current = key;
    setNotice(
      mode === "replace"
        ? `«${sub.name}» reemplazó a «${current.target.name}» en esta sesión.`
        : `«${current.target.name}» conserva sus series y quedó completado. Sigue con «${sub.name}».`,
    );
  };

  /** «Alternar con otro ejercicio»: forma la pareja, define sus series y la deja junta. */
  const confirmAlt = (partnerKey: string, setsA: number, setsB: number) => {
    const source = altFor;
    setAltFor(null);
    if (!source) return;
    update((d) => {
      const group = nextAltGroup(d.exercises);
      const withTarget = (e: DraftExercise, sets: number): DraftExercise => ({
        ...e,
        target: { sets, repsMin: e.target?.repsMin ?? null, repsMax: e.target?.repsMax ?? null, blocks: e.target?.blocks ?? null },
      });
      const partner = d.exercises.find((e) => e.key === partnerKey);
      if (!partner) return d;
      const list = d.exercises.filter((e) => e.key !== partnerKey);
      const i = list.findIndex((e) => e.key === source.key);
      list[i] = { ...withTarget(list[i], setsA), alt: { group, slot: 0 } };
      list.splice(i + 1, 0, { ...withTarget(partner, setsB), alt: { group, slot: 1 } });
      return { ...d, exercises: list };
    });
    setNotice(`Series alternadas: ${source.name} y ${draftRef.current?.exercises.find((e) => e.key === partnerKey)?.name ?? ""}.`);
  };

  /** Separa la pareja: cada ejercicio conserva sus series registradas. */
  const separateAlt = (group: number) =>
    update((d) => ({ ...d, exercises: d.exercises.map((e) => (e.alt?.group === group ? { ...e, alt: null } : e)) }));

  if (!draft) {
    return <p className="muted" aria-live="polite">Cargando entrenamiento…</p>;
  }

  const validation = draftToPayload(draft);
  const setErrors = !validation.ok && showErrors ? validation.errors.sets : {};
  const inSession = new Set(exerciseIds);
  const isNew = !savedOnce.current;
  const guidedOpen = view === "guided" && draft.exercises.length > 0 && !finished;

  const statusNode = (
    <span className="save-status" data-state={status} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span>{STATUS_TEXT[status]}</span>
    </span>
  );
  const retryNode =
    status === "error" ? (
      <button type="button" className="btn btn-sm btn-primary" onClick={() => void save(true)}>
        Reintentar
      </button>
    ) : null;

  const pending = pendingExercises(draft.exercises);
  const summarySheet = finishSummary ? (
    <div className="sheet-backdrop" onClick={() => setFinishSummary(false)}>
      <div className="sheet stack" role="dialog" aria-modal="true" aria-labelledby="resumen-titulo" onClick={(e) => e.stopPropagation()}>
        <h2 id="resumen-titulo" style={{ margin: 0 }}>¿Finalizar con ejercicios pendientes?</h2>
        <p className="muted" style={{ margin: 0 }}>Se guardará solo lo que registraste.</p>
        <ul className="pending-list">
          {pending.map((p) => (
            <li key={p.key}>
              <strong>{p.name}</strong> <span className="muted">· {p.text}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-primary btn-block" onClick={() => void finish(true)} disabled={finishing}>
          {finishing ? "Finalizando…" : "Finalizar sesión"}
        </button>
        <button type="button" className="btn btn-ghost btn-block" onClick={() => setFinishSummary(false)}>
          Seguir entrenando
        </button>
      </div>
    </div>
  ) : null;

  if (guidedOpen) {
    return (
      <div>
        {status === "error" && errorMsg ? (
          <p className="alert alert-error" role="alert">{errorMsg} Tus datos siguen aquí; pulsa «Reintentar».</p>
        ) : errorMsg && showErrors ? (
          <p className="alert alert-error" role="alert">{errorMsg}</p>
        ) : null}
        <GuidedView
          exercises={draft.exercises}
          steps={steps}
          index={guidedIndex}
          previous={prevForDate}
          prevError={prevError}
          status={
            <span className="guided-status">
              {statusNode}
              {retryNode}
            </span>
          }
          onIndexChange={setGuidedIndex}
          onAddSet={addRegisteredSet}
          onReplaceSet={replaceRegisteredSet}
          onSetDone={setExercisesDone}
          onExit={() => openView("list")}
          onFinishSession={() => void finish()}
          finishing={finishing}
        />
        {summarySheet}
      </div>
    );
  }

  return (
    <div>
      <header className="session-head">
        <div className="session-head-row">
          <h1>Sesión de entrenamiento</h1>
          <div className="session-head-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void finish()} disabled={status === "saving" || finishing}>
              {finishing ? "Finalizando…" : finished ? "Listo" : "Finalizar sesión"}
            </button>
            {finished ? (
              <ActionsMenu
                label="Acciones de la sesión"
                items={[{ label: "Guardar como rutina", icon: <IconList />, onSelect: () => void saveAsRoutine() }]}
              />
            ) : null}
          </div>
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
            {statusNode}
            {status === "error" ? (
              retryNode
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
        ) : !finished ? (
          <button type="button" className="btn btn-primary btn-lg btn-block guided-start" onClick={startGuided}>
            <IconPlay /> {draft.guided?.started ? "Continuar entrenamiento" : "Iniciar entrenamiento"}
          </button>
        ) : null}

        <p id="reordenar-ayuda" className="sr-only">
          Mantén presionado el tirador y arrastra para cambiar el orden. Con el teclado, usa las flechas arriba y abajo.
        </p>
        <p className="sr-only" role="status" aria-live="polite">{moveMsg}</p>
        <div className="exercise-list" id="lista-ejercicios">
        {reorder.drag ? (
          <div
            className="drop-slot"
            aria-hidden="true"
            style={{
              top: reorder.drag.slotTop,
              height: reorder.drag.slotHeight,
            }}
          />
        ) : null}
        {draft.exercises.map((ex, exIndex) => {
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
              data-done={ex.done || undefined}
              data-dragging={reorder.drag?.key === ex.key || undefined}
              data-shifting={(reorder.drag && reorder.drag.key !== ex.key) || undefined}
              style={reorder.styleFor(ex.key, exIndex)}
            >
              <div className="ex-head">
                <button
                  type="button"
                  className="ex-toggle"
                  aria-expanded={!isCollapsed}
                  aria-controls={bodyId}
                  aria-label={`${isCollapsed ? "Expandir" : "Colapsar"} ${ex.name}`}
                  aria-describedby={ex.target ? `${bodyId}-meta ${bodyId}-resumen` : `${bodyId}-resumen`}
                  onClick={() => toggleCollapsed(ex.key)}
                >
                  <span className="ex-chevron" aria-hidden="true"><IconChevronDown /></span>
                  <span className="ex-title">
                    <h3>{ex.name}</h3>
                    {formatTarget(ex.target) ? (
                      <span id={`${bodyId}-meta`} className="ex-goal">Meta: {formatTarget(ex.target)}</span>
                    ) : null}
                    {ex.done ? (
                      <span className="ex-done"><IconCheck /> Completado</span>
                    ) : progressText(ex) ? (
                      <span className="ex-progress">{progressText(ex)}</span>
                    ) : null}
                    {ex.alt ? (
                      <span className="alt-badge">
                        ⇄ Series alternadas · con{" "}
                        {draft.exercises.filter((o) => o.alt?.group === ex.alt!.group && o.alt.slot !== ex.alt!.slot).map((o) => o.name).join(" / ")}
                      </span>
                    ) : null}
                    <span id={`${bodyId}-resumen`} className="ex-summary" hidden={!isCollapsed}>
                      {summary.text}
                      {summary.incomplete ? <span className="badge badge-warning">Faltan datos</span> : null}
                    </span>
                    {ex.archived ? <span className="badge">Archivado</span> : null}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon swap-btn"
                  aria-label={`Cambiar ejercicio ${ex.name}`}
                  title="Cambiar ejercicio"
                  onClick={() => setSwap({ target: ex, substitute: null })}
                >
                  <IconSwap />
                </button>
                {draft.exercises.length >= 2 ? (
                  <button
                    type="button"
                    className="drag-handle"
                    aria-label={`Reordenar ${ex.name}`}
                    aria-describedby="reordenar-ayuda"
                    {...reorder.handleProps(ex.key)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" && exIndex > 0) {
                        e.preventDefault();
                        moveExercise(ex.key, exIndex - 1);
                      } else if (e.key === "ArrowDown" && exIndex < draft.exercises.length - 1) {
                        e.preventDefault();
                        moveExercise(ex.key, exIndex + 1);
                      }
                    }}
                  >
                    <IconGrip />
                  </button>
                ) : null}
                <CardMenu
                  exerciseName={ex.name}
                  onRemove={() => removeExercise(ex)}
                  onMoveUp={exIndex > 0 ? () => moveExercise(ex.key, exIndex - 1) : null}
                  onMoveDown={exIndex < draft.exercises.length - 1 ? () => moveExercise(ex.key, exIndex + 1) : null}
                  extra={[
                    ex.done
                      ? { label: "Reabrir ejercicio", icon: <IconPencil />, onSelect: () => setExercisesDone([ex.key], false) }
                      : { label: "Finalizar ejercicio", icon: <IconCheck />, onSelect: () => setExercisesDone([ex.key], true) },
                    ex.alt
                      ? { label: "Separar series alternadas", icon: <IconSwap />, onSelect: () => separateAlt(ex.alt!.group) }
                      : { label: "Alternar con otro ejercicio", icon: <IconSwap />, onSelect: () => setAltFor(ex) },
                  ]}
                />
              </div>

              {!isCollapsed ? (
                <div id={bodyId}>
                  {ex.done ? (
                    <div className="ex-done-row">
                      <span className="ex-done"><IconCheck /> Completado</span>
                      <button type="button" className="btn btn-sm" onClick={() => setExercisesDone([ex.key], false)}>
                        Reabrir ejercicio
                      </button>
                    </div>
                  ) : null}
                  {ex.target?.blocks ? (
                    <div className="plan-box">
                      <p style={{ margin: 0 }}>
                        <span className="muted small">Secuencia planificada · </span>
                        {formatTarget(ex.target)}
                      </p>
                      <button type="button" className="btn btn-sm" onClick={() => loadPlan(ex, ex.target!.blocks!)}>
                        Cargar secuencia planificada
                      </button>
                    </div>
                  ) : null}
                  <PreviousSummary
                    prev={prev}
                    loadError={prevError}
                    exerciseName={ex.name}
                    canCopy={empty}
                    onCopy={(p) => copyPrevious(ex, p)}
                  />

                  {ex.sets.length ? (
                    <div className="set-table" role="group" aria-label={`Series de ${ex.name}`}>
                      {ex.sets.some((st) => !st.blocks) ? (
                        <div className="set-row set-head" aria-hidden="true">
                          <span>Serie</span>
                          <span>Carga</span>
                          <span>Reps</span>
                          <span />
                        </div>
                      ) : null}
                      {ex.sets.map((set, i) =>
                        set.blocks ? (
                          <BlockSetRow
                            key={set.key}
                            n={i + 1}
                            exerciseName={ex.name}
                            blocks={set.blocks}
                            error={setErrors[set.key]}
                            onEdit={() => editBlockSet(ex, set, i + 1)}
                            onRemove={() => updateExercise(ex.key, (e) => ({ ...e, sets: e.sets.filter((s) => s.key !== set.key) }))}
                          />
                        ) : (
                        <div key={set.key}>
                          <div className="set-row">
                            <span className="num">{i + 1}</span>
                            {(() => {
                              // Celda de carga: el peso (con peso o registro sin modo) o la etiqueta del modo.
                              const mode = loadOf(set);
                              const open = loadEdit === set.key;
                              const toggle = () => setLoadEdit(open ? null : set.key);
                              const label = `Carga de la serie ${i + 1} de ${ex.name}: ${loadLabel(mode)}`;
                              if (mode === "bar" || mode === "body") {
                                return (
                                  <button
                                    type="button"
                                    className="load-chip"
                                    data-mode={mode}
                                    aria-label={label}
                                    aria-expanded={open}
                                    onClick={toggle}
                                  >
                                    {mode === "body" ? "Corporal" : set.weight.trim() ? `Barra ${set.weight} kg` : "Solo barra"}
                                  </button>
                                );
                              }
                              return (
                                <div className="load-input">
                                  <input
                                    className="input"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    placeholder="—"
                                    aria-label={`Peso serie ${i + 1} de ${ex.name} (kg)`}
                                    aria-invalid={setErrors[set.key] ? true : undefined}
                                    value={set.weight}
                                    onChange={(e) => updateSet(ex.key, set.key, { weight: e.target.value })}
                                    enterKeyHint="next"
                                  />
                                  <button type="button" className="load-mode-btn" aria-label={label} aria-expanded={open} onClick={toggle}>
                                    kg
                                  </button>
                                </div>
                              );
                            })()}
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
                          {loadEdit === set.key ? (
                            <div className="load-editor">
                              <LoadPicker
                                value={loadOf(set)}
                                label={`Carga de la serie ${i + 1} de ${ex.name}`}
                                onChange={(m) =>
                                  // Solo cambia esta serie. Al pasar a barra o peso corporal, el peso anterior no es el de la barra.
                                  updateSet(ex.key, set.key, {
                                    load: m,
                                    bar: undefined,
                                    ...(m !== "weight" && m !== loadOf(set) ? { weight: "" } : {}),
                                  })
                                }
                              />
                              {loadOf(set) === "bar" ? (
                                <BarWeightField
                                  value={set.weight}
                                  onChange={(v) => updateSet(ex.key, set.key, { weight: v })}
                                  label={`Peso de la barra serie ${i + 1} de ${ex.name} (kg, opcional)`}
                                />
                              ) : null}
                              <button type="button" className="btn btn-sm" onClick={() => setLoadEdit(null)}>
                                Listo
                              </button>
                            </div>
                          ) : null}
                          {setErrors[set.key] ? <p className="set-error">Serie {i + 1}: {setErrors[set.key]}</p> : null}
                        </div>
                        ),
                      )}
                    </div>
                  ) : null}

                  {showQuick ? (
                    <QuickAddSets
                      key={`${ex.key}-${ex.sets.length}`}
                      exerciseKey={ex.key}
                      exerciseName={ex.name}
                      defaults={lastSet ? { reps: lastSet.reps, weight: lastSet.weight, load: loadOf(lastSet) } : undefined}
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
                  <button type="button" className="btn btn-ghost btn-block block-add" onClick={() => openBlocks(ex)}>
                    <IconPlus /> Agregar serie por bloques
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
        </div>

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

      {blockSheet ? (
        <BlockSetSheet
          key={`${blockSheet.exKey}-${blockSheet.setKey ?? "nueva"}`}
          exerciseName={blockSheet.exerciseName}
          initial={blockSheet.initial}
          initialCount={blockSheet.count}
          title={blockSheet.title}
          notice={blockSheet.notice}
          onSubmit={submitBlocks}
          onClose={() => setBlockSheet(null)}
        />
      ) : null}

      {summarySheet}

      {altFor ? (
        <AlternateSheet
          exercise={altFor}
          candidates={draft.exercises.filter((e) => e.key !== altFor.key && !e.alt)}
          onConfirm={confirmAlt}
          onClose={() => setAltFor(null)}
        />
      ) : null}

      {swap && !swap.substitute ? (
        <ExercisePicker
          exercises={catalog}
          muscleGroups={muscleGroups}
          inSession={inSession}
          hideInSession
          initialGroup={swap.target.muscleGroupId ?? catalog.find((c) => c.id === swap.target.exerciseId)?.muscle_group_id ?? null}
          title="Cambiar ejercicio"
          header={
            <p className="swap-current" style={{ margin: 0 }}>
              <span className="muted small">Ejercicio actual</span> <strong>{swap.target.name}</strong>
              <span className="badge badge-primary">Solo en esta sesión</span>
            </p>
          }
          onClose={() => setSwap(null)}
          onPick={(exercise) => setSwap((sw) => (sw ? { ...sw, substitute: exercise } : sw))}
          onCreated={(exercise) => setCatalog((c) => (c.some((x) => x.id === exercise.id) ? c : [...c, exercise]))}
        />
      ) : null}
      {swap?.substitute ? (
        <SwapSheet
          original={swap.target}
          substitute={swap.substitute}
          plan={swapPlan(swap.target)}
          partnerName={
            swap.target.alt
              ? draft.exercises.filter((o) => o.alt?.group === swap.target.alt!.group && o.alt.slot !== swap.target.alt!.slot).map((o) => o.name).join(" / ") || null
              : null
          }
          date={draft.date}
          sessionId={draft.id}
          onConfirm={confirmSwap}
          onBack={() => setSwap((sw) => (sw ? { ...sw, substitute: null } : sw))}
          onClose={() => setSwap(null)}
        />
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

/**
 * Serie por bloques en la tarjeta: primero los totales («Serie 1 · 21 reps · 21 s de
 * sostén»); al tocar el resumen se ven los pasos con sus cargas y las acciones.
 */
function BlockSetRow({
  n,
  exerciseName,
  blocks,
  error,
  onEdit,
  onRemove,
}: {
  n: number;
  exerciseName: string;
  blocks: DraftBlocks;
  error?: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const parsed = parseBlocks(blocks);
  const set = parsed.ok ? parsed.set : null;
  const totals = set ? formatSetTotals(set) : "datos incompletos";
  return (
    <div className="set-row-blocks">
      <details className="block-set">
        <summary aria-label={`Serie ${n} de ${exerciseName}: ${totals}${set ? `. ${formatSequence(set.blocks!, set.rounds ?? 1)}` : ""}`}>
          <span className="block-set-head">
            <span className="block-set-totals">
              Serie {n} · {set ? formatSetTotals(set) : "Faltan datos"}
            </span>
            {set ? <span className="block-set-text">{formatSequence(set.blocks!, set.rounds ?? 1)}</span> : null}
          </span>
        </summary>
        {set ? (
          <ol className="block-set-list">
            {set.blocks!.map((b, i) => (
              <li key={i}>
                {i + 1} · {formatStep(b)}
              </li>
            ))}
            <li className="muted">Vueltas por serie: {set.rounds}</li>
          </ol>
        ) : null}
        <div className="block-set-actions">
          <button type="button" className="btn btn-sm btn-primary" aria-label={`Editar serie ${n} de ${exerciseName}`} onClick={onEdit}>
            <IconPencil /> Editar serie
          </button>
          <button type="button" className="btn btn-sm btn-ghost" aria-label={`Quitar serie ${n} de ${exerciseName}`} onClick={onRemove}>
            <IconTrash /> Quitar
          </button>
        </div>
      </details>
      {error ? <p className="set-error">Serie {n}: {error}</p> : null}
    </div>
  );
}
