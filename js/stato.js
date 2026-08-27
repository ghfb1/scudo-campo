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

export function iniziaGiro({ operatore, matricola, operatore_ditta: ditta,
                             tipi_asset: tipi } = {}) {
  if (operatore !== undefined) stato.sessione.operatore = operatore;
  if (matricola !== undefined) stato.sessione.matricola = matricola;
  if (ditta !== undefined) stato.sessione.operatore_ditta = ditta;
  if (tipi !== undefined) stato.sessione.tipi_asset = [...tipi];
  if (!stato.sessione.iniziato_il) stato.sessione.iniziato_il = new Date().toISOString();
  stato.sessione.concluso_il = null;
  notifica();
  return statoGiro();
}

export function concludiGiro(note) {
  if (!stato.sessione.iniziato_il) return statoGiro();
  stato.sessione.concluso_il = new Date().toISOString();
  if (note !== undefined) stato.sessione.note_giro = note;
  notifica();
  return statoGiro();
}

export function riapriGiro() {
  stato.sessione.concluso_il = null;
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

export function carica({ manifest, dati, campi }, info = {}) {
  const sessioneCorrente = { ...stato.sessione };
  stato = vuoto();
  stato.caricato = true;
  stato.manifest = manifest;
  stato.perEntita = dati;
  stato.campi = campi || dati[E.CAMPO] || [];
  // `precedente` è la sessione PRIMA dell'azzeramento: serve a non perdere chi
  // sta lavorando. L'operatore si identifica una volta alla porta; caricare un
  // pacchetto è un'azione sui dati, non un cambio di persona, e sovrascrivere
  // il nome con quello scritto nel manifest (che è chi l'ha ESPORTATO, in
  // ufficio) attribuiva i controlli alla persona sbagliata senza dirlo.
  const precedente = sessioneCorrente;
  stato.sessione = {
    operatore: info.operatore || precedente.operatore || manifest.operatore || '',
    matricola: info.matricola || precedente.matricola || '',
    operatore_ditta: precedente.operatore_ditta || '',
    iniziato_il: precedente.iniziato_il || null,
    concluso_il: precedente.concluso_il || null,
    note_giro: precedente.note_giro || '',
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
  return [...(idx.interventiPerAsset.get(assetId) || [])]
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
}
export function scadenzeDi(assetId) {
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
 * È **calcolata**, non memorizzata, e la ragione è tutta in una delle sue voci:
 * SCADUTO. Nessuno lo registra — succede da solo, quando passa la data — quindi
 * scriverlo in una colonna vorrebbe dire tenerlo aggiornato con un lavoro
 * notturno, e sbagliarlo per tutte le ore che passano fra un giro e l'altro. Un
 * dato che invecchia da solo non si memorizza: si ricalcola quando lo si guarda.
 *
 * Le cinque risposte, in ordine di precedenza:
 *
 *   DISMESSO / SEGREGATO / NON_PREVISTO — il ciclo di vita, che una PERSONA
 *       decide. Vince su tutto: di un presidio che non è in servizio non ha
 *       senso chiedersi se sia idoneo.
 *   NON_IDONEO — ha almeno un'anomalia aperta. Batte SCADUTO perché è un
 *       problema diverso e più grave: un pezzo rotto va riparato, non
 *       ricontrollato. Chi guarda l'elenco deve vedere la cosa da fare.
 *   SCADUTO — nessuna anomalia, ma almeno un piano è scaduto e la verifica non
 *       è stata registrata. È il caso che l'utente ha descritto: un presidio
 *       idoneo che diventa scaduto senza che nessuno abbia toccato niente.
 *   IDONEO — tutto il resto.
 *
 * `origine` dice PERCHÉ, e serve: «non idoneo» e «non idoneo perché la fonte
 * non ha mai dichiarato lo stato» si chiudono in due modi diversi.
 */
export const IDONEITA = ['IDONEO', 'NON_IDONEO', 'SCADUTO',
  'SEGREGATO', 'DISMESSO', 'NON_PREVISTO'];

export function idoneita(a, oggi = new Date()) {
  const st = statoDi(a);
  const codice = (a && a.stato_codice) || '';

  // 1. il ciclo di vita, deciso da una persona
  if (codice === 'DISMESSO') return { stato: 'DISMESSO', origine: 'rimosso dal servizio' };
  if (codice === 'SEGREGATO') return { stato: 'SEGREGATO', origine: 'messo da parte' };
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

  // 3. le scadenze passate
  const sc = statoControlliDi(a.id, oggi);
  if (sc.scaduti) {
    return {
      stato: 'SCADUTO',
      origine: `${sc.scaduti} controll${sc.scaduti === 1 ? 'o scaduto' : 'i scaduti'}`,
      scaduti: sc.scaduti,
    };
  }

  return {
    stato: 'IDONEO',
    origine: sc.totale ? 'controlli in regola' : 'nessuna scadenza calcolata',
    // Un presidio senza scadenzario è idoneo per quanto ne sappiamo, e quel
    // «per quanto ne sappiamo» va detto: non è la stessa cosa di uno controllato.
    incerto: sc.totale === 0,
  };
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
 * giro. Finché il giro non è iniziato, nessun presidio risulta controllato.
 */
export function controllato(assetId) {
  const sess = stato.sessione.sessione_id;
  const da = stato.sessione.iniziato_il;
  return (idx.interventiPerAsset.get(assetId) || []).some((i) => {
    if (sess && i.sessione_id) return i.sessione_id === sess;
    if (!da) return false;
    return Boolean(i.registrato_il) && i.registrato_il >= da;
  });
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

export function alberoUbicazioni() {
  const perImpianto = new Map();
  const perEdificio = new Map();
  const perLocale = new Map();
  for (const a of stato.perEntita[E.ASSET] || []) {
    if (a.eliminato_il) continue;
    perImpianto.set(a.impianto_id, (perImpianto.get(a.impianto_id) || 0) + 1);
    if (a.edificio_id) perEdificio.set(a.edificio_id, (perEdificio.get(a.edificio_id) || 0) + 1);
    if (a.locale_id) perLocale.set(a.locale_id, (perLocale.get(a.locale_id) || 0) + 1);
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
      nome: l.denominazione || '(locale senza nome)',
      dettaglio: l.piano ? `piano ${l.piano}` : '',
      riga: l,
      presidi: perLocale.get(l.id) || 0,
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
        nome: e.denominazione || '(edificio senza nome)',
        dettaglio: '',
        riga: e,
        presidi: perEdificio.get(e.id) || 0,
        // I presidi agganciati all'edificio ma a nessun locale: contarli solo
        // nei figli li farebbe sparire dal totale.
        presidi_diretti: (perEdificio.get(e.id) || 0)
          - figli.reduce((n, l) => n + l.presidi, 0),
        figli,
      };
    })
    .sort(perNome);

  const radici = impianti.map((i) => {
    const figli = nodiEdificio(i.id);
    return {
      tipo: 'impianto',
      id: i.id,
      nome: i.denominazione || '(impianto senza nome)',
      dettaglio: [i.tipologia, i.comune].filter(Boolean).join(' · '),
      riga: i,
      presidi: perImpianto.get(i.id) || 0,
      presidi_diretti: (perImpianto.get(i.id) || 0)
        - figli.reduce((n, e) => n + e.presidi, 0),
      figli,
    };
  }).sort(perNome);

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

export function albero(filtroCategorie = []) {
  const cat = new Set(Array.isArray(filtroCategorie)
    ? filtroCategorie
    : (filtroCategorie ? [filtroCategorie] : []));
  const perImpianto = new Map();
  for (const a of stato.perEntita[E.ASSET] || []) {
    if (a.eliminato_il) continue;
    if (cat.size && !cat.has(a.categoria_codice)) continue;
    if (!perImpianto.has(a.impianto_id)) perImpianto.set(a.impianto_id, []);
    perImpianto.get(a.impianto_id).push(a);
  }

  const conteggi = (lista) => ({
    totale: lista.length,
    // Un nodo dell'albero è «finito» quando ogni presidio ha ricevuto TUTTI i
    // controlli che gli spettano, non quando ognuno ne ha ricevuto uno.
    controllati: lista.filter((a) => avanzamentoDi(a.id).completo).length,
    controlli_previsti: lista.reduce((n, a) => n + avanzamentoDi(a.id).previsti, 0),
    controlli_fatti: lista.reduce((n, a) => n + avanzamentoDi(a.id).fatti, 0),
    nonConformi: lista.filter((a) => !conforme(a)).length,
    anomalie: lista.reduce((n, a) => n + anomalieDi(a.id).length, 0),
    presidi: lista.reduce((n, a) => n + (Number.parseInt(a.quantita || '0', 10) || 0), 0),
  });

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
        nome: (idx.locali.get(locId) || {}).denominazione || '(locale)',
        piano: (idx.locali.get(locId) || {}).piano || '',
        assets: l,
        ...conteggi(l),
      })).sort((x, y) => x.nome.localeCompare(y.nome));
      if (senzaLocale.length) {
        locali.push({ id: '', nome: '(senza locale)', piano: '', assets: senzaLocale,
          ...conteggi(senzaLocale) });
      }
      edifici.push({
        id: ediId,
        nome: (edi || {}).denominazione || '(edificio)',
        locali,
        assets: lista,
        ...conteggi(lista),
      });
    }
    edifici.sort((x, y) => x.nome.localeCompare(y.nome));
    if (senzaEdificio.length) {
      edifici.push({
        id: '', nome: '(senza edificio)',
        locali: [{ id: '', nome: '(senza locale)', piano: '', assets: senzaEdificio,
          ...conteggi(senzaEdificio) }],
        assets: senzaEdificio, ...conteggi(senzaEdificio),
      });
    }

    out.push({
      id: impId,
      nome: (imp || {}).denominazione || '(impianto)',
      tipologia: (imp || {}).tipologia || '',
      edifici,
      assets,
      ...conteggi(assets),
    });
  }
  return out.sort((x, y) => x.nome.localeCompare(y.nome));
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

