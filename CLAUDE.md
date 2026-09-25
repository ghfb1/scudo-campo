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

⚠️ **E una VERSIONE già pubblicata non si riusa.** Sbagliato il 16/09/2026:
pubblicata la v52, cambiati altri file e rilanciato `--aggiorna` sulla stessa v52 —
il controllo torna verde, ma chi ha installato la v52 resta sulla revisione vecchia
per sempre, perché il nome della cache non cambia. Adesso `deploy_github_pages.sh`
marca la versione come `pubblicata` in `.sw-impronte.json`, e `--aggiorna` si
rifiuta di riscriverla: da lì in poi si può solo alzare `VERSIONE`.

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
| `codicePacchetto`, `CHIAVI_UFFICIO`, `metaDiRientro` (`js/pacchetto.js`) | `codice_pacchetto`, `CHIAVI_UFFICIO` | `test_manifest_cross.py` |
| `motivoRifiutoIdoneo` (`js/stato.js`) | `motivo_rifiuto_idoneo` (`scudo_registrazione.py`) e `registrazioneVerifica.js` dell'ufficio | `test_idoneo_cross.py` |
| `js/nome_presidio.js` | `frontend/src/components/scudo/nomePresidio.js` | `test_nome_presidio_cross.mjs` |
| `js/piani.js` | `backend/app/services/scudo_piani.py` | `test_periodicita_cross.py` |
| `js/calcoli.js` | `backend/app/services/scudo_calcoli.py` | `test_calcoli_cross.py` |
| `js/piani.js` (etichette) | `frontend/src/components/scudo/frequenza.js` | `test_frequenza_cross.mjs` |

**Il manifest di rientro si costruisce con `metaDiRientro`, mai a mano in
`app.js`**: le chiavi scritte dall'ufficio (`CHIAVI_UFFICIO`: codice, esportato da,
operatore previsto, periodo, note, impianti previsti) devono tornare invariate, e
in un oggetto scritto a mano una chiave dimenticata sparisce senza errori.

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
| `test_conferma_pacchetto.mjs` | la conferma prima di caricare un pacchetto, e i previsti in cima |
| `test_giro_presidi.mjs` | «fatto» solo con le voci eseguite, pulsante a tre stati, annullamento dal messaggio, vista a tre, barra del giro, anomalie in cima alla scheda |
| `test_admin_campo.mjs` | la password admin e il censimento delle scritture sui piani in `app.js` |
| `test_ui_campo.mjs` | la scelta cercabile (`ui.js`) e il progressivo Terna proposto |
| `test_idoneo_cross.py` | «IDONEO solo con tutte le verifiche fatte E zero pezzi guasti», stessa frase in campo, ufficio e server |
| `test_grafici_campo.mjs` | i numeri dei grafici |
| `test_ui_grafici.mjs` | il DISEGNO dei grafici |
| `test_azioni_complete.mjs` (+ `.py`) | **ogni azione che scrive** — tutte e 29 — fatta da una mano, ritrovata dall'altra e poi in archivio |
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

## Caricare un pacchetto

**Un pacchetto si carica solo passando dalla conferma** (`conferma_pacchetto.js`):
lettura, validazione, foglio con il codice, chi l'ha esportato, per chi, periodo,
note, impianti previsti, avvisi di lavoro non esportato e di pacchetto già
caricato — e solo dopo «Carica e sostituisci» `S.carica` e il salvataggio. Prima
i dati del dispositivo si sostituivano al primo tocco su un file.

**Un foglio che chiede una decisione si risolve anche alla chiusura**: toccare
fuori, la ✕ o Esc valgono «Annulla» (`apriSheetConChiusura`). La `conferma()` di
`ui.js` lasciava la promessa sospesa per sempre. Il pulsante risolve e POI chiude:
la chiusura trova la decisione già presa.

Gli **impianti previsti** dall'ufficio (`impiantiPrevisti()` in `stato.js`) stanno
in testa in `albero()` e `alberoUbicazioni()`, con «★ previsto» (simbolo e
parola). Il pacchetto li contiene comunque tutti.

In Diagnostica **«Codice del pacchetto»** è il codice dell'ufficio (`XXXX-XXXX`);
il checksum dei dati si chiama **«Impronta dei dati»**. Prima si chiamavano
entrambi «codice».

## Il lavoro del giro sull'elenco (15/09/2026)

`giro_presidi.js`: barra «N di M controllati · mancano K» in alto (ambito: impianto,
edificio, tipologie scelte — non la ricerca né la vista), scelta a tre «Da
controllare / Controllati / Tutti», pulsante «✓ fatto / ↩ da fare» accanto a ogni
riga (fuori dal pulsante della riga), anomalie aperte in cima alla scheda con
«Ancora presente», «Risolta…» (secondo tocco, nota facoltativa) e «Modifica».

`segnaNelGiro` in `stato.js` sposta un presidio senza creare né togliere controlli;
un controllo registrato DOPO il segno lo scavalca — deciso con i controlli che il
segno ha visto, non con l'orario (al secondo). `riconfermaAnomalia` scrive
`confermata_il`/`confermata_da`, colonne in coda a `5-anomalie.csv` in entrambi i
gemelli.

**«Fatto» vuol dire eseguito** (16/09/2026). `vociDelGiro(assetId)` elenca le voci
dei piani DA FARE all'inizio del giro (scaduto, in scadenza, mai eseguito, non
calcolabile — le stesse della sezione «da fare» della scheda) e quali hanno un
controllo IDONEO o NON_IDONEO in questo giro. `controllato` è vero solo con tutte
eseguite; `segnaNelGiro('controllato')` rifiuta nominando quelle che mancano. Finché
ne manca una, il pulsante è «👁 esegui controllo» e porta ai controlli, nell'elenco
e nella scheda. «Non accessibile» e «non eseguito» sono registrazioni, non
esecuzioni: la riga del piano lo dice («va ancora eseguito») e lascia i due esiti.
Nessuna voce da fare = si può segnare fatto a mano. I numeri del riepilogo e dei
grafici (`avanzamentoDi`) restano quelli delle scadenze aperte: sono un'altra misura.

**I messaggi che si annullano.** `muta(fn, msg, { annullabile: true })` mostra
«… - (clicca per annullare)»; il tocco chiama `annullaEventi` con gli eventi appena
scritti. Si annullano solo i tipi che portano il «prima» intero (segno del giro con
`segno_prima`, aggiornamento di un'anomalia con `prima`), una volta sola, e non se
sulla stessa cosa è arrivata una modifica dopo. L'annullamento è a sua volta un
evento del giornale. Un controllo registrato si annulla dalla sua scheda, con il
motivo: non da qui.

## La password admin (16/09/2026)

`admin.js`: scegliere i piani di un presidio, farlo uscire da un piano e tutta la
scheda «Piani» chiedono la password admin (`conAdmin` in `app.js`). Nel sorgente c'è
solo l'impronta SHA-256, normalizzata come la parola d'accesso; lo sblocco dura
quanto la scheda del browser. **Non è una protezione** (il confronto avviene nel
telefono): tiene fuori il gesto distratto. `test_admin_campo.mjs` censisce `app.js` —
ogni chiamata che scrive sui piani deve stare in una schermata raggiungibile solo
passando dalla password — quindi una schermata nuova che li tocca va aggiunta lì.

## Aree e ubicazioni (16/09/2026)

A schermo l'edificio si chiama **area** e il locale **ubicazione** (richiesta
dell'operatore). Nei dati, negli indici, nel pacchetto e nei nomi delle colonne
restano `edificio` e `locale`: sono il formato scambiato con l'ufficio. Le frasi con
gli articoli giusti stanno in `NOMI_LUOGO` di `luoghi.js`.

## Il telefono in mano (16/09/2026)

Tutto questo viene da schermate vere dell'operatore, non da una revisione a
tavolino.

* **Presidi, intestazione fissa.** Erano incollate cinque fasce — avanzamento,
  ricerca, vista a tre, chip dei filtri, tipologie — e su un telefono occupavano
  metà schermo. Adesso in alto restano **percorso, avanzamento in una riga,
  ricerca e vista a tre**; «non conformi», «con anomalie» e le tipologie stanno
  dietro il pulsante **⚙︎ Filtri**, che dice quanti sono attivi. Sopra i 720 px
  tornano in pagina (`.filtri-estesi`): lì lo spazio c'è.
* **Percorso.** «🏠 Tutti gli impianti › ACCIAIOLO › Box di stallo» era una fila
  di chip uguali, e nessuno li toccava. Adesso il primo elemento dice dove porta —
  «‹ Su a ACCIAIOLO» — e il livello corrente è in fondo, preceduto da «sei in».
* **Albero dei luoghi.** Il nome VA A CAPO: con i tre comandi sulla stessa riga
  aveva novanta pixel e si leggeva «Box d…», cioè l'unica cosa che serve per
  scegliere dove andare era l'unica illeggibile. Sotto i 560 px i comandi scendono
  su una riga loro, larghi uguali, e i rientri si dimezzano.
* **Dati del controllo.** Le tipologie partono **tutte selezionate**: si toglie
  quello che non si controlla. Nel dato la convenzione non cambia (vuoto = tutte).
* **Vita utile**: interruttore anni / mesi accanto al campo; nel dato restano i
  mesi. **Progressivo Terna** (ex «#ID targhetta»): si modifica solo dopo la
  password admin (`admin: true` nei metadati del campo).
* **Pezzi guasti**: stanno nel CONTROLLO, sopra l'esito, non in fondo dentro un
  pannello chiuso — sono il dato che decide l'esito. Con almeno un pezzo guasto
  «Idoneo» si spegne e lo dice, con la frase della regola gemella.

## Il telefono in mano, seconda passata (16/09/2026)

* **La fascia rossa** portava tre pastiglie su due righe — «salvato sul
  dispositivo», i controlli, «N da esportare». Adesso porta l'AVANZAMENTO (barra +
  «1/2095 controlli») e gli allarmi che chiedono un'azione. «Da esportare» è già il
  numero sulla linguetta Dati; «salvato sul dispositivo» lo dice per esteso la
  scheda Dati.
* **I filtri che si combinano sono CASELLE** («Non idonei», «Con anomalie»): due
  pastiglie che cambiavano colore si leggevano come etichette, e non dicevano che
  si possono accendere entrambe.
* **L'interruttore a tre** ha il bordo su ogni voce: prima le inattive erano testo
  grigio su fondo grigio e non sembravano toccabili.
* **`sceltaCercabile` (`ui.js`)**: si scrivono due lettere e restano le voci che le
  contengono. Senza valore iniziale non preseleziona niente e nasce aperta — su un
  modulo di creazione una tipologia preselezionata si salva per inerzia.
* **Nuovo presidio**: tipologia cercabile, **progressivo Terna** proposto (il primo
  numero libero, solo cifre), i campi della tipologia (estinguente, carica, anno,
  messa in servizio) chiesti subito perché sono quelli che decidono i piani, la
  copia delle eccezioni da un presidio simile (password admin) e, se c'è qualcosa
  da controllare, la scheda che si apre sui controlli.
* **A colpo d'occhio**: in elenco un presidio dice «CO2 · 5 kg · portatile». La
  categoria si chiama «Estintore» e non più «Estintore portatile o carrellato»: la
  differenza che conta è l'estinguente, e quella si vede.

## Terza passata sul telefono (16/09/2026, sera)

* **L'intestazione dei Presidi non è più incollata sotto i 720 px.** Anche ridotta
  a percorso + avanzamento + ricerca + vista occupava 225 px su 797, e su un
  telefono quel terzo è l'elenco. Quello che serve sempre — avanzamento del giro e
  «indietro» — sta nella fascia rossa, che resta fissa; il resto torna scorrendo
  su. Su schermo largo l'intestazione resta fissa: lì lo spazio c'è.
* **I filtri restringono l'albero, non lo sostituiscono.** Prima bastava scegliere
  una tipologia per ritrovarsi 408 estintori in fila senza più impianti né
  ubicazioni. Adesso `albero(filtri)` passa da `cerca` — un posto solo per i
  filtri — e l'elenco piatto compare quando lo si è chiesto: scrivendo nella
  ricerca, scendendo a un'ubicazione, o con «mostra tutti».
* **Il dettaglio della tipologia sta accanto al nome**: «Estintore · CO2», «Porta
  REI 60», «2 ante». È la differenza che decide la periodicità, e stava in quarta
  posizione su una riga grigia. La regola è gemella
  (`nome_presidio.js` ⇄ `frontend/.../nomePresidio.js`, `dettaglioTipologia`) e i
  due lati si confrontano su tutti i presidi del pacchetto.
* La riga di un presidio adesso è divisa in blocchi: **nome e tipologia**,
  **ubicazione**, **dati fisici** (carica, installazione, anno, marca), **stato
  delle scadenze**, e i tag di anomalie e guasti.

## Quarta passata (17/09/2026): quello che l'operatore ha misurato in campo

* **⛔ Niente `input[type=number]`, mai.** Le frecce e la ROTELLA cambiano il
  valore del campo a fuoco: scorrere la pagina col pollice riscrive un dato senza
  che chi scorre stia guardando quel campo. Segnalato sul numero di loop di una
  centralina, ma il caso peggiore era «di cui guasti» nel controllo, che decide se
  l'esito può essere idoneo. Si usa `campoNumerico` di `ui.js` (`type=text` +
  `inputmode`), e `test_ui_campo.mjs` censisce il sorgente perché un modulo nuovo
  non lo riscriva a mano.
* **Un elenco non si tronca in silenzio.** `sceltaCercabile` mostrava le prime
  OTTO voci e le altre comparivano solo scrivendo: su ventidue tipologie, chi non
  trovava la sua concludeva che non esistesse e ne sceglieva una vicina. Adesso
  le mostra tutte, il riquadro scorre e dice quante sono («22 tipologie», «3 di
  22» quando si filtra).
* **Un numero senza unità eredita l'unità del vicino.** In elenco si leggeva
  «10 pezzi» e sotto «1 in regola», e si capiva «1 pezzo su 10 è a posto» mentre
  il conto era dei PIANI DI VERIFICA. Adesso `riassuntoControlli` scrive
  «verifiche: 1 in regola», e la parola sta per prima.
* **Il progressivo Terna non si ripete.** Il modulo lo dice mentre si scrive
  (nominando il presidio che ce l'ha e dove sta), e `creaPresidio` rifiuta comunque:
  la schermata si può aggirare, e un doppione scritto è molto più caro da togliere
  che da rifiutare.
* **La centralina di appartenenza si sceglie fra quelle dell'IMPIANTO**, non
  dell'edificio: nei dati veri i rilevatori di un edificio appartengono alla
  centralina di un altro, e SUVERETO ne ha sei in un impianto solo. Resta testo
  libero (una centralina non censita deve poter essere scritta), con i
  suggerimenti in un `datalist`. Nel seed sono già collegati 160 sensori su 163.

## Quinta passata (17/09/2026): l'intestazione dei presidi

* **Un regime solo, telefono e scrivania.** I filtri stavano dietro un pulsante
  sul telefono e aperti in pagina su schermo largo, «perché lì lo spazio c'è».
  Due difetti: l'avanzamento compariva DUE VOLTE (compatto in alto, intero nei
  filtri estesi, con lo stesso ambito sotto entrambi), e ventidue tipologie
  aperte occupavano più spazio dell'elenco che dovevano filtrare. Adesso il
  pulsante ⚙︎ Filtri a ogni larghezza, e l'intestazione **non è più incollata a
  nessuna larghezza**: lo spazio disponibile non è una ragione per occuparlo con
  comandi che si usano una volta ogni tanto.
* **«Idonei» accanto a «Non idonei».** Mancava, e senza di lui l'unico modo di
  vedere i pezzi a posto era togliere ogni filtro — cioè guardarli insieme a
  quelli che non lo sono.
* **Un luogo senza presidi resta in elenco**, con il fondo più scuro e «nessun
  presidio — entra per aggiungerne», e resta toccabile. Sparendo si comportava
  come un luogo inesistente: per censire un pezzo in un'ubicazione vuota
  bisognava crearlo altrove e poi spostarlo. `albero(filtri, { conVuoti: true })`.
* **Un impianto si stacca dal successivo**, sia nei Presidi (barra di stato
  ingrossata, nome più grande) sia nella scheda Luoghi (filetto sopra). Una barra
  sola e non due: la `barra-stato` porta già un significato, affiancarle un
  filetto decorativo faceva leggere due indicatori dove ce n'è uno.
* **Alla creazione si vedono i piani che nasceranno**, e si aggiornano a ogni
  tasto: scrivere «CO2» invece di «polvere» porta da 3 piani a 5 e cambia la
  revisione da tre a cinque anni. Togliendo una spunta si crea un'eccezione
  ESCLUDI — che chiede la password admin, come ogni scrittura sui piani.

## Il pezzo montato può cambiare (18/09/2026)

Sulla scheda del presidio c'è «↔ Il pezzo è stato sostituito». Serve al tecnico
che porta via l'estintore per il collaudo e monta un muletto, e al rilevatore a
fine vita che si butta e si rimpiazza: **è lo stesso gesto**, cambia solo se il
nostro pezzo torna.

* il **motivo** decide il resto: «ritirato per revisione/collaudo» preselezionano
  il temporaneo, «guasto/fine vita» il definitivo. Dal motivo e non dalla
  categoria — un giorno potrebbero portare via una centralina e lasciarne una di
  scorta, e una tabella «chi può avere il muletto» sarebbe sbagliata quel giorno;
* le **date che il pezzo nuovo si porta dietro** si chiedono e diventano
  esecuzioni: senza, le sue scadenze non ripartono da lui. Se non si sanno si
  lascia vuoto — meglio «non calcolabile» che le date di un altro pezzo;
* finché c'è un muletto la scheda porta una fascia **ambra** (non rossa: non è un
  guasto, è un in-sospeso) con «↩ È cambiato: dimmi che pezzo c'è adesso».

**Alla chiusura si chiede la MATRICOLA, non «è rientrato sì/no»**, e l'app DICE
che cosa ha concluso prima di registrare, così chi ha letto male corregge. Tre
esiti: è il nostro, è il muletto, è un terzo mai visto — quest'ultimo è il caso
normale, perché la ditta ruota gli estintori fra le sedi Terna e solo questa usa
Scudo.

Gemelli: `sostituisciPezzo`/`chiudiSostituzione` ⇄ `sostituisci_pezzo`/
`chiudi_sostituzione`, `valePerIlPezzo` ⇄ `vale_per_il_pezzo`,
`5b-sostituzioni.csv` nei due schemi del pacchetto (**formato 5**).

## La schermata del controllo, sesta passata (18/09/2026)

Tutto da schermate vere dell'operatore.

* **⛔ «(senza area)» non si poteva toccare.** Il nodo aveva `id: ''`, e cliccarlo
  impostava un filtro vuoto — che in `cerca` vuol dire «non filtrare». La riga si
  vedeva, si toccava e non faceva niente. Misurato: **5 schede per 90 presidi**
  (ACCIAIOLO 24, AREZZO C 24, PIAN DELLA SPERANZA 24, SUVERETO 18) irraggiungibili
  dall'albero. Adesso l'id è `SENZA_LUOGO` e il filtro è vero: «quelli che non ce
  l'hanno». Una riga che non risponde è peggio di una riga assente — si prova una
  volta, poi non si prova più nemmeno con quelle che funzionano.
* **Spuntare è un GIUDIZIO, e lo dice.** «N di M verifiche idonee», e il pulsante
  è «Segna tutte le verifiche come idonee» / «Segna tutto non idoneo». «Fatte»
  faceva leggere la spunta come «l'ho guardata», che non decide niente.
* **«⚠ Verifica non eseguibile» sta sulla RIGA**, accanto a idoneo e non idoneo.
  Era dentro la scheda, dove ci si arriva solo dopo aver premuto uno dei due —
  cioè dopo aver già dato il giudizio che «non eseguibile» dice di non poter dare.
* **Non eseguibile chiude la voce nel giro, ma non la dichiara eseguita.** Il
  presidio esce dai «da controllare» — ci si è andati, ritrovarselo davanti dieci
  volte non lo rende possibile — e porta un **⚠ ambra** invece del ✓ verde:
  `conVerificheNonEseguibili`. Il registro resta onesto: `eseguite` non conta
  quelle voci, il presidio resta com'era, la scadenza non si sposta.
* **Un'anomalia aperta non decisa blocca QUALUNQUE esito**, non solo idoneo.
  Prima si registrava non idoneo lasciandola in sospeso, ed era la strada per cui
  un difetto risolto restava aperto per sempre.
* **Niente preselezioni su «che cosa non va»**: il catalogo dei tipi non è
  filtrato per categoria — le stesse sedici voci per un estintore e per una porta
  REI — quindi un tipo suggerito è suggerito a caso, e scegliere un tipo non muove
  più la gravità. Una valutazione messa in bocca a chi non l'ha fatta.
* **I pulsanti di conferma in FONDO**, dopo tutti i campi anche facoltativi.
  Prima «Registra» stava a metà scheda con sotto la descrizione dell'anomalia: si
  confermava passando sopra a campi non ancora compilati.
* Una **nota facoltativa sulle verifiche**, per quello che non entra nell'elenco
  delle voci senza spunta.
* **Le voci CONDIZIONALI non contano per IDONEO.** L'operatore ha segnalato voci
  da estintore a CO2 dentro il controllo di uno a polvere e ha chiesto di
  verificare se il problema fosse isolato: non lo era. Misurato — **18 voci
  condizionali su 12 piani**, e la conseguenza era «Non si può dichiarare IDONEO:
  1 verifiche su 7 non risultano fatte» su **408 estintori**, cioè una regola che
  non si poteva mai soddisfare. La colonna `piani_azioni.obbligatoria` esisteva
  già ed era decorativa: adesso decide in tutti e tre gli alberi (server, campo,
  ufficio), le voci condizionali si disegnano con `casella-condizionale` e la
  frase «— solo se si applica a questo pezzo», e il denominatore le esclude.
  L'elenco completo, con il segno ⊙, è in `docs/mappatura-piani-verifica.md`.
## La staffetta: passare il giro a un altro operatore (19/09/2026)

«Succede spesso che una zona la faccia un operatore e un'altra zona un altro.»
Si esporta il pacchetto e lo si manda all'altro: lo carica e continua da dove sei
arrivato. Funzionava già per i DATI; perdeva tutto il resto. Che cosa cambia:

* **il giornale di chi ha lavorato prima non si butta.** `carica()` lo eredita
  quando il pacchetto ha `origine === 'campo'`, deduplicato per `evento_id`. Solo
  da lì: se un domani l'ufficio esportasse il suo, `luogoCreatoInCampo`
  risponderebbe «sì» su ogni ubicazione mai creata. Conseguenze gratuite —
  annullare un controllo di un altro **ripristina il presidio**, e correggere
  un'ubicazione creata da lui non chiede la password admin;
* ⛔ **`stato.esportato.seq` si inizializza con il giornale ereditato**, o il
  lavoro del primo risulta un debito del secondo — e siccome caricare è bloccato
  con modifiche in sospeso, il passaggio successivo si bloccherebbe da solo;
* **il giro si eredita dal pacchetto, la persona no.** Niente ripiego su
  `manifest.operatore`: su un rilievo quel nome è di chi te l'ha mandato;
* **l'avanzamento resta cumulativo**: `intervento_id` viaggia nelle scadenze;
* **la catena delle consegne** (`consegne` nel manifest) dice all'ufficio chi ha
  tenuto il pacchetto, in ordine, con quanti controlli;
* **caricare è bloccato** con lavoro non esportato: il pulsante è assente, non
  spento, e al suo posto c'è «Esporta il tuo rilievo»;
* **il foglio dice che è un rilievo già iniziato**: chi ci ha lavorato prima, da
  quando, quanto risulta fatto, quanti presidi restano;
* **chiudere il lavoro di un altro non riscrive chi l'ha fatto**: tre scritture
  sovrascrivevano la provenienza in silenzio;
* **le quattro funzioni del giro lasciano traccia** nel giornale.

**Quante mani?** Non due: quante servono. Misurato il 19/09/2026 con quattro
operatori, in entrambe le varianti — un solo rientro alla fine, e un rientro
dopo OGNI mano. La catena si allunga, il giornale si unisce senza duplicati, il
denominatore resta fermo e nessuna mano eredita il nome della precedente.

⚠️ E per questo la prova end-to-end usa **quattro** mani e non due: con due, una
catena che accoda e una che tiene solo «primo e ultimo» sono indistinguibili, e
lo stesso vale per un giornale che unisce e uno che sostituisce. Il terzo
passaggio è il primo che discrimina — due è il caso degenere di questo problema.

## La settima passata (19/09/2026)

* **«Verifica non eseguibile» apre una scheda CORTA.** Prima apriva la stessa
  scheda del giudizio — checklist, anno dall'etichetta, pezzi guasti, anomalie
  aperte da confermare — e ognuna di quelle è una domanda a cui NON si può
  rispondere quando non si è arrivati al pezzo. Restano le due che si possono
  fare: che cosa è successo e perché. In particolare **le anomalie aperte non si
  devono più decidere su questa strada**: chiedere se un difetto c'è ancora a chi
  non ha visto il pezzo è chiedere di indovinare.
* **Il segno era un carattere COMBINANTE.** `⃠` è U+20E0: non si affianca al
  testo, gli si sovrappone — e nessuno spazio lo separa, perché lo spazio è
  proprio il carattere su cui si combina. Sostituito con `⚠` in un elemento suo,
  come negli altri due pulsanti, qui e in `FormVerifica.js` dell'ufficio. Lo
  sorveglia una prova che rifiuta qualunque combinante nella riga.
* **I pezzi guasti si CHIEDONO.** Il campo portava `quantita_ko` dall'archivio:
  su 44 righe (misurato) erano tutti i pezzi, e la scheda si apriva con la
  risposta già dentro — «su 3 pz, 3 hanno problemi» invece di «su 3 pz, quanti».
  Adesso nasce vuoto, l'archivio compare come contesto («in archivio ne risultano
  3 guasti: confermalo o correggilo») ed è **obbligatorio**, perché lasciato vuoto
  il server non tocca il campo e un «idoneo» convivrebbe con tre guasti in
  archivio. Non lo chiede su «non eseguibile»: nessuno li ha contati.
* **Via il pulsante «non lo faccio adesso»**: per non fare una cosa basta non
  farla. Dargli la forma di un comando, accanto a «verifica non eseguibile» che
  invece un'azione lo è, confondeva due cose diverse. La FRASE resta — è lei che
  evita l'errore vero, premere «non idoneo» per dire «non l'ho fatto».
* **Un'ubicazione si rinomina e si ELIMINA, e si può farlo dal livello in cui si
  è.** L'anagrafica spariva appena si entrava in un'ubicazione (terzo livello):
  chi ne creava una sbagliata e ci entrava dentro non aveva più nessun modo di
  correggerla. Adesso c'è a ogni livello, e all'ultimo mostra rinomina/elimina
  invece di «+ nuova». La regola dei permessi sta in `permessiLuogo`, una
  funzione sola usata dal pulsante e dall'azione: **senza password si tocca solo
  ciò che si è creati in questo giro** (lo dice il giornale, `luogoCreatoInCampo`,
  non un campo nuovo nel pacchetto), il resto chiede l'admin. L'eliminazione ha in
  più un limite che la password NON supera: un luogo con dentro presidi o altri
  luoghi non si cancella (`motivoNonEliminabile`). È una cancellazione VERA — i
  file dei luoghi non hanno `eliminato_il` e l'ufficio sostituisce quelle tabelle
  al rientro — ed è per questo che il limite è severo.
* **«Elimina» non sparisce dove non si può: è spento con il motivo scritto.** Un
  pulsante assente non dice perché, e chi lo cerca conclude che la cosa non si
  possa fare — che è esattamente la segnalazione da cui nasce tutto questo.
* **L'albero conta i controlli DA FARE, non tutte le scadenze aperte.** Diceva
  «0/4 controlli» su una posizione che, aperta, ne aveva **uno**: le altre tre
  scadenze erano di ottobre, gennaio e **2030**. Erano due definizioni di «da
  fare» — `vociDelGiro` per la riga dell'elenco (corretta il 16/09) e «tutte le
  scadenze aperte» per l'albero, le barre e i grafici. Adesso la definizione è
  una: `avanzamentoDi` e `avanzamentoPerChiave` leggono `vociDelGiro`. Sul parco
  intero il denominatore passa da **2095 a 1466**.
* **Il nodo dice due numeri**: «24 presidi su 1 scheda». Diceva solo «24 presidi
  in tutto» e aprendolo compariva UNA riga — gli schiumogeni da 24 pezzi.

* **Gli stati sono CINQUE**, e rispondono a una domanda sola — «c'è un pezzo qui,
  e protegge questo punto?»: in servizio, **di scorta a magazzino**, presente ma
  fuori servizio, rimosso e non sostituito, non previsto. SCORTA è nuovo (nove
  estintori erano già di scorta e stavano come «in servizio»); non sospende le
  scadenze e **non** è un ramo di `idoneita()` — una scorta può essere idonea o no
  come tutte le altre. «Rimosso e non sostituito» non è ridondante con la
  sostituzione: là un pezzo nuovo arriva, qui la postazione resta vuota.

## «(senza area)» e «(senza ubicazione)» non sono luoghi (19/09/2026)

Segnalazione dell'operatore: «il difetto c'è comunque su scudo campo, a livello
di navigazione e interfaccia». Il difetto del 18/09 (nodo che non rispondeva) era
corretto **nei dati**; quello che restava era nell'app, e nessuna prova sui dati
poteva vederlo, perché albero, filtri ed esportazioni erano tutti giusti.

`albero()` produce due specie di nodi che si disegnano uguali: i luoghi veri, con
una riga in anagrafica, e i due **segnaposto**, che rispondono a «quelli che non
ce l'hanno» e portano per id `SENZA_LUOGO`. Trattati come luoghi, offrivano tre
comandi che fallivano, ognuno solo dopo aver fatto compilare un modulo:

* **«Elimina questa ubicazione» ACCESO e rosso** su un nodo pieno di presidi,
  perché `motivoNonEliminabile` cercava quelli con `locale_id === '__senza__'` e
  ne trovava zero: i veri ce l'hanno vuoto. Premerlo chiedeva la password admin e
  poi falliva con «Ubicazione non trovata»;
