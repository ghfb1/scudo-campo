/**
 * Scudo Campo — i controlli MENSILI in blocco, e il loro rapportino (15/11/2026).
 *
 * Dall'operatore: «la sorveglianza mensile va trovato un modo (anche per le luci di
 * emergenza) di segnarla come fatta massivamente e stampare un rapportino per gli
 * impianti fatti; ma per gli estintori che nell'ultimo controllo avevano anomalie
 * dovrebbe poterle riconfermare o togliere in modo semplice senza corrompere il
 * database».
 *
 * Che cosa c'è qui
 * ----------------
 *  - `righeMensili`: i presidi che hanno un piano con periodicità fino a un mese
 *    (sorveglianza degli estintori, prova dell'illuminazione, pulizia dei filtri),
 *    con l'ultimo controllo ESEGUITO, la prossima data, lo stato (mai fatto,
 *    scaduto, in scadenza, fatto), i pezzi e le anomalie aperte;
 *  - `pianoDiRegistrazione`: da quelle righe e dalle risposte dell'operatore, che
 *    cosa si registra, che cosa resta fuori (e perché) e CHE COSA CAMBIA rispetto
 *    a prima — pura, così una prova la esegue senza schermo;
 *  - `vistaMensili`: la schermata. Salvare e «fatto» arrivano da fuori;
 *  - `datiRapportino` / `pdfRapportino`: il foglio da stampare, un capitolo per
 *    impianto e per chi esegue (personale Terna, ditta), con la firma su ogni foglio.
 *
 * Le regole che la schermata NON decide
 * -------------------------------------
 * L'esito non si sceglie: lo decide `S.registraControlliInBlocco` da ciò che resta
 * sul presidio dopo le risposte, con le regole del controllo singolo. Qui si
 * raccolgono le risposte e si dice in anticipo che cosa ne verrà.
 *
 * La seconda stesura (v221, lo stesso giorno, dall'operatore che l'ha usata):
 * «questa schermata è un po' confusa, non c'è corretta separazione tra un presidio
 * e un altro, e la descrizione delle anomalie non è ben visibile; di default
 * dovrebbe selezionare come era precedentemente; se si cambia qualcosa, al
 * salvataggio deve chiedere conferma; non c'è cognizione di quali stiamo
 * registrando, se solo quelli scaduti o anche quelli non ancora scaduti; la data
 * va potuta mettere a mano; dove la quantità è più di uno dovremmo vedere quanti
 * sono guasti e modificare quel numero anche da qui».
 *
 * ⚠️ «Da fare» qui NON è quello del giro (`vociDelGiro`): la sorveglianza non
 * genera scadenze e nel giro non torna mai da fare. Qui vale la data: ultimo
 * controllo eseguito + periodicità.
 */
import * as S from './stato.js';
import * as CAL from './calcoli.js';
import { ambitiPeriodici, pianoVisita, pianificazioneImpianto, GRUPPI_VISITA, STATO_SCHEDA } from './prossima_visita.js';
import * as PV from './piani.js';
import { E } from './pacchetto.js';
import { el, tag, avviso, campo, campoData, scelte, sceltaCercabile, svuotaNodo } from './ui.js';
import { spuntataDiPartenza, voceObbligatoria, percheSiApplica, sceltaPezziGuasti } from './controllo.js';
import { A4, nuovoDocumento } from './pdf.js';
import { FONDO, LARGA, M, dataIt, nomePezzo, penna } from './verbale.js';

/** Quanti giorni prima della scadenza un mensile è «in scadenza»: il giro del mese
 *  non cade sempre lo stesso giorno. */
export const GIORNI_ANTICIPO = 7;

/** Quali presidi si registrano: solo gli scaduti, anche quelli in scadenza, tutti. */
export const AMBITI_MENSILI = ['SCADUTI', 'IN_SCADENZA', 'TUTTI'];

const MESI_NOME = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto',
  'settembre', 'ottobre', 'novembre', 'dicembre'];

export { eMensile } from './piani.js';

function isoPiu(iso, giorni) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + giorni);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Dove sta, senza ripetere il nome dell'impianto (la schermata è già dentro uno). */
function doveSenzaImpianto(a) {
  const tutto = S.ubicazione(a) || '';
  const imp = (S.indici.impianti.get(a.impianto_id) || {}).denominazione || '';
  return imp && tutto.startsWith(`${imp} / `) ? tutto.slice(imp.length + 3) : tutto;
}

/**
 * I presidi con un piano mensile, uno per riga (un presidio con due piani mensili
 * dà due righe).
 *
 * `ultimo` è l'ultimo controllo ESEGUITO (idoneo o non idoneo): un «non
 * accessibile» non ferma l'orologio, come dappertutto (`CAL.esecuzioneVale`).
 * `stato`: MAI (mai eseguito) · SCADUTO · IN_SCADENZA (entro `anticipo` giorni) ·
 * FATTO (prossima oltre l'anticipo). `daFare` = tutto tranne FATTO.
 */
export function righeMensili({ impiantoId = '', pianoId = '', oggi = S.oggiIso(), soloInBlocco = false, anticipo = GIORNI_ANTICIPO } = {}) {
  const limite = isoPiu(oggi, anticipo);
  const out = [];
  for (const a of S.get().perEntita[E.ASSET] || []) {
    // I presidi sospesi (dismessi, non previsti) non hanno una guardia qui: per
    // loro `controlliApplicabili` risponde già vuoto (`sospendeLavoro`). Provato:
    // con la guardia in più, toglierla non faceva fallire niente.
    if (a.eliminato_il) continue;
    if (impiantoId && a.impianto_id !== impiantoId) continue;
    let registrati = null;
    for (const t of S.controlliApplicabili(a)) {
      if (!t.piano_id || S.eFineVita(t.codice, t.piano_id) || (pianoId && t.piano_id !== pianoId)) continue;
      if (soloInBlocco && (!S.nelPerimetro(a) || !PV.tipoPeriodicoInBlocco(t, S.tipoAssetDi(a)))) continue;
      if (!PV.eMensile(t)) continue;
      if (!registrati) registrati = S.interventiDi(a.id).filter((i) => !i.eliminato_il);
      const ultimo = CAL.ultimaEsecuzione(registrati.filter((i) => i.tipo_controllo_codice === t.codice)) || '';
      // La prossima: la scadenza che l'app già conosce, se no ultimo + periodicità.
      // (Per la sorveglianza, che non genera scadenze, è sempre la seconda.)
      const prossima = String(t.scadenza || t.prossima_calcolata
        || (ultimo ? CAL.prossimaScadenza(ultimo, t.frequenza_valore, t.frequenza_unita) : '') || '').slice(0, 10);
      const stato = !prossima ? 'MAI' : prossima <= oggi ? 'SCADUTO' : prossima <= limite ? 'IN_SCADENZA' : 'FATTO';
      out.push({
        a, t,
        impianto_id: a.impianto_id || '',
        nome: nomePezzo(a),
        dove: doveSenzaImpianto(a),
        ultimo,
        prossima,
        stato,
        daFare: stato !== 'FATTO',
        anomalie: S.anomalieDi(a.id),
        quantita: Math.max(1, Math.trunc(Number(a.quantita) || 1)),
        pezziGuasti: Math.max(0, Math.trunc(Number(a.quantita_ko) || 0)),
      });
    }
  }
  return out.sort((x, y) => x.dove.localeCompare(y.dove, 'it') || x.nome.localeCompare(y.nome, 'it'));
}

/** Le righe che un ambito comprende (`AMBITI_MENSILI`). */
export function righeDellAmbito(righe, ambito) {
  if (ambito === 'TUTTI') return righe;
  if (ambito === 'SCADUTI') return righe.filter((r) => r.stato === 'MAI' || r.stato === 'SCADUTO');
  return righe.filter((r) => r.stato !== 'FATTO');
}

/** I piani mensili di un impianto, con quanti presidi, quanti da fare e chi li esegue. */
export function pianiMensili(impiantoId = '', opzioni = {}) {
  const per = new Map();
  for (const r of righeMensili({ ...opzioni, impiantoId })) {
    if (!per.has(r.t.piano_id)) {
      per.set(r.t.piano_id, { piano_id: r.t.piano_id, codice: r.t.codice, descrizione: r.t.descrizione,
        tipoInBlocco: PV.tipoPeriodicoInBlocco(r.t, S.tipoAssetDi(r.a)),
        norma: r.t.norma || '', frequenza: r.t.frequenza_testo || '', azioni: r.t.azioni || [],
        esecutore: r.t.esecutore || PV.DITTA,
        presidi: 0, daFare: 0, scaduti: 0, conAnomalie: 0 });
    }
    const p = per.get(r.t.piano_id);
    p.presidi += 1;
    if (r.daFare) p.daFare += 1;
    if (r.stato === 'MAI' || r.stato === 'SCADUTO') p.scaduti += 1;
    if (r.anomalie.length) p.conAnomalie += 1;
  }
  return [...per.values()].sort((x, y) => y.presidi - x.presidi || x.descrizione.localeCompare(y.descrizione, 'it'));
}

/** Gli impianti che hanno almeno un presidio con un piano mensile. */
export function impiantiConMensili(opzioni = {}) {
  const per = new Map();
  for (const r of righeMensili(opzioni)) {
    if (!per.has(r.impianto_id)) {
      per.set(r.impianto_id, { id: r.impianto_id,
        nome: (S.indici.impianti.get(r.impianto_id) || {}).denominazione || '(senza impianto)', righe: 0, daFare: 0 });
    }
    const i = per.get(r.impianto_id);
    i.righe += 1;
    if (r.daFare) i.daFare += 1;
  }
  return [...per.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'it'));
}

