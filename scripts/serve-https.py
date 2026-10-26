import functools
import http.server
import pathlib
import ssl
import sys

root = pathlib.Path(__file__).resolve().parent.parent
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8443

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
server = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(root / ".certs" / "cert.pem", root / ".certs" / "key.pem")
server.socket = context.wrap_socket(server.socket, server_side=True)

print(f"HTTPS em https://0.0.0.0:{port}", flush=True)
server.serve_forever()
