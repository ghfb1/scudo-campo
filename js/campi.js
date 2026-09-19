/**
 * Scudo Campo — resa dei campi di un presidio a partire dai metadati.
 *
 * Sia la scheda sia il form di modifica si costruiscono da qui. È il motivo per
 * cui "ogni dato è modificabile" non è una promessa da mantenere a mano: un
 * campo aggiunto ai metadati in Scudo arriva nel pacchetto e compare qui, senza
 * che nessuno debba ricordarsi di aggiungerlo anche all'app di campo.
 */
import { el, campo as campoUi, campoNumerico, select, testo as testoOpp } from './ui.js';
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
export function vistaCampi(asset, { soloCampo = false } = {}) {
  const gruppi = S.gruppiPerCategoria(asset.categoria_codice, soloCampo);
  const mancanze = new Map(S.mancanzeDeterminanti(asset).map((m) => [m.campo, m.messaggio]));
  const frag = document.createDocumentFragment();

  for (const g of gruppi) {
    const righe = [];
    for (const c of g.campi) {
      const grezzo = asset[c.nome];
      const leggibile = valoreLeggibile(c, grezzo, asset);
      if (leggibile === null && !mancanze.has(c.nome)) continue;
      righe.push(el('dt', { testo: c.etichetta }));
      if (leggibile === null) {
        righe.push(el('dd', {}, [
          el('span', { class: 'mancante', testo: 'non compilato' }),
          el('div', { class: 'mini', testo: mancanze.get(c.nome) }),
        ]));
      } else {
        righe.push(el('dd', {
          class: c.nome === 'codice' ? 'mono' : '',
          testo: leggibile,
        }));
      }
    }
    if (!righe.length) continue;
    frag.append(el('h3', { testo: g.etichetta }));
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
export function formCampi(asset, { soloCampo = false, adminSbloccato = () => true,
                                   sbloccaAdmin = null, escludiGruppi = [] } = {}) {
  // `escludiGruppi`: i gruppi che la schermata chiamante disegna da sé (la
  // creazione di un presidio chiede impianto, ubicazione e identificazione con i
  // suoi controlli, e da qui vuole solo i campi SPECIFICI della tipologia).
  const gruppi = S.gruppiPerCategoria(asset.categoria_codice, soloCampo)
    .filter((g) => !escludiGruppi.includes(g.codice));
  const controlli = new Map();
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
        return el('input', { type: 'date', value: String(valore).slice(0, 10) });
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
