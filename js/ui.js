/**
 * Scudo Campo — utilità di interfaccia.
 *
 * Nessuna libreria: DOM diretto. Tutto il testo che proviene dai dati passa da
 * `testo()` o da `el()`, che usano `textContent`. Il pacchetto CSV arriva da un
 * file che l'operatore sceglie e può contenere qualunque cosa: inserirlo con
 * `innerHTML` significherebbe eseguirlo.
 */

export function el(tag, attrs = {}, figli = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'testo') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;            // solo con stringhe letterali del codice
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    // ⛔ Una TEXTAREA non ha un attributo `value` (23/09/2026, trovato su
    // segnalazione dell'operatore: «quando modifichiamo un'anomalia la
    // descrizione dovrebbe essere precompilata»). `setAttribute('value', …)` su
    // una textarea non mostra niente: il campo appariva VUOTO. E non era solo
    // estetica — in «Modifica anagrafica» il campo note vuoto risultava
    // «cambiato» rispetto all'archivio, e salvare per qualunque altro motivo
    // CANCELLAVA la nota (331 presidi su 875 ne hanno una). Stessa sorte per le
    // note del giro, di un luogo e l'esito di un punto aperto. Il valore si
    // mette come PROPRIETÀ, che è quello che il browser mostra.
    else if (k === 'value' && String(tag).toLowerCase() === 'textarea') n.value = String(v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  for (const f of [].concat(figli)) {
    if (f === null || f === undefined || f === false) continue;
    n.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return n;
}

export function svuotaNodo(n) { while (n.firstChild) n.removeChild(n.firstChild); }

export function testo(v, fallback = '—') {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

export function num(v, fallback = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function dataIt(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

export function dataOraIt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function tag(t, variante = '') {
  return el('span', { class: `tag ${variante}`.trim(), testo: t });
}

/**
 * L'etichetta dell'idoneità, con il colore e il segno.
 *
 * Colore E segno insieme: contro luce il rosso e l'ambra si somigliano, e c'è
 * chi non li distingue affatto. E la parola per esteso, perché «si può usare?» è
 * la domanda a cui questa etichetta risponde, e una pastiglia colorata non la
 * risponde.
 */
export const IDONEITA_ETICHETTA = {
  IDONEO: { testo: 'idoneo', segno: '✓', classe: 'tag-verde' },
  NON_IDONEO: { testo: 'non idoneo', segno: '✕', classe: 'tag-rosso' },
  // SCADUTO è uscito di qui il 17/09/2026: rispondeva a «è in regola con i
  // controlli?», che adesso ha la sua tabella qui sotto. Lasciarlo avrebbe
  // tenuto in piedi una voce che nessuno produce più, e il codice che la
  // gestisce sarebbe sopravvissuto per sempre senza che niente lo esegua.
  SEGREGATO: { testo: 'segregato', segno: '⊘', classe: 'tag-grigio' },
  DISMESSO: { testo: 'dismesso', segno: '⊘', classe: 'tag-grigio' },
  NON_PREVISTO: { testo: 'non previsto', segno: '–', classe: 'tag-grigio' },
};

/**
 * Lo stato delle VERIFICHE, separato dall'idoneità (17/09/2026).
 *
 * «Non in regola» non vuol dire rotto: vuol dire che una verifica è scaduta.
 * Tenerle insieme faceva leggere «scaduto» come un difetto del pezzo, e un pezzo
 * non idoneo come un ritardo di calendario.
 */
export const VERIFICHE_ETICHETTA = {
  REGOLARE: { testo: 'verifiche in regola', segno: '✓', classe: 'tag-verde' },
  NON_REGOLARE: { testo: 'verifiche non in regola', segno: '!', classe: 'tag-rosso' },
  SENZA: { testo: 'nessuna scadenza calcolata', segno: '?', classe: 'tag-grigio' },
};

export function tagVerifiche(v) {
  const e = VERIFICHE_ETICHETTA[v && v.stato] || VERIFICHE_ETICHETTA.SENZA;
  return el('span', { class: `tag ${e.classe}` }, [
    el('span', { style: 'font-weight:800;margin-right:4px', testo: e.segno }),
    el('span', { testo: e.testo }),
    v && v.stato === 'NON_REGOLARE' ? el('span', { style: 'opacity:.75', testo: ` — ${v.testo}` }) : null,
  ].filter(Boolean));
}

/**
 * Il pallino dell'elenco: UNA forma per DUE domande.
 *
 * In elenco c'è spazio per un segno solo, e le due domande non hanno la stessa
 * urgenza: un pezzo che non si può usare va RIPARATO, uno fuori regola va
 * RICONTROLLATO. Quindi l'idoneità decide per prima, e lo stato delle verifiche
 * parla quando l'idoneità non ha niente da dire.
 *
 * GEMELLO di `pallinoDi` in `frontend/src/components/scudo/idoneitaVocabolario.js`,
 * confrontato da `scripts/scudo/test_vocabolario_cross.mjs`. Restituisce una
 * CHIAVE neutra e non una classe CSS: i due alberi hanno fogli di stile diversi,
 * e la cosa che deve coincidere è la DECISIONE, non il nome del colore.
 */
export const PALLINO_CLASSE = {
  ko: 'ko', attenzione: 'attenzione', ok: 'ok', ignoto: 'ignoto',
};

export function pallinoDi({ idoneita, verifiche, inScadenza = false, incerto = false } = {}) {
  if (idoneita === 'NON_IDONEO') return { chiave: 'ko', segno: '✕' };
  if (idoneita === 'SEGREGATO' || idoneita === 'DISMESSO') return { chiave: 'ignoto', segno: '⊘' };
  if (idoneita === 'NON_PREVISTO') return { chiave: 'ignoto', segno: '–' };
  if (verifiche === 'NON_REGOLARE') return { chiave: 'ko', segno: '!' };
  if (inScadenza) return { chiave: 'attenzione', segno: '!' };
  if (incerto || verifiche === 'SENZA') return { chiave: 'ignoto', segno: '?' };
  return { chiave: 'ok', segno: '✓' };
}

/**
 * Un campo numerico SENZA frecce e senza rotella.
 *
 * ⛔ Non usare `input[type=number]` in quest'app. Segnalato dall'operatore il
 * 17/09/2026 sul numero di loop di una centralina, ma il difetto è lo stesso su
 * ogni campo numerico: un `type=number` a fuoco cambia valore con la ROTELLA e
 * con le frecce su/giù. Su una schermata che si scorre col pollice questo
 * significa che SCORRERE LA PAGINA RISCRIVE UN DATO, senza che chi scorre stia
 * guardando quel campo e senza che niente glielo dica.
 *
 * Il caso peggiore non è il loop: è «di cui guasti» nel controllo, che decide se
 * l'esito può essere idoneo. Uno scroll di troppo su quella riga cambia il
 * verdetto di un controllo antincendio.
 *
 * `inputmode` porta comunque la tastiera numerica sul telefono, che è l'unica
 * cosa che le frecce facevano di utile. `min`/`max` restano come promemoria e
 * vanno controllati da chi legge il valore: senza `type=number` il browser non
 * li applica più da solo, ed è meglio così — li applicava soltanto al submit di
 * un form, che qui non c'è.
 */
export function campoNumerico({ decimale = false, valore = '', placeholder = '',
  min = null, max = null, ...extra } = {}) {
  const ctrl = el('input', {
    type: 'text',
    inputmode: decimale ? 'decimal' : 'numeric',
    autocomplete: 'off',
    value: valore === null || valore === undefined ? '' : String(valore),
    ...(placeholder ? { placeholder } : {}),
    ...extra,
  });
  if (min !== null) ctrl.dataset.min = String(min);
  if (max !== null) ctrl.dataset.max = String(max);
  const ammesso = decimale ? /[^0-9.,-]/g : /[^0-9-]/g;
  ctrl.addEventListener('input', () => {
    const pulito = ctrl.value.replace(ammesso, '');
    if (pulito !== ctrl.value) ctrl.value = pulito;
  });
  return ctrl;
}

export function tagIdoneita(id) {
  const e = IDONEITA_ETICHETTA[id && id.stato] || IDONEITA_ETICHETTA.IDONEO;
  return el('span', { class: `tag ${e.classe}` }, [
    el('span', { style: 'font-weight:800;margin-right:4px', testo: e.segno }),
    el('span', { testo: e.testo }),
    id && id.origine ? el('span', { style: 'opacity:.75', testo: ` — ${id.origine}` }) : null,
  ].filter(Boolean));
}

/**
 * Un numero con la sua etichetta.
 *
 * Con `onClick` diventa un PULSANTE, non un `div` con un ascoltatore sopra: si
 * raggiunge con la tastiera, il lettore di schermo lo annuncia come tale, e si
 * vede che è toccabile. Un numero che si può aprire e non lo dice è un numero
 * che nessuno apre.
 */
export function kpi(valore, etichetta, variante = '', onClick = null) {
  const dentro = [
    el('div', { class: 'kpi-valore', testo: String(valore) }),
    el('div', { class: 'kpi-etichetta', testo: etichetta }),
  ];
  if (!onClick) return el('div', { class: `kpi ${variante}`.trim() }, dentro);
  return el('button', {
    class: `kpi kpi-apribile ${variante}`.trim(), type: 'button',
    'aria-label': `${valore} ${etichetta} — vedi quali`,
    onclick: onClick,
  }, [...dentro, el('span', { class: 'kpi-freccia', testo: '›' })]);
}

export function campo(etichetta, controllo, aiuto) {
  const id = controllo.id || `c-${Math.random().toString(36).slice(2, 9)}`;
  controllo.id = id;
  return el('div', {}, [
    el('label', { for: id, testo: etichetta }),
    controllo,
    aiuto ? el('div', { class: 'mini', testo: aiuto }) : null,
  ]);
}

/**
 * Una DATA con tre menù — giorno, mese, anno — invece del calendario
 * (23/09/2026, dall'operatore: «anziché usare il calendario, che è molto lento
 * da telefono, meglio tre campi: giorno, mese, anno. Scrivere che dove non si
 * sa il mese mettere gennaio. Deve essere pratico da smartphone»).
 *
 * Il calendario del telefono parte da OGGI: per una data di messa in servizio
 * del 2009 sono quindici anni da sfogliare, mese per mese. Tre menù sono tre
 * tocchi, e l'anno (quello che si sa quasi sempre) si sceglie per primo.
 *
 * ⛔ Il valore resta `AAAA-MM-GG` in `.value`, come quello di un
 * `input[type=date]`: chi legge il modulo non deve sapere che il campo è cambiato.
 * Scelto l'anno, mese e giorno vuoti diventano gennaio e 1 — SI VEDE, e lo dice
 * la riga sotto: non è un valore nascosto, è quello che la frase suggerisce.
 * Il giorno si adatta al mese (niente 31 febbraio). «—» sull'anno svuota.
 */
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio',
  'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export function campoData({ valore = '', annoMin = 1950, annoMax = new Date().getFullYear() + 1 } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valore || ''));
  const due = (n) => String(n).padStart(2, '0');
  const anni = [];
  for (let y = annoMax; y >= annoMin; y -= 1) anni.push({ valore: String(y), testo: String(y) });
  // Un anno fuori dall'intervallo (una data vecchia in archivio) resta scelto.
  if (m && !anni.some((x) => x.valore === m[1])) anni.push({ valore: m[1], testo: m[1] });
  const fGiorno = select([{ valore: '', testo: 'giorno' },
    ...Array.from({ length: 31 }, (_, i) => ({ valore: due(i + 1), testo: String(i + 1) }))], m ? m[3] : '',
  { 'aria-label': 'Giorno' });
  const fMese = select([{ valore: '', testo: 'mese' },
    ...MESI.map((n, i) => ({ valore: due(i + 1), testo: n }))], m ? m[2] : '', { 'aria-label': 'Mese' });
  const fAnno = select([{ valore: '', testo: 'anno' }, ...anni], m ? m[1] : '', { 'aria-label': 'Anno' });
  const giorniNelMese = () => {
    const y = Number(fAnno.value) || 2000;
    const mm = Number(fMese.value) || 1;
    return new Date(y, mm, 0).getDate();
  };
  const sistema = () => {
    if (!fAnno.value) return;
    if (!fMese.value) fMese.value = '01';
    if (!fGiorno.value) fGiorno.value = '01';
    if (Number(fGiorno.value) > giorniNelMese()) fGiorno.value = due(giorniNelMese());
  };
  for (const s of [fGiorno, fMese, fAnno]) s.addEventListener('change', sistema);
  const nodo = el('div', { class: 'campo-data' }, [
    el('div', { class: 'campo-data-menu' }, [fGiorno, fMese, fAnno]),
    el('div', { class: 'mini', testo: 'Se non sai il giorno o il mese, metti 1 e gennaio.' }),
  ]);
  Object.defineProperty(nodo, 'value', {
    get() {
      if (!fAnno.value) return '';
      const mm = fMese.value || '01';
      const gg = fGiorno.value || '01';
      const max = new Date(Number(fAnno.value), Number(mm), 0).getDate();
      return `${fAnno.value}-${mm}-${due(Math.min(Number(gg), max))}`;
    },
    set(v) {
      const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
      fAnno.value = x ? x[1] : ''; fMese.value = x ? x[2] : ''; fGiorno.value = x ? x[3] : '';
    },
  });
  nodo.menu = { giorno: fGiorno, mese: fMese, anno: fAnno };
  return nodo;
}

export function select(opzioni, valore, attrs = {}) {
  const s = el('select', attrs);
  for (const o of opzioni) {
    const opt = el('option', { value: o.valore, testo: o.testo });
    if (String(o.valore) === String(valore ?? '')) opt.selected = true;
    s.append(opt);
  }
  return s;
}

/**
 * Una scelta fra poche voci, fatta di pulsanti invece che di un menù a tendina.
 *
 * Perché non una `<select>`
 * -------------------------
 * Perché su un telefono la tendina nativa apre la ruota del sistema operativo,
 * che copre il foglio da cui è partita; dentro un foglio che a sua volta scorre,
 * con i guanti, in piedi, è il controllo peggiore che si possa mettere in una
 * schermata di campo. Con diciassette voci diventa inutilizzabile — ed è
 * successo: il selettore «che cosa ha» era di fatto inservibile.
 *
 * I pulsanti costano un tocco, sono alti 44px, si vedono tutti insieme e
 * mostrano che cosa è selezionato senza aprire niente. Occupano più spazio: è il
 * prezzo, e va pagato quando le voci sono poche o medie. Sopra una ventina di
 * voci torna preferibile un elenco cercabile.
 *
 * Il valore si legge da `.valore`, non da `.value`: un nodo che espone `value`
 * senza essere un campo di modulo verrebbe scambiato per uno, e il codice che
 * legge i moduli lo tratterebbe come tale.
 *
 * @param opzioni      [{ valore, testo }]
 * @param obbligatorio se falso, ri-toccando la voce scelta la si toglie
 */
export function scelte(opzioni, valore = '', { obbligatorio = false, onCambia } = {}) {
  const box = el('div', { class: 'scelte', role: 'group' });
  box.valore = valore;
  const bottoni = [];

  const dipingi = () => {
    for (const { b, o } of bottoni) {
      const attivo = String(box.valore) === String(o.valore);
      b.classList.toggle('scelta-attiva', attivo);
      b.setAttribute('aria-pressed', attivo ? 'true' : 'false');
    }
  };

  for (const o of opzioni) {
    // `tono` (24/09/2026): 'ok' | 'attenzione' | 'ko' colora la voce anche da
    // spenta — verde, giallo, rosso — e da accesa la riempie. Vedi il CSS.
    const b = el('button', {
      type: 'button', class: `scelta${o.tono ? ` tono-${o.tono}` : ''}`, testo: o.testo,
      onclick: () => {
        const gia = String(box.valore) === String(o.valore);
        box.valore = (gia && !obbligatorio) ? '' : o.valore;
        dipingi();
        if (onCambia) onCambia(box.valore);
      },
    });
    bottoni.push({ b, o });
    box.append(b);
  }
  // Chi cambia `box.valore` da fuori (la gravità suggerita da «che cosa ha»)
  // deve poterlo far vedere: senza, il valore cambia e i pulsanti no.
  box.ridipingi = dipingi;
  dipingi();
  return box;
}

export function vuoto(icona, messaggio, dettaglio) {
  return el('div', { class: 'vuoto' }, [
    el('span', { class: 'vuoto-ico', testo: icona }),
    el('div', { testo: messaggio }),
    dettaglio ? el('div', { class: 'mini', testo: dettaglio }) : null,
  ]);
}

export function avviso(messaggio, variante = '', elenco = []) {
  return el('div', { class: `avviso ${variante}`.trim() }, [
    el('div', { testo: messaggio }),
    elenco.length
      ? el('ul', {}, elenco.map((x) => el('li', { class: 'mono', testo: x })))
      : null,
  ]);
}

let toastId = 0;
/**
 * Il messaggio in basso. Con `onAnnulla` diventa un pulsante: «… - (clicca per
 * annullare)», richiesta dell'operatore del 15/09/2026. Resta più a lungo (chi
 * legge «segnato fra i controllati» sul presidio sbagliato deve fare in tempo), si
 * annulla una volta sola e sparisce al tocco.
 */
export function toast(messaggio, variante = '', durataMs = 3400, { onAnnulla } = {}) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return null;
  const id = ++toastId;
  // ⛔ Ogni messaggio ha la sua ✕ (26/09/2026, dall'operatore: «aggiungi una x per
  // chiuderle in anticipo»). Un messaggio che copre quello che serve e non si può
  // togliere fa aspettare sette secondi davanti al pezzo. La ✕ chiude e basta:
  // su quello annullabile NON annulla — per annullare si tocca il messaggio.
  let timer = null;
  let n = null;
  const chiudi = () => { if (timer !== null) clearTimeout(timer); if (n) n.remove(); };
  const chiudiBtn = el('button', {
    class: 'toast-chiudi', type: 'button', testo: '✕', 'aria-label': 'Chiudi il messaggio',
    onclick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); chiudi(); },
  });
  let corpo;
  if (!onAnnulla) {
    corpo = el('span', { class: 'toast-testo', testo: messaggio });
  } else {
    let usato = false;
    corpo = el('button', {
      class: 'toast-corpo', type: 'button', 'aria-label': `${messaggio}. Tocca per annullare`,
      onclick: () => {
        if (usato) return;
        usato = true;
        chiudi();
        onAnnulla();
      },
    }, [
      el('span', { testo: messaggio }),
      el('span', { class: 'toast-annulla', testo: ' - (clicca per annullare)' }),
    ]);
  }
  n = el('div', { class: `toast${onAnnulla ? ' toast-annullabile' : ''} ${variante}`.trim(), dataset: { id } },
    [corpo, chiudiBtn]);
  wrap.append(n);
  timer = setTimeout(chiudi, onAnnulla ? Math.max(durataMs, 7000) : durataMs);
  return n;
}

