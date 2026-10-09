/**
 * Scudo Campo — le righe del PRESIDIO nella scheda che si apre toccandolo sulla
 * mappa (06/10/2026).
 *
 * Richiesta dell'operatore: «quando sulla mappa clicchiamo su un presidio, ce lo
 * dà con nessun difetto rilevato anche se ci sono anomalie. Inoltre dovrebbe
 * mostrare le note come le abbiamo inserite (gli "a capo" vanno rispettati), e
 * anche se un estintore è carrellato o meno».
 *
 * Un modulo a sé perché la scheda sta in `app.js`, che avvia l'applicazione
 * appena viene importato e non si può costruire in una prova: queste righe sì.
 */

import { el } from './ui.js';
import * as S from './stato.js';
import { riassuntoAnomalia } from './anomalia_testo.js';
import { valoreLeggibile } from './campi.js';

/**
 * Un codice di scelta a parole: nel catalogo le opzioni sono solo codici
 * («POLVERE», «REI_120», «VERSO_ESODO»). Le eccezioni dove la regola generica
 * («REI 120», «Polvere») non basta stanno qui.
 */
export const CODICI_A_PAROLE = {
  CARRELLATO: 'Carrellato (su ruote)',
  FISSA: 'Fissa (bombola a servizio di un impianto)',
  USCITA_SICUREZZA: 'Uscita di sicurezza',
  VERSO_ESODO: "Nel verso dell'esodo",
  CONTRARIO_ESODO: "Contro il verso dell'esodo",
  INOX_ALLUMINIO: 'Inox o alluminio',
};

