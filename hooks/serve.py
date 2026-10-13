# ponytail: one-file local server for the splat pane. Routes:
#   GET  /             viewer.html         GET /splat  the splat file
#   GET  /snap?az=&d=  render that view: starts headless Chrome once, later calls just hand it the new view
#   GET  /next         long-poll the headless page uses to wait for the next view
#   POST /shot         PNG written to OUT, prints SHOT      POST /log  page errors, printed as LOG ...
# stdout: first line the port, then SHOT / LOG lines; the mod reads those.
import http.server, os, shutil, signal, subprocess, sys, threading, time
VIEWER, SPLAT, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
EXT = os.path.splitext(SPLAT)[1].lstrip('.').lower()
TMP = os.path.dirname(OUT)
os.makedirs(TMP, exist_ok=True)
CHROME = next((c for c in [os.environ.get('CHROME_BIN'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    shutil.which('google-chrome'), shutil.which('chromium'), shutil.which('chromium-browser')] if c and os.path.exists(c)), None)
chrome = None
pending = None            # the next view's query string, handed to the page by /next
cond = threading.Condition()

PROFILE = TMP + '/chrome-' + str(os.getpid())  # ponytail: one profile per server, Chrome refuses to share one across instances

# a server that was SIGKILLed could not remove its profile: sweep those of servers no longer running
def alive(pid):
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True
for name in os.listdir(TMP):
    if name.startswith('chrome-') and name[7:].isdigit() and not alive(int(name[7:])):
        shutil.rmtree(os.path.join(TMP, name), ignore_errors=True)

def kill():
    global chrome
    with cond:
        if chrome: chrome.kill(); chrome.wait(); chrome = None
    shutil.rmtree(PROFILE, ignore_errors=True)
    try: os.remove(OUT)
    except OSError: pass

# Chrome reads commands from fd 3 and quits when that pipe closes, so it dies with this process even on SIGKILL.
# ponytail: we never speak the protocol; our end of the pipe only has to stay open.
def start_chrome(url):
    r_in, w_in = os.pipe(); r_out, w_out = os.pipe()
    def wire(): os.dup2(r_in, 3); os.dup2(w_out, 4)
    proc = subprocess.Popen([CHROME, '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--user-data-dir=' + PROFILE,
        '--hide-scrollbars', '--window-size=960,600', url], preexec_fn=wire, pass_fds=(3, 4), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.close(r_in); os.close(w_out)
    proc.pipe_ends = (w_in, r_out)
    return proc

# A crashed or force-quit Claude Code sends no signal: when we are reparented, its child is gone, so go too.
def watch_parent():
    parent = os.getppid()
    while os.getppid() == parent: time.sleep(1)
    kill(); os._exit(0)

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, body=b'', ctype='text/plain'):
        self.send_response(code)
        self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(body)))
        self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        global chrome, pending
        route, _, query = self.path.partition('?')
        if route == '/':
            with open(VIEWER, 'rb') as f: self.reply(200, f.read(), 'text/html')
        elif route == '/splat':
            with open(SPLAT, 'rb') as f: self.reply(200, f.read(), 'application/octet-stream')
        elif route == '/snap':
            if not CHROME: print('LOG no Chrome found; set CHROME_BIN', flush=True); self.reply(500); return
            with cond:
                if chrome and chrome.poll() is None:
                    pending = query; cond.notify_all()
                else:
                    url = 'http://127.0.0.1:%d/?ext=%s&shot=1&%s' % (self.server.server_address[1], EXT, query)
                    chrome = start_chrome(url)
            self.reply(204)
        elif route == '/next':
            with cond:
                cond.wait_for(lambda: pending is not None, timeout=25)
                view, pending = pending, None
            self.reply(200, view.encode()) if view is not None else self.reply(204)
        else: self.reply(404)
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/shot':
            with open(OUT, 'wb') as f: f.write(body)
            print('SHOT', flush=True)
        else: print('LOG ' + body.decode(errors='replace').replace('\n', ' ')[:300], flush=True)
        self.reply(204)

srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP): signal.signal(sig, lambda *a: (kill(), os._exit(0)))
threading.Thread(target=watch_parent, daemon=True).start()
print(srv.server_address[1], flush=True)
try: srv.serve_forever()
finally: kill()