/**
 * Un messaggio che CHIEDE, sì o no (23/09/2026, richiesta dell'operatore per il
 * trascinamento sulla mappa: «il toast che appare deve essere diverso dagli
 * altri: deve chiedere conferma, spostare sì o no, anziché annulla»).
 *
 * Diverso a vista dagli altri messaggi (`toast-conferma`: chiaro, bordo spesso,
 * due pulsanti) e diverso nel comportamento: NON sparisce da solo. Un «sì» che
 * scade sarebbe una scelta fatta per conto di chi non ha risposto.
 *
 * @returns `{ nodo, risposta: Promise<boolean>, chiudi() }` — `chiudi()` risponde
 *   «no» (chi lascia la schermata senza rispondere non ha confermato niente).
 */
export function chiediConferma(messaggio, { si = 'Sì', no = 'No' } = {}) {
  const wrap = document.getElementById('toast-wrap');
  let risolvi;
  const risposta = new Promise((r) => { risolvi = r; });
  let finito = false;
  const fine = (valore) => {
    if (finito) return;
    finito = true;
    nodo.remove();
    risolvi(valore);
  };
  const nodo = el('div', { class: 'toast toast-conferma', role: 'alertdialog', 'aria-label': messaggio }, [
    el('div', { class: 'toast-conferma-testo', testo: messaggio }),
    el('div', { class: 'toast-conferma-scelte' }, [
      el('button', { class: 'btn btn-piccolo', type: 'button', testo: no, onclick: () => fine(false) }),
      el('button', { class: 'btn btn-piccolo btn-primario', type: 'button', testo: si, onclick: () => fine(true) }),
    ]),
  ]);
  if (wrap) wrap.append(nodo);
  else finito = true;
  if (!wrap) risolvi(false);
  return { nodo, risposta, chiudi: () => fine(false) };
}

