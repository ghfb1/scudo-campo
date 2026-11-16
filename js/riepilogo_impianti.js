/**
 * Scudo Campo — i dati di ogni IMPIANTO in una pagina, nella scheda Dati
 * (30/10/2026, v217).
 *
 * Dall'operatore: «una sotto-scheda nella scheda dati in cui riepiloghi i dati
 * dei GE e SCIA, etc. su ogni impianto». Chi prepara un giro vuole sapere, per
 * ogni impianto, quali gruppi elettrogeni ci sono e di che potenza, con che
 * comando si stacca il gasolio, a che punto sono CPI, SCIA e ARPCA, e quanto
 * resta aperto. Erano sparsi in quattro posti: il registro (dal foglio del
 * luogo), le note dei gruppi, l'anagrafica delle leve, le anomalie.
 *
 * ⛔ Niente dati inventati. La potenza di un gruppo si legge dalla nota che
 * l'ufficio ha scritto creando il presidio («Attività 49 (gruppi elettrogeni):
 * potenza 160 kW, pratica VV.F. …») e, se manca, dal modello («160 kW»); se
 * nessuno dei due la dice resta «—», e la riga dice da dove viene il numero.
 * Le righe «• …» del registro sono quelle del file «SCIA e CPI», mostrate come
 * sono scritte.
 *
 * Solo lettura. Modulo a sé (come `registro_impianto.js`): `app.js` non si
 * costruisce in una prova.
 */
import * as S from './stato.js';
import { E } from './pacchetto.js';
import { dataIt, el, sceltaCercabile } from './ui.js';
import { righeRegistro } from './registro_impianto.js';
import { ripartizioneGas } from './gas_clima.js';

const CATEGORIA_GE = 'GRUPPO_ELETTROGENO';
const CATEGORIA_LEVA = 'LEVA_SGANCIO';
const BARRA = { SCADUTO: 'ko', IN_SCADENZA: 'attenzione', REGOLARE: 'ok' };
const PAROLA_SEMAFORO = { SCADUTO: 'scaduto', IN_SCADENZA: 'in scadenza', REGOLARE: 'in regola' };

const t = (v) => String(v == null ? '' : v).trim();
const senzaPunto = (s) => t(s).replace(/\s*\.\s*$/, '');

/**
 * La potenza di un gruppo elettrogeno, e da dove viene.
 *
 * @returns `{ valore, fonte }`: fonte `'nota'` (la riga «Attività 49» scritta
 *   dall'ufficio), `'modello'` (un numero con kW, kVA o MW nel modello), o
 *   `''` con valore vuoto quando nessuno dei due la dice.
 */
export function potenzaGruppo(a) {
  // Il valore comincia con un numero (o «> 750 kW»): «nessuna potenza scritta» non è una potenza.
  const nota = t(a && a.note).match(/potenza\s+((?:>\s*)?\d[^,\n]*?)\s*(?:,|\n|$)/i);
  if (nota) return { valore: nota[1].trim(), fonte: 'nota' };
  // Nel modello si prende l'ULTIMO numero con l'unità: «MCI 443 kW - 320 kW»
  // dice prima la potenza del motore e poi quella del gruppo.
  const nel = [...t(a && a.modello).matchAll(/(\d+(?:[.,]\d+)?\s*(?:kW|kVA|MW))\b/gi)];
  if (nel.length) return { valore: nel[nel.length - 1][1], fonte: 'modello' };
  return { valore: '', fonte: '' };
}

/** Pratica VV.F., comando e serbatoio del gasolio, dalla nota del gruppo. Vuoti se la nota tace. */
export function praticaGruppo(a) {
  const n = t(a && a.note);
  const p = n.match(/pratica VV\.F\.\s*([^(\n]+?)\s*\(Comando di ([^)]+)\)/i);
  const s = n.match(/Serbatoio del gasolio \(attività 12\):\s*([^\n]+)/i);
  return {
    pratica: p ? p[1].trim() : '',
    comando: p ? p[2].trim() : '',
    serbatoio: s ? senzaPunto(s[1]) : '',
  };
}

