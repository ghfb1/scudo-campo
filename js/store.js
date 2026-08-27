/**
 * Scudo Campo — persistenza del rilievo.
 *
 * Il requisito è: durante un controllo in campo non si perde niente. Non con
 * la navigazione fra schermate, non chiudendo la scheda, non se il telefono
 * uccide la pagina per liberare memoria, non se la batteria finisce.
 *
 * Come è ottenuto
 * ---------------
 * 1. **Nessuna scrittura ritardata.** Ogni modifica apre *subito* una
 *    transazione IndexedDB e viene attesa. Non c'è debounce: un debounce
 *    lascia una finestra, per quanto breve, in cui la modifica esiste solo in
 *    memoria, ed è esattamente la finestra in cui il sistema operativo uccide
 *    la pagina. Il dataset completo pesa qualche centinaio di KB e riscriverlo
 *    costa pochi millisecondi, molto meno del tempo fra due tocchi.
 *
 * 2. **Doppia scrittura: dataset + giornale.** Nella stessa transazione va
 *    l'istantanea dei dati *e* l'evento append-only che descrive la modifica.
 *    Se l'istantanea si corrompe, il giornale la ricostruisce; il giornale è
 *    anche ciò che l'ufficio riceve per sapere chi ha cambiato cosa.
 *
 * 3. **Copia di sicurezza in localStorage.** Su iOS in navigazione privata
 *    IndexedDB può essere assente o azzerata alla chiusura. Il modulo se ne
 *    accorge al primo avvio e passa interamente a localStorage; in condizioni
 *    normali localStorage tiene comunque gli ultimi eventi come scatola nera.
 *
 * 4. **Flush sugli eventi di uscita.** `pagehide` e `visibilitychange` sono gli
 *    unici eventi affidabili su mobile: `beforeunload` su iOS spesso non parte.
 *    Si usano tutti e tre.
 *
 * 5. **Avviso di lavoro non esportato.** Salvato ≠ consegnato. Finché il
 *    pacchetto non è stato esportato, l'app lo dice a chiare lettere.
 */

const DB_NAME = 'scudo-campo';
const DB_VERSION = 1;
const STORE_KV = 'kv';
const STORE_JOURNAL = 'journal';
const LS_PREFIX = 'scudo.campo.';
const LS_BLACKBOX = `${LS_PREFIX}blackbox`;
const LS_DATASET = `${LS_PREFIX}dataset`;
const LS_MODE = `${LS_PREFIX}mode`;
const BLACKBOX_MAX = 200;

let db = null;
let modalita = 'idb'; // 'idb' | 'localstorage'
let ultimoErrore = null;

// Quanto si aspetta IndexedDB prima di dichiararlo non disponibile.
const TIMEOUT_APERTURA_MS = 4000;

/**
 * Attesa con scadenza.
 *
 * Serve perché `indexedDB.open()` può non emettere NESSUN evento: né success,
 * né error, né blocked. Succede davvero — misurato il 2026-08-24: con un'altra
 * scheda che teneva una connessione aperta e una `deleteDatabase` in coda,
 * l'apertura è rimasta appesa a tempo indefinito. L'avvio dell'app restava
 * fermo su quell'await e l'operatore vedeva una pagina bianca, senza nessun
 * errore da nessuna parte.
 *
 * Nessun passo dell'avvio deve poter attendere senza limite: meglio partire in
 * modalità ridotta e dirlo, che non partire affatto.
 */
function conScadenza(promessa, ms, messaggio) {
  return Promise.race([
    promessa,
    new Promise((_, reject) => setTimeout(() => reject(new Error(messaggio)), ms)),
  ]);
}

// --------------------------------------------------------------------------- //
// apertura
// --------------------------------------------------------------------------- //
function apriIdb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB non disponibile')); return; }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_KV)) d.createObjectStore(STORE_KV);
      if (!d.objectStoreNames.contains(STORE_JOURNAL)) {
        d.createObjectStore(STORE_JOURNAL, { keyPath: 'seq', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('apertura IndexedDB fallita'));
    req.onblocked = () => reject(new Error('IndexedDB bloccato da un\'altra scheda'));
  });
}

