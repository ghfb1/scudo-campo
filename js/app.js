/**
 * Scudo Campo — applicazione.
 *
 * Sequenza di avvio:
 *   1. apre lo storage e verifica che sappia davvero scrivere;
 *   2. ripristina il rilievo interrotto, se c'è;
 *   3. registra i flush di uscita;
 *   4. disegna.
 *
 * Ogni azione che modifica i dati passa da `muta()`, che salva PRIMA di
 * ridisegnare. Se il salvataggio fallisce l'operatore lo vede subito, e non
 * dopo aver fatto trenta controlli convinto che fossero al sicuro.
 */
import {
  E, ESITI, GRAVITA, STATI_ANOMALIA, leggiPacchetto, scriviPacchetto, valida,
  PacchettoNonValido,
} from './pacchetto.js';
import * as store from './store.js';
import * as S from './stato.js';
import * as PV from './piani.js';
import { formCampi, vistaCampi } from './campi.js';
import { apriPorta, dimentica, nomeCompleto } from './accesso.js';
import {
  apriSheet, apriSheetConChiusura, avviso, barreImpilate, campo, chiudiSheet, ciambella, collegaSheet,
  conferma, dataIt, dataOraIt, el, kpi, num, scaricaFile, scelte, select, sheetAperto,
  svuotaNodo, tag, tagIdoneita, testo, toast, vuoto,
} from './ui.js';
import * as G from './grafici.js';
import { vistaAlberoLuoghi } from './luoghi.js';
import {
  corpoControlloPiano, corpoRegistrazione, etichettaEsito, frasScadenza,
  gravitaSuggerita, sezionePiani,
} from './controllo.js';

const VISTE = ['riepilogo', 'presidi', 'scadenze', 'anomalie', 'piani', 'luoghi', 'dati'];
let vistaCorrente = 'riepilogo';
let limiteElenco = 60;
let contaAltreIstanze = () => 0;

// Dove si trova l'operatore dentro l'albero delle ubicazioni.
let dove = { impiantoId: '', edificioId: '', localeId: '' };
let filtri = {
  testo: '', categorie: [], soloNonConformi: false,
  soloConAnomalie: false, soloDaControllare: false,
};

// --------------------------------------------------------------------------- //
// Avvio
// --------------------------------------------------------------------------- //
async function avvia() {
  // La porta prima di tutto: finché l'operatore non si è identificato non si
  // disegna niente e non si tocca la memoria del dispositivo. Se è già entrato
  // in passato, `apriPorta` risolve subito e non si vede nessuna schermata.
  const identitaOperatore = await apriPorta();

  collegaSheet();
  collegaStoria();

  // L'avvio disegna comunque. Un passo che fallisce degrada l'app, non la
  // impedisce: una pagina bianca in cabina è il peggior esito possibile,
  // perché non dice nemmeno che cosa è andato storto.
  let persistenza = { modalita: 'localstorage', errore: null };
  try {
    persistenza = await store.inizializza();
  } catch (e) {
    persistenza = { modalita: 'localstorage', errore: String(e.message || e) };
  }

  try {
    const salvato = await store.caricaDataset();
    if (salvato && S.ripristina(salvato)) {
      const r = S.riepilogo();
      toast(`Rilievo ripristinato: ${r.righe} presidi, ${r.modifiche_non_esportate} modifiche non esportate.`,
        r.modifiche_non_esportate > 0 ? 'toast-warn' : '');
    }
  } catch (e) {
    if (e.formatoIncompatibile) {
      // Si cancella e si dice perché. Tenerlo lì significherebbe riproporre lo
      // stesso errore a ogni apertura, e con l'app aggiornata quel rilievo non
      // è comunque più esportabile.
      await store.svuota();
      S.azzera();
      toast(`${e.message} È stato rimosso: ricarica il pacchetto da Scudo e rifai il giro.`,
        'toast-ko', 20000);
    } else {
      toast(`Non è stato possibile ripristinare il rilievo salvato: ${e.message}`, 'toast-ko', 12000);
    }
  }

  store.registraFlush(() => (S.get().caricato ? S.serializza() : null), () => S.lavoroNonEsportato());

  contaAltreIstanze = store.sorvegliaIstanze((n) => {
    if (n > 0) {
      toast("Attenzione: Scudo Campo è aperto in un'altra scheda. Chiudi le altre, "
        + 'altrimenti possono sovrascriversi il rilievo a vicenda.', 'toast-warn', 12000);
    }
    aggiornaStatusbar();
  });

  document.getElementById('tabbar').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-vista]');
    if (b) vaiA(b.dataset.vista);
  });
  document.getElementById('btn-sessione').addEventListener('click', apriSessione);

  // Il titolo riporta al riepilogo, e azzera la navigazione: chi lo tocca è
  // sceso in un locale e vuole ricominciare da capo, non tornare al riepilogo
  // di quel locale.
  document.getElementById('btn-home').addEventListener('click', () => {
    dove = { impiantoId: '', edificioId: '', localeId: '' };
    chiudiSheet();
    vaiA('riepilogo');
  });

  if (persistenza.modalita !== 'idb') {
    toast('Archiviazione ridotta: il database locale del browser non è utilizzabile'
      + (persistenza.errore ? ` (${persistenza.errore})` : '')
      + '. Il rilievo viene salvato in una copia di emergenza: esporta il pacchetto più spesso.',
      'toast-warn', 12000);
  }

  // L'operatore della porta è l'operatore del giro: non lo si chiede due volte.
  // Va applicato DOPO il ripristino, altrimenti il dataset ricaricato
  // riporterebbe l'operatore del pacchetto e sovrascriverebbe chi sta lavorando
  // adesso — che è quasi sempre un'altra persona.
  if (identitaOperatore) {
    S.impostaSessione({
      operatore: nomeCompleto(identitaOperatore),
      matricola: identitaOperatore.matricola,
    });
  }

  registraServiceWorker();
  S.registraOsservatore(() => { aggiornaStatusbar(); });
  // All'avvio non c'è niente a cui tornare indietro.
  vaiA(S.get().caricato ? 'riepilogo' : 'dati', { ricorda: false });

  // Un pacchetto arrivato per condivisione o per doppio clic si carica da solo.
  await raccogliPacchettoInArrivo();
}

/**
 * Raccoglie un pacchetto arrivato da fuori: condiviso da un'altra app (Android)
 * o aperto con un doppio clic (desktop).
 *
 * Il file non passa dal selettore: il service worker lo ha già messo da parte
 * mentre apriva l'applicazione. Qui lo si prende e lo si carica.
 *
 * Perché serve: su un telefono il pacchetto arriva in posta o in chat, e il
 * percorso normale è "salvalo, apri l'app, tocca carica, trovalo fra i file" —
 * quattro passaggi in cui l'ultimo è quello dove la gente si perde, perché la
 * cartella dei download di un telefono non somiglia a niente. Con la
 * condivisione diventa un tocco solo.
 */
async function raccogliPacchettoInArrivo() {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open('scudo-campo-condivisi');
    const risposta = await cache.match('./in-arrivo');
    if (!risposta) return;

    const nome = decodeURIComponent(risposta.headers.get('X-Nome-File') || 'pacchetto.zip');
    const blob = await risposta.blob();
    if (!blob.size) { await cache.delete('./in-arrivo'); return; }

    toast(`Pacchetto ricevuto: ${nome}`, '', 6000);
    const prima = S.get().caricato ? S.get().sessione.checksum_origine : null;
    try {
      await caricaFile(new File([blob], nome, { type: 'application/zip' }));
    } finally {
      // Si toglie DOPO il tentativo, non prima.
      //
      // Cancellarlo subito sembrava prudente — un file rimasto in cache verrebbe
      // riproposto a ogni apertura — ma `caricaFile` può fermarsi a chiedere
      // conferma (se ci sono modifiche non esportate) o rifiutare un pacchetto
      // non valido. In quei casi il file era già stato buttato, e l'operatore
      // doveva farselo rimandare: la condivisione, che serve a togliere
      // passaggi, ne aggiungeva uno proprio quando le cose andavano storte.
      //
      // Toglierlo qui copre entrambi i casi: caricato o rifiutato, la decisione
      // è stata presa e riproporlo non serve.
      await cache.delete('./in-arrivo');
    }

    if (S.get().sessione.checksum_origine === prima) {
      toast('Il pacchetto condiviso non è stato caricato. Quando hai esportato '
        + 'il rilievo, ricondividilo per aprirlo.', 'toast-warn', 12000);
    }
  } catch (e) {
    toast(`Il pacchetto condiviso non è stato letto: ${e.message}. `
      + 'Puoi caricarlo a mano dalla scheda Dati.', 'toast-warn', 12000);
  }
}

/**
 * Apertura da doppio clic sul file (desktop, applicazione installata).
 *
 * È un canale diverso dalla condivisione — qui il file arriva dal sistema
 * operativo, non da un'altra applicazione — e va agganciato subito, non dentro
 * `avvia()`: l'evento può scattare prima che l'avvio finisca.
 */
if ('launchQueue' in window && 'files' in (window.LaunchParams || {}).prototype) {
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || !params.files.length) return;
    try {
      const handle = params.files[0];
      const file = await handle.getFile();
      toast(`Pacchetto aperto: ${file.name}`, '', 6000);
      await caricaFile(file);
    } catch (e) {
      toast(`Il file non è stato letto: ${e.message}`, 'toast-ko', 10000);
    }
  });
}

function registraServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;

  // Un service worker serve dalla cache: dopo una pubblicazione la pagina
  // continua a eseguire la revisione precedente finché non viene ricaricata.
  //
  // Prima l'app lo diceva con un toast che spariva dopo dodici secondi e
  // chiedeva di "chiudere e riaprire" — cioè un'istruzione che si legge quando
  // il messaggio è già andato via, e che su un'app installata sulla schermata
  // Home non è nemmeno ovvia (chiudere la scheda non basta se resta in
  // background). Il risultato pratico: si pubblica e non cambia niente.
  //
  // Adesso è una barra che RESTA finché non la si tocca, con un pulsante che
  // attiva la revisione nuova e ricarica. Il rilievo vive in IndexedDB e non
  // viene toccato dalla ricarica.
  let barra = null;
  const proponi = (reg) => {
    if (barra) return;
    barra = el('div', { class: 'aggiornamento', role: 'status' }, [
      el('span', { class: 'agg-testo', testo: "Nuova versione dell'app disponibile." }),
      el('button', {
        class: 'agg-btn', type: 'button', testo: 'Aggiorna',
        onclick: () => {
          barra.querySelector('.agg-testo').textContent = 'Aggiorno…';
          // `controllerchange` ricarica: si aspetta che il nuovo worker abbia
          // davvero preso il controllo, altrimenti si ricarica sulla vecchia.
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            location.reload();
          }, { once: true });
          const target = reg.waiting || reg.installing;
          if (target) target.postMessage('ATTIVA_ORA');
          else location.reload();
        },
      }),
      el('button', {
        class: 'agg-chiudi', type: 'button', 'aria-label': 'Rimanda',
        testo: '✕', onclick: () => { barra.remove(); barra = null; },
      }),
    ]);
    document.body.append(barra);
  };

  // `updateViaCache: 'none'`: senza, il browser può servire lo sw.js dalla
  // cache HTTP (GitHub Pages manda `max-age=600`) e non accorgersi per dieci
  // minuti che ne esiste uno nuovo.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) proponi(reg);
    reg.addEventListener('updatefound', () => {
      const nuovo = reg.installing;
      if (!nuovo) return;
      nuovo.addEventListener('statechange', () => {
        if (nuovo.state === 'installed' && navigator.serviceWorker.controller) proponi(reg);
      });
    });

    // Ricontrolla all'apertura e ogni volta che l'app torna in primo piano: su
    // un telefono l'app non viene quasi mai chiusa davvero, viene messa via —
    // quindi "al caricamento" da solo può non succedere per giorni.
    // Dopo OGNI controllo si riguarda `reg.waiting`, non ci si affida al solo
    // evento `updatefound`.
    //
    // `updatefound` scatta una volta sola, quando il worker comincia a
    // installarsi. Se si è installato mentre questa pagina non stava
    // ascoltando — un'altra scheda che ha fatto il controllo per prima, o un
    // controllo del browser fra un caricamento e l'altro — quell'evento è già
    // passato e non torna: il worker resta in attesa per sempre e la barra non
    // compare mai. Misurato provandolo: con la revisione nuova già in `waiting`,
    // ogni successivo `update()` non produceva nessun evento.
    const controlla = () => reg.update()
      .then(() => { if (reg.waiting && navigator.serviceWorker.controller) proponi(reg); })
      .catch(() => {});

    controlla();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') controlla();
    });
  }).catch(() => {});
}

/** Versione dell'app effettivamente in esecuzione, letta dalla cache attiva. */
async function versioneInEsecuzione() {
  try {
    const chiavi = await caches.keys();
    return chiavi.find((k) => k.startsWith('scudo-campo-v')) || null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------- //
// Salvataggio: il punto obbligato di ogni modifica
// --------------------------------------------------------------------------- //
async function muta(fn, messaggioOk) {
  const prima = S.get().giornale.length;
  let risultato;
  try {
    risultato = fn();
  } catch (e) {
    toast(e.message || String(e), 'toast-ko', 7000);
    return null;
  }
  const nuoviEventi = S.get().giornale.slice(prima);
  const esito = await store.salvaConEvento(S.serializza(), nuoviEventi);
  if (esito.degradato) {
    toast('Salvataggio nel database locale non riuscito: passo alla copia di emergenza. '
      + 'Esporta il pacchetto appena puoi.', 'toast-warn', 9000);
  }
  if (messaggioOk) toast(messaggioOk, 'toast-ok');
  disegna();
  return risultato;
}

// --------------------------------------------------------------------------- //
// Telaio
// --------------------------------------------------------------------------- //
// --------------------------------------------------------------------------- //
// Navigazione: si deve poter tornare indietro
// --------------------------------------------------------------------------- //
//
// Il difetto che questa parte risolve: toccando una barra di un grafico l'app
// cambiava vista e riscriveva i filtri, e da lì non c'era modo di tornare a
// quello che si stava guardando. Su un telefono è la differenza fra uno
// strumento e una trappola — si smette di toccare qualunque cosa, per paura di
// perdere il punto in cui si era.
//
// Come funziona: ogni salto salva un'ISTANTANEA di tutto ciò che decide che cosa
// si vede (vista, ubicazione, filtri, sotto-schede, ricerche) e aggiunge una voce
// alla cronologia del browser. Il tasto ‹ e il gesto «indietro» di Android
// consumano quella voce e rimettono le cose com'erano.
//
// Il foglio a comparsa NON entra nella cronologia, di proposito: `chiudiSheet` è
// chiamato da una quarantina di punti, spesso subito prima di aprirne un altro,
// e `history.back()` è asincrono — la chiusura sarebbe arrivata dopo
// l'apertura successiva, chiudendo il foglio sbagliato. Il gesto indietro con un
// foglio aperto lo chiude e RIMETTE la voce consumata: la cronologia resta
// bilanciata e il foglio si comporta come una finestra modale, che è come si
// comporta in ogni app.
const storia = [];

function istantanea() {
  return {
    vista: vistaCorrente,
    dove: { ...dove },
    filtri: { ...filtri, categorie: [...filtri.categorie] },
    limiteElenco,
    vistaTotale,
    filtroScadenze,
    schedaScadenze,
    ricercaScadenze,
    filtroScadenzeImp: [...filtroScadenzeImp],
    filtroScadenzeCat: [...filtroScadenzeCat],
    filtroScadenzePiano: [...filtroScadenzePiano],
    schedaAnomalie,
    ricercaAnomalie,
    filtroPunti,
    filtroAnomalie: {
      ...filtroAnomalie,
      impiantoIds: [...filtroAnomalie.impiantoIds],
      tipiAsset: [...filtroAnomalie.tipiAsset],
    },
  };
}

function ripristina(s) {
  vistaCorrente = s.vista;
  dove = s.dove;
  filtri = s.filtri;
  limiteElenco = s.limiteElenco;
  vistaTotale = s.vistaTotale;
  filtroScadenze = s.filtroScadenze;
  schedaScadenze = s.schedaScadenze;
  ricercaScadenze = s.ricercaScadenze;
  filtroScadenzeImp = s.filtroScadenzeImp;
  filtroScadenzeCat = s.filtroScadenzeCat;
  filtroScadenzePiano = s.filtroScadenzePiano;
  schedaAnomalie = s.schedaAnomalie;
  ricercaAnomalie = s.ricercaAnomalie;
  filtroPunti = s.filtroPunti;
  filtroAnomalie = s.filtroAnomalie;
  segnaTabAttiva(vistaCorrente);
}

function segnaTabAttiva(vista) {
  for (const b of document.querySelectorAll('#tabbar .tab')) {
    b.classList.toggle('attivo', b.dataset.vista === vista);
  }
}

function aggiornaIndietro() {
  const b = document.getElementById('btn-indietro');
  if (b) b.hidden = storia.length === 0;
}

function tornaIndietro() {
  const s = storia.pop();
  if (!s) return false;
  ripristina(s);
  disegna();
  scrollTo({ top: 0 });
  return true;
}

function collegaStoria() {
  addEventListener('popstate', () => {
    if (sheetAperto()) {
      // Il foglio si comporta come una modale: indietro lo chiude e non si
      // esce dalla schermata sotto. La voce appena consumata viene rimessa.
      chiudiSheet();
      try { history.pushState({ scudo: true }, ''); } catch { /* senza cronologia */ }
      return;
    }
    tornaIndietro();
    aggiornaIndietro();
  });
  const b = document.getElementById('btn-indietro');
  if (b) b.addEventListener('click', () => history.back());
}

/**
 * @param ricorda  se true, da qui si potrà tornare indietro. È false solo per i
 *                 salti che sostituiscono il punto di partenza invece di
 *                 partirne — il logo «casa», e il ritorno alla radice.
 */
function vaiA(vista, { ricorda = true } = {}) {
  if (!VISTE.includes(vista)) return;
  if (ricorda) {
    storia.push(istantanea());
    try { history.pushState({ scudo: storia.length }, ''); } catch { /* senza cronologia */ }
  }
  vistaCorrente = vista;
  limiteElenco = 60;
  segnaTabAttiva(vista);
  disegna();
  aggiornaIndietro();
  document.getElementById('vista').focus({ preventScroll: true });
  scrollTo({ top: 0 });
}

function disegna() {
  const c = document.getElementById('vista');
  svuotaNodo(c);
  const st = S.get();
  if (!st.caricato && vistaCorrente !== 'dati') {
    c.append(vistaSenzaDati());
  } else {
    switch (vistaCorrente) {
      case 'riepilogo': c.append(vistaRiepilogo()); break;
      case 'presidi': c.append(vistaPresidi()); break;
      case 'scadenze': c.append(vistaScadenze()); break;
      case 'anomalie': c.append(vistaAnomalie()); break;
      case 'piani': c.append(vistaPiani()); break;
      case 'luoghi': c.append(vistaLuoghi()); break;
      default: c.append(vistaDati());
    }
  }
  aggiornaStatusbar();
  aggiornaIndietro();
}

function aggiornaStatusbar() {
  const st = S.get();
  const sb = document.getElementById('statusbar');
  svuotaNodo(sb);
  document.getElementById('chip-operatore').textContent = st.sessione.operatore || 'chi sei?';

  if (!st.caricato) {
    sb.append(el('span', { class: 'pill pill-attesa', testo: '● nessun pacchetto caricato' }));
    for (const id of ['badge-anomalie', 'badge-dati']) document.getElementById(id).hidden = true;
    return;
  }

  const r = S.riepilogo();
  const p = store.statoPersistenza();

  sb.append(el('span', {
    class: p.modalita === 'idb' ? 'pill pill-ok' : 'pill pill-allarme',
    testo: p.modalita === 'idb' ? '● salvato sul dispositivo' : '● archiviazione ridotta',
  }));
  // Sulla barra di stato l'unità è il CONTROLLO, non il presidio: è il lavoro
  // che resta, e un estintore con quattro piani non è finito dopo il primo.
  sb.append(el('span', { class: 'pill',
    testo: `${r.controlli_fatti}/${r.controlli_previsti} controlli` }));
  if (r.modifiche_non_esportate > 0) {
    sb.append(el('span', { class: 'pill pill-attesa', testo: `${r.modifiche_non_esportate} da esportare` }));
  } else if (st.esportato.il) {
    sb.append(el('span', { class: 'pill pill-ok', testo: 'esportato ✓' }));
  }
  if (contaAltreIstanze() > 0) {
    sb.append(el('span', { class: 'pill pill-allarme', testo: "● aperto in un'altra scheda" }));
  }

  const ba = document.getElementById('badge-anomalie');
  ba.hidden = r.anomalie_aperte === 0;
  ba.textContent = String(r.anomalie_aperte > 99 ? '99+' : r.anomalie_aperte);

  const bd = document.getElementById('badge-dati');
  bd.hidden = r.modifiche_non_esportate === 0;
  bd.textContent = String(r.modifiche_non_esportate > 99 ? '99+' : r.modifiche_non_esportate);
}

function vistaSenzaDati() {
  return el('div', {}, [
    vuoto('📥', 'Nessun pacchetto caricato',
      'Carica il file .zip esportato da Scudo per iniziare il giro.'),
    el('button', {
      class: 'btn btn-primario btn-blocco', type: 'button',
      testo: 'Vai a Dati e carica il pacchetto', onclick: () => vaiA('dati'),
    }),
  ]);
}

function barraAvanzamento(fatti, totale) {
  const perc = totale ? Math.round((fatti / totale) * 100) : 0;
  return el('div', { class: 'avanzamento', 'aria-label': `${fatti} di ${totale}` }, [
    el('div', { class: 'avanzamento-riemp', style: `width:${perc}%` }),
  ]);
}

// --------------------------------------------------------------------------- //
// Vista: riepilogo
// --------------------------------------------------------------------------- //
function dataOra(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('it-IT',
    { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Il giro come oggetto con un suo stato, non come somma di controlli sparsi.
 *
 * La conclusione è una CONFERMA, non un conteggio: arrivare al 100% dei presidi
 * non significa che il giro sia finito — restano quelli non accessibili, quelli
 * da rivedere, e soprattutto resta la responsabilità di dire "ho finito", che è
 * di una persona e non di una percentuale.
 */
function schedaGiro(r) {
  const st = S.get();
  const s = st.sessione;
  const stato = S.statoGiro();

  const etichetta = {
    [S.GIRO_NON_INIZIATO]: ['Controllo non ancora iniziato', 'tag-grigio'],
    [S.GIRO_IN_CORSO]: ['Controllo in corso', 'tag-ambra'],
    [S.GIRO_CONCLUSO]: ['Controllo concluso', 'tag-verde'],
  }[stato];

  const righe = [
    el('dt', { testo: 'Stato' }),
    el('dd', {}, [tag(etichetta[0], etichetta[1])]),
    el('dt', { testo: 'Operatore Terna' }),
    el('dd', { testo: [s.operatore, s.matricola && `matr. ${s.matricola}`]
      .filter(Boolean).join(' · ') || '—' }),
    el('dt', { testo: 'Operatore ditta' }),
    el('dd', { testo: s.operatore_ditta || '—' }),
    el('dt', { testo: 'Inizio' }),
    el('dd', { testo: dataOra(s.iniziato_il) || '—' }),
    el('dt', { testo: 'Fine' }),
    el('dd', { testo: dataOra(s.concluso_il)
      || (stato === S.GIRO_IN_CORSO ? 'da confermare' : '—') }),
  ];
  if (s.note_giro) {
    righe.push(el('dt', { testo: 'Note' }), el('dd', { testo: s.note_giro }));
  }

  const azioni = [];
  if (stato === S.GIRO_NON_INIZIATO) {
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button',
      testo: 'Inizia il controllo', onclick: formGiro,
    }));
  } else {
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: 'Modifica i dati del controllo', onclick: formGiro,
    }));
  }
  if (stato === S.GIRO_IN_CORSO) {
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:8px',
      testo: 'Concludi il controllo', onclick: () => confermaConclusione(r),
    }));
  }
  if (stato === S.GIRO_CONCLUSO) {
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:8px',
      testo: 'Riapri il controllo',
      onclick: () => { S.riapriGiro(); toast('Controllo riaperto.'); disegna(); },
    }));
  }

  return el('div', { class: 'card' }, [
    el('h2', { testo: 'Il controllo', style: 'margin-top:0' }),
    el('dl', { class: 'dati' }, righe),
    ...azioni,
  ]);
}