* **«Rinomina»**, che apre un modulo vuoto e fallisce al salvataggio;
* dentro «(senza area)», **«+ Nuova ubicazione»**, che `creaLocale` rifiuta
  («Area inesistente») — il guardiano c'era, il vicolo cieco no.

E la **briciola di pane perdeva il gradino**: cercava il nome in anagrafica, non
lo trovava, e scartava il livello. Stando dentro «(senza ubicazione)» la barra
diceva «‹ Su a ACCIAIOLO · sei in Box di stallo» — nominava il PADRE come se
fosse dove si è, e il pulsante «su» saltava un livello.

Adesso la decisione sta in **`luoghi.js`** (`azioniDelNodo`, `livelliDiPercorso`),
dove una prova può eseguirla: `app.js` non è costruibile fuori dal browser, e una
regola che nessuna prova esegue vale finché qualcuno se la ricorda. Sul segnaposto
c'è una sola azione, che è anche il modo di farlo sparire: **«📍 Assegna un'area a
questi presidi»**. Un nome mancante ripiega, non fa cadere il gradino — vale anche
per un luogo vero cancellato da un altro operatore.

## L'ubicazione di terzo livello è obbligatoria (19/09/2026)

Richiesta dell'operatore: «quando creiamo o modifichiamo un presidio, lo dobbiamo
creare o modificare su una ubicazione di terzo livello». Prima le due tendine
offrivano «(nessuno)» **preselezionato**: si poteva lasciare un presidio senza
ubicazione senza che niente lo dicesse, e chi poi lo cercava navigando non lo
trovava dove doveva essere.

`js/ubicazione.js` → `bloccoUbicazione()`, **uno solo** per i tre punti che
facevano la stessa domanda in tre modi diversi: creazione, modifica anagrafica,
assegnazione di massa. Area e ubicazione obbligatorie, con il messaggio che dice
QUALE manca.

⚠️ **Un obbligo senza via d'uscita è una trappola**: se l'area giusta non esiste,
mandare l'operatore nella scheda Luoghi a crearla e poi farlo tornare è il punto
in cui si smette e si annota su un foglio. Quindi «＋ Crea…» sta dentro il modulo,
e il luogo nasce **nella stessa transazione del presidio** — guardare gli errori
non crea niente, o un salvataggio annullato lascerebbe in archivio un'area vuota.

⛔ **L'obbligo sta nel MODULO, non nei metadati del campo.** Misurato:
`scudo_pacchetto.py` valida ogni presidio in arrivo con le stesse regole dei
metadati, e in archivio ci sono **5 presidi su 868** senza area — i fusti di
schiumogeno, che la fonte colloca solo a parole («Deposito»). Marcandolo
`obbligatorio` nei metadati, l'ufficio rifiuterebbe **il proprio pacchetto**.
L'obbligo va dove si SCEGLIE, non dove si giudica la storia.

Quei cinque hanno la posizione **già scritta** in `ubicazione_testo`: il foglio di
assegnazione la propone come nome, così non c'è niente da ricopiare.

## I pezzi guasti si toccano, non si scrivono (20/09/2026)

Richiesta dell'operatore: «assicurati che la compilazione sia davvero intuitiva e
veloce, anche quando un parziale della quantità ha problemi».

Misurato sull'archivio: **169 righe su 868 valgono più di un pezzo**, e non sono
grandi — 68 ne valgono due, 25 tre, 22 quattro: **139 su 169 stanno entro otto**.
Le risposte poi non sono distribuite affatto: **770 righe su 868 hanno zero
guasti**, e delle 99 che ne hanno, **83 li hanno tutti**. Cioè due risposte
coprono quasi tutto, e un campo numerico da riempire con i guanti le trattava
come il caso raro in mezzo.

* **fino a otto pezzi**: un pulsante per numero — «nessuno · 1 · 2 · 3 · tutti (4)»;
* **oltre**: «nessuno · alcuni… · tutti (24)», e «alcuni…» apre il campo, con il
  minimo e il massimo nel segnaposto («da 1 a 23»).

Gli estremi hanno il loro pulsante e il campo NON li accetta: due strade per la
stessa risposta e chi legge l'archivio non saprebbe più quale ha usato
l'operatore.

⚠️ **«nessuno» non è preselezionato**, ed è la stessa regola del 19/09 per cui il
campo non porta più il valore d'archivio: una risposta già data si conferma per
inerzia, e questa decide l'esito. Il pulsante «Idoneo» reagisce al TOCCO — se
aspettasse il salvataggio, l'operatore lo vedrebbe spegnersi solo dopo averlo
premuto.

## Il lavoro e i pezzi sono due misure (20/09/2026)

Richiesta dell'operatore: «scadenze scadute» → **«verifiche scadute»** (è la
parola che l'app usa dappertutto: usarne due per la stessa cosa fa credere che
siano due cose), e in più **quanti presidi sono in regola e quanti no**.

Sono due domande diverse e vanno tenute distinte:

| numero | risponde a |
|---|---|
| 478 verifiche scadute | quanto LAVORO manca |
| 275 presidi non in regola | su quanti PEZZI manca |

Un estintore con controllo, revisione, collaudo e fine vita scaduti pesa
**quattro** nel primo numero e **uno** nel secondo. La differenza decide se si va
una volta in quel posto o quattro.

La definizione di «non in regola» non è scritta nel riepilogo: è quella di
`statoVerifiche` — almeno una verifica scaduta **oppure** un piano il cui ultimo
esito è non idoneo. Il terzo stato (nessuna scadenza calcolata) è dichiarato
sotto i due numeri, o si leggerebbero come una somma che non torna.

Lo stesso vale nella scheda **Scadenze**, che contava solo le scadenze: adesso
dice anche su quanti presidi stanno, e quante a testa.

## Le coordinate dal GPS (20/09/2026)

Richiesta dell'operatore: prendere la posizione dal telefono e poterla aprire su
una mappa. Quattro campi facoltativi sul presidio — `lat`, `lon`,
`gps_accuratezza_m`, `gps_rilevato_il` — presi da `bloccoUbicazione`, che già
possiede la domanda «dove sta questo presidio».

⛔ **L'accuratezza si registra sempre, e non è un dettaglio.** La maggior parte
di questi presidi sta DENTRO — shelter, cabine, sale quadri — e lì il GPS di un
telefono sbaglia da dieci a cento metri, quando risponde. Su una stazione
elettrica cento metri sono l'edificio sbagliato. Senza il numero accanto, una
posizione presa male è **indistinguibile** da una presa bene: è la forma esatta
del ripiego-che-sembra-un-dato già costato una correzione su 602 presidi. Sopra
i 25 m la schermata lo scrive — «indica l'area, non il pezzo» — e non rifiuta
niente: il numero vero si registra comunque e decide chi guarda.

⚠️ **Il collegamento è `google.com/maps?q=` e non uno schema nativo** (`geo:`,
`maps://`): quelli aprono l'app su una sola delle due piattaforme e sull'altra
non fanno niente. Un collegamento che su metà dei telefoni non risponde è peggio
di nessun collegamento — si prova una volta e poi non si prova più. GEMELLO in
`frontend/src/components/scudo/scudoUtils.js`.

⚠️ **I tre errori si distinguono uno per uno**: permesso negato, nessun segnale,
troppo lento si risolvono in tre modi diversi, e un unico «errore di
localizzazione» manda l'operatore a indovinare quale sia. `posizioneDalDispositivo`
è **iniettabile**, o la schermata sarebbe verificabile solo guardandola:
`navigator.geolocation` non esiste in Node.

Le colonne viaggiano nel pacchetto (additive, nessun `PKG_VERSION` da alzare) e
finiscono nelle estrazioni, dove l'accuratezza è una **colonna sua** e non un
suffisso nella cella: in un foglio di calcolo «mostrami solo quelle sotto i 25
metri» è la domanda che ci si fa.

## Il GPS: la precisione migliora, e si guarda migliorare (20/09/2026)

L'operatore l'ha misurato sul suo telefono prima di noi: la stessa posizione,
presa due volte di fila, è uscita **±11 m** e poi **±3 m**. Non è un caso — il
primo fix del GPS è grossolano e migliora man mano che il ricevitore aggancia
più satelliti. `getCurrentPosition` prende il primo valore che arriva, cioè
**sistematicamente il peggiore**, e su un presidio la differenza fra tre e undici
metri è fra «è quello» e «è uno dei quattro in quell'angolo».

Adesso `seguiPosizione` ascolta per venticinque secondi, mostra il numero
scendere («migliorata da ±20 m»), e tiene sempre la **lettura migliore** — non
l'ultima: l'accuratezza oscilla, e tenere l'ultima butterebbe via il lavoro dei
secondi precedenti. Si salva quando basta.

⛔ **E questo, a differenza di prima, TIENE IL GPS ACCESO.** La domanda
dell'operatore — «non consumiamo più batteria?» — è la ragione per cui il
ricevitore va spento da **quattro** strade, e la quarta è quella che il pannello
non può vedere da sé:

| strada | chi la chiude |
|---|---|
| si salva | il pannello |
| si annulla | il pannello |
| scadono i 25 secondi | il pannello (promessa alla batteria: si spegne anche se nessuno preme niente) |
| **si chiude il foglio** | **chi lo ha aperto**, con `chiudi()` |

`ferma()` è idempotente apposta: quattro strade ci arrivano e nessuna sa che cosa
hanno già fatto le altre.

### La QUINTA strada: si spegne perché non serve più (22/09/2026)

Segnalazione dell'operatore, ed è la stessa domanda di prima posta una seconda
volta perché la prima risposta non bastava: «se clicco su dove sono o apro la
mappa, sembra che il satellite rimanga sempre attivo perché dove sono si aggiusta
di continuo, facendo consumare batteria».

Le quattro strade sopra spengono il ricevitore per un **evento**: qualcuno salva,
annulla, chiude, o scade il tempo. Ne mancava una per il **merito**: sotto una
certa precisione, continuare a misurare non aggiunge niente.

`seguiPosizione` prende quindi `fermaSottoM`, e si spegne da sé appena la
migliore lettura scende sotto quella soglia, con motivo `'precisione'`.

| chi chiama | durata | soglia | perché |
|---|---|---|---|
| il pannello che **salva** una posizione (`bloccoCoordinate`) | 25 s | **nessuna** | quel numero finisce in archivio e ci resta: vale la pena aspettare il meglio, e chi guarda il numero scendere sta decidendo se salvarlo |
| «**dove sono**» sulla mappa | **10 s** (`DURATA_DOVE_SONO_MS`) | **5 m** (`ACCURATEZZA_PRECISA_M`) | la domanda è «dove sono adesso» e la risposta serve per un minuto; sotto i cinque metri è la banda «precisa» e un presidio non si distingue meglio |

Tre dettagli, ognuno pagato:

* **`ferma('precisione')` sta DOPO `onAggiorna`**, non prima. Fermarsi prima non
  perde nessun dato — `onAggiorna` viene chiamato lo stesso — ma rovescia
  l'ordine, e chi scrive sulla stessa riga (la mappa lo fa) finisce per dire
  «sto ancora misurando…» **dopo** aver detto «GPS spento»: cioè esattamente il
  dubbio da cui nasce la soglia. La prova registra la SEQUENZA: con due elenchi
  separati quella mutazione restava verde.
* **Che il GPS sia spento va SCRITTO**, e i due esiti si distinguono: «più
  preciso di così non serve» e «spento dopo 10 s — tocca di nuovo «dove sono»
  per rimisurare». Un puntino fermo senza spiegazione si legge come un
  ricevitore ancora acceso.
* **La mappa non accende niente da sola**: il GPS parte solo dal pulsante. La
  sensazione di «sempre attivo» veniva dalla calibrazione che non finiva mai.

### Il cerchio della precisione

«Un raggio semitrasparente del cerchio deve mostrare la precisione dove c'è il
pallino». Il raggio è l'accuratezza **in metri veri** (la viewBox della mappa è
in metri), con un minimo di `lato / 40` perché a mappa larga tre metri non si
vedrebbero.

⚠️ In SVG **non si usa `opacity`** su quel cerchio: si applica al disegno già
composto e si **moltiplica** per `stroke-opacity`. La prima stesura aveva
`opacity: .12; stroke-opacity: .35`, cioè un bordo allo **0,042** — sopra una
fotografia dal satellite, invisibile: il cerchio c'era, la prova del raggio era
verde, e non si vedeva niente. Il velo sta sul solo riempimento
(`fill-opacity`), il bordo resta pieno e tratteggiato perché è un'incertezza e
non un confine, e `pointer-events: none` perché a ±40 m quel velo copre mezza
mappa e intercetterebbe i tocchi sui presidi che ci stanno sotto.

### Perché il cerchio non si vedeva lo stesso (seconda passata, 22/09/2026)

L'operatore ha riferito la stessa cosa una seconda volta: «non vedo ancora il
cerchio trasparente intorno alla posizione, vedo solo il pallino blu». Non era
il CSS: il cerchio **coincideva esattamente con il pallino**.

`r: Math.max(accuratezza, r)` vuol dire «almeno grande quanto il pallino», e il
pallino è pieno e disegnato sopra. Misurato sui trenta impianti veri, dove il
riquadro che contiene tutto è largo **25 979 m**:

| zoom | vista | raggio del pallino | cerchio a ±3 m |
|---:|---:|---:|---:|
| 1 | 25 979 m | 649,5 m | **649,5 m** |
| 10 | 2 598 m | 64,9 m | **64,9 m** |
| 100 | 260 m | 6,5 m | **6,5 m** |

Adesso il puntino di «sei qui» è **più piccolo** degli altri e l'anello vale la
precisione vera, con un minimo visibile. (Le misure esatte sono cambiate nella
terza passata, qui sotto: in pixel, non in proporzione.)

⚠️ Quel minimo **non è la precisione**: è la soglia sotto la quale un anello non
si vedrebbe. Quando scatta significa «più preciso di quanto questa scala possa
mostrare», e il numero esatto resta scritto nella nota — che è la ragione per
cui è lecito arrotondare lì e non altrove.

### Terza passata: nel browser VERO il puntino non c'era (22/09/2026, v106)

L'operatore: «su Scudo Campo non funziona ancora come stai dicendo». Aveva
ragione, e le prove erano verdi. Il DOM finto non dipinge niente: due difetti
si vedevano **solo** aprendo la mappa in un browser vero (pagina di prova con i
moduli dell'app e i 24 impianti veri del pacchetto, fuori dalla porta
d'accesso):

* **il puntino blu era dipinto SOTTO il pallino rosso dell'impianto.** Era il
  primo della lista — l'ordine dà la precedenza al suo NOME — e quindi il
  primo a essere dipinto. Chi apre la mappa sta quasi sempre sopra un
  impianto: il suo puntino era coperto sempre. Precedenza del nome e ordine
  della pittura sono due domande diverse; ora «sei qui» si dipinge per ultimo;
* **ogni tratto era in METRI.** La viewBox è in metri, quindi `stroke-width:
  2px` vuol dire due metri: a 2 km di vista il bordo del cerchio era un quarto
  di pixel, a 5 m il contorno nero del nome «Sei qui» copriva mezzo schermo.
  Solo griglia, nord e croce avevano `vector-effect: non-scaling-stroke`; ora
  ce l'ha ogni tratto dentro `.mappa`, e un censimento della CSS lo pretende.

«Sei qui» ora ha misure in **pixel**: puntino da 6 px con bordo bianco, anello
di almeno 16 px (e più largo di un pallino d'impianto) che diventa la
precisione vera appena la supera.

⚠️ **Il fondo corsa è 10 m, non 5** (la v105 diceva 5). Misurato: il servizio
delle immagini arriva al livello 19 (0,22 m per pixel qui) e dal 20 in su
risponde «Map data not yet available»; a 12,8 m di vista la foto è fatta di
macchie di colore, a 5 m era una poltiglia e un anello di ±4 m riempiva lo
schermo.

⚠️ **Per provare la mappa nel browser si parte da un'ORIGINE nuova** (per
esempio `localhost` invece di `127.0.0.1`): Chrome tiene i moduli ES nella sua
cache HTTP, e una pagina ricaricata esegue il `mappa.js` di prima — successo,
con le misure della versione precedente lette come se fossero quelle nuove. Il
service worker dell'app NON ha questo problema: installa con `cache: 'reload'`.

### I nomi vicini: nessuno sparisce senza dirlo, nessuno copre un punto (22/09/2026)

«Dove le etichette sono troppo ravvicinate, dovresti trovare il modo per far sì
che si vedano tutte e due senza sovrapporsi, con una linea che porta al punto.»

`piazzaEtichette` (pura, gemella in `frontend/src/components/scudo/
mappaGeometria.js`):

1. **tutti i pallini occupano spazio prima di qualunque nome** — il difetto
   visto solo nel browser vero: un nome si confrontava con i pallini già
   disegnati e finiva sotto uno che arrivava dopo (LARDERELLO, CALA TELEGRAFO);
2. i quattro posti accanto, poi **anelli** fino a 31 raggi in sedici direzioni,
   con una **linea guida** dal bordo del pallino al bordo del nome;
3. un pallino che ne **tocca** un altro salta i posti accanto: accanto a due
   pallini sovrapposti un nome è ambiguo, e i primi quattro nomi di un grappolo
   lo chiudevano in un anello che nessuna guida poteva più attraversare;
4. nessuna guida attraversa un nome e nessun nome copre una guida —
   intersezione **esatta** (Liang–Barsky): un campionamento a undici punti
   lasciava passare una guida che tagliava l'angolo di un nome;
5. il nome sta **dentro lo schermo**; chi non trova posto viene contato nella
   nota («N nomi non stanno a questa scala: ingrandisci»).

Misurato sui 24 impianti veri a tutta vista: **prima** 15 nomi, 9 spariti, 8
stampati sopra un pallino, 5 tagliati dal bordo; **adesso** 21, zero sovrapposti,
zero su un pallino, zero tagliati. A metà zoom sette su sette.

⚠️ Provato e **tolto**: «prima i più affollati» (l'euristica classica)
lasciava senza posto gli stessi 3 nomi e portava le guide da 10 a 14. E il
corpo del carattere quasi non conta: da 15 a 11,5 px si guadagna un nome.

### Lo zoom si misura in metri, non in rapporti (22/09/2026)

«Dovremmo poter zoommare più di 100 m, anche a costo di perdere qualità».

Il fondo corsa era `ZOOM_MAX = 400`, cioè «quattrocento volte il riquadro che
contiene tutto». Un rapporto non dice niente da solo: con 25 979 m di riquadro
cadeva a **65 m** di vista, e sullo stesso codice aperto su un impianto solo gli
stessi 400 sarebbero arrivati a qualche centimetro. Adesso il limite è
`LATO_MINIMO_VISTA_M = 10`: dieci metri in uno schermo (la v105 diceva cinque;
misurato nel browser, sotto i dieci la foto è una poltiglia — vedi la terza
passata).

Le tessere del satellite si fermano al livello 19 e sotto sfocano — è il costo
accettato. **La geometria non sfoca**: griglia, barra di scala e cerchio della
precisione sono disegnati, non scaricati, e restano esatti.

### Lo stato del GPS sta sul PULSANTE (22/09/2026)

«Ancora non vedo quando sta prendendo la posizione e quando no.» La nota c'era
e diceva tutto, ma stava sotto la barra di scala, otto comandi e una legenda di
sei voci: su un telefono, **fuori schermo**. Un messaggio che nessuno vede non è
un messaggio.

L'unica cosa che chi ha premuto sta sicuramente guardando è il tasto che ha
premuto, quindi lo stato sta lì: «📡 dove sono» → «📡 cerco il segnale…» →
«📡 misuro… ±17 m» → di nuovo «📡 dove sono» quando il ricevitore è spento.
Tre segnali insieme — parola, colore, battito — perché uno solo lascia fuori
qualcuno, con `aria-busy` per chi non vede il colore e `prefers-reduced-motion`
per chi ha chiesto che niente si muova. E la nota è risalita **sopra** la
legenda.


## La posizione si prende durante il CONTROLLO (20/09/2026)

Richiesta dell'operatore: «se la posizione manca, suggeriamo di salvarla anche in
quel momento, senza cambiare tab o scheda». È lo stesso ragionamento del campo
dell'anno di costruzione: il controllo è **l'unico momento in cui si è davanti al
pezzo**, e una cosa registrabile solo stando lì va chiesta lì. Mandare
l'operatore in anagrafica e poi farlo tornare è il percorso che non fa nessuno.

Il riquadro compare **solo se manca**: su un presidio che ce l'ha sarebbe una
domanda a cui si è già risposto. Le coordinate viaggiano con i dati del controllo
(come `anno_costruzione`) e il ponte in `app.js` le scrive sul presidio **nella
stessa transazione**. Un riquadro aperto e non compilato non manda niente, o
svuoterebbe quelle che c'erano.

`bloccoCoordinate` è estratto da `bloccoUbicazione` proprio per questo: i
chiamanti sono due.

## Aspettare il GPS non basta: bisogna RICHIEDERE (20/09/2026)

Segnalazione dell'operatore, su **Chrome/iOS**: «l'ubicazione gps viene acquisita
in un istante senza fare la misurazione della precisione», dopo aver reimportato
il pacchetto.

Due cose, e la prima va detta perché tornerà: **reimportare un pacchetto non
aggiorna l'app.** Il pacchetto porta i DATI; il programma arriva dal service
worker, e senza `skipWaiting` la revisione nuova entra in funzione solo quando
l'operatore preme «Aggiorna». Un difetto corretto e pubblicato può quindi restare
sul telefono per giorni.

La seconda è un difetto vero, e la prova non poteva vederlo. `watchPosition`
avvisa quando la posizione **cambia**: su un telefono fermo — cioè sempre, quando
si è davanti al presidio — WebKit consegna un fix solo e poi tace per tutti i
venticinque secondi. Il pannello mostrava quel primo numero e restava immobile,
che da fuori è indistinguibile da «ha finito». E il primo fix è sistematicamente
il **peggiore**: è tutto il motivo per cui questa schermata esiste.

* si **richiede** una posizione nuova ogni `INTERVALLO_RILETTURA_MS` (3 s,
  `maximumAge: 0`, quindi un fix vero e non quello in cache), oltre ad ascoltare.
  Dove `watchPosition` consegna da sé le due strade si sommano; su iOS è l'unica
  che produce una sequenza;
* il pannello **dice** che sta lavorando: «3 letture · continuo a misurare ancora
  12 s». Con un numero fermo, «sto misurando» e «ho finito» hanno lo stesso
  aspetto — ed è esattamente la cosa che l'operatore ha letto;
* il conto alla rovescia si spegne **da sé** a zero, non solo quando qualcuno lo
  ferma: un orologio che dipende dalla catena delle chiamate resta acceso per
  sempre appena una non arriva (misurato con una mutazione — teneva in vita il
  processo delle prove).

⛔ **La finzione delle prove garantiva proprio ciò che le prove dovevano
verificare.** `geoFinta` emette tre letture di fila da `watchPosition`: con
quella, «la precisione migliora» è vero per costruzione. Adesso c'è
`geoIphoneFermo`, che ne dà **una** e poi tace — le altre le ottiene solo chi le
chiede — con il fratello che usa un dispositivo capace solo di ascoltare.

## Le azioni della scheda: due famiglie, non una fila (20/09/2026)

Richiesta dell'operatore: «scegli i piani» e «questo presidio fa eccezione»
devono andare in fondo, dove c'è il pulsante per segnalare che un presidio non
c'è più; «apri anomalia» resta dov'è; e tutti centrati.

Sono due famiglie, e la fila unica le faceva sembrare una:

* **aprire un'anomalia** è la strada secondaria dei CONTROLLI — si passa davanti
  a un estintore e si vede il cartello staccato — quindi sta attaccata a loro;
* **scegliere i piani**, **derogare** e **segnalare un presidio rimosso** si
  fanno una volta ogni tanto, due delle tre chiedono la password admin, e in
  mezzo ai controlli facevano scorrere via quello che serve sempre.

In fondo, staccate da un filetto, e centrate: in una colonna di pulsanti larghi
uguali il testo fuori asse si legge come un errore di impaginazione.

## «Presidio rimosso»: dove finisce, oggi (misurato il 20/09/2026)

L'operatore ha chiesto se quella segnalazione si veda in ufficio. **No.**

`eliminaPresidio` marca `eliminato_il` e aggiunge il motivo alla nota. Da quel
momento il presidio è filtrato via **da tutte le viste dell'ufficio**:

| dove | filtro |
|---|---|
| elenco presidi | `Asset.eliminato_il.is_(None)` |
| estrazioni Excel | `Asset.eliminato_il.is_(None)` |
| cruscotto | `Asset.eliminato_il.is_(None)` |
| pacchetto verso il campo | `Asset.eliminato_il.is_(None)` |

L'unica traccia leggibile è **l'evento nel registro delle modifiche** (entità
asset, DELETE, con il motivo). Nell'anteprima del rientro si vede soltanto come
**un numero più basso**, senza dire quale né perché — e il motivo, che è
obbligatorio scrivere, finisce in un posto che nessuno guarda.

### La correzione, accettata dall'operatore lo stesso giorno

«Segnala presidio rimosso» era **una** domanda con **tre** risposte diverse
dentro, e ne applicava una sola. Adesso il foglio ne chiede tre, perché sono
tre fatti diversi e solo chi è sul posto li distingue:

| che cosa è successo | che cosa fa l'app | perché |
|---|---|---|
| **è stato sostituito** | la sostituzione di sempre | il punto presidiato c'è ancora |
| **è stato tolto e non sostituito** | `dismettiPresidio`: stato `DISMESSO` **+ un'anomalia con il motivo** | la postazione esiste e resta vuota: va vista in ufficio, e non deve più generare lavoro |
| **non è mai esistito** | `eliminaPresidio`, con conferma | la riga non doveva esserci: toglierla è la cosa giusta |

Le due scritture di `dismettiPresidio` servono **tutte e due**, e ognuna copre
il buco dell'altra: lo stato spegne il lavoro ma non si vede in ufficio (nessuna
estrazione mostra `stato_codice` da solo); l'anomalia si vede ma non spegne
niente — da sola lascerebbe il presidio «in servizio» a chiedere controlli su un
pezzo che non c'è. Il motivo è obbligatorio: senza, la dismissione sarebbe un
modo silenzioso di far sparire il lavoro, cioè esattamente ciò che si voleva
evitare (provato rosso).

⚠️ `DISMESSO` deve esserci **nel catalogo che il pacchetto porta**: con un
pacchetto vecchio la funzione si ferma e lo dice, invece di scrivere uno stato
che l'ufficio rifiuterebbe riga per riga al rientro.

## Stato e anomalie: due domande, e perché non si uniscono (20/09/2026)

L'operatore ha chiesto un'analisi più completa. Ecco i numeri, e poi la regola.

**Che cosa FA lo stato, meccanicamente** (`stati_asset`):

| stato | operativo | sospende scadenze | presidi oggi |
|---|---|---|---|
| IN_SERVIZIO | 1 | no | **864** |
| NON_PREVISTO | 1 | **sì** | **4** |
| SCORTA | 1 | no | 0 |
| SEGREGATO | 0 | **sì** | 0 |
| DISMESSO | 0 | **sì** | 0 |

**La differenza è una sola riga della tabella, e decide tutto**:
`sospende_scadenze`. Lo stato è l'unico campo che può dire *«questa riga non
genera lavoro»*. Un'anomalia fa l'opposto per costruzione: dice che c'è un
difetto, e **aggiunge** lavoro.

Quindi fonderli significherebbe: per dire «qui non ci deve essere niente» si
aprirebbe un'anomalia, il presidio diventerebbe NON_IDONEO e resterebbe per
sempre nell'elenco delle cose da riparare — su una postazione che è
correttamente vuota. È esattamente il contrario di quello che si vuole dire.

**Dov'era la confusione, allora.** Non nei dati: nelle parole.

1. la pastiglia rossa «N da sistemare» contava **214** presidi dove le anomalie
   ne contavano **210** — lo stesso insieme più quattro NON_PREVISTO. Tolta;
2. il filtro «Non idonei» selezionava `!conforme(a)`, cioè *tutto ciò che non è
   idoneo*: ci finivano dentro anche quei quattro. Adesso seleziona
   `idoneita === 'NON_IDONEO'`: **210 invece di 214**;
3. la pastiglia dello stato sulla riga del presidio era **rossa**. «Rimosso e non
   sostituito» e «fuori servizio in attesa di decisione» sono decisioni di una
   persona, non difetti trovati sul pezzo: adesso è ambra. Il rosso è dei
   difetti, e usarlo anche per le decisioni insegna che rosso vuol dire
   «qualcosa», cioè niente.

⚠️ E da questo nasce un terzo gruppo: «Idonei» e «Non idonei» **non
partizionano più**, perché restano fuori i non previsti e i fuori servizio. Il
pannello dei filtri adesso lo DICE — «altri N presidi non sono né idonei né non
idonei» — come i numeri della home dicono i loro. Due caselle che non fanno il
totale nascondono qualcuno senza dirlo.

**Il consiglio, in una riga**: tenere il campo, e trattarlo per quello che è —
un'**eccezione**, che deve restare quasi sempre vuota (864 su 868 hanno lo
stesso valore, ed è giusto così). Quello che andava tolto non era il dato: era
l'abitudine di mostrarlo come se fosse un problema.

### ⛔ E la sospensione era dichiarata e mai applicata, da questo lato

Trovato il 20/09/2026 **scrivendo la frase d'aiuto che la prometteva** — cioè
nel momento in cui a qualcuno toccava dire all'operatore che cosa fa lo stato.

Misurato prima di correggere: l'ufficio la sospensione **la applicava già**
(`ricalcola_scadenze` in `scudo_seed.py` salta i presidi sospesi e ANNULLA le
loro scadenze aperte), mentre nell'app di campo **nessuno leggeva
`sospende_scadenze`**. Il campo compariva solo come colonna del pacchetto e come
riga di un commento.

Il modo in cui si nascondeva è la parte che vale la pena ricordare: **ognuno dei
due lati era coerente con sé stesso**, quindi il pacchetto passava di mano senza
un errore, i totali tornavano, e nessuna prova poteva accorgersene. Quattro
postazioni `NON_PREVISTO` chiedevano **8 controlli su 1497**.

