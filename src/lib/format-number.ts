/** «42,5» — sin dependencias, para evitar ciclos entre módulos de formato. */
export function formatKg(value: number): string {
  return new Intl.NumberFormat("es", { maximumFractionDigits: 2 }).format(value);
}
