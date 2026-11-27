/**
 * Equipo de un ejercicio (Mancuernas, Barra…). Es opcional: los ejercicios anteriores
 * no lo tienen y se siguen mostrando con su nombre. El mismo nombre puede existir con
 * equipos distintos; cada variante es un ejercicio con su propio ID e historial.
 */
export const EQUIPMENT = [
  { id: "mancuernas", label: "Mancuernas" },
  { id: "barra", label: "Barra" },
  { id: "smith", label: "Máquina Smith" },
  { id: "maquina", label: "Máquina" },
  { id: "polea", label: "Polea" },
  { id: "banda", label: "Banda elástica" },
  { id: "corporal", label: "Peso corporal" },
  { id: "otro", label: "Otro" },
] as const;

export type Equipment = (typeof EQUIPMENT)[number]["id"];

export const EQUIPMENT_UNSET_LABEL = "Sin indicar";

export function equipmentLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  return EQUIPMENT.find((e) => e.id === id)?.label ?? null;
}

/** Valor de un formulario → equipo o null ("" = sin indicar). */
export function parseEquipment(value: unknown): { ok: true; value: Equipment | null } | { ok: false } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const found = EQUIPMENT.find((e) => e.id === value);
  return found ? { ok: true, value: found.id } : { ok: false };
}

/** «Press de banca plano · Barra» (o solo el nombre si el equipo no está indicado). */
export function exerciseLabel(e: { name: string; equipment?: string | null }): string {
  const eq = equipmentLabel(e.equipment);
  return eq ? `${e.name} · ${eq}` : e.name;
}

/** Texto en el que se busca un ejercicio: nombre y equipo. */
export function exerciseSearchText(e: { name: string; equipment?: string | null }): string {
  return `${e.name} ${equipmentLabel(e.equipment) ?? ""}`;
}