⚠️ E la difesa dell'ufficio, arrivata in campo, produceva l'effetto **opposto**
al suo: annullata la scadenza, il ramo «mai eseguito» di `vociDelGiro` accende
la voce **proprio perché** non c'è una data. Zittirle in ufficio le rendeva più
rumorose qui.

Adesso la risposta sta in **una funzione sola**, `sospendeLavoro(a)` in
`stato.js`, e ci passano `controlliApplicabili` (da cui discendono `vociDelGiro`,
`avanzamentoDi`, la barra e l'albero) e `scadenzeDi`. Non è cablata su un elenco
di codici: la porta il catalogo nel pacchetto, quindi uno stato nuovo entra in
vigore senza toccare il file. Denominatore del giro: **1497 → 1489**.

Le scadenze qui sono **nascoste, non cancellate**: se lo stato torna «in
servizio» — perché il presidio c'era davvero — tornano da sé, senza passare
dall'ufficio. La scheda lo dice con un riquadro che nomina lo stato e indica la
via d'uscita, perché una sezione «Controlli» vuota si legge come un difetto dei
dati e non come la decisione che è.

Prove: `test_stato_campo.mjs` «uno stato che sospende spegne davvero il lavoro,
non solo a parole», con **due fratelli** — rimesso in servizio il lavoro
ricompare intero, e «di scorta» (che non sospende) non lo perde, o «spegni tutto
ciò che non è in servizio», il difetto opposto, sarebbe verde. La parità fra i
due lati sul dato vero è in `test_azioni_complete.py`: dopo il rientro il
presidio dismesso non ha scadenze aperte (mutazione: l'ufficio che non sospende
più → rossa, 1 scadenza).

## «Da sistemare» diceva quello che le anomalie dicevano già (20/09/2026)

Segnalazione dell'operatore: «lo stato (etichette rosse nei presidi) avevamo
detto che era superfluo se sfruttiamo correttamente le anomalie; forse dobbiamo
unirle nel database così che usiamo solo le anomalie — verifica meglio».

Misurato sull'archivio prima di toccare niente:

| | |
|---|---|
| presidi «da sistemare» (pastiglia rossa) | **214** |
| presidi con anomalie aperte | **210** |
| di differenza | **4**, tutti `NON_PREVISTO` |
| non idonei per pezzi guasti **senza** anomalia | **0** |
| non idonei per piani falliti **senza** anomalia | **0** |

Cioè: lo stesso insieme, più quattro presidi che **non sono un difetto** — «non
previsto» è una decisione, e chiamarla «da sistemare» è falso. Due pastiglie con
lo stesso numero fanno cercare la differenza che non c'è, e una sbagliata su
quattro insegna a non fidarsi nemmeno delle altre.

Nell'albero adesso ci sono **due fatti che non si ripetono**: «N guasti» (rosso)
e «N anomalie» (ambra).

⛔ **Ma i dati NON si uniscono**, e la misura dice perché. Lo stato risponde a
«c'è un pezzo qui, e protegge questo punto?» — `NON_PREVISTO` vuol dire che non
ce n'è e non ce ne deve essere; un'anomalia vuol dire che ce n'è uno e ha un
difetto. Sono due domande, e fonderle perderebbe proprio la distinzione che
l'operatore stesso aveva chiesto il 18/09 («DISMESSO non è ridondante con la
sostituzione: là un pezzo nuovo arriva, qui la postazione resta vuota»). A
essere duplicata era **l'etichetta**, non il dato.

⚠️ Tolta la pastiglia, l'albero potrebbe diventare cieco: un presidio non idoneo
senza anomalie e senza guasti non lo mostrerebbe più nessuno. `test_stato_campo.mjs`
lo sorveglia e diventa rosso **nominandoli**, così si decide se rimettere una
pastiglia invece di scoprirlo in campo.

## Un numero che non si può inseguire è una constatazione (20/09/2026)

Richiesta dell'operatore: «dove dice 13 senza scadenze calcolate, se ci
clicchiamo dovrebbe mostrarci quali sono».

Adesso quella scheda è un **pulsante** — non un `div` con un ascoltatore sopra:
si raggiunge con la tastiera, il lettore di schermo lo annuncia, e si vede che è
toccabile. Apre l'elenco, e ogni riga apre la scheda del presidio: è lì che si
risolve, perché quasi sempre manca la data da cui contare e si scrive in
anagrafica.

⚠️ Le altre due voci del gruppo (in regola, non in regola) **non** sono
apribili, e non è una dimenticanza: si guardano nell'elenco dei presidi con i
filtri che già esistono. Se lo diventassero tutte, «apribile» smetterebbe di
dire qualcosa. Lo pretende `test_riepilogo_home.mjs`.

## Il titolo del foglio non si perde (20/09/2026)

Segnalazione dell'operatore: «quando apriamo un presidio in alto dice
• 7663 • CO2 • UISUV-13, ma se clicchiamo su idoneo quel titolo viene sostituito
dal nome del controllo».

Chi registra un giudizio deve continuare a vedere **su quale pezzo** lo sta
registrando: è l'unica cosa che dalla schermata non si ricava in nessun altro
modo, e sbagliare pezzo è l'errore più caro di tutta l'app. Adesso il foglio ha
un **sottotitolo**: sopra il presidio, sotto il controllo che si sta registrando.

Il titolo lo costruisce `titoloPresidio(a)`, una funzione sola usata dalla scheda
e dal foglio del controllo: due titoli scritti in due posti si separano al primo
ritocco, e «resta in testa» diventerebbe «resta in testa, ma scritto in un altro
modo». Lo sorveglia un censimento del sorgente in `test_ui_campo.mjs` — `app.js`
avvia l'applicazione appena viene importato, quindi è l'unico strumento
possibile.

## Un bersaglio solo, e le parole nel foglio (20/09/2026, terza forma)

Segnalazione dell'operatore: «rendi meno invadente la navigazione/posizione/
indirizzo nella tab dei luoghi, altrimenti ci si distrae dall'alberatura».

Aveva ragione, ed era colpa di come le avevo messe: ogni nodo portava una fascia
azzurra «Naviga» a tutta larghezza **più** una riga tratteggiata per la
posizione, sopra i quattro comandi. **Tre righe di contorno per un nodo**, e
l'albero — che è il motivo per cui quella scheda esiste — spariva sotto.

Adesso nel nodo c'è **un'icona sola** in fondo alla riga del nome (🧭 se una
posizione c'è, 📍 se non c'è), alta quanto il pollice. Il nodo torna a essere
nome + conteggi, come prima che la navigazione esistesse.

Le parole non si perdono: si spostano nel **foglio** che l'icona apre — «Dove si
trova · NOME» — dove c'è spazio per scriverle per esteso e dove «🧭 Naviga» e
«📍 Rileva la posizione» non si possono confondere. Lì c'è anche l'accuratezza,
che nell'albero non entrava.

⚠️ **Un'icona sola vuole un nome accessibile.** `aria-label` con il nome del
luogo: senza, con il lettore di schermo è un pulsante che non si sa che cosa
faccia. Lo pretende `test_luoghi_campo.mjs`.

La lezione, che vale oltre questa schermata: **la densità è una funzione, non
una rifinitura.** Due righe in più per nodo sembravano un dettaglio grafico e
hanno reso inutilizzabile la navigazione dell'albero — che è il lavoro vero di
quella scheda. Il percorso è stato: prima un pulsantino in fila con gli altri
(troppo piccolo, e della famiglia sbagliata), poi una riga intera (leggibile ma
invadente), infine un'icona con le parole altrove. Le prime due sono servite a
scoprire la terza, e sono costate due pubblicazioni.

## Navigare è la riga, non un pulsantino (20/09/2026) — superato dal paragrafo sopra

Segnalazione dell'operatore: «il link naviga non è posizionato in modo ottimale
per sfruttare bene la funzione di navigazione luoghi da smartphone».

Erano due cose separate: l'indirizzo scritto piccolo dentro il pulsante che apre
il nodo, e un quinto pulsantino «🧭 Indicazioni» in fila con Presidi, Rinomina,
+ area, Elimina. Due difetti insieme:

* **cinque comandi in una riga** su un telefono diventano bersagli da mezzo
  pollice — ed era proprio il gesto che si fa in piedi, fuori, con i guanti;
* **navigare non è della stessa famiglia di rinominare.** Uno lo fai *prima di
  partire*, gli altri quando sei già lì e stai correggendo l'anagrafica.
  Metterli in fila li fa sembrare intercambiabili.

Adesso **la cosa che leggi è la cosa che tocchi**: una riga intera sotto il nome,
con la bussola davanti, «Naviga» in grassetto e sotto l'indirizzo (o le
coordinate). Bersaglio alto 44 px e largo quanto la scheda.

## La posizione di un LUOGO, presa sul posto (20/09/2026)

Richiesta dell'operatore: «dai modo di modificare le ubicazioni usando la stessa
funzione di satellite usata per i presidi; la modifica deve essere comunque
registrata come avviene per gli altri dati e presa sia su staffetta che su
Scudo».

Impianti, aree e ubicazioni hanno adesso `lat`, `lon`, `gps_accuratezza_m` e
`gps_rilevato_il`, e il modulo che li rinomina monta **lo stesso
`bloccoCoordinate` dei presidi** — non una copia: la scala della precisione, la
lettura migliore, i quattro modi di spegnere il GPS e le parole delle bande sono
già risolti là, e una seconda implementazione divergerebbe al primo ritocco.

* su una stazione grande «l'impianto» è un recinto di ettari: il punto che serve
  è quello della cabina, e ora ce l'ha la cabina;
* ⛔ **«📍 Rileva la posizione» è un comando a sé, e NON chiede la password
  admin.** Era dentro il modulo di rinomina, e rinominare un luogo che viene
  dall'ufficio la chiede: per registrare dove si trova una cabina bisognava
  passare da una porta che difende un'altra cosa — segnalazione dell'operatore,
  «non mi fa modificare per usare il satellite». La password difende la
  STRUTTURA dell'archivio (un nome cambiato, un luogo cancellato cambiano come
  lo ritrova chi non è qui); una posizione è un dato di campo che prima non
  c'era, della stessa famiglia del GPS sui presidi, che non ha mai chiesto
  niente. **Chiedere una password per aggiungere l'unica informazione che solo
  chi è sul posto può dare vuol dire non averla.** Il pannello resta anche nel
  modulo di rinomina, per chi ci passa già;
* il comando sta accanto a «Naviga» e non in fila con Rinomina ed Elimina: è lo
  stesso argomento — dove si trova questo posto — e dice due cose diverse a
  seconda dello stato («📍 Rileva la posizione» quando non c'è, «📍 correggi la
  posizione» quando c'è);
* la posizione entra nella **stessa modifica** del nome, quindi nello stesso
  evento di giornale: in ufficio si legge chi l'ha presa e quando, come per ogni
  altro dato. Viaggia nel pacchetto (dieci colonne additive nei due gemelli) e
  passa di mano nella staffetta;
* ⚠️ **tutti e quattro i campi insieme o nessuno** (`posizioneDa` in `stato.js`).
  Una data «rilevata il» accanto a coordinate che non esistono è un dato che
  sembra un dato — chi legge conclude che qualcuno sia andato sul posto — e
  l'accuratezza senza coordinate non dice niente affatto. Mezza coordinata non
  vale: manderebbe sul meridiano di Greenwich.

⛔ E l'export/import di aree e ubicazioni **non ha più elenchi di colonne scritti
a mano**: legge quelle dichiarate, come già fa l'impianto. Era la terza volta in
tre giorni che una colonna nuova si perdeva in una di quelle liste.

## Gli indirizzi degli impianti, e come arrivarci (20/09/2026)

Richiesta dell'operatore: «dal database facility trova tutti gli indirizzi degli
impianti e mettili come link Google Maps nella schermata Luoghi».

Nell'albero dei Luoghi ogni impianto porta adesso il suo indirizzo per esteso e,
fra i comandi, **«🧭 Indicazioni»** — il primo, perché chi guarda quella riga con
il telefono in mano spesso deve ancora arrivarci.

* ⚠️ **`/maps/dir/?api=1&destination=` e non `?q=`**: sono due cose diverse.
  `?q=` apre la scheda del posto — che è quello che fa `linkMappa` sulle
  coordinate di un presidio, e risponde a «dov'è questo estintore». Qui serve
  l'altra domanda: partire da dove si è e arrivare lì.
* Resta `google.com` e non uno schema nativo, per la ragione già scritta su
  `linkMappa`: `geo:` e `maps://` aprono l'app su UNA delle due piattaforme.
* È un `<a>` e non un pulsante: porta fuori dall'app, e tenendolo premuto si
  copia l'indirizzo da mandare a un collega.
* ⛔ **Le COORDINATE vincono sull'indirizzo** (20/09/2026, l'operatore ha
  dettato quattro pin). Un pin è una posizione; un indirizzo è un nome che
  qualcuno deve interpretare — e qui i nomi sono «LOCALITÀ PIAN DELLA TORA»,
  «VILLAGGIO BORACIFERO», «STRADA STATALE 541, KM 8,230»: portano al paese, non
  al cancello. SUVERETO e SUVERETO SACOI stanno a cinquecento metri l'uno
  dall'altro e con il solo indirizzo non si distinguono affatto. L'indirizzo
  resta SCRITTO, perché si legge, si detta al telefono e si cerca in un elenco.
* Dove l'indirizzo non c'è ma il pin sì, la riga mostra **le coordinate** — non
  il solo comune, che sarebbe un nome travestito da indirizzo.
* **Un impianto su trenta non ha né l'uno né l'altro** (CE CORTONA) e non ha
  nessun pulsante: la fonte tace, e un indirizzo accostato «per somiglianza»
  manderebbe l'operatore nel posto sbagliato con la faccia di un dato buono.

⚠️ In `nodoAlbero` **non** c'è un `nodo.tipo === 'impianto'` a decidere chi
mostra il pulsante, e l'assenza è misurata: c'era, e toglierlo lasciava tutte le
prove verdi. Solo la tabella degli impianti ha la colonna `indirizzo`, quindi su
un'area `linkIndicazioni` risponde già `null`. La proprietà — aree e ubicazioni
non offrono indicazioni — resta fissata da `test_luoghi_campo.mjs`, che la
verifica sui dati invece che su una guardia che non può fallire.

## Il giro comincia quando comincia il lavoro (20/09/2026)

Segnalazione dell'operatore: «vedo che mi fa registrare le verifiche anche se
non abbiamo iniziato il controllo».

Registrare senza aver premuto «Inizia» era già previsto — ai presidi ci si
arriva anche dalla loro scheda, e `interventoNelGiro` ripiegava sull'ora in cui
il pacchetto è stato caricato — ma lasciava lo schermo a dire due cose opposte:
la fascia **«controllo non iniziato»** sopra un presidio appena controllato.
Uno stato che il programma tratta come «in corso» e scrive «non iniziato» non è
un dettaglio di etichetta: è il motivo per cui poi nessuno si fida dei numeri
accanto.

Adesso il primo controllo registrato **apre il giro da sé**, e il giornale dice
quale delle due strade è stata («a mano» / «primo controllo registrato»), così
in ufficio la differenza resta leggibile.

⚠️ L'apertura sta **dopo** le validazioni di `registraIntervento`: un tentativo
rifiutato non deve aprire niente — in ufficio un giro aperto è un lock sugli
impianti. Ha il suo fratello in `test_stato_campo.mjs`.

## «Non si è potuto fare» non ferma l'orologio (20/09/2026)

L'operatore l'ha previsto prima che lo misurassimo: «quando mettiamo un
controllo come non possibile verificare va in quelli fatti, e in quel controllo
può andare bene perché così l'operatore non se lo ritrova ogni volta da
spuntare — ma è necessario accertarsi che quando re-importeremo il pacchetto su
Scudo e poi ricreeremo il pacchetto per Scudo Campo, quei presidi non vadano in
automatico in quelli fatti: deve riproporli in quelli da fare».

Misurato prima di correggere: una `VERIFICA_USCITE` registrata NON_ACCESSIBILE
spostava la scadenza dal 03/10/2026 al **20/03/2027**, e nel pacchetto
successivo quel presidio usciva con `richieste: 0`. **Un cancello chiuso trovato
una volta lo nascondeva fino al giro dopo il prossimo.**

Restano due fatti distinti, e servono entrambi:

* **dentro il giro** la voce è chiusa — `vociDelGiro` la toglie dai mancanti
  guardando gli interventi di QUESTO giro, non la scadenza;
* **per l'orologio** non è successo niente: `esecuzioneVale` (in `calcoli.js`,
  gemella di `esecuzione_vale` del server) salta quegli esiti, la scadenza resta
  dov'era e il presidio torna nei «da fare» al giro dopo.

In campo la strada che restava aperta era la terza: `vociDelGiro` leggeva «mai
eseguito» come spento da QUALUNQUE intervento precedente. Vale per i presidi
senza nessuna scadenza calcolata — i sette «presenti, da verificare» del
censimento — e una mutazione che la ripristinava restava VERDE finché la prova
non ha avuto quel caso: i due giri di andata e ritorno scelgono un presidio CON
una scadenza, quindi passano dal semaforo e quel ramo non lo eseguono mai.

## I numeri della home si sommano (20/09/2026)

Segnalazione dell'operatore: «se sommiamo presidi in regola e non in regola non
arriviamo comunque a 868, e nemmeno a 1688, quindi non è affatto chiaro».

Aveva ragione due volte:

1. **due unità con lo stesso nome.** «1688 presidi censiti» è la somma delle
   QUANTITÀ — i pezzi — mentre 868, 581 e 281 contano le RIGHE, cioè le
   postazioni. Misurato: 868 righe, 169 delle quali valgono più di un pezzo,
   1688 pezzi in tutto;
2. **la somma che torna non si vedeva.** 581 + 281 + 6 fa 868, ma il terzo
   addendo stava in una nota staccata e in mezzo c'era una scheda che contava
   un'altra cosa.

Adesso i numeri stanno in **blocchi**, ognuno con il suo totale scritto in testa
e le voci che ci sommano dentro (`riepilogo_home.js`, puro, così una prova può
eseguirlo). I pezzi stanno in **nota** e non in una scheda: una scheda accanto
alle altre invita a sommarla con loro, ed è di un'altra unità.

E il caso che sullo schermo sembrava un errore — «1 presidio completato» accanto
a «0 controlli fatti» — adesso è scritto: quel presidio è chiuso da una verifica
che non si è potuta eseguire, e la nota lo dice («contano come visti, non come
fatti»).

⚠️ Nel modulo **non** c'è un campo `quadra`, e l'assenza è misurata: c'era, e una
mutazione che lo faceva rispondere sempre «sì» non faceva fallire niente — la
prova la somma se la calcola da sé, e `app.js` non lo leggeva. Un valore che
nessuna prova può smentire insegna che conta e non conta.

## La precisione si guarda migliorare (20/09/2026)

Richiesta dell'operatore, subito dopo: «qualcosa di animato, colorato, che fa
capire la precisione che migliora via via che prova — sotto i 10 m è
accettabile, 5 m precisa».

Il movimento **è** l'informazione. Un numero che passa da 20 a 3 va letto e
confrontato con quello di prima; un puntino che scivola verso destra su una
scala colorata si vede senza leggere, con i guanti e il telefono in mano.

| accuratezza | parola | simbolo | colore |
|---|---|---|---|
| ≤ 5 m | precisa | ✓ | verde |
| ≤ 10 m | accettabile | ✓ | blu |
| ≤ 25 m | approssimativa | ! | ambra |
| oltre | grossolana | ✕ | rosso |

* ⛔ **Colore E parola E simbolo, tutti e tre.** Controluce, dentro una cabina,
  verde e ambra si somigliano, e c'è chi non li distingue affatto: una barra che
  dice la qualità solo col colore non la dice. Il numero resta accanto — «±3 m» —
  perché la posizione di un puntino su una scala non si stima.
* **La scala è LOGARITMICA** (`quotaAccuratezza`, ancorata fra 3 e 100 m).
  L'accuratezza non ha un massimo — un fix scadente dice ±2000 m — e su una
  scala lineare tutto quello che conta (3, 5, 10, 25) si schiaccia in un angolo,
  cioè la barra non mostrerebbe proprio il miglioramento che deve mostrare.
* **Il fantasma**, il trattino fermo dov'era la prima lettura, è la parte che
  risponde alla domanda vera: *vale la pena aspettare ancora?* Senza di lui si
  vede dove si è, non quanta strada si è fatta.
* **Fermo e in corso hanno due aspetti diversi**: mentre misura il puntino
  pulsa, alla fine no. È lo stesso difetto di partenza — «sta lavorando»
  indistinguibile da «ha finito» — che tornerebbe in grafica invece che a parole.
* Le quattro zone colorate sono larghe quanto le **stesse costanti** che
  decidono le parole (`GRADINI_ACCURATEZZA`): il disegno non può dire una cosa e
  la pastiglia un'altra.
* ⚠️ `prefers-reduced-motion` spegne le animazioni. Restano colore, parola,
  numero e posizione, cioè tutta l'informazione: per qualcuno un'animazione che
  non finisce mai non è un dettaglio ma un sintomo.

⚠️ **Le bande sono un VOCABOLARIO, quindi hanno un gemello.** L'ufficio aveva già
la sua regola dei 25 m scritta a mano in due punti di `Presidi.js`: aggiungendo i
gradini fini al solo telefono, lo stesso presidio si sarebbe chiamato «precisa»
in campo e niente in ufficio. Ora `livelloAccuratezza` sta in
`scudo-campo/js/ubicazione.js` e in `frontend/src/components/scudo/accuratezzaGps.js`
(senza importare niente, o non sarebbe eseguibile in Node), e le confronta
`scripts/scudo/test_accuratezza_cross.mjs` — parole, simboli, soglie e posizione
sulla scala, con i confini esatti e i loro vicini (4-5-6, 9-10-11, 24-25-26):
senza quelli, `<= 5` e `< 5` sono indistinguibili.

I **25 metri non spariscono**: restano il confine che decide la frase «indica
l'area, non il pezzo». Gli altri due gradini stanno dentro la zona buona e
dicono un'altra cosa — quanto si può ancora guadagnare stando fermi qualche
secondo in più, che è l'unica decisione che l'operatore ha in mano mentre misura.

## «Non spuntata» vuol dire NON IDONEA (20/09/2026)

Richiesta dell'operatore: registrando un controllo non idoneo con delle caselle
non spuntate, il verbale diceva «Verifiche non eseguite: …». «Non spuntarle
significa che non sono idonee.»

Non è una questione di stile. In Scudo **«non eseguito» è un esito con un nome
proprio** (`NON_ESEGUITO`, «non si è potuto fare»): non è un difetto del pezzo e
lascia l'idoneità dov'era. Una casella vuota dentro un controllo che si sta
dichiarando non idoneo dice l'opposto — quella verifica è stata fatta e non è
andata bene. Con le parole dell'esito che significa il contrario, chi legge il
verbale in ufficio va a cercare un lavoro da rifare invece di un difetto da
riparare.

La frase è adesso `descrizioneVerificheNonIdonee` (`stato.js`), gemella di
`descrizione_verifiche_non_idonee` del server — ⚠️ **le due nessuno le
confrontava**, ed è la stessa forma del difetto del «perché non in regola» del
19/09: due implementazioni della stessa frase, ognuna provata contro sé stessa.
Peggio che altrove, perché il testo finisce nella DESCRIZIONE dell'anomalia,
cioè nella stessa colonna d'archivio scritta ora dal telefono ora dalla
scrivania. Le confronta `test_idoneo_cross.py`.

## Il registro delle modifiche registrava tutto e non si leggeva (20/09/2026)

Segnalazione dell'operatore: «il registro non sembra che recepisca i controlli,
la modifica anagrafica, la posizione». Misurato: li **recepiva tutti**. La
schermata mostrava le due colonne grezze dell'evento — «asset · UPDATE» —
identiche per tre azioni diverse: cambiare le note, salvare la posizione,
correggere la quantità. Nessuna si riconosceva come la cosa appena fatta, e **un
registro che non si riconosce è indistinguibile da un registro che non
registra**: la conclusione era ragionevole.

`descriviEvento` traduce: soggetto («UISUV-444 · Uscita di sicurezza»), azione
(«Posizione salvata»), dettaglio («43.077127, 10.676445 · ±3 m»). Il payload
conteneva già `prima` e `dopo`: nessuno lo apriva.

## Due difetti che bloccavano il salvataggio (20/09/2026)

Trovati dal telefono dell'operatore e dalla prova scritta per riprodurli.

1. **«Campo sconosciuto: lat»** — i metadati dei campi viaggiano nel pacchetto,
   e uno esportato prima dei campi GPS non li conosce. `aggiornaAsset` rifiutava,
   e l'eccezione portava giù l'INTERO salvataggio: si perdeva **il controllo**,
   cioè il lavoro obbligatorio, per colpa di un dato facoltativo. Adesso
   `CAMPI_APP` sono i campi che l'app sa gestire da sé (le loro colonne le
   dichiara `pacchetto.js`, quindi il dato torna comunque in ufficio), e il ponte
   del controllo racchiude la scrittura della posizione in un `try`: **una cosa
   in più non deve mai far perdere la cosa dovuta**.
2. **«Posizione rilevata il: non modificabile»** — mascherato dal primo, e
   sarebbe uscito con un pacchetto AGGIORNATO. «Non modificabile» vuol dire «non
   si scrive a mano», non «non si scrive»: la data la mette l'app.

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

## La mappa dei luoghi: perché è disegnata e non scaricata (20/09/2026)

Richiesta dell'operatore: «nella scheda luoghi vorrei anche la modalità mappa
zoomabile con i vari impianti, edifici, presidi, in modo che l'utente possa
vedere dove si trova lui e dove sono i presidi (con numero progressivo)».

### Lo sfondo dal satellite: facoltativo, e degrada invece di rompersi (20/09/2026)

L'operatore l'ha chiesto due volte — «non vedo la cartina», poi «non vedo ancora
le immagini del satellite». Aggiunto, **senza toccare la promessa dell'app**:

* le tessere sono `<img>` dentro l'SVG, **non una libreria**: non entrano nel
  bundle, non hanno versioni, non possono rompere l'avvio. «Zero dipendenze»
  parla di librerie, e questa regola resta intera;
* **senza rete non succede niente**: ogni tessera che fallisce si toglie da sé e
  restano griglia, scala, punti e nomi — cioè la mappa di prima. Nessun
  caricamento da aspettare, nessun errore da leggere. È il caso normale in
  cabina, non un guasto;
* c'è un **interruttore** e la scelta si ricorda, per due motivi diversi e
  tutti e due veri: i dati del telefono, e il fatto che chiedere una tessera
  **dice a qualcun altro quale riquadro stai guardando** — su queste
  installazioni non è irrilevante;
* l'attribuzione (Esri, Maxar, Earthstar Geographics) è scritta sotto la mappa
  quando lo sfondo è acceso: è dovuta, e dice all'operatore che quel fondo non è
  un nostro rilievo.

⚠️ **Le tessere sono in Mercatore, questa mappa è equirettangolare locale.** Ogni
tessera si piazza dai suoi DUE angoli convertiti con `inMetri`: dentro una
tessera la differenza fra le due proiezioni è di centimetri. Stirare un'immagine
sola su tutto il riquadro sarebbe stato più semplice e sbagliato di centinaia di
metri ai bordi — **e un fondo spostato non dà nessun errore**: si vede benissimo,
ed è peggio di nessun fondo, perché l'operatore crede che l'estintore sia dietro
quel capannone.

⛔ **Due prove di questo gruppo sono nate CIECHE e lo si è scoperto con la
mutazione**, non rileggendole:

* l'ordine dell'indirizzo è `z/y/x` (ArcGIS: livello/riga/colonna) e l'ago
  cercava `/\d+/\d+/\d+$`, che combacia con tutti e due gli ordini. Invertirlo
  non rompe niente in modo visibile: le immagini arrivano lo stesso, sono di un
  altro posto del mondo;
* il tetto di 36 tessere era provato con un riquadro di mille chilometri su uno
  schermo da 360 px — che ne produce **4**, perché il livello di zoom si adatta
  alla larghezza. L'asserzione era vera per vacuità. Con uno schermo largo il
  tetto morde davvero: senza, 42.

E una prova è nata **rossa su codice giusto**: pretendeva che una tessera fosse
più alta che larga di 1/cos(lat). Falso — Mercatore è conforme, quindi la
risoluzione al suolo è la stessa nelle due direzioni e la tessera è quadrata in
metri. Era la prova a sbagliare, e la tentazione era «correggere» la mappa.

### Di default solo gli impianti, e la posizione si dà in due modi (20/09/2026)

**I livelli sotto l'impianto sono nascosti**, e il motivo è aritmetico prima che
estetico: gli impianti sono **30**, tutto il resto è **1426** fra aree,
ubicazioni e presidi. Alla scala di una provincia non sono «dettaglio in più»:
sono una macchia che copre le trenta cose che si stavano cercando.

Servono **due condizioni insieme**, e nessuna basta: l'operatore accende
`🔎 dettagli`, **e** la barra di scala dice **200 m o meno** — la distanza a cui
«l'estintore è dietro la cabina» comincia a voler dire qualcosa. Quando
l'opzione è accesa e la scala è larga, la mappa lo **scrive**: senza, si accende,
non cambia niente, e si conclude che il pulsante è rotto — peggio di non averlo.
La soglia è in `dettagliVisibili()`, una funzione a sé perché sia misurabile.

**«Correggi la posizione» chiede quale delle due strade**, e non sono una buona
e una di ripiego:

* **il satellite** misura dove sei ADESSO, quindi vale solo se sei sul punto, e
  dentro una cabina spesso non prende affatto;
* **a mano** vale anche da lontano e non misura niente: riconosci il tetto
  giusto sulla fotografia. Sopra un edificio grande è spesso **più preciso** di
  un GPS che rimbalza sulle pareti.

Chi è sul posto sa quale ha in mano. Sceglierlo al posto suo vuol dire, metà
delle volte, dargli lo strumento che lì non funziona.