function formGiro() {
  const s = S.get().sessione;
  const fOp = el('input', { type: 'text', value: s.operatore || '', placeholder: 'Nome e cognome' });
  const fMat = el('input', { type: 'text', value: s.matricola || '', placeholder: 'Matricola', inputmode: 'numeric' });
  const fDitta = el('input', { type: 'text', value: s.operatore_ditta || '', placeholder: 'Nome e ditta di appartenenza' });
  const fNote = el('textarea', { rows: '2', value: s.note_giro || '' });

  // Tipologie del giro. Le voci si costruiscono dai presidi presenti, con il
  // conteggio: una tipologia offerta e senza presidi manderebbe l'operatore su
  // un elenco vuoto.
  const st = S.get();
  const conta = new Map();
  for (const a of (st.perEntita[E.ASSET] || [])) {
    if (a.eliminato_il) continue;
    const t = S.tipoAssetDi(a);
    if (t) conta.set(t, (conta.get(t) || 0) + 1);
  }
  const nomiTipo = new Map((st.perEntita[E.TIPO_ASSET] || []).map((t) => [t.codice, t.descrizione]));
  const scelti = new Set(s.tipi_asset || []);
  const caselle = [...conta.entries()].sort((a, b) => b[1] - a[1]).map(([codice, n]) => {
    const chk = el('input', { type: 'checkbox' });
    chk.checked = scelti.has(codice);
    chk.addEventListener('change', () => {
      if (chk.checked) scelti.add(codice); else scelti.delete(codice);
      aggiornaConteggio();
    });
    return { codice, n, chk, nodo: el('label', { class: 'casella' }, [
      chk,
      el('span', { class: 'casella-testo', testo: nomiTipo.get(codice) || codice }),
      el('span', { class: 'f-conta', testo: String(n) }),
    ]) };
  });
  const riassunto = el('div', { class: 'mini', style: 'margin:6px 0' });
  function aggiornaConteggio() {
    const tot = caselle.reduce((t, c) => t + (scelti.has(c.codice) ? c.n : 0), 0);
    riassunto.textContent = scelti.size
      ? `${scelti.size} tipologie selezionate · ${tot} presidi nel giro`
      : `Nessuna selezione: il giro copre tutti i ${caselle.reduce((t, c) => t + c.n, 0)} presidi.`;
  }
  aggiornaConteggio();

  apriSheet('Dati del controllo', el('div', {}, [
    campo('Operatore Terna', fOp),
    campo('Matricola dipendente', fMat),
    campo('Operatore ditta manutentrice', fDitta),
    campo('Note sul giro', fNote),
    el('h3', { testo: 'Che cosa controlli in questo giro', style: 'margin:16px 0 4px;font-size:.95rem' }),
    el('div', { class: 'mini' }, [
      'Lascia tutto deselezionato per controllare ogni tipologia. Scegliendone '
      + "alcune, l'avanzamento e il riepilogo si riferiscono solo a quelle — "
      + "con un interruttore per rivedere l'archivio intero quando serve.",
    ]),
    riassunto,
    el('div', { class: 'caselle' }, caselle.map((c) => c.nodo)),
    el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px',
      testo: 'Salva',
      onclick: () => {
        if (!fOp.value.trim()) { toast("Serve il nome dell'operatore Terna.", 'toast-ko'); return; }
        if (S.statoGiro() === S.GIRO_NON_INIZIATO) {
          S.iniziaGiro({
            operatore: fOp.value.trim(), matricola: fMat.value.trim(),
            operatore_ditta: fDitta.value.trim(), tipi_asset: [...scelti],
          });
          toast('Controllo iniziato.', 'toast-ok');
        } else {
          S.aggiornaGiro({
            operatore: fOp.value.trim(), matricola: fMat.value.trim(),
            operatore_ditta: fDitta.value.trim(), note_giro: fNote.value.trim(),
            tipi_asset: [...scelti],
          });
          toast('Dati del controllo aggiornati.');
        }
        vistaTotale = false;
        chiudiSheet();
        disegna();
      },
    }),
  ]));
}

function confermaConclusione(r) {
  const mancanti = r.righe - r.controllati;
  const fNote = el('textarea', { rows: '2', value: S.get().sessione.note_giro || '' });

  apriSheet('Concludere il controllo', el('div', {}, [
    mancanti > 0
      ? avviso(`Restano ${mancanti} presidi su ${r.righe} senza nessun controllo `
        + 'registrato in questo giro. Puoi concludere lo stesso — un presidio non '
        + 'accessibile resta non controllato — ma la differenza deve risultare, '
        + 'quindi scrivi qui sotto perché.', 'avviso-ambra')
      : avviso(`Tutti i ${r.righe} presidi hanno un controllo registrato in questo giro.`,
        'avviso-verde'),
    campo('Note di chiusura', fNote),
    el('div', { class: 'mini', style: 'margin-top:4px' }, [
      'Concludere non blocca niente: puoi sempre riaprire il controllo e '
      + 'continuare. Serve a dire in ufficio che il giro è finito, cosa che il '
      + 'solo conteggio dei presidi non può dire.',
    ]),
    el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px',
      testo: 'Sì, il controllo è concluso',
      onclick: () => {
        if (mancanti > 0 && !fNote.value.trim()) {
          toast('Scrivi perché restano presidi non controllati.', 'toast-ko');
          return;
        }
        S.concludiGiro(fNote.value.trim());
        chiudiSheet();
        toast('Controllo concluso. Ricordati di esportare il pacchetto.', 'toast-ok', 9000);
        disegna();
      },
    }),
  ]));
}

// Le serie dei grafici, dichiarate una volta sola.
//
// Lo stesso significato deve avere lo stesso colore in tutta l'app: se «da
// fare» è blu nel riepilogo e grigio nello scadenzario, ogni grafico va riletto
// da capo. E ogni colore che compare in un grafico compare anche qui, con il suo
// nome: `barreImpilate` disegna solo ciò che è dichiarato in `serie`, quindi non
// può esistere un colore senza legenda.
const SERIE_GIRO = [
  { chiave: 'fatti', etichetta: 'fatti in questo giro', colore: 'var(--verde)' },
  { chiave: 'restanti', etichetta: 'ancora da fare', colore: 'var(--blu)' },
];

const SERIE_SCADENZE = [
  { chiave: 'scadute', etichetta: 'scadute', colore: 'var(--rosso)' },
  { chiave: 'in_scadenza', etichetta: 'in scadenza', colore: 'var(--ambra)' },
  { chiave: 'regolari', etichetta: 'in regola', colore: 'var(--verde)' },
];

let vistaTotale = false;   // false = solo le tipologie del giro

function vistaRiepilogo() {
  const st = S.get();
  const r = S.riepilogo(vistaTotale);
  const frag = document.createDocumentFragment();

  frag.append(el('h1', { testo: 'Riepilogo del giro' }));

  if (r.modifiche_non_esportate > 0) {
    frag.append(avviso(
      `Hai ${r.modifiche_non_esportate} modifiche salvate sul dispositivo ma non ancora consegnate a Scudo. `
      + 'Il lavoro è al sicuro anche se chiudi la scheda, ma va esportato per rientrare in archivio.'));
  }

  // Il toggle compare solo se c'è un perimetro: un interruttore fra due viste
  // identiche è un comando che non fa niente, e insegna a non fidarsi degli
  // altri comandi.
  const tipiGiro = st.sessione.tipi_asset || [];
  if (tipiGiro.length) {
    frag.append(el('div', { class: 'contesto' }, [
      el('span', { testo: vistaTotale ? 'Stai vedendo ' : 'Giro limitato a ' }),
      el('b', { testo: vistaTotale ? 'tutto l\'archivio'
        : `${tipiGiro.length} tipologie (${r.righe} presidi su ${r.righe_totali})` }),
      el('button', {
        type: 'button', testo: vistaTotale ? 'torna al giro' : 'vedi tutto',
        onclick: () => { vistaTotale = !vistaTotale; disegna(); },
      }),
    ]));
  }

  frag.append(el('div', { class: 'griglia-kpi' }, [
    kpi(`${r.controlli_fatti}/${r.controlli_previsti}`, 'controlli fatti',
      r.controlli_fatti ? 'verde' : ''),
    kpi(`${r.controllati}/${r.righe}`, 'presidi completati',
      r.controllati === r.righe && r.righe ? 'verde' : ''),
    kpi(r.presidi, 'presidi censiti'),
    kpi(r.anomalie_aperte, 'anomalie aperte', r.anomalie_aperte ? 'rosso' : 'verde'),
    kpi(r.scadute, 'scadenze scadute', r.scadute ? 'rosso' : 'verde'),
  ]));

  frag.append(schedaGiro(r));

  // --- avanzamento, a ciambella --------------------------------------------- //
  //
  // La ciambella e la barra dicono lo stesso numero in due modi, e il modo
  // conta: la percentuale al centro è l'unica cifra che si legge in un colpo
  // d'occhio con il telefono in mano, mentre la barra dice quanto manca in
  // proporzione. Il numero esatto è scritto in legenda, perché la lunghezza di
  // un arco non si stima.
  const restanti = Math.max(0, r.controlli_previsti - r.controlli_fatti);
  const perc = r.controlli_previsti
    ? Math.round((r.controlli_fatti / r.controlli_previsti) * 100) : 0;
  frag.append(el('div', { class: 'card' }, [
    el('h2', { testo: 'Avanzamento del giro', style: 'margin-top:0' }),
    ciambella([
      { valore: r.controlli_fatti, etichetta: 'controlli fatti', colore: 'var(--verde)' },
      { valore: restanti, etichetta: 'ancora da fare', colore: 'var(--grigio-500)' },
    ], { numero: `${perc}%`, testo: 'del giro' }),
    barraAvanzamento(r.controlli_fatti, r.controlli_previsti),
    el('div', { class: 'mini', style: 'margin-top:6px',
      testo: `${restanti} controlli ancora da fare, `
        + `su ${r.righe - r.controllati} presidi.` }),
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
      testo: 'Vai a quelli da controllare',
      onclick: () => {
        filtri = { ...filtri, soloDaControllare: true, testo: '', categorie: [] };
        dove = { impiantoId: '', edificioId: '', localeId: '' };
        vaiA('presidi');
      },
    }),
  ]));

  // --- che cosa ho fatto finora --------------------------------------------- //
  //
  // Serve per due ragioni diverse, e la seconda è quella che conta.
  //
  // La prima: dieci minuti dopo non ci si ricorda se quel rilevatore lo si è
  // segnato o no, e senza questo elenco l'unico modo di saperlo è ritrovare il
  // presidio nell'albero.
  //
  // La seconda: si tocca «Conforme» sul pezzo sbagliato. Succede, con il
  // telefono in una mano. Da qui si apre il verbale di quella registrazione e la
  // si annulla — l'alternativa, senza, è registrare un secondo controllo per
  // "correggere" il primo, che non corregge niente e lascia nel registro un
  // controllo mai eseguito.
  const fatti = S.interventiDelGiro();
  if (fatti.length) {
    frag.append(el('div', { class: 'card' }, [
      el('h2', { testo: `Fatti in questo giro (${fatti.length})`, style: 'margin-top:0' }),
      el('div', { class: 'mini', style: 'margin:-4px 0 8px',
        testo: 'Tocca una riga per vedere che cosa risulta registrato, o per annullarla.' }),
      el('ul', { class: 'elenco' }, fatti.slice(0, 12).map((iv) => {
        const a = S.indici.assets.get(iv.asset_id);
        const cat = a ? S.categoriaDi(a) : null;
        const tc = S.indici.tipiControllo.get(iv.tipo_controllo_codice);
        const pn = (S.indici.piani || []).find((x) => x.id === iv.piano_id);
        return el('li', {}, [
          el('button', {
            class: 'voce', type: 'button', onclick: () => schedaRegistrazione(iv.id),
          }, [
            el('span', { class: `barra-stato ${iv.esito === 'IDONEO' ? 'ok' : iv.esito === 'NON_IDONEO' ? 'ko' : 'attenzione'}` }),
            el('span', { class: 'voce-ico', testo: (cat && cat.icona) || '🛠️' }),
            el('span', { class: 'voce-corpo' }, [
              el('div', { class: 'voce-titolo' }, [
                a && a.identificativo
                  ? el('span', { class: 'mono', style: 'font-weight:700', testo: `${a.identificativo} ` })
                  : null,
                el('span', { testo: (cat && cat.descrizione) || (a && a.categoria_codice) || 'Presidio' }),
              ]),
              el('div', { class: 'voce-sotto',
                testo: (pn && pn.denominazione) || (tc && tc.descrizione) || iv.tipo_controllo_codice }),
              el('div', { class: 'voce-tag' }, [
                tag(etichettaEsito(iv.esito),
                  iv.esito === 'IDONEO' ? 'tag-verde'
                    : iv.esito === 'NON_IDONEO' ? 'tag-rosso' : 'tag-ambra'),
                a ? tag(S.ubicazione(a), 'tag-grigio') : null,
              ].filter(Boolean)),
            ]),
            el('span', { class: 'voce-freccia', testo: '\u203a' }),
          ]),
        ]);
      })),
      fatti.length > 12
        ? el('div', { class: 'mini', style: 'margin-top:6px',
          testo: `Gli altri ${fatti.length - 12} si trovano nella scheda del loro presidio, `
            + 'in fondo, sotto «Storico controlli».' })
        : null,
    ]));
  }

  // --- che cosa resta, per piano di verifica -------------------------------- //
  //
  // È la domanda con cui si organizza la giornata: non «quanti controlli
  // mancano» ma «di che tipo sono», perché piani diversi vogliono attrezzi
  // diversi. Le barre si toccano e portano all'elenco già filtrato: un grafico
  // su cui non si può agire, su un telefono, è spazio tolto a quello che serve.
  const perPiano = S.avanzamentoPerChiave((sc) => {
    const id = sc.piano_id || sc.regola_id;
    if (!id) return { valore: '(senza piano)', etichetta: 'senza piano di verifica' };
    const pn = (S.indici.piani || []).find((y) => y.id === id);
    const f = pn ? PV.etichettaFrequenza(pn.frequenza_valore, pn.frequenza_unita) : '';
    return { valore: id, etichetta: (pn && pn.denominazione) || id, frequenza: f };
  }, vistaTotale).filter((x) => x.restanti > 0);

  if (perPiano.length) {
    frag.append(el('div', { class: 'card' }, [
      el('h2', { testo: 'Che cosa resta, per piano', style: 'margin-top:0' }),
      el('div', { class: 'mini', style: 'margin:-4px 0 10px',
        testo: 'In verde quelli già fatti in questo giro. Tocca una riga per '
          + "vedere l'elenco." }),
      barreImpilate({
        serie: SERIE_GIRO,
        nota: 'La lunghezza dice quanti sono; i colori come stanno.',
        righe: perPiano.slice(0, 8).map((x) => ({
          etichetta: x.etichetta,
          sotto: x.frequenza,
          valori: { fatti: x.fatti, restanti: x.restanti },
          onclick: () => {
            filtroScadenzePiano = x.valore === '(senza piano)' ? [] : [x.valore];
            filtroScadenzeImp = []; filtroScadenzeCat = [];
            filtroScadenze = 'TUTTE'; schedaScadenze = 'elenco'; limiteElenco = 60;
            vaiA('scadenze');
          },
        })),
      }),
      perPiano.length > 8
        ? el('div', { class: 'mini', style: 'margin-top:6px',
          testo: `Altri ${perPiano.length - 8} piani con lavoro residuo non sono `
            + 'nel grafico: li trovi nello scadenzario.' })
        : null,
    ]));
  }

  // --- dove resta lavoro ---------------------------------------------------- //
  //
  // Il costo di una verifica è quasi tutto viaggio. Sapere che di un impianto
  // resta un controllo solo, e di un altro settanta, decide l'ordine in cui ci
  // si va — ed è un'informazione che l'elenco dei presidi non dà mai, perché lì
  // si vede una riga alla volta.
  const perImpianto = S.avanzamentoPerChiave((_sc, a) => {
    const i = S.indici.impianti.get(a.impianto_id);
    return i ? { valore: i.id, etichetta: i.denominazione } : null;
  }, vistaTotale).filter((x) => x.restanti > 0);

  if (perImpianto.length > 1) {
    frag.append(el('div', { class: 'card' }, [
      el('h2', { testo: 'Dove resta lavoro', style: 'margin-top:0' }),
      el('div', { class: 'mini', style: 'margin:-4px 0 10px',
        testo: 'Controlli ancora da fare per impianto. Tocca per andarci.' }),
      barreImpilate({
        serie: SERIE_GIRO,
        righe: perImpianto.slice(0, 10).map((x) => ({
          etichetta: x.etichetta,
          valori: { fatti: x.fatti, restanti: x.restanti },
          onclick: () => {
            dove = { impiantoId: x.valore, edificioId: '', localeId: '' };
            filtri = { ...filtri, testo: '', soloDaControllare: true };
            vaiA('presidi');
          },
        })),
      }),
    ]));
  }

  frag.append(el('div', { class: 'card' }, [
    el('h2', { testo: 'Stato del parco', style: 'margin-top:0' }),
    el('dl', { class: 'dati' }, [
      el('dt', { testo: 'Presidi totali' }), el('dd', { testo: String(r.presidi) }),
      el('dt', { testo: 'Pezzi guasti' }), el('dd', { testo: String(r.presidi_ko) }),
      el('dt', { testo: 'Righe non conformi' }), el('dd', { testo: String(r.non_conformi) }),
      el('dt', { testo: 'Impianti nel giro' }), el('dd', { testo: String(r.impianti) }),
      el('dt', { testo: 'Controlli registrati' }), el('dd', { testo: String(r.interventi) }),
    ]),
  ]));

  frag.append(el('div', { class: 'card' }, [
    el('h2', { testo: 'Anomalie aperte per gravità', style: 'margin-top:0' }),
    el('div', { class: 'griglia-kpi', style: 'grid-template-columns:repeat(3,1fr);margin:0' }, [
      kpi(r.anomalie_gravita.ALTA, 'alta', r.anomalie_gravita.ALTA ? 'rosso' : ''),
      kpi(r.anomalie_gravita.MEDIA, 'media', r.anomalie_gravita.MEDIA ? 'ambra' : ''),
      kpi(r.anomalie_gravita.BASSA, 'bassa'),
    ]),
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:12px',
      testo: 'Apri elenco anomalie', onclick: () => vaiA('anomalie'),
    }),
  ]));

  // Punti aperti: si aprono e si chiudono da qui.
  //
  // Il selettore di stato serve a vedere anche quelli chiusi: senza, un punto
  // risolto sparisce e non resta traccia di che cosa è stato fatto durante il
  // giro — che è proprio quello che in ufficio si vuole sapere.
  const tuttiIPunti = st.perEntita[E.VERIFICA] || [];
  const contaPunti = {
    APERTO: tuttiIPunti.filter((v) => (v.stato || 'APERTO') === 'APERTO').length,
    RISOLTO: tuttiIPunti.filter((v) => v.stato === 'RISOLTO').length,
    ANNULLATO: tuttiIPunti.filter((v) => v.stato === 'ANNULLATO').length,
  };
  const punti = filtroPunti === 'TUTTI'
    ? tuttiIPunti
    : tuttiIPunti.filter((v) => (v.stato || 'APERTO') === filtroPunti);

  {
    frag.append(el('h2', { testo: 'Punti aperti' }));

    // La differenza con le anomalie va detta QUI, dove l'operatore ci arriva
    // senza contesto. I due elenchi si assomigliano abbastanza da far pensare
    // che uno sia di troppo, e la conseguenza è che se ne guarda uno solo.
    frag.append(el('div', { class: 'mini', style: 'margin:-4px 0 10px' }, [
      "Un'anomalia è un presidio che c'è ed è guasto. Un punto aperto è ciò che "
      + 'MANCA o di cui si dubita — una sala senza luci di emergenza, un presidio '
      + 'da installare, un dato da confermare. Non ha un presidio a cui '
      + 'agganciarsi, e si chiude decidendo o installando, non riparando.',
    ]));

    frag.append(el('div', { class: 'filtro-barra' }, [
      filtroBottone(`Aperti ${contaPunti.APERTO}`, filtroPunti === 'APERTO',
        () => { filtroPunti = 'APERTO'; disegna(); }),
      filtroBottone(`Risolti ${contaPunti.RISOLTO}`, filtroPunti === 'RISOLTO',
        () => { filtroPunti = 'RISOLTO'; disegna(); }),
      filtroBottone(`Annullati ${contaPunti.ANNULLATO}`, filtroPunti === 'ANNULLATO',
        () => { filtroPunti = 'ANNULLATO'; disegna(); }),
      filtroBottone(`Tutti ${tuttiIPunti.length}`, filtroPunti === 'TUTTI',
        () => { filtroPunti = 'TUTTI'; disegna(); }),
    ]));

    frag.append(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-bottom:10px',
      testo: '+ Segnala un punto aperto',
      onclick: () => formNuovoPuntoAperto(),
    }));

    if (!punti.length) {
      frag.append(el('div', { class: 'mini', style: 'margin:4px 0 12px' }, [
        filtroPunti === 'APERTO'
          ? 'Nessun punto aperto. Se trovi qualcosa che manca — una sala senza '
            + 'luci, un estintore che dovrebbe esserci — segnalalo qui: non è '
            + "un'anomalia, perché non c'è un presidio a cui agganciarla."
          : 'Nessun punto in questo stato.',
      ]));
    }

    frag.append(el('ul', { class: 'elenco' }, punti.slice(0, 30).map((v) => {
      // Quanti presidi guasti ha lo stesso impianto: "impianto da rifare" e
      // "37 rilevatori scaduti" sono la stessa realtà a due scale, e vederle
      // separate fa pensare che una delle due sia superflua.
      const anomalieLi = v.impianto_id
        ? (st.perEntita[E.ANOMALIA] || []).filter((an) => {
          if (!['APERTA', 'IN_CORSO'].includes(an.stato || 'APERTA')) return false;
          const a = S.indici.assets.get(an.asset_id);
          return a && a.impianto_id === v.impianto_id;
        }).length
        : null;

      return el('li', {}, [
        el('button', { class: 'voce', type: 'button', onclick: () => schedaVerifica(v) }, [
          el('span', { class: `barra-stato ${v.priorita === 'ALTA' ? 'ko' : 'attenzione'}` }),
          el('span', { class: 'voce-corpo' }, [
            el('div', { class: 'voce-titolo', testo: testo(v.ambito) }),
            el('div', { class: 'voce-sotto', testo: testo(v.punto_aperto) }),
            el('div', { class: 'voce-tag' }, [
              tag(testo(v.priorita), v.priorita === 'ALTA' ? 'tag-rosso' : 'tag-ambra'),
              // Due punti su ventuno non riguardano nessun impianto: parlano
              // dell'archivio (numerazione, matricole duplicate). Non sono
              // guasti di niente, e mescolarli agli altri li rende incomprensibili.
              !v.impianto_id ? tag("riguarda l'archivio", 'tag-grigio') : null,
              anomalieLi ? tag(`${anomalieLi} anomalie qui`, 'tag-ambra') : null,
            ].filter(Boolean)),
          ]),
        ]),
      ]);
    })));
  }
  return frag;
}

// --------------------------------------------------------------------------- //
// Vista: presidi — sfoglia per ubicazione oppure cerca
// --------------------------------------------------------------------------- //
function vistaPresidi() {
  const frag = document.createDocumentFragment();
  frag.append(barraRicerca());
  frag.append(briciole());

  const inRicerca = Boolean(filtri.testo.trim()) || filtri.soloNonConformi
    || filtri.soloConAnomalie || filtri.soloDaControllare || filtri.categorie.length > 0;

  if (dove.localeId || inRicerca) frag.append(elencoPresidi());
  else {
    frag.append(navigazione());
    frag.append(azioniUbicazione());
  }
  return frag;
}

/**
 * Aggiungere e rinominare ubicazioni dal punto in cui ci si trova.
 *
 * Il pulsante cambia significato con il livello: sopra crea un impianto, dentro
 * un impianto un edificio, dentro un edificio un locale. È la stessa logica
 * della navigazione, e serve perché l'operatore che trova una cabina non
 * censita deve poterla registrare lì, con il presidio davanti — non annotarla
 * su un foglio per riportarla in ufficio, che è il momento in cui si perde.
 */
function azioniUbicazione() {
  const livello = dove.edificioId ? 'locale' : dove.impiantoId ? 'edificio' : 'impianto';
  const etichette = {
    impianto: ['+ Nuovo impianto', 'Rinomina questo impianto'],
    edificio: ['+ Nuovo edificio', 'Rinomina questo edificio'],
    locale: ['+ Nuovo locale', 'Rinomina questo locale'],
  }[livello];

  const azioni = [el('button', {
    class: 'btn btn-blocco btn-piccolo', type: 'button',
    testo: etichette[0], onclick: () => formUbicazione(livello, null),
  })];

  // La rinomina agisce sul livello in cui si è entrati, non su quello che si
  // sta per creare: dentro un edificio si rinomina l'edificio.
  const corrente = livello === 'locale'
    ? { tipo: 'edificio', id: dove.edificioId }
    : livello === 'edificio' ? { tipo: 'impianto', id: dove.impiantoId } : null;
  if (corrente) {
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:6px',
      testo: `Rinomina questo ${corrente.tipo}`,
      onclick: () => formUbicazione(corrente.tipo, corrente.id),
    }));
  }

  return el('div', { class: 'card', style: 'margin-top:12px' }, [
    el('h2', { testo: 'Anagrafica', style: 'margin-top:0;font-size:1rem' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px' }, [
      "Quello che aggiungi qui viaggia nel pacchetto e rientra in archivio "
      + "insieme ai controlli.",
    ]),
    ...azioni,
  ]);
}

