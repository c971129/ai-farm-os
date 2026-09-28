#!/usr/bin/env python3
"""Cross-platform launcher for AI Farm OS (macOS / Linux / Windows).

Creates .venv if needed, installs requirements, ensures .env exists,
then starts the live backend (static UI + Senoiot telemetry).

Use --watch to keep the live API on the chosen port: reclaim the port from
static `python -m http.server` (no /api) and restart if the process exits.
"""
from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
REQ = ROOT / "requirements.txt"
ENV_EXAMPLE = ROOT / ".env.example"
ENV_FILE = ROOT / ".env"
PID_FILE = ROOT / ".runtime" / "backend.pid"
LOG_FILE = ROOT / ".runtime" / "backend.log"


def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def candidate_pythons() -> list[str]:
    names = [
        "python3.13",
        "python3.12",
        "python3.11",
        "python3.10",
        "python3",
        "python",
        "py",
    ]
    extras = [
        Path.home() / ".local" / "bin",
        Path("/opt/homebrew/bin"),
        Path("/usr/local/bin"),
    ]
    found: list[str] = []
    search_path = os.pathsep.join(
        [*(str(p) for p in extras if p.is_dir()), os.environ.get("PATH", "")]
    )
    for name in names:
        path = shutil.which(name, path=search_path)
        if path and path not in found:
            found.append(path)
    return found


