/**
 * L'albero delle ubicazioni in PDF (15/10/2026, dall'operatore: «fa in modo che
 * l'alberatura di ogni impianto, o di ogni area, compresi o no i presidi, possa
 * essere stampata in pdf, con i dati che vediamo in modalità sposta»).
 *
 * Gli stessi dati della modalità «Sposta», dalle stesse funzioni:
 *  * i luoghi da `S.alberoUbicazioni()` — impianto › area › ubicazione, con quanti
 *    presidi ha ciascuno e il piano dell'ubicazione;
 *  * i presidi da `S.presidiDelLuogo()` e `presidioInAlbero()` (sposta.js) — che
 *    cosa è (categoria e tipologia), quale (matricola e progressivo) e la
 *    quantità. Sotto un'area quelli che un'ubicazione non ce l'hanno, sotto
 *    l'impianto quelli senza area: come nell'albero.
 *
 * Due funzioni, come gli altri PDF: `datiAlbero` decide (si prova in Node senza
 * leggere il PDF), `pdfAlbero` scrive. Solo lettura: niente nel rilievo, nel
 * giornale o nel lavoro da esportare. Le emoji non entrano in un PDF scritto con
 * i caratteri standard (WinAnsi): il livello si dice a parole e con il rientro.
 */
import * as S from './stato.js';
import { E } from './pacchetto.js';
import { A4, aCapo, nuovoDocumento } from './pdf.js';
import { LARGA, M, RIGA, dataIt, penna } from './verbale.js';
import { ordinePresidiInAlbero, presidioInAlbero } from './sposta.js';

export const LIVELLO = { impianto: 'Impianto', edificio: 'Area', locale: 'Ubicazione' };
const RIENTRO = 14;   // punti di rientro per ogni livello dell'albero

/**
 * I nodi da stampare, in ordine, già appiattiti: `{ tipo, livello, nome,
 * dettaglio, presidi, presidio? }`. Il presidio porta i campi di
 * `presidioInAlbero` (nome, dettaglio, quantita).
 *
 * @param impiantoId  l'impianto; vuoto = tutti
 * @param edificioId  un'area di quell'impianto; vuoto = tutto l'impianto
 * @param conPresidi  anche i presidi, sotto il loro luogo
 */
export function datiAlbero({ impiantoId = '', edificioId = '', conPresidi = true } = {}) {
  const radici = S.alberoUbicazioni().filter((n) => !impiantoId || n.id === impiantoId);
  const righe = [];
  const totali = { impianti: 0, aree: 0, ubicazioni: 0, presidi: 0, pezzi: 0 };
  const conta = { impianto: 'impianti', edificio: 'aree', locale: 'ubicazioni' };
  const presidiDi = (nodo, livello) => {
    if (!conPresidi) return;
    // Per tipo, poi per progressivo (`ordinePresidiInAlbero`, come nei due alberi).
    const presidi = S.presidiDelLuogo(nodo.tipo, nodo.id).map((a) => presidioInAlbero(a, S.categoriaDi(a)))
      .sort(ordinePresidiInAlbero);
    for (const p of presidi) righe.push({ tipo: 'presidio', livello, presidio: p });
  };
  const visita = (nodo, livello) => {
    righe.push({ tipo: nodo.tipo, livello, nome: nodo.nome, dettaglio: nodo.dettaglio || '', presidi: nodo.presidi || 0 });
    totali[conta[nodo.tipo]] += 1;
    // I presidi DOPO i luoghi figli, come nell'albero di «Sposta»: sono quelli che
    // stanno in questo luogo e non in uno più stretto.
    for (const f of nodo.figli || []) visita(f, livello + 1);
    presidiDi(nodo, livello + 1);
  };
  let area = null;
  for (const imp of radici) {
    if (edificioId) {
      area = (imp.figli || []).find((f) => f.tipo === 'edificio' && f.id === edificioId) || null;
      if (area) visita(area, 0);
    } else visita(imp, 0);
  }
  // I presidi e i pezzi dell'ambito, contati sull'anagrafica e non sulle righe:
  // valgono anche senza i presidi nel foglio.
  const nelPerimetro = (a) => !a.eliminato_il && (!impiantoId || a.impianto_id === impiantoId)
    && (!edificioId || a.edificio_id === edificioId);
  for (const a of S.get().perEntita[E.ASSET] || []) {
    if (!nelPerimetro(a)) continue;
    totali.presidi += 1;
    const q = Number(a.quantita);
    totali.pezzi += Number.isFinite(q) && String(a.quantita ?? '').trim() !== '' ? q : 1;
  }
  const imp = impiantoId ? S.indici.impianti.get(impiantoId) : null;
  return {
    filtri: { impiantoId, edificioId, conPresidi,
      impianto: imp ? imp.denominazione : '', area: area ? area.nome : '' },
    righe, totali,
  };
}

/** «Impianto ACCIAIOLO · area Box di stallo», o «tutti gli impianti». */
function ambitoAParole(f) {
  if (!f.impianto) return 'tutti gli impianti';
  return `impianto ${f.impianto}${f.area ? ` · area ${f.area}` : ''}`;
}

