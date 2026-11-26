import Link from "next/link";
import { formatDate } from "@/lib/format";

export type SessionRow = {
  id: string;
  session_date: string;
  created_at: string;
  exercise_count: number;
  set_count: number;
  exercises: { name: string; sets: number }[];
  /** null = en curso. */
  finished_at?: string | null;
};

export function SessionListItem({ session }: { session: SessionRow }) {
  return (
    <Link href={`/sesiones/${session.id}`} className="link-card">
      <div className="card stack" style={{ gap: 6 }}>
        <div className="row between">
          <strong>
            {formatDate(session.session_date)}{" "}
            {session.finished_at === null ? <span className="badge badge-warning">En curso</span> : null}
          </strong>
          <span className="badge">
            {session.exercise_count} {session.exercise_count === 1 ? "ejercicio" : "ejercicios"} · {session.set_count}{" "}
            {session.set_count === 1 ? "serie" : "series"}
          </span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {session.exercises.length
            ? session.exercises.map((e) => `${e.name} (${e.sets})`).join(" · ")
            : "Sin ejercicios"}
        </p>
      </div>
    </Link>
  );
}
