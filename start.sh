#!/usr/bin/env bash
# macOS / Linux — live API with port reclaim + auto-restart (default --watch)
set -euo pipefail
cd "$(dirname "$0")"

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:${PATH}"

pick_python() {
  local c
  for c in python3.13 python3.12 python3.11 python3.10 python3 python; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
        echo "$c"
        return 0
      fi
    fi
  done
  return 1
}

PY="$(pick_python || true)"
if [[ -z "${PY}" ]]; then
  echo "需要 Python 3.10+。" >&2
  echo "macOS 可用: brew install python   或   uv python install 3.11" >&2
  exit 1
fi

# Default to watch mode unless user already passed --watch / --help / -h
HAS_WATCH=0
HAS_HELP=0
for arg in "$@"; do
  case "$arg" in
    --watch) HAS_WATCH=1 ;;
    -h|--help) HAS_HELP=1 ;;
  esac
done

if [[ $HAS_HELP -eq 1 ]]; then
  exec "$PY" start.py "$@"
fi

if [[ $HAS_WATCH -eq 1 ]]; then
  exec "$PY" start.py "$@"
fi

exec "$PY" start.py --watch "$@"