/**
 * @param padreId  sotto quale ubicazione creare. Serve alla scheda dei luoghi,
 *                 dove si crea un edificio sotto un impianto qualunque
 *                 dell'albero — non sotto quello in cui si sta navigando.
 *                 Senza, l'unico modo di creare un locale sotto l'edificio X
 *                 era prima andarci dentro.
 */
function formUbicazione(tipo, id, padreId = '') {
  const st = S.get();
  const esistente = id
    ? (st.perEntita[{ impianto: E.IMPIANTO, edificio: E.EDIFICIO, locale: E.LOCALE }[tipo]] || [])
      .find((r) => r.id === id)
    : null;

  const fNome = el('input', { type: 'text', value: (esistente && esistente.denominazione) || '' });
  const campi = [campo('Denominazione', fNome)];

  let fPiano = null;
  let extra = {};
  if (tipo === 'locale') {
    fPiano = el('input', { type: 'text', value: (esistente && esistente.piano) || '' });
    campi.push(campo('Piano', fPiano));
  }
  if (tipo === 'impianto') {
    // Solo i campi che servono davvero in campo. Indirizzo completo, SCIA e
    // codici attività si compilano in ufficio: chiederli qui, davanti a un
    // cancello, produce campi vuoti e basta.
    extra = {
      tipologia: el('input', { type: 'text', value: (esistente && esistente.tipologia) || '', placeholder: 'SE, RT, SHELTER…' }),
      comune: el('input', { type: 'text', value: (esistente && esistente.comune) || '' }),
    };
    campi.push(campo('Tipologia', extra.tipologia), campo('Comune', extra.comune));
  }
  const fNote = el('textarea', { rows: '2', value: (esistente && esistente.note) || '' });
  campi.push(campo('Note', fNote));

  const titolo = esistente
    ? `Rinomina ${tipo}` : `Nuovo ${tipo}`;

  apriSheet(titolo, el('div', {}, [
    ...campi,
    el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px',
      testo: 'Salva',
      // Passa da `muta()`, come ogni altra azione che tocca i dati.
      //
      // Prima non ci passava, ed era l'unico punto dell'app a non farlo. Le
      // conseguenze, misurate: (1) niente veniva scritto sul dispositivo al
      // momento dell'azione — un blocco del browser subito dopo aver creato un
      // edificio lo perdeva; (2) gli eventi del giornale generati qui non
      // finivano MAI nell'archivio durevole degli eventi, perché `muta()`
      // salva soltanto il tratto di giornale prodotto dentro di sé, e questi
      // cadevano fuori da qualunque tratto, per sempre.
      //
      // La documentazione dichiarava «istantanea e giornale nella stessa
      // transazione, non può esistere uno stato in cui uno registra una
      // modifica che l'altro non ha». Era vero della funzione che salva, falso
      // del sistema: la garanzia sta nella transazione, non nel percorso che
      // decide di chiamarla — e questo percorso non la chiamava.
      onclick: async () => {
        const esito = await muta(() => {
          if (esistente) {
            const patch = { denominazione: fNome.value.trim(), note: fNote.value.trim() };
            if (fPiano) patch.piano = fPiano.value.trim();
            for (const [k, inp] of Object.entries(extra)) patch[k] = inp.value.trim();
            S.modificaUbicazione(tipo, id, patch);
            return { messaggio: 'Ubicazione aggiornata.' };
          }
          if (tipo === 'impianto') {
            const creato = S.creaImpianto({
              denominazione: fNome.value, note: fNote.value.trim(),
              tipologia: extra.tipologia.value.trim(), comune: extra.comune.value.trim(),
            });
            dove = { impiantoId: creato.id, edificioId: '', localeId: '' };
            return { messaggio: 'Impianto creato.' };
          }
          if (tipo === 'edificio') {
            const creato = S.creaEdificio({
              impianto_id: padreId || dove.impiantoId,
              denominazione: fNome.value, note: fNote.value.trim(),
            });
            if (!padreId) dove = { ...dove, edificioId: creato.id, localeId: '' };
            return { messaggio: 'Edificio creato.' };
          }
          S.creaLocale({
            edificio_id: padreId || dove.edificioId, denominazione: fNome.value,
            piano: fPiano.value.trim(), note: fNote.value.trim(),
          });
          return { messaggio: 'Locale creato.' };
        }, null);
        if (esito) { toast(esito.messaggio, 'toast-ok'); chiudiSheet(); }
      },
    }),
  ]));
}

function barraRicerca() {
  const input = el('input', {
    type: 'search', inputmode: 'search', placeholder: 'Codice, matricola, #ID, locale…',
    value: filtri.testo, autocomplete: 'off', enterkeyhint: 'search',
    'aria-label': 'Cerca un presidio',
  });
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      filtri.testo = input.value;
      limiteElenco = 60;
      disegna();
      const nuovo = document.querySelector('.cerca-riga input');
      if (nuovo) { nuovo.focus(); nuovo.setSelectionRange(nuovo.value.length, nuovo.value.length); }
    }, 200);
  });

  const categorie = S.categoriePresenti({
    impiantoId: dove.impiantoId,
    edificioId: dove.edificioId,
    localeId: dove.localeId === '__tutti__' ? '' : dove.localeId,
    tutte: true,
  });

  // I due numeri dell'interruttore si calcolano IGNORANDO il filtro stesso,
  // altrimenti "Tutti" mostrerebbe il conteggio dei soli da controllare e i due
  // valori sarebbero sempre uguali — cioè l'interruttore non direbbe niente.
  const senzaIlFiltro = S.cerca({
    ...filtri, soloDaControllare: false,
    impiantoId: dove.impiantoId, edificioId: dove.edificioId,
    localeId: dove.localeId === '__tutti__' ? '' : dove.localeId,
  }).filter((a) => vistaTotale || S.nelPerimetro(a));
  const conteggi = {
    totale: senzaIlFiltro.length,
    daFare: senzaIlFiltro.filter((a) => !S.controllato(a.id)).length,
  };

  return el('div', { class: 'cerca-wrap' }, [
    el('div', { class: 'cerca-riga' }, [
      input,
      el('button', {
        class: 'btn btn-primario btn-piccolo', type: 'button', testo: '+ Nuovo',
        'aria-label': 'Aggiungi un presidio non censito', onclick: formNuovoPresidio,
      }),
    ]),
    // Due livelli invece di una lista piatta.
    //
    // Prima gli stati (tre, sempre gli stessi) scorrevano nella stessa riga
    // delle categorie (fino a diciotto, con nomi lunghi): su un telefono
    // significava una striscia che scorreva all'infinito, in cui per arrivare a
    // "Rilevatore di idrogeno" bisognava trascinare oltre lo schermo e i tre
    // filtri di stato sparivano da soli. E la categoria attiva, una volta
    // scelta, usciva dalla vista: non si vedeva più che cosa si stava
    // guardando.
    //
    // Adesso: gli stati restano fissi in cima, le categorie diventano un
    // elenco verticale con icona, nome per esteso e conteggio a destra —
    // leggibile e con bersagli grossi da toccare. Aperto solo quando serve, per
    // non allontanare l'elenco dei presidi.
    // "Da controllare / tutti" è la scelta che si fa e si disfa in
    // continuazione durante un giro, quindi ha un interruttore proprio invece
    // di un chip in mezzo agli altri: si vede sempre in che modo si sta
    // guardando l'elenco, e i due numeri dicono subito quanto manca.
    interruttore([
      { chiave: 'da', etichetta: 'Da controllare', n: conteggi.daFare },
      { chiave: 'tutti', etichetta: 'Tutti', n: conteggi.totale },
    ], filtri.soloDaControllare ? 'da' : 'tutti',
    (k) => { filtri.soloDaControllare = k === 'da'; }),
    el('div', { class: 'filtro-barra' }, [
      filtroBottone('Non conformi', filtri.soloNonConformi, () => {
        filtri.soloNonConformi = !filtri.soloNonConformi; limiteElenco = 60; disegna();
      }),
      filtroBottone('Con anomalie', filtri.soloConAnomalie, () => {
        filtri.soloConAnomalie = !filtri.soloConAnomalie; limiteElenco = 60; disegna();
      }),
    ]),
    selettoreCategoria(categorie),
  ]);
}

/**
 * Selettore a scelta multipla, in un pannello che possiede il proprio scroll.
 *
 * Prima era un elenco disegnato dentro la pagina, e non funzionava: con
 * diciotto tipologie l'elenco era alto 1089px in un viewport da 699, dentro un
 * documento da 4897px perché sotto restava tutta la navigazione. Scorrendo si
 * scorreva QUELLA — le tipologie uscivano di scena e non si arrivava mai in
 * fondo. Misurato prima di cambiarlo.
 *
 * Il pannello è lo stesso già usato per le schede e i form (`.sheet`), che ha
 * il proprio `overflow-y` e un fondo che copre la pagina: lo scroll appartiene
 * a lui, e il contenuto sotto non si muove.
 *
 * E la scelta è multipla. Una sola alla volta costringeva a tre giri per
 * contare porte, luci e uscite di uno stesso locale, che è una domanda sola.
 *
 * @param {object} opzioni
 *   titolo, icona, voci [{valore, etichetta, icona, n}], selezione (array),
 *   onApplica(array)
 */
function pannelloScelta({ titolo, icona = '🗂️', etichettaTutti, voci, selezione, onApplica }) {
  const scelti = new Set(selezione || []);
  const caselle = [];

  const riga = (v) => {
    const chk = el('input', { type: 'checkbox' });
    chk.checked = scelti.has(v.valore);
    chk.addEventListener('change', () => {
      if (chk.checked) scelti.add(v.valore); else scelti.delete(v.valore);
      aggiorna();
    });
    caselle.push({ valore: v.valore, chk });
    return el('label', { class: `casella${v.n === 0 ? ' casella-vuota' : ''}` }, [
      chk,
      el('span', { class: 'f-ico', testo: v.icona || '•' }),
      el('span', { class: 'casella-testo', testo: v.etichetta }),
      el('span', { class: 'f-conta', testo: String(v.n) }),
    ]);
  };

  const riassunto = el('div', { class: 'mini', style: 'margin:2px 0 10px' });
  const vuote = voci.filter((v) => v.n === 0).length;
  function aggiorna() {
    const tot = voci.reduce((t, v) => t + (scelti.has(v.valore) ? v.n : 0), 0);
    const base = scelti.size
      ? `${scelti.size} selezionate · ${tot} elementi`
      : `${etichettaTutti} · ${voci.reduce((t, v) => t + v.n, 0)} elementi`;
    riassunto.textContent = vuote
      ? `${base} · ${vuote} a zero: qui non ce ne sono, ma la categoria esiste`
      : base;
  }
  aggiorna();

  const corpo = el('div', {}, [
    riassunto,
    el('div', { class: 'riga', style: 'gap:6px;margin-bottom:10px' }, [
      el('button', {
        class: 'btn btn-piccolo', type: 'button', testo: 'Seleziona tutte',
        onclick: () => { voci.forEach((v) => scelti.add(v.valore)); caselle.forEach((c) => { c.chk.checked = true; }); aggiorna(); },
      }),
      el('button', {
        class: 'btn btn-piccolo', type: 'button', testo: 'Nessuna',
        onclick: () => { scelti.clear(); caselle.forEach((c) => { c.chk.checked = false; }); aggiorna(); },
      }),
    ]),
    el('div', { class: 'caselle' }, voci.map(riga)),
    el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:14px',
      testo: 'Applica',
      onclick: chiudiSheet,
    }),
  ]);

  // Chiudere in QUALUNQUE modo applica: il pulsante, il tocco fuori, la ✕,
  // Escape. Un pannello di filtri che si annulla toccando fuori perde le spunte
  // proprio con il gesto più naturale — il pannello copre l'elenco che si vuole
  // vedere, quindi si tocca fuori per tornarci.
  apriSheetConChiusura(titolo, corpo, () => { onApplica([...scelti]); disegna(); });
}

/**
 * Riga chiusa del filtro: dice che cosa è selezionato e apre il pannello.
 * Ogni voce scelta si toglie singolarmente — con più selezioni, dover azzerare
 * tutto per togliere la terza è il motivo per cui non si usano.
 */
function rigaFiltro({ icona = '🗂️', etichettaTutti, totale, voci, selezione, onApri, onCambia }) {
  if (!voci.length) return el('span', {});
  const scelti = selezione || [];

  if (!scelti.length) {
    return el('button', {
      class: 'filtro-riga', type: 'button', 'aria-pressed': 'false', onclick: onApri,
    }, [
      el('span', { class: 'f-ico', testo: icona }),
      el('span', { class: 'f-testo' }, [
        el('span', { class: 'f-nome', testo: etichettaTutti }),
        el('span', { class: 'f-sotto', testo: `${voci.length} · tocca per filtrare` }),
      ]),
      el('span', { class: 'f-conta', testo: String(totale) }),
    ]);
  }

  const perValore = new Map(voci.map((v) => [v.valore, v]));
  return el('div', { class: 'contesto contesto-chip' }, [
    ...scelti.map((v) => {
      const voce = perValore.get(v) || { etichetta: v, n: 0, icona: '' };
      return el('button', {
        class: 'chip-filtro', type: 'button',
        'aria-label': `Togli il filtro ${voce.etichetta}`,
        onclick: () => { onCambia(scelti.filter((x) => x !== v)); disegna(); },
      }, [
        el('span', { testo: `${voce.icona || ''} ${voce.etichetta}`.trim() }),
        el('span', { class: 'chip-conta', testo: String(voce.n) }),
        el('span', { class: 'chip-x', testo: '✕' }),
      ]);
    }),
    el('button', { type: 'button', testo: 'cambia', onclick: onApri }),
  ]);
}

function selettoreCategoria(categorie) {
  const voci = categorie.map(({ codice, n, categoria }) => ({
    valore: codice, etichetta: categoria.descrizione, icona: categoria.icona, n,
  }));
  const totale = voci.reduce((t, v) => t + v.n, 0);
  const applica = (sel) => { filtri.categorie = sel; limiteElenco = 60; };
  return rigaFiltro({
    etichettaTutti: 'Tutte le tipologie',
    totale,
    voci,
    selezione: filtri.categorie,
    onCambia: (sel) => { applica(sel); },
    onApri: () => pannelloScelta({
      titolo: 'Filtra per tipologia',
      etichettaTutti: 'Tutte le tipologie',
      voci,
      selezione: filtri.categorie,
      onApplica: applica,
    }),
  });
}

/**
 * Percorso corrente, con ogni livello cliccabile per risalire.
 *
 * In campo la domanda non è "come si chiama questo locale in anagrafica" ma
 * "sono qui, cosa c'è qui": scendere per livelli è il modo naturale, cercare
 * per stringa presuppone di ricordarsi la denominazione esatta.
 */
function briciole() {
  const nomeImpianto = dove.impiantoId
    ? (S.indici.impianti.get(dove.impiantoId) || {}).denominazione : null;
  const nomeEdificio = dove.edificioId
    ? (S.indici.edifici.get(dove.edificioId) || {}).denominazione : null;
  const nomeLocale = dove.localeId && dove.localeId !== '__tutti__'
    ? (S.indici.locali.get(dove.localeId) || {}).denominazione : null;

  if (!nomeImpianto && !filtri.testo && !filtri.categorie.length) return el('div', { hidden: true });

  const pezzi = [
    el('button', {
      class: 'briciola', type: 'button', testo: '🏠 Tutti gli impianti',
      onclick: () => { dove = { impiantoId: '', edificioId: '', localeId: '' }; disegna(); },
    }),
  ];
  if (nomeImpianto) {
    pezzi.push(el('span', { class: 'briciola-sep', testo: '›' }));
    pezzi.push(el('button', {
      class: 'briciola', type: 'button', testo: nomeImpianto,
      onclick: () => { dove = { ...dove, edificioId: '', localeId: '' }; disegna(); },
    }));
  }
  if (nomeEdificio) {
    pezzi.push(el('span', { class: 'briciola-sep', testo: '›' }));
    pezzi.push(el('button', {
      class: 'briciola', type: 'button', testo: nomeEdificio,
      onclick: () => { dove = { ...dove, localeId: '' }; disegna(); },
    }));
  }
  if (nomeLocale) {
    pezzi.push(el('span', { class: 'briciola-sep', testo: '›' }));
    pezzi.push(el('span', { class: 'briciola briciola-attiva', testo: nomeLocale }));
  }
  return el('nav', { class: 'briciole', 'aria-label': 'Percorso' }, pezzi);
}

function navigazione() {
  const alb = S.albero(filtri.categorie);
  const frag = document.createDocumentFragment();

  if (!dove.impiantoId) {
    frag.append(el('div', { class: 'mini', style: 'margin:4px 0 8px',
      testo: `${alb.length} impianti nel giro. Tocca per entrare.` }));
    frag.append(el('ul', { class: 'elenco' }, alb.map((i) => el('li', {}, [
      voceNavigazione(i.nome, i, () => {
        dove = { impiantoId: i.id, edificioId: '', localeId: '' }; disegna();
      }, i.tipologia),
    ]))));
    return frag;
  }

  const imp = alb.find((i) => i.id === dove.impiantoId);
  if (!imp) { frag.append(vuoto('🔍', 'Nessun presidio qui con questo filtro')); return frag; }

  if (!dove.edificioId) {
    frag.append(el('ul', { class: 'elenco' }, imp.edifici.map((e) => el('li', {}, [
      voceNavigazione(e.nome, e, () => {
        dove = { ...dove, edificioId: e.id, localeId: '' }; disegna();
      }, `${e.locali.length} local${e.locali.length === 1 ? 'e' : 'i'}`),
    ]))));
    frag.append(bottoneTuttoQui(imp.totale, imp.nome));
    return frag;
  }

  const edi = imp.edifici.find((e) => e.id === dove.edificioId);
  if (!edi) { frag.append(vuoto('🔍', 'Nessun presidio qui')); return frag; }

  frag.append(el('ul', { class: 'elenco' }, edi.locali.map((l) => el('li', {}, [
    voceNavigazione(l.nome, l, () => { dove = { ...dove, localeId: l.id || '__tutti__' }; disegna(); },
      l.piano),
  ]))));
  frag.append(bottoneTuttoQui(edi.totale, edi.nome));
  return frag;
}

function voceNavigazione(nome, nodo, onclick, sottotitolo) {
  const completo = nodo.totale > 0 && nodo.controllati === nodo.totale;
  return el('button', { class: 'voce', type: 'button', onclick }, [
    el('span', { class: `barra-stato ${completo ? 'ok' : nodo.controllati ? 'attenzione' : ''}` }),
    el('span', { class: 'voce-corpo' }, [
      el('div', { class: 'voce-titolo', testo: nome }),
      sottotitolo ? el('div', { class: 'voce-sotto', testo: sottotitolo }) : null,
      barraAvanzamento(nodo.controlli_fatti, nodo.controlli_previsti),
      el('div', { class: 'voce-tag' }, [
        tag(`${nodo.controlli_fatti}/${nodo.controlli_previsti} controlli`, completo ? 'tag-verde' : ''),
        nodo.controllati ? tag(`${nodo.controllati}/${nodo.totale} presidi finiti`) : null,
        nodo.presidi !== nodo.totale ? tag(`${nodo.presidi} pezzi`) : null,
        nodo.nonConformi ? tag(`${nodo.nonConformi} da sistemare`, 'tag-rosso') : null,
        nodo.anomalie ? tag(`${nodo.anomalie} anomalie`, 'tag-ambra') : null,
      ]),
    ]),
    el('span', { class: 'voce-freccia', testo: '›' }),
  ]);
}

function bottoneTuttoQui(quanti, nome) {
  return el('button', {
    class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:4px',
    testo: `Mostra tutti i ${quanti} presidi di ${nome}`,
    onclick: () => { dove = { ...dove, localeId: '__tutti__' }; disegna(); },
  });
}

function elencoPresidi() {
  const frag = document.createDocumentFragment();
  let trovati = S.cerca({
    ...filtri,
    impiantoId: dove.impiantoId,
    edificioId: dove.edificioId,
    localeId: dove.localeId === '__tutti__' ? '' : dove.localeId,
  });

  // Il perimetro del giro vale anche qui, con lo stesso interruttore del
  // riepilogo: chi è uscito per gli estintori non deve scorrere
  // centoventitré rilevatori per trovarli. Ma resta visibile e reversibile —
  // un elenco che nasconde presidi senza dirlo è peggio di uno lungo.
  const tipiGiro = S.get().sessione.tipi_asset || [];
  if (tipiGiro.length) {
    const totale = trovati.length;
    if (!vistaTotale) trovati = trovati.filter((a) => S.nelPerimetro(a));
    frag.append(el('div', { class: 'contesto' }, [
      el('span', { testo: vistaTotale ? 'Stai vedendo ' : 'Solo le tipologie del giro · ' }),
      el('b', { testo: vistaTotale ? 'tutte le tipologie' : `${trovati.length} di ${totale}` }),
      el('button', {
        type: 'button', testo: vistaTotale ? 'torna al giro' : 'vedi tutte',
        onclick: () => { vistaTotale = !vistaTotale; limiteElenco = 60; disegna(); },
      }),
    ]));
  }

  const daFare = trovati.filter((a) => !S.controllato(a.id));
  frag.append(el('div', { class: 'riga', style: 'margin:2px 0 8px;gap:6px' }, [
    el('span', { class: 'mini', testo: `${trovati.length} presidi · ${daFare.length} da controllare` }),
    (filtri.testo || filtri.categorie.length || filtri.soloNonConformi || filtri.soloConAnomalie
      || filtri.soloDaControllare)
      ? el('button', {
        class: 'btn btn-piccolo', type: 'button', testo: 'azzera filtri',
        onclick: () => {
          filtri = { testo: '', categorie: [], soloNonConformi: false,
            soloConAnomalie: false, soloDaControllare: false };
          limiteElenco = 60; disegna();
        },
      })
      : null,
  ]));

  if (!trovati.length) {
    frag.append(vuoto('🔍', 'Nessun presidio trovato', 'Prova a togliere qualche filtro.'));
    return frag;
  }

  // Controllo di gruppo: in un locale con dodici lampade, farlo dodici volte
  // significa dodici volte quattro tocchi — ed è il tipo di attrito che porta a
  // segnare tutto "conforme" a fine giro, seduti in macchina.
  //
  // L'etichetta diceva «Segna conformi i N da controllare», ed era rimasta
  // indietro di due riscritture: il form non segna più niente da solo, chiede
  // quale PIANO si sta eseguendo e con quale esito, e rifiuta il conforme se le
  // verifiche non sono spuntate. Un pulsante che promette un'azione diversa da
  // quella che apre è il modo più rapido per farlo premere per sbaglio.
  if (daFare.length > 1) {
    frag.append(el('button', {
      class: 'btn btn-blocco', type: 'button', style: 'margin-bottom:10px',
      testo: `Registra un controllo su ${daFare.length} presidi…`,
      onclick: () => formControlloDiGruppo(daFare),
    }));
  }

  frag.append(el('ul', { class: 'elenco' },
    trovati.slice(0, limiteElenco).map((a) => el('li', {}, [voceAsset(a)]))));

  if (trovati.length > limiteElenco) {
    frag.append(el('button', {
      class: 'btn btn-blocco', type: 'button',
      testo: `Mostra altri ${Math.min(60, trovati.length - limiteElenco)} (di ${trovati.length - limiteElenco})`,
      onclick: () => { limiteElenco += 60; disegna(); },
    }));
  }
  return frag;
}

/**
 * Sotto-schede: prima il quadro d'insieme, poi l'elenco.
 *
 * Un elenco di 459 scadenze o 165 anomalie risponde a "quale, di preciso" e non
 * a "quanto e dove", che è la domanda con cui si comincia. Prima si arrivava
 * direttamente all'elenco, e per sapere quanti estintori scaduti ci fossero a
 * SUVERETO bisognava filtrare e contare a occhio.
 */
/**
 * Interruttore a due stati, grande abbastanza da toccarlo.
 *
 * I filtri a chip (`filtroBottone`) stanno in una striscia che scorre: vanno
 * bene per opzioni che si combinano, male per una scelta binaria che si fa e si
 * disfa in continuazione — su un telefono la striscia scorre e il chip attivo
 * esce dalla vista, quindi non si vede più in che modo si sta guardando
 * l'elenco. Questo resta fermo, mostra ENTRAMBE le alternative con il loro
 * conteggio, e dice quale è attiva.
 */