/** La risposta che conferma un'anomalia COM'È ADESSO. */
export function decisioneComeSta(an) {
  return S.anomaliaBlocca(an) ? 'BLOCCA' : 'USABILE';
}

const DECISIONE_A_PAROLE = { RISOLTA: 'risolta', USABILE: 'c\'è ancora, si può usare', BLOCCA: 'c\'è ancora, impedisce l\'uso' };

/**
 * Che cosa si registra, che cosa resta fuori, e che cosa CAMBIA.
 *
 * @param righe        quelle che la schermata mostra
 * @param esclusi      Set di asset_id a cui l'operatore ha tolto la spunta
 * @param decisioni    Map anomalia_id → 'RISOLTA' | 'USABILE' | 'BLOCCA'. Dove manca
 *                     vale COM'ERA (`decisioneComeSta`): è la preselezione
 * @param guasti       Map asset_id → pezzi guasti (numero), o `null` se la
 *                     risposta non è completa. Dove manca valgono quelli d'archivio
 * @param descrizioni  Map asset_id → che cosa non va (serve con pezzi guasti e
 *                     nessuna anomalia aperta: nasce un'anomalia)
 *
 * `daCompletare`: i presidi che non si possono registrare così, col motivo.
 * `cambi`: ciò che l'operatore ha cambiato rispetto a prima — lo stato di
 * un'anomalia, i pezzi guasti. Con almeno un cambio la schermata chiede conferma.
 */
export function pianoDiRegistrazione(righe, { esclusi = new Set(), decisioni = new Map(), guasti = new Map(),
  descrizioni = new Map() } = {}) {
  const elenco = [];
  const daCompletare = [];
  const cambi = [];
  const esiti = new Map();
  let idonei = 0;
  let nonIdonei = 0;
  let risolte = 0;
  for (const r of righe) {
    if (esclusi.has(r.a.id)) continue;
    const risposte = r.anomalie.map((an) => ({ id: an.id, decisione: decisioni.get(an.id) || decisioneComeSta(an) }));
    if (risposte.some((x) => !S.DECISIONI_ANOMALIA.includes(x.decisione))) {
      daCompletare.push({ r, motivo: 'una risposta su un\'anomalia non è valida' });
      continue;
    }
    const ko = guasti.has(r.a.id) ? guasti.get(r.a.id) : r.pezziGuasti;
    if (ko === null || !Number.isInteger(ko) || ko < 0 || ko > r.quantita) {
      daCompletare.push({ r, motivo: `di' quanti dei ${r.quantita} pezzi non funzionano` });
      continue;
    }
    const blocca = risposte.some((x) => x.decisione === 'BLOCCA');
    // Con pezzi guasti il controllo è non idoneo: sullo stesso difetto se resta
    // un'anomalia aperta, altrimenti serve dire che cosa non va (nasce l'anomalia).
    const restaUna = risposte.some((x) => x.decisione !== 'RISOLTA');
    const descrizione = String(descrizioni.get(r.a.id) || '').trim();
    if (!restaUna && ko > 0 && !descrizione) {
      daCompletare.push({ r, motivo: `${ko === 1 ? 'un pezzo guasto' : `${ko} pezzi guasti`} e nessuna anomalia aperta: scrivi che cosa non va` });
      continue;
    }
    const voce = { asset_id: r.a.id, anomalie: risposte };
    // I pezzi guasti si SCRIVONO solo se il presidio ne ha più di uno o se il
    // numero è cambiato: su un pezzo solo e senza guasti non c'è niente da dire.
    if (r.quantita > 1 || ko !== r.pezziGuasti) voce.quantita_ko = ko;
    if (!restaUna && ko > 0) voce.descrizione = descrizione;
    elenco.push(voce);
    const esito = (blocca || ko > 0) ? 'NON_IDONEO' : 'IDONEO';
    esiti.set(r.a.id, esito);
    if (esito === 'IDONEO') idonei += 1; else nonIdonei += 1;
    risolte += risposte.filter((x) => x.decisione === 'RISOLTA').length;
    for (const an of r.anomalie) {
      const prima = decisioneComeSta(an);
      const dopo = risposte.find((x) => x.id === an.id).decisione;
      if (dopo !== prima) {
        cambi.push({ tipo: 'anomalia', asset_id: r.a.id, anomalia_id: an.id, presidio: r.nome,
          testo: String(an.descrizione || '').trim() || 'Anomalia senza descrizione',
          da: DECISIONE_A_PAROLE[prima], a: DECISIONE_A_PAROLE[dopo] });
      }
    }
    if (ko !== r.pezziGuasti) {
      cambi.push({ tipo: 'guasti', asset_id: r.a.id, presidio: r.nome,
        testo: `pezzi guasti su ${r.quantita}`, da: String(r.pezziGuasti), a: String(ko) });
    }
  }
  return { elenco, daCompletare, cambi, esiti, idonei, nonIdonei, risolte };
}

const plurale = (n, uno, molti) => `${n} ${n === 1 ? uno : molti}`;

const FILTRI_VISITE = {
  ENTRO_VISITA: { gruppo: 'entro_visita', titolo: 'Scadono entro la prossima visita stimata',
    aiuto: 'Sono ancora in regola alla data scelta. Se la scadenza precede la visita stimata, concorda un passaggio prima della scadenza.' },
  TRA_VISITE: { gruppo: 'valutare_anticipo', titolo: 'Scadono tra le due visite stimate',
    aiuto: 'Alla prossima visita saranno ancora in regola. Aspettando la visita seguente scadrebbero. Puoi concordare un anticipo con chi esegue il controllo.' },
};
const notaVisite = 'Le date delle visite sono stimate dalla cadenza e dall’ultimo passaggio documentato.';

/** La ricerca degli impianti delimita l'insieme selezionabile. Cambiare filtro
 * azzera le spunte: una sede nascosta non può arrivare nella conferma. */
