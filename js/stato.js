/**
 * Scudo Campo — stato del rilievo in memoria.
 *
 * Tiene il pacchetto caricato, gli indici per la ricerca e la navigazione, e
 * applica le modifiche dell'operatore producendo insieme:
 *   - la riga aggiornata nel dataset (quello che tornerà a Scudo);
 *   - l'evento di giornale (chi, quando, cosa, con che dispositivo).
 *
 * Ogni mutazione passa da `applica()`: è il solo punto in cui il dataset
 * cambia, quindi è anche il solo punto che deve ricordarsi di salvare.
 *
 * I nomi dei campi sono quelli tecnici del pacchetto v2, cioè quelli del
 * modello dati di Scudo. Non c'è nessuna traduzione fra le due parti: è la
 * ragione per cui una modifica fatta qui rientra senza che nessuno debba
 * ricordarsi di mappare qualcosa.
 */
import { E, ESITI, GRAVITA, STATI_ANOMALIA } from './pacchetto.js';
import * as PV from './piani.js';
import * as CAL from './calcoli.js';

export const SOGLIA_SCADENZA_GIORNI = 60;

/**
 * Ogni quanto si torna sul posto: la ditta antincendio fa il giro ogni SEI MESI.
 *
 * ⛔ È un numero DIVERSO dalla soglia del semaforo qui sopra, e la differenza è
 * tutta la questione (22/09/2026, segnalazione dell'operatore: «su alcuni
 * presidi mi viene il comando "fatto" usabile ancora prima di aver fatto i
 * controlli, solo perché ancora non sono scaduti — ma se scadono entro 6 mesi
 * dovrebbe dire esegui controllo»).
 *
 * Le due soglie rispondono a due domande:
 *
 *   `SOGLIA_SCADENZA_GIORNI` (60)  «come sta questa scadenza?» — il COLORE, ed è
 *                                  gemello dell'ufficio (`scudo_calcoli.py`):
 *                                  spostarlo cambierebbe cruscotti, scadenzario
 *                                  ed estrazioni, cioè una cosa che non c'entra.
 *   `ORIZZONTE_GIRO_MESI` (6)      «conviene farlo mentre sono qui?» — il
 *                                  LAVORO del giro. Chi ci va torna fra sei
 *                                  mesi: un controllo che scade fra tre lascia
 *                                  il presidio non idoneo per il tempo che
 *                                  manca al giro dopo.
 *
 * La schermata dei controlli conosceva già i sei mesi — la sezione «Prossimi
 * controlli (entro 6 mesi)», dal 17/09/2026 — ma `vociDelGiro` no: contava solo
 * quello che il semaforo chiamava scaduto o in scadenza. Così il presidio
 * mostrava «prossimi controlli entro sei mesi» e insieme il pulsante «✓ fatto»,
 * che è la contraddizione segnalata.
 */
export const ORIZZONTE_GIRO_MESI = 6;

/**
 * Se questa scadenza cade prima del giro successivo (o è già passata).
 *
 * ⚠️ Mesi e non giorni: «sei mesi» è quello che c'è scritto sullo schermo, e
 * 183 giorni non sono sei mesi in tutti i mesi dell'anno. La data si costruisce
 * in LOCALE, come `oggiIso`: `toISOString()` è UTC e in Italia sposta il
 * confine di un giorno per due ore ogni sera.
 */
/**
 * Se questa scadenza è quella di un controllo APPENA ESEGUITO: davanti a sé ha
 * ancora un periodo intero.
 *
 * ⛔ Si confrontano DATE e non giorni, e la differenza non è teorica: sei mesi
 * a partire dal 22 settembre sono **181 giorni**, mentre «sei mesi» contati a
 * 30,44 giorni l'uno ne fanno 182,6. Con l'aritmetica approssimata un
 * semestrale registrato oggi risultava «scade fra meno di un periodo», cioè da
 * rifare subito — e il pacchetto successivo avrebbe riproposto tutto il parco.
 * L'ha trovato `test_non_eseguibile_giro.py`, che quella proprietà la difende
 * dal 20/09/2026.
 */
export function periodoInteroDavanti(t, dataIso, oggi = new Date()) {
  const n = Number((t || {}).frequenza_valore);
  if (!Number.isFinite(n) || n <= 0 || !dataIso) return false;
  const limite = CAL.aggiungiPeriodo(new Date(oggi), n, (t.frequenza_unita || 'MESI'));
  if (!limite) return false;
  return String(dataIso).slice(0, 10) >= CAL.aIso(limite);
}

export function entroOrizzonteGiro(dataIso, oggi = new Date()) {
  if (!dataIso) return false;
  const limite = new Date(oggi);
  limite.setHours(0, 0, 0, 0);
  limite.setMonth(limite.getMonth() + ORIZZONTE_GIRO_MESI);
  const p = (n) => String(n).padStart(2, '0');
  const iso = `${limite.getFullYear()}-${p(limite.getMonth() + 1)}-${p(limite.getDate())}`;
  return String(dataIso).slice(0, 10) <= iso;
}

/**
 * Versione della forma con cui il rilievo viene salvato sul dispositivo.
 *
 * Serve a non ripristinare dati di una versione precedente dentro codice nuovo.
 * Misurato durante lo sviluppo: un rilievo salvato in formato v1 è stato
 * ripristinato dal codice v2 e la schermata sembrava perfetta — i conteggi
 * tornavano, perché i campi che l'interfaccia legge per primi hanno lo stesso
 * nome nelle due versioni. Erano diversi quelli che servono all'esportazione
 * (`ubicazione` contro `ubicazione_testo`, `operatore` contro `operatore_nome`),
 * e il rilievo sarebbe tornato in ufficio monco senza che nessuno avesse visto
 * niente di storto. Un ripristino che sembra riuscito è peggio di uno che
 * fallisce.
 */
export const FORMATO_DATASET = 2;

let stato = vuoto();
let onCambio = null;

function vuoto() {
  const perEntita = {};
  for (const k of Object.values(E)) perEntita[k] = [];
  return {
    caricato: false,
    manifest: {},
    perEntita,
    campi: [],
    giornale: [],
    sessione: {
      operatore: '',
      matricola: '',
      // --- il giro come oggetto con un ciclo di vita, non come somma di
      // controlli sparsi. Senza questi campi non c'è modo di dire se un giro è
      // finito: "tutti controllati" e "controllo concluso" sono due cose
      // diverse, e la seconda è una decisione di chi l'ha fatto.
      operatore_ditta: '',
      // Tipologie che questo giro si propone di controllare. Vuoto = tutte.
      //
      // Serve perché un giro reale quasi mai copre tutto: si va a controllare
      // gli estintori, oppure l'illuminazione di emergenza. Con il perimetro
      // dichiarato, "0 su 357" diventa "0 su 31" e l'avanzamento torna a
      // significare qualcosa; senza, ogni giro parziale risulta eternamente
      // incompleto e il numero smette di essere guardato.
      tipi_asset: [],
      iniziato_il: null,
      concluso_il: null,
      note_giro: '',
      device_id: '',
      sessione_id: '',
      caricato_il: null,
      nome_file: '',
      checksum_origine: '',
    },
    esportato: { seq: 0, il: null, checksum: '' },
  };
}

export function registraOsservatore(fn) { onCambio = fn; }

/**
 * Stato del giro: NON_INIZIATO -> IN_CORSO -> CONCLUSO.
 *
 * `CONCLUSO` non si raggiunge contando: arrivare al 100% dei presidi non vuol
 * dire che il giro sia finito — mancano i presidi non accessibili, quelli da
 * rivedere, la firma di chi se ne assume la responsabilità. Ci si arriva solo
 * con una conferma esplicita, e da lì non si torna indietro da soli.
 */
export const GIRO_NON_INIZIATO = 'NON_INIZIATO';
export const GIRO_IN_CORSO = 'IN_CORSO';
export const GIRO_CONCLUSO = 'CONCLUSO';

export function statoGiro() {
  const s = stato.sessione;
  if (s.concluso_il) return GIRO_CONCLUSO;
  if (s.iniziato_il) return GIRO_IN_CORSO;
  return GIRO_NON_INIZIATO;
}

/**
 * Il cambio di stato del giro lascia una traccia nel giornale.
 *
 * ⚠️ Fino al 19/09/2026 queste quattro funzioni cambiavano lo stato senza
 * scrivere niente: in ufficio un giro riaperto era indistinguibile da uno mai
 * concluso, e «chi ha concluso questo giro, e quando» non aveva risposta.
 *
 * `entita_id` è il giro quando c'è, altrimenti la stringa 'giro': un evento
 * senza id non si aggancia a niente.
 */
function eventoDiGiro(operazione, payload) {
  applica('giro', stato.sessione.sessione_id || 'giro', operazione, payload, () => {});
}

export function iniziaGiro({ operatore, matricola, operatore_ditta: ditta,
                             tipi_asset: tipi, note_giro: note,
                             avvio = 'a mano' } = {}) {
  if (operatore !== undefined) stato.sessione.operatore = operatore;
  if (matricola !== undefined) stato.sessione.matricola = matricola;
  if (ditta !== undefined) stato.sessione.operatore_ditta = ditta;
  if (tipi !== undefined) stato.sessione.tipi_asset = [...tipi];
  // ⛔ Le note si perdevano al primo salvataggio: la schermata ha il campo
  // «Note sul giro», ma il ramo che INIZIA il giro non lo passava — e quindi si
  // perdeva esattamente quando lo si scriveva per la prima volta.
  if (note !== undefined) stato.sessione.note_giro = note;
  const nuovo = !stato.sessione.iniziato_il;
  if (nuovo) stato.sessione.iniziato_il = new Date().toISOString();
  stato.sessione.concluso_il = null;
  if (nuovo) {
    eventoDiGiro('CREATE', {
      iniziato_il: stato.sessione.iniziato_il,
      operatore: stato.sessione.operatore,
      tipi_asset: [...(stato.sessione.tipi_asset || [])],
      // Chi ha aperto il giro: l'operatore premendo «Inizia», o il primo
      // controllo registrato. In ufficio la differenza si legge nel giornale.
      avvio,
    });
  }
  notifica();
  return statoGiro();
}

export function concludiGiro(note) {
  if (!stato.sessione.iniziato_il) return statoGiro();
  stato.sessione.concluso_il = new Date().toISOString();
  if (note !== undefined) stato.sessione.note_giro = note;
  eventoDiGiro('UPDATE', {
    concluso_il: stato.sessione.concluso_il,
    operatore: stato.sessione.operatore,
    note_giro: stato.sessione.note_giro || '',
  });
  notifica();
  return statoGiro();
}

export function riapriGiro(motivo = '') {
  if (!stato.sessione.concluso_il) return statoGiro();
  const eraConcluso = stato.sessione.concluso_il;
  stato.sessione.concluso_il = null;
  eventoDiGiro('UPDATE', {
    riaperto_il: adessoIso(),
    era_concluso_il: eraConcluso,
    operatore: stato.sessione.operatore,
    motivo,
  });
  notifica();
  return statoGiro();
}

export function aggiornaGiro(campi = {}) {
  for (const k of ['operatore', 'matricola', 'operatore_ditta', 'note_giro']) {
    if (campi[k] !== undefined) stato.sessione[k] = campi[k];
  }
  if (campi.tipi_asset !== undefined) stato.sessione.tipi_asset = [...campi.tipi_asset];
  notifica();
}
function notifica() { if (onCambio) onCambio(stato); }

export function get() { return stato; }

/**
 * Esegue `fn` TUTTA O NIENTE (23/09/2026).
 *
 * Il difetto: un salvataggio che fa più scritture — aprire un'anomalia e poi
 * scrivere i pezzi guasti, creare un presidio e poi le sue eccezioni — se
 * falliva sulla seconda lasciava la PRIMA in memoria. Il messaggio d'errore
 * diceva che non era successo niente; il salvataggio successivo, di qualunque
 * cosa, scriveva anche quella. Misurato: «Apri anomalia senza registrare un
 * controllo» falliva sempre sulla seconda scrittura, e ogni tentativo lasciava
 * un'anomalia in più.
 *
 * Come: una FOTOGRAFIA profonda di `stato` prima di `fn`, rimessa se `fn`
 * solleva. È esatta perché `stato` è l'unico stato di questo modulo — gli
 * indici (`idx`) ne sono derivati e si ricostruiscono — e perché `fn` è
 * sincrona: fra la fotografia e l'errore non può succedere nient'altro.
 * Misurato sul pacchetto vero (2,6 MB, 875 presidi): 7 ms la copia, 1 ms gli
 * indici, contro una scrittura su IndexedDB di tutto il rilievo che ogni
 * salvataggio fa comunque.
 *
 * ⚠️ Si rimette DENTRO lo stesso oggetto, chiave per chiave, e non si sostituisce
 * `stato`: chi ha in mano `S.get()` continua a guardare il rilievo vero. Se va
 * bene non cambia niente: né il valore restituito né quello che è stato scritto.
 */
/*
 * ⛔ La fotografia non deve MAI impedire di salvare. Se non riesce — un valore
 * che non si copia, un telefono senza `structuredClone` — si prova con JSON, e
 * se nemmeno quella riesce si scrive COME PRIMA, senza rete: un salvataggio
 * senza «tutto o niente» è il comportamento di sempre, un salvataggio rifiutato
 * per colpa della rete sarebbe un controllo perso.
 */
function fotografaStato() {
  try {
    if (typeof structuredClone === 'function') return structuredClone(stato);
  } catch { /* si prova con JSON */ }
  try {
    return JSON.parse(JSON.stringify(stato));
  } catch {
    return null;
  }
}

export function transazione(fn) {
  const fotografia = fotografaStato();
  try {
    return fn();
  } catch (e) {
    if (!fotografia) throw e;
    for (const k of Object.keys(stato)) if (!(k in fotografia)) delete stato[k];
    Object.assign(stato, fotografia);
    costruisciIndici();
    notifica();
    throw e;
  }
}
export function serializza() { return { ...stato, _formato: FORMATO_DATASET }; }

export function ripristina(dataset) {
  if (!dataset || !dataset.perEntita) return false;
  if (dataset._formato !== FORMATO_DATASET) {
    const e = new Error(
      'Il rilievo salvato su questo dispositivo è in un formato precedente '
      + `(${dataset._formato || 'v1'}) e non è leggibile da questa versione dell'app.`
    );
    e.formatoIncompatibile = true;
    throw e;
  }
  stato = { ...vuoto(), ...dataset };
  for (const k of Object.values(E)) if (!stato.perEntita[k]) stato.perEntita[k] = [];
  costruisciIndici();
  notifica();
  return true;
}

/**
 * Il giornale che il pacchetto porta con sé, ripulito.
 *
 * Deduplicato per `evento_id` (la prima occorrenza vince) e ordinato per
 * `ts_utc`. Le righe senza `evento_id` si scartano: l'ufficio le scarta
 * comunque (`_registra_change_log`), e tenerle qui vorrebbe dire far crescere il
 * giornale di righe che non arriveranno mai da nessuna parte.
 */
function giornaleEreditato(righe) {
  const visti = new Set();
  const out = [];
  for (const r of righe || []) {
    const id = r && r.evento_id;
    if (!id || visti.has(id)) continue;
    visti.add(id);
    out.push(r);
  }
  return out.sort((a, b) => String(a.ts_utc || '').localeCompare(String(b.ts_utc || '')));
}

export function carica({ manifest, dati, campi }, info = {}) {
  const sessioneCorrente = { ...stato.sessione };
  stato = vuoto();
  stato.caricato = true;
  stato.manifest = manifest;
  stato.perEntita = dati;
  stato.campi = campi || dati[E.CAMPO] || [];

  // ⭐ LA STAFFETTA: il giornale di chi ha lavorato prima non si butta
  // (19/09/2026). Se il pacchetto viene dal CAMPO, dentro c'è il lavoro di un
  // altro operatore che sta continuando lo stesso giro, e il suo giornale è
  // l'unica traccia di cose che nessuna colonna registra: i motivi con cui ha
  // annullato un controllo, chi ha creato un'area o un'ubicazione (quelle
  // tabelle non hanno nessun campo di autore), i «prima/dopo» di ogni modifica.
  //
  // Misurato prima di questa riga: nel pacchetto che il secondo operatore
  // riportava in ufficio, le righe di giornale del primo erano **ZERO**.
  //
  // ⚠️ Solo `origine === 'campo'`, e non è una precauzione teorica: il pacchetto
  // dell'ufficio oggi non porta giornale (misurato: 0 righe), ma se un domani lo
  // portasse, ereditarlo renderebbe `luogoCreatoInCampo` vero su OGNI ubicazione
  // mai creata — e cadrebbe la regola per cui senza password si tocca solo ciò
  // che si è creati in questo giro.
  const dalCampo = (manifest && manifest.origine) === 'campo';
  stato.giornale = dalCampo ? giornaleEreditato(dati[E.CHANGE]) : [];
  // ⛔ E il lavoro ereditato NON è un debito di chi lo riceve.
  //
  // `lavoroNonEsportato()` è `giornale.length > esportato.seq`. Senza questa
  // riga il secondo operatore, appena carica, si vedrebbe «N modifiche non
  // esportate» — il lavoro del primo, contato come suo — e siccome caricare è
  // bloccato quando ci sono modifiche in sospeso, **il terzo passaggio di mano
  // si bloccherebbe da solo**. Due modifiche giuste che si sabotano a vicenda, e
  // nessuna delle due, da sola, lo mostra.
  stato.esportato = {
    seq: stato.giornale.length,
    il: (manifest && manifest.generato_il) || null,
    checksum: (manifest && manifest.checksum) || '',
  };
  // `precedente` è la sessione PRIMA dell'azzeramento: serve a non perdere chi
  // sta lavorando. L'operatore si identifica una volta alla porta; caricare un
  // pacchetto è un'azione sui dati, non un cambio di persona, e sovrascrivere
  // il nome con quello scritto nel manifest (che è chi l'ha ESPORTATO, in
  // ufficio) attribuiva i controlli alla persona sbagliata senza dirlo.
  const precedente = sessioneCorrente;

  // ⭐ IL GIRO SI EREDITA DAL PACCHETTO, LA PERSONA NO (19/09/2026).
  //
  // Prima il giro veniva ereditato dalla sessione PRECEDENTE del telefono, e il
  // manifest — che lo porta da sempre — veniva ignorato. Due difetti in uno:
  //
  //  • nella staffetta, il giro di A si perdeva: in ufficio arrivava
  //    `giro_stato = NON_INIZIATO` e `giro_iniziato_il` vuoto anche se A
  //    l'aveva iniziato la mattina (misurato);
  //  • sullo stesso telefono, un giro CONCLUSO sopravviveva al pacchetto nuovo:
  //    si caricava il giro di ottobre e la scheda diceva già «Controllo
  //    concluso» con le note di settembre.
  //
  // La regola adesso è una: il giro viene dal PACCHETTO se il pacchetto è di
  // campo e parla dello stesso giro; se viene dall'ufficio il giro riparte
  // pulito. La PERSONA invece non si eredita mai — è l'altra metà della regola
  // già scritta qui sopra, e la staffetta la rende ancora più vera: B è un'altra
  // persona.
  // La condizione è solo `dalCampo`, e NON un confronto con il giro che stava sul
  // telefono: quello che c'era prima viene sostituito comunque, e se B aveva
  // caricato un altro giro, confrontare i due lo farebbe ripartire da zero
  // proprio nel caso in cui A gli sta passando un giro già iniziato.
  const giro = dalCampo
    ? {
      iniziato_il: manifest.giro_iniziato_il || null,
      concluso_il: manifest.giro_concluso_il || null,
      note_giro: manifest.giro_note || '',
      tipi_asset: String(manifest.giro_tipi_asset || '').split('|').filter(Boolean),
    }
    : { iniziato_il: null, concluso_il: null, note_giro: '', tipi_asset: [] };

  stato.sessione = {
    // ⛔ Niente ripiego su `manifest.operatore`: su un pacchetto di staffetta
    // quel nome è quello di CHI TE L'HA MANDATO, e attribuirebbe a lui i
    // controlli che stai per registrare tu.
    operatore: info.operatore || precedente.operatore || '',
    matricola: info.matricola || precedente.matricola || '',
    operatore_ditta: precedente.operatore_ditta || '',
    ...giro,
    device_id: info.device_id || deviceId(),
    sessione_id: manifest.sessione_id || '',
    caricato_il: new Date().toISOString(),
    nome_file: info.nome_file || '',
    checksum_origine: manifest.checksum || '',
  };
  costruisciIndici();
  notifica();
  return stato;
}

export function azzera() { stato = vuoto(); notifica(); }

// --------------------------------------------------------------------------- //
// Indici
// --------------------------------------------------------------------------- //
const idx = {
  assets: new Map(),
  impianti: new Map(),
  edifici: new Map(),
  locali: new Map(),
  categorie: new Map(),
  stati: new Map(),
  tipiControllo: new Map(),
  regole: [],
  anomaliePerAsset: new Map(),
  interventiPerAsset: new Map(),
  scadenzePerAsset: new Map(),
  edificiPerImpianto: new Map(),
  localiPerEdificio: new Map(),
  ricerca: new Map(),
};

function mappa(lista, chiave = 'id') {
  const m = new Map();
  for (const r of lista || []) if (r[chiave]) m.set(r[chiave], r);
  return m;
}

function raggruppa(lista, chiave) {
  const m = new Map();
  for (const r of lista || []) {
    if (!r[chiave]) continue;
    if (!m.has(r[chiave])) m.set(r[chiave], []);
    m.get(r[chiave]).push(r);
  }
  return m;
}

export function costruisciIndici() {
  const p = stato.perEntita;
  idx.assets = mappa(p[E.ASSET]);
  idx.impianti = mappa(p[E.IMPIANTO]);
  idx.edifici = mappa(p[E.EDIFICIO]);
  idx.locali = mappa(p[E.LOCALE]);
  idx.categorie = mappa(p[E.CATEGORIA], 'codice');
  idx.stati = mappa(p[E.STATO], 'codice');
  idx.tipiControllo = mappa(p[E.TIPO_CONTROLLO], 'codice');
  idx.tipiAnomalia = mappa(p[E.TIPO_ANOMALIA], 'codice');
  // Le tipologie di asset: servono a creare un piano, che deve dichiarare a
  // quale tipologia si applica. Prima non erano indicizzate perché nessuno in
  // campo doveva sceglierle.
  idx.tipiAsset = mappa(p[E.TIPO_ASSET], 'codice');
  idx.regole = p[E.REGOLA] || [];
  idx.piani = p[E.PIANO] || [];
  // I piani anche per id: `modificaPiano` e l'applicazione di massa li cercano
  // per identificativo, e su un elenco che ora può crescere dal campo una
  // scansione lineare a ogni disegno non è più gratis.
  idx.pianiPerId = mappa(p[E.PIANO]);
  idx.condizioniPerPiano = raggruppa(p[E.PIANO_CONDIZIONE], 'piano_id');
  idx.azioniPerPiano = raggruppa(p[E.PIANO_AZIONE], 'piano_id');
  idx.eccezioniPerAsset = raggruppa(p[E.ECCEZIONE], 'asset_id');
  for (const lista of idx.azioniPerPiano.values()) {
    lista.sort((a, b) => Number(a.ordine || 0) - Number(b.ordine || 0));
  }
  idx.anomaliePerAsset = raggruppa(p[E.ANOMALIA], 'asset_id');
  idx.interventiPerAsset = raggruppa(p[E.INTERVENTO], 'asset_id');
  idx.azioniPerIntervento = raggruppa(p[E.INTERVENTO_AZIONE], 'intervento_id');
  idx.scadenzePerAsset = raggruppa(p[E.SCADENZA], 'asset_id');
  idx.edificiPerImpianto = raggruppa(p[E.EDIFICIO], 'impianto_id');
  idx.localiPerEdificio = raggruppa(p[E.LOCALE], 'edificio_id');

  idx.ricerca = new Map();
  for (const a of p[E.ASSET] || []) idx.ricerca.set(a.id, testoRicerca(a));
}

