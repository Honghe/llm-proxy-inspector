import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DIST_ROOT = ROOT / "dist"


class SpaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST_ROOT), **kwargs)

    def do_GET(self):
        if not DIST_ROOT.exists():
            self.send_response(503)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Frontend assets not built. Run `cd frontend && npm install && npm run build`.")
            return

        path = self.translate_path(self.path)
        if self.path.startswith("/assets/") and Path(path).exists():
            return super().do_GET()
        if self.path in ("/", "/index.html") or not Path(path).exists():
            self.path = "/index.html"
        return super().do_GET()


def main() -> None:
    parser = argparse.ArgumentParser(description="LLM Proxy Inspector Frontend")
    parser.add_argument("--host", default=os.getenv("FRONTEND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("FRONTEND_PORT", "7655")))
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), SpaHandler)
    print(f"  Frontend -> http://{args.host}:{args.port}")
    print()
    server.serve_forever()


if __name__ == "__main__":
    main()