/**
 * Una scelta fra tante voci, con la RICERCA (operatore, 16/09/2026).
 *
 * Una tendina con ventidue tipologie si scorre con la ruota di sistema, che sul
 * telefono copre il foglio da cui è partita: per arrivare a «Rivelatore di
 * idrogeno» si scorre alla cieca. Qui si scrivono due lettere e restano le voci
 * che le contengono; la scelta fatta resta visibile, con «cambia» accanto.
 *
 * Senza un valore iniziale NON si preseleziona niente e l'elenco nasce aperto: su
 * un modulo di creazione una tipologia preselezionata si salva per inerzia, e un
 * presidio con la tipologia sbagliata riceve i piani sbagliati senza che si veda.
 *
 * `voci`: [{ valore, testo, icona }]. Ritorna { nodo, valore(), apri() }.
 */
export function sceltaCercabile({ voci, valore, placeholder = 'Cerca…', onCambia }) {
  let scelto = valore || '';
  let aperto = !scelto;
  const nodo = el('div', { class: 'scelta-cercabile' });
  const cerca = el('input', { type: 'search', placeholder, autocomplete: 'off', 'aria-label': placeholder });
  const elenco = el('div', { class: 'scelta-voci' });
  const scelta = el('div', { class: 'scelta-fatta' });

  // TUTTE le voci, sempre. Fino al 17/09/2026 se ne mostravano OTTO (`mostrate = 8`)
  // e le altre comparivano solo scrivendo: segnalato dall'operatore, che apriva
  // «nuovo presidio» e vedeva otto tipologie su ventidue senza niente che dicesse
  // che ce n'erano altre. Un elenco troncato in silenzio non è un elenco corto: è
  // un elenco SBAGLIATO, perché chi non trova la sua voce conclude che non esiste
  // e ne sceglie una vicina. Il riquadro scorre — lo spazio si risolve con il CSS,
  // non nascondendo dati.
  const vociDi = (ago) => {
    const q = String(ago || '').trim().toLowerCase();
    return q ? voci.filter((v) => `${v.testo}`.toLowerCase().includes(q)) : voci;
  };

  function disegnaElenco() {
    svuotaNodo(elenco);
    const lista = vociDi(cerca.value);
    if (!lista.length) {
      elenco.append(el('div', { class: 'mini', testo: 'Nessuna voce con queste lettere.' }));
      return;
    }
    // Quante sono, sopra l'elenco: dice che il riquadro scorre, e con un ago
    // dice quante ne restano — «3 di 22» è l'informazione che manca quando si
    // filtra e non si trova quello che si cerca.
    elenco.append(el('div', { class: 'mini scelta-conteggio',
      testo: lista.length === voci.length
        ? `${voci.length} tipologie` : `${lista.length} di ${voci.length}` }));
    for (const v of lista) {
      elenco.append(el('button', {
        class: `scelta-voce${v.valore === scelto ? ' attiva' : ''}`, type: 'button',
        onclick: () => {
          scelto = v.valore;
          aperto = false;          // scelto: l'elenco si chiude e resta la scelta
          if (onCambia) onCambia(scelto);
          disegna();
        },
      }, [
        v.icona ? el('span', { class: 'f-ico', testo: v.icona }) : null,
        el('span', { testo: v.testo }),
      ].filter(Boolean)));
    }
  }

  function aggiorna() {
    cerca.hidden = !aperto;
    elenco.hidden = !aperto;
    scelta.hidden = aperto;
    if (aperto) disegnaElenco();
  }

  function disegna() {
    const v = voci.find((x) => x.valore === scelto);
    svuotaNodo(scelta);
    if (v) {
      scelta.append(el('span', { class: 'scelta-fatta-testo', testo: `${v.icona ? `${v.icona} ` : ''}${v.testo}` }));
      scelta.append(el('button', {
        class: 'btn btn-piccolo', type: 'button', testo: 'cambia',
        onclick: () => { aperto = true; aggiorna(); },
      }));
    }
    aggiorna();
  }

  cerca.addEventListener('input', disegnaElenco);
  nodo.append(scelta, cerca, elenco);
  disegna();
  return {
    nodo,
    valore: () => scelto,
    apri: () => { aperto = true; aggiorna(); },
    // Quello che è stato SCRITTO nella ricerca (23/09/2026): chi scrive
    // «estintore» e non tocca la voce vede la parola nel riquadro e crede di
    // aver scelto. Chi convalida il modulo deve poterlo riconoscere.
    testoCercato: () => String(cerca.value || '').trim(),
    /** Le voci che corrispondono a quello che è scritto. */
    corrispondenze: () => (String(cerca.value || '').trim() ? vociDi(cerca.value) : []),
    /** Sceglie una voce come se la si toccasse. */
    scegli: (v) => {
      if (!voci.some((x) => x.valore === v)) return;
      scelto = v; aperto = false;
      if (onCambia) onCambia(scelto);
      disegna();
    },
  };
}