export async function inizializza() {
  try {
    db = await conScadenza(
      apriIdb(), TIMEOUT_APERTURA_MS,
      'IndexedDB non risponde (spesso: l\'app è aperta in un\'altra scheda)'
    );
    // Prova di scrittura reale: su alcune configurazioni l'apertura riesce e
    // la scrittura no. Sapere che la modalità è degradata DOPO aver perso un
    // rilievo non serve a niente, quindi si verifica adesso.
    await conScadenza(
      kvSet('__probe', Date.now()), TIMEOUT_APERTURA_MS,
      'IndexedDB non accetta scritture'
    );
    modalita = 'idb';
  } catch (e) {
    ultimoErrore = e;
    db = null;
    modalita = 'localstorage';
  }
  try { localStorage.setItem(LS_MODE, modalita); } catch { /* niente storage: si va avanti in memoria */ }

  // Persistenza duratura: senza, il browser può liberare lo storage sotto
  // pressione di spazio. Non è garantita, ma chiederla è gratis.
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* non supportato */ }

  return { modalita, errore: ultimoErrore ? String(ultimoErrore.message || ultimoErrore) : null };
}

export function statoPersistenza() {
  return { modalita, errore: ultimoErrore ? String(ultimoErrore.message || ultimoErrore) : null };
}

// --------------------------------------------------------------------------- //
// primitive
// --------------------------------------------------------------------------- //
function tx(store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function attendi(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(chiave, valore) {
  if (!db) throw new Error('IndexedDB non aperto');
  const t = db.transaction(STORE_KV, 'readwrite');
  const s = t.objectStore(STORE_KV);
  s.put(valore, chiave);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transazione annullata'));
  });
}

async function kvGet(chiave) {
  if (!db) return undefined;
  return attendi(tx(STORE_KV, 'readonly').get(chiave));
}

// --------------------------------------------------------------------------- //
// API
// --------------------------------------------------------------------------- //
/**
 * Salva istantanea + evento nella STESSA transazione.
 *
 * Il fatto che siano una transazione sola è la ragione per cui non può
 * esistere uno stato in cui il giornale registra una modifica che
 * l'istantanea non ha, o viceversa.
 */
export async function salvaConEvento(dataset, eventi) {
  const lista = eventi ? (Array.isArray(eventi) ? eventi : [eventi]) : [];
  for (const ev of lista) scriviBlackbox(ev);

  if (modalita !== 'idb' || !db) {
    salvaLocalStorage(dataset);
    return { ok: true, modalita };
  }

  try {
    const t = db.transaction([STORE_KV, STORE_JOURNAL], 'readwrite');
    t.objectStore(STORE_KV).put(dataset, 'dataset');
    for (const ev of lista) t.objectStore(STORE_JOURNAL).add(ev);
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transazione annullata'));
    });
    return { ok: true, modalita };
  } catch (e) {
    // Fallita la scrittura principale, il rilievo non deve fermarsi: si
    // degrada a localStorage e si dice all'utente che è successo.
    ultimoErrore = e;
    modalita = 'localstorage';
    salvaLocalStorage(dataset);
    return { ok: true, modalita, degradato: true, errore: String(e.message || e) };
  }
}

export async function salvaDataset(dataset) {
  return salvaConEvento(dataset, []);
}

export async function caricaDataset() {
  if (modalita === 'idb' && db) {
    try {
      const d = await conScadenza(kvGet('dataset'), TIMEOUT_APERTURA_MS,
        'lettura del rilievo salvato non riuscita');
      if (d) return d;
    } catch (e) {
      // Il ripristino non deve poter impedire l'avvio: si prosegue con la
      // copia di emergenza, che nel caso peggiore è vuota.
      ultimoErrore = e;
    }
  }
  return leggiLocalStorage();
}

export async function leggiGiornale() {
  if (modalita === 'idb' && db) {
    try { return await attendi(tx(STORE_JOURNAL, 'readonly').getAll()); } catch { /* sotto */ }
  }
  return leggiBlackbox();
}

export async function svuota() {
  if (modalita === 'idb' && db) {
    const t = db.transaction([STORE_KV, STORE_JOURNAL], 'readwrite');
    t.objectStore(STORE_KV).clear();
    t.objectStore(STORE_JOURNAL).clear();
    await new Promise((resolve) => { t.oncomplete = resolve; t.onerror = resolve; });
  }
  try {
    localStorage.removeItem(LS_DATASET);
    localStorage.removeItem(LS_BLACKBOX);
  } catch { /* niente storage */ }
}

// --------------------------------------------------------------------------- //
// localStorage: modalità degradata + scatola nera
// --------------------------------------------------------------------------- //
function salvaLocalStorage(dataset) {
  try {
    localStorage.setItem(LS_DATASET, JSON.stringify(dataset));
  } catch (e) {
    // Quota esaurita: si conserva almeno la scatola nera, che è piccola e
    // permette di ricostruire il lavoro dell'ultimo giro.
    ultimoErrore = e;
  }
}

function leggiLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_DATASET);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function scriviBlackbox(evento) {
  if (!evento) return;
  try {
    const raw = localStorage.getItem(LS_BLACKBOX);
    const lista = raw ? JSON.parse(raw) : [];
    lista.push(evento);
    while (lista.length > BLACKBOX_MAX) lista.shift();
    localStorage.setItem(LS_BLACKBOX, JSON.stringify(lista));
  } catch { /* quota o storage assente: si prosegue */ }
}

