/**
 * «Smarcato come non fattibile» o «mai affrontato»? (16/11/2026)
 *
 * Dall'operatore: «dobbiamo accertarci che Scudo Campo e Scudo dashboard
 * gestiscano bene e in modo intuitivo questo, anche le varie scadenze, altrimenti
 * ci perdiamo, non capiamo cosa è stato effettivamente smarcato come non fattibile
 * e cosa non affrontato proprio».
 *
 * Sui PRESIDI la distinzione c'era già (le viste «Da fare / Sospesi / Fatti»), ma
 * senza il perché: un sospeso diceva «2 verifiche non eseguite» e basta. Sulle
 * SCADENZE non c'era affatto: una verifica scaduta aveva lo stesso aspetto sia che
 * nessuno l'avesse toccata, sia che qualcuno avesse scritto «centralina
 * disalimentata». Qui stanno le parole e i conti; lo schermo li monta in `app.js`.
 *
 * Modulo a sé perché `app.js` non si può costruire in una prova.
 */
import { el, tag } from './ui.js';
import * as S from './stato.js';

/** I tre modi di guardare le scadenze. */
export const LAVORO = Object.freeze({ TUTTE: 'TUTTE', DA_FARE: 'DA_FARE', NON_ESEGUIBILI: 'NON_ESEGUIBILI' });

function dataIt(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * L'ultimo tentativo non eseguibile, in una frase: «non eseguibile il 22/09/2026 —
 * Centralina disalimentata… (Leonardo Serafini)». GEMELLA di `fraseTentativo` in
 * `frontend/src/components/scudo/scadenzarioCalcolo.js`: la stessa scadenza si
 * deve leggere uguale sul telefono e in ufficio.
 */
export function fraseTentativo(t) {
  if (!t) return '';
  const quando = dataIt(t.data) ? ` il ${dataIt(t.data)}` : '';
  const che = t.esito === 'NON_ACCESSIBILE' ? 'non accessibile' : 'non eseguibile';
  const motivo = String(t.motivo || '').trim() || 'senza un motivo scritto';
  return `${che}${quando} — ${motivo}${t.operatore ? ` (${t.operatore})` : ''}`;
}

/** Il tentativo non eseguibile sul controllo di una scadenza, o `null`. */
export function tentativoDellaScadenza(s) {
  return s && s.asset_id ? S.tentativoNonEseguibile(s.asset_id, s.tipo_controllo_codice) : null;
}

/**
 * Divide un elenco di scadenze in «mai affrontate» e «segnate non eseguibili». I
 * due insiemi si spartiscono l'elenco: nessuna in tutti e due, nessuna fuori.
 */
export function spartisciScadenze(lista) {
  const daFare = [], nonEseguibili = [];
  for (const s of lista || []) (tentativoDellaScadenza(s) ? nonEseguibili : daFare).push(s);
  return { tutte: lista || [], daFare, nonEseguibili };
}

export function filtraPerLavoro(lista, modo) {
  const p = spartisciScadenze(lista);
  return modo === LAVORO.DA_FARE ? p.daFare : (modo === LAVORO.NON_ESEGUIBILI ? p.nonEseguibili : p.tutte);
}

/** Le voci dell'interruttore a tre, con i numeri. */
export function vociLavoro(lista) {
  const p = spartisciScadenze(lista);
  return [
    { chiave: LAVORO.TUTTE, etichetta: 'Tutte', n: p.tutte.length },
    { chiave: LAVORO.DA_FARE, etichetta: 'Mai affrontate', n: p.daFare.length },
    { chiave: LAVORO.NON_ESEGUIBILI, etichetta: 'Non eseguibili', n: p.nonEseguibili.length },
  ];
}

/** La pastiglia sulla riga di una scadenza: c'è solo se la scadenza è stata segnata non eseguibile. */
export function tagTentativo(s) {
  const t = tentativoDellaScadenza(s);
  return t ? tag(`⚠ ${fraseTentativo(t)}`, 'tag-ambra') : null;
}

/** Il motivo, corto abbastanza per una riga d'elenco. */
export function motivoBreve(t, max = 60) {
  const m = String((t && t.motivo) || '').trim() || 'senza un motivo scritto';
  return m.length > max ? `${m.slice(0, max - 1).trimEnd()}…` : m;
}

/**
 * La pastiglia di un presidio SOSPESO nell'elenco: dice il perché, non solo quante.
 * «⚠ non eseguibile: Centralina disalimentata…» e, se le voci sono più d'una con
 * ragioni diverse, quante altre.
 */
export function testoSospeso(assetId) {
  const voci = S.motiviNonEseguibili(assetId);
  if (!voci.length) return '';
  const motivi = [...new Set(voci.map((v) => motivoBreve(v.tentativo)))];
  const che = voci.every((v) => v.tentativo && v.tentativo.esito === 'NON_ACCESSIBILE') ? 'non accessibile' : 'non eseguibile';
  return `⚠ ${voci.length === 1 ? che : `${voci.length} verifiche non eseguibili`}: ${motivi[0]}${motivi.length > 1 ? ` (+${motivi.length - 1} ${motivi.length === 2 ? 'altro motivo' : 'altri motivi'})` : ''}`;
}

/**
 * Perché sono sospesi: i motivi, dal più frequente, con quanti presidi a testa.
 * Un presidio con due voci ferme per lo stesso motivo conta una volta.
 */
export function riepilogoMotivi(assetIds) {
  const perMotivo = new Map();
  for (const id of assetIds || []) {
    for (const m of new Set(S.motiviNonEseguibili(id).map((v) => String((v.tentativo && v.tentativo.motivo) || '').trim() || 'senza un motivo scritto'))) {
      perMotivo.set(m, (perMotivo.get(m) || 0) + 1);
    }
  }
  return [...perMotivo.entries()].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo, 'it'));
}

