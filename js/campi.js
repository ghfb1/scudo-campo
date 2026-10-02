/**
 * Scudo Campo — resa dei campi di un presidio a partire dai metadati.
 *
 * Sia la scheda sia il form di modifica si costruiscono da qui. È il motivo per
 * cui "ogni dato è modificabile" non è una promessa da mantenere a mano: un
 * campo aggiunto ai metadati in Scudo arriva nel pacchetto e compare qui, senza
 * che nessuno debba ricordarsi di aggiungerlo anche all'app di campo.
 */
import { el, campo as campoUi, campoData, campoNumerico, select, testo as testoOpp } from './ui.js';
import * as S from './stato.js';

/** Valore già formattato per la lettura. */
export function valoreLeggibile(campo, valore, cataloghi = {}) {
  if (valore === null || valore === undefined || valore === '') return null;
  switch (campo.tipo) {
    case 'booleano':
      return ['1', 'true', 'si', 'sì'].includes(String(valore).toLowerCase()) ? 'Sì' : 'No';
    case 'data': {
      const m = String(valore).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valore);
    }
    case 'scelta': {
      const opz = S.opzioniCampo(campo, cataloghi);
      const trovata = opz.find((o) => String(o.valore) === String(valore));
      return trovata ? trovata.testo : String(valore);
    }
    default:
      return String(valore);
  }
}

/**
 * Scheda in sola lettura, raggruppata.
 *
 * `mancanze` sono i campi vuoti che vanno mostrati lo stesso perché la loro
 * assenza ha una conseguenza: senza la data di messa in servizio il presidio
 * resta fuori dallo scadenzario, e se la scheda saltasse i campi vuoti
 * l'operatore non avrebbe modo di saperlo.
 */
export const MARCATORE = /_(derivata|dichiarata)$/;

/**
 * La nota che un marcatore mette sul campo di cui parla, o `null`.
 *
 * ⛔ `data_messa_servizio_derivata` NON è una riga: è un segno su
 * `data_messa_servizio`. Mostrarlo da solo dà «Messa in servizio derivata: 1»,
 * che non dice niente — e dal 21/09/2026, con il riepilogo in cima, quelle due
 * righe sarebbero le prime che l'operatore legge su **413 presidi su 875**.
 *
 * La convenzione è dichiarata nei metadati (`backend/app/services/scudo_campi.py`:
 * «il nome segue la convenzione `<campo>_derivata`: la scheda non lo mostra come
 * riga propria, lo appende al campo di cui parla») e l'ufficio la applica già
 * (`frontend/src/components/scudo/scudoCampi.js`). Qui non la applicava nessuno.
 *
 * Il TESTO viene dall'`aiuto` del marcatore, cioè dai metadati: scriverlo qui
 * sarebbe una terza copia di una frase che già esiste, e le tre copie
 * divergerebbero senza che niente lo dica. Si toglie solo il «1 = » iniziale,
 * che parla del valore della colonna e non a chi legge la scheda.
 */
export function notaMarcatore(campo, asset, campiCategoria) {
  for (const suff of ['_derivata', '_dichiarata']) {
    const nome = `${campo.nome}${suff}`;
    if (String(asset[nome] ?? '') !== '1') continue;
    const m = campiCategoria.find((c) => c.nome === nome);
    const testo = ((m && m.aiuto) || '').replace(/^1\s*=\s*/, '');
    return `◌ ${testo || 'valore ricavato, non letto da una fonte'}`;
  }
  return null;
}

/**
 * I campi di un presidio, a gruppi.
 *
 * ⛔ `solo` / `escludi` / `vuotiCome` esistono dal 21/09/2026, quando la scheda
 * è stata rovesciata su richiesta dell'operatore: i dati che servono a
 * RICONOSCERE il pezzo vanno in cima, il tracciamento resta in fondo.
 *
 * Una funzione sola e non due viste: i gruppi, le etichette e il modo di
 * leggere un valore restano in un posto, e chi guarda in cima e chi guarda in
 * fondo vede lo stesso dato scritto allo stesso modo.
 *
 * ⚠️ `vuotiCome` serve al riepilogo in cima: lì un campo vuoto va SCRITTO con un
 * trattino invece di sparire. Se sparisce, l'operatore che cerca la matricola e
 * non la trova non sa se manca il dato o se quella riga non esiste per questa
 * tipologia — e sono due cose diverse. Altrove il comportamento resta quello di
 * prima: saltare, perché un elenco lungo di trattini è rumore.
 */