// --------------------------------------------------------------------------- //
// foglio a comparsa
// --------------------------------------------------------------------------- //
const sheet = () => document.getElementById('sheet');
const backdrop = () => document.getElementById('sheet-backdrop');
let ultimoFocus = null;

/**
 * @param titolo  una stringa, oppure `{ titolo, sottotitolo }`.
 *
 * ⛔ Il sottotitolo esiste perché il titolo non si deve PERDERE (20/09/2026,
 * segnalazione dell'operatore): aprendo un presidio l'intestazione dice
 * «• 7663 • CO2 • UISUV-13», e premendo «idoneo» quella riga veniva sostituita
 * dal nome del controllo. Chi registra un giudizio deve continuare a vedere su
 * quale pezzo lo sta registrando — è l'unica cosa che non può ricavare da
 * nient'altro, e sbagliare pezzo è l'errore più caro di tutta l'app.
 */
/**
 * Toglie il fuoco al campo del foglio prima di chiuderlo o svuotarlo (25/09/2026).
 *
 * Segnalazione dell'operatore: rinominando un'area «non diventa cliccabile il
 * campo per modificarla». Rinominare un luogo dell'ufficio passa prima dal foglio
 * della password: su iPhone, un campo che ha il fuoco e sparisce dalla pagina
 * mentre la tastiera è aperta lascia la tastiera e il fuoco in uno stato da cui il
 * campo successivo non si attiva al tocco. Non riprodotto in un browser da
 * scrivania (lì tutto funziona): è la difesa per l'ipotesi, non la prova.
 */