function normalizza(s) {
  return (s || '').toString().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function testoRicerca(a) {
  const imp = idx.impianti.get(a.impianto_id);
  const edi = idx.edifici.get(a.edificio_id);
  const loc = idx.locali.get(a.locale_id);
  const cat = idx.categorie.get(a.categoria_codice);
  return normalizza([
    a.codice, a.identificativo, a.matricola, a.marca, a.modello,
    a.ubicazione_testo, a.note, a.estinguente,
    imp && imp.denominazione, edi && edi.denominazione, loc && loc.denominazione,
    cat && cat.descrizione,
  ].filter(Boolean).join(' '));
}

export const indici = idx;

// --------------------------------------------------------------------------- //
// Letture derivate
// --------------------------------------------------------------------------- //
/**
 * L'ubicazione come stringa leggibile.
 *
 * Quattro segmenti, non tre: impianto, edificio, locale e **posizione precisa**
 * (`ubicazione_testo`, una colonna dell'asset che l'operatore o il censimento
 * possono compilare a mano).
 *
 * Un segmento non si ripete due volte di fila. Sull'archivio si legge
 * «AREZZO C / Edificio Stazione / PALAZZINA INGRESSO / PALAZZINA INGRESSO»:
 * non sono due locali con lo stesso nome — è la posizione precisa che ripete la
 * denominazione del locale, perché i due dati arrivano da due colonne diverse
 * dello stesso foglio. Chi lo legge in campo cerca la differenza fra i due
 * segmenti e non la trova, e nel frattempo sospetta che l'anagrafica sia
 * sbagliata.
 *
 * Il confronto ignora maiuscole e spazi ai bordi: «Shelter» e «SHELTER» sono lo
 * stesso posto scritto da due lettori diversi del seed.
 */
export function ubicazione(a) {
  const imp = idx.impianti.get(a.impianto_id);
  const edi = idx.edifici.get(a.edificio_id);
  const loc = idx.locali.get(a.locale_id);
  const parti = [];
  // Il confronto è con l'ultimo pezzo VISIBILE, non con l'ultimo segmento.
  //
  // Un edificio dell'archivio si chiama letteralmente «Magazzino / Officina»,
  // separatore compreso, e sta sopra un locale «Officina»: chi legge vede
  // «… / Magazzino / Officina / Officina» e cerca la differenza fra gli ultimi
  // due. Confrontando i segmenti quel caso sfuggiva, perché i due segmenti sono
  // diversi — è il testo a ripetersi, non il campo.
  const aggiungi = (v) => {
    const t = String(v || '').trim();
    if (!t) return;
    const visibili = parti.join(' / ').split(' / ');
    const ultimo = visibili[visibili.length - 1] || '';
    if (ultimo && ultimo.toLocaleLowerCase() === t.toLocaleLowerCase()) return;
    parti.push(t);
  };
  if (imp) aggiungi(imp.denominazione);
  if (edi) aggiungi(edi.denominazione);
  if (loc) aggiungi(loc.denominazione);
  aggiungi(a.ubicazione_testo);
  return parti.join(' / ');
}

export function categoriaDi(a) { return idx.categorie.get(a.categoria_codice) || null; }

/**
 * Tipologia tecnica del presidio.
 *
 * Non viaggia nel pacchetto: si deriva dalla categoria, che è l'unica fonte.
 * Portarla come colonna significherebbe poterla far divergere dalla categoria,
 * e su quella divergenza si applicherebbero le regole di periodicità sbagliate.
 */
export function tipoAssetDi(a) {
  const cat = idx.categorie.get(a.categoria_codice);
  return (cat && cat.tipo_asset_codice) || a.tipo_asset_codice || null;
}
export function statoDi(a) { return idx.stati.get(a.stato_codice) || null; }

export function anomalieDi(assetId, soloAperte = true) {
  const l = idx.anomaliePerAsset.get(assetId) || [];
  return soloAperte ? l.filter((x) => ['APERTA', 'IN_CORSO'].includes(x.stato || 'APERTA')) : l;
}
export function interventiDi(assetId) {
  // Dal più recente. A PARITÀ DI DATA decide `registrato_il`: due controlli
  // dello stesso giorno sullo stesso piano sono il caso normale quando si
  // corregge un esito, e senza questo secondo criterio l'ordine è quello in cui
  // le righe sono capitate nell'indice. La gemella `piani_non_idonei` del server
  // ordina già così: qui mancava, e nell'archivio di oggi non esiste NESSUNA
  // coppia (presidio, tipo, data) ripetuta — misurato, zero su 2095 — quindi la
  // differenza non poteva emergere da sola. La fa emergere il caso piantato in
  // `scripts/scudo/test_idoneita_cross.py`.
  return [...(idx.interventiPerAsset.get(assetId) || [])]
    .sort((a, b) => (b.data || '').localeCompare(a.data || '')
      || (b.registrato_il || '').localeCompare(a.registrato_il || ''));
}
export function scadenzeDi(assetId) {
  // Lo stato che sospende tace anche qui. In ufficio queste righe vengono
  // ANNULLATE (`ricalcola_scadenze`); in campo restano aperte fino al rientro,
  // e senza questo filtro la scheda di un presidio appena dismesso continuerebbe
  // a dire «scade fra tre giorni» su una postazione che l'operatore ha appena
  // dichiarato vuota. Nascoste, non cancellate: se lo stato torna «in servizio»
  // — perché il presidio c'era — tornano da sé, senza bisogno dell'ufficio.
  if (sospendeLavoro(idx.assets.get(assetId))) return [];
  return [...(idx.scadenzePerAsset.get(assetId) || [])]
    .filter((s) => (s.stato || 'APERTA') === 'APERTA')
    .sort((a, b) => (a.data_scadenza || '').localeCompare(b.data_scadenza || ''));
}

export function semaforo(dataIso, oggi = new Date()) {
  if (!dataIso) return null;
  const d = new Date(`${dataIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const gg = Math.round((d - startOfDay(oggi)) / 86400000);
  if (gg < 0) return 'SCADUTO';
  if (gg <= SOGLIA_SCADENZA_GIORNI) return 'IN_SCADENZA';
  return 'REGOLARE';
}

export function giorniResidui(dataIso, oggi = new Date()) {
  if (!dataIso) return null;
  const d = new Date(`${dataIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((d - startOfDay(oggi)) / 86400000);
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

/** Data da stringa ISO, oppure null. */
function dataDa(v) {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** È conforme se lo stato è operativo e non ci sono pezzi guasti. */
/**
 * L'IDONEITÀ di un presidio: si può usare, adesso?
 *
 * È **calcolata**, non memorizzata: dipende da fatti che cambiano da soli
 * (un'anomalia che resta aperta, un esito registrato ieri), e un dato che
 * invecchia da solo non si scrive in colonna — si ricalcola quando lo si guarda.
 *
 * ⚠️ SCADUTO NON È PIÙ UNA RISPOSTA (17/09/2026). Era la voce che rispondeva a
 * un'ALTRA domanda — «è in regola con i controlli?» — e stando nella stessa
 * parola se la mangiava: un estintore integro con la semestrale scaduta si
 * leggeva come un pezzo da non usare, e un estintore rotto con le scadenze in
 * regola si leggeva come «non idoneo» senza dire che i controlli erano a posto.
 * Adesso le due domande hanno due risposte: qui l'idoneità, in `statoVerifiche`
 * lo stato delle verifiche. Un presidio può benissimo essere IDONEO e
 * NON_REGOLARE, ed è il caso più frequente (69 presidi su 868, misurato).
 *
 * Le risposte, in ordine di precedenza:
 *
 *   DISMESSO / SEGREGATO / NON_PREVISTO — il ciclo di vita, che una PERSONA
 *       decide. Vince su tutto: di un presidio che non è in servizio non ha
 *       senso chiedersi se sia idoneo.
 *   NON_IDONEO — ha almeno un'anomalia aperta, oppure dei pezzi guasti, oppure
 *       un piano il cui ULTIMO esito è non idoneo (richiesta dell'operatore del
 *       17/09/2026: «idoneo solo se tutti i piani di verifica sono idonei»).
 *   IDONEO — tutto il resto.
 *
 * `origine` dice PERCHÉ, e serve: «non idoneo» e «non idoneo perché la fonte
 * non ha mai dichiarato lo stato» si chiudono in due modi diversi.
 */
export const IDONEITA = ['IDONEO', 'NON_IDONEO',
  'SEGREGATO', 'DISMESSO', 'NON_PREVISTO'];

export function idoneita(a, oggi = new Date()) {
  const st = statoDi(a);
  const codice = (a && a.stato_codice) || '';

  // 1. il ciclo di vita, deciso da una persona.
  //
  // ⚠️ SCORTA non è qui, ed è una decisione (18/09/2026): una scorta è un pezzo
  // VERO e può essere idonea o no come tutte le altre. Quello che la distingue è
  // che non presidia un punto, e quello lo dice lo stato. Se stesse fra questi
  // rami sarebbe «né idonea né no», cioè invisibile il giorno in cui serve.
  // GEMELLA di `serializza_asset` in `backend/app/routers/scudo_common.py`:
  // stesse voci, stessa precedenza, stesse parole.
  if (codice === 'DISMESSO') return { stato: 'DISMESSO', origine: 'rimosso e non sostituito' };
  if (codice === 'SEGREGATO') {
    return { stato: 'SEGREGATO', origine: 'fuori servizio, in attesa di decisione' };
  }
  if (codice === 'NON_PREVISTO') {
    return { stato: 'NON_PREVISTO', origine: 'non richiesto dalla configurazione' };
  }

  // 2. i problemi aperti
  const aperte = anomalieDi(a.id).length;
  if (aperte) {
    return { stato: 'NON_IDONEO', origine: `${aperte} anomali${aperte === 1 ? 'a' : 'e'} apert${aperte === 1 ? 'a' : 'e'}`, anomalie: aperte };
  }
  // I pezzi guasti contati sulla riga: una riga che vale dodici lampade e ne
  // dichiara tre rotte è non idonea anche senza un'anomalia scritta.
  const ko = Number.parseInt(a.quantita_ko || '0', 10) || 0;
  if (ko > 0) {
    return { stato: 'NON_IDONEO', origine: `${ko} pezz${ko === 1 ? 'o guasto' : 'i guasti'}` };
  }

  // 3. i piani il cui ULTIMO controllo è andato male (operatore, 17/09/2026:
  //    «idoneo solo se tutti i piani di verifica sono idonei»).
  //
  //    Misurato prima di introdurla: 206 presidi hanno un piano con l'ultimo esito
  //    NON_IDONEO, e oggi sono già tutti non idonei per via dell'anomalia che quel
  //    controllo ha aperto. La regola non sposta niente adesso: chiude il buco di
  //    domani — un'anomalia chiusa senza rifare il controllo faceva tornare
  //    «idoneo» un presidio la cui ultima verifica era fallita.
  const falliti = pianiNonIdonei(a.id);
  if (falliti.length) {
    return {
      stato: 'NON_IDONEO',
      origine: `${falliti.length} controll${falliti.length === 1 ? 'o' : 'i'} con esito non idoneo`,
      piani_non_idonei: falliti,
    };
  }

  // Le SCADENZE non stanno più qui (17/09/2026): sono un'altra domanda, e
  // mescolarle rispondeva male a entrambe. «Si può usare?» è l'idoneità;
  // «è in regola con i controlli?» è `statoVerifiche`. Un estintore con la
  // revisione scaduta ieri funziona; non è a norma. Sono due colonne.
  const sc = statoControlliDi(a.id, oggi);
  return {
    stato: 'IDONEO',
    origine: sc.totale ? 'nessun difetto rilevato' : 'nessuna scadenza calcolata',
    // Un presidio senza scadenzario è idoneo per quanto ne sappiamo, e quel
    // «per quanto ne sappiamo» va detto: non è la stessa cosa di uno controllato.
    incerto: sc.totale === 0,
  };
}

/**
 * I piani il cui ULTIMO controllo è NON_IDONEO.
 *
 * L'ultimo per ogni tipo di controllo, non «uno qualsiasi»: un estintore trovato
 * non idoneo a marzo e riparato ad aprile è idoneo, e contare lo storico lo
 * terrebbe non idoneo per sempre.
 */
export function pianiNonIdonei(assetId) {
  const visti = new Set();
  const out = [];
  for (const i of interventiDi(assetId)) {   // già ordinati dal più recente
    if (visti.has(i.tipo_controllo_codice)) continue;
    visti.add(i.tipo_controllo_codice);
    if (i.esito === 'NON_IDONEO') out.push(i.tipo_controllo_codice);
  }
  return out;
}

/**
 * Lo stato delle VERIFICHE: in regola con i controlli, oppure no.
 *
 * Richiesta dell'operatore del 17/09/2026, e separata dall'idoneità apposta: una
 * sola voce scaduta rende il presidio NON REGOLARE, anche se il pezzo funziona.
 * «In scadenza» è ancora regolare — la data non è passata — ma si conta, perché
 * è quello che si va a fare.
 */
export function statoVerifiche(a, oggi = new Date()) {
  const sc = statoControlliDi(a.id, oggi);
  // ⚠️ DUE cause, non una (19/09/2026, richiesta dell'operatore: «quando un
  // piano di verifica scade O viene registrato come non idoneo, lo stato del
  // presidio diventa non regolare»). Fino a oggi ne guardava una sola — la
  // scadenza — e la seconda era la più grave: un piano il cui ULTIMO esito è
  // non idoneo dice che la verifica è STATA FATTA e ha trovato un difetto,
  // mentre una scadenza dice solo che nessuno l'ha ancora fatta. Il presidio
  // risultava «in regola con i controlli» proprio perché il controllo c'era
  // stato — e aveva detto di no.
  const falliti = pianiNonIdonei(a.id).length;
  if (!sc.totale && !falliti) {
    return { stato: 'SENZA', testo: 'nessuna scadenza calcolata', ...sc };
  }
  if (sc.scaduti || falliti) {
    return {
      stato: 'NON_REGOLARE',
      testo: percheNonRegolare(sc.scaduti, falliti),
      piani_non_idonei: falliti,
      ...sc,
    };
  }
  return {
    stato: 'REGOLARE',
    testo: sc.in_scadenza ? `in regola · ${sc.in_scadenza} in scadenza` : 'in regola',
    ...sc,
  };
}

/**
 * Perché il presidio non è in regola con i controlli.
 *
 * GEMELLA di `_perche_non_regolare` in `backend/app/routers/scudo_common.py`:
 * stesse parole, stesso ordine. Le due cause si nominano ENTRAMBE quando ci
 * sono entrambe — «3 verifiche scadute» e «1 controllo con esito non idoneo»
 * sono due lavori diversi (uno si fa andando, l'altro riparando), e scriverne
 * una sola manda l'operatore a fare metà del lavoro credendo di averlo finito.
 */
export function percheNonRegolare(scadute, falliti) {
  const pezzi = [];
  if (scadute) pezzi.push(`${scadute} verific${scadute === 1 ? 'a scaduta' : 'he scadute'}`);
  if (falliti) {
    pezzi.push(`${falliti} controll${falliti === 1 ? 'o' : 'i'} con esito non idoneo`);
  }
  return pezzi.join(' · ');
}

/**
 * Nome storico, tenuto perché lo legge l'elenco: adesso vuol dire «idoneo».
 * Non guarda più `operativo` dello stato — lo stato non parla più di guasti.
 */
export function conforme(a) {
  return idoneita(a).stato === 'IDONEO';
}

/**
 * Controllato IN QUESTO GIRO: è quello che serve sapere in cabina.
 *
 * "In questo giro" va inteso alla lettera, e prima non lo era: senza un
 * sessione_id bastava che l'intervento avesse una data di registrazione, e
 * quindi ogni controllo storico contava come fatto adesso. Con il pacchetto che
 * porta i 357 interventi del rilievo, l'app si apriva dicendo "357/357
 * controllati, 0 presidi ancora da controllare" a un operatore che non aveva
 * ancora fatto niente — cioè esattamente il numero che serve, sbagliato, nel
 * punto in cui viene guardato per primo.
 *
 * Il confine è l'inizio del giro. Un intervento registrato prima appartiene
 * alla storia del presidio e si vede nella sua scheda; non appartiene a questo
 * giro.
 *
 * Dal 16/09/2026 il confine è quello di `interventoNelGiro` (inizio del giro, o in
 * mancanza il caricamento del pacchetto): è lo stesso che decide «✓ fatto in questo
 * giro» sulla riga del piano, e il pulsante «fatto» si abilita guardando quelle
 * righe. Con due confini diversi un controllo registrato senza aver premuto «inizia
 * giro» risultava fatto sulla riga e non contava per il pulsante. Gli interventi
 * storici restano fuori comunque: arrivano con il pacchetto, quindi prima del
 * caricamento.
 */
function registratiNelGiro(assetId) {
  return (idx.interventiPerAsset.get(assetId) || []).filter(interventoNelGiro);
}

/**
 * Controllato in questo giro: per i controlli registrati, oppure perché
 * l'operatore l'ha SEGNATO (`segnaNelGiro`).
 *
 * Il segno vince finché dopo di lui non arriva una registrazione: chi rimette fra
 * «da controllare» un presidio già fatto e poi ci registra un controllo lo ritrova
 * fra i controllati, senza doverlo spostare una seconda volta. «Dopo» non si
 * decide con l'orario — è al secondo, e un segno e una registrazione nello stesso
 * secondo sarebbero indistinguibili — ma con i controlli che il segno ha VISTO:
 * uno che non c'era quando è stato messo lo scavalca.
 */
export function controllato(assetId) {
  return origineControllato(assetId) !== null;
}

/**
 * Il presidio è stato trattato, ma qualcosa non si è potuto verificare.
 *
 * Serve a mettere un ⚠ dove altrimenti ci sarebbe un ✓ verde: un check verde su
 * un presidio con una verifica impossibile direbbe «tutto a posto», e non lo è.
 */
export function conVerificheNonEseguibili(assetId) {
  return (vociDelGiro(assetId).nonEseguibili || []).length;
}

/**
 * 'registrato' | 'segnato' | null — perché il presidio risulta controllato.
 *
 * Regola dell'operatore del 15/09/2026: **fatto vuol dire eseguito**. Un presidio è
 * controllato solo quando ogni voce dei suoi piani da fare in questo giro ha un
 * controllo con esito IDONEO o NON_IDONEO (quale dei due non conta: anche un pezzo
 * non idoneo è stato controllato). «Non accessibile» e «non eseguito» sono
 * registrazioni, non esecuzioni: il presidio resta da controllare, e il pulsante
 * dice «esegui controllo» invece di «fatto». La stessa condizione chiude la porta
 * al segno a mano (`segnaNelGiro`), e vale anche per un segno già messo: se poi si
 * annulla il controllo che lo reggeva, il presidio torna da controllare.
 */
export function origineControllato(assetId) {
  // «Trattati», non «eseguiti»: dal 18/09/2026 anche una verifica dichiarata NON
  // ESEGUIBILE chiude la voce per il giro. Ci si è andati e non si poteva fare —
  // ritrovarsela davanti dieci volte non la rende possibile.
  const fatti = registratiNelGiro(assetId).filter(
    (i) => ESITI_ESEGUITI.includes(i.esito) || ESITI_NON_ESEGUIBILI.includes(i.esito));
  const segno = (stato.sessione.segnati || {})[assetId];
  const visti = new Set((segno && segno.visti) || []);
  let origine;
  if (segno && fatti.every((i) => visti.has(i.id))) {
    origine = segno.stato === 'controllato' ? (fatti.length ? 'registrato' : 'segnato') : null;
  } else {
    origine = fatti.length ? 'registrato' : null;
  }
  // Le voci si calcolano per ultime: costano un giro del motore dei piani, e sulla
  // gran parte dei presidi — né segnati né registrati — la risposta è già «no».
  if (origine === null) return null;
  return vociDelGiro(assetId).completa ? origine : null;
}

/** Gli esiti che vogliono dire «il controllo è stato ESEGUITO». */
export const ESITI_ESEGUITI = ['IDONEO', 'NON_IDONEO'];

/**
 * Gli esiti che dicono «non si è potuto fare», non «è andata così».
 *
 * ⚠️ Contano come TRATTATE nel giro, ma non come eseguite (18/09/2026, richiesta
 * dell'operatore). Sono due fatti diversi e servono entrambi:
 *
 * * per l'OPERATORE la voce è chiusa — ci è andato, non si poteva fare, e
 *   tenergliela in «da controllare» per tutto il giro vuol dire fargliela
 *   ritrovare davanti dieci volte senza che possa farci niente;
 * * per il REGISTRO la verifica NON è stata eseguita, e dirla fatta sarebbe
 *   falso: il presidio resta nello stato in cui era e la scadenza non si muove.
 *
 * Da qui il segno: un presidio con almeno una voce non eseguibile è «trattato»
 * ma porta un ⚠ invece del ✓ verde. Un check verde direbbe che è tutto a posto,
 * e non lo è — c'è qualcosa che nessuno ha potuto guardare.
 */
// Ri-esportata da `calcoli.js`, dove decide anche se l'orologio riparte: due
// copie dello stesso elenco si separerebbero al primo esito nuovo.
export const ESITI_NON_ESEGUIBILI = CAL.ESITI_NON_ESEGUIBILI;

/**
 * Le voci dei piani che questo presidio deve ricevere nel giro, e quali sono state
 * eseguite.
 *
 * «Da fare» è quello che la scheda mostra nella sezione dei controlli da fare
 * (`dividiPiani` di `controllo.js`): scaduto, in scadenza, mai eseguito, o non
 * calcolabile perché manca un dato. Ma deciso com'era **all'inizio del giro**: dopo
 * la registrazione la scadenza è assolta e il piano passerebbe «in regola», e un
 * denominatore che si restringe mentre si lavora darebbe per finito un presidio
 * solo perché lo si è toccato (lo stesso difetto misurato su `avanzamentoDi`).
 *
 * Una voce eseguita che non era da fare (un controllo in anticipo) compare con
 * `richiesta: false` e non conta nel conteggio.
 *
 * Nessuna voce da fare → `completa` è vera: su un presidio in regola non c'è niente
 * da eseguire, e segnarlo fatto resta possibile.
 */
export function vociDelGiro(assetId) {
  const a = idx.assets.get(assetId);
  if (!a) return { voci: [], richieste: 0, eseguite: 0, mancanti: [], completa: true };
  const oggi = new Date();
  const interventi = idx.interventiPerAsset.get(assetId) || [];
  const nelGiro = interventi.filter(interventoNelGiro);
  const idNelGiro = new Set(nelGiro.map((i) => i.id));
  const scadenze = idx.scadenzePerAsset.get(assetId) || [];

  const voci = [];
  for (const t of controlliApplicabili(a)) {
    const eseguita = nelGiro.some((i) => i.tipo_controllo_codice === t.codice
      && ESITI_ESEGUITI.includes(i.esito));
    // Trattata ma non eseguita: ci si è andati e non si poteva fare.
    const nonEseguibile = !eseguita && nelGiro.some((i) => i.tipo_controllo_codice === t.codice
      && ESITI_NON_ESEGUIBILI.includes(i.esito));
    // La scadenza com'era all'inizio: ancora aperta, o assolta da un controllo di
    // questo giro (non da uno di prima).
    // ⚠️ Il ripiego `!s.intervento_id` è ESATTO, non una tolleranza, e la ragione
    // va scritta o il prossimo lo legge come una scorciatoia: **l'ufficio esporta
    // soltanto le scadenze APERTA**, quindi una riga ASSOLTA dentro un pacchetto
    // può essere nata solo dal lavoro di campo di questo giro. Serve ai pacchetti
    // scritti prima del 19/09/2026, quando `intervento_id` non era una colonna
    // del CSV e si perdeva appena il pacchetto cambiava mano.
    const sc = scadenze
      .filter((s) => s.tipo_controllo_codice === t.codice
        && ((s.stato || 'APERTA') === 'APERTA'
          || (s.stato === 'ASSOLTA' && (idNelGiro.has(s.intervento_id) || !s.intervento_id))))
      .sort((x, y) => (x.data_scadenza || '').localeCompare(y.data_scadenza || ''))[0];
    let richiesta;
    if (t.indeterminato) richiesta = true;
    // ⛔ L'ORIZZONTE DEL GIRO, non il semaforo (22/09/2026). Il semaforo dice
    // com'è messa una scadenza — ed è il colore, gemello dell'ufficio; qui
    // serve un'altra cosa: se convenga farlo adesso che si è sul posto. Chi ci
    // va torna fra sei mesi.
    //
    // ⚠️ …ma NON quello appena eseguito, e la differenza l'ha trovata una prova
    // che esisteva già (`test_non_eseguibile_giro.py`): un semestrale
    // registrato oggi genera la scadenza a sei mesi esatti, cioè dentro
    // l'orizzonte, e il pacchetto successivo l'avrebbe riproposto — «il giro
    // successivo riproporrebbe tutto il parco». Un controllo appena fatto ha
    // davanti un PERIODO INTERO: `periodoInteroDavanti` lo distingue da uno che
    // sta per scadere, senza bisogno di sapere quando è stato l'ultimo giro.
    //
    // Limite dichiarato: se il pacchetto si rigenera qualche settimana dopo un
    // giro, i controlli con periodicità ≤ 6 mesi fatti allora tornano fra i «da
    // fare» — hanno davanti meno di un periodo e scadono prima del giro
    // successivo, quindi per questa regola sono da anticipare. Nel flusso vero
    // il pacchetto nuovo si genera per il giro dopo, e lì è la risposta giusta.
    else if (sc) {
      richiesta = entroOrizzonteGiro(sc.data_scadenza, oggi)
        && !periodoInteroDavanti(t, sc.data_scadenza, oggi);
    }
    // La scadenza calcolata in campo dalla data di partenza (24/09/2026) conta
    // come quella dell'ufficio: è la stessa che l'ufficio scriverà al rientro.
    // Senza, un fine vita fra quattro anni restava fra i «da fare» — e il fine
    // vita non si esegue, quindi il presidio non diventava mai «fatto».
    else if (t.scadenza_calcolata) {
      richiesta = entroOrizzonteGiro(t.scadenza, oggi)
        && !periodoInteroDavanti(t, t.scadenza, oggi);
    }
    // ⛔ «Mai eseguito» lo spegne solo un controllo ESEGUITO. Un NON_ACCESSIBILE
    // di sei mesi fa diceva «questo tipo è già stato fatto», e insieme alla
    // scadenza che non c'è più il presidio spariva dai «da fare» — che è
    // esattamente il difetto misurato il 20/09/2026. Le due strade che lo
    // nascondevano erano due, e correggerne una sola lasciava l'altra.
    else {
      richiesta = !interventi.some((i) => i.tipo_controllo_codice === t.codice
        && !idNelGiro.has(i.id) && CAL.esecuzioneVale(i.esito));
    }
    if (richiesta || eseguita || nonEseguibile) {
      voci.push({ codice: t.codice, piano_id: t.piano_id, descrizione: t.descrizione,
        richiesta, eseguita, nonEseguibile });
    }
  }
  const richieste = voci.filter((v) => v.richiesta);
  // «Mancante» è quello su cui non si è ancora fatto NIENTE. Una voce dichiarata
  // non eseguibile è stata trattata: esce dai da fare e non ci torna.
  const mancanti = richieste.filter((v) => !v.eseguita && !v.nonEseguibile);
  const nonEseguibili = richieste.filter((v) => v.nonEseguibile);
  return {
    voci,
    richieste: richieste.length,
    eseguite: richieste.filter((v) => v.eseguita).length,
    mancanti,
    nonEseguibili,
    // `completa` vuol dire «non resta niente da fare qui», non «è tutto a posto»:
    // la seconda la dice `nonEseguibili`, ed è per quello che l'elenco porta un
    // ⚠ invece di un ✓ quando ce n'è almeno una.
    completa: mancanti.length === 0,
  };
}

/**
 * Sposta un presidio fra «controllati in questo giro» e «da controllare».
 *
 * Non crea né toglie controlli: è la lista di lavoro dell'operatore. Un presidio
 * segnato controllato senza registrazioni resta senza verbale, e la scheda lo
 * dice. Va nel giornale, così in ufficio si sa che il segno è stato messo a mano.
 */
export function segnaNelGiro(assetId, destinazione) {
  if (!idx.assets.has(assetId)) throw new Error(`Presidio ${assetId} non trovato`);
  if (!['controllato', 'da_controllare'].includes(destinazione)) {
    throw new Error(`Destinazione «${destinazione}» non valida.`);
  }
  if (destinazione === 'controllato') {
    const { mancanti } = vociDelGiro(assetId);
    if (mancanti.length) {
      throw new Error(`Prima esegui ${mancanti.length === 1 ? 'il controllo' : `i ${mancanti.length} controlli`}: `
        + `${mancanti.map((v) => v.descrizione).join('; ')}. Fatto vuol dire idoneo o non idoneo.`);
    }
  }
  const prima = controllato(assetId) ? 'controllato' : 'da_controllare';
  // `segno_prima` è il segno com'era, intero: serve ad annullare (`annullaEventi`)
  // rimettendo esattamente quello, non «la destinazione opposta» — che avrebbe
  // fotografato di nuovo i controlli visti e cambiato chi scavalca chi.
  const segnoPrima = (stato.sessione.segnati || {})[assetId] || null;
  return applica('giro', assetId, 'UPDATE', {
    asset_id: assetId, prima, dopo: destinazione, segno_prima: segnoPrima,
  }, () => {
    if (!stato.sessione.segnati) stato.sessione.segnati = {};
    stato.sessione.segnati[assetId] = {
      stato: destinazione, il: adessoIso(), visti: registratiNelGiro(assetId).map((i) => i.id),
    };
  });
}

/**
 * Annulla le modifiche appena fatte, dal tocco sul messaggio «(clicca per
 * annullare)» — richiesta dell'operatore del 15/09/2026.
 *
 * Lavora sugli EVENTI del giornale, non su una copia dei dati: una copia di tutto
 * l'archivio a ogni tocco costerebbe megabyte, e ripristinarla cancellerebbe anche
 * quello che nel frattempo si è fatto altrove. Ogni evento sa com'era prima
 * (`segno_prima`, `prima`), e l'annullamento è a sua volta un evento: in ufficio si
 * vede che cosa è stato fatto e disfatto.
 *
 * Si annullano solo i tipi che portano il «prima» intero — segno del giro e
 * aggiornamento di un'anomalia —; un altro tipo solleva, invece di disfare a metà.
 * E si rifiuta se sulla stessa cosa è arrivata una modifica DOPO: disfare la prima
 * delle due rimetterebbe in vita uno stato che nessuno ha più visto.
 */
export function annullaEventi(eventoIds) {
  const ids = new Set(eventoIds || []);
  const eventi = stato.giornale.filter((e) => ids.has(e.evento_id));
  if (!eventi.length) throw new Error('Niente da annullare: la modifica non è più nel giornale.');
  // Uno SPOSTAMENTO nell'albero (22/09/2026) si disfa tutto insieme: le sue
  // righe portano lo stesso `spostamento`, e ognuna sa com'era prima. Disfarne
  // una parte lascerebbe un presidio in un posto che nessuno ha scelto.
  const diSpostamento = eventi.map((e) => JSON.parse(e.payload || '{}').spostamento);
  const spostamento = diSpostamento.every(Boolean) && new Set(diSpostamento).size === 1;
  // ⛔ Chi si può disfare (23/09/2026). Fino a ieri solo giro e anomalie, ma
  // «clicca per annullare» lo promettevano OTTO scritture di `app.js`, e tre
  // rispondevano «non si annulla da qui» solo DOPO il tocco — misurato
  // eseguendole tutte: eliminare un luogo, e assegnare un'ubicazione ai presidi
  // (scegliendone una o creandola sul momento). Una promessa che si scopre falsa
  // quando la si usa è peggio di nessuna promessa.
  // `test_annulla_campo.mjs` censisce `app.js`: ogni scrittura annullabile deve
  // stare fra quelle che la prova disfa davvero.
  const LUOGHI = ['impianto', 'edificio', 'locale'];
  const annullabile = (ev) => {
    const payload = JSON.parse(ev.payload || '{}');
    if ((ev.entita === 'giro' || ev.entita === 'anomalia') && ev.operazione === 'UPDATE') return true;
    if (ev.entita === 'asset' && ev.operazione === 'UPDATE') return Boolean(payload.prima);
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'CREATE') return true;
    // Una MODIFICA di un luogo (la posizione spostata sulla mappa) si disfa se
    // l'evento sa com'era: quelli scritti prima del 23/09/2026 no.
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'UPDATE') return Boolean(payload.prima && payload.dopo);
    // Un'eliminazione si disfa solo se l'evento conserva la riga intera: quelle
    // scritte prima di oggi portano solo il nome, e rimettere un luogo di cui
    // si sa solo il nome vorrebbe dire inventare il resto.
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'DELETE') return Boolean(payload.riga);
    return false;
  };
  for (const ev of eventi) {
    const ok = spostamento || annullabile(ev);
    if (!ok) throw new Error(`Questa modifica (${ev.entita}) non si annulla da qui.`);
    const pos = stato.giornale.indexOf(ev);
    const dopo = stato.giornale.slice(pos + 1)
      .find((x) => x.entita === ev.entita && x.entita_id === ev.entita_id && !ids.has(x.evento_id));
    if (dopo) throw new Error('Nel frattempo è stato modificato di nuovo: non si annulla più da qui.');
  }
  if (spostamento) { annullaSpostamento(eventi); return; }

  // ⚠️ TUTTO si controlla PRIMA di disfare qualunque cosa: un annullamento a
  // metà lascia uno stato che nessuno ha mai visto, ed è peggio di nessun
  // annullamento.
  const tabella = { impianto: E.IMPIANTO, edificio: E.EDIFICIO, locale: E.LOCALE };
  const riportati = new Set(eventi.filter((e) => e.entita === 'asset').map((e) => e.entita_id));
  // I luoghi nati NELLA STESSA modifica (un'area e la sua ubicazione create
  // insieme): se ne vanno insieme, e non contano come «messo dopo».
  const natiQui = new Set(eventi.filter((e) => LUOGHI.includes(e.entita) && e.operazione === 'CREATE')
    .map((e) => e.entita_id));
  for (const ev of eventi) {
    const payload = JSON.parse(ev.payload || '{}');
    if (ev.entita === 'asset' && !idx.assets.get(ev.entita_id)) {
      throw new Error('Il presidio non esiste più: non si annulla più da qui.');
    }
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'UPDATE'
      && !(stato.perEntita[tabella[ev.entita]] || []).some((x) => x.id === ev.entita_id)) {
      throw new Error('Il luogo non esiste più: non si annulla più da qui.');
    }
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'CREATE') {
      // Il luogo nato qui si toglie solo se nessun ALTRO lo usa: i presidi che
      // vi sono stati messi nella stessa modifica tornano dov'erano prima.
      const campo = { impianto: 'impianto_id', edificio: 'edificio_id', locale: 'locale_id' }[ev.entita];
      const altri = (stato.perEntita[E.ASSET] || [])
        .filter((a) => a[campo] === ev.entita_id && !riportati.has(a.id)).length;
      const figli = ev.entita === 'impianto'
        ? (stato.perEntita[E.EDIFICIO] || []).filter((x) => x.impianto_id === ev.entita_id && !natiQui.has(x.id))
        : ev.entita === 'edificio'
          ? (stato.perEntita[E.LOCALE] || []).filter((x) => x.edificio_id === ev.entita_id && !natiQui.has(x.id))
          : [];
      if (altri || figli.length) {
        throw new Error('Nel frattempo in quel luogo è stato messo altro: non si annulla più da qui.');
      }
    }
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'DELETE') {
      const r = payload.riga;
      // L'area eliminata INSIEME alle sue ubicazioni (26/09/2026) torna nella stessa
      // modifica, prima di loro: conta come padre anche se adesso non c'è.
      const rimessoQui = (ent, pid) => eventi.some((e) => e.entita === ent && e.operazione === 'DELETE'
        && (JSON.parse(e.payload || '{}').riga || {}).id === pid);
      const padre = ev.entita === 'edificio' ? idx.impianti.get(r.impianto_id)
        : ev.entita === 'locale' ? (idx.edifici.get(r.edificio_id) || rimessoQui('edificio', r.edificio_id)) : true;
      if (!padre) throw new Error('Il luogo che lo conteneva non c’è più: non si annulla più da qui.');
      if ((stato.perEntita[tabella[ev.entita]] || []).some((x) => x.id === r.id)) {
        throw new Error('Il luogo c’è già: non si annulla più da qui.');
      }
    }
  }

  // Dall'ultimo al primo, come si disfa una pila.
  for (const ev of [...eventi].reverse()) {
    const payload = JSON.parse(ev.payload || '{}');
    if (ev.entita === 'asset') {
      aggiornaAsset(ev.entita_id, payload.prima);
      continue;
    }
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'CREATE') {
      eliminaUbicazione(ev.entita, ev.entita_id);
      continue;
    }
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'UPDATE') {
      // Com'era, campo per campo: quelli che c'erano tornano, quelli che non
      // c'erano se ne vanno.
      const riga = (stato.perEntita[tabella[ev.entita]] || []).find((x) => x.id === ev.entita_id);
      const ora = Object.fromEntries(Object.keys(payload.dopo).filter((k) => k in riga).map((k) => [k, riga[k]]));
      applica(ev.entita, ev.entita_id, 'UPDATE',
        { prima: ora, dopo: { ...payload.prima }, annulla_evento: ev.evento_id }, () => {
          for (const k of Object.keys(payload.dopo)) {
            if (k in payload.prima) riga[k] = payload.prima[k];
            else delete riga[k];
          }
          costruisciIndici();
        });
      continue;
    }
    if (LUOGHI.includes(ev.entita) && ev.operazione === 'DELETE') {
      const riga = { ...payload.riga };
      const righe = stato.perEntita[tabella[ev.entita]] = stato.perEntita[tabella[ev.entita]] || [];
      applica(ev.entita, riga.id, 'CREATE', { riga, annulla_evento: ev.evento_id }, () => {
        righe.push(riga);
        costruisciIndici();
      });
      continue;
    }
    if (ev.entita === 'giro') {
      const assetId = ev.entita_id;
      const segnoOra = (stato.sessione.segnati || {})[assetId] || null;
      const precedente = payload.segno_prima || null;
      applica('giro', assetId, 'UPDATE', {
        asset_id: assetId, prima: payload.dopo, dopo: precedente ? precedente.stato : 'nessun segno',
        segno_prima: segnoOra, annulla_evento: ev.evento_id,
      }, () => {
        if (!stato.sessione.segnati) stato.sessione.segnati = {};
        if (precedente) stato.sessione.segnati[assetId] = precedente;
        else delete stato.sessione.segnati[assetId];
      });
    } else {
      aggiornaAnomalia(ev.entita_id, payload.prima || {});
    }
  }
}

// --------------------------------------------------------------------------- //
// Navigazione annidata: impianto -> edificio -> locale
// --------------------------------------------------------------------------- //
/**
 * Albero delle ubicazioni con i conteggi a ogni livello.
 *
 * Serve perché in campo non si cerca per stringa: si è dentro un locale e si
 * vuole l'elenco di quel locale. Cercare "sala quadri" presuppone di ricordarsi
 * come è scritto in anagrafica; scendere impianto → edificio → locale no.
 */
/**
 * L'albero delle UBICAZIONI: i luoghi, non il lavoro.
 *
 * Perché non basta `albero()`
 * ---------------------------
 * `albero()` costruisce la gerarchia partendo dai PRESIDI: raggruppa gli asset
 * per impianto, edificio e locale. È l'albero giusto per lavorare — mostra dove
 * c'è da andare — ma ha una conseguenza che qui sarebbe un difetto: **un luogo
 * senza presidi non esiste**. Un edificio appena creato, o un locale svuotato,
 * sparirebbe dalla schermata che serve proprio a gestirlo, e chi lo ha appena
 * creato penserebbe che il salvataggio non abbia funzionato.
 *
 * Questo parte dalle TABELLE dei luoghi e ci appende i conteggi. Le due funzioni
 * rispondono a due domande diverse e devono restare separate.
 *
 * I presidi che puntano a un impianto o un edificio inesistente non vengono
 * inghiottiti: finiscono in un nodo «(non in anagrafica)», perché un dato
 * incoerente che sparisce dalla vista è un dato che nessuno correggerà mai.
 */
/**
 * Ubicazioni che sono lo stesso posto scritto in due modi.
 *
 * Non è un sospetto: è misurato. Nell'archivio ci sono 10 gruppi di locali che
 * differiscono solo per maiuscole — `Shelter`/`SHELTER`, `Sala Quadri`/`SALA
 * QUADRI`, `Officina`/`OFFICINA`, `Servizi MT`/`SERVIZI MT` — per 69 presidi
 * complessivi. Hanno una causa sola: tre lettori diversi del censimento
 * (foglio CETIS, DataBase Facility, scadenziario estintori) generano l'id
 * dell'ubicazione facendo l'hash della stringa GREZZA, quindi due grafie danno
 * due id e due righe. Il vincolo di unicità sul database non può fermarle,
 * perché per il database sono due nomi diversi.
 *
 * Il vincolo di unicità è anche il motivo per cui l'unificazione NON si fa da
 * qui: due righe con la stessa denominazione sotto lo stesso padre non possono
 * coesistere, quindi unire significa spostare i presidi da una all'altra e
 * cancellarne una — una modifica che riscrive l'anagrafica e che va fatta in
 * ufficio, con un backup, non da un telefono in mezzo a un capannone.
 *
 * Quello che si può fare in campo è VEDERLE. Un elenco che le mostra impedisce
 * la terza grafia, che è il modo in cui il problema cresce.
 */