export function vistaCampi(asset, {
  soloCampo = false, solo = null, escludi = [], vuotiCome = null, senzaTitoli = false,
} = {}) {
  const gruppi = S.gruppiPerCategoria(asset.categoria_codice, soloCampo)
    .filter((g) => (solo ? solo.includes(g.codice) : !escludi.includes(g.codice)));
  const mancanze = new Map(S.mancanzeDeterminanti(asset).map((m) => [m.campo, m.messaggio]));
  const tuttiICampi = S.campiPerCategoria(asset.categoria_codice);
  const frag = document.createDocumentFragment();

  for (const g of gruppi) {
    const righe = [];
    for (const c of g.campi) {
      // ⛔ `codice` fuori dal riepilogo: è la chiave interna di Scudo
      // («ACCIAIOLO-EDIFICIO-NUOVAPAL-REI-01») e in cima si leggeva al posto
      // del progressivo e della matricola, che sono i due numeri scritti SUL
      // PEZZO. Chi confronta la scheda con l'etichetta cerca quelli.
      if (vuotiCome !== null && c.nome === 'codice') continue;
      // I marcatori non sono righe: vedi `notaMarcatore` qui sopra.
      if (MARCATORE.test(c.nome)) continue;
      const grezzo = asset[c.nome];
      const leggibile = valoreLeggibile(c, grezzo, asset);
      // ⚠️ Il trattino vale solo per i campi che si CONFRONTANO con l'etichetta,
      // cioè quelli che una persona può compilare. I marcatori — «messa in
      // servizio derivata», «dichiarata» — dicono qualcosa su un ALTRO campo, e
      // `modificabile: false` è esattamente ciò che li distingue: quando sono
      // vuoti non c'è nessun dato mancante da segnalare, c'è solo una nota che
      // non si applica. Quattro trattini in cima al riepilogo di ogni presidio
      // sarebbero quattro domande che non hanno risposta.
      const confrontabile = c.modificabile !== false;
      if (leggibile === null && vuotiCome !== null && confrontabile && !mancanze.has(c.nome)) {
        righe.push(el('dt', { testo: c.etichetta }));
        righe.push(el('dd', { class: 'mancante', testo: vuotiCome }));
        continue;
      }
      if (leggibile === null && !mancanze.has(c.nome)) continue;
      righe.push(el('dt', { testo: c.etichetta }));
      if (leggibile === null) {
        righe.push(el('dd', {}, [
          el('span', { class: 'mancante', testo: 'non compilato' }),
          el('div', { class: 'mini', testo: mancanze.get(c.nome) }),
        ]));
      } else {
        const nota = notaMarcatore(c, asset, tuttiICampi);
        righe.push(el('dd', { class: c.nome === 'codice' ? 'mono' : '' }, [
          el('span', { testo: leggibile }),
          nota ? el('div', { class: 'mini', testo: nota }) : null,
        ]));
      }
    }
    if (!righe.length) continue;
    if (!senzaTitoli) frag.append(el('h3', { testo: g.etichetta }));
    frag.append(el('dl', { class: 'dati' }, righe));
  }
  return frag;
}

/**
 * Form di modifica. Ritorna { nodo, leggi(), errori() }.
 *
 * Le tendine annidate (edificio dipende da impianto, locale da edificio) si
 * ricalcolano quando cambia il campo da cui dipendono: senza, l'operatore che
 * cambia impianto si ritrova a scegliere fra i locali di un altro impianto.
 */
/**
 * `opzioni`:
 *   soloCampo      — solo i campi che si compilano in campo
 *   adminSbloccato() / sbloccaAdmin() — i campi con `admin: true` (oggi il
 *     progressivo Terna) si modificano solo dopo la password admin. Le due
 *     funzioni arrivano da fuori (`admin.js` via `app.js`): qui non si sa
 *     che cosa sia una password, e il form resta costruibile in una prova.
 */