function interruttore(voci, attiva, onCambia) {
  return el('div', { class: 'interruttore', role: 'group' }, voci.map((v) => el('button', {
    class: `interruttore-voce${attiva === v.chiave ? ' attiva' : ''}`,
    type: 'button', 'aria-pressed': String(attiva === v.chiave),
    onclick: () => { onCambia(v.chiave); limiteElenco = 60; disegna(); },
  }, [
    el('span', { testo: v.etichetta }),
    v.n != null ? el('span', { class: 'interruttore-n', testo: String(v.n) }) : null,
  ].filter(Boolean))));
}

function sottoSchede(attiva, voci, onCambia) {
  return el('div', { class: 'sottoschede', role: 'tablist' }, voci.map((v) => el('button', {
    class: `sottoscheda${attiva === v.chiave ? ' attiva' : ''}`,
    type: 'button', role: 'tab', 'aria-selected': String(attiva === v.chiave),
    onclick: () => { onCambia(v.chiave); disegna(); },
  }, [
    el('span', { testo: v.etichetta }),
    v.n != null ? el('span', { class: 'sottoscheda-n', testo: String(v.n) }) : null,
  ].filter(Boolean))));
}

/**
 * Campo di ricerca, uguale a quello dei presidi.
 *
 * Il fuoco va rimesso a mano dopo `disegna()`: l'app ridisegna l'intera vista a
 * ogni cambiamento, e senza questo la tastiera si chiude a ogni lettera.
 */
function campoRicerca(valore, segnaposto, onCambia) {
  const input = el('input', {
    type: 'search', inputmode: 'search', placeholder: segnaposto,
    value: valore, autocomplete: 'off', enterkeyhint: 'search',
    'aria-label': segnaposto,
  });
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      onCambia(input.value);
      disegna();
      const nuovo = document.querySelector('.cerca-wrap input[type=search]');
      if (nuovo) { nuovo.focus(); nuovo.setSelectionRange(nuovo.value.length, nuovo.value.length); }
    }, 200);
  });
  return el('div', { class: 'cerca-wrap' }, [el('div', { class: 'cerca-riga' }, [input])]);
}

/**
 * Un gruppo del riepilogo: intestazione, conteggio, e le voci che lo compongono.
 * Toccarlo porta all'elenco già filtrato — un totale che non si può aprire
 * costringe a rifare a mano il filtro che lo ha prodotto.
 */
function cluster(titolo, righe, onApri) {
  if (!righe.length) return el('span', {});
  return el('div', { class: 'card' }, [
    el('h2', { testo: titolo, style: 'margin-top:0;font-size:1rem' }),
    el('ul', { class: 'elenco elenco-cluster' }, righe.map((r) => el('li', {}, [
      el('button', {
        class: 'voce', type: 'button', onclick: () => onApri(r),
      }, [
        el('span', { class: `barra-stato ${r.tono || ''}` }),
        el('span', { class: 'voce-corpo' }, [
          el('div', { class: 'voce-titolo', testo: `${r.icona || ''} ${r.etichetta}`.trim() }),
          r.sotto ? el('div', { class: 'voce-sotto', testo: r.sotto }) : null,
        ].filter(Boolean)),
        el('span', { class: 'cluster-n', testo: String(r.n) }),
      ]),
    ]))),
  ]);
}

function filtroBottone(etichetta, attivo, onclick) {
  return el('button', {
    class: 'filtro', type: 'button', 'aria-pressed': attivo ? 'true' : 'false',
    testo: etichetta, onclick,
  });
}

function voceAsset(a) {
  const cat = S.categoriaDi(a);
  const stato = S.statoDi(a);
  const anomalie = S.anomalieDi(a.id);
  const fatto = S.controllato(a.id);
  const ko = num(a.quantita_ko);
  const q = num(a.quantita, 1);
  const classeBarra = !S.conforme(a) ? 'ko' : (fatto ? 'ok' : '');

  // Il pallino: devo fermarmi qui, sì o no.
  //
  // È la prima cosa che si guarda scorrendo un elenco di quaranta presidi, e
  // prima non c'era: c'era una riga di testo che nominava UNA scadenza, mentre
  // un estintore ne ha fino a cinque. «Scade fra 49 giorni» poteva convivere con
  // un collaudo scaduto da un anno, e il collaudo non si vedeva.
  //
  // Colore E simbolo, sempre: contro luce il rosso e l'ambra si somigliano, e
  // c'è chi non li distingue affatto.
  const sc = S.statoControlliDi(a.id);
  const id = S.idoneita(a);
  // Il pallino risponde alla domanda dell'operatore che scorre l'elenco: devo
  // fermarmi qui? Le anomalie aperte battono le scadenze, perché un pezzo rotto
  // va riparato, non ricontrollato — e chi scorre deve vedere la cosa da fare.
  const pallino = {
    NON_IDONEO: { classe: 'ko', segno: '✕', titolo: `non idoneo — ${id.origine}` },
    SCADUTO: { classe: 'ko', segno: '!', titolo: `scaduto — ${id.origine}` },
    SEGREGATO: { classe: 'ignoto', segno: '⊘', titolo: 'segregato' },
    DISMESSO: { classe: 'ignoto', segno: '⊘', titolo: 'dismesso' },
    NON_PREVISTO: { classe: 'ignoto', segno: '–', titolo: 'non previsto' },
    IDONEO: sc.chiave === 'IN_SCADENZA'
      ? { classe: 'attenzione', segno: '!', titolo: `${sc.in_scadenza} controlli in scadenza` }
      : { classe: id.incerto ? 'ignoto' : 'ok', segno: id.incerto ? '?' : '✓',
        titolo: id.incerto ? 'nessuna scadenza calcolata' : 'idoneo' },
  }[id.stato];

  return el('button', { class: 'voce', type: 'button', onclick: () => schedaPresidio(a.id) }, [
    el('span', { class: `barra-stato ${classeBarra}` }),
    el('span', { class: `pallino-controlli ${pallino.classe}`, title: pallino.titolo,
      'aria-label': pallino.titolo, testo: pallino.segno }),
    el('span', { class: 'voce-ico', testo: (cat && cat.icona) || '🧯' }),
    el('span', { class: 'voce-corpo' }, [
      // L'identificativo davanti al nome, non in coda fra i tag.
      //
      // È quello che l'operatore dice a voce e scrive sul cartellino:
      // «ACCI-CEN-01», o «#274» per gli estintori, dove il cancelletto viene dal
      // registro del manutentore. Il codice lungo
      // (`ACCIAIOLO-PALAZZIN-PALAZZIN-CENTRALINA-01`) resta sulla scheda, dove
      // serve a chi lavora sui file: in elenco riempiva la riga senza che
      // nessuno lo leggesse.
      el('div', { class: 'voce-titolo' }, [
        a.identificativo
          ? el('span', { class: 'mono', style: 'font-weight:700', testo: `${a.identificativo} ` })
          : null,
        el('span', { testo: (cat && cat.descrizione) || a.categoria_codice }),
      ]),
      el('div', { class: 'voce-sotto', testo: S.ubicazione(a) }),
      // I dati che identificano l'oggetto fisico, su una riga sola.
      //
      // Sono quelli che si confrontano con quello che si ha davanti — la
      // matricola punzonata, l'anno sul serbatoio, la carica — e prima
      // richiedevano di aprire la scheda per ognuno dei quaranta presidi di un
      // locale. Si mostra solo quello che c'è: una riga di «— · — · —» occupa
      // spazio e non dice niente.
      (() => {
        const dati = [
          a.matricola ? `matr. ${a.matricola}` : null,
          a.anno_costruzione ? `${a.anno_costruzione}` : null,
          a.estinguente || null,
          a.carica_kg ? `${a.carica_kg} kg` : null,
          a.marca || null,
          q !== 1 ? `${q} pezzi` : null,
        ].filter(Boolean);
        return dati.length
          ? el('div', { class: 'voce-sotto mono', testo: dati.join(' · ') })
          : null;
      })(),
      // Lo stato della prossima scadenza, a parole: il colore da solo non si
      // legge contro luce, e una data da sola non dice se è passata.
      (() => {
        // Il riassunto conta TUTTI i controlli, poi nomina il più urgente. Prima
        // ne nominava uno solo, scelto per data, e gli altri sparivano.
        if (sc.chiave === 'SENZA') {
          return el('div', { class: 'voce-sotto',
            testo: 'nessuna scadenza calcolata — apri la scheda per sapere perché' });
        }
        const parti = [
          sc.scaduti ? `${sc.scaduti} scadut${sc.scaduti === 1 ? 'o' : 'i'}` : null,
          sc.in_scadenza ? `${sc.in_scadenza} in scadenza` : null,
          sc.regolari ? `${sc.regolari} in regola` : null,
        ].filter(Boolean);
        const urgente = S.scadenzeDi(a.id)[0];
        const tcp = urgente && S.indici.tipiControllo.get(urgente.tipo_controllo_codice);
        return el('div', {}, [
          el('div', { class: 'voce-sotto', style: 'font-weight:600', testo: parti.join(' · ') }),
          urgente
            ? el('div', { class: 'voce-sotto', testo:
              `${(tcp && tcp.descrizione) || urgente.tipo_controllo_codice}: `
              + `${frasScadenza(urgente.data_scadenza).testo.toLowerCase()}` })
            : null,
        ].filter(Boolean));
      })(),
      el('div', { class: 'voce-tag' }, [
        ko > 0 ? tag(`${ko} guasti`, 'tag-rosso') : null,
        stato && Number(stato.operativo) !== 1 ? tag(stato.descrizione || a.stato_codice, 'tag-rosso') : null,
        anomalie.length ? tag(`${anomalie.length} anomalie`, 'tag-ambra') : null,
        // «controllato» diceva "toccato almeno una volta". Un estintore ha
        // quattro piani, e misurato sull'archivio 433 presidi su 919 ne hanno
        // quattro aperti: la bandierina lo dava per finito dopo il primo.
        (() => {
          const av = S.avanzamentoDi(a.id);
          if (!av.fatti) return null;
          return av.completo
            ? tag('tutti i controlli fatti', 'tag-verde')
            : tag(`${av.fatti} di ${av.previsti} controlli`, 'tag-ambra');
        })(),
      ]),
    ]),
  ]);
}

// --------------------------------------------------------------------------- //
// Scheda presidio
// --------------------------------------------------------------------------- //
function schedaPresidio(assetId) {
  const a = S.indici.assets.get(assetId);
  if (!a) { toast('Presidio non trovato', 'toast-ko'); return; }
  const cat = S.categoriaDi(a);
  const corpo = document.createDocumentFragment();

  corpo.append(el('div', { class: 'riga', style: 'gap:6px;margin-bottom:8px' }, [
    // «Si può usare?», con il motivo. Non più «conforme / da sistemare»:
    // conforme è il termine del verbale e descrive un adempimento, mentre qui
    // serve sapere se il pezzo è utilizzabile adesso.
    tagIdoneita(S.idoneita(a)),
    S.controllato(a.id) ? tag('controllato in questo giro', 'tag-verde') : tag('non ancora controllato'),
    cat ? tag(cat.famiglia || '', 'tag-blu') : null,
  ]));
  corpo.append(el('div', { class: 'mini', style: 'margin-bottom:2px', testo: S.ubicazione(a) }));
  // I dati che identificano il pezzo, senza doverli cercare in fondo alla
  // scheda: sono quelli che si confrontano con la targhetta che si ha davanti.
  corpo.append(el('div', { class: 'mini', style: 'margin-bottom:2px',
    testo: [
      a.matricola ? `matricola ${a.matricola}` : null,
      a.anno_costruzione ? `costruito ${a.anno_costruzione}` : null,
      a.data_messa_servizio ? `in servizio dal ${dataIt(a.data_messa_servizio)}` : null,
      num(a.quantita, 1) > 1 ? `${num(a.quantita)} pezzi` : null,
    ].filter(Boolean).join(' · ') || '—' }));
  corpo.append(el('div', { class: 'mini mono', style: 'margin-bottom:10px', testo: a.codice }));

  // --- che cosa si può fare su questo presidio ---------------------------- //
  //
  // Perché qui NON c'è più un «✓ Conforme» generale.
  //
  // C'era, ed era un errore concettuale. Un presidio non è conforme o non
  // conforme: sono i suoi CONTROLLI a esserlo, e un estintore ne ha quattro —
  // controllo semestrale, revisione, collaudo, fine vita — con periodicità,
  // azioni e scadenze diverse. Un pulsante che diceva «conforme» senza dire a
  // che cosa doveva sceglierne uno per conto dell'operatore, e quello che
  // sceglieva assolveva una scadenza vera.
  //
  // Adesso il presidio ha due cose sole: i suoi DATI, che si modificano, e i
  // suoi CONTROLLI, che si eseguono uno per uno. La conformità sta dentro il
  // controllo, dove esiste.
  corpo.append(el('button', {
    class: 'btn btn-blocco', type: 'button', style: 'margin:12px 0',
    testo: '✎ Modifica anagrafica', onclick: () => formModificaAsset(a),
  }));

  const applicabili = S.controlliApplicabili(a);
  corpo.append(sezionePiani(a, applicabili, {
    onEsito: (piano, esito) => formControlloPiano(a, piano, esito),
    onRipeti: (piano) => formControlloPiano(a, piano),
    onVedi: (iv) => schedaRegistrazione(iv.id),
  }));

  // Aprire un'anomalia senza registrare un controllo: capita — si passa
  // davanti a un estintore e si vede il cartello staccato — ma è la strada
  // secondaria, e sta sotto i controlli.
  corpo.append(el('button', {
    class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
    testo: '📋 Scegli i piani di questo presidio…',
    onclick: () => formPianiDiPresidio(a.id),
  }));
  corpo.append(el('button', {
    class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:6px',
    testo: '⚠️ Apri anomalia senza registrare un controllo',
    onclick: () => formAnomalia(a),
  }));

  // Togliere un piano da QUI è il gesto naturale: chi ha il presidio davanti ha
  // appena visto perché quel controllo non ha senso su questo pezzo. Costringerlo
  // a segnarselo e a farlo al rientro significa che non lo farà, e la scadenza
  // resterà rossa per sempre su una porta che non esiste più.
  const conPiano = applicabili.filter((t) => t.piano_id);
  if (conPiano.length) {
    corpo.append(el('button', {
      class: 'btn btn-piccolo', type: 'button', style: 'margin-top:6px',
      testo: '⚙︎ Questo presidio fa eccezione…',
      onclick: () => formDeroga(a, conPiano),
    }));
  }

  const anomalie = S.anomalieDi(a.id, false);
  const aperte = anomalie.filter((x) => ['APERTA', 'IN_CORSO'].includes(x.stato || 'APERTA'));
  corpo.append(el('h3', { testo: `Anomalie (${aperte.length} aperte su ${anomalie.length})` }));
  if (!anomalie.length) {
    corpo.append(el('div', { class: 'mini', testo: 'Nessuna anomalia registrata.' }));
  } else {
    corpo.append(el('ul', { class: 'elenco' }, anomalie.map((an) => voceAnomalia(an, false))));
  }

  const interventi = S.interventiDi(a.id);
  corpo.append(el('h3', { testo: `Storico controlli (${interventi.length})` }));
  if (!interventi.length) {
    corpo.append(el('div', { class: 'mini', testo: 'Nessun controllo registrato su questo presidio.' }));
  } else {
    // Ogni riga si apre: dentro c'è il verbale com'è stato salvato, spunta per
    // spunta, e — se è di questo giro — il modo per annullarla.
    corpo.append(el('div', { class: 'storico' }, interventi.map((iv) => {
      const tc = S.indici.tipiControllo.get(iv.tipo_controllo_codice);
      return el('button', {
        class: `storico-voce storico-voce-btn ${iv.esito === 'IDONEO' ? 'ok' : iv.esito === 'NON_IDONEO' ? 'ko' : ''}`,
        type: 'button', onclick: () => schedaRegistrazione(iv.id),
      }, [
        el('div', {}, [el('b', { testo: dataIt(iv.data) }), ` · ${(tc && tc.descrizione) || iv.tipo_controllo_codice}`]),
        el('div', { class: 'mini', testo: `${etichettaEsito(iv.esito)}${iv.operatore_nome ? ` · ${iv.operatore_nome}` : ''}` }),
        iv.azione_eseguita ? el('div', { class: 'mini', testo: iv.azione_eseguita }) : null,
        iv.note ? el('div', { class: 'mini', testo: iv.note }) : null,
        el('span', { class: 'voce-freccia', testo: '›' }),
      ]);
    })));
  }

  corpo.append(el('h3', { testo: 'Tutti i dati' }));
  corpo.append(vistaCampi(a));

  corpo.append(el('div', { style: 'margin-top:18px' }, [
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: '🗑️ Segnala presidio rimosso / inesistente',
      onclick: () => formEliminaAsset(a),
    }),
  ]));

  // In testa alla scheda l'identificativo, che è come il presidio si chiama;
  // il codice lungo resta più sotto, dove serve a chi lavora sui file.
  apriSheet(`${(cat && cat.icona) || '🧯'} ${a.identificativo || a.codice}`, corpo);
}

// --------------------------------------------------------------------------- //
// Form: deroga su un singolo presidio
// --------------------------------------------------------------------------- //
function formDeroga(a, controlli) {
  const opzioni = controlli.map((t) => ({
    valore: t.piano_id,
    testo: `${t.descrizione}${t.deroga ? ' — già in deroga' : ''}`,
  }));
  const fPiano = select(opzioni, opzioni[0] && opzioni[0].valore);
  const fAzione = select([
    { valore: 'ESCLUDI', testo: 'Non si applica a questo presidio' },
    { valore: 'SOSTITUISCI_FREQUENZA', testo: 'Cambia la frequenza solo qui' },
  ], 'ESCLUDI');
  const fValore = el('input', { type: 'number', min: '1', inputmode: 'numeric' });
  const fUnita = select(
    ['GIORNI', 'SETTIMANE', 'MESI', 'ANNI'].map((u) => ({ valore: u, testo: u.toLowerCase() })),
    'MESI');
  const fMotivo = el('textarea', { placeholder: 'Es. porta murata nel 2024' });
  const boxFreq = el('div', { hidden: true }, [
    el('div', { class: 'campi campi-2' }, [campo('Ogni', fValore), campo('Unità', fUnita)]),
  ]);
  fAzione.addEventListener('change', () => {
    boxFreq.hidden = fAzione.value !== 'SOSTITUISCI_FREQUENZA';
  });

  const derogaEsistente = () => (controlli.find((t) => t.piano_id === fPiano.value) || {}).deroga;

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${a.codice} · ${S.ubicazione(a)}` }),
    avviso('Vale per questo presidio soltanto: il piano resta invariato per '
      + 'tutti gli altri.', 'avviso-blu'),
    campo('Quale controllo', fPiano),
    campo('Che cosa fare', fAzione),
    boxFreq,
    campo('Perché', fMotivo,
      'Lo leggerà chi fra sei mesi si chiederà perché questo presidio fa eccezione. '
      + 'Senza motivo, una deroga non si distingue da un errore.'),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      derogaEsistente()
        ? el('button', {
          class: 'btn', type: 'button', testo: 'Togli la deroga',
          onclick: async () => {
            const r = await muta(() => S.togliEccezione(a.id, fPiano.value),
              'Deroga tolta');
            if (r) chiudiSheet();
          },
        })
        : null,
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          if (!fMotivo.value.trim()) {
            toast('Scrivi perché questo presidio fa eccezione.', 'toast-ko', 6000);
            return;
          }
          const r = await muta(() => S.creaEccezione(a.id, {
            piano_id: fPiano.value,
            azione: fAzione.value,
            frequenza_valore: fValore.value ? Number(fValore.value) : null,
            frequenza_unita: fUnita.value,
            motivo: fMotivo.value.trim(),
          }), 'Deroga registrata');
          if (r) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet('Questo presidio fa eccezione', corpo);
}

// --------------------------------------------------------------------------- //
// Form: intervento
// --------------------------------------------------------------------------- //
/**
 * La scheda di un controllo già registrato: che cosa risulta, e come disfarlo.
 */
function schedaRegistrazione(interventoId) {
  const d = S.dettaglioIntervento(interventoId);
  if (!d) { toast('Controllo non trovato', 'toast-ko'); return; }
  const assetId = d.intervento.asset_id;
  const corpo = corpoRegistrazione(d, {
    annulla: (id, motivo) => muta(() => S.annullaIntervento(id, motivo), null),
    avvisa: (msg) => toast(msg, 'toast-ko', 8000),
    chiudi: (annullato) => {
      chiudiSheet();
      if (annullato) {
        toast('Registrazione annullata. La scadenza è tornata aperta.', 'toast-ok', 7000);
        schedaPresidio(assetId);
      }
    },
  });
  apriSheet('Controllo registrato', corpo);
}

/**
 * Quali piani ha QUESTO presidio.
 *
 * È la schermata che rende vera la frase «i piani si scelgono per presidio». Il
 * comportamento automatico resta — un estintore riceve la revisione perché la
 * norma la prevede per gli estintori, non perché qualcuno se lo è ricordato — ma
 * qui si vede da dove viene ciascun piano e lo si può cambiare.
 *
 * Ogni riga dice la sua ORIGINE, perché toglierla non ha lo stesso significato:
 *
 *   automatico   — lo prevede la norma per questa tipologia. Toglierlo è una
 *                  deroga, e resta scritta;
 *   dato a mano  — qualcuno lo ha assegnato a questo presidio. Toglierlo
 *                  cancella quella decisione, non ne aggiunge una contraria;
 *   tolto a mano — qualcuno lo aveva escluso. Rimetterlo cancella l'esclusione;
 *   non previsto — le condizioni non lo prevedono qui, o è un piano che si dà
 *                  solo su richiesta.
 *
 * Il motivo si chiede una volta per tutte le modifiche insieme: chiederlo per
 * ogni casella significa che alla terza si scrive «x».
 */
function formPianiDiPresidio(assetId) {
  const a = S.indici.assets.get(assetId);
  if (!a) { toast('Presidio non trovato', 'toast-ko'); return; }
  const righe = S.pianiDelPresidio(assetId);

  if (!righe.length) {
    apriSheet('Piani del presidio', el('div', {}, [
      avviso('Per questa tipologia non c\'è nessun piano di verifica a catalogo. '
        + 'Se ne serve uno, crealo nella scheda «Piani di verifica».', 'avviso-blu'),
    ]));
    return;
  }

  const ETICHETTA = {
    AUTOMATICO: ['previsto dalla norma', 'tag-verde'],
    DATO_A_MANO: ['dato a questo presidio', 'tag-blu'],
    TOLTO_A_MANO: ['tolto a questo presidio', 'tag-rosso'],
    NON_PREVISTO: ['non previsto qui', 'tag-grigio'],
  };

  const caselle = [];
  const elenco = el('ul', { class: 'elenco' }, righe.map((r) => {
    const c = el('input', { type: 'checkbox', checked: r.attivo, tabindex: '-1' });
    caselle.push({ c, r });
    const [testoOrigine, classe] = ETICHETTA[r.origine];
    const riga = el('button', {
      class: `voce voce-selezionabile ${r.attivo ? 'scelta' : ''}`, type: 'button',
      'aria-pressed': r.attivo ? 'true' : 'false',
      onclick: () => {
        c.checked = !c.checked;
        riga.classList.toggle('scelta', c.checked);
        riga.setAttribute('aria-pressed', c.checked ? 'true' : 'false');
        aggiornaNota();
      },
    }, [
      el('span', { class: 'voce-casella' }, [c]),
      el('span', { class: 'voce-corpo' }, [
        el('div', { class: 'voce-titolo', testo: r.piano.denominazione }),
        el('div', { class: 'voce-sotto', testo: [
          PV.etichettaFrequenza(r.piano.frequenza_valore, r.piano.frequenza_unita),
          `${r.azioni.length} verifiche`,
          r.piano.norma || null,
        ].filter(Boolean).join(' · ') }),
        el('div', { class: 'voce-tag' }, [
          tag(testoOrigine, classe),
          r.su_richiesta ? tag('solo su richiesta', 'tag-grigio') : null,
          r.eccezione && r.eccezione.motivo
            ? tag(r.eccezione.motivo.slice(0, 40), 'tag-grigio') : null,
        ].filter(Boolean)),
      ]),
    ]);
    return el('li', {}, [riga]);
  }));

  const fMotivo = el('input', { type: 'text',
    placeholder: 'Es. estintore riconvertito a CO2 nel 2026' });
  const nota = el('div', { class: 'mini', style: 'margin:8px 0' });
  const boxMotivo = el('div', { hidden: true }, [campo('Perché', fMotivo)]);

  function aggiornaNota() {
    const cambi = caselle.filter(({ c, r }) => c.checked !== r.attivo);
    boxMotivo.hidden = cambi.length === 0;
    nota.textContent = cambi.length
      ? `${cambi.length} modific${cambi.length === 1 ? 'a' : 'he'} da salvare.`
      : 'Nessuna modifica.';
  }
  aggiornaNota();

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${a.identificativo || a.codice} · ${S.ubicazione(a)}` }),
    el('div', { class: 'mini', style: 'margin:6px 0 10px',
      testo: 'Spunta i piani che questo presidio deve avere. Quelli previsti dalla '
        + 'norma sono già spuntati: toglierli è una deroga, e resta scritta.' }),
    elenco,
    nota,
    boxMotivo,
    el('div', { class: 'riga riga-fine', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          const voluti = caselle.filter(({ c }) => c.checked).map(({ r }) => r.piano.id);
          const esito = await muta(
            () => S.impostaPianiDiPresidio(assetId, voluti, fMotivo.value), null);
          if (!esito) return;
          chiudiSheet();
          const parti = [];
          if (esito.aggiunti.length) parti.push(`${esito.aggiunti.length} aggiunti`);
          if (esito.tolti.length) parti.push(`${esito.tolti.length} tolti`);
          if (esito.ripristinati.length) parti.push(`${esito.ripristinati.length} riportati al previsto`);
          toast(parti.length ? parti.join(' · ') : 'Nessuna modifica.', 'toast-ok', 7000);
          schedaPresidio(assetId);
        },
      }),
    ]),
  ]);
  apriSheet('Piani di questo presidio', corpo);
}

