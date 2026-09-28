"""Single-process launcher: static app, read-only API and persistent sync worker."""
import argparse
import os
import threading
import time
import webbrowser
from urllib.request import urlopen

from backend.senoiot import load_env


def main():
    load_env()
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--port", type=int, default=int(os.getenv("AI_FARM_PORT", "8080")))
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    origin = f"http://127.0.0.1:{args.port}"
    os.environ.setdefault("AI_FARM_ALLOWED_ORIGINS", f"{origin},http://localhost:{args.port}")
    if not args.no_browser:
        def open_ready():
            for _ in range(30):
                try:
                    with urlopen(origin + "/api/health", timeout=1) as response:
                        if response.status == 200:
                            webbrowser.open(origin)
                            return
                except OSError:
                    time.sleep(1)
        threading.Thread(target=open_ready, daemon=True).start()
    import uvicorn
    uvicorn.run("backend.app:app", host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()