function leggiBlackbox() {
  try {
    const raw = localStorage.getItem(LS_BLACKBOX);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function scatolaNera() {
  return leggiBlackbox();
}

// --------------------------------------------------------------------------- //
// istanza unica
// --------------------------------------------------------------------------- //
/**
 * Rileva se l'app è aperta in più schede sullo stesso dispositivo.
 *
 * Non è un caso teorico: durante il collaudo ho tenuto due schede aperte e
 * ognuna scriveva l'intero dataset dalla propria copia in memoria. Chi salva
 * per ultimo vince, quindi la scheda rimasta indietro cancella il lavoro
 * dell'altra — silenziosamente, perché entrambe mostrano "salvato".
 *
 * Il rimedio è dirlo. Bloccare la seconda scheda sarebbe peggio: se la prima è
 * un residuo dimenticato l'operatore resterebbe fuori dal proprio rilievo, in
 * campo, senza modo di rientrare.
 */
const CANALE = 'scudo-campo-istanze';
export const idIstanza = Math.random().toString(36).slice(2, 10);
let canale = null;
let altreIstanze = new Set();

const INTERVALLO_APPELLO_MS = 15000;
const ATTESA_RISPOSTE_MS = 1200;

export function sorvegliaIstanze(onCambio) {
  if (!globalThis.BroadcastChannel) return () => altreIstanze.size;
  try {
    canale = new BroadcastChannel(CANALE);
  } catch { return () => 0; }

  // Le presenze si ricostruiscono a ogni appello invece di accumularsi.
  // Fidarsi del solo messaggio di uscita non funziona: una scheda che va in
  // crash, o che il sistema chiude per liberare memoria, non lo manda mai, e
  // l'avviso "aperto in un'altra scheda" resterebbe acceso per sempre. Un
  // allarme che non si spegne insegna a ignorarlo, e la volta che è vero
  // nessuno lo guarda.
  let inRaccolta = new Set();

  canale.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (!m.id || m.id === idIstanza) return;
    if (m.tipo === 'ciao') {
      // Risponde al saluto (e solo a quello, altrimenti due istanze si
      // rimbalzano messaggi all'infinito).
      canale.postMessage({ tipo: 'sono-qui', id: idIstanza });
      inRaccolta.add(m.id);
      altreIstanze.add(m.id);
      if (onCambio) onCambio(altreIstanze.size);
    } else if (m.tipo === 'sono-qui') {
      inRaccolta.add(m.id);
    } else if (m.tipo === 'esco') {
      inRaccolta.delete(m.id);
      altreIstanze.delete(m.id);
      if (onCambio) onCambio(altreIstanze.size);
    }
  });

  const appello = () => {
    inRaccolta = new Set();
    try { canale.postMessage({ tipo: 'ciao', id: idIstanza }); } catch { return; }
    setTimeout(() => {
      const prima = altreIstanze.size;
      altreIstanze = inRaccolta;
      if (onCambio && altreIstanze.size !== prima) onCambio(altreIstanze.size);
    }, ATTESA_RISPOSTE_MS);
  };

  appello();
  const timer = setInterval(appello, INTERVALLO_APPELLO_MS);

  addEventListener('pagehide', () => {
    clearInterval(timer);
    try { canale.postMessage({ tipo: 'esco', id: idIstanza }); } catch { /* in uscita */ }
  });
  return () => altreIstanze.size;
}

// --------------------------------------------------------------------------- //
// flush sugli eventi di uscita
// --------------------------------------------------------------------------- //
/**
 * Registra i gestori che salvano quando la pagina sta per sparire.
 *
 * `beforeunload` su iOS Safari spesso non viene emesso: `pagehide` e
 * `visibilitychange` sì. Si usano tutti e tre e si accetta di salvare più
 * volte, perché il costo di un salvataggio in più è nullo e quello di uno in
 * meno è il rilievo della giornata.
 */
export function registraFlush(getDataset, haLavoroNonEsportato) {
  const flush = () => {
    try {
      const d = getDataset();
      if (d) salvaLocalStorage(d);   // sincrono: l'unico che fa in tempo
      if (d && modalita === 'idb' && db) salvaDataset(d).catch(() => {});
    } catch { /* in uscita non si può fare altro */ }
  };

  addEventListener('pagehide', flush);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('beforeunload', (ev) => {
    flush();
    if (haLavoroNonEsportato && haLavoroNonEsportato()) {
      ev.preventDefault();
      ev.returnValue = '';
      return '';
    }
    return undefined;
  });
}