export function pdfAlbero(dati, { versione = '', adesso = new Date().toISOString(), codice = '' } = {}) {
  const f = dati.filtri;
  const titolo = `Albero delle ubicazioni — ${ambitoAParole(f)}`;
  const doc = nuovoDocumento({ titolo, autore: 'Scudo Campo' });
  const p = penna(doc, { testata: titolo, destra: f.conPresidi ? 'con i presidi' : 'senza i presidi', onPagina: () => {} });
  p.nuovaPagina();
  p.paragrafo('ALBERO DELLE UBICAZIONI', { corpo: 15, grassetto: true, dopo: 2 });
  p.paragrafo(`${ambitoAParole(f).replace(/^./, (c) => c.toUpperCase())} · ${f.conPresidi ? 'con i presidi' : 'senza i presidi'}`
    + ` · stampato il ${dataIt(adesso)}${codice ? ` · pacchetto ${codice}` : ''}`, { corpo: 9, grigio: 0.35, dopo: 8 });
  const t = dati.totali;
  const n = (x, uno, tanti) => `${x} ${x === 1 ? uno : tanti}`;
  p.riquadro([
    [f.edificioId ? '' : n(t.impianti, 'impianto', 'impianti'), n(t.aree, 'area', 'aree'), n(t.ubicazioni, 'ubicazione', 'ubicazioni'),
      `${n(t.presidi, 'presidio', 'presidi')} (${t.pezzi} pz)`].filter(Boolean).join(' · '),
    // «>» e non «›»: il secondo non è nei caratteri WinAnsi e usciva «?».
    'Impianto > area > ubicazione, con il rientro. Accanto a ogni luogo quanti presidi contiene in tutto; '
      + (f.conPresidi ? 'sotto, i presidi che stanno proprio lì: che cosa sono, matricola e progressivo, quantità.'
        : 'i presidi non sono elencati.'),
  ]);
  if (!dati.righe.length) p.paragrafo('Niente da stampare con queste scelte.', { grigio: 0.4 });
  // ⛔ Ogni LUOGO è una FASCIA, il presidio è testo semplice (15/10/2026,
  // dall'operatore: «le ubicazioni si confondono visivamente con i presidi, anche
  // se sono sfalsati»). Con il solo rientro due righe di testo si somigliavano;
  // adesso il livello si riconosce dal fondo, prima di leggere:
  //  * impianto: fascia SCURA, testo bianco;
  //  * area: fascia grigia, grassetto;
  //  * ubicazione: fascia chiara con una barra scura a sinistra;
  //  * presidio: niente fondo, corpo piccolo, sotto la sua fascia.
  const STILE = {
    impianto: { corpo: 11, fondo: 0.3, testo: 1, grassetto: true, barra: null, prima: 10 },
    edificio: { corpo: 10, fondo: 0.8, testo: 0, grassetto: true, barra: 0.4, prima: 7 },
    locale: { corpo: 9, fondo: 0.94, testo: 0, grassetto: true, barra: 0.55, prima: 4 },
  };
  const fascia = (testo, st, rientro) => {
    const x = M + rientro; const w = LARGA - rientro; const pad = st.barra === null ? 6 : 8;
    const righe = aCapo(testo, st.grassetto, st.corpo, w - pad - 4);
    const alt = righe.length * st.corpo * RIGA + 6;
    p.spazio(alt + st.prima + 12);   // la fascia non resta sola in fondo alla pagina
    p.y += st.prima;
    doc.rettangolo(x, p.y, w, alt, { riempi: st.fondo, bordo: 0 });
    if (st.barra !== null) doc.rettangolo(x, p.y, 3, alt, { riempi: st.barra, bordo: 0 });
    let yr = p.y + 3;
    for (const riga of righe) {
      doc.testo(x + pad, yr + st.corpo, riga, { corpo: st.corpo, grassetto: st.grassetto, grigio: st.testo });
      yr += st.corpo * RIGA;
    }
    p.y += alt + 3;
  };
  for (const r of dati.righe) {
    const rientro = Math.min(r.livello, 4) * RIENTRO;
    if (r.tipo === 'presidio') {
      const x = r.presidio;
      p.paragrafo(`- ${[x.nome, x.dettaglio, x.quantita].filter(Boolean).join(' · ')}`,
        { corpo: 8, grigio: 0.15, dopo: 1.5, rientro: rientro + 2 });
      continue;
    }
    // Un impianto da pagina nuova, quando nel foglio ce n'è più d'uno: si sfoglia.
    if (r.tipo === 'impianto' && r.livello === 0 && dati.totali.impianti > 1 && p.y > 140) p.nuovaPagina();
    fascia(`${LIVELLO[r.tipo]}: ${r.nome}${r.dettaglio ? ` (${r.dettaglio})` : ''} — `
      + `${r.presidi ? n(r.presidi, 'presidio', 'presidi') : 'nessun presidio'}`, STILE[r.tipo], rientro);
  }
  const pagine = doc.numeroPagine;
  for (let k = 1; k <= pagine; k += 1) {
    doc.suPagina(k);
    doc.linea(M, A4.altezza - 34, M + LARGA, A4.altezza - 34, { grigio: 0.7 });
    doc.testo(M, A4.altezza - 22, `Scudo Campo ${versione} · ${titolo} · stampato il ${dataIt(adesso)}`, { corpo: 7, grigio: 0.4 });
    doc.testo(M + LARGA - 62, A4.altezza - 22, `foglio ${k} di ${pagine}`, { corpo: 7, grigio: 0.4 });
  }
  return doc.bytes();
}

/** «Albero delle ubicazioni - ACCIAIOLO - con i presidi - 15-10-2026.pdf». */
export function nomeFileAlbero(dati, adesso = new Date().toISOString()) {
  const f = dati.filtri;
  return `Albero delle ubicazioni - ${f.impianto || 'tutti gli impianti'}${f.area ? ` - ${f.area}` : ''} - `
    + `${f.conPresidi ? 'con i presidi' : 'senza i presidi'} - ${dataIt(String(adesso).slice(0, 10)).replace(/\//g, '-')}.pdf`
    .replace(/[\\/:*?"<>|]+/g, '-');
}
