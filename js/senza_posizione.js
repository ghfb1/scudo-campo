/**
 * Accanto alla mappa: che cosa NON c'è sulla mappa, e come dargli un posto.
 *
 * Perché esiste (24/09/2026, richiesta dell'operatore: «metti il filtro
 * posizione anche nella mappa della tab ubicazioni»)
 * -------------------------------------------------------------------------
 * Sulla mappa, per costruzione, si vede solo chi una posizione ce l'ha: un
 * filtro «senza posizione» lì non ha niente da disegnare. Quello che serve è
 * l'ELENCO di chi manca — presidi, aree, ubicazioni, impianti — con il modo di
 * dargli un posto, accanto alla mappa su cui lo si metterà. Scelto con
 * l'operatore fra due strade; l'altra (disegnarli sul punto del loro luogo)
 * avrebbe messo sulla mappa posizioni che nessuno ha rilevato.
 *
 * Prima c'era solo l'elenco degli IMPIANTI senza posizione (23/09/2026,
 * «manca Populonia»): è diventato una delle quattro voci di questo.
 *
 * ⛔ Qui non si scrive niente: la riga chiama `onPosiziona(voce)`, e l'app
 * apre le sue due strade di sempre (satellite o a mano), che passano da
 * `muta` e finiscono nel pacchetto come ogni altra modifica.
 *
 * La regola «ha una posizione» è `S.haPosizione`, gemella di `conPosizione`
 * della mappa (le confronta `test_mappa_campo.mjs`): l'elenco e la mappa si
 * spartiscono i luoghi, nessuno sta in tutti e due e nessuno in nessuno.
 */
import { el } from './ui.js';
import * as S from './stato.js';
import { E } from './pacchetto.js';
import { nomePresidioMappa, normaRicerca } from './mappa.js';
import { dettaglioTipologia } from './nome_presidio.js';
import { propostaPer } from './posizioni_proposte.js';

/** I quattro tipi, nell'ordine in cui compaiono: dal più grosso al più piccolo. */
export const TIPI_SENZA = [
  { tipo: 'impianto', etichetta: 'Impianti' },
  { tipo: 'edificio', etichetta: 'Aree' },
  { tipo: 'locale', etichetta: 'Ubicazioni' },
  { tipo: 'presidio', etichetta: 'Presidi' },
];

/**
 * Chi ha una posizione, e chi no: `{ sulla: n, senza: [voci] }`.
 *
 * Ogni voce: `{ tipo, id, nome, dove, riga, vicino }`. `vicino` è la posizione
 * del luogo più stretto che la contiene e che una posizione ce l'ha
 * (ubicazione → area → impianto): da lì parte la croce del posizionamento a
 * mano, invece che dal centro di quello che si stava guardando.
 *
 * Un impianto con una posizione PROPOSTA (`posizioni_proposte.js`) è sulla
 * mappa — tratteggiato, con «Conferma» — quindi non è fra i senza.
 */
/** La posizione di un impianto, anche solo PROPOSTA (sulla mappa c'è), o null. */
export function posizioneImpianto(i) {
  if (!i) return null;
  if (S.haPosizione(i)) return { lat: i.lat, lon: i.lon };
  const p = propostaPer(i);
  return p ? { lat: p.lat, lon: p.lon } : null;
}

/**
 * Da dove parte la croce per un luogo o un presidio senza posizione: il luogo
 * più stretto che lo contiene e ce l'ha (ubicazione → area → impianto), o null.
 * Una regola sola, per l'elenco accanto alla mappa e per i pulsanti delle righe
 * dei Presidi (24/09/2026).
 */
export function posizioneDelContenitore(tipo, riga) {
  if (!riga) return null;
  const pos = (r) => (r && S.haPosizione(r) ? { lat: r.lat, lon: r.lon } : null);
  const imp = (id) => posizioneImpianto(S.indici.impianti.get(id));
  if (tipo === 'impianto') return null;
  if (tipo === 'edificio') return imp(riga.impianto_id);
  if (tipo === 'locale') {
    const ed = S.indici.edifici.get(riga.edificio_id);
    return pos(ed) || imp(riga.impianto_id || (ed && ed.impianto_id));
  }
  const loc = S.indici.locali && S.indici.locali.get(riga.locale_id);
  return pos(loc) || pos(S.indici.edifici.get(riga.edificio_id)) || imp(riga.impianto_id);
}