export function sceltaImpiantiPerPiano(apri, precedente = null, oggi = S.oggiIso()) {
  const data = campoData({ valore: precedente?.data || oggi, annoMin: Number(oggi.slice(0, 4)) - 1, annoMax: Number(oggi.slice(0, 4)) });
  const righeAllaData = () => pianoVisita('', data.value || oggi).filter(r => r.tipo_in_blocco && r.stato_scheda !== 'fuori_perimetro');
  let visita = righeAllaData();
  const piani = new Map(visita.map(r => [r.piano_id, r]));
  const sedi = el('div');
  let pianoId = precedente?.pianoId || '';
  const selezione = new Set();
  const cerca = el('input', { type: 'search', placeholder: 'Più nomi separati da virgole', 'aria-label': 'Cerca un impianto' });
  const opzione = (value, testo) => el('option', { value, testo });
  const presidio = el('select', {}, [opzione('', 'Tutti gli impianti'), opzione('1', 'Presidiati'), opzione('0', 'Non presidiati')]);
  const ambito = el('select', {}, [opzione('SCADUTI', 'Dovuti oggi, scaduti o prima verifica'),
    opzione('IN_SCADENZA', 'Anche in scadenza entro 7 giorni'),
    ...Object.entries(FILTRI_VISITE).map(([valore, filtro]) => opzione(valore, filtro.titolo)),
    opzione('TUTTI', 'Tutte le scadenze')]);
  ambito.value = precedente?.ambito || 'SCADUTI';
  presidio.value = precedente?.presidio || '';
  cerca.value = precedente?.cerca || '';
  const guida = el('div', { class: 'mini', 'aria-live': 'polite' });
  const filtri = el('div', {}, [campo('Data delle verifiche', data), campo('Stato del controllo', ambito), guida, campo('Presidio della sede', presidio), campo('Nome impianto', cerca)]);
  const avanti = el('button', { type: 'button', class: 'btn btn-primario btn-blocco mensili-avanti', onclick: () => {
    if (selezione.size) apri({ pianoId, impianti: new Set(selezione), ambito: ambito.value,
      data: data.value, presidio: presidio.value, cerca: cerca.value });
  } });
  const aggiornaNumero = () => {
    avanti.disabled = !selezione.size;
    avanti.textContent = selezione.size ? 'Rivedi i presidi · ' + selezione.size + (selezione.size === 1 ? ' impianto' : ' impianti') : 'Seleziona gli impianti';
  };
  function elenca(ripristina = false) {
    svuotaNodo(sedi);
    selezione.clear();
    aggiornaNumero();
    filtri.hidden = avanti.hidden = !pianoId;
    const filtroVisita = FILTRI_VISITE[ambito.value];
    guida.hidden = !filtroVisita;
    guida.textContent = filtroVisita ? filtroVisita.aiuto + ' ' + notaVisite : '';
    if (!pianoId) return;
    if (!data.value || data.value > oggi) { sedi.append(avviso('Scegli la data in cui hai eseguito le verifiche, fino a oggi.')); return; }
    const conteggi = new Map();
    const sediConPiano = new Set();
    let prossima = '';
    const nomi = cerca.value.toLocaleLowerCase('it').split(',').map(nome => nome.trim()).filter(Boolean);
    for (const r of visita) {
      if (r.piano_id !== pianoId) continue;
      const sede = S.indici.impianti.get(r.impianto_id);
      if (!sede || (nomi.length && !nomi.some(nome => r.impianto.toLocaleLowerCase('it').includes(nome)))) continue;
      if (presidio.value && Number(sede.presidiato) !== Number(presidio.value)) continue;
      sediConPiano.add(sede.id);
      if (r.scadenza > data.value && (!prossima || r.scadenza < prossima)) prossima = r.scadenza;
      if (!inAmbito(r, ambito.value, data.value)) continue;
      const datiSede = conteggi.get(sede.id) || { quanti: 0, primaScadenza: r.scadenza, visita: r.visita.data_stimata };
      datiSede.quanti++;
      if (r.scadenza && (!datiSede.primaScadenza || r.scadenza < datiSede.primaScadenza)) datiSede.primaScadenza = r.scadenza;
      conteggi.set(sede.id, datiSede);
    }
    const voci = [...conteggi].sort(([a], [b]) => S.indici.impianti.get(a).denominazione.localeCompare(S.indici.impianti.get(b).denominazione, 'it'));
    if (!voci.length) {
      if (!sediConPiano.size) {
        sedi.append(avviso('Nessun impianto con questo piano corrisponde ai filtri sulla sede.'));
      } else {
        const motivo = ambito.value === 'SCADUTI' ? 'Nessuna verifica dovuta al ' + dataIt(data.value)
          : 'Nessuna verifica con lo stato selezionato';
        sedi.append(avviso(motivo + '. Il piano riguarda ' + plurale(sediConPiano.size, 'impianto', 'impianti') + ' con i filtri attuali.'
          + (prossima ? ' Prossima scadenza ' + dataIt(prossima) + '.' : '')));
        sedi.append(el('button', { type: 'button', class: 'btn', testo: 'Mostra tutte le scadenze',
          onclick: () => { ambito.value = 'TUTTI'; elenca(); } }));
      }
      return;
    }
    const caselle = new Map();
    function seleziona(tutti) {
      for (const [id, c] of caselle) { c.checked = tutti; if (tutti) selezione.add(id); else selezione.delete(id); }
      aggiornaNumero();
    }
    sedi.append(el('div', { class: 'scelte' }, [
      el('button', { type: 'button', class: 'btn', testo: 'Seleziona gli impianti filtrati (' + voci.length + ')', onclick: () => seleziona(true) }),
      el('button', { type: 'button', class: 'btn', testo: 'Deseleziona gli impianti', onclick: () => seleziona(false) }),
    ]));
    for (const [id, sede] of voci) {
      const c = el('input', { type: 'checkbox', onchange: () => {
        if (c.checked) selezione.add(id); else selezione.delete(id);
        aggiornaNumero();
      } });
      if (ripristina && precedente?.impianti.has(id)) { selezione.add(id); c.checked = true; }
      caselle.set(id, c);
      sedi.append(el('label', { class: 'casella casella-grande' }, [c, el('span', {}, [
        S.indici.impianti.get(id).denominazione + ' · ' + plurale(sede.quanti, 'presidio', 'presidi'),
        filtroVisita && el('span', { class: 'voce-sotto', style: 'display:block',
          testo: 'Prima scadenza ' + dataIt(sede.primaScadenza) + ' · Visita stimata ' + dataIt(sede.visita) }),
      ])]));
    }
    aggiornaNumero();
  }
  for (const menu of Object.values(data.menu)) menu.addEventListener('change', () => { visita = righeAllaData(); elenca(); });
  cerca.addEventListener('input', () => elenca());
  presidio.addEventListener('change', () => elenca());
  ambito.addEventListener('change', () => elenca());
  const voci = [...piani.values()].map(r => {
    const testo = [r.tipo_in_blocco, r.esecutore === PV.TERNA ? 'Terna' : 'Ditta', r.piano_id].join(' · ');
    const pluraleCadenza = r.tipo_in_blocco.includes('bimestrale') ? 'bimestrali' : 'mensili';
    const terminiRicerca = [testo, r.controllo, r.periodicita, pluraleCadenza].join(' ').toLowerCase();
    return { valore: r.piano_id, testo, terminiRicerca };
  }).sort((a, b) => a.testo.localeCompare(b.testo, 'it'));
  const piano = sceltaCercabile({ voci, valore: pianoId, nomeVoci: 'piani', placeholder: 'Cerca il controllo, ad esempio luci o filtri…',
    onCambia: id => { pianoId = id; elenca(); } });
  elenca(true);
  return el('div', { class: 'mensili' }, [campo('Tipo di verifica e piano', piano.nodo), filtri, sedi, avanti]);
}

const CHIAVE_AMBITO = { SCADUTI: 'dovuti', IN_SCADENZA: 'entro_sette_giorni', TUTTI: 'tutti' };
function inAmbito(r, filtro, oggi) {
  if (FILTRI_VISITE[filtro]) return r.gruppo === FILTRI_VISITE[filtro].gruppo;
  const ambiti = r.periodico ? r.ambiti_periodici : ambitiPeriodici(r.gruppo, r.scadenza, oggi);
  return ambiti.includes(CHIAVE_AMBITO[filtro]);
}

/**
 * La schermata.
 *
 * @param impiantoId  l'impianto da cui si parte (quello in cui si sta navigando)
 * @param registra    (elenco, comuni) => Promise<esito | null> — salva (da `muta`)
 * @param alFatto     ({ impiantoId, pianoId, data, esito }) => void — dopo il salvataggio
 * @param oggi        per le prove
 */
