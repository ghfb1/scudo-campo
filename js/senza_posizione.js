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
import { cercaDelPresidio, corrispondeRicerca, nomePresidioMappa, normaRicerca } from './mappa.js';
import { dettaglioTipologia } from './nome_presidio.js';
import { propostaPer } from './posizioni_proposte.js';
import { posizioneVicina } from './ubicazione.js';

/**
 * Le parole in cui si cerca un PRESIDIO, oltre a nome ed etichetta: tipologia,
 * codice di categoria, i NOMI di impianto, area e ubicazione, e i dati del pezzo
 * di `cercaDelPresidio` (marca, modello, matricola dell'unità interna,
 * estinguente, installazione, gas). ⛔ UNA regola per le due barre (17/10/2026,
 * dall'operatore: «gli stessi parametri della barra in alto devono essere usati
 * anche in quella dei presidi da posizionare; alcuni campi non sono usati»):
 * la mappa (`puntiDellaMappa` in app.js) e l'elenco qui sotto la chiamano tutte
 * e due. Prima l'elenco cercava solo nel nome e nel luogo.
 */
export function chiaviRicercaPresidio(a) {
  const nome = (m, id) => ((m && m.get(id)) || {}).denominazione;
  return [dettaglioTipologia(a), a.categoria_codice, nome(S.indici.impianti, a.impianto_id),
    nome(S.indici.edifici, a.edificio_id), nome(S.indici.locali, a.locale_id), ...cercaDelPresidio(a)]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
}

/**
 * Le parole di un LUOGO oltre al suo nome: chi lo contiene (l'impianto di
 * un'area; impianto e area di un'ubicazione). Anche questa per le due barre.
 */
export function chiaviRicercaLuogo(tipo, riga) {
  if (!riga || tipo === 'impianto') return [];
  const nome = (m, id) => ((m && m.get(id)) || {}).denominazione;
  const ed = tipo === 'locale' ? S.indici.edifici.get(riga.edificio_id) : null;
  const impiantoId = riga.impianto_id || (ed && ed.impianto_id);
  return [nome(S.indici.impianti, impiantoId), ed && ed.denominazione].filter(Boolean);
}

/**
 * Da controllare o già controllato, per i filtri «⚑ solo da controllare» e
 * «✓ solo controllati» — gli stessi sulla mappa e nell'elenco:
 * * `daFare`: ha voci del giro ancora da eseguire (`vociDelGiro`), come il colore
 *   ambra della mappa;
 * * `controllato`: trattato nel giro e senza verifiche non eseguibili, cioè la
 *   vista «Fatti» dei Presidi (`S.controllato`, e i sospesi a parte).
 */
export function statoControlloPresidio(a) {
  return {
    daFare: S.vociDelGiro(a.id).mancanti.length > 0,
    controllato: S.controllato(a.id) && !S.conVerificheNonEseguibili(a.id),
  };
}

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
 * (ubicazione → area → impianto). Fino al 12/10/2026 la croce del
 * posizionamento a mano partiva da lì; adesso, dalla mappa, parte dal centro
 * di quello che si sta guardando (vedi `pannelloMappa` in app.js).
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

/** Quanto lontano dal presidio nasce la croce di un luogo (15/10/2026). */
export const METRI_DAL_PRESIDIO = 3;

/**
 * Da dove parte la croce per dare la posizione a un LUOGO (15/10/2026,
 * dall'operatore: «la crocetta deve partire dall'ubicazione di uno dei presidi
 * che usano quell'area, se presente, a 3 m di distanza da esso»): un presidio
 * che sta in quel luogo — l'ubicazione, l'area o l'impianto — e ha una
 * posizione; la croce nasce a `METRI_DAL_PRESIDIO` a nord di lui, non sopra, così
 * il presidio resta visibile e si capisce da dove si parte. Il primo per
 * progressivo, perché due aperture di fila partano dallo stesso posto.
 *
 * @returns `{ lat, lon, presidio }` o null (luogo senza presidi posizionati, o un
 *          presidio: per un presidio si parte da dove si guarda)
 */
