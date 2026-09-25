/**
 * Scudo Campo — aritmetica delle scadenze.
 *
 * GEMELLO di `backend/app/services/scudo_calcoli.py`. Le due implementazioni
 * devono dare la stessa data su qualunque ingresso: se divergono, l'app di campo
 * promette all'operatore una scadenza che l'ufficio poi contraddice, e nessuna
 * delle due può accorgersene da sola. Le tiene allineate
 * `scripts/scudo/test_calcoli_cross.py`, che confronta oltre ventimila casi.
 *
 * Perché il calcolo serve anche in campo
 * --------------------------------------
 * Registrare un controllo ASSOLVE la sua scadenza. Fino a ieri, subito dopo, la
 * schermata diceva soltanto «ha assolto la scadenza del 19/02/2027» — e la
 * domanda che si pone chiunque abbia appena fatto un lavoro («e adesso quando
 * torna?») restava senza risposta fino al rientro in ufficio. La risposta si
 * calcola qui, con la stessa regola che l'ufficio applicherà all'import.
 *
 * La regola, in una riga: **prossima = ultima esecuzione + periodicità**.
 * L'ancoraggio anagrafico (messa in servizio, costruzione) serve solo quando un
 * controllo non è MAI stato eseguito; appena esiste un'esecuzione, vince quella.
 * È così anche in `prossima_scadenza`, dove si legge `ultima_esecuzione or
 * riferimento`.
 */

export const GIORNI = 'GIORNI';
export const SETTIMANE = 'SETTIMANE';
export const MESI = 'MESI';
export const ANNI = 'ANNI';

/** ISO → Date (mezzanotte locale). Null se non è una data. */
export function aData(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function aIso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Somma mesi a una data, tagliando il giorno a fine mese.
 *
 * 31 gennaio + 1 mese = 28 febbraio (o 29 negli anni bisestili). Senza il taglio
 * si otterrebbe il 3 marzo, che è la risposta che dà l'aritmetica ingenua di
 * `Date` e che nessuno si aspetta su una scadenza di manutenzione.
 */
export function aggiungiMesi(d, mesi) {
  const y = d.getFullYear() + Math.floor((d.getMonth() + mesi) / 12);
  const m = ((d.getMonth() + mesi) % 12 + 12) % 12;
  const ultimo = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), ultimo));
}

/**
 * Somma un periodo a una data. `null` se il periodo non è valido.
 *
 * ANNI è definito come **dodici mesi**, non come «lo stesso giorno l'anno
 * prossimo»: il 29 febbraio 2024 più un anno deve dare il 28 febbraio 2025, e
 * definendo gli anni come mesi nel sistema resta UNA sola regola di calendario
 * invece di due che possono divergere.
 *
 * SETTIMANE sono sette giorni esatti. Non si normalizza tutto in giorni: un anno
 * non è 365 giorni, e cinquantadue settimane non sono un anno.
 *
 * Una periodicità è positiva per definizione. Un valore negativo produrrebbe una
 * scadenza NEL PASSATO, cioè un presidio che si presenta come scaduto — la forma
 * che meno invita a sospettare della regola. Il guardiano sta qui e non nel
 * chiamante, o basterebbe una nuova unità per riaprire la falla.
 *
 * Un'unità sconosciuta non vale «mesi»: darebbe una data plausibile e sbagliata.
 * Meglio nessuna data, che si vede.
 */
export function aggiungiPeriodo(d, valore, unita = MESI) {
  const n = Number(valore);
  if (!n || n < 0 || !(d instanceof Date)) return null;
  const u = String(unita || MESI).toUpperCase();
  if (u === MESI) return aggiungiMesi(d, n);
  if (u === ANNI) return aggiungiMesi(d, n * 12);
  if (u === SETTIMANE) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n * 7);
  if (u === GIORNI) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return null;
}

/**
 * Prossima scadenza a partire da una data ISO. Ritorna una stringa ISO o null.
 *
 * @param dataIso  l'ultima esecuzione, oppure l'ancoraggio anagrafico se il
 *                 controllo non è mai stato eseguito
 */
export function prossimaScadenza(dataIso, frequenzaValore, frequenzaUnita = MESI) {
  const d = aData(dataIso);
  if (!d) return null;
  return aIso(aggiungiPeriodo(d, frequenzaValore, frequenzaUnita));
}

