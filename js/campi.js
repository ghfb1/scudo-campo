/**
 * Scudo Campo — resa dei campi di un presidio a partire dai metadati.
 *
 * Sia la scheda sia il form di modifica si costruiscono da qui. È il motivo per
 * cui "ogni dato è modificabile" non è una promessa da mantenere a mano: un
 * campo aggiunto ai metadati in Scudo arriva nel pacchetto e compare qui, senza
 * che nessuno debba ricordarsi di aggiungerlo anche all'app di campo.
 */
import { el, campo as campoUi, select, testo as testoOpp } from './ui.js';
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
export function formCampi(asset, { soloCampo = false } = {}) {
  const gruppi = S.gruppiPerCategoria(asset.categoria_codice, soloCampo);
  const controlli = new Map();
  const nodo = el('div', {});
  const valoriCorrenti = () => {
    const out = { ...asset };
    for (const [nome, ctrl] of controlli) out[nome] = leggiControllo(ctrl);
    return out;
  };

  function leggiControllo(ctrl) {
    if (ctrl.type === 'checkbox') return ctrl.checked ? '1' : '0';
    return ctrl.value;
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
      case 'decimale': {
        const attrs = { type: 'number', inputmode: c.tipo === 'intero' ? 'numeric' : 'decimal', value: String(valore) };
        if (c.tipo === 'decimale') attrs.step = '0.01';
        if (c.min !== null && c.min !== undefined) attrs.min = String(c.min);
        if (c.max !== null && c.max !== undefined) attrs.max = String(c.max);
        return el('input', attrs);
      }
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
      default:
        return el('input', { type: 'text', value: String(valore) });
    }
  }

  for (const g of gruppi) {
    const campiModificabili = g.campi.filter((c) => c.modificabile);
    if (!campiModificabili.length) continue;
    nodo.append(el('h3', { testo: g.etichetta }));
    for (const c of g.campi) {
      if (!c.modificabile) continue;
      const ctrl = creaControllo(c);
      controlli.set(c.nome, ctrl);
      nodo.append(campoUi(c.etichetta, ctrl, c.aiuto));
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
