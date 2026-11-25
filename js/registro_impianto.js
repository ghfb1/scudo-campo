/**
 * Scudo Campo — il registro antincendio di un IMPIANTO, come si legge.
 *
 * ⛔ 27/09/2026, dalle schermate dell'operatore: «vedo alcune cose come se fossero
 * scadute, e i dati vengono visualizzati in modo abbastanza confuso». Quattro
 * difetti, nessuno nei dati:
 *
 *  1. gli obblighi in testa venivano dalle righe del pacchetto, calcolate prima
 *     dell'aggiornamento dei campi: «Rinnovo del CPI · SCADUTA» sopra «CPI scade
 *     il 2029». Adesso vengono da `S.obblighiDiImpianto`, cioè dagli stessi campi
 *     che si leggono qui sotto;
 *  2. etichetta e valore erano due `span` in un `div` senza regole: si leggeva
 *     «CPI rilasciato il2018-11-12». Adesso sono due colonne (`.dove-riga`);
 *  3. le date erano in forma ISO, e la stessa data compariva due volte nella
 *     stessa riga: «2029-11-26 — in regola — prossima scadenza il 26/11/2029».
 *     Adesso una volta, all'italiana; lo STATO sta negli obblighi in testa, dove
 *     c'è il colore, e non si ripete accanto al campo;
 *  4. le note del registro — dove stanno Comando VV.F., gruppi elettrogeni,
 *     asseverazioni — non si vedevano da nessuna parte.
 *
 * Modulo a sé (come `luoghi.js`): `app.js` non si costruisce in una prova.
 */
import { dataIt, el } from './ui.js';
import { frasScadenza } from './controllo.js';
import * as S from './stato.js';

const BARRA = { SCADUTO: 'ko', IN_SCADENZA: 'attenzione', REGOLARE: 'ok' };

/** Una data ISO all'italiana; un testo che non è una data resta com'è scritto. */
function data(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? dataIt(s) : s;
}

/** Da dove viene la data di un obbligo, a parole. */
export function origineObbligo(o) {
  if (o.campo === 'ultima_prova_evacuazione') {
    return `Dodici mesi dall'ultima prova, fatta il ${data(o.ultima)} (DM 02/09/2021).`;
  }
  if (o.campo === 'conformita_scadenza') return 'Dalla data scritta sull\'attestazione di rinnovo periodico (ARPCA).';
  if (o.campo === 'cpi_scadenza') return 'Dalla scadenza scritta sul CPI.';
  return '';
}

/**
 * Le righe «etichetta → valore» del registro, in ordine. Pura: la prova le
 * confronta con la riga dell'impianto.
 */
export function righeRegistro(riga) {
  const v = (k) => String(riga[k] == null ? '' : riga[k]).trim();
  const documenti = [
    ['Attività soggette (DPR 151/2011)', v('codici_attivita')],
    ['Pratica VV.F. / CPI n.', v('cpi_numero')],
    ['CPI rilasciato il', data(v('cpi_rilascio'))],
    ['CPI scade il', data(v('cpi_scadenza'))],
    ['SCIA', [v('scia_protocollo'), data(v('scia_data'))].filter(Boolean).join(' · ')],
    ['Rinnovo periodico (ARPCA) — ultimo', data(v('conformita_ultimo_rinnovo'))],
    ['Rinnovo periodico (ARPCA) — entro il', data(v('conformita_scadenza'))],
    // La data dell'ultima prova, non solo la scadenza che ne discende: chi è
    // sul posto deve poter dire «questa è vecchia» guardando il giorno in cui
    // è stata fatta.
    ['Ultima prova di evacuazione', data(v('ultima_prova_evacuazione'))],
  ].filter(([, x]) => x);
  const persone = [
    ['Datore di lavoro', v('datore_lavoro')],
    ['RSPP', v('rspp')],
    ['ASPP', v('aspp')],
    ['RLSA', v('rlsa')],
    ['Medico competente', v('medico_competente')],
    ['Responsabile del registro', v('responsabile_registro')],
    ['Squadra di emergenza', v('squadra_emergenza')],
    ['Piano di emergenza', v('piano_emergenza')],
  ].filter(([, x]) => x);
  return { documenti, persone, note: v('note') };
}

const rigaDati = ([k, val]) => el('div', { class: 'dove-riga' }, [
  el('span', { class: 'dove-etichetta', testo: k }),
  el('span', { class: 'dove-valore', testo: val }),
]);

/**
 * @param riga       la riga dell'impianto
 * @param opzioni    `{ obblighi, nomeTipo(codice), modifica: { testo, fai } }`
 */
export function vistaRegistroImpianto(riga, { obblighi = [], nomeTipo = (c) => c, modifica = null } = {}) {
  const { documenti, persone, note } = righeRegistro(riga);
  return el('div', { class: 'registro-impianto' }, [
    el('h3', { testo: obblighi.length ? `Scadenze di questo impianto (${obblighi.length})` : 'Scadenze di questo impianto' }),
    obblighi.length
      ? el('ul', { class: 'elenco' }, obblighi.map((o) => {
        const f = frasScadenza(o.data_scadenza);
        const origine = origineObbligo(o);
        return el('li', {}, [
          el('div', { class: 'voce', style: 'cursor:default' }, [
            // ⛔ La barra vuole `ko`/`attenzione`/`ok`, non le classi delle
            // pastiglie: con `tag-rosso` restava GRIGIA anche sulla prova di
            // evacuazione scaduta (visto nel browser, 27/09/2026).
            el('span', { class: `barra-stato ${BARRA[S.semaforo(o.data_scadenza)] || ''}` }),
            el('span', { class: 'voce-corpo' }, [
              el('div', { class: 'voce-titolo', testo: nomeTipo(o.tipo_controllo_codice) }),
              // Una volta sola, all'italiana: la frase porta già la data.
              el('div', { class: 'voce-sotto', testo: f.testo }),
              origine ? el('div', { class: 'mini', testo: origine }) : null,
            ].filter(Boolean)),
          ]),
        ]);
      }))
      // Il vuoto si DICE: una sezione assente si legge come «tutto in regola».
      : el('div', { class: 'mini', testo:
        'Nessuna: nel registro non c\'è una data da cui contarle (scadenza del CPI, '
        + 'rinnovo periodico ARPCA, ultima prova di evacuazione).' }),
    el('h3', { testo: 'Prevenzione incendi' }),
    documenti.length ? el('div', { class: 'dove-righe' }, documenti.map(rigaDati))
      // ⚠️ Il vuoto si DICE, e si dice che cosa vuol dire: una sezione vuota
      // senza spiegazione si legge come «questo impianto non ha un CPI», che
      // è un'affermazione che nessuno ha fatto.
      : el('div', { class: 'mini', testo:
        'Il registro di questo impianto non è ancora stato riportato in Scudo. '
        + "Non vuol dire che manchi: vuol dire che qui non c'è." }),
    persone.length ? el('h3', { testo: 'Chi' }) : null,
    persone.length ? el('div', { class: 'dove-righe' }, persone.map(rigaDati)) : null,
    // Le note stanno chiuse: sono lunghe (Comando VV.F., gruppi elettrogeni,
    // asseverazioni, valori di prima) e chi apre il foglio cerca prima le date.
    note ? el('details', { class: 'registro-note' }, [
      el('summary', { testo: 'Note del registro' }),
      el('div', { class: 'registro-note-testo', testo: note }),
    ]) : null,
    modifica ? el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
      testo: modifica.testo, onclick: modifica.fai,
    }) : null,
  ].filter(Boolean));
}