/**
 * Il ponte fra il modulo del controllo e l'applicazione.
 *
 * `controllo.js` costruisce il form e non sa salvare, avvisare né chiudere: le
 * tre cose che hanno un effetto arrivano da qui. È quello che rende il modulo
 * eseguibile in una prova automatica — la finta le sostituisce e preme i
 * pulsanti — e che tiene `muta()` (salva PRIMA di ridisegnare) in un posto solo.
 */
function formControlloPiano(a, t, esitoIniziale = null) {
  const corpo = corpoControlloPiano(a, t, esitoIniziale, {
    registra: (dati, messaggio) => muta(() => S.registraIntervento(a.id, dati), messaggio),
    avvisa: (msg) => toast(msg, 'toast-ko', 8000),
    chiudi: (registrato = true) => {
      chiudiSheet();
      // Dopo aver registrato si torna alla scheda del presidio, non al nulla:
      // gli altri controlli di quel pezzo sono lì, e quasi sempre se ne fa più
      // di uno prima di spostarsi.
      if (registrato) schedaPresidio(a.id);
    },
  });
  apriSheet(t.descrizione, corpo);
}

function formControlloDiGruppo(assets) {
  // Si sceglie un PIANO, non un tipo di controllo.
  //
  // Prima si sceglieva il tipo, e sui presidi a cui non si applicava l'app
  // sostituiva in silenzio il primo controllo previsto per la loro tipologia.
  // Misurato: il 51,7% dei presidi riceveva un controllo diverso da quello
  // scelto, e ogni registrazione chiudeva la scadenza di quel controllo. Adesso
  // i presidi fuori piano restano fuori, e si vedono.
  const perPiano = new Map();
  for (const a of assets) {
    for (const t of S.controlliApplicabili(a)) {
      if (!t.piano_id) continue;
      if (!perPiano.has(t.piano_id)) perPiano.set(t.piano_id, { t, assets: [] });
      perPiano.get(t.piano_id).assets.push(a);
    }
  }
  if (!perPiano.size) {
    toast('Nessun piano di verifica si applica a questi presidi.', 'toast-ko', 6000);
    return;
  }

  const opzioni = [...perPiano.entries()]
    .sort((x, y) => y[1].assets.length - x[1].assets.length)
    .map(([id, v]) => ({
      valore: id,
      testo: `${v.t.descrizione}${v.t.frequenza_testo ? ` — ${v.t.frequenza_testo}` : ''}`
        + ` · ${v.assets.length} di ${assets.length}`,
    }));

  const fPiano = select(opzioni, opzioni[0].valore);
  const fEsito = scelte(ESITI.map((e) => ({ valore: e, testo: etichettaEsito(e) })), 'IDONEO',
    { obbligatorio: true, onCambia: () => aggiornaEsito() });
  const fData = el('input', { type: 'date', value: S.oggiIso() });
  const fNote = el('input', { type: 'text', placeholder: 'Nota comune (facoltativa)' });

  const boxPerimetro = el('div', {});
  const boxAzioni = el('div', {});
  const caselle = [];

  const aggiorna = () => {
    const v = perPiano.get(fPiano.value);
    const dentro = v ? v.assets.length : 0;
    const fuori = assets.length - dentro;

    svuotaNodo(boxPerimetro);
    boxPerimetro.append(avviso(
      `Si registra su ${dentro} presidi. `
      + (fuori
        ? `Gli altri ${fuori} non hanno questo piano e restano da controllare: `
          + 'non ricevono niente.'
        : 'Tutti i presidi selezionati hanno questo piano.'),
      fuori ? 'avviso-ambra' : 'avviso-blu'));

    if (fuori) {
      const dentroIds = new Set((v ? v.assets : []).map((a) => a.id));
      const rimasti = assets.filter((a) => !dentroIds.has(a.id));
      boxPerimetro.append(el('details', {}, [
        el('summary', { class: 'mini', testo: `Vedi i ${fuori} presidi esclusi` }),
        el('ul', { class: 'mini', style: 'margin:8px 0 0;padding-left:18px' },
          rimasti.slice(0, 60).map((a) => el('li', {
            testo: `${a.identificativo || a.codice} — ${S.ubicazione(a)}`,
          }))),
      ]));
    }

    // La checklist del piano: è la STESSA per tutti, perché il piano è lo
    // stesso. Spuntarla una volta per il gruppo è onesto; inventare quali
    // verifiche siano state fatte su ciascuno no.
    svuotaNodo(boxAzioni);
    caselle.length = 0;
    const azioni = (v && v.t.azioni) || [];
    if (azioni.length) {
      boxAzioni.append(el('h3', { testo: `Che cosa hai verificato (${azioni.length})` }));
      boxAzioni.append(el('div', { class: 'mini',
        testo: 'Vale per tutti i presidi del gruppo: il piano è lo stesso.' }));
      boxAzioni.append(el('ul', { class: 'elenco-azioni' }, azioni.map((az) => {
        const c = el('input', { type: 'checkbox' });
        caselle.push({ casella: c, azione: az });
        c.addEventListener('change', aggiornaEsito);
        return el('li', {}, [
          el('label', { class: 'casella casella-grande' }, [
            c, el('span', { class: 'casella-testo', testo: az.testo }),
          ]),
        ]);
      })));
      boxAzioni.append(el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button',
        testo: `Ho fatto tutte le ${azioni.length} verifiche`,
        onclick: () => {
          const tutte = caselle.every((c) => c.casella.checked);
          for (const c of caselle) c.casella.checked = !tutte;
          aggiornaEsito();
        },
      }));
    }
    aggiornaEsito();
  };
  fPiano.addEventListener('change', aggiorna);

  // La stessa regola del controllo singolo, e detta prima di premere: conforme
  // vuol dire eseguito per intero, e su un gruppo lo vuol dire per tutti.
  const bottone = el('button', { class: 'btn btn-ok', type: 'button', testo: 'Registra' });
  const motivoBlocco = el('div', { class: 'mini', style: 'text-align:right' });
  function aggiornaEsito() {
    const mancanti = caselle.filter((c) => !c.casella.checked).length;
    const bloccato = fEsito.valore === 'IDONEO' && caselle.length > 0 && mancanti > 0;
    bottone.disabled = bloccato;
    bottone.classList.toggle('btn-spento', bloccato);
    motivoBlocco.textContent = bloccato
      ? `Per dichiarare idoneo mancano ${mancanti} verifiche su ${caselle.length}.`
      : '';
  }
  bottone.addEventListener('click', async () => {
    const v = perPiano.get(fPiano.value);
    if (!v || !v.assets.length) { toast('Nessun presidio per questo piano.', 'toast-ko'); return; }
    const res = await muta(() => S.registraInterventoDiGruppo(v.assets.map((a) => a.id), {
      piano_id: fPiano.value,
      esito: fEsito.valore,
      data: fData.value || S.oggiIso(),
      note: fNote.value.trim(),
      azioni: caselle.map(({ casella, azione }, i) => ({
        azione_id: azione.id || null,
        ordine: Number(azione.ordine ?? i),
        testo: azione.testo,
        fatta: casella.checked ? 1 : 0,
      })),
    }), null);
    if (res) {
      chiudiSheet();
      toast(`${res.registrati.length} controlli registrati`
        + (res.esclusi.length ? `, ${res.esclusi.length} presidi esclusi` : '.'),
      'toast-ok', 6000);
    }
  });

  const corpo = el('div', {}, [
    campo('Piano di verifica', fPiano),
    boxPerimetro,
    campo('Esito', fEsito),
    campo('Data', fData),
    boxAzioni,
    campo('Nota', fNote),
    motivoBlocco,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      bottone,
    ]),
  ]);
  aggiorna();
  apriSheet('Registra lo stesso controllo su più presidi', corpo);
}