export function ubicazioniSimili() {
  const norm = (v) => String(v || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLocaleUpperCase();

  const gruppi = [];
  const raggruppa = (righe, chiavePadre, tipo, nomePadre) => {
    const per = new Map();
    for (const r of righe) {
      if (r.eliminato_il) continue;
      const k = `${r[chiavePadre] || ''}|${norm(r.denominazione)}`;
      if (!per.has(k)) per.set(k, []);
      per.get(k).push(r);
    }
    for (const [, righeGruppo] of per) {
      if (righeGruppo.length < 2) continue;
      gruppi.push({
        tipo,
        padre: nomePadre(righeGruppo[0]),
        nome: norm(righeGruppo[0].denominazione),
        varianti: righeGruppo.map((r) => ({
          id: r.id,
          denominazione: r.denominazione,
          presidi: (stato.perEntita[E.ASSET] || [])
            .filter((a) => !a.eliminato_il
              && (tipo === 'locale' ? a.locale_id : a.edificio_id) === r.id).length,
        })),
      });
    }
  };

  raggruppa([...idx.edifici.values()], 'impianto_id', 'edificio',
    (r) => (idx.impianti.get(r.impianto_id) || {}).denominazione || '?');
  raggruppa([...idx.locali.values()], 'edificio_id', 'locale',
    (r) => (idx.edifici.get(r.edificio_id) || {}).denominazione || '?');

  return gruppi.sort((a, b) => String(a.padre).localeCompare(String(b.padre)));
}

/**
 * Gli impianti su cui l'ufficio ha chiesto di lavorare in questo giro.
 *
 * Il pacchetto li contiene TUTTI (un pacchetto parziale, al rientro,
 * cancellerebbe gli altri): questi sono la priorità, e le due navigazioni li
 * mettono in cima. Un manifest di un formato precedente non li ha: nessuno.
 */
export function impiantiPrevisti() {
  const m = stato.manifest || {};
  return new Set(Array.isArray(m.impianti_previsti) ? m.impianti_previsti : []);
}

/** Previsti prima, poi per nome: l'ordine di entrambe le navigazioni. */
function primaIPrevisti(a, b) {
  if (a.previsto !== b.previsto) return a.previsto ? -1 : 1;
  return String(a.nome || '').localeCompare(String(b.nome || ''));
}

export function alberoUbicazioni() {
  const perImpianto = new Map();
  const perEdificio = new Map();
  const perLocale = new Map();
  // Quanti di quei presidi hanno una posizione (25/09/2026, dall'operatore: «anche
  // su luoghi, dove c'è l'alberatura, dovrebbe essere possibile vedere se un
  // presidio ha o non ha l'ubicazione, coerente con i presidi»). Stessa regola
  // del filtro dei Presidi e della mappa: `haPosizione`.
  const conPos = { impianto: new Map(), edificio: new Map(), locale: new Map() };
  const piu = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
  for (const a of stato.perEntita[E.ASSET] || []) {
    if (a.eliminato_il) continue;
    perImpianto.set(a.impianto_id, (perImpianto.get(a.impianto_id) || 0) + 1);
    if (a.edificio_id) perEdificio.set(a.edificio_id, (perEdificio.get(a.edificio_id) || 0) + 1);
    if (a.locale_id) perLocale.set(a.locale_id, (perLocale.get(a.locale_id) || 0) + 1);
    if (haPosizione(a)) {
      piu(conPos.impianto, a.impianto_id); piu(conPos.edificio, a.edificio_id); piu(conPos.locale, a.locale_id);
    }
  }

  const impianti = [...idx.impianti.values()].filter((x) => !x.eliminato_il);
  const edifici = [...idx.edifici.values()].filter((x) => !x.eliminato_il);
  const locali = [...idx.locali.values()].filter((x) => !x.eliminato_il);

  const perNome = (a, b) => String(a.nome || '').localeCompare(String(b.nome || ''));

  const nodiLocale = (edificioId) => locali
    .filter((l) => l.edificio_id === edificioId)
    .map((l) => ({
      tipo: 'locale',
      id: l.id,
      nome: l.denominazione || '(ubicazione senza nome)',
      dettaglio: l.piano ? `piano ${l.piano}` : '',
      riga: l,
      presidi: perLocale.get(l.id) || 0,
      presidi_con_posizione: conPos.locale.get(l.id) || 0,
      figli: [],
    }))
    .sort(perNome);

  const nodiEdificio = (impiantoId) => edifici
    .filter((e) => e.impianto_id === impiantoId)
    .map((e) => {
      const figli = nodiLocale(e.id);
      return {
        tipo: 'edificio',
        id: e.id,
        nome: e.denominazione || '(area senza nome)',
        dettaglio: '',
        riga: e,
        presidi: perEdificio.get(e.id) || 0,
        presidi_con_posizione: conPos.edificio.get(e.id) || 0,
        // I presidi agganciati all'edificio ma a nessun locale: contarli solo
        // nei figli li farebbe sparire dal totale.
        presidi_diretti: (perEdificio.get(e.id) || 0)
          - figli.reduce((n, l) => n + l.presidi, 0),
        figli,
      };
    })
    .sort(perNome);

  const previsti = impiantiPrevisti();
  const radici = impianti.map((i) => {
    const figli = nodiEdificio(i.id);
    return {
      tipo: 'impianto',
      id: i.id,
      previsto: previsti.has(i.id),
      nome: i.denominazione || '(impianto senza nome)',
      dettaglio: [i.tipologia, i.comune].filter(Boolean).join(' · '),
      // ⛔ Gli obblighi di SITO scaduti si vedono sul nodo, senza aprire niente
      // (21/09/2026, segnalazione dell'operatore: «dove dovrei vedere i dati dei
      // registri? non li vedo»).
      //
      // Il difetto non era solo dove stavano: era che NIENTE li annunciava.
      // Un'informazione raggiungibile in due tocchi ma che non si annuncia è
      // un'informazione che si trova solo per caso — e un CPI scaduto da cinque
      // anni non deve dipendere dal caso.
      obblighi_scaduti: obblighiDiImpianto(i.id)
        .filter((o) => semaforo(o.data_scadenza) === 'SCADUTO').length,
      riga: i,
      presidi: perImpianto.get(i.id) || 0,
      presidi_con_posizione: conPos.impianto.get(i.id) || 0,
      presidi_diretti: (perImpianto.get(i.id) || 0)
        - figli.reduce((n, e) => n + e.presidi, 0),
      figli,
    };
  }).sort(primaIPrevisti);

  // Quello che punta a un'ubicazione che non c'è. Non è un caso teorico: i
  // presidi arrivano da fogli di calcolo, e un identificativo può restare
  // orfano dopo una modifica in ufficio.
  const noti = new Set(impianti.map((x) => x.id));
  const orfani = [...perImpianto.entries()]
    .filter(([id]) => !noti.has(id))
    .reduce((n, [, q]) => n + q, 0);
  if (orfani) {
    radici.push({
      tipo: 'orfani', id: '', nome: '(presidi senza impianto in anagrafica)',
      dettaglio: 'da correggere in ufficio', riga: null,
      presidi: orfani, presidi_diretti: orfani, figli: [],
    });
  }
  return radici;
}

export function albero(filtro = [], { conVuoti = false } = {}) {
  // Accetta un elenco di categorie (come prima) oppure i FILTRI INTERI.
  //
  // Dal 16/09/2026 (operatore): scegliendo una tipologia la navigazione spariva e
  // restava un elenco piatto di 408 estintori. Sbagliato due volte: si perde il
  // «dove sono» proprio quando serve — un estintore si va a cercare in un locale,
  // non in una lista alfabetica — e si perde la possibilità di dire «di questa
  // tipologia, qui dentro, quanti ne mancano». Adesso i filtri restringono
  // l'albero invece di sostituirlo, e i conteggi dei nodi sono quelli filtrati.
  //
  // I presidi li sceglie `cerca`, che è l'unico posto dove quei filtri sono
  // scritti: una seconda copia qui divergerebbe al primo filtro nuovo.
  const f = Array.isArray(filtro) ? { categorie: filtro } : (filtro || {});
  const perImpianto = new Map();
  for (const a of cerca({ ...f, impiantoId: '', edificioId: '', localeId: '' })) {
    if (!perImpianto.has(a.impianto_id)) perImpianto.set(a.impianto_id, []);
    perImpianto.get(a.impianto_id).push(a);
  }

  // `vociDelGiro` fa girare il selettore dei piani, e l'albero chiede i conteggi
  // tre volte per presidio (impianto, area, ubicazione): senza memoria sarebbe
  // nove volte lo stesso lavoro. Misurato: 14 ms prima, ~35 ms con memoria,
  // ~170 ms senza. La memoria vive per la durata di UNA chiamata e non può
  // invecchiare.
  const memoria = new Map();
  const av = (id) => {
    if (!memoria.has(id)) memoria.set(id, avanzamentoDi(id));
    return memoria.get(id);
  };

  const conteggi = (lista) => ({
    totale: lista.length,
    // Un nodo dell'albero è «finito» quando ogni presidio ha ricevuto TUTTI i
    // controlli che gli spettano, non quando ognuno ne ha ricevuto uno.
    controllati: lista.filter((a) => av(a.id).completo).length,
    controlli_previsti: lista.reduce((n, a) => n + av(a.id).previsti, 0),
    controlli_fatti: lista.reduce((n, a) => n + av(a.id).fatti, 0),
    // ⛔ `nonConformi` non c'è più (20/09/2026, segnalazione dell'operatore:
    // «lo stato lo avevamo detto superfluo se sfruttiamo correttamente le
    // anomalie»). Misurato sull'archivio prima di toglierlo: **214 presidi
    // risultavano «da sistemare» e 210 avevano anomalie aperte — lo stesso
    // insieme**; gli altri quattro erano NON_PREVISTO, cioè una decisione e non
    // un difetto, e chiamarli «da sistemare» era falso. Zero presidi erano non
    // idonei per pezzi guasti o piani falliti senza un'anomalia scritta.
    //
    // Al suo posto due fatti che NON si ripetono: i pezzi guasti (una riga che
    // vale dodici lampade e ne dichiara tre rotte lo dice qui) e le anomalie.
    // Che l'insieme resti quello lo sorveglia `test_stato_campo.mjs`: se un
    // giorno un presidio diventasse non idoneo senza anomalia né guasti,
    // l'albero smetterebbe di dirlo, e la prova diventa rossa nominandolo.
    guasti: lista.reduce((n, a) => n + (Number.parseInt(a.quantita_ko || '0', 10) || 0), 0),
    anomalie: lista.reduce((n, a) => n + anomalieDi(a.id).length, 0),
    presidi: lista.reduce((n, a) => n + (Number.parseInt(a.quantita || '0', 10) || 0), 0),
  });

  const previsti = impiantiPrevisti();
  const out = [];
  for (const [impId, assets] of perImpianto) {
    const imp = idx.impianti.get(impId);
    const perEdificio = new Map();
    const senzaEdificio = [];
    for (const a of assets) {
      if (!a.edificio_id) { senzaEdificio.push(a); continue; }
      if (!perEdificio.has(a.edificio_id)) perEdificio.set(a.edificio_id, []);
      perEdificio.get(a.edificio_id).push(a);
    }

    const edifici = [];
    for (const [ediId, lista] of perEdificio) {
      const edi = idx.edifici.get(ediId);
      const perLocale = new Map();
      const senzaLocale = [];
      for (const a of lista) {
        if (!a.locale_id) { senzaLocale.push(a); continue; }
        if (!perLocale.has(a.locale_id)) perLocale.set(a.locale_id, []);
        perLocale.get(a.locale_id).push(a);
      }
      const locali = [...perLocale].map(([locId, l]) => ({
        id: locId,
        nome: (idx.locali.get(locId) || {}).denominazione || '(ubicazione)',
        piano: (idx.locali.get(locId) || {}).piano || '',
        assets: l,
        ...conteggi(l),
      })).sort((x, y) => x.nome.localeCompare(y.nome));
      if (senzaLocale.length) {
        locali.push({ id: SENZA_LUOGO, nome: NOME_SENZA.locale, piano: '',
          assets: senzaLocale, ...conteggi(senzaLocale) });
      }
      edifici.push({
        id: ediId,
        nome: (edi || {}).denominazione || '(area)',
        locali,
        assets: lista,
        ...conteggi(lista),
      });
    }
    edifici.sort((x, y) => x.nome.localeCompare(y.nome));
    if (senzaEdificio.length) {
      edifici.push({
        id: SENZA_LUOGO, nome: NOME_SENZA.edificio,
        locali: [{ id: SENZA_LUOGO, nome: NOME_SENZA.locale, piano: '',
          assets: senzaEdificio, ...conteggi(senzaEdificio) }],
        assets: senzaEdificio, ...conteggi(senzaEdificio),
      });
    }

    out.push({
      id: impId,
      previsto: previsti.has(impId),
      nome: (imp || {}).denominazione || '(impianto)',
      tipologia: (imp || {}).tipologia || '',
      edifici,
      assets,
      ...conteggi(assets),
    });
  }
  if (conVuoti) aggiungiLuoghiVuoti(out);
  return out.sort(primaIPrevisti);
}

/**
 * I luoghi dell'anagrafica che con questo filtro non hanno nessun presidio.
 *
 * Perché ci sono, invece di sparire (17/09/2026, richiesta dell'operatore).
 * Un'ubicazione senza presidi si comporta come un'ubicazione che non esiste, e
 * sono due cose diverse: nella prima si può entrare e aggiungere il pezzo che
 * il censimento non aveva registrato — che è esattamente il lavoro che si fa in
 * campo — nella seconda no. Sparendo, quella porta si chiudeva: per creare un
 * presidio in un locale vuoto bisognava crearlo altrove e poi spostarlo.
 *
 * Restano riconoscibili come vuoti (`vuoto: true`, sfondo più scuro), perché un
 * elenco in cui i luoghi pieni e quelli vuoti si somigliano è peggio di uno che
 * nasconde i vuoti: fa contare i luoghi sbagliati.
 */
function aggiungiLuoghiVuoti(out) {
  const zero = {
    totale: 0, controllati: 0, controlli_previsti: 0, controlli_fatti: 0,
    guasti: 0, anomalie: 0, presidi: 0, assets: [], vuoto: true,
  };
  const previsti = impiantiPrevisti();
  const perId = new Map(out.map((i) => [i.id, i]));

  for (const imp of idx.impianti.values()) {
    if (imp.eliminato_il) continue;
    let nodo = perId.get(imp.id);
    if (!nodo) {
      nodo = {
        id: imp.id, previsto: previsti.has(imp.id),
        nome: imp.denominazione || '(impianto)', tipologia: imp.tipologia || '',
        edifici: [], ...zero,
      };
      out.push(nodo);
      perId.set(imp.id, nodo);
    }
    const ediPresenti = new Set(nodo.edifici.map((e) => e.id));
    for (const edi of idx.edifici.values()) {
      if (edi.eliminato_il || edi.impianto_id !== imp.id) continue;
      let nEdi = nodo.edifici.find((e) => e.id === edi.id);
      if (!nEdi) {
        nEdi = { id: edi.id, nome: edi.denominazione || '(area)', locali: [], ...zero };
        nodo.edifici.push(nEdi);
        ediPresenti.add(edi.id);
      }
      for (const loc of idx.locali.values()) {
        if (loc.eliminato_il || loc.edificio_id !== edi.id) continue;
        if (nEdi.locali.some((l) => l.id === loc.id)) continue;
        nEdi.locali.push({
          id: loc.id, nome: loc.denominazione || '(ubicazione)', piano: loc.piano || '',
          ...zero,
        });
      }
      nEdi.locali.sort((x, y) => x.nome.localeCompare(y.nome));
    }
    nodo.edifici.sort((x, y) => x.nome.localeCompare(y.nome));
  }
}

/**
 * Quanti presidi ha ogni luogo, e quanti di questi sono SOSPESI, con i filtri
 * dati MA SENZA la vista del giro (da fare / fatti / sospesi).
 *
 * Serve alla vista «Da fare» (23/09/2026, segnalazione dell'operatore): un
 * luogo in cui è tutto fatto resta in elenco, grigio, ma diceva «nessun
 * presidio — entra per aggiungerne», come uno vuoto davvero. Sono due fatti
 * opposti — «qui c'è niente» e «qui hai finito» — e per dirli diversi bisogna
 * sapere se i presidi ci SONO, fuori dal filtro «da fare».
 *
 * @returns Map id (impianto, area o ubicazione) → `{ presidi, sospesi }`.
 *   Le chiavi sono gli id delle righe; gli uuid non si ripetono fra tabelle.
 */
export function presenzeNeiLuoghi(filtri = {}) {
  const base = { ...filtri, impiantoId: '', edificioId: '', localeId: '',
    soloDaControllare: false, soloControllati: false, soloSospesi: false };
  const out = new Map();
  const somma = (id, k) => {
    if (!id) return;
    if (!out.has(id)) out.set(id, { presidi: 0, sospesi: 0 });
    out.get(id)[k] += 1;
  };
  for (const a of cerca(base)) {
    const sospeso = controllato(a.id) && conVerificheNonEseguibili(a.id) > 0;
    for (const id of [a.impianto_id, a.edificio_id, a.locale_id]) {
      somma(id, 'presidi');
      if (sospeso) somma(id, 'sospesi');
    }
  }
  return out;
}

/** Categorie effettivamente presenti, con quanti presidi ciascuna. */
/**
 * Categorie da offrire nel filtro, con il conteggio nel perimetro corrente.
 *
 * `tutte: true` include anche quelle che qui non hanno nessun presidio.
 *
 * Serve perché un elenco costruito solo dai presidi presenti nasconde le
 * categorie vuote, e nasconderle significa che l'operatore non sa che
 * esistono: nel parco attuale mancano del tutto idranti, gruppi elettrogeni e
 * schiumogeni a servizio di impianto fisso, quindi chi ne trova uno in campo
 * non trova nemmeno il posto dove metterlo. Vederle a zero dice due cose in una:
 * qui non ce ne sono, e la categoria è disponibile.
 */
export function categoriePresenti(filtro = {}) {
  const conta = new Map();
  for (const a of stato.perEntita[E.ASSET] || []) {
    if (a.eliminato_il) continue;
    if (filtro.impiantoId && a.impianto_id !== filtro.impiantoId) continue;
    if (filtro.edificioId && a.edificio_id !== filtro.edificioId) continue;
    if (filtro.localeId && a.locale_id !== filtro.localeId) continue;
    conta.set(a.categoria_codice, (conta.get(a.categoria_codice) || 0) + 1);
  }
  if (filtro.tutte) {
    for (const codice of idx.categorie.keys()) {
      if (!conta.has(codice)) conta.set(codice, 0);
    }
  }
  return [...conta].map(([codice, n]) => ({
    codice, n, categoria: idx.categorie.get(codice) || { descrizione: codice },
  })).sort((x, y) => y.n - x.n
    || (x.categoria.descrizione || '').localeCompare(y.categoria.descrizione || ''));
}

/**
 * I piani che nascerebbero su un presidio ANCORA DA CREARE.
 *
 * Richiesta dell'operatore del 17/09/2026: creando un presidio si deve vedere
 * quali piani di verifica gli verranno assegnati, e poterli cambiare.
 *
 * Perché serve, e non è un vezzo: quali piani si applichino lo decidono i DATI
 * (estinguente, tipo di serbatoio, messa in servizio, anno). Chi compila il
 * modulo non ha modo di sapere che scrivendo «CO2» invece di «polvere» ha
 * cambiato la periodicità della revisione da tre anni a cinque — lo scoprirebbe
 * mesi dopo, dallo scadenzario. Mostrarli mentre si compila trasforma un effetto
 * invisibile in una riga che si legge.
 *
 * `candidato` è l'anagrafica in corso di compilazione: un oggetto con
 * `categoria_codice` e i campi della tipologia. Non serve che esista — le
 * scadenze e gli interventi di un presidio non ancora creato sono vuoti per
 * definizione, e `pianoScelto` guarda solo l'anagrafica.
 */
/**
 * I campi OBBLIGATORI alla creazione di un presidio in campo (23/09/2026,
 * dall'operatore: «i dati obbligatori dovrebbero essere il tipo e i dati che
 * servono per attivare il piano di verifica, ma non per forza la matricola —
 * per gli estintori e le porte REI sì, per gli altri no»).
 *
 * Due fonti, e la seconda non è scritta a mano:
 *  * `OBBLIGATORI_PER_CATEGORIA` — le eccezioni dichiarate: la matricola di
 *    estintori e porte REI, e l'anno di costruzione dell'estintore (decide il
 *    fine vita, 18 anni: senza, il pezzo non esce mai dal servizio);
 *  * i campi su cui i PIANI mettono una condizione, ricavati dal catalogo: un
 *    campo è obbligatorio se c'è un piano che lo guarda e le cui ALTRE
 *    condizioni non sono già false con quello che si è scritto. Così il tipo di
 *    serbatoio diventa obbligatorio solo scegliendo «schiuma», e la messa in
 *    servizio solo scegliendo «polvere» — che è quando decidono qualcosa.
 *
 * Vale SOLO alla creazione: sui presidi che arrivano dall'archivio mancano dati
 * a centinaia, e pretenderli a ogni modifica bloccherebbe il lavoro di campo.
 *
 * @returns `[{ nome, etichetta, perche }]`
 */
export const OBBLIGATORI_PER_CATEGORIA = {
  ESTINTORE: {
    matricola: 'è scritta sul pezzo, e lega revisioni e collaudi al pezzo giusto',
    anno_costruzione: 'decide il fine vita (18 anni dalla costruzione)',
  },
  PORTA_REI: {
    matricola: 'è sulla targhetta della porta, e identifica la certificazione',
  },
};
export function obbligatoriAllaCreazione(candidato) {
  const cat = idx.categorie.get(candidato && candidato.categoria_codice);
  if (!cat) return [];
  const perche = new Map(Object.entries(OBBLIGATORI_PER_CATEGORIA[cat.codice] || {}));
  for (const piano of idx.piani || []) {
    if (piano.tipo_asset_codice !== cat.tipo_asset_codice) continue;
    if (String(piano.attivo ?? '1') === '0') continue;
    const cond = idx.condizioniPerPiano.get(piano.id) || [];
    for (const c of cond) {
      if (c.campo === 'categoria_codice' || perche.has(c.campo)) continue;
      const altre = cond.filter((x) => x !== c);
      if (PV.pianoApplicabile(altre, candidato, stato.campi) === PV.FALSO) continue;
      // ⚠️ «vale», non «si applica» seguito da una parentesi:
      // `test_azioni_complete.py` riconosce chi scrive dalla chiamata alla
      // funzione di scrittura, e la trova anche dentro un testo.
      perche.set(c.campo, `decide quale piano vale: ${piano.denominazione || piano.id}`);
    }
  }
  const perNome = new Map((stato.campi || []).map((x) => [x.nome, x]));
  return [...perche].map(([nome, p]) => ({
    nome, etichetta: (perNome.get(nome) || {}).etichetta || nome, perche: p,
  }));
}

export function pianiProposti(candidato) {
  const cat = idx.categorie.get(candidato && candidato.categoria_codice);
  if (!cat) return [];
  const tipo = cat.tipo_asset_codice;
  const out = [];
  for (const tc of idx.tipiControllo.values()) {
    const piano = PV.pianoScelto(idx.piani, idx.condizioniPerPiano, candidato,
                                 tipo, tc.codice, stato.campi, []);
    if (!piano) continue;
    out.push({
      tipo_controllo_codice: tc.codice,
      controllo: tc.descrizione || tc.codice,
      piano_id: piano.id,
      denominazione: piano.denominazione || tc.descrizione || tc.codice,
      frequenza_valore: piano.frequenza_valore,
      frequenza_unita: piano.frequenza_unita,
      norma: piano.norma || '',
    });
  }
  return out.sort((x, y) => x.denominazione.localeCompare(y.denominazione));
}

// --------------------------------------------------------------------------- //
// Tipi di controllo applicabili e scadenze
// --------------------------------------------------------------------------- //
/**
 * Se lo stato di questo presidio sospenda il lavoro su di lui.
 *
 * È l'UNICO effetto meccanico che lo stato ha, e per questo sta in una funzione
 * sola: chiunque debba chiedersi «qui c'è da fare qualcosa?» passa di qui, e
 * non esiste un secondo posto dove ricordarsene. La risposta non è cablata su
 * un elenco di codici — la porta il catalogo, nella colonna
 * `sospende_scadenze`, e il pacchetto la trasporta già: uno stato nuovo entra
 * in vigore senza toccare questo file.
 */
export function sospendeLavoro(a) {
  if (!a || !a.stato_codice) return false;
  const st = idx.stati && idx.stati.get(a.stato_codice);
  return !!(st && Number(st.sospende_scadenze) === 1);
}

/**
 * I tipi di controllo che hanno senso per un presidio, con la scadenza aperta
 * se c'è e l'ultima esecuzione nota.
 *
 * Si ricavano dalle regole di periodicità che arrivano nel pacchetto: così
 * l'operatore vede "questo estintore vuole CONTROLLO ogni 6 mesi e REVISIONE
 * ogni 36" senza che l'elenco debba essere ricalcolato in ufficio.
 *
 * ⛔ Uno stato che sospende lo scadenzario spegne TUTTO l'elenco (20/09/2026).
 * Era il divario fra i due gemelli, e il modo in cui si nascondeva è la parte
 * che vale la pena ricordare: **l'ufficio la sospensione la applicava già** —
 * `ricalcola_scadenze` salta i presidi sospesi e ANNULLA le loro scadenze
 * aperte — mentre qui nessuno leggeva `sospende_scadenze`. Ognuno dei due lati
 * era coerente con sé stesso, e il pacchetto passava di mano senza un errore.
 *
 * Misurato sul pacchetto vero, prima di correggere: 4 postazioni `NON_PREVISTO`
 * chiedevano **8 controlli** su 1497. E l'annullamento fatto in ufficio non le
 * zittiva: le rendeva più rumorose. Senza scadenza aperta il ramo «mai
 * eseguito» di `vociDelGiro` accende la voce proprio PERCHÉ non c'è una data —
 * quindi la difesa dell'ufficio, arrivata in campo, produceva l'effetto
 * opposto al suo.
 *
 * Il numero è piccolo oggi e non lo resta: `dismettiPresidio` scrive DISMESSO
 * a ogni presidio tolto e non sostituito, cioè fabbrica questi casi.
 */
// --------------------------------------------------------------------------- //
// Correzioni DI CAMPO al catalogo dei piani (24/09/2026)
// --------------------------------------------------------------------------- //
//
// ⛔ Perché qui e non nel catalogo: il catalogo viaggia DENTRO i pacchetti, e
// quelli già sui telefoni non si rigenerano. Richiesta dell'operatore: «la
// modifica non deve corrompere i pacchetti aperti in corso, e deve semplificare
// la gestione sul campo». Queste due correzioni cambiano solo come il campo
// PRESENTA e VALIDA un piano: nessuna colonna, nessun dato scritto in modo
// diverso. Misurato che l'ufficio le accetta al rientro: l'import non applica la
// regola di IDONEO alle registrazioni di campo, e non ha nessuna regola sul fine
// vita — un «idoneo» sulla verifica dei 12 anni fa ripartire i 12 anni anche lì
// (`esecuzione_vale`).
//
// Che fine fanno (24/09/2026, dopo «il seme non lo useremo più»):
//  * le VOCI ALTERNATIVE si correggono anche nel catalogo, all'ESPORTAZIONE
//    (`datiDaEsportare`): dopo un giro di pacchetto sono giuste ovunque, e qui
//    diventano inerti;
//  * pv-29 NON fine vita resta invece qui, ed è una scelta: il catalogo lo
//    direbbe solo cambiando il tipo di controllo (ROTTAMAZIONE →
//    VERIFICA_GENERALE), e le scadenze e i controlli già registrati sono
//    indicizzati per tipo — la storia dei rivelatori andrebbe riscritta, e un
//    controllo dei 12 anni già fatto risulterebbe mai eseguito.

/**
 * pv-29, «Verifica generale dei rivelatori di fumo (12 anni)», sta nel catalogo
 * sotto ROTTAMAZIONE, ma NON è un fine vita: la UNI 11224 a dodici anni dà tre
 * strade — revisione in fabbrica, sostituzione, prova reale con fuoco — e due
 * su tre sono una verifica che, se passa, fa ripartire i dodici anni. In campo
 * si registra come una verifica: idoneo, non idoneo, non eseguibile.
 */
const PIANI_VERIFICA_NON_FINE_VITA = new Set(['pv-29']);
/**
 * Le tre strade di pv-29 sono ALTERNATIVE, e il catalogo le dichiara tutte
 * obbligatorie: per dichiarare idoneo bisognava spuntare anche le due non fatte.
 * In campo valgono «solo in certi casi»; resta obbligatoria la voce che dice di
 * sceglierne una (pv-29-a2).
 */
const VOCI_ALTERNATIVE_DI_CAMPO = new Set(['pv-29-a3', 'pv-29-a4', 'pv-29-a5']);

/** Questo controllo è un FINE VITA (una data: il pezzo si sostituisce)? */
export function eFineVita(codice, pianoId) {
  return codice === 'ROTTAMAZIONE' && !PIANI_VERIFICA_NON_FINE_VITA.has(pianoId || '');
}

/** Le voci di un piano, con le correzioni di campo (vedi sopra). */
export function azioniDelPiano(pianoId) {
  return (idx.azioniPerPiano.get(pianoId) || [])
    .map((z) => (VOCI_ALTERNATIVE_DI_CAMPO.has(z.id) ? { ...z, obbligatoria: '0' } : z));
}

export function controlliApplicabili(a) {
  if (sospendeLavoro(a)) return [];
  const oggi = new Date();
  const tipo = tipoAssetDi(a);
  const scadenze = idx.scadenzePerAsset.get(a.id) || [];
  const interventi = idx.interventiPerAsset.get(a.id) || [];
  const out = [];

  for (const tc of idx.tipiControllo.values()) {
    const eccezioni = idx.eccezioniPerAsset.get(a.id) || [];
    const piano = PV.pianoScelto(idx.piani, idx.condizioniPerPiano, a,
                                 tipo, tc.codice, stato.campi, eccezioni);
    const causa = piano
      ? null
      : PV.diagnosi(idx.piani, idx.condizioniPerPiano, a, tipo, tc.codice, stato.campi);

    // `causa === null` senza piano vuol dire che il controllo non è previsto
    // per questa tipologia: non è un silenzio da spiegare, è una domanda che
    // non si pone. Non compare in elenco.
    if (!piano && causa === null) continue;

    const sc = scadenze
      .filter((x) => x.tipo_controllo_codice === tc.codice
        && (x.stato || 'APERTA') === 'APERTA')
      .sort((x, y) => (x.data_scadenza || '').localeCompare(y.data_scadenza || ''))[0];
    // Solo i controlli del PEZZO montato adesso (18/09/2026): quelli fatti sul
    // pezzo che è stato portato via non dicono niente su quello che c'è ora.
    // Sugli interventi senza matricola — tutti quelli nati prima della colonna —
    // `valePerIlPezzo` risponde vero, quindi qui non cambia niente finché
    // nessuno sostituisce un pezzo.
    const eseguiti = interventi
      .filter((x) => x.tipo_controllo_codice === tc.codice
        && CAL.valePerIlPezzo(x.matricola_pezzo, a.matricola))
      .sort((x, y) => (y.data || '').localeCompare(x.data || ''));

    // ⛔ La scadenza DALLA DATA DI PARTENZA (24/09/2026, segnalazione
    // dell'operatore: «la data la inserisco, ma non me la fa registrare, come se
    // non l'avessi inserita» — rilevatori di idrogeno, fine vita). La data si
    // salvava; mancava questa metà della regola dell'ufficio. Senza una
    // scadenza nel pacchetto e senza un'esecuzione che valga, un controllo MAI
    // eseguito si conta dalla messa in servizio / installazione / costruzione
    // (`ancoraDiCalcolo`, gemella di `ancora_di_calcolo`) — che è esattamente
    // ciò che farà l'ufficio al rientro. Prima restava «da calcolare» fino ad
    // allora, e il fine vita, che non si esegue mai, non si calcolava mai.
    //
    // ⚠️ Solo in MEMORIA: non è una riga del pacchetto e non si esporta. Al
    // rientro l'ufficio ricalcola le scadenze dalla data che viaggia
    // nell'anagrafica. `scadenza_calcolata` lo distingue da una scadenza
    // dell'ufficio, per chi la mostra. Niente per i tipi che non generano
    // scadenze (`genera_scadenza = 0`: la sorveglianza), come in ufficio.
    const ultimaValida = CAL.ultimaEsecuzione(eseguiti);
    const dp = CAL.dateDelPresidio(a);
    const ancora = (!sc && piano && !ultimaValida && String(tc.genera_scadenza ?? '1') !== '0')
      ? CAL.ancoraDiCalcolo(piano.base_calcolo || tc.base_calcolo, dp.messaServizio, dp.installazione, dp.costruzione)
      : null;
    const dallaPartenza = ancora
      ? CAL.prossimaScadenza(ancora, piano.frequenza_valore, piano.frequenza_unita) : null;
    // ⛔ QUALI dati mancano a QUESTO controllo (24/09/2026, dall'operatore: «i
    // campi da compilare relativi alla data mancante andrebbero messi proprio
    // dove c'è il controllo da eseguire, dinamici: uno o più a seconda del
    // caso»). Si deduce dalla stessa regola che calcola la scadenza, così la
    // riga chiede esattamente ciò che la sblocca: il fine vita che si conta
    // dalla COSTRUZIONE vuole l'anno, gli altri una qualunque delle tre date;
    // un piano che non si sceglie per un dato mancante vuole quel dato.
    const serveData = !sc && piano && !ultimaValida && String(tc.genera_scadenza ?? '1') !== '0' && !dallaPartenza;
    const base = piano ? (piano.base_calcolo || tc.base_calcolo || CAL.BASE_MESSA_SERVIZIO) : '';
    const datiPerScadenza = serveData
      ? (base === CAL.BASE_COSTRUZIONE ? ['anno_costruzione']
        : ['data_messa_servizio', 'data_installazione', 'anno_costruzione'])
      : (causa === 'DATO_MANCANTE'
        ? [...new Set(mancanzeDeterminanti(a).flatMap((m) => m.campi || [m.campo]))]
          .filter((c) => c !== 'matricola')
        : []);
    const scadenza = sc ? sc.data_scadenza : dallaPartenza;

    out.push({
      codice: tc.codice,
      indeterminato: !piano,
      piano_id: piano ? piano.id : null,
      // La denominazione del piano dice di più del nome del tipo di controllo:
      // «Revisione — polvere immessa sul mercato ante 25/07/2024» invece di
      // «REVISIONE».
      descrizione: (piano && piano.denominazione) || tc.descrizione || tc.codice,
      norma: (piano && piano.norma) || tc.norma || '',
      frequenza_valore: piano ? Number(piano.frequenza_valore) || null : null,
      frequenza_unita: piano ? (piano.frequenza_unita || 'MESI') : null,
      frequenza_testo: piano
        ? PV.etichettaFrequenza(piano.frequenza_valore, piano.frequenza_unita) : '',
      // Che cosa fare, in ordine: è la ragione per cui i piani esistono.
      azioni: piano ? azioniDelPiano(piano.id) : [],
      // 0 = la periodicità non è mai stata confrontata con il testo della
      // norma. Va mostrata: il campo `norma` si legge come una citazione e non
      // lo è, e un operatore che vede «UNI 9994-1 — ogni 60 mesi» non ha modo
      // di sapere che quel 60 non l'ha verificato nessuno.
      verificata: piano ? Number(piano.verificata || 0) === 1 : false,
      fonte: (piano && piano.fonte) || '',
      deroga: (eccezioni.find((e) => e.piano_id === (piano && piano.id))) || null,
      scadenza,
      // Vero quando la scadenza l'ha calcolata l'app dalla data di partenza,
      // e non l'ufficio: l'ufficio la conferma al rientro.
      scadenza_calcolata: !sc && Boolean(dallaPartenza),
      // I campi che, compilati, danno una scadenza a questo controllo (vedi
      // sopra). Vuoto quando non manca niente.
      dati_per_scadenza: datiPerScadenza,
      // Se la scadenza aperta non c'è più — perché il controllo è appena stato
      // eseguito — la prossima si calcola con la stessa regola dell'ufficio:
      // ultima esecuzione + periodicità. Senza, subito dopo aver fatto il lavoro
      // la scheda non sapeva dire quando si torna, e la risposta arrivava solo
      // al rientro.
      prossima_calcolata: (!sc && piano && eseguiti.length)
        ? CAL.prossimaScadenza(CAL.ultimaEsecuzione(eseguiti),
                               piano.frequenza_valore, piano.frequenza_unita)
        : null,
      semaforo: scadenza ? semaforo(scadenza, oggi) : null,
      ultimo: eseguiti[0] || null,
      // «Fatto in questo giro» lo decide `interventoNelGiro`, come per
      // l'avanzamento. Qui c'era una seconda definizione, e sbagliava:
      //
      //     eseguiti.some((x) => !stato.sessione.sessione_id || x.sessione_id === ...)
      //
      // Senza un id di sessione — che `iniziaGiro` non assegna — la prima metà
      // dell'OR è vera sempre, quindi QUALUNQUE controllo presente in archivio
      // risultava «fatto in questo giro». Sulla scheda del presidio compariva la
      // fascia verde «✓ fatto in questo giro» su una revisione del 2019, e i due
      // pulsanti per eseguirla sparivano.
      //
      // Trovato costruendo la schermata in una prova automatica: la riga aveva
      // un pulsante invece di due.
      fatto_nel_giro: eseguiti.some(interventoNelGiro),
      // Registrato in questo giro, ma eseguito? «Non accessibile» chiude la riga
      // come fatta e però non conta per il pulsante «fatto» del presidio
      // (`vociDelGiro`): la riga deve dirlo, altrimenti le due cose si contraddicono.
      eseguito_nel_giro: eseguiti.some((i) => interventoNelGiro(i) && ESITI_ESEGUITI.includes(i.esito)),
      // Il motivo nomina il RIMEDIO, non solo la causa: i due casi si chiudono
      // in modi opposti e chi legge in campo può agire solo sul primo.
      motivo: causa === 'DATO_MANCANTE'
        ? 'manca un dato del presidio: compilalo e la scadenza si calcola'
        : (causa === 'LACUNA_TABELLA'
          ? 'nessun piano di verifica copre questo caso: serve chi conosce la norma'
          : undefined),
    });
  }

  const ordine = { SCADUTO: 0, IN_SCADENZA: 1, REGOLARE: 2 };
  return out.sort((x, y) => (ordine[x.semaforo] ?? 3) - (ordine[y.semaforo] ?? 3)
    || x.descrizione.localeCompare(y.descrizione));
}

// --------------------------------------------------------------------------- //
// Metadati dei campi
// --------------------------------------------------------------------------- //
/**
 * I campi RITIRATI: tolti dai metadati e da non mostrare MAI più.
 *
 * Perché serve un elenco qui, e non basta toglierli dal server (17/09/2026).
 * I metadati dei campi viaggiano DENTRO il pacchetto, quindi un pacchetto
 * esportato prima del ritiro li porta ancora — e l'app di campo, che disegna il
 * modulo da lì, li rimette a schermo. Segnalato dall'operatore: la casella
 * «Carrellato» ricompariva accanto alla tendina «Tipo di installazione», cioè
 * esattamente la ridondanza che era stata tolta il 16/09.
 *
 * Non è un dettaglio estetico: due campi per lo stesso fatto sono due verità che
 * divergono al primo che qualcuno compila. E il pacchetto di un giro può restare
 * fuori per settimane, quindi «si risolve al prossimo export» vuol dire «resta
 * rotto per tutto il giro».
 *
 * I DATI non si toccano: la colonna esiste ancora nel pacchetto e rientra in
 * archivio invariata. Qui si smette solo di CHIEDERLA.
 */
export const CAMPI_RITIRATI = new Set([
  // 16/09/2026: lo stesso fatto stava nella casella «Carrellato» e nella tendina
  // «Tipo di installazione», che sa dire anche FISSA (una bombola a servizio di
  // un impianto non è né portatile né carrellata).
  'carrellato',
]);

export function campiPerCategoria(categoria) {
  return (stato.campi || [])
    .filter((c) => !CAMPI_RITIRATI.has(c.nome))
    .filter((c) => !c.categorie || c.categorie.includes(categoria));
}

export function gruppiPerCategoria(categoria, soloCampo = false) {
  const campi = campiPerCategoria(categoria)
    .filter((c) => (soloCampo ? c.campo_campo : true));
  const perGruppo = new Map();
  for (const c of campi) {
    if (!perGruppo.has(c.gruppo)) {
      perGruppo.set(c.gruppo, { codice: c.gruppo, etichetta: c.gruppo_etichetta || c.gruppo, campi: [] });
    }
    perGruppo.get(c.gruppo).campi.push(c);
  }
  return [...perGruppo.values()];
}

/** Opzioni di una tendina, comprese quelle che dipendono da un altro campo. */
export function opzioniCampo(campo, valori = {}) {
  if (campo.opzioni) return campo.opzioni.map((o) => ({ valore: o, testo: o }));
  switch (campo.opzioni_da) {
    case 'stati':
      return [...idx.stati.values()].map((s) => ({ valore: s.codice, testo: s.descrizione || s.codice }));
    case 'categorie':
      return [...idx.categorie.values()].map((c) => ({
        valore: c.codice, testo: `${c.icona || ''} ${c.descrizione}`.trim() }));
    case 'impianti':
      return [...idx.impianti.values()]
        .map((i) => ({ valore: i.id, testo: i.denominazione }))
        .sort((a, b) => a.testo.localeCompare(b.testo));
    case 'edifici':
      return (idx.edificiPerImpianto.get(valori.impianto_id) || [])
        .map((e) => ({ valore: e.id, testo: e.denominazione }))
        .sort((a, b) => a.testo.localeCompare(b.testo));
    case 'locali':
      return (idx.localiPerEdificio.get(valori.edificio_id) || [])
        .map((l) => ({ valore: l.id, testo: l.piano ? `${l.denominazione} (${l.piano})` : l.denominazione }))
        .sort((a, b) => a.testo.localeCompare(b.testo));
    case 'centraline_impianto':
      // Le centraline dello STESSO IMPIANTO, non dello stesso edificio: nei dati
      // veri i rilevatori di un edificio possono appartenere alla centralina di
      // un altro, e SUVERETO ha sei centraline in un impianto solo. Restringere
      // all'edificio nasconderebbe proprio quella giusta.
      return (stato.perEntita[E.ASSET] || [])
        .filter((a) => !a.eliminato_il
          && a.categoria_codice === 'CENTRALINA'
          && a.impianto_id === valori.impianto_id)
        .map((a) => ({
          valore: a.codice,
          testo: [a.identificativo || a.codice, ubicazione(a), a.marca].filter(Boolean).join(' · '),
        }))
        .sort((a, b) => a.testo.localeCompare(b.testo));
    case 'tipi_controllo':
      return [...idx.tipiControllo.values()].map((t) => ({ valore: t.codice, testo: t.descrizione || t.codice }));
    case 'operatori':
      return (stato.perEntita[E.OPERATORE] || []).map((o) => ({ valore: o.id, testo: o.nome }));
    default:
      return [];
  }
}

/** Stessa validazione del lato Python: l'errore si vede in campo, non al rientro. */
export function validaCampo(campo, valore) {
  if (valore === null || valore === undefined || valore === '') {
    return campo.obbligatorio ? `${campo.etichetta}: obbligatorio.` : null;
  }
  if (campo.tipo === 'intero' || campo.tipo === 'decimale') {
    const n = Number(String(valore).replace(',', '.'));
    if (!Number.isFinite(n)) return `${campo.etichetta}: deve essere un numero.`;
    if (campo.tipo === 'intero' && !Number.isInteger(n)) return `${campo.etichetta}: deve essere un numero intero.`;
    if (campo.min !== null && campo.min !== undefined && n < campo.min) {
      return `${campo.etichetta}: non può essere minore di ${campo.min}.`;
    }
    if (campo.max !== null && campo.max !== undefined && n > campo.max) {
      return `${campo.etichetta}: non può essere maggiore di ${campo.max}.`;
    }
  } else if (campo.tipo === 'data') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valore).trim())) {
      return `${campo.etichetta}: la data va in formato AAAA-MM-GG.`;
    }
  } else if (campo.tipo === 'scelta' && campo.opzioni && !campo.opzioni.includes(String(valore))) {
    return `${campo.etichetta}: valore '${valore}' non ammesso.`;
  }
  return null;
}

