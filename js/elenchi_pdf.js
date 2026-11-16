/**
 * Anomalie e punti aperti in un PDF da portare sul posto (09/10/2026, dall'operatore:
 * «per le anomalie e per i punti aperti la possibilità di estrarre un pdf — solo
 * clima, solo antincendio, o entrambi —, diviso per impianto e per tipologia; un
 * pdf utile sul campo, pratico da consultare per prendere appunti, aggiornarli,
 * vedere il riepilogo per tipologia e impianto e le varie note»).
 *
 * Che cosa c'è, e perché in quest'ordine:
 *  * il FRONTESPIZIO con i numeri: per impianto (con il foglio da cui comincia, così
 *    si sfoglia) e per tipologia. È la pagina che si guarda prima di partire;
 *  * un capitolo per IMPIANTO, da pagina nuova: le anomalie divise per tipologia,
 *    poi i punti aperti divisi per tema. Ogni riga ha una CASELLA da spuntare quando
 *    la cosa è verificata sul posto, e una colonna vuota per scrivere se è risolta — il foglio serve a prendere appunti, e
 *    una riga alta quanto il suo testo non lascia lo spazio per farlo;
 *  * in fondo a ogni impianto un riquadro di APPUNTI a righe, per ciò che non sta
 *    in nessuna riga (una cosa nuova vista sul posto).
 *
 * Il tema di un'anomalia è quello del suo presidio: climatizzatore = clima, il
 * resto = antincendio. Il tema di un punto aperto è il suo (`S.temaPunto`).
 *
 * Solo lettura: niente nel rilievo, nel giornale o nel lavoro da esportare.
 * Scritto con la penna del verbale (`verbale.js`): stesso impaginatore, stessi
 * a capo, stesse tabelle che vanno a pagina nuova ripetendo l'intestazione.
 */
import * as S from './stato.js';
import { E } from './pacchetto.js';
import { A4, nuovoDocumento } from './pdf.js';
import { FONDO, LARGA, M, dataIt, nomePezzo, penna } from './verbale.js';

export const TEMI = { ANTINCENDIO: 'Antincendio', CLIMA: 'Climatizzatori' };
const STATI_APERTI_ANOMALIA = ['APERTA', 'IN_CORSO'];
const SENZA_IMPIANTO = 'Senza impianto (archivio o stazioni fuori da Scudo)';

/** Il tema di un'anomalia: quello del suo presidio. */
export function temaAnomalia(an) {
  const a = an && S.indici.assets.get(an.asset_id);
  return a && S.tipoAssetDi(a) === 'CLIMATIZZATORE' ? 'CLIMA' : 'ANTINCENDIO';
}

const impedisce = (n) => `${n} ${n === 1 ? 'impedisce' : 'impediscono'} l'uso`;
// Le frasi che il seme ha fatto CONFLUIRE in un'anomalia o in un punto aperto da
// altre righe del censimento (`scudo-seed`: «il testo dell'altro vi confluisce alla
// lettera»). Parlano di ALTRI presidi: nel foglio vanno in un elenco a parte,
// non attaccate al difetto come se fossero il suo dettaglio (09/10/2026,
// dall'operatore: «non c'entra nulla centralina con carrellati»).
const SEGNO_CONFLUITO = /^(Dal censimento( 2026)?|Assente|Dal foglio DA VERIFICARE IN CAMPO|Da verificare):\s*/;
export function separaConfluiti(testo, separatore) {
  const pezzi = String(testo || '').split(separatore).map((x) => x.trim()).filter(Boolean);
  return { proprio: pezzi.filter((x) => !SEGNO_CONFLUITO.test(x)), confluiti: pezzi.filter((x) => SEGNO_CONFLUITO.test(x)) };
}
/** Il testo di un punto aperto: la frase sua, poi le righe «Dal censimento 2026: a; b» una per una. */
export function separaPuntoAperto(testo) {
  const t = String(testo || '').trim();
  const i = t.indexOf(' Dal censimento 2026: ');
  if (i < 0) return { proprio: t, confluiti: [] };
  return { proprio: t.slice(0, i).trim(),
    confluiti: t.slice(i + ' Dal censimento 2026: '.length).replace(/\.$/, '').split('; ').map((x) => x.trim()).filter(Boolean) };
}

/**
 * I dati del pezzo che servono sul posto (09/10/2026, dall'operatore: «per gli
 * estintori occorre mostrare anche l'estinguente e la carica… deve essere riportata
 * la quantità effettiva in anagrafica»): la QUANTITÀ quando è più di uno (luci,
 * rilevatori…), e per un estintore estinguente, carica e installazione.
 */
