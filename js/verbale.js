/**
 * Il VERBALE DEI CONTROLLI del giro, in PDF, da stampare e far firmare.
 *
 * Perché esiste (24/09/2026, richiesta dell'operatore: «un report PDF da
 * stampare e far firmare alla ditta, con i controlli fatti, gli esiti e le
 * anomalie; deve far capire quali anomalie sono riconfermate, quali nuove…»)
 * -------------------------------------------------------------------------
 * Due parti, separate apposta:
 *  * `datiVerbale()` decide CHE COSA c'è — pura, sui dati del rilievo, provata
 *    in `test_verbale_campo.mjs`. È lì che una classificazione sbagliata («nuova»
 *    per un'anomalia di aprile) diventerebbe una firma su un fatto falso;
 *  * `pdfVerbale()` decide COME si vede, con `pdf.js` (niente librerie).
 *
 * «Di questo giro» è la regola di sempre (`interventoNelGiro`): dall'inizio del
 * giro o, se non è stato premuto «Inizia», dal caricamento del pacchetto.
 *
 * ⚠️ Solo lettura: il verbale non scrive niente nel rilievo, non entra nel
 * giornale e non crea «lavoro non esportato». Stamparlo due volte è innocuo.
 */
import * as S from './stato.js';
import { E } from './pacchetto.js';
import { A4, aCapo, nuovoDocumento } from './pdf.js';
import { dettaglioTipologia } from './nome_presidio.js';
import * as PV from './piani.js';

const ESITI_A_PAROLE = {
  IDONEO: 'Idoneo',
  NON_IDONEO: 'Non idoneo',
  NON_ESEGUITO: 'Non eseguibile (non si poteva fare)',
  NON_ACCESSIBILE: 'Non eseguibile (non raggiungibile)',
};

/**
 * Le date in forma italiana, senza dipendere dalla lingua del telefono.
 *
 * ⚠️ Un istante con il fuso (`…T21:22:00Z`, come li scrive `adessoIso`) si
 * mostra nell'ORA LOCALE: visto nel primo PDF, «stampato il 24/09 21:22» alle
 * 23:22 — e vicino a mezzanotte anche il giorno del giro sarebbe stato quello
 * sbagliato. Una data semplice (`2026-09-24`) resta com'è: è già un giorno.
 */
export function dataIt(iso) {
  const s = String(iso || '');
  if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}

/** Tipologia, progressivo, matricola: il nome del pezzo SENZA emoji. */
function nomePezzo(a) {
  const cat = S.categoriaDi(a) || {};
  const matricola = String(a.matricola == null ? '' : a.matricola).trim();
  return [[cat.descrizione || a.categoria_codice, dettaglioTipologia(a)].filter(Boolean).join(' · '),
    String(a.identificativo || '').trim(), matricola ? `matr. ${matricola}` : ''].filter(Boolean).join(' · ');
}

/** La categoria del presidio a parole («Estintore»), come la chiama l'app. */
function categoriaParole(a) {
  return (S.categoriaDi(a) || {}).descrizione || a.categoria_codice || 'Senza categoria';
}

/** I pezzi di una riga dell'anagrafica: la quantità, 1 se non è scritta. */
function pezziDi(a) {
  const q = String(a.quantita ?? '').trim();
  return q === '' || Number.isNaN(Number(q)) ? 1 : Number(q);
}

/**
 * Le VERIFICHE PREVISTE dal piano per un controllo, ognuna con quello che dice
 * la sua spunta (25/09/2026, dall'operatore: «al posto delle verifiche non
 * idonee, riporta le verifiche previste»). Si leggono dalle voci salvate CON il
 * controllo — la copia di quel giorno — e, se non ce ne sono, dal piano.
 *
 * ⛔ Una spunta vuol dire ESEGUITA, non idonea (25/09/2026, stesso giorno: in
 * campo, con qualcosa che non andava, il sorvegliante lasciava tutto senza
 * spunta e scriveva la nota, e il verbale diceva «non idonea» a ogni voce). Il
 * giudizio è l'esito del controllo; il difetto è l'anomalia, scritta a mano.
 *  * spuntata                                      → «eseguita»;
 *  * la voce che l'anomalia di questo controllo nomina → «eseguita — difetto
 *    segnalato» (è lì che il controllo non è andato);
 *  * «solo se si applica», vuota, in un IDONEO       → «non si applica»;
 *  * vuota, negli altri casi                        → «non spuntata»: vale per
 *    le registrazioni di prima, dove una voce vuota voleva dire «non idonea» o
 *    «non l'ho spuntata per fare prima», e il verbale non sceglie fra le due;
 *  * controllo non eseguibile                       → «non eseguita».
 */
