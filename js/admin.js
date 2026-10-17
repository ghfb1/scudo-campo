/**
 * Scudo Campo — la password admin davanti alle scelte sui piani.
 *
 * Richiesta dell'operatore del 15/09/2026: scegliere i piani di un presidio, farlo
 * uscire da un piano («fa eccezione») e gestire i piani di verifica (applicarli ai
 * presidi, crearli, correggerli) chiedono la password admin. Sono le azioni che
 * spostano le scadenze di altri presidi o tolgono un controllo dal verbale: non le
 * deve fare chi sta solo eseguendo il giro.
 *
 * Come per la parola d'accesso (`accesso.js`), e va detto qui dove chi modifica
 * il file lo legge per primo: **NON È UNA PROTEZIONE**. Il codice è pubblico e il
 * confronto avviene nel telefono; chi apre gli strumenti per sviluppatori passa.
 * Tiene fuori il gesto distratto, non chi ci prova. Per lo stesso motivo la
 * password non compare in chiaro: nel sorgente c'è solo l'impronta SHA-256, con la
 * stessa normalizzazione della parola d'accesso (spazi tolti, minuscole).
 *
 * Lo sblocco dura quanto la scheda del browser (`sessionStorage`): riaprendo l'app
 * si richiede. Si conserva l'IMPRONTA, non la parola, e si confronta con quella
 * attesa: cambiata la password, gli sblocchi vecchi non valgono più.
 */
import { impronta } from './accesso.js';
import { campo, el } from './ui.js';

// SHA-256 della password admin (normalizzata come in `impronta`).
export const IMPRONTA_ADMIN = '01ecb2602e17fc52a0e867ff5f917751442e237992bd514e8abfb5b5e3d75348';

const CHIAVE = 'scudo-campo:admin';

// Anche senza sessionStorage (navigazione privata, anteprime) lo sblocco vale finché
// la pagina resta aperta.
let sbloccatoInMemoria = null;

function leggi() {
  try { return sessionStorage.getItem(CHIAVE); } catch { return null; }
}

export function sbloccato(attesa = IMPRONTA_ADMIN) {
  return (sbloccatoInMemoria || leggi()) === attesa;
}

/** Controlla la password; se è giusta sblocca. Risolve true/false, non lancia. */
export async function sblocca(parola, attesa = IMPRONTA_ADMIN) {
  if (!String(parola || '').trim()) return false;
  let h;
  try { h = await impronta(parola); } catch { return false; }
  if (h !== attesa) return false;
  sbloccatoInMemoria = h;
  try { sessionStorage.setItem(CHIAVE, h); } catch { /* resta in memoria */ }
  return true;
}

export function blocca() {
  sbloccatoInMemoria = null;
  try { sessionStorage.removeItem(CHIAVE); } catch { /* niente da togliere */ }
}

/**
 * Il contenuto del foglio che chiede la password.
 *
 * Le due uscite sono funzioni passate da fuori (come in `controllo.js`): è quello
 * che rende il foglio costruibile e cliccabile in una prova. `onSbloccato` arriva
 * solo con la password giusta; con quella sbagliata il foglio resta aperto e lo
 * dice, e il campo si svuota.
 */
export function corpoSblocco({ perche, onSbloccato, onAnnulla, attesa = IMPRONTA_ADMIN }) {
  const campoParola = el('input', {
    type: 'password', autocomplete: 'off', 'aria-label': 'Password admin',
    placeholder: 'Password admin',
  });
  const errore = el('div', { class: 'mini', role: 'alert', hidden: true,
    style: 'color:var(--rosso);font-weight:600;margin-top:6px', testo: '✕ Password sbagliata.' });
  let inCorso = false;
  const prova = async () => {
    if (inCorso) return;
    inCorso = true;
    const ok = await sblocca(campoParola.value, attesa);
    inCorso = false;
    if (ok) { onSbloccato(); return; }
    errore.hidden = false;
    campoParola.value = '';
    if (campoParola.focus) campoParola.focus();
  };
  campoParola.addEventListener('keydown', (e) => { if (e.key === 'Enter') prova(); });
  return el('div', {}, [
    el('p', { testo: `🔒 ${perche || 'Questa operazione'} richiede la password admin.` }),
    campo('Password admin', campoParola),
    errore,
    el('div', { class: 'riga riga-fine', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: () => onAnnulla() }),
      el('button', { class: 'btn btn-primario', type: 'button', testo: 'Sblocca', onclick: prova }),
    ]),
  ]);
}

/**
 * Chiede la password se serve. Risolve true se si può procedere.
 *
 * `apri(titolo, corpo, allaChiusura)` e `chiudi()` sono `apriSheetConChiusura` e
 * `chiudiSheet` di `ui.js`: toccare fuori, la ✕ o Esc valgono «Annulla» — un foglio
 * che chiede una decisione si risolve anche alla chiusura (regola di `CLAUDE.md`).
 */
export function chiediAdmin({ perche, apri, chiudi, attesa = IMPRONTA_ADMIN }) {
  if (sbloccato(attesa)) return Promise.resolve(true);
  return new Promise((risolvi) => {
    let deciso = false;
    const fine = (v) => { if (deciso) return; deciso = true; risolvi(v); };
    const corpo = corpoSblocco({
      perche, attesa,
      onSbloccato: () => { fine(true); chiudi(); },
      onAnnulla: () => { fine(false); chiudi(); },
    });
    apri('Password admin', corpo, () => fine(false));
  });
}