// --------------------------------------------------------------------------- //
// Form: anomalia
// --------------------------------------------------------------------------- //
function formAnomalia(a) {
  const fGravita = scelte(GRAVITA.map((g) => ({ valore: g, testo: g.toLowerCase() })),
    gravitaSuggerita(a), { obbligatorio: true });

  // Che cosa ha il presidio: un elenco, piu' il testo libero che resta.
  //
  // Prima questa informazione stava nello STATO del presidio, che aveva tredici
  // voci — «scaduto», «da sostituire», «guasto alimentazione» — e l'operatore
  // doveva sceglierne una durante il controllo mentre ne sceglieva un'altra
  // simile per l'anomalia. Il difetto sta qui; lo stato dice solo se il presidio
  // c'e' e se funziona.
  const tipiAnomalia = [...(S.indici.tipiAnomalia || new Map()).values()]
    .filter((t) => Number(t.attivo ?? 1) === 1);
  // Pulsanti e non una tendina: sedici voci dentro un foglio, su un telefono,
  // aprivano la ruota di sistema sopra il foglio stesso ed erano inservibili.
  const fTipoAn = scelte(
    tipiAnomalia.map((t) => ({ valore: t.codice, testo: t.descrizione })), '',
    { onCambia: (v) => {
      const t = tipiAnomalia.find((x) => x.codice === v);
      if (t && t.gravita_suggerita) { fGravita.valore = t.gravita_suggerita; fGravita.ridipingi(); }
    } });
  const fDescr = el('textarea', { placeholder: 'Che cosa non va (obbligatorio)' });
  const fAzione = el('input', { type: 'text', placeholder: 'Azione proposta' });
  const q = num(a.quantita, 1);
  const fKo = el('input', { type: 'number', min: '0', max: String(q), inputmode: 'numeric', value: String(num(a.quantita_ko)) });
  const statiKo = [...S.indici.stati.values()].filter((s) => Number(s.operativo) !== 1);
  const fStato = select([{ valore: '', testo: '(lascia invariato)' },
    ...statiKo.map((s) => ({ valore: s.codice, testo: s.descrizione || s.codice }))], '');

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${a.codice} · ${S.ubicazione(a)}` }),
    campo('Che cosa ha', fTipoAn, 'Facoltativo: serve a contare e a filtrare.'),
    campo('Gravità', fGravita),
    campo('Descrizione', fDescr, 'Obbligatoria: il tipo non la sostituisce. '
      + "Quello che hai visto lo sai solo tu."),
    campo('Azione proposta', fAzione),
    el('div', { class: 'campi campi-2' }, [
      campo(`Pezzi guasti (su ${q})`, fKo),
      campo('Aggiorna stato presidio', fStato),
    ]),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Apri anomalia',
        onclick: async () => {
          if (!fDescr.value.trim()) { toast('La descrizione è obbligatoria.', 'toast-ko'); return; }
          const ko = fKo.value === '' ? null : Number(fKo.value);
          const res = await muta(() => {
            const an = S.apriAnomalia(a.id, {
            tipo_codice: fTipoAn.valore || undefined,
              gravita: fGravita.valore,
              descrizione: fDescr.value.trim(),
              azione_proposta: fAzione.value.trim(),
              quantita_ko: ko,
            });
            const campi = {};
            if (fStato.value) campi.stato_codice = fStato.value;
            if (ko !== null) campi.quantita_ko = ko;
            if (Object.keys(campi).length) S.aggiornaAsset(a.id, campi);
            return an;
          }, 'Anomalia aperta');
          if (res) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet('Nuova anomalia', corpo);
}

function voceAnomalia(an, conContesto = true) {
  const aperta = ['APERTA', 'IN_CORSO'].includes(an.stato || 'APERTA');
  const a = S.indici.assets.get(an.asset_id);
  const cat = a ? S.categoriaDi(a) : null;
  return el('li', {}, [
    el('button', { class: 'voce', type: 'button', onclick: () => schedaAnomalia(an) }, [
      el('span', { class: `barra-stato ${aperta ? (an.gravita === 'ALTA' ? 'ko' : 'attenzione') : 'ok'}` }),
      conContesto ? el('span', { class: 'voce-ico', testo: (cat && cat.icona) || '⚠️' }) : null,
      el('span', { class: 'voce-corpo' }, [
        el('div', { class: 'voce-titolo', testo: testo(an.descrizione) }),
        conContesto && a ? el('div', { class: 'voce-sotto', testo: S.ubicazione(a) }) : null,
        conContesto && a ? el('div', { class: 'voce-sotto mono', testo: a.codice }) : null,
        an.azione_proposta ? el('div', { class: 'voce-sotto', testo: `→ ${an.azione_proposta}` }) : null,
        el('div', { class: 'voce-tag' }, [
          tag(an.gravita || '?', an.gravita === 'ALTA' ? 'tag-rosso' : an.gravita === 'MEDIA' ? 'tag-ambra' : ''),
          tag(an.stato || 'APERTA', aperta ? '' : 'tag-verde'),
          an.data_apertura ? tag(dataIt(an.data_apertura)) : null,
        ]),
      ]),
    ]),
  ]);
}

function schedaAnomalia(an) {
  const a = S.indici.assets.get(an.asset_id);
  const fStato = scelte(STATI_ANOMALIA.map((s) => ({ valore: s, testo: s.toLowerCase().replace('_', ' ') })),
    an.stato || 'APERTA', { obbligatorio: true });
  const fGravita = scelte(GRAVITA.map((g) => ({ valore: g, testo: g.toLowerCase() })),
    an.gravita, { obbligatorio: true });
  const fAzione = el('input', { type: 'text', value: an.azione_proposta || '' });
  const fNote = el('textarea', { placeholder: 'Note di chiusura / avanzamento', value: an.note_chiusura || '' });

  const corpo = el('div', {}, [
    a ? el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: `Apri scheda ${a.codice}`, onclick: () => schedaPresidio(a.id),
    }) : null,
    el('dl', { class: 'dati', style: 'margin-top:12px' }, [
      el('dt', { testo: 'Descrizione' }), el('dd', { testo: testo(an.descrizione) }),
      el('dt', { testo: 'Aperta il' }), el('dd', { testo: dataIt(an.data_apertura) }),
      an.data_chiusura ? el('dt', { testo: 'Chiusa il' }) : null,
      an.data_chiusura ? el('dd', { testo: dataIt(an.data_chiusura) }) : null,
      el('dt', { testo: 'Origine' }), el('dd', { testo: testo(an.origine) }),
      a ? el('dt', { testo: 'Ubicazione' }) : null,
      a ? el('dd', { testo: S.ubicazione(a) }) : null,
    ]),
    el('h3', { testo: 'Aggiorna' }),
    el('div', { class: 'campi campi-2' }, [campo('Stato', fStato), campo('Gravità', fGravita)]),
    campo('Azione proposta', fAzione),
    campo('Note', fNote),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Chiudi', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          const res = await muta(() => S.aggiornaAnomalia(an.id, {
            stato: fStato.valore, gravita: fGravita.valore,
            azione_proposta: fAzione.value.trim(), note_chiusura: fNote.value.trim(),
          }), 'Anomalia aggiornata');
          if (res) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet('Anomalia', corpo);
}

// --------------------------------------------------------------------------- //
// Form: modifica / creazione / eliminazione presidio
// --------------------------------------------------------------------------- //
function formModificaAsset(a) {
  const form = formCampi(a);
  const corpo = el('div', {}, [
    el('div', { class: 'mini mono', testo: a.codice }),
    avviso('Tutti i campi del presidio sono modificabili. Quelli specifici per tipologia '
      + 'compaiono in base alla categoria.', 'avviso-blu'),
    form.nodo,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva modifiche',
        onclick: async () => {
          const errori = form.errori();
          if (errori.length) { toast(errori[0], 'toast-ko', 7000); return; }
          const cambiati = form.leggi();
          if (!Object.keys(cambiati).length) { chiudiSheet(); toast('Nessuna modifica.'); return; }
          const res = await muta(() => S.aggiornaAsset(a.id, cambiati),
            `Aggiornati ${Object.keys(cambiati).length} campi`);
          if (res) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet(`Modifica ${a.codice}`, corpo);
}

function formNuovoPresidio() {
  const st = S.get();
  const impianti = st.perEntita[E.IMPIANTO] || [];
  if (!impianti.length) { toast('Carica prima un pacchetto.', 'toast-ko'); return; }
  const categorie = [...S.indici.categorie.values()];

  const fImp = select(impianti.map((i) => ({ valore: i.id, testo: i.denominazione }))
    .sort((x, y) => x.testo.localeCompare(y.testo)), dove.impiantoId || impianti[0].id);
  const fCat = select(categorie.map((c) => ({ valore: c.codice, testo: `${c.icona || ''} ${c.descrizione}`.trim() })),
    categorie[0] && categorie[0].codice);
  const fEdi = select([{ valore: '', testo: '(nessuno)' }], '');
  const fLoc = select([{ valore: '', testo: '(nessuno)' }], '');
  const fUbic = el('input', { type: 'text', placeholder: 'Dove esattamente: parete nord, ingresso…' });
  const fId = el('input', { type: 'text', placeholder: 'Es. #501' });
  const fMatr = el('input', { type: 'text' });
  const fQta = el('input', { type: 'number', min: '1', inputmode: 'numeric', value: '1' });
  const fNote = el('textarea', { placeholder: "Com'è messo" });

  function riempi(sel, opzioni, valore) {
    svuotaNodo(sel);
    sel.append(el('option', { value: '', testo: '(nessuno)' }));
    for (const o of opzioni) sel.append(el('option', { value: o.valore, testo: o.testo }));
    sel.value = valore || '';
  }
  function aggiornaLocali() {
    riempi(fLoc, S.opzioniCampo({ opzioni_da: 'locali' }, { edificio_id: fEdi.value }),
      dove.localeId === '__tutti__' ? '' : dove.localeId);
  }
  function aggiornaEdifici() {
    riempi(fEdi, S.opzioniCampo({ opzioni_da: 'edifici' }, { impianto_id: fImp.value }), dove.edificioId);
    aggiornaLocali();
  }
  fImp.addEventListener('change', aggiornaEdifici);
  fEdi.addEventListener('change', aggiornaLocali);
  aggiornaEdifici();

  const corpo = el('div', {}, [
    avviso('Il presidio creato in campo riceve un identificatore univoco generato qui: '
      + 'rientra in Scudo senza rischio di collisione con quelli creati da altri dispositivi.', 'avviso-blu'),
    campo('Impianto', fImp),
    campo('Categoria', fCat),
    el('div', { class: 'campi campi-2' }, [campo('Edificio', fEdi), campo('Locale / area', fLoc)]),
    campo('Posizione precisa', fUbic),
    el('div', { class: 'campi campi-2' }, [campo('#ID targhetta', fId), campo('Matricola', fMatr)]),
    campo('Quantità', fQta),
    campo('Note', fNote),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Crea presidio',
        onclick: async () => {
          const nuovo = await muta(() => S.creaPresidio({
            impianto_id: fImp.value,
            categoria_codice: fCat.value,
            edificio_id: fEdi.value,
            locale_id: fLoc.value,
            ubicazione_testo: fUbic.value.trim(),
            identificativo: fId.value.trim(),
            matricola: fMatr.value.trim(),
            quantita: Number(fQta.value) || 1,
            note: fNote.value.trim(),
          }), 'Presidio creato');
          if (nuovo) { chiudiSheet(); schedaPresidio(nuovo.id); }
        },
      }),
    ]),
  ]);
  apriSheet('Nuovo presidio trovato in campo', corpo);
}

function formEliminaAsset(a) {
  const fMotivo = el('textarea', { placeholder: "Perché non c'è più (obbligatorio)" });
  const corpo = el('div', {}, [
    avviso('Il presidio non viene cancellato: viene marcato come rimosso, con data e motivo, '
      + "così l'ufficio vede la modifica e può accettarla.", 'avviso-blu'),
    el('div', { class: 'mini mono', testo: a.codice }),
    campo('Motivo', fMotivo),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Segnala rimosso',
        onclick: async () => {
          if (!fMotivo.value.trim()) { toast('Il motivo è obbligatorio.', 'toast-ko'); return; }
          const res = await muta(() => S.eliminaPresidio(a.id, fMotivo.value.trim()),
            'Presidio segnalato come rimosso');
          if (res) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet('Presidio rimosso o inesistente', corpo);
}

/**
 * Segnala un punto aperto durante il giro.
 *
 * L'impianto si propone da dove ci si trova, ma resta cambiabile e può restare
 * vuoto: un punto aperto può riguardare l'archivio e non un impianto — due dei
 * ventuno ereditati dal censimento sono di quel tipo.
 */
function formNuovoPuntoAperto(impiantoIniziale) {
  const st = S.get();
  const impianti = [...(st.perEntita[E.IMPIANTO] || [])]
    .sort((a, b) => (a.denominazione || '').localeCompare(b.denominazione || ''));

  const fImp = select(
    [{ valore: '', testo: "— nessuno: riguarda l'archivio —" },
      ...impianti.map((i) => ({ valore: i.id, testo: i.denominazione }))],
    impiantoIniziale || dove.impiantoId || '',
  );
  const fAmbito = el('input', { type: 'text', placeholder: 'Es. SUVERETO - Sala quadri' });
  const fTesto = el('textarea', {
    rows: '3',
    placeholder: 'Es. Sala B.T.1 priva di luci di emergenza',
  });
  const fPriorita = select(
    ['ALTA', 'MEDIA', 'BASSA'].map((x) => ({ valore: x, testo: x })), 'MEDIA');

  apriSheet('Segnala un punto aperto', el('div', {}, [
    el('div', { class: 'mini' }, [
      "Serve per ciò che MANCA o di cui si dubita. Se invece un presidio c'è ed è "
      + "guasto, apri un'anomalia dalla sua scheda: è la cosa giusta, e resta "
      + 'legata a quel presidio.',
    ]),
    campo('Impianto', fImp),
    campo('Ambito', fAmbito, 'Dove, in poche parole. Facoltativo.'),
    campo('Che cosa hai riscontrato', fTesto),
    campo('Priorità', fPriorita),
    el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px',
      testo: 'Segnala',
      onclick: async () => {
        try {
          await muta(() => S.creaVerifica({
            impianto_id: fImp.value,
            ambito: fAmbito.value,
            punto_aperto: fTesto.value,
            priorita: fPriorita.value,
          }), 'Punto aperto segnalato');
          filtroPunti = 'APERTO';
          chiudiSheet();
          disegna();
        } catch (err) {
          toast(err.message, 'toast-ko', 8000);
        }
      },
    }),
  ]));
}

function schedaVerifica(v) {
  const fStato = select(['APERTO', 'RISOLTO', 'ANNULLATO'].map((s) => ({ valore: s, testo: s })),
    v.stato || 'APERTO');
  const fEsito = el('textarea', { placeholder: 'Che cosa hai riscontrato', value: v.esito_verifica || '' });
  const corpo = el('div', {}, [
    el('dl', { class: 'dati' }, [
      el('dt', { testo: 'Ambito' }), el('dd', { testo: testo(v.ambito) }),
      el('dt', { testo: 'Punto aperto' }), el('dd', { testo: testo(v.punto_aperto) }),
      el('dt', { testo: 'Priorità' }), el('dd', { testo: testo(v.priorita) }),
      el('dt', { testo: 'Fonte' }), el('dd', { class: 'mini', testo: testo(v.fonte) }),
      ...(v.data_verifica
        ? [el('dt', { testo: 'Chiuso il' }),
          el('dd', { testo: `${dataIt(v.data_verifica)}${v.operatore_nome ? ` · ${v.operatore_nome}` : ''}` })]
        : []),
    ]),
    campo('Stato', fStato),
    campo('Esito della verifica', fEsito),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          const res = await muta(() => S.aggiornaVerifica(v.id, {
            stato: fStato.value, esito_verifica: fEsito.value.trim(),
          }), 'Punto aperto aggiornato');
          if (res) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet('Punto aperto', corpo);
}

// --------------------------------------------------------------------------- //
// Vista: anomalie
// --------------------------------------------------------------------------- //
let filtroAnomalie = { soloAperte: true, gravita: '', stato: '', impiantoIds: [], tipiAsset: [] };

function anomalieFiltrate(st, { conGravita = true, senza = null } = {}) {
  let lista = st.perEntita[E.ANOMALIA] || [];
  if (filtroAnomalie.soloAperte) {
    lista = lista.filter((a) => ['APERTA', 'IN_CORSO'].includes(a.stato || 'APERTA'));
  }
  if (filtroAnomalie.stato) {
    lista = lista.filter((a) => (a.stato || 'APERTA') === filtroAnomalie.stato);
  }
  if (conGravita && filtroAnomalie.gravita) {
    lista = lista.filter((a) => a.gravita === filtroAnomalie.gravita);
  }
  // `senza` esclude un filtro dal conto: serve a costruire le opzioni degli
  // altri. Vedi la nota in `scadenzeFiltrate`.
  const imp = new Set(senza === 'impianto' ? [] : filtroAnomalie.impiantoIds);
  const tipi = new Set(senza === 'tipologia' ? [] : filtroAnomalie.tipiAsset);
  const q = (ricercaAnomalie || '').trim().toLowerCase();

  return lista.filter((an) => {
    const a = S.indici.assets.get(an.asset_id);
    if (!a) return !imp.size && !tipi.size && !q;
    if (imp.size && !imp.has(a.impianto_id)) return false;
    if (tipi.size && !tipi.has(S.tipoAssetDi(a))) return false;
    if (q) {
      const blob = [an.descrizione, an.azione_proposta, a.codice, a.matricola,
        a.marca, a.modello, (S.categoriaDi(a) || {}).descrizione,
        (S.indici.impianti.get(a.impianto_id) || {}).denominazione, a.ubicazione_testo,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

function riepilogoAnomalie(st, frag) {
  const lista = anomalieFiltrate(st, { conGravita: false });
  const per = (chiave) => {
    const m = new Map();
    for (const an of lista) {
      const k = chiave(an);
      if (!k) continue;
      if (!m.has(k.valore)) m.set(k.valore, { ...k, n: 0, alte: 0 });
      const v = m.get(k.valore);
      v.n += 1;
      if (an.gravita === 'ALTA') v.alte += 1;
    }
    return [...m.values()].sort((a, b) => b.alte - a.alte || b.n - a.n);
  };

  const conta = { ALTA: 0, MEDIA: 0, BASSA: 0 };
  for (const an of lista) if (conta[an.gravita] !== undefined) conta[an.gravita] += 1;

  frag.append(el('div', { class: 'griglia-kpi', style: 'grid-template-columns:repeat(3,1fr)' }, [
    kpi(conta.ALTA, 'alta', conta.ALTA ? 'rosso' : ''),
    kpi(conta.MEDIA, 'media', conta.MEDIA ? 'ambra' : ''),
    kpi(conta.BASSA, 'bassa'),
  ]));

  const apri = () => { schedaAnomalie = 'elenco'; limiteElenco = 60; };

  frag.append(cluster('Per impianto', per((an) => {
    const a = S.indici.assets.get(an.asset_id);
    const i = a && S.indici.impianti.get(a.impianto_id);
    return i ? { valore: i.id, etichetta: i.denominazione, icona: '🏭' } : null;
  }).map((r) => ({ ...r, tono: r.alte ? 'ko' : 'attenzione', sotto: r.alte ? `${r.alte} di gravità alta` : 'nessuna alta' })),
  (r) => { filtroAnomalie.impiantoIds = [r.valore]; apri(); disegna(); }));

  frag.append(cluster('Per tipologia', per((an) => {
    const a = S.indici.assets.get(an.asset_id);
    if (!a) return null;
    const t = S.tipoAssetDi(a);
    const nome = (st.perEntita[E.TIPO_ASSET] || []).find((x) => x.codice === t);
    const cat = S.categoriaDi(a);
    return t ? { valore: t, etichetta: (nome && nome.descrizione) || t, icona: cat && cat.icona } : null;
  }).map((r) => ({ ...r, tono: r.alte ? 'ko' : 'attenzione', sotto: r.alte ? `${r.alte} di gravità alta` : 'nessuna alta' })),
  (r) => { filtroAnomalie.tipiAsset = [r.valore]; apri(); disegna(); }));

  frag.append(cluster('Per stato', per((an) => ({
    valore: an.stato || 'APERTA', etichetta: an.stato || 'APERTA', icona: '🔖',
  })).map((r) => ({ ...r, tono: '', sotto: null })),
  (r) => { filtroAnomalie.stato = r.valore; filtroAnomalie.soloAperte = false; apri(); disegna(); }));
}

function vistaAnomalie() {
  const st = S.get();
  const frag = document.createDocumentFragment();
  frag.append(el('h1', { testo: 'Anomalie' }));

  frag.append(sottoSchede(schedaAnomalie, [
    { chiave: 'riepilogo', etichetta: 'Riepilogo' },
    { chiave: 'elenco', etichetta: 'Elenco', n: anomalieFiltrate(st, { conGravita: false }).length },
  ], (k) => { schedaAnomalie = k; limiteElenco = 60; }));

  // Voci dei filtri, a CASCATA: ognuna si conta su ciò che sopravvive agli
  // ALTRI filtri, non a sé stessa. Prima si contavano su tutte le anomalie, e
  // scelto un impianto il filtro delle tipologie continuava a offrire tipologie
  // che lì non ci sono — voci che danno zero righe, che è il modo in cui un
  // filtro insegna a non fidarsi di lui. Escludere sé stessa è necessario: se
  // no, scelta una tipologia, tutte le altre risulterebbero a zero e non si
  // potrebbe più cambiarla.
  const contaImp = new Map();
  for (const an of anomalieFiltrate(st, { conGravita: false, senza: 'impianto' })) {
    const a = S.indici.assets.get(an.asset_id);
    if (a) contaImp.set(a.impianto_id, (contaImp.get(a.impianto_id) || 0) + 1);
  }
  const contaTipo = new Map();
  for (const an of anomalieFiltrate(st, { conGravita: false, senza: 'tipologia' })) {
    const a = S.indici.assets.get(an.asset_id);
    const t = a && S.tipoAssetDi(a);
    if (t) contaTipo.set(t, (contaTipo.get(t) || 0) + 1);
  }
  const vociImp = [...contaImp.entries()].map(([id, n]) => ({
    valore: id, etichetta: (S.indici.impianti.get(id) || {}).denominazione || id, icona: '🏭', n,
  })).sort((a, b) => b.n - a.n);
  const nomiTipo = new Map((st.perEntita[E.TIPO_ASSET] || []).map((t) => [t.codice, t.descrizione]));
  const iconaTipo = (codice) => {
    const c = (st.perEntita[E.CATEGORIA] || []).find((x) => x.tipo_asset_codice === codice && x.icona);
    return (c && c.icona) || '•';
  };
  const vociTipo = [...contaTipo.entries()].map(([t, n]) => ({
    valore: t, etichetta: nomiTipo.get(t) || t, icona: iconaTipo(t), n,
  })).sort((a, b) => b.n - a.n);

  // Aperte / tutte: la stessa scelta binaria dei presidi, con lo stesso
  // interruttore. Conta su TUTTE le anomalie, non su quelle già filtrate,
  // altrimenti i due numeri coinciderebbero sempre.
  const tutteLeAnomalie = st.perEntita[E.ANOMALIA] || [];
  frag.append(interruttore([
    { chiave: 'aperte', etichetta: 'Aperte', n: tutteLeAnomalie.filter(
      (a) => ['APERTA', 'IN_CORSO'].includes(a.stato || 'APERTA')).length },
    { chiave: 'tutte', etichetta: 'Tutte', n: tutteLeAnomalie.length },
  ], filtroAnomalie.soloAperte && !filtroAnomalie.stato ? 'aperte' : 'tutte',
  (k) => { filtroAnomalie.soloAperte = k === 'aperte'; filtroAnomalie.stato = ''; }));

  frag.append(el('div', { class: 'filtro-barra' }, [
    ...GRAVITA.map((g) => filtroBottone(g, filtroAnomalie.gravita === g, () => {
      filtroAnomalie.gravita = filtroAnomalie.gravita === g ? '' : g; disegna();
    })),
    ...STATI_ANOMALIA.map((x) => filtroBottone(x, filtroAnomalie.stato === x, () => {
      filtroAnomalie.stato = filtroAnomalie.stato === x ? '' : x;
      if (filtroAnomalie.stato) filtroAnomalie.soloAperte = false;
      disegna();
    })),
  ]));

  frag.append(rigaFiltro({
    icona: '🏭', etichettaTutti: 'Tutti gli impianti',
    totale: [...contaImp.values()].reduce((n, v) => n + v, 0),
    voci: vociImp, selezione: filtroAnomalie.impiantoIds,
    onCambia: (sel) => { filtroAnomalie.impiantoIds = sel; limiteElenco = 60; },
    onApri: () => pannelloScelta({
      titolo: 'Filtra per impianto', icona: '🏭', etichettaTutti: 'Tutti gli impianti',
      voci: vociImp, selezione: filtroAnomalie.impiantoIds,
      onApplica: (sel) => { filtroAnomalie.impiantoIds = sel; limiteElenco = 60; },
    }),
  }));
  frag.append(rigaFiltro({
    etichettaTutti: 'Tutte le tipologie',
    totale: [...contaTipo.values()].reduce((n, v) => n + v, 0),
    voci: vociTipo, selezione: filtroAnomalie.tipiAsset,
    onCambia: (sel) => { filtroAnomalie.tipiAsset = sel; limiteElenco = 60; },
    onApri: () => pannelloScelta({
      titolo: 'Filtra per tipologia', etichettaTutti: 'Tutte le tipologie',
      voci: vociTipo, selezione: filtroAnomalie.tipiAsset,
      onApplica: (sel) => { filtroAnomalie.tipiAsset = sel; limiteElenco = 60; },
    }),
  }));

  if (schedaAnomalie === 'riepilogo') {
    riepilogoAnomalie(st, frag);
    return frag;
  }

  frag.append(campoRicerca(ricercaAnomalie, 'Descrizione, codice, impianto…',
    (v) => { ricercaAnomalie = v; limiteElenco = 60; }));

  const ordine = { ALTA: 0, MEDIA: 1, BASSA: 2 };
  const lista = [...anomalieFiltrate(st)].sort((a, b) => (ordine[a.gravita] ?? 9) - (ordine[b.gravita] ?? 9)
    || (a.data_apertura || '').localeCompare(b.data_apertura || ''));

  frag.append(el('div', { class: 'mini', style: 'margin:6px 0 8px', testo: `${lista.length} anomalie` }));
  if (!lista.length) { frag.append(vuoto('✅', 'Nessuna anomalia con questi filtri')); return frag; }

  frag.append(el('ul', { class: 'elenco' }, lista.slice(0, limiteElenco).map((an) => voceAnomalia(an))));
  if (lista.length > limiteElenco) {
    frag.append(el('button', {
      class: 'btn btn-blocco', type: 'button',
      testo: `Mostra altre ${Math.min(60, lista.length - limiteElenco)}`,
      onclick: () => { limiteElenco += 60; disegna(); },
    }));
  }
  return frag;
}

// --------------------------------------------------------------------------- //
// Vista: scadenze
// --------------------------------------------------------------------------- //
let filtroScadenze = 'TUTTE';
let schedaScadenze = 'riepilogo';
let ricercaScadenze = '';
let filtroScadenzeImp = [];
let filtroScadenzeCat = [];
let filtroScadenzePiano = [];
let schedaAnomalie = 'riepilogo';
let filtroPunti = 'APERTO';   // APERTO | RISOLTO | ANNULLATO | TUTTI
let ricercaAnomalie = '';

/**
 * Le scadenze che passano i filtri.
 *
 * `senza` esclude UN filtro dal conto, e serve a costruire le opzioni degli
 * altri: le voci di «tipologia» si contano su ciò che sopravvive a impianto,
 * piano e ricerca, ma non a sé stessa — altrimenti, appena scelta una
 * tipologia, tutte le altre risulterebbero a zero e non si potrebbe più
 * cambiarla.
 *
 * È la ragione per cui i filtri qui sono a cascata: scelto «rilevatori di
 * fumo», il filtro dei piani offre i piani dei rilevatori e non tutti e
 * ventotto, di cui ventisei non darebbero nessuna riga.
 */
function scadenzeFiltrate(st, { conSemaforo = true, senza = null } = {}) {
  let lista = (st.perEntita[E.SCADENZA] || []).filter((x) => (x.stato || 'APERTA') === 'APERTA');
  const cat = new Set(senza === 'categoria' ? [] : filtroScadenzeCat);
  const imp = new Set(senza === 'impianto' ? [] : filtroScadenzeImp);
  const piani = new Set(senza === 'piano' ? [] : filtroScadenzePiano);
  const q = (ricercaScadenze || '').trim().toLowerCase();

  lista = lista.filter((x) => {
    const a = S.indici.assets.get(x.asset_id);
    if (!a) return false;
    if (imp.size && !imp.has(a.impianto_id)) return false;
    if (cat.size && !cat.has(a.categoria_codice)) return false;
    if (piani.size && !piani.has(x.piano_id || x.regola_id)) return false;
    if (q) {
      const tc = S.indici.tipiControllo.get(x.tipo_controllo_codice);
      const pn = (S.indici.piani || []).find((y) => y.id === (x.piano_id || x.regola_id));
      const blob = [a.codice, a.matricola, a.marca, a.modello,
        (S.categoriaDi(a) || {}).descrizione,
        (S.indici.impianti.get(a.impianto_id) || {}).denominazione,
        a.ubicazione_testo, tc && tc.descrizione, pn && pn.denominazione, x.data_scadenza,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
  if (conSemaforo && filtroScadenze !== 'TUTTE') {
    // DA_FARE non è un semaforo: è l'unione di scadute e in scadenza, cioè
    // quello che riguarda il giro in corso.
    lista = filtroScadenze === 'DA_FARE'
      ? lista.filter((x) => ['SCADUTO', 'IN_SCADENZA'].includes(S.semaforo(x.data_scadenza)))
      : lista.filter((x) => S.semaforo(x.data_scadenza) === filtroScadenze);
  }
  return lista.sort((a, b) => (a.data_scadenza || '').localeCompare(b.data_scadenza || ''));
}

function riepilogoScadenze(st, frag) {
  const lista = scadenzeFiltrate(st, { conSemaforo: false });
  const per = (chiave) => {
    const m = new Map();
    for (const x of lista) {
      const k = chiave(x);
      if (!k) continue;
      if (!m.has(k.valore)) m.set(k.valore, { ...k, n: 0, scadute: 0 });
      const v = m.get(k.valore);
      v.n += 1;
      if (S.semaforo(x.data_scadenza) === 'SCADUTO') v.scadute += 1;
    }
    return [...m.values()].sort((a, b) => b.scadute - a.scadute || b.n - a.n);
  };

  const scadute = lista.filter((x) => S.semaforo(x.data_scadenza) === 'SCADUTO').length;
  const inScadenza = lista.filter((x) => S.semaforo(x.data_scadenza) === 'IN_SCADENZA').length;

  frag.append(el('div', { class: 'griglia-kpi' }, [
    kpi(lista.length, 'scadenze aperte'),
    kpi(scadute, 'scadute', scadute ? 'rosso' : 'verde'),
    kpi(inScadenza, 'in scadenza', inScadenza ? 'ambra' : 'verde'),
  ]));

  const vaiA_elenco = (semaforo) => { filtroScadenze = semaforo; schedaScadenze = 'elenco'; limiteElenco = 60; };

  // --- come sta lo scadenzario, a ciambella --------------------------------- //
  //
  // Tre quote di un totale: è esattamente la figura che una ciambella sa fare e
  // che tre numeri affiancati non fanno. «112 scadute» e «980 regolari» letti in
  // fila sembrano due numeri grandi; visti come archi si vede subito che il
  // rosso è un decimo, oppure che è metà.
  //
  // La legenda si tocca e filtra l'elenco: le fette no, sono bersagli troppo
  // piccoli per un pollice, e un bersaglio che si manca insegna a non provarci.
  const q = G.quoteSemaforo(lista, S.semaforo);
  frag.append(el('div', { class: 'card' }, [
    el('h2', { testo: 'Come sta lo scadenzario', style: 'margin-top:0' }),
    ciambella([
      { valore: q.SCADUTO, etichetta: 'scadute', colore: 'var(--rosso)' },
      { valore: q.IN_SCADENZA, etichetta: 'in scadenza', colore: 'var(--ambra)' },
      { valore: q.REGOLARE, etichetta: 'regolari', colore: 'var(--verde)' },
      { valore: q.SENZA_DATA, etichetta: 'senza data', colore: 'var(--grigio-500)' },
    ], { numero: lista.length, testo: 'aperte' }),
    el('div', { class: 'filtro-barra', style: 'margin-top:10px' }, [
      filtroBottone(`Vai alle ${q.SCADUTO} scadute`, false,
        () => { vaiA_elenco('SCADUTO'); disegna(); }),
      filtroBottone(`Vai alle ${q.IN_SCADENZA} in scadenza`, false,
        () => { vaiA_elenco('IN_SCADENZA'); disegna(); }),
    ]),
  ]));

  // --- quando arriva il lavoro ---------------------------------------------- //
  //
  // Le scadenze di questo archivio non sono distribuite: sono campagne. Vederlo
  // significa chiamare la ditta due volte l'anno invece di dodici, ed è un fatto
  // che nessun totale annuo può mostrare.
  //
  // Il primo secchio, «già scadute», c'è apposta: un grafico che comincia da
  // oggi fa sparire l'arretrato, che è la parte che urge.
  const carico = G.caricoMensile(lista, new Date(), 6);
  const righeCarico = [
    carico.scadute
      ? {
        etichetta: 'già scadute', valori: { scadute: carico.scadute },
        onclick: () => { vaiA_elenco('SCADUTO'); disegna(); },
      }
      : null,
    // Le barre dei mesi non si toccano: un filtro per mese non esiste, e una
    // barra che sembra un pulsante e non lo è si prova una volta sola, poi non
    // si prova più nemmeno con quelle che funzionano.
    ...carico.mesi.map((m) => ({ etichetta: m.etichetta, valori: { futuro: m.n } })),
  ].filter(Boolean);
  if (carico.scadute || carico.mesi.some((m) => m.n)) {
    frag.append(el('div', { class: 'card' }, [
      el('h2', { testo: 'Quando arriva il lavoro', style: 'margin-top:0' }),
      el('div', { class: 'mini', style: 'margin:-4px 0 10px',
        testo: 'Scadenze dei prossimi sei mesi. Se una barra è molto più lunga '
          + 'delle altre, il lavoro è a campagne: si va una volta e si fa tutto.' }),
      barreImpilate({
        serie: [
          { chiave: 'scadute', etichetta: 'già scadute', colore: 'var(--rosso)' },
          { chiave: 'futuro', etichetta: 'scadono in quel mese', colore: 'var(--blu)' },
        ],
        righe: righeCarico,
      }),
      el('div', { class: 'mini', style: 'margin-top:8px',
        testo: carico.oltre
          ? `Oltre i sei mesi ce ne sono altre ${carico.oltre}: ci sono, ma non `
            + 'riguardano questo giro.'
          : 'Nei prossimi sei mesi c\'è tutto quello che c\'è.' }),
    ]));
  }

  // --- per piano di verifica, a barre --------------------------------------- //
  //
  // Sostituisce l'elenco che c'era qui. Un elenco con i numeri a destra dice
  // quanti sono; le barre dicono quanto pesano l'uno rispetto all'altro, che è
  // la domanda di chi deve decidere da dove cominciare. La quota rossa dentro la
  // barra è la parte già scaduta: due piani con quaranta scadenze ciascuno non
  // sono lo stesso lavoro se in uno trenta sono scadute e nell'altro nessuna.
  const perPiano = G.raggruppa(lista, (x) => {
    const id = x.piano_id || x.regola_id;
    if (!id) return null;
    const pn = (S.indici.piani || []).find((y) => y.id === id);
    return {
      valore: id,
      etichetta: (pn && pn.denominazione) || id,
      frequenza: pn ? PV.etichettaFrequenza(pn.frequenza_valore, pn.frequenza_unita) : '',
    };
  }, S.semaforo);

  if (perPiano.length > 1) {
    frag.append(el('div', { class: 'card' }, [
      el('h2', { testo: 'Per piano di verifica', style: 'margin-top:0' }),
      barreImpilate({
        serie: SERIE_SCADENZE,
        nota: 'La lunghezza dice quante sono; i colori come stanno. '
          + "Tocca una riga per vedere l'elenco.",
        righe: perPiano.slice(0, 10).map((x) => ({
          etichetta: x.etichetta,
          sotto: x.frequenza,
          valori: {
            scadute: x.scadute,
            in_scadenza: x.in_scadenza,
            regolari: x.n - x.scadute - x.in_scadenza,
          },
          onclick: () => { filtroScadenzePiano = [x.valore]; vaiA_elenco('TUTTE'); disegna(); },
        })),
      }),
      perPiano.length > 10
        ? el('div', { class: 'mini', style: 'margin-top:6px',
          testo: `Altri ${perPiano.length - 10} piani non sono nel grafico: usa il `
            + 'filtro qui sopra per vederli.' })
        : null,
    ]));
  }

  frag.append(cluster('Per impianto', per((x) => {
    const a = S.indici.assets.get(x.asset_id);
    const i = a && S.indici.impianti.get(a.impianto_id);
    return i ? { valore: i.id, etichetta: i.denominazione, icona: '🏭' } : null;
  }).map((r) => ({ ...r, tono: r.scadute ? 'ko' : '', sotto: r.scadute ? `${r.scadute} scadute` : 'nessuna scaduta' })),
  (r) => { filtroScadenzeImp = [r.valore]; vaiA_elenco('TUTTE'); disegna(); }));

  frag.append(cluster('Per tipologia di presidio', per((x) => {
    const a = S.indici.assets.get(x.asset_id);
    const c = a && S.categoriaDi(a);
    return c ? { valore: c.codice, etichetta: c.descrizione, icona: c.icona } : null;
  }).map((r) => ({ ...r, tono: r.scadute ? 'ko' : '', sotto: r.scadute ? `${r.scadute} scadute` : 'nessuna scaduta' })),
  (r) => { filtroScadenzeCat = [r.valore]; vaiA_elenco('TUTTE'); disegna(); }));

  frag.append(cluster('Per tipo di controllo', per((x) => {
    const tc = S.indici.tipiControllo.get(x.tipo_controllo_codice);
    return { valore: x.tipo_controllo_codice, etichetta: (tc && tc.descrizione) || x.tipo_controllo_codice, icona: '🛠️' };
  }).map((r) => ({ ...r, tono: r.scadute ? 'ko' : '', sotto: r.scadute ? `${r.scadute} scadute` : 'nessuna scaduta' })),
  () => { vaiA_elenco('TUTTE'); disegna(); }));
}

function vistaScadenze() {
  const st = S.get();
  const frag = document.createDocumentFragment();
  frag.append(el('h1', { testo: 'Scadenzario' }));

  const totali = scadenzeFiltrate(st, { conSemaforo: false }).length;
  frag.append(sottoSchede(schedaScadenze, [
    { chiave: 'riepilogo', etichetta: 'Riepilogo' },
    { chiave: 'elenco', etichetta: 'Elenco', n: totali },
  ], (k) => { schedaScadenze = k; limiteElenco = 60; }));

  // I filtri valgono per entrambe le schede: passare dal riepilogo all'elenco
  // e vedere numeri diversi è il modo più rapido per non fidarsi di nessuno dei due.
  const conScadenzaTutte = scadenzeFiltrate(st, { conSemaforo: false });

  const conta = (lista, chiave) => {
    const m = new Map();
    for (const x of lista) {
      const a = S.indici.assets.get(x.asset_id);
      if (!a) continue;
      const k = chiave(x, a);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };

  const contaImp = conta(scadenzeFiltrate(st, { conSemaforo: false, senza: 'impianto' }),
    (_x, a) => a.impianto_id);
  const contaCat = conta(scadenzeFiltrate(st, { conSemaforo: false, senza: 'categoria' }),
    (_x, a) => a.categoria_codice);

  const vociImp = [...contaImp.entries()].map(([id, n]) => ({
    valore: id, etichetta: (S.indici.impianti.get(id) || {}).denominazione || id, icona: '🏭', n,
  })).sort((a, b) => b.n - a.n);
  const vociCat = [...contaCat.entries()].map(([c, n]) => {
    const cat = S.indici.categorie.get(c) || {};
    return { valore: c, etichetta: cat.descrizione || c, icona: cat.icona, n };
  }).sort((a, b) => b.n - a.n);

  frag.append(rigaFiltro({
    icona: '🏭', etichettaTutti: 'Tutti gli impianti',
    totale: [...contaImp.values()].reduce((n, v) => n + v, 0),
    voci: vociImp, selezione: filtroScadenzeImp,
    onCambia: (sel) => { filtroScadenzeImp = sel; limiteElenco = 60; },
    onApri: () => pannelloScelta({
      titolo: 'Filtra per impianto', icona: '🏭', etichettaTutti: 'Tutti gli impianti',
      voci: vociImp, selezione: filtroScadenzeImp,
      onApplica: (sel) => { filtroScadenzeImp = sel; limiteElenco = 60; },
    }),
  }));
  frag.append(rigaFiltro({
    etichettaTutti: 'Tutte le tipologie',
    totale: [...contaCat.values()].reduce((n, v) => n + v, 0),
    voci: vociCat, selezione: filtroScadenzeCat,
    onCambia: (sel) => { filtroScadenzeCat = sel; limiteElenco = 60; },
    onApri: () => pannelloScelta({
      titolo: 'Filtra per tipologia', etichettaTutti: 'Tutte le tipologie',
      voci: vociCat, selezione: filtroScadenzeCat,
      onApplica: (sel) => { filtroScadenzeCat = sel; limiteElenco = 60; },
    }),
  }));

  // Filtro per PIANO: è la domanda che l'operatore si pone davvero — «che cosa
  // devo fare oggi», non «quali tipi di controllo esistono». Due piani dello
  // stesso tipo di controllo (la revisione di una polvere e quella di una
  // schiuma) sono due lavori diversi, con azioni diverse.
  const contaPiano = new Map();
  for (const x of scadenzeFiltrate(st, { conSemaforo: false, senza: 'piano' })) {
    const k = x.piano_id || x.regola_id;
    if (k) contaPiano.set(k, (contaPiano.get(k) || 0) + 1);
  }
  // Nel menù il piano porta la sua frequenza: «Revisione — CO2» e «Collaudo —
  // CO2» si somigliano, e ogni 60 mesi contro ogni 120 è la differenza che
  // conta. Senza, si sceglie a caso fra due voci quasi uguali.
  const vociPiano = [...contaPiano.entries()].map(([id, n]) => {
    const pn = (S.indici.piani || []).find((y) => y.id === id);
    const f = pn ? PV.etichettaFrequenza(pn.frequenza_valore, pn.frequenza_unita) : '';
    return {
      valore: id,
      etichetta: `${(pn && pn.denominazione) || id}${f ? ` — ${f}` : ''}`,
      n,
    };
  }).sort((a, b) => a.etichetta.localeCompare(b.etichetta));

  if (vociPiano.length > 1) {
    frag.append(rigaFiltro({
      etichettaTutti: 'Tutti i piani',
      totale: [...contaPiano.values()].reduce((n, v) => n + v, 0),
      voci: vociPiano, selezione: filtroScadenzePiano,
      onCambia: (sel) => { filtroScadenzePiano = sel; limiteElenco = 60; },
      onApri: () => pannelloScelta({
        titolo: 'Filtra per piano di verifica', etichettaTutti: 'Tutti i piani',
        voci: vociPiano, selezione: filtroScadenzePiano,
        onApplica: (sel) => { filtroScadenzePiano = sel; limiteElenco = 60; },
      }),
    }));
  }

  if (schedaScadenze === 'riepilogo') {
    riepilogoScadenze(st, frag);
    return frag;
  }

  frag.append(campoRicerca(ricercaScadenze, 'Codice, impianto, controllo…',
    (v) => { ricercaScadenze = v; limiteElenco = 60; }));

  // "Da fare / tutte" è la scelta binaria anche qui: da fare vuol dire scadute
  // o in scadenza, cioè quello che riguarda questo giro. I quattro filtri per
  // semaforo restano sotto per chi vuole essere preciso.
  const senzaSemaforo = scadenzeFiltrate(st, { conSemaforo: false });
  const daFare = senzaSemaforo.filter(
    (x) => ['SCADUTO', 'IN_SCADENZA'].includes(S.semaforo(x.data_scadenza))).length;
  frag.append(interruttore([
    { chiave: 'dafare', etichetta: 'Da fare', n: daFare },
    { chiave: 'tutte', etichetta: 'Tutte', n: senzaSemaforo.length },
  ], filtroScadenze === 'TUTTE' ? 'tutte' : 'dafare',
  (k) => { filtroScadenze = k === 'tutte' ? 'TUTTE' : 'DA_FARE'; }));

  frag.append(el('div', { class: 'filtri' },
    ['TUTTE', 'SCADUTO', 'IN_SCADENZA', 'REGOLARE'].map((f) => filtroBottone(
      { TUTTE: 'Tutte', SCADUTO: 'Scadute', IN_SCADENZA: 'In scadenza', REGOLARE: 'Regolari' }[f],
      filtroScadenze === f,
      () => { filtroScadenze = f; limiteElenco = 60; disegna(); },
    ))));

  const lista = scadenzeFiltrate(st);

  // Quanti presidi non hanno scadenzario è un'informazione, non un dettaglio:
  // senza, un elenco corto sembra "poco da fare" mentre invece è "poco noto".
  const conScadenza = new Set((st.perEntita[E.SCADENZA] || []).map((x) => x.asset_id));
  const impSel = new Set(filtroScadenzeImp);
  const senza = (st.perEntita[E.ASSET] || [])
    .filter((a) => !a.eliminato_il && !conScadenza.has(a.id)
      && (!impSel.size || impSel.has(a.impianto_id))).length;
  if (senza) {
    frag.append(avviso(`${senza} presidi non hanno scadenze calcolate: manca la data di messa in `
      + 'servizio o di costruzione da cui derivarle. Compilandola in scheda entrano nello scadenzario.'));
  }

  frag.append(el('div', { class: 'mini', style: 'margin:6px 0 8px', testo: `${lista.length} scadenze` }));
  if (!lista.length) { frag.append(vuoto('📅', 'Nessuna scadenza con questi filtri')); return frag; }

  frag.append(el('ul', { class: 'elenco' }, lista.slice(0, limiteElenco).map((s) => {
    const a = S.indici.assets.get(s.asset_id);
    const cat = a ? S.categoriaDi(a) : null;
    const tc = S.indici.tipiControllo.get(s.tipo_controllo_codice);
    const sem = S.semaforo(s.data_scadenza);
    const frase = frasScadenza(s.data_scadenza);
    return el('li', {}, [
      el('button', {
        class: 'voce', type: 'button',
        onclick: () => (a ? schedaPresidio(a.id) : toast('Presidio non nel pacchetto', 'toast-ko')),
      }, [
        el('span', { class: `barra-stato ${sem === 'SCADUTO' ? 'ko' : sem === 'IN_SCADENZA' ? 'attenzione' : 'ok'}` }),
        el('span', { class: 'voce-ico', testo: (cat && cat.icona) || '📅' }),
        el('span', { class: 'voce-corpo' }, [
          // Il titolo è il DISPOSITIVO, non il controllo.
          //
          // In elenco si cerca un oggetto — «l'estintore ACCI-EST-12» — e la
          // riga diceva «Controllo periodico semestrale» quaranta volte di
          // fila, tutte uguali, con l'unica cosa che le distingueva relegata in
          // fondo. Il controllo resta, un rigo sotto: è la seconda domanda.
          el('div', { class: 'voce-titolo' }, [
            a && a.identificativo
              ? el('span', { class: 'mono', style: 'font-weight:700', testo: `${a.identificativo} ` })
              : null,
            el('span', { testo: (cat && cat.descrizione) || (a && a.categoria_codice) || 'Presidio' }),
          ]),
          el('div', { class: 'voce-sotto', testo: a ? S.ubicazione(a) : '—' }),
          el('div', { class: 'voce-sotto', testo: (tc && tc.descrizione) || s.tipo_controllo_codice }),
          el('div', { class: 'voce-tag' }, [
            tag(frase.testo, frase.classe),
            tc && tc.norma ? tag(tc.norma, 'tag-blu') : null,
          ]),
        ]),
      ]),
    ]);
  })));

  if (lista.length > limiteElenco) {
    frag.append(el('button', {
      class: 'btn btn-blocco', type: 'button',
      testo: `Mostra altre ${Math.min(60, lista.length - limiteElenco)}`,
      onclick: () => { limiteElenco += 60; disegna(); },
    }));
  }
  return frag;
}

// --------------------------------------------------------------------------- //
// Vista: luoghi (anagrafica delle ubicazioni)
// --------------------------------------------------------------------------- //
let schedaLuoghi = 'albero';   // albero | sistemare
let ricercaLuoghi = '';
// Quali rami sono aperti. Vive fuori dalla funzione di disegno perché ogni
// modifica ridisegna la vista: tenendolo dentro, salvare una rinomina
// richiuderebbe l'albero e l'operatore ricomincerebbe da capo ogni volta.
const ramiAperti = new Set();

function vistaLuoghi() {
  const st = S.get();
  const frag = document.createDocumentFragment();
  frag.append(el('h1', { testo: 'Ubicazioni' }));

  const simili = S.ubicazioniSimili();
  frag.append(sottoSchede(schedaLuoghi, [
    { chiave: 'albero', etichetta: 'Albero' },
    { chiave: 'sistemare', etichetta: 'Da sistemare', n: simili.length },
  ], (k) => { schedaLuoghi = k; }));

  if (schedaLuoghi === 'sistemare') {
    frag.append(pannelloDoppioni(simili));
    return frag;
  }

  const azioni = {
    onCrea: (tipoFiglio, padre) => formUbicazione(tipoFiglio, null, padre.id),
    onRinomina: (nodo) => formUbicazione(nodo.tipo, nodo.id),
    onApri: (nodo) => {
      // Dall'anagrafica al lavoro: aprire i presidi di quel luogo è la domanda
      // che segue sempre a «che cosa c'è qui dentro».
      if (nodo.tipo === 'impianto') dove = { impiantoId: nodo.id, edificioId: '', localeId: '' };
      else if (nodo.tipo === 'edificio') {
        dove = { impiantoId: nodo.riga.impianto_id, edificioId: nodo.id, localeId: '' };
      } else {
        const edi = S.indici.edifici.get(nodo.riga.edificio_id) || {};
        dove = { impiantoId: edi.impianto_id || '', edificioId: nodo.riga.edificio_id, localeId: nodo.id };
      }
      filtri = { ...filtri, testo: '' };
      vaiA('presidi');
    },
  };

  frag.append(el('button', {
    class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-bottom:10px',
    testo: '+ Nuovo impianto', onclick: () => formUbicazione('impianto'),
  }));

  frag.append(campoRicerca(ricercaLuoghi, 'Cerca un impianto, un edificio, un locale…',
    (v) => { ricercaLuoghi = v; }));

  let radici = S.alberoUbicazioni();
  const q = ricercaLuoghi.trim().toLocaleLowerCase();
  if (q) {
    // La ricerca tiene un ramo se il nome corrisponde A QUALUNQUE livello, e
    // mostra la strada per arrivarci: trovare un locale e non vedere sotto quale
    // impianto stia non serve a niente.
    const corrisponde = (n) => String(n.nome || '').toLocaleLowerCase().includes(q);
    radici = radici.map((imp) => {
      if (corrisponde(imp)) return imp;
      const figli = imp.figli.map((edi) => {
        if (corrisponde(edi)) return edi;
        const locali = edi.figli.filter(corrisponde);
        return locali.length ? { ...edi, figli: locali } : null;
      }).filter(Boolean);
      return figli.length ? { ...imp, figli } : null;
    }).filter(Boolean);
    // Con una ricerca in corso l'albero si apre: cercare e poi dover espandere a
    // mano quello che si è appena trovato è il modo per non usare più la ricerca.
    for (const imp of radici) {
      ramiAperti.add(`impianto:${imp.id}`);
      for (const edi of imp.figli) ramiAperti.add(`edificio:${edi.id}`);
    }
    frag.append(el('div', { class: 'mini', style: 'margin-bottom:6px',
      testo: `${radici.length} impianti contengono «${ricercaLuoghi.trim()}»` }));
  }

  frag.append(vistaAlberoLuoghi(radici, azioni, ramiAperti));

  if (simili.length) {
    frag.append(avviso(`${simili.length} ubicazioni risultano scritte in due modi diversi. `
      + 'Guardale nella scheda «Da sistemare» prima di crearne altre.', 'avviso-ambra'));
  }
  frag.append(el('div', { class: 'mini', style: 'margin-top:12px',
    testo: `Creato in questo giro: ${(st.giornale || []).filter((e) => ['impianto', 'edificio', 'locale'].includes(e.entita)).length} modifiche all'anagrafica dei luoghi.` }));
  return frag;
}