function verifichePreviste(iv, piano, collegata) {
  const salvate = (S.indici.azioniPerIntervento.get(iv.id) || []).slice()
    .sort((x, y) => Number(x.ordine || 0) - Number(y.ordine || 0));
  const delPiano = piano ? S.azioniDelPiano(piano.id) : [];
  const condizionale = (id) => String((delPiano.find((z) => z.id === id) || {}).obbligatoria ?? '1') === '0';
  const nonEseguito = ['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(iv.esito);
  if (!salvate.length) return delPiano.map((z) => ({ azione_id: z.id, testo: z.testo, esito: nonEseguito ? 'non eseguita' : '', condizionale: condizionale(z.id) }));
  return salvate.map((z) => {
    const fatta = String(z.fatta) === '1' || z.fatta === true;
    const cond = condizionale(z.azione_id);
    const difetto = Boolean(collegata) && String(z.testo || '').trim() === collegata;
    let esito = 'eseguita';
    if (nonEseguito) esito = 'non eseguita';
    else if (!fatta) esito = cond && iv.esito === 'IDONEO' ? 'non si applica' : 'non spuntata';
    if (difetto && !nonEseguito) esito = fatta ? 'eseguita — difetto segnalato' : 'difetto segnalato';
    return { azione_id: z.azione_id, testo: z.testo, esito, condizionale: cond, difetto };
  });
}

/** I dati dell'impianto per il frontespizio: solo quelli che l'archivio ha. */
function datiImpianto(i) {
  if (!i) return [];
  const indirizzo = String(i.indirizzo || '').trim()
    || [[i.via, i.civico].filter(Boolean).join(' '), [i.cap, i.comune].filter(Boolean).join(' '), i.provincia ? `(${i.provincia})` : '']
      .filter((x) => String(x || '').trim()).join(', ');
  const comune = String(i.indirizzo || '').trim() && i.comune ? `${i.comune}${i.provincia ? ` (${i.provincia})` : ''}` : '';
  const origini = { RILIEVO: 'rilevata sul posto', SOTTOSTAZIONE: 'ricavata dalla sottostazione (OSM)', INDIRIZZO: 'ricavata dall\'indirizzo' };
  const pos = i.lat && i.lon ? `${Number(i.lat).toFixed(6)}, ${Number(i.lon).toFixed(6)}`
    + (i.coordinate_origine ? ` — ${origini[i.coordinate_origine] || i.coordinate_origine}` : '') : '';
  const data = (x) => (/^\d{4}-\d{2}-\d{2}/.test(String(x || '')) ? dataIt(x) : String(x || '').trim());
  const cpi = [i.cpi_numero ? `n. ${i.cpi_numero}` : '', i.cpi_rilascio ? `rilasciato il ${data(i.cpi_rilascio)}` : '',
    i.cpi_scadenza ? `scade il ${data(i.cpi_scadenza)}` : ''].filter(Boolean).join(' · ');
  const scia = [i.scia_protocollo, i.scia_data ? `del ${data(i.scia_data)}` : ''].filter((x) => String(x || '').trim()).join(' ');
  const conformita = [i.conformita_ultimo_rinnovo ? `ultimo rinnovo ${data(i.conformita_ultimo_rinnovo)}` : '',
    i.conformita_scadenza ? `scade il ${data(i.conformita_scadenza)}` : ''].filter(Boolean).join(' · ');
  return [
    ['Indirizzo', [indirizzo, comune].filter(Boolean).join(' — ')],
    ['Posizione', pos],
    ['Tipologia', [i.tipologia, i.tensione, i.codice_terna ? `codice Terna ${i.codice_terna}` : ''].filter((x) => String(x || '').trim()).join(' · ')],
    ['Attività (DPR 151/2011)', i.codici_attivita],
    ['SCIA', scia],
    ['CPI', cpi],
    ['Attestazione di rinnovo', conformita],
    ['Datore di lavoro', i.datore_lavoro],
    ['RSPP', i.rspp],
    ['Responsabile del registro', i.responsabile_registro],
    ['Piano di emergenza', i.piano_emergenza],
    ['Ultima prova di evacuazione', data(i.ultima_prova_evacuazione)],
  ].map(([k, v]) => [k, String(v || '').replace(/\s+/g, ' ').trim()]).filter(([, v]) => v);
}

/** Il confine del giro: inizio o, se manca, caricamento del pacchetto. */
function inizioDelGiro() {
  const s = S.get().sessione || {};
  return s.iniziato_il || s.caricato_il || '';
}

/**
 * Che cosa va nel verbale.
 *
 * @param impiantoId  un impianto, o '' per tutti quelli toccati nel giro.
 * @param nonRiviste  se elencare anche le anomalie aperte non riviste nel giro.
 * @returns `{ intestazione, controlli, anomalie: { nuove, riconfermate,
 *   risolte, nonRiviste }, conteggi, impianti }`
 */
export function datiVerbale({ impiantoId = '', nonRiviste = true } = {}) {
  const st = S.get();
  const da = inizioDelGiro();
  const giornoDa = da.slice(0, 10);
  const assets = new Map((st.perEntita[E.ASSET] || []).map((a) => [a.id, a]));
  const nelPerimetro = (a) => a && (!impiantoId || a.impianto_id === impiantoId);
  const nomeImpianto = (id) => (S.indici.impianti.get(id) || {}).denominazione || '';

  // L'anomalia aperta da ogni controllo, per la sua nota nel punto 1.
  const anomaliaDi = new Map((st.perEntita[E.ANOMALIA] || [])
    .filter((an) => an.intervento_apertura_id && !an.eliminato_il)
    .map((an) => [an.intervento_apertura_id, an]));
  // La verifica collegata all'anomalia aperta da ogni controllo (25/09/2026).
  const collegataDi = new Map((st.perEntita[E.ANOMALIA] || [])
    .filter((an) => an.intervento_apertura_id && String(an.verifica_collegata || '').trim())
    .map((an) => [an.intervento_apertura_id, String(an.verifica_collegata).trim()]));

  // ---- i controlli registrati nel giro ----------------------------------- //
  const controlli = S.interventiDelGiro()
    .filter((iv) => !iv.eliminato_il && nelPerimetro(assets.get(iv.asset_id)))
    .map((iv) => {
      const a = assets.get(iv.asset_id);
      // Il piano dall'indice: `dettaglioIntervento` non lo restituisce (la prima
      // stesura lo leggeva da lì e riceveva sempre undefined — la norma era
      // quella del TIPO, «UNI 9994-1» al posto di «UNI 9994-1:2024»).
      const piano = S.indici.pianiPerId.get(iv.piano_id) || null;
      const tipo = S.indici.tipiControllo.get(iv.tipo_controllo_codice) || {};
      const nonEseguito = ['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(iv.esito);
      return {
        id: iv.id,
        asset_id: iv.asset_id,
        categoria: categoriaParole(a),
        data: iv.data || '',
        impianto: nomeImpianto(a.impianto_id),
        presidio: nomePezzo(a),
        ubicazione: S.ubicazione(a),
        controllo: (piano && piano.denominazione) || tipo.descrizione || iv.tipo_controllo_codice,
        // La NORMA del controllo, dove il catalogo la dice (24/09/2026, richiesta
        // dell'operatore): quella del piano, altrimenti quella del tipo.
        norma: String((piano && piano.norma) || tipo.norma || '').trim(),
        // Ogni quanto (25/09/2026, dall'operatore: «nel verbale manca la
        // frequenza del controllo»). Quella del piano, con le stesse parole
        // della scheda: «ogni 6 mesi».
        frequenza: piano ? PV.etichettaFrequenza(piano.frequenza_valore, piano.frequenza_unita) : '',
        esito: iv.esito,
        esitoParole: ESITI_A_PAROLE[iv.esito] || String(iv.esito || '').replace(/_/g, ' ').toLowerCase(),
        pezziGuasti: Number(iv.quantita_ko || 0) || 0,
        note: [nonEseguito ? iv.descrizione : '', iv.note].filter((x) => String(x || '').trim()).join(' — '),
        operatore: iv.operatore_nome || '',
        // Chi ha SORVEGLIATO: l'operatore che l'ha registrato — il committente,
        // non la ditta. Con una staffetta ogni controllo porta il suo.
        sorvegliante: String(iv.operatore_nome || '').trim(),
        verifiche: verifichePreviste(iv, piano, collegataDi.get(iv.id) || ''),
        piano_id: iv.piano_id || '',
        // La NOTA DELL'ANOMALIA quando il controllo è non idoneo (25/09/2026,
        // dall'operatore): quella aperta da questo controllo o, con «stesso
        // difetto», la descrizione del controllo che la nomina.
        anomaliaNota: iv.esito === 'NON_IDONEO'
          ? (anomaliaDi.has(iv.id) ? (S.testoAnomalia(anomaliaDi.get(iv.id)).nota.trim() || anomaliaDi.get(iv.id).descrizione || '')
            : String(iv.descrizione || '').trim())
          : '',
      };
    })
    .sort((x, y) => (x.impianto.localeCompare(y.impianto) || x.data.localeCompare(y.data)
      || x.presidio.localeCompare(y.presidio)));

  // ---- le anomalie, per quello che è successo loro nel giro --------------- //
  // «Modificata»: un evento di giornale che cambia qualcosa oltre la conferma.
  const modificate = new Set((st.giornale || [])
    .filter((ev) => ev.entita === 'anomalia' && ev.operazione === 'UPDATE' && (!da || String(ev.ts_utc || '') >= da))
    .filter((ev) => {
      let p = ev.payload;
      if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
      const dopo = (p && p.dopo) || {};
      return Object.keys(dopo).some((k) => !['confermata_il', 'confermata_da', 'bloccante', 'stato',
        'data_chiusura', 'note_chiusura', 'aggiornato_il'].includes(k));
    })
    .map((ev) => ev.entita_id));

  // Chi ha toccato le anomalie nel giro (conferme, modifiche, chiusure): anche
  // loro hanno sorvegliato, e vanno nel verbale.
  const manoAnomalie = new Map();   // anomalia id -> Set di nomi
  for (const ev of st.giornale || []) {
    if (ev.entita !== 'anomalia' || (da && String(ev.ts_utc || '') < da)) continue;
    const nome = String(ev.operatore_nome || '').trim();
    if (!nome) continue;
    if (!manoAnomalie.has(ev.entita_id)) manoAnomalie.set(ev.entita_id, new Set());
    manoAnomalie.get(ev.entita_id).add(nome);
  }
  const anomalie = { nuove: [], riconfermate: [], risolte: [], nonRiviste: [] };
  for (const an of st.perEntita[E.ANOMALIA] || []) {
    if (an.eliminato_il) continue;
    const a = assets.get(an.asset_id);
    if (!nelPerimetro(a)) continue;
    const t = S.testoAnomalia(an);
    const aperta = ['APERTA', 'IN_CORSO'].includes(an.stato || 'APERTA');
    const nuova = Boolean(da) && String(an.registrato_il || '') >= da;
    const chiusaNelGiro = !aperta && Boolean(giornoDa) && String(an.data_chiusura || '') >= giornoDa;
    const riga = {
      id: an.id,
      categoria: categoriaParole(a),
      impianto: nomeImpianto(a.impianto_id),
      presidio: nomePezzo(a),
      ubicazione: S.ubicazione(a),
      nota: t.nota.trim(),
      verifiche: t.verifiche.length ? t.verifiche : (t.grezzo ? [t.grezzo] : []),
      gravita: an.gravita || '',
      blocca: aperta ? S.anomaliaBlocca(an) : null,
      stato: an.stato || 'APERTA',
      aperta_il: an.data_apertura || '',
      riconfermata_il: an.confermata_il || '',
      chiusa_il: an.data_chiusura || '',
      note_chiusura: an.note_chiusura || '',
      modificata: modificate.has(an.id),
      daControllo: t.verifiche.length > 0,
      collegata: String(an.verifica_collegata || '').trim(),
      intervento_apertura_id: an.intervento_apertura_id || '',
      nuova,
      mani: [...(manoAnomalie.get(an.id) || [])],
    };
    // ⛔ Un'anomalia ANNULLATA (un doppione, o registrata per errore) non è
    // «risolta»: non è mai stata un difetto a sé. Prima finiva fra le risolte
    // del giro, e il verbale avrebbe firmato come riparati i doppioni annullati.
    if (an.stato === 'ANNULLATA') continue;
    if (chiusaNelGiro) anomalie.risolte.push(riga);   // anche se nata nel giro: il fatto che conta è che è chiusa
    else if (!aperta) continue;                       // chiusa prima del giro: non riguarda questo verbale
    else if (nuova) anomalie.nuove.push(riga);
    else if (S.confermataNelGiro(an)) anomalie.riconfermate.push(riga);
    else if (nonRiviste) anomalie.nonRiviste.push(riga);
  }
  const ordine = (x, y) => x.impianto.localeCompare(y.impianto) || x.presidio.localeCompare(y.presidio);
  for (const k of Object.keys(anomalie)) anomalie[k].sort(ordine);

  const conta = (esito) => controlli.filter((c) => c.esito === esito).length;
  const { perCategoria, totale: totaleCategorie } = presidiPerCategoria(
    [...assets.values()].filter((a) => !a.eliminato_il && nelPerimetro(a)), controlli, anomalie.nuove);
  const sess = st.sessione || {};
  // ⛔ I SORVEGLIANTI, tutti (24/09/2026, dall'operatore: «gli operatori che hanno
  // compilato i controlli sono i sorveglianti lato committente, e andrebbero
  // riportati tutti, anche se c'è stata una staffetta»). Si leggono dai dati —
  // chi ha registrato ogni controllo, chi ha toccato ogni anomalia del perimetro
  // — e non dalla sola sessione, che conosce soltanto l'ultima mano. Matricola e
  // tecnico della ditta vengono dalla catena delle consegne e dalla sessione,
  // per nome.
  const mani = [...((st.manifest || {}).consegne || []),
    { operatore: sess.operatore, matricola: sess.matricola, ditta: sess.operatore_ditta }];
  const infoMano = (nome) => mani.filter((m) => String(m.operatore || '').trim() === nome);
  const sorveglianti = new Map();
  const segna = (nome, campo) => {
    if (!nome) return;
    if (!sorveglianti.has(nome)) {
      const info = infoMano(nome);
      sorveglianti.set(nome, { nome, matricola: (info.find((m) => m.matricola) || {}).matricola || '',
        ditta: [...new Set(info.map((m) => String(m.ditta || '').trim()).filter(Boolean))], controlli: 0, anomalie: 0 });
    }
    sorveglianti.get(nome)[campo] += 1;
  };
  for (const c of controlli) segna(c.sorvegliante, 'controlli');
  for (const r of [...anomalie.nuove, ...anomalie.riconfermate, ...anomalie.risolte]) for (const m of r.mani) segna(m, 'anomalie');
  const elencoSorveglianti = [...sorveglianti.values()].sort((x, y) => y.controlli - x.controlli || x.nome.localeCompare(y.nome));
  // ⛔ I tecnici della ditta (25/09/2026, dall'operatore: «anziché "da indicare a
  // mano", metti l'operatore della ditta che mettiamo nel pacchetto»). Prima di
  // tutto quelli delle mani che hanno sorvegliato QUESTO impianto; se il nome non
  // combacia (una mano senza consegna, un nome scritto in due modi) tutti quelli
  // scritti nel giro: sessione, manifest, catena delle consegne.
  const conosciuti = [...new Set([sess.operatore_ditta, (st.manifest || {}).operatore_ditta,
    ...mani.map((m) => m.ditta)].map((x) => String(x || '').trim()).filter(Boolean))];
  const suoi = [...new Set(elencoSorveglianti.flatMap((x) => x.ditta))];
  const tecniciDitta = suoi.length ? suoi : conosciuti;
  const unita = ((st.perEntita[E.UI] || [])[0] || {}).denominazione || '';
  const impianti = [...new Set([...controlli.map((c) => c.impianto),
    ...Object.values(anomalie).flat().map((r) => r.impianto)])].filter(Boolean).sort();
  return {
    intestazione: {
      impianto: impiantoId ? nomeImpianto(impiantoId) : '',
      impianti,
      dal: da,
      unita,
      sorveglianti: elencoSorveglianti,
      tecniciDitta,
      dispositivo: sess.device_id || '',
    },
    controlli,
    anomalie,
    // I controlli per TIPO DI PRESIDIO e per PIANO (25/09/2026, dall'operatore:
    // «suddividere i controlli per tipo di presidio, e le verifiche spiegate una
    // sola volta all'inizio di ogni gruppo»).
    gruppi: raggruppaPerCategoriaEPiano(controlli),
    impianto: impiantoId ? datiImpianto(S.indici.impianti.get(impiantoId)) : [],
    perCategoria,
    totaleCategorie,
    conteggi: {
      controlli: controlli.length,
      idonei: conta('IDONEO'),
      nonIdonei: conta('NON_IDONEO'),
      nonEseguibili: conta('NON_ESEGUITO') + conta('NON_ACCESSIBILE'),
      // Per id, non per nome: due presidi con lo stesso nome nella stessa
      // ubicazione (dodici lampade uguali) sono dodici presidi.
      presidi: totaleCategorie.controllati,
      pezzi: totaleCategorie.pezzi,
      nuove: anomalie.nuove.length,
      riconfermate: anomalie.riconfermate.length,
      modificate: anomalie.riconfermate.filter((r) => r.modificata).length,
      risolte: anomalie.risolte.length,
      nonRiviste: anomalie.nonRiviste.length,
    },
  };
}

/**
 * I controlli per TIPO DI PRESIDIO e, dentro, per PIANO (25/09/2026). Ogni piano
 * porta le sue verifiche UNA volta, numerate; ogni controllo solo quello che se
 * ne discosta, con quei numeri: `nonSpuntate`, `difettoSu`. Prima ogni controllo
 * ripeteva le sue sette o otto voci con «— eseguita», e un giro faceva centinaia
 * di pagine per dire quasi sempre la stessa cosa.
 *
 * L'elenco è quello del PIANO; una voce salvata con il controllo che nel piano
 * non c'è più (il piano è cambiato) si accoda, così nessuna voce registrata
 * resta senza numero.
 */
function raggruppaPerCategoriaEPiano(controlli) {
  const categorie = new Map();
  for (const c of controlli) {
    if (!categorie.has(c.categoria)) categorie.set(c.categoria, new Map());
    const piani = categorie.get(c.categoria);
    const chiave = c.piano_id || `tipo:${c.controllo}`;
    if (!piani.has(chiave)) {
      const voci = (c.piano_id ? S.azioniDelPiano(c.piano_id) : []).map((z) => ({
        id: z.id, testo: String(z.testo || '').trim(), condizionale: String(z.obbligatoria ?? '1') === '0' }));
      piani.set(chiave, { chiave, controllo: c.controllo, frequenza: c.frequenza, norma: c.norma, voci, righe: [] });
    }
    const g = piani.get(chiave);
    const numero = (v) => {
      let i = g.voci.findIndex((x) => (v.azione_id && x.id === v.azione_id) || x.testo === String(v.testo || '').trim());
      if (i < 0) { g.voci.push({ id: v.azione_id || '', testo: String(v.testo || '').trim(), condizionale: v.condizionale }); i = g.voci.length - 1; }
      return i + 1;
    };
    const numerate = c.verifiche.map((v) => ({ ...v, n: numero(v) }));
    const spuntabili = numerate.filter((v) => v.esito !== 'non si applica' && v.esito !== 'non eseguita' && v.esito !== '');
    g.righe.push({
      ...c,
      nonSpuntate: numerate.filter((v) => v.esito === 'non spuntata' || v.esito === 'difetto segnalato').map((v) => v.n),
      tutteNonSpuntate: spuntabili.length > 0 && spuntabili.every((v) => v.esito === 'non spuntata' || v.esito === 'difetto segnalato'),
      difettoSu: (numerate.find((v) => v.difetto) || {}).n || null,
      conVoci: numerate.length > 0,
    });
  }
  return [...categorie.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([categoria, piani]) => {
    const lista = [...piani.values()].sort((x, y) => x.controllo.localeCompare(y.controllo));
    for (const g of lista) {
      g.righe.sort((x, y) => x.impianto.localeCompare(y.impianto) || x.ubicazione.localeCompare(y.ubicazione)
        || x.presidio.localeCompare(y.presidio) || x.data.localeCompare(y.data));
    }
    const righe = lista.flatMap((g) => g.righe);
    return { categoria, presidi: new Set(righe.map((r) => r.asset_id)).size, controlli: righe.length, piani: lista };
  });
}

const CAMPI_CATEGORIA = ['presidi', 'controllati', 'pezzi', 'controlli', 'idonei', 'nonIdonei', 'nonEseguibili', 'anomalieNuove'];
const rigaVuota = (categoria) => ({ categoria, ...Object.fromEntries(CAMPI_CATEGORIA.map((k) => [k, 0])) });
const somma = (righe, nome = 'Totale') => righe.reduce((t, r) => {
  for (const k of CAMPI_CATEGORIA) t[k] += r[k];
  return t;
}, rigaVuota(nome));

/**
 * I presidi PER CATEGORIA (24/09/2026, dall'operatore: «il totale dei presidi
 * controllati, con subtotale delle categorie, sia per impianto sia in una pagina
 * generale»). Per ogni categoria:
 *  * `presidi`     quelli in anagrafica nel perimetro — esclusi i non previsti e
 *                  i dismessi (`sospendeLavoro`), che non chiedono controlli,
 *                  a meno che uno sia stato controllato lo stesso;
 *  * `controllati` quelli con almeno un controllo nel giro, e i loro `pezzi`;
 *  * `controlli` e i loro esiti: un presidio ne ha uno per piano di verifica;
 *  * `anomalieNuove` aperte in questo giro.
 * Tutte le categorie del perimetro, anche con zero controllati: «0 di 5» dice
 * che cosa non è stato sorvegliato.
 */
function presidiPerCategoria(presidi, controlli, nuove) {
  const perCat = new Map();
  const riga = (cat) => { if (!perCat.has(cat)) perCat.set(cat, rigaVuota(cat)); return perCat.get(cat); };
  const toccati = new Set(controlli.map((c) => c.asset_id));
  for (const a of presidi) {
    const toccato = toccati.has(a.id);
    if (!toccato && S.sospendeLavoro(a)) continue;
    const r = riga(categoriaParole(a));
    r.presidi += 1;
    if (toccato) { r.controllati += 1; r.pezzi += pezziDi(a); }
  }
  for (const c of controlli) {
    const r = riga(c.categoria);
    r.controlli += 1;
    if (c.esito === 'IDONEO') r.idonei += 1;
    else if (c.esito === 'NON_IDONEO') r.nonIdonei += 1;
    else if (['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(c.esito)) r.nonEseguibili += 1;
  }
  for (const an of nuove) riga(an.categoria).anomalieNuove += 1;
  const perCategoria = [...perCat.values()].sort((x, y) => x.categoria.localeCompare(y.categoria));
  return { perCategoria, totale: somma(perCategoria) };
}

/**
 * La pagina GENERALE di un PDF con più verbali: i totali di tutto il giro, le
 * categorie sommate su tutti gli impianti e una riga per impianto. Pura: somma
 * quello che i verbali dicono già, così i due livelli non possono divergere.
 */
export function riepilogoGenerale(lista) {
  const verbali = (lista || []).filter(Boolean);
  const perCat = new Map();
  for (const d of verbali) {
    for (const r of d.perCategoria) {
      if (!perCat.has(r.categoria)) perCat.set(r.categoria, rigaVuota(r.categoria));
      const t = perCat.get(r.categoria);
      for (const k of CAMPI_CATEGORIA) t[k] += r[k];
    }
  }
  const perCategoria = [...perCat.values()].sort((x, y) => x.categoria.localeCompare(y.categoria));
  const conteggi = {};
  for (const d of verbali) for (const [k, v] of Object.entries(d.conteggi)) conteggi[k] = (conteggi[k] || 0) + v;
  const sorveglianti = new Map();
  for (const d of verbali) {
    for (const x of d.intestazione.sorveglianti) {
      const t = sorveglianti.get(x.nome) || { nome: x.nome, matricola: '', ditta: [], controlli: 0, anomalie: 0 };
      t.matricola = t.matricola || x.matricola;
      t.ditta = [...new Set([...t.ditta, ...x.ditta])];
      t.controlli += x.controlli;
      t.anomalie += x.anomalie;
      sorveglianti.set(x.nome, t);
    }
  }
  const primo = (verbali[0] || {}).intestazione || {};
  return {
    intestazione: {
      unita: primo.unita || '',
      dal: verbali.map((d) => d.intestazione.dal).filter(Boolean).sort()[0] || '',
      impianti: verbali.map((d) => d.intestazione.impianto),
      sorveglianti: [...sorveglianti.values()].sort((x, y) => y.controlli - x.controlli || x.nome.localeCompare(y.nome)),
      tecniciDitta: [...new Set(verbali.flatMap((d) => d.intestazione.tecniciDitta))],
      dispositivo: primo.dispositivo || '',
    },
    perCategoria,
    totaleCategorie: somma(perCategoria),
    impianti: verbali.map((d) => ({ nome: d.intestazione.impianto, dati: d.impianto })),
    perImpianto: verbali.map((d) => ({ ...d.totaleCategorie, categoria: d.intestazione.impianto,
      riconfermate: d.conteggi.riconfermate, risolte: d.conteggi.risolte })),
    conteggi,
  };
}

/**
 * Un verbale per ogni impianto su cui nel giro è successo qualcosa — un
 * controllo, un'anomalia nuova, riconfermata o risolta (24/09/2026, dall'operatore:
 * «dovremmo poter generare tutti i rapporti in una sola volta»). Gli impianti
 * con sole anomalie aperte e mai riviste non hanno un verbale: nessuno li ha
 * sorvegliati in questo giro, e un verbale con dentro solo quelle chiederebbe
 * una firma su un lavoro che non c'è stato.
 */
export function datiVerbaliPerImpianto({ nonRiviste = true } = {}) {
  return (S.get().perEntita[E.IMPIANTO] || [])
    .filter((i) => !i.eliminato_il)
    .map((i) => datiVerbale({ impiantoId: i.id, nonRiviste }))
    .filter((d) => d.controlli.length || d.anomalie.nuove.length || d.anomalie.riconfermate.length
      || d.anomalie.risolte.length)
    .sort((x, y) => x.intestazione.impianto.localeCompare(y.intestazione.impianto));
}

/**
 * Chi FIRMA, prima di scaricare (25/09/2026, dall'operatore: «quando esportiamo
 * il pdf ci chieda prima di modificare i sorveglianti, rimuoverne, aggiungerne,
 * o anche gli operatori della ditta»).
 *
 * L'elenco proposto è l'unione di quelli dei verbali scelti, come i dati lo
 * ricavano (`datiVerbale`); chi lo corregge lo fa per QUESTO documento. Le
 * righe dei controlli non sono firme: dicono chi ha registrato il controllo, e
 * quello resta com'è — tranne un nome CORRETTO, che si corregge ovunque, perché
 * è la stessa persona scritta male.
 *
 * @returns `{ sorveglianti: [{ da, nome, matricola, controlli, anomalie }], tecnici: [{ da, nome }] }`
 *          — `da` è il nome come sta nei dati, e resta vuoto per chi si aggiunge.
 */
export function firmatariProposti(lista) {
  const sorveglianti = new Map();
  const tecnici = new Map();
  for (const d of (lista || []).filter(Boolean)) {
    for (const x of d.intestazione.sorveglianti) {
      const t = sorveglianti.get(x.nome) || { da: x.nome, nome: x.nome, matricola: x.matricola || '', controlli: 0, anomalie: 0 };
      t.matricola = t.matricola || x.matricola || '';
      t.controlli += x.controlli;
      t.anomalie += x.anomalie;
      sorveglianti.set(x.nome, t);
    }
    for (const n of d.intestazione.tecniciDitta) if (!tecnici.has(n)) tecnici.set(n, { da: n, nome: n });
  }
  return {
    sorveglianti: [...sorveglianti.values()].sort((x, y) => y.controlli - x.controlli || x.nome.localeCompare(y.nome)),
    tecnici: [...tecnici.values()],
  };
}

/**
 * I verbali con i firmatari scelti nel foglio. Pura: non tocca i dati del giro
 * né la lista ricevuta.
 *
 * - chi nei dati c'era e nella scelta non c'è più (o ha il nome vuoto) esce dalle
 *   firme e dall'intestazione — le righe dei controlli continuano a dire chi li
 *   ha registrati;
 * - un nome cambiato si cambia anche nelle righe e nelle anomalie;
 * - chi è aggiunto a mano (`da` vuoto) entra in OGNI verbale del documento, con
 *   zero controlli: firma perché era presente, non perché ha registrato.
 */
export function applicaFirmatari(lista, scelta) {
  const norm = (x) => String(x || '').trim();
  const sorv = ((scelta || {}).sorveglianti || []).map((x) => ({ ...x, da: norm(x.da), nome: norm(x.nome), matricola: norm(x.matricola) }));
  const tecn = ((scelta || {}).tecnici || []).map((x) => ({ da: norm(x.da), nome: norm(x.nome) }));
  // Nome nei dati → nome da stampare ('' = tolto). Chi non compare nella scelta è tolto anche lui.
  const rinomina = new Map(sorv.filter((x) => x.da).map((x) => [x.da, x.nome]));
  const matricola = new Map(sorv.filter((x) => x.nome).map((x) => [x.nome, x.matricola]));
  const aggiunti = sorv.filter((x) => !x.da && x.nome);
  const nomeRiga = (n) => (rinomina.get(n) || n);
  const tecnDa = new Map(tecn.filter((x) => x.da).map((x) => [x.da, x.nome]));
  const tecnAggiunti = tecn.filter((x) => !x.da && x.nome).map((x) => x.nome);

  return (lista || []).filter(Boolean).map((d) => {
    const unici = new Map();
    for (const x of d.intestazione.sorveglianti) {
      const nome = rinomina.has(x.nome) ? rinomina.get(x.nome) : '';
      if (!nome) continue;
      const t = unici.get(nome) || { ...x, nome, ditta: [...(x.ditta || [])], controlli: 0, anomalie: 0 };
      t.controlli += x.controlli;
      t.anomalie += x.anomalie;
      t.matricola = matricola.has(nome) ? matricola.get(nome) : (t.matricola || '');
      unici.set(nome, t);
    }
    for (const x of aggiunti) {
      if (!unici.has(x.nome)) unici.set(x.nome, { nome: x.nome, matricola: x.matricola, ditta: [], controlli: 0, anomalie: 0 });
    }
    const tecnici = [...new Set([
      ...d.intestazione.tecniciDitta.map((n) => (tecnDa.has(n) ? tecnDa.get(n) : '')).filter(Boolean),
      ...tecnAggiunti,
    ])];
    const riga = (r) => ({ ...r, sorvegliante: nomeRiga(r.sorvegliante) });
    const anomalie = Object.fromEntries(Object.entries(d.anomalie)
      .map(([k, righe]) => [k, righe.map((r) => ({ ...r, mani: [...new Set((r.mani || []).map(nomeRiga))] }))]));
    return {
      ...d,
      intestazione: { ...d.intestazione, sorveglianti: [...unici.values()], tecniciDitta: tecnici },
      controlli: d.controlli.map(riga),
      anomalie,
      gruppi: d.gruppi.map((g) => ({ ...g, piani: g.piani.map((p) => ({ ...p, righe: p.righe.map(riga) })) })),
    };
  });
}

// --------------------------------------------------------------------------- //
// Il disegno
// --------------------------------------------------------------------------- //
const M = 36;                              // margine
const LARGA = A4.larghezza - 2 * M;        // larghezza utile
const FONDO = A4.altezza - 46;             // sotto questa y si va a pagina nuova (resta il piè)
const RIGA = 1.25;                         // interlinea, in corpi

/** Un verbale solo: `Uint8Array`. */
export function pdfVerbale(dati, opzioni = {}) {
  return pdfVerbali([dati], opzioni);
}

/**
 * Uno o più verbali nello STESSO PDF (24/09/2026: «un pdf unico con tutti i
 * verbali di tutti gli impianti»). Ognuno comincia su una pagina nuova, ha le sue
 * firme e numera le SUE pagine («pagina 2 di 3»): si stampa tutto insieme e si
 * separa per impianto senza che un foglio parli di un altro.
 *
 * @param lista    risultati di `datiVerbale()`
 * @param opzioni  `{ versione, adesso }` (adesso: ISO; le prove lo fissano)
 */
export function pdfVerbali(lista, { versione = '', adesso = new Date().toISOString() } = {}) {
  const verbali = (lista || []).filter(Boolean);
  const mesi = periodoMesi(verbali, adesso);
  const titoloDoc = verbali.length === 1
    ? `Controlli antincendio ${mesi}${verbali[0].intestazione.impianto ? ` - ${verbali[0].intestazione.impianto}` : ''}`
    : `Controlli antincendio ${mesi} - ${verbali.length} impianti`;
  const doc = nuovoDocumento({ titolo: titoloDoc,
    autore: [...new Set(verbali.flatMap((d) => d.intestazione.sorveglianti.map((x) => x.nome)))].join(', ') });
  const pagineDi = [];   // per pagina: l'indice del verbale, GENERALE per il riepilogo
  // Con più verbali, in testa la pagina GENERALE (24/09/2026, dall'operatore: «una
  // pagina generale che ingloba il totale del controllo e i vari subtotali»),
  // con il foglio da cui comincia ogni verbale. I fogli si contano scrivendo
  // prima tutto su documenti di prova: il riepilogo sta davanti, e i numeri
  // che deve stampare dipendono da quello che viene dopo.
  if (verbali.length > 1) {
    const generale = riepilogoGenerale(verbali);
    const quante = (scrivi) => { const d = nuovoDocumento(); scrivi(d); return d.numeroPagine; };
    const fogliGenerale = quante((d) => scriviGenerale(d, generale, { versione, adesso, mesi, partenze: verbali.map(() => 0), onPagina: () => {} }));
    const partenze = [];
    let foglio = fogliGenerale + 1;
    for (const dati of verbali) {
      partenze.push(foglio);
      foglio += quante((d) => scriviVerbale(d, dati, { versione, adesso, onPagina: () => {} }));
    }
    scriviGenerale(doc, generale, { versione, adesso, mesi, partenze, onPagina: () => pagineDi.push(GENERALE) });
  }
  verbali.forEach((dati, k) => scriviVerbale(doc, dati, { versione, adesso, onPagina: () => pagineDi.push(k) }));
  if (!verbali.length) { doc.pagina(); pagineDi.push(-1); doc.testo(M, 80, 'Nessun verbale: in questo giro non risulta niente da sorvegliare.', { corpo: 11 }); }

  // Piè di pagina: le pagine di OGNI verbale, e il totale del file.
  const n = doc.numeroPagine;
  for (let p = 1; p <= n; p += 1) {
    const k = pagineDi[p - 1];
    const sue = pagineDi.filter((x) => x === k).length;
    const iesima = pagineDi.slice(0, p).filter((x) => x === k).length;
    doc.suPagina(p);
    doc.linea(M, A4.altezza - 34, M + LARGA, A4.altezza - 34, { grigio: 0.7 });
    doc.testo(M, A4.altezza - 22, `Scudo Campo ${versione} · stampato il ${dataIt(adesso)}`
      + (verbali.length > 1 ? ` · foglio ${p} di ${n} del file` : ''), { corpo: 7, grigio: 0.4 });
    const di = k === GENERALE ? 'del riepilogo' : 'del verbale';
    doc.testo(M + LARGA - (k === GENERALE ? 98 : 92), A4.altezza - 22, `pagina ${iesima} di ${sue} ${di}`, { corpo: 7, grigio: 0.4 });
  }
  return doc.bytes();
}

const GENERALE = -2;

/** «dal 24/09/2026 al 25/09/2026». */
function periodo(dal, adesso) {
  return dal ? `dal ${dataIt(dal).slice(0, 10)} al ${dataIt(adesso).slice(0, 10)}` : `al ${dataIt(adesso).slice(0, 10)}`;
}

/** «Mario Rossi (matr. 1) — 3 controlli, 1 anomalia; …» */
function testoSorveglianti(elenco) {
  return elenco.map((x) => `${x.nome}${x.matricola ? ` (matr. ${x.matricola})` : ''}`
    + ` — ${x.controlli} controll${x.controlli === 1 ? 'o' : 'i'}${x.anomalie ? `, ${x.anomalie} anomali${x.anomalie === 1 ? 'a' : 'e'}` : ''}`).join('; ');
}

/** Le due righe del riquadro dei numeri. */
function righeRiepilogo(c) {
  return [
    `Presidi controllati: ${c.presidi} (${c.pezzi} pezzi) — controlli registrati ${c.controlli}: idonei ${c.idonei}, `
      + `non idonei ${c.nonIdonei}, non eseguibili ${c.nonEseguibili}.`,
    `Anomalie: ${c.nuove} nuove · ${c.riconfermate} già aperte e riconfermate${c.modificate ? ` (${c.modificate} modificate)` : ''} · `
      + `${c.risolte} risolte · ${c.nonRiviste} aperte e non riviste in questo giro.`,
  ];
}

/**
 * La tabella dei presidi per categoria (o per impianto: stesse colonne), con la
 * riga del totale. `prima`: il titolo della prima colonna; `sotto(r)`: una riga
 * grigia sotto il nome (il foglio da cui comincia il verbale di un impianto).
 */
function tabellaCategorie(p, righe, totale, { prima = 'Categoria', sotto = null, anomalie = false } = {}) {
  const n = (x) => String(x);
  const colonne = [
    { titolo: prima, larghezza: anomalie ? 0.22 : 0.27 }, { titolo: 'Presidi controllati', larghezza: 0.14 },
    { titolo: 'Pezzi controllati', larghezza: 0.09 }, { titolo: 'Controlli', larghezza: 0.09 },
    { titolo: 'Idonei', larghezza: 0.08 }, { titolo: 'Non idonei', larghezza: 0.08 },
    { titolo: 'Non eseguibili', larghezza: 0.1 },
    anomalie ? { titolo: 'Anomalie nuove · riconf. · risolte', larghezza: 0.2 } : { titolo: 'Anomalie nuove', larghezza: 0.15 },
  ];
  const cella = (r, grassetto) => [
    [{ testo: r.categoria, grassetto: true }, sotto && !grassetto ? { testo: sotto(r), corpo: 7, grigio: 0.35 } : null].filter(Boolean),
    [{ testo: `${r.controllati} di ${r.presidi}`, grassetto }],
    [{ testo: n(r.pezzi), grassetto }], [{ testo: n(r.controlli), grassetto }],
    [{ testo: n(r.idonei), grassetto }], [{ testo: n(r.nonIdonei), grassetto: grassetto || r.nonIdonei > 0 }],
    [{ testo: n(r.nonEseguibili), grassetto }],
    [{ testo: anomalie ? `${r.anomalieNuove} · ${r.riconfermate} · ${r.risolte}` : n(r.anomalieNuove), grassetto }],
  ];
  // Nelle righe solo le categorie in cui nel giro è successo qualcosa; le altre
  // in una riga di testo sotto, con quanti presidi hanno in anagrafica. Visto nel
  // primo PDF: ventidue righe, diciassette di zeri, e i numeri che contano
  // sparivano in mezzo. Il TOTALE resta su tutte.
  const toccate = righe.filter((r) => r.controllati || r.controlli || r.anomalieNuove || r.riconfermate || r.risolte);
  const ferme = righe.filter((r) => !toccate.includes(r));
  p.tabella(colonne, [...toccate.map((r) => cella(r, false)), cella({ ...totale, categoria: 'TOTALE' }, true)]);
  if (ferme.length) {
    p.paragrafo(`Nessun presidio controllato in questo giro (in anagrafica): ${ferme.map((r) => `${r.categoria} ${r.presidi}`).join(' · ')}.`,
      { corpo: 7, grigio: 0.25, dopo: 4 });
  }
}

/**
 * La pagina GENERALE di un PDF con più verbali: i totali, le categorie su tutti
 * gli impianti, una riga per impianto con il foglio da cui comincia il suo
 * verbale. Non ha firme: si firma ogni verbale.
 */
function scriviGenerale(doc, g, { versione, adesso, mesi, partenze, onPagina }) {
  const h = g.intestazione;
  // Il titolo è il PERIODO dei controlli (25/09/2026, dall'operatore: «non
  // dovrebbe chiamarsi riepilogo generale ma qualcosa tipo "controlli
  // antincendio gen-feb 2026"»): è così che il documento si cerca in un archivio.
  const p = penna(doc, { testata: `Controlli antincendio ${mesi} — riepilogo`, destra: `${h.impianti.length} impianti`, onPagina });
  p.nuovaPagina();
  p.paragrafo(`CONTROLLI ANTINCENDIO ${mesi.toUpperCase()}`, { corpo: 15, grassetto: true, dopo: 2 });
  p.paragrafo('riepilogo di tutti gli impianti del giro — seguono i verbali dei singoli impianti, ciascuno con le sue firme',
    { corpo: 10, grigio: 0.35, dopo: 8 });
  p.campi([
    ['Committente', h.unita || '—'],
    ['Periodo del giro', periodo(h.dal, adesso)],
    ['Impianti', `${h.impianti.length}: ${h.impianti.join(', ')}`],
    [h.sorveglianti.length === 1 ? 'Sorvegliante' : 'Sorveglianti', testoSorveglianti(h.sorveglianti) || '—'],
    ['Ditta manutentrice', testoDitta(h.tecniciDitta)],
    ['Stampato il', `${dataIt(adesso)} · Scudo Campo ${versione}${h.dispositivo ? ` · dispositivo ${h.dispositivo}` : ''}`],
  ]);
  p.riquadro(righeRiepilogo(g.conteggi));
  p.titolo('Presidi controllati, per categoria — tutti gli impianti', 10);
  tabellaCategorie(p, g.perCategoria, g.totaleCategorie);
  p.paragrafo('«Presidi controllati»: quelli con almeno un controllo nel giro, su quelli in anagrafica negli impianti '
    + 'di questo file (esclusi i non previsti e i dismessi). Un presidio ha un controllo per ogni piano di verifica: '
    + 'per questo i controlli sono più dei presidi.', { corpo: 7, grigio: 0.35, dopo: 6 });
  p.titolo('Per impianto', 10);
  const tot = { ...g.totaleCategorie, riconfermate: g.perImpianto.reduce((t, r) => t + r.riconfermate, 0),
    risolte: g.perImpianto.reduce((t, r) => t + r.risolte, 0) };
  tabellaCategorie(p, g.perImpianto, tot, { prima: 'Impianto', anomalie: true,
    sotto: (r) => `verbale dal foglio ${partenze[g.perImpianto.indexOf(r)]}` });
  // Gli impianti, con i loro dati (25/09/2026: il frontespizio unico riporta
  // «i vari impianti»); il resto dei dati sta nel frontespizio di ogni verbale.
  p.titolo('Gli impianti', 10);
  const val = (d, k) => (d.find(([x]) => x === k) || [])[1] || '—';
  p.tabella([
    { titolo: 'Impianto', larghezza: 0.16 }, { titolo: 'Indirizzo e posizione', larghezza: 0.32 },
    { titolo: 'Attività (DPR 151/2011)', larghezza: 0.14 }, { titolo: 'SCIA', larghezza: 0.16 }, { titolo: 'CPI', larghezza: 0.22 },
  ], g.impianti.map((d) => [
    [{ testo: d.nome, grassetto: true }],
    [{ testo: val(d.dati, 'Indirizzo') }, { testo: val(d.dati, 'Posizione'), corpo: 7, grigio: 0.35 }],
    [{ testo: val(d.dati, 'Attività (DPR 151/2011)') }],
    [{ testo: val(d.dati, 'SCIA') }],
    [{ testo: val(d.dati, 'CPI') }],
  ]));
  // Le firme e i timbri delle due parti, per TUTTI gli impianti elencati.
  firme(p, doc, {
    titolo: 'Firme e timbri',
    testo: `Il presente riepilogo e i ${h.impianti.length} verbali che seguono riguardano gli impianti: ${h.impianti.join(', ')}. `
      + 'I controlli sono stati eseguiti dalla ditta manutentrice alla presenza dei sorveglianti del committente qui '
      + 'indicati, che ne hanno registrato gli esiti. La ditta manutentrice firma per presa visione.',
    sorveglianti: h.sorveglianti,
    tecnici: h.tecniciDitta,
  });
}

/**
 * Gli attrezzi di scrittura di una sezione del PDF: pagina nuova con la testata,
 * paragrafi, titoli, tabelle che vanno a capo e a pagina nuova. `y` è la
 * posizione corrente (dall'alto), leggibile e scrivibile da chi disegna.
 */
function penna(doc, { testata, destra, onPagina }) {
  let y = 0;

  const nuovaPagina = () => {
    doc.pagina();
    onPagina();
    doc.testo(M, 26, testata, { grassetto: true, corpo: 9, grigio: 0.35 });
    doc.testo(M + LARGA - 170, 26, destra, { corpo: 9, grigio: 0.35 });
    doc.linea(M, 32, M + LARGA, 32, { grigio: 0.6 });
    y = 48;
  };
  const spazio = (serve) => { if (y + serve > FONDO) nuovaPagina(); };
  const paragrafo = (testo, { corpo = 9, grassetto = false, grigio = 0, dopo = 4, rientro = 0 } = {}) => {
    for (const r of aCapo(testo, grassetto, corpo, LARGA - rientro)) {
      spazio(corpo * RIGA);
      doc.testo(M + rientro, y + corpo, r, { corpo, grassetto, grigio });
      y += corpo * RIGA;
    }
    y += dopo;
  };
  // Un titolo non resta da solo in fondo alla pagina: si porta con sé lo
  // spazio per l'intestazione di una tabella e una riga (visto nel primo PDF:
  // «2.4 …» in fondo alla pagina 2, la tabella alla 3).
  const titolo = (testo, corpo = 12) => { spazio(corpo * 3 + 70); y += 6; paragrafo(testo, { corpo, grassetto: true, dopo: 2 }); };

  const CORPO_T = 8;
  const PAD = 3;
  /** L'intestazione grigia di una tabella; va a capo anche lei («Data e
   *  sorvegliante» in una colonna stretta usciva nella colonna accanto). */
  const intestazioneDi = (colonne, larghezze) => {
    const titoli = colonne.map((c, i) => aCapo(c.titolo, true, CORPO_T, larghezze[i] - 2 * PAD));
    const hh = Math.max(...titoli.map((t) => t.length)) * CORPO_T * RIGA + 2 * PAD;
    // `riserva`: l'altezza della riga che deve seguire l'intestazione sulla
    // stessa pagina. Due righe di testo (20 punti) non bastavano: una riga vera ne
    // occupa 30 e più, e l'intestazione restava sola in fondo alla pagina
    // (misurato: un verbale di 43 pagine ne aveva due così).
    const disegna = (riserva = CORPO_T * RIGA * 2) => {
      spazio(hh + riserva);
      doc.rettangolo(M, y, LARGA, hh, { riempi: 0.9, bordo: 0 });
      let x = M;
      titoli.forEach((righe, i) => {
        righe.forEach((r, k) => doc.testo(x + PAD, y + PAD + CORPO_T + k * CORPO_T * RIGA, r, { corpo: CORPO_T, grassetto: true }));
        x += larghezze[i];
      });
      y += hh;
    };
    return { disegna, hh };
  };
  const lineeDi = (pezzi, w) => pezzi.flatMap((q) => aCapo(q.testo, q.grassetto, q.corpo || CORPO_T, w - 2 * PAD)
    .map((r) => ({ ...q, testo: r })));
  const altDi = (l) => l.reduce((t, q) => t + (q.corpo || CORPO_T) * RIGA, 0) + 2 * PAD;
  const scriviLinee = (l, x, y0) => {
    let yy = y0 + PAD;
    for (const q of l) {
      const c = q.corpo || CORPO_T;
      doc.testo(x + PAD, yy + c, q.testo, { corpo: c, grassetto: q.grassetto, grigio: q.grigio || 0 });
      yy += c * RIGA;
    }
  };

  /**
   * Una tabella che va a capo dentro le celle e a pagina nuova fra le righe,
   * ripetendo l'intestazione. `colonne`: [{ titolo, larghezza (frazione) }];
   * `righe`: per cella un elenco di pezzi { testo, grassetto, grigio, corpo }.
   */
  const tabella = (colonne, righe) => {
    const larghezze = colonne.map((c) => c.larghezza * LARGA);
    const corpo = 8;
    const pad = 3;
    // L'intestazione va a capo anche lei: «Data e sorvegliante» in una colonna
    // stretta usciva nella colonna accanto (visto nel PDF del 24/09/2026).
    const { disegna: intestazione } = intestazioneDi(colonne, larghezze);
    const misurate = righe.map((celle) => {
      const linee = celle.map((pezzi, i) => pezzi.flatMap((p) => aCapo(p.testo, p.grassetto, p.corpo || corpo,
        larghezze[i] - 2 * pad).map((r) => ({ ...p, testo: r }))));
      return { linee, alt: Math.max(...linee.map((l) => l.reduce((t, p) => t + (p.corpo || corpo) * RIGA, 0))) + 2 * pad };
    });
    // L'intestazione non resta sola: con lei ci dev'essere spazio per la prima riga vera.
    intestazione(misurate.length ? misurate[0].alt : undefined);
    for (const { linee, alt } of misurate) {
      if (y + alt > FONDO) { nuovaPagina(); intestazione(alt); }
      let x = M;
      linee.forEach((l, i) => {
        let yy = y + pad;
        for (const p of l) {
          const c = p.corpo || corpo;
          doc.testo(x + pad, yy + c, p.testo, { corpo: c, grassetto: p.grassetto, grigio: p.grigio || 0 });
          yy += c * RIGA;
        }
        x += larghezze[i];
      });
      doc.linea(M, y + alt, M + LARGA, y + alt, { grigio: 0.75, spessore: 0.4 });
      y += alt;
    }
    y += 6;
  };

  // Righe «etichetta: valore», con il valore che va a capo.
  const campi = (coppie, { corpo = 9, etichetta: we = 110 } = {}) => {
    for (const [etichetta, valore] of coppie) {
      const r = aCapo(valore, false, corpo, LARGA - we);
      spazio(Math.max(1, r.length) * corpo * RIGA + 2);
      doc.testo(M, y + corpo, `${etichetta}:`, { corpo, grassetto: true });
      r.forEach((riga, i) => doc.testo(M + we, y + corpo + i * corpo * RIGA, riga, { corpo }));
      y += Math.max(1, r.length) * corpo * RIGA + 2;
    }
    y += 6;
  };
  // Un riquadro grigio con i numeri principali.
  const riquadro = (righe) => {
    const alt = righe.reduce((t, r) => t + aCapo(r, false, 9, LARGA - 16).length, 0) * 9 * RIGA + 14;
    spazio(alt);
    doc.rettangolo(M, y, LARGA, alt, { riempi: 0.95, bordo: 0.5 });
    let yr = y + 7;
    for (const r of righe) for (const riga of aCapo(r, false, 9, LARGA - 16)) { doc.testo(M + 8, yr + 9, riga, { corpo: 9 }); yr += 9 * RIGA; }
    y += alt + 6;
  };
  return {
    get y() { return y; },
    set y(v) { y = v; },
    nuovaPagina, spazio, paragrafo, titolo, tabella, campi, riquadro,
  };
}

function scriviVerbale(doc, dati, { versione, adesso, onPagina }) {
  const h = dati.intestazione;
  const p = penna(doc, { testata: 'Verbale di sorveglianza dei controlli antincendio',
    destra: h.impianto || `${h.impianti.length} impianti`, onPagina });
  const { nuovaPagina, paragrafo, titolo, tabella } = p;
  // ---- frontespizio: chi, dove, quando, l'impianto e i numeri --------------- //
  // ⛔ Redatto dal COMMITTENTE (24/09/2026, dall'operatore: il verbale deve
  // potersi mostrare «come redatto dal committente che ha sorvegliato la ditta
  // antincendio»). Gli operatori di Scudo Campo sono i SORVEGLIANTI: non hanno
  // eseguito i controlli, li hanno sorvegliati e registrati.
  nuovaPagina();
  paragrafo('VERBALE DI SORVEGLIANZA DEI CONTROLLI ANTINCENDIO', { corpo: 15, grassetto: true, dopo: 2 });
  paragrafo('eseguiti dalla ditta manutentrice, redatto dal committente', { corpo: 10, grigio: 0.35, dopo: 8 });
  p.campi([
    ['Committente', h.unita || '—'],
    ['Impianto', h.impianto || `tutti quelli del giro (${h.impianti.join(', ') || 'nessuno'})`],
    ['Periodo del giro', periodo(h.dal, adesso)],
    [h.sorveglianti.length === 1 ? 'Sorvegliante' : 'Sorveglianti', testoSorveglianti(h.sorveglianti) || '—'],
    ['Ditta manutentrice', testoDitta(h.tecniciDitta)],
    ['Stampato il', `${dataIt(adesso)} · Scudo Campo ${versione}${h.dispositivo ? ` · dispositivo ${h.dispositivo}` : ''}`],
  ]);
  // I dati dell'impianto (25/09/2026, dall'operatore: «nel frontespizio andrebbero
  // riportati i dati dell'impianto: indirizzo, geolocalizzazione, attività, SCIA,
  // CPI, scadenza CPI…»). Solo quelli che l'archivio ha: una riga vuota non si scrive.
  if (dati.impianto.length) {
    titolo('Dati dell\'impianto', 10);
    p.campi(dati.impianto, { corpo: 8, etichetta: 135 });
  }
  p.riquadro(righeRiepilogo(dati.conteggi));
  // I presidi controllati PER CATEGORIA (24/09/2026, dall'operatore: «il totale
  // dei presidi controllati, con subtotale delle categorie»).
  titolo('Presidi controllati, per categoria', 10);
  tabellaCategorie(p, dati.perCategoria, dati.totaleCategorie);
  paragrafo('«Presidi controllati»: quelli con almeno un controllo nel giro, su quelli in anagrafica (esclusi i non '
    + 'previsti e i dismessi). Un presidio ha un controllo per ogni piano di verifica: per questo i controlli sono più '
    + 'dei presidi.', { corpo: 7, grigio: 0.35, dopo: 4 });

  // ---- 1. i controlli, per tipo di presidio e per piano -------------------- //
  // (25/09/2026, dall'operatore: le verifiche previste spiegate UNA volta per
  // gruppo, e nelle righe solo quello che se ne discosta — da centinaia di pagine
  // a poche).
  titolo('1. Controlli eseguiti dalla ditta e sorvegliati');
  if (!dati.controlli.length) paragrafo('Nessun controllo registrato in questo giro.', { grigio: 0.4 });
  else {
    paragrafo('Divisi per tipo di presidio e per piano. Per ogni piano le verifiche previste, numerate, una volta sola: '
      + 'nelle righe dei presidi c\'è solo quello che se ne discosta — le voci non spuntate, la voce a cui si riferisce il '
      + 'difetto, la nota dell\'anomalia. Le voci «solo se si applica» valgono solo per certi pezzi.',
    { corpo: 7, grigio: 0.35, dopo: 4 });
    dati.gruppi.forEach((cat, k) => {
      titolo(`1.${k + 1} ${cat.categoria} — ${cat.presidi} ${cat.presidi === 1 ? 'presidio' : 'presidi'}, `
        + `${cat.controlli} ${cat.controlli === 1 ? 'controllo' : 'controlli'}`, 11);
      for (const g of cat.piani) {
        // L'intestazione del piano, con le sue verifiche: una volta sola. Il
        // blocco non si spezza e non resta in fondo alla pagina senza la sua
        // tabella (visto nel primo PDF: «Sorveglianza visiva» e le sue otto voci
        // in fondo alla pagina, i presidi alla pagina dopo, e le ultime voci di un
        // altro piano in cima alla pagina, staccate dal loro titolo): si tiene
        // insieme tutto, più l'intestazione della tabella e la prima riga.
        const righeVoci = g.voci.reduce((t, v, i) => t + aCapo(`${i + 1}. ${v.testo}${v.condizionale ? ' (solo se si applica)' : ''}`,
          false, 7, LARGA - 8).length, 0);
        p.spazio(9 * RIGA + 18 + (g.voci.length ? (righeVoci + 1) * 7 * RIGA + 5 : 0) + 55);
        p.y += 4;
        paragrafo(g.controllo, { corpo: 9, grassetto: true, dopo: 1 });
        const sotto = [g.frequenza, g.norma].filter(Boolean).join(' · ');
        if (sotto) paragrafo(sotto, { corpo: 7, grigio: 0.35, dopo: 2 });
        if (g.voci.length) {
          paragrafo(`Verifiche previste (${g.voci.length}):`, { corpo: 7, grigio: 0.25, dopo: 1 });
          g.voci.forEach((v, i) => paragrafo(`${i + 1}. ${v.testo}${v.condizionale ? ' (solo se si applica)' : ''}`,
            { corpo: 7, grigio: 0.25, dopo: 0, rientro: 8 }));
          p.y += 4;
        }
        tabella([
          { titolo: 'Presidio e ubicazione', larghezza: 0.33 }, { titolo: 'Data e sorvegliante', larghezza: 0.16 },
          { titolo: 'Esito', larghezza: 0.14 }, { titolo: 'Verifiche, anomalia e note', larghezza: 0.37 },
        ], g.righe.map((x) => {
          const nonEseguibile = ['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(x.esito);
          const verifiche = nonEseguibile || !x.conVoci ? null
            : x.tutteNonSpuntate ? { testo: 'nessuna voce spuntata', corpo: 7 }
              : x.nonSpuntate.length ? { testo: `non spuntate: n. ${x.nonSpuntate.join(', ')}`, corpo: 7 }
                : { testo: 'tutte eseguite', corpo: 7, grigio: 0.35 };
          return [
            [{ testo: x.presidio, grassetto: true },
              { testo: [h.impianto ? '' : x.impianto, x.ubicazione].filter(Boolean).join(' · '), grigio: 0.35, corpo: 7 }],
            [{ testo: dataIt(x.data) }, x.sorvegliante ? { testo: x.sorvegliante, corpo: 7, grigio: 0.35 } : null].filter(Boolean),
            [{ testo: x.esitoParole, grassetto: x.esito !== 'IDONEO' },
              x.pezziGuasti ? { testo: `pezzi guasti: ${x.pezziGuasti}`, corpo: 7 } : null].filter(Boolean),
            [verifiche,
              x.difettoSu ? { testo: `difetto sulla n. ${x.difettoSu}`, corpo: 7, grassetto: true } : null,
              x.anomaliaNota ? { testo: `Anomalia: ${x.anomaliaNota}`, corpo: 7, grassetto: true } : null,
              x.note ? { testo: `Note: ${x.note}`, corpo: 7 } : null].filter(Boolean),
          ];
        }));
      }
    });
  }

  // ---- 2. le anomalie ------------------------------------------------------ //
  titolo('2. Anomalie');
  paragrafo('Divise per quello che è successo in questo giro. In grassetto la descrizione dell\'anomalia; '
    + '«Riguarda la verifica»: quella del piano a cui il difetto si riferisce, se il sorvegliante l\'ha indicata. '
    + '«Uso»: se con il difetto il presidio si può usare.',
  { corpo: 8, grigio: 0.35, dopo: 6 });
  const tabellaAnomalie = (righe, date) => tabella([
    { titolo: 'Presidio e ubicazione', larghezza: 0.3 }, { titolo: 'Anomalia', larghezza: 0.4 },
    { titolo: 'Uso', larghezza: 0.13 }, { titolo: 'Date', larghezza: 0.17 },
  ], righe.map((r) => [
    [{ testo: r.presidio, grassetto: true }, { testo: [h.impianto ? '' : r.impianto, r.ubicazione].filter(Boolean).join(' · '), grigio: 0.35, corpo: 7 }],
    // «Nota dell'operatore» SOLO dove la descrizione l'ha composta un controllo:
    // le anomalie del censimento hanno un testo che nessun operatore ha scritto,
    // e chiamarlo così nel documento da firmare sarebbe falso.
    // ⚠️ Le anomalie registrate PRIMA del 25/09/2026 portano l'elenco delle voci
    // lasciate senza spunta: si riporta com'è stato registrato, e si dice che
    // cos'è — non un giudizio voce per voce (al punto 1 quelle voci sono «non
    // spuntate»), ma quello che la registrazione di allora ci aggiungeva.
    [r.daControllo
      ? (r.nota ? { testo: `Nota dell'operatore: ${r.nota}`, grassetto: true } : { testo: 'Nessuna nota scritta', grigio: 0.4 })
      : { testo: r.nota || '(senza descrizione)', grassetto: true },
      r.collegata ? { testo: `Riguarda la verifica: ${r.collegata}`, corpo: 7 } : null,
      ...(r.daControllo ? [{ testo: `Voci lasciate senza spunta alla registrazione (${r.verifiche.length}), `
        + 'che allora si aggiungevano da sole come «non idonee»:', corpo: 7, grigio: 0.25 },
      ...r.verifiche.map((v) => ({ testo: `• ${v}`, corpo: 7, grigio: 0.25 }))] : []),
      r.modificata ? { testo: 'Modificata in questo giro.', corpo: 7, grassetto: true } : null,
      r.note_chiusura ? { testo: `Chiusura: ${r.note_chiusura}`, corpo: 7 } : null,
      r.mani.length ? { testo: `Sorvegliante: ${r.mani.join(', ')}`, corpo: 7, grigio: 0.35 } : null].filter(Boolean),
    [{ testo: r.blocca === true ? "Impedisce l'uso" : r.blocca === false ? 'Si può usare' : '—', grassetto: r.blocca === true },
      r.gravita ? { testo: `gravità ${r.gravita.toLowerCase()}`, corpo: 7, grigio: 0.35 } : null].filter(Boolean),
    date(r).filter(([, v]) => v).map(([k, v]) => ({ testo: `${k} ${dataIt(v).slice(0, 10)}`, corpo: 7 })),
  ]));
  const sezioni = [
    ['2.1 Nuove — aperte in questo giro', dati.anomalie.nuove, (r) => [['aperta il', r.aperta_il]]],
    ['2.2 Già aperte e riconfermate in questo giro', dati.anomalie.riconfermate,
      (r) => [['aperta il', r.aperta_il], ['riconfermata il', r.riconfermata_il]]],
    ['2.3 Risolte in questo giro', dati.anomalie.risolte, (r) => [['aperta il', r.aperta_il], ['chiusa il', r.chiusa_il]]],
    ['2.4 Aperte e non riviste in questo giro', dati.anomalie.nonRiviste, (r) => [['aperta il', r.aperta_il],
      ['ultima conferma', r.riconfermata_il]]],
  ];
  for (const [t, righe, date] of sezioni) {
    titolo(`${t} (${righe.length})`, 10);
    if (righe.length) tabellaAnomalie(righe, date);
    else paragrafo('Nessuna.', { grigio: 0.4 });
  }

  // ---- 3. le firme ------------------------------------------------------- //
  firme(p, doc, {
    titolo: '3. Firme e timbri',
    testo: 'Verbale redatto dal committente. I controlli elencati al punto 1 sono stati eseguiti dalla ditta '
      + 'manutentrice alla presenza dei sorveglianti del committente qui indicati, che ne hanno registrato gli '
      + 'esiti; al punto 2 le anomalie. La ditta manutentrice firma per presa visione.',
    sorveglianti: h.sorveglianti,
    tecnici: h.tecniciDitta,
  });
}

/** Il campo «Ditta manutentrice»: i tecnici scritti nel giro, o dove si scrivono. */
function testoDitta(tecnici) {
  return tecnici.length ? `tecnici presenti: ${tecnici.join(', ')}`
    : 'non indicata nel giro (sul telefono: «Dati del controllo» › «Operatore ditta manutentrice»)';
}

/**
 * Le firme delle due parti, con il TIMBRO (25/09/2026). I sorveglianti firmano
 * per il committente, i tecnici della ditta per presa visione: uno per riga, con
 * il nome già scritto quando il giro lo conosce.
 */
function firme(p, doc, { titolo, testo, sorveglianti, tecnici }) {
  const w = (LARGA - 16) / 2;
  const TIMBRO = 62;
  const nS = Math.max(1, sorveglianti.length);
  const nT = Math.max(1, tecnici.length);
  const alt = Math.max(36 + nS * 30, 36 + nT * 30 + 24) + TIMBRO + 16;
  p.spazio(alt + 110);
  p.titolo(titolo);
  p.paragrafo(testo, { corpo: 9, dopo: 10 });
  const y = p.y;
  const persone = (x0, elenco) => (elenco.length ? elenco : ['']).forEach((nome, i) => {
    const yy = y + 42 + i * 30;
    doc.testo(x0 + 8, yy, nome || 'Nome e cognome:', { corpo: 8, grigio: nome ? 0 : 0.35 });
    doc.testo(x0 + 8, yy + 11, 'Firma:', { corpo: 7, grigio: 0.35 });
    doc.linea(x0 + 40, yy + 12, x0 + w - 10, yy + 12, { grigio: 0.5 });
  });
  const timbro = (x0) => {
    doc.rettangolo(x0 + 8, y + alt - TIMBRO - 8, 130, TIMBRO, { bordo: 0.4 });
    doc.testo(x0 + 12, y + alt - TIMBRO, 'Timbro', { corpo: 7, grigio: 0.45 });
  };
  doc.rettangolo(M, y, w, alt, { bordo: 0.6 });
  doc.testo(M + 8, y + 16, `Per il committente — ${sorveglianti.length === 1 ? 'il sorvegliante' : 'i sorveglianti'}`, { corpo: 9, grassetto: true });
  persone(M, sorveglianti.map((x) => x.nome));
  timbro(M);
  const x2 = M + w + 16;
  doc.rettangolo(x2, y, w, alt, { bordo: 0.6 });
  doc.testo(x2 + 8, y + 16, 'Per la ditta manutentrice — per presa visione', { corpo: 9, grassetto: true });
  persone(x2, tecnici);
  const yData = y + 42 + nT * 30;
  doc.testo(x2 + 8, yData, 'Data:', { corpo: 8, grigio: 0.35 });
  doc.linea(x2 + 40, yData + 1, x2 + w - 10, yData + 1, { grigio: 0.5 });
  timbro(x2);
  p.y = y + alt + 10;
}

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/**
 * Il PERIODO dei controlli a mesi: «set 2026», «gen-feb 2026», «dic 2025-gen
 * 2026» (25/09/2026, dall'operatore). Dalle DATE dei controlli dei verbali, non
 * dal giorno in cui si stampa: un giro di febbraio stampato a marzo è di
 * febbraio. Senza controlli, dall'inizio del giro a oggi.
 */
export function periodoMesi(lista, adesso = new Date().toISOString()) {
  const verbali = (Array.isArray(lista) ? lista : [lista]).filter(Boolean);
  const giorno = (iso) => { const [g, m, a] = dataIt(iso).slice(0, 10).split('/'); return a ? `${a}-${m}-${g}` : ''; };
  const date = verbali.flatMap((d) => d.controlli.map((c) => String(c.data || '').slice(0, 10)))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
  const dal = verbali.map((d) => d.intestazione.dal).filter(Boolean).sort()[0];
  const primo = date[0] || (dal && giorno(dal)) || giorno(adesso);
  const ultimo = date[date.length - 1] || giorno(adesso);
  const mese = (x) => [Number(x.slice(0, 4)), Number(x.slice(5, 7)) - 1];
  const [a1, m1] = mese(primo);
  const [a2, m2] = mese(ultimo);
  if (a1 === a2 && m1 === m2) return `${MESI[m1]} ${a1}`;
  if (a1 === a2) return `${MESI[m1]}-${MESI[m2]} ${a1}`;
  return `${MESI[m1]} ${a1}-${MESI[m2]} ${a2}`;
}

/**
 * Il nome del file: «Controlli antincendio gen-feb 2026 - SUVERETO.pdf», o
 * «… - tutti gli impianti (3).pdf», senza caratteri che i telefoni rifiutano.
 */
export function nomeFileVerbale(dati, adesso = new Date().toISOString()) {
  const piu = Array.isArray(dati);
  const dove = piu ? `tutti gli impianti (${dati.length})`
    : (dati.intestazione.impianto || 'tutti gli impianti');
  return `Controlli antincendio ${periodoMesi(dati, adesso)} - ${dove}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
}