export function raccogliSenzaPosizione() {
  const st = S.get();
  const vivi = (ent) => (st.perEntita[ent] || []).filter((r) => !r.eliminato_il);
  const impianti = new Map(vivi(E.IMPIANTO).map((r) => [r.id, r]));
  const edifici = new Map(vivi(E.EDIFICIO).map((r) => [r.id, r]));
  const locali = new Map(vivi(E.LOCALE).map((r) => [r.id, r]));
  const posImpianto = posizioneImpianto;
  const nomeDi = (m, id) => ((m.get(id) || {}).denominazione || '');

  let sulla = 0;
  const senza = [];
  for (const i of impianti.values()) {
    if (posImpianto(i)) { sulla += 1; continue; }
    senza.push({ tipo: 'impianto', id: i.id, nome: i.denominazione, dove: '', riga: i, vicino: null });
  }
  for (const e of edifici.values()) {
    if (S.haPosizione(e)) { sulla += 1; continue; }
    senza.push({ tipo: 'edificio', id: e.id, nome: e.denominazione, dove: nomeDi(impianti, e.impianto_id),
      riga: e, vicino: posizioneDelContenitore('edificio', e) });
  }
  for (const l of locali.values()) {
    if (S.haPosizione(l)) { sulla += 1; continue; }
    const ed = edifici.get(l.edificio_id);
    const impiantoId = l.impianto_id || (ed && ed.impianto_id);
    senza.push({ tipo: 'locale', id: l.id, nome: l.denominazione,
      dove: [nomeDi(impianti, impiantoId), ed ? ed.denominazione : ''].filter(Boolean).join(' › '),
      riga: l, vicino: posizioneDelContenitore('locale', l) });
  }
  for (const a of vivi(E.ASSET)) {
    if (S.haPosizione(a)) { sulla += 1; continue; }
    const cat = S.categoriaDi(a) || {};
    senza.push({ tipo: 'presidio', id: a.id,
      nome: nomePresidioMappa({ icona: cat.icona,
        categoria: [cat.descrizione || a.categoria_codice, dettaglioTipologia(a)].filter(Boolean).join(' · '),
        identificativo: a.identificativo, matricola: a.matricola }),
      dove: S.ubicazione(a), riga: a,
      vicino: posizioneDelContenitore('presidio', a) });
  }
  return { sulla, senza };
}

/** Le voci di un tipo (o tutte), che contengono tutte le parole cercate. */
export function filtraSenza(voci, { tipo = '', testo = '' } = {}) {
  const parole = normaRicerca(testo).split(' ').filter(Boolean);
  return (voci || []).filter((v) => {
    if (tipo && v.tipo !== tipo) return false;
    if (!parole.length) return true;
    const blob = normaRicerca(`${v.nome} ${v.dove}`);
    return parole.every((p) => blob.includes(p));
  });
}

const PASSO = 30;

/**
 * Il riquadro accanto alla mappa.
 *
 * @param dati    il risultato di `raccogliSenzaPosizione()`
 * @param azioni  `{ onPosiziona(voce) }`
 * @param memoria un oggetto di chi apre la mappa (sopravvive ai ridisegni):
 *   `{ vista: 'sulla' | 'senza', tipo, testo, limite }`.
 *
 * ⛔ Si ridisegna DA SÉ (solo l'elenco), non con la schermata: scrivendo nella
 * ricerca un ridisegno completo rifarebbe la mappa a ogni tasto e toglierebbe
 * il fuoco dal campo.
 */