/** Il tipo di comando di una leva a parole; «da precisare» se l'anagrafica non lo dice. */
export function tipoComandoLeva(leva) {
  const v = t(leva && leva.tipo_sgancio);
  if (!v) return 'da precisare';
  return ((S.ETICHETTE_OPZIONI || {}).tipo_sgancio || {})[v] || v;
}

/** Le righe «• …» delle note dell'impianto (il file «SCIA e CPI»), senza il pallino. */
export function righeSciaCpi(imp) {
  return t(imp && imp.note).split('\n')
    .map((r) => r.trim())
    .filter((r) => r.startsWith('•'))
    .map((r) => r.replace(/^•\s*/, ''));
}

/** Lo stato peggiore fra gli obblighi di sito, o null se l'impianto non ne ha. */
function peggiore(obblighi) {
  const ordine = ['SCADUTO', 'IN_SCADENZA', 'REGOLARE'];
  let p = null;
  for (const o of obblighi) {
    const s = S.semaforo(o.data_scadenza);
    if (ordine.includes(s) && (p === null || ordine.indexOf(s) < ordine.indexOf(p))) p = s;
  }
  return p;
}

/**
 * I dati di ogni impianto, in ordine di nome. Pura sullo stato caricato.
 *
 * @param impiantoId un impianto, o '' per tutti
 */
export function datiImpianti({ impiantoId = '' } = {}) {
  const st = S.get();
  const assets = (st.perEntita[E.ASSET] || []).filter((a) => !a.eliminato_il);
  const punti = st.perEntita[E.VERIFICA] || [];
  return [...(st.perEntita[E.IMPIANTO] || [])]
    .filter((i) => !impiantoId || i.id === impiantoId)
    .sort((x, y) => t(x.denominazione).localeCompare(t(y.denominazione)))
    .map((imp) => {
      const suoi = assets.filter((a) => a.impianto_id === imp.id);
      const perProgressivo = (x, y) => t(x.identificativo).localeCompare(t(y.identificativo), 'it', { numeric: true });
      const gruppi = suoi.filter((a) => a.categoria_codice === CATEGORIA_GE).sort(perProgressivo).map((a) => ({
        id: a.id,
        progressivo: t(a.identificativo),
        marca: t(a.marca),
        modello: t(a.modello),
        potenza: potenzaGruppo(a),
        ...praticaGruppo(a),
        // Il percorso senza l'impianto, che la scheda dice già.
        dove: S.ubicazione(a).split(' / ').slice(1).join(' › '),
        stato: S.idoneita(a).stato,
      }));
      const leve = suoi.filter((a) => a.categoria_codice === CATEGORIA_LEVA).sort(perProgressivo).map((a) => ({
        id: a.id, progressivo: t(a.identificativo), tipo: tipoComandoLeva(a), stato: S.idoneita(a).stato,
      }));
      const anomalie = suoi.flatMap((a) => S.anomalieDi(a.id));
      const obblighi = S.obblighiDiImpianto(imp.id);
      return {
        id: imp.id,
        nome: t(imp.denominazione),
        luogo: [t(imp.comune), t(imp.provincia)].filter(Boolean).join(' · '),
        registro: righeRegistro(imp).documenti,
        scia_cpi: righeSciaCpi(imp),
        obblighi,
        stato_obblighi: peggiore(obblighi),
        gruppi,
        leve,
        clima: ripartizioneGas(suoi, {}).totali,
        presidi: suoi.length,
        anomalie_aperte: anomalie.length,
        anomalie_bloccanti: anomalie.filter((an) => S.anomaliaBlocca(an)).length,
        punti_aperti: punti.filter((v) => v.impianto_id === imp.id && (v.stato || 'APERTO') === 'APERTO').length,
      };
    });
}