A mano compare una **croce trascinabile** fino alla conferma (`posizionaAMano`).
Tre cose che sembrano dettagli e non lo sono: la presa del dito è molto più
grande del disegno (una linea di un pixel non si afferra col pollice); le braccia
sono lunghe mezzo schermo (una crocetta piccola si copre col dito **proprio
mentre la si sposta**); e `onFine` riceve `null` sia annullando sia uscendo dalla
mappa, perché chi aspetta deve distinguere «confermato» da «lasciato perdere».

⛔ Confermando, **l'accuratezza GPS si azzera** — quella posizione non è stata
misurata, e lasciarci il ±4 m della lettura di prima la farebbe passare per un
rilievo con una precisione che nessuno ha verificato. E per un impianto **cade il
marchio «ricavata»**: senza quella riga la mappa continuerebbe a disegnarlo
tratteggiato dopo che una persona sul posto l'ha corretto, cioè direbbe «non
fidarti» proprio del punto più affidabile che abbiamo.

⚠️ **Il DOM finto ha imparato tre cose in un giorno** — `setAttributeNS`,
`parentNode` e **gli eventi che portano i dati** (`clientX`, `touches`). Ognuna
delle tre mancanze si è presentata come un difetto del codice: «l'elemento è
rimasto appeso», «il punto confermato è `{lat: null}`». Tutte e tre funzionavano
nel browser. È la regola di questo file, e continua a costare: **quando una prova
col DOM finto dice una cosa impossibile, sospetta il DOM finto prima del codice.**

**Niente tasselli PRECARICATI, e non è una rinuncia: è il vincolo dell'app.** Scudo Campo
non ha dipendenze e deve funzionare **senza rete** — è tutto il suo motivo di
esistere, e in stazione elettrica la rete spesso non c'è. Una mappa a tasselli
scarica immagini da un server a ogni spostamento e a ogni zoom: sul posto
sarebbe un rettangolo grigio, e lo sarebbe **proprio quando serve**. Quindi
`js/mappa.js` disegna un SVG: i punti che conosciamo, su una griglia, con una
**barra di scala in metri** — senza la quale una mappa senza sfondo non dice
nessuna distanza.

**La geometria, in tre righe che sbagliano in silenzio se si toccano**
(`inMetri`):

* i gradi di longitudine si accorciano andando verso i poli, quindi la x porta
  `cos(lat)`: a 43° la differenza è del **26%**, e senza, SUVERETO e SACOI
  distano 719 m invece di ~520 (provato rosso);
* la **y cresce verso il basso**, perché così crescono le coordinate dello
  schermo: `lat0 - lat`, non `lat - lat0`. Invertirlo capovolge la mappa e
  nient'altro — nessun errore, nessun numero sbagliato, solo il nord in basso;
* un solo punto non fa un riquadro: `SPAN_MINIMO_M` evita la divisione per zero
  e lo zoom infinito su chi è solo.

**Il progressivo e non il codice**: sul segnaposto c'è il numero che l'operatore
legge sull'etichetta del presidio, non `ACCIAIOLO-BOXDISTA-…`, che non entra e
non gli dice niente.

⛔ **La mappa dichiara quello che non sa, e oggi è quasi tutto.** Misurato il
20/09/2026: **0 presidi, 0 edifici, 0 locali e 5 impianti su 30** hanno
coordinate. Una mappa che disegnasse solo i cinque punti noti sembrerebbe dire
«ecco dove sono le cose»; questa scrive **«N luoghi non hanno ancora una
posizione»**. È la stessa regola del resto del progetto: quando una fonte tace,
si dichiara il silenzio invece di riempirlo. Il numero cala da sé man mano che
gli operatori rilevano le posizioni sul posto — la mappa è costruita per
crescere, non per essere piena oggi.

### Le posizioni ricavate si vedono per quello che sono

Dal 20/09/2026 gli impianti posizionati sono **23 su 30**: 5 rilevati (pin
dettati dall'operatore) e **18 ricavati** — 6 dalla sottostazione omonima mappata
in OpenStreetMap, 3 dalla sola geocodifica della via. La derivazione regge
perché è stata misurata contro i pin veri: OSM li ritrova a **168-228 m**.

`coordinate_origine` viaggia con l'impianto (`RILIEVO` · `SOTTOSTAZIONE` ·
`INDIRIZZO`) e la mappa la usa: un punto ricavato si disegna **vuoto e
tratteggiato**, e una nota dice quanti sono e che cosa valgono — «portano nella
via giusta, non davanti al cancello». Non è un vezzo grafico: disegnarli identici
insegnerebbe a fidarsi di un punto quanto dell'altro, e la prima volta che uno
dei nove sbaglia si smette di fidarsi anche dei cinque veri.

Gli altri 16 restano **senza posizione, dichiarati uno per uno** nel generatore:
per 10 l'indirizzo porta solo al centro del comune, e un pin nel centro di
Piombino è peggio di nessun pin perché l'operatore ci va. Le decisioni e la
misura stanno nella skill `scudo-seed`.

### Che cosa si è imparato guardandola sul telefono (20/09/2026)

Quattro difetti, tutti invisibili in prova e tutti evidenti in mano:

1. **Il fondo grigio si legge come «non ha caricato».** Senza tessere non c'è
   una cartina da vedere — è il vincolo dell'app — ma un vuoto uniforme fa
   smettere di guardare anche ciò che c'è. Adesso porta una **griglia con il
   passo della barra di scala**: il fondo diventa un righello invece di un
   vuoto, e ogni quadrato vale quello che la barra dichiara. Più il **nord**,
   che senza sfondo è l'unico appiglio per orientarsi.
2. **Le etichette si stampavano una sull'altra** — «SEUVFEROESTAOCCOI»: tre
   impianti a cinquecento metri reali. Due nomi sovrapposti non sono «un po'
   peggio» di due separati: non se ne legge **nessuno**, quindi si perde anche
   l'informazione che c'era. Ogni nome prova quattro posizioni intorno al suo
   punto; se sono tutte occupate **il pallino resta e il nome sparisce**, e
   ingrandendo si separano da sé. Gli impianti hanno precedenza sui presidi: a
   perdere il nome dev'essere il dettaglio, non il contenitore.
3. **Non si poteva rimpicciolire sotto «tutto»**, e i punti agli angoli
   restavano a filo del bordo. Il minimo è sceso a un quarto.
4. **Il tocco portava via di colpo.** Un tocco su una mappa è impreciso per
   natura, e chi tocca un impianto di solito non vuole «i suoi presidi»: vuole
   sapere **dov'è e come arrivarci**, che è la ragione per cui ha aperto la
   mappa. Adesso apre una scheda con indirizzo, coordinate, **da dove viene la
   posizione**, «Naviga fin qui», «Correggi la posizione» e — per ultimo — «Vai
   ai presidi».

⚠️ L'origine della posizione è scritta **a parole** in quella scheda e non solo
col pallino tratteggiato: lì la persona sta per mettersi in macchina, ed è il
momento in cui «rilevata» e «ricavata» contano davvero.

Prove: `scripts/scudo/test_mappa_campo.mjs` (13), che gira **sui dati veri del
pacchetto** e non su un corpus inventato — dove tutti i punti hanno coordinate,
la difesa sul silenzio non è esercitata. Due di quelle prove fissano che ricavato
e rilevato non si disegnano uguali, **con il fratello**: senza posizioni ricavate
la nota non compare, o comparirebbe sempre e smetterebbe di voler dire qualcosa.

## La home: tolto il doppione, tenuto quello che diceva (20/09/2026)

Il blocco **«Le verifiche di questo giro»** in cima è stato tolto. Diceva
fatti, restano e percentuale come «Avanzamento del giro» sessanta pixel più
sotto, e lo diceva per primo e peggio: una barra non porta la percentuale al
centro, che è l'unica cifra che si legge in un colpo d'occhio col telefono in
mano. La riduzione da due schede grandi a una barra, fatta in mattinata, aveva
tolto **inchiostro** al duplicato senza togliere il **duplicato**.

⚠️ Quello che non era un doppione — «su N presidi · M verifiche sono già
scadute» — è **sceso accanto alla ciambella** invece di sparire con il blocco.
È la riga che dice quanto del lavoro è in ritardo, e non compariva in nessun
altro punto della schermata: «restano 1489» non distingue una verifica che scade
fra sei mesi da una scaduta da settembre, e sono le seconde a decidere da dove
si comincia. **Togliere un doppione è una cosa; portarsi via con lui l'unico
dato che portava è un'altra.**

La prova che pretendeva quel blocco è stata **rovesciata**, non cancellata:
adesso pretende che non torni, perché è il genere di blocco che sembra naturale
riaggiungere guardando la schermata da soli.

### «Senza scadenze calcolate»: prima CHE COSA è, poi come si chiama

Segnalazione dell'operatore: «non mostra il tipo, non so se é un estintore, una
luce, e la matricola costruttore».

Su quell'elenco si arriva per decidere che cosa fare, e la prima domanda è
sempre «di che si tratta». Una matricola in cima risponde a «quale», che è la
seconda: finché non sai se è un estintore o una lampada, **«7663» non è
un'informazione, è un numero.** Adesso in testa c'è la categoria **a parole**
(non la sola icona: contro luce due emoji si somigliano), sotto la matricola
**nominata** — «matr. 7663», perché il numero nudo si legge come un progressivo
e i due si cercano in due posti diversi del pezzo — e «senza matricola» quando
non c'è, che su questo elenco è spesso il motivo per cui il presidio è lì.

L'ordinamento segue il tipo: le cose dello stesso genere stanno insieme e si
sbrigano in blocco.

## I piani si LEGGONO senza password, si modificano con (20/09/2026)

Richiesta dell'operatore: «dobbiamo poter vedere la mappatura in
visualizzazione, la password deve essere solo per la modifica; e le varie voci
di verifica andrebbero potute visualizzare, attualmente non le vediamo».

Prima l'intera scheda Piani era chiusa, e la difesa era **sproporzionata alla
cosa difesa**: la password protegge le scadenze di presidi che non si hanno
davanti — cioè il potere di spostare del lavoro su qualcun altro. Sapere che
cosa prevede un piano non sposta niente, ed è quello che l'operatore sta per
fare con il presidio in mano: negarglielo vuol dire fargli eseguire una
checklist che non può leggere per intero.

⚠️ E una porta chiusa su ciò che si può leggere **consuma la password**: insegna
a chiederla per abitudine, e quando serve davvero è già stata data a qualcuno
che voleva solo guardare.

Adesso: catalogo e scheda del piano aperti in lettura; `+ Nuovo piano`,
`Modifica` e «Applica ai presidi» dietro la password. Le **voci di checklist**
si vedono, con il segno ⊙ sulle condizionali — 23 voci del catalogo valgono solo
per certi pezzi, e senza il segno l'elenco promette un lavoro che su quel pezzo
non si fa.

Dalla scheda del presidio, in fondo, **«📋 I piani di questo presidio»**: non è
un doppione di «Esegui i controlli», che mostra ciò che c'è da fare **adesso**.
Questa dice quali piani si applicano e che cosa chiedono, compresi quelli in
regola fino al 2031, e nomina i controlli **senza** piano applicabile con il
motivo — che è la domanda «perché questo presidio non ha una scadenza».

⛔ **La difesa è stata allargata e STRETTA nella stessa modifica**, o allargarla
sarebbe stato toglierla. Il censimento di `test_admin_campo.mjs` ammette ora
`schedaPiano` fra chi può aprire `formPiano`, **e in più** pretende che ogni
chiamata da una vista raggiungibile senza password stia dentro una guardia
(`conAdmin(…)` o `if (ADMIN.sbloccato())`). E la prova che pretendeva la
schermata chiusa è stata **rovesciata**: adesso pretende che da bloccati il
catalogo si veda.

⚠️ **L'ago guarda il COSTRUTTO, non la riga.** La prima stesura leggeva la sola
riga della chiamata e diventava rossa su codice giusto: «+ Nuovo piano» sta
dentro `if (ADMIN.sbloccato()) { … }`, protetto, ma la guardia è due righe
sopra. Si contano le graffe (e le parentesi di `conAdmin(`): un numero di
caratteri non può essere giusto per due blocchi di lunghezza diversa.

**Le modifiche ai piani arrivano in ufficio**, ed è misurato e non dedotto:
`test_azioni_complete` esercita `creaPiano` e `modificaPiano` in campo e ritrova
il piano in archivio **con il nome modificato**, dopo il passaggio di mano. Due
campi che `creaPiano` scrive non sono colonne del pacchetto — `creato_il` e
`device_origine` — ma non si perdono: li porta il giornale, che dal lavoro sulla
staffetta torna indietro intero, e l'autore sta anche in `fonte` («creato in
campo da …»).

### Lo stato nell'elenco: grigio o rosso, non ambra

Correzione dell'operatore lo stesso giorno: «va mostrato in grigio o rosso, le
anomalie le stiamo mostrando in giallo». Aveva ragione, e il modo in cui avevo
sbagliato vale più della correzione: al mattino avevo scelto l'ambra per una
ragione giusta in astratto — «una decisione non è un difetto» — **dimenticando
che l'ambra era già occupata**. Due significati sullo stesso colore non sono
un'ambiguità: sono un colore che non dice più niente.

Adesso **rosso** a chi sospende lo scadenzario (lì non si fanno più verifiche, ed
è la cosa da notare) e **grigio** a chi non lo sospende — «di scorta» è un pezzo
vero con le sue revisioni, e un rosso lo trasformerebbe in un allarme che non è.
La distinzione passa da `sospendeLavoro()`, la stessa funzione del resto.


## Le scadenze che non hanno un presidio (20/09/2026)

Il passo 5 del piano, e il solo che poteva rompere il caso normale.

`Scadenza.asset_id` è **nullabile** e c'è `impianto_id`: una scadenza appartiene
a un presidio **oppure** a un impianto, mai a tutti e due e mai a nessuno — un
`CheckConstraint`, non una convenzione, perché una scadenza senza padrone non
comparirebbe da nessuna parte e una con due comparirebbe due volte, e **nessuno
dei due casi dà un errore**.

Nove obblighi di sito oggi: otto rinnovi di CPI e una prova di evacuazione.
**Cinque CPI sono già scaduti** (il più vecchio dal 2021).

⛔ **L'inquinamento previsto si è presentato**, e vale la pena tenerlo scritto
perché è la forma in cui questa classe di difetti si vede: appena le nove righe
sono entrate nel pacchetto, «verifiche scadute» è passato da **142 a 148**.
Nessun errore, niente di rotto — un numero salito del quattro per cento e ancora
plausibile, dentro cui c'erano cinque certificati di prevenzione incendi, che
non sono verifiche e non li fa l'operatore in giro. `riepilogo()` adesso filtra
`s.asset_id`, e la prova confronta il totale con il conto fatto a mano sulle sole
scadenze di presidio.

⚠️ Tre punti dove lo stesso difetto poteva ripresentarsi, e due si sono
presentati davvero:

1. **L'export del pacchetto** filtrava `s.asset_id not in id_assets`: con
   `asset_id` nullo quella condizione è VERA, e scartava tutte e nove le righe.
   Nessun errore: nove righe che non arrivano sul telefono.
2. **La colonna `ultima_prova_evacuazione`** non era stata scritta in nessuno dei
   due gemelli, quindi la data si perdeva al primo giro e la prova di evacuazione
   spariva. L'ha trovata la prova sul giro completo, contando le righe: 2131 →
   2130. **Una riga su duemila**, e senza quel contatore non l'avrebbe vista
   nessuno.
3. **L'impronta dello scadenzario** era cieca su tutta la famiglia: le righe
   d'impianto hanno `asset_id` vuoto, quindi due impianti con lo stesso obbligo
   alla stessa data producevano due righe identiche. La riga canonica adesso
   porta `impianto_id`.

L'obbligo di sito è una **data sull'impianto**, non un intervento con verbale ed
esito: una prova di evacuazione non ha un pezzo, non ha una checklist da spuntare
e non ha pezzi guasti, e costringerla dentro la macchina degli interventi
vorrebbe dire compilare quattro campi che non significano niente. Il suo verbale
è il rapporto di prova, che sta in `piano_emergenza`.

⚠️ **Due delle tre scadenze non si calcolano**: il CPI e la conformità dicono da
sé quando scadono, e ricalcolarle vorrebbe dire sostituire un documento con
un'aritmetica. Solo la prova di evacuazione è periodica — dodici mesi, DM
02/09/2021.

Migrazione: `_rilassa_scadenze_asset_id` ricostruisce la tabella sui database già
esistenti (SQLite non sa cambiare la nullabilità con un `ALTER`), **copiando le
righe**. Buttarle sarebbe stato vero solo per le `REGOLA`: le `NORMATIVA` — i
piani PFAS — vengono dal seme e su un archivio di produzione sarebbero sparite.

## Anomalie e idoneità: bloccante o no (21/09/2026)

Segnalazione dell'operatore: «molte anomalie possono coesistere con lo stato
idoneo… occorre mettere non idoneo solo quando c'è un problema di funzionamento
che rende il presidio non utilizzabile».

Fino a quel giorno **qualunque** anomalia aperta rifiutava `IDONEO`. Misurato
sulle 212 aperte:

| | quante |
|---|---|
| bloccanti per natura (guasto, scaduto, assente, non a norma, tacitata…) | **123** |
| non bloccanti (box da sostituire, segnaletica, matricola duplicata, «in servizio ma con segnalazione attiva») | **89** |

**87 presidi su 875 avevano SOLO difetti non bloccanti**, e nessuno di loro
poteva essere dichiarato idoneo: un estintore carico e funzionante, con il box
ammaccato, risultava non idoneo. L'unica via d'uscita era **dichiarare risolto
un difetto che c'è ancora**, cioè mentire al registro.

### Due livelli, e l'ordine conta

* `TipoAnomalia.blocca_idoneita` — il **default**, come `sospende_scadenze` sugli
  stati;
* `Anomalia.bloccante` — la **risposta di chi ha il pezzo davanti**, che vince.

Il tipo non può rispondere per tutti i casi che copre: «manca una dotazione» è
il cartello mancante di un estintore (non blocca) e il maniglione di un'uscita di
sicurezza (blocca eccome). Il tipo propone, la persona decide.

⚠️ **Il default è PRUDENTE — bloccante salvo prova contraria — perché l'errore
non è simmetrico.** Dire «non blocca» di un difetto che blocca produce un
presidio dichiarato idoneo su cui qualcuno conterà; dire «blocca» di uno che non
blocca produce una seccatura. Vale anche per il tipo sconosciuto e per il
pacchetto vecchio che non porta la colonna: in dubbio, blocca.

⚠️ **E NON è la gravità.** `gravita_suggerita` dice quanto è urgente riparare,
`blocca_idoneita` se intanto si può usare. Un box da sostituire è MEDIA e non
blocca; una segnalazione tacitata è ALTA e blocca. Riusare la gravità per due
domande è il difetto già corretto due volte qui (`carrellato`, `vita_utile`).

### La domanda si fa UNA VOLTA PER GIRO

Misurato prima di correggere: **403 conferme per 212 anomalie** — ognuna chiesta
1,9 volte in media, fino a 4 sullo stesso presidio, perché le decisioni vivevano
in una mappa locale al modulo che si azzerava a ogni apertura. `confermata_il`
esisteva già, viaggiava nel pacchetto e si vedeva nella scheda: **nessuno la
leggeva**. Adesso `confermataNelGiro()` la legge, e l'anomalia già guardata in
questo giro non si richiede.

⚠️ «In questo giro» e non «oggi»: un giro può durare più giorni, e legarlo alla
data farebbe ricominciare le domande a mezzanotte. Se il giro non è ancora
iniziato non c'è un confine, e allora nessuna conferma vale — si chiede.

### Tre risposte, non due

| risposta | che cosa scrive |
|---|---|
| ✓ Risolta, non c'è più | chiude l'anomalia con il controllo |
| ! C'è ancora, ma si può usare | `confermata_il` + `bloccante = 0` |
| ✕ C'è ancora e impedisce l'uso | `confermata_il` + `bloccante = 1` |

La terza risposta è quella che c'era; la seconda è quella che mancava, e senza
di lei nessuna delle due diceva il vero su un box ammaccato — «risolta» è falso,
«c'è ancora» costringeva a NON IDONEO un estintore che funziona.

⛔ **La regola vive in UN posto** (`anomaliaBlocca`), con i suoi due gemelli in
ufficio e sul server, e i tre restano allineati da `test_idoneo_cross.py`. La
frase che l'operatore legge è la stessa che il server userebbe per rifiutare.

⚠️ **Quattro elenchi di colonne, non due.** Oltre ai due gemelli del pacchetto
ci sono l'export e l'import dell'archivio, ognuno con la sua lista scritta a
mano: `blocca_idoneita` aggiunta solo ai gemelli compariva nell'intestazione del
CSV e restava vuota, e la regola concludeva «blocca» per tutte e 212. L'ha
trovata il conteggio, non il ragionamento.

## Sei correzioni dall'uso sul campo (21/09/2026)

**Il controllo di gruppo compariva sempre.** Serve a un caso preciso — dodici
lampade nello stesso locale, dove farle a una a una sono quarantotto tocchi — e
la condizione era «più di un presidio da fare», quindi compariva sull'elenco
intero: ottocento presidi di dodici tipologie su trenta impianti. Adesso servono
**due condizioni insieme**: un'ubicazione precisa **e** una sola categoria. Senza
la seconda, un locale con tre lampade e un estintore riproporrebbe il problema in
piccolo — il modulo chiede quale PIANO si esegue, e i piani non sono gli stessi.

⚠️ La regola stava dentro `elencoPresidi`, che le prove non costruiscono, e la
mutazione che la toglieva **restava verde**. È diventata
`offriControlloDiGruppo()`, e adesso si esercita.

**I sedici tipi di anomalia sono usciti dal foglio del non idoneo.** Erano
dichiarati facoltativi e si presentavano come sedici pulsanti a tutta larghezza
fra la descrizione e la conferma: **un campo facoltativo che occupa mezzo schermo
si legge come obbligatorio**, e così è stato letto. Restano in «Apri anomalia»,
dove sceglierli è il gesto e non un ostacolo in mezzo a un altro gesto.
⚠️ Nessuna regressione di dati: `tipo_codice` è nullabile e tutti i lettori lo
gestiscono. Il tipo vuoto vale **bloccante**, che è la risposta giusta per
un'anomalia nata da un controllo non idoneo.

**Il passaggio del giro era ambiguo, e il programma si comportava in due modi
senza dirlo.** Misurato: se A **conclude** e poi esporta, B carica un giro
`CONCLUSO` e deve premere «Riapri il controllo» prima di registrare qualunque
cosa; se A **non conclude**, B continua. Quindi la regola è una: **si conclude
solo quando il giro finisce davvero**. Adesso la scheda Dati ha **due strade
dichiarate** — «Passa il giro a un altro operatore» e «Il giro è finito, riporta
in ufficio» — ognuna con il suo effetto scritto sotto, e la seconda esporta
subito dopo aver concluso (un «ricordati di esportare» dato a chi sta chiudendo
l'app è il modo in cui un giorno di lavoro resta su un telefono).

**L'operatore si precompila dall'identità della porta** e non solo dalla
sessione, che è memoria viva e un caricamento può azzerare. La sessione vince
comunque: riscriverci sopra il nome della porta attribuirebbe i controlli a chi
non li ha fatti.

**La ricerca ha la croce per svuotarsi.** `type="search"` la disegna da sé su
alcuni browser e **non su iOS in una PWA installata**, che è dove quest'app vive.

**L'avviso sul lavoro non esportato compare solo a giro CONCLUSO.** Scattava alla
prima registrazione e restava fino all'esportazione, cioè per tutto il giro:
avere lavoro non consegnato mentre si sta lavorando non è un problema, è la
definizione di stare lavorando. ⚠️ **Un avviso sempre acceso non avverte di
niente** — insegna a saltare la fascia in cui un giorno comparirà qualcosa che
conta. A giro concluso invece è il momento esatto: il lavoro è finito e lo vede
solo quel telefono.

## I dati del pezzo in cima alla scheda (21/09/2026)

Richiesta dell'operatore: «quando clicchiamo su un presidio per registrare un
controllo, dovremmo vedere, in alto, i dati del dispositivo così che l'operatore
può verificarne la correttezza; ciò che deve rimanere in fondo (possibilmente
compattato) è la sezione tracciamento; il pulsante "modifica anagrafica" deve
essere vicino a quei dati di riepilogo».

Il primo gesto davanti a un presidio è **confrontare la scheda con la targhetta
che si ha in mano**. Quel confronto stava in fondo, dentro un blocco «Tutti i
dati» che veniva dopo controlli, anomalie e storico — tre schermate di
scorrimento — e comprendeva anche chi aveva creato la riga. Un confronto che
costa tre schermate non si fa, e allora si registra un controllo su un pezzo che
potrebbe non essere quello: è l'errore più caro di tutta l'app, perché produce
un verbale corretto sul pezzo sbagliato.

Adesso la scheda ha tre zone: **quello che chiede un'azione** (idoneità,
anomalie aperte), **chi è questo pezzo** (il riepilogo, con «✎ Modifica
anagrafica» attaccato), **che cosa si fa** (i controlli). Il tracciamento resta
in fondo in un `<details>` chiuso: chi ha creato la riga e quando non serve a chi
sta davanti al pezzo, serve dopo, in ufficio.

* **Il riepilogo sta dopo le anomalie e prima dei controlli**, non prima di
  tutto: il blocco giallo delle anomalie aperte è un allarme con tre azioni
  dentro (decisione del 15/09), e spingerlo sotto venti righe di anagrafica
  sarebbe disfare quella. Sui presidi senza anomalie aperte — la maggioranza —
  il riepilogo è comunque la prima cosa sotto le pastiglie.
* **I campi vuoti portano un trattino** (`vuotiCome`), e solo qui. Un campo che
  sparisce lascia chi cerca la matricola senza sapere se il dato manca o se
  quella riga non esiste per questa tipologia — due cose diverse, e la prima è
  un lavoro da fare. In fondo, invece, i trattini resterebbero rumore.
  ⚠️ Il trattino vale per i campi che si CONFRONTANO con l'etichetta, cioè
  quelli che una persona può compilare: un `modificabile: false` vuoto non è un
  dato mancante, è una nota che non si applica.
* ⛔ **`codice` fuori dal riepilogo.** L'operatore l'ha nominato per primo: «una
  dicitura strana composta da scudo, ovvero ACCIAIOLO-EDIFICIO-NUOVAPAL-REI-01».
  È la chiave interna di Scudo, non è scritta da nessuna parte sul pezzo, e stava
  esattamente dove si cercano il progressivo Terna e la matricola, che invece ci
  sono scritti. Con lei sono sparite anche due righe senza titolo («F12345 · 2019
  · in servizio dal …»): un numero senza il suo nome non si confronta con
  un'etichetta, perché sul pezzo i numeri sono due e si somigliano.
* **Una funzione sola per le due viste** (`vistaCampi` con `solo` / `escludi` /
  `vuotiCome` / `senzaTitoli`). Due viste separate si sarebbero separate anche
  nelle etichette e nel modo di leggere una data, e chi guarda in cima e chi
  guarda in fondo vedrebbe lo stesso dato scritto in due modi.

### I marcatori non sono righe

`data_messa_servizio_derivata` non è un dato: è un segno su
`data_messa_servizio`. Mostrarlo da solo dà **«Messa in servizio derivata: 1»**,
che non dice niente — e in cima sarebbe fra le prime righe che l'operatore legge
su **413 presidi su 875**.

La convenzione era già dichiarata nei metadati
(`backend/app/services/scudo_campi.py`: «la scheda non lo mostra come riga
propria, lo appende al campo di cui parla») e l'ufficio la applicava già.
**Qui non la applicava nessuno**: è la solita forma del difetto — una regola
scritta in un commento, vera da un lato solo, e nessun errore da nessuna parte.

Adesso `notaMarcatore` (`campi.js`) la applica in campo, e l'ufficio è stato
esteso nello stesso modo: `marcatoreDi` (`frontend/src/components/scudo/scudoCampi.js`).