/**
 * Campi vuoti che è importante mostrare lo stesso, con il perché.
 *
 * Il caso concreto: senza data di messa in servizio o anno di costruzione il
 * presidio resta fuori dallo scadenzario. Se la scheda nascondesse i campi
 * vuoti, l'operatore non avrebbe modo di sapere perché quel presidio non ha
 * scadenze — e sono 321 su 352.
 */
export function mancanzeDeterminanti(a) {
  const out = [];
  if (!a.data_messa_servizio && !a.anno_costruzione && !a.data_installazione) {
    out.push({
      campo: 'data_messa_servizio',
      // ⛔ `campi` dal 22/09/2026: QUALI campi sbloccano questa mancanza. Sono
      // tre e ne basta uno — la periodicità si calcola dalla prima data
      // disponibile — e l'elenco serve al foglio che li chiede, per non
      // costringere l'operatore a passare dall'anagrafica intera.
      campi: ['data_messa_servizio', 'data_installazione', 'anno_costruzione'],
      messaggio: 'Senza messa in servizio, installazione o anno di costruzione questo '
        + 'presidio non entra nello scadenzario: le periodicità si calcolano da lì.',
    });
  }
  if (a.tipo_asset_codice === 'ESTINTORE') {
    if (!a.estinguente) {
      out.push({ campo: 'estinguente', campi: ['estinguente'],
        messaggio: "Senza estinguente non si può scegliere fra le regole UNI 9994-1: "
          + 'polvere e CO2 hanno periodicità diverse.' });
    }
    if (!a.matricola) {
      out.push({ campo: 'matricola', campi: ['matricola'],
        messaggio: "Senza matricola l'estintore non è distinguibile dagli altri con lo "
          + 'stesso #ID, che non è univoco a livello di unità impianti.' });
    }
  }
  return out;
}

/**
 * Le verifiche di questo presidio che NON hanno una scadenza calcolabile.
 *
 * ⛔ 22/09/2026, segnalazione dell'operatore: «quando manca la data di messa in
 * servizio, il controllo non lo fa fare ma lo tiene come da fare; deve essere
 * più chiaro che va messa la data».
 *
 * Misurato: **185 presidi su 875** hanno almeno una verifica in questo stato —
 * 191 verifiche in tutto — e tutte per lo stesso motivo, la data che manca. Il
 * presidio resta fra i «da fare» per sempre: non c'è una scadenza da assolvere,
 * quindi il ramo «mai eseguito» lo riaccende a ogni giro.
 *
 * ⚠️ La domanda non è «manca un dato?» ma «manca un dato CHE SERVE QUI?». I
 * presidi a cui manca la messa in servizio sono 434, ma su 249 di loro la
 * periodicità si calcola lo stesso dall'anno di costruzione o dalla data di
 * installazione: mostrare un avviso anche a quelli vorrebbe dire mostrarlo su
 * metà del parco, e un avviso sempre acceso non avverte di niente.
 */
export function verificheSenzaScadenza(a) {
  if (!a) return [];
  return controlliApplicabili(a)
    .filter((t) => !t.scadenza && !t.prossima_calcolata)
    .map((t) => ({ codice: t.codice, descrizione: t.descrizione }));
}

// --------------------------------------------------------------------------- //
// Ricerca
// --------------------------------------------------------------------------- //
/**
 * Un evento del giornale, in italiano.
 *
 * ⛔ Perché esiste (20/09/2026, segnalazione dell'operatore: «il registro delle
 * modifiche non sembra che recepisca i controlli, la modifica anagrafica, la
 * posizione»).
 *
 * Misurato: il giornale li RECEPISCE tutti — un controllo fa `intervento/INSERT`,
 * una modifica fa `asset/UPDATE`, la posizione fa `asset/UPDATE`, un luogo fa
 * `edificio/CREATE`. Il difetto era nella schermata, che mostrava le due colonne
 * grezze: «asset · UPDATE». Tre azioni diverse — cambiare le note, salvare la
 * posizione, correggere la quantità — si leggevano tutte allo stesso modo, e
 * nessuna si riconosceva come la cosa che si era appena fatta. Un registro che
 * non si riconosce è indistinguibile da un registro che non registra: è la
 * conclusione a cui l'operatore è arrivato, ed era ragionevole.
 *
 * Il payload contiene già `prima` e `dopo`: nessuno lo apriva.
 *
 * @returns `{ cosa, azione, dettaglio }` — il soggetto, che cosa gli è successo,
 *          e con quale contenuto. Tutti e tre stringhe, mai `undefined`: una
 *          cella vuota in una tabella si legge come un dato mancante.
 */
export function descriviEvento(ev) {
  const vuoto = { cosa: '', azione: '', dettaglio: '' };
  if (!ev) return vuoto;

  let p = ev.payload;
  if (typeof p === 'string') {
    try { p = JSON.parse(p); } catch { p = null; }
  }
  p = p && typeof p === 'object' ? p : {};

  const nomeCampo = (n) => {
    const c = (stato.campi || []).find((x) => x.nome === n);
    return (c && c.etichetta) || n;
  };
  const elenco = (o) => Object.keys(o || {}).map(nomeCampo).join(', ');

  // Il SOGGETTO. Un presidio si nomina come lo chiama l'operatore, non con il
  // suo uuid: «53cff67d-…» in una tabella non è un'informazione, è rumore.
  const nomeAsset = (id) => {
    const a = idx.assets.get(id);
    if (!a) return 'presidio non più in archivio';
    // La categoria dal catalogo: `a.categoria` è una colonna di contesto che
    // scrive l'ufficio, e un presidio creato in campo non ce l'ha (26/09/2026).
    return [a.identificativo || a.codice, (categoriaDi(a) || {}).descrizione || a.categoria].filter(Boolean).join(' · ');
  };
  const nomeLuogo = (mappa, id, tipo) => {
    const l = idx[mappa].get(id);
    return l ? `${tipo} «${l.denominazione}»` : `${tipo} non più in archivio`;
  };

  switch (ev.entita) {
    case 'intervento': {
      const iv = (stato.perEntita[E.INTERVENTO] || []).find((x) => x.id === ev.entita_id);
      const tc = iv && idx.tipiControllo.get(iv.tipo_controllo_codice);
      const esiti = {
        IDONEO: 'idoneo', NON_IDONEO: 'non idoneo',
        NON_ESEGUITO: 'non eseguito', NON_ACCESSIBILE: 'non accessibile',
      };
      return {
        cosa: iv ? nomeAsset(iv.asset_id) : 'controllo',
        azione: ev.operazione === 'DELETE' ? 'Controllo annullato' : 'Controllo registrato',
        dettaglio: [(tc && tc.descrizione) || (iv && iv.tipo_controllo_codice),
          iv && esiti[iv.esito]].filter(Boolean).join(' — '),
      };
    }
    case 'asset': {
      const dopo = p.dopo || {};
      const chiavi = Object.keys(dopo);
      // La POSIZIONE è un'azione a sé anche se tecnicamente è una modifica
      // dell'anagrafica: è quello che l'operatore ha fatto, ed è quello che
      // deve ritrovare scritto.
      const soloPosizione = chiavi.length > 0
        && chiavi.every((k) => ['lat', 'lon', 'gps_accuratezza_m', 'gps_rilevato_il'].includes(k));
      if (soloPosizione) {
        const acc = dopo.gps_accuratezza_m;
        return {
          cosa: nomeAsset(ev.entita_id),
          azione: dopo.lat ? 'Posizione salvata' : 'Posizione tolta',
          dettaglio: dopo.lat
            ? `${dopo.lat}, ${dopo.lon}${acc ? ` · ±${acc} m` : ''}` : '',
        };
      }
      const azioni = {
        INSERT: 'Presidio creato in campo',
        CREATE: 'Presidio creato in campo',
        DELETE: 'Presidio segnalato rimosso',
        UPDATE: 'Anagrafica modificata',
      };
      return {
        cosa: nomeAsset(ev.entita_id),
        azione: azioni[ev.operazione] || ev.operazione,
        dettaglio: ev.operazione === 'UPDATE' ? elenco(dopo) : '',
      };
    }
    case 'anomalia': {
      const an = (stato.perEntita[E.ANOMALIA] || []).find((x) => x.id === ev.entita_id);
      return {
        cosa: an ? nomeAsset(an.asset_id) : 'anomalia',
        azione: ev.operazione === 'INSERT' ? 'Anomalia aperta' : 'Anomalia aggiornata',
        dettaglio: [(an && an.descrizione) || '', (p.dopo || {}).stato || ''].filter(Boolean)
          .join(' — ').slice(0, 90),
      };
    }
    case 'sostituzione':
      return { cosa: nomeAsset((p.asset_id) || ev.entita_id),
        azione: 'Pezzo sostituito', dettaglio: '' };
    case 'impianto':
    case 'edificio':
    case 'locale': {
      const tipo = { impianto: 'Impianto', edificio: 'Area', locale: 'Ubicazione' }[ev.entita];
      const mappa = { impianto: 'impianti', edificio: 'edifici', locale: 'locali' }[ev.entita];
      // L'impianto è maschile: «Impianto creata» si leggeva nel registro.
      const verbi = ev.entita === 'impianto'
        ? { CREATE: 'creato', UPDATE: 'rinominato', DELETE: 'eliminato' }
        : { CREATE: 'creata', UPDATE: 'rinominata', DELETE: 'eliminata' };
      const cosa = ev.operazione === 'DELETE'
        ? `${tipo} «${(p.denominazione) || '—'}»` : nomeLuogo(mappa, ev.entita_id, tipo);
      // I campi CAMBIATI: `dopo` dal 23/09/2026, l'evento intero prima.
      const cambiati = ev.operazione === 'UPDATE' ? ((p.prima && p.dopo) ? p.dopo : p) : {};
      // ⛔ Una POSIZIONE si scrive come posizione, non come «rinominata»: è
      // quello che è stato fatto — sul luogo come sul presidio — ed è quello
      // che l'operatore cerca nel registro dopo aver trascinato un punto.
      if (ev.operazione === 'UPDATE' && p.annulla_evento) {
        return { cosa, azione: 'Modifica annullata', dettaglio: elenco(p.dopo) };
      }
      const chiaviPos = ['lat', 'lon', 'gps_accuratezza_m', 'gps_rilevato_il', 'coordinate_origine'];
      if (ev.operazione === 'UPDATE' && Object.keys(cambiati).length
        && Object.keys(cambiati).every((k) => chiaviPos.includes(k))) {
        const acc = cambiati.gps_accuratezza_m;
        return {
          cosa,
          azione: cambiati.lat ? 'Posizione salvata' : 'Posizione tolta',
          dettaglio: cambiati.lat ? `${cambiati.lat}, ${cambiati.lon}${acc ? ` · ±${acc} m` : ''}` : '',
        };
      }
      return {
        cosa,
        azione: `${tipo === 'Impianto' ? 'Impianto' : tipo} ${verbi[ev.operazione] || ev.operazione}`,
        dettaglio: ev.operazione === 'UPDATE' ? elenco(cambiati) : '',
      };
    }
    case 'giro':
      return { cosa: 'Il giro', azione: (p && p.evento) || ev.operazione, dettaglio: '' };
    default:
      return { cosa: ev.entita || '', azione: ev.operazione || '', dettaglio: '' };
  }
}

/**
 * Il luogo che NON C'È: l'area o l'ubicazione non registrate.
 *
 * ⚠️ Serve un valore vero, e il difetto che ha costretto a inventarlo è
 * istruttivo (18/09/2026, segnalato dall'operatore su ACCIAIOLO). I nodi «(senza
 * area)» e «(senza ubicazione)» avevano `id: ''`, e toccarli impostava il filtro
 * a stringa vuota — che in `cerca` vuol dire «non filtrare». Il risultato era una
 * riga che si vedeva, si poteva toccare, e NON FACEVA NIENTE: l'elenco si
 * ridisegnava identico e i presidi restavano irraggiungibili.
 *
 * Misurato prima di correggere: 5 schede per 90 presidi — ACCIAIOLO 24, AREZZO C
 * 24, PIAN DELLA SPERANZA 24, SUVERETO 18 — che dall'albero non si potevano
 * aprire in nessun modo. Una riga che non risponde è peggio di una riga assente:
 * si prova una volta, poi non si prova più nemmeno con quelle che funzionano.
 */
export const SENZA_LUOGO = '__senza__';

/**
 * Come si chiamano a schermo i due nodi che NON sono luoghi.
 *
 * Stanno qui, in un posto solo, perché erano scritti a mano in tre punti —
 * `albero()` due volte e le briciole di pane — e il terzo li scriveva in un modo
 * che non combaciava con gli altri due. Le chiavi sono quelle del DATO
 * (`edificio`, `locale`), i valori quelli dello SCHERMO (area, ubicazione),
 * come in `NOMI_LUOGO` di `luoghi.js`.
 */
export const NOME_SENZA = { edificio: '(senza area)', locale: '(senza ubicazione)' };

/** Il nodo su cui si sta è un segnaposto e non un luogo vero? */
export function eSenzaLuogo(id) { return id === SENZA_LUOGO; }

/**
 * Il presidio ha una POSIZIONE che la mappa sa disegnare?
 *
 * ⛔ La stessa regola di `conPosizione` in mappa.js (che qui non si importa:
 * porta con sé il DOM), e `test_giro_presidi.mjs` le confronta su tutto il
 * pacchetto e sui casi che hanno già rotto qualcosa. Se divergessero, il filtro
 * «sulla mappa» mostrerebbe presidi che la mappa non disegna, o viceversa.
 * `null` e stringa vuota non sono una posizione: `Number(null)` vale 0, e un
 * presidio finirebbe nel Golfo di Guinea.
 */
export function haPosizione(a) {
  if (!a || a.lat === null || a.lat === undefined || a.lon === null || a.lon === undefined) return false;
  const la = Number(a.lat);
  const lo = Number(a.lon);
  return Number.isFinite(la) && Number.isFinite(lo)
    && String(a.lat).trim() !== '' && String(a.lon).trim() !== ''
    && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
}

export function cerca({ testo = '', impiantoId = '', edificioId = '', localeId = '',
  categorie = [], stato: filtroStato = '', soloNonConformi = false, soloIdonei = false,
  soloConAnomalie = false, soloDaControllare = false, soloControllati = false,
  soloSospesi = false, posizione = '' } = {}) {
  const q = normalizza(testo).split(/\s+/).filter(Boolean);
  // Insieme e non stringa: una sola categoria alla volta costringeva a fare tre
  // giri per contare porte, luci e uscite di un locale — che è una domanda sola.
  const cat = new Set(categorie || []);
  const out = [];
  for (const a of stato.perEntita[E.ASSET] || []) {
    if (a.eliminato_il) continue;
    if (impiantoId && a.impianto_id !== impiantoId) continue;
    // `SENZA_LUOGO` è un filtro VERO: «quelli che non ce l'hanno». Con la
    // stringa vuota sarebbe «non filtrare», che è un'altra cosa e faceva
    // sparire 90 presidi dietro una riga che non rispondeva.
    if (edificioId === SENZA_LUOGO) { if (a.edificio_id) continue; }
    else if (edificioId && a.edificio_id !== edificioId) continue;
    if (localeId === SENZA_LUOGO) { if (a.locale_id) continue; }
    else if (localeId && a.locale_id !== localeId) continue;
    if (cat.size && !cat.has(a.categoria_codice)) continue;
    if (filtroStato && a.stato_codice !== filtroStato) continue;
    // ⛔ «Non idonei» vuol dire NON_IDONEO, non «tutto ciò che non è idoneo»
    // (20/09/2026). `conforme()` collassa in un solo «no» cose diverse: un
    // pezzo guasto, una postazione che non deve avere niente (NON_PREVISTO),
    // una rimossa e non sostituita (DISMESSO). Filtrando su `!conforme` il
    // filtro «non idonei» tirava dentro anche quelle — e l'operatore le trovava
    // in mezzo alle cose da riparare, dove non c'è niente da riparare.
    if (soloNonConformi && idoneita(a).stato !== 'NON_IDONEO') continue;
    // «Idonei» accanto a «Non idonei» (17/09/2026, richiesta dell'operatore):
    // servono ENTRAMBI, e non è ridondante. Senza questa casella l'unico modo di
    // vedere i pezzi a posto era togliere ogni filtro, cioè guardarli insieme a
    // quelli che non lo sono. Spuntate tutte e due, l'elenco resta vuoto — ed è
    // la risposta giusta: un presidio non è idoneo e non idoneo insieme.
    if (soloIdonei && !conforme(a)) continue;
    if (soloConAnomalie && anomalieDi(a.id).length === 0) continue;
    if (soloDaControllare && controllato(a.id)) continue;
    // ⛔ «SOSPESI» (23/09/2026, richiesta dell'operatore): i presidi usciti dai
    // «da fare» perché un controllo è stato registrato come NON ESEGUIBILE — ci
    // si è andati e non si poteva fare. Prima finivano fra i «fatti», mescolati
    // a quelli controllati davvero, e a fine giro non si ritrovavano: «se al
    // termine del controllo li troviamo, possiamo sempre registrarli». Quindi
    // «fatti» sono quelli senza niente in sospeso, e i sospesi hanno un filtro
    // loro. Le tre viste si SPARTISCONO i presidi: nessuno sta in due.
    if (soloControllati && (!controllato(a.id) || conVerificheNonEseguibili(a.id))) continue;
    if (soloSospesi && (!controllato(a.id) || !conVerificheNonEseguibili(a.id))) continue;
    // ⛔ «Sulla mappa» / «Senza posizione» (24/09/2026, richiesta
    // dell'operatore: «filtrare solo quelli a cui manca la geolocalizzazione
    // oppure solo quelli che ce l'hanno»). Un valore solo, non due caselle
    // indipendenti: le due risposte si escludono, e accese insieme darebbero un
    // elenco sempre vuoto.
    if (posizione === 'con' && !haPosizione(a)) continue;
    if (posizione === 'senza' && haPosizione(a)) continue;
    if (q.length) {
      const blob = idx.ricerca.get(a.id) || '';
      if (!q.every((t) => blob.includes(t))) continue;
    }
    out.push(a);
  }
  out.sort((x, y) => (x.codice || '').localeCompare(y.codice || ''));
  return out;
}

/** I presidi che questo giro si propone di controllare. */
export function nelPerimetro(a) {
  const tipi = stato.sessione.tipi_asset || [];
  if (!tipi.length) return true;
  return tipi.includes(tipoAssetDi(a));
}

/**
 * @param {boolean} tutto  true = ignora il perimetro del giro e conta tutto.
 *
 * I due numeri servono entrambi e vanno tenuti distinti: l'avanzamento è sul
 * perimetro (è lì che l'operatore misura quanto gli manca), lo stato del parco è
 * sul totale (è lì che l'ufficio vede quanti presidi esistono). Confonderli
 * significa o un avanzamento che non arriva mai al 100%, o un archivio che
 * sembra contenere solo quello che si sta controllando oggi.
 */
export function riepilogo(tutto = false) {
  const tuttiGliAssets = (stato.perEntita[E.ASSET] || []).filter((a) => !a.eliminato_il);
  const assets = tutto ? tuttiGliAssets : tuttiGliAssets.filter(nelPerimetro);
  let presidi = 0; let ko = 0; let nonConformi = 0;
  for (const a of assets) {
    presidi += Number.parseInt(a.quantita || '0', 10) || 0;
    ko += Number.parseInt(a.quantita_ko || '0', 10) || 0;
    if (!conforme(a)) nonConformi += 1;
  }
  const anomalie = (stato.perEntita[E.ANOMALIA] || [])
    .filter((x) => ['APERTA', 'IN_CORSO'].includes(x.stato || 'APERTA'));
  const perGravita = { ALTA: 0, MEDIA: 0, BASSA: 0 };
  for (const an of anomalie) if (perGravita[an.gravita] !== undefined) perGravita[an.gravita] += 1;

  // ⛔ Solo le scadenze DEI PRESIDI (20/09/2026). Dal momento in cui esistono
  // gli obblighi d'impianto — rinnovo del CPI, conformità, prova di
  // evacuazione — questo elenco ne conterrebbe due specie, e «148 verifiche
  // scadute» comprenderebbe cinque certificati di prevenzione incendi.
  //
  // ⚠️ Misurato sull'archivio di quel giorno: 142 → 148 appena le nove righe
  // d'impianto sono entrate nel pacchetto, senza nessun errore e senza che
  // niente si rompesse. È l'inquinamento previsto quando `asset_id` è
  // diventato nullabile, ed è esattamente la forma in cui si presenta: un
  // numero che sale del quattro per cento e resta plausibile.
  const scadenze = (stato.perEntita[E.SCADENZA] || [])
    .filter((s) => (s.stato || 'APERTA') === 'APERTA' && s.asset_id);
  // Stessa memoria locale dell'albero, per la stessa ragione: qui l'avanzamento
  // si chiede quattro volte per presidio.
  const memoria = new Map();
  const avanz = (id) => {
    if (!memoria.has(id)) memoria.set(id, avanzamentoDi(id));
    return memoria.get(id);
  };
  return {
    righe: assets.length,
    presidi,
    presidi_ko: ko,
    non_conformi: nonConformi,
    anomalie_aperte: anomalie.length,
    anomalie_gravita: perGravita,
    scadute: scadenze.filter((s) => semaforo(s.data_scadenza) === 'SCADUTO').length,
    in_scadenza: scadenze.filter((s) => semaforo(s.data_scadenza) === 'IN_SCADENZA').length,
    // I PRESIDI in regola e non (20/09/2026, richiesta dell'operatore). È
    // un'altra misura da `scadute`, e tenerle distinte è il punto: «478
    // verifiche scadute» dice quanto LAVORO manca, «275 presidi non in regola»
    // dice su quanti PEZZI manca. Un estintore con quattro scadenze scadute
    // pesa quattro nel primo numero e uno nel secondo, e le due domande — «in
    // quante devo andare» e «quanti pezzi sono fuori regola» — si fanno
    // entrambe.
    //
    // La definizione è quella di `statoVerifiche`, non una terza scritta qui:
    // non in regola = almeno una verifica scaduta OPPURE un piano il cui ultimo
    // esito è non idoneo.
    presidi_in_regola: assets.filter((a) => statoVerifiche(a).stato === 'REGOLARE').length,
    presidi_non_in_regola: assets.filter((a) => statoVerifiche(a).stato === 'NON_REGOLARE').length,
    presidi_senza_scadenze: assets.filter((a) => statoVerifiche(a).stato === 'SENZA').length,
    impianti: (stato.perEntita[E.IMPIANTO] || []).length,
    punti_aperti: (stato.perEntita[E.VERIFICA] || [])
      .filter((v) => (v.stato || 'APERTO') === 'APERTO').length,
    // Tre numeri diversi, e tenerli distinti è il punto.
    //
    // `toccati` sono i presidi su cui è stato registrato almeno un controllo:
    // è quello che il contatore diceva prima, chiamandolo «controllati». Ma un
    // estintore ha quattro piani — controllo, revisione, collaudo, rottamazione
    // — e misurato sull'archivio 433 presidi su 919 ne hanno quattro aperti.
    // Con quel solo numero, un estintore a cui ne mancavano tre risultava fatto.
    //
    // `controlli_fatti` su `controlli_previsti` è l'avanzamento vero: l'unità di
    // lavoro è il controllo, non il presidio.
    toccati: assets.filter((a) => controllato(a.id)).length,
    completati: assets.filter((a) => avanz(a.id).completo).length,
    // Quanti dei «completati» lo sono perché qualcosa NON si è potuto fare.
    // Senza questo numero la home diceva «1 presidio completato» accanto a «0
    // controlli fatti», che letti insieme sembrano un errore del programma e
    // invece sono due misure diverse: quel presidio è stato chiuso da un «non
    // accessibile», che chiude la voce e non esegue niente.
    chiusi_non_eseguibili: assets.filter(
      (a) => avanz(a.id).completo && conVerificheNonEseguibili(a.id)).length,
    controlli_previsti: assets.reduce((n, a) => n + avanz(a.id).previsti, 0),
    controlli_fatti: assets.reduce((n, a) => n + avanz(a.id).fatti, 0),
    // Nome storico, tenuto perché lo leggono il riepilogo e le prove: adesso
    // vuol dire «presidi con tutti i controlli previsti fatti».
    controllati: assets.filter((a) => avanz(a.id).completo).length,
    interventi: (stato.perEntita[E.INTERVENTO] || []).length,
    modifiche_non_esportate: stato.giornale.length - stato.esportato.seq,
    // Quanto vale il perimetro, per poterlo dire invece di lasciarlo indovinare.
    perimetro_attivo: !tutto && (stato.sessione.tipi_asset || []).length > 0,
    righe_totali: tuttiGliAssets.length,
    tipi_perimetro: [...(stato.sessione.tipi_asset || [])],
  };
}

/**
 * Quanti controlli ha registrato QUESTA mano: questo dispositivo, da quando ha
 * preso in carico il pacchetto.
 *
 * Serve alla catena delle consegne. Si conta per `device_origine` e non per
 * nome: due operatori possono chiamarsi allo stesso modo, due dispositivi no —
 * e il nome sul telefono si può cambiare a metà giro, il dispositivo no.
 */
export function controlliDiQuestaMano() {
  const mio = stato.sessione.device_id;
  const da = stato.sessione.caricato_il || '';
  if (!mio) return 0;
  return (stato.perEntita[E.INTERVENTO] || []).filter(
    (i) => i.device_origine === mio && String(i.registrato_il || '') >= da).length;
}

export function lavoroNonEsportato() {
  return stato.caricato && stato.giornale.length > stato.esportato.seq;
}

// --------------------------------------------------------------------------- //
// Mutazioni
// --------------------------------------------------------------------------- //
export function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function deviceId() {
  const K = 'scudo.campo.device';
  try {
    let v = localStorage.getItem(K);
    if (!v) { v = `DEV-${uuid().slice(0, 8).toUpperCase()}`; localStorage.setItem(K, v); }
    return v;
  } catch { return 'DEV-ANON'; }
}

export function oggiIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function adessoIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

function evento(entita, entitaId, operazione, payload) {
  return {
    evento_id: uuid().replace(/-/g, ''),
    entita,
    entita_id: entitaId,
    operazione,
    payload: JSON.stringify(payload),
    ts_utc: adessoIso(),
    device_id: stato.sessione.device_id,
    operatore_nome: stato.sessione.operatore,
    sessione_id: stato.sessione.sessione_id,
  };
}

function applica(entita, entitaId, operazione, payload, muta) {
  muta();
  const ev = evento(entita, entitaId, operazione, payload);
  stato.giornale.push(ev);
  notifica();
  return ev;
}

export function impostaSessione({ operatore, sessione_id: sessioneId, matricola }) {
  if (operatore !== undefined) stato.sessione.operatore = operatore;
  if (sessioneId !== undefined) stato.sessione.sessione_id = sessioneId;
  if (matricola !== undefined) stato.sessione.matricola = matricola;
  notifica();
}

/**
 * Aggiorna un presidio. `campi` è { nome: valore } e può contenere qualunque
 * campo dichiarato nei metadati, di colonna o di dettaglio: qui non c'è nessun
 * elenco scritto a mano da tenere allineato.
 */
/**
 * I campi che l'app scrive da sé, anche se il pacchetto caricato è più vecchio
 * della loro introduzione.
 *
 * Le loro colonne stanno in `pacchetto.js` (lato app), quindi il dato torna in
 * ufficio comunque; è solo la DESCRIZIONE dei campi — che viene dal pacchetto —
 * a poter essere indietro. Senza questo elenco, chi ha in mano un pacchetto di
 * ieri non può salvare una posizione, e soprattutto non può salvare il CONTROLLO
 * a cui la posizione era attaccata.
 */
// ⛔ `quantita_ko` dal 23/09/2026. «Di cui guasti» è NON modificabile a mano —
// è l'esito di un controllo, e dall'anagrafica non si tocca (`formCampi` non lo
// mostra) — ma lo scrive l'APP quando si apre o si modifica un'anomalia con i
// pezzi che non funzionano. Senza questa voce `aggiornaAsset` lo rifiutava:
// misurato, «Apri anomalia senza registrare un controllo» falliva SEMPRE con
// «Di cui guasti: non modificabile» (mandava il numero anche a zero), e
// l'anomalia creata prima del rifiuto restava in memoria e finiva salvata col
// salvataggio successivo — ogni nuovo tentativo ne aggiungeva un'altra.
export const CAMPI_APP = new Set(['lat', 'lon', 'gps_accuratezza_m', 'gps_rilevato_il', 'quantita_ko']);

export function aggiornaAsset(assetId, valori) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error(`Presidio ${assetId} non trovato`);

  const perNome = new Map((stato.campi || []).map((c) => [c.nome, c]));
  const errori = [];
  for (const [nome, valore] of Object.entries(valori)) {
    const c = perNome.get(nome);
    // ⛔ I metadati dei campi VIAGGIANO NEL PACCHETTO, e un pacchetto vecchio
    // non conosce i campi aggiunti dopo che è stato esportato.
    //
    // Misurato sul telefono dell'operatore il 20/09/2026: registrando un
    // controllo su un pacchetto di qualche giorno prima usciva «Campo
    // sconosciuto: lat, lon, gps_accuratezza_m, gps_rilevato_il» e il controllo
    // NON si salvava. Cioè un campo facoltativo, aggiunto per comodità, faceva
    // perdere il lavoro obbligatorio — che è il baratto peggiore possibile.
    //
    // `CAMPI_APP` sono i campi che l'APP stessa sa gestire: le loro colonne le
    // dichiara `pacchetto.js`, quindi viaggiano comunque verso l'ufficio anche
    // quando la descrizione dei campi è più vecchia. La guardia resta per tutto
    // il resto, che è il suo mestiere: intercettare un nome sbagliato.
    if (!c && !CAMPI_APP.has(nome)) { errori.push(`Campo sconosciuto: ${nome}`); continue; }
    if (!c) continue;
    // ⚠️ «Non modificabile» vuol dire «non si scrive a mano», non «non si
    // scrive». `gps_rilevato_il` è dichiarato così apposta — una data che
    // l'operatore non deve poter battere — ma la scrive l'APP quando prende la
    // posizione, e la guardia la rifiutava: misurato il 20/09/2026, con un
    // pacchetto AGGIORNATO salvare una posizione falliva con «Posizione
    // rilevata il: non modificabile». Il difetto era mascherato da quello dei
    // metadati vecchi, che dava un errore diverso sullo stesso gesto.
    if (!c.modificabile && !CAMPI_APP.has(nome)) {
      errori.push(`${c.etichetta}: non modificabile.`); continue;
    }
    const msg = validaCampo(c, valore);
    if (msg) errori.push(msg);
  }
  const q = valori.quantita !== undefined ? Number(valori.quantita) : Number(a.quantita || 0);
  const ko = valori.quantita_ko !== undefined ? Number(valori.quantita_ko) : Number(a.quantita_ko || 0);
  if (Number.isFinite(q) && Number.isFinite(ko) && ko > q) {
    errori.push(`I pezzi guasti (${ko}) non possono superare la quantità totale (${q}).`);
  }
  if (errori.length) throw new Error(errori.join(' '));

  const prima = {};
  for (const k of Object.keys(valori)) prima[k] = a[k] ?? '';
  return applica('asset', assetId, 'UPDATE', { prima, dopo: valori }, () => {
    for (const [k, v] of Object.entries(valori)) {
      if (v === '' || v === null || v === undefined) delete a[k];
      else a[k] = String(v);
    }
    a.modificato_il = adessoIso();
    a.modificato_da = stato.sessione.operatore || '';
    a.device_origine = stato.sessione.device_id;
    idx.ricerca.set(a.id, testoRicerca(a));
  });
}

/**
 * Perché IDONEO non si può dichiarare, o null se si può.
 *
 * GEMELLA di `motivo_rifiuto_idoneo` in `backend/app/services/scudo_registrazione.py`
 * e di `motivoRifiutoIdoneo` in `frontend/src/components/scudo/registrazioneVerifica.js`,
 * con la stessa frase: i tre lati li confronta `scripts/scudo/test_idoneo_cross.py`.
 * L'ufficio registra le verifiche con la stessa regola del campo, e se due lati
 * divergessero un controllo rifiutato in cabina passerebbe da una scrivania.
 */
