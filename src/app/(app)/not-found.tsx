import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card empty stack">
      <h1>No encontrado</h1>
      <p>Este registro no existe o no te pertenece.</p>
      <Link className="btn btn-primary" href="/">Volver al inicio</Link>
    </div>
  );
}
