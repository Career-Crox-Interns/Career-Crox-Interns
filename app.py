import atexit
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

import requests
from flask import Flask, Response, request

BASE_DIR = Path(__file__).resolve().parent
NODE_STARTED = False
NODE_PROCESS = None
NODE_LOCK = threading.Lock()


def _resolve_node_command():
    candidates = [
        os.environ.get('NODE_BINARY'),
        'node',
    ]
    for cmd in candidates:
        if not cmd:
            continue
        try:
            subprocess.run([cmd, '--version'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            return cmd
        except Exception:
            continue
    raise RuntimeError('Node.js binary not found for Render bridge startup')


def _pick_internal_port():
    preferred = int(os.environ.get('INTERNAL_NODE_PORT', '10001'))
    external = int(os.environ.get('PORT', '10000'))
    if preferred == external:
        preferred += 1
    return preferred


def _wait_for_port(host: str, port: int, timeout: float = 40.0):
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.5):
                return
        except OSError as exc:
            last_error = exc
            time.sleep(0.5)
    raise RuntimeError(f'Node backend did not start on {host}:{port}: {last_error}')


def _start_node_backend():
    global NODE_STARTED, NODE_PROCESS
    if NODE_STARTED and NODE_PROCESS and NODE_PROCESS.poll() is None:
        return
    with NODE_LOCK:
        if NODE_STARTED and NODE_PROCESS and NODE_PROCESS.poll() is None:
            return

        node_cmd = _resolve_node_command()
        internal_port = _pick_internal_port()
        backend_dir = BASE_DIR / 'backend'
        if not backend_dir.exists():
            raise RuntimeError(f'backend directory missing at {backend_dir}')

        env = os.environ.copy()
        env['PORT'] = str(internal_port)
        env.setdefault('HOST', '127.0.0.1')
        env.setdefault('NODE_ENV', 'production')

        server_file = backend_dir / 'server.js'
        if not server_file.exists():
            raise RuntimeError(f'backend/server.js missing at {server_file}')

        NODE_PROCESS = subprocess.Popen(
            [node_cmd, str(server_file)],
            cwd=str(backend_dir),
            env=env,
            stdout=None,
            stderr=None,
        )
        _wait_for_port('127.0.0.1', internal_port)
        NODE_STARTED = True

        def _cleanup():
            global NODE_PROCESS
            if NODE_PROCESS and NODE_PROCESS.poll() is None:
                try:
                    NODE_PROCESS.terminate()
                    NODE_PROCESS.wait(timeout=8)
                except Exception:
                    try:
                        NODE_PROCESS.kill()
                    except Exception:
                        pass

        atexit.register(_cleanup)


def _node_base_url():
    return f"http://127.0.0.1:{_pick_internal_port()}"


def _proxy(path: str = ''):
    _start_node_backend()
    url = f"{_node_base_url()}/{path}" if path else f"{_node_base_url()}/"
    if request.query_string:
        url = f"{url}?{request.query_string.decode('utf-8', errors='ignore')}"

    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in {'host', 'content-length', 'connection'}
    }

    resp = requests.request(
        method=request.method,
        url=url,
        headers=headers,
        data=request.get_data(),
        cookies=request.cookies,
        allow_redirects=False,
        timeout=120,
    )

    excluded = {'content-encoding', 'content-length', 'transfer-encoding', 'connection'}
    response_headers = [(k, v) for k, v in resp.headers.items() if k.lower() not in excluded]
    return Response(resp.content, resp.status_code, response_headers)


app = Flask(__name__)


@app.route('/', defaults={'path': ''}, methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
@app.route('/<path:path>', methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
def catch_all(path: str):
    return _proxy(path)