function pezziGuasti(valore) {
  const n = Number(valore);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Se questa anomalia impedisca di dichiarare IDONEO il presidio.
 *
 * ⛔ Due livelli, e l'ordine conta: la risposta di chi ha il pezzo davanti
 * (`bloccante` sull'anomalia) vince sul default del tipo
 * (`blocca_idoneita` nel catalogo). Il tipo non può rispondere per tutti i casi
 * che copre — «manca una dotazione» è il cartello mancante di un estintore e il
 * maniglione di un'uscita di sicurezza — quindi propone e non decide.
 *
 * ⚠️ Un tipo che il pacchetto non conosce BLOCCA. Il default sta dalla parte
 * sicura perché l'errore non è simmetrico: dire «non blocca» di un difetto che
 * blocca produce un presidio dichiarato idoneo su cui qualcuno conterà; dire
 * «blocca» di uno che non blocca produce una seccatura.
 */
export function anomaliaBlocca(an) {
  if (!an) return false;
  if (an.bloccante !== undefined && an.bloccante !== null && an.bloccante !== '') {
    return Number(an.bloccante) === 1;
  }
  const t = idx.tipiAnomalia && idx.tipiAnomalia.get(an.tipo_codice);
  if (!t || t.blocca_idoneita === undefined || t.blocca_idoneita === null
      || t.blocca_idoneita === '') return true;
  return Number(t.blocca_idoneita) === 1;
}

export function motivoRifiutoIdoneo(esito, azioni, quantitaKo, anomalieAncoraPresenti) {
  if (esito !== 'IDONEO') return null;
  // I pezzi guasti (16/09/2026): il controllo è stato ESEGUITO, ma con una lampada
  // bruciata su dodici l'esito non è idoneo. Gemella su tre lati, stessa frase.
  const ko = pezziGuasti(quantitaKo);
  if (ko) {
    return `Non si può dichiarare IDONEO: ${ko} `
      + `${ko === 1 ? 'pezzo risulta guasto' : 'pezzi risultano guasti'}. `
      + 'Registra NON IDONEO dicendo che cosa manca.';
  }
  // Un elenco vuoto passa, ma il controllo sulle ANOMALIE non dipende da lui:
  // prima si usciva qui, e un piano senza checklist avrebbe saltato del tutto la
  // domanda sulle anomalie.
  // ⚠️ Una voce NON OBBLIGATORIA non blocca IDONEO se resta senza spunta
  // (18/09/2026). Sul collaudo di un estintore a polvere compariva «Bombole CO2…
  // 25 MPa», che su quel pezzo non si può fare: 18 voci su 226, in 12 piani, sono
  // condizionali, e due di esse (PED e non-PED) si escludono a vicenda per
  // costruzione. Pretenderle tutte lasciava una scelta sola e sbagliata in
  // entrambi i versi: spuntare una riga falsa, o non poter dichiarare idoneo un
  // estintore che lo è.
  const richieste = Array.isArray(azioni) && azioni.length
    ? azioni.filter((x) => (x || {}).obbligatoria === undefined || (x || {}).obbligatoria) : [];
  const mancanti = richieste.filter((x) => !(x || {}).fatta);
  if (mancanti.length) {
    return `Non si può dichiarare IDONEO: ${mancanti.length} verifiche su `
      + `${richieste.length} non risultano fatte. Spuntale, oppure registra `
      + 'NON IDONEO dicendo che cosa manca.';
  }
  // ⛔ Solo le anomalie BLOCCANTI (21/09/2026). Chi chiama passa già il conteggio
  // filtrato: la regola resta un confronto con un numero, identica sui tre lati.
  //
  // Fino a quel giorno bastava una qualunque anomalia aperta. Misurato sulle 212
  // in archivio: 89 non impediscono di usare il pezzo — box da sostituire,
  // segnaletica illeggibile, matricola duplicata — e 87 presidi ne avevano SOLO
  // di quelle. Un estintore carico e funzionante, con il box ammaccato,
  // risultava non idoneo, e l'unica via d'uscita era dichiarare risolto un
  // difetto che c'è ancora.
  const n = pezziGuasti(anomalieAncoraPresenti);
  if (n) {
    return 'Non si può dichiarare IDONEO: '
      + (n === 1 ? "un'anomalia bloccante è ancora presente"
        : `${n} anomalie bloccanti sono ancora presenti`)
      + '. Registra NON IDONEO, oppure dichiara che '
      + (n === 1 ? 'è risolta.' : 'sono risolte.');
  }
  return null;
}

/**
 * L'elenco delle verifiche rimaste SENZA SPUNTA dentro un controllo non idoneo.
 *
 * Sono «NON IDONEE», non «non eseguite» — richiesta dell'operatore del
 * 20/09/2026: «non spuntarle significa che non sono idonee». La differenza non è
 * di stile. In questa app «non eseguito» è un ESITO con un nome proprio
 * (`NON_ESEGUITO`, «non si è potuto fare»), che non è un difetto del pezzo e
 * lascia l'idoneità dov'era; una casella lasciata vuota dentro un controllo che
 * si sta dichiarando non idoneo dice l'opposto — quella verifica è stata fatta e
 * non è andata bene. Chiamarle come l'esito che significa il contrario manda chi
 * legge il verbale in ufficio a cercare un lavoro da rifare invece di un difetto
 * da riparare.
 *
 * GEMELLA di `descrizione_verifiche_non_idonee` in `scudo_registrazione.py`: la
 * frase la scrivono in due — il campo quando registra sul telefono, il server
 * quando registra dalla scrivania — e in archivio finiscono nella stessa
 * colonna. Le confronta `scripts/scudo/test_idoneo_cross.py`.
 */
// --------------------------------------------------------------------------- //
// La NOTA dell'operatore e l'ELENCO delle verifiche, dentro una descrizione
// --------------------------------------------------------------------------- //
//
// ⛔ Perché esiste (24/09/2026, segnalazione dell'operatore con un esempio vero:
// «test — Verifiche non idonee: Provare i rivelatori con il metodo prescritto
// dal costruttore…; Verificare che…; …» — sette righe dopo quattro lettere). Un
// NON IDONEO accoda alla descrizione dell'anomalia l'elenco delle voci non
// spuntate (`descrizioneVerificheNonIdonee`, gemella dell'ufficio), e quello che
// l'operatore ha scritto a mano ci annega dentro.
//
// ⚠️ Il FORMATO salvato non cambia, di proposito: è quello dei pacchetti già in
// giro, dell'import dell'ufficio e delle estrazioni. Cambia come si LEGGE: la
// nota è ciò che precede il segno «Verifiche non idonee: »; l'elenco NON si
// ricava spezzando il testo — 20 voci del catalogo su 251 contengono «;» — ma
// dalle voci del controllo che ha aperto l'anomalia, che ne tiene la copia com'era
// quel giorno. Se domani i piani cambiano, l'elenco resta quello verificato.
//
// GEMELLE in `backend/app/services/scudo_anomalie_testo.py`, confrontate da
// `scripts/scudo/test_anomalia_testo_cross.py`.
export const SEGNO_VERIFICHE = 'Verifiche non idonee: ';
const SEPARATORE_NOTA = ' — ';

/**
 * `{ nota, coda }`: la nota scritta a mano e la coda con l'elenco (dal segno in
 * poi, compreso), o `''`. Il segno conta solo all'INIZIO o dopo il separatore
 * con cui lo accoda la registrazione: scritto a mano in mezzo a una frase, resta
 * nota.
 */
export function parteNota(descrizione) {
  const d = String(descrizione == null ? '' : descrizione);
  if (d.startsWith(SEGNO_VERIFICHE)) return { nota: '', coda: d };
  const i = d.lastIndexOf(SEPARATORE_NOTA + SEGNO_VERIFICHE);
  if (i >= 0) return { nota: d.slice(0, i), coda: d.slice(i + SEPARATORE_NOTA.length) };
  return { nota: d, coda: '' };
}

/**
 * Il testo di un'anomalia, separato: `{ nota, verifiche, grezzo }`.
 * `verifiche` sono i testi delle voci NON spuntate del controllo che l'ha aperta,
 * nell'ordine del piano; se quel controllo non c'è (un'anomalia arrivata senza),
 * restano vuote e `grezzo` porta l'elenco com'è scritto, senza spezzarlo.
 */
export function testoAnomalia(an) {
  return testoDaVoci(an && an.descrizione, (an && an.intervento_apertura_id && idx.azioniPerIntervento
    && idx.azioniPerIntervento.get(an.intervento_apertura_id)) || []);
}

/** La parte PURA di `testoAnomalia`: il testo e le voci del controllo. */
export function testoDaVoci(descrizione, vociDelControllo) {
  const { nota, coda } = parteNota(descrizione);
  if (!coda) return { nota, verifiche: [], grezzo: '' };
  const voci = [...(vociDelControllo || [])]
    .filter((z) => !['1', 'true', 'True'].includes(String(z.fatta)) && String(z.testo || '').trim())
    .sort((x, y) => Number(x.ordine || 0) - Number(y.ordine || 0))
    .map((z) => String(z.testo).trim());
  return { nota, verifiche: voci, grezzo: voci.length ? '' : coda.slice(SEGNO_VERIFICHE.length).replace(/\.$/, '') };
}

/**
 * La descrizione con la NOTA cambiata e la coda com'era, byte per byte: chi
 * modifica un'anomalia corregge quello che ha scritto, non l'elenco delle voci.
 */
export function ricomponiDescrizione(descrizioneVecchia, notaNuova) {
  const { coda } = parteNota(descrizioneVecchia);
  const nota = String(notaNuova == null ? '' : notaNuova).trim();
  if (!coda) return nota;
  return nota ? `${nota}${SEPARATORE_NOTA}${coda}` : coda;
}

export function descrizioneVerificheNonIdonee(testi) {
  const voci = (testi || []).map((t) => String(t == null ? '' : t).trim()).filter(Boolean);
  return voci.length ? `Verifiche non idonee: ${voci.join('; ')}.` : '';
}

export function registraIntervento(assetId, dati) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error(`Presidio ${assetId} non trovato`);
  if (!ESITI.includes(dati.esito)) throw new Error(`Esito "${dati.esito}" non valido.`);
  if (!idx.tipiControllo.has(dati.tipo_controllo_codice)) {
    throw new Error(`Tipo controllo "${dati.tipo_controllo_codice}" non a catalogo.`);
  }

  // CONFORME significa che il controllo è stato ESEGUITO per intero.
  //
  // Un piano di verifica è un elenco di cose da fare: se anche una sola non è
  // stata fatta, il controllo non è passato — non è ancora finito. Dichiararlo
  // conforme lo chiuderebbe, assolverebbe la scadenza e scriverebbe nel registro
  // dei controlli che quella verifica è stata eseguita. È il documento che si
  // mostra a chi chiede se la manutenzione è stata fatta.
  //
  // Il divieto sta QUI e non solo nella schermata perché la schermata è una
  // delle strade: c'è anche il controllo di gruppo, e domani ce ne saranno
  // altre. Una regola scritta nel form vale finché nessuno scrive un secondo
  // form.
  //
  // Attenzione a che cosa NON vieta: un elenco vuoto passa. `azioni: []`
  // significa «questo piano non ha una checklist», che è il caso di parecchi
  // piani e di tutti gli interventi che arrivano dall'archivio. Il divieto
  // riguarda un elenco che esiste e ha voci non spuntate.
  // ⛔ «Obbligatoria» si rilegge DAL PIANO (24/09/2026). Le voci salvate non la
  // portano, e la regola legge una voce senza il campo come obbligatoria: la
  // schermata accendeva «Idoneo» con le voci «solo in certi casi» non spuntate
  // (lei lo sa), e qui il salvataggio lo rifiutava — misurato su UISUV-480,
  // prova funzionale, 2 voci condizionali su 9. Una voce senza `azione_id`
  // resta com'è: è il caso dei registri che non vengono da un piano.
  const perVoce = new Map(azioniDelPiano(dati.piano_id).map((z) => [z.id, z.obbligatoria]));
  const azioniPerRegola = (dati.azioni || []).map((x) => {
    if (!x || x.obbligatoria !== undefined || !x.azione_id || !perVoce.has(x.azione_id)) return x;
    const v = perVoce.get(x.azione_id);
    return { ...x, obbligatoria: (v === undefined || v === null || v === '' || String(v) === '1' || v === true) ? 1 : 0 };
  });
  const rifiuto = motivoRifiutoIdoneo(dati.esito, azioniPerRegola, dati.quantita_ko);
  if (rifiuto) throw new Error(rifiuto);
  // La verifica collegata all'anomalia (25/09/2026) è una delle voci di QUESTO
  // controllo, o niente: un testo che non è fra le voci non si collega a niente
  // e nel verbale indicherebbe una verifica che nessuno ha guardato.
  // «È lo stesso difetto già aperto» (25/09/2026): il non idoneo che lo dice non
  // apre un'anomalia nuova. Dev'essere un'anomalia APERTA di QUESTO presidio.
  const esistente = dati.anomalia_esistente
    ? (stato.perEntita[E.ANOMALIA] || []).find((x) => x.id === dati.anomalia_esistente) : null;
  if (dati.anomalia_esistente && (!esistente || esistente.asset_id !== assetId || esistente.eliminato_il
    || !['APERTA', 'IN_CORSO'].includes(esistente.stato || 'APERTA'))) {
    throw new Error('L\'anomalia indicata come «stesso difetto» non è aperta su questo presidio.');
  }
  const collegata = String(dati.verifica_collegata || '').trim();
  if (collegata && !(dati.azioni || []).some((z) => String(z.testo || '').trim() === collegata)) {
    throw new Error('La verifica collegata all\'anomalia non è fra quelle di questo controllo.');
  }

  // ⛔ Il FINE VITA non ha un esito (23/09/2026, dall'operatore: «il fine vita
  // dell'estintore, se raggiunto, lo fa verificare come idoneo; invece dovrebbe
  // essere non idoneo, e dovrebbe essere facile sostituirlo»).
  //
  // Il fine vita non è un controllo che si passa: è una DATA, costruzione più
  // vita utile. E per il calcolo — qui e in ufficio, `esecuzioneVale` e la sua
  // gemella — un esito eseguito fa ripartire l'orologio: «idoneo» su un
  // estintore di diciotto anni gliene regalava altri diciotto, e anche «non
  // idoneo» spostava la data in avanti, in silenzio. Le strade giuste sono due,
  // e nessuna passa di qui con un esito eseguito:
  //  * il pezzo si SOSTITUISCE (`registraSostituzione`, motivo FINE_VITA): il
  //    pezzo nuovo porta il suo anno, e la fine vita riparte da lì;
  //  * si lascia DA SOSTITUIRE (`fineVitaDaSostituire`): NON_ESEGUITO, che
  //    l'orologio non lo tocca, più un'anomalia che rende il presidio non idoneo.
  if (eFineVita(dati.tipo_controllo_codice, dati.piano_id) && ESITI_ESEGUITI.includes(dati.esito)) {
    throw new Error('Il fine vita non si registra come «idoneo» o «non idoneo»: se il pezzo '
      + 'ci è arrivato va sostituito — adesso («Sostituiscilo adesso») o al prossimo giro '
      + '(«Da sostituire al prossimo giro»); se non ci è arrivato non c\'è niente da registrare.');
  }

  // ⛔ IL GIRO COMINCIA QUANDO COMINCIA IL LAVORO (20/09/2026, segnalazione
  // dell'operatore: «vedo che mi fa registrare le verifiche anche se non
  // abbiamo iniziato il controllo»).
  //
  // Registrare senza aver premuto «Inizia» era già previsto — ai presidi ci si
  // arriva anche dalla loro scheda, e `interventoNelGiro` ripiegava sull'ora in
  // cui il pacchetto è stato caricato — ma lasciava lo schermo a dire due cose
  // opposte: la fascia «controllo non iniziato» sopra un presidio appena
  // controllato. Uno stato che il programma tratta come «in corso» e scrive
  // «non iniziato» non è un dettaglio di etichetta: è il motivo per cui poi
  // nessuno si fida dei numeri accanto.
  //
  // Sta DOPO le validazioni, apposta: un tentativo rifiutato non deve aprire
  // niente. E `iniziaGiro` scrive l'evento una volta sola, quindi il secondo
  // controllo non riapre nulla.
  if (!stato.sessione.iniziato_il) iniziaGiro({ avvio: 'primo controllo registrato' });

  const iv = {
    id: uuid(),
    asset_id: assetId,
    asset_codice: a.codice,
    tipo_controllo_codice: dati.tipo_controllo_codice,
    piano_id: dati.piano_id || '',
    data: dati.data || oggiIso(),
    esito: dati.esito,
    descrizione: dati.descrizione || '',
    azione_eseguita: dati.azione_eseguita || '',
    documento_rif: dati.documento_rif || '',
    operatore_nome: stato.sessione.operatore || '',
    quantita_verificata: dati.quantita_verificata != null ? String(dati.quantita_verificata) : '',
    quantita_ko: dati.quantita_ko != null ? String(dati.quantita_ko) : '',
    note: dati.note || '',
    sessione_id: stato.sessione.sessione_id,
    registrato_il: adessoIso(),
    device_origine: stato.sessione.device_id,
  };
  for (const k of Object.keys(iv)) if (iv[k] === '') delete iv[k];

  // Le spunte della checklist, fotografate: testo compreso. Il piano si può
  // modificare, e un verbale che rimandasse alla «seconda voce» racconterebbe
  // fra un anno una verifica che nessuno ha mai fatto.
  const azioni = (dati.azioni || []).map((az, i) => ({
    id: uuid(),
    intervento_id: iv.id,
    asset_codice: a.codice,
    data: iv.data,
    azione_id: az.azione_id || '',
    ordine: String(az.ordine ?? i),
    testo: az.testo || '',
    fatta: az.fatta ? '1' : '0',
    nota: az.nota || '',
  })).filter((x) => x.testo);

  // Che cos'era il presidio PRIMA di questo controllo.
  //
  // Serve solo ad annullare: registrare un controllo cambia lo stato del pezzo
  // (FUNZIONANTE / GUASTO) e i pezzi guasti, e senza il valore precedente
  // l'annullamento potrebbe togliere l'intervento ma lascerebbe il presidio
  // marcato guasto per sempre. Sta nel giornale, che è già una colonna libera:
  // nessuna tabella del pacchetto cambia forma.
  const primaDelControllo = {
    stato_codice: a.stato_codice || '',
    quantita_ko: a.quantita_ko != null ? String(a.quantita_ko) : '',
  };

  applica('intervento', iv.id, 'INSERT', {
    asset_id: assetId, tipo: iv.tipo_controllo_codice, data: iv.data, esito: iv.esito,
    azioni_fatte: azioni.filter((x) => x.fatta === '1').length,
    azioni_totali: azioni.length,
    prima: primaDelControllo,
  }, () => {
    stato.perEntita[E.INTERVENTO].push(iv);
    if (azioni.length) {
      if (!stato.perEntita[E.INTERVENTO_AZIONE]) stato.perEntita[E.INTERVENTO_AZIONE] = [];
      stato.perEntita[E.INTERVENTO_AZIONE].push(...azioni);
      idx.azioniPerIntervento.set(iv.id, azioni);
    }
    if (!idx.interventiPerAsset.has(assetId)) idx.interventiPerAsset.set(assetId, []);
    idx.interventiPerAsset.get(assetId).push(iv);

    // Qui l'esito NON scrive lo stato del presidio, e non è una dimenticanza.
    // `stato_codice` dice se il presidio è in servizio, segregato, dismesso o
    // non previsto: sono decisioni di esercizio, non esiti di un controllo. Che
    // cosa il controllo ha trovato lo dicono l'anomalia e `idoneita()`.
    //
    // Fino al 27/08/2026 qui c'era `{ IDONEO: 'FUNZIONANTE', NON_IDONEO:
    // 'GUASTO' }`, rimasto dal vocabolario precedente. Non si vedeva perché la
    // guardia `idx.stati.has(nuovo)` lo rendeva un nulla di fatto con il
    // catalogo nuovo — e il gemello Python (`ESITO_STATO`, tutti None) aveva
    // già smesso di scriverlo. Due gemelli divergenti, di cui uno silenzioso.
    if (dati.quantita_ko != null && dati.quantita_ko !== '') {
      a.quantita_ko = String(Math.min(Number(dati.quantita_ko),
        Number(a.quantita || dati.quantita_ko)));
    }
    a.modificato_il = adessoIso();

    // Assolve la scadenza aperta dello stesso tipo: in campo la scadenza
    // assolta è ciò che dice all'operatore che quel giro è fatto.
    const sc = (idx.scadenzePerAsset.get(assetId) || [])
      .filter((s) => s.tipo_controllo_codice === iv.tipo_controllo_codice
        && (s.stato || 'APERTA') === 'APERTA')
      .sort((x, y) => (x.data_scadenza || '').localeCompare(y.data_scadenza || ''))[0];
    if (sc) { sc.stato = 'ASSOLTA'; sc.intervento_id = iv.id; }
  });

  let anomalia = null;
  if (esistente) {
    // Lo stesso difetto: nessuna anomalia nuova. Il legame resta nella
    // descrizione del controllo, scritta da chi l'ha registrato.
    anomalia = null;
  } else if (dati.esito === 'NON_IDONEO' || dati.apri_anomalia) {
    const gravitaStato = (idx.stati.get(a.stato_codice) || {}).gravita_implicita;
    anomalia = apriAnomalia(assetId, {
      // «Che cosa ha»: la schermata del controllo lo chiede e lo manda come
      // `tipo_anomalia`, e fino al 27/08/2026 questa riga non c'era — il campo
      // veniva raccolto sul telefono e lasciato cadere qui. In ufficio ogni
      // anomalia rientrata dal campo arrivava senza tipo, cioè impossibile da
      // contare e da filtrare, che è l'unica ragione per cui la colonna esiste.
      tipo_codice: dati.tipo_anomalia || '',
      gravita: dati.gravita_anomalia || gravitaStato || 'MEDIA',
      descrizione: dati.descrizione || dati.note
        || `Esito ${dati.esito} al controllo ${dati.tipo_controllo_codice}`,
      azione_proposta: dati.azione_eseguita || '',
      quantita_ko: dati.quantita_ko,
      origine: 'Intervento in campo',
      intervento_apertura_id: iv.id,
      verifica_collegata: dati.verifica_collegata || '',
    });
  }
  return { intervento: iv, anomalia };
}

/**
 * I testi che il difetto delle textarea ha CANCELLATO, ritrovati nel giornale
 * (23/09/2026).
 *
 * Fino alla v116 una textarea precompilata appariva VUOTA (`el` scriveva il
 * valore come attributo, che il browser ignora). In «Modifica anagrafica» il
 * campo note vuoto risultava cambiato, e salvare — per qualunque altro motivo —
 * scriveva una nota vuota sopra quella vera. Il giornale però conserva il
 * «prima» di ogni modifica di presidio: da lì la nota si ritrova.
 *
 * Proposte, non rimesse: una nota svuotata può anche essere stata tolta
 * apposta, e lo sa solo chi l'ha fatto. Si propone solo se è ANCORA vuota — una
 * scritta dopo, o rimessa con un annullamento, vince.
 *
 * @returns `[{ asset_id, campo, testo }]`
 */
export function testiCancellatiPerErrore() {
  const lunghi = new Set((stato.campi || []).filter((c) => c.tipo === 'testo_lungo').map((c) => c.nome));
  lunghi.add('note');
  const trovati = new Map();
  for (const ev of stato.giornale || []) {
    if (ev.entita !== 'asset' || ev.operazione !== 'UPDATE') continue;
    let p;
    try { p = JSON.parse(ev.payload || '{}'); } catch { continue; }
    if (!p || !p.prima || !p.dopo) continue;
    for (const k of Object.keys(p.dopo)) {
      if (!lunghi.has(k)) continue;
      const chiave = `${ev.entita_id}|${k}`;
      const svuotato = String(p.dopo[k] ?? '') === '' && String(p.prima[k] ?? '').trim() !== '';
      // L'ULTIMO svuotamento vince (il suo «prima» è il testo più recente). Una
      // nota scritta dopo non serve cancellarla da qui: la esclude il filtro
      // qui sotto, che la trova piena — un ramo che lo faceva anche qui era
      // ridondante (misurato: toglierlo lasciava verdi le prove).
      if (svuotato) trovati.set(chiave, { asset_id: ev.entita_id, campo: k, testo: String(p.prima[k]) });
    }
  }
  return [...trovati.values()].filter((x) => {
    const a = idx.assets.get(x.asset_id);
    return a && !a.eliminato_il && !String(a[x.campo] ?? '').trim();
  });
}

/**
 * Fine vita RAGGIUNTO, e il pezzo si sostituisce al prossimo giro (23/09/2026).
 *
 * Due scritture, e servono tutte e due:
 *  * la voce di fine vita registrata NON_ESEGUITO, con il perché: esce dai «da
 *    fare» di questo giro e finisce fra i SOSPESI, dove si ritrova — ma
 *    l'orologio non si muove (`esecuzioneVale`, qui e in ufficio), quindi al
 *    giro dopo la fine vita è ancora lì, scaduta;
 *  * un'anomalia SCADUTO («vita utile superata, da sostituire»): è lei che rende
 *    il presidio NON IDONEO, sui due lati e con le regole che ci sono già — non
 *    serve toccare `idoneita` né la sua gemella dell'ufficio.
 */
export function fineVitaDaSostituire(assetId, { piano_id: pianoId = '', scadenza = '' } = {}) {
  const quando = scadenza ? ` il ${String(scadenza).split('-').reverse().join('/')}` : '';
  return registraIntervento(assetId, {
    tipo_controllo_codice: 'ROTTAMAZIONE',
    piano_id: pianoId,
    esito: 'NON_ESEGUITO',
    descrizione: `Fine vita raggiunto${quando}: il pezzo va sostituito.`,
    apri_anomalia: true,
    tipo_anomalia: 'SCADUTO',
    gravita_anomalia: 'ALTA',
    azione_eseguita: 'Da sostituire al prossimo giro',
  });
}

/**
 * Controllo di gruppo: registra lo stesso esito su più presidi in un colpo.
 *
 * In un locale con dodici lampade di emergenza, farlo dodici volte significa
 * dodici volte quattro tocchi. È il tipo di attrito che porta l'operatore a
 * segnare tutto "conforme" a fine giro, seduto in macchina, invece che sul posto.
 */
/**
 * Registra lo stesso controllo su più presidi. Un PIANO, non un tipo generico.
 *
 * Che cosa faceva prima, e perché era grave
 * -----------------------------------------
 * Prendeva un tipo di controllo e, sui presidi a cui quel tipo non si applicava,
 * **sostituiva in silenzio il primo controllo previsto per la loro tipologia**.
 * Misurato sull'archivio reale: su 923 presidi, **477 (il 51,7%) avrebbero
 * ricevuto un controllo diverso da quello scelto**. Centoventuno porte si
 * sarebbero viste registrare «controllo periodico delle uscite di sicurezza —
 * CONFORME» perché l'operatore aveva scelto il controllo semestrale degli
 * estintori.
 *
 * E ogni registrazione **assolve la scadenza** di quel controllo. Quindi non era
 * rumore: era una scadenza vera chiusa da una verifica che nessuno ha fatto, su
 * un presidio che nessuno ha guardato. Il registro dei controlli è il documento
 * che si mostra a chi chiede se la manutenzione è stata fatta.
 *
 * Adesso non sostituisce niente. I presidi a cui il piano non si applica vengono
 * **esclusi e restituiti**, perché chi ha premuto il pulsante deve sapere su
 * quanti ha davvero registrato — un'esclusione silenziosa e una sostituzione
 * silenziosa si somigliano troppo.
 */
export function registraInterventoDiGruppo(assetIds, dati) {
  if (!dati.piano_id) throw new Error('Serve il piano di verifica da registrare.');
  // La regola «conforme = eseguito per intero» NON è ripetuta qui.
  //
  // Ci avevo messo un controllo preventivo, con la motivazione che senza di
  // esso metà gruppo sarebbe stato registrato prima del rifiuto. Provato con
  // una mutazione: togliendolo non cambia niente. `registraIntervento` solleva
  // sul PRIMO presidio applicabile, e i presidi esclusi non scrivono nulla,
  // quindi l'archivio resta intatto in entrambi i casi. Era una seconda
  // implementazione della stessa regola con una giustificazione falsa — cioè la
  // cosa peggiore da lasciare in un codice, perché la prossima persona la legge
  // e ci crede.
  const registrati = [];
  const esclusi = [];
  for (const id of assetIds) {
    const a = idx.assets.get(id);
    if (!a) continue;
    const applicabile = controlliApplicabili(a)
      .find((t) => t.piano_id === dati.piano_id);
    if (!applicabile) {
      esclusi.push(a);
      continue;
    }
    registrati.push(registraIntervento(id, {
      ...dati,
      tipo_controllo_codice: applicabile.codice,
    }));
  }
  return { registrati, esclusi };
}

/**
 * I controlli che questo presidio deve ricevere, e quanti ne ha ricevuti nel
 * giro in corso.
 *
 * Serve perché «controllato» non è una domanda binaria su un presidio: un
 * estintore ha quattro piani — controllo, revisione, collaudo, rottamazione — e
 * misurato sull'archivio **433 presidi su 919 ne hanno quattro aperti**. Con la
 * sola bandierina, registrare il controllo semestrale faceva risultare
 * «controllato» un estintore a cui mancavano ancora tre verifiche, e la barra di
 * avanzamento contava quel presidio come finito.
 */
/**
 * Un intervento appartiene al giro in corso?
 *
 * Sta qui, in una funzione sola, perché la rispondono in due — `avanzamentoDi`
 * per il singolo presidio e `avanzamentoPerChiave` per i grafici — e due
 * risposte diverse alla stessa domanda producono un grafico che contraddice il
 * numero scritto sopra di lui. È già successo in questo progetto, fra cruscotto
 * e scadenzario, e nessuno dei due segnalava niente.
 */
function interventoNelGiro(i) {
  const sess = stato.sessione.sessione_id;
  if (sess && i.sessione_id) return i.sessione_id === sess;
  // Da quando si conta il «giro», in ordine di preferenza.
  //
  // Il terzo ripiego è quello che chiude un difetto misurato: se l'operatore non
  // preme «inizia giro» — e non è obbligato, ai presidi ci si arriva
  // direttamente dalla loro scheda — `iniziato_il` resta nullo, e allora NIENTE
  // risultava di questo giro. Conseguenze, tutte silenziose: un controllo appena
  // registrato si dichiarava «non di questo giro» e non si poteva annullare,
  // l'avanzamento restava a zero controlli fatti, il riquadro verde «fatto» non
  // compariva e l'elenco «fatti in questo giro» restava vuoto mentre il lavoro
  // veniva salvato regolarmente.
  //
  // Il caricamento del pacchetto è un confine sensato: il pacchetto È l'archivio
  // di prima, quindi tutto ciò che viene registrato dopo averlo aperto è lavoro
  // di adesso, per definizione.
  const da = stato.sessione.iniziato_il || stato.sessione.caricato_il;
  return Boolean(da) && Boolean(i.registrato_il) && i.registrato_il >= da;
}

export function avanzamentoDi(assetId, voci = null) {
  // ⛔ UNA definizione sola di «quanto c'è da fare qui», ed è `vociDelGiro`
  // (19/09/2026, segnalazione dell'operatore).
  //
  // Prima questa funzione ne aveva una sua: contava TUTTE le scadenze aperte del
  // presidio. L'albero dei luoghi diceva quindi «0/4 controlli» su una posizione
  // che, aprendola, aveva **un solo** controllo da fare — le altre tre scadenze
  // erano di ottobre, di gennaio e del 2030. Misurato il 19/09/2026 su ACCIAIOLO
  // «(senza area)»: un presidio, quattro scadenze aperte
  // (SORVEGLIANZA_FUSTI 03/10/2026, PIANO_PFAS 23/10/2026, ANALISI_SCHIUMA
  // 01/01/2027, SOSTITUZIONE_PFAS 23/10/**2030**) e una sola voce da fare.
  // Sull'intero archivio il denominatore era 2095 invece di 1466: **629 controlli
  // che nessuno doveva fare in questo giro**, cioè il 30% della barra.
  //
  // Lo stesso difetto era già stato trovato e corretto il 16/09/2026 sulla RIGA
  // dell'elenco presidi — che da allora usa `vociDelGiro` — e non nell'albero né
  // nelle barre: una correzione giusta applicata a uno dei posti che portavano la
  // stessa logica. Adesso il posto è uno.
  //
  // `voci` è la stessa risposta già calcolata da chi chiama in ciclo (l'albero,
  // il riepilogo): serve solo a non ripetere il lavoro, non cambia il risultato.
  const v = voci || vociDelGiro(assetId);
  return {
    previsti: v.richieste,
    fatti: v.eseguite,
    // `altri` sono i controlli registrati che non erano in scadenza: non sono un
    // errore — si può eseguire un controllo in anticipo — ma non devono gonfiare
    // l'avanzamento.
    altri: v.voci.filter((x) => !x.richiesta && x.eseguita).length,
    // «Completo» vuol dire «non resta niente da fare qui», non «è tutto a posto»:
    // una voce dichiarata non eseguibile è stata trattata e non torna fra i da
    // fare. Che cosa è rimasto non verificato lo dicono `nonEseguibili` e il ⚠
    // dell'elenco.
    completo: v.richieste > 0 && v.mancanti.length === 0,
  };
}

/**
 * L'avanzamento del giro spaccato per una chiave: piano, impianto, tipologia.
 *
 * È quello che i grafici disegnano. Non ricalcola niente per conto suo: legge le
 * stesse `vociDelGiro` che usano `avanzamentoDi` e la riga dell'elenco presidi —
 * «da fare» vuol dire scaduto o in scadenza, non «ha una scadenza aperta nel
 * 2030».
 *
 * Il vincolo che ne deriva è verificabile, ed è verificato
 * (`scripts/scudo/test_grafici_campo.mjs`): con una chiave che non scarta mai
 * niente, la somma delle colonne del grafico deve fare esattamente
 * `riepilogo().controlli_previsti`. Un grafico che somma a un numero diverso da
 * quello scritto sopra di lui è peggio di nessun grafico: si guarda, si crede, e
 * non c'è modo di accorgersene.
 *
 * @param chiaveFn (voce, asset) -> { valore, etichetta, icona } | null
 *        `voce` è una voce di `vociDelGiro`: `{ codice, piano_id, descrizione,
 *        richiesta, eseguita, nonEseguibile }`. Era una SCADENZA fino al
 *        19/09/2026: chi legge `sc.piano_id` continua a funzionare, chi leggeva
 *        `sc.regola_id` no — e nel programma nessuno lo faceva più.
 */
export function avanzamentoPerChiave(chiaveFn, tutto = false) {
  const tuttiGliAssets = (stato.perEntita[E.ASSET] || []).filter((a) => !a.eliminato_il);
  const assets = tutto ? tuttiGliAssets : tuttiGliAssets.filter(nelPerimetro);
  const m = new Map();

  for (const a of assets) {
    // Le stesse voci di `avanzamentoDi` e della riga dell'elenco: una sola
    // definizione di «da fare», altrimenti il grafico contraddice il numero
    // scritto sopra di lui. `vociDelGiro` restituisce già una voce per tipo di
    // controllo, quindi qui non serve deduplicare.
    for (const v of vociDelGiro(a.id).voci) {
      if (!v.richiesta) continue;
      const k = chiaveFn(v, a);
      if (!k) continue;
      if (!m.has(k.valore)) m.set(k.valore, { ...k, previsti: 0, fatti: 0 });
      const riga = m.get(k.valore);
      riga.previsti += 1;
      if (v.eseguita) riga.fatti += 1;
    }
  }

  return [...m.values()]
    .map((v) => ({ ...v, restanti: v.previsti - v.fatti }))
    .sort((x, y) => y.restanti - x.restanti
      || y.previsti - x.previsti
      || String(x.valore).localeCompare(String(y.valore)));
}

/**
 * I controlli registrati in questo giro, dal più recente.
 *
 * L'ordine viene dalla POSIZIONE nell'elenco, non da `registrato_il`: quel campo
 * ha risoluzione al secondo, e il controllo di gruppo ne registra dodici nello
 * stesso istante — ordinarli per data li mescolerebbe a ogni ridisegno.
 */
/**
 * Come stanno i controlli di un presidio, in un colpo solo.
 *
 * Serve all'ELENCO, dove va risposta una domanda sola: devo fermarmi qui?
 * Prima bisognava aprire ogni scheda per saperlo, oppure leggere una riga di
 * testo che nominava UNA scadenza — e un estintore ne ha fino a cinque, quindi
 * quella riga poteva dire «scade fra 49 giorni» mentre un altro controllo era
 * scaduto da un anno.
 *
 * ⛔ Guarda le scadenze del pacchetto E quelle calcolate in campo (24/09/2026,
 * segnalazione dell'operatore: «102 senza scadenze calcolate, ma se ne apro una
 * non vedo problemi» — UISUV-512, tutti e due i controlli fatti nel giro, con
 * il prossimo scritto sulla scheda). Registrare un controllo ASSOLVE la sua
 * scadenza del pacchetto, e la prossima esiste solo in memoria
 * (`prossima_calcolata`); lo stesso vale per quella contata dalla data scritta
 * in campo (`scadenza_calcolata`). Leggendo solo il pacchetto, ogni presidio
 * finito diventava «senza scadenze»: misurato, 13 → 64 dopo aver controllato
 * per intero 60 presidi, 51 falsi.
 *
 * Qui prima c'era scritto che valutare i piani per ogni riga avrebbe reso lento
 * l'elenco: MISURATO il 24/09/2026, `controlliApplicabili` su tutti gli 875
 * presidi costa 22 ms. Il ragionamento era prudente, il numero non lo sostiene.
 *
 * Per ogni tipo di controllo vale la scadenza del pacchetto se è aperta;
 * altrimenti quella calcolata dall'app, esclusi i tipi che in ufficio non
 * generano scadenze (`genera_scadenza = 0`, la sorveglianza), o i due lati
 * conterebbero cose diverse.
 */
export function statoControlliDi(assetId, oggi = new Date()) {
  let scaduti = 0;
  let inScadenza = 0;
  let regolari = 0;
  let prossima = null;
  const conta = (data) => {
    const sem = semaforo(data, oggi);
    if (sem === 'SCADUTO') scaduti += 1;
    else if (sem === 'IN_SCADENZA') inScadenza += 1;
    else regolari += 1;
    if (!prossima || String(data) < String(prossima)) prossima = data;
  };
  const coperti = new Set();
  for (const sc of idx.scadenzePerAsset.get(assetId) || []) {
    if ((sc.stato || 'APERTA') !== 'APERTA') continue;
    conta(sc.data_scadenza);
    coperti.add(sc.tipo_controllo_codice);
  }
  const a = idx.assets.get(assetId);
  if (a) {
    for (const t of controlliApplicabili(a)) {
      if (coperti.has(t.codice)) continue;
      const tc = idx.tipiControllo.get(t.codice) || {};
      if (String(tc.genera_scadenza ?? '1') === '0') continue;
      const data = t.scadenza || t.prossima_calcolata;
      if (data) conta(data);
    }
  }
  const totale = scaduti + inScadenza + regolari;
  const chiave = scaduti ? 'SCADUTO'
    : inScadenza ? 'IN_SCADENZA'
      : totale ? 'REGOLARE' : 'SENZA';
  return { chiave, scaduti, in_scadenza: inScadenza, regolari, totale, prossima };
}

/**
 * Il riassunto dei controlli, a parole, per l'elenco.
 *
 * ⚠️ Dice «verifiche» e lo dice PER PRIMO, e non è una scelta di stile.
 * Segnalato dall'operatore il 17/09/2026 su un caso vero:
 *
 *     ACCIAIOLO-EDIFICIO-EDIFICIO-RIL_FUMO-01 · Rilevatore di fumo
 *     10 pezzi
 *     1 in regola                       <-- si legge «1 pezzo su 10 è a posto»
 *
 * I numeri contano i PIANI DI VERIFICA, non i pezzi, e quel rilevatore ha un
 * piano solo, in regola. Ma la riga sopra parla di pezzi, quindi «1 in regola»
 * subito sotto si legge come il loro seguito — ed è la lettura che allarma: nove
 * rilevatori di fumo guasti su dieci.
 *
 * Il difetto non era nel conto: era che il conto non diceva DI CHE COSA. Un
 * numero senza unità accanto a un altro numero con unità diversa eredita
 * l'unità del vicino.
 */
export function riassuntoControlli(sc) {
  if (!sc || !sc.totale) return 'nessuna scadenza calcolata';
  const parti = [
    sc.scaduti ? `${sc.scaduti} scadut${sc.scaduti === 1 ? 'a' : 'e'}` : null,
    sc.in_scadenza ? `${sc.in_scadenza} in scadenza` : null,
    sc.regolari ? `${sc.regolari} in regola` : null,
  ].filter(Boolean);
  // Singolare e plurale: «verifica: 1 in regola» invece di «verifiche: 1 in regola».
  return `${sc.totale === 1 ? 'verifica' : 'verifiche'}: ${parti.join(' · ')}`;
}

export function interventiDelGiro() {
  return (stato.perEntita[E.INTERVENTO] || [])
    .filter(interventoNelGiro)
    .slice()
    .reverse();
}

/**
 * Che cosa risulta registrato per un controllo: quello che l'operatore vedrà
 * quando vorrà rivedere che cosa ha fatto.
 */
export function dettaglioIntervento(interventoId) {
  const iv = (stato.perEntita[E.INTERVENTO] || []).find((x) => x.id === interventoId);
  if (!iv) return null;
  const azioni = (idx.azioniPerIntervento.get(iv.id) || [])
    .slice()
    .sort((x, y) => Number(x.ordine || 0) - Number(y.ordine || 0));
  const anomalia = (stato.perEntita[E.ANOMALIA] || [])
    .find((x) => x.intervento_apertura_id === iv.id) || null;
  const scadenza = (idx.scadenzePerAsset.get(iv.asset_id) || [])
    .find((x) => x.intervento_id === iv.id) || null;
  const asset = idx.assets.get(iv.asset_id) || null;
  const piano = (idx.piani || []).find((x) => x.id === iv.piano_id) || null;
  const tipo = idx.tipiControllo.get(iv.tipo_controllo_codice) || null;
  // Quando torna. Si conta dall'esecuzione PIÙ RECENTE di quel controllo, non
  // da questa: registrare oggi un verbale cartaceo del 2020 non deve far
  // arretrare una scadenza già calcolata su un'esecuzione più nuova. È la stessa
  // definizione dell'ufficio (`ultima_esecuzione` tiene il massimo).
  const stessoTipo = (idx.interventiPerAsset.get(iv.asset_id) || [])
    .filter((x) => x.tipo_controllo_codice === iv.tipo_controllo_codice
      // Solo il pezzo montato adesso: vedi `valePerIlPezzo`.
      && CAL.valePerIlPezzo(x.matricola_pezzo, (idx.assets.get(iv.asset_id) || {}).matricola));
  const prossima = piano
    ? CAL.prossimaScadenza(CAL.ultimaEsecuzione(stessoTipo),
                           piano.frequenza_valore, piano.frequenza_unita)
    : null;

  return {
    intervento: iv,
    asset,
    azioni,
    anomalia,
    scadenza,
    prossima,
    frequenza_testo: piano
      ? PV.etichettaFrequenza(piano.frequenza_valore, piano.frequenza_unita) : '',
    nome: (piano && piano.denominazione) || (tipo && tipo.descrizione) || iv.tipo_controllo_codice,
    nel_giro: interventoNelGiro(iv),
    // Annullabile solo se è di questo giro: vedi `annullaIntervento`.
    annullabile: interventoNelGiro(iv),
    // Lo stato del presidio si può riportare indietro solo se dopo questo
    // controllo non ne sono stati registrati altri sullo stesso pezzo.
    //
    // L'ordine lo dà la POSIZIONE nell'elenco, non `registrato_il`: quel campo ha
    // risoluzione al secondo, e due controlli registrati nello stesso secondo
    // risultavano entrambi «l'ultimo». Non è un caso di laboratorio — il controllo
    // di gruppo ne registra dodici in un colpo. L'elenco invece è in ordine di
    // inserimento per costruzione, perché ci si scrive solo in coda.
    ultimo_del_presidio: (() => {
      const delGiro = (idx.interventiPerAsset.get(iv.asset_id) || []).filter(interventoNelGiro);
      return delGiro.length > 0 && delGiro[delGiro.length - 1].id === iv.id;
    })(),
  };
}

/**
 * Annulla un controllo registrato in questo giro.
 *
 * Perché serve
 * ------------
 * Si tocca «Conforme» sul presidio sbagliato, o sul piano sbagliato. Senza un
 * annullamento l'unico rimedio è registrare un secondo controllo per
 * "correggere" il primo, che non corregge niente: nel registro restano due
 * controlli, uno dei quali non è mai stato eseguito.
 *
 * Perché SOLO di questo giro
 * --------------------------
 * Perché il rientro in ufficio **sostituisce** le tabelle: `TABELLE_SOSTITUITE`
 * in `scudo_campo_service.py` svuota interventi, scadenze e anomalie e reinserisce
 * quello che il pacchetto contiene. Un intervento del 2019 tolto qui sparirebbe
 * dall'archivio dell'ufficio senza che nessuno lo abbia deciso. La storia si
 * corregge in ufficio, dove c'è un backup e una persona che risponde; in campo si
 * disfa solo quello che si è appena fatto.
 *
 * Che cosa rimette a posto
 * ------------------------
 *  - l'intervento e le sue spunte spariscono;
 *  - la scadenza che aveva assolto torna APERTA;
 *  - l'anomalia aperta da quel controllo viene tolta, ma **solo se nessuno l'ha
 *    toccata**: se è già stata presa in carico o risolta, resta e viene detto;
 *  - lo stato del presidio torna quello di prima, ma **solo se questo è l'ultimo
 *    controllo registrato su quel pezzo**. Lo stato è un campo solo: se dopo
 *    sono stati registrati altri controlli, riportarlo indietro cancellerebbe
 *    quello che dicono loro. In quel caso resta com'è, e la funzione lo dichiara
 *    nel valore di ritorno perché l'interfaccia possa scriverlo.
 *
 * Nel giornale resta l'evento DELETE con dentro il motivo: il giornale viaggia
 * nel pacchetto (`giornale.csv`) e finisce nel change log dell'ufficio, quindi
 * l'annullamento è visibile a chi legge, non è una cancellazione silenziosa.
 */
/**
 * Scrive o corregge la nota di una verifica già registrata.
 *
 * Perché è una cosa diversa da un'anomalia
 * ----------------------------------------
 * L'anomalia sta sul PRESIDIO: «questo estintore ha il cappuccio mancante», ed
 * è un problema aperto finché qualcuno non lo chiude. La nota sta sulla
 * VERIFICA: «il giorno in cui l'ho guardato, era dietro il bancone». Non è un
 * problema, non si chiude, e riguarda quel controllo e non il presidio.
 * Confonderle riempie l'elenco delle cose da fare di frasi che non sono cose da
 * fare, e nasconde i problemi veri in mezzo a esse.
 *
 * Si può annotare QUALUNQUE controllo, anche uno di un altro giro — a
 * differenza dell'annullamento, che è vietato fuori dal proprio giro. La
 * ragione è la direzione: annullare TOGLIE una riga dall'archivio dell'ufficio,
 * annotare ne AGGIUNGE una parte. Al rientro la riga viene sostituita con
 * quella annotata, e non si perde niente di quello che c'era.
 *
 * Passa da `applica`, quindi finisce nel giornale: in ufficio si deve poter
 * vedere che qualcuno ha scritto una nota, e quando.
 */
export function annotaIntervento(interventoId, nota) {
  const iv = (stato.perEntita[E.INTERVENTO] || []).find((x) => x.id === interventoId);
  if (!iv) throw new Error('Controllo non trovato.');
  const testo = String(nota == null ? '' : nota).trim();
  const prima = iv.note || '';
  if (testo === prima) return null;   // niente da scrivere, niente da registrare

  return applica('intervento', iv.id, 'UPDATE', {
    asset_id: iv.asset_id,
    campo: 'note',
    prima,
    dopo: testo,
  }, () => {
    if (testo) iv.note = testo;
    else delete iv.note;
    // ⛔ `device_origine` non si riscrive: il CONTROLLO resta di chi l'ha fatto.
    // Prima la nota di un altro operatore lasciava il nome di chi aveva eseguito
    // il controllo e ci metteva accanto il dispositivo di chi annotava: una riga
    // firmata da una persona e registrata da un telefono che non era il suo.
    // Chi ha scritto la nota sta nel giornale, che dal 19/09/2026 sopravvive
    // alla staffetta.
  });
}

export function annullaIntervento(interventoId, motivo = '') {
  const d = dettaglioIntervento(interventoId);
  if (!d) throw new Error('Controllo non trovato.');
  const iv = d.intervento;

  if (!interventoNelGiro(iv)) {
    throw new Error(
      'Si possono annullare solo i controlli registrati in questo giro. Questo '
      + `è del ${iv.data || '?'}: correggerlo qui lo cancellerebbe anche `
      + "dall'archivio dell'ufficio. Segnalalo come punto aperto.");
  }
  if (!(motivo || '').trim()) {
    throw new Error("Scrivi perché lo annulli: senza motivo, in ufficio un "
      + 'controllo sparito è indistinguibile da un guasto del programma.');
  }

  const anomaliaTolta = d.anomalia && (d.anomalia.stato || 'APERTA') === 'APERTA'
    ? d.anomalia : null;
  const anomaliaRimasta = d.anomalia && !anomaliaTolta ? d.anomalia : null;
  const statoRipristinato = d.ultimo_del_presidio;

  // Lo stato di prima sta nel giornale, scritto al momento della registrazione.
  const ev = [...stato.giornale].reverse().find((x) => x.entita === 'intervento'
    && x.entita_id === iv.id && x.operazione === 'INSERT');
  let prima = null;
  if (ev) {
    try { prima = (JSON.parse(ev.payload) || {}).prima || null; } catch { prima = null; }
  }

  applica('intervento', iv.id, 'DELETE', {
    asset_id: iv.asset_id,
    tipo: iv.tipo_controllo_codice,
    data: iv.data,
    esito: iv.esito,
    motivo: motivo.trim(),
    anomalia_tolta: anomaliaTolta ? anomaliaTolta.id : null,
    stato_ripristinato: statoRipristinato,
  }, () => {
    // 1. le spunte
    if (stato.perEntita[E.INTERVENTO_AZIONE]) {
      stato.perEntita[E.INTERVENTO_AZIONE] = stato.perEntita[E.INTERVENTO_AZIONE]
        .filter((x) => x.intervento_id !== iv.id);
    }
    idx.azioniPerIntervento.delete(iv.id);

    // 2. l'intervento
    stato.perEntita[E.INTERVENTO] = (stato.perEntita[E.INTERVENTO] || [])
      .filter((x) => x.id !== iv.id);
    idx.interventiPerAsset.set(iv.asset_id,
      (idx.interventiPerAsset.get(iv.asset_id) || []).filter((x) => x.id !== iv.id));

    // 3. la scadenza torna aperta
    for (const sc of idx.scadenzePerAsset.get(iv.asset_id) || []) {
      if (sc.intervento_id === iv.id) {
        sc.stato = 'APERTA';
        delete sc.intervento_id;
      }
    }

    // 4. l'anomalia, se nessuno l'ha toccata
    if (anomaliaTolta) {
      stato.perEntita[E.ANOMALIA] = (stato.perEntita[E.ANOMALIA] || [])
        .filter((x) => x.id !== anomaliaTolta.id);
      idx.anomaliePerAsset.set(iv.asset_id,
        (idx.anomaliePerAsset.get(iv.asset_id) || []).filter((x) => x.id !== anomaliaTolta.id));
    }

    // 5. il presidio
    const a = idx.assets.get(iv.asset_id);
    if (a && statoRipristinato && prima) {
      if (prima.stato_codice) a.stato_codice = prima.stato_codice;
      else delete a.stato_codice;
      if (prima.quantita_ko !== '') a.quantita_ko = prima.quantita_ko;
      else delete a.quantita_ko;
      a.modificato_il = adessoIso();
      idx.ricerca.set(a.id, testoRicerca(a));
    }
  });

  return {
    annullato: iv,
    anomalia_tolta: anomaliaTolta,
    anomalia_rimasta: anomaliaRimasta,
    stato_ripristinato: Boolean(statoRipristinato && prima),
  };
}

export function apriAnomalia(assetId, dati) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error(`Presidio ${assetId} non trovato`);
  if (!GRAVITA.includes(dati.gravita)) throw new Error(`Gravità "${dati.gravita}" non valida.`);
  if (!(dati.descrizione || '').trim()) throw new Error("La descrizione dell'anomalia è obbligatoria.");

  const an = {
    id: uuid(),
    asset_id: assetId,
    asset_codice: a.codice,
    // Che cosa ha, scelto da un elenco. La descrizione resta obbligatoria: il
    // tipo serve a contare e a filtrare, non a sostituire quello che
    // l'operatore ha visto con la voce che ci somiglia di più.
    tipo_codice: dati.tipo_codice || '',
    gravita: dati.gravita,
    descrizione: dati.descrizione.trim(),
    azione_proposta: dati.azione_proposta || '',
    quantita_ko: dati.quantita_ko != null ? String(dati.quantita_ko) : '',
    // «Si può usare?» detto da chi apre l'anomalia (23/09/2026): vince sul
    // default del tipo, come la risposta data alla riconferma. Vuoto = non
    // detto, e allora vale il tipo (`anomaliaBlocca`).
    bloccante: dati.bloccante != null && dati.bloccante !== '' ? String(Number(dati.bloccante) ? 1 : 0) : '',
    stato: 'APERTA',
    data_apertura: dati.data_apertura || oggiIso(),
    origine: dati.origine || 'Campo',
    intervento_apertura_id: dati.intervento_apertura_id || '',
    // La verifica a cui il difetto si riferisce (25/09/2026): facoltativa, e
    // solo da un controllo — lì le voci sono quelle di quel giorno.
    verifica_collegata: String(dati.verifica_collegata || '').trim(),
    sessione_id: stato.sessione.sessione_id,
    registrato_il: adessoIso(),
    device_origine: stato.sessione.device_id,
  };
  for (const k of Object.keys(an)) if (an[k] === '') delete an[k];

  applica('anomalia', an.id, 'INSERT', {
    asset_id: assetId, gravita: an.gravita, descrizione: an.descrizione,
  }, () => {
    stato.perEntita[E.ANOMALIA].push(an);
    if (!idx.anomaliePerAsset.has(assetId)) idx.anomaliePerAsset.set(assetId, []);
    idx.anomaliePerAsset.get(assetId).push(an);
  });
  return an;
}

