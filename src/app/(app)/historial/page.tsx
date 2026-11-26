import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { readHistoryFilters } from "@/lib/history";
import { HistoryView } from "./HistoryView";

export const metadata: Metadata = { title: "Historial" };

/**
 * Historial: filtros rápidos por fecha local, búsqueda por ejercicio y lista por
 * meses. Las sesiones se cargan en el cliente (dependen de la fecha del
 * dispositivo) y se vuelven a pedir al regresar, para reflejar las correcciones.
 */
export default async function HistoryPage({ searchParams }: PageProps<"/historial">) {
  await requireUser();
  const params = await searchParams;
  const initial = readHistoryFilters(params);
  // La clave reinicia los filtros al navegar a /historial con otra URL (p. ej. desde la barra).
  return <HistoryView key={JSON.stringify(initial)} initial={initial} deleted={Boolean(params.eliminada)} />;
}
