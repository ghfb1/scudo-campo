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