/**
 * «Ancora presente»: l'anomalia è stata vista oggi e non è risolta.
 *
 * Senza, l'unico modo di dirlo era non fare niente — indistinguibile da non
 * averla guardata. Scrive `confermata_il` e `confermata_da`, che viaggiano nel
 * pacchetto (colonne in coda a 5-anomalie.csv, gemelle in scudo_pacchetto.py).
 */
/**
 * Se questa anomalia è già stata guardata IN QUESTO GIRO.
 *
 * ⛔ È la funzione che toglie le riconferme ripetute: un'anomalia confermata
 * dopo l'inizio del giro non si richiede a ogni piano. Misurato prima di
 * scriverla: 403 richieste per 212 anomalie.
 *
 * ⚠️ «In questo giro» e non «oggi»: un giro può durare più giorni, e legarlo
 * alla data farebbe ricominciare le domande a mezzanotte. Se il giro non è
 * ancora iniziato non c'è un confine, e allora nessuna conferma vale — si
 * chiede, che è la risposta prudente.
 */
export function confermataNelGiro(an) {
  if (!an) return false;
  const inizio = (stato.sessione || {}).iniziato_il;
  if (!inizio) return false;
  // ⛔ Anche quella NATA in questo giro (25/09/2026): è stata appena vista, da
  // chi l'ha aperta. Prima al controllo successivo dello stesso presidio veniva
  // chiesta di nuovo come se fosse vecchia, e il non idoneo apriva un'anomalia
  // nuova con la stessa nota — doppioni visti nel verbale dell'operatore
  // (UISUV-701, «Freccia cartello sbagliata» due volte).
  if (an.registrato_il && String(an.registrato_il) >= String(inizio)) return true;
  if (!an.confermata_il) return false;
  return String(an.confermata_il) >= String(inizio).slice(0, 10);
}

export function riconfermaAnomalia(anomaliaId, bloccante) {
  const an = (stato.perEntita[E.ANOMALIA] || []).find((x) => x.id === anomaliaId);
  if (!an) throw new Error('Anomalia non trovata');
  if (!['APERTA', 'IN_CORSO'].includes(an.stato || 'APERTA')) {
    throw new Error("Si riconferma solo un'anomalia aperta.");
  }
  return aggiornaAnomalia(anomaliaId, {
    confermata_il: oggiIso(),
    confermata_da: stato.sessione.operatore || '',
    // ⛔ La risposta alla seconda domanda — «impedisce di usarlo?» — si scrive
    // QUI, nel momento in cui una persona guarda il pezzo. È la deroga per caso
    // singolo che vince sul default del tipo, ed è l'unica che sa distinguere
    // il cartello mancante di un estintore dal maniglione di un'uscita.
    //
    // `undefined` la lascia com'è: riconfermare senza rispondere non cancella
    // la risposta di prima.
    ...(bloccante === undefined ? {} : { bloccante: bloccante ? '1' : '0' }),
  });
}

export function aggiornaAnomalia(anomaliaId, campi) {
  const an = (stato.perEntita[E.ANOMALIA] || []).find((x) => x.id === anomaliaId);
  if (!an) throw new Error('Anomalia non trovata');
  if (campi.stato && !STATI_ANOMALIA.includes(campi.stato)) {
    throw new Error(`Stato anomalia "${campi.stato}" non valido.`);
  }
  if (campi.gravita && !GRAVITA.includes(campi.gravita)) {
    throw new Error(`Gravità "${campi.gravita}" non valida.`);
  }
  const dopo = { ...campi };
  if (['CHIUSA', 'ANNULLATA'].includes(dopo.stato) && !dopo.data_chiusura) {
    dopo.data_chiusura = oggiIso();
  }
  const prima = {};
  for (const k of Object.keys(dopo)) prima[k] = an[k] ?? '';

  applica('anomalia', anomaliaId, 'UPDATE', { prima, dopo }, () => {
    for (const [k, v] of Object.entries(dopo)) {
      if (v === '' || v === null || v === undefined) delete an[k]; else an[k] = String(v);
    }
    // ⛔ `registrato_il` e `device_origine` NON si riscrivono (19/09/2026).
    //
    // In ufficio quella colonna si chiama «Registrata il» ed è la data in cui
    // l'anomalia è NATA: riscriverla quando un altro operatore la chiude — o la
    // riconferma — le sposta la data di apertura, e un difetto aperto a marzo
    // risulta aperto oggi. Lo stesso per il dispositivo: è quello che l'ha
    // registrata, non l'ultimo che l'ha toccata.
    //
    // Prima non si vedeva perché a toccare l'anomalia era sempre chi l'aveva
    // aperta; con la staffetta è normale che sia un altro.
  });
  return an;
}

// --------------------------------------------------------------------------- //
// Il pezzo montato su una postazione è cambiato
// --------------------------------------------------------------------------- //
//
// Il gesto si fa QUI, non in ufficio: è il tecnico sul posto a portare via
// l'estintore e a montare il muletto, ed è l'operatore che gli sta accanto a
// leggere la matricola nuova sull'etichetta.
//
// GEMELLO di `sostituisci_pezzo` in `backend/app/services/scudo_registrazione.py`:
// stessi motivi, stesse regole d'ingresso, stessi campi del pezzo. Se divergono,
// una sostituzione registrata in campo viene rifiutata al rientro — cioè si
// scopre a giro finito, quando il pezzo non si può più guardare.

export const MOTIVI_SOSTITUZIONE = ['RITIRO_REVISIONE', 'RITIRO_COLLAUDO', 'GUASTO',
  'FINE_VITA', 'ALTRO'];

// I campi che descrivono il PEZZO e non la postazione. Elenco esplicito, gemello
// di `CAMPI_PEZZO`: un campo del pezzo che finisse fuori da qui resterebbe quello
// del pezzo vecchio senza che niente lo dica.
export const CAMPI_PEZZO = ['matricola', 'anno_costruzione', 'data_messa_servizio',
  'data_installazione', 'marca', 'modello', 'estinguente', 'carica_kg', 'tipo_serbatoio'];

/** La sostituzione temporanea ancora aperta su questa postazione, se c'è. */
export function sostituzioneAperta(assetId) {
  return (stato.perEntita[E.SOSTITUZIONE] || [])
    .filter((x) => x.asset_id === assetId && !x.eliminato_il
      && String(x.temporanea) === '1' && !x.chiusa_il)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))[0] || null;
}

/** Tutte le sostituzioni di una postazione, dalla più recente. */
export function sostituzioniDi(assetId) {
  return (stato.perEntita[E.SOSTITUZIONE] || [])
    .filter((x) => x.asset_id === assetId && !x.eliminato_il)
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
}

function datiPezzo(a) {
  const fuori = {};
  for (const campo of CAMPI_PEZZO) {
    if (a[campo] !== undefined && a[campo] !== null && a[campo] !== '') fuori[campo] = a[campo];
  }
  return fuori;
}

function scriviDatiPezzo(a, dati) {
  for (const campo of CAMPI_PEZZO) {
    if (!(campo in dati)) continue;
    const v = dati[campo];
    // Un campo a vuoto si TOGLIE invece di restare a "": una stringa vuota si
    // legge come un dato dichiarato vuoto, e qui vuol dire «di questo pezzo non
    // lo sappiamo».
    if (v === null || v === undefined || v === '') delete a[campo];
    else a[campo] = String(v);
  }
}

export function sostituisciPezzo(assetId, dati) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error(`Presidio ${assetId} non trovato`);
  const motivo = String(dati.motivo_codice || '').toUpperCase();
  if (!MOTIVI_SOSTITUZIONE.includes(motivo)) {
    throw new Error(`Motivo «${dati.motivo_codice}» non previsto.`);
  }
  const temporanea = Boolean(dati.temporanea);
  if (temporanea && motivo === 'FINE_VITA') {
    throw new Error('Una sostituzione per fine vita non può essere temporanea: '
      + 'il pezzo arrivato a fine vita non rientra.');
  }
  // Un muletto già montato non si sovrascrive: la fotografia del pezzo da
  // rimettere verrebbe sostituita da quella del muletto, e l'originale
  // diventerebbe irrecuperabile.
  const aperta = sostituzioneAperta(assetId);
  if (aperta) {
    throw new Error(`Qui c'è già un pezzo temporaneo dal ${aperta.data} `
      + `(matricola ${aperta.matricola_entrata || '—'}). Prima dicci se l'originale `
      + 'è rientrato o se non rientrerà più.');
  }

  const uscita = datiPezzo(a);
  const pezzo = { ...(dati.pezzo || {}) };
  if (dati.matricola_entrata !== undefined) pezzo.matricola = dati.matricola_entrata;

  const riga = {
    id: uuid(),
    asset_id: assetId,
    asset_codice: a.codice,
    data: dati.data || oggiIso(),
    matricola_uscita: uscita.matricola || '',
    dati_uscita_json: JSON.stringify(uscita),
    matricola_entrata: pezzo.matricola || '',
    motivo_codice: motivo,
    motivo: (dati.motivo || '').trim(),
    temporanea: temporanea ? '1' : '0',
    rientro_atteso: temporanea ? (dati.rientro_atteso || '') : '',
    documento_rif: (dati.documento_rif || '').trim(),
    operatore_nome: stato.sessione.operatore || '',
    note: (dati.note || '').trim(),
    sessione_id: stato.sessione.sessione_id,
    registrato_il: adessoIso(),
    device_origine: stato.sessione.device_id,
  };

  applica('sostituzione', riga.id, 'INSERT', {
    asset_id: assetId, da: riga.matricola_uscita, a: riga.matricola_entrata,
    motivo, temporanea, prima: uscita,
  }, () => {
    if (!stato.perEntita[E.SOSTITUZIONE]) stato.perEntita[E.SOSTITUZIONE] = [];
    stato.perEntita[E.SOSTITUZIONE].push(riga);
    scriviDatiPezzo(a, pezzo);
    a.modificato_il = adessoIso();
    a.modificato_da = stato.sessione.operatore || '';
  });
  return riga;
}

/**
 * La sostituzione temporanea si chiude: che cosa c'è adesso su questa postazione?
 *
 * Si chiede la MATRICOLA, non «è rientrato sì/no». La ditta antincendio lavora a
 * rotazione su più sedi Terna e solo questa usa Scudo: al ritiro può riportare
 * estintori che qui non sono mai stati. Chi è in campo legge l'etichetta; la
 * conclusione la ricava questa funzione.
 */
export function chiudiSostituzione(sostituzioneId, dati) {
  const so = (stato.perEntita[E.SOSTITUZIONE] || []).find((x) => x.id === sostituzioneId);
  if (!so) throw new Error('Sostituzione non trovata');
  if (so.chiusa_il) throw new Error(`Già chiusa il ${so.chiusa_il}.`);
  if (String(so.temporanea) !== '1') {
    throw new Error('Questa sostituzione è definitiva: non c\'è niente in sospeso.');
  }
  const a = idx.assets.get(so.asset_id);
  if (!a) throw new Error('Presidio non trovato');

  const presente = String(dati.matricola_presente || '').trim();
  if (!presente) {
    throw new Error('Dimmi la matricola del pezzo che c\'è adesso: senza, non si '
      + 'può sapere se è tornato il nostro o se ne è arrivato un altro.');
  }
  const eLOriginale = Boolean(String(so.matricola_uscita || '').trim())
    && presente === String(so.matricola_uscita).trim();
  const eIlMuletto = presente === String(so.matricola_entrata || '').trim();
  const data = dati.data || oggiIso();

  applica('sostituzione', so.id, 'UPDATE', {
    asset_id: a.id, chiusa_il: data, matricola_presente: presente,
    esito: eLOriginale ? 'RIENTRATO' : 'NON_RIENTRA',
  }, () => {
    if (eLOriginale) {
      let prima = {};
      try { prima = JSON.parse(so.dati_uscita_json || '{}'); } catch { prima = {}; }
      scriviDatiPezzo(a, prima);
      a.modificato_il = adessoIso();
      a.modificato_da = stato.sessione.operatore || '';
    }
    so.chiusa_il = data;
    so.esito_chiusura = eLOriginale ? 'RIENTRATO' : 'NON_RIENTRA';
    so.temporanea = '0';
  });

  // Il terzo pezzo: né il nostro né il muletto. È una sostituzione a tutti gli
  // effetti — il muletto esce, lui entra — e va registrata come tale, o quel
  // pezzo arriverebbe in archivio senza una riga che dica da dove viene.
  let terza = null;
  if (!eLOriginale && !eIlMuletto) {
    terza = sostituisciPezzo(a.id, {
      matricola_entrata: presente,
      pezzo: { ...(dati.pezzo || {}), matricola: presente },
      motivo_codice: 'ALTRO',
      motivo: `Arrivato al posto del pezzo temporaneo ${so.matricola_entrata || '—'}: `
        + `il nostro (${so.matricola_uscita || '—'}) non è rientrato.`,
      temporanea: false, data,
    });
  }
  return { sostituzione: so, esito: so.esito_chiusura, terza };
}

// --------------------------------------------------------------------------- //
// Anagrafica creata in campo
// --------------------------------------------------------------------------- //
//
// Un impianto o un locale che l'operatore trova e non può registrare è un dato
// che si perde: viene scritto su un foglio, o non viene scritto. Qui si crea,
// entra subito negli indici (quindi diventa selezionabile per i presidi nello
// stesso giro) e viaggia nel pacchetto come qualunque altra riga.
//
// Il duplicato si intercetta qui e non al rientro: scoprire in ufficio che
// esistono "Cabina 1" e "CABINA 1" significa doverli fondere a mano, con i
// presidi già appesi a entrambi.

function _duplicato(righe, campo, valore, filtro) {
  const n = (valore || '').trim().toUpperCase();
  return righe.some((r) => (!filtro || filtro(r)) && (r[campo] || '').trim().toUpperCase() === n);
}

export function creaImpianto(dati) {
  const nome = (dati.denominazione || '').trim();
  if (!nome) throw new Error("La denominazione dell'impianto è obbligatoria.");
  const righe = stato.perEntita[E.IMPIANTO] || [];
  if (_duplicato(righe, 'denominazione', nome)) {
    throw new Error(`Esiste già un impianto "${nome}".`);
  }
  const id = uuid();
  const imp = {
    id,
    ui_id: dati.ui_id || (stato.perEntita[E.UI] || [{}])[0].id || '',
    denominazione: nome,
    tipologia: dati.tipologia || '',
    codice_terna: dati.codice_terna || '',
    comune: dati.comune || '',
    provincia: dati.provincia || '',
    via: dati.via || '',
    civico: dati.civico || '',
    cap: dati.cap || '',
    indirizzo: dati.indirizzo || '',
    codici_attivita: dati.codici_attivita || '',
    scia_protocollo: dati.scia_protocollo || '',
    scia_data: dati.scia_data || '',
    conformita_ultimo_rinnovo: dati.conformita_ultimo_rinnovo || '',
    conformita_scadenza: dati.conformita_scadenza || '',
    distaccamento: dati.distaccamento || '',
    presidiato: '0',
    attivo: '1',
    note: dati.note || '',
    ...posizioneDa(dati),
  };
  return applica('impianto', id, 'CREATE', imp, () => {
    (stato.perEntita[E.IMPIANTO] = righe).push(imp);
    costruisciIndici();
  }) && imp;
}

/**
 * I dati del REGISTRO ANTINCENDIO di un impianto: CPI, SCIA, attività, persone.
 *
 * ⛔ Una funzione a sé e non `modificaUbicazione('impianto', …)`, e non è una
 * duplicazione: quella scrive dove sta un luogo — nome, posizione — e la usa
 * chiunque; questa scrive il titolo autorizzativo di un sito e i nomi delle
 * persone responsabili. Tenerle separate è ciò che permette di mettere una
 * password su una e non sull'altra, ed è la regola che l'operatore ha chiesto
 * il 20/09/2026: la posizione la prende chi è sul posto, il numero del CPI lo
 * cambia chi ha la password.
 *
 * ⚠️ Passa da `applica(...)` come ogni altra scrittura: senza il giornale, una
 * modifica fatta in campo non sopravvivrebbe al passaggio di mano e in ufficio
 * nessuno saprebbe chi l'ha fatta.
 */
export const CAMPI_REGISTRO_IMPIANTO = [
  'codici_attivita', 'cpi_numero', 'cpi_rilascio', 'cpi_scadenza',
  'scia_protocollo', 'scia_data', 'conformita_ultimo_rinnovo', 'conformita_scadenza',
  'datore_lavoro', 'medico_competente', 'rspp', 'aspp', 'rlsa',
  'responsabile_registro', 'squadra_emergenza', 'piano_emergenza',
  // ⛔ `ultima_prova_evacuazione` mancava, ed è il QUINTO elenco in cui
  // mancava (22/09/2026): il modello ce l'ha, i due gemelli del pacchetto pure,
  // ma l'elenco bianco del server, il modulo dell'ufficio, quello del campo e
  // questo la lasciavano cadere. Nessuno dei quattro dava un errore — un
  // elenco bianco scarta in silenzio — quindi la data della prova di
  // evacuazione si poteva scrivere e non si salvava da nessuna parte.
  //
  // Il censimento che impedisce al sesto di nascere è
  // `scripts/scudo/test_campi_impianto_cross.py`.
  'ultima_prova_evacuazione',
];

/**
 * Gli obblighi che scadono su un IMPIANTO: CPI, conformità, prova di evacuazione.
 *
 * ⛔ Una funzione a sé e non `scadenzeDi`, che è per i presidi. Le due famiglie
 * si tengono separate fin dal nome: mescolarle vorrebbe dire che ogni conteggio
 * di «verifiche scadute» comprende anche i certificati — che non sono verifiche
 * e non li fa l'operatore in giro.
 */
export function obblighiDiImpianto(impiantoId) {
  return (stato.perEntita[E.SCADENZA] || [])
    .filter((s) => s.impianto_id === impiantoId && (s.stato || 'APERTA') === 'APERTA')
    .sort((a, b) => String(a.data_scadenza || '').localeCompare(String(b.data_scadenza || '')));
}

export function modificaImpianto(impiantoId, dati) {
  const riga = (stato.perEntita[E.IMPIANTO] || []).find((r) => r.id === impiantoId);
  if (!riga) throw new Error('Impianto non trovato.');
  const campi = {};
  for (const k of CAMPI_REGISTRO_IMPIANTO) {
    if (dati[k] === undefined) continue;
    campi[k] = String(dati[k] == null ? '' : dati[k]).trim();
  }
  // ⛔ Un elenco bianco, non `Object.entries(dati)`: così un campo che non
  // appartiene al registro — la denominazione, la posizione — non si può
  // cambiare da questa porta per sbaglio. Le colonne del pacchetto sono le
  // stesse, quindi un campo fuori elenco sparirebbe comunque all'esportazione:
  // scriverlo e poi perderlo è peggio che rifiutarlo.
  if (!Object.keys(campi).length) throw new Error('Niente da salvare.');
  return applica('impianto', impiantoId, 'UPDATE', campi, () => {
    for (const [k, v] of Object.entries(campi)) riga[k] = v;
    costruisciIndici();
  });
}

/**
 * I quattro campi della posizione, ripuliti: si scrivono solo se c'è una
 * coordinata vera.
 *
 * ⚠️ Tutti e quattro insieme o nessuno. L'accuratezza senza le coordinate non
 * dice niente, e le coordinate senza l'accuratezza sono il ripiego-che-sembra-
 * un-dato già costato una correzione su 602 presidi: su una stazione elettrica
 * cento metri sono l'edificio sbagliato, e senza il numero accanto una
 * posizione presa male è indistinguibile da una presa bene.
 */
function posizioneDa(dati) {
  const lat = String((dati || {}).lat ?? '').trim();
  const lon = String((dati || {}).lon ?? '').trim();
  if (!lat || !lon) return {};
  const acc = String((dati || {}).gps_accuratezza_m ?? '').trim();
  return {
    lat,
    lon,
    gps_accuratezza_m: acc,
    // La data si riempie da sé solo per una posizione MISURATA (c'è
    // l'accuratezza). Una messa A MANO sulla mappa non è un rilievo: resta senza
    // data, come quando la croce corregge un luogo che c'è già (25/09/2026 —
    // creando un'area a mano la data compariva, correggendola no).
    gps_rilevato_il: String((dati || {}).gps_rilevato_il ?? '').trim() || (acc ? oggiIso() : ''),
  };
}

export function creaEdificio(dati) {
  const nome = (dati.denominazione || '').trim();
  if (!nome) throw new Error("La denominazione dell'area è obbligatoria.");
  if (!idx.impianti.has(dati.impianto_id)) throw new Error('Impianto inesistente.');
  const righe = stato.perEntita[E.EDIFICIO] || [];
  if (_duplicato(righe, 'denominazione', nome, (r) => r.impianto_id === dati.impianto_id)) {
    throw new Error(`Esiste già un'area "${nome}" in questo impianto.`);
  }
  const id = uuid();
  const e = {
    id, impianto_id: dati.impianto_id, denominazione: nome, note: dati.note || '',
    ...posizioneDa(dati),
  };
  return applica('edificio', id, 'CREATE', e, () => {
    (stato.perEntita[E.EDIFICIO] = righe).push(e);
    costruisciIndici();
  }) && e;
}

export function creaLocale(dati) {
  const nome = (dati.denominazione || '').trim();
  if (!nome) throw new Error("La denominazione dell'ubicazione è obbligatoria.");
  if (!idx.edifici.has(dati.edificio_id)) throw new Error('Area inesistente.');
  const righe = stato.perEntita[E.LOCALE] || [];
  if (_duplicato(righe, 'denominazione', nome, (r) => r.edificio_id === dati.edificio_id)) {
    throw new Error(`Esiste già un'ubicazione "${nome}" in quest'area.`);
  }
  const id = uuid();
  const l = {
    id, edificio_id: dati.edificio_id, denominazione: nome,
    piano: dati.piano || '', note: dati.note || '',
    ...posizioneDa(dati),
  };
  return applica('locale', id, 'CREATE', l, () => {
    (stato.perEntita[E.LOCALE] = righe).push(l);
    costruisciIndici();
  }) && l;
}