/**
 * L'ultima esecuzione di un controllo: la data PIÙ ALTA, non l'ultima
 * registrata.
 *
 * È la definizione dell'ufficio (`ultima_esecuzione` in `scudo_calcoli.py`
 * tiene il massimo). Registrare oggi un controllo con data 01/01/2020 — cosa
 * che si fa per recuperare un verbale cartaceo — non deve far arretrare la
 * prossima scadenza rispetto a un'esecuzione più recente già in archivio.
 */
/**
 * Questo controllo parla del pezzo che c'è ADESSO?
 *
 * GEMELLA di `vale_per_il_pezzo` in `backend/app/services/scudo_calcoli.py`.
 *
 * Serve da quando una postazione può cambiare pezzo (18/09/2026). Le scadenze di
 * revisione, collaudo e fine vita si contano dall'ultima esecuzione — ma
 * l'ultima esecuzione DI CHI? Se sulla postazione è stato montato un muletto, il
 * collaudo fatto sul pezzo originale non dice niente sul muletto, e contarlo gli
 * darebbe una scadenza che nessuno gli ha mai verificato.
 *
 * Due risposte vere, e nessuna delle due è «no»: una matricola VUOTA vuol dire
 * «non sappiamo su quale pezzo» — è il caso di tutti gli interventi nati prima di
 * questa colonna, ed escluderli spazzerebbe via la storia del parco — e una
 * matricola UGUALE a quella montata è lo stesso pezzo. Tutto il resto è la storia
 * di un pezzo che qui non c'è più.
 */
export function valePerIlPezzo(matricolaIntervento, matricolaMontata) {
  const a = String(matricolaIntervento == null ? '' : matricolaIntervento).trim();
  if (!a) return true;
  return a === String(matricolaMontata == null ? '' : matricolaMontata).trim();
}

/**
 * Gli esiti che dicono «non si è potuto fare», non «è andata così».
 *
 * Sta QUI, nel modulo più in basso, perché è qui che si decide «da quando si
 * conta»: `stato.js` lo ri-esporta invece di averne una copia.
 */
export const ESITI_NON_ESEGUIBILI = ['NON_ESEGUITO', 'NON_ACCESSIBILE'];

/**
 * Questo controllo fa ripartire l'orologio?
 *
 * ⛔ No, se non è stato eseguito — ed è la correzione del 20/09/2026, chiesta
 * dall'operatore dopo averne previsto l'effetto: «quando re-importeremo il
 * pacchetto su Scudo e poi ricreeremo il pacchetto per Scudo Campo, quei
 * presidi non devono andare in automatico in quelli fatti, deve riproporli in
 * quelli da fare».
 *
 * Misurato prima di correggere, su un archivio temporaneo: una `VERIFICA_USCITE`
 * registrata NON_ACCESSIBILE il 20/09/2026 spostava la scadenza al **20/03/2027**
 * — un semestre intero — e nel pacchetto successivo quel presidio usciva con
 * `richieste: 0`, cioè **spariva dai «da fare»**. Un cancello chiuso trovato una
 * volta nascondeva il presidio fino al giro dopo il prossimo.
 *
 * Le due cose restano distinte, e servono entrambe:
 *
 * * **dentro il giro** la voce è chiusa (`vociDelGiro` la toglie dai mancanti):
 *   ci si è andati, non si poteva fare, e ritrovarsela davanti dieci volte non
 *   la rende possibile;
 * * **per l'orologio** non è successo niente: la scadenza resta dov'era, il
 *   presidio torna nei «da fare» al giro successivo, e il registro non dichiara
 *   eseguita una verifica che nessuno ha eseguito.
 *
 * ⚠️ Un esito SCONOSCIUTO vale (torna `true`), come una matricola vuota in
 * `valePerIlPezzo`: escludere ciò che non si riconosce spazzerebbe via la
 * storia del parco al primo nome nuovo.
 *
 * GEMELLA di `esecuzione_vale` in `backend/app/services/scudo_calcoli.py`.
 */
export function esecuzioneVale(esito) {
  const u = String(esito == null ? '' : esito).trim().toUpperCase();
  return !ESITI_NON_ESEGUIBILI.includes(u);
}

