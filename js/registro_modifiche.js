/**
 * Scudo Campo — il registro delle modifiche, giorno per giorno.
 *
 * ⛔ 27/09/2026, richiesta dell'operatore: «il registro modifiche dovrebbe
 * mostrare una divisione per ogni giorno, così che sia più ordinato, e anche
 * quale presidio (progressivo) è stato modificato o controllato, o ubicazione o
 * altro»; e poi: «se il target può essere collegato all'impianto deve essere
 * mostrato l'impianto, così sappiamo in ogni momento dove era l'operatore».
 *
 * Prima era una tabella unica di trecento righe, con «Quando» ripetuto a ogni
 * riga e senza impianto: per sapere dove si era lavorato martedì bisognava
 * leggerle tutte.
 *
 * Adesso ogni giorno è un blocco che si apre (il più recente è aperto), con in
 * testa quante modifiche e chi le ha fatte; dentro, ogni riga dice l'ORA, che
 * cosa è successo, su quale presidio o luogo, e DOVE — impianto › area ›
 * ubicazione, com'era a quell'ora (vedi `descriviEvento`).
 *
 * Modulo a sé (come `luoghi.js`): `app.js` non si costruisce in una prova.
 */
import { el } from './ui.js';

/** Il giorno LOCALE di un istante UTC, in `AAAA-MM-GG`. */
export function giornoLocale(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function oraLocale(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** «venerdì 25 settembre 2026». */
export function giornoAParole(giorno) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(giorno || '');
  if (!m) return 'data sconosciuta';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // Maiuscola solo la prima lettera: «Sabato 26 settembre», non «Settembre».
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Gli eventi descritti (dal più recente) raggruppati per giorno, nello stesso
 * ordine. Pura.
 *
 * @param descritti  `[{ ev, d }]`, come li dà `S.registroDescritto()`
 * @returns `[{ giorno, eventi: [{ev, d}], chi: [nomi], impianti: [nomi] }]`
 */
export function giorniDelRegistro(descritti) {
  const giorni = [];
  let corrente = null;
  for (const x of descritti || []) {
    const g = giornoLocale(x.ev.ts_utc);
    if (!corrente || corrente.giorno !== g) {
      corrente = { giorno: g, eventi: [], chi: [], impianti: [] };
      giorni.push(corrente);
    }
    corrente.eventi.push(x);
    const chi = String(x.ev.operatore_nome || '').trim();
    if (chi && !corrente.chi.includes(chi)) corrente.chi.push(chi);
    if (x.d.impianto && !corrente.impianti.includes(x.d.impianto)) corrente.impianti.push(x.d.impianto);
  }
  return giorni;
}

function rigaEvento({ ev, d }) {
  const chi = String(ev.operatore_nome || '').trim();
  return el('li', { class: 'registro-evento' }, [
    el('div', { class: 'registro-evento-testa' }, [
      el('span', { class: 'registro-ora mono', testo: oraLocale(ev.ts_utc) }),
      el('span', { class: 'registro-azione', testo: d.azione || ev.operazione || '' }),
    ]),
    d.cosa ? el('div', { class: 'registro-cosa', testo: d.cosa }) : null,
    // Il DOVE sta su una riga sua, con il segno: è la risposta a «dove ero».
    d.dove && d.dove !== d.cosa ? el('div', { class: 'registro-dove', testo: `📍 ${d.dove}` }) : null,
    d.dettaglio ? el('div', { class: 'registro-dettaglio', testo: d.dettaglio }) : null,
    // Un evento senza nome lo DICE: una cella vuota si legge come un difetto
    // della schermata, non del dato.
    el('div', { class: `registro-chi${chi ? '' : ' registro-chi-manca'}`,
      testo: chi ? `di ${chi}` : 'chi l\'ha fatto non è stato registrato' }),
  ].filter(Boolean));
}

/**
 * @param descritti  `S.registroDescritto()`
 */
export function vistaRegistroModifiche(descritti) {
  const giorni = giorniDelRegistro(descritti);
  const n = (descritti || []).length;
  return el('div', { class: 'registro-modifiche' }, [
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo:
      `${n} ${n === 1 ? 'modifica' : 'modifiche'} in ${giorni.length} ${giorni.length === 1 ? 'giorno' : 'giorni'}, `
      + 'dalla più recente. Ci sono quelle fatte su questo dispositivo e quelle di chi ha '
      + 'tenuto il giro prima; rientrano in ufficio con il pacchetto.' }),
    ...giorni.map((g, i) => el('details', { class: 'registro-giorno', open: i === 0 }, [
      el('summary', {}, [
        el('span', { class: 'registro-giorno-titolo', testo: giornoAParole(g.giorno) }),
        el('span', { class: 'mini', testo:
          ` · ${g.eventi.length} ${g.eventi.length === 1 ? 'modifica' : 'modifiche'}`
          + (g.chi.length ? ` · ${g.chi.join(', ')}` : '')
          + (g.impianti.length ? ` · ${g.impianti.length <= 3 ? g.impianti.join(', ') : `${g.impianti.length} impianti`}` : '') }),
      ]),
      el('ul', { class: 'registro-eventi' }, g.eventi.map(rigaEvento)),
    ])),
  ]);
}