/**
 * Un luogo è nato IN QUESTO GIRO, sul telefono?
 *
 * È la chiave della regola che l'operatore ha chiesto il 19/09/2026: «deve essere
 * possibile, senza password admin, modificare o eliminare solo le aree/ubicazioni
 * create dall'operatore, mentre la gestione totale richiede password admin».
 *
 * La risposta sta nel GIORNALE e non in una colonna: un luogo creato qui ha il
 * suo evento CREATE, e il giornale è per definizione il lavoro di questo giro.
 * Dopo il rientro quel locale torna dall'ufficio come tutti gli altri, e da quel
 * momento rinominarlo o cancellarlo tocca righe che qualcun altro sta usando:
 * giusto che chieda la password. La regola non ha bisogno di nessun campo nuovo
 * nel pacchetto, e quindi non ha bisogno che l'ufficio la conosca.
 */
export function luogoCreatoInCampo(tipo, id) {
  if (!tipo || !id) return false;
  // ⚠️ Un CREATE nato da uno SPOSTAMENTO non conta (22/09/2026): quando un
  // luogo cambia livello nasce una riga nuova, e quando uno spostamento si
  // annulla la riga vecchia rinasce — ma in nessuno dei due casi l'ha creata
  // l'operatore. Contarli aprirebbe una scorciatoia alla regola della password:
  // basterebbe spostare un luogo dell'ufficio avanti e indietro per poterlo poi
  // rinominare o cancellare senza admin.
  // E per la stessa ragione non conta il CREATE di un annullamento (23/09/2026):
  // cancellare un luogo dell'ufficio e annullare lo rimette, ma non l'ha creato
  // l'operatore.
  return (stato.giornale || []).some((e) => {
    if (e.entita !== tipo || e.entita_id !== id || e.operazione !== 'CREATE') return false;
    const payload = JSON.parse(e.payload || '{}');
    return !payload.spostamento && !payload.annulla_evento;
  });
}

/**
 * Le righe di presidio che stanno sotto un luogo, discendenti compresi.
 *
 * ⚠️ Conta le RIGHE e non i pezzi, ed è voluto: serve a rispondere «si può
 * cancellare?», e la risposta è no anche se la riga vale un pezzo solo. Conta
 * anche i presidi eliminati in campo: la loro riga viaggia comunque nel
 * pacchetto e punta a questo locale.
 */
export function presidiSotto(tipo, id) {
  const assets = stato.perEntita[E.ASSET] || [];
  if (tipo === 'locale') return assets.filter((a) => a.locale_id === id).length;
  if (tipo === 'edificio') return assets.filter((a) => a.edificio_id === id).length;
  if (tipo === 'impianto') return assets.filter((a) => a.impianto_id === id).length;
  return 0;
}

/** I luoghi figli di un luogo: servono a dire perché non si può cancellare. */
export function figliDiLuogo(tipo, id) {
  if (tipo === 'impianto') {
    return (stato.perEntita[E.EDIFICIO] || []).filter((e) => e.impianto_id === id).length;
  }
  if (tipo === 'edificio') {
    return (stato.perEntita[E.LOCALE] || []).filter((l) => l.edificio_id === id).length;
  }
  return 0;
}

/**
 * Perché questo luogo NON si può cancellare, oppure null.
 *
 * Una funzione sola, non un `if` nella schermata: la stessa domanda se la pongono
 * il pulsante (per spegnersi) e la cancellazione (per rifiutare), e due risposte
 * diverse vorrebbero dire un pulsante acceso che poi non funziona.
 */
/**
 * I presidi VIVI dentro un luogo, compresi quelli delle sue ubicazioni (26/09/2026).
 *
 * `presidiSotto` conta anche i presidi RIMOSSI (`eliminato_il`), che l'albero non
 * mostra: su un luogo che l'albero diceva «vuoto» la cancellazione rispondeva
 * «ci sono presidi» (segnalazione dell'operatore). Quelli rimossi non impediscono
 * più niente: alla cancellazione perdono il riferimento al luogo
 * (`eliminaUbicazione`), o il pacchetto nominerebbe un luogo che non c'è.
 */
export function presidiViviSotto(tipo, id) {
  const campo = { impianto: 'impianto_id', edificio: 'edificio_id', locale: 'locale_id' }[tipo];
  if (!campo) return 0;
  return (stato.perEntita[E.ASSET] || []).filter((a) => !a.eliminato_il && a[campo] === id).length;
}

export function motivoNonEliminabile(tipo, id) {
  const n = presidiViviSotto(tipo, id);
  if (n) {
    return (n === 1
      ? "Qui dentro c'è un presidio: spostalo prima, "
      : `Qui dentro ci sono ${n} presidi: spostali prima, `)
      + 'oppure questa riga sparirebbe dal pacchetto portandoseli dietro.';
  }
  // ⛔ Un'AREA con dentro solo ubicazioni VUOTE si elimina, e le ubicazioni se ne
  // vanno con lei (26/09/2026, dall'operatore: «anche se le ubicazioni sono tutte
  // vuote il cestino è disattivato»). Farle cancellare una per una prima era un
  // lavoro senza senso: vuote, non portano via niente. I presidi vivi sono già
  // contati sopra, compresi quelli delle ubicazioni (hanno anche `edificio_id`).
  // Per un IMPIANTO resta la regola di prima: prima si tolgono le aree.
  const f = tipo === 'edificio' ? 0 : figliDiLuogo(tipo, id);
  if (f) {
    const nome = tipo === 'impianto' ? (f === 1 ? 'un\'area' : `${f} aree`)
      : (f === 1 ? 'un\'ubicazione' : `${f} ubicazioni`);
    return `Qui dentro c'è ${nome}: cancella prima quelle.`;
  }
  return null;
}

/**
 * Cancella un luogo vuoto.
 *
 * ⚠️ Cancellazione VERA, non logica, e la ragione sta nel formato: `1-impianti`,
 * `2-edifici` e `3-locali` non hanno una colonna `eliminato_il` (a differenza dei
 * presidi), e al rientro l'ufficio SOSTITUISCE quelle tabelle con quelle del
 * pacchetto (`TABELLE_SOSTITUITE`). Una riga tolta di qui è quindi una riga tolta
 * dall'archivio, senza bisogno di nessuna colonna nuova né di nessun accordo con
 * l'ufficio.
 *
 * È anche il motivo per cui `motivoNonEliminabile` è severo: una riga di luogo
 * che sparisce mentre un presidio la nomina lascerebbe quel presidio senza
 * ubicazione al rientro.
 */
export function eliminaUbicazione(tipo, id) {
  const entita = { impianto: E.IMPIANTO, edificio: E.EDIFICIO, locale: E.LOCALE }[tipo];
  if (!entita) throw new Error(`Tipo di ubicazione sconosciuto: ${tipo}`);
  const righe = stato.perEntita[entita] || [];
  const i = righe.findIndex((r) => r.id === id);
  if (i < 0) throw new Error('Ubicazione non trovata.');
  const motivo = motivoNonEliminabile(tipo, id);
  if (motivo) throw new Error(motivo);
  const riga = righe[i];
  // Un'area porta via con sé le sue ubicazioni, VUOTE (`motivoNonEliminabile` lo ha
  // appena verificato): un evento ciascuna, con la riga intera, così «clicca per
  // annullare» le rimette tutte (26/09/2026).
  if (tipo === 'edificio') {
    for (const l of (stato.perEntita[E.LOCALE] || []).filter((x) => x.edificio_id === id)) {
      eliminaUbicazione('locale', l.id);
    }
  }
  // I presidi RIMOSSI che puntano qui perdono il riferimento, con il «prima»: il
  // pacchetto nominerebbe un luogo che non c'è, e la validazione lo rifiuterebbe.
  const campo = { impianto: 'impianto_id', edificio: 'edificio_id', locale: 'locale_id' }[tipo];
  if (tipo !== 'impianto') {
    for (const a of (stato.perEntita[E.ASSET] || []).filter((x) => x.eliminato_il && x[campo] === id)) {
      // Solo gli ID: i nomi di contesto (`edificio`, `locale`) li riscrive
      // l'esportazione, e l'annullamento passa da `aggiornaAsset`, che non li accetta.
      const togli = tipo === 'edificio' ? ['edificio_id', 'locale_id'] : ['locale_id'];
      const prima = Object.fromEntries(togli.filter((k) => k in a).map((k) => [k, a[k]]));
      applica('asset', a.id, 'UPDATE', { prima, dopo: Object.fromEntries(togli.map((k) => [k, ''])) }, () => {
        for (const k of togli) a[k] = '';
      });
    }
  }
  // La riga INTERA nel giornale, non solo il nome: è quello che permette di
  // rimetterla con «clicca per annullare» (23/09/2026). Col solo nome, rimettere
  // un luogo vorrebbe dire inventarne note, posizione e padre.
  return applica(tipo, id, 'DELETE', { denominazione: riga.denominazione, riga: { ...riga } }, () => {
    righe.splice(righe.indexOf(riga), 1);
    costruisciIndici();
  });
}

/** Rinomina un'ubicazione esistente (impianto, edificio o locale). */
export function modificaUbicazione(tipo, id, campi) {
  const mappa = {
    impianto: [E.IMPIANTO, idx.impianti],
    edificio: [E.EDIFICIO, idx.edifici],
    locale: [E.LOCALE, idx.locali],
  }[tipo];
  if (!mappa) throw new Error(`Tipo di ubicazione sconosciuto: ${tipo}`);
  const [entita] = mappa;
  const riga = (stato.perEntita[entita] || []).find((r) => r.id === id);
  if (!riga) throw new Error('Ubicazione non trovata.');
  if (campi.denominazione !== undefined && !String(campi.denominazione).trim()) {
    throw new Error('La denominazione è obbligatoria.');
  }
  // ⛔ `{ prima, dopo }` dal 23/09/2026, come per i presidi. Prima l'evento
  // portava solo i campi nuovi: si sapeva che cosa era diventato, non che cosa
  // era, e quindi uno spostamento sulla mappa non si poteva annullare. Gli
  // eventi vecchi (piatti) restano leggibili: `descriviEvento` li riconosce, e
  // `annullaEventi` li rifiuta invece di inventarne il «prima».
  // Nel «prima» solo i campi che la riga AVEVA: uno assente e uno vuoto nel
  // pacchetto si scrivono uguali, ma rimettere `''` dove non c'era niente non
  // è rimettere la riga com'era (la prova dell'annullamento lo vede).
  const prima = Object.fromEntries(Object.keys(campi).filter((k) => k in riga).map((k) => [k, riga[k]]));
  return applica(tipo, id, 'UPDATE', { prima, dopo: { ...campi } }, () => {
    for (const [k, v] of Object.entries(campi)) riga[k] = v === null ? '' : String(v);
    costruisciIndici();
  });
}

// --------------------------------------------------------------------------- //
// Spostare nell'albero: aree, ubicazioni e presidi, come cartelle (22/09/2026)
// --------------------------------------------------------------------------- //
//
// Richiesta dell'operatore: «nella tab albero l'admin deve poter spostare le
// aree da un livello a un altro, da un'ubicazione a un'altra, da un impianto a
// un altro, come se fossero cartelle. Spostando l'ubicazione, tutti i presidi e
// le aree sottostanti devono essere spostati. Un'area di secondo livello che
// sotto ha aree di terzo livello non deve poter essere spostata su un'area di
// terzo livello, altrimenti si va oltre la profondità consentita. E non deve
// corrompere i controlli in corso».
//
// I livelli sono TRE e fissi: impianto → area (`edificio`) → ubicazione
// (`locale`). Un presidio sta sempre in un'ubicazione (obbligatoria dal
// 19/09/2026). Da qui tutte le regole:
//
// | che cosa           | su un impianto            | su un'area                 | su un'ubicazione |
// |--------------------|---------------------------|----------------------------|------------------|
// | presidio           | no: gli serve un'ubicaz.  | no: gli serve un'ubicaz.   | SPOSTA           |
// | ubicazione         | DIVENTA AREA, se è vuota  | SPOSTA, con i suoi presidi | no: 4° livello   |
// | area               | SPOSTA, con tutto dentro  | DIVENTA UBICAZIONE, se non | no: 4° livello   |
// |                    |                           | ha ubicazioni sotto        |                  |
//
// ⛔ Perché «non corrompe i controlli in corso», detto in una riga per ciascuno:
//  * controlli, anomalie, scadenze e sostituzioni si agganciano al presidio per
//    `asset_id`, e il presidio NON cambia id: lo seguono ovunque vada;
//  * l'ufficio al rientro sostituisce l'archivio con il pacchetto (validato:
//    nessun riferimento orfano), e mentre il giro è fuori anagrafica e presidi
//    sono bloccati in ufficio (423) — nessuno sta modificando in parallelo le
//    righe che si spostano;
//  * due luoghi con lo STESSO NOME sotto lo stesso padre violano un vincolo di
//    unicità dell'archivio (`uq_edificio_denom`, `uq_locale_denom`) e fanno
//    fallire l'INTERO rientro: si rifiutano qui, prima, e con il nome;
//  * le colonne «di comodo» (il NOME di impianto, area e ubicazione scritto
//    sulla riga) si riscrivono: l'ufficio le usa come ripiego quando un id
//    manca, e un nome rimasto vecchio riaggancerebbe un presidio al posto di
//    prima.
//
// Tutto o niente: il piano si calcola per intero PRIMA di scrivere, e un solo
// elemento che non si può spostare ferma tutto lo spostamento, con il motivo.

const LIVELLO_LUOGO = { impianto: 1, edificio: 2, locale: 3 };

/** La riga viva di un luogo o di un presidio, o undefined. */
function rigaDelNodo(tipo, id) {
  if (tipo === 'impianto') return idx.impianti.get(id);
  if (tipo === 'edificio') return idx.edifici.get(id);
  if (tipo === 'locale') return idx.locali.get(id);
  if (tipo === 'presidio') return idx.assets.get(id);
  return undefined;
}

/** Come si chiama un elemento in una frase: «l'area «Sala»», «il presidio #12». */
export function nomeNelleFrasi(tipo, riga) {
  const n = (x) => `«${x}»`;
  if (!riga) return 'un elemento che non esiste più';
  if (tipo === 'impianto') return `l'impianto ${n(riga.denominazione || '?')}`;
  if (tipo === 'edificio') return `l'area ${n(riga.denominazione || '?')}`;
  if (tipo === 'locale') return `l'ubicazione ${n(riga.denominazione || '?')}`;
  return `il presidio ${n(riga.identificativo || riga.matricola || riga.codice || riga.id)}`;
}

/** Lo stesso, dopo «in»: «nell'area «Sala»» e non «in l'area». */
function dentroNelleFrasi(tipo, riga) {
  const nome = `«${(riga && riga.denominazione) || '?'}»`;
  return { impianto: `nell'impianto ${nome}`, edificio: `nell'area ${nome}`,
    locale: `nell'ubicazione ${nome}` }[tipo] || `in ${nomeNelleFrasi(tipo, riga)}`;
}

/** E dopo «su»: «sull'area «Sala»» e non «su l'area». */
function suNelleFrasi(tipo, riga) {
  const nome = `«${(riga && riga.denominazione) || '?'}»`;
  return { impianto: `sull'impianto ${nome}`, edificio: `sull'area ${nome}`,
    locale: `sull'ubicazione ${nome}` }[tipo] || `su ${nomeNelleFrasi(tipo, riga)}`;
}

const normaNome = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+/g, ' ').trim().toLocaleUpperCase();

/**
 * Che cosa succederebbe spostando `elementi` su `destinazione`, SENZA scrivere.
 *
 * È la stessa domanda che si pongono il trascinamento (per colorare di verde o
 * di rosso la destinazione sotto il dito), il pulsante «Sposta qui» (per
 * spegnersi con il motivo scritto) e lo spostamento vero (per rifiutare): una
 * funzione sola, perché tre risposte diverse vorrebbero dire una destinazione
 * verde che poi non accetta.
 *
 * @param elementi     `[{ tipo: 'edificio'|'locale'|'presidio', id }]`
 * @param destinazione `{ tipo: 'impianto'|'edificio'|'locale', id }`
 * @returns `{ ok, motivo, operazioni, riassunto }` — `motivo` è la frase da
 *   mostrare quando `ok` è falso; `riassunto` dice che cosa si porta dietro.
 */
export function pianoSpostamento(elementi, destinazione) {
  const no = (motivo) => ({ ok: false, motivo, operazioni: [], riassunto: null });
  const dt = destinazione && destinazione.tipo;
  const dest = dt && rigaDelNodo(dt, destinazione.id);
  if (!dest || !LIVELLO_LUOGO[dt]) return no('La destinazione non è un impianto, un\'area o un\'ubicazione.');
  if (!Array.isArray(elementi) || !elementi.length) return no('Non hai scelto niente da spostare.');

  // Dove finisce, livello per livello.
  let impDest = null; let ediDest = null; let locDest = null;
  if (dt === 'impianto') impDest = dest;
  if (dt === 'edificio') { ediDest = dest; impDest = idx.impianti.get(dest.impianto_id); }
  if (dt === 'locale') {
    locDest = dest; ediDest = idx.edifici.get(dest.edificio_id);
    impDest = ediDest && idx.impianti.get(ediDest.impianto_id);
  }
  if (!impDest) return no('La destinazione non è agganciata a nessun impianto: correggila prima.');

  // Elementi validi e senza doppioni.
  const visti = new Set();
  const scelti = [];
  for (const e of elementi) {
    const k = `${e && e.tipo}:${e && e.id}`;
    if (visti.has(k)) continue;
    visti.add(k);
    if (!e || !['edificio', 'locale', 'presidio'].includes(e.tipo)) {
      return no(e && e.tipo === 'impianto'
        ? 'Un impianto non si sposta: è la radice dell\'albero. Si spostano le sue aree.'
        : 'Uno degli elementi scelti non si può spostare.');
    }
    const riga = rigaDelNodo(e.tipo, e.id);
    if (!riga || (e.tipo === 'presidio' && riga.eliminato_il)) {
      return no('Uno degli elementi scelti non esiste più: ricarica l\'albero.');
    }
    scelti.push({ tipo: e.tipo, id: e.id, riga });
  }

  // Chi sta DENTRO un altro scelto viene con lui: si toglie dall'elenco invece di
  // spostarlo due volte (prima col padre, poi da solo verso la destinazione).
  const sceltiEdifici = new Set(scelti.filter((x) => x.tipo === 'edificio').map((x) => x.id));
  const sceltiLocali = new Set(scelti.filter((x) => x.tipo === 'locale').map((x) => x.id));
  const conIlPadre = [];
  const radici = scelti.filter((x) => {
    const dentro = (x.tipo === 'locale' && sceltiEdifici.has(x.riga.edificio_id))
      || (x.tipo === 'presidio' && (sceltiLocali.has(x.riga.locale_id)
        || sceltiEdifici.has(x.riga.edificio_id)));
    if (dentro) conIlPadre.push(x);
    return !dentro;
  });

  const assets = stato.perEntita[E.ASSET] || [];
  const attiviIn = (campo, id) => assets.filter((a) => !a.eliminato_il && a[campo] === id);
  const tuttiIn = (campo, id) => assets.filter((a) => a[campo] === id);

  // I NOMI che ogni padre avrà dopo lo spostamento: due uguali fanno fallire il
  // rientro (vincolo di unicità dell'archivio). Si parte da quelli che ci sono,
  // si tolgono quelli che se ne vanno e si aggiungono quelli che arrivano.
  const partono = new Set(radici.filter((x) => x.tipo !== 'presidio').map((x) => x.id));
  const nomiSotto = new Map();
  const nomiDi = (tipoFigli, padreId) => {
    const k = `${tipoFigli}:${padreId}`;
    if (!nomiSotto.has(k)) {
      const righe = tipoFigli === 'edificio'
        ? [...idx.edifici.values()].filter((r) => r.impianto_id === padreId)
        : [...idx.locali.values()].filter((r) => r.edificio_id === padreId);
      nomiSotto.set(k, new Map(righe.filter((r) => !partono.has(r.id))
        .map((r) => [normaNome(r.denominazione), r.denominazione])));
    }
    return nomiSotto.get(k);
  };
  const arriva = (tipoFigli, padreId, riga, doveNome) => {
    const nomi = nomiDi(tipoFigli, padreId);
    const n = normaNome(riga.denominazione);
    if (nomi.has(n)) {
      return `${doveNome[0].toUpperCase()}${doveNome.slice(1)} c'è già ${tipoFigli === 'edificio' ? "un'area" : "un'ubicazione"} `
        + `«${nomi.get(n)}»: due luoghi con lo stesso nome nello stesso posto farebbero `
        + 'rifiutare il pacchetto in ufficio. Rinomina prima uno dei due, oppure sposta '
        + 'solo i presidi.';
    }
    nomi.set(n, riga.denominazione);
    return null;
  };

  const operazioni = [];
  const fermi = [];
  let presidiPortati = 0;
  for (const x of radici) {
    const chi = nomeNelleFrasi(x.tipo, x.riga);
    if (x.tipo === 'presidio') {
      if (dt !== 'locale') {
        return no(`Non si può mettere ${chi} ${suNelleFrasi(dt, dest)}: un presidio sta `
          + 'sempre in un\'ubicazione. Trascinalo su un\'ubicazione (il terzo livello).');
      }
      if (x.riga.locale_id === dest.id) { fermi.push(x); continue; }
      operazioni.push({ cosa: 'sposta', tipo: 'presidio', id: x.id });
      continue;
    }
    if (x.tipo === 'locale') {
      if (dt === 'locale') {
        return no(`Non si può mettere ${chi} dentro ${nomeNelleFrasi(dt, dest)}: il terzo livello `
          + 'è l\'ultimo, e un\'ubicazione dentro un\'ubicazione sarebbe al quarto.');
      }
      if (dt === 'edificio') {
        if (x.riga.edificio_id === dest.id) { fermi.push(x); continue; }
        const doppio = arriva('locale', dest.id, x.riga, dentroNelleFrasi(dt, dest));
        if (doppio) return no(doppio);
        presidiPortati += tuttiIn('locale_id', x.id).filter((a) => !a.eliminato_il).length;
        operazioni.push({ cosa: 'sposta', tipo: 'locale', id: x.id });
        continue;
      }
      // Su un impianto: l'ubicazione DIVENTA un'area.
      const n = attiviIn('locale_id', x.id).length;
      if (n) {
        return no(`${chi[0].toUpperCase()}${chi.slice(1)} contiene ${n === 1 ? 'un presidio'
          : `${n} presidi`}: diventando un'area ${n === 1 ? 'resterebbe' : 'resterebbero'} senza `
          + 'ubicazione, e l\'ubicazione è obbligatoria. Sposta prima i presidi in un\'altra '
          + 'ubicazione, oppure trascinala su un\'area.');
      }
      const doppio = arriva('edificio', dest.id, x.riga, dentroNelleFrasi(dt, dest));
      if (doppio) return no(doppio);
      operazioni.push({ cosa: 'converti', tipo: 'locale', id: x.id, in: 'edificio' });
      continue;
    }
    // x.tipo === 'edificio'
    if (dt === 'locale') {
      return no(`Non si può mettere ${chi} dentro ${nomeNelleFrasi(dt, dest)}: finirebbe al quarto `
        + 'livello, che non esiste.');
    }
    if (dt === 'impianto') {
      if (x.riga.impianto_id === dest.id) { fermi.push(x); continue; }
      const doppio = arriva('edificio', dest.id, x.riga, dentroNelleFrasi(dt, dest));
      if (doppio) return no(doppio);
      presidiPortati += tuttiIn('edificio_id', x.id).filter((a) => !a.eliminato_il).length;
      operazioni.push({ cosa: 'sposta', tipo: 'edificio', id: x.id });
      continue;
    }
    // Su un'area: l'area DIVENTA un'ubicazione.
    if (x.id === dest.id) return no(`Non si può mettere ${chi} dentro sé stessa.`);
    const figli = [...idx.locali.values()].filter((l) => l.edificio_id === x.id).length;
    if (figli) {
      return no(`${chi[0].toUpperCase()}${chi.slice(1)} contiene ${figli === 1 ? "un'ubicazione"
        : `${figli} ubicazioni`}: diventando un'ubicazione ${figli === 1 ? 'la porterebbe' : 'le porterebbe'} `
        + 'al quarto livello, che non esiste. Sposta prima le sue ubicazioni, oppure trascinala '
        + 'su un impianto.');
    }
    const doppio = arriva('locale', dest.id, x.riga, dentroNelleFrasi(dt, dest));
    if (doppio) return no(doppio);
    presidiPortati += attiviIn('edificio_id', x.id).length;
    operazioni.push({ cosa: 'converti', tipo: 'edificio', id: x.id, in: 'locale' });
  }

  if (!operazioni.length) {
    return no(fermi.length === 1 ? `${nomeNelleFrasi(fermi[0].tipo, fermi[0].riga)} è già lì.`
      : 'Sono già tutti lì.');
  }
  const conta = (t) => operazioni.filter((o) => o.tipo === t).length;
  return {
    ok: true,
    motivo: '',
    operazioni,
    destinazione: { tipo: dt, id: dest.id, impianto_id: impDest.id,
      edificio_id: ediDest ? ediDest.id : '', locale_id: locDest ? locDest.id : '' },
    riassunto: {
      aree: conta('edificio'),
      ubicazioni: conta('locale'),
      presidi: conta('presidio'),
      // Quelli che vengono DENTRO un luogo spostato: si dicono a parte, perché
      // sono il motivo per cui un gesto piccolo può muovere tanto.
      presidi_portati: presidiPortati,
      conversioni: operazioni.filter((o) => o.cosa === 'converti')
        .map((o) => ({ da: o.tipo, a: o.in, nome: rigaDelNodo(o.tipo, o.id).denominazione })),
      gia_li: fermi.length,
      con_il_padre: conIlPadre.length,
      dove: nomeNelleFrasi(dt, dest),
      dentro: dentroNelleFrasi(dt, dest),
    },
  };
}

/**
 * Sposta davvero. Rifiuta con il motivo di `pianoSpostamento` se non si può.
 *
 * Ogni riga toccata lascia un evento di giornale con il `prima` e il `dopo` dei
 * campi cambiati, e tutti portano lo stesso `spostamento`: è così che
 * `annullaEventi` li disfa insieme, e che in ufficio si legge «queste venti
 * righe si sono mosse con un gesto solo».
 *
 * @returns il piano eseguito, con `spostamento` (l'id del gesto)
 */
export function spostaNelAlbero(elementi, destinazione) {
  const piano = pianoSpostamento(elementi, destinazione);
  if (!piano.ok) throw new Error(piano.motivo);
  const sid = uuid();
  const d = piano.destinazione;
  const nomeImp = (id) => (idx.impianti.get(id) || {}).denominazione || '';
  const nomeEdi = (id) => (idx.edifici.get(id) || {}).denominazione || '';
  const nomeLoc = (id) => (idx.locali.get(id) || {}).denominazione || '';

  // Cambia i campi di una riga e scrive l'evento, SOLO se qualcosa cambia.
  const cambia = (entitaEv, riga, nuovi, extra = {}) => {
    const prima = {}; const dopo = {};
    for (const [k, v] of Object.entries(nuovi)) {
      const ora = riga[k] === undefined || riga[k] === null ? '' : String(riga[k]);
      if (ora !== String(v)) { prima[k] = ora; dopo[k] = String(v); }
    }
    if (!Object.keys(dopo).length) return;
    applica(entitaEv, riga.id, 'UPDATE', { spostamento: sid, prima, dopo, ...extra }, () => {
      Object.assign(riga, dopo);
    });
  };
  // Il presidio prende TUTTI i livelli del suo nuovo posto, nomi di comodo compresi.
  const riagganciaPresidio = (a, impId, ediId, locId) => cambia('asset', a, {
    impianto_id: impId, edificio_id: ediId, locale_id: locId,
    impianto: nomeImp(impId), edificio: ediId ? nomeEdi(ediId) : '',
    locale: locId ? nomeLoc(locId) : '',
  });
  const assets = () => stato.perEntita[E.ASSET] || [];

  for (const op of piano.operazioni) {
    const riga = rigaDelNodo(op.tipo, op.id);
    if (op.cosa === 'sposta' && op.tipo === 'presidio') {
      riagganciaPresidio(riga, d.impianto_id, d.edificio_id, d.locale_id);
    } else if (op.cosa === 'sposta' && op.tipo === 'locale') {
      cambia('locale', riga, { edificio_id: d.edificio_id, edificio: nomeEdi(d.edificio_id),
        impianto: nomeImp(d.impianto_id) });
      costruisciIndici();
      for (const a of assets().filter((x) => x.locale_id === riga.id)) {
        riagganciaPresidio(a, d.impianto_id, d.edificio_id, riga.id);
      }
    } else if (op.cosa === 'sposta' && op.tipo === 'edificio') {
      cambia('edificio', riga, { impianto_id: d.impianto_id, impianto: nomeImp(d.impianto_id) });
      costruisciIndici();
      for (const l of (stato.perEntita[E.LOCALE] || []).filter((x) => x.edificio_id === riga.id)) {
        cambia('locale', l, { impianto: nomeImp(d.impianto_id) });
      }
      for (const a of assets().filter((x) => x.edificio_id === riga.id)) {
        riagganciaPresidio(a, d.impianto_id, riga.id, a.locale_id || '');
      }
    } else if (op.cosa === 'converti') {
      convertiLuogo(op, riga, d, sid, riagganciaPresidio);
    }
  }
  costruisciIndici();
  return { ...piano, spostamento: sid };
}

/**
 * Un luogo che cambia LIVELLO: un'ubicazione che diventa area, o un'area che
 * diventa ubicazione.
 *
 * Aree e ubicazioni stanno in due tabelle diverse (`2-edifici`, `3-locali`),
 * quindi cambiare livello vuol dire: nasce una riga nuova nell'altra tabella,
 * con lo stesso nome, le note e la posizione; i presidi si riagganciano a lei;
 * la riga vecchia si cancella. In quest'ordine, così in nessun momento un
 * presidio punta a una riga che non c'è.
 *
 * ⚠️ Un id NUOVO e non lo stesso: le due tabelle hanno chiavi indipendenti, ma
 * un presidio porta sia `edificio_id` sia `locale_id`, e lo stesso id in tutti e
 * due i posti si leggerebbe come un'area dentro sé stessa.
 */
function convertiLuogo(op, riga, d, sid, riagganciaPresidio) {
  const nuovoId = uuid();
  const posizione = {};
  for (const k of ['lat', 'lon', 'gps_accuratezza_m', 'gps_rilevato_il']) {
    if (riga[k] !== undefined && riga[k] !== '') posizione[k] = riga[k];
  }
  const nomeImp = (idx.impianti.get(d.impianto_id) || {}).denominazione || '';
  const assets = stato.perEntita[E.ASSET] || [];
  if (op.in === 'edificio') {
    // L'ubicazione DIVENTA area. Il piano la porta nelle note: una colonna
    // `piano` le aree non ce l'hanno, e perderlo in silenzio sarebbe un dato in
    // meno senza che nessuno l'abbia deciso.
    const note = [riga.note, riga.piano ? `piano ${riga.piano}` : ''].filter(Boolean).join(' · ');
    const nuova = { id: nuovoId, impianto_id: d.impianto_id, impianto: nomeImp,
      denominazione: riga.denominazione, note, ...posizione };
    applica('edificio', nuovoId, 'CREATE', {
      spostamento: sid, conversione_di: { tipo: 'locale', id: riga.id }, riga: nuova,
    }, () => { (stato.perEntita[E.EDIFICIO] = stato.perEntita[E.EDIFICIO] || []).push(nuova); });
    costruisciIndici();
    // Solo presidi ELIMINATI possono puntare qui (quelli attivi il piano li ha
    // esclusi): viaggiano comunque nel pacchetto, e non devono restare orfani.
    for (const a of assets.filter((x) => x.locale_id === riga.id)) {
      riagganciaPresidio(a, d.impianto_id, nuovoId, '');
    }
    const righe = stato.perEntita[E.LOCALE] || [];
    applica('locale', riga.id, 'DELETE', {
      spostamento: sid, convertito_in: { tipo: 'edificio', id: nuovoId }, riga: { ...riga },
    }, () => { righe.splice(righe.indexOf(riga), 1); });
  } else {
    // L'area DIVENTA ubicazione, dentro l'area di destinazione.
    const nuova = { id: nuovoId, edificio_id: d.edificio_id,
      edificio: (idx.edifici.get(d.edificio_id) || {}).denominazione || '', impianto: nomeImp,
      denominazione: riga.denominazione, piano: '', note: riga.note || '', ...posizione };
    applica('locale', nuovoId, 'CREATE', {
      spostamento: sid, conversione_di: { tipo: 'edificio', id: riga.id }, riga: nuova,
    }, () => { (stato.perEntita[E.LOCALE] = stato.perEntita[E.LOCALE] || []).push(nuova); });
    costruisciIndici();
    for (const a of assets.filter((x) => x.edificio_id === riga.id)) {
      riagganciaPresidio(a, d.impianto_id, d.edificio_id, nuovoId);
    }
    const righe = stato.perEntita[E.EDIFICIO] || [];
    applica('edificio', riga.id, 'DELETE', {
      spostamento: sid, convertito_in: { tipo: 'locale', id: nuovoId }, riga: { ...riga },
    }, () => { righe.splice(righe.indexOf(riga), 1); });
  }
  costruisciIndici();
}

/**
 * Disfa uno spostamento, evento per evento, dall'ultimo al primo.
 *
 * Chiamata da `annullaEventi` (il tocco su «clicca per annullare»). Ogni evento
 * sa com'era prima: un UPDATE rimette i campi `prima`, un CREATE toglie la riga
 * nata dalla conversione, un DELETE rimette la riga convertita. L'annullamento è
 * a sua volta scritto nel giornale, come ogni modifica.
 */
function annullaSpostamento(eventi) {
  const sid = uuid();
  const tabella = { edificio: E.EDIFICIO, locale: E.LOCALE, asset: E.ASSET };
  for (const ev of [...eventi].reverse()) {
    const payload = JSON.parse(ev.payload || '{}');
    const righe = stato.perEntita[tabella[ev.entita]] = stato.perEntita[tabella[ev.entita]] || [];
    const annota = { spostamento: sid, annulla_spostamento: payload.spostamento,
      annulla_evento: ev.evento_id };
    if (ev.operazione === 'UPDATE') {
      const riga = righe.find((r) => r.id === ev.entita_id);
      if (!riga) throw new Error('Una delle righe spostate non esiste più: non si annulla più da qui.');
      applica(ev.entita, riga.id, 'UPDATE', { ...annota, prima: payload.dopo, dopo: payload.prima },
        () => { Object.assign(riga, payload.prima); });
    } else if (ev.operazione === 'CREATE') {
      const i = righe.findIndex((r) => r.id === ev.entita_id);
      if (i < 0) throw new Error('Il luogo creato dallo spostamento non esiste più: non si annulla più da qui.');
      applica(ev.entita, ev.entita_id, 'DELETE', { ...annota, riga: { ...righe[i] } },
        () => { righe.splice(i, 1); });
    } else if (ev.operazione === 'DELETE') {
      const riga = { ...payload.riga };
      applica(ev.entita, riga.id, 'CREATE', { ...annota, riga }, () => { righe.push(riga); });
    }
    costruisciIndici();
  }
}

/**
 * I presidi che stanno DIRETTAMENTE in un luogo, per mostrarli nell'albero
 * quando si sposta: sotto un'ubicazione i suoi, sotto un'area quelli senza
 * ubicazione, sotto un impianto quelli senza area.
 */
export function presidiDelLuogo(tipo, id) {
  return (stato.perEntita[E.ASSET] || []).filter((a) => !a.eliminato_il && (
    (tipo === 'locale' && a.locale_id === id)
    || (tipo === 'edificio' && a.edificio_id === id && !a.locale_id)
    || (tipo === 'impianto' && a.impianto_id === id && !a.edificio_id)));
}

