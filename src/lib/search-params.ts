import { isIsoDate } from "./format";

export function readDateRange(params: Record<string, string | string[] | undefined>) {
  const from = typeof params.desde === "string" && isIsoDate(params.desde) ? params.desde : "";
  const to = typeof params.hasta === "string" && isIsoDate(params.hasta) ? params.hasta : "";
  // Si el rango viene invertido, se intercambia.
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}