/**
 * Le ubicazioni scritte in due modi.
 *
 * Non offre di unirle, e non è una mancanza. Unire significa spostare i presidi
 * da una riga all'altra e cancellarne una — il vincolo di unicità impedisce che
 * due righe con lo stesso nome coesistano sotto lo stesso padre, quindi non è
 * una rinomina, è una migrazione. Va fatta in ufficio, dove c'è un backup del
 * database e una persona che risponde, non da un telefono dentro un capannone.
 *
 * Quello che serve in campo è VEDERLE: chi sa che «Shelter» esiste già non crea
 * «SHELTER», ed è così che il problema smette di crescere.
 */
function pannelloDoppioni(simili) {
  const frag = document.createDocumentFragment();
  if (!simili.length) {
    frag.append(vuoto('✓', 'Nessuna ubicazione scritta in due modi',
      'Ogni luogo compare con una grafia sola.'));
    return frag;
  }
  const presidi = simili.reduce((n, g) => n + g.varianti.reduce((m, v) => m + v.presidi, 0), 0);
  frag.append(avviso(
    `${simili.length} luoghi compaiono con due grafie diverse, per ${presidi} presidi in totale. `
    + 'Sono lo stesso posto scritto da due fogli sorgenti diversi: il censimento usa una '
    + "grafia, l'archivio delle porte un'altra, e l'identificativo nasce dalla stringa scritta. "
    + 'Qui si vedono; si uniscono in ufficio, perché unire vuol dire spostare presidi da una '
    + 'riga all\'altra e cancellarne una.', 'avviso-ambra'));

  frag.append(el('ul', { class: 'elenco' }, simili.map((g) => el('li', {}, [
    el('div', { class: 'voce', style: 'cursor:default' }, [
      el('span', { class: 'barra-stato attenzione' }),
      el('span', { class: 'voce-corpo' }, [
        el('div', { class: 'voce-titolo', testo: g.nome }),
        el('div', { class: 'voce-sotto', testo: `${g.tipo} · sotto ${g.padre}` }),
        el('div', { class: 'voce-tag' }, g.varianti.map((v) => tag(
          `«${v.denominazione}» — ${v.presidi} presidi`, 'tag-grigio'))),
      ]),
    ]),
  ]))));
  return frag;
}

// --------------------------------------------------------------------------- //
// Vista: piani di verifica
// --------------------------------------------------------------------------- //
let schedaPiani = 'applica';        // applica | catalogo
let selezionePiani = new Set();     // id dei presidi spuntati
let filtriPiani = { testo: '', categorie: [] };

function vistaPiani() {
  const frag = document.createDocumentFragment();
  frag.append(el('h1', { testo: 'Piani di verifica' }));
  frag.append(sottoSchede(schedaPiani, [
    { chiave: 'applica', etichetta: 'Applica ai presidi' },
    { chiave: 'catalogo', etichetta: 'Catalogo', n: (S.indici.piani || []).length },
  ], (k) => { schedaPiani = k; }));

  if (schedaPiani === 'catalogo') { frag.append(catalogoPiani()); return frag; }
  frag.append(selezionePresidiPerPiano());
  return frag;
}

/**
 * Scegli dei presidi, poi applica loro un piano.
 *
 * Perché serve, visto che i piani si applicano da soli
 * ----------------------------------------------------
 * Perché non sempre ci riescono. Un piano vale per una tipologia e per le
 * condizioni che dichiara — «polvere immessa sul mercato dal 25/07/2024», per
 * dire — e la realtà ha casi che le condizioni non prevedono: dodici estintori
 * riconvertiti, un lotto con una prescrizione particolare, un impianto con un
 * accordo diverso. Finora l'unico modo era aprire dodici schede e fare dodici
 * deroghe.
 *
 * Che cosa scrive: una **deroga INCLUDI per presidio**, non un'assegnazione. Il
 * motivo è nella funzione `applicaPianoAPresidi`, ed è che una tabella di
 * assegnazioni diventerebbe falsa appena qualcuno cambia l'estinguente di un
 * estintore. Ogni deroga porta il suo motivo e il suo autore, si vede nella
 * scheda del presidio come «in deroga», si toglie da lì, e rientra in ufficio
 * con il pacchetto.
 */
function selezionePresidiPerPiano() {
  const frag = document.createDocumentFragment();
  const trovati = S.cerca({ ...filtriPiani, impiantoId: '', edificioId: '', localeId: '' });

  frag.append(campoRicerca(filtriPiani.testo, 'Cerca fra i presidi…',
    (v) => { filtriPiani = { ...filtriPiani, testo: v }; }));

  const categorie = [...S.indici.categorie.values()];
  frag.append(selettoreCategoria(categorie.map((c) => ({
    valore: c.codice, etichetta: c.descrizione || c.codice, icona: c.icona,
    n: S.cerca({ ...filtriPiani, categorie: [c.codice] }).length,
  })).filter((x) => x.n > 0)));

  frag.append(el('div', { class: 'riga', style: 'gap:8px;margin:8px 0' }, [
    el('span', { class: 'mini', testo: `${trovati.length} presidi · ${selezionePiani.size} selezionati` }),
    el('button', {
      class: 'btn btn-piccolo', type: 'button',
      testo: trovati.every((a) => selezionePiani.has(a.id)) && trovati.length
        ? 'Deseleziona tutti' : `Seleziona tutti (${trovati.length})`,
      onclick: () => {
        const tutti = trovati.every((a) => selezionePiani.has(a.id)) && trovati.length;
        for (const a of trovati) {
          if (tutti) selezionePiani.delete(a.id); else selezionePiani.add(a.id);
        }
        disegna();
      },
    }),
    selezionePiani.size
      ? el('button', {
        class: 'btn btn-piccolo', type: 'button', testo: 'Azzera',
        onclick: () => { selezionePiani = new Set(); disegna(); },
      })
      : null,
  ].filter(Boolean)));

  if (!trovati.length) {
    frag.append(vuoto('🔍', 'Nessun presidio con questi filtri'));
    return frag;
  }

  // Righe con la casella. Tutta la riga seleziona: su un telefono, centrare il
  // pollice su una casella da 20px mentre si tiene una scala è il modo per
  // selezionare il presidio sbagliato.
  frag.append(el('ul', { class: 'elenco' }, trovati.slice(0, limiteElenco).map((a) => {
    const cat = S.categoriaDi(a);
    const scelto = selezionePiani.has(a.id);
    const c = el('input', { type: 'checkbox', checked: scelto, tabindex: '-1' });
    return el('li', {}, [
      el('button', {
        class: `voce voce-selezionabile ${scelto ? 'scelta' : ''}`, type: 'button',
        'aria-pressed': scelto ? 'true' : 'false',
        onclick: () => {
          if (selezionePiani.has(a.id)) selezionePiani.delete(a.id);
          else selezionePiani.add(a.id);
          disegna();
        },
      }, [
        el('span', { class: 'voce-casella' }, [c]),
        el('span', { class: 'voce-ico', testo: (cat && cat.icona) || '🧯' }),
        el('span', { class: 'voce-corpo' }, [
          el('div', { class: 'voce-titolo' }, [
            a.identificativo
              ? el('span', { class: 'mono', style: 'font-weight:700', testo: `${a.identificativo} ` })
              : null,
            el('span', { testo: (cat && cat.descrizione) || a.categoria_codice }),
          ]),
          el('div', { class: 'voce-sotto', testo: S.ubicazione(a) }),
          el('div', { class: 'voce-sotto mini',
            testo: `${S.controlliApplicabili(a).filter((t) => t.piano_id).length} piani già applicati` }),
        ]),
      ]),
    ]);
  })));

  if (trovati.length > limiteElenco) {
    frag.append(el('button', {
      class: 'btn btn-blocco', type: 'button',
      testo: `Mostra altri ${Math.min(60, trovati.length - limiteElenco)}`,
      onclick: () => { limiteElenco += 60; disegna(); },
    }));
  }

  // La barra dell'azione resta in fondo alla vista e non galleggia: una barra
  // fissa su un telefono copre le ultime righe dell'elenco, che sono quelle che
  // si stanno guardando quando si finisce di selezionare.
  if (selezionePiani.size) {
    frag.append(el('div', { class: 'barra-azione' }, [
      el('button', {
        class: 'btn btn-primario btn-blocco', type: 'button',
        testo: `Applica un piano ai ${selezionePiani.size} selezionati…`,
        onclick: () => formApplicaPiano([...selezionePiani]),
      }),
    ]));
  }
  return frag;
}

/**
 * Il dialogo che applica un piano ai presidi scelti.
 *
 * Mostra PRIMA che cosa succederà: quanti lo riceveranno, quanti sono di un'altra
 * tipologia e resteranno fuori, quanti ce l'hanno già per conto loro. Un'azione
 * di massa che dice il risultato solo dopo averlo prodotto è un'azione che si
 * smette di usare.
 */