function lasciaIlFuoco(s) {
  const attivo = document.activeElement;
  if (attivo && attivo !== document.body && s && s.contains && s.contains(attivo) && attivo.blur) attivo.blur();
}

export function apriSheet(titolo, contenuto) {
  const s = sheet();
  const b = backdrop();
  lasciaIlFuoco(s);
  ultimoFocus = document.activeElement;
  const principale = typeof titolo === 'string' ? titolo : (titolo || {}).titolo || '';
  const sotto = typeof titolo === 'string' ? '' : (titolo || {}).sottotitolo || '';
  document.getElementById('sheet-titolo').textContent = principale;
  const nodoSotto = document.getElementById('sheet-sottotitolo');
  if (nodoSotto) {
    nodoSotto.textContent = sotto;
    nodoSotto.hidden = !sotto;
  }
  const body = document.getElementById('sheet-body');
  svuotaNodo(body);
  body.append(contenuto);
  b.hidden = false;
  s.hidden = false;
  body.scrollTop = 0;
  // Si blocca `#vista`, non più il `body`: dal 19/09/2026 a scorrere è quello
  // (il documento non scorre affatto, o su iOS la tabbar si disancora). Il
  // `body` resta per i browser che servissero una pagina vecchia dalla cache.
  document.body.style.overflow = 'hidden';
  const v = document.getElementById('vista');
  if (v) v.style.overflow = 'hidden';
  const primo = s.querySelector('button, input, select, textarea, [tabindex]');
  if (primo) primo.focus({ preventScroll: true });
}