export function partenzaDaPresidio(tipo, riga) {
  if (!riga || !['impianto', 'edificio', 'locale'].includes(tipo)) return null;
  const chiave = { impianto: 'impianto_id', edificio: 'edificio_id', locale: 'locale_id' }[tipo];
  const dentro = (S.get().perEntita[E.ASSET] || [])
    .filter((a) => !a.eliminato_il && a[chiave] === riga.id && S.haPosizione(a))
    .sort((x, y) => (S.numeroProgressivo(x.identificativo) ?? Infinity) - (S.numeroProgressivo(y.identificativo) ?? Infinity));
  if (!dentro.length) return null;
  const a = dentro[0];
  return { ...posizioneVicina(a.lat, a.lon, METRI_DAL_PRESIDIO), presidio: a };
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
      cerca: chiaviRicercaLuogo('edificio', e), riga: e, vicino: posizioneDelContenitore('edificio', e) });
  }
  for (const l of locali.values()) {
    if (S.haPosizione(l)) { sulla += 1; continue; }
    const ed = edifici.get(l.edificio_id);
    const impiantoId = l.impianto_id || (ed && ed.impianto_id);
    senza.push({ tipo: 'locale', id: l.id, nome: l.denominazione,
      dove: [nomeDi(impianti, impiantoId), ed ? ed.denominazione : ''].filter(Boolean).join(' › '),
      cerca: chiaviRicercaLuogo('locale', l), riga: l, vicino: posizioneDelContenitore('locale', l) });
  }
  for (const a of vivi(E.ASSET)) {
    if (S.haPosizione(a)) { sulla += 1; continue; }
    const cat = S.categoriaDi(a) || {};
    senza.push({ tipo: 'presidio', id: a.id,
      nome: nomePresidioMappa({ icona: cat.icona,
        categoria: [cat.descrizione || a.categoria_codice, dettaglioTipologia(a)].filter(Boolean).join(' · '),
        identificativo: a.identificativo, matricola: a.matricola }),
      dove: S.ubicazione(a), riga: a,
      // Come il punto della mappa: etichetta, le stesse chiavi, lo stesso stato.
      etichetta: a.identificativo || a.matricola || '', cerca: chiaviRicercaPresidio(a),
      ...statoControlloPresidio(a),
      vicino: posizioneDelContenitore('presidio', a) });
  }
  return { sulla, senza };
}

/**
 * Le voci di un tipo (o tutte) che corrispondono alla ricerca — con
 * `corrispondeRicerca`, la regola della barra della mappa: tutte le parole, in
 * qualunque ordine, fra nome, etichetta, chiavi (`cerca`) e il luogo scritto.
 * `controllo` ('' | 'DA_FARE' | 'CONTROLLATI') filtra i soli PRESIDI, come sulla
 * mappa: un'area non si controlla.
 */
export function filtraSenza(voci, { tipo = '', testo = '', controllo = '' } = {}) {
  return (voci || []).filter((v) => {
    if (tipo && v.tipo !== tipo) return false;
    if (v.tipo === 'presidio' && controllo === 'DA_FARE' && v.daFare !== true) return false;
    if (v.tipo === 'presidio' && controllo === 'CONTROLLATI' && v.controllato !== true) return false;
    return corrispondeRicerca({ nome: v.nome, etichetta: v.etichetta, cerca: [...(v.cerca || []), v.dove] }, testo);
  });
}

/** Le voci del filtro dei controlli, con le parole delle caselle della mappa. */
export const FILTRI_CONTROLLO = [
  { valore: '', etichetta: 'Tutti' },
  { valore: 'DA_FARE', etichetta: '⚑ Da controllare' },
  { valore: 'CONTROLLATI', etichetta: '✓ Controllati' },
];

const PASSO = 30;