export function ultimaEsecuzione(interventi) {
  let max = null;
  for (const iv of interventi || []) {
    if (!esecuzioneVale(iv && iv.esito)) continue;
    const d = String((iv && iv.data) || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    if (!max || d > max) max = d;
  }
  return max;
}

// --------------------------------------------------------------------------- //
// Da quale DATA si conta un controllo mai eseguito (24/09/2026)
// --------------------------------------------------------------------------- //
//
// ⛔ Perché è arrivato in campo (segnalazione dell'operatore: «quando cerco di
// controllare i rilevatori di idrogeno, o altri tipi che necessitano di una
// data di costruzione, la inserisco ma non me la fa registrare, come se non
// l'avessi inserita»). La data SI SALVAVA: ma in campo la prossima scadenza si
// calcolava solo dall'ultima esecuzione, e un controllo mai eseguito senza una
// scadenza nel pacchetto restava «da calcolare» fino al rientro in ufficio. Il
// fine vita, che non si esegue mai, diceva «senza l'anno di costruzione non si
// calcola» con l'anno di costruzione appena scritto.
//
// Le tre funzioni sotto sono GEMELLE di `parse_date`, `date_del_presidio` e
// `ancora_di_calcolo` in `backend/app/services/scudo_calcoli.py`, e le confronta
// `scripts/scudo/test_calcoli_cross.py`. La regola intera resta quella di
// `prossima_scadenza`: **ultima esecuzione, oppure la data di partenza, +
// periodicità**.

export const BASE_MESSA_SERVIZIO = 'MESSA_SERVIZIO';
export const BASE_COSTRUZIONE = 'COSTRUZIONE';

const FORMATI_DATA = [
  [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => [m[1], m[2], m[3]]],
  [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [m[3], m[2], m[1]]],
  [/^(\d{1,2})-(\d{1,2})-(\d{4})$/, (m) => [m[3], m[2], m[1]]],
  [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (m) => [m[1], m[2], m[3]]],
];

/**
 * Una data scritta in uno dei quattro modi che accetta l'ufficio, in ISO; `null`
 * se non lo è. ⚠️ Una data IMPOSSIBILE (31 febbraio) è `null`, come per
 * `strptime`: `new Date` la farebbe scivolare al 3 marzo senza dire niente.
 */
export function dataDelCalendario(valore) {
  if (valore === null || valore === undefined || valore === '') return null;
  let s = String(valore).trim();
  if (s.includes('T')) s = s.split('T')[0];
  for (const [re, parti] of FORMATI_DATA) {
    const m = re.exec(s);
    if (!m) continue;
    const [a, me, g] = parti(m).map(Number);
    // `setFullYear` e non il costruttore: `new Date(99, …)` vuol dire 1999, e
    // Python legge l'anno 99 come l'anno 99.
    const d = new Date(2000, 0, 1);
    d.setFullYear(a, me - 1, g);
    if (a >= 1 && d.getFullYear() === a && d.getMonth() === me - 1 && d.getDate() === g) {
      return `${String(a).padStart(4, '0')}-${String(me).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Le tre date di un presidio: `{ messaServizio, installazione, costruzione }`,
 * in ISO o `null`. L'anno di costruzione diventa il PRIMO GENNAIO: è
 * l'approssimazione dichiarata dell'ufficio, e sta qui una volta sola.
 */
export function dateDelPresidio(a) {
  const x = a || {};
  const anno = String(x.anno_costruzione == null ? '' : x.anno_costruzione).trim();
  const costruzione = /^\d{1,4}$/.test(anno) && Number(anno) > 0
    ? `${String(Number(anno)).padStart(4, '0')}-01-01` : null;
  return {
    messaServizio: dataDelCalendario(x.data_messa_servizio),
    installazione: dataDelCalendario(x.data_installazione),
    costruzione,
  };
}

/**
 * La data da cui si conta un controllo MAI eseguito, o `null`.
 *
 * ⛔ `COSTRUZIONE` non ripiega su nient'altro, come in ufficio: il fine vita si
 * conta dalla costruzione, e sostituirle la messa in servizio darebbe una data
 * plausibile e sbagliata — anni di ritardo sulla rottamazione.
 */
export function ancoraDiCalcolo(baseCalcolo, messaServizio, installazione, costruzione) {
  if ((baseCalcolo || BASE_MESSA_SERVIZIO) === BASE_COSTRUZIONE) return costruzione || null;
  return messaServizio || installazione || costruzione || null;
}
