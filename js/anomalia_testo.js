/**
 * Come si MOSTRA il testo di un'anomalia: la nota dell'operatore in evidenza,
 * l'elenco delle verifiche non idonee raccolto sotto.
 *
 * Perché esiste (24/09/2026, dall'operatore: «dell'anomalia dovremmo
 * evidenziare meglio la nota manuale e far capire che è ciò che è stato scritto
 * dall'operatore, nei vari posti in cui mostriamo le anomalie»). La
 * separazione la fa `S.testoAnomalia` (il formato salvato non cambia); qui si
 * decide solo l'aspetto, in un posto solo, perché i posti sono cinque e una
 * regola ripetuta cinque volte diverge alla prima correzione.
 *
 * Due forme:
 *  * `riassuntoAnomalia(an)` → `{ titolo, sotto }`, due stringhe per le righe
 *    degli ELENCHI, che sono pulsanti: dentro un pulsante non si mette un
 *    elemento che si apre e si chiude;
 *  * `nodoTestoAnomalia(an)` → la nota, e l'elenco dentro un `<details>` chiuso,
 *    per le schede.
 *
 * Dal 25/09/2026 un'anomalia nuova non ha più l'elenco: la descrizione è solo
 * quello che l'operatore ha scritto, e al più UNA verifica collegata
 * (`verifica_collegata`), che si mostra come «riguarda: …». L'elenco resta per
 * quelle registrate prima, com'erano.
 */
import { el } from './ui.js';
import * as S from './stato.js';

// ⛔ «voci lasciate senza spunta», non «verifiche non idonee» (25/09/2026,
// dall'operatore: «è normale che da alcune parti dica non idonee e da altre non
// controllate?»). È l'elenco che la registrazione di PRIMA del 25/09 aggiungeva da
// sola con le voci vuote; dal 25/09 una spunta vuol dire «eseguita», e il
// dettaglio del controllo le mostra come non spuntate. Chiamarle «non idonee»
// affermava un giudizio che il dato non contiene: con qualcosa che non andava,
// l'operatore le lasciava tutte vuote per fare prima.
const plurale = (n) => (n === 1 ? '1 voce lasciata senza spunta' : `${n} voci lasciate senza spunta`);
export const SPIEGA_VOCI_VUOTE = 'Registrazione di prima del 25/09/2026: le voci lasciate senza spunta si aggiungevano '
  + 'da sole alla descrizione come «non idonee». Non vuol dire che ognuna lo fosse.';

/** Quante voci ha l'elenco: le verifiche, o 1 se c'è solo il testo grezzo. */
function contaVoci(t) {
  return t.verifiche.length || (t.grezzo ? 1 : 0);
}

/** La verifica a cui il difetto si riferisce, se chi l'ha aperto l'ha scelta. */
export function verificaCollegata(an) {
  return String((an && an.verifica_collegata) || '').trim();
}

export function riassuntoAnomalia(an) {
  const t = S.testoAnomalia(an);
  const n = contaVoci(t);
  const nota = t.nota.trim();
  const collegata = verificaCollegata(an);
  if (!n) return { titolo: nota || '(senza descrizione)', sotto: collegata ? `riguarda: ${collegata}` : '' };
  return nota
    ? { titolo: nota, sotto: `+ ${t.verifiche.length ? plurale(n) : 'voci lasciate senza spunta'}` }
    : { titolo: t.verifiche.length ? plurale(n) : 'Voci lasciate senza spunta', sotto: 'nessuna nota scritta' };
}

export function nodoTestoAnomalia(an) {
  const t = S.testoAnomalia(an);
  const nota = t.nota.trim();
  const n = contaVoci(t);
  return el('div', { class: 'anomalia-testo-diviso' }, [
    nota
      ? el('div', { class: 'anomalia-nota' }, [
        el('span', { class: 'anomalia-nota-segno', 'aria-label': 'Scritto dall\'operatore', testo: '✍️ ' }),
        el('span', { testo: nota }),
      ])
      : (n ? el('div', { class: 'anomalia-nota anomalia-nota-vuota', testo: 'Nessuna nota scritta' })
        : el('div', { class: 'anomalia-nota', testo: '(senza descrizione)' })),
    verificaCollegata(an) ? el('div', { class: 'anomalia-collegata', testo: `↳ riguarda la verifica: ${verificaCollegata(an)}` }) : null,
    n ? el('details', { class: 'anomalia-verifiche' }, [
      el('summary', { testo: t.verifiche.length ? plurale(n) : 'Voci lasciate senza spunta' }),
      el('div', { class: 'mini', style: 'margin:4px 0', testo: SPIEGA_VOCI_VUOTE }),
      t.verifiche.length
        ? el('ul', {}, t.verifiche.map((v) => el('li', { testo: v })))
        : el('div', { class: 'mini', testo: t.grezzo }),
    ]) : null,
  ].filter(Boolean));
}
