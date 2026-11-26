const KEY = "sistema-gym:historial";

/** Guarda los filtros de Historial («?rango=…&q=…») para volver a la lista con ellos. */
export function saveHistoryQuery(search: string) {
  try {
    sessionStorage.setItem(KEY, search);
  } catch {}
}

/** Enlace a Historial con los últimos filtros usados en esta pestaña del navegador. */
export function historyHref(): string {
  try {
    const search = sessionStorage.getItem(KEY) ?? "";
    return search.startsWith("?") ? `/historial${search}` : "/historial";
  } catch {
    return "/historial";
  }
}