/**
 * Che cosa fare quando il foglio si chiude senza premere un pulsante:
 * toccando fuori, la ✕, o Escape.
 *
 * Per un FORM la chiusura è un annullamento e va bene così. Per un pannello di
 * filtri no: si spuntano tre tipologie, si tocca fuori per tornare all'elenco —
 * che è il gesto naturale, perché il pannello copre proprio l'elenco che si
 * vuole vedere — e le tre spunte si perdono. L'operatore le rifà, tocca fuori,
 * le perde di nuovo, e conclude che il filtro non funziona.
 */
let allaChiusura = null;

export function apriSheetConChiusura(titolo, contenuto, fn) {
  allaChiusura = fn;
  apriSheet(titolo, contenuto);
}

export function chiudiSheet() {
  const fn = allaChiusura;
  allaChiusura = null;
  lasciaIlFuoco(sheet());
  sheet().hidden = true;
  backdrop().hidden = true;
  document.body.style.overflow = '';
  const v = document.getElementById('vista');
  if (v) v.style.overflow = '';
  if (ultimoFocus && ultimoFocus.focus) ultimoFocus.focus({ preventScroll: true });
  if (fn) fn();
}

export function sheetAperto() { return !sheet().hidden; }

export function collegaSheet() {
  document.getElementById('sheet-chiudi').addEventListener('click', chiudiSheet);
  backdrop().addEventListener('click', chiudiSheet);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetAperto()) chiudiSheet(); });
}

