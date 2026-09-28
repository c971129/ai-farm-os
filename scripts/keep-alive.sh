#!/usr/bin/env bash
# Durable supervisor for AI Farm OS live API (survives terminal close).
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

if [[ -x .venv/bin/python ]]; then
  PY=".venv/bin/python"
else
  PY="$(command -v python3 || true)"
fi

if [[ -z "${PY}" ]]; then
  echo "需要 Python 3.10+ 或先运行 ./start.sh 创建 .venv" >&2
  exit 1
fi

action="${1:-status}"
shift || true
exec "$PY" scripts/keep_alive.py "$action" "$@"
