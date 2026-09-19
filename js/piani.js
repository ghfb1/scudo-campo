/**
 * Quale piano di verifica si applica a un presidio — lato campo.
 *
 * Gemello di `backend/app/services/scudo_piani.py`. Non è una comodità: in
 * cabina non c'è rete, e l'app deve poter dire da sola «questo estintore vuole
 * il controllo ogni 6 mesi, ed ecco che cosa devi guardare». Le due
 * implementazioni sono tenute d'accordo da `scripts/scudo/test_periodicita_cross.py`,
 * che genera una matrice di casi e pretende che scelgano lo stesso piano.
 *
 * **Qui NON si calcolano date.** Le scadenze arrivano già calcolate
 * nell'archivio del pacchetto: portare in campo anche l'aritmetica del
 * calendario significherebbe due implementazioni del clamp di fine mese, cioè
 * un'altra cosa che può divergere. Qui si sceglie il piano, e basta.
 *
 * La valutazione è a **tre valori** come lato Python: VERO, FALSO,
 * INDETERMINATO. Un booleano confonderebbe «certamente no» con «non lo so», e
 * l'operatore leggerebbe «nessuna periodicità copre questo caso» dove invece
 * basta compilare un campo.
 */
export const VERO = 'VERO';
export const FALSO = 'FALSO';
export const INDETERMINATO = 'INDETERMINATO';

// Campo mancante -> campo di ripiego. "MINORANTE": il surrogato è un limite
// INFERIORE del campo vero (messa in servizio >= costruzione), quindi permette
// di concludere `>=` e mai `<=`.
export const SURROGATI = {
  data_messa_servizio: [['anno_costruzione', 'MINORANTE']],
};

// Durata indicativa in giorni: serve SOLO a ordinare due frequenze quando due
// piani competono. Non è aritmetica di calendario e non deve mai produrre una
// data.
const GIORNI_INDICATIVI = { GIORNI: 1, SETTIMANE: 7, MESI: 30, ANNI: 365 };

export function durataIndicativa(valore, unita) {
  if (!valore) return 0;
  return Number(valore) * (GIORNI_INDICATIVI[String(unita || 'MESI').toUpperCase()] || 30);
}

function vuoto(v) {
  return v === null || v === undefined || (typeof v === 'string' && !v.trim());
}

/** Il valore di un campo, sia su colonna sia dentro il dettaglio. */
export function valoreDi(asset, campo) {
  if (asset && Object.prototype.hasOwnProperty.call(asset, campo)) return asset[campo];
  // I campi con `colonna: false` (tipologia della porta, tipo di serbatoio,
  // numero di ante) viaggiano come colonne aggiuntive del foglio presidi, e
  // quindi arrivano già spianate sull'oggetto. Se un giorno arrivassero
  // annidati, li si cerca anche lì invece di rispondere "vuoto" — che
  // produrrebbe un piano che non si applica mai, in silenzio.
  const d = asset && asset.dettaglio_json;
  if (!d) return null;
  if (typeof d === 'string') {
    try { return (JSON.parse(d) || {})[campo]; } catch { return null; }
  }
  return d[campo];
}

function tipoCampo(campo, campiMeta) {
  const m = (campiMeta || []).find((c) => c.nome === campo);
  return (m && m.tipo) || 'testo';
}

function confrontabile(v, tipo) {
  if (vuoto(v)) return null;
  if (tipo === 'data') {
    // Si confronta come stringa ISO: sulle date ISO l'ordine lessicografico è
    // l'ordine cronologico. Il formato italiano viene normalizzato, perché il
    // gemello Python lo accetta e due parser che accettano insiemi diversi
    // divergono sul dato che uno dei due non capisce.
    const t = String(v).trim().split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    return null;
  }
  if (tipo === 'intero' || tipo === 'decimale') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (tipo === 'booleano') {
    const s = String(v).trim().toLowerCase();
    if (['1', 'true', 'si', 'sì', 'yes'].includes(s)) return 1;
    if (['0', 'false', 'no'].includes(s)) return 0;
    return null;
  }
  return String(v).trim().toUpperCase();
}