export function vistaMensili({ impiantoId = '', lotto = null, apriPresidio, rapporto, registra, alFatto, oggi = S.oggiIso() } = {}) {
  if (lotto && !registra) {
    const giorno = lotto.data || oggi;
    const righe = pianoVisita('', giorno).filter(r => r.tipo_in_blocco && r.piano_id === lotto.pianoId
      && lotto.impianti.has(r.impianto_id) && r.stato_scheda !== 'fuori_perimetro'
      && inAmbito(r, lotto.ambito, giorno));
    const vista = el('div', { class: 'mensili' });
    vista.append(el('h3', { testo: righe[0]?.controllo || 'Presidi del piano' }));
    for (const id of lotto.impianti) {
      const locali = righe.filter(r => r.impianto_id === id);
      const nome = S.indici.impianti.get(id)?.denominazione || id;
      const sezione = el('details', { class: 'card', open: lotto.impianti.size === 1 }, [
        el('summary', { testo: nome + ' · ' + plurale(locali.length, 'presidio', 'presidi') }),
      ]);
      if (rapporto && locali.some(r => r.selezionabile)) sezione.append(el('button', {
        type: 'button', class: 'btn btn-blocco', testo: 'Rapporto PDF Terna · ' + nome, onclick: () => rapporto(id),
      }));
      for (const r of locali) sezione.append(el('div', { class: 'voce' }, [
        el('span', { class: 'voce-corpo' }, [
          el('strong', { testo: r.identificativo }),
          el('span', { class: 'voce-sotto', testo: [r.ubicazione, GRUPPI_VISITA[r.gruppo],
            r.scadenza && 'Scadenza ' + dataIt(r.scadenza), FILTRI_VISITE[lotto.ambito] && r.visita.testo, r.motivo !== GRUPPI_VISITA[r.gruppo] && r.motivo].filter(Boolean).join(' · ') }),
        ]),
      ]));
      vista.append(sezione);
    }
    return vista;
  }
  const stato = { impiantoId, pianoId: lotto?.pianoId || '', ambito: lotto?.ambito || 'SCADUTI' };
  const rapporti = new Map();
  const operatore = el('input', { type: 'text', maxlength: 150, autocomplete: 'off' });
  const confermati = new Set();
  const decisioni = new Map();
  const guasti = new Map();
  const descrizioni = new Map();
  const corpo = el('div', { class: 'mensili-corpo' });
  const boxPiani = el('div', { class: 'mensili-piani' });
  const visita = el('div');
  let pianoLocale = [];
  function aggiornaVisita() {
    svuotaNodo(visita);
    const id = stato.impiantoId;
    if (lotto) {
      pianoLocale = pianoVisita('', fData.value || oggi).filter(r => lotto.impianti.has(r.impianto_id) && r.piano_id === lotto.pianoId);
      return;
    }
    pianoLocale = id ? pianoVisita(id, fData.value || oggi) : [];
    if (rapporto && id) visita.append(el('button', { type: 'button', class: 'btn btn-blocco',
      testo: 'Rapporto PDF Terna · estintori e luci', onclick: () => rapporto(id) }));
    if (!apriPresidio) return;
    const dettagli = el('details', { class: 'card' }, [el('summary', {
      testo: id ? 'Pianificazione di tutte le attività della sede' : 'Riepilogo delle visite per impianto' })]);
    dettagli.addEventListener('toggle', () => {
      if (dettagli.open && dettagli.children.length === 1) dettagli.append(
        pianificazioneImpianto(id ? pianoLocale : pianoVisita('', fData.value || oggi), id, apriPresidio, scelta.scegli));
    });
    visita.append(dettagli);
  }
  // La data si SCRIVE (tre menù: giorno, mese, anno), e vale per tutti i presidi
  // che si registrano. Parte da oggi.
  const fData = campoData({ valore: lotto?.data || oggi, annoMin: Number(oggi.slice(0, 4)) - 1, annoMax: Number(oggi.slice(0, 4)) });
  const azzera = () => { confermati.clear(); rapporti.clear(); decisioni.clear(); guasti.clear(); descrizioni.clear(); };
  // La data sta in testa e non si ridisegna con il resto: cambiandola si
  // aggiorna solo il fondo (quanti, con quale data).
  // ⚠️ Sui tre menù, non sul contenitore: nel browser `change` risale da solo, ma
  // contarci vuol dire una data che cambia senza che il pulsante lo dica.
  for (const menu of Object.values(fData.menu)) {
    menu.addEventListener('change', () => { if (lotto) lotto.data = fData.value; azzera(); aggiornaVisita(); disegnaCorpo(); });
  }

  const conteggi = new Map((lotto ? [] : impiantiConMensili({ oggi, soloInBlocco: true })).map(i => [i.id, i.righe]));
  const impianti = [...S.indici.impianti.values()].map(i => ({
    id: i.id, nome: i.denominazione, righe: conteggi.get(i.id) || 0,
  })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  const scelta = sceltaCercabile({
    voci: impianti.map((i) => ({ valore: i.id, testo: `${i.nome} — ${i.righe} verifiche con piano` })),
    valore: impianti.some((i) => i.id === impiantoId) ? impiantoId : '',
    placeholder: 'Scrivi il nome dell\'impianto…', nomeVoci: 'impianti',
    onCambia: (v) => { stato.impiantoId = v || ''; stato.pianoId = ''; stato.ambito = 'SCADUTI'; azzera(); disegnaPiani(); },
  });
  if (!impianti.some((i) => i.id === impiantoId)) stato.impiantoId = '';

  function disegnaPiani() {
    svuotaNodo(boxPiani);
    svuotaNodo(corpo);
    aggiornaVisita();
    if (lotto) { disegnaCorpo(); return; }
    if (!stato.impiantoId || !registra) return;
    const piani = pianiMensili(stato.impiantoId, { oggi, soloInBlocco: true });
    if (!piani.length) {
      boxPiani.append(el('div', { class: 'mini', testo: 'In questo impianto nessun presidio ha un controllo periodico.' }));
      return;
    }
    // Uno solo: è già scelto. Più d'uno: si sceglie, niente preselezione — i
    // piani non sono intercambiabili e quello sbagliato si registrerebbe su tutti.
    if (piani.length === 1) stato.pianoId = piani[0].piano_id;
    const fPeriodici = scelte(piani.map((p) => ({ valore: p.piano_id,
      testo: `${p.tipoInBlocco} · ${p.presidi} presidi · ${p.esecutore === PV.TERNA ? 'Terna' : 'ditta'}` })), stato.pianoId,
    { obbligatorio: true, onCambia: (v) => { stato.pianoId = v; stato.ambito = 'SCADUTI'; azzera(); disegnaCorpo(); } });
    boxPiani.append(campo('Quale controllo', fPeriodici));
    disegnaCorpo();
  }

  function disegnaCorpo() {
    svuotaNodo(corpo);
    if (!stato.pianoId) return;
    const visite = new Map(pianoLocale.filter(r => r.piano_id === stato.pianoId).map(r => [r.asset_id, r]));
    const tutte = righeMensili({ impiantoId: stato.impiantoId, pianoId: stato.pianoId, soloInBlocco: true, oggi: fData.value || oggi })
      .filter(r => visite.has(r.a.id) && (!lotto || lotto.impianti.has(r.impianto_id)));
    const piano = tutte[0]?.t;
    if (!piano) { corpo.append(avviso('Piano non più disponibile. Riapri la visita.')); return; }
    const ambiti = Object.fromEntries([...Object.keys(CHIAVE_AMBITO), ...Object.keys(FILTRI_VISITE)].map(filtro =>
      [filtro, tutte.filter(r => inAmbito(visite.get(r.a.id), filtro, fData.value || oggi))]));
    const terna = tutte.some(r => S.sorveglianzaTerna(r.a, r.t.codice, r.t.esecutore));
    const righe = ambiti[stato.ambito];
    const giaEseguiti = new Set(righe.filter(r => S.eseguitoNellaData(r.a, r.t.codice, fData.value || oggi)).map(r => r.a.id));
    const esclusi = new Set(righe.filter(r => !confermati.has(r.a.id)).map(r => r.a.id));
    const conAnomalie = righe.filter((r) => r.anomalie.length);
    const senza = righe.filter((r) => !r.anomalie.length);

    // --- QUALI si registrano: detto in testa, con i numeri
    const fAmbito = scelte([
      { valore: 'SCADUTI', testo: `Dovuti oggi, scaduti o prima verifica (${ambiti.SCADUTI.length})` },
      { valore: 'IN_SCADENZA', testo: `Scaduti e in scadenza entro ${GIORNI_ANTICIPO} giorni (${ambiti.IN_SCADENZA.length})` },
      ...Object.entries(FILTRI_VISITE).map(([valore, f]) => ({ valore, testo: f.titolo + ' (' + ambiti[valore].length + ')' })),
      { valore: 'TUTTI', testo: `Tutti, anche i non ancora in scadenza (${ambiti.TUTTI.length})` },
    ], stato.ambito, { obbligatorio: true, onCambia: (v) => { stato.ambito = v; if (lotto) lotto.ambito = v; azzera(); disegnaCorpo(); } });
    const fuori = tutte.length - righe.length;
    const cheCosa = el('div', { class: 'avviso avviso-blu mensili-che-cosa' }, [
      el('div', { style: 'font-weight:700', testo: `${piano.descrizione} — a cura ${piano.esecutore === PV.TERNA ? 'del personale Terna' : 'della ditta esterna'}` }),
      el('div', { testo: `In elenco ${plurale(righe.length, 'presidio', 'presidi')}. Restano fuori ${fuori} con questo filtro. Spunta solo le prove eseguite.` }),
    ]);

    // --- le verifiche del piano, uguali per tutti
    const caselle = [];
    const pezzi = righe.map((r) => r.a);
    const boxAzioni = el('div', {});
    if ((piano.azioni || []).length) {
      boxAzioni.append(el('h3', { testo: `Che cosa hai verificato (${piano.azioni.length})` }));
      boxAzioni.append(el('div', { class: 'mini', testo: 'Vale per tutti i presidi che registri qui: il piano è lo stesso.' }));
      boxAzioni.append(el('ul', { class: 'elenco-azioni' }, piano.azioni.map((az) => {
        const c = el('input', { type: 'checkbox' });
        c.checked = !lotto && !terna && PV.eMensile(piano) && spuntataDiPartenza(az, pezzi);
        c.addEventListener('change', () => aggiornaFondo());
        caselle.push({ casella: c, azione: az });
        const cond = !voceObbligatoria(az);
        const siApplica = cond ? percheSiApplica(az, pezzi) : null;
        return el('li', {}, [el('label', { class: `casella casella-grande${cond ? ' casella-condizionale' : ''}` }, [
          c, el('span', { class: 'casella-testo' }, [
            el('span', { testo: az.testo }),
            cond ? el('span', { class: 'casella-solo-se',
              testo: siApplica ? ` — si applica: ${siApplica}` : ' — solo se si applica a questi presidi' }) : null,
          ].filter(Boolean)),
        ])]);
      })));
    }

    // --- UNA SCHEDA PER PRESIDIO: intestazione, pezzi, anomalie, e che cosa si registra
    const perScheda = new Map();
    const schedaPresidio = (r) => {
      const c = el('input', { type: 'checkbox', 'aria-label': `Registra ${r.nome}` });
      c.checked = !esclusi.has(r.a.id);
      c.disabled = giaEseguiti.has(r.a.id);
      const scheda = el('li', { class: `mensili-riga mensili-scheda${esclusi.has(r.a.id) ? ' esclusa' : ''}`, 'data-asset': r.a.id });
      c.addEventListener('change', () => {
        if (c.checked) { confermati.add(r.a.id); esclusi.delete(r.a.id); }
        else { confermati.delete(r.a.id); esclusi.add(r.a.id); }
        scheda.classList.toggle('esclusa', !c.checked);
        aggiornaFondo();
      });
      const attivita = visite.get(r.a.id);
      const figli = [
        el('label', { class: 'mensili-scheda-testa' }, [c, el('span', { class: 'mensili-scheda-nome' }, [
          el('span', { class: 'mensili-nome', testo: r.nome }),
          el('span', { class: 'mini', style: 'display:block', testo: [lotto ? attivita.impianto : '', r.dove,
            attivita.ultima_esecuzione ? `ultimo: ${dataIt(attivita.ultima_esecuzione)}` : null].filter(Boolean).join(' · ') }),
          el('span', { class: 'voce-tag', style: 'display:block;margin-top:4px' }, [tag(attivita.scadenza
            ? (attivita.gruppo === 'dovute' ? 'scaduto dal ' : 'scade il ') + dataIt(attivita.scadenza)
            : GRUPPI_VISITA[attivita.gruppo], attivita.gruppo === 'dovute' ? 'tag-rosso' : 'tag-grigio')]),
        ])]),
      ];

      if (attivita) figli.push(el('div', { class: 'mini', testo: [
        'Scheda nel pacchetto · ' + STATO_SCHEDA[attivita.stato_scheda], GRUPPI_VISITA[attivita.gruppo],
        attivita.visita.testo, attivita.motivo !== GRUPPI_VISITA[attivita.gruppo] ? attivita.motivo : '',
      ].filter(Boolean).join(' · ') }));

      if (c.disabled) figli.push(avviso('Verifica già eseguita nella data scelta.'));
      if (piano.codice === 'CONTROLLO_PERDITE_FGAS') {
        const link = el('input', { type: 'url', placeholder: 'https://…', value: rapporti.get(r.a.id) || '' });
        link.addEventListener('input', () => { rapporti.set(r.a.id, link.value.trim()); aggiornaFondo(); });
        figli.push(campo('Rapporto F-Gas di ' + r.nome, link));
      }

      // I PEZZI: quanti sono, quanti guasti, e il numero si cambia da qui. Parte
      // da quello d'archivio, come le anomalie partono com'erano.
      if (r.quantita > 1 || r.pezziGuasti > 0) {
        const sg = sceltaPezziGuasti(r.quantita, 0, () => {
          guasti.set(r.a.id, sg.errore() ? null : sg.valore());
          aggiornaFondo();
        }, { iniziale: guasti.has(r.a.id) && guasti.get(r.a.id) !== null ? guasti.get(r.a.id) : r.pezziGuasti,
          aiuto: `In archivio: ${r.pezziGuasti ? plurale(r.pezziGuasti, 'pezzo guasto', 'pezzi guasti') : 'nessun pezzo guasto'} su ${r.quantita}. `
            + 'Con almeno un pezzo guasto il controllo si registra non idoneo.' });
        sg.nodo.classList.add('mensili-pezzi');
        figli.push(sg.nodo);
      }

      // LE ANOMALIE: la descrizione grande, com'è adesso, e le tre risposte —
      // preselezionata quella di PRIMA (dall'operatore: «di default dovrebbe
      // selezionare come era precedentemente»). Cambiarla chiede conferma al
      // salvataggio.
      for (const an of r.anomalie) {
        const blocca = S.anomaliaBlocca(an);
        const box = scelte([
          { valore: 'USABILE', testo: '! C\'è ancora, si può usare', tono: 'attenzione' },
          { valore: 'BLOCCA', testo: '✕ C\'è ancora, impedisce l\'uso', tono: 'ko' },
          { valore: 'RISOLTA', testo: '✓ Risolta', tono: 'ok' },
        ], decisioni.get(an.id) || decisioneComeSta(an), { obbligatorio: true, onCambia: (v) => {
          if (v === decisioneComeSta(an)) decisioni.delete(an.id); else decisioni.set(an.id, v);
          aggiornaFondo();
        } });
        figli.push(el('div', { class: `mensili-anomalia${blocca ? ' blocca' : ''}`, 'data-anomalia': an.id }, [
          el('div', { class: 'mini', style: 'margin-bottom:2px' }, [
            el('span', { testo: 'Anomalia aperta' }),
            an.data_apertura ? el('span', { testo: ` dal ${dataIt(an.data_apertura)}` }) : null,
            el('span', { testo: ' · adesso: ' }),
            tag(blocca ? 'impedisce l\'uso' : 'si può usare', blocca ? 'tag-rosso' : 'tag-ambra'),
          ].filter(Boolean)),
          el('div', { class: 'mensili-anomalia-testo', testo: String(an.descrizione || '').trim() || 'Anomalia senza descrizione' }),
          el('div', { class: 'mini', style: 'margin:6px 0 4px', testo: 'Com\'è adesso?' }),
          box,
        ]));
      }

      // Che cosa non va: serve con pezzi guasti e nessuna anomalia che impedisce l'uso.
      const fDescrizione = el('textarea', { rows: '2', placeholder: 'Che cosa non va (es. 2 lampade spente)',
        value: descrizioni.get(r.a.id) || '' });
      fDescrizione.addEventListener('input', () => { descrizioni.set(r.a.id, fDescrizione.value); aggiornaFondo(); });
      const boxDescrizione = el('div', { class: 'mensili-descrizione', hidden: true }, [
        campo('Che cosa non va', fDescrizione, 'Ci sono pezzi guasti e nessuna anomalia aperta che lo dica: '
          + 'con questa descrizione nasce l\'anomalia, come dal controllo singolo.'),
      ]);
      figli.push(boxDescrizione);
      const esito = el('div', { class: 'mensili-esito' });
      figli.push(esito);
      perScheda.set(r.a.id, { esito, boxDescrizione, c, scheda });
      scheda.append(...figli);
      return scheda;
    };

    const sezioni = [];
    if (lotto) {
      for (const id of lotto.impianti) {
        const locali = righe.filter(r => r.impianto_id === id);
        if (!locali.length) continue;
        const anomalie = locali.filter(r => r.anomalie.length).length;
        const titolo = S.indici.impianti.get(id).denominazione + ' · ' + plurale(locali.length, 'presidio', 'presidi');
        sezioni.push(el('details', { class: 'card' }, [
          el('summary', { testo: titolo + (anomalie ? ' · ' + anomalie + ' con anomalie' : '') }),
          el('ul', { class: 'mensili-elenco' }, locali.map(schedaPresidio)),
        ]));
      }
    } else if (conAnomalie.length) {
      sezioni.push(el('h3', { testo: `Con anomalie aperte (${conAnomalie.length})` }));
      sezioni.push(el('div', { class: 'mini', testo: 'Ogni anomalia parte com\'era l\'ultima volta. Cambiala solo se è cambiata: '
        + 'al salvataggio ti chiedo conferma. Con un\'anomalia che impedisce l\'uso il controllo si registra NON IDONEO, '
        + 'senza aprire un\'anomalia nuova.' }));
      sezioni.push(el('ul', { class: 'mensili-elenco' }, conAnomalie.map(schedaPresidio)));
    }
    if (!lotto && senza.length) {
      sezioni.push(el('h3', { testo: `Senza anomalie aperte (${senza.length})` }));
      sezioni.push(el('div', { class: 'mini', testo: 'Seleziona i presidi sui quali hai eseguito la prova.' }));
      sezioni.push(el('ul', { class: 'mensili-elenco' }, senza.map(schedaPresidio)));
    }
    if (!righe.length) {
      sezioni.push(avviso(FILTRI_VISITE[stato.ambito] ? 'Nessuna scadenza in questo intervallo tra le visite.' : stato.ambito === 'TUTTI' ? 'Nessun presidio con questo controllo.'
        : `Niente da registrare con questa scelta: ${stato.ambito === 'SCADUTI' ? 'nessuno è scaduto' : 'nessuno è scaduto o in scadenza'}. `
          + 'Per registrarli lo stesso scegli «Tutti».', 'avviso-verde'));
    }

    // --- il fondo: che cosa succede premendo, detto prima
    const riassunto = el('div', { class: 'mensili-riassunto', style: 'margin-top:14px' });
    const motivo = el('div', { class: 'mini', style: 'text-align:right' });
    const bottone = el('button', { class: 'btn btn-ok', type: 'button', testo: 'Registra' });
    const boxConferma = el('div', { class: 'mensili-conferma', hidden: true });
    let confermaAperta = false;
    const scelteFatte = () => pianoDiRegistrazione(righe, { esclusi, decisioni, guasti, descrizioni });
    const dataScelta = () => fData.value || '';

    function aggiornaFondo() {
      confermaAperta = false;
      boxConferma.hidden = true;
      const p = scelteFatte();
      // Scheda per scheda: che cosa si registra, e se serve la descrizione.
      for (const r of righe) {
        const s = perScheda.get(r.a.id);
        if (!s) continue;
        const ko = guasti.has(r.a.id) ? guasti.get(r.a.id) : r.pezziGuasti;
        const restaUna = r.anomalie.some((an) => (decisioni.get(an.id) || decisioneComeSta(an)) !== 'RISOLTA');
        s.boxDescrizione.hidden = !(ko > 0 && !restaUna);
        const manca = p.daCompletare.find((x) => x.r.a.id === r.a.id);
        const e = p.esiti.get(r.a.id);
        const fuoriScheda = esclusi.has(r.a.id);
        s.esito.className = `mensili-esito${fuoriScheda ? ' fuori' : manca ? ' manca' : e === 'NON_IDONEO' ? ' ko' : ' ok'}`;
        s.esito.textContent = fuoriScheda ? 'Presidio escluso dalla registrazione.'
          : manca ? `Non si registra ancora: ${manca.motivo}.`
            : e === 'NON_IDONEO' ? '→ Si registra NON IDONEO' : '→ Si registra IDONEO';
      }
      svuotaNodo(riassunto);
      const parti = [
        p.idonei ? plurale(p.idonei, 'idoneo', 'idonei') : null,
        p.nonIdonei ? `${p.nonIdonei} non ${p.nonIdonei === 1 ? 'idoneo' : 'idonei'}` : null,
      ].filter(Boolean);
      const giorno = dataScelta();
      riassunto.append(el('div', { style: 'font-weight:700', testo: p.elenco.length
        ? `Si registrano ${plurale(p.elenco.length, 'controllo', 'controlli')} con la data ${giorno ? dataIt(giorno) : '—'}: ${parti.join(', ')}.`
        : 'Nessun controllo da registrare con queste scelte.' }));
      if (p.risolte) riassunto.append(el('div', { class: 'mini', testo: `${plurale(p.risolte, 'anomalia viene chiusa', 'anomalie vengono chiuse')} come risolta.` }));
      if (p.cambi.length) {
        riassunto.append(el('div', { class: 'mini mensili-nota-cambi', testo: `Hai cambiato ${plurale(p.cambi.length, 'cosa', 'cose')} rispetto a prima: `
          + 'prima di registrare ti chiedo conferma.' }));
      }
      if (p.daCompletare.length) {
        riassunto.append(avviso(`${plurale(p.daCompletare.length, 'presidio non si registra', 'presidi non si registrano')} `
          + 'finché non completi la scheda (o togli la spunta):', '', p.daCompletare.map((x) => `${x.r.nome}: ${x.motivo}`)));
      }
      const richieste = caselle.filter((x) => voceObbligatoria(x.azione));
      const mancanti = richieste.filter((x) => !x.casella.checked).length;
      const futuro = Boolean(giorno) && giorno > oggi;
      // Senza tutte le verifiche obbligatorie IDONEO non si può dichiarare: stessa
      // regola del controllo singolo, detta prima di premere.
      const mancaOperatore = terna && !operatore.value.trim();
      const mancaRapporto = piano.codice === 'CONTROLLO_PERDITE_FGAS' && p.elenco.some(v => !S.rapportoFGasValido(rapporti.get(v.asset_id)));
      const bloccato = mancaRapporto || p.daCompletare.length > 0 || mancaOperatore || !p.elenco.length || !giorno || futuro || (p.idonei > 0 && mancanti > 0);
      bottone.disabled = bloccato;
      bottone.classList.toggle('btn-spento', bloccato);
      bottone.textContent = p.elenco.length
        ? `Registra ${plurale(p.elenco.length, 'controllo', 'controlli')}${giorno ? ` con data ${dataIt(giorno)}` : ''}` : 'Registra';
      motivo.textContent = mancaRapporto ? 'Inserisci un link al rapporto F-Gas per ogni presidio selezionato.' : mancaOperatore ? 'Indica il nome di chi ha eseguito le prove.' : !p.elenco.length ? ''
        : !giorno ? 'Scegli la data del controllo.'
          : futuro ? 'La data del controllo non può essere nel futuro.'
            : (p.idonei > 0 && mancanti > 0) ? `Per dichiarare idoneo mancano ${mancanti} verifiche su ${richieste.length}.` : '';
    }

    operatore.oninput = aggiornaFondo;

    async function salva(p) {
      const data = dataScelta() || oggi;
      const elenco = p.elenco.map(v => ({ ...v, impianto_id: visite.get(v.asset_id).impianto_id,
        ...(rapporti.has(v.asset_id) ? { rapporto_url: rapporti.get(v.asset_id) } : {}) }));
      const esito = await registra(elenco, {
        impiantiConfermati: lotto ? [...lotto.impianti] : [stato.impiantoId],
        piano_id: stato.pianoId,
        ...(terna ? { visitaTerna: { impiantoId: stato.impiantoId, operatore: operatore.value.trim() } } : {}),
        data,
        azioni: caselle.map(({ casella, azione }, i) => ({
          azione_id: azione.id || null, ordine: Number(azione.ordine ?? i), testo: azione.testo, fatta: casella.checked ? 1 : 0,
        })),
      });
      if (esito && alFatto) alFatto({ impiantoId: stato.impiantoId, pianoId: stato.pianoId, data, esito, terna, periodico: PV.eMensile(piano) });
    }

    bottone.addEventListener('click', async () => {
      const p = scelteFatte();
      if (!p.elenco.length || !registra || bottone.disabled) return;
      // ⛔ Si sta cambiando qualcosa rispetto a prima — lo stato di un'anomalia, i
      // pezzi guasti: si chiede conferma, con l'elenco di che cosa cambia
      // (dall'operatore: «se si cambia qualcosa, al salvataggio deve chiedere
      // conferma che stiamo cambiando lo stato di un'anomalia»). In un controllo in
      // blocco un tocco sbagliato su una scheda fra trenta non si rilegge da sé.
      if (confermaAperta) return;
      {
        confermaAperta = true;
        svuotaNodo(boxConferma);
        const perImpianto = new Map();
        for (const voce of p.elenco) {
          const nome = visite.get(voce.asset_id).impianto;
          perImpianto.set(nome, (perImpianto.get(nome) || 0) + 1);
        }
        boxConferma.append(
          el('div', { style: 'font-weight:700', testo: `Confermi le prove effettivamente svolte sui ${p.elenco.length} presidi selezionati il ${dataIt(dataScelta() || oggi)}? Modifiche rispetto a prima: ${p.cambi.length}.` }),
          el('div', { class: 'mini', testo: [...perImpianto].map(([nome, n]) => nome + ' · ' + n).join(' / ') }),
          el('details', {}, [el('summary', { testo: 'Presidi selezionati · ' + p.elenco.length }),
            el('ul', {}, p.elenco.map(voce => el('li', { testo: visite.get(voce.asset_id).impianto + ' · ' + nomePezzo(S.indici.assets.get(voce.asset_id)) })))]),
          el('ul', { class: 'mensili-cambi' }, p.cambi.map((c) => el('li', {}, [
            el('span', { style: 'font-weight:600', testo: c.presidio }),
            el('span', { testo: c.tipo === 'anomalia' ? ` — «${c.testo}»: ` : ` — ${c.testo}: ` }),
            el('span', { testo: `da «${c.da}» a ` }),
            el('span', { style: 'font-weight:700', testo: `«${c.a}»` }),
          ]))),
          el('div', { class: 'riga riga-fine', style: 'gap:8px;margin-top:8px' }, [
            el('button', { class: 'btn', type: 'button', testo: 'Torna a controllare',
              onclick: () => { confermaAperta = false; boxConferma.hidden = true; } }),
            el('button', { class: 'btn btn-primario', type: 'button', testo: 'Sì, conferma e registra',
              onclick: async (ev) => {
                const b = ev.currentTarget || ev.target; if (b.disabled) return; b.disabled = true;
                try { await salva(scelteFatte()); } finally { b.disabled = false; }
              } }),
          ]),
        );
        boxConferma.hidden = false;
        return;
      }
    });

    const rapide = righe.filter(r => !giaEseguiti.has(r.a.id) && !['impedite', 'da_chiarire'].includes(visite.get(r.a.id).gruppo));
    function spuntaInBlocco(includi) {
      for (const r of includi ? rapide : righe) {
        const id = r.a.id, voce = perScheda.get(id);
        if (includi) { confermati.add(id); esclusi.delete(id); }
        else { confermati.delete(id); esclusi.add(id); }
        voce.c.checked = includi;
        voce.scheda.classList.toggle('esclusa', !includi);
      }
      aggiornaFondo();
    }
    corpo.append(
      campo('Quali registrare', fAmbito, FILTRI_VISITE[stato.ambito] && FILTRI_VISITE[stato.ambito].aiuto + ' ' + notaVisite),
      ...(terna ? [campo('Operatore Terna che ha eseguito le prove', operatore)] : []),
      cheCosa,
      el('div', { class: 'scelte' }, [
        el('button', { type: 'button', class: 'btn', disabled: !rapide.length, testo: 'Seleziona i presidi del filtro (' + rapide.length + ')', onclick: () => spuntaInBlocco(true) }),
        el('button', { type: 'button', class: 'btn', testo: 'Deseleziona i presidi', onclick: () => spuntaInBlocco(false) }),
      ]),
      ...(rapide.length < righe.length ? [avviso('Esclusi dalla selezione rapida: verifiche già registrate nella data scelta, impedimenti e dati da chiarire.')] : []),
      boxAzioni,
      ...sezioni,
      riassunto,
      motivo,
      boxConferma,
      el('div', { class: 'riga riga-fine', style: 'margin-top:12px' }, [bottone]),
    );
    aggiornaFondo();
  }

  const nodo = el('div', { class: 'mensili' }, [
    lotto ? el('p', { testo: 'Impianti selezionati · ' + [...lotto.impianti].map(id => S.indici.impianti.get(id)?.denominazione).join(', ') })
      : campo('Impianto', scelta.nodo),
    visita,
    !registra ? avviso('Consultazione del giro. Puoi pianificare la visita e stampare i rapporti.') : null,
    registra ? campo('Data del controllo', fData, 'Vale per tutti i presidi che registri qui. Oggi, se l\'hai fatto adesso; '
      + 'se il giro del mese è di un altro giorno, metti quello: la prossima scadenza si conta da questa data.') : null,
    boxPiani,
    corpo,
  ]);
  disegnaPiani();
  return nodo;
}

// --------------------------------------------------------------------------- //
// Il rapportino
// --------------------------------------------------------------------------- //

/** Gli ultimi `quanti` mesi, dal corrente: `[{ valore: '2026-11', testo, dal, al }]`. */
export function mesiRecenti(oggi = S.oggiIso(), quanti = 4) {
  const [aa, mm] = oggi.split('-').map(Number);
  const out = [];
  for (let k = 0; k < quanti; k += 1) {
    const d = new Date(aa, mm - 1 - k, 1, 12);
    const anno = d.getFullYear();
    const mese = d.getMonth();
    const p = (x) => String(x).padStart(2, '0');
    const ultimo = new Date(anno, mese + 1, 0, 12).getDate();
    out.push({ valore: `${anno}-${p(mese + 1)}`, testo: `${MESI_NOME[mese]} ${anno}`,
      dal: `${anno}-${p(mese + 1)}-01`, al: `${anno}-${p(mese + 1)}-${p(ultimo)}` });
  }
  return out;
}

const ESITO_PAROLE = { IDONEO: 'idoneo', NON_IDONEO: 'NON IDONEO', NON_ESEGUITO: 'non eseguito', NON_ACCESSIBILE: 'non accessibile' };

/** Chi firma un capitolo: a parole, per la riga della firma. */
export const FIRMA_DI = { TERNA: 'operatore Terna', DITTA: 'operatore della ditta' };

/**
 * I controlli mensili registrati fra `dal` e `al`, impianto per impianto e, dentro
 * l'impianto, divisi per CHI li esegue (`gruppi`: personale Terna, ditta esterna):
 * sono due firme diverse, quindi due capitoli.
 *
 * Dice anche chi NON è stato verificato nel periodo: un rapportino che elenca solo
 * i fatti fa credere che siano tutti.
 * Senza `impiantoId` entrano solo gli impianti con almeno un controllo nel periodo.
 * `esecutore` ('TERNA' | 'DITTA') lascia solo i piani di quella mano.
 */
export function sorveglianzeTernaDelGiro(impiantoId) {
  return S.interventiDelGiro().filter(i => {
    if (i.eliminato_il || !CAL.esecuzioneVale(i.esito)) return false;
    const a = S.indici.assets.get(i.asset_id);
    const piano = S.indici.pianiPerId.get(i.piano_id);
    return a && (!impiantoId || a.impianto_id === impiantoId) && piano && piano.tipo_controllo_codice === i.tipo_controllo_codice
      && S.sorveglianzaTerna(a, i.tipo_controllo_codice, PV.esecutoreDi(piano));
  });
}

// Per la firma conta il piano registrato al momento della prova, anche se la
// periodicità o i piani attuali del presidio sono cambiati nel frattempo.
function righeDelRapportoTerna(interventi) {
  const righe = new Map();
  for (const i of interventi) {
    const a = S.indici.assets.get(i.asset_id);
    const p = S.indici.pianiPerId.get(i.piano_id);
    const chiave = JSON.stringify([a.id, p.id]);
    if (!righe.has(chiave)) righe.set(chiave, {
      a, impianto_id: a.impianto_id, nome: nomePezzo(a), dove: doveSenzaImpianto(a), interventi: [],
      t: { piano_id: p.id, codice: i.tipo_controllo_codice, esecutore: PV.TERNA,
        descrizione: p.denominazione, frequenza_testo: PV.etichettaFrequenza(p.frequenza_valore, p.frequenza_unita) },
    });
    righe.get(chiave).interventi.push(i);
  }
  return [...righe.values()].sort((a,b) => a.dove.localeCompare(b.dove, 'it') || a.nome.localeCompare(b.nome, 'it'));
}

export function datiRapportino({ impiantoId = '', dal, al, esecutore = '', soloPacchetto = false, idsTerna = null } = {}) {
  const nelPacchetto = soloPacchetto ? new Set(S.interventiDelGiro().map(i => i.id)) : null;
  const dentro = (d) => { const x = String(d || '').slice(0, 10); return Boolean(x) && (!dal || x >= dal) && (!al || x <= al); };
  const perImpianto = new Map();
  const righe = idsTerna ? righeDelRapportoTerna(sorveglianzeTernaDelGiro(impiantoId).filter(i => idsTerna.has(i.id) && dentro(i.data)))
    : righeMensili({ impiantoId });
  for (const r of righe) {
    if (!perImpianto.has(r.impianto_id)) {
      const imp = S.indici.impianti.get(r.impianto_id) || {};
      perImpianto.set(r.impianto_id, { id: r.impianto_id, nome: imp.denominazione || '(senza impianto)',
        indirizzo: [imp.indirizzo, imp.comune].filter(Boolean).join(', '), piani: new Map() });
    }
    const imp = perImpianto.get(r.impianto_id);
    const registrazioni = r.interventi || S.interventiDi(r.a.id)
      .filter(i => !i.eliminato_il && i.tipo_controllo_codice === r.t.codice && dentro(i.data)
        && (!nelPacchetto || nelPacchetto.has(i.id)))
      .sort((x, y) => String(x.data).localeCompare(String(y.data)));
    const perPiano = new Map();
    for (const i of registrazioni) {
      const id = i.piano_id || r.t.piano_id;
      if (!perPiano.has(id)) perPiano.set(id, []);
      perPiano.get(id).push(i);
    }
    if (!perPiano.size) perPiano.set(r.t.piano_id, []);
    for (const [id, controlli] of perPiano) {
      const storico = id === r.t.piano_id ? null : S.indici.pianiPerId.get(id);
      const mano = storico ? PV.esecutoreDi(storico) : r.t.esecutore || PV.DITTA;
      if (esecutore && mano !== esecutore) continue;
      if (!imp.piani.has(id)) {
        imp.piani.set(id, { piano_id: id, descrizione: storico?.denominazione || r.t.descrizione,
          norma: storico ? storico.norma || '' : r.t.norma || '',
          frequenza: storico ? PV.etichettaFrequenza(storico.frequenza_valore, storico.frequenza_unita) : r.t.frequenza_testo || '',
          esecutore: mano, voci: ((storico ? S.indici.azioniPerPiano.get(id) : r.t.azioni) || []).map(z => z.testo).filter(Boolean),
          previsti: 0, verificati: 0, idonei: 0, nonIdonei: 0, nonEseguiti: 0, righe: [], nonVerificati: [], operatori: new Set() });
      }
      const p = imp.piani.get(id);
      p.previsti += 1;
      const eseguiti = controlli.filter((i) => CAL.esecuzioneVale(i.esito));
      if (!eseguiti.length) p.nonVerificati.push({ presidio: r.nome, dove: r.dove, motivo: controlli.length ? (ESITO_PAROLE[controlli[controlli.length - 1].esito] || '') : '' });
      else p.verificati += 1;
      for (const i of controlli) {
        if (i.esito === 'IDONEO') p.idonei += 1;
        else if (i.esito === 'NON_IDONEO') p.nonIdonei += 1;
        else p.nonEseguiti += 1;
        if (i.operatore_nome) p.operatori.add(i.operatore_nome);
        p.righe.push({
          presidio: r.nome, dove: r.dove, data: String(i.data || '').slice(0, 10), esito: i.esito,
          esitoTesto: ESITO_PAROLE[i.esito] || String(i.esito || '').toLowerCase(),
          operatore: i.operatore_nome || '',
          // I pezzi: quanti sono e quanti guasti ADESSO (si stampano dove sono più di uno).
          pezzi: idsTerna ? Number(i.quantita_verificata || 1) : r.quantita, pezziGuasti: idsTerna ? Number(i.quantita_ko || 0) : r.pezziGuasti,
          // Le anomalie aperte ADESSO sul presidio: è ciò che chi firma deve sapere.
          descrizione: i.descrizione || '',
          anomalie: idsTerna ? [] : r.anomalie.map((an) => ({ testo: String(an.descrizione || '').trim() || 'Anomalia senza descrizione',
            blocca: S.anomaliaBlocca(an) })),
        });
      }
    }
  }
  const impianti = [...perImpianto.values()].map((i) => {
    const tutti = [...i.piani.values()].sort((x, y) => x.descrizione.localeCompare(y.descrizione, 'it'));
    for (const p of tutti) p.operatori = [...p.operatori].sort();
    // Un piano senza NESSUN controllo nel periodo non ha un capitolo: chi stampa il
    // rapportino della sorveglianza non vuole sessanta filtri «non verificati».
    // Ma si nomina (`senzaControlli`), o il foglio farebbe credere che non esista.
    const piani = tutti.filter((p) => p.righe.length > 0);
    // Un capitolo per chi esegue: Terna prima, poi la ditta.
    const gruppi = PV.ESECUTORI.map((mano) => {
      const suoi = piani.filter((p) => p.esecutore === mano);
      const date = suoi.flatMap((p) => p.righe.map((r) => r.data)).filter(Boolean).sort();
      return { esecutore: mano, piani: suoi,
        operatori: [...new Set(suoi.flatMap((p) => p.operatori))].sort(),
        dal: date[0] || '', al: date[date.length - 1] || '',
        controlli: suoi.reduce((t, p) => t + p.righe.length, 0) };
    }).filter((g) => g.piani.length);
    return { id: i.id, nome: i.nome, indirizzo: i.indirizzo, piani, gruppi,
      operatori: [...new Set(gruppi.flatMap((g) => g.operatori))].sort(),
      senzaControlli: tutti.filter((p) => !p.righe.length).map((p) => ({ descrizione: p.descrizione, previsti: p.previsti, esecutore: p.esecutore })),
      controlli: piani.reduce((t, p) => t + p.righe.length, 0) };
  }).filter((i) => impiantoId || i.controlli > 0).sort((x, y) => x.nome.localeCompare(y.nome, 'it'));
  return {
    dal: dal || '', al: al || '', esecutore, impianti, rapportoTerna: Boolean(idsTerna),
    totali: {
      impianti: impianti.length,
      controlli: impianti.reduce((t, i) => t + i.controlli, 0),
      nonIdonei: impianti.reduce((t, i) => t + i.piani.reduce((u, p) => u + p.nonIdonei, 0), 0),
      nonVerificati: impianti.reduce((t, i) => t + i.piani.reduce((u, p) => u + p.nonVerificati.length, 0), 0),
    },
  };
}

function periodoAParole(d) {
  if (d.dal && d.al) return `dal ${dataIt(d.dal)} al ${dataIt(d.al)}`;
  if (d.dal) return `dal ${dataIt(d.dal)}`;
  if (d.al) return `fino al ${dataIt(d.al)}`;
  return 'tutto il rilievo';
}

/** «il 10/11/2026», o «dal 10/11/2026 al 12/11/2026»: le date dei controlli di un capitolo. */
export function dateDeiControlli(g) {
  if (!g || !g.dal) return '';
  return g.dal === g.al ? `il ${dataIt(g.dal)}` : `dal ${dataIt(g.dal)} al ${dataIt(g.al)}`;
}

/** L'altezza riservata in fondo a OGNI foglio per la firma di chi ha eseguito. */
const ALTEZZA_FIRMA = 44;

/**
 * Chi firma ogni CAPITOLO del rapportino, nell'ordine in cui si stampano: un
 * capitolo per impianto e per chi esegue. Ogni foglio di un capitolo porta la
 * stessa firma (`pdfRapportino` la disegna in fondo a ognuno).
 */
export function capitoliDelRapportino(dati) {
  const out = [];
  for (const i of dati.impianti) {
    if (!i.gruppi.length) out.push({ impianto: i.nome, esecutore: null, operatori: [], gruppo: null, i });
    for (const g of i.gruppi) out.push({ impianto: i.nome, esecutore: g.esecutore, operatori: g.operatori, gruppo: g, i });
  }
  return out;
}

/**
 * Il rapportino in PDF: un capitolo per impianto E per chi esegue, la data dei
 * controlli in testa al capitolo e su ogni riga, e in fondo a OGNI foglio la riga
 * per la firma dell'operatore Terna o dell'operatore della ditta (dall'operatore:
 * «il pdf deve riportare la data e deve poter far firmare ogni foglio»).
 *
 * `allaFirma(foglio, capitolo)` è chiamata per ogni foglio che porta una firma:
 * serve alle prove, perché dentro un PDF il testo sta in un flusso compresso.
 */
export function pdfRapportino(dati, { versione = '', adesso = new Date().toISOString(), codice = '', allaFirma = null } = {}) {
  const titolo = dati.rapportoTerna ? 'Rapporto sorveglianze Terna' : 'Rapportino dei controlli periodici';
  const doc = nuovoDocumento({ titolo, autore: 'Scudo Campo' });
  // Chi firma il foglio che si sta scrivendo: lo segna `onPagina`, una voce per foglio.
  const firme = [];
  let corrente = null;
  const p = penna(doc, { testata: titolo, destra: periodoAParole(dati), fondo: FONDO - ALTEZZA_FIRMA,
    onPagina: () => { firme[doc.numeroPagine] = corrente; } });
  if (!dati.impianti.length) {
    p.nuovaPagina();
    p.paragrafo(titolo.toUpperCase(), { corpo: 15, grassetto: true, dopo: 4 });
    p.paragrafo(`Nessun controllo periodico registrato ${periodoAParole(dati)}.`, { corpo: 11, dopo: 6 });
  }
  for (const cap of capitoliDelRapportino(dati)) {
    const { i, gruppo: g } = cap;
    corrente = g ? cap : null;
    p.nuovaPagina();
    doc.rettangolo(M, p.y, LARGA, 26, { riempi: 0.15, bordo: 0 });
    doc.testo(M + 8, p.y + 17, `IMPIANTO ${i.nome}`, { corpo: 13, grassetto: true, grigio: 1 });
    p.y += 32;
    if (!g) {
      p.paragrafo('Nessun controllo periodico registrato in questo impianto nel periodo.', { corpo: 10, dopo: 4 });
    } else {
      p.paragrafo(`Controlli periodici a cura ${g.esecutore === PV.TERNA ? 'del PERSONALE TERNA' : 'della DITTA ESTERNA'}`,
        { corpo: 12, grassetto: true, dopo: 2 });
      p.paragrafo(`Data dei controlli: ${dateDeiControlli(g)} · eseguiti da: ${g.operatori.length ? g.operatori.join(', ') : '—'}`,
        { corpo: 10, dopo: 2 });
    }
    p.paragrafo(`${periodoAParole(dati)}${i.indirizzo ? ` · ${i.indirizzo}` : ''} · stampato il ${dataIt(adesso)}`
      + `${codice ? ` · pacchetto ${codice}` : ''}`, { corpo: 8, grigio: 0.35, dopo: 6 });
    if (!g) continue;
    p.tabella([
      { titolo: 'Controllo', larghezza: 0.36 }, { titolo: dati.rapportoTerna ? 'Schede nel rapporto' : 'Presidi previsti', larghezza: 0.12 },
      { titolo: 'Verificati', larghezza: 0.12 }, { titolo: 'Idonei', larghezza: 0.12 },
      { titolo: 'Non idonei', larghezza: 0.14 }, { titolo: 'Non verificati', larghezza: 0.14 },
    ], g.piani.map((pi) => [
      [{ testo: pi.descrizione, grassetto: true }, ...(pi.norma ? [{ testo: pi.norma, grigio: 0.4, corpo: 7 }] : [])],
      [{ testo: String(pi.previsti) }], [{ testo: String(pi.verificati) }], [{ testo: String(pi.idonei) }],
      [{ testo: String(pi.nonIdonei), grassetto: pi.nonIdonei > 0 }],
      [{ testo: String(pi.nonVerificati.length), grassetto: pi.nonVerificati.length > 0 }],
    ]));
    const altri = i.senzaControlli.filter((x) => x.esecutore === g.esecutore);
    if (altri.length) {
      p.paragrafo(`Altri controlli periodici di questo impianto, della stessa mano, senza registrazioni nel periodo: ${altri
        .map((x) => `${x.descrizione} (${x.previsti} presidi)`).join('; ')}.`, { corpo: 8, grigio: 0.3, dopo: 4 });
    }
    for (const pi of g.piani) {
      p.titolo(`${pi.descrizione} — ${pi.verificati} verificati su ${pi.previsti}`, 11);
      if (pi.voci.length) {
        p.paragrafo(`Verifiche del piano: ${pi.voci.map((v, k) => `${k + 1}) ${v}`).join('  ')}`, { corpo: 8, grigio: 0.25, dopo: 4 });
      }
      if (pi.righe.length) {
        p.tabella([
          { titolo: 'Presidio', larghezza: 0.3 }, { titolo: 'Dove', larghezza: 0.23 }, { titolo: 'Data del controllo', larghezza: 0.11 },
          { titolo: 'Esito', larghezza: 0.11 }, { titolo: dati.rapportoTerna ? 'Note della verifica' : 'Pezzi guasti e anomalie aperte', larghezza: 0.25 },
        ], pi.righe.map((r) => [
          [{ testo: r.presidio, grassetto: true }],
          [{ testo: r.dove || '—', grigio: 0.25 }],
          [{ testo: dataIt(r.data) }, ...(r.operatore && g.operatori.length > 1 ? [{ testo: r.operatore, grigio: 0.45, corpo: 7 }] : [])],
          [{ testo: r.esitoTesto, grassetto: r.esito !== 'IDONEO' }],
          [
            ...(r.pezzi > 1 ? [{ testo: `${r.pezzi} pezzi, ${r.pezziGuasti ? `${r.pezziGuasti} guasti` : 'nessuno guasto'}`,
              grassetto: r.pezziGuasti > 0, corpo: 7 }] : []),
            ...(dati.rapportoTerna ? [{ testo: r.descrizione || '—', corpo: 7 }] : r.anomalie.length
              ? r.anomalie.map((an) => ({ testo: `${an.blocca ? "IMPEDISCE L'USO: " : 'si può usare: '}${an.testo}`, grassetto: an.blocca, corpo: 7 }))
              : [{ testo: 'nessuna anomalia', grigio: 0.5, corpo: 7 }]),
          ],
        ]));
      }
      if (pi.nonVerificati.length) {
        p.paragrafo(`Non verificati nel periodo (${pi.nonVerificati.length}):`, { corpo: 9, grassetto: true, dopo: 2 });
        for (const n of pi.nonVerificati) {
          p.paragrafo(`• ${n.presidio}${n.dove ? ` — ${n.dove}` : ''}${n.motivo ? ` (${n.motivo})` : ''}`, { corpo: 8, grigio: 0.25, dopo: 1 });
        }
        p.y += 4;
      }
    }
  }
  const n = doc.numeroPagine;
  for (let k = 1; k <= n; k += 1) {
    doc.suPagina(k);
    // LA FIRMA, su ogni foglio: di chi ha eseguito i controlli di quel capitolo.
    const f = firme[k];
    if (f) {
      const y = A4.altezza - 34 - ALTEZZA_FIRMA + 6;
      doc.rettangolo(M, y, LARGA, ALTEZZA_FIRMA - 10, { bordo: 0.6 });
      doc.testo(M + 8, y + 13, `Firma dell'${FIRMA_DI[f.esecutore]}`, { corpo: 9, grassetto: true });
      doc.testo(M + 8, y + 27, 'Nome e cognome:', { corpo: 8, grigio: 0.35 });
      if (f.operatori.length === 1) doc.testo(M + 78, y + 27, f.operatori[0], { corpo: 9 });
      doc.testo(M + LARGA * 0.45, y + 27, 'Data:', { corpo: 8, grigio: 0.35 });
      doc.testo(M + LARGA * 0.62, y + 27, 'Firma:', { corpo: 8, grigio: 0.35 });
      if (allaFirma) allaFirma(k, f);
    }
    doc.linea(M, A4.altezza - 34, M + LARGA, A4.altezza - 34, { grigio: 0.7 });
    doc.testo(M, A4.altezza - 22, `Scudo Campo ${versione} · ${titolo} · stampato il ${dataIt(adesso)}`, { corpo: 7, grigio: 0.4 });
    doc.testo(M + LARGA - 62, A4.altezza - 22, `foglio ${k} di ${n}`, { corpo: 7, grigio: 0.4 });
  }
  return doc.bytes();
}

/** «Rapportino periodici - SUVERETO - novembre 2026.pdf». */
export function nomeFileRapportino(dati, etichettaPeriodo = '') {
  const dove = dati.impianti.length === 1 ? dati.impianti[0].nome : `${dati.impianti.length} impianti`;
  const chi = dati.esecutore === PV.TERNA ? ' - Terna' : dati.esecutore === PV.DITTA ? ' - ditta' : '';
  const quando = etichettaPeriodo || [dati.dal, dati.al].filter(Boolean).map((d) => dataIt(d).replace(/\//g, '-')).join(' al ');
  return `Rapportino periodici - ${dove}${chi}${quando ? ` - ${quando}` : ''}.pdf`.replace(/[\\/:*?"<>|]+/g, '-');
}