export function datiDelPezzo(a) {
  const pezzi = [];
  const q = Number(a.quantita || 1);
  if (q > 1) pezzi.push(`${q} pz in anagrafica`);
  if (a.categoria_codice === 'ESTINTORE') {
    const parola = (v) => String(v || '').replace(/_/g, ' ').toLowerCase();
    if (a.estinguente) pezzi.push(`estinguente ${/^CO2$/i.test(a.estinguente) ? 'CO2' : parola(a.estinguente)}`);
    if (String(a.carica_kg || '').trim()) pezzi.push(`carica ${String(a.carica_kg).replace('.', ',')} kg`);
    if (a.installazione) pezzi.push(parola(a.installazione));
  }
  return pezzi.join(' · ');
}

/**
 * Un punto aperto scritto «Dall'email di …: «…». In Scudo: … Da fare: …» (09/10/2026,
 * le voci dell'email di Iacopo Citi) va su tre righe nel foglio: chi lo legge sul
 * posto deve vedere subito che cosa dice la segnalazione, che cosa risulta e che cosa
 * fare. Un testo senza quella forma resta una riga sola.
 */
export function righePunto(testo) {
  const t = String(testo || '').trim();
  const m = /^(.*?)\s+In Scudo: (.*?)\s+Da fare: (.*)$/.exec(t);
  return m ? [m[1], `In Scudo: ${m[2]}`, `Da fare: ${m[3]}`] : [t];
}

const perNome = (x, y) => (x === SENZA_IMPIANTO) - (y === SENZA_IMPIANTO) || x.localeCompare(y, 'it');

/**
 * I dati dell'elenco. `tema`: 'ANTINCENDIO' | 'CLIMA' | '' (entrambi); `cosa`:
 * 'ANOMALIE' | 'PUNTI' | '' (entrambi); `impiantoId`: '' tutti; `soloAperti`:
 * le anomalie aperte o in lavorazione e i punti aperti, altrimenti anche chiusi
 * e risolti (mai gli annullati: non erano difetti).
 */