def python_ok(exe: str) -> bool:
    try:
        out = subprocess.check_output(
            [exe, "-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        major, minor = map(int, out.split(".", 1))
        return (major, minor) >= (3, 10)
    except Exception:  # noqa: BLE001
        return False


def reexec_if_needed() -> None:
    if sys.version_info >= (3, 10):
        return
    for exe in candidate_pythons():
        if python_ok(exe) and Path(exe).resolve() != Path(sys.executable).resolve():
            os.execv(exe, [exe, str(Path(__file__).resolve()), *sys.argv[1:]])
    die(
        f"Python 3.10+ required (found {sys.version.split()[0]}).\n"
        "macOS: brew install python   or   uv python install 3.11"
    )


def venv_python() -> Path:
    if os.name == "nt":
        return VENV / "Scripts" / "python.exe"
    return VENV / "bin" / "python"


def venv_works(py: Path) -> bool:
    if not py.is_file():
        return False
    try:
        subprocess.check_output(
            [str(py), "-c", "import encodings,sys; print(sys.version)"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=30,
        )
        return True
    except Exception:  # noqa: BLE001
        return False


def create_venv() -> Path:
    print("Creating Python virtual environment (.venv)…")
    if VENV.exists():
        shutil.rmtree(VENV)

    uv = shutil.which("uv")
    if uv:
        rc = subprocess.call(
            [uv, "venv", str(VENV), "--python", sys.executable],
            cwd=ROOT,
        )
        if rc != 0:
            die("uv venv failed. Try: uv python install 3.11")
    else:
        try:
            builder = venv.EnvBuilder(with_pip=True, clear=True, symlinks=False)
            builder.create(VENV)
        except Exception as exc:  # noqa: BLE001
            die(
                f"Unable to create .venv: {exc}\n"
                "Install Python 3.10+ (brew/uv) and retry."
            )

    py = venv_python()
    if not venv_works(py):
        die(
            "Virtual environment is broken.\n"
            "If you use uv-managed Python, install uv and retry, or:\n"
            "  brew install python && rm -rf .venv && ./start.sh"
        )
    return py


def ensure_venv() -> Path:
    py = venv_python()
    if venv_works(py):
        return py
    if VENV.exists():
        print("Removing broken .venv…")
        shutil.rmtree(VENV)
    return create_venv()


def deps_ok(py: Path) -> bool:
    code = (
        "import importlib.util,sys;"
        "sys.exit(0 if all(importlib.util.find_spec(n) for n in "
        "('fastapi','uvicorn','pydantic')) else 1)"
    )
    return subprocess.call([str(py), "-c", code], cwd=ROOT) == 0


def ensure_deps(py: Path) -> None:
    if deps_ok(py):
        return
    print("Installing dependencies from requirements.txt…")
    uv = shutil.which("uv")
    if uv:
        rc = subprocess.call(
            [uv, "pip", "install", "-r", str(REQ), "--python", str(py)],
            cwd=ROOT,
        )
    else:
        rc = subprocess.call(
            [str(py), "-m", "pip", "install", "-r", str(REQ)],
            cwd=ROOT,
        )
    if rc != 0:
        die("Dependency installation failed. Check network and retry.")


def ensure_env() -> None:
    if ENV_FILE.exists():
        return
    if not ENV_EXAMPLE.exists():
        die(".env.example is missing; cannot create .env")
    ENV_FILE.write_bytes(ENV_EXAMPLE.read_bytes())
    print("Created .env from .env.example")
    print("Fill SENOIOT_ACCOUNT and SENOIOT_PASSWORD in .env to enable live readings.")


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def listeners(port: int) -> list[tuple[int, str]]:
    """Return [(pid, command), ...] listening on TCP port."""
    try:
        out = subprocess.check_output(
            ["lsof", f"-iTCP:{port}", "-sTCP:LISTEN", "-n", "-P"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
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
        try:
            cmd = subprocess.check_output(
                ["ps", "-p", str(pid), "-o", "command="],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except subprocess.CalledProcessError:
            cmd = parts[0]
        rows.append((pid, cmd))
    return rows


def is_our_backend(cmd: str) -> bool:
    return "backend.run" in cmd or "uvicorn backend.app" in cmd


def is_static_server(cmd: str) -> bool:
    return "http.server" in cmd


def reclaim_port(port: int) -> None:
    """Kill static http.server only. Never SIGKILL unknown python listeners.

    Mis-identifying uvicorn as a foreign occupant was a root cause of silent
    backend deaths (no traceback — just connection refused).
    """
    tracked = None
    try:
        tracked = int(PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        tracked = None
    for pid, cmd in listeners(port):
        if is_our_backend(cmd) or (tracked and pid == tracked):
            continue
        if is_static_server(cmd) or "http.server" in cmd:
            print(f"Reclaiming :{port} from static server pid={pid}")
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
            continue
        print(f"Leaving :{port} occupant pid={pid} alone ({cmd[:80]})")
    time.sleep(0.3)


def health_ok(port: int) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/health", timeout=2
        ) as resp:
            body = resp.read().decode("utf-8", "replace")
            return resp.status == 200 and "telemetry" in body
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def start_backend(py: Path, port: int, no_browser: bool) -> subprocess.Popen:
    PID_FILE.parent.mkdir(parents=True, exist_ok=True)
    cmd = [str(py), "-m", "backend.run", "--port", str(port)]
    if no_browser:
        cmd.append("--no-browser")
    log = open(LOG_FILE, "a", encoding="utf-8")  # noqa: SIM115
    log.write(f"\n---- start {time.strftime('%Y-%m-%d %H:%M:%S')} port={port} ----\n")
    log.flush()
    proc = subprocess.Popen(
        cmd,
        cwd=ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    PID_FILE.write_text(str(proc.pid), encoding="utf-8")
    return proc


def wait_healthy(port: int, seconds: float = 25) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if health_ok(port):
            return True
        time.sleep(0.5)
    return False


def run_watch(py: Path, port: int, no_browser: bool) -> int:
    print(f"Watch mode → http://127.0.0.1:{port}/  (Ctrl+C to stop)")
    print("Will reclaim static http.server and restart the live API if it dies.")
    print("Tip: ./scripts/keep-alive.sh start  →  detaches and survives terminal close.")
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    watch_log = LOG_FILE.parent / "watch.log"

    def wlog(msg: str) -> None:
        line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
        print(line)
        try:
            with watch_log.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass

    proc: subprocess.Popen | None = None
    try:
        while True:
            reclaim_port(port)
            if health_ok(port):
                time.sleep(3)
                continue
            # Stop stale our-backend if unhealthy
            for pid, cmd in listeners(port):
                if is_our_backend(cmd):
                    wlog(f"stopping unhealthy backend pid={pid}")
                    try:
                        os.kill(pid, signal.SIGTERM)
                    except OSError:
                        pass
            reclaim_port(port)
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
            exit_code = proc.poll() if proc else None
            wlog(f"Starting live backend on :{port}… (prev_exit={exit_code})")
            proc = start_backend(py, port, no_browser=True)
            if not wait_healthy(port):
                wlog("Backend failed to become healthy; retrying in 3s…")
                time.sleep(3)
                continue
            wlog(f"Live API ready → http://127.0.0.1:{port}/")
            if not no_browser:
                try:
                    import webbrowser

                    webbrowser.open(f"http://127.0.0.1:{port}/")
                except Exception:  # noqa: BLE001
                    pass
                no_browser = True  # open only once
            while True:
                time.sleep(3)
                reclaim_port(port)
                child_dead = proc.poll() is not None
                if not health_ok(port) or child_dead:
                    wlog(
                        f"Live API lost; restarting… "
                        f"(health_ok={health_ok(port)} child_exit={proc.poll()})"
                    )
                    break
    except KeyboardInterrupt:
        print("\nStopping…")
        if proc and proc.poll() is None:
            proc.terminate()
        return 0


def main() -> None:
    reexec_if_needed()

    parser = argparse.ArgumentParser(description="Start AI Farm OS (live telemetry)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser")
    parser.add_argument("--port", type=int, default=None, help="Override AI_FARM_PORT")
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Keep reclaiming the port and restart the live API if it dies",
    )
    args, passthrough = parser.parse_known_args()

    os.chdir(ROOT)
    py = ensure_venv()
    ensure_deps(py)
    ensure_env()

    port = args.port or int(os.getenv("AI_FARM_PORT", "8080"))
    reclaim_port(port)

    if args.watch:
        raise SystemExit(run_watch(py, port, args.no_browser))

    if not port_free(port):
        # After reclaim, still busy — fall back
        alt = 8090 if port != 8090 else 8091
        print(
            f"Port {port} is still busy after reclaim.\n"
            f"Switching to http://127.0.0.1:{alt}/",
            file=sys.stderr,
        )
        port = alt
        reclaim_port(port)
        if not port_free(port):
            die(f"Port {port} is also busy. Free it or pass --port N.")

    cmd = [str(py), "-m", "backend.run", "--port", str(port)]
    if args.no_browser:
        cmd.append("--no-browser")
    cmd.extend(passthrough)

    print(f"Starting AI Farm OS → http://127.0.0.1:{port}/")
    print("Press Ctrl+C to stop. Tip: ./start.sh --watch keeps the API alive.")
    raise SystemExit(subprocess.call(cmd, cwd=ROOT))


if __name__ == "__main__":
    main()
