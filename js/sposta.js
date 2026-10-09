/**
 * Scudo Campo — spostare nell'albero, come cartelle (22/09/2026).
 *
 * Richiesta dell'operatore: «nella tab albero l'admin deve poter attivare la
 * modalità drag and drop, così che si possano spostare le aree da un livello a
 * un altro, da un'ubicazione a un'altra, da un impianto a un altro, come se
 * fossero cartelle. Semplice e intuitivo, anche da mobile, con animazioni
 * intuitive. Dobbiamo anche poter visualizzare i presidi e spostare anche
 * quelli, con la selezione multipla. Oltre al drag and drop, anche con i
 * pulsanti (sposta qui / annulla).»
 *
 * Due strade per lo stesso gesto, e nessuna è il ripiego dell'altra:
 *
 *  * **i pulsanti**: si spunta quello che si vuole spostare, e su ogni luogo che
 *    lo accetterebbe compare «⤵ Sposta qui». È la strada che funziona sempre,
 *    anche con un guanto o con un dito solo mentre l'altra mano tiene la scala;
 *  * **il trascinamento**: si prende la maniglia ⠿ e si porta sulla
 *    destinazione. La maniglia è l'UNICO punto che trascina — il resto della
 *    riga scorre la pagina come sempre: su un telefono, una riga intera che
 *    trascina rende impossibile scorrere un albero di seicento luoghi.
 *
 * ⛔ Le regole NON stanno qui. Se una destinazione accetta o no lo decide
 * `pianoSpostamento` in `stato.js`, passata da fuori come `azioni.piano`: la
 * stessa funzione colora la destinazione sotto il dito, accende o spegne «Sposta
 * qui» e rifiuta lo spostamento vero. Tre risposte diverse vorrebbero dire una
 * destinazione verde che poi non accetta. Misurato: 588 destinazioni in 4 ms.
 *
 * Perché un modulo a sé: `app.js` apre IndexedDB e avvia l'applicazione appena
 * viene importato, quindi nessuna prova può costruirlo. Qui c'è solo DOM, e ciò
 * che il browser vero ha e il DOM finto no (`elementFromPoint`, la cattura del
 * puntatore, `requestAnimationFrame`) arriva da fuori o è guardato.
 */
import { el } from './ui.js';
import { dettaglioTipologia, nomePresidio } from './nome_presidio.js';

const ICONA = { impianto: '🏭', edificio: '🏢', locale: '🚪', presidio: '🧯' };
const NOME = { impianto: 'impianto', edificio: 'area', locale: 'ubicazione', presidio: 'presidio' };
const PLURALE = { edificio: 'aree', locale: 'ubicazioni', presidio: 'presidi' };
const FIGLIO = { impianto: 'edificio', edificio: 'locale' };

/** Quanto deve muoversi il dito sulla maniglia prima che sia un trascinamento. */
export const SOGLIA_TRASCINA_PX = 6;
/** Quanto si resta sopra un luogo chiuso prima che si apra da sé. */
export const APRI_SOPRA_MS = 700;

const chiave = (tipo, id) => `${tipo}:${id}`;

// ⚠️ Una classe alla volta: `classList.remove('a', 'b')` nel browser le toglie
// tutte e due, nel DOM finto delle prove solo la prima — e una prova vedrebbe
// un bersaglio ancora acceso che nel browser si è spento.
const togli = (nodo, ...classi) => { for (const c of classi) nodo.classList.remove(c); };

/**
 * Come si chiama un presidio nell'albero: PRIMA che cosa è, poi quale.
 *
 * ⛔ Nel browser vero i presidi si chiamavano «[object Object]»:
 * `nomePresidio()` restituisce `{ principale, eMatricola, secondario }`, non una
 * stringa, e la prova col DOM finto usava `a.codice` al posto della funzione
 * vera — cioè provava una scorciatoia che nell'app non c'era. Adesso la regola
 * sta qui, e la prova la esegue sui presidi del pacchetto.
 *
 * L'ordine è la lezione dell'elenco «senza scadenze» (20/09/2026): finché non
 * sai se è un estintore o una lampada, «7663» non è un'informazione, è un
 * numero. La matricola è NOMINATA («matr. 7663»): il numero nudo si legge come
 * un progressivo, e i due si cercano in due posti diversi del pezzo.
 */
