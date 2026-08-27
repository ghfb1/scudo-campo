/**
 * Scudo Campo — porta d'ingresso: parola d'accesso e identità dell'operatore.
 *
 * ATTENZIONE, e va detto qui dove chi modifica il file lo legge per primo:
 * QUESTA NON È UNA PROTEZIONE. La pagina è pubblica e tutto il codice è
 * scaricabile; chiunque sappia aprire gli strumenti per sviluppatori entra
 * senza sapere la parola. Serve a tenere fuori chi capita sull'indirizzo per
 * caso, non chi ci prova. Per questo la pagina NON contiene dati: il pacchetto
 * lo porta l'operatore.
 *
 * Quello che invece è vero, ed è il motivo per cui questa schermata esiste
 * anche al di là della parola: da qui l'operatore si identifica una volta sola,
 * e da quel momento ogni controllo che registra porta il suo nome e la sua
 * matricola. Senza, il rilievo torna in ufficio senza sapere chi l'ha fatto.
 *
 * La parola non compare in chiaro nel sorgente. Non è sicurezza — l'impronta si
 * confronta lato client come tutto il resto — ma evita che si legga aprendo il
 * file, che è il modo in cui una parola d'accesso si perde davvero.
 */

const CHIAVE_ACCESSO = 'scudo-campo:accesso';

// SHA-256 della parola d'accesso.
const IMPRONTA_ATTESA = 'd87750ed0e8c83c10a52ca6fbcdcc6c22b06993105ee3a70221dd092da0d7d13';

async function impronta(testo) {
  const dati = new TextEncoder().encode(String(testo).trim().toLowerCase());
  const buf = await crypto.subtle.digest('SHA-256', dati);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Identità salvata, oppure null. Non lancia mai: senza, si torna alla porta. */
export function identita() {
  try {
    const raw = localStorage.getItem(CHIAVE_ACCESSO);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return (v && v.nome && v.cognome) ? v : null;
  } catch {
    return null;
  }
}

export function nomeCompleto(id = identita()) {
  if (!id) return '';
  return `${id.nome} ${id.cognome}`.trim();
}

export function dimentica() {
  try { localStorage.removeItem(CHIAVE_ACCESSO); } catch { /* niente da fare */ }
}

function campo(id, etichetta, opzioni = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'campo';
  const lab = document.createElement('span');
  lab.className = 'campo-etichetta';
  lab.textContent = etichetta;
  const inp = document.createElement('input');
  inp.id = id;
  inp.type = opzioni.type || 'text';
  inp.autocomplete = opzioni.autocomplete || 'off';
  if (opzioni.inputmode) inp.inputMode = opzioni.inputmode;
  if (opzioni.placeholder) inp.placeholder = opzioni.placeholder;
  wrap.append(lab, inp);
  return { wrap, inp };
}

/**
 * Mostra la porta e risolve quando l'operatore è entrato.
 * Se è già entrato in passato, risolve subito senza mostrare niente.
 */
export function apriPorta() {
  return new Promise((risolvi) => {
    const gia = identita();
    if (gia) { risolvi(gia); return; }

    const porta = document.createElement('div');
    porta.className = 'porta';
    porta.innerHTML = '';

    const box = document.createElement('form');
    box.className = 'porta-box';
    box.noValidate = true;

    const h = document.createElement('h1');
    h.className = 'porta-titolo';
    h.innerHTML = '<span class="porta-mark">🧯</span> Scudo <b>Campo</b>';

    const sub = document.createElement('p');
    sub.className = 'porta-sub';
    sub.textContent = 'Rilievo dei presidi antincendio — UI Suvereto';

    const pw = campo('porta-pw', 'Parola di accesso',
      { type: 'password', autocomplete: 'current-password' });
    const nome = campo('porta-nome', 'Nome', { autocomplete: 'given-name' });
    const cognome = campo('porta-cognome', 'Cognome', { autocomplete: 'family-name' });
    const matricola = campo('porta-matricola', 'Matricola dipendente',
      { inputmode: 'numeric', placeholder: 'es. 123456' });

    const nota = document.createElement('div');
    nota.className = 'porta-nota';
    nota.innerHTML =
      '<b>Questi dati restano sul telefono.</b> Nome, cognome e matricola sono '
      + 'salvati soltanto nella memoria di questo browser: non vengono inviati a '
      + 'nessun server, non passano da internet e nessuno li può leggere da remoto. '
      + 'Escono di qui solo dentro al pacchetto che sei tu a esportare e a '
      + 'consegnare a Scudo. L\'applicazione vive sul telefono per policy '
      + 'aziendale, e la pagina non conserva nessun dato degli impianti finché '
      + 'non sei tu a caricare il pacchetto.';

    const err = document.createElement('div');
    err.className = 'porta-errore';
    err.hidden = true;
    err.setAttribute('role', 'alert');

    const btn = document.createElement('button');
    btn.className = 'btn btn-blocco';
    btn.type = 'submit';
    btn.textContent = 'Entra';

    box.append(h, sub, pw.wrap, nome.wrap, cognome.wrap, matricola.wrap, nota, err, btn);
    porta.append(box);
    document.body.append(porta);
    setTimeout(() => pw.inp.focus(), 60);

    const sbaglia = (messaggio, campoDaFocalizzare) => {
      err.textContent = messaggio;
      err.hidden = false;
      if (campoDaFocalizzare) campoDaFocalizzare.focus();
    };

    box.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      err.hidden = true;

      const n = nome.inp.value.trim();
      const c = cognome.inp.value.trim();
      const m = matricola.inp.value.trim();

      // Prima l'identità, poi la parola: se sbagli la parola ma hai già scritto
      // nome e cognome, ritrovarli cancellati è la cosa più irritante possibile
      // su una tastiera del telefono sotto il sole.
      if (!n) return sbaglia('Serve il nome.', nome.inp);
      if (!c) return sbaglia('Serve il cognome.', cognome.inp);
      if (!m) return sbaglia('Serve la matricola dipendente.', matricola.inp);

      btn.disabled = true;
      let ok = false;
      try {
        ok = (await impronta(pw.inp.value)) === IMPRONTA_ATTESA;
      } catch {
        // crypto.subtle non esiste fuori da un contesto sicuro (http:// che non
        // sia localhost). Meglio dirlo che lasciare un "parola errata" bugiardo
        // su una parola giusta.
        btn.disabled = false;
        return sbaglia('Questo browser non può verificare la parola di accesso '
          + 'su una connessione non sicura. Apri la pagina in https.');
      }
      btn.disabled = false;

      if (!ok) {
        pw.inp.value = '';
        return sbaglia('Parola di accesso errata.', pw.inp);
      }

      const id = {
        nome: n,
        cognome: c,
        matricola: m,
        entrato_il: new Date().toISOString(),
      };
      try {
        localStorage.setItem(CHIAVE_ACCESSO, JSON.stringify(id));
      } catch {
        // Memoria non disponibile (navigazione privata): si entra lo stesso,
        // la verrà richiesta di nuovo alla prossima apertura. Meglio che
        // bloccare l'operatore davanti a un impianto.
      }
      porta.remove();
      risolvi(id);
      return undefined;
    });
  });
}