/**
 * Lo stato con cui nasce un presidio creato in campo, preso DAL CATALOGO che il
 * pacchetto porta con sé.
 *
 * Non una costante, e la ragione è stata misurata in tutte e due le direzioni il
 * 27/08/2026. Il validatore rifiuta un presidio il cui stato non sia a catalogo,
 * e rifiuta con lui l'INTERO pacchetto: un solo presidio creato sul posto fa
 * perdere il giro completo. Il ripiego era `'DA_VERIFICARE'`, rimasto da quando
 * gli stati diagnostici erano stati del presidio — fuori catalogo per i
 * pacchetti di oggi. Sostituirlo con `'IN_SERVIZIO'` lo mette fuori catalogo per
 * i pacchetti di ieri, che quel codice non lo conoscono: un operatore partito
 * prima della modifica avrebbe avuto lo stesso rifiuto, all'altro estremo.
 *
 * L'unica risposta che regge entrambi i versi è chiedere al catalogo caricato.
 */
function statoIniziale() {
  const codici = [...idx.stati.keys()];
  if (!codici.length) return '';
  if (idx.stati.has('IN_SERVIZIO')) return 'IN_SERVIZIO';
  const operativo = codici.find((c) => Number((idx.stati.get(c) || {}).operativo) === 1);
  return operativo || codici[0];
}

/**
 * Il primo progressivo Terna libero (richiesta dell'operatore del 16/09/2026).
 *
 * Gli identificativi del registro sono `#<numero>`; quelli composti dal
 * generatore (`XXXX-US-01`) non sono numeri e non entrano nel conto. Si propone
 * il massimo più uno, e resta una PROPOSTA: la targhetta comanda, e un presidio
 * può non averlo affatto.
 */
export const PREFISSO_PROGRESSIVO = 'UISUV-';

export function prossimoProgressivo() {
  let massimo = 0;
  for (const a of stato.perEntita[E.ASSET] || []) {
    const n = numeroProgressivo(a.identificativo);
    if (n !== null) massimo = Math.max(massimo, n);
  }
  return massimo + 1;
}

/**
 * Il NUMERO dentro un progressivo, o null se non ce n'è.
 *
 * Accetta le tre forme che circolano: `UISUV-376` (quella di adesso), `#376`
 * (come lo scriveva il registro del manutentore) e `376` nudo, che è come lo
 * detta chi lo legge a voce. Sono lo stesso numero, e trattarle come stringhe
 * diverse farebbe entrare un doppione appena qualcuno scrive il prefisso in un
 * modo invece che nell'altro.
 */
export function numeroProgressivo(valore) {
  const t = String(valore == null ? '' : valore).trim();
  const m = /^(?:UISUV-|#)?(\d+)$/i.exec(t);
  return m ? Number(m[1]) : null;
}

/**
 * Il progressivo scritto in due modi è lo STESSO progressivo.
 *
 * `UISUV-375`, `#375`, `375` e ` 375 ` vengono dallo stesso cartellino. Confrontare le
 * stringhe così come sono lascerebbe entrare un doppione appena qualcuno omette
 * il cancelletto — e un doppione sul progressivo è il difetto più difficile da
 * accorgersi, perché l'applicazione continua a funzionare: è il manutentore, in
 * campo, a trovarsi due pezzi con lo stesso numero.
 */
export function chiaveProgressivo(valore) {
  const n = numeroProgressivo(valore);
  if (n !== null) return String(n);
  const t = String(valore == null ? '' : valore).trim();
  return t ? t.toUpperCase() : '';
}

/**
 * Il presidio che porta già questo progressivo, o null.
 *
 * Richiesta dell'operatore del 17/09/2026: il progressivo Terna non deve
 * accettare doppioni. Restituisce il PRESIDIO e non `true`, perché il messaggio
 * utile non è «già usato» ma «già usato da questo, in questo posto»: senza il
 * nome, chi lo legge non sa se sta guardando il proprio pezzo o un altro.
 */
export function presidioConProgressivo(valore, escludiId = null) {
  const chiave = chiaveProgressivo(valore);
  if (!chiave) return null;
  for (const a of stato.perEntita[E.ASSET] || []) {
    if (a.eliminato_il || a.id === escludiId) continue;
    if (chiaveProgressivo(a.identificativo) === chiave) return a;
  }
  return null;
}

export function creaPresidio(dati) {
  if (!idx.categorie.has(dati.categoria_codice)) throw new Error('Categoria non a catalogo.');
  if (!idx.impianti.has(dati.impianto_id)) throw new Error('Impianto inesistente.');
  const cat = idx.categorie.get(dati.categoria_codice);
  const imp = idx.impianti.get(dati.impianto_id);

  const id = uuid();
  const slug = (s, n) => (s || 'NA').toString().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, n) || 'NA';
  const base = `${slug(imp.denominazione, 10)}-NEW-${cat.codice}`;
  const esistenti = (stato.perEntita[E.ASSET] || []).filter((x) => (x.codice || '').startsWith(base)).length;
  const codice = dati.codice || `${base}-${String(esistenti + 1).padStart(2, '0')}-${id.slice(0, 4).toUpperCase()}`;

  // Il progressivo non si ripete. Il controllo sta QUI e non solo nel modulo:
  // la schermata può essere aggirata (un pacchetto, una versione vecchia), e un
  // doppione scritto è molto più caro da togliere che da rifiutare.
  const gemello = presidioConProgressivo(dati.identificativo);
  if (gemello) {
    throw new Error(`Il progressivo ${String(dati.identificativo).trim()} è già di `
      + `${gemello.identificativo || gemello.codice}${gemello.codice ? ` (${gemello.codice})` : ''}. `
      + 'Due presidi con lo stesso numero non si distinguono più in campo.');
  }

  if ((stato.perEntita[E.ASSET] || []).some((x) => x.codice === codice)) {
    throw new Error(`Codice ${codice} già presente.`);
  }

  const a = {
    id,
    codice,
    categoria_codice: cat.codice,
    impianto_id: dati.impianto_id,
    edificio_id: dati.edificio_id || '',
    locale_id: dati.locale_id || '',
    quantita: String(dati.quantita ?? 1),
    quantita_ko: String(dati.quantita_ko ?? 0),
    stato_codice: dati.stato_codice || statoIniziale(),
    origine_dato: 'Creato in campo',
    creato_il: adessoIso(),
    creato_da: stato.sessione.operatore || '',
    modificato_il: adessoIso(),
    device_origine: stato.sessione.device_id,
  };
  // Ogni altro campo dichiarato nei metadati viene accettato così com'è.
  const perNome = new Map((stato.campi || []).map((c) => [c.nome, c]));
  for (const [k, v] of Object.entries(dati)) {
    if (a[k] !== undefined || !perNome.has(k)) continue;
    if (v !== '' && v !== null && v !== undefined) a[k] = String(v);
  }
  for (const k of Object.keys(a)) if (a[k] === '') delete a[k];

  applica('asset', id, 'INSERT', { codice, categoria: cat.codice }, () => {
    stato.perEntita[E.ASSET].push(a);
    idx.assets.set(id, a);
    idx.ricerca.set(id, testoRicerca(a));
  });
  return a;
}

/**
 * Il pezzo è stato TOLTO e non sostituito: la postazione resta scoperta.
 *
 * ⛔ Non è una cancellazione, ed è la correzione del 20/09/2026 (l'operatore:
 * «segnala presidio rimosso credo che dovrebbe aprire un'anomalia come le
 * altre»). Misurato prima di cambiare: un presidio marcato `eliminato_il`
 * spariva da OGNI vista dell'ufficio — elenco presidi, estrazioni Excel,
 * cruscotto, pacchetto verso il campo — e l'unica traccia restava l'evento nel
 * registro delle modifiche. Il motivo, che è obbligatorio scrivere, finiva in
 * un posto che nessuno guarda.
 *
 * Due scritture, e servono tutte e due:
 *
 * * **stato DISMESSO** — è lo stato costruito apposta («rimosso e non
 *   sostituito: la postazione resta vuota») e l'unico che può dire «questa riga
 *   non genera più lavoro»: `sospende_scadenze`. Senza, l'operatore si
 *   ritroverebbe da controllare un pezzo che non c'è, a ogni giro, per sempre —
 *   lo stesso difetto che `ESITI_NON_ESEGUIBILI` è stato inventato per evitare;
 * * **un'anomalia** con il motivo — è quella che lo rende VISIBILE in ufficio e
 *   nelle estrazioni, dove l'anomalia c'è e il presidio cancellato no.
 *
 * ⚠️ Un'anomalia DA SOLA non basterebbe, ed è il motivo per cui non si fa così:
 * il presidio resterebbe «in servizio» e continuerebbe a generare scadenze.
 *
 * Il caso «non è mai esistito» resta `eliminaPresidio`: lì la riga non doveva
 * esserci, e toglierla è la cosa giusta.
 */
export function dismettiPresidio(assetId, motivo) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error('Presidio non trovato');
  const testo = String(motivo == null ? '' : motivo).trim();
  if (!testo) {
    throw new Error("Scrivi perché non c'è più: senza motivo, in ufficio una "
      + 'postazione vuota è indistinguibile da un errore di censimento.');
  }
  // ⚠️ Il catalogo arriva dal pacchetto: uno vecchio non conosce DISMESSO, e
  // scriverlo lo farebbe rifiutare al rientro riga per riga. Meglio dirlo qui.
  if (!idx.stati.has('DISMESSO')) {
    throw new Error("Questo pacchetto non conosce lo stato «dismesso»: "
      + "riesporta l'archivio da Scudo e riprova.");
  }
  aggiornaAsset(assetId, { stato_codice: 'DISMESSO' });
  return apriAnomalia(assetId, {
    // Una postazione che doveva essere protetta e non lo è più: è il fatto più
    // grave che questa app sappia registrare. Se poi il pezzo non serviva,
    // l'ufficio lo dichiara NON_PREVISTO e chiude l'anomalia — ma è una
    // decisione, e si prende guardando, non si dà per scontata qui.
    gravita: 'ALTA',
    tipo_codice: idx.tipiAnomalia && idx.tipiAnomalia.has('ASSENTE') ? 'ASSENTE' : '',
    descrizione: `Rimosso e non sostituito: ${testo}`,
    origine: 'Campo',
  });
}

export function eliminaPresidio(assetId, motivo) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error('Presidio non trovato');
  return applica('asset', assetId, 'DELETE', { motivo }, () => {
    a.eliminato_il = adessoIso();
    a.note = `${a.note || ''} [Rimosso in campo: ${motivo || 'nessun motivo indicato'}]`.trim();
  });
}

/**
 * Apre un punto aperto durante il giro.
 *
 * Mancava, ed era il buco più grosso: si potevano chiudere i ventuno ereditati
 * dal censimento, non aprirne di nuovi. Ma il momento in cui un punto aperto
 * NASCE è quasi sempre il giro — «questa sala non ha luci di emergenza», «qui
 * dovrebbero esserci quattro estintori e non ci sono» — cioè proprio le cose
 * che un'anomalia non può esprimere, perché non hanno un presidio a cui
 * agganciarsi.
 *
 * Senza questa via, l'operatore che trova una mancanza la scrive nella nota
 * dell'anomalia più vicina — falsandola, perché quel presidio non è guasto —
 * oppure non la scrive affatto.
 */
export function creaVerifica(dati) {
  const testo = (dati.punto_aperto || '').trim();
  if (!testo) throw new Error('Scrivi che cosa hai riscontrato.');
  if (dati.impianto_id && !idx.impianti.has(dati.impianto_id)) {
    throw new Error('Impianto inesistente.');
  }
  const id = uuid();
  const v = {
    id,
    // Facoltativo: due dei ventuno punti esistenti non riguardano nessun
    // impianto ma l'archivio (numerazione, matricole duplicate).
    impianto_id: dati.impianto_id || '',
    ambito: (dati.ambito || '').trim(),
    priorita: dati.priorita || 'MEDIA',
    punto_aperto: testo,
    // La provenienza resta scritta: un punto nato in campo e uno ereditato dal
    // censimento si chiudono con la stessa fatica ma non hanno lo stesso peso,
    // e a distanza di mesi non si distinguono più.
    fonte: 'Rilevato in campo',
    stato: 'APERTO',
    operatore_nome: stato.sessione.operatore || '',
    sessione_id: stato.sessione.sessione_id || '',
  };
  return applica('verifica_campo', id, 'CREATE', v, () => {
    if (!stato.perEntita[E.VERIFICA]) stato.perEntita[E.VERIFICA] = [];
    stato.perEntita[E.VERIFICA].push(v);
    costruisciIndici();
  }) && v;
}

export function aggiornaVerifica(verificaId, campi) {
  const v = (stato.perEntita[E.VERIFICA] || []).find((x) => x.id === verificaId);
  if (!v) throw new Error('Punto aperto non trovato');
  const dopo = { ...campi };
  if (['RISOLTO', 'ANNULLATO'].includes(dopo.stato) && !dopo.data_verifica) {
    dopo.data_verifica = oggiIso();
  }
  const prima = {};
  for (const k of Object.keys(dopo)) prima[k] = v[k] ?? '';
  applica('verifica_campo', verificaId, 'UPDATE', { prima, dopo }, () => {
    for (const [k, val] of Object.entries(dopo)) {
      if (val === '' || val === null || val === undefined) delete v[k]; else v[k] = String(val);
    }
    // ⛔ `operatore_nome` è CHI HA APERTO il punto, e non si sovrascrive: era
    // l'unica traccia di provenienza che questa tabella ha (non esiste un
    // `device_origine` sui punti aperti). Chi lo aggiorna sta nel giornale.
    if (!v.operatore_nome) v.operatore_nome = stato.sessione.operatore || '';
    // `sessione_id` invece si aggiorna: serve al riporto del giro, non a dire
    // chi è stato.
    v.sessione_id = stato.sessione.sessione_id;
  });
  return v;
}

// --------------------------------------------------------------------------- //
// Esportazione
// --------------------------------------------------------------------------- //
/** Dati da consegnare a Scudo: tutto il dataset più il giornale del giro. */
/**
 * Toglie (o modifica) un piano su QUESTO presidio.
 *
 * Serve in campo perché è lì che ci si accorge: la porta è stata murata, il
 * locale non esiste più, quell'estintore è in magazzino. Segnarlo al rientro
 * significa non segnarlo. Il motivo è obbligatorio per la stessa ragione per
 * cui lo è in ufficio: fra sei mesi una deroga senza motivo non si distingue da
 * un errore di battitura, e nessuno se la sente di toglierla.
 */
/**
 * Crea un piano di verifica dal campo.
 *
 * Perché un piano si possa creare qui
 * -----------------------------------
 * Perché è in campo che ci si accorge che manca. Un impianto con una
 * prescrizione particolare, una tipologia che il catalogo non copre, una
 * verifica che il committente chiede in più: aspettare il rientro significa
 * annotarla su un foglio, e un foglio non rientra.
 *
 * L'id: `pv-` più dieci esadecimali, la stessa forma che usa l'ufficio. Non è
 * un dettaglio estetico — il pacchetto SOSTITUISCE le tabelle al rientro, quindi
 * un piano creato in campo e uno creato in ufficio devono poter convivere nello
 * stesso archivio senza collidere. La casualità dell'uuid garantisce che non
 * collidano; la forma comune garantisce che nessuno debba sapere da dove viene.
 *
 * Le AZIONI si creano insieme al piano e non dopo: un piano di verifica senza
 * l'elenco di che cosa verificare è esattamente ciò che esisteva prima dei
 * piani, cioè un nome e una frequenza.
 *
 * Le CONDIZIONI no: si scrivono in ufficio. Una condizione è un pezzo di logica
 * («polvere immessa sul mercato dal 25/07/2024») che decide a quali presidi si
 * applica il piano, e sbagliarla in campo significa spostare in silenzio decine
 * di scadenze. Dal campo il piano si applica ai presidi scelti a mano, che è
 * un'azione visibile e reversibile.
 */
export function creaPiano(dati) {
  const denominazione = (dati.denominazione || '').trim();
  if (!denominazione) throw new Error('Il piano deve avere un nome.');
  if (!dati.tipo_asset_codice || !idx.tipiAsset.has(dati.tipo_asset_codice)) {
    throw new Error('Scegli a quale tipologia di presidio si applica.');
  }
  if (!dati.tipo_controllo_codice || !idx.tipiControllo.has(dati.tipo_controllo_codice)) {
    throw new Error('Scegli di quale controllo si tratta.');
  }
  const valore = Number(dati.frequenza_valore);
  if (!Number.isFinite(valore) || valore <= 0) {
    throw new Error('La periodicità deve essere un numero maggiore di zero.');
  }
  const unita = String(dati.frequenza_unita || 'MESI').toUpperCase();
  if (!['GIORNI', 'SETTIMANE', 'MESI', 'ANNI'].includes(unita)) {
    throw new Error(`Unità «${unita}» non valida.`);
  }
  const azioni = (dati.azioni || []).map((t) => String(t || '').trim()).filter(Boolean);

  // A chi si applica. Il default è SU_RICHIESTA e non TIPOLOGIA, ed è una scelta
  // asimmetrica di proposito: assegnare per sbaglio un piano a tutta una
  // tipologia genera scadenze vere su centinaia di presidi e nessuno se ne
  // accorge finché non arrivano; dimenticarsi di estenderlo si vede subito, sul
  // presidio che si ha davanti. Il form offre la scorciatoia «tutta la
  // tipologia» come scelta esplicita, non come comportamento di partenza.
  const ambito = String(dati.ambito || 'SU_RICHIESTA').toUpperCase();
  if (!['TIPOLOGIA', 'SU_RICHIESTA'].includes(ambito)) {
    throw new Error(`Ambito «${ambito}» non valido.`);
  }

  const id = `pv-${uuid().replace(/-/g, '').slice(0, 10)}`;
  const piano = {
    id,
    codice: (dati.codice || '').trim(),
    denominazione,
    tipo_asset_codice: dati.tipo_asset_codice,
    tipo_controllo_codice: dati.tipo_controllo_codice,
    norma: (dati.norma || '').trim(),
    frequenza_valore: String(valore),
    frequenza_unita: unita,
    base_calcolo: dati.base_calcolo || '',
    condizione_descrizione: '',
    priorita: '',
    ambito,
    attivo: '1',
    // Nasce NON verificata, sempre: la periodicità è quella che ha scritto una
    // persona in campo, non una confrontata con il testo della norma. L'app la
    // segnala con un asterisco, ed è giusto che lo faccia anche qui.
    verificata: '0',
    fonte: `creato in campo da ${stato.sessione.operatore || 'operatore'}`,
    note: (dati.note || '').trim(),
    creato_il: adessoIso(),
    device_origine: stato.sessione.device_id,
  };
  for (const k of Object.keys(piano)) if (piano[k] === '') delete piano[k];

  const righeAzioni = azioni.map((testo, i) => ({
    id: `${id}-a${i + 1}`,
    piano_id: id,
    ordine: String(i + 1),
    testo,
    obbligatoria: '1',
  }));

  applica('piano', id, 'INSERT', {
    denominazione, tipo_asset_codice: piano.tipo_asset_codice,
    tipo_controllo_codice: piano.tipo_controllo_codice,
    frequenza: `${valore} ${unita}`, azioni: righeAzioni.length, ambito,
  }, () => {
    if (!stato.perEntita[E.PIANO]) stato.perEntita[E.PIANO] = [];
    stato.perEntita[E.PIANO].push(piano);
    if (righeAzioni.length) {
      if (!stato.perEntita[E.PIANO_AZIONE]) stato.perEntita[E.PIANO_AZIONE] = [];
      stato.perEntita[E.PIANO_AZIONE].push(...righeAzioni);
    }
    costruisciIndici();
  });
  return piano;
}

/**
 * Modifica un piano esistente, azioni comprese.
 *
 * Le azioni si RIscrivono per intero invece di essere modificate una per una:
 * il verbale di un controllo già eseguito conserva il TESTO delle voci spuntate,
 * non un riferimento, quindi riscrivere l'elenco non riscrive la storia. È la
 * stessa ragione per cui `interventi_azioni` porta il testo.
 *
 * Cambiare la periodicità azzera `verificata`: il numero non è più quello che
 * qualcuno aveva confrontato con la norma, e continuare a dichiararlo verificato
 * sarebbe la bugia peggiore fra quelle possibili qui.
 */
export function modificaPiano(pianoId, patch) {
  const piano = (stato.perEntita[E.PIANO] || []).find((p) => p.id === pianoId);
  if (!piano) throw new Error('Piano non trovato.');

  const prima = {};
  const dopo = {};
  const campiTesto = ['denominazione', 'norma', 'note', 'codice', 'base_calcolo'];
  if (patch.ambito !== undefined) {
    const a = String(patch.ambito).toUpperCase();
    if (!['TIPOLOGIA', 'SU_RICHIESTA'].includes(a)) {
      throw new Error(`Ambito «${a}» non valido.`);
    }
    patch = { ...patch, ambito: a };
    campiTesto.push('ambito');
  }
  for (const k of campiTesto) {
    if (patch[k] === undefined) continue;
    const v = String(patch[k] || '').trim();
    if (String(piano[k] || '') === v) continue;
    prima[k] = piano[k] || '';
    dopo[k] = v;
  }
  if (patch.frequenza_valore !== undefined) {
    const valore = Number(patch.frequenza_valore);
    if (!Number.isFinite(valore) || valore <= 0) {
      throw new Error('La periodicità deve essere un numero maggiore di zero.');
    }
    const unita = String(patch.frequenza_unita || piano.frequenza_unita || 'MESI').toUpperCase();
    if (!['GIORNI', 'SETTIMANE', 'MESI', 'ANNI'].includes(unita)) {
      throw new Error(`Unità «${unita}» non valida.`);
    }
    if (String(piano.frequenza_valore) !== String(valore)
        || String(piano.frequenza_unita || 'MESI') !== unita) {
      prima.frequenza = `${piano.frequenza_valore} ${piano.frequenza_unita || 'MESI'}`;
      dopo.frequenza = `${valore} ${unita}`;
      dopo.frequenza_valore = String(valore);
      dopo.frequenza_unita = unita;
    }
  }
  if (patch.attivo !== undefined && String(Number(patch.attivo)) !== String(Number(piano.attivo ?? 1))) {
    prima.attivo = String(Number(piano.attivo ?? 1));
    dopo.attivo = String(Number(patch.attivo));
  }

  const azioniNuove = patch.azioni === undefined
    ? null
    : (patch.azioni || []).map((t) => String(t || '').trim()).filter(Boolean);
  const azioniVecchie = (idx.azioniPerPiano.get(pianoId) || []).map((a) => a.testo);
  const azioniCambiate = azioniNuove !== null
    && azioniNuove.join('\u0001') !== azioniVecchie.join('\u0001');

  if (!Object.keys(dopo).length && !azioniCambiate) return piano;

  applica('piano', pianoId, 'UPDATE', {
    denominazione: piano.denominazione, prima, dopo,
    azioni_prima: azioniVecchie.length,
    azioni_dopo: azioniNuove === null ? azioniVecchie.length : azioniNuove.length,
  }, () => {
    for (const [k, v] of Object.entries(dopo)) {
      if (k === 'frequenza') continue;
      if (v === '') delete piano[k]; else piano[k] = v;
    }
    // La periodicità cambiata non è più quella confrontata con la norma.
    if (dopo.frequenza) piano.verificata = '0';
    piano.modificato_il = adessoIso();
    piano.device_origine = stato.sessione.device_id;

    if (azioniCambiate) {
      stato.perEntita[E.PIANO_AZIONE] = (stato.perEntita[E.PIANO_AZIONE] || [])
        .filter((a) => a.piano_id !== pianoId);
      stato.perEntita[E.PIANO_AZIONE].push(...azioniNuove.map((testo, i) => ({
        id: `${pianoId}-a${i + 1}`,
        piano_id: pianoId,
        ordine: String(i + 1),
        testo,
        obbligatoria: '1',
      })));
    }
    costruisciIndici();
  });
  return piano;
}

/**
 * Quali piani ha QUESTO presidio, e come stanno.
 *
 * Restituisce una riga per ogni piano della sua tipologia, con l'origine di
 * ciascuno: distinguere «lo ha perché la norma lo prevede» da «lo ha perché
 * qualcuno gliel'ha dato» è il punto — sono due cose che si tolgono in due modi
 * diversi e che invecchiano diversamente.
 */
export function pianiDelPresidio(assetId) {
  const a = idx.assets.get(assetId);
  if (!a) return [];
  const tipo = tipoAssetDi(a);
  const eccezioni = idx.eccezioniPerAsset.get(assetId) || [];
  const perPiano = new Map(eccezioni.map((e) => [e.piano_id, e]));

  return (idx.piani || [])
    .filter((p) => p.tipo_asset_codice === tipo && Number(p.attivo ?? 1) === 1)
    .map((p) => {
      const cond = idx.condizioniPerPiano.get(p.id) || [];
      const daSolo = String(p.ambito || 'TIPOLOGIA').toUpperCase() !== 'SU_RICHIESTA'
        && PV.pianoApplicabile(cond, a, stato.campi) === 'VERO';
      const ecc = perPiano.get(p.id) || null;
      const azione = ecc ? String(ecc.azione || '').toUpperCase() : '';
      const attivo = azione === 'ESCLUDI' ? false : (daSolo || azione === 'INCLUDI');
      return {
        piano: p,
        attivo,
        eccezione: ecc,
        origine: azione === 'ESCLUDI' ? 'TOLTO_A_MANO'
          : azione === 'INCLUDI' ? 'DATO_A_MANO'
            : daSolo ? 'AUTOMATICO' : 'NON_PREVISTO',
        su_richiesta: String(p.ambito || 'TIPOLOGIA').toUpperCase() === 'SU_RICHIESTA',
        azioni: idx.azioniPerPiano.get(p.id) || [],
      };
    })
    .sort((x, y) => String(x.piano.denominazione).localeCompare(String(y.piano.denominazione)));
}

/**
 * Scrive quali piani deve avere questo presidio.
 *
 * Riceve l'elenco COMPLETO dei piani voluti e calcola la differenza rispetto a
 * come stanno adesso. È l'unico modo onesto di far corrispondere una schermata
 * fatta di caselle a un archivio fatto di eccezioni: chiedere all'interfaccia di
 * mandare «le differenze» significa fidarsi che le abbia calcolate bene, e
 * un'interfaccia che sbaglia la differenza toglie un piano che nessuno voleva
 * togliere.
 *
 * Che cosa scrive, caso per caso:
 *
 * | prima | dopo | che cosa succede |
 * |---|---|---|
 * | automatico | tolto | deroga ESCLUDI |
 * | automatico | tenuto | niente |
 * | non previsto | dato | deroga INCLUDI |
 * | dato a mano | tolto | la deroga viene RIMOSSA, non invertita |
 * | tolto a mano | rimesso | la deroga viene RIMOSSA, non invertita |
 *
 * Le ultime due righe sono la ragione per cui questa funzione esiste: togliere
 * un piano che era stato dato a mano NON è la stessa cosa che escluderlo. Se
 * lasciasse una deroga ESCLUDI dove prima c'era una INCLUDI, il presidio
 * porterebbe per sempre la traccia di una decisione che è stata annullata, e
 * domani un cambio di condizioni non potrebbe più raggiungerlo.
 */
export function impostaPianiDiPresidio(assetId, pianiVoluti, motivo = '') {
  const voluti = new Set(pianiVoluti || []);
  const stati = pianiDelPresidio(assetId);
  const cambi = stati.filter((r) => r.attivo !== voluti.has(r.piano.id));
  if (!cambi.length) return { aggiunti: [], tolti: [], ripristinati: [] };

  if (!String(motivo || '').trim()) {
    throw new Error('Scrivi perché questo presidio fa eccezione: senza motivo, in '
      + 'ufficio una deroga è indistinguibile da un errore di battitura.');
  }

  const aggiunti = [];
  const tolti = [];
  const ripristinati = [];
  for (const r of cambi) {
    const vuole = voluti.has(r.piano.id);
    if (r.origine === 'DATO_A_MANO' && !vuole) {
      togliEccezione(assetId, r.piano.id);
      ripristinati.push(r.piano);
    } else if (r.origine === 'TOLTO_A_MANO' && vuole) {
      togliEccezione(assetId, r.piano.id);
      ripristinati.push(r.piano);
    } else if (vuole) {
      creaEccezione(assetId, { piano_id: r.piano.id, azione: 'INCLUDI', motivo });
      aggiunti.push(r.piano);
    } else {
      creaEccezione(assetId, { piano_id: r.piano.id, azione: 'ESCLUDI', motivo });
      tolti.push(r.piano);
    }
  }
  return { aggiunti, tolti, ripristinati };
}

/**
 * Applica un piano di verifica a PIÙ presidi in un colpo solo.
 *
 * Come funziona davvero, sotto
 * ----------------------------
 * Non esiste — e volutamente non esiste — una tabella che dica «questo piano
 * vale per questo presidio». L'appartenenza si CALCOLA ogni volta dalla
 * tipologia del presidio e dalle condizioni del piano; una tabella di
 * assegnazioni sarebbe una copia che diverge appena qualcuno cambia
 * l'estinguente di un estintore.
 *
 * Quello che si può scrivere è una **decisione umana** su una coppia (presidio,
 * piano): è la deroga, e la sua azione `INCLUDI` significa esattamente «questo
 * piano vale anche qui, anche se le condizioni non lo prevedono». Il motore la
 * legge in `pianoScelto` e forza il piano dentro con specificità massima.
 *
 * Che cosa rifiuta, e perché
 * --------------------------
 * **La tipologia diversa.** Un piano appartiene a un tipo di asset: applicare a
 * una porta il collaudo decennale di un estintore genererebbe una scadenza vera
 * su una verifica che non esiste. Il motore, da solo, non lo impedisce — il ramo
 * INCLUDI non guarda la tipologia — quindi il rifiuto sta qui, dove la decisione
 * viene presa e dove si può ancora spiegare.
 *
 * **Il piano disattivato.** Un piano ritirato che rientra da una porta di
 * servizio è peggio di un piano mancante, perché nessuno lo sta più guardando.
 *
 * Non è una registrazione sola: sono N deroghe, una per presidio, ognuna con il
 * suo evento nel giornale. È giusto così — ciascuna si toglie da sola, e in
 * ufficio si vede su quale presidio è stata presa la decisione.
 */
export function applicaPianoAPresidi(assetIds, dati) {
  const piano = (idx.piani || []).find((p) => p.id === dati.piano_id);
  if (!piano) throw new Error('Piano di verifica non trovato.');
  if (Number(piano.attivo ?? 1) === 0) {
    throw new Error(`Il piano «${piano.denominazione}» è disattivato: riattivalo prima di applicarlo.`);
  }
  const motivo = (dati.motivo || '').trim();
  if (!motivo) {
    throw new Error('Scrivi perché questo piano va applicato a questi presidi: '
      + "in ufficio una deroga senza motivo è indistinguibile da un errore.");
  }

  const applicati = [];
  const esclusi = [];
  const gia = [];
  for (const id of assetIds) {
    const a = idx.assets.get(id);
    if (!a) continue;
    if (tipoAssetDi(a) !== piano.tipo_asset_codice) {
      esclusi.push({ asset: a, motivo: 'tipologia diversa' });
      continue;
    }
    // Se il piano già si applica per conto suo, la deroga non serve: scriverla
    // vorrebbe dire lasciare in archivio una decisione umana che non decide
    // niente, e che fra un anno qualcuno leggerà come se avesse un senso.
    const eccezioni = idx.eccezioniPerAsset.get(id) || [];
    const scelto = PV.pianoScelto(idx.piani, idx.condizioniPerPiano, a,
      tipoAssetDi(a), piano.tipo_controllo_codice, stato.campi, eccezioni);
    if (scelto && scelto.id === piano.id
        && !eccezioni.some((e) => e.piano_id === piano.id)) {
      gia.push(a);
      continue;
    }
    applicati.push(creaEccezione(id, {
      piano_id: piano.id,
      azione: 'INCLUDI',
      motivo,
      valida_al: dati.valida_al || '',
    }));
  }
  return { piano, applicati, esclusi, gia };
}

export function creaEccezione(assetId, dati) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error(`Presidio ${assetId} non trovato`);
  const motivo = (dati.motivo || '').trim();
  if (!motivo) throw new Error('Scrivi perché questo presidio fa eccezione.');
  if (!dati.piano_id) throw new Error('Manca il piano su cui vale la deroga.');

  const azione = dati.azione || 'ESCLUDI';
  if (azione === 'SOSTITUISCI_FREQUENZA' && !dati.frequenza_valore) {
    throw new Error('Per cambiare la frequenza serve un numero.');
  }

  const esistente = (idx.eccezioniPerAsset.get(assetId) || [])
    .find((e) => e.piano_id === dati.piano_id);
  const e = esistente || {
    id: uuid(),
    asset_id: assetId,
    asset_codice: a.codice,
    piano_id: dati.piano_id,
    creato_il: adessoIso(),
  };
  e.azione = azione;
  e.frequenza_valore = azione === 'SOSTITUISCI_FREQUENZA' ? String(dati.frequenza_valore) : '';
  e.frequenza_unita = azione === 'SOSTITUISCI_FREQUENZA' ? (dati.frequenza_unita || 'MESI') : '';
  e.motivo = motivo;
  e.autore = stato.sessione.operatore || '';
  e.valida_al = dati.valida_al || '';
  e.sessione_id = stato.sessione.sessione_id;

  applica('eccezione', e.id, esistente ? 'UPDATE' : 'INSERT',
    { asset_id: assetId, piano_id: e.piano_id, azione: e.azione, motivo }, () => {
      if (!stato.perEntita[E.ECCEZIONE]) stato.perEntita[E.ECCEZIONE] = [];
      if (!esistente) {
        stato.perEntita[E.ECCEZIONE].push(e);
        if (!idx.eccezioniPerAsset.has(assetId)) idx.eccezioniPerAsset.set(assetId, []);
        idx.eccezioniPerAsset.get(assetId).push(e);
      }
    });
  return e;
}

export function togliEccezione(assetId, pianoId) {
  const lista = idx.eccezioniPerAsset.get(assetId) || [];
  const e = lista.find((x) => x.piano_id === pianoId);
  if (!e) return null;
  applica('eccezione', e.id, 'DELETE', { asset_id: assetId, piano_id: pianoId }, () => {
    idx.eccezioniPerAsset.set(assetId, lista.filter((x) => x !== e));
    stato.perEntita[E.ECCEZIONE] = (stato.perEntita[E.ECCEZIONE] || [])
      .filter((x) => x.id !== e.id);
  });
  return e;
}

export function datiDaEsportare() {
  const out = {};
  for (const k of Object.values(E)) {
    if (k === E.CHANGE) continue;
    out[k] = stato.perEntita[k] || [];
  }
  // ⛔ Il catalogo esce CORRETTO (24/09/2026, dall'operatore: «non possiamo
  // farlo ora? il seme non lo useremo più, useremo i pacchetti dal campo»).
  // Al rientro l'ufficio SOSTITUISCE tutto il catalogo con quello del pacchetto
  // (`TABELLE_SOSTITUITE` in scudo_campo_service.py): correggerlo nell'archivio
  // dell'ufficio non servirebbe, il primo pacchetto di ritorno lo riscriverebbe.
  // Quindi la correzione viaggia qui: le tre strade alternative di pv-29 escono
  // «solo in certi casi», l'ufficio le riceve così, e il telefono che carica
  // questo pacchetto le trova già giuste.
  // ⚠️ Solo nel FILE: il rilievo in memoria non cambia, e nessuna riga entra nel
  // giornale — altrimenti ogni pacchetto caricato nascerebbe con del «lavoro
  // non esportato», e caricarne un altro sarebbe bloccato. Tutto il resto del
  // catalogo esce identico a come è entrato.
  out[E.PIANO_AZIONE] = out[E.PIANO_AZIONE].map((z) => (VOCI_ALTERNATIVE_DI_CAMPO.has(z.id)
    && String(z.obbligatoria) !== '0' ? { ...z, obbligatoria: '0' } : z));
  // Il progressivo Terna su ogni anomalia (25/09/2026): preso dal presidio al
  // momento dell'esportazione, così lo portano anche le anomalie nate prima. Solo
  // nel FILE, come la correzione del catalogo qui sopra.
  out[E.ANOMALIA] = out[E.ANOMALIA].map((an) => ({
    ...an, asset_identificativo: (idx.assets.get(an.asset_id) || {}).identificativo || '' }));
  out[E.CAMPO] = stato.campi || [];
  out[E.CHANGE] = stato.giornale;
  return out;
}

export function segnaEsportato(checksum) {
  stato.esportato = { seq: stato.giornale.length, il: adessoIso(), checksum };
  notifica();
}
