#!/usr/bin/env python3
"""Tiny dev launcher for the simulation steps.

Usage:
  python sim.py            # list available steps
  python sim.py 3          # serve & open step-3/index.html
  python sim.py step-3     # same
  python sim.py 3 --port 8123
  python sim.py 3 --no-open

Stdlib only — no pip install.
"""
from __future__ import annotations

import argparse
import http.server
import os
import socket
import socketserver
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def list_steps() -> list[str]:
    out = []
    for p in sorted(ROOT.iterdir()):
        if p.is_dir() and (p / "index.html").exists():
            out.append(p.name)
    return out


def resolve_target(arg: str) -> str:
    """Accept '3', 'step-3', 'step3', or an exact folder name."""
    steps = list_steps()
    if arg in steps:
        return arg
    # numeric shorthand
    digits = "".join(c for c in arg if c.isdigit())
    if digits:
        for s in steps:
            sd = "".join(c for c in s if c.isdigit())
            if sd == digits:
                return s
    raise SystemExit(f"unknown step '{arg}'. available: {', '.join(steps) or '(none)'}")


def pick_port(preferred: int) -> int:
    for port in range(preferred, preferred + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("no free port found near %d" % preferred)


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """Disable caching so reloads always pick up edits."""

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        # quieter terminal — keep only errors
        if args and isinstance(args[1], str) and args[1].startswith(("4", "5")):
            super().log_message(fmt, *args)


def serve(port: int) -> socketserver.TCPServer:
    os.chdir(ROOT)
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", port), NoCacheHandler)
    httpd.daemon_threads = True
    t = threading.Thread(target=httpd.serve_forever, name="sim-http", daemon=True)
    t.start()
    return httpd


def main() -> None:
    ap = argparse.ArgumentParser(description="Launch a simulation step in the browser.")
    ap.add_argument("target", nargs="?", help="step name or number (e.g. 3, step-3)")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true", help="don't open a browser")
    ap.add_argument("--list", action="store_true", help="list available steps")
    args = ap.parse_args()

    steps = list_steps()
    if args.list or args.target is None:
        if not steps:
            print("no step folders with index.html found in", ROOT)
            return
        print("available steps:")
        for s in steps:
            print(" ", s)
        print("\nusage: python sim.py <step>   (e.g. python sim.py 3)")
        return

    folder = resolve_target(args.target)
    port = pick_port(args.port)
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/{folder}/index.html"
    print(f"serving {ROOT} on http://127.0.0.1:{port}")
    print(f"opening {url}")
    if not args.no_open:
        webbrowser.open(url)
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        print("\nshutting down")
        httpd.shutdown()


if __name__ == "__main__":
    main()
