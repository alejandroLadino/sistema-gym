export const MAX_WEIGHT_KG = 2000;
export const MAX_REPS = 1000;
export const MIN_PASSWORD_LENGTH = 8;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Acepta "42,5" o "42.5". Vacío = peso corporal (null). Máximo dos decimales. */
export function parseWeight(input: string): Parsed<number | null> {
  const raw = input.trim().replace(",", ".");
  if (raw === "") return { ok: true, value: null };
  if (!/^\d{1,4}(\.\d{0,2})?$/.test(raw)) {
    return { ok: false, error: "Peso inválido (máx. 2 decimales)" };
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > MAX_WEIGHT_KG) {
    return { ok: false, error: `El peso debe estar entre 0 y ${MAX_WEIGHT_KG} kg` };
  }
  return { ok: true, value: Math.round(value * 100) / 100 };
}

export function parseReps(input: string): Parsed<number> {
  const raw = input.trim();
  if (raw === "") return { ok: false, error: "Indica las repeticiones" };
  if (!/^\d{1,4}$/.test(raw)) return { ok: false, error: "Repeticiones inválidas" };
  const value = Number(raw);
  if (value < 1 || value > MAX_REPS) {
    return { ok: false, error: `Entre 1 y ${MAX_REPS} repeticiones` };
  }
  return { ok: true, value };
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > 72) return "La contraseña no puede superar 72 caracteres.";
  return null;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Normaliza para búsquedas: minúsculas y sin acentos. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function cleanText(value: FormDataEntryValue | null, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}