/**
 * Conferma modale. Ritorna una Promise<boolean>.
 *
 * Chiudere il foglio senza premere un pulsante (fuori, ✕, Esc) vale «Annulla».
 * Prima la promessa restava sospesa per sempre, e chi la aspettava non andava
 * né avanti né indietro. La decisione vale una volta: il pulsante risolve e POI
 * chiude, e la chiusura trova la promessa già risolta.
 */
export function conferma({ titolo, messaggio, dettagli = [], ok = 'Conferma', variante = 'btn-primario' }) {
  return new Promise((resolve) => {
    let deciso = false;
    const fine = (v) => { if (deciso) return; deciso = true; resolve(v); };
    const corpo = el('div', {}, [
      el('p', { testo: messaggio }),
      dettagli.length ? el('ul', { class: 'mini' }, dettagli.map((d) => el('li', { testo: d }))) : null,
      el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
        el('button', {
          class: 'btn', type: 'button', testo: 'Annulla',
          onclick: () => { fine(false); chiudiSheet(); },
        }),
        el('button', {
          class: `btn ${variante}`, type: 'button', testo: ok,
          onclick: () => { fine(true); chiudiSheet(); },
        }),
      ]),
    ]);
    apriSheetConChiusura(titolo, corpo, () => fine(false));
  });
}