function annoComeData(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${String(n).padStart(4, '0')}-01-01` : null;
}

export function valutaClausola(clausola, asset, campiMeta) {
  const campo = clausola.campo;
  const op = (clausola.operatore || '=').trim();
  const tipo = tipoCampo(campo, campiMeta);
  const grezzo = valoreDi(asset, campo);

  if (op === 'vuoto') return vuoto(grezzo) ? VERO : FALSO;
  if (op === 'non_vuoto') return vuoto(grezzo) ? FALSO : VERO;

  let atteso = null;
  let attesi = [];
  if (op === 'in') {
    attesi = String(clausola.valore || '').split('|')
      .filter((x) => x.trim()).map((x) => confrontabile(x, tipo));
  } else {
    atteso = confrontabile(clausola.valore, tipo);
  }

  const valore = confrontabile(grezzo, tipo);

  if (valore === null) {
    for (const [nome, natura] of (SURROGATI[campo] || [])) {
      const s = valoreDi(asset, nome);
      if (vuoto(s)) continue;
      const sVal = nome === 'anno_costruzione'
        ? annoComeData(s) : confrontabile(s, tipoCampo(nome, campiMeta));
      if (sVal === null) continue;
      if (natura === 'MINORANTE' && op === '>=' && atteso !== null) {
        return sVal >= atteso ? VERO : INDETERMINATO;
      }
      return INDETERMINATO;
    }
    // Nessun surrogato dichiarato: vale il comportamento storico (un presidio
    // senza estinguente non riceve le regole per estinguente). È discutibile ed
    // è discusso nel gemello Python: cambiarlo sposterebbe i conteggi della
    // copertura, quindi va fatto da solo e non di contrabbando.
    return SURROGATI[campo] ? INDETERMINATO : FALSO;
  }

  if (op === '=') return valore === atteso ? VERO : FALSO;
  if (op === '!=') return valore !== atteso ? VERO : FALSO;
  if (op === 'in') return attesi.includes(valore) ? VERO : FALSO;
  if (atteso === null) return INDETERMINATO;
  if (op === '>=') return valore >= atteso ? VERO : FALSO;
  if (op === '<=') return valore <= atteso ? VERO : FALSO;
  return INDETERMINATO;
}

/** AND sui tre valori: basta un FALSO per escludere. */
export function pianoApplicabile(condizioni, asset, campiMeta) {
  let esito = VERO;
  for (const c of condizioni || []) {
    const v = valutaClausola(c, asset, campiMeta);
    if (v === FALSO) return FALSO;
    if (v === INDETERMINATO) esito = INDETERMINATO;
  }
  return esito;
}

function specificita(condizioni, asset, campiMeta) {
  return (condizioni || []).filter(
    (c) => valutaClausola(c, asset, campiMeta) === VERO).length;
}

/**
 * Il piano che vince, fra quelli che competono per lo stesso controllo.
 *
 * Classifica derivata, non assegnata a mano: priorità dichiarata, poi il piano
 * più specifico, poi la frequenza più corta, poi l'id. L'ultima chiave non è un
 * capriccio — senza, due valutazioni identiche potrebbero attribuire lo stesso
 * controllo a piani diversi.
 */
export const ESCLUDI = 'ESCLUDI';
export const INCLUDI = 'INCLUDI';
export const SOSTITUISCI_FREQUENZA = 'SOSTITUISCI_FREQUENZA';

/** Se una deroga vale oggi. */
export function eccezioneAttiva(e, oggi) {
  const g = (oggi || new Date()).toISOString().slice(0, 10);
  if (e.valida_dal && g < e.valida_dal) return false;
  if (e.valida_al && g > e.valida_al) return false;
  return true;
}

/**
 * Applica al piano le deroghe scritte su questo presidio.
 * Ritorna null se una deroga lo esclude.
 */
export function applicaEccezioni(piano, eccezioni, oggi) {
  if (!piano) return null;
  let fuori = piano;
  for (const e of eccezioni || []) {
    if (e.piano_id !== piano.id || !eccezioneAttiva(e, oggi)) continue;
    const azione = (e.azione || ESCLUDI).toUpperCase();
    if (azione === ESCLUDI) return null;
    if (azione === SOSTITUISCI_FREQUENZA && e.frequenza_valore) {
      fuori = { ...fuori,
        frequenza_valore: Number(e.frequenza_valore),
        frequenza_unita: e.frequenza_unita || fuori.frequenza_unita,
        _frequenza_in_deroga: true };
    }
  }
  return fuori;
}

export function pianoScelto(piani, condizioniPerPiano, asset, tipoAsset, tipoControllo,
                            campiMeta, eccezioni, oggi) {
  const candidati = [];
  for (const p of piani || []) {
    if (p.tipo_asset_codice !== tipoAsset) continue;
    if (p.tipo_controllo_codice !== tipoControllo) continue;
    if (p.attivo !== undefined && p.attivo !== null
        && Number(p.attivo) === 0) continue;
    // Un piano SU_RICHIESTA non si applica a nessuno da solo: vale solo sui
    // presidi che lo hanno ricevuto uno per uno, con una deroga INCLUDI. Il
    // salto è qui e non nella classifica: non è un piano che perde il
    // confronto, è un piano che al confronto non partecipa.
    if (String(p.ambito || 'TIPOLOGIA').toUpperCase() === 'SU_RICHIESTA') continue;
    const cond = condizioniPerPiano.get(p.id) || [];
    if (pianoApplicabile(cond, asset, campiMeta) !== VERO) continue;
    candidati.push({ piano: p, spec: specificita(cond, asset, campiMeta) });
  }
  // Una deroga INCLUDI porta dentro un piano che le condizioni escludono.
  const forzati = new Set((eccezioni || [])
    .filter((e) => (e.azione || '').toUpperCase() === INCLUDI && eccezioneAttiva(e, oggi))
    .map((e) => e.piano_id));
  if (forzati.size) {
    const gia = new Set(candidati.map((c) => c.piano.id));
    for (const p of piani || []) {
      // `attivo` vale anche qui: un piano ritirato che rientra perché una
      // vecchia deroga lo nomina genera scadenze che nessuno sorveglia più.
      if (p.attivo !== undefined && p.attivo !== null && Number(p.attivo) === 0) continue;
      if (forzati.has(p.id) && !gia.has(p.id) && p.tipo_controllo_codice === tipoControllo) {
        candidati.push({ piano: p, spec: 99 });
      }
    }
  }

  const ammessi = candidati.filter(
    (c) => applicaEccezioni(c.piano, eccezioni, oggi) !== null);
  if (!ammessi.length) return null;
  candidati.length = 0;
  candidati.push(...ammessi);
  candidati.sort((a, b) => {
    const pa = a.piano.priorita, pb = b.piano.priorita;
    const ha = pa !== null && pa !== undefined && pa !== '';
    const hb = pb !== null && pb !== undefined && pb !== '';
    if (ha !== hb) return ha ? -1 : 1;
    if (ha && Number(pb) !== Number(pa)) return Number(pb) - Number(pa);
    if (b.spec !== a.spec) return b.spec - a.spec;
    const da = durataIndicativa(a.piano.frequenza_valore, a.piano.frequenza_unita);
    const db = durataIndicativa(b.piano.frequenza_valore, b.piano.frequenza_unita);
    if (da !== db) return da - db;
    return String(a.piano.id).localeCompare(String(b.piano.id));
  });
  return applicaEccezioni(candidati[0].piano, eccezioni, oggi);
}

/** Perché un controllo previsto non produce nessuna scadenza. */
export function diagnosi(piani, condizioniPerPiano, asset, tipoAsset, tipoControllo, campiMeta) {
  const pertinenti = (piani || []).filter(
    (p) => p.tipo_asset_codice === tipoAsset
      && p.tipo_controllo_codice === tipoControllo
      && !(p.attivo !== undefined && p.attivo !== null && Number(p.attivo) === 0));
  if (!pertinenti.length) return null;      // controllo non previsto: non è una lacuna
  const esiti = pertinenti.map(
    (p) => pianoApplicabile(condizioniPerPiano.get(p.id) || [], asset, campiMeta));
  if (esiti.includes(VERO)) return null;
  if (esiti.includes(INDETERMINATO)) return 'DATO_MANCANTE';
  return 'LACUNA_TABELLA';
}

/** Etichetta leggibile di una frequenza: «ogni 6 mesi», «ogni anno». */
/**
 * Porta la frequenza all'unità più grande che la divide ESATTAMENTE.
 *
 * «Ogni 216 mesi» è un numero corretto che nessuno legge: per capire che sono
 * diciotto anni bisogna fare una divisione, in piedi, davanti a un estintore. E
 * accanto a «ogni 120 mesi» e «ogni 60 mesi» le tre voci si distinguono solo
 * contando le cifre.
 *
 * Le conversioni ammesse sono due, e sono esattamente le due che il CALCOLO
 * delle date considera esatte:
 *
 *   - 12 mesi = 1 anno, perché `aggiungi_periodo` definisce ANNI come
 *     `add_mesi(d, 12·n)` — una sola regola di calendario in tutto il sistema;
 *   - 7 giorni = 1 settimana, per la stessa ragione.
 *
 * Non si convertono 30 giorni in «un mese» né 52 settimane in «un anno»: sono
 * approssimazioni, e un'etichetta che approssima mente su una scadenza di legge.
 * Un piano da 18 mesi resta «ogni 18 mesi», che è quello che dice la norma.
 *
 * L'unità e il valore memorizzati non cambiano: questa è solo la lingua in cui
 * si scrivono. Il pacchetto, il seed e l'impronta dello scadenzario non vedono
 * niente di diverso.
 */
export function normalizzaFrequenza(valore, unita) {
  let n = Number(valore);
  let u = String(unita || 'MESI').toUpperCase();
  if (!Number.isFinite(n) || n <= 0) return { valore: 0, unita: u };
  if (u === 'MESI' && n >= 12 && n % 12 === 0) { n /= 12; u = 'ANNI'; }
  else if (u === 'GIORNI' && n >= 7 && n % 7 === 0) { n /= 7; u = 'SETTIMANE'; }
  return { valore: n, unita: u };
}

const NOMI_UNITA = {
  GIORNI: ['giorno', 'giorni'],
  SETTIMANE: ['settimana', 'settimane'],
  MESI: ['mese', 'mesi'],
  ANNI: ['anno', 'anni'],
};

/** «5 anni», «6 mesi», «settimana». Per le righe strette. */
export function frequenzaBreve(valore, unita) {
  const f = normalizzaFrequenza(valore, unita);
  if (!f.valore) return '';
  const nomi = NOMI_UNITA[f.unita] || NOMI_UNITA.MESI;
  return f.valore === 1 ? nomi[0] : `${f.valore} ${nomi[1]}`;
}

/** «ogni 5 anni», «ogni 6 mesi», «ogni settimana». */
export function etichettaFrequenza(valore, unita) {
  const b = frequenzaBreve(valore, unita);
  return b ? `ogni ${b}` : '';
}