const riga = (k, v) => el('div', { class: 'dove-riga' }, [
  el('span', { class: 'dove-etichetta', testo: k }),
  el('span', { class: 'dove-valore', testo: v }),
]);

const PAROLA_FONTE = { nota: 'dalla nota del gruppo', modello: 'dal modello' };

/** Una riga per gruppo elettrogeno: che cos'è, quanto è potente, da dove viene il numero. */
function voceGruppo(g, nomeImpianto = '') {
  const titolo = [nomeImpianto, g.progressivo || 'senza progressivo'].filter(Boolean).join(' · ');
  // Un modello che dice solo la potenza («160 kW») la ripeterebbe: si salta.
  const modello = g.modello === g.potenza.valore ? '' : g.modello;
  const macchina = [g.marca, modello].filter(Boolean).join(' ');
  const pratica = [g.pratica && `pratica VV.F. ${g.pratica}${g.comando ? ` (${g.comando})` : ''}`,
    g.serbatoio && `serbatoio ${g.serbatoio}`].filter(Boolean).join(' · ');
  return el('li', {}, [el('div', { class: 'voce', style: 'cursor:default' }, [
    el('span', { class: `barra-stato ${g.stato === 'NON_IDONEO' ? 'ko' : 'ok'}` }),
    el('span', { class: 'voce-corpo' }, [
      el('div', { class: 'voce-titolo', testo: `⚡ ${titolo}` }),
      el('div', { class: 'voce-sotto', testo: g.potenza.valore
        ? `${g.potenza.valore} (${PAROLA_FONTE[g.potenza.fonte]})` : 'potenza non indicata' }),
      macchina ? el('div', { class: 'mini', testo: macchina }) : null,
      g.dove ? el('div', { class: 'mini', testo: `📍 ${g.dove}` }) : null,
      pratica ? el('div', { class: 'mini', testo: pratica }) : null,
    ].filter(Boolean)),
  ])]);
}

/** Il riquadro di tutti i gruppi elettrogeni, impianto per impianto. */
function cardGruppi(dati) {
  const conGruppi = dati.filter((d) => d.gruppi.length);
  const n = conGruppi.reduce((s, d) => s + d.gruppi.length, 0);
  return el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: `⚡ Gruppi elettrogeni (${n})` }),
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo: n
      ? `${n} gruppi in ${conGruppi.length} impianti su ${dati.length}. La potenza è quella scritta nella nota del `
        + 'gruppo (pratica VV.F.) o, se manca, nel modello.'
      : 'Nessun gruppo elettrogeno censito fra i presidi.' }),
    n ? el('ul', { class: 'elenco' }, conGruppi.flatMap((d) => d.gruppi.map((g) => voceGruppo(g, d.nome)))) : null,
  ].filter(Boolean));
}