export function datiElenchi({ tema = '', cosa = '', impiantoId = '', soloAperti = true } = {}) {
  const st = S.get();
  const nomeImp = (id) => (id && (S.indici.impianti.get(id) || {}).denominazione) || SENZA_IMPIANTO;
  const anomalie = cosa === 'PUNTI' ? [] : (st.perEntita[E.ANOMALIA] || []).filter((an) => {
    if (an.eliminato_il) return false;
    const stato = an.stato || 'APERTA';
    if (stato === 'ANNULLATA') return false;
    if (soloAperti && !STATI_APERTI_ANOMALIA.includes(stato)) return false;
    const a = S.indici.assets.get(an.asset_id);
    if (!a || a.eliminato_il) return false;
    if (tema && temaAnomalia(an) !== tema) return false;
    return !impiantoId || a.impianto_id === impiantoId;
  });
  const punti = cosa === 'ANOMALIE' ? [] : (st.perEntita[E.VERIFICA] || []).filter((v) => {
    const stato = v.stato || 'APERTO';
    if (stato === 'ANNULLATO') return false;
    if (soloAperti && stato !== 'APERTO') return false;
    if (tema && S.temaPunto(v) !== tema) return false;
    return !impiantoId || v.impianto_id === impiantoId;
  });

  const riga = (an) => {
    const a = S.indici.assets.get(an.asset_id);
    const t = S.testoAnomalia(an);
    return {
      // «Dove» senza l'impianto: il capitolo è già il suo.
      id: an.id, presidio: nomePezzo(a),
      dove: [(S.indici.edifici.get(a.edificio_id) || {}).denominazione, (S.indici.locali.get(a.locale_id) || {}).denominazione]
        .filter(Boolean).filter((x, i, t) => i === 0 || x !== t[i - 1]).join(' / ') || String(a.ubicazione_testo || '').trim(), tipologia: (S.categoriaDi(a) || {}).descrizione || a.categoria_codice || 'Senza categoria',
      difetto: (t.nota || '').trim() || (t.verifiche.length ? '' : (an.descrizione || '').trim()),
      verifiche: t.verifiche,
      // L'azione proposta: il primo pezzo è il dettaglio dell'anomalia, le frasi
      // confluite dal censimento vanno a parte (`separaConfluiti`).
      ...(() => { const s = separaConfluiti(an.azione_proposta, ' · ');
        return { azione: s.proprio.join(' · '), confluiti: s.confluiti.map((x) => x.replace(SEGNO_CONFLUITO, '')) }; })(),
      // I pezzi guasti si dicono solo su un presidio da PIÙ pezzi: su uno solo
      // «1 pezzo non funziona» ripete «impedisce l'uso» (o lo contraddice).
      pezziGuasti: Number(an.quantita_ko) > 0 && Number(a.quantita || 1) > 1 ? Number(an.quantita_ko) : 0,
      pezzi: Number(a.quantita || 1),
      blocca: S.anomaliaBlocca(an), gravita: an.gravita || '', stato: an.stato || 'APERTA', aperta: an.data_apertura || '',
      tema: temaAnomalia(an),
    };
  };
  const perImpianto = new Map();
  const imp = (nome) => {
    if (!perImpianto.has(nome)) perImpianto.set(nome, { nome, anomalie: [], punti: [] });
    return perImpianto.get(nome);
  };
  // UNA riga per presidio (09/10/2026, dall'operatore: «vengono create righe
  // duplicate per lo stesso presidio, stesso progressivo»): misurato, 34 presidi
  // su 250 hanno due anomalie aperte — quasi sempre quella del censimento e quella
  // vista nel giro. Sul foglio sono un pezzo solo, con i suoi difetti numerati.
  const perAsset = new Map();
  for (const an of anomalie) {
    const a = S.indici.assets.get(an.asset_id);
    if (!perAsset.has(a.id)) perAsset.set(a.id, { a, difetti: [] });
    perAsset.get(a.id).difetti.push(riga(an));
  }
  const PESO_GRAVITA = { ALTA: 3, MEDIA: 2, BASSA: 1 };
  for (const { a, difetti } of perAsset.values()) {
    difetti.sort((x, y) => String(x.aperta).localeCompare(String(y.aperta)));
    const primo = difetti[0];
    imp(nomeImp(a.impianto_id)).anomalie.push({
      id: a.id, presidio: primo.presidio, dove: primo.dove, tipologia: primo.tipologia, tema: primo.tema, pezzi: Number(a.quantita || 1),
      datiPezzo: datiDelPezzo(a), difetti,
      blocca: difetti.some((d) => d.blocca),
      gravita: difetti.map((d) => d.gravita).sort((x, y) => (PESO_GRAVITA[y] || 0) - (PESO_GRAVITA[x] || 0))[0] || '',
    });
  }
  for (const v of punti) {
    const nome = nomeImp(v.impianto_id);
    const sp = separaPuntoAperto(v.punto_aperto);
    imp(nome).punti.push({ id: v.id, ambito: S.ambitoSenzaImpianto(v.ambito, nome === SENZA_IMPIANTO ? '' : nome),
      testo: sp.proprio, confluiti: sp.confluiti, priorita: v.priorita || '', tema: S.temaPunto(v), stato: v.stato || 'APERTO',
      esito: String(v.esito_verifica || '').trim(), fonte: String(v.fonte || '').trim() });
  }

  const impianti = [...perImpianto.values()].sort((x, y) => perNome(x.nome, y.nome)).map((i) => {
    const tip = new Map();
    for (const r of i.anomalie) {
      if (!tip.has(r.tipologia)) tip.set(r.tipologia, []);
      tip.get(r.tipologia).push(r);
    }
    const ordina = (x, y) => (y.blocca - x.blocca) || x.dove.localeCompare(y.dove, 'it') || x.presidio.localeCompare(y.presidio, 'it');
    const difetti = i.anomalie.flatMap((r) => r.difetti);
    const perTema = Object.keys(TEMI).map((t) => ({ tema: t, righe: i.punti.filter((p) => p.tema === t)
      .sort((x, y) => x.ambito.localeCompare(y.ambito, 'it')) })).filter((g) => g.righe.length);
    return {
      nome: i.nome,
      tipologie: [...tip.entries()].sort(([x], [y]) => x.localeCompare(y, 'it')).map(([tipologia, righe]) => ({ tipologia, righe: righe.sort(ordina) })),
      temiPunti: perTema,
      conteggi: { anomalie: difetti.length, presidi: i.anomalie.length, bloccano: difetti.filter((d) => d.blocca).length, punti: i.punti.length,
        puntiAlta: i.punti.filter((p) => p.priorita === 'ALTA').length },
    };
  });
  const perTipologia = new Map();
  for (const i of impianti) for (const g of i.tipologie) {
    const t = perTipologia.get(g.tipologia) || { tipologia: g.tipologia, anomalie: 0, bloccano: 0, impianti: 0 };
    const dd = g.righe.flatMap((r) => r.difetti);
    t.anomalie += dd.length; t.bloccano += dd.filter((d) => d.blocca).length; t.impianti += 1;
    perTipologia.set(g.tipologia, t);
  }
  return {
    filtri: { tema, cosa, impiantoId, soloAperti, impianto: impiantoId ? nomeImp(impiantoId) : '' },
    impianti,
    perTipologia: [...perTipologia.values()].sort((x, y) => y.anomalie - x.anomalie || x.tipologia.localeCompare(y.tipologia, 'it')),
    totali: {
      anomalie: anomalie.length, bloccano: impianti.reduce((t, i) => t + i.conteggi.bloccano, 0), punti: punti.length,
      impianti: impianti.length,
    },
  };
}