⚠️ **DERIVATA non è DICHIARATA**, e i metadati lo dicono a chiare lettere: una
data derivata è calcolata da un altro dato che la fonte porta (l'anno di
costruzione), una dichiarata è l'affermazione di chi conosce l'impianto e non ha
nessun dato dietro. Una parola sola per le due farebbe sembrare la seconda più
solida di quello che è: in campo si scrive per esteso il testo dei metadati (sul
telefono non c'è un suggerimento al passaggio del mouse), in ufficio restano due
pastiglie con due parole — «ricavato» e «dichiarato».

Prova: `scripts/scudo/test_scheda_presidio.mjs`, sette mutazioni tutte viste
rosse. ⚠️ Il secondo fratello dei marcatori è **costruito** apposta: misurato,
nell'archivio di oggi ogni presidio con una messa in servizio porta uno dei due
marcatori (441 su 441), quindi il caso «nessuna nota» non esiste nei dati veri e
una funzione che annota SEMPRE passerebbe a pieni voti.

## Il registro dell'impianto si compila, non si trascrive (22/09/2026)

Segnalazione dell'operatore: «da Scudo e Scudo Campo quei dati non si aggiornano
facilmente». Due difetti, e il primo è grosso.

* ⛔ **La data della prova di evacuazione non si poteva salvare.** Non era nel
  modulo, e non era nemmeno in `CAMPI_REGISTRO_IMPIANTO`, l'elenco bianco di
  `modificaImpianto`: il quinto elenco su cinque in cui mancava (il modello e i
  due gemelli del pacchetto ce l'avevano). Un elenco bianco **scarta in
  silenzio** — si compila, si salva, nessun errore, e al ricaricamento la
  casella è di nuovo vuota. Adesso c'è in entrambi, e il censimento che
  impedisce al sesto di nascere è
  `scripts/scudo/test_campi_impianto_cross.py`.
* **Le date sono campi data.** Erano sei caselle di testo con scritto «nella
  forma 2021-10-07»: su un telefono, con i guanti, vuol dire digitare dieci
  caratteri nell'ordine giusto e senza nessun controllo — e una data scritta
  storta non produce un errore, produce un adempimento che scade nel giorno
  sbagliato.
  ⚠️ Una riga che in archivio NON ha la forma `AAAA-MM-GG` resta di testo: un
  campo data la mostrerebbe vuota e il salvataggio la cancellerebbe. Succede
  davvero — la SCIA di SUVERETO è «30/06/2015 - Prot 8871».

La scheda dell'impianto mostra anche l'**ultima prova di evacuazione** e non solo
la scadenza che ne discende: chi è sul posto deve poter dire «questa è vecchia»
guardando il giorno in cui è stata fatta.

## L'anomalia si conferma DICENDO se blocca (22/09/2026)

Segnalazione dell'operatore, in due tempi: «quando si riconferma un'anomalia che
è bloccante, o non bloccante, non fa mettere idoneo», e poi — dopo averlo
guardato — «quel box giallo per la conferma anomalia non ci dice se è bloccante
e non ce la fa nemmeno modificare per metterla bloccante o non bloccante (e per
questo non ce lo fa mettere idoneo se è bloccante)».

⛔ **Il difetto era nel riquadro giallo della scheda del presidio.** Il pulsante
era uno solo, «👁 Ancora presente», e chiamava `riconfermaAnomalia(an.id)`
**senza la risposta alla seconda domanda**. Due effetti, ed erano esattamente
quelli segnalati:

1. `bloccante` restava vuoto, quindi valeva il **default del TIPO** — e 123
   anomalie aperte su 212 hanno un tipo che blocca;
2. `confermata_il` veniva scritta lo stesso, e da quel momento la scheda del
   controllo **non faceva più la domanda** («si chiede una volta per giro», la
   correzione del 21/09): la risposta mai data diventava definitiva, e il
   presidio non si poteva più dichiarare idoneo per tutto il giro.

Il secondo punto è la parte che vale la pena ricordare: **due correzioni giuste
prese una per volta si sono sabotate a vicenda.** Chiedere una volta sola per
giro è giusto; rispondere per conto dell'operatore è sbagliato; insieme hanno
prodotto una risposta inventata e irrevocabile.

Adesso:

* nel riquadro giallo ci sono **le due risposte** — «! Si può usare» e «✕
  Impedisce l'uso» — sempre tutte e due premibili, con quella in vigore
  evidenziata: toccare l'altra **corregge**. La pastiglia dice anche che cosa
  comporta («impedisce l'uso: niente IDONEO»), perché «bloccante» è una parola
  nostra;
* nella scheda del controllo le anomalie **già confermate in questo giro non
  spariscono più**: restano in elenco con la risposta segnata, non sono
  obbligatorie (la domanda non si ripete) e si possono correggere. La correzione
  viaggia con il controllo, o resterebbe sullo schermo;
* la decisione del giro si legge in **un posto solo** (`decisioni`, che per le
  già confermate parte dal valore in archivio). Sommare due insiemi — «le nuove
  decise» più «le vecchie come stanno» — era il modo in cui una correzione non
  poteva arrivare.

Prove: `test_giro_presidi.mjs` (le due risposte, l'evidenziazione, il censimento
di `app.js` che pretende il secondo argomento) e `test_controllo_campo.mjs` (la
riga resta, si corregge nei due versi, e la correzione viaggia). Nove mutazioni,
tutte viste rosse.

## L'ubicazione che manca si vede dalla scheda (22/09/2026)

Segnalazione: «quando è già stato messo idoneo o non idoneo su un controllo non
gli fa aggiungere l'ubicazione».

Misurato: il dato si poteva scrivere — `aggiornaAsset` accetta `edificio_id` e
`locale_id` anche su un presidio con un controllo già registrato, provato in
Node — ma l'unica strada era «✎ Modifica anagrafica»: un modulo da venti campi,
in fondo a una scheda lunga, che bisogna sapere che è lì. **Undici presidi su
875** non hanno area o ubicazione.

Adesso la scheda lo **dice**, con un avviso in cima («📍 Manca l'area di questo
presidio») e un pulsante che apre un foglio che chiede **solo quello**. È dove
l'operatore torna appena registrato un controllo, ed è il momento in cui ha
ancora il pezzo davanti e sa dove si trova. Non chiede la password admin:
assegnare un'ubicazione è un dato di campo.

## Un aggiornamento non può cancellare il rilievo (22/09/2026)

Richiesta dell'operatore: «va mandato un aggiornamento che non gli cancelli il
pacchetto». Era già vero — il service worker tocca solo la **Cache Storage**,
cioè i file del programma, mentre il rilievo sta in **IndexedDB** — ma era vero
*per costruzione* e niente lo teneva vero: sarebbe bastata una riga
(`indexedDB.deleteDatabase` in `activate`, «per ripulire») per perdere una
giornata di lavoro premendo «Aggiorna», senza nessun errore.

`check_sw_versione.mjs` adesso lo pretende: `sw.js` non può nominare
`indexedDB`, `deleteDatabase` né `localStorage`, e la pulizia delle cache deve
restare **filtrata** (la cache dei pacchetti condivisi non è versionata e non si
riscarica). Provato rosso.

## Due soglie, non una: il colore e il lavoro (22/09/2026)

Segnalazione dell'operatore: «su alcuni presidi mi viene il comando "fatto"
usabile ancora prima di aver fatto i controlli — solo perché ancora non sono
scaduti — ma se scadono entro 6 mesi dovrebbe dire esegui controllo».

La contraddizione era visibile sulla stessa schermata: la sezione **«Prossimi
controlli (entro 6 mesi)»** esiste dal 17/09, ma `vociDelGiro` — che decide che
cosa è «da fare», quindi il pulsante della riga, i conteggi dell'albero e le
barre — contava solo ciò che il SEMAFORO chiama scaduto o in scadenza, cioè
**60 giorni**. Lo stesso presidio elencava i controlli da anticipare e sopra
offriva «✓ fatto».

Adesso le soglie sono due, dichiarate, e rispondono a due domande diverse:

| costante | domanda | valore |
|---|---|---|
| `SOGLIA_SCADENZA_GIORNI` | «come sta questa scadenza?» — il COLORE | 60 giorni |
| `ORIZZONTE_GIRO_MESI` | «conviene farlo mentre sono qui?» — il LAVORO | 6 mesi |

⛔ **Non si è spostato il semaforo**, ed è la parte da non perdere: quella soglia
è gemella di `scudo_calcoli.py` e muove cruscotti, scadenzario ed estrazioni
dell'ufficio — cioè una cosa che non c'entra con il giro. Una prova pretende che
resti 60 (`test_stato_campo.mjs`), così chi un domani volesse «allargare i sei
mesi» alzando il semaforo se ne accorge prima.

Il numero dei sei mesi vive in `stato.js` e `controllo.js` lo riusa
(`MESI_FRA_UN_GIRO_E_L_ALTRO = S.ORIZZONTE_GIRO_MESI`): due costanti con lo
stesso significato avrebbero ricominciato a divergere: era esattamente questo
difetto.

⚠️ **E una seconda condizione, che non avevo previsto**: un controllo APPENA
ESEGUITO ha la scadenza esattamente a un periodo di distanza, quindi con il solo
orizzonte tornava «da fare» il giorno dopo — su un semestrale, tutto il parco.
L'ha trovato una prova che esisteva già, `test_non_eseguibile_giro.py`, che
difende quella proprietà dal 20/09. La regola completa è: **dentro l'orizzonte e
senza un periodo intero davanti** (`periodoInteroDavanti`).

⛔ E si confrontano DATE, non giorni: sei mesi a partire dal 22 settembre sono
**181 giorni**, mentre «sei mesi» contati a 30,44 giorni l'uno ne fanno 182,6.
Con l'aritmetica approssimata il semestrale appena registrato rientrava nel giro
per un giorno e mezzo di differenza — misurato, non dedotto: la prima stesura
della regola usava i giorni ed è rimasta rossa.

Limite dichiarato: se il pacchetto si rigenera qualche settimana dopo un giro, i
controlli con periodicità ≤ 6 mesi fatti allora tornano fra i «da fare» — hanno
davanti meno di un periodo e scadono prima del giro successivo, quindi per
questa regola sono da anticipare. Nel flusso vero il pacchetto nuovo si genera
per il giro dopo, e lì è la risposta giusta.

Effetto misurato sul pacchetto del 22/09/2026: le voci del giro passano da
**1496 a 1516** (+20) e i presidi con qualcosa da fare restano **871** — cioè su
questi dati cambia poco, perché quasi tutti hanno già qualcosa di scaduto. Cambia
sui presidi come le sirene segnalate, dove l'unico controllo scade fra tre o
quattro mesi: prima dicevano «✓ fatto» senza che nessuno avesse fatto niente.

⚠️ E la frase della sezione «Prossimi controlli» è stata corretta: diceva
«lasciarli non richiede di registrare niente», che da oggi è falso — finché
restano, il presidio resta fra i da controllare.

## Il dato che manca si vede e si scrive da dove serve (22/09/2026)

Segnalazione dell'operatore: «quando manca la data di messa in servizio, il
controllo non lo fa fare ma lo tiene come da fare. Deve essere più chiaro per
l'operatore che deve mettere la data — cliccando sul presidio deve vedere le
verifiche che non possono essere fatte finché non c'è — e deve essere possibile
inserire la data necessaria (messa in servizio, costruzione, dipende cosa serve)
direttamente da lì, senza per forza andare su modifica anagrafica».

Misurato sul pacchetto del 22/09/2026, e sono tre numeri diversi che è facile
confondere:

| | quanti |
|---|---|
| presidi senza messa in servizio, installazione né anno | **434** |
| presidi con almeno una verifica senza scadenza calcolabile | **593** |
| **l'incrocio, cioè quelli a cui l'avviso serve** | **185** (191 verifiche) |

⛔ La domanda non è «manca un dato?» né «questa verifica ha una scadenza?», ma
l'incrocio delle due. Le altre 408 sono tutte SORVEGLIANZA mensile mai eseguita,
dove non c'è nessun dato da chiedere; i 249 che restano hanno la periodicità
calcolata lo stesso dall'anno o dall'installazione. Un avviso acceso su metà del
parco non avverte di niente.

Adesso, quando le due cose valgono insieme, sopra i controlli c'è:

* **che cosa è fermo**, per nome («Prova di autonomia, Fine vita»);
* **perché**, con il messaggio della mancanza;
* **✎ Inserisci la data che manca**, che apre un foglio con le SOLE caselle che
  la sbloccano — le tre date sono alternative e il foglio lo dice: ne basta una,
  la messa in servizio è la più precisa.

⚠️ **E dice il vero su che cosa succede**, che è la parte che si sarebbe
sbagliata volentieri: scrivere la data **non** fa comparire una scadenza in
campo. L'app proietta la prossima SOLO da un'esecuzione (è la regola
dell'ufficio; ricalcolarla da un'ancora vorrebbe dire scrivere qui una seconda
copia di `ancora_di_calcolo`, e due copie divergono). La scadenza la calcola
l'ufficio al rientro. Quello che sblocca subito è **registrare il controllo**: da
lì la prossima si proietta dall'esecuzione, e la verifica esce dalle ferme.

Le due metà sono provate tutte e due in `test_stato_campo.mjs` — «la sola data
non cambia niente qui» e «registrato il controllo la verifica esce dalle ferme»
— e la seconda è nata perché una mutazione (`verificheSenzaScadenza` che ignora
`prossima_calcolata`) restava VERDE: la prima stesura della prova non la
distingueva.

## La mappa: due interruttori, un colore per livello, e il link da mandare (22/09/2026)

Richiesta dell'operatore: «con un toggle dovrebbe essere possibile visualizzare
anche i presidi (cliccabili in modo che mostri un tooltip con i dati in
anagrafica e pulsante per andare al presidio, se scaduto o no, etc), e deve
essere toggabile anche il fatto se sono da controllare o meno. I colori dei
pallini dovrebbero essere diversi a seconda se mostriamo impianti o presidi o
ubicazioni. Deve anche essere possibile copiare il link google map».

* **Due interruttori e non uno.** C'era «dettagli», che accendeva insieme aree,
  ubicazioni e presidi sotto i 200 m di scala. I presidi sono la cosa che si
  CERCA su una mappa; le ubicazioni sono il contenitore. Adesso: `🧯 presidi`
  (vince a qualunque scala — nasconderli «perché sono troppi» vuol dire dire di
  no a una domanda appena fatta) e `🏢 ubicazioni` (che la soglia ce l'ha ancora,
  ed è il motivo per cui è nata: 558 punti coprono i trenta impianti). Il terzo,
  `⚑ solo da controllare`, filtra i presidi con lavoro nel giro.
  La decisione sta in `puntiDaDisegnare`, una funzione a sé: dentro il ciclo di
  disegno non si poteva esercitare.
* **Un colore per livello**, pieno e non solo di bordo: sopra una fotografia dal
  satellite il bianco vince sul bordo e i quattro livelli si leggevano uguali.
  Ambra per «da controllare». E una **legenda** sotto la mappa, perché un colore
  senza legenda non ha un valore.
* **La scheda di un presidio** dice idoneità, stato delle verifiche, quante voci
  restano nel giro, categoria, progressivo, matricola, dove sta e la prossima
  scadenza — e porta alla scheda vera, dove si registra.
* **🔗 Copia il link della mappa**: `navigator.clipboard` dove c'è, e dove non
  c'è (http, browser vecchi) un foglio con il link già pronto da copiare a mano.
  Un pulsante che non fa niente e non lo dice è peggio di uno assente.

⛔ **Un difetto vero trovato guardando la mappa dell'ufficio**: `conPosizione`
accettava `null`. `Number(null)` vale **0**, che è finito e sta dentro i limiti:
875 presidi senza coordinate risultavano «geolocalizzati» a (0, 0) — nel Golfo
di Guinea — e si portavano dietro l'inquadratura di tutta la mappa, che mostrava
il Sahara. In campo non si vedeva perché il CSV manda stringhe vuote; l'API
dell'ufficio manda `null`. Corretto sui due lati e fissato nel confronto.

## Tre correzioni dall'uso, sulla posizione e sulla mappa (22/09/2026)

* **La posizione si salva quando la si salva.** Nel modulo «Modifica
  anagrafica» il pannello del GPS scriveva nel modulo, e il dato arrivava in
  archivio solo premendo «Salva modifiche» in fondo. Prendere una posizione è
  un gesto che si chiude da sé — si guarda la precisione scendere per
  venticinque secondi e si preme «Salva questa posizione» — e chiedere un
  secondo salvataggio in fondo a un modulo lungo vuol dire che una posizione
  presa bene si perde scorrendo. Adesso `bloccoCoordinate` avvisa chi lo usa
  (`onCambio`), e la modifica anagrafica scrive subito i quattro campi.
  ⚠️ È FACOLTATIVO: nella creazione di un presidio il pezzo non esiste ancora, e
  nella scheda del controllo le coordinate viaggiano con il controllo, nella sua
  stessa transazione. Chi non passa `onCambio` si comporta come prima.
* **Gli interruttori della mappa sono CASELLE.** Erano pulsanti che cambiavano
  scritta («🧯 presidi» / «🧯 senza presidi»), e per sapere in che stato fossero
  bisognava leggerli; quattro comandi che si combinano si leggevano come quattro
  azioni invece che come quattro filtri. È la stessa correzione fatta il 16/09
  sui filtri dei presidi.
* **«Dove sono» porta la mappa su di me, e la scala resta quella.** Prima il
  puntino compariva e basta: alla scala di una provincia era un pixel da
  cercare, e alla scala di un sito quasi sempre fuori dal riquadro — cioè il
  pulsante sembrava non fare niente. Cambiare anche lo zoom sarebbe l'errore
  opposto: chi ha inquadrato una cabina sta guardando quella.
  ⚠️ Si centra solo al PRIMO segnale: le letture successive migliorano la
  precisione, e riagganciare la mappa a ogni aggiornamento strapperebbe di mano
  lo spostamento a chi la sta trascinando.

⛔ E la prova di «dove sono» è nata CIECA: la posizione finta era il punto in
mezzo ai due impianti, che sta al centro del riquadro da sé — quindi «sposta la
mappa» e «non spostarla» davano lo stesso risultato e la mutazione restava
verde. Adesso il GPS finto risponde le coordinate di UNO dei due.

## Spostare nell'albero, come cartelle (22/09/2026)

Richiesta dell'operatore: «nella tab albero l'admin deve poter attivare la
modalità drag and drop, così che si possano spostare le aree da un livello a un
altro, da un'ubicazione a un'altra, da un impianto a un altro, come se fossero
cartelle; semplice, intuitivo, anche da mobile, con animazioni; spostando
un'ubicazione, tutti i presidi e le aree sottostanti devono essere spostati;
non deve corrompere i controlli in corso; si devono vedere e spostare anche i
presidi, con la selezione multipla; e oltre al drag and drop anche con i
pulsanti (sposta qui / annulla)».

### Le regole: tre livelli fissi

| che cosa | su un impianto | su un'area | su un'ubicazione |
|---|---|---|---|
| presidio | no: gli serve un'ubicazione | no: gli serve un'ubicazione | **sposta** |
| ubicazione | **diventa area**, se non ha presidi | **sposta**, con i suoi presidi | no: quarto livello |
| area | **sposta**, con tutto dentro | **diventa ubicazione**, se non ha ubicazioni sotto | no: quarto livello |

Più quattro condizioni che valgono sempre: **niente due luoghi con lo stesso
nome sotto lo stesso padre** (senza maiuscole né accenti), **tutto o niente**
(un elemento che non si può spostare ferma tutto lo spostamento, e il giornale
non si muove di un evento), **chi sta dentro un altro scelto viene con lui**, e
gli impianti non si spostano (sono le radici).

Tutte stanno in **`pianoSpostamento`** (`stato.js`), che non scrive niente: la
stessa funzione colora la destinazione sotto il dito, decide dove compare
«⤵ Sposta qui» e rifiuta lo spostamento vero. Tre risposte diverse vorrebbero
dire una destinazione verde che poi non accetta. Misurato: 588 destinazioni in
4 ms, quindi si può chiedere per ogni riga.

### Perché non corrompe niente, una riga per ciascuno

* **controlli, anomalie, scadenze e sostituzioni** si agganciano al presidio per
  `asset_id`, e il presidio non cambia id: lo seguono. `test_azioni_complete`
  lo misura in archivio — un'ubicazione vera con presidi e controlli portata in
  un altro impianto, e i suoi controlli ancora tutti attaccati;
* **l'ufficio** sostituisce l'archivio con il pacchetto al rientro (validato:
  nessun riferimento orfano), e con un giro fuori anagrafica e presidi sono
  bloccati in ufficio (423): nessuno sta cambiando le stesse righe altrove;
* ⛔ **i nomi doppi fanno fallire l'INTERO rientro**: l'archivio ha
  `uq_edificio_denom (impianto_id, denominazione)` e `uq_locale_denom
  (edificio_id, denominazione)`, e il validatore del campo non li guarda. Si
  rifiutano prima, con il nome. Sui dati veri scatta spesso: «Shelter» c'è
  quasi ovunque (area «Shelter» con dentro l'ubicazione «Shelter») — in quel
  caso si spostano i presidi, non la cartella;
* **i nomi di comodo si riscrivono** (`impianto`, `edificio`, `locale` sulle
  righe): l'ufficio li usa come ripiego quando un id manca, e un nome rimasto
  vecchio riaggancerebbe il presidio al posto di prima.

### Il cambio di livello

Aree e ubicazioni stanno in due tabelle (`2-edifici`, `3-locali`): cambiare
livello vuol dire che nasce una riga nell'altra tabella (stesso nome, note,
posizione; il piano di un'ubicazione finisce nelle note, perché le aree non
hanno quella colonna), i presidi si riagganciano, e la riga vecchia si cancella.
Con un **id nuovo**: un presidio porta sia `edificio_id` sia `locale_id`, e lo
stesso id nei due posti si leggerebbe come un'area dentro sé stessa.

⚠️ Una riga nata così **non conta come «creata dall'operatore»**, e nemmeno una
rimessa da un annullamento: `luogoCreatoInCampo` salta i CREATE con
`spostamento`. Altrimenti bastava spostare un luogo dell'ufficio avanti e
indietro per poterlo rinominare o cancellare senza password.

### Annullare

Ogni riga toccata lascia un evento con il `prima` e il `dopo`, e tutti portano lo
stesso `spostamento`: «clicca per annullare» li disfa insieme (`annullaEventi`
riconosce lo spostamento e chiama `annullaSpostamento`), conversioni comprese.
Si rifiuta se nel frattempo qualcuno ha toccato le stesse righe.

### L'interfaccia (`js/sposta.js`)

* **«✋ Sposta…»** accanto a «+ Nuovo impianto», dietro la password admin: è
  una MODALITÀ, non sei comandi in più su ogni riga di un albero di seicento
  luoghi. Si esce con «✓ Fine» o cambiando scheda.
* **i pulsanti**: si spunta (la casella o il nome), e «⤵ Sposta qui» compare
  **solo dove si può**. ⚠️ Non spento con il motivo come «Elimina»: misurato,
  con un'ubicazione scelta erano 587 pulsanti in vista e 486 spenti, e i 101
  che contano sparivano. Il perché di un «no» resta a un gesto (il
  trascinamento lo dice sotto il dito) e la barra della scelta lo spiega —
  anche quando i posti sono zero, che per una scelta mista presidi + luoghi è
  la risposta giusta e va detta;
* **il trascinamento** parte SOLO dalla maniglia ⠿, che ha `touch-action: none`:
  il resto della riga scorre la lista, o un albero lungo non si potrebbe
  scorrere. Sotto i 6 px è un tocco, non un trascinamento. La destinazione
  sotto il dito diventa **verde** (e pulsa) o **rossa**, il fantasma dice «⤵ in
  «Sala»» o il perché no; restandoci sopra 0,7 s una cartella chiusa **si apre
  da sé**; vicino al bordo la lista **scorre da sola** (⚠️ il contenitore che
  scorre è `.vista`, non il documento); un rifiuto **scuote** la riga;
* **si conferma sempre**, con il riassunto a parole: che cosa, dove, quanti
  presidi vengono dentro, chi cambia livello. Un dito sbagliato può muovere
  quaranta presidi. Dopo, il messaggio si annulla con un tocco, e chi è appena
  arrivato **si illumina** nel posto nuovo, con la destinazione aperta;
* **«🧯 mostra i presidi»**: foglie sotto la loro ubicazione (sotto l'area o
  l'impianto quelli che un'ubicazione non ce l'hanno), con il nome che dice
  prima CHE COSA è e poi quale (`presidioInAlbero`).

⛔ Quattro difetti trovati SOLO nel browser vero, con il pacchetto reale (una
pagina di prova che monta `sposta.js` con le funzioni vere di `stato.js`, fuori
dalla porta d'accesso), e ognuno ora ha la sua prova:

1. i presidi si chiamavano **«[object Object]»**: `nomePresidio()` restituisce
   un oggetto, e la prova col DOM finto usava `a.codice` al posto della funzione
   vera. La regola è in `presidioInAlbero`, e la prova la esegue;
2. **la lista saltava sotto il dito**: prendere una riga non scelta la faceva
   diventare la scelta, comparivano i pulsanti e le righe cambiavano altezza.
   Durante il gesto i pulsanti non si toccano; si rimettono in ordine al rilascio;
3. **«1 ubicazione scelto»**, «Viene con loro 1 presidio che ci stanno dentro»:
   l'accordo (area e ubicazione sono femminili);
4. **587 pulsanti in vista**, 486 spenti (sopra).

E uno trovato da una mutazione rimasta verde: il controllo al rilascio in
`lascia` era ridondante con quello di `spostaQui`. Tolto: una porta sola.

Prove: `scripts/scudo/test_sposta_campo.mjs` (21, sui dati veri: regole casella
per casella, effetti, controlli intatti, pacchetto valido e senza doppioni,
annullamento, password senza scorciatoie; e l'interfaccia col DOM finto),
`test_azioni_complete` (gli spostamenti in archivio e nella staffetta),
`test_admin_campo.mjs` (la modalità si accende solo dentro `conAdmin`).

## «Clicca per annullare» mantiene la promessa (23/09/2026)

L'operatore ha segnalato che eliminando un'area o un'ubicazione il messaggio
diceva «(clicca per annullare)» e il tocco rispondeva «Questa modifica non si
annulla da qui». Invece di correggere quel caso solo, sono state **eseguite
tutte** le otto scritture che fanno quella promessa: tre la tradivano —
eliminare un luogo, e assegnare un'ubicazione ai presidi, scegliendone una o
creandola sul momento.

`annullaEventi` adesso sa disfare anche un aggiornamento di presidio (rimette i
campi `prima`), la creazione di un luogo (lo toglie, con i presidi messi dentro
nello stesso gesto che tornano dov'erano) e l'eliminazione di un luogo (lo
rimette). Per quest'ultima l'evento di `eliminaUbicazione` conserva **la riga
intera**: quelli scritti prima portano solo il nome, e rimettere un luogo di cui
si sa solo il nome vorrebbe dire inventarne note, posizione e padre — si rifiuta.

⚠️ **Tutto si controlla prima di disfare qualunque cosa**: se nel frattempo il
luogo creato è stato usato da un altro presidio, o il padre di quello eliminato
non c'è più, non si disfa niente. Un annullamento a metà è peggio di nessuno.

E un luogo rimesso da un annullamento **non conta come creato dall'operatore**:
altrimenti cancellare e annullare aprirebbe una scorciatoia alla password.

`test_annulla_campo.mjs` censisce `app.js`: ogni funzione chiamata dentro un
`muta(…)` con `annullabile: true` deve essere fra quelle che la prova disfa
davvero. Una nona promessa non può nascere rotta.

## La mappa: il presidio si chiama per quello che è, si cerca, ed è la sua emoji (23/09/2026)

Dallo schermo dell'operatore:

* **toccando un presidio, il foglio si intitolava con il codice interno**
  («SUVERETO-STAZIONE-SALAMT1-TARGA_AV-01», che sul campo non si usa). Adesso
  è `nomePresidioMappa`: «🔔 Targa acustico-visiva · UISUV-840 · matr. 7663» —
  che cosa è, poi quale; la matricola è nominata;
* **le righe del foglio erano attaccate** («CategoriaTarga acustico-visiva»):
  etichetta sopra, valore sotto. «Nessuna scadenza calcolata» compariva TRE
  volte (due pastiglie e una riga): la riga c'è solo quando dice una data.
  «Indirizzo» ripeteva le coordinate quando un indirizzo non c'è: compare
  solo se è un indirizzo;
* **una barra di ricerca sopra la mappa**, con la ✕ dei Presidi. Vuota: le
  caselle decidono che cosa si vede. Scrivendo: si vede SOLO ciò che
  corrisponde — progressivo (anche solo il numero), matricola, categoria,
  tipologia, nome del luogo; tutte le parole, in qualunque ordine, senza
  maiuscole né accenti — e **le caselle non contano**: cercare una matricola
  con «presidi» spento e non trovarla direbbe «non c'è» di un pezzo che c'è. La
  mappa inquadra i risultati, dice quanti sono e quanti **non hanno una
  posizione** (oggi quasi tutti i presidi: «è in archivio ma non ha una
  posizione» e «non esiste» sono due risposte diverse), e svuotando torna alla
  vista di prima;
* ⚠️ **il codice interno NON si cerca**: contiene pezzi abbreviati o vecchi dei
  nomi («SALAMT1») e troverebbe presidi per parole che non si leggono da
  nessuna parte;
* ⭐ **si cerca per DOVE sta il presidio** (23/09/2026, dall'operatore: «se
  scrivo "compensatore" dovrebbe mostrarmi tutti i presidi che sono in un'area
  o edificio che si chiama compensatore»): nel `cerca` del presidio entrano i
  NOMI di impianto, area e ubicazione, presi dalle loro righe. Le parole si
  sommano fra nome e luogo («compensatore estintore»). Questo ROVESCIA la regola
  del giorno prima, per cui «suvereto» trovava l'impianto e non i suoi presidi:
  adesso li trova tutti, ed è quello che è stato chiesto. Misurato sul pacchetto
  di SUVERETO: un'area e dodici ubicazioni contengono «compensatore», con **74
  presidi, nessuno ancora con una posizione** — quindi oggi la ricerca risponde
  «74 corrispondono, 0 sulla mappa», e i punti compariranno man mano che si
  rilevano;
* **il presidio è la sua emoji di categoria**, non un pallino verde, su un alone
  bianco che la stacca dal satellite; «da controllare» è un **anello** ambra
  (un disco pieno ne mangiava i colori, visto nel browser); il nome sulla mappa
  è il solo progressivo, senza l'emoji ripetuta;
* **una croce sola**: quella nativa di `type=search` compariva in più della
  nostra su Android e al computer; ora è nascosta (anche nei Presidi). La nostra
  resta perché su iOS in una PWA quella nativa non c'è.

La ricerca e il nome sono **gemelli** con l'ufficio (`mappaGeometria.js`), che ha
la stessa barra, le stesse emoji e la stessa regola — confrontati da
`test_mappa_cross.mjs`.

## Le foto dal satellite: di quando sono, da dove vengono, e la velocità (23/09/2026)

«Le immagini sono troppo vecchie» e «la navigazione è lenta». Misurato prima di
toccare niente.

**Le date** (metadati Esri, per livello):

| impianto | Esri (Vantor) | Regione Toscana |
|---|---|---|
| SUVERETO | 21/08/2021, 46 cm | 2022, 20 cm |
| GROSSETO | 10/05/2022, 50 cm | 2022, 20 cm |
| ACCIAIOLO | 19/04/2023, 31 cm | 2022, 20 cm |
| AREZZO | 04/03/2025, 31 cm | 2022, 20 cm |

Non esiste una fonte GRATUITA e senza chiave più recente dappertutto. La Regione
arriva al 2022 (ha 2016, 2019, 2022 e basta). Si è aggiunta come **seconda fonte,
scelta a mano** (`FONTI_IMMAGINI`, gemella in ufficio), e sotto la mappa si legge
**di quando è la foto** che si sta guardando (`leggiDataFotoEsri`: l'indice
«Wayback» dice il nome del servizio dei metadati attuale, che cambia a ogni
rilascio; poi il risultato del LIVELLO corrente, non il primo della lista).

⚠️ **La licenza delle ortofoto 2022**: sono di AGEA, concesse alla Regione «per
fini istituzionali senza che in alcun modo sia consentito il download delle
immagini», con obbligo di citare *«Ortofoto 2022 copyright AGEA - licenza d'uso
concessa a Regione Toscana con la convenzione del 11/07/2024»* e divieto di
togliere le informazioni di proprietà (le tessere portano la dicitura impressa, e
resta). Quindi: citazione sempre in vista, nessuna copia salvata dall'app, e non
è il predefinito. Se l'uso in un'app aziendale sia coperto va chiesto alla
Regione: non è una decisione del codice.

**La velocità**:
* Esri da `services.arcgisonline.com` invece di `server.`: stesso servizio, stesse
  tessere (verificato byte per byte), mediana **0,53 s contro 1,48 s** su dieci
  tessere alternate;
* **a dito in movimento non si chiedono tessere**: un pizzico attraversa più
  livelli e le chiedeva tutte; si chiedono quando il dito si alza;
* **le tessere di prima restano sotto** finché le nuove non arrivano: prima si
  toglievano subito e restava la griglia grigia a ogni cambio di livello;
* `preconnect` al server delle foto in `index.html`.

⚠️ **Nessuna copia delle tessere per l'uso senza rete**, ed è una scelta: i termini
di Esri lo vietano, la licenza AGEA vieta il download.

## Rinomina, elimina e crea anche nella modalità sposta (23/09/2026)

«Nella modalità sposta dovrebbero esserci anche i pulsanti per rinominare o
eliminare le aree.» Tre icone (＋ ✎ 🗑) sui luoghi, con le funzioni QUELLE
dell'albero normale — stessa password per i luoghi dell'ufficio, cestino spento
con il motivo quando dentro c'è qualcosa. Compaiono quando non c'è niente di
scelto; con una scelta la riga serve a «Sposta qui» (su un telefono le due cose
insieme lasciavano al nome una manciata di pixel).

### Fornitori gratuiti di foto più recenti: la ricerca, misurata (23/09/2026)

Richiesta dell'operatore: «verifica meglio se ci sono fornitori gratuiti di
immagini più recenti». Tutto misurato su Suvereto, non ricordato:

| fonte | più recente | risoluzione | usabile? |
|---|---|---|---|
| Esri World Imagery (in uso) | 21/08/2021 | 46 cm | sì |
| Esri **Clarity** | foto diversa, ma è quella che Esri usava nel **2014-2016** | — | più vecchia |
| Esri **Wayback** (196 rilasci, 11 foto diverse a Suvereto) | 21/08/2021 in tutti i rilasci degli ultimi 3 anni; prima 2021-05, 2018, 2014, 2011 | — | nessuna più nuova |
| Regione Toscana (Geoscopio) | 2022 | 20 cm | sì, con licenza AGEA (sopra) |
| Geoportale Nazionale (PCN) | 2012 | — | più vecchia |
| OpenAerialMap | nessuna immagine entro 5 km da 4 impianti | — | — |
| Sentinel-2 cloudless (EOX) | 2024 | 10 m | **no, per qualità**: la licenza (CC BY-NC-SA) il committente la copre («siamo autorizzati»), ma a 10 m per pixel una stazione è una macchia. Integrata e provata il 23/09/2026, poi tolta: «10 m per pixel è davvero scarsa di qualità… così non è usabile» |
| **Google (Map Tiles API)** | **mostra già la sede nuova di Suvereto** (area sbancata a ovest della stazione, edifici nuovi a sud-est, «Cantiere Ansaldo Energia»), che Esri 2021 e Regione 2022 non hanno | fino a z22 | **sì, con una chiave**: 100.000 tessere al mese gratis, poi 0,18 $ ogni mille; logo Google e copyright del `viewport` sempre in vista; niente uso offline |

Conclusione: **non esiste una fonte gratuita e senza chiave più recente di
quelle che usiamo**. L'unica verificata con la sede nuova di Suvereto è Google,
ed è a chiave: account Google Cloud con fatturazione, chiave limitata ai domini
dell'app. Crearla è un passo di chi ha l'account, non del codice. Le immagini di
Google e Bing prese direttamente, senza la loro API, violano i termini. Bing non
si è potuto guardare dal browser automatico (dominio non permesso).

### Google come fonte di PROVA, senza chiave (23/09/2026, v111)

Decisione del committente, presa sapendo che è fuori dai termini di Google:
«puoi trattarla come fonte di prova senza chiave… l'app è sotto password e a
breve non sarà raggiungibile nemmeno da github pages». Quindi:

* è la **fonte predefinita** (`FONTE_PREDEFINITA`) e il **primo** dei tre
  pulsanti; le tessere vengono da `mt1.google.com/vt/lyrs=s`, l'indirizzo che
  usa Google Maps, non dalla Map Tiles API;
* **lo dice**: «Google · più recente · prova» sul pulsante, «fonte di PROVA
  senza chiave, non per l'uso ufficiale» nella citazione sempre in vista;
* **nessuna data** sotto la foto: Google non la dichiara, e la data di Esri
  sotto una foto di Google sarebbe falsa;
* la scelta si ricorda con una chiave **nuova** (`scudo-campo:mappa-fonte-2`):
  con la vecchia, chi aveva toccato Esri una volta non avrebbe mai visto Google;
* nessuna copia: il service worker non tocca tessere di altri domini.

Verificato nel browser vero: le nove tessere di Suvereto arrivano (256 px
l'una), e si vedono gli edifici nuovi a sud-est e l'area sbancata a nord-ovest,
che Esri 2021 e Regione 2022 non hanno.

⛔ **Prima di un uso ufficiale va sostituita** con la Map Tiles API (chiave,
100.000 tessere al mese gratis, logo Google e copyright del `viewport`) **o
tolta**. L'indirizzo senza chiave può cambiare o essere bloccato senza preavviso:
allora la mappa resta sulla griglia, e Esri e Regione sono a un tocco. Il
comando `curl` con cui si voleva misurarla da terminale è stato bloccato dal
controllo di sicurezza (Referer presentato come quello dell'app): la misura si
fa solo dal browser, con l'intestazione che il browser manda da sé.

### Il contorno di focus sui punti (23/09/2026)

Toccando un'etichetta compariva un ovale blu e bianco enorme: il punto è un
gruppo SVG con `tabindex`, e il contorno di focus del browser si disegna nelle
unità della mappa, cioè in metri. Il censimento degli `stroke-width` non
poteva vederlo (un contorno non è un tratto). `.mappa-punto:focus` lo spegne, e
per la tastiera il pallino prende un bordo blu in pixel.

### Correggere e spostare i punti sulla mappa (23/09/2026, v112)

Richiesta dell'operatore: «metti il pulsante "correggi posizione" anche sui
presidi della mappa, manuale o con gps come per gli impianti… una modalità drag
and drop per presidi, impianti, ubicazioni… quando è attivata si possono
spostare gli elementi sulla mappa e quello gli modifica la posizione salvata».

* **«📍 Correggi la posizione» per OGNI punto**, presidi compresi: le due strade
  (satellite con `posizioneLuogo`, croce con `posizionaSullaMappa`) scrivono il
  presidio con `aggiornaAsset` e il luogo con `modificaUbicazione`. Aree e
  ubicazioni lo avevano già — ma solo quelle CON una posizione compaiono sulla
  mappa: le altre si posizionano dal loro «dove si trova» nell'albero.
* **«✋ sposta i punti»**, spenta di suo: accesa, il dito su un punto prende il
  PUNTO (fuori dai punti si sposta ancora la mappa); lasciato, la posizione si
  salva subito ed è **annullabile dal messaggio**. Sotto 6 px è un tocco e apre
  la scheda; il tocco che il browser manda alla fine del trascinamento no. Se il
  dito esce dalla mappa, o arriva la seconda dita, il punto torna dov'era. I
  campi scritti sono quelli della croce (`campiPosizioneAMano`): precisione e
  data vuote — una posizione a mano non è misurata — e per l'impianto
  `coordinate_origine = RILIEVO`.
* **La memoria della mappa** (`memoriaMappa` in app.js): ogni `muta` ridisegna
  la schermata e ricostruiva la mappa da capo, cioè dopo ogni salvataggio si
  tornava a tutti gli impianti — con il trascinamento sarebbe successo a ogni
  punto. Si ricordano centro (in GRADI: i metri dipendono dal baricentro, che si
  sposta con il punto), scala, ricerca e modalità. E la mappa di prima si
  CHIUDE: prima restava viva, con il GPS di «dove sono» eventualmente acceso.
* **La mappa lavora su COPIE dei punti**: spostandone uno cambiava la posizione
  negli oggetti di chi l'aveva aperta (le prove condividono gli stessi punti
  fra una mappa e l'altra, e se ne sono accorte).
* **Il giornale**: `modificaUbicazione` scrive `{prima, dopo}` come i presidi
  (prima: solo i campi nuovi, e non si poteva annullare). Nel «prima» solo i
  campi che la riga AVEVA. Nel registro modifiche una posizione si legge
  «Posizione salvata», non «rinominata», e l'annullamento «Modifica
  annullata»; corretto anche «Impianto creata/rinominata» al maschile.
* **Pacchetti in corso**: nessuna colonna nuova (`lat`/`lon` c'erano già su
  tutte e quattro le tabelle), quindi `PKG_VERSION` resta. Gli eventi PIATTI già
  nei giornali dei telefoni si leggono ancora nel registro e non si annullano
  (non si inventa il «prima»). L'ufficio conserva il payload come testo e non
  lo interpreta. Provato fino all'archivio dell'ufficio da
  `test_azioni_complete`.
* **Da desktop** la mappa era un quadrato di ~480 px a sinistra: con
  `aspect-ratio`, il `max-height: 60vh` si trasferisce alla LARGHEZZA. Da 720 px
  in su la colonna della mappa prende la larghezza del riquadro (80vh) e sta al
  centro. Misurato nel browser: 618 px su una finestra di 1200, 291 px per lato.

⚠️ **Che cosa il DOM finto non vede**: che il dito su un punto NON sposti anche
la mappa dipende da `stopPropagation` nel `pointerdown` del punto, e il DOM
finto non propaga gli eventi. Verificato nel browser vero con il mouse (il punto
arriva esattamente dove lasciato, la mappa resta ferma). Attenzione misurando
così: lo strumento di automazione del browser usa coordinate SCALATE rispetto ai
pixel CSS (767 → 671); un primo trascinamento «fallito» era partito fuori dal
punto, sulla mappa.

### Lente, versione, messaggi, «Sospesi» (23/09/2026, v113)

* **🔍 La lente del trascinamento.** «Il dito copre dove lo stiamo
  posizionando… sembra che appaia inizialmente ma va via dopo un po'». Quello
  che appariva e spariva era la lente di SELEZIONE DEL TESTO di iOS: il dito
  premeva sul nome del punto. Sulla mappa ora `user-select: none` e
  `-webkit-touch-callout: none`, e c'è una lente nostra: un cerchio
  nell'angolo in alto OPPOSTO al dito, ingrandito `INGRANDIMENTO_LENTE` (4)
  volte con una croce nel punto esatto. Non ridisegna niente: due `<use>`
  puntano al fondo e ai punti di QUESTA mappa (gli id sono per mappa: l'app ne
  costruisce una a ogni ridisegno). Il puntatore si CATTURA sulla mappa al
  primo tocco del punto: il punto sotto il dito si ridisegna a ogni passo, e
  col tocco il browser consegna gli eventi all'elemento su cui il dito si è
  posato. Visto nel browser vero: lente a sinistra con il dito a destra,
  nascosta al rilascio.
* **La versione sotto il titolo** («v.113»), piccola: `mostraVersione` la
  chiede al service worker che ESEGUE, non a una costante. Senza service
  worker (prima apertura) non scrive niente. Misurato: l'intestazione resta
  alta 56 px. ⚠️ L'app vera non si è potuta aprire oltre la porta d'accesso
  (serve la parola d'accesso, che non si digita per conto dell'operatore): la
  misura è sull'intestazione con lo stesso markup e lo stesso CSS.
* **I messaggi non coprono più «Nuova versione»**: la barra, quando compare,
  scrive la sua altezza in `--altezza-aggiornamento`, e la colonna dei
  messaggi sale di tanto; chiusa la barra torna a zero.
* **«Sospesi»**, fra «Fatti» e «Tutti»: i presidi usciti dai «da fare» perché
  un controllo è stato registrato NON ESEGUIBILE. Prima finivano fra i fatti;
  adesso «fatti» sono solo quelli verificati, e da fare + fatti + sospesi =
  tutti. Un sospeso si recupera dalla sua scheda (la voce resta fra quelle da
  eseguire, con Idoneo e Non idoneo premibili) e passa fra i fatti. La barra
  «N di M controllati» e l'avanzamento contano ancora i sospesi come trattati:
  per il giro la voce è chiusa, per il registro no — la distinzione del
  18/09/2026 resta. Su un telefono le quattro voci mettono il numero SOTTO
  l'etichetta (a 375 px «Da fare» andava a capo e la fascia cresceva da 44 a
  62 px; ora 50).

### Luoghi per vista, e «spostare qui?» (23/09/2026, v114)

* **I luoghi dell'elenco seguono la vista del giro.** «Tutti» e «Da fare»
  mostrano anche i luoghi senza presidi con quel filtro (`conVuoti`); «Fatti» e
  «Sospesi» solo quelli che ne contengono — un elenco di luoghi grigi in cui
  non c'è niente di fatto seppellisce la risposta a «dove ho lavorato». In «Da
  fare» un luogo spento può essere VUOTO o FINITO, e diceva «nessun presidio —
  entra per aggiungerne» in tutti e due i casi: adesso un luogo finito dice
  «✓ tutto fatto qui», o «niente da fare qui · N sospesi» se qualcosa è rimasto
  in sospeso, e resta grigio per vederli tutti. Il conteggio che distingue è
  `S.presenzeNeiLuoghi(filtri)`: i presidi di ogni luogo con i filtri ma SENZA
  la vista del giro.
* **Trascinare chiede conferma a ogni rilascio del dito** (al posto di «clicca
  per annullare»): «Spostare «X» qui? · No · Sì, sposta», con
  `chiediConferma` di `ui.js` — un messaggio diverso dagli altri (chiaro, bordo
  blu, due pulsanti) che NON sparisce da solo: un «sì» che scade sarebbe una
  scelta fatta per conto di chi non ha risposto. Finché la domanda è aperta il
  punto resta dove è stato lasciato e gli altri punti non si prendono (una
  domanda alla volta). «No» lo rimette dov'era; lasciare la mappa senza
  rispondere vale «no». Visto nel browser vero, a 375 px: «No» riporta il punto
  esattamente indietro, «Sì» lo salva e il punto resta anche dopo il ridisegno.

### Impianti senza posizione: POPULONIA, e la correzione «in volo» (23/09/2026, v115)

«Sulla mappa manca populonia (forse mancano anche altri impianti). Ci sono
pacchetti in corso: trova una soluzione per fixare in volo senza corromperglieli.»
Misurato: **sei impianti su trenta** senza coordinate (97 presidi), per scelta
del seme (`SENZA_COORDINATE_NOTO`): AREZZO NORD RT, BOLGHERI, CE CORTONA, LAGO,
POPULONIA, ROSIGNANO.

* **POPULONIA** rimisurata ed entrata nel seme (vedi la skill `scudo-seed`).
* **In volo, senza scrivere niente da sola**: l'app porta la stessa posizione in
  `js/posizioni_proposte.js` e la DISEGNA dove il pacchetto tace (tratteggiata,
  come ogni ricavata, su una COPIA della riga). La scheda dice «💡 Posizione
  proposta dall'app, non ancora nel rilievo» con «✓ Conferma questa posizione»:
  solo quel tocco la scrive (`modificaUbicazione`, annullabile), e con il
  pacchetto arriva in ufficio. Perché non una scrittura automatica al
  caricamento: sarebbe una modifica che nessuno ha fatto, conterebbe come
  lavoro non esportato (e bloccherebbe il pacchetto successivo), e in ufficio
  direbbe che l'operatore ha rilevato un punto che non ha mai visto. Perché non
  correggere l'archivio dell'ufficio: al rientro l'anagrafica viene
  SOSTITUITA da quella del pacchetto — e quell'archivio non è nemmeno su
  questa macchina (qui zero giri registrati).
* **Gli altri cinque, per nome**, sotto la mappa: «📍 N impianti non hanno una
  posizione», ognuno con «📍 Dagli una posizione» (satellite o croce). Prima
  c'era solo un numero, e un impianto che manca senza dire quale non si sa di
  doverlo cercare.
* ⚠️ La proposta vale solo dove il pacchetto TACE, e per id E nome: un
  pacchetto futuro che porta già la posizione (dal seme) la ignora.

### Fine vita, nuovo presidio, date a tre menù, il prossimo controllo (23/09/2026, v116)

* **Il FINE VITA non ha un esito.** «Il fine vita, se raggiunto, lo fa
  verificare come idoneo; dovrebbe essere non idoneo, e facile da sostituire.»
  Peggio di quanto sembrava, e misurato: per il calcolo — qui e in ufficio,
  `esecuzioneVale` e la gemella — un esito eseguito fa RIPARTIRE l'orologio.
  Con un «non idoneo» piantato, l'ufficio spostava il fine vita dal 2041-01-01
  al **2044-09-23** (oggi + 18 anni); «idoneo» faceva lo stesso. Adesso:
  `registraIntervento` rifiuta idoneo e non idoneo su `ROTTAMAZIONE`; la riga
  mostra la data e due strade — «🔁 Sostituiscilo adesso» (il cambio pezzo,
  motivo FINE_VITA già scelto) e «Da sostituire al prossimo giro»
  (`fineVitaDaSostituire`: NON_ESEGUITO, che l'orologio non lo tocca, più
  un'anomalia SCADUTO «vita utile superata», che rende il presidio NON IDONEO
  sui due lati senza toccare le regole gemelle dell'idoneità; il presidio
  finisce fra i «Sospesi»). Senza anno di costruzione resta solo «non
  eseguibile». Nessun estintore dell'archivio è oggi oltre il fine vita (il
  primo al 2034): il caso nasce in campo, con un anno scritto sul posto.
* **Nuovo presidio: i motivi del rifiuto, tutti e scritti.** «A volte non gli
  fa inserire nuovi presidi, e non si capisce cosa stia bloccando.» Simulato il
  modulo su tutte le 25 tipologie a campi vuoti: nessun blocco nascosto nei
  campi. Le trappole erano altrove — la tipologia SCRITTA e non toccata (a
  schermo sembra scelta), e un messaggio di pochi secondi con un motivo alla
  volta, senza campo segnato. Adesso: se le lettere dicono una tipologia sola,
  la si sceglie; i motivi stanno tutti in un riquadro rosso sopra «Crea
  presidio», ognuno con «vai al campo».
* **Gli obbligatori alla creazione hanno l'asterisco**, e la regola è
  `S.obbligatoriAllaCreazione`: tipologia, impianto, area, ubicazione; la
  matricola per estintori e porte REI; l'anno di costruzione per l'estintore
  (decide il fine vita); e i campi su cui i PIANI mettono condizioni, ricavati
  dal catalogo — l'estinguente, il serbatoio se è a schiuma, la messa in
  servizio se è a polvere. L'asterisco segue i dati. Vale SOLO alla creazione:
  i presidi dell'archivio hanno lacune a centinaia, e pretenderle a ogni
  modifica bloccherebbe il lavoro.
* **Date con tre menù** (`campoData` in ui.js): giorno, mese, anno invece del
  calendario, nell'anagrafica, nelle date dichiarate del pezzo nuovo, nel
  rientro del muletto e nel registro dell'impianto. Scelto l'anno, giorno e
  mese vuoti diventano 1 e gennaio, visibilmente, e la riga sotto lo dice.
  Restano calendari solo le date già compilate a oggi (quella del controllo,
  della sostituzione), che non chiedono niente.
* **Dopo un controllo si scende al PROSSIMO** (`schedaPresidio(…, { alProssimo
  })`): la scheda si riapre all'altezza della riga del primo controllo che
  manca (`data-codice` su ogni riga), senza aprirlo; se non ne manca nessuno,
  alla sezione dei controlli.
* ⚠️ **Pacchetti in corso**: nessuna colonna nuova, nessun formato nuovo; il
  rifiuto vale solo per le registrazioni NUOVE. Un fine vita registrato con un
  esito prima di oggi resta com'è.

### Anomalie coerenti, e le textarea che apparivano vuote (23/09/2026, v117)

* **Aprire e modificare un'anomalia usano gli STESSI campi** (`campiAnomalia`
  in controllo.js), con le parole della scheda del presidio: descrizione *,
  «Con questo difetto, il presidio si può usare?» * con «! Si può usare / ✕
  Impedisce l'uso» (scritta su `bloccante`, anche all'apertura:
  `apriAnomalia` la accetta ora), gravità, e «Su N pezzi, quanti non
  funzionano?» — la domanda del controllo, SOLO se la riga conta più di un
  pezzo: «pezzi guasti (su 1)» non aveva senso, su un pezzo solo la risposta è
  già «impedisce l'uso». Via dall'apertura i sedici tipi da cliccare (tolti
  dal controllo già il 21/09) e «Aggiorna stato presidio» (il ciclo di vita
  del pezzo sta in «Modifica anagrafica»). In modifica ogni campo parte da
  quello che c'è; all'apertura «si può usare?» non è preselezionato.
* ⛔ **Il difetto dietro «la descrizione non è precompilata»**: `el` scriveva il
  valore come ATTRIBUTO, e su una textarea il browser lo ignora. Il campo
  appariva vuoto — e non solo lì: in «Modifica anagrafica» le note vuote
  risultavano cambiate e **salvare le cancellava** (331 presidi su 875 hanno
  una nota; riprodotto: aprire e salvare senza toccare mandava `{note: ""}`);
  stessa sorte per le note del giro, di un luogo, l'esito di un punto aperto.
  Nessuna prova lo vedeva perché il DOM finto copiava l'attributo nel valore:
  la finzione era più gentile del browser. Corretti tutti e due (`el` e
  `domfinto.mjs`), e verificato nel browser vero che il vecchio modo lasciava
  la textarea vuota.
* **Le note già cancellate si ritrovano**: `S.testiCancellatiPerErrore` legge il
  «prima» nel giornale del telefono, e il Riepilogo mostra «⚠ N note sono
  state cancellate per un difetto dell'app» con il foglio per guardarle e
  rimetterle — col tocco dell'operatore, con una modifica normale che torna in
  ufficio. Solo le note ANCORA vuote; una scritta dopo vince. ⚠️ Recupera i
  PRESIDI; le note dei luoghi scritte prima di oggi avevano un evento senza
  «prima» (vedi v112), e quelle del giro non passano dal giornale.
* Anche «✎ Inserisci la data che manca» ha ora i tre menù.

### Modificare un'anomalia la riconferma; «Apri anomalia» falliva sempre (23/09/2026, v118)

* **Salvare la modifica di un'anomalia che resta aperta vale come riconferma
  di oggi** («dopo che la modifichiamo dovrebbe fare come se l'avessimo
  confermata, altrimenti dobbiamo riconfermarla e non è intuitivo»): chi la
  rilegge e risponde «si può usare?» l'ha guardata. Il foglio lo dice prima del
  salvataggio e mostra «Riconfermata il …»; `riconfermaAnomalia` scrive la
  risposta del foglio, e in questo giro il controllo non la richiede più.
  Chiudendola non si riconferma niente. «Clicca per annullare» disfa tutto
  insieme — modifica, pezzi e riconferma (`test_annulla_campo.mjs`).
* ⛔ **«Apri anomalia senza registrare un controllo» falliva SEMPRE**, trovato
  scrivendo la prova qui sopra: mandava «Di cui guasti» anche a zero, e
  `aggiornaAsset` lo rifiuta («non modificabile»: dall'anagrafica non si tocca).
  E l'anomalia, creata PRIMA del rifiuto, restava in memoria e finiva salvata
  col salvataggio successivo: chi ha riprovato può avere anomalie DOPPIE sullo
  stesso presidio. `quantita_ko` è ora fra i `CAMPI_APP` — i campi che l'app
  scrive da sé — e resta fuori dall'anagrafica. La v117 aveva lo stesso
  rifiuto cambiando i pezzi in «Modifica anomalia».
* ~~Resta un difetto di fondo: `muta` non disfa le scritture fatte prima di
  un'eccezione~~ — **corretto lo stesso giorno, v119**: vedi sotto.

### Un salvataggio è tutto o niente (23/09/2026, v119)

Il difetto che aveva prodotto i doppioni non era di un foglio: era di `muta`,
che eseguiva le scritture senza poterle disfare. Otto salvataggi su diciassette
fanno più di una scrittura; se la seconda falliva, la prima restava in memoria,
il messaggio diceva che non era successo niente, e il salvataggio successivo —
di qualunque cosa — la scriveva.

`S.transazione(fn)`, usata da `muta`: una fotografia PROFONDA di `stato` prima
di `fn`, rimessa se `fn` solleva, con gli indici ricostruiti. È esatta perché
`stato` è l'unico stato del modulo (gli indici sono derivati) e perché `fn` è
sincrona — misurato: nessuna chiamata a `muta` passa una funzione asincrona.
Si rimette DENTRO lo stesso oggetto: chi ha in mano `S.get()` guarda ancora il
rilievo vero. Costo misurato sul pacchetto vero (2,6 MB): 7 ms la copia, 1 ms
gli indici.

⛔ **La fotografia non impedisce mai di salvare.** Se non riesce (un valore che
non si copia, un telefono senza `structuredClone`) si prova con JSON, e se
nemmeno quella riesce si scrive come prima, senza rete: un salvataggio senza
«tutto o niente» è il comportamento di sempre, uno rifiutato per colpa della
rete sarebbe un controllo perso. Se va bene non cambia niente: né il valore
restituito né quello che è stato scritto.

Non tocca il formato del pacchetto né quello che è già salvato sui telefoni;
le anomalie doppie già create dai tentativi falliti restano, e si chiudono a
mano. Prova: `test_transazione_campo.mjs` (sette casi, mutazioni rosse — fra
cui il comportamento di prima, la fotografia superficiale, gli indici non
ricostruiti, e la copia che blocca il salvataggio).

### «Vedi» su un controllo: si registra da lì, e si torna dov'era (23/09/2026, v120)

«Se clicco su Vedi, dovrebbe comunque permetterci di registrare il controllo o
tornare alla schermata precedente senza tornare da capo.» La registrazione si
apriva AL POSTO della scheda del presidio, e l'unica uscita chiudeva tutto:
elenco, e il presidio da ritrovare. Aperta dalla scheda del presidio (la riga
del piano o lo storico, `daPresidio`), adesso:

* «‹ Torna al presidio» — e anche la ✕ o il tocco fuori — riporta alla scheda
  del presidio all'ALTEZZA di quel controllo (`schedaPresidio(…, { allaRiga })`,
  con `data-codice` anche sulle righe compatte);
* se la registrazione è NON ESEGUITA (non accessibile, non si poteva fare) c'è
  «Il controllo va ancora eseguito: registralo adesso» con Idoneo, Non idoneo e
  Verifica non eseguibile — gli stessi della riga; se era eseguita, «↻ Rifai il
  controllo». Il fine vita non ha esiti: da lì si torna e basta.
* Aperta da altrove (il registro delle modifiche) resta com'era.

### Gli stati di un'anomalia a parole (23/09/2026, v121)

«Se vado su anomalie non si capisce cosa significa "in_corso".» I filtri, il
riepilogo «Per stato», l'elenco e la scheda mostravano il CODICE. Adesso le
parole di `STATI_ANOMALIA_A_PAROLE` (giro_presidi.js), in un posto solo:
Aperta (da sistemare, nessuno ci sta ancora lavorando), **In lavorazione**
(qualcuno la sta già sistemando; conta ancora fra le aperte), Chiusa (il
difetto è sistemato), Annullata (non era un difetto, o era registrata per
errore). Sotto i filtri una riga dice che cosa vuol dire ogni stato — su un
telefono non ci sono i suggerimenti al passaggio del mouse — e il riepilogo lo
scrive sotto ogni voce. Solo testo a schermo: i codici nei dati, nel pacchetto
e in ufficio restano quelli. Uno stato nuovo senza parole fa diventare rossa
`test_giro_presidi.mjs`.


### Il presidio sulla mappa, dall'elenco (23/09/2026, v122)

«Quando un presidio ha la geolocalizzazione, nella tab presidi, sotto al
pulsante "da fare" o "esegui controllo" deve esserci il pulsante per vederlo
sulla mappa, senza cambiare scheda… chiudendola dobbiamo restare dove eravamo…
e poter spostarlo con il drag and drop, e vedere dove siamo.»

* La colonna di lato della riga (`.voce-lato`) ha sotto il pulsante del giro
  **🗺 mappa**, solo se il presidio ha una posizione (`conPosizione`).
* Apre `livelloMappa` (mappa.js): un livello a schermo intero **sopra**
  l'elenco, non un foglio — la mappa al tocco apre la scheda del punto, che è un
  foglio, e un foglio solo alla volta l'avrebbe cacciata. L'elenco sotto non si
  tocca: chiudendo (✕, indietro, Escape) si è sulla stessa riga, stesso
  scorrimento. Pila: sopra tabbar (40) e aggiornamento (45), sotto fogli (50/60)
  e messaggi (80), perché «Spostare qui?» è un messaggio.
* Dentro c'è la **stessa** mappa della scheda Mappa: punti da
  `puntiDellaMappa()` e azioni da `azioniDellaMappa()` («dove sono», «✋ sposta i
  punti» con la domanda a ogni rilascio, la scheda al tocco), estratti da
  `pannelloMappa` perché le mappe sono due. Cambia solo da dove parte: memoria
  PROPRIA centrata sul presidio a 80 m (la vista della scheda Mappa non si
  sposta), e `evidenzia`: anello attorno, disegnato sempre (caselle e ricerca
  non lo nascondono), presidi accesi senza scriverlo nella preferenza.
* `disegna()` la rifà dopo ogni salvataggio (`rifaiMappaDelPresidio`): dopo
  «Correggi la posizione» il punto deve stare dove è ora. Cambiare scheda o
  «Apri il presidio» dalla scheda del punto la chiudono.

Nessun dato nuovo, nessuna colonna: gli spostamenti passano dalla stessa
`spostaPuntoSullaMappa` → `muta` → `S.aggiornaAsset` di prima, quindi pacchetti
in corso invariati. Prove in `test_mappa_campo.mjs` (quattro nuove, diciotto
mutazioni tutte rosse). Oggi nel pacchetto corrente nessun presidio ha ancora
una posizione (misurato: 0): il pulsante compare man mano che gliela si dà.

### Da desktop la mappa prende lo schermo (24/09/2026, v123)

«Da desktop la tab mappa e la funzione mappa dovrebbero sfruttare al massimo lo
schermo… entrare tutto in uno schermo verticalmente ma sfruttare lo spazio
orizzontale. Invariato da mobile.»

* **Due colonne** (`.mappa-colonna-mappa`, `.mappa-colonna-comandi`): ricerca e
  mappa a sinistra, comandi, legenda, fonti e note a destra (300 px, scorre da
  sola). Anche l'elenco degli impianti senza posizione ci va, passato come
  `accanto` a `vistaMappa`. Sul telefono le colonne stanno una sotto l'altra,
  **nello stesso ordine di prima**: tutte le regole nuove stanno sotto
  `@media (min-width: 720px)`.
* **L'altezza** del riquadro la misura `adatta()` (mappa.js) dentro l'elemento
  che scorre (`.vista` o il corpo del livello sopra l'elenco): dipende da cosa
  c'è sopra, quindi non si scrive nel CSS. Si rifà al ridimensionamento della
  finestra (ascoltatore tolto in `chiudi()`) e quando compare la nota della
  ricerca. Misurato nel browser: pagina e livello non scorrono.
* **La vista non è più quadrata**: `lato` resta la LARGHEZZA in metri, l'altezza
  è `lato × rapporto()`. «⤢ tutto» e la prima apertura usano `zoomTutto()` —
  il livello che fa stare tutto anche in altezza. ⚠️ La decisione «si parte da
  tutto?» si prende PRIMA del primo `disegna()`, che scrive la memoria: letta
  dopo diceva sempre «c'era già una vista» (visto nel browser: impianti
  tagliati in alto e in basso).
* **Le misure restano in pixel**: pallini al massimo 12 px, la «N», la croce e
  la lente sul lato corto. Prima erano frazioni della larghezza: su 1200 px
  pallini e nomi erano tre volte più grandi. Sul telefono i numeri sono quelli
  di sempre (un quarantesimo).
* **Il righello** sta nella colonna ma misura la MAPPA: larghezza in pixel della
  mappa, passo scelto su quello che entra nella colonna, stesso passo della
  griglia. In percentuale della colonna sarebbe stato sbagliato di 3,5 volte.
* **Le tessere**: il tetto di 36 cresce con il riquadro (una fascia bianca su un
  monitor grande). `tessereVisibili` accetta `alto`, nei due gemelli
  (`frontend/.../mappaGeometria.js` ignora il caso: l'ufficio disegna quadrato).

Solo impaginazione e disegno: nessun dato, nessun pacchetto toccato. Prove in
`test_mappa_campo.mjs` (sei nuove) e `test_mappa_cross.mjs` (la vista larga),
diciotto mutazioni rosse; una verde (una condizione ridondante) tolta.

Nella stessa versione, prima di pubblicare (24/09/2026, dall'operatore):

* **La freccia ‹ in alto nei Presidi sale di un livello di ubicazione**
  (ubicazione → area → impianto → tutti), invece di tornare alla home. Conosceva
  solo i cambi di scheda: scendere in un impianto non crea un'istantanea.
  `livelloSopra(dove)` in `luoghi.js` (pura, provata in `test_luoghi_campo.mjs`,
  coerente con «‹ Su a …» delle briciole); in app.js `saliDiUnLivello()` dalla
  freccia e dal gesto indietro di Android (che rimette la voce consumata), e la
  freccia resta visibile dentro un luogo anche a cronologia vuota. Alla radice
  decide la cronologia, come prima.
* **Comandi allineati**: una riga per muovere la mappa (＋ － tutto, dove sono),
  una griglia a due colonne uguali per le caselle e «sposta i punti», le fonti
  delle immagini una per riga a tutta larghezza. Vale anche sul telefono: è
  quello che è stato chiesto, con la foto dei pulsanti che andavano a capo.
* **Il pizzico ingrandisce la mappa, non la pagina**, attorno alle dita o al
  cursore (`zoomaVerso`). Tre strade fermate: `touchstart`/`touchmove` a due
  dita, gli eventi `gesture*` di iOS Safari, e la rotella — sul trackpad il
  pizzico è una rotella con `ctrlKey`, e la mappa non ascoltava la rotella
  affatto. Un dito solo NON si ferma (i tocchi sui punti devono arrivare).

### Presidi: filtro «sulla mappa / senza posizione» (24/09/2026, v124)

«Nei presidi si possa filtrare solo quelli a cui manca la geolocalizzazione
oppure solo quelli che gli è stata messa (presenti su mappa).» Nel foglio
«Filtri»: **📍 Sulla mappa (N)** e **Senza posizione (M)**, che si escludono
(accenderne una spegne l'altra, anche a vista: il foglio non si ridisegna) e
contano il luogo e le tipologie in cui si è. In `S.cerca` è un valore solo,
`posizione: '' | 'con' | 'senza'`, e la regola è `S.haPosizione`, gemella di
`conPosizione` della mappa (confrontate su tutto il pacchetto in
`test_mappa_campo.mjs`). «Azzera filtri» e il caricamento di un pacchetto la
spengono; «azzera filtri» ora compare anche con il solo «Idonei» acceso.
Chiesta «nella v123», è uscita come **v124**: una versione pubblicata non si
riusa, o i telefoni che l'hanno già non si aggiornano.

### Mappa: chi NON è sulla mappa; il nome dei presidi a parole (24/09/2026, v125)

**Filtro posizione nella mappa delle Ubicazioni.** Sulla mappa si vede solo chi
una posizione ce l'ha, quindi il filtro è un ELENCO (scelto con l'operatore fra
due strade; l'altra, disegnarli sul punto del loro luogo, avrebbe mostrato
posizioni mai rilevate). `senza_posizione.js`, nella colonna accanto alla mappa
(sotto, sul telefono): «Sulla mappa (N) / Senza posizione (M)»; aperto, i tipi
(Tutti · Impianti · Aree · Ubicazioni · Presidi, con i numeri), la ricerca e
«📍 Dagli una posizione» su ogni riga → le due strade di sempre (satellite o a
mano). Sostituisce l'elenco dei soli impianti del 23/09. L'elenco e la mappa si
spartiscono i luoghi (`S.haPosizione`; un impianto con posizione proposta è
sulla mappa). Si ridisegna da sé: scrivendo non si rifà la mappa né si perde il
fuoco. Memoria in `memoriaSenza`.

**A mano, da un pezzo senza posizione**, la croce parte dal luogo più stretto
che la contiene e ce l'ha (ubicazione → area → impianto: `vicino`), e con
`posizionaAMano(..., { avvicina: true })` la mappa ci va alla scala di un sito
(`LATO_POSIZIONA_M` = 300 m) anche se il luogo era già in vista — visto nel
browser: la croce nasceva sull'impianto a 150 km di riquadro. Poi porta in vista
il riquadro e «✓ Conferma qui» (da desktop sta in cima alla colonna, che chi
arriva dall'elenco ha fatto scorrere in fondo). «Correggi la posizione» di un
punto in vista non sposta niente, come prima.

**Il nome dei presidi a parole, mai il codice interno.** «Modifica
SUVERETO-EST-289-982599» → titolo «Modifica · 🧯 Estintore · CO2», sottotitolo
«progressivo UISUV-289 · matricola costruttore 982599». Lo stesso difetto stava
in altri sette punti (anomalie, deroghe, «togli la riga», «Apri la scheda»):
passano tutti da `nomeParlato(a)`. `test_giro_presidi.mjs` rifiuta ogni
`a.codice` a schermo che non sia un ripiego o un ingrediente della ricerca.

### La data inserita in campo fa comparire subito la scadenza (24/09/2026, v126)

«Quando cerco di controllare i rilevatori di idrogeno, o altri tipi che
necessitano di una data di costruzione, la inserisco ma non me la fa
registrare, come se non l'avessi inserita» (UISUV-557, UISUV-558). **La data si
salvava** (misurato: l'anagrafica la porta, l'avviso «senza messa in
servizio…» sparisce). Mancava metà della regola dell'ufficio: in campo la
prossima scadenza si contava solo dall'ultima esecuzione, quindi un controllo
MAI eseguito senza scadenza nel pacchetto restava «da calcolare» fino al
rientro. Il fine vita, che non si esegue, diceva «senza l'anno di costruzione
non si calcola» con l'anno appena scritto, offriva solo «non eseguibile», e il
presidio restava fra i «da fare» per sempre.

* `controlliApplicabili`: senza scadenza nel pacchetto e senza un'esecuzione
  che valga, la scadenza si conta dalla **data di partenza** —
  `CAL.ancoraDiCalcolo(piano.base_calcolo || tc.base_calcolo, …)` +
  periodicità — e porta `scadenza_calcolata: true`. Un'esecuzione vince sempre
  sulla partenza, una scadenza dell'ufficio vince su tutto; niente per i tipi
  con `genera_scadenza = 0`. Solo in memoria: non è una riga del pacchetto,
  l'ufficio la ricalcola al rientro dalla data che viaggia nell'anagrafica.
* `vociDelGiro` tratta la scadenza calcolata come quella dell'ufficio (orizzonte
  del giro): un fine vita fra quattro anni esce dai «da fare».
* La riga dice «Scadenza calcolata qui dalla data del presidio: l'ufficio la
  conferma al rientro». L'elenco dei presidi e lo scadenzario continuano a
  mostrare le scadenze dell'ufficio: la vedono dopo il rientro.
* `dataDelCalendario`, `dateDelPresidio`, `ancoraDiCalcolo` in `calcoli.js` sono
  GEMELLE di `parse_date`, `date_del_presidio`, `ancora_di_calcolo` e le
  confronta `test_calcoli_cross.py` (date scritte in quattro forme, impossibili,
  con orario, anni a due cifre; 180 presidi). Il fine vita si conta dalla
  COSTRUZIONE e non ripiega sulla messa in servizio, come in ufficio.
* ⚠️ Ribalta una decisione del 22/09/2026 fissata in `test_stato_campo.mjs`
  («la data non deve far comparire una scadenza: sarebbe una seconda copia che
  diverge»): la copia c'è, dichiarata e sorvegliata dal confronto incrociato.

### I dati che mancano, nella riga del controllo (24/09/2026, v127)

«I campi da compilare relativi alla data mancante andrebbero messi proprio dove
c'è il controllo da eseguire, sopra "verifica non eseguibile", così l'utente non
cambia scheda: la inserisce, conferma, e poi appaiono idoneo e non idoneo.
Dinamico: uno o più campi a seconda del caso.»

* `controlliApplicabili` dice per ogni controllo **quali** campi gli darebbero
  una scadenza (`dati_per_scadenza`), dalla stessa regola che la calcola: fine
  vita contato dalla COSTRUZIONE → solo l'anno (idrogeno, termici, estintori);
  gli altri → una delle tre date (messa in servizio, installazione, anno); un
  piano che non si sceglie per un dato mancante → quel dato (es. estinguente).
* `rigaPianoDaEseguire(…, { datiMancanti })`: il blocco sta nella riga, sopra
  «Verifica non eseguibile». Sul fine vita prende il posto della frase fissa,
  che diceva «senza l'anno di costruzione» anche su pv-29 (si conta dalla messa
  in servizio). Sui controlli normali idoneo/non idoneo compaiono dopo la data,
  e restano a un tocco con «Non la conosco: registra il controllo lo stesso».
* `bloccoDatiMancanti` (app.js) salva con `muta` e riapre la scheda sulla stessa
  riga; i campi li costruisce `campiDatiMancanti`, condiviso con il foglio «Dati
  che mancano» (che diceva ancora «la calcola l'ufficio al rientro»: corretto).
* ⚠️ Aperta, da decidere con l'operatore: pv-29 «Verifica generale dei
  rivelatori di fumo (12 anni)» è nel catalogo come ROTTAMAZIONE, quindi in
  campo è un fine vita (niente idoneo). La norma però prevede tre strade —
  revisione in fabbrica, sostituzione o prova reale con fuoco — e due su tre
  sono una verifica che fa ripartire i 12 anni.

### La verifica dei 12 anni è una verifica; le voci «solo in certi casi» si salvano (24/09/2026, v128)

Deciso con l'operatore: «la modifica non deve corrompere i pacchetti aperti in
corso, e deve semplificare la gestione sul campo».

* **pv-29** («Verifica generale dei rivelatori di fumo (12 anni)») sta nel
  catalogo sotto ROTTAMAZIONE, ma la UNI 11224 a dodici anni dà tre strade —
  revisione in fabbrica, sostituzione, prova reale con fuoco — e due sono una
  verifica. In campo adesso lo è: idoneo, non idoneo, non eseguibile, e un
  idoneo fa ripartire i 12 anni. Le tre strade valgono «solo in certi casi»;
  resta obbligatoria la voce che dice di sceglierne una (pv-29-a2).
* **Correzioni di campo, non del catalogo** (`PIANI_VERIFICA_NON_FINE_VITA`,
  `VOCI_ALTERNATIVE_DI_CAMPO`, `eFineVita`, `azioniDelPiano` in stato.js): il
  catalogo viaggia nei pacchetti, e quelli già sui telefoni non si rigenerano.
  Nessuna colonna, nessun dato scritto in modo diverso. «Fine vita» si decide
  ora in un posto solo, usato da registrazione, riga, scheda della
  registrazione e dalla domanda sull'anno di costruzione. Quando il catalogo
  verrà corretto (seme + ufficio), queste righe diventano inerti e si tolgono;
  `test_controllo_campo.mjs` diventa rosso se id o testi di pv-29 cambiano.
* **Difetto trovato per strada, vero anche oggi:** la schermata accendeva
  «Idoneo» con le voci «solo in certi casi» non spuntate, e il salvataggio lo
  rifiutava (le voci salvate non portano «obbligatoria», e la regola le legge
  obbligatorie). Misurato su UISUV-480, prova funzionale, 2 condizionali su 9.
  `registraIntervento` rilegge «obbligatoria» dal piano. La regola
  `motivoRifiutoIdoneo` NON cambia: è gemella sui tre lati (`test_idoneo_cross`).
* **Il rientro, provato**: `test_azioni_complete` registra in campo la data di
  messa in servizio, un IDONEO su pv-29 con una sola strada e un IDONEO con le
  condizionali non spuntate; in ufficio arrivano tutti, e la scadenza di pv-29
  riparte da oggi per 144 mesi. L'import non applica la regola di IDONEO alle
  registrazioni di campo e non ha regole sul fine vita (misurato sul codice).

### Il catalogo corretto viaggia nei pacchetti (24/09/2026, v129)

«Non possiamo farlo ora? Il seme non lo useremo più, useremo i pacchetti dal
campo da qui in avanti.» Misurato sul codice: al rientro l'ufficio **sostituisce
tutto il catalogo** con quello del pacchetto (`TABELLE_SOSTITUITE` in
`scudo_campo_service.py`: piani, voci, tipi di controllo). Correggerlo
nell'archivio dell'ufficio non servirebbe — il primo pacchetto di ritorno lo
riscriverebbe — e il seme non si usa più. Il catalogo vero è quello nei
pacchetti, e lì va corretto.

* `datiDaEsportare` esce con le tre strade di pv-29 «solo in certi casi». Solo
  nel FILE: il rilievo in memoria e il giornale non cambiano (altrimenti ogni
  pacchetto caricato nascerebbe con del «lavoro non esportato» e caricarne un
  altro sarebbe bloccato); tutto il resto del catalogo esce identico, e una riga
  già giusta esce com'è. Dopo un giro l'ufficio e il telefono successivo le
  hanno già corrette, e `VOCI_ALTERNATIVE_DI_CAMPO` diventa inerte.
* pv-29 «non fine vita» invece **resta una regola di campo**, per scelta: nel
  catalogo si direbbe solo cambiando il tipo di controllo (ROTTAMAZIONE →
  VERIFICA_GENERALE), e scadenze e controlli sono indicizzati per tipo — la
  storia dei rivelatori andrebbe riscritta, e una verifica dei 12 anni già fatta
  risulterebbe mai eseguita. Da ricordare se un giorno l'ufficio ricalcolasse
  le scadenze di pv-29 con una regola sul fine vita: oggi non ne ha nessuna.
* Il seme resta com'era, di proposito: è ormai solo il dato di partenza delle
  prove, e restando «vecchio» è lui a provare che un pacchetto non corretto si
  corregge al primo rientro (`test_azioni_complete`: seconda mano e ufficio).

### Risposte a colori, nota dell'anomalia separata, «📍 posizione» di lato (24/09/2026, v130)

**Colori.** «Su N pezzi quanti non funzionano»: nessuno verde, alcuni giallo,
tutti rosso; sulle anomalie aperte: risolta verde, c'è ma si usa giallo,
impedisce l'uso rosso (anche «si può usare / impedisce l'uso» nella scheda e
nella modifica). Il colore c'è sempre, tenue; la scelta si riempie, prende un
anello e ✓, le altre si attenuano. Classi `tono-ok|attenzione|ko`; `scelte()`
accetta `tono` per voce.

**La nota dell'operatore, separata dall'elenco delle verifiche.** Un NON IDONEO
accoda alla descrizione «— Verifiche non idonee: …» (campo e ufficio, gemelli),
e la nota scritta a mano ci annegava. **Il formato salvato NON cambia** (pacchetti
in giro, import, archivio): si separa per MOSTRARE, MODIFICARE ed ESTRARRE.
* la nota è ciò che precede il segno; l'elenco NON si spezza sul «;» (20 voci del
  catalogo su 251 lo contengono) ma si legge dalle voci del controllo di
  apertura (`intervento_apertura_id` → `6b-controlli-azioni.csv`), che ne tiene
  la copia di quel giorno: se i piani cambiano, l'elenco resta quello verificato;
* campo: `S.parteNota`, `S.testoAnomalia`/`testoDaVoci`, `S.ricomponiDescrizione`;
  aspetto in `anomalia_testo.js` (nota in evidenza «✍️», elenco in un
  `<details>`; nelle righe-pulsante solo il conteggio). La modifica apre SOLO la
  nota e ricompone la coda byte per byte; con l'elenco la nota è facoltativa;
* ufficio: `scudo_anomalie_testo.py` (gemello, `test_anomalia_testo_cross.py`),
  l'API aggiunge `nota_operatore`, `verifiche_non_idonee`, `verifiche_contate`
  (anomalie e scheda presidio), l'Excel ha le colonne «Nota dell'operatore» e
  «Verifiche non idonee» al posto di «Descrizione», e `TestoAnomalia.js` le
  mostra in Anomalie, scheda anomalia, scheda presidio e form della verifica.
  L'import dei pacchetti non cambia. ⚠️ In ufficio si vede dopo aver rifatto
  l'eseguibile.

**«📍 posizione» al posto della mappa.** Nei Presidi, la colonna di lato ha
`pulsanteMappaOPosizione(tipo, riga, …)`: con la posizione «🗺 mappa», senza
«📍 posizione» (ambra) — su presidi e, con `conLato`, anche sulle righe di
impianti, aree e ubicazioni. «A mano» dai Presidi apre la mappa SOPRA l'elenco
(`mappaSopraElenco`, generalizzata da `mappaDelPresidio`) già sul luogo che
contiene il punto (`posizioneDelContenitore`, estratta da `senza_posizione.js`).

### Anomalia già risposta: un pulsante solo; niente fondo bianco (24/09/2026, v131)

«Dopo che clicchiamo su una delle scelte o la modifichiamo, appare sempre come
se dovessimo farla: serve un unico pulsante che le fa riapparire; solo al
prossimo pacchetto deve riproporle — anche dentro un piano di verifica che
stiamo eseguendo.» Con `S.confermataNelGiro(an)` (vale per il giro; anche
«Modifica» conta, perché dal 23/09 riconferma):
* scheda del presidio (`bloccoAnomalie(…, { giaRisposta })`): le etichette dicono
  la risposta, e al posto di domande, «Risolta…» e «Modifica» c'è «✎ Cambia la
  risposta o modificala», che le riapre;
* controllo (`corpoControlloPiano`): «✓ già risposto in questo giro: …» e «✎ Cambia
  la risposta»; le tre scelte restano nascoste finché non lo si tocca.
Al giro successivo `confermataNelGiro` torna falso e si richiede tutto.
Il bianco dietro «si può usare / impedisce l'uso» era `.anomalia-blocca {
background: #fff }`, del 22/09, quando i pulsanti erano bianchi: tolto.

### Il verbale dei controlli in PDF, da far firmare (24/09/2026, v132)

«Un report PDF da stampare e far firmare alla ditta, con i controlli fatti, gli
esiti e le anomalie; deve far capire quali anomalie sono riconfermate, quali
nuove, ecc.» Dati → «4. Verbale da far firmare» → impianto (uno, o tutti quelli
del giro), «elenca anche le anomalie aperte non riviste», anteprima dei numeri,
«📄 Scarica il PDF» (`scaricaFile`, come il pacchetto: dal telefono si stampa o
si manda dall'anteprima).

* **Contenuto** (`verbale.js`): intestazione (impianto, periodo del giro,
  operatore, matricola, ditta, stampato il, versione, dispositivo); riepilogo;
  1. controlli del giro (data, presidio e ubicazione, piano, esito a parole,
  pezzi guasti, note/motivo); 2. anomalie in quattro gruppi — **nuove** (nate in
  questo giro), **già aperte e riconfermate** (con «modificata in questo giro» se
  il testo è cambiato), **risolte**, **aperte e non riviste** — con «uso» (si può
  usare / impedisce l'uso) e le date; 3. dichiarazione e due riquadri firma
  (ditta, committente). Piè «pagina x di N».
* **Classificazione** (`datiVerbale`, pura): «di questo giro» = da `iniziato_il`
  o, se manca, da `caricato_il` (la regola di `interventoNelGiro`); nuova =
  `registrato_il` dopo il confine; risolta = chiusa con `data_chiusura` dal
  giorno del confine; riconfermata = `confermataNelGiro`; modificata = un evento
  di giornale che cambia qualcosa oltre conferma/stato. Ogni anomalia sta in un
  gruppo solo; quelle chiuse prima del giro non entrano.
* «Nota dell'operatore» solo dove c'è l'elenco delle verifiche (anomalia nata
  da un controllo): le anomalie del censimento hanno un testo che nessun
  operatore ha scritto, e nel documento da firmare chiamarlo così sarebbe falso.
* **Il PDF è scritto a mano** (`pdf.js`, niente librerie): Helvetica e
  Helvetica-Bold standard, codifica WinAnsi (accenti italiani sì; emoji tolte;
  il resto «?»), a capo con le metriche AFM, tabelle che vanno a pagina nuova
  ripetendo l'intestazione, titoli che non restano soli in fondo. Le date con
  il fuso si stampano nell'ora LOCALE (il primo PDF diceva 21:22 alle 23:22).
* **Solo lettura**: niente nel rilievo, nel giornale o nel «lavoro da
  esportare»; nessun pacchetto toccato.
* Prove: `test_verbale_campo.mjs` (classificazione, conteggi, filtro impianto,
  solo lettura, struttura del PDF — xref, startxref, lunghezze, pagine —,
  testo WinAnsi e a capo, ora locale, censimento app/sw); 13 mutazioni rosse.
  La RESA è stata guardata a occhio con due motori (PDFKit di macOS, pagina per
  pagina, e Chrome); il download dal telefono vero no — l'app è dietro password.

### «Senza scadenze calcolate» contava i presidi finiti; il verbale è di sorveglianza (24/09/2026, v133)

**Il conteggio.** «102 senza scadenze calcolate, ma se ne apro una non vedo
problemi» (UISUV-512). Registrare un controllo ASSOLVE la sua scadenza del
pacchetto, e la prossima esiste solo in memoria (`prossima_calcolata`):
`statoControlliDi` guardava solo le scadenze aperte del pacchetto, quindi ogni
presidio controllato per intero diventava «senza». Misurato: 13 → 64 dopo 60
presidi, 51 falsi. Adesso per ogni tipo di controllo vale la scadenza del
pacchetto se è aperta, altrimenti quella calcolata dall'app — esclusi i tipi con
`genera_scadenza = 0` (la sorveglianza), che l'ufficio non conta. I «senza» veri
sono 13: 12 con un dato mancante, 1 senza piano. Costo: `controlliApplicabili`
su 875 presidi, 16-22 ms. Prove in `test_stato_campo.mjs`, con il caso
costruito della sorveglianza (nei dati veri nessun «senza» ne ha una, e la
guardia restava cieca).

**Il verbale è del committente che ha sorvegliato la ditta.** «Verbale di
sorveglianza dei controlli antincendio — eseguiti dalla ditta manutentrice,
redatto dal committente».
* **I sorveglianti sono tutti**, anche dopo una staffetta: si leggono dai dati
  (chi ha registrato ogni controllo, chi ha toccato ogni anomalia), non dalla
  sessione, che conosce solo l'ultima mano. Matricola e tecnici della ditta
  vengono dalla catena delle `consegne` e dalla sessione. Ogni controllo e ogni
  anomalia dicono il loro sorvegliante, e nel riquadro delle firme c'è una riga
  per ciascuno; accanto, «per la ditta manutentrice — per presa visione».
* **La norma sotto ogni controllo**: quella del piano, altrimenti quella del
  tipo. ⛔ La v132 leggeva il piano da `dettaglioIntervento`, che non lo
  restituisce: ogni controllo portava il nome del TIPO e non del piano. L'ha
  trovato la prova della norma («UNI 9994-1» invece di «UNI 9994-1:2024»).
* **Tutti gli impianti in un PDF** («Tutti: un verbale per impianto, in un solo
  PDF», prima scelta del foglio): un verbale per ogni impianto su cui nel giro
  è successo qualcosa (non quelli con sole anomalie mai riviste: nessuno li ha
  sorvegliati). Ognuno parte da una pagina nuova, ha le sue firme e numera le
  sue pagine; il piè dice anche il foglio del file.

Solo lettura, come in v132: nessun pacchetto toccato. Dieci mutazioni rosse
(quattro sul conteggio, sei sul verbale); due erano verdi e hanno avuto la loro
prova (sorveglianza, «pagina x di n» per verbale).

### Il verbale conta i presidi per categoria, e con più impianti ha una pagina generale (25/09/2026, v134)

«Il verbale dovrebbe mostrare anche il totale dei presidi controllati, con
subtotale delle categorie, sia per impianto sia in una pagina generale.»

* **In ogni verbale**, sotto il riquadro dei numeri, «Presidi controllati, per
  categoria»: per categoria i presidi controllati **su** quelli in anagrafica
  («4 di 36»), i pezzi, i controlli con i loro esiti e le anomalie nuove, più la
  riga TOTALE. Le righe sono solo le categorie in cui è successo qualcosa; le
  altre stanno in una riga di testo con quanti presidi hanno — ventidue righe di
  cui diciassette di zeri nascondevano i numeri che contano.
* **Contare**: presidi per ID (dodici lampade uguali nello stesso locale sono
  dodici), pezzi dalla quantità, un controllo per piano (un presidio può averne
  più d'uno, e la nota lo dice). I non previsti e i dismessi (`sospendeLavoro`)
  non sono nel «di N», a meno che siano stati controllati lo stesso.
* **Con più impianti** («Tutti») il PDF comincia con il **riepilogo generale**:
  intestazione del giro, i totali, le categorie sommate su tutti gli impianti e
  una riga per impianto con «verbale dal foglio N». Il riepilogo non ha firme
  (si firmano i verbali) e numera le sue pagine. `riepilogoGenerale` SOMMA quello
  che dicono i verbali: i due livelli non possono divergere. I fogli si contano
  scrivendo prima tutto su documenti di prova.

Prove in `test_verbale_campo.mjs`: i conti per categoria contro un oracolo
scritto nella prova (con un non previsto mai controllato e uno controllato),
le somme della pagina generale, e il «foglio N» che porta davvero alla prima
pagina del verbale di quell'impianto. Dieci mutazioni rosse; due erano verdi —
pezzi e presidi confusi con i controlli — perché nella scena ogni presidio aveva
un pezzo e un controllo: ora c'è un presidio da più pezzi con due controlli.

### Il verbale: ditta dal giro, presidi raggruppati, verifiche previste, frontespizi con l'impianto e i timbri (25/09/2026, v135)

Dall'operatore, cinque richieste in una:

* **La ditta non è più «da indicare a mano».** È «Operatore ditta manutentrice»
  dei dati del controllo (`sessione.operatore_ditta`, nel manifest e nella
  catena delle consegne). Prima si cercava solo sotto il nome dei sorveglianti:
  se il nome non combaciava, niente. Ora prima quelli delle mani di quell'impianto,
  poi tutti quelli scritti nel giro. Se nessuno l'ha scritta, il verbale lo dice e
  dice dove si scrive. Nel riquadro delle firme ogni tecnico ha il suo nome.
* **Un presidio si scrive una volta** (`raggruppaPerPresidio`, `tabellaGruppi`
  in `penna`): a sinistra il presidio con «N controlli», a destra i suoi
  controlli uno sotto l'altro. Un gruppo sta su una pagina se ci sta; più alto
  di una pagina si spezza fra i controlli e la testa si ripete con «(segue)».
* **Le verifiche PREVISTE, ognuna con il suo esito** (`verifichePreviste`), dalle
  voci salvate con il controllo (la copia di quel giorno) o, se non ce ne sono,
  dal piano senza esito. Una voce non spuntata: obbligatoria → «non idonea»;
  «solo se si applica» in un IDONEO → «non si applica»; in un NON idoneo → «non
  spuntata» (il verbale non sceglie al posto di chi c'era); controllo non
  eseguibile → «non eseguita». Nelle anomalie niente più elenco: «nata dal
  controllo non idoneo al punto 1». L'elenco resta solo se quel controllo al
  punto 1 non c'è (un'anomalia di un giro precedente), o si perderebbe.
* **Il frontespizio di ogni verbale** porta i dati dell'impianto
  (`datiImpianto`): indirizzo, posizione con la sua origine, tipologia,
  attività DPR 151, SCIA, CPI con rilascio e scadenza, attestazione di rinnovo,
  datore di lavoro, RSPP, responsabile del registro, piano di emergenza,
  ultima prova di evacuazione. Solo le voci che l'archivio ha.
* **Il frontespizio unico** («Tutti») porta gli impianti con i loro dati e le
  **firme e i timbri delle due parti** per tutti gli impianti elencati. Anche
  ogni verbale ha ora il riquadro del timbro per le due parti.

Prove in `test_verbale_campo.mjs` (14): la ditta con il nome che non combacia e
il fratello senza ditta; il raggruppamento e gli esiti voce per voce contro le
spunte salvate, con una condizionale in un idoneo e in un non idoneo; l'anomalia
che rimanda al punto 1 e il fratello in cui quel controllo non c'è; i dati
dell'impianto contro la sua riga; firme e timbri del frontespizio unico.
Quattordici mutazioni rosse. ⚠️ Due aghi sul testo del PDF erano nati ciechi: il
PDF scrive `(` come `\(`, e un `includes('(… (')` negativo non poteva mai
scattare. Adesso sono espressioni che combaciano con la forma scritta, e la
mutazione che le mette alla prova è rossa.

### Una spunta vuol dire ESEGUITA; l'anomalia la scrive l'operatore; il PDF si chiama con il periodo (25/09/2026, v136)

Dall'operatore: «quando qualcosa non va, il sorvegliante flagga tutti come
negativi e mette la nota, per questione di tempo». Il problema era nel
significato della spunta, non nell'operatore:

* dal 18/09 il contatore diceva «N di M verifiche **idonee**», e dal 20/09 una
  voce senza spunta in un non idoneo finiva nella descrizione come «Verifiche non
  idonee: …». La strada più veloce — nessuna spunta, la nota, non idoneo — era
  anche quella falsa: registrava TUTTE le verifiche come fallite, e il verbale le
  firmava così;
* la regola di IDONEO (gemella su tre lati) le leggeva già come «fatte»: non è
  cambiata di una riga.

Deciso con l'operatore, dopo un'analisi (scartata la variante «quale non va? e
le altre idonee», che faceva leggere un elenco a ogni non idoneo):

* **la spunta = eseguita.** «N di M verifiche eseguite», «Segna tutte le
  verifiche come eseguite»; nel dettaglio di un controllo ✓ eseguita, — vuota;
* **il giudizio è solo l'esito**; con «non idoneo» la **descrizione è sempre
  obbligatoria** e non le si aggiunge niente;
* **una verifica collegata, facoltativa** (`verifica_collegata`): un riquadro
  chiuso «Riguarda una verifica dell'elenco?» con un pulsante per voce (niente
  menù a tendina: regola della schermata). Solo dentro un controllo, una sola, e
  deve essere una delle voci di QUEL controllo (`registraIntervento` e il server
  rifiutano il resto). Il TESTO della voce, copiato: se il piano cambia, resta
  quella di quel giorno;
* **colonna in coda a `5-anomalie.csv`** nei due gemelli, colonna nullable sul
  modello (`allinea_colonne`), letta dall'import, nell'API (`orm_to_dict`), nel
  foglio Anomalie dell'Excel («Verifica collegata») e in `TestoAnomalia.js`;
* **ufficio uguale**: `registra_verifica` non scrive più l'elenco e accetta la
  verifica collegata; `FormVerifica.js` ha il menù (in ufficio la tendina va
  bene: si lavora con il mouse);
* **il verbale**: le voci dicono «eseguita», «non si applica» (condizionale vuota
  in un idoneo), «non spuntata», «non eseguita», e la voce collegata «eseguita —
  difetto segnalato»; l'anomalia dice «Riguarda la verifica: …».

⚠️ **I pacchetti in corso non si toccano.** Nessun dato riscritto. Le voci già
registrate si leggono con il significato nuovo, che è vero anche per loro (idonea
implica fatta; una voce vuota diventa «non spuntata», senza dire «non idonea»).
Le anomalie registrate prima tengono la descrizione con l'elenco, byte per byte,
e il verbale la riporta com'è stata registrata («Voci lasciate senza spunta alla
registrazione, che allora si aggiungevano da sole come «non idonee»»). Colonna
additiva: `PKG_VERSION` resta. Misurato: nell'archivio dell'ufficio e nel
pacchetto di questa macchina le voci salvate sono ZERO — il vecchio significato
vive solo nei telefoni, nel giro in corso.

⚠️ `descrizioneVerificheNonIdonee` e la gemella restano: sono la forma delle
anomalie di prima, che si leggono ancora (`parteNota`, `testoAnomalia`).

**Il PDF si chiama con il PERIODO dei controlli** (`periodoMesi`): «Controlli
antincendio gen-feb 2026 - tutti gli impianti (3).pdf», e il frontespizio unico
è «CONTROLLI ANTINCENDIO GEN-FEB 2026» invece di «riepilogo generale». Il periodo
viene dalle DATE dei controlli, non dal giorno di stampa (un giro di febbraio
stampato a marzo è di febbraio); senza controlli, dall'inizio del giro a oggi.

Prove: `test_controllo_campo` (la spunta registrata com'è, descrizione solo
dell'operatore, obbligatoria, la verifica collegata che viaggia e si toglie),
`test_giro_presidi` (appartenenza, l'anomalia che la porta e la mostra),
`test_verbale_campo` (esiti delle voci, la collegata, l'elenco di prima, il
periodo), `test_scudo_registrazione` (ufficio: niente elenco, collegata,
rifiuti, API ed Excel), `test_azioni_complete` (la colonna arriva in archivio ed
è fra le `RESE_MISURABILI`), `test_manifest_cross` (i due schemi). Venti
mutazioni rosse. Non coperti da prove: `FormVerifica.js` e `TestoAnomalia.js`
dell'ufficio (solo la build); la schermata del non idoneo è stata guardata nel
browser a 375 px.

### Lo spazio occupato, e il salvataggio che dice quando non riesce (25/09/2026, v137)

«Nella pagina dati dovremmo mostrare la dimensione dell'IndexedDB, così che se
è troppo grande lo capiamo, con indicazioni sulla grandezza massima.»

Nella scheda Dati, dentro «Come sono conservati i dati», c'è il riquadro «Spazio
occupato sul dispositivo» (`spazio.js`, misure da `store.misuraSpazio()`):
rilievo salvato e giornale (byte del loro JSON: quello che l'app riscrive a ogni
salvataggio), quanto occupa il sito su disco e il TETTO che il browser
permetterebbe (`navigator.storage.estimate`; se tace lo si dice), se la
conservazione è garantita (`persisted`) e se l'app è aperta come app installata
o come pagina del browser. Un semaforo con la frase che decide, e le indicazioni.

⚠️ **Il tetto non è «il limite vero»** (correzione dell'operatore lo stesso
giorno: «10 GB sono talmente grandi che chiamarlo vero limite sembra
allarmistico oppure è fuorviante»). È per il SITO, non per l'app, e non è
spazio riservato: è quanto il browser lascerebbe usare, sullo stesso disco di
foto e app. Con 8 MB per giro non ci si avvicina; il rischio concreto è il
telefono con la memoria piena. Il riquadro lo dice così, e dice anche che su
iPhone l'app della schermata Home e Safari hanno dati SEPARATI (su Android
l'app installata e Chrome usano gli stessi).

**I numeri di riferimento sono misurati** (e `test_spazio_campo.mjs` rimisura il
primo sul pacchetto vero, così non invecchia in silenzio):

| | misurato |
|---|---|
| rilievo appena caricato (875 presidi) | 2,7 MB |
| ogni controllo registrato, sul pacchetto VERO dell'operatore | ~4,6 KB (5,1 MB a 525 controlli su 1.516) |
| ogni evento del giornale | ~0,5 KB |
| un giro completo (~1.500 controlli) | ~10 MB (la v137 diceva 8: misurato con controlli di prova idonei e senza note) |
| tetto di Chrome per il sito (non riservato) | 10,7 GB |
| copia di emergenza (localStorage, Chrome) | ~5,24 milioni di caratteri |
| su disco, Chrome comprime | 2,6 MB di rilievo → 0,5 MB |

Soglie: sopra il 50% del tetto ambra, dall'80% rosso (una rete, non un'attesa); la copia di
emergenza non è mai verde (non tiene un giro intero); un rilievo oltre tre giri
(24 MB) è ambra — qualcosa cresce e non dovrebbe.

⛔ **Il difetto trovato misurando.** Nella copia di EMERGENZA (quando il database
del browser non c'è) `salvaLocalStorage` ingoiava l'errore di spazio e
`salvaConEvento` rispondeva `ok: true`: con il rilievo che ne occupa già metà
appena caricato, a metà giro l'app avrebbe detto «salvato» su un lavoro rimasto
solo in memoria. Adesso risponde `ok: false`, e `muta`, il caricamento di un
pacchetto e l'esportazione lo dicono in rosso, con che cosa fare.

Prove: `test_spazio_campo.mjs` (soglie con i confini, copia di emergenza,
rilievo anomalo con il fratello, errore di spazio, browser che tace, salvataggio
che non riesce con un localStorage finto con limite, riferimento rimisurato,
censimento). Nove mutazioni rosse. Visto nel browser con IndexedDB vero. Non
vede: l'ingombro vero su disco e che cosa dice Safari.

### La copia di emergenza non è il salvataggio (25/09/2026, v138)

Sull'iPhone di prova, con il pacchetto parziale dell'operatore (a metà giro,
5,1 MB), la v137 diceva in rosso «Un salvataggio non è riuscito per mancanza di
spazio (The quota has been exceeded.). Esporta subito il pacchetto». Il lavoro
era salvato: a non starci più era la **copia di emergenza**.

Come funziona, misurato: all'uscita dall'app (`registraFlush`, su `pagehide` e
`visibilitychange`) il rilievo si scrive DUE volte — in localStorage (sincrono,
copia di emergenza) e nel database IndexedDB. `muta` salva solo nel database. La
copia di emergenza tiene ~5,24 milioni di caratteri: a metà giro il rilievo non
ci sta più, ed è normale.

Il difetto vero era un altro: quando la copia non ci stava, **restava quella
vecchia**, dell'ultima volta che ci stava. Un avvio con il database che non
risponde l'avrebbe caricata come il rilievo di oggi, senza dirlo. Adesso:

* `salvaCopia(d, { secondaria })`: con il database aperto la copia è
  SECONDARIA e, se non ci sta, si **toglie**; quando è l'unica (database assente)
  si tiene quella di prima e si dice che non è salvato;
* l'errore della copia di emergenza è separato da quello del salvataggio
  (`erroreEmergenza`): il riquadro dice «il lavoro è salvato nel database» in
  giallo; il rosso resta per un salvataggio vero non riuscito;
* il riquadro mostra i **caratteri** del rilievo e della copia di emergenza;
* all'avvio, se il database non risponde e non c'è niente da aprire, l'app dice
  di NON caricare pacchetti e di chiuderla e riaprirla: il rilievo è ancora lì.

Misurato in Chrome (il motore dell'Android dell'operatore) con il pacchetto vero
e 1.200 controlli registrati: rilievo di 6,66 milioni di caratteri, salvataggio
nel database riuscito ogni volta in 28-45 ms, copia di emergenza non scritta e
quella vecchia tolta, riletti dal database tutti i 2.309 controlli.

⚠️ Uno strumento sbagliato, trovato per strada: l'ago del censimento cercava la
fine di `registraFlush` da inizio file, e `pagehide` compare prima, in
`sorvegliaIstanze` — fetta vuota, prova rossa su codice giusto. Il primo giro di
mutazioni era stato fatto con la prova già rossa: rifatto con la base verde,
quindici mutazioni rosse.

**v139 (25/09/2026, stesso giorno).** Sull'iPhone di prova, a un terzo di giro, la
riga della copia di emergenza diceva «non ancora scritta» anche con l'app chiusa e
riaperta: l'errore della copia vive in memoria e si perde a ogni apertura, e il
riquadro si disegna quando si apre la scheda. Adesso «non ci sta più» si decide
dai CARATTERI (rilievo oltre ~5 milioni e copia assente), e non è un allarme — da
un terzo di giro in poi è la condizione normale: resta verde e lo dice. Il
riferimento del giro completo è passato a ~10 MB (dal pacchetto vero), e la soglia
del rilievo anomalo a tre giri, 30 MB.

### Anomalie doppie; la frequenza nel verbale (25/09/2026, v140)

Dal verbale dell'operatore: UISUV-701 con «Freccia cartello sbagliata» due volte
fra le nuove, una «si può usare» e una «impedisce l'uso». Il presidio aveva due
piani, entrambi non idonei per lo stesso difetto, e ogni non idoneo apriva
un'anomalia nuova. Due cause, due correzioni:

* **un'anomalia NATA nel giro conta come già vista** (`confermataNelGiro`): prima
  al controllo successivo veniva chiesta di nuovo come se fosse vecchia;
* **«Il difetto è uno di quelli già aperti?»**: nel riquadro del non idoneo, se sul
  presidio ci sono anomalie che ci sono ancora, la risposta è obbligatoria (niente
  preselezionato). «Sì: …» registra il non idoneo SENZA aprire un'anomalia nuova
  (`anomalia_esistente`, controllata in `registraIntervento`: aperta e di questo
  presidio) e la descrizione del controllo la nomina; «No, è un difetto nuovo»
  chiede la descrizione come prima;
* **«⧉ È un doppione…»** nella scheda del presidio, solo con almeno due anomalie
  aperte: annulla (stato ANNULLATA, «Doppione di: …») quella su cui si preme, e si
  può annullare dal messaggio. Serve per i doppioni già registrati: dal telefono
  l'unico modo di toglierli era «risolta», che è falso.

Nel verbale ogni controllo porta la **frequenza** del piano («ogni 6 mesi»),
sotto il nome e prima della norma.

⚠️ Due aghi sbagliati per strada, tutti e due trovati perché la prova diceva una
cosa impossibile: la prova della scheda del controllo era finita DOPO il
riepilogo finale (contava 53 prove invece di 54), e quella del doppione cercava
la riga nel testo di tutta la riga — che contiene, nascosto, il titolo
dell'altra anomalia.

### «Voci lasciate senza spunta», non «verifiche non idonee» (25/09/2026, v141)

Dall'operatore, con due schermate dello stesso controllo del 23/09: la scheda
dell'anomalia diceva «✕ 7 verifiche non idonee», il dettaglio del controllo
«Verifiche eseguite: 0 di 7». Stesso dato, due parole. Il dettaglio era già
aggiornato al significato di v136 (spunta = eseguita); la scheda dell'anomalia,
la sua modifica, l'ufficio (`TestoAnomalia.js`) e l'Excel usavano ancora
l'etichetta di prima, che afferma un giudizio che il dato non contiene: con
qualcosa che non andava l'operatore lasciava tutto vuoto per fare prima.

Adesso l'elenco si chiama dappertutto **«voci lasciate senza spunta»** (come nel
verbale), in grigio e non in rosso, con la riga che dice da dove viene
(`SPIEGA_VOCI_VUOTE`). Il testo salvato nella descrizione NON cambia (resta
«Verifiche non idonee: …», byte per byte): cambia solo come si mostra. La colonna
dell'Excel si chiama «Voci lasciate senza spunta».

### Il verbale per tipo di presidio e per piano: le verifiche una volta sola (25/09/2026, v142)

Dall'operatore: «suddividere i controlli per tipo di presidio; i controlli previsti
con tutte le verifiche una ad una spiegati una sola volta all'inizio di ogni
gruppo; dove è non idoneo riportare la nota dell'anomalia; così passiamo da
centinaia di pagine a un numero molto inferiore».

* **Il punto 1 è per tipo di presidio** (1.1 Estintore — N presidi, M controlli…)
  e, dentro, **per piano**: nome, frequenza, norma e le **verifiche previste
  numerate, una volta sola** (`raggruppaPerCategoriaEPiano`). L'elenco è quello
  del PIANO; una voce salvata con un controllo che nel piano non c'è più si
  accoda, così nessuna voce registrata resta senza numero.
* **Una riga per presidio con solo quello che si discosta**: «tutte eseguite»,
  «non spuntate: n. 2, 5», «nessuna voce spuntata», «difetto sulla n. 3», e per il
  non idoneo **«Anomalia: <nota>»** (quella aperta dal controllo o, con «stesso
  difetto», la descrizione che la nomina), più le note.
* **Misurato**: SUVERETO con 657 controlli, **176 pagine prima, 43 dopo**.
* **Il blocco di un piano non si spezza**: titolo, verifiche, intestazione della
  tabella e la prima riga stanno insieme (nel primo PDF un piano restava in fondo
  alla pagina senza la sua tabella). E `tabella()` non lascia più
  un'intestazione sola in fondo: riserva l'altezza VERA della prima riga (prima
  due righe di testo, 20 punti, contro i 30 e più di una riga vera).
  ⚠️ Questa seconda difesa è ridondante sui dati di prova — la protegge già il
  blocco del piano, e la mutazione che la toglie resta verde — e vale per le
  tabelle delle anomalie e delle categorie, che nessun dato di prova porta in
  fondo alla pagina. Dichiarato, non coperto.

Prove in `test_verbale_campo.mjs`: raggruppamento, voci del piano (con il caso di
un controllo che ne ha salvate meno, senza il quale la mutazione «voci dal primo
controllo» restava verde), numeri delle eccezioni, nota dell'anomalia, e un
verbale GRANDE (tetto di pagine: la v141 lo fa diventare rosso; nessun elenco
senza la sua tabella, controllato per POSIZIONE — contando, una mutazione restava
verde).

### Il progressivo Terna sulle anomalie; le annullate non sono risolte (25/09/2026, v143)

Dal rientro di Serafini (pacchetto MK6S-KVJ1, 759 controlli, 282 anomalie):

* **Il progressivo Terna su ogni anomalia**, «il dato primario»: nel CSV del
  pacchetto (`5-anomalie.csv`, colonna di contesto «Progressivo Terna» in coda,
  nei due gemelli; il campo la scrive all'esportazione dal presidio, così la
  portano anche le anomalie vecchie, e l'import non la legge), nell'Excel
  dell'ufficio (prima del codice interno), nell'elenco e nella scheda delle
  anomalie dell'ufficio (al posto del codice interno), e sul telefono il presidio
  sta sopra l'ubicazione.
* **Un'anomalia ANNULLATA non entra nel verbale.** Finiva fra le «risolte nel
  giro»: il verbale avrebbe firmato come riparati i doppioni annullati.

Il pacchetto di Serafini è stato corretto in ufficio con i moduli dell'app
(script fuori dal repository, rapporto consegnato con il pacchetto): i 25 doppioni
del giro annullati (stesso presidio, stesso giorno, due piani), l'elenco delle
voci non spuntate tolto da 63 descrizioni, i dati del file «SCIA e CPI» sugli
impianti (la scadenza ARPCA nel campo della scadenza del CPI — è quello che genera
l'obbligo di rinnovo — e il resto nelle note, con i valori di prima), 9 aree e 26
ubicazioni doppie unite, dopo conferma. Controlli, voci, scadenze e giornale
identici; stesso manifest, quindi stesso giro e stessa catena delle mani; nessun
evento di giornale (sono correzioni d'ufficio, non azioni di un sorvegliante).
Letto dalla v142 e dalla v143, importato in un archivio di prova.

### Chi firma il verbale; la posizione nell'albero; le note dei luoghi; il fuoco fra un foglio e l'altro (25/09/2026, v144)

* **Chi firma, prima di scaricare** («deve chiederci di modificare i sorveglianti,
  rimuoverne, aggiungerne, o anche gli operatori della ditta»). Nel foglio del
  verbale, «Chi firma»: sorveglianti (nome e matricola) e tecnici della ditta
  proposti dai dati, da correggere, togliere (resta in vista, barrato, con
  «Rimetti») o aggiungere. Vale per QUEL PDF: i dati del giro non cambiano.
  Regola pura in `verbale.js` (`firmatariProposti`, `applicaFirmatari`); foglio in
  `firmatari.js`. Un nome CORRETTO si corregge anche nelle righe dei controlli e
  nelle anomalie (è la stessa persona scritta male); uno TOLTO esce solo dalle
  firme — le righe continuano a dire chi ha registrato; uno AGGIUNTO firma in
  ogni verbale del documento, con zero controlli. Le correzioni sono legate al
  nome com'è nei dati, non alla posizione: cambiando «Quali verbali» restano
  sulla persona giusta. Il campo aggiunto prende il fuoco (visto nel browser:
  senza, quello che si digitava non andava da nessuna parte).
* **La posizione nell'albero dei Luoghi** («coerente con come funziona su
  presidi»): ogni area e ubicazione ha il pulsante dei Presidi — «🗺 mappa» se ha
  una posizione, «📍 posizione» se no (`bottonePosizione` in `nodoAlbero`, lo
  costruisce `app.js`). Per l'IMPIANTO stesso aspetto, ma apre «Dove si trova»,
  dove c'è il suo registro antincendio: con la mappa, un impianto senza posizione
  non avrebbe più avuto strada verso il registro. Ogni nodo dice anche quanti dei
  suoi presidi sono sulla mappa («🗺 3 di 12», «tutti», «📍 nessuno»), con
  `haPosizione`, la regola del filtro dei Presidi. «Dove si trova» ha ora anche
  «🗺 Vedi sulla mappa» e «✎ Rinomina».
* **Le note di area e ubicazione nei Presidi**: entrando in un luogo, sotto il
  percorso (`noteDelPercorso`, `riquadroNoteDelPercorso` in `luoghi.js`). Non
  quelle dell'impianto (sono il registro, che ha il suo foglio) e non durante una
  ricerca.
* **Cambiando scheda si esce da «sposta i punti»** della mappa (`lasciaLaVista`,
  e «indietro» verso un'altra scheda in `ripristina`).
* **Rinominare un'area «non diventa cliccabile»**: NON riprodotto. Nel browser da
  scrivania i tre percorsi (albero, Presidi, modalità sposta) funzionano, con lo
  sblocco admin impostato nella scheda di prova. Il giornale del telefono dice
  che sulle cinque aree di ACCIAIOLO è stata salvata solo la posizione. Ipotesi:
  su iPhone il campo della password, tolto dalla pagina mentre ha il fuoco, lascia
  la tastiera in uno stato da cui il campo del foglio dopo non si attiva.
  `lasciaIlFuoco` (`ui.js`) toglie il fuoco prima di chiudere o svuotare un
  foglio. Non provato sul telefono: da riprovare.

### La posizione anche in «Sposta»; creando un luogo, satellite O a mano (25/09/2026, v145)

* **Modalità «Sposta»**: ogni luogo ha la sua icona di posizione accanto a ＋ ✎ 🗑
  — 🗺 se ce l'ha (apre la mappa), 📍 in ambra se no (chiede come darla). Il gesto
  è QUELLO dell'albero e dei Presidi: `gestoPosizione` / `gestoDelNodo` in
  `app.js`, un posto solo per le tre facce (pulsante dei Presidi, pulsante
  dell'albero, icona di «Sposta»), passato a `sposta.js` come `azioni.posizione`.
  Anche nell'albero normale «📍 posizione» è ora ambra, come nei Presidi.
* **Creando o rinominando un impianto, un'area o un'ubicazione** il pannello della
  posizione ha le due strade di «Correggi la posizione»: «🛰 Con il satellite» e
  «✛ A mano, sulla mappa» (`aMano` di `bloccoCoordinate`; senza, il pannello è
  quello di prima — creazione di un presidio, controllo). La mappa sta SOTTO i
  fogli: il modulo si chiude ricordando quello che è scritto (la `bozza` di
  `formUbicazione`), si mette la croce (`posizionaPerIlModulo`, sulla mappa a
  schermo o su quella sopra l'elenco, che si richiude), e il modulo si riapre con
  la posizione, ancora da salvare. La croce parte dal luogo che conterrà quello
  nuovo. Provato nel browser fino al salvataggio.
* Una posizione messa **a mano** alla creazione non riceve più la data «rilevata
  il» (`posizioneDa` la riempie solo se c'è un'accuratezza): era già così
  correggendo con la croce un luogo esistente.
* Un **impianto** riposizionato dal modulo diventa `coordinate_origine = RILIEVO`,
  come con la croce: altrimenti la mappa lo disegnava ancora «ricavato».

### «Sposta» di nuovo usabile dal telefono; ogni livello ha il suo sfondo (26/09/2026, v146)

* Dalla schermata dell'operatore: con la quarta icona (la posizione, v145) al nome
  restavano tre lettere, e andava a capo una sillaba per riga. La riga di «Sposta»
  adesso **va a capo**: sotto i 560 px le icone (e «Sposta qui») hanno una riga
  loro, a destra; il nome resta nella sua colonna (`flex: 1 1 0`) e va a capo fra
  le parole. ⚠️ Queste regole stanno IN FONDO alla sezione di «Sposta»: scritte
  prima delle regole di base di nome e icone, non si applicavano (misurato nel
  browser: `flex-basis: auto`).
* **Ogni livello si riconosce senza leggere**, in «Sposta» e nell'albero normale:
  impianto la fascia più scura, area grigio chiaro con una barra scura a sinistra,
  ubicazione bianca con una barra chiara, presidio più piccolo e tenue. Solo
  grigi: il blu è della scelta e dei «previsti», il verde e il rosso della
  destinazione, l'ambra di ciò che manca — e vincono loro (le regole dei livelli
  stanno prima; il «previsto» ha la specificità per battere quella dell'impianto).
* ⚠️ **Provando in locale, il service worker serve il CSS vecchio**: la pagina lo
  registra di nuovo a ogni apertura, e con `VERSIONE` invariata la sua cache non
  si rinnova. Prima di guardare una modifica: toglierlo (`getRegistrations` →
  `unregister`) e svuotare `caches`, poi ricaricare. Misurato il 26/09/2026:
  tre tentativi di «il CSS non si applica» erano la cache del service worker.

### La posizione anche sui presidi di «Sposta»; il nome della categoria dal catalogo (26/09/2026, v147)

* Dalla schermata dell'operatore: nella modalità «Sposta», con «mostra i presidi»,
  le righe dei PRESIDI non avevano l'icona della posizione. Adesso ce l'hanno — 🗺
  se il presidio ha una posizione, 📍 in ambra se no — con il gesto dei Presidi
  (`azioni.posizionePresidio` → `gestoPosizione('presidio', …)`), e come i comandi
  dei luoghi si nasconde mentre si sceglie.
* Nella stessa schermata una leva si chiamava «LEVA_SGANCIO». `presidioInAlbero`
  leggeva il nome della categoria da `a.categoria`, che è una colonna di CONTESTO
  scritta dall'ufficio all'esportazione: un presidio creato in campo, o aggiunto
  d'ufficio a un pacchetto, non ce l'ha. Adesso il nome (e l'icona della
  categoria) vengono dal catalogo (`presidioInAlbero(a, S.categoriaDi(a))`); lo
  stesso nel registro delle modifiche (`descriviEvento`). Il verbale lo faceva già.

### I messaggi in alto, con la ✕ (26/09/2026, v148)

* «Le conferme vanno in alto, non in basso, e aggiungi una x per chiuderle in
  anticipo.» I messaggi (`toast`, `ui.js`) stanno sotto la fascia rossa
  (`top` con `--altezza-topbar` e l'area del notch): in basso coprivano proprio i
  comandi che si toccano di più. In alto non coprono nemmeno la barra «Nuova
  versione»; `--altezza-aggiornamento`, che serviva a scansarla, i messaggi non la
  usano più.
* Ogni messaggio ha la sua **✕**. Su quello annullabile il TESTO resta il pulsante
  che annulla, e la ✕ chiude SOLTANTO — chi chiude non ha chiesto di disfare.
  La domanda sì/no (`chiediConferma`) non ha la ✕: ha già «No».
* Visto nel browser a 390 px: il messaggio compare 13 px sotto la fascia, la ✕ lo
  chiude.

### Un'area con ubicazioni vuote si elimina; spuntando in «Sposta» l'elenco non salta (26/09/2026, v149)

* «Anche se le ubicazioni sono tutte vuote il cestino è disattivato, oppure dice
  impossibile perché ci sono presidi.» Due cause:
  - un'area con dentro QUALUNQUE ubicazione non si cancellava («cancella prima
    quelle»). Adesso un'**area** senza presidi vivi si elimina, e le sue ubicazioni
    vuote se ne vanno con lei: il foglio di conferma le nomina. Per un **impianto**
    resta la regola di prima (prima si tolgono le aree);
  - `presidiSotto` conta anche i presidi **rimossi** (`eliminato_il`), che l'albero
    non mostra. La regola usa `presidiViviSotto`; i rimossi che puntano al luogo
    cancellato perdono il riferimento (solo gli id, con il «prima»), o la
    validazione del pacchetto rifiuterebbe un presidio che nomina un luogo che non c'è.
  - Tutto è un gesto solo, e «clicca per annullare» rimette area, ubicazioni e
    riferimenti (`annullaEventi` accetta come padre di un'ubicazione l'area rimessa
    nella stessa modifica).
* «Quando in modalità sposta flaggo qualcosa, perdo il focus di ciò che ho
  flaggato perché cambia visualizzazione.» Scegliendo, i comandi di OGNI riga
  sparivano; dalla v146 sul telefono hanno una riga loro, quindi ogni riga si
  accorciava di ~44 px e quello appena spuntato usciva dallo schermo. Adesso i
  comandi restano, e «Sposta qui» compare DENTRO la loro riga, al primo posto.
  Misurato nel browser a 390 px: la riga spuntata resta a 380 px prima e dopo, e
  su 38 righe in vista nessuna cambia altezza.
* ⚠️ Provando nel browser, Chrome ha eseguito `sposta.js` VECCHIO anche dopo aver
  tolto il service worker, svuotato le cache e ricaricato con `cache: 'reload'`:
  i moduli ES restano in una cache che dalla pagina non si svuota. Serve
  un'ORIGINE nuova (un'altra porta del server di prova), come già scritto per la
  mappa. Le misure di un'origine già usata non valgono.
