/**
 * Scudo Campo — i climatizzatori per gas refrigerante, nella scheda Dati
 * (17/10/2026).
 *
 * Dall'operatore: «nella scheda dati dobbiamo mostrare una sezione dei clima con
 * grafici a torta e barre col tipo di gas e quantitativi / numero di clima con
 * tipologia gas». È la «Ripartizione gas» di ClimaTrack (`aggrega_gas` in
 * `backend/app/routers/climatrack_gas.py`, `RipartizioneGas.js`), fatta sui dati
 * del pacchetto: le regole sono le sue, perché due totali diversi per la stessa
 * flotta farebbero chiedere quale dei due sia vero.
 *
 * * si contano i climatizzatori IN SERVIZIO: un dismesso (anche «dismesso e
 *   sostituito») non ha più gas a bordo, ed è escluso come in ClimaTrack. La
 *   regola è `idoneita` (stato.js), una sola per tutta l'app;
 * * un gas vuoto è «Non specificato»; un gas scritto in un altro modo («R410A»,
 *   «r-410a») si riconduce al nome del catalogo, perché è lo stesso gas;
 * * t CO₂eq = carica × GWP ÷ 1000, unità per unità al centesimo (`tco2eq` di
 *   clima.js, gemello del conto dell'ufficio), poi sommate. Un gas fuori
 *   catalogo non ha un GWP: conta nel numero e nei kg, non nelle t CO₂eq, e la
 *   scheda lo dice.
 *
 * Solo lettura: niente qui scrive nel rilievo.
 */
import * as S from './stato.js';
import { E } from './pacchetto.js';
import { el, ciambella, sceltaCercabile } from './ui.js';
import { GWP, tco2eq } from './clima.js';
import { numeroDecimale } from './calcoli.js';

export const NON_SPECIFICATO = 'Non specificato';

/** Il gas come lo scrive il catalogo, o com'è scritto se il catalogo non lo conosce. */
const chiaveGas = (v) => String(v || '').replace(/[^0-9a-z]/gi, '').toUpperCase();
const PER_CHIAVE = new Map(Object.keys(GWP).map((g) => [chiaveGas(g), g]));
export function nomeGas(v) {
  const t = String(v ?? '').trim();
  if (!t) return NON_SPECIFICATO;
  return PER_CHIAVE.get(chiaveGas(t)) || t;
}

/**
 * Il colore di un gas. ⛔ Segue il GAS, non il suo posto in classifica: filtrando
 * per impianto l'R-32 resta dello stesso colore anche se diventa il primo. Gli
 * otto colori vanno ai gas del catalogo nel suo ordine (validati per il
 * daltonismo, in chiaro e in scuro: `--gas-1…8` in styles.css); il resto è grigio,
 * e il nome nella legenda lo distingue.
 */
export function coloreGas(gas) {
  const i = Object.keys(GWP).indexOf(gas);
  return i >= 0 && i < 8 ? `var(--gas-${i + 1})` : 'var(--gas-altro)';
}

const tipoClima = (a) => S.tipoAssetDi(a) === 'CLIMATIZZATORE';
const dismesso = (a) => S.idoneita(a).stato === 'DISMESSO';
const centesimi = (n) => Math.round(n * 100) / 100;

/**
 * I climatizzatori del pacchetto, per gas.
 *
 * @param assets     le righe dei presidi (anche non clima: si filtrano qui)
 * @param impiantoId un impianto, o '' per tutti
 * @returns `{ totali: { n_unita, carica_kg, tco2eq, senza_carica, fuori_catalogo },
 *   per_gas: [{ gas, n_unita, carica_kg, tco2eq, gwp, senza_carica }], dismessi }`,
 *   `per_gas` dal gas con più climatizzatori.
 */