// --------------------------------------------------------------------------- //
// Tipi di controllo applicabili e scadenze
// --------------------------------------------------------------------------- //
/**
 * I tipi di controllo che hanno senso per un presidio, con la scadenza aperta
 * se c'è e l'ultima esecuzione nota.
 *
 * Si ricavano dalle regole di periodicità che arrivano nel pacchetto: così
 * l'operatore vede "questo estintore vuole CONTROLLO ogni 6 mesi e REVISIONE
 * ogni 36" senza che l'elenco debba essere ricalcolato in ufficio.
 */
export function controlliApplicabili(a) {
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
    const eseguiti = interventi
      .filter((x) => x.tipo_controllo_codice === tc.codice)
      .sort((x, y) => (y.data || '').localeCompare(x.data || ''));

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
      azioni: piano ? (idx.azioniPerPiano.get(piano.id) || []) : [],
      // 0 = la periodicità non è mai stata confrontata con il testo della
      // norma. Va mostrata: il campo `norma` si legge come una citazione e non
      // lo è, e un operatore che vede «UNI 9994-1 — ogni 60 mesi» non ha modo
      // di sapere che quel 60 non l'ha verificato nessuno.
      verificata: piano ? Number(piano.verificata || 0) === 1 : false,
      fonte: (piano && piano.fonte) || '',
      deroga: (eccezioni.find((e) => e.piano_id === (piano && piano.id))) || null,
      scadenza: sc ? sc.data_scadenza : null,
      // Se la scadenza aperta non c'è più — perché il controllo è appena stato
      // eseguito — la prossima si calcola con la stessa regola dell'ufficio:
      // ultima esecuzione + periodicità. Senza, subito dopo aver fatto il lavoro
      // la scheda non sapeva dire quando si torna, e la risposta arrivava solo
      // al rientro.
      prossima_calcolata: (!sc && piano && eseguiti.length)
        ? CAL.prossimaScadenza(CAL.ultimaEsecuzione(eseguiti),
                               piano.frequenza_valore, piano.frequenza_unita)
        : null,
      semaforo: sc ? semaforo(sc.data_scadenza, oggi) : null,
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
export function campiPerCategoria(categoria) {
  return (stato.campi || []).filter((c) => !c.categorie || c.categorie.includes(categoria));
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
      messaggio: 'Senza messa in servizio, installazione o anno di costruzione questo '
        + 'presidio non entra nello scadenzario: le periodicità si calcolano da lì.',
    });
  }
  if (a.tipo_asset_codice === 'ESTINTORE') {
    if (!a.estinguente) {
      out.push({ campo: 'estinguente',
        messaggio: "Senza estinguente non si può scegliere fra le regole UNI 9994-1: "
          + 'polvere e CO2 hanno periodicità diverse.' });
    }
    if (!a.matricola) {
      out.push({ campo: 'matricola',
        messaggio: "Senza matricola l'estintore non è distinguibile dagli altri con lo "
          + 'stesso #ID, che non è univoco a livello di unità impianti.' });
    }
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Ricerca
// --------------------------------------------------------------------------- //
export function cerca({ testo = '', impiantoId = '', edificioId = '', localeId = '',
  categorie = [], stato: filtroStato = '', soloNonConformi = false,
  soloConAnomalie = false, soloDaControllare = false, soloControllati = false } = {}) {
  const q = normalizza(testo).split(/\s+/).filter(Boolean);
  // Insieme e non stringa: una sola categoria alla volta costringeva a fare tre
  // giri per contare porte, luci e uscite di un locale — che è una domanda sola.
  const cat = new Set(categorie || []);
  const out = [];
  for (const a of stato.perEntita[E.ASSET] || []) {
    if (a.eliminato_il) continue;
    if (impiantoId && a.impianto_id !== impiantoId) continue;
    if (edificioId && a.edificio_id !== edificioId) continue;
    if (localeId && a.locale_id !== localeId) continue;
    if (cat.size && !cat.has(a.categoria_codice)) continue;
    if (filtroStato && a.stato_codice !== filtroStato) continue;
    if (soloNonConformi && conforme(a)) continue;
    if (soloConAnomalie && anomalieDi(a.id).length === 0) continue;
    if (soloDaControllare && controllato(a.id)) continue;
    if (soloControllati && !controllato(a.id)) continue;
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

  const scadenze = (stato.perEntita[E.SCADENZA] || []).filter((s) => (s.stato || 'APERTA') === 'APERTA');
  return {
    righe: assets.length,
    presidi,
    presidi_ko: ko,
    non_conformi: nonConformi,
    anomalie_aperte: anomalie.length,
    anomalie_gravita: perGravita,
    scadute: scadenze.filter((s) => semaforo(s.data_scadenza) === 'SCADUTO').length,
    in_scadenza: scadenze.filter((s) => semaforo(s.data_scadenza) === 'IN_SCADENZA').length,
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
    completati: assets.filter((a) => avanzamentoDi(a.id).completo).length,
    controlli_previsti: assets.reduce((n, a) => n + avanzamentoDi(a.id).previsti, 0),
    controlli_fatti: assets.reduce((n, a) => n + avanzamentoDi(a.id).fatti, 0),
    // Nome storico, tenuto perché lo leggono il riepilogo e le prove: adesso
    // vuol dire «presidi con tutti i controlli previsti fatti».
    controllati: assets.filter((a) => avanzamentoDi(a.id).completo).length,
    interventi: (stato.perEntita[E.INTERVENTO] || []).length,
    modifiche_non_esportate: stato.giornale.length - stato.esportato.seq,
    // Quanto vale il perimetro, per poterlo dire invece di lasciarlo indovinare.
    perimetro_attivo: !tutto && (stato.sessione.tipi_asset || []).length > 0,
    righe_totali: tuttiGliAssets.length,
    tipi_perimetro: [...(stato.sessione.tipi_asset || [])],
  };
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
export function aggiornaAsset(assetId, valori) {
  const a = idx.assets.get(assetId);
  if (!a) throw new Error(`Presidio ${assetId} non trovato`);

  const perNome = new Map((stato.campi || []).map((c) => [c.nome, c]));
  const errori = [];
  for (const [nome, valore] of Object.entries(valori)) {
    const c = perNome.get(nome);
    if (!c) { errori.push(`Campo sconosciuto: ${nome}`); continue; }
    if (!c.modificabile) { errori.push(`${c.etichetta}: non modificabile.`); continue; }
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
  if (dati.esito === 'IDONEO' && Array.isArray(dati.azioni) && dati.azioni.length) {
    const mancanti = dati.azioni.filter((x) => !x.fatta);
    if (mancanti.length) {
      throw new Error(
        `Non si può dichiarare IDONEO: ${mancanti.length} verifiche su `
        + `${dati.azioni.length} non risultano fatte. Spuntale, oppure registra `
        + 'NON CONFORME dicendo che cosa manca.');
    }
  }

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
  if (dati.esito === 'NON_IDONEO' || dati.apri_anomalia) {
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
    });
  }
  return { intervento: iv, anomalia };
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

export function avanzamentoDi(assetId) {
  const nelGiro = interventoNelGiro;

  const fatti = new Set();
  const idFatti = new Set();
  for (const i of idx.interventiPerAsset.get(assetId) || []) {
    if (nelGiro(i)) { fatti.add(i.tipo_controllo_codice); idFatti.add(i.id); }
  }

  // Il denominatore è quello che c'era da fare QUANDO IL GIRO È COMINCIATO, non
  // quello che resta adesso.
  //
  // Registrare un controllo ASSOLVE la sua scadenza, quindi contando le sole
  // scadenze aperte il denominatore si restringe man mano che si lavora: dopo il
  // primo di quattro controlli l'avanzamento diceva «0 su 3». Misurato scrivendo
  // questa funzione la prima volta, e preso da una prova che si aspettava «1 su
  // 4» — il numero che l'operatore si aspetta di vedere.
  const previsti = new Set();
  for (const s of idx.scadenzePerAsset.get(assetId) || []) {
    const stato_ = s.stato || 'APERTA';
    if (stato_ === 'APERTA') previsti.add(s.tipo_controllo_codice);
    else if (stato_ === 'ASSOLTA' && s.intervento_id && idFatti.has(s.intervento_id)) {
      previsti.add(s.tipo_controllo_codice);
    }
  }

  const previstiFatti = [...previsti].filter((t) => fatti.has(t)).length;
  return {
    previsti: previsti.size,
    fatti: previstiFatti,
    // `altri` sono i controlli registrati che non erano in scadenza: non sono un
    // errore — si può eseguire un controllo in anticipo — ma non devono gonfiare
    // l'avanzamento.
    altri: [...fatti].filter((t) => !previsti.has(t)).length,
    completo: previsti.size > 0 && previstiFatti === previsti.size,
  };
}

/**
 * L'avanzamento del giro spaccato per una chiave: piano, impianto, tipologia.
 *
 * È quello che i grafici disegnano. Non ricalcola niente per conto suo: usa gli
 * stessi due insiemi di `avanzamentoDi` — il previsto è la scadenza APERTA
 * all'inizio del giro oppure quella chiusa da un intervento di questo giro, il
 * fatto è il tipo di controllo che in questo giro ha ricevuto un intervento — e
 * lo stesso `interventoNelGiro`.
 *
 * Il vincolo che ne deriva è verificabile, ed è verificato
 * (`scripts/scudo/test_grafici_campo.mjs`): con una chiave che non scarta mai
 * niente, la somma delle colonne del grafico deve fare esattamente
 * `riepilogo().controlli_previsti`. Un grafico che somma a un numero diverso da
 * quello scritto sopra di lui è peggio di nessun grafico: si guarda, si crede, e
 * non c'è modo di accorgersene.
 *
 * @param chiaveFn (scadenza, asset) -> { valore, etichetta, icona } | null
 */
export function avanzamentoPerChiave(chiaveFn, tutto = false) {
  const tuttiGliAssets = (stato.perEntita[E.ASSET] || []).filter((a) => !a.eliminato_il);
  const assets = tutto ? tuttiGliAssets : tuttiGliAssets.filter(nelPerimetro);
  const m = new Map();

  for (const a of assets) {
    const fattiCodici = new Set();
    const idFatti = new Set();
    for (const i of idx.interventiPerAsset.get(a.id) || []) {
      if (interventoNelGiro(i)) { fattiCodici.add(i.tipo_controllo_codice); idFatti.add(i.id); }
    }

    // Una sola volta per tipo di controllo, come nel denominatore di
    // `avanzamentoDi`: due scadenze aperte dello stesso controllo sullo stesso
    // presidio sono un lavoro solo, e contarle due volte gonfierebbe la colonna.
    const viste = new Set();
    for (const s of idx.scadenzePerAsset.get(a.id) || []) {
      const st = s.stato || 'APERTA';
      const previsto = st === 'APERTA'
        || (st === 'ASSOLTA' && s.intervento_id && idFatti.has(s.intervento_id));
      if (!previsto) continue;
      if (viste.has(s.tipo_controllo_codice)) continue;
      viste.add(s.tipo_controllo_codice);

      const k = chiaveFn(s, a);
      if (!k) continue;
      if (!m.has(k.valore)) m.set(k.valore, { ...k, previsti: 0, fatti: 0 });
      const v = m.get(k.valore);
      v.previsti += 1;
      if (fattiCodici.has(s.tipo_controllo_codice)) v.fatti += 1;
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
 * Guarda solo le scadenze già calcolate (`idx.scadenzePerAsset`) e non valuta i
 * piani: l'elenco ne disegna centinaia di righe alla volta, e far girare il
 * selettore dei piani per ciascuna lo renderebbe lento proprio dove si scorre.
 * Il prezzo è che «mai eseguito» e «scadenza non calcolabile» qui si presentano
 * insieme, come «nessuna scadenza calcolata»: la distinzione la fa la scheda.
 */
export function statoControlliDi(assetId, oggi = new Date()) {
  let scaduti = 0;
  let inScadenza = 0;
  let regolari = 0;
  let prossima = null;
  for (const sc of idx.scadenzePerAsset.get(assetId) || []) {
    if ((sc.stato || 'APERTA') !== 'APERTA') continue;
    const sem = semaforo(sc.data_scadenza, oggi);
    if (sem === 'SCADUTO') scaduti += 1;
    else if (sem === 'IN_SCADENZA') inScadenza += 1;
    else regolari += 1;
    if (!prossima || String(sc.data_scadenza) < String(prossima)) prossima = sc.data_scadenza;
  }
  const totale = scaduti + inScadenza + regolari;
  const chiave = scaduti ? 'SCADUTO'
    : inScadenza ? 'IN_SCADENZA'
      : totale ? 'REGOLARE' : 'SENZA';
  return { chiave, scaduti, in_scadenza: inScadenza, regolari, totale, prossima };
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
    .filter((x) => x.tipo_controllo_codice === iv.tipo_controllo_codice);
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
    stato: 'APERTA',
    data_apertura: dati.data_apertura || oggiIso(),
    origine: dati.origine || 'Campo',
    intervento_apertura_id: dati.intervento_apertura_id || '',
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
    an.registrato_il = adessoIso();
    an.device_origine = stato.sessione.device_id;
  });
  return an;
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
  };
  return applica('impianto', id, 'CREATE', imp, () => {
    (stato.perEntita[E.IMPIANTO] = righe).push(imp);
    costruisciIndici();
  }) && imp;
}

export function creaEdificio(dati) {
  const nome = (dati.denominazione || '').trim();
  if (!nome) throw new Error("La denominazione dell'edificio è obbligatoria.");
  if (!idx.impianti.has(dati.impianto_id)) throw new Error('Impianto inesistente.');
  const righe = stato.perEntita[E.EDIFICIO] || [];
  if (_duplicato(righe, 'denominazione', nome, (r) => r.impianto_id === dati.impianto_id)) {
    throw new Error(`Esiste già un edificio "${nome}" in questo impianto.`);
  }
  const id = uuid();
  const e = {
    id, impianto_id: dati.impianto_id, denominazione: nome, note: dati.note || '',
  };
  return applica('edificio', id, 'CREATE', e, () => {
    (stato.perEntita[E.EDIFICIO] = righe).push(e);
    costruisciIndici();
  }) && e;
}

export function creaLocale(dati) {
  const nome = (dati.denominazione || '').trim();
  if (!nome) throw new Error('La denominazione del locale è obbligatoria.');
  if (!idx.edifici.has(dati.edificio_id)) throw new Error('Edificio inesistente.');
  const righe = stato.perEntita[E.LOCALE] || [];
  if (_duplicato(righe, 'denominazione', nome, (r) => r.edificio_id === dati.edificio_id)) {
    throw new Error(`Esiste già un locale "${nome}" in questo edificio.`);
  }
  const id = uuid();
  const l = {
    id, edificio_id: dati.edificio_id, denominazione: nome,
    piano: dati.piano || '', note: dati.note || '',
  };
  return applica('locale', id, 'CREATE', l, () => {
    (stato.perEntita[E.LOCALE] = righe).push(l);
    costruisciIndici();
  }) && l;
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
  return applica(tipo, id, 'UPDATE', campi, () => {
    for (const [k, v] of Object.entries(campi)) riga[k] = v === null ? '' : String(v);
    costruisciIndici();
  });
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
    v.operatore_nome = stato.sessione.operatore || v.operatore_nome;
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
  out[E.CAMPO] = stato.campi || [];
  out[E.CHANGE] = stato.giornale;
  return out;
}

export function segnaEsportato(checksum) {
  stato.esportato = { seq: stato.giornale.length, il: adessoIso(), checksum };
  notifica();
}
