# Scudo Campo — regole

PWA che l'operatore usa **sul posto**: offline, su un telefono, spesso con i
guanti, dentro una cabina. Pubblicata su GitHub Pages con l'account `ghfb1`.

## Le tre regole che non si negoziano

### 1. Zero dipendenze esterne

Nessuna libreria, nessun bundler, nessun passo di build: moduli ES serviti così
come sono. È la ragione per cui l'app si apre in modalità aereo dopo un solo
caricamento.

Se serve un grafico, si scrive l'SVG (`ui.js` → `ciambella`, `barreImpilate`).
Se serve leggere uno ZIP, c'è `zip.js`. **Aggiungere una libreria è un cambio di
architettura, non una comodità.** Vale anche per le PROVE: il DOM finto in
`scripts/scudo/domfinto.mjs` esiste perché aggiungere jsdom farebbe verificare un
ambiente diverso da quello vero.

### 2. Ogni modulo nuovo va in `sw.js`

`RISORSE` in `sw.js` è la lista dei file messi in cache all'installazione. Un
modulo che non c'è dentro **non parte offline** — e non è teorico: `piani.js` è
rimasto fuori per settimane, e reggeva solo perché il fetch handler mette in
cache anche ciò che scarica, cioè per l'ordine fortunato delle visite.

`check_sw_versione.mjs` adesso lo verifica ed esce 2 se manca. Lo stesso
controllo pretende che **`VERSIONE` salga a ogni modifica** di un file in cache:
senza, chi ha l'app installata continua a eseguire la revisione vecchia contro un
pacchetto nuovo.

Dopo aver alzato `VERSIONE`: `node scripts/scudo/check_sw_versione.mjs --aggiorna`.

### 3. Ogni scrittura passa da `muta()`

`muta(fn, messaggio)` in `app.js` salva **prima** di ridisegnare, e salva
l'istantanea e gli eventi del giornale **nella stessa transazione**.

Chiamare una funzione di mutazione fuori da `muta()` produce due danni, e il
secondo è invisibile: niente viene scritto sul dispositivo al momento
dell'azione, e gli eventi del giornale generati lì **non finiscono mai**
nell'archivio durevole, perché `muta()` salva soltanto il tratto di giornale
prodotto dentro di sé. È già successo con la creazione delle ubicazioni.

## I gemelli

Tre coppie di implementazioni della stessa regola, in due linguaggi. Se
divergono, ciascuna conferma sé stessa e nessuna può accorgersene.

| campo | ufficio | li tiene allineati |
|---|---|---|
| `js/pacchetto.js` | `backend/app/services/scudo_pacchetto.py` | `test_pacchetto_cross.mjs`, `test_checksum_cross.mjs`, `test_valida_cross.py` |
| `js/piani.js` | `backend/app/services/scudo_piani.py` | `test_periodicita_cross.py` |
| `js/calcoli.js` | `backend/app/services/scudo_calcoli.py` | `test_calcoli_cross.py` |
| `js/piani.js` (etichette) | `frontend/src/components/scudo/frequenza.js` | `test_frequenza_cross.mjs` |

**Toccarne uno significa toccare l'altro, nello stesso commit.** Le colonne del
pacchetto vanno tenute nello **stesso ordine** nei due file: il checksum si
calcola sui byte dei CSV nel loro ordine, quindi due ordini diversi danno due
checksum diversi sugli stessi dati.

E quando aggiungi un comportamento nuovo al motore dei piani, aggiungi anche il
caso in `backend/tests/dati/piani_avversariali.json`: il corpus reale non contiene
piani in giorni, settimane, anni, né piani su richiesta, quindi senza il catalogo
avversariale il confronto passa verde **per mancanza di occasioni**.

## Che cosa si prova, e con che cosa

| file | che cosa copre |
|---|---|
| `test_stato_campo.mjs` | il comportamento: registrazioni, annullamenti, piani, ubicazioni |
| `test_controllo_campo.mjs` | la schermata del controllo, costruita e cliccata davvero |
| `test_luoghi_campo.mjs` | l'albero delle ubicazioni |
| `test_grafici_campo.mjs` | i numeri dei grafici |
| `test_ui_grafici.mjs` | il DISEGNO dei grafici |
| `check_js.mjs` | compila i moduli, cerca identificatori inesistenti |

`check_js.mjs` **non** vede una riga che va in errore quando viene eseguita: ha
lasciato passare `arco.append(svgEl('title')).textContent = ''`, che portava giù
l'intera schermata di riepilogo. Per questo esistono le prove con il DOM finto, e
per questo una schermata nuova va scritta in un **modulo a sé** (come
`controllo.js`, `luoghi.js`) e non dentro `app.js`: `app.js` apre IndexedDB e
avvia l'applicazione appena viene importato, quindi non è costruibile in una
prova.

Le tre cose che hanno effetti — salvare, avvisare, chiudere — si passano da
fuori come funzioni. È quello che rende la schermata provabile.

## Interfaccia: che cosa si è imparato guardandola usare

* **Colore e simbolo insieme.** Contro luce, rosso e ambra si somigliano, e c'è
  chi non li distingue affatto. `✓` e `✕`, `!` e `?`.
* **Il numero accanto alla forma, sempre.** La lunghezza di una barra o di un
  arco non si stima con il telefono in mano.
* **Bersagli da 44px, e tutta la riga è il bersaglio.** Centrare il pollice su una
  casella da 20px con i guanti significa selezionare la riga sbagliata.
* **Niente menù a tendina per una scelta breve.** La ruota di sistema copre il
  foglio da cui è partita. Usa `scelte()` (pulsanti). Sopra una ventina di voci
  serve invece un elenco cercabile.
* **Se non si può toccare, non deve sembrare toccabile.** Una barra che sembra un
  pulsante e non lo è si prova una volta sola, poi non si prova più nemmeno con
  quelle che funzionano.
* **A parole, non solo col colore.** «SCADUTA da 32 giorni» si legge; un bordo
  rosso accanto a una data no.