// --------------------------------------------------------------------------- //
// download di un file generato in pagina
// --------------------------------------------------------------------------- //
export function scaricaFile(nome, contenuto, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([contenuto], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  // Il revoke immediato su iOS può annullare il download appena avviato.
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

// --------------------------------------------------------------------------- //
// Grafici
// --------------------------------------------------------------------------- //
//
// Scritti in SVG a mano, senza librerie.
//
// L'app di campo non ha nessuna dipendenza esterna: sta su una pagina statica,
// deve aprirsi in modalità aereo dentro una cabina, e ogni libreria è peso da
// scaricare la prima volta e da tenere in cache per sempre. Un istogramma e una
// ciambella sono cento righe di SVG; Chart.js sono duecento kilobyte.
//
// Regole che valgono per tutti e due:
//  - il numero c'è SEMPRE scritto accanto alla forma. Su un telefono contro
//    luce la lunghezza di una barra non si stima, e un grafico che si può solo
//    guardare è decorazione;
//  - se si può toccare, si tocca: una barra che filtra l'elenco è uno strumento,
//    una barra che non fa niente occupa lo schermo.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(nome, attributi = {}) {
  const n = document.createElementNS(SVG_NS, nome);
  for (const [k, v] of Object.entries(attributi)) {
    if (v !== null && v !== undefined) n.setAttribute(k, String(v));
  }
  return n;
}

/**
 * Ciambella: due o tre quote di un totale.
 *
 * @param fette  [{ valore, etichetta, colore }]
 * @param centro { numero, testo }
 */
export function ciambella(fette, centro = {}) {
  const dati = fette.filter((f) => Number(f.valore) > 0);
  const totale = dati.reduce((n, f) => n + Number(f.valore), 0);
  const box = el('div', { class: 'grafico-ciambella' });
  if (!totale) {
    box.append(el('div', { class: 'mini', testo: 'Niente da mostrare' }));
    return box;
  }

  const R = 54;
  const spessore = 18;
  const raggio = R - spessore / 2;
  const circonferenza = 2 * Math.PI * raggio;
  const svg = svgEl('svg', {
    viewBox: `0 0 ${R * 2} ${R * 2}`, width: 132, height: 132,
    role: 'img', 'aria-label': dati.map((f) => `${f.etichetta}: ${f.valore}`).join(', '),
  });

  let offset = 0;
  for (const f of dati) {
    const quota = Number(f.valore) / totale;
    const arco = svgEl('circle', {
      cx: R, cy: R, r: raggio, fill: 'none',
      stroke: f.colore, 'stroke-width': spessore,
      'stroke-dasharray': `${circonferenza * quota} ${circonferenza * (1 - quota)}`,
      'stroke-dashoffset': -circonferenza * offset,
      transform: `rotate(-90 ${R} ${R})`,
    });
    svg.append(arco);
    offset += quota;
  }

  if (centro.numero !== undefined) {
    const t = svgEl('text', {
      x: R, y: R - 2, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 700,
      fill: 'currentColor',
    });
    t.textContent = String(centro.numero);
    svg.append(t);
    if (centro.testo) {
      const s = svgEl('text', {
        x: R, y: R + 15, 'text-anchor': 'middle', 'font-size': 9,
        fill: 'var(--testo-tenue)',
      });
      s.textContent = centro.testo;
      svg.append(s);
    }
  }

  box.append(svg);
  box.append(el('ul', { class: 'legenda' }, dati.map((f) => el('li', {}, [
    el('span', { class: 'legenda-pallino', style: `background:${f.colore}` }),
    el('span', { class: 'legenda-testo', testo: f.etichetta }),
    el('b', { testo: String(f.valore) }),
  ]))));
  return box;
}

/**
 * Barre orizzontali impilate, con legenda obbligatoria.
 *
 * Perché la legenda è un parametro e non un'opzione
 * -------------------------------------------------
 * La versione precedente disegnava una barra grigia con dentro una quota
 * colorata e scriveva accanto «2/430». Sullo schermo di un telefono quella riga
 * pone tre domande e non risponde a nessuna: che cosa è grigio, che cosa è
 * rosso, e se «2/430» voglia dire «2 fatti su 430» (progresso) o «2 scaduti su
 * 430 aperti» (stato). Erano due codifiche diverse nella stessa forma, senza
 * chiave.
 *
 * Adesso ogni colore ha un nome scritto sopra il grafico, e non si può disegnare
 * una serie che non sia in legenda: `serie` è la legenda ed è anche l'elenco di
 * ciò che si disegna, quindi non possono divergere.
 *
 * E il numero non è più una frazione ambigua: a destra c'è il TOTALE della riga,
 * e sotto la barra la ripartizione a parole — «2 scadute · 5 in scadenza · 423
 * in regola». Sotto quel testo la barra diventa un accessorio, che è esattamente
 * quello che deve essere: la si guarda per confrontare due righe a colpo
 * d'occhio, non per leggerci dentro un numero.
 *
 * Due cose che la barra dice, e vanno dette anche a parole (`nota`):
 *   - la LUNGHEZZA è quante sono, in proporzione alla riga più grande;
 *   - i COLORI sono come stanno.
 *
 * @param serie  [{ chiave, etichetta, colore }] — la legenda
 * @param righe  [{ etichetta, sotto, valori: {chiave: n}, onclick }]
 */
export function barreImpilate({ serie, righe, nota = '' }) {
  const tot = (r) => serie.reduce((n, s) => n + (Number(r.valori[s.chiave]) || 0), 0);
  const dati = righe.filter((r) => tot(r) > 0);
  if (!dati.length) return el('div', { class: 'mini', testo: 'Niente da mostrare' });
  const cima = Math.max(...dati.map(tot));

  // La legenda mostra solo le serie che compaiono almeno una volta: una voce di
  // legenda per un colore che non si vede da nessuna parte fa cercare a chi
  // legge una cosa che non c'è.
  const presenti = serie.filter((s) => dati.some((r) => Number(r.valori[s.chiave]) > 0));

  return el('div', { class: 'grafico' }, [
    el('ul', { class: 'legenda legenda-riga' }, presenti.map((s) => el('li', {}, [
      el('span', { class: 'legenda-pallino', style: `background:${s.colore}` }),
      el('span', { class: 'legenda-testo', testo: s.etichetta }),
    ]))),
    nota ? el('div', { class: 'mini', style: 'margin:2px 0 8px', testo: nota }) : null,
    el('ul', { class: 'grafico-barre' }, dati.map((r) => {
      const totale = tot(r);
      const parti = presenti
        .map((s) => ({ ...s, n: Number(r.valori[s.chiave]) || 0 }))
        .filter((x) => x.n > 0);

      const barra = el('div', { class: 'barra-esterna' }, [
        el('div', { class: 'barra-piena', style: `width:${(totale / cima) * 100}%` },
          parti.map((x) => el('div', {
            class: 'barra-quota',
            style: `flex:0 0 ${(x.n / totale) * 100}%;background:${x.colore}`,
            title: `${x.etichetta}: ${x.n}`,
          }))),
      ]);

      const corpo = el('div', { class: 'barra-corpo' }, [
        el('div', { class: 'barra-riga' }, [
          el('span', { class: 'barra-etichetta', testo: r.etichetta }),
          el('b', { class: 'barra-numero', testo: String(totale) }),
        ]),
        barra,
        // La ripartizione a parole. È la riga che rende il grafico leggibile
        // senza doverlo interpretare: quando c'è una sola serie non serve, e
        // ripeterla direbbe due volte il numero già scritto a destra.
        parti.length > 1
          ? el('div', { class: 'mini barra-dettaglio' },
            parti.map((x, i) => el('span', {}, [
              i ? el('span', { class: 'barra-punto', testo: ' · ' }) : null,
              el('span', { style: `color:${x.colore};font-weight:600`, testo: String(x.n) }),
              el('span', { testo: ` ${x.etichetta}` }),
            ])))
          : null,
        r.sotto ? el('div', { class: 'mini', testo: r.sotto }) : null,
      ]);

      return el('li', {},
        r.onclick
          ? [el('button', { type: 'button', class: 'barra-tocca', onclick: r.onclick }, [
            corpo, el('span', { class: 'barra-freccia', testo: '\u203a' }),
          ])]
          : [corpo]);
    })),
  ]);
}
