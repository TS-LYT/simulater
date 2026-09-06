#!/usr/bin/env python3
"""ACE TCP 旁路代理。

不修改 new-sealinx 源码：节点仍连本机 6666，流量原样转到官方
sealinx_ace_simulator，同时解析 phy.src / phy.dst 推给 Three.js。
"""
from __future__ import print_function

import argparse
import json
import select
import socket
import struct
import threading
import time
import traceback

try:
    from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
except ImportError:
    from BaseHTTPServer import BaseHTTPRequestHandler, HTTPServer
    from SocketServer import ThreadingMixIn
    class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
        daemon_threads = True

ACE_PACKET_SIZE = 8 * 4 + 5120
HEADER = struct.Struct("<8i")

clients = []
clients_lock = threading.Lock()
event_id = 0
event_lock = threading.Lock()


def log(msg):
    print("[bridge] " + msg, flush=True)


def emit(event):
    global event_id
    with event_lock:
        event_id += 1
        payload = dict(event)
        payload["id"] = event_id
        payload["ts"] = time.time()
        data = json.dumps(payload, ensure_ascii=False)
    dead = []
    with clients_lock:
        for waiter in list(clients):
            try:
                waiter(data)
            except Exception:
                dead.append(waiter)
        for waiter in dead:
            if waiter in clients:
                clients.remove(waiter)


def parse_packet(buf):
    fields = HEADER.unpack_from(buf)
    dst, src, mode, typ, guard, power, fd, payload_size = fields
    size = max(0, min(payload_size, 5120))
    raw = buf[32 : 32 + size]
    text = "".join(chr(b) if 32 <= b < 127 else " " for b in raw).strip()
    return {
        "type": "packet",
        "src": int(src),
        "dst": int(dst),
        "mode": int(mode),
        "payload_size": int(size),
        "payload": text[:80],
    }


class SSEHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log("http " + (fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/health"):
            body = b'{"ok":true}\n'
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if not self.path.startswith("/events"):
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        queue = []
        lock = threading.Lock()

        def waiter(data):
            with lock:
                queue.append(data)

        with clients_lock:
            clients.append(waiter)
        emit({"type": "hello", "message": "ace-bridge"})
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                item = None
                with lock:
                    if queue:
                        item = queue.pop(0)
                if item is None:
                    time.sleep(0.05)
                    continue
                chunk = ("data: %s\n\n" % item).encode("utf-8")
                self.wfile.write(chunk)
                self.wfile.flush()
        except Exception:
            pass
        finally:
            with clients_lock:
                if waiter in clients:
                    clients.remove(waiter)


def pipe_pair(node_id, client, backend):
    buffers = {client: bytearray(), backend: bytearray()}
    skip_id = {client: True, backend: False}
    sockets = [client, backend]
    try:
        while True:
            readable, _, _ = select.select(sockets, [], [], 1.0)
            if not readable:
                continue
            for sock in readable:
                peer = backend if sock is client else client
                data = sock.recv(8192)
                if not data:
                    return
                if sock is client:
                    buffers[sock].extend(data)
                    buf = buffers[sock]
                    if skip_id[sock]:
                        if len(buf) < 4:
                            continue
                        reported = struct.unpack_from("<I", buf)[0]
                        peer.sendall(buf[:4])
                        del buf[:4]
                        skip_id[sock] = False
                        emit({"type": "join", "node": int(reported or node_id)})
                    while len(buf) >= ACE_PACKET_SIZE:
                        packet = bytes(buf[:ACE_PACKET_SIZE])
                        del buf[:ACE_PACKET_SIZE]
                        try:
                            emit(parse_packet(packet))
                        except Exception:
                            traceback.print_exc()
                        peer.sendall(packet)
                else:
                    peer.sendall(data)
    except Exception:
        pass
    finally:
        try:
            client.close()
        except Exception:
            pass
        try:
            backend.close()
        except Exception:
            pass
        emit({"type": "leave", "node": int(node_id)})


def handle_client(client, backend_addr):
    client.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    node_id = 0
    backend = socket.create_connection(backend_addr, timeout=5)
    backend.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    backend.settimeout(None)
    client.settimeout(None)
    log("node socket %s -> %s:%s" % (client.getpeername(), backend_addr[0], backend_addr[1]))
    pipe_pair(node_id, client, backend)


def tcp_server(listen_port, backend_addr):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("0.0.0.0", listen_port))
    server.listen(16)
    log("ACE proxy listen 0.0.0.0:%s -> %s:%s" % (listen_port, backend_addr[0], backend_addr[1]))
    while True:
        client, addr = server.accept()
        log("accept %s:%s" % addr)
        thread = threading.Thread(target=handle_client, args=(client, backend_addr))
        thread.daemon = True
        thread.start()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen", type=int, default=6666)
    parser.add_argument("--backend", default="127.0.0.1:16666")
    parser.add_argument("--http", type=int, default=8765)
    args = parser.parse_args()
    host, port = args.backend.rsplit(":", 1)
    backend_addr = (host, int(port))
    tcp = threading.Thread(target=tcp_server, args=(args.listen, backend_addr))
    tcp.daemon = True
    tcp.start()
    httpd = ThreadingHTTPServer(("0.0.0.0", args.http), SSEHandler)
    httpd.daemon_threads = True
    log("SSE http://127.0.0.1:%s/events" % args.http)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