/** La scheda di un impianto, chiusa: si apre quello che serve. */
function schedaImpianto(d, { aperta = false } = {}) {
  const sommario = [
    d.gruppi.length ? `⚡ ${d.gruppi.length}` : null,
    d.clima.n_unita ? `❄️ ${d.clima.n_unita}` : null,
    d.anomalie_aperte ? `⚠ ${d.anomalie_aperte}` : null,
    d.stato_obblighi ? PAROLA_SEMAFORO[d.stato_obblighi] : null,
  ].filter(Boolean).join(' · ');
  return el('details', { class: 'card riepilogo-impianto', open: aperta || null }, [
    el('summary', {}, [
      el('span', { class: `barra-stato ${BARRA[d.stato_obblighi] || ''}` }),
      el('span', { class: 'riepilogo-impianto-nome', testo: d.nome }),
      sommario ? el('span', { class: 'mini', testo: sommario }) : null,
    ].filter(Boolean)),
    d.luogo ? el('div', { class: 'mini', testo: d.luogo }) : null,

    el('h3', { testo: 'Prevenzione incendi' }),
    d.registro.length ? el('div', { class: 'dove-righe' }, d.registro.map(([k, v]) => riga(k, v)))
      // Il vuoto si DICE (come nel registro): «qui non c'è» non vuol dire «manca».
      : el('div', { class: 'mini', testo: 'Il registro di questo impianto non è ancora stato riportato in Scudo.' }),
    d.obblighi.length ? el('div', { class: 'dove-righe' }, d.obblighi.map((o) => riga(
      ((S.indici.tipiControllo.get(o.tipo_controllo_codice) || {}).descrizione || o.tipo_controllo_codice),
      [dataIt(o.data_scadenza), PAROLA_SEMAFORO[S.semaforo(o.data_scadenza)]].filter(Boolean).join(' · '),
    ))) : null,
    d.scia_cpi.length ? el('details', { class: 'registro-note' }, [
      el('summary', { testo: 'Dal file «SCIA e CPI»' }),
      el('ul', { class: 'mini' }, d.scia_cpi.map((r) => el('li', { testo: r }))),
    ]) : null,

    el('h3', { testo: 'Gruppi elettrogeni e sgancio del combustibile' }),
    d.gruppi.length ? el('ul', { class: 'elenco' }, d.gruppi.map((g) => voceGruppo(g))) :
      el('div', { class: 'mini', testo: 'Nessun gruppo elettrogeno fra i presidi di questo impianto.' }),
    d.leve.length ? el('div', { class: 'dove-righe' }, d.leve.map((l) => riga(
      `Comando ${l.progressivo || ''}`.trim(), l.tipo))) : null,

    el('h3', { testo: 'Presidi' }),
    el('div', { class: 'dove-righe' }, [
      riga('Presidi in anagrafica', String(d.presidi)),
      riga('Anomalie aperte', d.anomalie_aperte
        ? `${d.anomalie_aperte}${d.anomalie_bloccanti ? `, di cui ${d.anomalie_bloccanti} impediscono l'uso` : ''}` : 'nessuna'),
      riga('Punti aperti', d.punti_aperti ? String(d.punti_aperti) : 'nessuno'),
      d.clima.n_unita ? riga('Climatizzatori in servizio', `${d.clima.n_unita} · ${String(d.clima.carica_kg).replace('.', ',')} kg di gas`
        + (d.clima.tco2eq ? ` · ${String(d.clima.tco2eq).replace('.', ',')} t CO₂eq` : '')) : null,
    ].filter(Boolean)),
  ].filter(Boolean));
}

/** La sotto-scheda «Impianti» della scheda Dati. */
export function vistaRiepilogoImpianti() {
  const tutti = datiImpianti();
  const frag = document.createDocumentFragment();
  if (!tutti.length) {
    frag.append(el('div', { class: 'mini', testo: 'Il pacchetto non ha impianti.' }));
    return frag;
  }
  const TUTTI = '*';
  const corpo = el('div', {});
  const mostra = (id) => {
    while (corpo.firstChild) corpo.removeChild(corpo.firstChild);
    const dati = id === TUTTI ? tutti : tutti.filter((d) => d.id === id);
    corpo.append(cardGruppi(dati), ...dati.map((d) => schedaImpianto(d, { aperta: dati.length === 1 })));
  };
  const scelta = sceltaCercabile({
    voci: [{ valore: TUTTI, testo: `Tutti gli impianti (${tutti.length})` },
      ...tutti.map((d) => ({ valore: d.id, testo: d.nome }))],
    valore: TUTTI, placeholder: 'Scrivi il nome dell\'impianto…', nomeVoci: 'impianti',
    onCambia: (v) => mostra(v || TUTTI),
  });
  mostra(TUTTI);
  frag.append(el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: '🏭 Impianti' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo: 'Per ogni impianto: CPI, SCIA e rinnovo periodico, '
      + 'i gruppi elettrogeni con la potenza e il comando che stacca il gasolio, i climatizzatori, le anomalie e i '
      + 'punti aperti. Solo lettura: i dati si correggono dal registro dell\'impianto e dalle schede dei presidi.' }),
    scelta.nodo,
  ]), corpo);
  return frag;
}