/** «Antincendio e climatizzatori», «Climatizzatori», …: che cosa c'è nel documento, a parole. */
function descriviFiltri(f) {
  const tema = f.tema ? TEMI[f.tema] : 'Antincendio e climatizzatori';
  const cosa = f.cosa === 'ANOMALIE' ? 'anomalie' : f.cosa === 'PUNTI' ? 'punti aperti' : 'anomalie e punti aperti';
  return { tema, cosa, stato: f.soloAperti ? 'solo quelli ancora aperti' : 'aperti e chiusi (non gli annullati)' };
}


/** Il PDF. `versione` e `adesso` solo per il piè e il frontespizio. */
export function pdfElenchi(dati, { versione = '', adesso = new Date().toISOString(), codice = '' } = {}) {
  const f = descriviFiltri(dati.filtri);
  const titolo = `${f.cosa.charAt(0).toUpperCase()}${f.cosa.slice(1)} — ${f.tema}`;
  // Due passate, come il verbale: il frontespizio dice da che foglio comincia ogni
  // impianto, e lo si sa solo dopo averli scritti.
  const scrivi = (doc, partenze) => {
    const inizi = [];
    const p = penna(doc, { testata: titolo, destra: dati.filtri.impianto || `${dati.totali.impianti} impianti`, onPagina: () => {} });
    p.nuovaPagina();
    p.paragrafo(titolo.toUpperCase(), { corpo: 15, grassetto: true, dopo: 2 });
    p.paragrafo(`${dati.filtri.impianto ? `Impianto ${dati.filtri.impianto} · ` : ''}${f.stato} · stampato il ${dataIt(adesso)}`
      + `${codice ? ` · pacchetto ${codice}` : ''}`, { corpo: 9, grigio: 0.35, dopo: 8 });
    p.riquadro([
      `Anomalie: ${dati.totali.anomalie}, di cui ${impedisce(dati.totali.bloccano)} del presidio.`,
      `Punti aperti: ${dati.totali.punti}.`,
      // Breve, e senza nomi di programmi (09/10/2026, dall'operatore): la casella
      // dice «verificato sul posto», le note dicono se è risolto o che cosa correggere.
      'Come si usa: «Pagina» indica dove comincia ogni impianto. La casella si spunta quando l\'anomalia o il punto '
        + 'aperto è verificato sul posto; in «Note sul posto» si scrive se è stato risolto o che cosa va corretto. '
        + 'Il riquadro «Appunti» in fondo a ogni impianto è per tutto il resto.',
    ]);
    if (dati.impianti.length) {
      p.titolo('Riepilogo per impianto', 11);
      p.tabella([
        { titolo: 'Impianto', larghezza: 0.36 }, { titolo: "Anomalie che impediscono l'uso", larghezza: 0.17 },
        { titolo: 'Anomalie che non lo impediscono', larghezza: 0.17 }, { titolo: 'Punti aperti (di cui priorità alta)', larghezza: 0.18 },
        { titolo: 'Pagina', larghezza: 0.12 },
      ], dati.impianti.map((i, k) => [
        [{ testo: i.nome, grassetto: true }], [{ testo: String(i.conteggi.bloccano), grassetto: i.conteggi.bloccano > 0 }],
        [{ testo: String(i.conteggi.anomalie - i.conteggi.bloccano) }],
        [{ testo: `${i.conteggi.punti}${i.conteggi.puntiAlta ? ` (${i.conteggi.puntiAlta})` : ''}` }],
        [{ testo: partenze[k] ? String(partenze[k]) : '…' }],
      ]));
    }
    if (dati.perTipologia.length) {
      p.titolo('Riepilogo delle anomalie per tipologia', 11);
      p.tabella([
        { titolo: 'Tipologia', larghezza: 0.46 }, { titolo: 'Anomalie', larghezza: 0.18 },
        { titolo: "di cui impediscono l'uso", larghezza: 0.18 }, { titolo: 'Impianti', larghezza: 0.18 },
      ], dati.perTipologia.map((t) => [[{ testo: t.tipologia, grassetto: true }], [{ testo: String(t.anomalie) }],
        [{ testo: String(t.bloccano), grassetto: t.bloccano > 0 }], [{ testo: String(t.impianti) }]]));
    }
    if (!dati.impianti.length) p.paragrafo('Niente da elencare con questi filtri.', { corpo: 11, dopo: 6 });

    for (const i of dati.impianti) {
      p.nuovaPagina();
      inizi.push(doc.numeroPagine);
      doc.rettangolo(M, p.y, LARGA, 26, { riempi: 0.15, bordo: 0 });
      doc.testo(M + 8, p.y + 17, `IMPIANTO ${i.nome}`, { corpo: 13, grassetto: true, grigio: 1 });
      p.y += 32;
      p.paragrafo(`${i.conteggi.anomalie} ${i.conteggi.anomalie === 1 ? 'anomalia' : 'anomalie'} (${impedisce(i.conteggi.bloccano)}) · ${i.conteggi.punti} punti aperti`
        + `${i.conteggi.puntiAlta ? ` (${i.conteggi.puntiAlta} a priorità alta)` : ''}`, { corpo: 9, grigio: 0.3, dopo: 6 });
      if (i.tipologie.length) {
        p.titolo(`Anomalie — ${i.conteggi.anomalie}`, 12);
        for (const g of i.tipologie) {
          const dd = g.righe.flatMap((r) => r.difetti);
          const blocc = dd.filter((d) => d.blocca).length;
          // Anche i PEZZI (09/10/2026, dall'operatore: «nel titolo mancano i pezzi
          // totali»): tre righe di rilevatori possono essere 37 rilevatori.
          const pz = g.righe.reduce((t, r) => t + r.pezzi, 0);
          p.titolo(`${g.tipologia} — ${g.righe.length} ${g.righe.length === 1 ? 'presidio' : 'presidi'}, ${pz} pz`
            + `${dd.length !== g.righe.length ? `, ${dd.length} anomalie` : ''}${blocc ? ` (${impedisce(blocc)})` : ''}`, 10);
          p.tabella([
            { titolo: '', larghezza: 0.05 }, { titolo: 'Presidio e dove', larghezza: 0.25 },
            { titolo: 'Difetto e che cosa fare', larghezza: 0.33 }, { titolo: 'Uso', larghezza: 0.11 },
            { titolo: 'Note sul posto', larghezza: 0.26 },
          ], g.righe.map((r) => [
            [{ testo: '' }],
            [{ testo: r.presidio, grassetto: true }, ...(r.datiPezzo ? [{ testo: r.datiPezzo, grigio: 0.15 }] : []),
              ...(r.dove ? [{ testo: r.dove, grigio: 0.35 }] : [])],
            r.difetti.flatMap((d, k) => [
              ...(d.difetto ? [{ testo: `${r.difetti.length > 1 ? `${k + 1}) ` : ''}${d.difetto}`, grassetto: r.difetti.length > 1 }] : []),
              ...(d.verifiche.length ? [{ testo: `Voci lasciate senza spunta: ${d.verifiche.join('; ')}`, grigio: 0.35 }] : []),
              ...(d.pezziGuasti ? [{ testo: `Non funzionano: ${d.pezziGuasti} pz su ${d.pezzi}`, grigio: 0.2 }] : []),
              // «Dettaglio» e non «Da fare»: nel censimento questa colonna porta
              // il dettaglio del difetto («Guasto sensore fumo e cavo») tanto
              // quanto l'azione.
              ...(d.azione ? [{ testo: `Dettaglio: ${d.azione}`, grigio: 0.25 }] : []),
              ...(d.confluiti.length ? [{ testo: 'Dal censimento, sugli altri presidi:', grigio: 0.45, corpo: 7 },
                ...d.confluiti.map((x) => ({ testo: `• ${x}`, grigio: 0.45, corpo: 7 }))] : []),
              { testo: `Aperta il ${dataIt(d.aperta) || '—'}${d.stato === 'IN_CORSO' ? ' · in lavorazione' : d.stato === 'CHIUSA' ? ' · chiusa' : ''}`
                + `${r.difetti.length > 1 ? (d.blocca ? " · impedisce l'uso" : ' · si può usare') : ''}`, grigio: 0.5, corpo: 7 },
            ]),
            [{ testo: r.blocca ? "IMPEDISCE L'USO" : 'si può usare', grassetto: r.blocca }, ...(r.gravita ? [{ testo: `gravità ${r.gravita.toLowerCase()}`, grigio: 0.4, corpo: 7 }] : [])],
            [{ testo: '' }],
          ]), { altezzaMinima: 40, casella: true });
        }
      }
      if (i.temiPunti.length) {
        p.titolo(`Punti aperti — ${i.conteggi.punti}`, 12);
        for (const g of i.temiPunti) {
          if (!dati.filtri.tema) p.titolo(`${TEMI[g.tema]} — ${g.righe.length}`, 10);
          p.tabella([
            { titolo: '', larghezza: 0.05 }, { titolo: 'Dove', larghezza: 0.2 }, { titolo: 'Punto aperto', larghezza: 0.41 },
            { titolo: 'Priorità', larghezza: 0.08 }, { titolo: 'Note sul posto', larghezza: 0.26 },
          ], g.righe.map((r) => [
            [{ testo: '' }],
            [{ testo: r.ambito || "Tutto l'impianto" }],
            [...righePunto(r.testo).map((x, k) => ({ testo: x, grigio: k === 1 ? 0.3 : 0 })),
              ...(r.confluiti.length ? [{ testo: 'Dal censimento 2026:', grigio: 0.45, corpo: 7 },
                ...r.confluiti.map((x) => ({ testo: `• ${x}`, grigio: 0.45, corpo: 7 }))] : []),
              ...(r.esito ? [{ testo: `Esito: ${r.esito}`, grigio: 0.35 }] : []),
              ...(r.stato !== 'APERTO' ? [{ testo: r.stato.toLowerCase(), grigio: 0.5, corpo: 7 }] : [])],
            [{ testo: (r.priorita || '').toLowerCase(), grassetto: r.priorita === 'ALTA' }],
            [{ testo: '' }],
          ]), { altezzaMinima: 40, casella: true });
        }
      }
      // Gli appunti: righe da riempire, fino a otto o fin dove arriva la pagina.
      const passo = 20;
      const quante = Math.min(8, Math.floor((FONDO - p.y - 24) / passo));
      if (quante < 3) p.nuovaPagina();
      const n = Math.max(3, Math.min(8, Math.floor((FONDO - p.y - 24) / passo)));
      p.paragrafo(`Appunti — ${i.nome}`, { corpo: 9, grassetto: true, dopo: 2 });
      for (let k = 1; k <= n; k += 1) doc.linea(M, p.y + k * passo, M + LARGA, p.y + k * passo, { grigio: 0.7, spessore: 0.4 });
      p.y += n * passo + 8;
    }
    return inizi;
  };
  const prova = nuovoDocumento();
  const partenze = scrivi(prova, []);
  const doc = nuovoDocumento({ titolo, autore: 'Scudo Campo' });
  scrivi(doc, partenze);
  const n = doc.numeroPagine;
  for (let k = 1; k <= n; k += 1) {
    doc.suPagina(k);
    doc.linea(M, A4.altezza - 34, M + LARGA, A4.altezza - 34, { grigio: 0.7 });
    doc.testo(M, A4.altezza - 22, `Scudo Campo ${versione} · ${titolo} · stampato il ${dataIt(adesso)}`, { corpo: 7, grigio: 0.4 });
    doc.testo(M + LARGA - 62, A4.altezza - 22, `foglio ${k} di ${n}`, { corpo: 7, grigio: 0.4 });
  }
  return doc.bytes();
}

/** «Anomalie e punti aperti - Climatizzatori - SUVERETO - 09-10-2026.pdf». */
export function nomeFileElenchi(dati, adesso = new Date().toISOString()) {
  const f = descriviFiltri(dati.filtri);
  const cosa = `${f.cosa.charAt(0).toUpperCase()}${f.cosa.slice(1)}`;
  return `${cosa} - ${f.tema} - ${dati.filtri.impianto || 'tutti gli impianti'} - ${dataIt(String(adesso).slice(0, 10)).replace(/\//g, '-')}.pdf`
    .replace(/[\\/:*?"<>|]+/g, '-');
}

