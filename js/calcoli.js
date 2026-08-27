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
export function ultimaEsecuzione(interventi) {
  let max = null;
  for (const iv of interventi || []) {
    const d = String(iv.data || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(d)) continue;
    if (!max || d > max) max = d;
  }
  return max;
}
