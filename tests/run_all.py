"""Run every app test against a local copy of the app.

    python3 tests/run_all.py            (from the reader-app folder)

Needs Python with Playwright (pip install playwright; playwright install chromium).
Set CHROME=/path/to/chrome to use a specific browser. Each test prints what it checked;
a test fails if it crashes, an `assert` fails, or the page logged JavaScript errors.
Screenshots go to tests/shots/.
"""
import os, subprocess, sys, time, glob, http.server, threading, functools

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PORT = 8765

def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=ROOT)
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler).serve_forever()

def main():
    threading.Thread(target=serve, daemon=True).start()
    time.sleep(0.5)
    os.makedirs(os.path.join(HERE, 'shots'), exist_ok=True)
    tests = sorted(glob.glob(os.path.join(HERE, 't[0-9][0-9]_*.py')))
    only = sys.argv[1:]
    failed = []
    for t in tests:
        name = os.path.basename(t)
        if only and not any(o in name for o in only):
            continue
        print(f'\n=== {name}')
        r = subprocess.run([sys.executable, t, HERE], capture_output=True, text=True, timeout=900)
        out = (r.stdout + r.stderr).strip()
        print(out[-4000:])
        last_errors = [l for l in out.splitlines() if l.startswith('errors')]
        bad = r.returncode != 0 or (last_errors and last_errors[-1].strip() not in ('errors: []', 'errors []'))
        if bad:
            failed.append(name)
    print('\n' + ('ALL PASSED' if not failed else 'FAILED: ' + ', '.join(failed)))
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    main()