/** La scheda in cima alla vista «Sospesi»: perché sono fermi, e quanti per ogni ragione. */
export function cartaMotivi(assetIds) {
  const righe = riepilogoMotivi(assetIds);
  if (!righe.length) return null;
  return el('div', { class: 'card card-piatta carta-motivi' }, [
    el('h3', { testo: 'Perché sono sospesi', style: 'margin-top:0' }),
    el('div', { class: 'mini', style: 'margin-bottom:6px', testo: 'Qualcuno ci è andato e ha scritto perché la verifica non si è potuta fare. Tornano da fare al prossimo giro.' }),
    el('ul', { class: 'elenco-motivi' }, righe.slice(0, 8).map((r) => el('li', {}, [
      el('span', { class: 'motivo-n', testo: String(r.n) }),
      el('span', { class: 'motivo-testo', testo: ` ${r.n === 1 ? 'presidio' : 'presidi'} · ${r.motivo}` }),
    ]))),
    righe.length > 8 ? el('div', { class: 'mini', testo: `e altri ${righe.length - 8} motivi` }) : null,
  ].filter(Boolean));
}

/**
 * L'avviso sulla riga di un controllo quando la centralina del dispositivo è fuori
 * servizio (`t.centralina_fuori`, da `S.controlliApplicabili`). Dice la regola
 * prima che si scelga un esito.
 */
export function avvisoCentralina(cf) {
  if (!cf) return null;
  return el('div', { class: 'avviso avviso-ambra avviso-centralina', style: 'margin:0 0 8px' }, [
    el('strong', { testo: `⚠ La centralina${cf.identificativo ? ` ${cf.identificativo}` : ''} è fuori servizio` }),
    el('div', { class: 'mini', testo: `«${cf.motivo}». Con la centralina spenta questa prova non si può fare: `
      + 'registra «Verifica non eseguita» (né idoneo né non idoneo). Il difetto resta scritto sulla centralina; '
      + 'se questo pezzo ha un difetto SUO, quello si segnala come anomalia.' }),
  ]);
}

/** Il motivo già pronto per «Verifica non eseguita» sotto una centralina fuori servizio. */
export function motivoCentralina(cf) {
  return cf ? `Centralina${cf.identificativo ? ` ${cf.identificativo}` : ''} fuori servizio: da verificare a impianto ripristinato` : '';
}

// --------------------------------------------------------------------------- //
// «Senza scadenze calcolate» e «verifiche sospese»: il perché di ogni riga
// --------------------------------------------------------------------------- //

/**
 * Perché un presidio IN SERVIZIO non ha una scadenza calcolata (16/11/2026).
 *
 * Il dato che manca, come prima, e in più — è la riga che mancava — la verifica
 * che è stata SEGNATA NON ESEGUIBILE: il gruppo elettrogeno di PORTOFERRAIO
 * (UISUV-968) stava in questo elenco con «manca la data», e la cosa vera da sapere
 * era che la prova era stata saltata il 23/10/2026. Senza data e mai eseguita non
 * ha una scadenza; ma «nessuno può dire quando va guardata» era falso: quanto prima.
 */
export function percheSenzaScadenze(a) {
  const pezzi = S.mancanzeDeterminanti(a).map((m) => m.messaggio);
  const righe = S.controlliApplicabili(a);
  if (!pezzi.length && !righe.length) pezzi.push('nessun piano applicabile a questa tipologia');
  for (const t of righe) {
    const tent = S.tentativoNonEseguibile(a.id, t.codice);
    if (tent) pezzi.push(`⚠ ${t.descrizione || t.codice}: ${fraseTentativo(tent)} — va ancora eseguita`);
  }
  return pezzi.join(' · ') || 'nessun piano applicabile a questa tipologia';
}

/** Perché le verifiche di un presidio sono sospese: lo stato, e la nota che lo spiega. */
export function percheSospese(a) {
  const st = S.indici.stati.get(a.stato_codice);
  const nota = String(a.note || '').replace(/\s+/g, ' ').trim();
  const corta = nota.length > 160 ? `${nota.slice(0, 159)}…` : nota;
  return `⏸ ${(st && st.descrizione) || a.stato_codice}: non si controlla${corta ? ` — ${corta}` : ''}`;
}