export function codiceAParole(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (CODICI_A_PAROLE[s]) return CODICI_A_PAROLE[s];
  // Sigle che si scrivono così: CO2, REI 120.
  if (/^[A-Z]{2,4}\d+$/.test(s)) return s;
  if (/^REI_\d+$/.test(s)) return s.replace('_', ' ');
  if (!/^[A-Z0-9_]+$/.test(s)) return s;
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Per compatibilità con chi la importa già: il tipo di installazione a parole. */
export function installazioneAParole(a) {
  return codiceAParole(a && a.installazione);
}

/**
 * I dati PROPRI della categoria del presidio, a parole: i campi che il catalogo
 * dichiara per quella categoria (`categorie`), solo quelli compilati.
 *
 * ⛔ Dalla categoria e non da un elenco scritto qui (06/10/2026, dall'operatore:
 * «il tipo di installazione dell'estintore, oppure per le uscite di sicurezza gli
 * altri dati utili, vanno sotto la categoria; deve essere visibile anche
 * l'estinguente»). Estintore: estinguente, carica, installazione, serbatoio,
 * revisione…; uscita di sicurezza: tipologia, ante, dotazione, verso di apertura.
 * Un campo nuovo del catalogo compare da sé, nella categoria giusta.
 */
export function datiDellaCategoria(a) {
  if (!a) return [];
  const dati = S.campiPerCategoria(a.categoria_codice)
    .filter((c) => Array.isArray(c.categorie) && c.categorie.length)
    .map((c) => {
      const grezzo = a[c.nome];
      if (grezzo === null || grezzo === undefined || String(grezzo).trim() === '') return null;
      let valore;
      if (c.tipo === 'scelta') valore = codiceAParole(grezzo);
      else if (c.nome === 'carica_kg' || c.nome === 'carica_refrigerante_kg') valore = `${String(grezzo).replace('.', ',')} kg`;
      else if (c.nome === 'tco2eq') valore = `${String(grezzo).replace('.', ',')} t`;
      else valore = valoreLeggibile(c, grezzo, a);
      // Le potenze del climatizzatore anche in BTU/h (09/10/2026, dall'operatore:
      // «fare anche la conversione per ricavare i btu dai dati che abbiamo»): è
      // la misura con cui si chiamano in commercio, «un 9000». Solo da leggere.
      // «(kg)» resta nel valore, non nell'etichetta: «Carica: 6 kg».
      return valore ? { etichetta: c.etichetta.replace(/\s*\((kg|kW|m|mm|bar)\)$/, ''), valore } : null;
    })
    .filter(Boolean);
  // Un climatizzatore SENZA potenza lo dice (09/10/2026): saltare la riga
  // faceva cercare i BTU che non c'erano, e il motivo — nessuna fonte riporta
  // la potenza resa — non si leggeva da nessuna parte.
  const cat = S.categoriaDi(a);
  if (cat && cat.tipo_asset_codice === 'CLIMATIZZATORE' && !String(a.potenza_frigorifera_kw ?? '').trim()) {
    dati.splice(Math.min(1, dati.length), 0, { etichetta: 'Potenza frigorifera resa',
      valore: 'non indicata: BTU/h non calcolabili (leggila sulla targhetta, in kW o BTU/h)' });
  }
  return dati;
}

/**
 * La voce «Categoria» del presidio: il nome della categoria e, sotto, i suoi dati.
 */
export function voceCategoria(a, nomeCategoria) {
  const dati = datiDellaCategoria(a);
  return el('div', { class: 'scheda-voce' }, [
    el('div', { class: 'scheda-voce-etichetta', testo: 'Categoria' }),
    el('div', { class: 'scheda-voce-valore', testo: nomeCategoria || (a && a.categoria_codice) || '' }),
    dati.length ? el('dl', { class: 'dati dati-categoria' }, dati.flatMap((d) => [
      el('dt', { testo: d.etichetta }),
      el('dd', { testo: d.valore }),
    ])) : null,
  ]);
}

function voce(etichetta, valore, classe = '') {
  return el('div', { class: 'scheda-voce' }, [
    el('div', { class: 'scheda-voce-etichetta', testo: etichetta }),
    typeof valore === 'string'
      ? el('div', { class: `scheda-voce-valore ${classe}`.trim(), testo: valore })
      : valore,
  ]);
}

/**
 * Le righe in più per un presidio, sotto «Dove»: anomalie aperte, note. (I dati
 * della categoria stanno in `voceCategoria`, sotto il nome della categoria.)
 *
 * ⛔ Le anomalie aperte si ELENCANO, con la risposta a «si può usare?». La
 * pastiglia dell'idoneità dice quante sono; chi apre la scheda sulla mappa vuole
 * sapere quali, e se il pezzo si può usare lo stesso.
 *
 * ⛔ Le note con i loro a capo (`testo-a-capo`, `white-space: pre-wrap`): un
 * elenco scritto su più righe, stampato su una riga sola, diventa un muro di
 * testo in cui non si capisce dove finisce una voce e comincia l'altra.
 */
export function righePresidioMappa(a) {
  if (!a) return [];
  const righe = [];
  const aperte = S.anomalieDi(a.id);
  if (aperte.length) {
    righe.push(voce(`Anomalie aperte (${aperte.length})`, el('ul', { class: 'scheda-anomalie' },
      aperte.map((an) => {
        const r = riassuntoAnomalia(an);
        const blocca = S.anomaliaBlocca(an);
        return el('li', {}, [
          el('span', { class: 'testo-a-capo', testo: r.titolo }),
          el('span', {
            class: `tag ${blocca ? 'tag-rosso' : 'tag-ambra'}`, style: 'margin-left:6px',
            testo: blocca ? '✕ impedisce l\'uso' : '! si può usare',
          }),
        ]);
      }))));
  }
  const note = String(a.note || '').trim();
  if (note) righe.push(voce('Note', note, 'testo-a-capo'));
  return righe;
}

/**
 * Un presidio NON INDIVIDUATO nell'ultimo controllo non è «idoneo, verifiche in
 * regola» (09/10/2026, dall'operatore su UISUV-260: «non è stato trovato e quindi
 * verificato, ma se ci clicchiamo dal presidio o dalla mappa dice idoneo, verifiche
 * in regola, niente da fare in questo giro, come se non ci fossero stati problemi»).
 *
 * L'idoneità resta quella dell'ultimo controllo ESEGUITO — è la regola gemella con
 * l'ufficio, e non cambia —: cambia quello che si scrive in testa alla scheda,
 * perché da allora nessuno ha visto il pezzo. `null` se il presidio è stato trovato.
 */
export function statoNonIndividuato(a) {
  const iv = a && S.ultimoNonIndividuato(a.id);
  if (!iv) return null;
  const d = String(iv.data || '').slice(0, 10).split('-').reverse().join('/');
  return {
    idoneita: `⚠ non individuato il ${d}: non si sa se si può usare`,
    verifiche: '⚠ da cercare: il controllo va rifatto',
  };
}