export function presidioInAlbero(a, cat = null) {
  const n = nomePresidio(a);
  // ⛔ Il nome della categoria dal CATALOGO (`cat`, 26/09/2026), non dalla colonna
  // di contesto `a.categoria`: quella la scrive l'ufficio esportando, e un presidio
  // creato in campo — o aggiunto d'ufficio a un pacchetto — non ce l'ha. Visto sul
  // telefono: «LEVA_SGANCIO · UISUV-930».
  const nomeCat = (cat && cat.descrizione) || a.categoria || a.categoria_codice;
  const cosa = [nomeCat, dettaglioTipologia(a)].filter(Boolean).join(' · ');
  const quale = [n.principale ? (n.eMatricola ? `matr. ${n.principale}` : n.principale) : '', n.secondario]
    .filter(Boolean).join(' · ');
  return { id: a.id, nome: cosa || quale || a.codice || 'presidio', dettaglio: cosa ? quale : '',
    icona: (cat && cat.icona) || '' };
}

/** «2 aree, 1 ubicazione e 3 presidi» — la selezione detta a parole. */
export function selezioneAParole(elementi) {
  const n = { edificio: 0, locale: 0, presidio: 0 };
  for (const e of elementi) if (n[e.tipo] !== undefined) n[e.tipo] += 1;
  const parti = ['edificio', 'locale', 'presidio'].filter((t) => n[t])
    .map((t) => `${n[t]} ${n[t] === 1 ? NOME[t] : PLURALE[t]}`);
  if (parti.length <= 1) return parti[0] || 'niente';
  return `${parti.slice(0, -1).join(', ')} e ${parti[parti.length - 1]}`;
}

/**
 * Il riassunto da confermare, a parole: che cosa si sposta, dove, che cosa si
 * porta dietro, e chi cambia livello. La conferma serve a QUESTO: un gesto di un
 * dito può muovere quaranta presidi, e va detto prima.
 */
export function fraseDiConferma(elementi, piano) {
  const r = piano.riassunto || {};
  const righe = [`Sposti ${selezioneAParole(elementi)}${r.dentro ? ` ${r.dentro}` : ''}.`];
  if (r.presidi_portati) {
    // L'accordo si è visto sbagliato nel browser: «Viene con LORO 1 presidio che
    // ci STANNO dentro» per una sola ubicazione. Con lei (area e ubicazione
    // sono femminili) o con loro; un presidio ci sta, due ci stanno.
    const con = elementi.length === 1 ? 'con lei' : 'con loro';
    righe.push(r.presidi_portati === 1
      ? `Viene ${con} 1 presidio che ci sta dentro, con i suoi controlli.`
      : `Vengono ${con} ${r.presidi_portati} presidi che ci stanno dentro, con i loro controlli.`);
  }
  for (const c of r.conversioni || []) {
    righe.push(`«${c.nome}» diventa ${c.a === 'edificio' ? "un'area" : "un'ubicazione"}.`);
  }
  if (r.con_il_padre) {
    righe.push(`${r.con_il_padre === 1 ? 'Un elemento scelto sta' : `${r.con_il_padre} elementi scelti stanno`} `
      + 'già dentro un altro scelto: viene con lui.');
  }
  if (r.gia_li) righe.push(`${r.gia_li === 1 ? 'Uno è' : `${r.gia_li} sono`} già lì e resta dov'è.`);
  return righe;
}

/**
 * La vista dell'albero in modalità «sposta».
 *
 * @param radici   i nodi di `alberoUbicazioni()`
 * @param azioni   `{ piano(elementi, dest), sposta(elementi, dest), presidiDi(tipo, id),
 *                    conferma({ titolo, righe, si, onSi }), avvisa(testo), onFine() }`
 * @param memoria  `{ aperti: Set, selezione: Map, conPresidi, arrivati: Set }` —
 *                 la tiene chi chiama, così sopravvive a un ridisegno
 * @param opzioni  `{ trovaSotto(x, y) }` — nel browser `document.elementFromPoint`;
 *                 nelle prove una funzione che restituisce la riga voluta
 */
