#!/bin/bash
#
# Serve l'app di campo in locale per provarla prima di pubblicarla.
#
# Perché serve un server e non basta il doppio clic su index.html: da `file://`
# il browser considera l'origine opaca e blocca i moduli ES, i service worker e
# IndexedDB. L'app aperta così sembra rotta senza esserlo, e — molto peggio —
# la parte che si romperebbe è proprio quella che impedisce di perdere dati.
#
# `http://localhost` invece è un contesto sicuro a tutti gli effetti: si comporta
# esattamente come GitHub Pages.

set -euo pipefail
cd "$(dirname "$0")"

PORTA="${PORTA:-8777}"
PY="$(command -v python3 || true)"
[ -z "$PY" ] && { echo "python3 non trovato."; exit 1; }

if lsof -nP -iTCP:"$PORTA" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "La porta $PORTA è occupata. Riprova con:  PORTA=8778 ./serve_locale.command"
  exit 1
fi

echo "Ctrl+C per fermare."
( sleep 1 && open "http://localhost:$PORTA/" ) &
exec "$PY" serve_locale.py "$PORTA"