export function ripartizioneGas(assets, { impiantoId = '' } = {}) {
  const clima = (assets || []).filter((a) => a && !a.eliminato_il && tipoClima(a)
    && (!impiantoId || a.impianto_id === impiantoId));
  const dismessi = clima.filter(dismesso).length;
  const perGas = new Map();
  const totali = { n_unita: 0, carica_kg: 0, tco2eq: 0, senza_carica: 0, fuori_catalogo: 0 };
  for (const a of clima) {
    if (dismesso(a)) continue;
    const gas = nomeGas(a.gas_refrigerante);
    const gwp = GWP[gas] ?? null;
    if (!perGas.has(gas)) perGas.set(gas, { gas, n_unita: 0, carica_kg: 0, tco2eq: 0, gwp, senza_carica: 0 });
    const b = perGas.get(gas);
    b.n_unita += 1;
    totali.n_unita += 1;
    if (gas !== NON_SPECIFICATO && gwp === null) totali.fuori_catalogo += 1;
    const kg = numeroDecimale(a.carica_refrigerante_kg);
    if (kg === null || kg <= 0) {
      b.senza_carica += 1;
      totali.senza_carica += 1;
      continue;
    }
    b.carica_kg += kg;
    totali.carica_kg += kg;
    const t = Number(tco2eq(gas, kg) || 0);
    b.tco2eq += t;
    totali.tco2eq += t;
  }
  const per_gas = [...perGas.values()]
    .map((b) => ({ ...b, carica_kg: centesimi(b.carica_kg), tco2eq: centesimi(b.tco2eq) }))
    .sort((x, y) => y.n_unita - x.n_unita || y.carica_kg - x.carica_kg || x.gas.localeCompare(y.gas));
  totali.carica_kg = centesimi(totali.carica_kg);
  totali.tco2eq = centesimi(totali.tco2eq);
  return { totali, per_gas, dismessi };
}

