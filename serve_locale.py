#!/usr/bin/env python3
"""
Server statico per provare Scudo Campo in locale.

Non è `python -m http.server`, e la differenza conta: quello non manda nessuna
intestazione di cache, il browser applica la propria euristica e continua a
servire i moduli JavaScript vecchi dopo che li hai modificati. Misurato il
2026-08-24: una correzione all'avvio sembrava non funzionare per quindici
minuti, e il codice caricato era quello di prima (`transferSize: 0`).

Un server di prova che mostra una versione diversa da quella su disco non è un
fastidio, è uno strumento che mente: fa credere che una correzione non funzioni,
o peggio che un difetto sia risolto.

`Cache-Control: no-store` toglie il problema in sviluppo. In produzione, su
GitHub Pages, la cache la governa il service worker con il proprio numero di
versione.
"""
import http.server
import sys
from functools import partial


class SenzaCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    server = http.server.ThreadingHTTPServer(("127.0.0.1", porta), SenzaCache)
    print(f"Scudo Campo su http://localhost:{porta}/  (cache disattivata)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nfermato.")