/**
 * Il riquadro accanto alla mappa.
 *
 * @param dati    il risultato di `raccogliSenzaPosizione()`
 * @param azioni  `{ onPosiziona(voce), onElimina(voce), onApri(voce), onCerca(testo), onFiltroControllo(f) }`
 *   — `onApri` (il popup della mappa) solo per i presidi;
 *   — `onElimina` solo per i presidi; gli ultimi due dicono alla mappa quello che
 *   si scrive o si sceglie QUI (le due barre e i due filtri sono uno, 17/10/2026).
 * @param memoria un oggetto di chi apre la mappa (sopravvive ai ridisegni):
 *   `{ vista: 'sulla' | 'senza', tipo, testo, limite, controllo }`.
 * @returns `{ nodo, ridisegna, impostaTesto(t), impostaControllo(f) }` — i due
 *   ultimi per la mappa, che scrive qui quello che si scrive LÀ.
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
  m.controllo = m.controllo || '';
  let campoCerca = null;
  // I numeri dei pulsanti (tipi e controlli), da rifare a ogni lettera: vedi `aggiornaConti`.
  let conti = [];

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
    const trovate = filtraSenza(dati.senza, { tipo: m.tipo, testo: m.testo, controllo: m.controllo });
    // ⛔ Toccando il NOME di un presidio si apre il suo popup, quello della mappa
    // (17/10/2026, dall'operatore: «se ci clicchiamo ci mostra il popup che vedremmo
    // cliccando sulla mappa, con la scelta di andare al presidio, etc.»). Il nome è
    // un pulsante e i pulsanti accanto restano i loro: niente tocchi che fanno due cose.
    const nomi = (v) => {
      const figli = [
        el('div', { class: 'senza-nome', testo: v.nome }),
        v.dove ? el('div', { class: 'mini', testo: v.dove }) : null,
      ].filter(Boolean);
      return v.tipo === 'presidio' && azioni.onApri
        ? el('button', { class: 'senza-nomi senza-apri', type: 'button', 'aria-label': `Apri ${v.nome}`,
          onclick: () => azioni.onApri(v) }, figli)
        : el('div', { class: 'senza-nomi' }, figli);
    };
    const righe = el('div', { class: 'senza-righe' }, trovate.slice(0, m.limite).map((v) => el('div', { class: 'senza-riga' }, [
      nomi(v),
      el('div', { class: 'senza-azioni' }, [
        el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: '📍 Dagli una posizione',
          'aria-label': `Dai una posizione a ${v.nome}`,
          onclick: () => { if (azioni.onPosiziona) azioni.onPosiziona(v); },
        }),
        // Il cestino solo sui PRESIDI (12/10/2026, dall'operatore: «serve anche
        // un pulsante cestino per eliminare quei presidi, come se cancellassimo
        // la riga»). Un luogo si elimina dall'albero dei Luoghi, con le sue
        // regole su chi ci sta dentro. Anche qui non si scrive niente: decide e
        // scrive l'app, con motivo e conferma.
        v.tipo === 'presidio' && azioni.onElimina ? el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: '🗑️',
          title: `Togli la riga di ${v.nome}`, 'aria-label': `Togli la riga di ${v.nome}`,
          onclick: () => azioni.onElimina(v),
        }) : null,
      ].filter(Boolean)),
    ])));
    return el('div', {}, [
      trovate.length ? righe : el('div', { class: 'mini', style: 'margin-top:8px',
        testo: m.testo ? `Niente corrisponde a «${m.testo.trim()}»${m.controllo ? ' con questo filtro' : ''}.`
          : (m.controllo ? 'Nessun presidio senza posizione con questo filtro.' : 'Qui non manca niente.') }),
      trovate.length > m.limite ? el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:8px',
        testo: `Mostra altri ${Math.min(PASSO, trovate.length - m.limite)} (di ${trovate.length - m.limite})`,
        onclick: () => { m.limite += PASSO; ridisegnaElenco(); },
      }) : null,
    ].filter(Boolean));
  }

  /**
   * ⛔ Ogni numero di un pulsante è QUANTE RIGHE si vedrebbero toccandolo, con la
   * ricerca e gli altri filtri di adesso (17/10/2026, dall'operatore: «ne vedo 40
   * da controllare ma il selettore mostra 183»). Prima contavano tutti i senza
   * posizione, ricerca ignorata. Si rifanno a ogni lettera senza rifare i pulsanti:
   * rifarli toglierebbe il fuoco dal campo.
   */
  const contaSe = (filtri) => filtraSenza(dati.senza, { tipo: m.tipo, testo: m.testo, controllo: m.controllo, ...filtri }).length;
  function aggiornaConti() {
    for (const c of conti) c.nodo.textContent = String(contaSe(c.filtri));
  }

  let contenitoreElenco = null;
  function ridisegnaElenco() {
    if (!contenitoreElenco) return;
    while (contenitoreElenco.firstChild) contenitoreElenco.removeChild(contenitoreElenco.firstChild);
    contenitoreElenco.append(elenco());
    aggiornaConti();
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
    conti = [];
    const numero = (filtri) => {
      const nodo = el('span', { class: 'interruttore-n' });
      conti.push({ nodo, filtri });
      return nodo;
    };
    const tipi = el('div', { class: 'interruttore senza-tipi', role: 'group', 'aria-label': 'Che cosa' },
      [{ tipo: '', etichetta: 'Tutti' }, ...TIPI_SENZA].map((t) => el('button', {
        class: `interruttore-voce${m.tipo === t.tipo ? ' attiva' : ''}`, type: 'button',
        'aria-pressed': String(m.tipo === t.tipo),
        onclick: () => { m.tipo = t.tipo; m.limite = PASSO; ridisegna(); },
      }, [el('span', { testo: t.etichetta }), numero({ tipo: t.tipo })])));
    // ⛔ Il filtro dei controlli (17/10/2026, dall'operatore: «anche il filtro
    // "solo quelli da controllare" deve funzionare in quelli da posizionare, e ci
    // vuole anche quello per vedere solo i controllati»). È LO STESSO delle caselle
    // della mappa: cambiato qui, cambia là, e viceversa. Solo dove ci sono presidi.
    const filtroControllo = !m.tipo || m.tipo === 'presidio'
      ? el('div', { class: 'interruttore senza-controllo', role: 'group', 'aria-label': 'Quali presidi' },
        FILTRI_CONTROLLO.map((f) => el('button', {
          class: `interruttore-voce${m.controllo === f.valore ? ' attiva' : ''}`, type: 'button',
          'aria-pressed': String(m.controllo === f.valore),
          onclick: () => {
            if (m.controllo === f.valore) return;
            m.controllo = f.valore; m.limite = PASSO; ridisegna();
            if (azioni.onFiltroControllo) azioni.onFiltroControllo(f.valore);
          },
        }, [el('span', { class: 'interruttore-testo', testo: f.etichetta }), numero({ controllo: f.valore })])))
      : null;
    const cerca = el('input', {
      type: 'search', inputmode: 'search', autocomplete: 'off', enterkeyhint: 'search',
      placeholder: 'Cerca matricola, progressivo, categoria, luogo…', 'aria-label': 'Cerca fra i senza posizione',
    });
    cerca.value = m.testo;
    cerca.addEventListener('input', () => {
      m.testo = cerca.value; m.limite = PASSO; ridisegnaElenco();
      if (azioni.onCerca) azioni.onCerca(m.testo);
    });
    campoCerca = cerca;
    contenitoreElenco = el('div', {});
    corpo.append(...[tipi, filtroControllo, el('div', { class: 'cerca-riga', style: 'margin-top:8px' }, [cerca]),
      contenitoreElenco].filter(Boolean));
    ridisegnaElenco();
  }

  ridisegna();
  return {
    nodo,
    ridisegna,
    /** Il testo scritto nella barra della MAPPA: filtra anche qui. */
    impostaTesto(t) {
      const testo = String(t ?? '');
      if (testo === m.testo) return;
      m.testo = testo;
      m.limite = PASSO;
      // Il campo è in pagina solo nella vista «Senza posizione»; se c'è e non è
      // quello in cui si sta scrivendo, si aggiorna senza rifarlo (il fuoco resta).
      if (campoCerca && campoCerca.isConnected !== false && m.vista === 'senza') campoCerca.value = testo;
      if (m.vista === 'senza') ridisegnaElenco();
    },
    /** Il filtro scelto sulla MAPPA: '' | 'DA_FARE' | 'CONTROLLATI'. */
    impostaControllo(f) {
      const v = f || '';
      if (v === m.controllo) return;
      m.controllo = v;
      m.limite = PASSO;
      if (m.vista === 'senza') ridisegna();
    },
  };
}

