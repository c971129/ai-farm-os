#!/usr/bin/env python3
"""Keep AI Farm OS live API stable.

Root causes this guards against
--------------------------------
1. Shell-background (`&`) backends die on SIGHUP when the parent agent/terminal
   session ends — no traceback, only a sudden connection refused.
2. Aggressive port reclaim that treats an unrecognized `python3.x` listener as
   foreign and SIGKILLs our own uvicorn.

This supervisor:
- detaches into its own session (survives terminal close)
- health-checks `/api/health` every few seconds
- restarts `backend.run` with exponential backoff
- logs restart reasons + exit codes to `.runtime/keep_alive.log`
- writes `.runtime/heartbeat.json` for quick status

Usage
-----
  ./scripts/keep_alive.sh start      # or: python3 scripts/keep_alive.py start
  ./scripts/keep_alive.sh status
  ./scripts/keep_alive.sh stop
  ./scripts/keep_alive.sh restart
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".runtime"
VENV_PY = ROOT / ".venv" / "bin" / "python"
if os.name == "nt":
    VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"

SUPERVISOR_PID = RUNTIME / "keep_alive.pid"
BACKEND_PID = RUNTIME / "backend.pid"
SUPERVISOR_LOG = RUNTIME / "keep_alive.log"
BACKEND_LOG = RUNTIME / "backend.log"
HEARTBEAT = RUNTIME / "heartbeat.json"
DEFAULT_PORT = int(os.getenv("AI_FARM_PORT", "8080"))


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M:%S%z")


def log(msg: str) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    line = f"[{now_iso()}] {msg}\n"
    with SUPERVISOR_LOG.open("a", encoding="utf-8") as fh:
        fh.write(line)
        fh.flush()
    # After daemonize, stdout is already the log file — avoid duplicate lines.
    if os.environ.get("AI_FARM_KEEPALIVE_DAEMON") == "1":
        return
    try:
        if sys.stdout.isatty():
            sys.stdout.write(line)
            sys.stdout.flush()
    except Exception:  # noqa: BLE001
        pass


def read_pid(path: Path) -> int | None:
    try:
        pid = int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    try:
        os.kill(pid, 0)
    except OSError:
        return None
    return pid


def write_pid(path: Path, pid: int) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    path.write_text(str(pid), encoding="utf-8")


def pid_cmdline(pid: int) -> str:
    try:
        return subprocess.check_output(
            ["ps", "-p", str(pid), "-o", "command="],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return ""


def is_our_backend_cmd(cmd: str) -> bool:
    return "backend.run" in cmd or "uvicorn backend.app" in cmd


def is_static_server_cmd(cmd: str) -> bool:
    return "http.server" in cmd


def listeners(port: int) -> list[tuple[int, str]]:
    try:
        out = subprocess.check_output(
            ["lsof", f"-iTCP:{port}", "-sTCP:LISTEN", "-n", "-P"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, OSError):
        return []
    rows: list[tuple[int, str]] = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[1])
        except ValueError:
            continue
        rows.append((pid, pid_cmdline(pid) or parts[0]))
    return rows


def health_ok(port: int) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/health", timeout=2.5
        ) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status == 200 and "telemetry" in body
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def write_heartbeat(port: int, *, state: str, detail: str = "") -> None:
    payload = {
        "ts": now_iso(),
        "port": port,
        "state": state,
        "detail": detail,
        "supervisor_pid": os.getpid(),
        "backend_pid": read_pid(BACKEND_PID),
        "health": health_ok(port),
        "url": f"http://127.0.0.1:{port}/",
    }
    RUNTIME.mkdir(parents=True, exist_ok=True)
    HEARTBEAT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def safe_reclaim(port: int) -> None:
    """Only remove static http.server. Never kill unknown/python listeners."""
    for pid, cmd in listeners(port):
        if is_our_backend_cmd(cmd):
            continue
        tracked = read_pid(BACKEND_PID)
        if tracked and pid == tracked:
            continue
        if is_static_server_cmd(cmd):
            log(f"reclaim: killing static http.server pid={pid}")
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
            continue
        # Leave unknown occupants alone — mis-killing uvicorn was a crash cause.
        log(f"reclaim: leaving pid={pid} alone ({cmd[:100]})")


def stop_pid(pid: int, label: str, timeout: float = 8) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except OSError:
            log(f"stopped {label} pid={pid}")
            return
        time.sleep(0.2)
    try:
        os.kill(pid, signal.SIGKILL)
        log(f"force-killed {label} pid={pid}")
    except OSError:
        pass


def venv_python() -> Path:
    if VENV_PY.exists():
        return VENV_PY
    return Path(sys.executable)


def start_backend(port: int) -> subprocess.Popen:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    py = venv_python()
    cmd = [str(py), "-m", "backend.run", "--port", str(port), "--no-browser"]
    log_fh = BACKEND_LOG.open("a", encoding="utf-8")
    log_fh.write(f"\n---- keep_alive start {now_iso()} port={port} ----\n")
    log_fh.flush()
    proc = subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdout=log_fh,
        stderr=subprocess.STDOUT,
        start_new_session=True,  # detach from supervisor TTY / SIGHUP
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    write_pid(BACKEND_PID, proc.pid)
    log(f"started backend pid={proc.pid} port={port}")
    return proc


def wait_healthy(port: int, seconds: float = 30) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if health_ok(port):
            return True
        time.sleep(0.5)
    return False


def ensure_detached() -> None:
    """Re-exec into a daemon session if still attached to a controlling terminal."""
    if os.environ.get("AI_FARM_KEEPALIVE_DAEMON") == "1":
        return
    if os.name == "nt":
        return
    # Fork once, setsid, redirect stdio, re-exec with marker.
    if os.fork() > 0:
        time.sleep(0.4)
        raise SystemExit(0)
    os.setsid()
    if os.fork() > 0:
        raise SystemExit(0)
    os.chdir(str(ROOT))
    os.environ["AI_FARM_KEEPALIVE_DAEMON"] = "1"
    # Redirect stdio to log
    RUNTIME.mkdir(parents=True, exist_ok=True)
    log_fd = os.open(
        str(SUPERVISOR_LOG),
        os.O_WRONLY | os.O_CREAT | os.O_APPEND,
        0o644,
    )
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)
    try:
        null = os.open(os.devnull, os.O_RDONLY)
        os.dup2(null, 0)
        os.close(null)
    except OSError:
        pass
    os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]])


def supervise(port: int, interval: float, backoff_max: float) -> int:
    write_pid(SUPERVISOR_PID, os.getpid())
    log(f"supervisor online pid={os.getpid()} port={port} interval={interval}s")
    proc: subprocess.Popen | None = None
    failures = 0
    stopping = False

    def on_signal(signum, _frame):  # noqa: ANN001
        nonlocal stopping
        stopping = True
        log(f"supervisor got signal {signum}; shutting down")

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    while not stopping:
        write_heartbeat(port, state="checking")
        if health_ok(port):
            failures = 0
            # Adopt existing healthy listener if we have no child handle
            if proc is None or proc.poll() is not None:
                for pid, cmd in listeners(port):
                    if is_our_backend_cmd(cmd):
                        write_pid(BACKEND_PID, pid)
                        break
            write_heartbeat(port, state="healthy", detail="api responding")
            time.sleep(interval)
            continue

        # Unhealthy: decide why
        exit_info = ""
        if proc is not None:
            code = proc.poll()
            if code is not None:
                exit_info = f" child_exit={code}"
            elif proc.poll() is None:
                # Still running but health failed — soft restart
                log("health failed while backend process still alive; restarting")
                stop_pid(proc.pid, "backend")
                exit_info = " health_timeout"
                proc = None

        safe_reclaim(port)
        # Also stop our tracked backend if still listed but unhealthy
        tracked = read_pid(BACKEND_PID)
        if tracked:
            cmd = pid_cmdline(tracked)
            if is_our_backend_cmd(cmd):
                stop_pid(tracked, "stale-backend")

        delay = min(backoff_max, 2 ** min(failures, 4))
        log(f"restarting backend (failure#{failures + 1}{exit_info}); backoff {delay:.1f}s")
        write_heartbeat(port, state="restarting", detail=exit_info.strip() or "down")
        time.sleep(delay)
        if stopping:
            break
        try:
            proc = start_backend(port)
        except OSError as exc:
            failures += 1
            log(f"failed to spawn backend: {exc}")
            continue
        if wait_healthy(port):
            failures = 0
            log("backend healthy after restart")
            write_heartbeat(port, state="healthy", detail="restarted")
        else:
            failures += 1
            code = proc.poll()
            log(f"backend failed health check after start (exit={code})")
            write_heartbeat(port, state="unhealthy", detail=f"exit={code}")

    if proc and proc.poll() is None:
        stop_pid(proc.pid, "backend")
    if SUPERVISOR_PID.exists():
        try:
            SUPERVISOR_PID.unlink()
        except OSError:
            pass
    write_heartbeat(port, state="stopped")
    log("supervisor exit")
    return 0


def cmd_start(port: int, interval: float, backoff_max: float, foreground: bool) -> int:
    existing = read_pid(SUPERVISOR_PID)
    if existing and existing != os.getpid():
        print(f"keep_alive already running pid={existing}")
        print(f"status: {HEARTBEAT}")
        return 0
    if not foreground:
        ensure_detached()
    return supervise(port, interval, backoff_max)


def cmd_stop() -> int:
    spid = read_pid(SUPERVISOR_PID)
    if spid:
        stop_pid(spid, "supervisor")
    else:
        print("no supervisor pid")
    bpid = read_pid(BACKEND_PID)
    # Only stop if it still looks like ours
    if bpid and is_our_backend_cmd(pid_cmdline(bpid)):
        stop_pid(bpid, "backend")
    for path in (SUPERVISOR_PID,):
        if path.exists():
            try:
                path.unlink()
            except OSError:
                pass
    print("stopped")
    return 0


def cmd_status(port: int) -> int:
    spid = read_pid(SUPERVISOR_PID)
    bpid = read_pid(BACKEND_PID)
    ok = health_ok(port)
    hb = {}
    if HEARTBEAT.exists():
        try:
            hb = json.loads(HEARTBEAT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            hb = {}
    print(f"url:        http://127.0.0.1:{port}/")
    print(f"health:     {'ok' if ok else 'DOWN'}")
    print(f"supervisor: {spid or '—'}")
    print(f"backend:    {bpid or '—'}")
    if hb:
        print(f"heartbeat:  {hb.get('ts')} state={hb.get('state')} {hb.get('detail') or ''}")
    print(f"log:        {SUPERVISOR_LOG}")
    return 0 if ok and spid else 1


def cmd_restart(port: int, interval: float, backoff_max: float) -> int:
    cmd_stop()
    time.sleep(1)
    return cmd_start(port, interval, backoff_max, foreground=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Keep AI Farm OS backend alive")
    parser.add_argument(
        "action",
        choices=["start", "stop", "status", "restart", "run"],
        help="run = foreground supervise (no daemonize)",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--interval", type=float, default=5.0, help="health poll seconds")
    parser.add_argument("--backoff-max", type=float, default=60.0)
    args = parser.parse_args()

    if not (1024 <= args.port <= 65535):
        print("port must be 1024–65535", file=sys.stderr)
        return 2

    if args.action == "start":
        return cmd_start(args.port, args.interval, args.backoff_max, foreground=False)
    if args.action == "run":
        return cmd_start(args.port, args.interval, args.backoff_max, foreground=True)
    if args.action == "stop":
        return cmd_stop()
    if args.action == "status":
        return cmd_status(args.port)
    if args.action == "restart":
        return cmd_restart(args.port, args.interval, args.backoff_max)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