function formApplicaPiano(assetIds) {
  const assets = assetIds.map((id) => S.indici.assets.get(id)).filter(Boolean);
  const tipi = new Set(assets.map((a) => S.tipoAssetDi(a)));

  const piani = (S.indici.piani || [])
    .filter((p) => Number(p.attivo ?? 1) === 1)
    .slice()
    .sort((x, y) => String(x.denominazione).localeCompare(String(y.denominazione)));

  // I piani della tipologia selezionata per primi, gli altri dopo e dichiarati
  // non applicabili: nasconderli renderebbe incomprensibile perché il piano che
  // si cerca non c'è.
  const compatibili = piani.filter((p) => tipi.has(p.tipo_asset_codice));
  const altri = piani.filter((p) => !tipi.has(p.tipo_asset_codice));

  const fPiano = select([
    ...compatibili.map((p) => ({
      valore: p.id,
      testo: `${p.denominazione} — ${PV.etichettaFrequenza(p.frequenza_valore, p.frequenza_unita)}`,
    })),
    ...(altri.length
      ? [{ valore: '', testo: `— ${altri.length} piani di altre tipologie, non applicabili —` }]
      : []),
  ], compatibili.length ? compatibili[0].id : '');

  const fMotivo = el('textarea', { rows: '2',
    placeholder: 'Es. estintori riconvertiti a CO2 dopo la sostituzione del 2026' });
  const anteprima = el('div', { class: 'mini', style: 'margin:8px 0' });

  const aggiorna = () => {
    const piano = piani.find((p) => p.id === fPiano.value);
    svuotaNodo(anteprima);
    if (!piano) {
      anteprima.append(avviso('Scegli un piano della tipologia dei presidi selezionati.',
        'avviso-ambra'));
      return;
    }
    const fuori = assets.filter((a) => S.tipoAssetDi(a) !== piano.tipo_asset_codice);
    anteprima.append(el('div', {}, [
      el('div', { testo: `${assets.length - fuori.length} presidi su ${assets.length} riceveranno «${piano.denominazione}».` }),
      fuori.length
        ? el('div', { class: 'tag tag-ambra',
          testo: `${fuori.length} sono di un'altra tipologia e restano fuori` })
        : null,
    ].filter(Boolean)));
  };
  fPiano.addEventListener('change', aggiorna);
  aggiorna();

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${assets.length} presidi selezionati, `
      + `${tipi.size} tipologi${tipi.size === 1 ? 'a' : 'e'}.` }),
    campo('Piano di verifica', fPiano),
    anteprima,
    campo('Perché', fMotivo,
      "Obbligatorio: resta scritto sulla deroga e rientra in ufficio. Chi la "
      + 'legge fra sei mesi deve capire perché è stata presa.'),
    avviso('Il piano viene applicato come DEROGA su ciascun presidio: si vede '
      + 'nella sua scheda, si toglie da lì, e le scadenze si calcolano al rientro '
      + 'in ufficio.', 'avviso-blu'),
    el('div', { class: 'riga riga-fine', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Applica',
        onclick: async () => {
          const esito = await muta(() => S.applicaPianoAPresidi(assetIds, {
            piano_id: fPiano.value, motivo: fMotivo.value,
          }), null);
          if (!esito) return;
          chiudiSheet();
          selezionePiani = new Set();
          const parti = [`${esito.applicati.length} presidi aggiornati`];
          if (esito.gia.length) parti.push(`${esito.gia.length} lo avevano già`);
          if (esito.esclusi.length) parti.push(`${esito.esclusi.length} esclusi per tipologia`);
          toast(parti.join(' · '), esito.applicati.length ? 'toast-ok' : 'toast-warn', 8000);
          disegna();
        },
      }),
    ]),
  ]);
  apriSheet('Applica un piano', corpo);
}

/**
 * Il catalogo dei piani: che cosa c'è, e come si aggiunge o si corregge.
 *
 * Raggruppato per TIPOLOGIA e non alfabetico: la domanda che ci si pone è «che
 * cosa prevede la norma per un estintore», non «come si chiama quel piano».
 */
function catalogoPiani() {
  const frag = document.createDocumentFragment();
  const piani = (S.indici.piani || []).slice();

  frag.append(el('button', {
    class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-bottom:10px',
    testo: '+ Nuovo piano di verifica', onclick: () => formPiano(),
  }));

  if (!piani.length) {
    frag.append(vuoto('📋', 'Nessun piano di verifica', 'Il pacchetto non ne contiene.'));
    return frag;
  }

  const perTipo = new Map();
  for (const pn of piani) {
    const k = pn.tipo_asset_codice || '(senza tipologia)';
    if (!perTipo.has(k)) perTipo.set(k, []);
    perTipo.get(k).push(pn);
  }

  const quantiPresidi = (tipo) => (S.get().perEntita[E.ASSET] || [])
    .filter((a) => !a.eliminato_il && S.tipoAssetDi(a) === tipo).length;

  for (const [tipo, lista] of [...perTipo].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ta = S.indici.tipiAsset.get(tipo);
    frag.append(el('h2', { style: 'margin:14px 0 4px;font-size:1rem',
      testo: (ta && ta.descrizione) || tipo }));
    frag.append(el('div', { class: 'mini', style: 'margin-bottom:6px',
      testo: `${lista.length} piani · ${quantiPresidi(tipo)} presidi di questa tipologia` }));

    frag.append(el('ul', { class: 'elenco' }, lista
      .sort((x, y) => String(x.denominazione).localeCompare(String(y.denominazione)))
      .map((pn) => {
        const azioni = S.indici.azioniPerPiano.get(pn.id) || [];
        const cond = S.indici.condizioniPerPiano.get(pn.id) || [];
        const spento = Number(pn.attivo ?? 1) === 0;
        return el('li', {}, [
          el('button', {
            class: 'voce', type: 'button', onclick: () => formPiano(pn.id),
          }, [
            el('span', { class: `barra-stato ${spento ? '' : 'ok'}` }),
            el('span', { class: 'voce-ico', testo: '📋' }),
            el('span', { class: 'voce-corpo' }, [
              el('div', { class: 'voce-titolo', testo: pn.denominazione || pn.id }),
              el('div', { class: 'voce-sotto',
                testo: [
                  PV.etichettaFrequenza(pn.frequenza_valore, pn.frequenza_unita),
                  `${azioni.length} verifiche`,
                  pn.norma || null,
                ].filter(Boolean).join(' · ') }),
              el('div', { class: 'voce-tag' }, [
                spento ? tag('disattivato', 'tag-rosso') : null,
                cond.length ? tag(`${cond.length} condizioni`, 'tag-grigio') : null,
                Number(pn.verificata || 0) === 0 ? tag('periodicità da verificare', 'tag-grigio') : null,
                /creato in campo/.test(pn.fonte || '') ? tag('creato in campo', 'tag-blu') : null,
              ].filter(Boolean)),
            ]),
            el('span', { class: 'voce-freccia', testo: '\u203a' }),
          ]),
        ]);
      })));
  }
  return frag;
}

/**
 * Creare o correggere un piano.
 *
 * Le CONDIZIONI non si toccano da qui, e la scheda lo dice invece di
 * nasconderlo. Una condizione è la logica che decide a quali presidi il piano si
 * applica («polvere immessa sul mercato dal 25/07/2024»): sbagliarla da un
 * telefono sposta in silenzio decine di scadenze, e l'errore si presenta come un
 * presidio che risulta a posto. Dal campo il piano si applica ai presidi scelti
 * a mano — un gesto visibile, con un motivo scritto, e reversibile.
 */
function formPiano(pianoId) {
  const esistente = pianoId ? (S.indici.pianiPerId || new Map()).get(pianoId) : null;
  const azioniAttuali = esistente ? (S.indici.azioniPerPiano.get(pianoId) || []) : [];
  const condizioni = esistente ? (S.indici.condizioniPerPiano.get(pianoId) || []) : [];

  const fNome = el('input', { type: 'text', value: (esistente && esistente.denominazione) || '' });
  const fNorma = el('input', { type: 'text', value: (esistente && esistente.norma) || '',
    placeholder: 'Es. UNI 9994-1:2024, oppure «accordo con il committente»' });
  const fValore = el('input', { type: 'number', min: '1', inputmode: 'numeric',
    value: String((esistente && esistente.frequenza_valore) || '') });
  const fUnita = scelte(
    [{ valore: 'GIORNI', testo: 'giorni' }, { valore: 'SETTIMANE', testo: 'settimane' },
      { valore: 'MESI', testo: 'mesi' }, { valore: 'ANNI', testo: 'anni' }],
    (esistente && esistente.frequenza_unita) || 'MESI', { obbligatorio: true });

  const tipiAsset = [...S.indici.tipiAsset.values()];
  const fTipo = select(tipiAsset.map((t) => ({ valore: t.codice, testo: t.descrizione || t.codice })),
    (esistente && esistente.tipo_asset_codice) || (tipiAsset[0] || {}).codice);
  const fControllo = select([...S.indici.tipiControllo.values()]
    .map((t) => ({ valore: t.codice, testo: t.descrizione || t.codice })),
  (esistente && esistente.tipo_controllo_codice) || '');
  const fNote = el('textarea', { rows: '2', value: (esistente && esistente.note) || '' });
  const fAttivo = scelte([{ valore: '1', testo: 'attivo' }, { valore: '0', testo: 'disattivato' }],
    String(Number((esistente && esistente.attivo) ?? 1)), { obbligatorio: true });
  // A chi si applica. Un piano nuovo nasce «solo su richiesta»: assegnarlo per
  // sbaglio a tutta una tipologia genera scadenze vere su centinaia di presidi,
  // mentre dimenticarsi di estenderlo si vede subito, sul presidio che si ha
  // davanti.
  const fAmbito = scelte([
    { valore: 'SU_RICHIESTA', testo: 'solo ai presidi che scelgo' },
    { valore: 'TIPOLOGIA', testo: 'a tutta la tipologia' },
  ], String((esistente && esistente.ambito) || 'SU_RICHIESTA').toUpperCase(),
  { obbligatorio: true, onCambia: () => aggiornaPortata() });

  // Le verifiche, una per riga. Un elenco di testi liberi e non una tabella:
  // in campo si scrive quello che si deve fare, non si compila uno schema.
  const fAzioni = el('textarea', { rows: '6',
    value: azioniAttuali.map((a) => a.testo).join('\n'),
    placeholder: 'Una verifica per riga.\nEs. Controllare la pressione sul manometro\nEs. Verificare il cartellino di manutenzione' });

  const avvisoPortata = el('div', { class: 'mini', style: 'margin:6px 0' });
  const aggiornaPortata = () => {
    const n = (S.get().perEntita[E.ASSET] || [])
      .filter((a) => !a.eliminato_il && S.tipoAssetDi(a) === fTipo.value).length;
    avvisoPortata.textContent = fAmbito.valore === 'TIPOLOGIA'
      ? `Si applicherà a TUTTI i ${n} presidi di questa tipologia, subito.`
      : `Non si applicherà a nessuno finché non lo dai tu: dalla scheda di un `
        + `presidio, o selezionandone diversi nella scheda «Piani». La tipologia `
        + `(${n} presidi) serve solo a dire con quali presidi è compatibile.`;
  };
  fTipo.addEventListener('change', aggiornaPortata);
  aggiornaPortata();

  const corpo = el('div', {}, [
    campo('Nome del piano', fNome, 'Come lo leggerà l\'operatore: «Revisione — CO2», non «REV_CO2».'),
    campo('Tipologia di presidio', fTipo),
    campo('A chi si applica', fAmbito),
    avvisoPortata,
    campo('Tipo di controllo', fControllo,
      'A quale scadenza risponde. Due piani dello stesso tipo di controllo si '
      + 'escludono a vicenda: vince quello più specifico.'),
    el('div', { class: 'campi campi-2' }, [
      campo('Ogni', fValore),
      campo('Unità', fUnita),
    ]),
    campo('Norma o riferimento', fNorma),
    campo('Che cosa verificare', fAzioni, 'Una verifica per riga. Sono le voci che '
      + "l'operatore spunta, e senza le quali «conforme» non si può premere."),
    esistente ? campo('Stato', fAttivo) : null,
    campo('Note', fNote),

    condizioni.length
      ? avviso(`Questo piano ha ${condizioni.length} condizioni che decidono a quali `
        + 'presidi si applica. Si vedono e si cambiano in ufficio: qui non si toccano, '
        + 'perché sbagliarne una sposta scadenze senza che si veda.', 'avviso-blu')
      : null,

    el('div', { class: 'riga riga-fine', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: esistente ? 'Salva' : 'Crea il piano',
        onclick: async () => {
          const azioni = fAzioni.value.split('\n').map((x) => x.trim()).filter(Boolean);
          const dati = {
            denominazione: fNome.value,
            tipo_asset_codice: fTipo.value,
            tipo_controllo_codice: fControllo.value,
            frequenza_valore: fValore.value,
            frequenza_unita: fUnita.valore,
            norma: fNorma.value,
            note: fNote.value,
            azioni,
          };
          const esito = await muta(() => (esistente
            ? S.modificaPiano(pianoId, { ...dati, attivo: fAttivo.valore, ambito: fAmbito.valore })
            : S.creaPiano({ ...dati, ambito: fAmbito.valore })), null);
          if (esito) {
            chiudiSheet();
            toast(esistente ? 'Piano aggiornato.' : `Piano «${esito.denominazione}» creato.`,
              'toast-ok', 6000);
            disegna();
          }
        },
      }),
    ]),
  ].filter(Boolean));

  apriSheet(esistente ? 'Modifica il piano' : 'Nuovo piano di verifica', corpo);
}

// --------------------------------------------------------------------------- //
// Vista: dati
// --------------------------------------------------------------------------- //
function vistaDati() {
  const st = S.get();
  const r = st.caricato ? S.riepilogo() : null;
  const p = store.statoPersistenza();
  const frag = document.createDocumentFragment();

  frag.append(el('h1', { testo: 'Dati del giro' }));

  const input = el('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none' });
  input.addEventListener('change', () => {
    if (input.files && input.files[0]) caricaFile(input.files[0]);
  });
  const zona = el('div', { class: 'dropzona' }, [
    el('div', { style: 'font-size:2rem' }, ['📥']),
    el('div', { testo: st.caricato ? 'Carica un altro pacchetto' : 'Carica il pacchetto .zip di Scudo' }),
    el('div', { class: 'mini', testo: 'Tocca qui oppure trascina il file' }),
  ]);
  zona.addEventListener('click', () => input.click());
  for (const ev of ['dragenter', 'dragover']) {
    zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sopra'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('sopra'); });
  }
  zona.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) caricaFile(f);
  });

  frag.append(el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: '1. Carica il pacchetto' }),
    zona, input,
  ]));

  if (!st.caricato) {
    frag.append(avviso('Il pacchetto .zip si esporta da Scudo: sezione Scudo → Campo → '
      + '"Esporta pacchetto".', 'avviso-blu'));
    frag.append(diagnostica(p));
    return frag;
  }

  frag.append(el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: '2. Chi sta lavorando' }),
    el('dl', { class: 'dati' }, [
      el('dt', { testo: 'Operatore' }), el('dd', { testo: testo(st.sessione.operatore, 'da indicare') }),
      el('dt', { testo: 'Dispositivo' }), el('dd', { class: 'mono', testo: st.sessione.device_id }),
      el('dt', { testo: 'Impianti' }), el('dd', { testo: testo(st.manifest.impianti) }),
      el('dt', { testo: 'Pacchetto del' }), el('dd', { testo: dataOraIt(st.manifest.generato_il) }),
      el('dt', { testo: 'Caricato il' }), el('dd', { testo: dataOraIt(st.sessione.caricato_il) }),
      el('dt', { testo: 'Sessione' }), el('dd', { class: 'mono', testo: testo(st.sessione.sessione_id, 'nessuna') }),
    ]),
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
      testo: 'Cambia operatore', onclick: apriSessione,
    }),
  ]));

  const daEsportare = r.modifiche_non_esportate;
  frag.append(el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: '3. Consegna il rilievo' }),
    daEsportare > 0
      ? avviso(`${daEsportare} modifiche non ancora esportate.`)
      : avviso(st.esportato.il
        ? `Ultimo pacchetto esportato il ${dataOraIt(st.esportato.il)}. Nessuna modifica in sospeso.`
        : 'Nessuna modifica registrata finora.', 'avviso-verde'),
    el('button', {
      class: 'btn btn-primario btn-blocco', type: 'button',
      testo: '📤 Esporta pacchetto per Scudo', onclick: esportaPacchetto,
    }),
    el('div', { class: 'mini', style: 'margin-top:8px' }, [
      'Il file .zip prodotto va importato in Scudo (Scudo → Campo → Reimporta). '
      + 'Scudo lo verifica e sostituisce integralmente i dati.',
    ]),
  ]));

  frag.append(diagnostica(p));

  frag.append(el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: 'Ricomincia da capo' }),
    el('div', { class: 'mini', testo: 'Cancella il rilievo salvato su questo dispositivo. Da usare solo dopo aver esportato e importato in Scudo.' }),
    el('button', {
      class: 'btn btn-blocco', type: 'button', style: 'margin-top:10px',
      testo: '🗑️ Cancella il rilievo dal dispositivo',
      onclick: async () => {
        const messaggio = daEsportare > 0
          ? `Ci sono ${daEsportare} modifiche MAI ESPORTATE. Cancellandole non sono più recuperabili.`
          : 'Il rilievo salvato su questo dispositivo verrà cancellato.';
        if (!await conferma({ titolo: 'Cancellare il rilievo?', messaggio, ok: 'Cancella tutto' })) return;
        await store.svuota();
        S.azzera();
        toast('Rilievo cancellato dal dispositivo.', 'toast-warn');
        vaiA('dati');
      },
    }),
  ]));

  return frag;
}

function diagnostica(p) {
  const st = S.get();
  // Il valore arriva dopo: `caches.keys()` è asincrona, e bloccare il disegno
  // della scheda per un dato di servizio sarebbe il baratto sbagliato.
  versioneInEsecuzione().then((v) => {
    const n = document.getElementById('revisione-attiva');
    if (n) n.textContent = v || 'non in cache (prima apertura, o cache svuotata)';
  });
  return el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: 'Come sono conservati i dati' }),
    p.modalita === 'idb'
      ? avviso('Ogni modifica viene scritta subito nel database del browser. Puoi cambiare schermata, '
        + 'chiudere la scheda o spegnere lo schermo: al rientro ritrovi tutto.', 'avviso-verde')
      : avviso('Il database del browser non è disponibile su questo dispositivo (spesso succede in '
        + 'navigazione privata). Si sta usando la copia di emergenza, che è più fragile: esporta il '
        + `pacchetto spesso.${p.errore ? ` Dettaglio: ${p.errore}` : ''}`, 'avviso-rosso'),
    st.caricato
      ? el('dl', { class: 'dati', style: 'margin-top:10px' }, [
        el('dt', { testo: 'Eventi nel giornale' }), el('dd', { testo: String(st.giornale.length) }),
        el('dt', { testo: 'Esportati' }), el('dd', { testo: String(st.esportato.seq) }),
        el('dt', { testo: 'Codice del pacchetto' }),
        el('dd', { class: 'mono', testo: (st.sessione.checksum_origine || '—').slice(0, 24) }),
        // Quale revisione dell'app sta girando davvero.
        //
        // La funzione che lo legge esisteva già e non la chiamava nessuno. È il
        // primo dato che serve quando qualcuno segnala un problema: l'app si
        // aggiorna solo quando l'operatore accetta, quindi «ho l'ultima
        // versione» è una supposizione finché non la si legge dalla cache.
        el('dt', { testo: 'Revisione in esecuzione' }),
        el('dd', { class: 'mono', id: 'revisione-attiva', testo: '…' }),
      ])
      : null,
    st.giornale.length
      ? el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
        testo: 'Mostra il giornale delle modifiche', onclick: mostraGiornale,
      })
      : null,

    // Uscire dalla porta.
    //
    // `dimentica()` era scritta in `accesso.js` e non la chiamava nessuno: chi
    // presta il telefono a un collega, o lo perde, non aveva modo di togliere
    // l'identità salvata. La conferma nomina la conseguenza vera — il lavoro non
    // esportato resta sul dispositivo, ma la prossima persona lo troverà
    // attribuito a chi c'era prima.
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
      testo: '🚪 Esci: dimentica questo operatore',
      onclick: async () => {
        const ok = await conferma({
          titolo: 'Uscire?',
          messaggio: 'Al prossimo avvio l\'app richiederà la password e il nome.',
          dettagli: [
            S.lavoroNonEsportato()
              ? 'Attenzione: hai lavoro non ancora esportato. Resta salvato sul '
                + 'dispositivo, ma chi userà l\'app dopo di te lo troverà attribuito a te.'
              : 'Non hai lavoro in sospeso da esportare.',
          ],
          ok: 'Esci',
          variante: 'btn-ko',
        });
        if (!ok) return;
        dimentica();
        toast('Operatore dimenticato. Chiudi e riapri l\'app.', 'toast-ok', 9000);
      },
    }),
  ]);
}

function mostraGiornale() {
  const g = [...S.get().giornale].reverse();
  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${g.length} eventi, dal più recente.` }),
    el('div', { class: 'scroll-x' }, [
      el('table', { class: 'tabellina' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { testo: 'Quando' }), el('th', { testo: 'Cosa' }),
          el('th', { testo: 'Operazione' }), el('th', { testo: 'Operatore' }),
        ])]),
        el('tbody', {}, g.slice(0, 300).map((ev) => el('tr', {}, [
          el('td', { testo: dataOraIt(ev.ts_utc) }),
          el('td', { testo: ev.entita }),
          el('td', { testo: ev.operazione }),
          el('td', { testo: testo(ev.operatore_nome) }),
        ]))),
      ]),
    ]),
  ]);
  apriSheet('Giornale delle modifiche', corpo);
}

function apriSessione() {
  const st = S.get();
  const fOp = el('input', { type: 'text', value: st.sessione.operatore || '', placeholder: 'Nome e cognome' });
  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: 'Il nome finisce su ogni controllo e ogni anomalia registrata da questo dispositivo.' }),
    campo('Operatore', fOp),
    el('dl', { class: 'dati' }, [
      el('dt', { testo: 'Dispositivo' }),
      el('dd', { class: 'mono', testo: st.sessione.device_id || S.deviceId() }),
    ]),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          S.impostaSessione({ operatore: fOp.value.trim() });
          await store.salvaDataset(S.serializza());
          chiudiSheet();
          disegna();
        },
      }),
    ]),
  ]);
  apriSheet('Operatore e dispositivo', corpo);
}

// --------------------------------------------------------------------------- //
// Caricamento ed esportazione dei pacchetti
// --------------------------------------------------------------------------- //
async function caricaFile(file) {
  if (S.lavoroNonEsportato()) {
    const ok = await conferma({
      titolo: 'Sovrascrivere il rilievo in corso?',
      messaggio: `Sul dispositivo ci sono ${S.riepilogo().modifiche_non_esportate} modifiche `
        + 'non ancora esportate. Caricando un altro pacchetto vanno perse.',
      dettagli: ['Esporta prima il pacchetto corrente, poi carica quello nuovo.'],
      ok: 'Carica lo stesso',
    });
    if (!ok) return;
  }

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    toast(`Impossibile leggere il file: ${e.message}`, 'toast-ko', 8000);
    return;
  }

  try {
    const letto = await leggiPacchetto(bytes);
    const errori = valida(letto.manifest, letto.dati);
    if (errori.length) {
      apriSheet('Pacchetto non valido', el('div', {}, [
        avviso(`Il pacchetto ha ${errori.length} problemi e non è stato caricato. `
          + 'I dati sul dispositivo non sono stati toccati.', 'avviso-rosso', errori.slice(0, 20)),
        el('button', { class: 'btn btn-blocco', type: 'button', testo: 'Chiudi', onclick: chiudiSheet }),
      ]));
      return;
    }

    S.carica(letto, { nome_file: file.name });
    await store.svuota();
    await store.salvaDataset(S.serializza());
    const r = S.riepilogo();
    if (letto.manifest._modificato) {
      toast("Attenzione: questo pacchetto è stato modificato dopo l'esportazione da Scudo.",
        'toast-warn', 10000);
    }
    toast(`Caricati ${r.righe} presidi su ${r.impianti} impianti.`, 'toast-ok', 5000);
    dove = { impiantoId: '', edificioId: '', localeId: '' };
    filtri = { testo: '', categorie: [], soloNonConformi: false,
      soloConAnomalie: false, soloDaControllare: false };
    if (!S.get().sessione.operatore) apriSessione();
    // Caricato il pacchetto, la navigazione ricomincia: «indietro» non deve
    // riportare alla schermata di un archivio che non c'è più.
    storia.length = 0;
    vaiA('riepilogo', { ricorda: false });
  } catch (e) {
    const dettagli = e instanceof PacchettoNonValido ? e.dettagli : [];
    apriSheet('Pacchetto non caricabile', el('div', {}, [
      avviso(e.message || String(e), 'avviso-rosso', dettagli),
      el('div', { class: 'mini', style: 'margin-top:10px' },
        ['I dati già presenti sul dispositivo non sono stati modificati.']),
      el('button', { class: 'btn btn-blocco', type: 'button', style: 'margin-top:12px', testo: 'Chiudi', onclick: chiudiSheet }),
    ]));
  }
}

async function esportaPacchetto() {
  const st = S.get();
  if (!st.caricato) { toast('Nessun pacchetto caricato.', 'toast-ko'); return; }
  if (!st.sessione.operatore) {
    toast("Indica prima il nome dell'operatore.", 'toast-warn');
    apriSessione();
    return;
  }

  const meta = {
    generato_da: 'Scudo Campo 1.1.0',
    origine: 'campo',
    schema_version: st.manifest.schema_version || '1.0',
    operatore: st.sessione.operatore,
    matricola: st.sessione.matricola || '',
    operatore_ditta: st.sessione.operatore_ditta || '',
    giro_iniziato_il: st.sessione.iniziato_il || '',
    giro_concluso_il: st.sessione.concluso_il || '',
    giro_stato: S.statoGiro(),
    giro_note: st.sessione.note_giro || '',
    giro_tipi_asset: (st.sessione.tipi_asset || []).join('|'),
    device_id: st.sessione.device_id,
    sessione_id: st.sessione.sessione_id || '',
    impianti: st.manifest.impianti || '',
  };

  let contenuto;
  try {
    contenuto = await scriviPacchetto(S.datiDaEsportare(), meta, st.campi);
  } catch (e) {
    toast(`Esportazione fallita: ${e.message}`, 'toast-ko', 8000);
    return;
  }

  // Rilettura immediata di quello che si sta per consegnare. Se il file non è
  // rileggibile è meglio scoprirlo adesso, con l'operatore davanti al telefono,
  // che in ufficio davanti a un import rifiutato.
  let checksum = '';
  try {
    const verifica = await leggiPacchetto(contenuto);
    checksum = verifica.manifest.checksum || '';
    if (verifica.manifest._modificato) {
      toast('Verifica interna fallita: il pacchetto generato non è coerente con sé stesso.',
        'toast-ko', 12000);
      return;
    }
    const errori = valida(verifica.manifest, verifica.dati);
    if (errori.length) {
      apriSheet('Esportazione bloccata', el('div', {}, [
        avviso('Il pacchetto generato non supera la validazione, quindi Scudo lo rifiuterebbe. '
          + 'Correggi i punti elencati e riprova.', 'avviso-rosso', errori.slice(0, 20)),
        el('button', { class: 'btn btn-blocco', type: 'button', testo: 'Chiudi', onclick: chiudiSheet }),
      ]));
      return;
    }
  } catch (e) {
    toast(`Verifica del pacchetto fallita: ${e.message}`, 'toast-ko', 9000);
    return;
  }

  const stamp = S.oggiIso().replace(/-/g, '');
  const opSlug = (st.sessione.operatore || 'operatore').replace(/[^A-Za-z0-9]+/g, '').toUpperCase().slice(0, 10);
  const nome = `SCUDO_RILIEVO_${stamp}_${opSlug}.zip`;

  scaricaFile(nome, contenuto, 'application/zip');
  S.segnaEsportato(checksum);
  await store.salvaDataset(S.serializza());
  disegna();

  apriSheet('Pacchetto esportato', el('div', {}, [
    avviso(`File generato: ${nome}`, 'avviso-verde'),
    el('div', { class: 'mini', style: 'margin-top:8px' }, [
      'Passi successivi: 1) invia o copia il file in ufficio; 2) in Scudo apri Campo → '
      + "Reimporta; 3) controlla l'anteprima e conferma.",
    ]),
    el('div', { class: 'mini mono', style: 'margin-top:8px', testo: `codice ${checksum.slice(0, 32)}…` }),
    avviso("Il rilievo resta su questo dispositivo: cancellalo solo dopo che Scudo ha confermato l'import."),
    el('button', { class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px', testo: 'Ho capito', onclick: chiudiSheet }),
  ]));
}

// --------------------------------------------------------------------------- //
avvia().catch((e) => {
  document.getElementById('vista').append(
    avviso(`Avvio non riuscito: ${e.message || e}`, 'avviso-rosso'),
  );
});
