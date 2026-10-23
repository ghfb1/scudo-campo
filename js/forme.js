/**
 * Le FORME disegnate sulla mappa per un'area o un'ubicazione (18/10/2026).
 *
 * Richiesta dell'operatore: «la possibilità di disegnare delle forme e dargli
 * un colore e una trasparenza sulla mappa, connesso alle aree o ubicazioni; non
 * deve corrompere i pacchetti attuali». Una forma è un poligono — tre angoli o
 * più, quanti servono — con un colore e un'opacità.
 *
 * Nel pacchetto sono TRE colonne in coda a `2-edifici.csv` e `3-locali.csv`
 * (gemelle in `scudo_pacchetto.py`), additive come le coordinate dei luoghi:
 *
 * | colonna          | che cosa                                   | esempio                      |
 * |------------------|--------------------------------------------|------------------------------|
 * | `forma_punti`    | gli angoli, «lat,lon» separati da spazi    | `43.0771,10.6764 43.0772,…`  |
 * | `forma_colore`   | il colore, `#rrggbb`                       | `#2563eb`                    |
 * | `forma_opacita`  | l'opacità del riempimento, in PERCENTO     | `30`                         |
 *
 * ⚠️ Perché un testo e non JSON: i CSV del pacchetto sono separati da `;` e
 * l'ufficio li apre anche in un foglio di calcolo; un JSON porta virgolette che
 * vanno raddoppiate, e una cella spezzata a metà è una forma persa. «lat,lon»
 * con il PUNTO decimale (mai la virgola: la virgola separa le due coordinate).
 * E l'opacità è un intero in percento per la stessa ragione dei decimali: un
 * «0,3» scritto da un foglio italiano non è un numero per nessuno dei due lati.
 *
 * ⛔ Leggere una forma non solleva MAI: un testo rovinato (scritto a mano in un
 * foglio, troncato) dà `null`, e la mappa semplicemente non la disegna. Un
 * difetto qui non deve poter bloccare né la mappa né un rientro — per questo la
 * validazione del pacchetto non guarda queste colonne.
 *
 * GEMELLO di `frontend/src/components/scudo/mappaGeometria.js` (`formaDaTesto`,
 * `coloreForma`, `opacitaForma`), confrontato da `test_mappa_cross.mjs`.
 */

/** I colori fra cui si sceglie: pochi, distinti sopra una foto dal satellite. */
export const PALETTE_FORME = [
  { colore: '#2563eb', nome: 'blu' },
  { colore: '#16a34a', nome: 'verde' },
  { colore: '#eab308', nome: 'giallo' },
  { colore: '#ea580c', nome: 'arancione' },
  { colore: '#dc2626', nome: 'rosso' },
  { colore: '#9333ea', nome: 'viola' },
  { colore: '#0891b2', nome: 'azzurro' },
  { colore: '#ffffff', nome: 'bianco' },
];
export const COLORE_PREDEFINITO = PALETTE_FORME[0].colore;

/** Le opacità fra cui si sceglie, in percento: dalla più trasparente. */
export const OPACITA_FORME = [15, 30, 45, 60];
export const OPACITA_PREDEFINITA = 30;
// Fuori da questi limiti una forma o non si vede o copre la foto e i punti.
const OPACITA_MIN = 5;
const OPACITA_MAX = 90;

/** Il minimo degli angoli: con due è una linea, non una forma. */
export const ANGOLI_MINIMI = 3;
// Sette decimali di grado sono un centimetro: oltre è rumore, sotto si perde
// l'angolo di una cabina.
const DECIMALI = 7;

/**
 * Gli angoli da un testo «lat,lon lat,lon …»: `[{lat, lon}]`, o `null` se il
 * testo non è una forma (vuoto, meno di tre angoli validi, un angolo illeggibile).
 *
 * ⚠️ Un solo angolo illeggibile rende nulla TUTTA la forma: saltarlo
 * disegnerebbe un'altra forma, con la faccia di quella giusta.
 */
export function formaDaTesto(testo) {
  const parti = String(testo ?? '').trim().split(/\s+/).filter(Boolean);
  if (parti.length < ANGOLI_MINIMI) return null;
  const punti = [];
  for (const parte of parti) {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(parte);
    if (!m) return null;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
    punti.push({ lat, lon });
  }
  return punti;
}

/** Il testo da scrivere nel pacchetto; `''` se gli angoli non fanno una forma. */
export function testoDaForma(punti) {
  const validi = (punti || []).filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)));
  if (validi.length < ANGOLI_MINIMI) return '';
  return validi.map((p) => `${Number(p.lat).toFixed(DECIMALI)},${Number(p.lon).toFixed(DECIMALI)}`).join(' ');
}

/** Il colore di una forma: `#rrggbb` minuscolo, o quello predefinito. */
export function coloreForma(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : COLORE_PREDEFINITO;
}

/** L'opacità di una forma in percento, intera, dentro i limiti; vuota = predefinita. */
export function opacitaForma(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return OPACITA_PREDEFINITA;
  return Math.min(OPACITA_MAX, Math.max(OPACITA_MIN, Number(s)));
}

/**
 * La forma di una riga di area o ubicazione, pronta da disegnare:
 * `{ punti, colore, opacita }`, o `null` se la riga non ne ha una leggibile.
 */
export function formaDelLuogo(riga) {
  const punti = formaDaTesto(riga && riga.forma_punti);
  if (!punti) return null;
  return { punti, colore: coloreForma(riga.forma_colore), opacita: opacitaForma(riga.forma_opacita) };
}

/**
 * I tre campi da scrivere sul luogo. `null` (o una forma con meno di tre
 * angoli) li SVUOTA tutti e tre: un colore rimasto senza angoli non dice niente,
 * e lascerebbe credere che una forma ci sia.
 */
export function campiForma(forma) {
  const testo = forma ? testoDaForma(forma.punti) : '';
  if (!testo) return { forma_punti: '', forma_colore: '', forma_opacita: '' };
  return {
    forma_punti: testo,
    forma_colore: coloreForma(forma.colore),
    forma_opacita: String(opacitaForma(forma.opacita)),
  };
}