/*   obbligatori(valori) — facoltativa: i campi obbligatori ADESSO, come
 *     `[{ nome, etichetta, perche }]` (vedi `S.obbligatoriAllaCreazione`). Si
 *     ricalcola a ogni modifica — scegliere «schiuma» rende obbligatorio il
 *     serbatoio — e mette l'asterisco sull'etichetta. */
export function formCampi(asset, { soloCampo = false, adminSbloccato = () => true,
                                   sbloccaAdmin = null, escludiGruppi = [], obbligatori = null } = {}) {
  // `escludiGruppi`: i gruppi che la schermata chiamante disegna da sé (la
  // creazione di un presidio chiede impianto, ubicazione e identificazione con i
  // suoi controlli, e da qui vuole solo i campi SPECIFICI della tipologia).
  const gruppi = S.gruppiPerCategoria(asset.categoria_codice, soloCampo)
    .filter((g) => !escludiGruppi.includes(g.codice));
  const controlli = new Map();
  // Il contenitore di ogni campo (etichetta + controllo): porta l'asterisco e
  // l'evidenza dell'errore, e chi chiama ci fa scorrere la vista.
  const contenitori = new Map();
  const nodo = el('div', {});
  const valoriCorrenti = () => {
    const out = { ...asset };
    for (const [nome, ctrl] of controlli) out[nome] = leggiControllo(ctrl);
    return out;
  };

  function leggiControllo(ctrl) {
    if (ctrl.type === 'checkbox') return ctrl.checked ? '1' : '0';
    // Campi in unità di tempo: a schermo anni o mesi, nel dato sempre mesi.
    if (ctrl.dataset && ctrl.dataset.unitaTempo === 'ANNI') {
      const n = Number(ctrl.value);
      return ctrl.value === '' || !Number.isFinite(n) ? '' : String(Math.round(n * 12));
    }
    return ctrl.value;
  }

  /**
   * L'interruttore anni / mesi (richiesta dell'operatore del 16/09/2026).
   *
   * «216» non si legge: diciotto anni sì. Il campo resta in MESI nel dato — il
   * database ragiona in mesi e non deve sapere niente di questo interruttore — e
   * la conversione avviene qui, in un posto solo (`leggiControllo`).
   */
  function interruttoreUnita(c, ctrl) {
    const mesi = Number(asset[c.nome]);
    const parteInAnni = Number.isFinite(mesi) && mesi >= 12 && mesi % 12 === 0;
    ctrl.dataset.unitaTempo = parteInAnni ? 'ANNI' : 'MESI';
    if (parteInAnni) ctrl.value = String(mesi / 12);
    const bottoni = [];
    const scegli = (unita) => {
      if (ctrl.dataset.unitaTempo === unita) return;
      const n = Number(ctrl.value);
      if (ctrl.value !== '' && Number.isFinite(n)) {
        ctrl.value = unita === 'ANNI' ? String(Math.round((n / 12) * 100) / 100) : String(Math.round(n * 12));
      }
      ctrl.dataset.unitaTempo = unita;
      for (const b of bottoni) {
        b.classList.toggle('attiva', b.dataset.unita === unita);
        b.setAttribute('aria-pressed', String(b.dataset.unita === unita));
      }
    };
    for (const [unita, etichetta] of [['ANNI', 'anni'], ['MESI', 'mesi']]) {
      const b = el('button', {
        class: `interruttore-voce${ctrl.dataset.unitaTempo === unita ? ' attiva' : ''}`,
        type: 'button', dataset: { unita }, testo: etichetta,
        'aria-pressed': String(ctrl.dataset.unitaTempo === unita),
        onclick: () => scegli(unita),
      });
      bottoni.push(b);
    }
    return el('div', { class: 'interruttore interruttore-unita', role: 'group',
      'aria-label': `Unità di ${c.etichetta}` }, bottoni);
  }

  function creaControllo(c) {
    const valore = asset[c.nome] ?? '';
    if (!c.modificabile) {
      const ctrl = el('input', { type: 'text', value: valoreLeggibile(c, valore, asset) || '', readonly: true });
      ctrl.style.background = 'var(--grigio-100)';
      return ctrl;
    }
    switch (c.tipo) {
      case 'testo_lungo':
        return el('textarea', { value: String(valore) });
      case 'intero':
      case 'decimale':
        // `campoNumerico` e non `input[type=number]`: le frecce e la ROTELLA
        // cambiano il valore mentre si scorre la pagina. Vedi `ui.js`.
        return campoNumerico({ decimale: c.tipo === 'decimale', valore, min: c.min, max: c.max });
      case 'data':
        // Tre menù e non il calendario (23/09/2026): vedi `campoData` in ui.js.
        return campoData({ valore: String(valore).slice(0, 10) });
      case 'booleano': {
        const ctrl = el('input', { type: 'checkbox' });
        ctrl.checked = ['1', 'true', 'si', 'sì'].includes(String(valore).toLowerCase());
        return ctrl;
      }
      case 'scelta': {
        const opz = S.opzioniCampo(c, asset);
        return select([{ valore: '', testo: '—' }, ...opz], valore);
      }
      default: {
        // Testo con SUGGERIMENTI quando il campo dichiara una fonte
        // (`opzioni_da`): la centralina di appartenenza di un rilevatore si
        // sceglie fra quelle dell'impianto, ma resta scrivibile a mano — una
        // centralina non ancora censita deve poter essere indicata, e un elenco
        // chiuso costringerebbe a lasciare il campo vuoto.
        const suggerimenti = c.opzioni_da ? S.opzioniCampo(c, asset) : [];
        if (!suggerimenti.length) return el('input', { type: 'text', value: String(valore) });
        const idLista = `sugg-${c.nome}`;
        const ctrl = el('input', { type: 'text', value: String(valore), list: idLista,
          autocomplete: 'off', placeholder: `${suggerimenti.length} in questo impianto` });
        const lista = el('datalist', { id: idLista });
        for (const o of suggerimenti) {
          // `value` è il CODICE (quello che si salva), l'etichetta è quello che
          // si legge: il browser mostra entrambi e salva il primo.
          lista.append(el('option', { value: o.valore, label: o.testo }));
        }
        // Si restituisce l'INPUT, non un contenitore: tutto il resto del modulo
        // legge `ctrl.value`, e incartarlo in un div romperebbe la lettura di
        // ogni campo senza che niente lo dica. Il `datalist` viaggia attaccato
        // all'input e lo appende chi costruisce la riga.
        ctrl.listaSuggerimenti = lista;
        return ctrl;
      }
    }
  }

  for (const g of gruppi) {
    const campiModificabili = g.campi.filter((c) => c.modificabile);
    if (!campiModificabili.length) continue;
    nodo.append(el('h3', { testo: g.etichetta }));
    for (const c of g.campi) {
      if (!c.modificabile) continue;
      const protetto = Boolean(c.admin) && !adminSbloccato();
      const ctrl = protetto
        ? (() => {
          const x = el('input', { type: 'text', value: String(asset[c.nome] ?? ''), readonly: true });
          x.style.background = 'var(--grigio-100)';
          return x;
        })()
        : creaControllo(c);
      controlli.set(c.nome, ctrl);
      const gruppoCampo = campoUi(c.etichetta, ctrl, c.aiuto);
      contenitori.set(c.nome, gruppoCampo);
      // Il `datalist` deve stare NEL documento perché il browser lo colleghi
      // all'input: fuori, i suggerimenti non compaiono e non lo dice nessuno.
      if (ctrl.listaSuggerimenti) gruppoCampo.append(ctrl.listaSuggerimenti);
      if (c.unita_tempo && !protetto && (c.tipo === 'intero' || c.tipo === 'decimale')) {
        gruppoCampo.append(interruttoreUnita(c, ctrl));
      }
      if (protetto) {
        // Il campo si vede, non si cambia: cambiare il progressivo Terna scollega
        // il presidio dal registro del manutentore, e chi ha il pezzo davanti non
        // ha modo di accorgersene.
        gruppoCampo.append(el('button', {
          class: 'btn btn-piccolo', type: 'button', style: 'margin-top:6px',
          testo: `🔒 Sblocca «${c.etichetta}» con la password admin (il modulo si riapre)`,
          onclick: async () => {
            if (!sbloccaAdmin || !(await sbloccaAdmin())) return;
            const nuovo = creaControllo(c);
            controlli.set(c.nome, nuovo);
            ctrl.replaceWith(nuovo);
          },
        }));
      }
      nodo.append(gruppoCampo);
    }
  }

  // L'asterisco segue i dati: si ricalcola a ogni modifica.
  const obbligatoriOra = () => (obbligatori ? obbligatori(valoriCorrenti()) : []);
  function aggiornaObbligatori() {
    const qui = new Set(obbligatoriOra().map((o) => o.nome));
    for (const [nome, w] of contenitori) {
      if (w.classList) w.classList.toggle('campo-obbligatorio', qui.has(nome));
    }
  }
  if (obbligatori) {
    aggiornaObbligatori();
    nodo.addEventListener('change', aggiornaObbligatori);
    nodo.addEventListener('input', aggiornaObbligatori);
  }

  // Ricalcolo delle tendine dipendenti.
  for (const [nome, ctrl] of controlli) {
    const dipendenti = [...controlli.entries()].filter(([, x]) => x.dataset.dipendeDa === nome);
    if (ctrl.tagName === 'SELECT') {
      const figli = gruppi.flatMap((g) => g.campi).filter((c) => c.dipende_da === nome);
      if (figli.length) {
        ctrl.addEventListener('change', () => {
          for (const figlio of figli) {
            const sel = controlli.get(figlio.nome);
            if (!sel) continue;
            const opz = S.opzioniCampo(figlio, valoriCorrenti());
            const precedente = sel.value;
            while (sel.firstChild) sel.removeChild(sel.firstChild);
            sel.append(el('option', { value: '', testo: '—' }));
            for (const o of opz) sel.append(el('option', { value: o.valore, testo: o.testo }));
            sel.value = opz.some((o) => o.valore === precedente) ? precedente : '';
            sel.dispatchEvent(new Event('change'));
          }
        });
      }
    }
    void dipendenti;
  }

  return {
    nodo,
    /** Solo i campi effettivamente cambiati: mandare tutto significherebbe
     *  registrare come modifica anche quello che l'operatore non ha toccato. */
    leggi() {
      const out = {};
      for (const [nome, ctrl] of controlli) {
        const nuovo = leggiControllo(ctrl);
        const vecchio = asset[nome] ?? '';
        const norm = (v) => (v === null || v === undefined ? '' : String(v));
        if (norm(nuovo) !== norm(vecchio)) out[nome] = nuovo;
      }
      return out;
    },
    /** Il contenitore del campo `nome`: per scorrerci e segnarlo. */
    contenitore(nome) { return contenitori.get(nome) || null; },
    /** I campi obbligatori adesso, con i dati scritti fin qui. */
    obbligatori: obbligatoriOra,
    aggiornaObbligatori,
    errori() {
      const perNome = new Map(S.campiPerCategoria(asset.categoria_codice).map((c) => [c.nome, c]));
      const valori = valoriCorrenti();
      const out = [];
      for (const [nome] of controlli) {
        const c = perNome.get(nome);
        if (!c || !c.modificabile) continue;
        const msg = S.validaCampo(c, valori[nome]);
        if (msg) out.push(msg);
      }
      // Gli obbligatori DI QUESTO MOMENTO che stanno in questo modulo, con il
      // perché: «Estinguente: obbligatorio» non dice che cosa si perde a
      // lasciarlo vuoto, e chi è in cabina deve sapere se vale la pena cercarlo.
      for (const o of obbligatoriOra()) {
        if (!controlli.has(o.nome)) continue;
        const v = valori[o.nome];
        if (v === null || v === undefined || String(v).trim() === '') {
          out.push(`${o.etichetta}: obbligatorio — ${o.perche}.`);
        }
      }
      const q = Number(valori.quantita ?? 0);
      const ko = Number(valori.quantita_ko ?? 0);
      if (Number.isFinite(q) && Number.isFinite(ko) && ko > q) {
        out.push(`I pezzi guasti (${ko}) non possono superare la quantità totale (${q}).`);
      }
      return out;
    },
  };
}

export { testoOpp };