/**
 * Gli impianti dal più vicino al più lontano rispetto a un punto: `[{ impianto, d }]`
 * (metri). Solo quelli con una posizione, anche solo PROPOSTA (sulla mappa c'è).
 *
 * Serve a «➕ aggiungi» della mappa (12/10/2026, dall'operatore: un'area o
 * un'ubicazione nuova «deve di default andare sotto l'impianto più vicino»).
 * Nessun raggio massimo: la richiesta è il più vicino, e la scelta resta
 * modificabile nel modulo, dove la distanza è scritta accanto al nome.
 */
export function impiantiPerDistanza(punto) {
  // ⚠️ `S.haPosizione` e non `Number.isFinite`: `Number('')` vale 0, e un punto
  // vuoto diventava (0, 0) con venticinque «impianti vicini» (misurato).
  if (!S.haPosizione(punto)) return [];
  const la = Number(punto.lat); const lo = Number(punto.lon);
  return (S.get().perEntita[E.IMPIANTO] || []).filter((i) => !i.eliminato_il)
    .map((i) => ({ impianto: i, pos: posizioneImpianto(i) }))
    .filter((x) => x.pos)
    .map((x) => ({ impianto: x.impianto, d: S.distanzaMetri({ lat: la, lon: lo }, x.pos) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((x, y) => x.d - y.d);
}

/**
 * L'area dell'impianto più vicina a un punto, per proporla a un'UBICAZIONE nuova:
 * `{ edificio, d }` o null.
 *
 * Le aree con una posizione propria sono poche: vale anche la posizione dei
 * PRESIDI che ci stanno dentro (sono molti, e stanno dove sta l'area). È la
 * stessa idea di `S.luogoPiuVicino`, che propone il luogo del presidio vicino.
 */
export function areaPiuVicina(punto, impiantoId) {
  if (!impiantoId || !S.haPosizione(punto)) return null;
  const la = Number(punto.lat); const lo = Number(punto.lon);
  const st = S.get();
  const aree = (st.perEntita[E.EDIFICIO] || []).filter((e) => !e.eliminato_il && e.impianto_id === impiantoId);
  const presidi = (st.perEntita[E.ASSET] || []).filter((a) => !a.eliminato_il && S.haPosizione(a));
  let meglio = null;
  for (const e of aree) {
    const posti = [e, ...presidi.filter((a) => a.edificio_id === e.id)].filter((r) => S.haPosizione(r));
    for (const r of posti) {
      const d = S.distanzaMetri({ lat: la, lon: lo }, r);
      if (Number.isFinite(d) && (!meglio || d < meglio.d)) meglio = { edificio: e, d };
    }
  }
  return meglio;
}
