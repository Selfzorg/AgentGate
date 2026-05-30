#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${ROOT_DIR}/.postgres/data"
LOG_FILE="${ROOT_DIR}/.postgres/postgres.log"
PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-agentgate}"
DB_USER="${POSTGRES_USER:-agentgate}"
DB_PASSWORD="${POSTGRES_PASSWORD:-agentgate}"

export PATH="/opt/homebrew/opt/postgresql@16/bin:/usr/local/opt/postgresql@16/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

require_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

init_cluster() {
  require_bin initdb
  require_bin pg_ctl
  require_bin createdb
  require_bin psql

  mkdir -p "$(dirname "${DATA_DIR}")"
  if [ ! -d "${DATA_DIR}" ]; then
    initdb -D "${DATA_DIR}" --auth=trust --encoding=UTF8 --locale=C
  fi

  if ! pg_ctl -D "${DATA_DIR}" status >/dev/null 2>&1; then
    pg_ctl -D "${DATA_DIR}" -l "${LOG_FILE}" -o "-p ${PORT}" start
  fi

  if ! psql -p "${PORT}" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
    psql -p "${PORT}" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}' CREATEDB;"
  fi

  if ! psql -p "${PORT}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
    createdb -p "${PORT}" -O "${DB_USER}" "${DB_NAME}"
  fi

  echo "Postgres ready on localhost:${PORT}/${DB_NAME}"
}

case "${COMMAND}" in
  init)
    init_cluster
    ;;
  start)
    require_bin pg_ctl
    mkdir -p "$(dirname "${DATA_DIR}")"
    if pg_ctl -D "${DATA_DIR}" status >/dev/null 2>&1; then
      echo "Postgres already running on localhost:${PORT}/${DB_NAME}"
    else
      pg_ctl -D "${DATA_DIR}" -l "${LOG_FILE}" -o "-p ${PORT}" start
    fi
    ;;
  stop)
    require_bin pg_ctl
    pg_ctl -D "${DATA_DIR}" stop
    ;;
  *)
    echo "Usage: $0 {init|start|stop}" >&2
    exit 1
    ;;
esac
