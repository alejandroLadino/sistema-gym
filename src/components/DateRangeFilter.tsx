import Link from "next/link";

/** Filtro por rango de fechas (GET): funciona sin JavaScript. */
export function DateRangeFilter({ action, from, to }: { action: string; from: string; to: string }) {
  return (
    <form action={action} className="card form-grid" aria-label="Filtrar por fechas">
      <div className="form-grid cols-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label className="field">
          <span>Desde</span>
          <input className="input" type="date" name="desde" defaultValue={from} />
        </label>
        <label className="field">
          <span>Hasta</span>
          <input className="input" type="date" name="hasta" defaultValue={to} />
        </label>
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary">Filtrar</button>
        {from || to ? <Link href={action} className="btn btn-ghost">Quitar filtro</Link> : null}
      </div>
    </form>
  );
}