export function vistaSenzaPosizione(dati, azioni = {}, memoria = {}) {
  const m = memoria;
  if (m.vista !== 'senza') m.vista = 'sulla';
  if (m.tipo === undefined) {
    // Si parte dal tipo che ha qualcuno da sistemare, dal più grosso.
    const primo = TIPI_SENZA.find((t) => dati.senza.some((v) => v.tipo === t.tipo));
    m.tipo = primo ? primo.tipo : '';
  }
  m.testo = m.testo || '';
  m.limite = m.limite || PASSO;

  const scelta = el('div', { class: 'senza-scelta' });
  const corpo = el('div', { class: 'senza-corpo' });
  const nodo = el('div', { class: 'card senza-posizione' }, [
    el('div', { class: 'senza-titolo', testo: '📍 Posizione' }),
    scelta,
    corpo,
  ]);

  function sceltaVista() {
    const voce = (chiave, testo) => el('button', {
      class: `interruttore-voce${m.vista === chiave ? ' attiva' : ''}`, type: 'button',
      'aria-pressed': String(m.vista === chiave),
      onclick: () => { m.vista = chiave; m.limite = PASSO; ridisegna(); },
    }, [el('span', { testo })]);
    return el('div', { class: 'interruttore', role: 'group', 'aria-label': 'Quali luoghi' }, [
      voce('sulla', `Sulla mappa (${dati.sulla})`),
      voce('senza', `Senza posizione (${dati.senza.length})`),
    ]);
  }

  function elenco() {
    const trovate = filtraSenza(dati.senza, { tipo: m.tipo, testo: m.testo });
    const righe = el('div', { class: 'senza-righe' }, trovate.slice(0, m.limite).map((v) => el('div', { class: 'senza-riga' }, [
      el('div', { class: 'senza-nomi' }, [
        el('div', { class: 'senza-nome', testo: v.nome }),
        v.dove ? el('div', { class: 'mini', testo: v.dove }) : null,
      ].filter(Boolean)),
      el('button', {
        class: 'btn btn-piccolo', type: 'button', testo: '📍 Dagli una posizione',
        'aria-label': `Dai una posizione a ${v.nome}`,
        onclick: () => { if (azioni.onPosiziona) azioni.onPosiziona(v); },
      }),
    ])));
    return el('div', {}, [
      trovate.length ? righe : el('div', { class: 'mini', style: 'margin-top:8px',
        testo: m.testo ? `Niente corrisponde a «${m.testo.trim()}».` : 'Qui non manca niente.' }),
      trovate.length > m.limite ? el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:8px',
        testo: `Mostra altri ${Math.min(PASSO, trovate.length - m.limite)} (di ${trovate.length - m.limite})`,
        onclick: () => { m.limite += PASSO; ridisegnaElenco(); },
      }) : null,
    ].filter(Boolean));
  }

  let contenitoreElenco = null;
  function ridisegnaElenco() {
    if (!contenitoreElenco) return;
    while (contenitoreElenco.firstChild) contenitoreElenco.removeChild(contenitoreElenco.firstChild);
    contenitoreElenco.append(elenco());
  }

  function ridisegna() {
    while (scelta.firstChild) scelta.removeChild(scelta.firstChild);
    scelta.append(sceltaVista());
    while (corpo.firstChild) corpo.removeChild(corpo.firstChild);
    if (m.vista !== 'senza') {
      corpo.append(el('div', { class: 'mini', style: 'margin-top:6px', testo: dati.senza.length
        ? `${dati.senza.length} fra impianti, aree, ubicazioni e presidi non hanno una posizione e non si `
          + 'vedono sulla mappa. «Senza posizione» li elenca, con il modo di dargliela.'
        : 'Tutto ha una posizione: si vede tutto sulla mappa.' }));
      return;
    }
    const tipi = el('div', { class: 'interruttore senza-tipi', role: 'group', 'aria-label': 'Che cosa' },
      [{ tipo: '', etichetta: 'Tutti' }, ...TIPI_SENZA].map((t) => {
        const n = t.tipo ? dati.senza.filter((v) => v.tipo === t.tipo).length : dati.senza.length;
        return el('button', {
          class: `interruttore-voce${m.tipo === t.tipo ? ' attiva' : ''}`, type: 'button',
          'aria-pressed': String(m.tipo === t.tipo),
          onclick: () => { m.tipo = t.tipo; m.limite = PASSO; ridisegna(); },
        }, [el('span', { testo: t.etichetta }), el('span', { class: 'interruttore-n', testo: String(n) })]);
      }));
    const cerca = el('input', {
      type: 'search', inputmode: 'search', autocomplete: 'off', enterkeyhint: 'search',
      placeholder: 'Cerca nome, progressivo, matricola, luogo…', 'aria-label': 'Cerca fra i senza posizione',
    });
    cerca.value = m.testo;
    cerca.addEventListener('input', () => { m.testo = cerca.value; m.limite = PASSO; ridisegnaElenco(); });
    contenitoreElenco = el('div', {});
    corpo.append(tipi, el('div', { class: 'cerca-riga', style: 'margin-top:8px' }, [cerca]), contenitoreElenco);
    ridisegnaElenco();
  }

  ridisegna();
  return { nodo, ridisegna };
}