export function vistaSposta(radici, azioni = {}, memoria = {}, opzioni = {}) {
  const aperti = memoria.aperti || (memoria.aperti = new Set());
  const selezione = memoria.selezione || (memoria.selezione = new Map());
  const arrivati = memoria.arrivati || new Set();
  memoria.arrivati = new Set();
  const avvisa = azioni.avvisa || (() => {});
  const trovaSotto = opzioni.trovaSotto
    || ((x, y) => (typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null));
  const raf = globalThis.requestAnimationFrame || ((f) => setTimeout(f, 16));
  const annullaRaf = globalThis.cancelAnimationFrame || clearTimeout;

  // Il registro delle righe: chiave → { tipo, id, nome, riga, qui, spunta, apri }.
  // Il bersaglio sotto il dito si ritrova risalendo i genitori fino a una riga
  // registrata (`__sposta`): niente `closest` né attributi da tenere allineati.
  const righe = new Map();
  let timerApri = null;

  const elenco = () => [...selezione.values()];

  // ---------------------------------------------------------------- disegno
  function rigaNodo(nodo, livello) {
    const k = chiave(nodo.tipo, nodo.id);
    const presidi = memoria.conPresidi && azioni.presidiDi ? azioni.presidiDi(nodo.tipo, nodo.id) : [];
    const figliNodi = (nodo.figli || []).map((f) => rigaNodo(f, livello + 1));
    const figliPresidi = presidi.map((p) => rigaPresidio(p, livello + 1));
    const haFigli = figliNodi.length + figliPresidi.length > 0;
    let aperto = aperti.has(k);
    const contenitore = el('div', { class: 'sposta-figli', hidden: !aperto },
      [...figliNodi, ...figliPresidi]);
    const freccia = el('button', {
      class: 'sposta-freccia', type: 'button', testo: haFigli ? (aperto ? '▾' : '▸') : '·',
      'aria-label': haFigli ? (aperto ? `Chiudi ${nodo.nome}` : `Apri ${nodo.nome}`) : nodo.nome,
      onclick: () => apri(!aperto),
    });
    function apri(si) {
      if (!haFigli) return;
      aperto = si;
      contenitore.hidden = !aperto;
      freccia.textContent = aperto ? '▾' : '▸';
      if (aperto) aperti.add(k); else aperti.delete(k);
    }
    const mobile = nodo.tipo !== 'impianto';
    const spunta = mobile ? el('input', { type: 'checkbox', class: 'sposta-spunta',
      'aria-label': `Scegli ${NOME[nodo.tipo]} ${nodo.nome}`,
      onchange: () => scegli(k, spunta.checked) }) : null;
    const maniglia = mobile ? el('span', { class: 'sposta-maniglia', testo: '⠿',
      title: 'Tieni premuto e trascina', 'aria-hidden': 'true' }) : null;
    const qui = el('button', { class: 'btn btn-piccolo sposta-qui', type: 'button', testo: '⤵ Sposta qui',
      hidden: true, onclick: () => spostaQui(k) });
    // ⛔ Rinomina, elimina e crea anche QUI (23/09/2026, richiesta
    // dell'operatore: «nella modalità sposta dovrebbero esserci anche i pulsanti
    // per rinominare o eliminare le aree»). Riordinare è spostare, ma anche
    // correggere un nome e togliere un'area rimasta vuota — uscire e rientrare
    // per farlo spezzava il lavoro in due.
    //
    // Le funzioni sono QUELLE dell'albero normale, passate da fuori: stessa
    // password per i luoghi dell'ufficio, stesso «Elimina» spento con il motivo
    // quando dentro c'è qualcosa.
    //
    // ⛔ E RESTANO anche con una scelta in corso, con «Sposta qui» al primo posto
    // della stessa riga (26/09/2026, dall'operatore: «quando flaggo qualcosa perdo
    // il focus di ciò che ho flaggato perché cambia visualizzazione»). Fino alla
    // v145 i comandi sparivano durante la scelta; dalla v146, sul telefono, hanno
    // una riga loro — quindi sparendo accorciavano OGNI riga di ~44 px, l'elenco
    // saliva e quello appena spuntato usciva dallo schermo. Nessuna riga deve
    // cambiare altezza mentre si sceglie.
    const perche = azioni.perchePuoi ? (azioni.perchePuoi(nodo) || {}) : { eliminabile: true };
    // La posizione del luogo (25/09/2026): 🗺 se ce l'ha — apre la mappa —, 📍
    // se no — chiede come darla. Il gesto arriva da fuori (`azioni.posizione`,
    // lo stesso dell'albero normale); qui c'è solo l'icona, piccola come le altre.
    const pos = azioni.posizione ? azioni.posizione(nodo) : null;
    const comandi = el('span', { class: 'sposta-comandi-luogo' }, [
      qui,
      pos ? el('button', {
        class: `btn btn-piccolo sposta-icona${pos.conPos ? '' : ' sposta-icona-manca'}`, type: 'button',
        testo: pos.segno, title: pos.etichetta, 'aria-label': pos.etichetta,
        onclick: () => pos.fai(),
      }) : null,
      (azioni.crea && FIGLIO[nodo.tipo]) ? el('button', {
        class: 'btn btn-piccolo sposta-icona', type: 'button', testo: '＋',
        title: `Nuova ${NOME[FIGLIO[nodo.tipo]]} qui`, 'aria-label': `Nuova ${NOME[FIGLIO[nodo.tipo]]} in ${nodo.nome}`,
        onclick: () => azioni.crea(FIGLIO[nodo.tipo], nodo),
      }) : null,
      azioni.rinomina ? el('button', {
        class: 'btn btn-piccolo sposta-icona', type: 'button', testo: '✎',
        title: `Rinomina ${nodo.nome}`, 'aria-label': `Rinomina ${NOME[nodo.tipo]} ${nodo.nome}`,
        onclick: () => azioni.rinomina(nodo),
      }) : null,
      azioni.elimina ? el('button', {
        class: `btn btn-piccolo sposta-icona${perche.eliminabile ? ' btn-pericolo' : ' btn-spento'}`,
        type: 'button', testo: '🗑', title: perche.motivo || `Elimina ${nodo.nome}`,
        'aria-label': `Elimina ${NOME[nodo.tipo]} ${nodo.nome}`,
        'aria-disabled': perche.eliminabile ? null : 'true',
        onclick: () => (perche.eliminabile ? azioni.elimina(nodo) : avvisa(perche.motivo || 'Non si può eliminare.')),
      }) : null,
    ].filter(Boolean));
    const conteggio = nodo.presidi ? `${nodo.presidi} presid${nodo.presidi === 1 ? 'io' : 'i'}` : 'vuoto';
    const testa = el('div', {
      class: `sposta-riga sposta-${nodo.tipo}${arrivati.has(k) ? ' sposta-arrivato' : ''}`,
      style: `--livello:${livello}`,
    }, [
      freccia,
      spunta,
      maniglia,
      el('span', { class: 'sposta-ico', testo: ICONA[nodo.tipo] }),
      el('button', {
        class: 'sposta-nome', type: 'button',
        // Toccare il nome sceglie (o apre, per l'impianto): è il bersaglio più
        // grande della riga, e su un telefono la casella da sola è piccola.
        onclick: () => (mobile ? scegli(k, !selezione.has(k)) : apri(!aperto)),
      }, [
        el('span', { class: 'sposta-testo', testo: nodo.nome }),
        el('span', { class: 'mini', testo: ` · ${conteggio}` }),
      ]),
      comandi,
    ].filter(Boolean));
    testa.__sposta = k;
    righe.set(k, { tipo: nodo.tipo, id: nodo.id, nome: nodo.nome, riga: testa, qui, spunta, comandi,
      apri, chiuso: () => haFigli && !aperto });
    if (maniglia) agganciaTrascina(maniglia, k);
    return el('div', { class: 'sposta-ramo' }, [testa, contenitore]);
  }

  function rigaPresidio(p, livello) {
    const k = chiave('presidio', p.id);
    const spunta = el('input', { type: 'checkbox', class: 'sposta-spunta',
      'aria-label': `Scegli il presidio ${p.nome}`, onchange: () => scegli(k, spunta.checked) });
    const maniglia = el('span', { class: 'sposta-maniglia', testo: '⠿', 'aria-hidden': 'true' });
    // La posizione anche sui PRESIDI (26/09/2026, dall'operatore: «non hai aggiunto
    // il comando mappa o aggiunta posizione anche sui presidi»): 🗺 se ce l'ha, 📍
    // se no, con il gesto dei Presidi (`azioni.posizionePresidio`). Come i comandi
    // dei luoghi, si nasconde mentre si sceglie.
    const pos = azioni.posizionePresidio ? azioni.posizionePresidio(p) : null;
    const comandi = pos ? el('span', { class: 'sposta-comandi-luogo' }, [el('button', {
      class: `btn btn-piccolo sposta-icona${pos.conPos ? '' : ' sposta-icona-manca'}`, type: 'button',
      testo: pos.segno, title: pos.etichetta, 'aria-label': pos.etichetta, onclick: () => pos.fai(),
    })]) : null;
    const testa = el('div', {
      class: `sposta-riga sposta-presidio${arrivati.has(k) ? ' sposta-arrivato' : ''}`,
      style: `--livello:${livello}`,
    }, [
      el('span', { class: 'sposta-freccia sposta-foglia', testo: '·' }),
      spunta,
      maniglia,
      el('span', { class: 'sposta-ico', testo: p.icona || ICONA.presidio }),
      el('button', { class: 'sposta-nome', type: 'button', onclick: () => scegli(k, !selezione.has(k)) }, [
        el('span', { class: 'sposta-testo', testo: p.nome }),
        p.dettaglio ? el('span', { class: 'mini', testo: ` · ${p.dettaglio}` }) : null,
      ].filter(Boolean)),
      comandi,
    ].filter(Boolean));
    testa.__sposta = k;
    righe.set(k, { tipo: 'presidio', id: p.id, nome: p.nome, riga: testa, qui: null, spunta, comandi,
      apri: () => {}, chiuso: () => false });
    agganciaTrascina(maniglia, k);
    return testa;
  }

  // ---------------------------------------------------------------- selezione
  function scegli(k, si) {
    const r = righe.get(k);
    if (!r || r.tipo === 'impianto') return;
    if (si) selezione.set(k, { tipo: r.tipo, id: r.id, nome: r.nome });
    else selezione.delete(k);
    // ⛔ Durante un trascinamento i pulsanti NON si toccano. Misurato nel
    // browser: prendere una riga non scelta la fa diventare la scelta, i
    // «Sposta qui» compaiono, le righe cambiano altezza — e la lista SALTA
    // sotto il dito proprio mentre la si afferra. I pulsanti servono all'altra
    // strada; si rimettono in ordine quando il dito si alza.
    if (presa && presa.attivo) aggiornaScelta(); else aggiorna();
  }

  // Tutto ciò che dipende dalla selezione si aggiorna SUL POSTO, senza ridisegnare:
  // ridisegnare perderebbe lo scorrimento e le animazioni proprio mentre si sceglie.
  function aggiornaScelta() {
    for (const [k, r] of righe) {
      const scelto = selezione.has(k);
      r.riga.classList.toggle('sposta-scelto', scelto);
      if (r.spunta) r.spunta.checked = scelto;
    }
  }

  function aggiorna() {
    const el_ = elenco();
    aggiornaScelta();
    for (const [k, r] of righe) {
      const scelto = selezione.has(k);
      if (!r.qui) continue;
      if (!el_.length || scelto) { r.qui.hidden = true; continue; }
      const p = azioni.piano ? azioni.piano(el_, { tipo: r.tipo, id: r.id }) : { ok: false, motivo: '' };
      // ⚠️ Solo dove si PUÒ, e non spento con il motivo come «Elimina».
      // Quella regola (19/09/2026) è per UN comando che, assente, sembrerebbe
      // non esistere. Qui, misurato nel browser su un'ubicazione scelta: 587
      // pulsanti in vista, 486 spenti — i 101 che contano sparivano fra gli
      // altri. Il perché di un «no» resta a un gesto: trascinando, il fantasma
      // lo dice sotto il dito, e la barra della scelta lo spiega.
      r.qui.hidden = !p.ok;
      r.qui.classList.add('btn-primario');
      r.qui.title = p.ok ? `Sposta qui ${selezioneAParole(el_)}` : '';
      r.qui.__piano = p;
    }
    barraScelta.hidden = !el_.length;
    // Accordo: area e ubicazione sono femminili, presidio maschile; misto va al
    // maschile. «1 ubicazione scelto» si è visto nel browser.
    const femminile = el_.every((e) => e.tipo !== 'presidio');
    const scelti = el_.length === 1 ? (femminile ? 'scelta' : 'scelto') : (femminile ? 'scelte' : 'scelti');
    const dove = [...righe.values()].filter((r) => r.qui && !r.qui.hidden).length;
    // ⚠️ Zero posti non è un guasto, e va detto: una scelta che mescola presidi
    // e luoghi non ha nessuna destinazione comune (un presidio va in
    // un'ubicazione, un'ubicazione in un'area). Nel browser si leggeva «0 posti»
    // e basta.
    const misto = el_.some((e) => e.tipo === 'presidio') && el_.some((e) => e.tipo !== 'presidio');
    testoScelta.textContent = !el_.length ? ''
      : dove ? `${selezioneAParole(el_)} ${scelti}. «Sposta qui» compare dove si può spostare `
        + `(${dove} ${dove === 1 ? 'posto' : 'posti'}); trascinando con ⠿ su un altro luogo ti dice perché no.`
        : `${selezioneAParole(el_)} ${scelti}, ma nessun posto li accetta tutti insieme`
          + (misto ? ': un presidio va in un’ubicazione, un’ubicazione in un’area. Spostali separatamente.'
            : '. Trascinando con ⠿ su un luogo ti dice perché.');
  }

  // ---------------------------------------------------------------- sposta
  function spostaQui(kDest) {
    const r = righe.get(kDest);
    const el_ = elenco();
    if (!r || !el_.length) return;
    const dest = { tipo: r.tipo, id: r.id };
    const p = azioni.piano ? azioni.piano(el_, dest) : null;
    if (!p || !p.ok) {
      scuoti(r.riga);
      avvisa((p && p.motivo) || 'Qui non si può spostare.');
      return;
    }
    const righeFrase = fraseDiConferma(el_, p);
    const esegui = async () => {
      // Chi è appena arrivato si illumina nel posto nuovo, e la destinazione si
      // apre: senza, lo spostamento riuscito sembra una sparizione.
      //
      // ⚠️ PRIMA di spostare, non dopo: chi chiama ridisegna l'albero DENTRO
      // `azioni.sposta` (è `muta` a farlo), e segnarlo dopo arriverebbe a
      // ridisegno già fatto. Se lo spostamento non riesce, si rimette tutto.
      const scelta = new Map(selezione);
      const eraAperta = aperti.has(kDest);
      memoria.arrivati = new Set(el_.map((e) => chiave(e.tipo, e.id)));
      aperti.add(kDest);
      selezione.clear();
      const fatto = azioni.sposta ? await azioni.sposta(el_, dest, p) : false;
      if (fatto === false || fatto === null || fatto === undefined) {
        memoria.arrivati = new Set();
        if (!eraAperta) aperti.delete(kDest);
        for (const [k, v] of scelta) selezione.set(k, v);
        aggiorna();
      }
    };
    if (azioni.conferma) {
      azioni.conferma({ titolo: 'Spostare qui?', righe: righeFrase, si: '⤵ Sposta qui', onSi: esegui });
    } else {
      esegui();
    }
  }

  function scuoti(nodo) {
    nodo.classList.remove('sposta-scuoti');
    // Forzare il ricalcolo fa ripartire l'animazione anche al secondo rifiuto.
    // eslint-disable-next-line no-unused-expressions
    nodo.offsetWidth;
    nodo.classList.add('sposta-scuoti');
  }

  // ---------------------------------------------------------------- trascina
  // Lo stato del trascinamento in corso: uno solo alla volta.
  let presa = null;

  function rigaSotto(x, y) {
    let n = trovaSotto(x, y);
    while (n && n.__sposta === undefined) n = n.parentNode;
    return n ? n.__sposta : null;
  }

  function agganciaTrascina(maniglia, k) {
    maniglia.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.preventDefault) e.preventDefault();
      presa = { k, x0: e.clientX, y0: e.clientY, attivo: false, sopra: null, id: e.pointerId };
      if (typeof maniglia.setPointerCapture === 'function' && e.pointerId !== undefined) {
        try { maniglia.setPointerCapture(e.pointerId); } catch { /* il browser può rifiutare */ }
      }
    });
    maniglia.addEventListener('pointermove', (e) => muovi(e));
    maniglia.addEventListener('pointerup', (e) => lascia(e));
    maniglia.addEventListener('pointercancel', () => annullaPresa());
  }

  function avviaTrascina() {
    // Si trascina la SELEZIONE se la riga presa ne fa parte; altrimenti solo lei,
    // e la selezione diventa lei: quello che è evidenziato è quello che si muove.
    presa.attivo = true;
    if (!selezione.has(presa.k)) { selezione.clear(); scegli(presa.k, true); }
    presa.elementi = elenco();
    for (const e of presa.elementi) {
      const r = righe.get(chiave(e.tipo, e.id));
      if (r) r.riga.classList.add('sposta-sollevato');
    }
    fantasma.hidden = false;
    fantasmaTesto.textContent = `⠿ ${selezioneAParole(presa.elementi)}`;
    fantasmaEsito.textContent = 'portali su un luogo';
    radice.classList.add('sposta-in-corso');
    scorriSeServe();
  }

  function muovi(e) {
    if (!presa) return;
    presa.x = e.clientX; presa.y = e.clientY;
    if (!presa.attivo) {
      if (Math.hypot(e.clientX - presa.x0, e.clientY - presa.y0) < SOGLIA_TRASCINA_PX) return;
      avviaTrascina();
    }
    if (fantasma.style) fantasma.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 10}px)`;
    valutaSotto();
  }

  // Che cosa c'è sotto il dito, adesso. Separata da `muovi` perché si chiama
  // anche dopo uno scorrimento automatico: la lista si muove sotto un dito
  // fermo, e senza movimento non arriva nessun `pointermove`.
  function valutaSotto() {
    const k = rigaSotto(presa.x, presa.y);
    if (k === presa.sopra) return;
    // Il bersaglio di prima si spegne.
    if (presa.sopra && righe.get(presa.sopra)) {
      togli(righe.get(presa.sopra).riga, 'sposta-bersaglio-si', 'sposta-bersaglio-no');
    }
    clearTimeout(timerApri);
    presa.sopra = k;
    presa.piano = null;
    const r = k && righe.get(k);
    if (!r || r.tipo === 'presidio') {
      fantasmaEsito.textContent = r ? 'un presidio non contiene niente' : 'portali su un luogo';
      togli(fantasma, 'sposta-fantasma-si', 'sposta-fantasma-no');
      return;
    }
    presa.piano = azioni.piano ? azioni.piano(presa.elementi, { tipo: r.tipo, id: r.id }) : null;
    const ok = presa.piano && presa.piano.ok;
    r.riga.classList.add(ok ? 'sposta-bersaglio-si' : 'sposta-bersaglio-no');
    fantasma.classList.toggle('sposta-fantasma-si', Boolean(ok));
    fantasma.classList.toggle('sposta-fantasma-no', !ok);
    // Sotto il dito si legge SUBITO perché no: scoprirlo solo dopo aver lasciato
    // vorrebbe dire tentare a caso.
    // Nel fantasma la PRIMA frase del motivo: è grande quanto un dito e segue il
    // dito, e tre frasi coprirebbero proprio le righe su cui si sta scegliendo.
    // Il motivo intero arriva nel messaggio, se si lascia qui.
    const breve = (m) => String(m || 'qui no').split(/(?<=[.])\s/)[0];
    fantasmaEsito.textContent = ok ? `⤵ in «${r.nome}»` : `✕ ${breve(presa.piano && presa.piano.motivo)}`;
    // Un luogo chiuso si apre da sé se ci si resta sopra: è come si entra in
    // una cartella trascinando, senza lasciare la presa.
    if (r.chiuso()) timerApri = setTimeout(() => { if (presa && presa.sopra === k) r.apri(true); }, APRI_SOPRA_MS);
  }

  function lascia(e) {
    if (!presa) return;
    const era = presa;
    if (!era.attivo) { presa = null; return; }
    if (e && e.clientX !== undefined) { era.x = e.clientX; era.y = e.clientY; }
    const k = era.sopra;
    finisciPresa();
    if (!k) return;
    const r = righe.get(k);
    if (!r || r.tipo === 'presidio') return;
    // Una porta sola: `spostaQui` rifà il piano e rifiuta con il motivo, per il
    // dito come per il pulsante. Un secondo controllo qui era ridondante —
    // misurato: toglierlo lasciava tutte le prove verdi.
    spostaQui(k);
  }

  function annullaPresa() { if (presa) finisciPresa(); }

  function finisciPresa() {
    clearTimeout(timerApri);
    if (presa && presa.rafScorri) annullaRaf(presa.rafScorri);
    for (const r of righe.values()) {
      togli(r.riga, 'sposta-sollevato', 'sposta-bersaglio-si', 'sposta-bersaglio-no');
    }
    fantasma.hidden = true;
    togli(fantasma, 'sposta-fantasma-si', 'sposta-fantasma-no');
    radice.classList.remove('sposta-in-corso');
    const eraAttiva = presa && presa.attivo;
    presa = null;
    if (eraAttiva) aggiorna();
  }

  // Vicino al bordo la lista scorre da sola: un albero lungo non sta in uno
  // schermo, e la destinazione è spesso più giù di dove si è preso.
  //
  // ⚠️ In quest'app il DOCUMENTO non scorre (19/09/2026, per il difetto di
  // Safari sulla barra in fondo): scorre `.vista`. Un `window.scrollBy` qui non
  // muoverebbe niente, quindi si cerca il primo antenato che scorre davvero, e
  // i bordi sono i SUOI, non quelli della finestra.
  function contenitoreCheScorre() {
    let n = radice.parentNode;
    while (n && n.nodeType === 1) {
      const st = typeof getComputedStyle === 'function' ? getComputedStyle(n) : null;
      if (st && /(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight) return n;
      n = n.parentNode;
    }
    return null;
  }
  function scorriSeServe() {
    if (!presa || !presa.attivo) return;
    if (presa.scorre === undefined) presa.scorre = contenitoreCheScorre();
    const c = presa.scorre;
    if (c && presa.y !== undefined && typeof c.getBoundingClientRect === 'function') {
      const r = c.getBoundingClientRect();
      const bordo = 70;
      const prima = c.scrollTop;
      if (presa.y < r.top + bordo) c.scrollTop -= Math.ceil((r.top + bordo - presa.y) / 4);
      else if (presa.y > r.bottom - bordo) c.scrollTop += Math.ceil((presa.y - (r.bottom - bordo)) / 4);
      if (c.scrollTop !== prima) valutaSotto();
    }
    presa.rafScorri = raf(scorriSeServe);
  }

  // ---------------------------------------------------------------- telaio
  const fantasmaTesto = el('div', { class: 'sposta-fantasma-testo' });
  const fantasmaEsito = el('div', { class: 'sposta-fantasma-esito mini' });
  const fantasma = el('div', { class: 'sposta-fantasma', hidden: true, 'aria-hidden': 'true' },
    [fantasmaTesto, fantasmaEsito]);

  const testoScelta = el('div', { class: 'sposta-scelta-testo' });
  const barraScelta = el('div', { class: 'sposta-scelta', hidden: true }, [
    testoScelta,
    el('button', { class: 'btn btn-piccolo', type: 'button', testo: 'Annulla la scelta',
      onclick: () => { selezione.clear(); aggiorna(); } }),
  ]);

  const casellaPresidi = el('input', { type: 'checkbox', class: 'sposta-mostra-presidi',
    onchange: () => { memoria.conPresidi = casellaPresidi.checked; if (azioni.ridisegna) azioni.ridisegna(); } });
  casellaPresidi.checked = Boolean(memoria.conPresidi);

  const testata = el('div', { class: 'sposta-testata' }, [
    el('div', { class: 'sposta-titolo', testo: '✋ Modalità sposta' }),
    el('div', { class: 'mini', testo: 'Spunta aree, ubicazioni o presidi, poi tocca «⤵ Sposta qui» '
      + 'sulla destinazione — oppure tieni premuta la maniglia ⠿ e trascinali. Prima di spostare '
      + 'ti chiede conferma, e dopo si può annullare.' }),
    el('div', { class: 'sposta-comandi' }, [
      el('label', { class: 'sposta-casella' }, [casellaPresidi, ' 🧯 mostra i presidi']),
      el('button', { class: 'btn btn-piccolo btn-primario', type: 'button', testo: '✓ Fine',
        onclick: () => { finisciPresa(); if (azioni.onFine) azioni.onFine(); } }),
    ]),
  ]);

  const albero = el('div', { class: 'sposta-albero' }, radici.map((r) => rigaNodo(r, 0)));
  const radice = el('div', { class: 'sposta' }, [testata, albero, barraScelta, fantasma]);
  aggiorna();

  return {
    nodo: radice,
    /** Per le prove e per chi chiama: la riga di un elemento, o undefined. */
    riga: (tipo, id) => (righe.get(chiave(tipo, id)) || {}).riga,
    chiudi: () => { finisciPresa(); clearTimeout(timerApri); },
  };
}
