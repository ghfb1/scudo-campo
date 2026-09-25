# Scudo Campo

App di rilievo dei presidi antincendio per l'operatore in campo. Si carica un
archivio `.zip` esportato da Scudo, si lavora **senza rete**, si riconsegna un
archivio che Scudo verifica e applica.

L'operatore può sfogliare per ubicazione (impianto → edificio → locale) invece
di cercare per stringa, vedere l'avanzamento del giro a ogni livello, aprire la
scheda completa di un presidio, modificarne qualunque campo, registrare
controlli — anche su un intero locale in una volta sola — e gestire le anomalie.

Nessuna dipendenza, nessuna compilazione: questa cartella si pubblica com'è su
GitHub Pages.

## Provarla in locale

```
./serve_locale.command
```

Serve un server HTTP. Aprendo `index.html` con un doppio clic il browser tratta
la pagina come origine opaca e disattiva moduli ES, service worker e IndexedDB —
cioè proprio i meccanismi che impediscono di perdere il rilievo. `localhost` si
comporta esattamente come GitHub Pages.

## Pubblicarla

Dalla radice del progetto:

```
../scripts/scudo/deploy_github_pages.sh              # prova a vuoto
../scripts/scudo/deploy_github_pages.sh --pubblica
```

Lo script verifica con quale account GitHub è autenticato e si rifiuta di
pubblicare con l'account sbagliato.

## Come sono organizzati i file

| File | Ruolo |
|---|---|
| `index.html` | telaio: barra di stato, contenitore delle viste, barra delle sezioni, foglio a comparsa |
| `styles.css` | tutto lo stile. Mobile-first: bersagli da 44px, sezioni in basso dove arriva il pollice, aree sicure per i telefoni con notch, tema chiaro e scuro |
| `js/pacchetto.js` | formato SCUDO-PKG v2: lettura, scrittura, checksum, validazione. **Gemello** di `backend/app/services/scudo_pacchetto.py`: le due implementazioni devono restare allineate |
| `js/zip.js` | lettura e scrittura di archivi ZIP, senza dipendenze |
| `js/campi.js` | scheda e form di modifica costruiti dai metadati dei campi che arrivano nel pacchetto |
| `js/store.js` | persistenza: IndexedDB, giornale, copia di emergenza, flush di uscita, rilevamento di più schede |
| `js/stato.js` | stato del rilievo in memoria, indici di ricerca, mutazioni |
| `js/ui.js` | utilità DOM, foglio a comparsa, avvisi, download |
| `js/app.js` | viste e collegamenti |
| `sw.js` | service worker: apre l'app senza rete. Non tocca i dati del rilievo |

## Due punti da non perdere di vista

**Se cambi `js/pacchetto.js`, cambia anche il gemello Python** e rialza
`PKG_VERSION` in entrambi. Se i due checksum divergono, ogni rilievo di rientro
viene rifiutato e non c'è modo di accorgersene se non provandolo. La prova è:

```
node ../scripts/scudo/test_pacchetto_cross.mjs <pacchetto.zip> /tmp/out.zip
```

**Se aggiungi o rinomini un file, aggiorna l'elenco `RISORSE` in `sw.js`** e alza
`VERSIONE`. Un file fuori dall'elenco funziona finché c'è rete e sparisce quando
serve davvero, che è il momento peggiore per scoprirlo.

## Il rilievo salvato ha una versione

`stato.js` esporta `FORMATO_DATASET`. Ogni rilievo salvato sul dispositivo porta
quel numero, e all'avvio un rilievo di formato diverso viene rifiutato e rimosso
invece di essere ripristinato dentro codice nuovo.

Serve davvero: durante lo sviluppo un rilievo salvato in formato v1 è stato
ripristinato dal codice v2 e la schermata sembrava perfetta, perché i campi che
l'interfaccia legge per primi hanno lo stesso nome nelle due versioni. Erano
diversi quelli che servono all'esportazione, e il rilievo sarebbe tornato in
ufficio monco senza che nessuno avesse visto niente di storto.

**Se cambi la forma dei dati salvati, alza `FORMATO_DATASET`.**

## Il service worker serve dalla cache

Dopo un aggiornamento la pagina già aperta continua con la versione vecchia
finché non viene chiusa e riaperta. L'app se ne accorge e lo dice con un avviso,
invece di ricaricarsi da sola: ricaricare a sorpresa durante un controllo è
peggio del ritardo. Il rilievo salvato non viene comunque toccato.


## Come far arrivare il pacchetto all'operatore

La pagina **non contiene nessun dato** ed è deliberato: è pubblica, e per policy
aziendale i dati degli impianti non ci stanno sopra. È l'operatore a caricare il
pacchetto, che resta nel suo browser finché non lo esporta.

Non esiste quindi un link che «si porta dietro» i dati, e non è una mancanza: un
indirizzo del genere richiederebbe di pubblicare il pacchetto da qualche parte,
che è esattamente ciò che la policy vieta.

Quello che si può fare è togliere i passaggi intorno al caricamento.

### Da telefono (Android) — un tocco

L'app è registrata come **destinazione di condivisione**. L'operatore riceve lo
`.zip` in posta o in chat, tocca *Condividi* e sceglie **Scudo Campo**: il file
arriva all'app senza passare dal selettore dei file, che è il punto in cui ci si
perde — la cartella dei download di un telefono non somiglia a niente.

Richiede che l'app sia **installata** (Aggiungi alla schermata Home).

### Da computer — doppio clic

Con l'app installata (Chrome o Edge: icona di installazione nella barra
indirizzi), un doppio clic sul file `.zip` lo apre direttamente in Scudo Campo.

### Su iPhone

iOS non supporta la destinazione di condivisione. Il percorso resta: salvare lo
`.zip` in *File*, aprire l'app, toccare la zona di caricamento e sceglierlo. Si
può anche trascinare il file sulla zona di caricamento.

### Che cosa mandare all'operatore

Un messaggio con il link e il file allegato:

```
Scudo Campo:  https://ghfb1.github.io/scudo-campo/
Parola di accesso: (quella concordata)

Apri il link, installa l'app (Aggiungi alla schermata Home), poi condividi
questo file con Scudo Campo.
```

Il nome del file dice già a chi è destinato e che cosa contiene, per esempio
`SCUDO_COMPLETO_2026-08-25_FABRICE-BARTOLI.zip`.