/** «12,5»: la virgola, al massimo due decimali. */
export function numeroIt(n) {
  return (Number(n) || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

/**
 * Barre orizzontali, una per gas, nel colore del gas. Le classi sono quelle di
 * `barreImpilate` (ui.js), quindi l'aspetto è lo stesso degli altri grafici; non
 * la si riusa perché lì il colore è della SERIE, e qui ogni riga è un gas.
 */
function barreGas(righe, { valore, testo, sotto }) {
  const cima = Math.max(0, ...righe.map(valore));
  return el('ul', { class: 'grafico-barre grafico-gas' }, righe.map((r) => {
    const v = valore(r);
    return el('li', {}, [
      el('div', { class: 'barra-corpo' }, [
        el('div', { class: 'barra-riga' }, [
          el('span', { class: 'legenda-pallino', style: `background:${coloreGas(r.gas)}` }),
          el('span', { class: 'barra-etichetta', testo: r.gas }),
          el('b', { class: 'barra-numero', testo: testo(r) }),
        ]),
        el('div', { class: 'barra-esterna' }, [
          el('div', { class: 'barra-piena', style: `width:${cima > 0 ? (v / cima) * 100 : 0}%` }, [
            el('div', { class: 'barra-quota', style: `flex:0 0 100%;background:${coloreGas(r.gas)}`,
              title: `${r.gas}: ${testo(r)}` }),
          ]),
        ]),
        el('div', { class: 'mini', testo: sotto(r) }),
      ]),
    ]);
  }));
}

/** La tabella: gli stessi numeri da leggere, con la percentuale e il GWP. */
function tabellaGas({ totali, per_gas }) {
  const riga = (celle, classe = '') => el('tr', { class: classe }, celle.map((c, i) => el(i ? 'td' : 'th', { testo: c })));
  return el('div', { class: 'tabella-gas-scorre' }, [
    el('table', { class: 'tabella-gas' }, [
      el('thead', {}, [el('tr', {}, ['Gas', 'Clima', 'kg', 't CO₂eq', '%', 'GWP'].map((h) => el('th', { testo: h })))]),
      el('tbody', {}, [
        ...per_gas.map((g) => riga([g.gas, String(g.n_unita), numeroIt(g.carica_kg), numeroIt(g.tco2eq),
          `${numeroIt(totali.n_unita ? (g.n_unita / totali.n_unita) * 100 : 0)}%`, g.gwp === null ? '—' : String(g.gwp)])),
        riga(['Totale', String(totali.n_unita), numeroIt(totali.carica_kg), numeroIt(totali.tco2eq), '100%', '—'],
          'tabella-gas-totale'),
      ]),
    ]),
  ]);
}

/** Il corpo della scheda per un impianto (o tutti): grafici, tabella, note. */
export function corpoGasClima(dati) {
  const { totali, per_gas: perGas, dismessi } = dati;
  if (!totali.n_unita) {
    return el('div', { class: 'mini', testo: dismessi
      ? `Nessun climatizzatore in servizio qui (${dismessi} dismess${dismessi === 1 ? 'o' : 'i'}).`
      : 'Nessun climatizzatore qui.' });
  }
  const note = [];
  if (totali.senza_carica) {
    note.push(`${totali.senza_carica} ${totali.senza_carica === 1 ? 'climatizzatore non ha' : 'climatizzatori non hanno'} `
      + 'la carica scritta: contano nel numero, non nei kg né nelle t CO₂eq.');
  }
  if (totali.fuori_catalogo) {
    note.push(`${totali.fuori_catalogo} con un gas fuori catalogo: senza GWP le t CO₂eq non si calcolano.`);
  }
  if (dismessi) note.push(`Esclus${dismessi === 1 ? 'o' : 'i'} ${dismessi} dismess${dismessi === 1 ? 'o' : 'i'}, come in ClimaTrack.`);
  return el('div', { class: 'gas-clima' }, [
    el('h3', { testo: 'Quanti climatizzatori, per gas' }),
    ciambella(perGas.map((g) => ({ valore: g.n_unita, etichetta: g.gas, colore: coloreGas(g.gas) })),
      { numero: totali.n_unita, testo: 'climatizzatori' }),
    el('h3', { testo: 'Quanto gas, per tipo' }),
    el('div', { class: 'mini', style: 'margin:-2px 0 8px',
      testo: `${numeroIt(totali.carica_kg)} kg in tutto · ${numeroIt(totali.tco2eq)} t CO₂eq. `
        + 'La barra è la carica in kg; sotto, le t CO₂eq (carica × GWP ÷ 1000).' }),
    barreGas(perGas, {
      valore: (g) => g.carica_kg,
      testo: (g) => `${numeroIt(g.carica_kg)} kg`,
      sotto: (g) => `${numeroIt(g.tco2eq)} t CO₂eq · ${g.n_unita} clima`
        + (g.senza_carica ? ` (${g.senza_carica} senza carica)` : ''),
    }),
    el('h3', { testo: 'In tabella' }),
    tabellaGas(dati),
    ...note.map((t) => el('div', { class: 'mini', style: 'margin-top:6px', testo: t })),
  ]);
}

/**
 * La scheda intera, con la scelta dell'impianto: cambiarlo ridisegna solo il
 * corpo. `null` se nel pacchetto non c'è nessun climatizzatore: una scheda vuota
 * su un giro solo antincendio sarebbe una domanda senza risposta.
 */
export function schedaGasClima() {
  const assets = S.get().perEntita[E.ASSET] || [];
  const clima = assets.filter((a) => a && !a.eliminato_il && tipoClima(a));
  if (!clima.length) return null;
  const nomeImpianto = (id) => (S.indici.impianti.get(id) || {}).denominazione || '';
  const impianti = [...new Set(clima.map((a) => a.impianto_id).filter((id) => id && nomeImpianto(id)))]
    .sort((x, y) => nomeImpianto(x).localeCompare(nomeImpianto(y)));
  // La scelta con la RICERCA (`sceltaCercabile`), non una tendina: gli impianti
  // sono una trentina, e la ruota di sistema sul telefono si scorre alla cieca.
  // Fra parentesi quanti climatizzatori ha ciascuno, dismessi compresi.
  const quanti = (id) => clima.filter((a) => !id || a.impianto_id === id).length;
  const TUTTI = '*';
  const corpo = el('div', {}, [corpoGasClima(ripartizioneGas(assets))]);
  const scelta = sceltaCercabile({
    voci: [{ valore: TUTTI, testo: `Tutti gli impianti (${quanti('')})` },
      ...impianti.map((id) => ({ valore: id, testo: `${nomeImpianto(id)} (${quanti(id)})` }))],
    valore: TUTTI, placeholder: 'Scrivi il nome dell\'impianto…', nomeVoci: 'impianti',
    onCambia: (v) => {
      while (corpo.firstChild) corpo.removeChild(corpo.firstChild);
      corpo.append(corpoGasClima(ripartizioneGas(assets, { impiantoId: v === TUTTI ? '' : v })));
    },
  });
  return el('div', { class: 'card scheda-gas-clima' }, [
    el('h2', { style: 'margin-top:0', testo: '❄️ Climatizzatori: gas refrigerante' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo: 'I climatizzatori in servizio per tipo di gas: '
      + 'quanti sono, quanti kg di gas hanno a bordo e le t CO₂ equivalenti. Gli stessi conti della «Ripartizione '
      + 'gas» di ClimaTrack, sui dati di questo telefono: una carica corretta qui si vede subito.' }),
    scelta.nodo,
    corpo,
  ]);
}
