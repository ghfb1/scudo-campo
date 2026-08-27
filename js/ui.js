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
  SCADUTO: { testo: 'scaduto', segno: '!', classe: 'tag-ambra' },
  SEGREGATO: { testo: 'segregato', segno: '⊘', classe: 'tag-grigio' },
  DISMESSO: { testo: 'dismesso', segno: '⊘', classe: 'tag-grigio' },
  NON_PREVISTO: { testo: 'non previsto', segno: '–', classe: 'tag-grigio' },
};

export function tagIdoneita(id) {
  const e = IDONEITA_ETICHETTA[id && id.stato] || IDONEITA_ETICHETTA.IDONEO;
  return el('span', { class: `tag ${e.classe}` }, [
    el('span', { style: 'font-weight:800;margin-right:4px', testo: e.segno }),
    el('span', { testo: e.testo }),
    id && id.origine ? el('span', { style: 'opacity:.75', testo: ` — ${id.origine}` }) : null,
  ].filter(Boolean));
}

export function kpi(valore, etichetta, variante = '') {
  return el('div', { class: `kpi ${variante}`.trim() }, [
    el('div', { class: 'kpi-valore', testo: String(valore) }),
    el('div', { class: 'kpi-etichetta', testo: etichetta }),
  ]);
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
    const b = el('button', {
      type: 'button', class: 'scelta', testo: o.testo,
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
export function toast(messaggio, variante = '', durataMs = 3400) {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const id = ++toastId;
  const n = el('div', { class: `toast ${variante}`.trim(), testo: messaggio, dataset: { id } });
  wrap.append(n);
  setTimeout(() => { n.remove(); }, durataMs);
}

// --------------------------------------------------------------------------- //
// foglio a comparsa
// --------------------------------------------------------------------------- //
const sheet = () => document.getElementById('sheet');
const backdrop = () => document.getElementById('sheet-backdrop');
let ultimoFocus = null;

export function apriSheet(titolo, contenuto) {
  const s = sheet();
  const b = backdrop();
  ultimoFocus = document.activeElement;
  document.getElementById('sheet-titolo').textContent = titolo;
  const body = document.getElementById('sheet-body');
  svuotaNodo(body);
  body.append(contenuto);
  b.hidden = false;
  s.hidden = false;
  body.scrollTop = 0;
  document.body.style.overflow = 'hidden';
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
  sheet().hidden = true;
  backdrop().hidden = true;
  document.body.style.overflow = '';
  if (ultimoFocus && ultimoFocus.focus) ultimoFocus.focus({ preventScroll: true });
  if (fn) fn();
}

export function sheetAperto() { return !sheet().hidden; }

export function collegaSheet() {
  document.getElementById('sheet-chiudi').addEventListener('click', chiudiSheet);
  backdrop().addEventListener('click', chiudiSheet);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheetAperto()) chiudiSheet(); });
}

/** Conferma modale. Ritorna una Promise<boolean>. */
export function conferma({ titolo, messaggio, dettagli = [], ok = 'Conferma', variante = 'btn-primario' }) {
  return new Promise((resolve) => {
    const corpo = el('div', {}, [
      el('p', { testo: messaggio }),
      dettagli.length ? el('ul', { class: 'mini' }, dettagli.map((d) => el('li', { testo: d }))) : null,
      el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
        el('button', {
          class: 'btn', type: 'button', testo: 'Annulla',
          onclick: () => { chiudiSheet(); resolve(false); },
        }),
        el('button', {
          class: `btn ${variante}`, type: 'button', testo: ok,
          onclick: () => { chiudiSheet(); resolve(true); },
        }),
      ]),
    ]);
    apriSheet(titolo, corpo);
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
