#!/usr/bin/env bash
# Aplica las migraciones en un PostgreSQL local temporal y ejecuta las pruebas
# de RLS y funciones. Requiere los binarios de PostgreSQL (initdb, pg_ctl, psql).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PATH="$PG_BIN:$PATH"
command -v initdb >/dev/null || { echo "No se encontró initdb. Define PG_BIN."; exit 1; }

WORK="$(mktemp -d)"
PORT="${PG_TEST_PORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  # PostgreSQL no arranca como root: usa el usuario 'postgres' si existe.
  chown -R postgres "$WORK"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() { "${RUN_AS[@]}" pg_ctl -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUN_AS[@]}" initdb -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null

PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres)

"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "Migración: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do
  echo "Pruebas:   $(basename "$f")"
  "${PSQL[@]}" -o /dev/null -f "$f"
done
echo "OK: todas las pruebas de base de datos pasaron."
