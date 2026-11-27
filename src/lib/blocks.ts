import { formatKg } from "./format-number";

/**
 * Series por bloques: una secuencia ordenada de bloques que se repite `rounds` veces
 * dentro de la serie. Cuenta como UNA serie.
 *   «Repeticiones»: reps y peso opcional · «Sostener»: segundos y peso opcional.
 */
export type RepsBlock = { type: "reps"; reps: number; weight_kg: number | null };
export type HoldBlock = { type: "hold"; seconds: number; weight_kg: number | null };
export type Block = RepsBlock | HoldBlock;

/** Secuencia planificada de una rutina (sin pesos: se toman de «Última vez»). */
export type BlockPlanItem = { type: "reps"; reps: number } | { type: "hold"; seconds: number };
export type BlockPlan = { rounds: number; items: BlockPlanItem[] };

export const MAX_BLOCKS = 20;
export const MAX_ROUNDS = 50;
export const MAX_HOLD_SECONDS = 3600;

/** Lo mínimo que necesita el cálculo: series simples o por bloques. */
export type AnySet = { reps: number | null; weight_kg: number | null; rounds?: number | null; blocks?: Block[] | null };

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export function isBlockSet(s: AnySet): s is AnySet & { blocks: Block[]; rounds: number } {
  return Array.isArray(s.blocks) && s.blocks.length > 0;
}

/** Reps totales: simple → sus reps; por bloques → ciclos × Σ reps de los bloques. */
export function setTotalReps(s: AnySet): number {
  if (!isBlockSet(s)) return s.reps ?? 0;
  return (s.rounds ?? 1) * s.blocks.reduce((sum, b) => sum + (b.type === "reps" ? b.reps : 0), 0);
}

/** Segundos de sostén (0 en las simples). */
export function setHoldSeconds(s: AnySet): number {
  if (!isBlockSet(s)) return 0;
  return (s.rounds ?? 1) * s.blocks.reduce((sum, b) => sum + (b.type === "hold" ? b.seconds : 0), 0);
}

/**
 * Mejor serie de una serie: simple → la propia; por bloques → el bloque de
 * repeticiones de mayor peso (empate → más reps), con SUS reps. null si solo sostiene.
 */
export function setBest(s: AnySet): { reps: number; weight_kg: number | null } | null {
  if (!isBlockSet(s)) return { reps: s.reps ?? 0, weight_kg: num(s.weight_kg) };
  let best: RepsBlock | null = null;
  for (const b of s.blocks) {
    if (b.type !== "reps") continue;
    const w = num(b.weight_kg);
    const bw = best ? num(best.weight_kg) : null;
    if (!best || (w !== null && (bw === null || w > bw)) || (w === bw && b.reps > best.reps)) best = b;
  }
  return best ? { reps: best.reps, weight_kg: num(best.weight_kg) } : null;
}

function weightText(w: number | string | null | undefined): string {
  const v = num(w);
  return v === null ? "" : ` a ${formatKg(v)} kg`;
}

/** «7 reps a 40 kg», «7 a 35 kg» (si sigue a otro bloque de reps), «sostener 7 s a 5 kg». */
export function formatBlock(b: Block | BlockPlanItem, previous?: Block | BlockPlanItem | null): string {
  const w = "weight_kg" in b ? b.weight_kg : null;
  if (b.type === "hold") return `sostener ${b.seconds} s${weightText(w)}`;
  const short = previous?.type === "reps" && num(w) !== null;
  return `${b.reps}${short ? "" : " reps"}${weightText(w)}`;
}

/** «7 reps a 40 kg → 7 a 35 kg → 7 a 30 kg» o «(7 reps → sostener 7 s) × 3». */
export function formatSequence(blocks: (Block | BlockPlanItem)[], rounds: number): string {
  const text = blocks.map((b, i) => formatBlock(b, i > 0 ? blocks[i - 1] : null)).join(" → ");
  if (rounds <= 1) return text;
  return blocks.length > 1 ? `(${text}) × ${rounds}` : `${text} × ${rounds}`;
}

export function formatPlan(plan: BlockPlan): string {
  return formatSequence(plan.items, plan.rounds);
}

/** Estructura de una serie por bloques (sin pesos): sirve de plan y para comparar. */
export function planOfSet(s: AnySet): BlockPlan | null {
  if (!isBlockSet(s)) return null;
  return {
    rounds: s.rounds ?? 1,
    items: s.blocks.map((b) => (b.type === "reps" ? { type: "reps", reps: b.reps } : { type: "hold", seconds: b.seconds })),
  };
}

export function planKey(plan: BlockPlan): string {
  return `${plan.rounds}|${plan.items.map((b) => (b.type === "reps" ? `r${b.reps}` : `h${b.seconds}`)).join(",")}`;
}

/** Misma secuencia de tipos (para tomar pesos de «Última vez» al cargar un plan). */
export function sameShape(a: (Block | BlockPlanItem)[], b: (Block | BlockPlanItem)[]): boolean {
  return a.length === b.length && a.every((x, i) => x.type === b[i].type);
}

/** Estructuras distintas de las series por bloques, con cuántas series tiene cada una. */
export function distinctPlans(sets: AnySet[]): { plan: BlockPlan; count: number }[] {
  const out = new Map<string, { plan: BlockPlan; count: number }>();
  for (const s of sets) {
    const plan = planOfSet(s);
    if (!plan) continue;
    const k = planKey(plan);
    const cur = out.get(k);
    if (cur) cur.count += 1;
    else out.set(k, { plan, count: 1 });
  }
  return [...out.values()];
}

export function isValidPlan(p: unknown): p is BlockPlan {
  if (!p || typeof p !== "object") return false;
  const plan = p as BlockPlan;
  if (!Number.isInteger(plan.rounds) || plan.rounds < 1 || plan.rounds > MAX_ROUNDS) return false;
  if (!Array.isArray(plan.items) || plan.items.length < 1 || plan.items.length > MAX_BLOCKS) return false;
  return plan.items.every(
    (b) =>
      (b.type === "reps" && Number.isInteger(b.reps) && b.reps >= 1 && b.reps <= 1000 && !("seconds" in b)) ||
      (b.type === "hold" && Number.isInteger(b.seconds) && b.seconds >= 1 && b.seconds <= MAX_HOLD_SECONDS && !("reps" in b)),
  );
}

/** Validación de una serie por bloques (servidor y cliente). */
export function isValidBlockSet(s: AnySet): boolean {
  if (!isBlockSet(s) || s.reps !== null || s.weight_kg !== null) return false;
  if (!Number.isInteger(s.rounds) || (s.rounds as number) < 1 || (s.rounds as number) > MAX_ROUNDS) return false;
  if (s.blocks.length > MAX_BLOCKS) return false;
  const okWeight = (w: unknown) =>
    w === null || (typeof w === "number" && w >= 0 && w <= 2000 && Math.round(w * 100) === w * 100);
  return s.blocks.every(
    (b) =>
      okWeight(b.weight_kg) &&
      ((b.type === "reps" && Number.isInteger(b.reps) && b.reps >= 1 && b.reps <= 1000 && !("seconds" in b)) ||
        (b.type === "hold" && Number.isInteger(b.seconds) && b.seconds >= 1 && b.seconds <= MAX_HOLD_SECONDS && !("reps" in b))),
  );
}
