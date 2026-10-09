/**
 * Scudo Campo — i conti del climatizzatore (09/10/2026).
 *
 * Due conti, tutti e due dai dati di targa che l'operatore ha davanti:
 *
 * * **t CO₂ equivalenti** = carica (kg) × GWP del gas ÷ 1000. È il numero su cui
 *   il Reg. (UE) 2024/573 fissa il controllo delle perdite (da 5 t ogni 12 mesi,
 *   da 50 t ogni 6), e i piani F-Gas lo leggono con una condizione. Si calcola,
 *   non si chiede: chi corregge la carica in cabina non deve ricordarsi di
 *   rifare una moltiplicazione, e un valore vecchio accanto a una carica nuova
 *   sposterebbe la scadenza in silenzio.
 * * **BTU/h** = kW × 3412,14: la misura con cui i climatizzatori si chiamano in
 *   commercio («un 9000»). Solo per leggerla: non si salva.
 *
 * ⛔ I GWP sono GEMELLI di `GAS` in `backend/app/services/climatrack_seed.py`, che
 * è il catalogo dei gas di ClimaTrack e quello con cui l'ufficio fa lo stesso
 * conto (`scudo_clima.py`). Prova: `scripts/scudo/test_clima_cross.py`.
 */

export const GWP = {
  'R-32': 675,
  'R-410A': 2088,
  'R-407C': 1774,
  'R-407A': 2107,
  'R-134a': 1430,
  'R-422D': 2729,
  'R-417A': 2346,
  'R-422A': 3143,
  'R-427A': 2138,
};

/** I campi che l'app calcola da altri campi: chi li decide sono le fonti. */
export const DERIVATI = { tco2eq: ['gas_refrigerante', 'carica_refrigerante_kg'] };

const numero = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Le t CO₂eq come testo («51.36»), o '' se il gas non è a catalogo o la carica manca. */
export function tco2eq(gas, caricaKg) {
  const g = GWP[String(gas || '').trim()];
  const c = numero(caricaKg);
  if (!g || c === null || c < 0) return '';
  return String(Math.round(c * g / 10) / 100);
}

/**
 * I campi derivati di un presidio, se cambiano: `{ tco2eq: '0.32' }` o `{}`.
 * Un gas fuori elenco non cancella un valore scritto a mano: non si sa dire
 * niente, e un vuoto non è una risposta.
 */
export function campiDerivati(a) {
  const t = tco2eq(a && a.gas_refrigerante, a && a.carica_refrigerante_kg);
  if (!t || String((a && a.tco2eq) ?? '') === t) return {};
  return { tco2eq: t };
}

/**
 * kW → BTU/h, arrotondati al MIGLIAIO («≈ 12.000»). Null se non è un numero.
 *
 * ⛔ Al migliaio e non al centinaio (09/10/2026, dall'operatore: «molti li dà
 * sotto i 12000 btu»): 3,5 kW sono 11.942 BTU/h, e «≈ 11.900» si leggeva come
 * una macchina più piccola di un 12.000 — che è invece proprio la sua taglia.
 * Le taglie commerciali (9.000, 12.000, 18.000, 24.000) sono migliaia; i kW
 * accanto restano esatti, quindi non si perde niente.
 */
export function btuOra(kw) {
  const n = numero(kw);
  if (n === null || n <= 0) return null;
  return Math.round((n * 3412.14) / 1000) * 1000;
}

/** I campi delle potenze rese, in kW. */
export const POTENZE_KW = new Set(['potenza_frigorifera_kw', 'potenza_termica_kw']);

/** «2,6 kW · ≈ 9.000 BTU/h»: il punto delle migliaia sempre (`toLocaleString('it-IT')`
 * non lo mette sotto le diecimila, e «8900» e «12.000» sembrerebbero scritti in due modi). */
export function testoPotenza(kw) {
  const t = String(kw ?? '').trim();
  if (!t) return null;
  const btu = btuOra(t);
  return `${t.replace('.', ',')} kW${btu ? ` · ≈ ${String(btu).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} BTU/h` : ''}`;
}

/**
 * I dati di targa che NON si conoscono (09/10/2026, dall'operatore: «su climatrack
 * non devono rimanere valori sbagliati anche se non riuscissimo a trovarli prima
 * di reimportare il pacchetto»).
 *
 * In un pacchetto un campo vuoto vuol dire «non lo so», e la sincronizzazione con
 * ClimaTrack non lo scrive (`scudo_climatrack.py`). Ma un valore TOLTO perché
 * sbagliato — il segnaposto 1,00 kW del censimento — è vuoto anche lui, e in
 * ClimaTrack resterebbe. `dati_da_rilevare` lo dice esplicitamente: questi campi
 * vanno letti sulla targhetta, e quello che altrove ne fa le veci non vale. La
 * sincronizzazione li SVUOTA in ClimaTrack finché Scudo non li ha.
 *
 * Si scrive come elenco di nomi di campo separati da virgola. Scrivere uno dei
 * campi lo toglie dall'elenco da solo (`daRilevareDopo`, in `aggiornaAsset`), così
 * nessuno deve ricordarsi di farlo. GEMELLO di `da_rilevare_dopo` in
 * `backend/app/services/scudo_clima.py`; prova: `scripts/scudo/test_clima_cross.py`.
 */
export const DATI_RILEVABILI = {
  potenza_frigorifera_kw: 'potenza frigorifera resa',
  potenza_termica_kw: 'potenza termica resa',
  gas_refrigerante: 'gas refrigerante',
  carica_refrigerante_kg: 'carica di refrigerante',
};

/** I nomi dei campi da rilevare, nell'ordine di `DATI_RILEVABILI`, senza doppioni né sconosciuti. */
export function elencoDaRilevare(v) {
  const scritti = new Set(String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  return Object.keys(DATI_RILEVABILI).filter((k) => scritti.has(k));
}

/**
 * `{ dati_da_rilevare: '…' }` se scrivere `scritti` toglie qualcosa dall'elenco
 * (un campo scritto NON VUOTO non è più da rilevare), altrimenti `{}`.
 */
export function daRilevareDopo(attuale, scritti) {
  const prima = elencoDaRilevare(attuale);
  const dopo = prima.filter((k) => String((scritti || {})[k] ?? '').trim() === '');
  return dopo.length === prima.length ? {} : { dati_da_rilevare: dopo.join(',') };
}

/** «potenza frigorifera resa, carica di refrigerante», o null se l'elenco è vuoto. */
export function testoDaRilevare(v) {
  const e = elencoDaRilevare(v);
  return e.length ? e.map((k) => DATI_RILEVABILI[k]).join(', ') : null;
}
