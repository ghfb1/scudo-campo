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
  PacchettoNonValido, metaDiRientro, codicePacchetto,
} from './pacchetto.js';
import * as store from './store.js';
import * as S from './stato.js';
import * as PV from './piani.js';
import { formCampi, vistaCampi } from './campi.js';
import { apriPorta, dimentica, identita, nomeCompleto } from './accesso.js';
import {
  apriSheet, apriSheetConChiusura, avviso, barreImpilate, campo, chiudiSheet, ciambella, collegaSheet,
  conferma, dataIt, dataOraIt, el, kpi, num, scaricaFile, scelte, sceltaCercabile, select,
  campoNumerico, pallinoDi, sheetAperto, svuotaNodo, tag, tagIdoneita, tagVerifiche, testo,
  toast, vuoto, chiediConferma, campoData,
} from './ui.js';
import * as G from './grafici.js';
import { NOMI_LUOGO, azioniDelNodo, livelliDiPercorso, livelloSopra, noteDelPercorso, riquadroNoteDelPercorso, vistaAlberoLuoghi, vistaDove } from './luoghi.js';
import { caricaConConferma, chiediConfermaPacchetto } from './conferma_pacchetto.js';
import { STATI_ANOMALIA_A_PAROLE, statoAnomaliaAParole, barraGiro, bloccoAnomalie, bottoneSegna, offriControlloDiGruppo,
  sceltaVistaGiro } from './giro_presidi.js';
import { dettaglioTipologia, nomePresidio } from './nome_presidio.js';
import { propostaPer } from './posizioni_proposte.js';
import { blocchiRiepilogo, vistaSenzaScadenze } from './riepilogo_home.js';
import { conPosizione, livelloMappa, nomePresidioMappa, vistaMappa } from './mappa.js';
import { presidioInAlbero, vistaSposta } from './sposta.js';
import { riassuntoAnomalia } from './anomalia_testo.js';
import { foglioFirmatari } from './firmatari.js';
import { applicaFirmatari, datiVerbale, datiVerbaliPerImpianto, firmatariProposti, nomeFileVerbale, pdfVerbali } from './verbale.js';
import { bloccoSpazio } from './spazio.js';
import { posizioneDelContenitore, raccogliSenzaPosizione, vistaSenzaPosizione } from './senza_posizione.js';
import * as ADMIN from './admin.js';
import * as U from './ubicazione.js';
import {
  corpoControlloPiano, corpoRegistrazione, etichettaEsito, frasScadenza,
  sezionePiani, campiAnomalia,
} from './controllo.js';

const VISTE = ['riepilogo', 'presidi', 'scadenze', 'anomalie', 'piani', 'luoghi', 'dati'];
let vistaCorrente = 'riepilogo';
let limiteElenco = 60;
let contaAltreIstanze = () => 0;

// Dove si trova l'operatore dentro l'albero delle ubicazioni.
let dove = { impiantoId: '', edificioId: '', localeId: '' };
let filtri = {
  testo: '', categorie: [], soloNonConformi: false,
  soloConAnomalie: false, soloDaControllare: false, soloControllati: false, soloSospesi: false,
  posizione: '',
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

  // ⛔ Il database non ha risposto e non c'è niente da aprire (25/09/2026). Dal
  // v138 la copia di emergenza vecchia non resta più in giro (vedi
  // `store.salvaCopia`), quindi in questo caso l'app si apre VUOTA — ma il
  // rilievo è ancora nel database, e riaprendo l'app ricompare. La cosa da non
  // fare è caricare un pacchetto: lo si dice prima che ci si pensi.
  if (persistenza.modalita !== 'idb' && !S.get().caricato) {
    toast('Il database del telefono non ha risposto e il rilievo non si è aperto. NON caricare pacchetti: '
      + 'chiudi Scudo Campo del tutto (anche dalle app recenti) e riaprilo — il rilievo è ancora lì.', 'toast-ko', 30000);
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
  mostraVersione();
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
  // I messaggi salgono sopra la barra: la sua altezza vera (va a capo su un
  // telefono stretto) in una variabile che il CSS dei messaggi somma.
  const faiSpazio = () => {
    const h = barra && barra.offsetHeight ? barra.offsetHeight + 8 : 0;
    document.documentElement.style.setProperty('--altezza-aggiornamento', `${h}px`);
  };
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
        testo: '✕', onclick: () => { barra.remove(); barra = null; faiSpazio(); },
      }),
    ]);
    document.body.append(barra);
    faiSpazio();
    window.addEventListener('resize', faiSpazio);
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

/**
 * La revisione che sta DAVVERO eseguendo, chiesta a chi esegue.
 *
 * ⛔ Prima si leggeva da `caches.keys()` prendendo la prima chiave
 * `scudo-campo-v*`, e quella risposta poteva essere falsa proprio quando conta.
 * Durante un aggiornamento le cache sono DUE — l'attiva e la nuova appena
 * installata, in attesa che l'operatore prema «Aggiorna» — e l'ordine di
 * `caches.keys()` non è definito da nessuna specifica. Il campo poteva quindi
 * annunciare la revisione nuova mentre la pagina eseguiva ancora la vecchia:
 * una diagnostica che dice «sei aggiornato» a chi non lo è è peggio di nessuna
 * diagnostica, perché manda a cercare il difetto da un'altra parte. È successo.
 *
 * `navigator.serviceWorker.controller` è per definizione il worker che serve
 * QUESTA pagina: glielo si chiede, e risponde il suo nome.
 */
/**
 * La versione sotto il titolo, «v.112». Quella che ESEGUE, chiesta al service
 * worker — non una costante scritta nell'app, che direbbe la versione del file
 * e non quella della cache che lo serve. Senza service worker (prima apertura,
 * o `file:`) non si scrive niente: meglio nessun numero che uno inventato.
 */
function mostraVersione() {
  versioneInEsecuzione().then((v) => {
    const n = document.getElementById('brand-versione');
    const num = String(v || '').match(/v(\d+)$/);
    if (n) n.textContent = num ? `v.${num[1]}` : '';
  });
}

async function versioneInEsecuzione() {
  const ctrl = typeof navigator !== 'undefined' && navigator.serviceWorker
    && navigator.serviceWorker.controller;
  if (!ctrl) return null;
  try {
    return await new Promise((risolvi) => {
      const canale = new MessageChannel();
      // Un worker vecchio non conosce questo messaggio e non risponderebbe mai:
      // senza un tempo massimo la scheda resterebbe su «…» per sempre.
      const scadenza = setTimeout(() => risolvi(null), 1500);
      canale.port1.onmessage = (ev) => { clearTimeout(scadenza); risolvi(ev.data || null); };
      ctrl.postMessage({ tipo: 'VERSIONE' }, [canale.port2]);
    });
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------- //
// Salvataggio: il punto obbligato di ogni modifica
// --------------------------------------------------------------------------- //
/**
 * `annullabile`: il messaggio diventa «… - (clicca per annullare)» e il tocco disfa
 * gli eventi appena scritti (`S.annullaEventi`), passando di nuovo da qui. Solo per
 * le modifiche che `annullaEventi` sa disfare per intero. `dopoAnnulla` ridisegna
 * quello che `disegna()` non vede (il foglio aperto).
 */
async function muta(fn, messaggioOk, { annullabile = false, dopoAnnulla = null } = {}) {
  const prima = S.get().giornale.length;
  let risultato;
  try {
    // TUTTA O NIENTE (23/09/2026): se `fn` fallisce a metà, le scritture già
    // fatte si disfano — vedi `S.transazione`. Prima restavano in memoria e le
    // salvava il salvataggio successivo.
    risultato = S.transazione(fn);
  } catch (e) {
    toast(e.message || String(e), 'toast-ko', 7000);
    return null;
  }
  const nuoviEventi = S.get().giornale.slice(prima);
  const esito = await store.salvaConEvento(S.serializza(), nuoviEventi);
  // ⛔ NON salvato (25/09/2026): prima questo caso non esisteva — la copia di
  // emergenza piena rispondeva «ok» — e l'app mostrava «salvato» su un lavoro
  // che restava solo in memoria. Lo si dice, in rosso e a lungo, e si dice che
  // cosa fare: il pacchetto esportato è l'unica copia che esce dal telefono.
  if (!esito.ok) {
    toast('ATTENZIONE: la modifica NON è stata salvata sul dispositivo (spazio esaurito). '
      + 'Esporta subito il pacchetto dalla scheda Dati.', 'toast-ko', 20000);
  } else if (esito.degradato) {
    toast('Salvataggio nel database locale non riuscito: passo alla copia di emergenza. '
      + 'Esporta il pacchetto appena puoi.', 'toast-warn', 9000);
  }
  if (messaggioOk && annullabile && nuoviEventi.length) {
    const ids = nuoviEventi.map((e) => e.evento_id);
    toast(messaggioOk, 'toast-ok', 7000, {
      onAnnulla: async () => {
        if (await muta(() => { S.annullaEventi(ids); return true; }, 'Annullato') && dopoAnnulla) dopoAnnulla();
      },
    });
  } else if (messaggioOk) {
    toast(messaggioOk, 'toast-ok');
  }
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
  // «Indietro» verso un'altra scheda è anche un cambio di scheda.
  if (s.vista !== vistaCorrente) { try { memoriaMappa.trascina = false; } catch { /* mappa non ancora nata */ } }
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
  // Dentro un impianto, un'area o un'ubicazione dei Presidi la freccia c'è
  // sempre: porta su di un livello (`saliDiUnLivello`), anche quando la
  // cronologia delle schermate è vuota.
  if (b) b.hidden = storia.length === 0 && !doveSopra();
}

/** Il livello sopra, se si è dentro un luogo dei Presidi (vedi `livelloSopra`). */
function doveSopra() {
  return vistaCorrente === 'presidi' ? livelloSopra(dove) : null;
}

/**
 * «Indietro» nei Presidi: su di un livello di ubicazione, come «‹ Su a …»
 * delle briciole. Risponde `false` se non c'è un livello sopra — allora decide
 * la cronologia delle schermate, come sempre.
 */
function saliDiUnLivello() {
  const d = doveSopra();
  if (!d) return false;
  dove = d;
  limiteElenco = 60;
  disegna();
  return true;
}

/**
 * Riporta in cima.
 *
 * ⚠️ `scrollTo` sulla finestra non serve più a niente: dal 19/09/2026 il
 * documento non scorre — scorre `.vista` (vedi il blocco su `body` in
 * `styles.css`). Una schermata nuova che si apre a metà pagina è il difetto che
 * si nota dopo, quindi la riga sta in una funzione sola invece che ripetuta.
 */
function inCima() {
  const v = document.getElementById('vista');
  if (v) v.scrollTop = 0;
}

function tornaIndietro() {
  const s = storia.pop();
  if (!s) return false;
  ripristina(s);
  disegna();
  inCima();
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
    // Stessa regola per la mappa aperta sopra l'elenco: «indietro» la chiude
    // e si resta sui presidi, dov'era chi l'ha aperta.
    if (mappaSopra) {
      chiudiMappaDelPresidio();
      try { history.pushState({ scudo: true }, ''); } catch { /* senza cronologia */ }
      return;
    }
    // Il gesto «indietro» di Android, dentro un luogo dei Presidi: su di un
    // livello, e la voce consumata si rimette (come per il foglio).
    if (saliDiUnLivello()) {
      try { history.pushState({ scudo: true }, ''); } catch { /* senza cronologia */ }
      return;
    }
    tornaIndietro();
    aggiornaIndietro();
  });
  const b = document.getElementById('btn-indietro');
  // La freccia in alto: dentro un luogo dei Presidi sale di un livello DA SÉ,
  // senza passare dalla cronologia — che lì può essere vuota (la freccia c'è
  // lo stesso) e `history.back()` porterebbe fuori dall'app.
  if (b) b.addEventListener('click', () => { if (!saliDiUnLivello()) history.back(); });
}

/**
 * @param ricorda  se true, da qui si potrà tornare indietro. È false solo per i
 *                 salti che sostituiscono il punto di partenza invece di
 *                 partirne — il logo «casa», e il ritorno alla radice.
 */
/**
 * Da chiamare quando si lascia la vista corrente: oggi lo usa la mappa, per
 * spegnere il GPS.
 *
 * ⚠️ Esiste perché una vista che accende qualcosa deve poterlo spegnere, e
 * `disegna()` la sostituisce senza avvisarla. Senza, uscire dalla mappa
 * lasciava il ricevitore acceso fino allo scadere dei venticinque secondi — il
 * consumo di fondo che l'app ha promesso di non avere.
 */
let alLasciareLaVista = null;

function lasciaLaVista() {
  // ⛔ Cambiando scheda si esce dalla modalità «sposta i punti» della mappa
  // (25/09/2026, dall'operatore). È una modalità che si accende a proposito per un
  // lavoro, e ritrovarla accesa tornando alla mappa vuol dire trascinare un punto
  // credendo di spostare la mappa.
  // (Nel try: `memoriaMappa` è dichiarata più in basso, e all'avvio non esiste ancora.)
  try { memoriaMappa.trascina = false; } catch { /* mappa non ancora nata */ }
  const fn = alLasciareLaVista;
  alLasciareLaVista = null;
  if (fn) { try { fn(); } catch { /* una pulizia non deve rompere la navigazione */ } }
}

function vaiA(vista, { ricorda = true } = {}) {
  if (!VISTE.includes(vista)) return;
  lasciaLaVista();
  chiudiMappaDelPresidio();
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
  inCima();
}

function disegna() {
  const c = document.getElementById('vista-corpo');
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
  // La mappa aperta sopra l'elenco segue i dati, come quella della scheda
  // Mappa che rinasce qui sopra (vedi `mappaDelPresidio`).
  rifaiMappaDelPresidio();
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

  // Che cosa resta nella fascia rossa (operatore, 16/09/2026).
  //
  // C'erano tre pastiglie — «salvato sul dispositivo», i controlli, «N da
  // esportare» — su due righe, e su un telefono costavano un centimetro di
  // schermata a ogni vista. Due delle tre non servono a chi sta lavorando:
  // «salvato sul dispositivo» è una rassicurazione che la scheda Dati ripete per
  // esteso, e «da esportare» è già il numero sulla linguetta Dati, in fondo.
  //
  // Resta l'AVANZAMENTO, che è la domanda del giro — a che punto sono — come
  // barra più il numero. E restano gli ALLARMI, perché quelli chiedono un'azione:
  // archiviazione ridotta e app aperta in un'altra scheda.
  const perc = r.controlli_previsti
    ? Math.round((r.controlli_fatti / r.controlli_previsti) * 100) : 0;
  sb.append(el('div', { class: 'stato-avanzamento',
    'aria-label': `${r.controlli_fatti} controlli su ${r.controlli_previsti}` }, [
    el('div', { class: 'stato-barra' }, [
      el('div', { class: 'stato-barra-riemp', style: `width:${perc}%` }),
    ]),
    el('span', { class: 'stato-numero', testo: `${r.controlli_fatti}/${r.controlli_previsti} controlli` }),
  ]));
  // ⚠️ Gli allarmi DICONO che cosa succede e SI TOCCANO (19/09/2026, operatore:
  // «questo non si capisce cosa sia (archiviazione ridotta)»).
  //
  // «Archiviazione ridotta» era un termine di mestiere in una fascia dove non c'è
  // spazio per spiegarlo, su un allarme che riguarda la cosa che l'operatore teme
  // di più: perdere il lavoro. E non era toccabile, quindi non portava da nessuna
  // parte. La spiegazione c'era, ma in fondo alla scheda Dati — cioè dove nessuno
  // la cerca finché non ha già perso qualcosa.
  // ⛔ Lo stato del giro nella fascia, che è sempre in vista (19/09/2026).
  //
  // Il giro si poteva iniziare da UN SOLO punto — la scheda dentro il Riepilogo
  // — e la fascia non diceva mai se fosse iniziato. Chi apre l'app e comincia a
  // registrare non passa da lì, e `iniziato_il` è il confine con cui si decide
  // che cosa è «di questo giro».
  const sg = S.statoGiro();
  if (sg === S.GIRO_NON_INIZIATO) {
    sb.append(el('button', {
      class: 'pill pill-btn', type: 'button', testo: '▶ controllo non iniziato',
      onclick: () => formGiro(),
    }));
  } else if (sg === S.GIRO_CONCLUSO) {
    sb.append(el('span', { class: 'pill', testo: '✓ controllo concluso' }));
  }
  if (p.modalita !== 'idb') {
    sb.append(el('button', {
      class: 'pill pill-allarme pill-btn', type: 'button',
      testo: '⚠ salvataggio a rischio',
      onclick: () => spiegaSalvataggioARischio(p),
    }));
  }
  if (contaAltreIstanze() > 0) {
    sb.append(el('button', {
      class: 'pill pill-allarme pill-btn', type: 'button',
      testo: "⚠ aperto in un'altra scheda",
      onclick: () => spiegaAltraScheda(),
    }));
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
      // Passa da `muta()` come ogni azione che tocca i dati: prima cambiava lo
      // stato senza salvare e senza lasciare traccia, e chi riapriva il giro e
      // perdeva la pagina lo ritrovava concluso.
      onclick: () => muta(() => S.riapriGiro('riaperto dall\'operatore'),
        'Controllo riaperto.').then(disegna),
    }));
  }

  return el('div', { class: 'card' }, [
    el('h2', { testo: 'Il controllo', style: 'margin-top:0' }),
    // La spiegazione del passaggio sta QUI, dove si guarda lo stato del giro, e
    // non solo dentro il foglio della conclusione.
    stato !== S.GIRO_NON_INIZIATO ? spiegazionePassaggio() : null,
    el('dl', { class: 'dati' }, righe),
    ...azioni,
  ]);
}

function formGiro() {
  const s = S.get().sessione;
  // ⛔ Il ripiego sull'IDENTITÀ DELLA PORTA, non solo sulla sessione
  // (21/09/2026, richiesta dell'operatore: «va precompilato con l'operatore che
  // ha fatto il login»).
  //
  // La sessione la riceve all'avvio, ma è memoria viva: un caricamento di
  // pacchetto, un ripristino, un giro nuovo la possono lasciare vuota, e allora
  // l'operatore si ritrova a riscrivere il nome che ha già dato entrando. Il
  // nome vero sta in `identita()`, salvata sul telefono, e leggerlo da lì non
  // può mancare.
  //
  // ⚠️ La sessione VINCE comunque: se qualcuno ha scritto un altro nome per
  // questo giro, riscriverci sopra quello della porta sarebbe attribuire i
  // controlli a chi non li ha fatti.
  const fOp = el('input', { type: 'text', value: s.operatore || nomeCompleto() || '',
    placeholder: 'Nome e cognome' });
  const fMat = el('input', { type: 'text',
    value: s.matricola || (identita() || {}).matricola || '',
    placeholder: 'Matricola', inputmode: 'numeric' });
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
  // Tutte selezionate di partenza (operatore, 16/09/2026): «lascia deselezionato
  // per controllare tutto» chiedeva di leggere una frase per capire che il foglio
  // vuoto voleva dire «tutto», e la schermata sembrava un elenco da spuntare a mano.
  // Adesso si parte da tutto acceso e si TOGLIE quello che non si controlla.
  // Nel dato la convenzione resta la stessa: tipi_asset vuoto = tutte le tipologie,
  // e si salva vuoto quando sono selezionate tutte.
  const tutti = [...conta.keys()];
  const scelti = new Set((s.tipi_asset && s.tipi_asset.length) ? s.tipi_asset : tutti);
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
    const totale = caselle.reduce((t, c) => t + c.n, 0);
    riassunto.textContent = !scelti.size
      ? 'Nessuna tipologia selezionata: il giro non coprirebbe niente.'
      : (scelti.size === caselle.length
        ? `Tutte le tipologie · ${totale} presidi nel giro`
        : `${scelti.size} tipologie su ${caselle.length} · ${tot} presidi nel giro`);
  }
  const segnaTutte = (valore) => {
    scelti.clear();
    if (valore) for (const c of caselle) scelti.add(c.codice);
    for (const c of caselle) c.chk.checked = valore;
    aggiornaConteggio();
  };
  aggiornaConteggio();

  // Tutte selezionate = nessun perimetro: il dato resta com'era prima di questa
  // schermata, e un pacchetto vecchio continua a leggersi.
  const tipiSalvati = () => (scelti.size === caselle.length ? [] : [...scelti]);

  apriSheet('Dati del controllo', el('div', {}, [
    campo('Operatore Terna', fOp),
    campo('Matricola dipendente', fMat),
    campo('Operatore ditta manutentrice', fDitta),
    campo('Note sul giro', fNote),
    el('h3', { testo: 'Che cosa controlli in questo giro', style: 'margin:16px 0 4px;font-size:.95rem' }),
    el('div', { class: 'mini' }, [
      'Sono selezionate tutte: TOGLI quelle che non controlli in questo giro. '
      + "L'avanzamento e il riepilogo si riferiscono a quelle che restano — con un "
      + "interruttore per rivedere l'archivio intero quando serve.",
    ]),
    el('div', { class: 'riga', style: 'gap:6px;margin-top:6px' }, [
      el('button', { class: 'btn btn-piccolo', type: 'button', testo: 'Seleziona tutte',
        onclick: () => segnaTutte(true) }),
      el('button', { class: 'btn btn-piccolo', type: 'button', testo: 'Nessuna',
        onclick: () => segnaTutte(false) }),
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
            operatore_ditta: fDitta.value.trim(), tipi_asset: tipiSalvati(),
            // Si perdevano: il campo c'è nel foglio, ma questo ramo non lo
            // passava — e quindi sparivano proprio la prima volta che si scrivono.
            note_giro: fNote.value.trim(),
          });
          toast('Controllo iniziato.', 'toast-ok');
        } else {
          S.aggiornaGiro({
            operatore: fOp.value.trim(), matricola: fMat.value.trim(),
            operatore_ditta: fDitta.value.trim(), note_giro: fNote.value.trim(),
            tipi_asset: tipiSalvati(),
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

/**
 * Come si passa il giro a un altro operatore.
 *
 * ⚠️ Stava DENTRO il foglio «Concludere il controllo», che si apre solo premendo
 * «Concludi il controllo», che a sua volta compare solo se il giro è già in
 * corso: chi non ha mai premuto «Inizia il controllo» non la leggeva mai.
 * Adesso è una funzione sola, usata dalla scheda del giro e dai due fogli.
 *
 * ⛔ E il testo è cambiato: fino al 19/09/2026 diceva che si passa SOLO dall'ufficio,
 * cioè esattamente il contrario di quello che l'app adesso sa fare.
 */
function spiegazionePassaggio() {
  return el('div', {}, [
    el('div', { style: 'font-weight:600;margin-top:10px',
      testo: 'Se il resto del giro lo fa un altro operatore' }),
    el('div', { class: 'mini', style: 'margin-top:2px' }, [
      'Esporta il pacchetto e mandalo a lui: lo carica sul suo telefono e continua '
      + 'da dove sei arrivato tu, con i tuoi controlli già dentro. Alla fine il '
      + "pacchetto torna in ufficio con il lavoro di tutti, e l'ufficio vede chi ha "
      + 'fatto che cosa.',
    ]),
    el('div', { class: 'mini', style: 'margin-top:6px;font-weight:600' }, [
      '⚠ Uno alla volta, però: due telefoni che escono con lo STESSO pacchetto e '
      + "lavorano in parallelo non si possono riportare tutti e due. L'ufficio "
      + 'rifiuta il secondo, perché cancellerebbe il lavoro del primo.',
    ]),
  ]);
}

function confermaConclusione(r, { poiEsporta = false } = {}) {
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

    // ⭐ Le due domande che l'operatore ha posto il 19/09/2026, con la risposta
    // MISURATA (`backend/tests/test_scudo_giro.py::
    // test_due_copie_dello_stesso_pacchetto_la_seconda_non_cancella_la_prima`).
    // Stanno QUI e non nella scheda Dati perché è qui che ci si chiede «e adesso
    // che cosa succede se lo riporto a metà».
    el('div', { class: 'card card-piatta', style: 'margin:10px 0' }, [
      el('div', { style: 'font-weight:600', testo: 'Che cosa succede ai presidi non controllati' }),
      el('div', { class: 'mini', style: 'margin-top:2px' }, [
        'Niente: non vengono cancellati. Il pacchetto riporta in ufficio TUTTO '
        + "l'archivio, controllato o no — quelli che nessuno ha guardato tornano "
        + 'identici, semplicemente senza un controllo nuovo, e le loro scadenze '
        + 'restano aperte.',
      ]),
      spiegazionePassaggio(),
    ]),

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
        // ⛔ Arrivando da «Il giro è finito, riporta in ufficio», l'esportazione
        // segue SUBITO: «ricordati di esportare» è un promemoria, e un
        // promemoria dato a chi sta per chiudere l'app è il modo in cui un
        // giorno di lavoro resta su un telefono.
        if (poiEsporta) { disegna(); esportaPacchetto(); return; }
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

/** Il foglio che mostra le note cancellate per errore, e le rimette. */
function formTestiCancellati() {
  const elenco = S.testiCancellatiPerErrore();
  if (!elenco.length) { toast('Nessuna nota da rimettere.', 'toast-ok'); return; }
  const perNome = new Map((S.get().campi || []).map((c) => [c.nome, c]));
  const corpo = el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo: 'Queste sono le note com\'erano prima '
      + 'del salvataggio che le ha svuotate. Se una l\'avevi tolta apposta, lasciala: si rimettono tutte insieme, '
      + 'e dal messaggio si può annullare.' }),
    ...elenco.map((x) => {
      const a = S.indici.assets.get(x.asset_id);
      return el('div', { class: 'card card-piatta', style: 'margin-bottom:8px' }, [
        el('div', { style: 'font-weight:600', testo: a ? titoloPresidio(a) : x.asset_id }),
        el('div', { class: 'mini', testo: `${(perNome.get(x.campo) || {}).etichetta || x.campo}${a ? ` · ${S.ubicazione(a)}` : ''}` }),
        el('div', { style: 'margin-top:4px;white-space:pre-wrap', testo: x.testo }),
      ]);
    }),
    el('div', { class: 'riga riga-fine', style: 'margin-top:12px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Non ora', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button',
        testo: `Rimetti ${elenco.length === 1 ? 'la nota' : `le ${elenco.length} note`}`,
        onclick: async () => {
          const res = await muta(() => {
            for (const x of elenco) S.aggiornaAsset(x.asset_id, { [x.campo]: x.testo });
            return true;
          }, `${elenco.length === 1 ? 'Nota rimessa' : `${elenco.length} note rimesse`}.`, { annullabile: true });
          if (res) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet('Note cancellate per errore', corpo);
}

function vistaRiepilogo() {
  const st = S.get();
  const r = S.riepilogo(vistaTotale);
  const frag = document.createDocumentFragment();

  frag.append(el('h1', { testo: 'Riepilogo del giro' }));

  // ⛔ Le note cancellate da un difetto dell'app (23/09/2026): vedi
  // `S.testiCancellatiPerErrore`. Compare solo se ce n'è almeno una, e si
  // rimettono solo col tocco dell'operatore — con una modifica normale, che
  // arriva in ufficio con il pacchetto.
  const cancellati = S.testiCancellatiPerErrore();
  if (cancellati.length) {
    frag.append(el('div', { class: 'avviso avviso-rosso', style: 'margin-bottom:12px' }, [
      el('div', { style: 'font-weight:600', testo: `⚠ ${cancellati.length} `
        + `${cancellati.length === 1 ? 'nota è stata cancellata' : 'note sono state cancellate'} per un difetto dell'app` }),
      el('div', { class: 'mini', style: 'margin:4px 0 8px', testo: 'Salvando «Modifica anagrafica» il campo '
        + 'note appariva vuoto, e il salvataggio lo svuotava davvero. Il testo di prima è nel registro: '
        + 'guardale e rimettile.' }),
      el('button', { class: 'btn btn-blocco', type: 'button', testo: 'Guarda e rimetti le note',
        onclick: () => formTestiCancellati() }),
    ]));
  }

  // ⛔ L'avviso sul lavoro non esportato compare SOLO a giro concluso
  // (21/09/2026, segnalazione dell'operatore: «è normale? credo che se non ci
  // sono problemi non dovremmo mostrare nulla»).
  //
  // Aveva ragione, e il motivo è che l'avviso era vero e inutile insieme:
  // scattava alla PRIMA registrazione e restava fino all'esportazione, cioè per
  // tutto il giro. Avere lavoro non ancora consegnato mentre si sta lavorando
  // non è un problema: è la definizione di stare lavorando. Un avviso sempre
  // acceso non avverte di niente — insegna a saltare la fascia in cui un
  // giorno comparirà qualcosa che conta.
  //
  // ⚠️ A giro CONCLUSO invece è il momento esatto in cui serve: il lavoro è
  // finito e non è ancora tornato in ufficio, e se il telefono passa di mano o
  // si spegne lì, nessuno sa che c'era. Il dato non si perde — sta in
  // IndexedDB — ma resta invisibile a tutti tranne che a questo telefono.
  if (r.modifiche_non_esportate > 0 && S.statoGiro() === 'CONCLUSO') {
    frag.append(avviso(
      `Il controllo è concluso e ${r.modifiche_non_esportate === 1
        ? "c'è 1 modifica" : `ci sono ${r.modifiche_non_esportate} modifiche`} `
      + 'che non sono ancora tornate in ufficio. Esporta il pacchetto dalla scheda '
      + 'Dati: finché resta qui, il lavoro lo vede solo questo telefono.',
      'avviso-ambra'));
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

  // ⛔ I numeri a BLOCCHI, ognuno con il suo totale dichiarato e le sue voci che
  // ci sommano dentro (20/09/2026, segnalazione dell'operatore: «se sommiamo
  // presidi in regola e non in regola non arriviamo comunque a 868, e nemmeno a
  // 1688»). Aveva ragione due volte: due unità si chiamavano «presidi» — le
  // righe e i pezzi — e la somma che invece torna aveva il terzo addendo in una
  // nota staccata. La decisione sta in `riepilogo_home.js`, dove una prova può
  // eseguirla e pretendere che ogni blocco quadri.
  for (const b of blocchiRiepilogo(r)) {
    // Ogni blocco ha la sua FORMA, decisa in `riepilogo_home.js`: una ciambella
    // dove le voci sommano al totale (in un cerchio la somma si vede senza
    // contarla), una barra dove sono un avanzamento, un numero solo dove non
    // c'è niente da ripartire. Prima erano tutte schede uguali, e due numeri
    // che sono un avanzamento si leggevano come due misure indipendenti.
    const corpo = [];
    if (b.forma === 'ciambella') {
      corpo.push(ciambella(b.voci.map((v) => ({
        valore: v.valore, etichetta: v.etichetta, colore: v.colore,
      })), { numero: b.totale.valore, testo: 'in tutto' }));
    } else if (b.forma === 'barra') {
      const fatte = (b.voci[0] || {}).valore || 0;
      corpo.push(barraAvanzamento(fatte, b.totale.valore));
      corpo.push(el('div', { class: 'blocco-ripartizione' },
        b.voci.map((v) => el('span', {}, [
          el('span', { class: 'legenda-pallino', style: `background:${v.colore}` }),
          el('b', { testo: String(v.valore) }),
          el('span', { class: 'mini', testo: ` ${v.etichetta}` }),
        ]))));
    } else {
      corpo.push(el('div', { class: 'griglia-kpi' },
        [kpi(b.totale.valore, b.totale.etichetta, b.totale.valore ? 'rosso' : 'verde')]));
    }
    // Le voci apribili diventano una riga a sé, sotto: dentro una legenda non
    // si vede che si possono toccare, e un bersaglio da toccare vuole la sua
    // riga alta quanto il pollice.
    for (const v of b.voci.filter((x) => x.apribile && x.valore)) {
      corpo.push(el('button', {
        class: 'btn btn-blocco btn-piccolo blocco-apri', type: 'button',
        testo: `Vedi i ${v.valore} ${v.etichetta} ›`,
        onclick: () => elencoSenzaScadenze(),
      }));
    }
    frag.append(el('div', { class: 'card blocco-numeri' }, [
      el('div', { class: 'blocco-titolo' }, [
        el('span', { testo: b.titolo }),
        b.voci.length
          ? el('b', { testo: `${b.totale.valore} ${b.totale.etichetta}` }) : null,
      ]),
      ...corpo,
      b.nota ? el('div', { class: 'mini blocco-nota', testo: b.nota }) : null,
    ]));
  }

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
    // ⛔ Scesa qui il 20/09/2026 insieme alla rimozione del blocco doppione in
    // cima. Dice quanto del lavoro è IN RITARDO, e non compare in nessun altro
    // punto della schermata: «restano 1489» non distingue una verifica che
    // scade fra sei mesi da una scaduta da settembre, e sono le seconde a
    // decidere da dove si comincia.
    r.scadute ? el('div', { class: 'mini', style: 'margin-top:2px',
      testo: `Su ${r.righe} presidi · ${r.scadute} verifiche sono già scadute.` }) : null,
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
      testo: 'Vai a quelli da controllare',
      onclick: () => {
        filtri = { ...filtri, soloDaControllare: true, soloControllati: false, soloSospesi: false, testo: '', categorie: [] };
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
  const perPiano = S.avanzamentoPerChiave((voce) => {
    const id = voce.piano_id;
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
  const perImpianto = S.avanzamentoPerChiave((_voce, a) => {
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
            filtri = { ...filtri, testo: '', soloDaControllare: true, soloControllati: false, soloSospesi: false };
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
  // Il percorso sta DENTRO l'intestazione fissa (16/09/2026): è la prima cosa da
  // sapere mentre si scorre l'elenco — «dove sono» — e prima usciva di scena al
  // primo scorrimento.
  frag.append(barraRicerca());

  // Quando si vede l'ELENCO e quando si vede la NAVIGAZIONE (16/09/2026).
  //
  // Prima bastava un filtro — una tipologia, «da fare», «con anomalie» — per far
  // sparire impianti e ubicazioni e ritrovarsi con 408 estintori in fila: la
  // domanda «dove sono» spariva proprio mentre si cercava un pezzo in un locale.
  // Adesso i filtri restringono l'albero (conteggi compresi) e l'elenco piatto
  // compare solo quando lo si è chiesto davvero: scrivendo nella ricerca, oppure
  // scendendo fino a un'ubicazione o premendo «mostra tutti».
  const inRicerca = Boolean(filtri.testo.trim());

  if (dove.localeId || inRicerca) frag.append(elencoPresidi());
  else frag.append(navigazione());
  // L'anagrafica c'è a OGNI livello, compreso il terzo (19/09/2026, segnalazione
  // dell'operatore: «entrando sul terzo livello dovrebbero apparire i pulsanti
  // per rinominare quell'area»). Prima spariva appena si entrava in
  // un'ubicazione, perché quel ramo disegnava solo l'elenco: chi creava
  // un'ubicazione sbagliata e ci entrava dentro non aveva più nessun modo di
  // rinominarla o cancellarla da lì.
  if (!inRicerca && dove.localeId !== '__tutti__') frag.append(azioniUbicazione());
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
  // Dove SI È, e che cosa si può creare qui sotto. Sono due cose diverse, e
  // tenerle separate è ciò che mancava: sull'ubicazione — il terzo e ultimo
  // livello — non c'è niente da creare sotto, ma c'è eccome da rinominare.
  // La decisione sta in `luoghi.js`, dove una prova può eseguirla: qui dentro
  // no, perché `app.js` non è costruibile fuori dal browser.
  const { qui, segnaposto, creaFiglio, rinomina, elimina } = azioniDelNodo(dove, S.SENZA_LUOGO);

  // ⛔ «(senza area)» e «(senza ubicazione)» NON sono luoghi: sono la risposta
  // alla domanda «quelli che non ce l'hanno», e portano per id il segnaposto
  // `SENZA_LUOGO`. Trattarli come un luogo produceva tre bugie, tutte lette sul
  // browser il 19/09/2026 e nessuna delle tre visibile da una prova sui dati:
  //  * «Elimina questa ubicazione» ACCESO e rosso su un nodo che contiene
  //    presidi, perché `motivoNonEliminabile` conta quelli con
  //    `locale_id === '__senza__'` — zero, visto che i veri ce l'hanno vuoto.
  //    Premerlo chiedeva la password admin e poi falliva;
  //  * «Rinomina questa ubicazione», che apre un modulo vuoto e fallisce al
  //    salvataggio con «Ubicazione non trovata»;
  //  * dentro «(senza area)», «+ Nuova ubicazione», che `creaLocale` rifiuta
  //    («Area inesistente») dopo aver fatto compilare tutto il modulo.
  // Al loro posto c'è l'unica azione che qui ha senso, e che è anche il modo di
  // far sparire il nodo: dare un luogo ai presidi che ci stanno dentro.
  if (segnaposto) return azioniSenzaLuogo(qui.tipo);

  const azioni = [];
  if (creaFiglio) {
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: `+ ${NOMI_LUOGO[creaFiglio].nuovo}`,
      onclick: () => formUbicazione(creaFiglio, null),
    }));
  }

  if (rinomina && elimina) {
    const nome = (S.indici[{ impianto: 'impianti', edificio: 'edifici', locale: 'locali' }[qui.tipo]]
      .get(qui.id) || {}).denominazione || NOMI_LUOGO[qui.tipo].questo;
    const p = permessiLuogo(qui.tipo, qui.id);
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:6px',
      testo: `Rinomina ${NOMI_LUOGO[qui.tipo].questo}`,
      onclick: () => rinominaLuogo(qui.tipo, qui.id),
    }));
    // Spento con il motivo scritto, non assente: vedi `luoghi.js`.
    azioni.push(el('button', {
      class: `btn btn-blocco btn-piccolo${p.eliminabile ? ' btn-pericolo' : ' btn-spento'}`,
      type: 'button', style: 'margin-top:6px',
      testo: `Elimina ${NOMI_LUOGO[qui.tipo].questo}`,
      title: p.motivo || '',
      'aria-disabled': p.eliminabile ? null : 'true',
      onclick: () => (p.eliminabile
        ? eliminaLuogo(qui.tipo, qui.id, nome)
        : toast(p.motivo, 'toast-ko', 7000)),
    }));
    if (!p.eliminabile) {
      azioni.push(el('div', { class: 'mini', style: 'margin-top:4px', testo: p.motivo }));
    }
  }

  return el('div', { class: 'card', style: 'margin-top:12px' }, [
    el('h2', { testo: 'Anagrafica', style: 'margin-top:0;font-size:1rem' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px' }, [
      "Quello che cambi qui viaggia nel pacchetto e rientra in archivio "
      + "insieme ai controlli. Senza password si tocca solo quello che hai creato "
      + "tu in questo giro.",
    ]),
    ...azioni,
  ]);
}

/** I presidi che stanno nel nodo-segnaposto in cui si è, filtri esclusi. */
function presidiSenzaLuogo() {
  // ⚠️ SENZA `filtri`, ed è voluto: questi presidi si spostano tutti insieme, e
  // un conteggio che dipende da una spunta lasciata accesa in un'altra
  // schermata direbbe «sposta 3» mentre il nodo ne contiene 24. Il foglio li
  // elenca uno per uno con la sua casella, quindi niente resta nascosto.
  return S.cerca({
    impiantoId: dove.impiantoId,
    edificioId: dove.edificioId,
    localeId: dove.localeId === '__tutti__' ? '' : dove.localeId,
  });
}

/**
 * Che cosa si può fare stando dentro «(senza area)» o «(senza ubicazione)».
 *
 * Non rinominare e non eliminare — non c'è niente da rinominare — ma **dare un
 * luogo**, che è la richiesta dell'operatore del 19/09/2026: «serve una voce di
 * default per quando non la selezioniamo, così che navigando nei presidi li
 * troviamo sempre e comunque sul terzo livello».
 *
 * La voce di default a schermo c'è già ed è questo nodo. Quello che mancava è la
 * via d'uscita: misurato sull'archivio vero, i presidi senza area sono **5**, e
 * tutti e cinque hanno la posizione GIÀ SCRITTA in «Posizione precisa»
 * («Deposito», «Compensatore Sincrono»). Il luogo si sa: non è mai stato
 * trasformato in una riga. Quindi il foglio propone quel testo come nome, e
 * l'operatore conferma invece di ricopiare.
 */
function azioniSenzaLuogo(tipo) {
  const presidi = presidiSenzaLuogo();
  const pezzi = presidi.reduce((n, a) => n + (Number.parseInt(a.quantita || '0', 10) || 0), 0);
  const cosa = tipo === 'edificio' ? "un'area" : "un'ubicazione";
  const contenuto = presidi.length === 1
    ? `C'è ${pezzi === 1 ? 'un presidio' : `una scheda da ${pezzi} pezzi`}`
    : `Ci sono ${presidi.length} schede, ${pezzi} pezzi in tutto`;

  const azioni = [];
  if (presidi.length) {
    azioni.push(el('button', {
      class: 'btn btn-blocco btn-primario btn-piccolo', type: 'button',
      testo: `📍 Assegna ${cosa} a questi presidi`,
      onclick: () => formAssegnaLuogo(tipo, presidi),
    }));
  }

  return el('div', { class: 'card', style: 'margin-top:12px' }, [
    el('h2', { testo: S.NOME_SENZA[tipo], style: 'margin-top:0;font-size:1rem' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: `Non è un posto: è l'elenco dei presidi a cui ${cosa} non è mai stata `
        + `assegnata. ${contenuto}. Non si rinomina e non si elimina — sparisce da `
        + 'sé quando non ci resta dentro più nessuno.' }),
    ...azioni,
  ]);
}

/**
 * Assegnare in un colpo solo il luogo ai presidi che non ce l'hanno.
 *
 * Il gesto lento che questo toglie: aprire ogni presidio, «Modifica anagrafica»,
 * scorrere fino a Ubicazione, scegliere, salvare, tornare indietro — per
 * ventiquattro schede di fila, tutte nello stesso posto.
 *
 * Il luogo nuovo si può creare da qui: mandare l'operatore nella scheda Luoghi a
 * crearlo e poi farlo tornare è il punto in cui si smette e si annota su un
 * foglio.
 */
function formAssegnaLuogo(tipo, presidi) {
  const scelti = new Set(presidi.map((a) => a.id));
  // Il nome che l'archivio già conosce. Se tutti i presidi del nodo dicono la
  // stessa cosa è una proposta; se dicono cose diverse non se ne inventa una
  // per loro — resta la scelta a mano, che è la risposta onesta.
  const testi = [...new Set(presidi.map((a) => (a.ubicazione_testo || '').trim()).filter(Boolean))];
  const proposta = testi.length === 1 ? testi[0] : '';

  const luogo = U.bloccoUbicazione({
    impiantoId: dove.impiantoId,
    // Dentro «(senza ubicazione)» l'area c'è già e non si discute: si chiede
    // solo il gradino che manca.
    areaFissa: tipo === 'locale' ? dove.edificioId : '',
    proposta,
  });

  // Che cosa si sposta, uno per uno: si vede PRIMA di premere. Un'azione che
  // tocca ventiquattro schede in un colpo deve mostrare quali.
  const elenco = el('div', { style: 'margin-top:6px' });
  for (const a of presidi) {
    const q = Number.parseInt(a.quantita || '0', 10) || 0;
    elenco.append(casellaFiltro(
      `${nomePresidio(a).principale || a.codice}${q > 1 ? ` · ${q} pezzi` : ''}`
      + `${(a.ubicazione_testo || '').trim() ? ` — «${a.ubicazione_testo.trim()}»` : ''}`,
      true,
      (v) => { if (v) scelti.add(a.id); else scelti.delete(a.id); }));
  }

  apriSheet(presidi.length === 1
    ? 'Dove sta questo presidio?' : `Dove stanno questi ${presidi.length} presidi?`,
    el('div', {}, [
      avviso(proposta
        ? `In archivio la posizione è già scritta: «${proposta}». È proposta come nome, `
          + 'così non c\'è niente da ricopiare.'
        : 'Assegnando un luogo, questi presidi si trovano scendendo fino al terzo '
          + 'livello invece che sotto il nodo «senza».', 'avviso-blu'),
      luogo.nodo,
      el('div', { class: 'mini', style: 'margin-top:10px', testo: 'Che cosa si sposta' }),
      elenco,
      el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
        el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
        el('button', {
          class: 'btn btn-primario', type: 'button', testo: 'Assegna',
          onclick: async () => {
            const daSpostare = presidi.filter((a) => scelti.has(a.id));
            if (!daSpostare.length) { toast('Non hai scelto nessun presidio.', 'toast-ko'); return; }
            const errori = luogo.errori();
            if (errori.length) { toast(errori[0], 'toast-ko', 7000); return; }

            const esito = await muta(() => {
              // Prima i luoghi, poi i presidi: se la creazione fallisce (nome
              // già usato) nessun presidio è ancora stato toccato.
              const posto = luogo.applica();
              for (const a of daSpostare) {
                S.aggiornaAsset(a.id, {
                  edificio_id: posto.edificio_id, locale_id: posto.locale_id,
                });
              }
              return posto;
            }, `${daSpostare.length === 1 ? 'Presidio assegnato' : `${daSpostare.length} presidi assegnati`}.`,
            { annullabile: true, dopoAnnulla: disegna });

            if (esito) {
              // Si va DOVE sono finiti: restare sul nodo «senza», che nel
              // frattempo si è svuotato, mostrerebbe un elenco vuoto e farebbe
              // credere che siano spariti.
              dove = { impiantoId: dove.impiantoId,
                edificioId: esito.edificio_id, localeId: esito.locale_id };
              chiudiSheet();
              disegna();
            }
          },
        }),
      ]),
    ]));
}

/**
 * Chi può toccare un luogo, e perché.
 *
 * ⛔ UNA funzione sola, e la usano sia il pulsante (per accendersi) sia l'azione
 * (per chiedere la password): due risposte diverse alla stessa domanda vorrebbero
 * dire un pulsante acceso che poi rifiuta, o spento su una cosa permessa.
 *
 * La regola l'ha chiesta l'operatore il 19/09/2026, ed è in due pezzi:
 *
 * 1. **Senza password** si modifica e si elimina SOLO ciò che si è creati qui —
 *    l'ubicazione sbagliata di dieci minuti fa, che oggi restava lì per sempre.
 *    Lo dice il giornale (`luogoCreatoInCampo`), non un campo nuovo.
 * 2. **Con password** tutto il resto: rinominare un'area che viene dall'ufficio
 *    cambia un nome che altri stanno usando, e va fatto da chi se ne assume la
 *    responsabilità.
 *
 * L'eliminazione ha in più un limite che NON si supera con la password, perché
 * non è una questione di permessi ma di integrità: un luogo con dentro presidi o
 * altri luoghi non si cancella (`motivoNonEliminabile`).
 */
function permessiLuogo(tipo, id) {
  const mio = S.luogoCreatoInCampo(tipo, id);
  const bloccante = S.motivoNonEliminabile(tipo, id);
  return {
    serveAdmin: !mio,
    eliminabile: !bloccante,
    motivo: bloccante || (mio ? '' : 'Creato in ufficio: chiede la password admin.'),
  };
}

const NOME_LUOGO_AZIONE = {
  impianto: 'impianto', edificio: NOMI_LUOGO.edificio.nome, locale: NOMI_LUOGO.locale.nome,
};

/**
 * «Dove si trova»: l'indirizzo, il comando per navigare e quello per rilevare.
 *
 * ⛔ Un foglio e non tre righe nell'albero (20/09/2026, segnalazione
 * dell'operatore: «rendi meno invadente la navigazione/posizione/indirizzo nella
 * tab dei luoghi, altrimenti ci si distrae dall'alberatura»). Nell'albero resta
 * un'icona; le parole stanno qui, dove c'è spazio per scriverle per esteso.
 */
function dovSiTrova(nodo) {
  const corpo = vistaDove(nodo, {
    onPosizione: () => { chiudiSheet(); posizioneLuogo(nodo.tipo, nodo.id, nodo.nome); },
    // La mappa e il nome da qui (25/09/2026): chi apre questo foglio sta
    // guardando QUESTO luogo, e cercare altrove come vederlo o rinominarlo è
    // la strada su cui ci si ferma.
    onMappa: S.haPosizione(nodo.riga || {}) ? () => {
      chiudiSheet();
      mappaSopraElenco({ id: nodo.id, centro: nodo.riga, titolo: `${ICONE_LUOGO[nodo.tipo] || '📍'} ${nodo.nome}` });
    } : null,
    onRinomina: () => { chiudiSheet(); rinominaLuogo(nodo.tipo, nodo.id); },
  });
  // ⛔ Per un IMPIANTO il foglio continua con il suo registro antincendio
  // (21/09/2026, segnalazione dell'operatore: «dove dovrei vedere i dati dei
  // registri? non li vedo»).
  //
  // Avevo scritto che si arrivava «da due strade, l'albero e la mappa». Era
  // falso: `schedaPuntoMappa` è chiamata da UN punto solo — il tocco sul pin —
  // e l'albero portava qui, dove il registro non c'era. Una seconda strada
  // dichiarata e mai collegata è peggio di una sola, perché chi cerca smette di
  // cercare nel posto giusto.
  //
  // ⚠️ Il foglio resta quello: un impianto ha UN posto dove si guarda, non due
  // che dicono metà per uno.
  if (nodo.tipo === 'impianto' && nodo.riga) corpo.append(sezioniImpianto(nodo.riga));
  apriSheet(nodo.tipo === 'impianto' ? nodo.nome : `Dove si trova · ${nodo.nome}`, corpo);
}

/**
 * Solo la POSIZIONE di un luogo, senza password.
 *
 * ⛔ Separata da `rinominaLuogo` il 20/09/2026, perché l'operatore non riusciva
 * a usarla: «non mi fa modificare per usare il satellite». Il pannello del GPS
 * stava dentro il modulo di rinomina, e rinominare un luogo che viene
 * dall'ufficio chiede la password admin — quindi per registrare dove si trova
 * una cabina bisognava passare da una porta che difende un'altra cosa.
 *
 * La password difende la STRUTTURA dell'archivio: un nome cambiato o un luogo
 * cancellato cambiano come lo ritrova chi non è qui. Una posizione è un dato di
 * campo che prima non c'era, della stessa famiglia del GPS sui presidi, che non
 * ha mai chiesto niente — e chiedere una password per aggiungere l'unica
 * informazione che solo chi è sul posto può dare vuol dire non averla.
 *
 * Il pannello resta anche nel modulo di rinomina: chi ci passa per altro non
 * deve uscire e rientrare.
 */
function posizioneLuogo(tipo, id, nome) {
  const st = S.get();
  // Dal 23/09/2026 anche il PRESIDIO, dalla sua scheda sulla mappa: stessi
  // quattro campi, stessa regola (senza password), scritti da `aggiornaAsset`.
  const riga = (st.perEntita[{ impianto: E.IMPIANTO, edificio: E.EDIFICIO, locale: E.LOCALE,
    presidio: E.ASSET }[tipo]] || [])
    .find((r) => r.id === id);
  if (!riga) { toast(tipo === 'presidio' ? 'Presidio non trovato.' : 'Ubicazione non trovata.', 'toast-ko'); return; }

  const coord = U.bloccoCoordinate({
    coordinate: {
      lat: riga.lat || '', lon: riga.lon || '',
      accuratezza: riga.gps_accuratezza_m || null,
      rilevato_il: riga.gps_rilevato_il || '',
    },
    avvisa: (m) => toast(m, 'toast-ko', 7000),
    titolo: `Posizione ${tipo === 'presidio' ? 'del presidio' : NOMI_LUOGO[tipo].della}`,
  });

  const corpo = el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: 'Prendila stando sul posto: è quella che porterà qui chi non c\'è '
        + 'mai stato.' }),
    coord.nodo,
    el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px',
      testo: 'Salva la posizione',
      onclick: async () => {
        const esito = await muta(() => {
          if (tipo === 'presidio') S.aggiornaAsset(id, coord.valori());
          else S.modificaUbicazione(tipo, id, coord.valori());
          return { messaggio: 'Posizione aggiornata.' };
        }, null);
        if (esito) { coord.chiudi(); chiudiSheet(); disegna(); }
      },
    }),
  ]);
  apriSheetConChiusura(nome || (tipo === 'presidio' ? 'Presidio' : NOMI_LUOGO[tipo].nome), corpo, () => coord.chiudi());
}

function rinominaLuogo(tipo, id) {
  const p = permessiLuogo(tipo, id);
  const apri = () => formUbicazione(tipo, id);
  if (!p.serveAdmin) { apri(); return; }
  conAdmin(`Rinominare ${NOME_LUOGO_AZIONE[tipo]} che viene dall'ufficio`, apri)();
}

async function eliminaLuogo(tipo, id, nome) {
  const p = permessiLuogo(tipo, id);
  if (!p.eliminabile) { toast(p.motivo, 'toast-ko', 7000); return; }
  const fai = async () => {
    // Si CHIEDE, perché al rientro la riga sparisce dall'archivio dell'ufficio:
    // è l'unica azione dell'app che toglie qualcosa a qualcun altro.
    // Un'area porta via le sue ubicazioni vuote (26/09/2026): si DICE prima, per nome.
    const figlie = tipo === 'edificio'
      ? (S.get().perEntita[E.LOCALE] || []).filter((l) => l.edificio_id === id).map((l) => l.denominazione) : [];
    const ok = await conferma({
      titolo: `Elimina ${NOME_LUOGO_AZIONE[tipo]}`,
      messaggio: `«${nome}» sparirà dall'archivio quando il pacchetto rientra in ufficio.`,
      dettagli: ['Qui dentro non ci sono presidi, quindi non si perde nessun controllo.',
        ...(figlie.length ? [`Se ne ${figlie.length === 1 ? 'va' : 'vanno'} con lei ${figlie.length === 1 ? "l'ubicazione vuota" : `le ${figlie.length} ubicazioni vuote`}: ${figlie.join(', ')}.`] : []),
        "Si può annullare subito dal messaggio, finché è in vista."],
      ok: 'Elimina',
      variante: 'btn-pericolo',
    });
    if (!ok) return;
    const esito = await muta(() => S.eliminaUbicazione(tipo, id),
      `${NOME_LUOGO_AZIONE[tipo]} «${nome}» eliminata.`,
      { annullabile: true, dopoAnnulla: disegna });
    if (esito) disegna();
  };
  if (!p.serveAdmin) { await fai(); return; }
  conAdmin(`Eliminare ${NOME_LUOGO_AZIONE[tipo]} che viene dall'ufficio`, fai)();
}

/**
 * @param padreId  sotto quale ubicazione creare. Serve alla scheda dei luoghi,
 *                 dove si crea un edificio sotto un impianto qualunque
 *                 dell'albero — non sotto quello in cui si sta navigando.
 *                 Senza, l'unico modo di creare un locale sotto l'edificio X
 *                 era prima andarci dentro.
 */
function formUbicazione(tipo, id, padreId = '', bozza = null) {
  const st = S.get();
  const esistente = id
    ? (st.perEntita[{ impianto: E.IMPIANTO, edificio: E.EDIFICIO, locale: E.LOCALE }[tipo]] || [])
      .find((r) => r.id === id)
    : null;
  // `bozza`: quello che era scritto nel modulo prima di andare sulla mappa a
  // mettere la croce (25/09/2026). Vince su quello che c'è in archivio: è la
  // modifica che si sta facendo, non ancora salvata.
  const iniziale = (k) => (bozza && bozza[k] !== undefined ? bozza[k] : (esistente && esistente[k]) || '');

  const fNome = el('input', { type: 'text', value: iniziale('denominazione') });
  const campi = [campo('Denominazione', fNome)];

  let fPiano = null;
  let extra = {};
  if (tipo === 'locale') {
    fPiano = el('input', { type: 'text', value: iniziale('piano') });
    campi.push(campo('Piano', fPiano));
  }
  if (tipo === 'impianto') {
    // Solo i campi che servono davvero in campo. Indirizzo completo, SCIA e
    // codici attività si compilano in ufficio: chiederli qui, davanti a un
    // cancello, produce campi vuoti e basta.
    //
    // La tipologia è una scelta fra due, SEDE e SE (decisione dell'operatore del
    // 14/09/2026): scritta a mano diventava «SE», «Se», «RT», «SHELTER». Un
    // valore vecchio resta fra le voci e selezionato, così salvare senza
    // toccarlo non lo cambia; e l'ufficio non rifiuta un pacchetto che lo porta.
    const tipologiaAttuale = iniziale('tipologia');
    const vociTipologia = ['', 'SEDE', 'SE'];
    if (tipologiaAttuale && !vociTipologia.includes(tipologiaAttuale)) vociTipologia.push(tipologiaAttuale);
    extra = {
      tipologia: el('select', {}, vociTipologia.map((t) => el('option', {
        value: t,
        selected: t === tipologiaAttuale,
        testo: t === '' ? '—' : (t === 'SE' ? 'SE — stazione' : t === 'SEDE' ? 'SEDE' : `${t} (non più in uso)`),
      }))),
      comune: el('input', { type: 'text', value: iniziale('comune') }),
    };
    campi.push(campo('Tipologia', extra.tipologia), campo('Comune', extra.comune));
  }
  const fNote = el('textarea', { rows: '2', value: iniziale('note') });
  campi.push(campo('Note', fNote));

  // ⛔ LA POSIZIONE, con lo stesso pannello dei presidi (20/09/2026, richiesta
  // dell'operatore: «dai modo di modificare le ubicazioni usando la stessa
  // funzione di satellite usata per i presidi»).
  //
  // Stesso componente e non una copia: la scala della precisione, la lettura
  // migliore, i quattro modi di spegnere il GPS e le parole delle bande sono
  // già risolti là, e una seconda implementazione le farebbe divergere al primo
  // ritocco. Qui cambia solo il titolo.
  const pos = (bozza && bozza.coord) || {
    lat: (esistente && esistente.lat) || '',
    lon: (esistente && esistente.lon) || '',
    gps_accuratezza_m: (esistente && esistente.gps_accuratezza_m) || '',
    gps_rilevato_il: (esistente && esistente.gps_rilevato_il) || '',
  };
  const coord = U.bloccoCoordinate({
    coordinate: {
      lat: pos.lat || '', lon: pos.lon || '',
      accuratezza: pos.gps_accuratezza_m || null,
      rilevato_il: pos.gps_rilevato_il || '',
    },
    avvisa: (m) => toast(m, 'toast-ko', 7000),
    titolo: `Posizione ${NOMI_LUOGO[tipo].della || 'del luogo'}`,
    // ⛔ Anche A MANO, come altrove (25/09/2026, dall'operatore: «quando
    // creiamo un'area o un'ubicazione possiamo solo usare il gps»). La mappa sta
    // sotto i fogli: il modulo si chiude ricordando quello che è scritto, si
    // mette la croce, e il modulo si riapre con quella posizione — ancora da
    // salvare, come ogni altro campo del modulo.
    aMano: (valori) => {
      const b = {
        denominazione: fNome.value, note: fNote.value, coord: valori,
        ...(fPiano ? { piano: fPiano.value } : {}),
        ...(extra.tipologia ? { tipologia: extra.tipologia.value } : {}),
        ...(extra.comune ? { comune: extra.comune.value } : {}),
      };
      const padre = tipo === 'edificio' ? { impianto_id: padreId || dove.impiantoId }
        : tipo === 'locale' ? { edificio_id: padreId || dove.edificioId } : null;
      const partenza = S.haPosizione(valori) ? { lat: valori.lat, lon: valori.lon }
        : posizioneDelContenitore(tipo, esistente || padre);
      chiudiSheet();
      posizionaPerIlModulo({
        titolo: `📍 ${b.denominazione.trim() || NOMI_LUOGO[tipo].nuovo}`, partenza,
        onFine: (punto) => formUbicazione(tipo, id, padreId, {
          ...b, coord: punto ? campiPosizioneAMano({ tipo: 'luogo' }, punto) : b.coord,
        }),
      });
    },
  });
  campi.push(coord.nodo);

  const titolo = esistente
    ? `Rinomina ${NOMI_LUOGO[tipo].nome}` : NOMI_LUOGO[tipo].nuovo;

  apriSheetConChiusura(titolo, el('div', {}, [
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
            // La posizione entra nella STESSA modifica, quindi nello stesso
            // evento di giornale: in ufficio si legge chi l'ha presa e quando,
            // come per ogni altro dato.
            Object.assign(patch, coord.valori());
            // Un impianto posizionato da qui — satellite o croce — ha una posizione
            // RILEVATA: senza, la mappa continuerebbe a disegnarlo tratteggiato come
            // «ricavata dall'indirizzo» (stessa regola di `campiPosizioneAMano`).
            if (tipo === 'impianto' && patch.lat
              && (String(patch.lat) !== String(esistente.lat || '') || String(patch.lon) !== String(esistente.lon || ''))) {
              patch.coordinate_origine = 'RILIEVO';
            }
            S.modificaUbicazione(tipo, id, patch);
            return { messaggio: 'Ubicazione aggiornata.' };
          }
          if (tipo === 'impianto') {
            const creato = S.creaImpianto({
              denominazione: fNome.value, note: fNote.value.trim(),
              tipologia: extra.tipologia.value.trim(), comune: extra.comune.value.trim(),
              ...coord.valori(),
            });
            dove = { impiantoId: creato.id, edificioId: '', localeId: '' };
            return { messaggio: 'Impianto creato.' };
          }
          if (tipo === 'edificio') {
            const creato = S.creaEdificio({
              impianto_id: padreId || dove.impiantoId,
              denominazione: fNome.value, note: fNote.value.trim(),
              ...coord.valori(),
            });
            if (!padreId) dove = { ...dove, edificioId: creato.id, localeId: '' };
            return { messaggio: NOMI_LUOGO.edificio.creato };
          }
          S.creaLocale({
            edificio_id: padreId || dove.edificioId, denominazione: fNome.value,
            piano: fPiano.value.trim(), note: fNote.value.trim(),
            ...coord.valori(),
          });
          return { messaggio: NOMI_LUOGO.locale.creato };
        }, null);
        if (esito) { toast(esito.messaggio, 'toast-ok'); chiudiSheet(); }
      },
    }),
  ]), () => coord.chiudi());
}

function barraRicerca() {
  const input = el('input', {
    type: 'search', inputmode: 'search', placeholder: 'Codice, matricola, #ID, ubicazione…',
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
    ...filtri, soloDaControllare: false, soloControllati: false, soloSospesi: false,
    impiantoId: dove.impiantoId, edificioId: dove.edificioId,
    localeId: dove.localeId === '__tutti__' ? '' : dove.localeId,
  }).filter((a) => vistaTotale || S.nelPerimetro(a));
  const trattati = senzaIlFiltro.filter((a) => S.controllato(a.id));
  const nSospesi = trattati.filter((a) => S.conVerificheNonEseguibili(a.id)).length;
  // Le quattro viste si spartiscono i presidi: da fare + fatti + sospesi = tutti.
  const conteggi = { totale: senzaIlFiltro.length, fatti: trattati.length - nSospesi, sospesi: nSospesi,
    daFare: senzaIlFiltro.length - trattati.length };

  // La barra IN ALTO: quanto manca nell'impianto e nelle tipologie scelte. Non
  // dipende da quello che si sta cercando né dalla vista (da controllare /
  // controllati): è la misura del lavoro, e non deve cambiare scrivendo.
  const ambitoGiro = S.cerca({
    impiantoId: dove.impiantoId, edificioId: dove.edificioId,
    localeId: dove.localeId === '__tutti__' ? '' : dove.localeId,
    categorie: filtri.categorie,
  }).filter((a) => vistaTotale || S.nelPerimetro(a));
  const nomeAmbito = [
    dove.impiantoId ? ((S.indici.impianti.get(dove.impiantoId) || {}).denominazione || 'impianto') : 'tutti gli impianti',
    dove.edificioId ? (S.indici.edifici.get(dove.edificioId) || {}).denominazione : null,
    filtri.categorie.length === 1 ? ((S.indici.categorie.get(filtri.categorie[0]) || {}).descrizione || filtri.categorie[0])
      : (filtri.categorie.length > 1 ? `${filtri.categorie.length} tipologie` : null),
  ].filter(Boolean).join(' · ');

  // L'intestazione, e perché è la stessa su telefono e su schermo largo
  // (operatore, 17/09/2026).
  //
  // Prima c'erano due regimi: sul telefono i filtri stavano dietro un pulsante,
  // su schermo largo restavano aperti in pagina («lì lo spazio c'è»). Due difetti,
  // entrambi visti in uso:
  //
  //  * l'avanzamento compariva DUE VOLTE — la forma compatta in alto e quella
  //    intera dentro i filtri estesi — con lo stesso ambito scritto sotto
  //    entrambe. Due righe che dicono la stessa cosa si leggono come due misure
  //    diverse, e chi legge cerca la differenza;
  //  * ventidue tipologie aperte in pagina occupavano più spazio dell'elenco che
  //    dovevano filtrare, e su questo schermo l'elenco È la schermata.
  //
  // Adesso: un regime solo, il pulsante «Filtri» a ogni larghezza, e l'intestazione
  // che scorre via con la pagina. «Lo spazio c'è» non è una buona ragione per
  // occuparlo con comandi che si usano una volta ogni tanto.
  const attivi = (filtri.soloNonConformi ? 1 : 0) + (filtri.soloIdonei ? 1 : 0)
    + (filtri.soloConAnomalie ? 1 : 0) + (filtri.categorie.length ? 1 : 0) + (filtri.posizione ? 1 : 0);
  const avanzamento = {
    fatti: ambitoGiro.filter((a) => S.controllato(a.id)).length,
    totale: ambitoGiro.length,
    ambito: nomeAmbito,
  };

  const pezziFiltri = () => [
    barraGiro(avanzamento),
    el('div', { class: 'filtro-caselle' }, [
      // «Idonei» accanto a «Non idonei» (17/09/2026): mancava, e senza di lui
      // l'unico modo di vedere i pezzi a posto era togliere ogni filtro, cioè
      // guardarli insieme a quelli che non lo sono.
      casellaFiltro('Idonei', filtri.soloIdonei, (v) => {
        filtri.soloIdonei = v; limiteElenco = 60; disegna();
      }),
      casellaFiltro('Non idonei', filtri.soloNonConformi, (v) => {
        filtri.soloNonConformi = v; limiteElenco = 60; disegna();
      }),
      casellaFiltro('Con anomalie', filtri.soloConAnomalie, (v) => {
        filtri.soloConAnomalie = v; limiteElenco = 60; disegna();
      }),
    ]),
    // ⛔ La POSIZIONE (24/09/2026, richiesta dell'operatore): solo quelli sulla
    // mappa, o solo quelli a cui manca. Le due caselle si ESCLUDONO — accenderne
    // una spegne l'altra — perché insieme darebbero sempre un elenco vuoto. Il
    // numero accanto conta il luogo e le tipologie in cui si è, così si sa
    // quanti ne restano da geolocalizzare prima di spuntare.
    (() => {
      const conPos = ambitoGiro.filter((a) => S.haPosizione(a)).length;
      // ⚠️ Il pannello è un FOGLIO e `disegna()` non lo rifà: accendendo una
      // casella, l'altra va spenta a mano, o resterebbe spuntata mentre il
      // filtro è l'altro.
      const caselle = {};
      const scegli = (valore) => (v) => {
        filtri.posizione = v ? valore : '';
        for (const [k, nodo] of Object.entries(caselle)) {
          const acceso = filtri.posizione === k;
          const chk = nodo.querySelector ? nodo.querySelector('input') : null;
          if (chk) chk.checked = acceso;
          nodo.classList.toggle('attiva', acceso);
        }
        limiteElenco = 60; disegna();
      };
      caselle.con = casellaFiltro(`📍 Sulla mappa (${conPos})`, filtri.posizione === 'con', scegli('con'));
      caselle.senza = casellaFiltro(`Senza posizione (${ambitoGiro.length - conPos})`, filtri.posizione === 'senza', scegli('senza'));
      return el('div', { class: 'filtro-caselle' }, [caselle.con, caselle.senza]);
    })(),
    // ⚠️ IL TERZO GRUPPO, dichiarato (20/09/2026). Dal momento in cui «Non
    // idonei» vuol dire davvero NON_IDONEO — e non «tutto ciò che non è
    // idoneo» — le due caselle non partizionano più: restano fuori le
    // postazioni che non devono avere niente e quelle fuori servizio. Sono
    // decisioni di una persona, non difetti, e il loro posto non è fra le cose
    // da riparare. Ma vanno DETTE, o due caselle che non fanno il totale
    // nascondono qualcuno senza dirlo — è lo stesso difetto dei numeri della
    // home, dove il terzo addendo stava in una nota staccata.
    (() => {
      const fuori = S.cerca({}).filter((a) => {
        const st = S.idoneita(a).stato;
        return st !== 'IDONEO' && st !== 'NON_IDONEO';
      }).length;
      return fuori ? el('div', { class: 'mini', style: 'margin:2px 2px 8px', testo:
        `Altri ${fuori} presidi non sono né idonei né non idonei: non previsti, `
        + 'fuori servizio o rimossi. Sono decisioni, non difetti.' }) : null;
    })(),
    selettoreCategoria(categorie),
  ];

  return el('div', { class: 'cerca-wrap' }, [
    briciole(),
    // Le note dell'area e dell'ubicazione in cui si è (25/09/2026): scritte in
    // anagrafica, finora si leggevano solo aprendo «Rinomina».
    filtri.testo ? null : riquadroNoteDelPercorso(noteDelPercorso(dove,
      (tipo, id) => S.indici[{ edificio: 'edifici', locale: 'locali' }[tipo]].get(id), S.SENZA_LUOGO)),
    barraGiro({ ...avanzamento, compatta: true }),
    el('div', { class: 'cerca-riga' }, [
      input,
      // ⛔ La croce per svuotare (21/09/2026, richiesta dell'operatore).
      // `type: 'search'` la disegna da sé su alcuni browser e NON su iOS in una
      // PWA installata, che è dove quest'app vive: lì l'unico modo di togliere
      // «UISUV-3» era cancellare otto caratteri con il pollice, e la ricerca si
      // ridisegna a ogni tasto. Un bersaglio da 44px la toglie in un tocco.
      filtri.testo ? el('button', {
        class: 'btn btn-piccolo cerca-svuota', type: 'button', testo: '✕',
        'aria-label': 'Cancella quello che hai cercato',
        onclick: () => {
          filtri.testo = '';
          limiteElenco = 60;
          disegna();
          const nuovo = document.querySelector('.cerca-riga input');
          if (nuovo) nuovo.focus();
        },
      }) : null,
      el('button', {
        class: 'btn btn-piccolo', type: 'button',
        'aria-label': `Filtri e avanzamento${attivi ? `, ${attivi} attivi` : ''}`,
        onclick: () => apriSheet('Filtri e avanzamento', el('div', {}, pezziFiltri())),
      }, [
        el('span', { 'aria-hidden': 'true', testo: '⚙︎ Filtri' }),
        attivi ? el('span', { class: 'pallino-conta', testo: String(attivi) }) : null,
      ].filter(Boolean)),
      el('button', {
        class: 'btn btn-primario btn-piccolo', type: 'button',
        'aria-label': 'Aggiungi un presidio non censito', onclick: formNuovoPresidio,
      }, [
        el('span', { testo: '+' }),
        el('span', { class: 'solo-largo', testo: ' Nuovo' }),
      ]),
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
    // Tre scelte e non due (15/09/2026): anche «Controllati», per rivedere quello
    // che è stato fatto e rimetterlo fra i da controllare se serve.
    sceltaVistaGiro(conteggi,
      filtri.soloDaControllare ? 'da'
        : (filtri.soloControllati ? 'fatti' : (filtri.soloSospesi ? 'sospesi' : 'tutti')),
      (k) => {
        filtri.soloDaControllare = k === 'da';
        filtri.soloControllati = k === 'fatti';
        filtri.soloSospesi = k === 'sospesi';
        limiteElenco = 60; disegna();
      }),
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
 * Dove sono, e come torno su.
 *
 * In campo la domanda non è "come si chiama questo locale in anagrafica" ma
 * "sono qui, cosa c'è qui": scendere per livelli è il modo naturale, cercare
 * per stringa presuppone di ricordarsi la denominazione esatta.
 *
 * Dal 16/09/2026 (operatore: «queste etichette non dicono che si può andare
 * avanti e indietro»): il primo elemento è un pulsante che dice DOVE PORTA —
 * «‹ Su a ACCIAIOLO», non una freccia muta — e il livello in cui si è sta in
 * fondo, evidenziato, con davanti la parola «sei in». Tre chip tutti uguali, di
 * cui uno colorato, si leggevano come un titolo: nessuno li toccava.
 */
function briciole() {
  if (!dove.impiantoId && !filtri.testo && !filtri.categorie.length) return el('div', { hidden: true });

  const vai = (d) => { dove = d; limiteElenco = 60; disegna(); };
  // I livelli, dalla radice in giù. Li costruisce `luoghi.js`, dove una prova
  // può eseguirli: il difetto che questa riga sostituisce era un gradino che
  // spariva quando il suo nome non si trovava in anagrafica.
  const mappe = { impianto: 'impianti', edificio: 'edifici', locale: 'locali' };
  const livelli = livelliDiPercorso(dove,
    (tipo, id) => (S.indici[mappe[tipo]].get(id) || {}).denominazione,
    { valore: S.SENZA_LUOGO, ...S.NOME_SENZA });
  const qui = livelli[livelli.length - 1];
  const sopra = livelli[livelli.length - 2];

  const pezzi = [];
  if (sopra) {
    // «‹ Su a ACCIAIOLO» quando si sale di un livello; alla radice basta «‹ Tutti
    // gli impianti», perché «su a tutti gli impianti» è più lungo e dice meno —
    // e su un telefono quella riga in più costa un centimetro di elenco.
    pezzi.push(el('button', {
      class: 'briciola briciola-su', type: 'button',
      'aria-label': `Sali a ${sopra.nome}`,
      onclick: () => vai(sopra.dove),
    }, [
      el('span', { 'aria-hidden': 'true', testo: '‹ ' }),
      sopra.radice ? null : el('span', { class: 'briciola-su-etichetta', testo: 'Su a ' }),
      el('span', { testo: sopra.nome }),
    ].filter(Boolean)));
  }
  pezzi.push(el('span', { class: 'briciola-qui-etichetta', testo: 'sei in' }));
  pezzi.push(el('span', { class: 'briciola briciola-attiva', testo: qui.nome }));
  // Gli antenati oltre il primo restano raggiungibili con un tocco: da un locale
  // si torna all'impianto senza passare per l'edificio.
  for (const l of livelli.slice(0, -2)) {
    pezzi.push(el('button', {
      class: 'briciola briciola-antenato', type: 'button',
      'aria-label': `Vai a ${l.nome}`, testo: l.nome, onclick: () => vai(l.dove),
    }));
  }
  return el('nav', { class: 'briciole', 'aria-label': 'Dove sei e come risalire' }, pezzi);
}

/** La vista del giro scelta sopra l'elenco: 'da' | 'fatti' | 'sospesi' | 'tutti'. */
function vistaGiroAttiva() {
  if (filtri.soloDaControllare) return 'da';
  if (filtri.soloControllati) return 'fatti';
  if (filtri.soloSospesi) return 'sospesi';
  return 'tutti';
}

function navigazione() {
  // ⛔ Quali luoghi si vedono dipende dalla VISTA (23/09/2026, richiesta
  // dell'operatore):
  //  * «Tutti» e «Da fare»: anche i luoghi senza presidi con questo filtro,
  //    spenti ma toccabili (`conVuoti`) — in «Da fare» servono per vederli
  //    TUTTI, compresi quelli finiti;
  //  * «Fatti» e «Sospesi»: solo i luoghi che ne contengono. Un elenco di
  //    luoghi grigi in cui non c'è niente di fatto non risponde alla domanda
  //    «dove ho lavorato», la seppellisce.
  const vista = vistaGiroAttiva();
  const alb = S.albero(filtri, { conVuoti: vista === 'da' || vista === 'tutti' });
  // In «Da fare» un luogo spento può essere vuoto davvero o FINITO: si dice quale.
  const presenze = vista === 'da' ? S.presenzeNeiLuoghi(filtri) : null;
  const finito = (id) => {
    const n = presenze && presenze.get(id);
    if (!n || !n.presidi) return null;
    return n.sospesi
      ? `niente da fare qui · ${n.sospesi} ${n.sospesi === 1 ? 'sospeso' : 'sospesi'}`
      : '✓ tutto fatto qui';
  };
  const frag = document.createDocumentFragment();

  if (!dove.impiantoId) {
    // `elenco-impianti`: un impianto si stacca dal successivo (filetto rosso a
    // sinistra, nome più grande, aria in mezzo). Erano righe uguali una sopra
    // l'altra e il confine fra un impianto e il prossimo si perdeva —
    // segnalato dall'operatore il 17/09/2026.
    const voci = (lista) => el('ul', { class: 'elenco elenco-impianti' }, lista.map((i) => conLato(
      voceNavigazione(i.nome, i, () => {
        dove = { impiantoId: i.id, edificioId: '', localeId: '' }; disegna();
      }, i.tipologia, finito(i.id)),
      pulsanteMappaOPosizione('impianto', S.indici.impianti.get(i.id), i.nome),
    )));
    // Il pacchetto contiene tutti gli impianti; quelli su cui l'ufficio ha
    // chiesto di lavorare vengono prima, con il loro titolo, e gli altri restano
    // raggiungibili sotto. `albero()` li ha già messi in testa.
    const previsti = alb.filter((i) => i.previsto);
    if (!previsti.length) {
      frag.append(el('div', { class: 'mini', style: 'margin:4px 0 8px',
        testo: `${alb.length} impianti nel giro. Tocca per entrare.` }));
      frag.append(voci(alb));
      return frag;
    }
    const altri = alb.filter((i) => !i.previsto);
    frag.append(el('h3', { class: 'titolo-previsti', testo: `★ Previsti per questo giro (${previsti.length})` }));
    frag.append(voci(previsti));
    if (altri.length) {
      frag.append(el('h3', { class: 'titolo-altri', testo: `Altri impianti (${altri.length})` }));
      frag.append(voci(altri));
    }
    return frag;
  }

  const imp = alb.find((i) => i.id === dove.impiantoId);
  if (!imp) { frag.append(vuoto('🔍', 'Nessun presidio qui con questo filtro')); return frag; }

  if (!dove.edificioId) {
    frag.append(el('ul', { class: 'elenco' }, imp.edifici.map((e) => conLato(
      voceNavigazione(e.nome, e, () => {
        dove = { ...dove, edificioId: e.id, localeId: '' }; disegna();
      }, `${e.locali.length} ubicazion${e.locali.length === 1 ? 'e' : 'i'}`, finito(e.id)),
      pulsanteMappaOPosizione('edificio', S.indici.edifici.get(e.id), e.nome, imp.nome),
    ))));
    frag.append(bottoneTuttoQui(imp.totale, imp.nome));
    return frag;
  }

  const edi = imp.edifici.find((e) => e.id === dove.edificioId);
  if (!edi) { frag.append(vuoto('🔍', 'Nessun presidio qui')); return frag; }

  frag.append(el('ul', { class: 'elenco' }, edi.locali.map((l) => conLato(
    // `l.id` adesso è sempre un valore vero, anche per «(senza ubicazione)»:
    // il ripiego `|| '__tutti__'` mostrava TUTTI i presidi dell'area invece di
    // quelli senza ubicazione — un'altra domanda, con la stessa faccia.
    voceNavigazione(l.nome, l, () => { dove = { ...dove, localeId: l.id }; disegna(); },
      l.piano, finito(l.id)),
    pulsanteMappaOPosizione('locale', S.indici.locali.get(l.id), l.nome, `${imp.nome} › ${edi.nome}`),
  ))));
  frag.append(bottoneTuttoQui(edi.totale, edi.nome));
  return frag;
}

/**
 * Il pezzo montato su questa postazione: che cosa c'è, e il gesto per cambiarlo.
 *
 * Perché un blocco a sé e non un campo dell'anagrafica (18/09/2026). Matricola e
 * anno erano già modificabili dalla scheda, senza traccia: cambiandoli si
 * sostituiva già un pezzo, e tutta la storia dei controlli del vecchio restava
 * attaccata al nuovo. Qui il cambio diventa un fatto registrato — chi è uscito,
 * chi è entrato, perché — e la fotografia del pezzo uscito permette di tornare
 * indietro.
 */
function bloccoPezzo(a, ridisegna) {
  const aperta = S.sostituzioneAperta(a.id);
  const box = el('div', { class: `card card-piatta${aperta ? ' card-attenzione' : ''}`,
    style: 'margin-bottom:10px' });

  if (aperta) {
    box.append(el('h3', { style: 'margin-top:0', testo: '⏳ Qui c\'è un pezzo temporaneo' }));
    box.append(el('div', { class: 'mini', testo:
      `Dal ${dataIt(aperta.data)} — matricola ${aperta.matricola_entrata || '—'}. `
      + `Il nostro (${aperta.matricola_uscita || '—'}) è uscito `
      + `${MOTIVO_SOSTITUZIONE[aperta.motivo_codice] || 'per altro'}`
      + (aperta.rientro_atteso ? `, atteso il ${dataIt(aperta.rientro_atteso)}` : '') + '.' }));
    box.append(el('button', {
      class: 'btn btn-blocco', type: 'button', style: 'margin-top:8px',
      testo: '↩ È cambiato: dimmi che pezzo c\'è adesso',
      onclick: () => formChiudiSostituzione(a, aperta, ridisegna),
    }));
    return box;
  }

  box.append(el('h3', { style: 'margin-top:0', testo: 'Il pezzo montato' }));
  box.append(el('div', { class: 'mini', testo: a.matricola
    ? `Matricola ${a.matricola}${a.anno_costruzione ? ` · ${a.anno_costruzione}` : ''}`
    : 'Nessuna matricola registrata.' }));
  const storia = S.sostituzioniDi(a.id);
  if (storia.length) {
    box.append(el('div', { class: 'mini', style: 'color:var(--testo-tenue)',
      testo: `${storia.length} cambi registrati, l'ultimo il ${dataIt(storia[0].data)}.` }));
  }
  box.append(el('button', {
    class: 'btn btn-blocco', type: 'button', style: 'margin-top:8px',
    testo: '↔ Il pezzo è stato sostituito',
    onclick: () => formSostituisciPezzo(a, ridisegna),
  }));
  return box;
}

// Le parole con cui si legge un motivo, e quale motivo fa pensare a un muletto.
// La TEMPORANEA si deduce dal motivo e non dalla categoria: un giorno potrebbero
// portare via una centralina e lasciarne una di scorta, e una tabella «chi può
// avere il muletto» sarebbe sbagliata quel giorno.
const MOTIVO_SOSTITUZIONE = {
  RITIRO_REVISIONE: 'per la revisione',
  RITIRO_COLLAUDO: 'per il collaudo',
  GUASTO: 'perché guasto',
  FINE_VITA: 'per fine vita',
  ALTRO: 'per altro',
};
const MOTIVI_TEMPORANEI = ['RITIRO_REVISIONE', 'RITIRO_COLLAUDO'];

/**
 * @param motivo  già scelto, quando si arriva da una ragione precisa: dalla
 *                voce di fine vita di un controllo si arriva con FINE_VITA.
 */
function formSostituisciPezzo(a, ridisegna, { motivo = '' } = {}) {
  const fMotivo = scelte([
    { valore: 'RITIRO_REVISIONE', testo: 'Ritirato per revisione' },
    { valore: 'RITIRO_COLLAUDO', testo: 'Ritirato per collaudo' },
    { valore: 'GUASTO', testo: 'Guasto' },
    { valore: 'FINE_VITA', testo: 'Fine vita' },
    { valore: 'ALTRO', testo: 'Altro' },
  ], motivo, { onCambia: () => aggiornaTemporanea() });

  const fMatricola = el('input', { type: 'text', autocomplete: 'off',
    placeholder: 'La matricola che leggi sull\'etichetta' });
  const fAnno = campoNumerico({ min: 1950, max: new Date().getFullYear(),
    placeholder: `Es. ${new Date().getFullYear() - 2}` });
  const fData = el('input', { type: 'date', value: S.oggiIso() });
  const fNote = el('textarea', { placeholder: 'Che cosa è successo' });

  const boxTemporanea = el('div', {});
  const boxDichiarati = el('div', {});
  let temporanea = false;
  let fRientro = null;

  // I piani legati al PEZZO: revisione, collaudo, fine vita. Le loro date il
  // pezzo nuovo se le porta dietro, e senza di esse le scadenze non ripartono da
  // lui — l'operatore ha chiesto proprio che siano le sue.
  const pianiDelPezzo = S.controlliApplicabili(a)
    .filter((c) => PV.CONTROLLI_DICHIARABILI.includes(c.codice));
  const campiDichiarati = new Map();

  function aggiornaTemporanea() {
    const m = fMotivo.valore;
    temporanea = MOTIVI_TEMPORANEI.includes(m);
    svuotaNodo(boxTemporanea);
    if (!m) return;
    if (m === 'FINE_VITA') {
      boxTemporanea.append(el('div', { class: 'mini',
        testo: 'Una fine vita non è temporanea: il pezzo non rientra.' }));
      return;
    }
    const cas = casellaFiltro('Il nostro pezzo deve tornare (muletto)', temporanea, (v) => {
      temporanea = v; aggiornaTemporanea();
    });
    boxTemporanea.append(cas);
    if (temporanea) {
      fRientro = fRientro || campoData({ annoMin: new Date().getFullYear(), annoMax: new Date().getFullYear() + 3 });
      boxTemporanea.append(campo('Quando dovrebbe tornare (facoltativo)', fRientro));
    } else {
      fRientro = null;
    }
  }

  svuotaNodo(boxDichiarati);
  if (pianiDelPezzo.length) {
    boxDichiarati.append(el('div', { class: 'mini', style: 'margin-top:10px', testo:
      'Che cosa il pezzo nuovo si porta dietro. Sono le date sulla sua etichetta: '
      + 'da qui ripartono le sue scadenze. Se non le sai, lascia vuoto — meglio '
      + '«non calcolabile» che le date di un altro pezzo.' }));
    for (const c of pianiDelPezzo) {
      // Tre menù e non il calendario (23/09/2026): vedi `campoData`.
      const inp = campoData();
      campiDichiarati.set(c.codice, inp);
      // ⚠️ `c.controllo` NON ESISTE su ciò che restituisce `controlliApplicabili`
      // (il campo si chiama `descrizione`), quindi il ripiego scattava sempre e
      // l'operatore leggeva il CODICE grezzo: «Ultimo «ROTTAMAZIONE»».
      boxDichiarati.append(campo(`Ultima «${c.descrizione || c.codice}»`, inp));
    }
  }

  aggiornaTemporanea();

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo:
      `Adesso c'è la matricola ${a.matricola || '—'}`
      + `${a.anno_costruzione ? ` (${a.anno_costruzione})` : ''}. `
      + 'Resta scritta nello storico di questa postazione.' }),
    campo('Perché è stato sostituito', fMotivo),
    boxTemporanea,
    campo('Matricola del pezzo nuovo', fMatricola),
    el('div', { class: 'campi campi-2' }, [
      campo('Anno di costruzione', fAnno),
      campo('Data', fData),
    ]),
    boxDichiarati,
    campo('Note', fNote),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Registra la sostituzione',
        onclick: async () => {
          if (!fMotivo.valore) { toast('Dimmi perché è stato sostituito.', 'toast-ko'); return; }
          if (!fMatricola.value.trim()) {
            toast('Scrivi la matricola del pezzo nuovo: senza, non si distingue dal '
              + 'vecchio e la storia dei controlli resta attaccata a lui.', 'toast-ko', 7000);
            return;
          }
          const dichiarati = [];
          for (const [codice, inp] of campiDichiarati) {
            if (inp.value) dichiarati.push({ tipo_controllo_codice: codice, data: inp.value });
          }
          const fatto = await muta(() => {
            const so = S.sostituisciPezzo(a.id, {
              matricola_entrata: fMatricola.value.trim(),
              motivo_codice: fMotivo.valore,
              temporanea,
              rientro_atteso: fRientro ? fRientro.value : '',
              data: fData.value || S.oggiIso(),
              note: fNote.value.trim(),
              pezzo: { anno_costruzione: fAnno.value || '' },
            });
            // Le date dichiarate diventano esecuzioni del pezzo NUOVO: il motore
            // ancora le scadenze all'ultima esecuzione, quindi una data che non
            // entra come esecuzione non sposta niente.
            for (const d of dichiarati) {
              S.registraIntervento(a.id, {
                tipo_controllo_codice: d.tipo_controllo_codice, data: d.data,
                esito: 'IDONEO',
                descrizione: 'Dichiarato alla sostituzione del pezzo: esecuzione del '
                  + 'pezzo montato ora, non verificata da noi.',
              });
            }
            return so;
          }, 'Sostituzione registrata');
          if (!fatto) return;
          chiudiSheet();
          schedaPresidio(a.id);
        },
      }),
    ]),
  ]);
  apriSheetConChiusura('Il pezzo è stato sostituito', corpo, () => {});
}

function formChiudiSostituzione(a, so, ridisegna) {
  const fMatricola = el('input', { type: 'text', autocomplete: 'off',
    placeholder: 'La matricola che leggi adesso sull\'etichetta' });
  const fAnno = campoNumerico({ min: 1950, max: new Date().getFullYear() });
  const fData = el('input', { type: 'date', value: S.oggiIso() });
  const esito = el('div', { class: 'mini', style: 'margin-top:6px' });

  // Si chiede la MATRICOLA e non «è rientrato sì/no»: la ditta lavora a rotazione
  // su più sedi e solo questa usa Scudo, quindi può riportare un estintore mai
  // visto qui. Chi è in campo legge l'etichetta; la conclusione la ricava l'app,
  // e la DICE, così l'operatore può correggere se ha letto male.
  const aggiorna = () => {
    const v = fMatricola.value.trim();
    if (!v) { esito.textContent = ''; return; }
    if (v === String(so.matricola_uscita || '').trim()) {
      esito.textContent = '✓ È tornato il nostro pezzo: rimetto i suoi dati com\'erano.';
    } else if (v === String(so.matricola_entrata || '').trim()) {
      esito.textContent = '→ È rimasto il pezzo temporaneo: chiudo il sospeso e '
        + 'lascio tutto com\'è.';
    } else {
      esito.textContent = '⚠ È un pezzo che qui non è mai stato: registro un cambio '
        + 'nuovo, e resta scritto che il nostro non è rientrato.';
    }
  };
  fMatricola.addEventListener('input', aggiorna);

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo:
      `Il nostro pezzo (${so.matricola_uscita || '—'}) è uscito il ${dataIt(so.data)} `
      + `${MOTIVO_SOSTITUZIONE[so.motivo_codice] || ''}. `
      + `Al suo posto è stato montato ${so.matricola_entrata || '—'}.` }),
    campo('Che matricola c\'è adesso', fMatricola),
    esito,
    el('div', { class: 'campi campi-2' }, [
      campo('Anno di costruzione (se è un pezzo nuovo)', fAnno),
      campo('Data', fData),
    ]),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Registra',
        onclick: async () => {
          if (!fMatricola.value.trim()) {
            toast('Dimmi che matricola c\'è adesso: senza, non si sa se è tornato '
              + 'il nostro o se ne è arrivato un altro.', 'toast-ko', 7000);
            return;
          }
          const fatto = await muta(() => S.chiudiSostituzione(so.id, {
            matricola_presente: fMatricola.value.trim(),
            data: fData.value || S.oggiIso(),
            pezzo: { anno_costruzione: fAnno.value || '' },
          }), 'Registrato');
          if (!fatto) return;
          chiudiSheet();
          schedaPresidio(a.id);
        },
      }),
    ]),
  ]);
  apriSheetConChiusura('Che pezzo c\'è adesso', corpo, () => {});
}

/**
 * @param finito  in «Da fare», per un luogo spento che i presidi li HA ma sono
 *                tutti fatti: la frase da mostrare al posto di «nessun presidio».
 */
/**
 * Una riga dell'elenco con il suo pulsante DI LATO, come quelle dei presidi
 * (24/09/2026): la voce a sinistra, il pulsante in colonna a destra. Senza
 * pulsante (le voci «(senza area)», che non sono un luogo) la riga è quella di
 * sempre.
 */
function conLato(voce, pulsante) {
  return pulsante
    ? el('li', { class: 'voce-riga' }, [voce, el('div', { class: 'voce-lato' }, [pulsante])])
    : el('li', {}, [voce]);
}

function voceNavigazione(nome, nodo, onclick, sottotitolo, finito = null) {
  const completo = nodo.totale > 0 && nodo.controllati === nodo.totale;
  // Un luogo SENZA presidi si vede e si tocca (17/09/2026, richiesta
  // dell'operatore). Prima spariva, e un'ubicazione vuota si comportava come
  // un'ubicazione inesistente: per censire il pezzo che il rilievo non aveva
  // registrato bisognava crearlo altrove e poi spostarlo. Resta però
  // riconoscibile — fondo più scuro, «nessun presidio» al posto dei conteggi —
  // perché un elenco in cui i luoghi pieni e i vuoti si somigliano fa contare i
  // luoghi sbagliati.
  const vuotoQui = nodo.totale === 0;
  return el('button', {
    class: `voce${nodo.previsto ? ' voce-prevista' : ''}${vuotoQui ? ' voce-vuota' : ''}`,
    type: 'button', onclick,
  }, [
    el('span', { class: `barra-stato ${completo ? 'ok' : nodo.controllati ? 'attenzione' : ''}` }),
    el('span', { class: 'voce-corpo' }, [
      el('div', { class: 'voce-titolo', testo: nome }),
      sottotitolo ? el('div', { class: 'voce-sotto', testo: sottotitolo }) : null,
      vuotoQui ? null : barraAvanzamento(nodo.controlli_fatti, nodo.controlli_previsti),
      el('div', { class: 'voce-tag' }, vuotoQui
        ? [
          nodo.previsto ? tag('★ previsto', 'tag-blu') : null,
          // Non un'assenza muta: dice che cosa si può fare, che è il motivo per
          // cui questa voce esiste ancora.
          // ⛔ …a meno che i presidi CI SIANO e siano tutti fatti (vista «Da
          // fare», 23/09/2026): allora «nessun presidio» è falso, e diceva di
          // aggiungerne proprio dove si era appena finito.
          finito ? tag(finito, 'tag-verde') : tag('nessun presidio — entra per aggiungerne', 'tag-grigio'),
        ].filter(Boolean)
        : [
          nodo.previsto ? tag('★ previsto', 'tag-blu') : null,
          tag(`${nodo.controlli_fatti}/${nodo.controlli_previsti} controlli`, completo ? 'tag-verde' : ''),
          nodo.controllati ? tag(`${nodo.controllati}/${nodo.totale} presidi finiti`) : null,
          // «presidi in tutto» e non «pezzi» (17/09/2026): l'operatore chiama
          // presidio il pezzo che ha davanti, non la riga d'anagrafica. «In
          // tutto» distingue questo numero — la somma delle quantità — da quello
          // delle schede, che compare accanto come rapporto.
          // ⚠️ DUE numeri, non uno (19/09/2026, segnalazione dell'operatore: il
          // nodo diceva «24 presidi in tutto» e aprendolo c'era UNA riga, gli
          // schiumogeni da 24 pezzi). «Presidio» è il pezzo, nel linguaggio di
          // chi lavora; «scheda» è la riga d'anagrafica su cui si registra. Sono
          // due numeri diversi e vanno scritti tutti e due, o quello mancante
          // viene ricostruito a mente — sbagliato.
          nodo.presidi !== nodo.totale
            ? tag(`${nodo.presidi} presidi su ${nodo.totale} ${nodo.totale === 1 ? 'scheda' : 'schede'}`)
            : null,
          // ⛔ Via «N da sistemare» (20/09/2026): misurato, era lo STESSO
          // insieme di «N anomalie» — 214 contro 210, e i quattro di
          // differenza erano NON_PREVISTO, cioè una decisione, non un difetto.
          // Due pastiglie che dicono lo stesso numero fanno cercare la
          // differenza che non c'è; e una sbagliata su quattro insegna a non
          // fidarsi anche delle altre.
          nodo.guasti ? tag(`${nodo.guasti} guasti`, 'tag-rosso') : null,
          nodo.anomalie ? tag(`${nodo.anomalie} anomalie`, 'tag-ambra') : null,
        ].filter(Boolean)),
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
    (filtri.testo || filtri.categorie.length || filtri.soloNonConformi || filtri.soloIdonei
      || filtri.soloConAnomalie || filtri.soloDaControllare || filtri.soloControllati || filtri.soloSospesi
      || filtri.posizione)
      ? el('button', {
        class: 'btn btn-piccolo', type: 'button', testo: 'azzera filtri',
        onclick: () => {
          filtri = { testo: '', categorie: [], soloNonConformi: false,
            soloConAnomalie: false, soloDaControllare: false, soloControllati: false, soloSospesi: false,
            posizione: '' };
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
  // ⛔ Solo dentro un GRUPPO OMOGENEO (21/09/2026, segnalazione dell'operatore:
  // «appare sempre, avevamo detto di nasconderlo»).
  //
  // Il commento qui sopra dice a che cosa serve — dodici lampade nello stesso
  // locale — e il codice non lo diceva: bastava che ci fosse più di un presidio
  // da fare, quindi compariva sull'elenco intero, ottocento presidi di dodici
  // tipologie sparsi su trenta impianti. Un pulsante che promette un'azione di
  // gruppo su un gruppo che non esiste è peggio che assente: premuto una volta
  // per curiosità, apre un modulo che l'operatore non può completare.
  //
  // «Omogeneo» vuol dire due cose insieme: si sta guardando UN'UBICAZIONE
  // precisa, e i presidi da fare sono di UNA sola categoria. Senza la seconda
  // condizione un locale con tre lampade e un estintore riproporrebbe lo stesso
  // problema in piccolo — il modulo chiede quale PIANO si sta eseguendo, e i
  // piani di un estintore non sono quelli di una lampada.
  if (offriControlloDiGruppo(daFare, dove)) {
    frag.append(el('button', {
      class: 'btn btn-blocco', type: 'button', style: 'margin-bottom:10px',
      testo: `Registra un controllo su ${daFare.length} presidi…`,
      onclick: () => formControlloDiGruppo(daFare),
    }));
  }

  frag.append(el('ul', { class: 'elenco' },
    trovati.slice(0, limiteElenco).map((a) => el('li', { class: 'voce-riga' }, [
      voceAsset(a),
      // ⭐ La colonna di lato: «da fare / esegui controllo» e, sotto, la mappa
      // (23/09/2026) — solo per chi ha una posizione. Un pulsante che apre
      // una mappa senza il punto sarebbe una promessa vuota.
      el('div', { class: 'voce-lato' }, [
        (() => {
          const fatto = S.controllato(a.id);
          return bottoneSegna(fatto, (dest) => muta(() => S.segnaNelGiro(a.id, dest),
            dest === 'controllato' ? 'Segnato fra i controllati' : 'Rimesso fra i da controllare',
            { annullabile: true, dopoAnnulla: () => riapriSchedaSeAperta(a.id) }), {
            mancanti: fatto ? 0 : S.vociDelGiro(a.id).mancanti.length,
            onEsegui: () => schedaPresidio(a.id, { aiControlli: true }),
          });
        })(),
        // Con la posizione «🗺 mappa», senza «📍 posizione» (24/09/2026).
        pulsanteMappaOPosizione('presidio', a, nomeParlato(a), S.ubicazione(a)),
      ].filter(Boolean)),
    ]))));

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

/**
 * Un filtro che si accende e si spegne, con la CASELLA (operatore, 16/09/2026).
 *
 * Erano due pastiglie che cambiavano colore: si leggevano come due etichette, e
 * non diceva niente che fossero indipendenti — si possono accendere tutte e due,
 * una sola, o nessuna. La casella lo dice da sé, e la riga intera è il bersaglio.
 */
function casellaFiltro(etichetta, attivo, onCambia) {
  const chk = el('input', { type: 'checkbox' });
  chk.checked = Boolean(attivo);
  const nodo = el('label', { class: `casella-filtro${attivo ? ' attiva' : ''}` }, [
    chk, el('span', { testo: etichetta }),
  ]);
  chk.addEventListener('change', () => onCambia(chk.checked));
  return nodo;
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
  // Dal 17/09/2026 le scadenze non stanno più dentro l'idoneità: il pallino le
  // rimette insieme qui, dove serve una risposta sola («devo fermarmi?»), ma le
  // due domande restano distinte in `idoneita` e `statoVerifiche`.
  const ver = S.statoVerifiche(a);
  const p = pallinoDi({
    idoneita: id.stato, verifiche: ver.stato,
    inScadenza: sc.chiave === 'IN_SCADENZA', incerto: id.incerto,
  });
  const nonEseguibili = S.conVerificheNonEseguibili(a.id);
  // Il titolo dice a parole quello che il segno dice con la forma: un pallino
  // senza frase si impara a memoria o non si impara affatto.
  const titolo = {
    '✕': `non idoneo — ${id.origine}`,
    '⊘': id.stato === 'SEGREGATO' ? 'segregato' : 'dismesso',
    '–': 'non previsto',
    '?': 'nessuna scadenza calcolata',
  }[p.segno] || (p.chiave === 'ko' ? `verifiche non in regola — ${ver.testo}`
    : p.chiave === 'attenzione' ? `${sc.in_scadenza} controlli in scadenza`
      : 'idoneo, verifiche in regola');
  const pallino = { classe: p.chiave, segno: p.segno, titolo };

  return el('button', { class: 'voce', type: 'button', onclick: () => schedaPresidio(a.id) }, [
    el('span', { class: `barra-stato ${nonEseguibili ? 'attenzione' : classeBarra}` }),
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
      // Dal 15/09/2026 la MATRICOLA per prima, poi «matr. Terna #…» (regola
      // dell'operatore, gemella dell'ufficio in `nome_presidio.js`).
      el('div', { class: 'voce-titolo' }, (() => {
        const n = nomePresidio(a);
        // Il DETTAGLIO della tipologia accanto al nome (16/09/2026): «Estintore ·
        // CO2», «Porta REI 60». È quello che distingue due presidi della stessa
        // categoria — e che decide la periodicità — e stava in mezzo agli altri
        // dati, su una riga grigia in quarta posizione.
        const dett = dettaglioTipologia(a);
        return [
          n.principale ? el('span', { class: 'mono', style: 'font-weight:700', testo: `${n.principale} ` }) : null,
          n.secondario ? el('span', { class: 'voce-sotto-nome', testo: `${n.secondario} · ` }) : null,
          el('span', { testo: (cat && cat.descrizione) || a.categoria_codice }),
          dett ? el('span', { class: 'voce-dettaglio', testo: ` · ${dett}` }) : null,
        ].filter(Boolean);
      })()),
      el('div', { class: 'voce-sotto', testo: S.ubicazione(a) }),
      // I dati che identificano l'oggetto fisico, su una riga sola.
      //
      // Sono quelli che si confrontano con quello che si ha davanti — la
      // matricola punzonata, l'anno sul serbatoio, la carica — e prima
      // richiedevano di aprire la scheda per ognuno dei quaranta presidi di un
      // locale. Si mostra solo quello che c'è: una riga di «— · — · —» occupa
      // spazio e non dice niente.
      (() => {
        // Estinguente e carica PRIMI (16/09/2026): sono quelli che distinguono
        // due estintori della stessa categoria, e decidono la periodicità della
        // revisione. Poi come è installato, l'anno, la marca.
        // L'estinguente NON è qui: sta accanto al nome. Qui restano i dati che si
        // confrontano con l'oggetto che si ha davanti — carica, come è installato,
        // anno, marca — e la quantità quando la riga vale più pezzi.
        const dati = [
          a.carica_kg ? `${a.carica_kg} kg` : null,
          a.installazione ? String(a.installazione).toLowerCase() : null,
          a.anno_costruzione ? `${a.anno_costruzione}` : null,
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
        const urgente = S.scadenzeDi(a.id)[0];
        const tcp = urgente && S.indici.tipiControllo.get(urgente.tipo_controllo_codice);
        return el('div', {}, [
          el('div', { class: 'voce-sotto', style: 'font-weight:600',
            testo: S.riassuntoControlli(sc) }),
          urgente
            ? el('div', { class: 'voce-sotto', testo:
              `${(tcp && tcp.descrizione) || urgente.tipo_controllo_codice}: `
              + `${frasScadenza(urgente.data_scadenza).testo.toLowerCase()}` })
            : null,
        ].filter(Boolean));
      })(),
      el('div', { class: 'voce-tag' }, [
        ko > 0 ? tag(`${ko} guasti`, 'tag-rosso') : null,
        // ⛔ Lo stato si mostra per QUALUNQUE valore diverso da «in servizio»,
        // non solo per quelli con `operativo = 0` (20/09/2026, segnalazione
        // dell'operatore: «le etichette non sono affatto chiare»).
        //
        // Misurato: `NON_PREVISTO` e `SCORTA` hanno `operativo = 1`, quindi con
        // la condizione di prima non comparivano MAI — una postazione «non
        // prevista» si leggeva esattamente come una in servizio, e i quattro
        // presidi che l'hanno erano invisibili. Il campo che li distingue è
        // l'unico che dice se quella riga genera lavoro, ed era l'unico a non
        // vedersi.
        //
        // ⚠️ Ambra e non rosso: «di scorta», «non previsto», «rimosso» sono
        // DECISIONI di una persona, non difetti trovati sul pezzo. Il rosso è
        // dei difetti — guasti e anomalie — e usarlo anche qui insegna che
        // rosso vuol dire «qualcosa», cioè niente.
        // ⛔ GRIGIO o ROSSO, non ambra (20/09/2026, correzione dell'operatore:
        // «va mostrato in grigio o rosso, le anomalie le stiamo mostrando in
        // giallo»). Aveva ragione e il motivo è che stamattina avevo scelto
        // l'ambra per una ragione giusta in astratto — «una decisione non è un
        // difetto» — dimenticando che l'ambra era GIÀ occupata dalle anomalie.
        // Due significati diversi sullo stesso colore non sono un'ambiguità:
        // sono un colore che non dice più niente.
        //
        // Il rosso va a chi SOSPENDE lo scadenzario, che è la cosa da notare:
        // lì non si fanno più verifiche. Il grigio a chi non lo sospende — «di
        // scorta» è un pezzo vero con le sue revisioni, e un rosso lo
        // trasformerebbe in un allarme che non è.
        stato && a.stato_codice && a.stato_codice !== 'IN_SERVIZIO'
          ? tag(stato.descrizione || a.stato_codice,
            S.sospendeLavoro(a) ? 'tag-rosso' : 'tag-grigio') : null,
        anomalie.length ? tag(`${anomalie.length} anomalie`, 'tag-ambra') : null,
        // «controllato» diceva "toccato almeno una volta". Un estintore ha
        // quattro piani, e misurato sull'archivio 433 presidi su 919 ne hanno
        // quattro aperti: la bandierina lo dava per finito dopo il primo.
        //
        // Dal 16/09/2026 conta le voci DA FARE di `vociDelGiro`, le stesse che
        // decidono il pulsante accanto: prima contava tutte le scadenze aperte
        // (`avanzamentoDi`), comprese le revisioni del 2031, e la riga diceva «1 di 4
        // controlli» accanto a un «✓ fatto».
        (() => {
          const v = S.vociDelGiro(a.id);
          if (!v.eseguite) return null;
          return v.completa
            ? tag('tutti i controlli fatti', 'tag-verde')
            : tag(`${v.eseguite} di ${v.richieste} controlli`, 'tag-ambra');
        })(),
      ]),
    ]),
  ]);
}

// --------------------------------------------------------------------------- //
// Scheda presidio
// --------------------------------------------------------------------------- //
/** Ridisegna la scheda del presidio solo se è ancora quella aperta (dopo un annullamento dal messaggio). */
/**
 * QUALI sono i presidi senza scadenze calcolate: la vista sta in
 * `riepilogo_home.js`, dove una prova può costruirla e cliccarci.
 */
function elencoSenzaScadenze() {
  const assets = (S.get().perEntita[E.ASSET] || [])
    .filter((a) => !a.eliminato_il && S.statoVerifiche(a).stato === 'SENZA');
  const corpo = vistaSenzaScadenze(assets, {
    // Che cosa È: la categoria a PAROLE, non solo l'icona. Contro luce due
    // emoji si somigliano, e c'è chi non le distingue affatto — è la stessa
    // regola per cui in questa app nessun colore viaggia da solo.
    che: (a) => {
      const cat = S.categoriaDi(a);
      const dett = dettaglioTipologia(a);
      const nomeCat = (cat && cat.descrizione) || a.categoria_codice || 'Tipologia ignota';
      return `${(cat && cat.icona) || '🧯'} ${nomeCat}${dett ? ` · ${dett}` : ''}`;
    },
    // ⚠️ `nomePresidio` torna un OGGETTO: qui si compone la stringa, una volta
    // sola. La prima stesura lo passava così com'era a `localeCompare`, e il
    // tocco sollevava un'eccezione senza dire niente.
    //
    // ⛔ E la matricola del costruttore si NOMINA: «7663» da solo si legge come
    // un progressivo, e i due numeri si cercano in due posti diversi del pezzo.
    // Quando non c'è si scrive che non c'è, invece di lasciare la riga muta:
    // su questo elenco la matricola mancante è spesso il motivo per cui il
    // presidio è qui.
    nome: (a) => {
      const matricola = String(a.matricola == null ? '' : a.matricola).trim();
      const n = nomePresidio(a);
      const progressivo = String(a.identificativo == null ? '' : a.identificativo).trim();
      const pezzi = [
        matricola ? `matr. ${matricola}` : 'senza matricola',
        progressivo || (matricola ? '' : n.principale),
      ].filter(Boolean);
      return pezzi.join(' · ');
    },
    dove: (a) => S.ubicazione(a),
    perche: (a) => S.mancanzeDeterminanti(a).map((m) => m.messaggio).join(' · ')
      || 'nessun piano applicabile a questa tipologia',
    onApri: (a) => { chiudiSheet(); schedaPresidio(a.id); },
  });
  apriSheet(`${assets.length} senza scadenze calcolate`, corpo);
}

/**
 * Come si chiama un presidio in testa a un foglio: «🧯 7663 · CO2 · UISUV-13».
 *
 * Una funzione sola perché la usano in due — la scheda del presidio e il foglio
 * del controllo — e il secondo la usava NON usandola: sostituiva il titolo con
 * il nome del controllo, e chi registrava un giudizio non vedeva più su quale
 * pezzo lo stava registrando (20/09/2026, segnalazione dell'operatore).
 * Sbagliare pezzo è l'errore più caro di tutta l'app, ed è l'unica cosa che
 * dalla schermata non si può ricavare in nessun altro modo.
 */
function titoloPresidio(a) {
  const cat = S.categoriaDi(a);
  const nome = nomePresidio(a);
  const dett = dettaglioTipologia(a);
  return `${(cat && cat.icona) || '🧯'} ${nome.principale}${dett ? ` · ${dett}` : ''}`
    + `${nome.secondario ? ` · ${nome.secondario}` : ''}`;
}

/**
 * Il nome di un presidio DETTO A PAROLE, su una riga: tipologia (con il suo
 * dettaglio), progressivo, matricola del costruttore — «🧯 Estintore · CO2 ·
 * UISUV-289 · matr. 982599».
 *
 * ⛔ Mai il codice interno (24/09/2026, segnalazione dell'operatore: «il titolo
 * del popup quando modifichiamo l'anagrafica dice Modifica
 * SUVERETO-EST-289-982599 anziché tipologia, progressivo e matricola»). È lo
 * stesso difetto già corretto sulla mappa il 23/09: un codice che sul campo
 * non si usa, scritto dove l'operatore cerca di capire su QUALE pezzo sta
 * lavorando. Stava in otto punti; ora passano tutti da qui (la ricerca continua
 * a trovare anche il codice: cercarlo è utile, leggerlo no).
 */
function nomeParlato(a) {
  const cat = S.categoriaDi(a) || {};
  return nomePresidioMappa({
    icona: cat.icona,
    categoria: [cat.descrizione || a.categoria_codice, dettaglioTipologia(a)].filter(Boolean).join(' · '),
    identificativo: a.identificativo,
    matricola: a.matricola,
  });
}

function riapriSchedaSeAperta(assetId) {
  const s = document.getElementById('sheet');
  if (!s || s.hidden) return;
  const segni = [...document.querySelectorAll('[data-scheda-presidio]')];
  if (segni.some((n) => n.dataset.schedaPresidio === assetId)) schedaPresidio(assetId);
}

/**
 * @param aiControlli  scorre alla sezione dei controlli;
 * @param alProssimo   scorre alla riga del PROSSIMO controllo da fare, senza
 *                     aprirlo (23/09/2026, dall'operatore: «una volta fatto un
 *                     controllo, se ce ne sono altri, dovrebbe essere semplice
 *                     andare al prossimo, invece che tornare in cima»). Se non
 *                     ne resta nessuno, alla sezione: si vede che è tutto fatto.
 */
/*
 * @param allaRiga     scorre alla riga di QUEL controllo (codice): si torna da
 *                     «Vedi» dove si era, non in cima (23/09/2026).
 */
function schedaPresidio(assetId, { aiControlli = false, alProssimo = false, allaRiga = '' } = {}) {
  const a = S.indici.assets.get(assetId);
  if (!a) { toast('Presidio non trovato', 'toast-ko'); return; }
  const cat = S.categoriaDi(a);
  const corpo = document.createDocumentFragment();
  // Il segno che dice quale scheda è aperta (`riapriSchedaSeAperta`).
  corpo.append(el('span', { hidden: true, dataset: { schedaPresidio: a.id } }));
  // Assegnata più sotto: il pulsante «esegui controllo» in cima ci porta.
  let sezioneControlli = null;
  const vaiAiControlli = () => {
    if (sezioneControlli && sezioneControlli.scrollIntoView) {
      sezioneControlli.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  // Il prossimo controllo che MANCA, trovato per codice fra le righe della
  // sezione (`data-codice` su ogni riga): si scorre lì, non si apre niente.
  const vaiAlProssimo = () => {
    const mancanti = S.vociDelGiro(a.id).mancanti;
    const riga = mancanti.length && sezioneControlli && sezioneControlli.querySelector
      ? sezioneControlli.querySelector(`[data-codice="${mancanti[0].codice}"]`) : null;
    if (riga && riga.scrollIntoView) riga.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else vaiAiControlli();
  };
  const ridisegna = () => riapriSchedaSeAperta(a.id);

  corpo.append(el('div', { class: 'riga', style: 'gap:6px;margin-bottom:8px' }, [
    // «Si può usare?», con il motivo. Non più «conforme / da sistemare»:
    // conforme è il termine del verbale e descrive un adempimento, mentre qui
    // serve sapere se il pezzo è utilizzabile adesso.
    tagIdoneita(S.idoneita(a)),
    // Due etichette, due domande (17/09/2026): «si può usare» e «è in regola con
    // i controlli». Prima una sola diceva «scaduto» e si leggeva come un guasto.
    tagVerifiche(S.statoVerifiche(a)),
    (() => {
      const o = S.origineControllato(a.id);
      // ⚠ e non ✓ quando qualcosa non si è potuto verificare (18/09/2026): un
      // check verde su un presidio con dentro una verifica che nessuno ha fatto
      // dice «tutto a posto», e non lo è. Il presidio è TRATTATO — esce dai da
      // fare — ma non è verificato per intero, e chi guarda l'elenco deve poterlo
      // vedere senza aprire la scheda.
      const nonEseguibili = S.conVerificheNonEseguibili(a.id);
      if (o === 'registrato' && nonEseguibili) {
        return tag(`⚠ trattato, ma ${nonEseguibili} verific${nonEseguibili === 1
          ? 'a non eseguibile' : 'he non eseguibili'}`, 'tag-ambra');
      }
      if (o === 'registrato') return tag('✓ controllato in questo giro', 'tag-verde');
      if (o === 'segnato') return tag('✓ segnato controllato — nessun controllo registrato', 'tag-verde');
      return tag('da controllare');
    })(),
    cat ? tag(cat.famiglia || '', 'tag-blu') : null,
  ]));
  const fatto = S.controllato(a.id);
  corpo.append(bottoneSegna(fatto, async (dest) => {
    await muta(() => S.segnaNelGiro(a.id, dest),
      dest === 'controllato' ? 'Segnato fra i controllati' : 'Rimesso fra i da controllare',
      { annullabile: true, dopoAnnulla: ridisegna });
    schedaPresidio(a.id);
  }, { largo: true, mancanti: fatto ? 0 : S.vociDelGiro(a.id).mancanti.length, onEsegui: vaiAiControlli }));
  corpo.append(el('div', { class: 'mini', style: 'margin-bottom:10px', testo: S.ubicazione(a) }));
  // ⛔ L'ubicazione che manca si DICE qui, dove l'operatore torna appena
  // registrato un controllo (22/09/2026, segnalazione: «non gli fa aggiungere
  // l'ubicazione»). Undici presidi su 875 non ce l'hanno, e senza questa riga
  // l'unica strada era «Modifica anagrafica» — un modulo da venti campi che si
  // apre per cambiarne uno, e che bisogna sapere che è lì.
  if (!a.edificio_id || !a.locale_id) {
    corpo.append(el('div', { class: 'avviso', style: 'margin-bottom:10px' }, [
      el('div', { style: 'font-weight:600',
        testo: `📍 Manca ${!a.edificio_id ? "l'area" : "l'ubicazione"} di questo presidio` }),
      el('div', { class: 'mini', testo:
        'Così non si trova navigando: resta sotto «(senza area)». '
        + 'Si assegna in due tocchi, anche a controllo già registrato.' }),
      el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:8px',
        testo: '📍 Assegna area e ubicazione',
        onclick: () => formLuogoPresidio(a),
      }),
    ]));
  }
  // ⛔ Qui c'erano due righe, e tutte e due erano quelle sbagliate
  // (21/09/2026, segnalazione dell'operatore).
  //
  // La prima elencava matricola, anno e messa in servizio SENZA i loro titoli —
  // «F12345 · 2019 · in servizio dal 01/01/2019» — e chi confronta la scheda con
  // la targhetta non sa quale numero è quale: il progressivo Terna e la
  // matricola del costruttore sono due numeri diversi scritti sullo stesso
  // pezzo. La seconda mostrava `codice`, cioè la chiave interna di Scudo
  // («ACCIAIOLO-EDIFICIO-NUOVAPAL-REI-01»), che non è scritta da nessuna parte
  // sul pezzo e occupava il posto dei due numeri che lo sono.
  //
  // Adesso quegli stessi dati stanno qui sotto nel riepilogo, con il loro
  // titolo e con un trattino dove manca il dato.

  // Le anomalie APERTE in cima, con le tre azioni: prima stavano in fondo, sotto
  // controlli e pulsanti, e ognuna apriva un foglio al posto della scheda.
  const blocco = bloccoAnomalie(S.anomalieDi(a.id, false), {
    // Già risposto in questo giro: un pulsante solo al posto delle domande
    // (24/09/2026). Anche «Modifica» conta: dal 23/09 vale come riconferma.
    giaRisposta: (an) => S.confermataNelGiro(an),
    // ⛔ La risposta ARRIVA dal pulsante (22/09/2026). Prima questa funzione
    // chiamava `riconfermaAnomalia(an.id)` e basta: `bloccante` restava vuoto,
    // valeva il default del tipo — che blocca in 123 casi su 212 — e
    // `confermata_il` veniva scritta lo stesso, quindi la scheda del controllo
    // non rifaceva più la domanda per tutto il giro. Il presidio non si poteva
    // più dichiarare idoneo e non c'era nessun modo di cambiare idea.
    onRiconferma: async (an, bloccante) => {
      const messaggio = bloccante
        ? "Anomalia confermata: impedisce l'uso, niente IDONEO"
        : 'Anomalia confermata: il presidio si può usare';
      if (await muta(() => S.riconfermaAnomalia(an.id, bloccante), messaggio,
        { annullabile: true, dopoAnnulla: ridisegna })) schedaPresidio(a.id);
    },
    onRisolta: async (an, nota) => {
      if (await muta(() => S.aggiornaAnomalia(an.id, { stato: 'CHIUSA', note_chiusura: nota || '' }),
        'Anomalia chiusa', { annullabile: true, dopoAnnulla: ridisegna })) schedaPresidio(a.id);
    },
    onModifica: (an) => schedaAnomalia(an, () => schedaPresidio(a.id)),
    // Un doppione si ANNULLA, dicendo di quale (25/09/2026): «risolta» sarebbe falso.
    onDoppione: async (an, altra) => {
      if (await muta(() => S.aggiornaAnomalia(an.id, { stato: 'ANNULLATA',
        note_chiusura: `Doppione di: ${riassuntoAnomalia(altra).titolo}` }),
      'Anomalia annullata: era un doppione', { annullabile: true, dopoAnnulla: ridisegna })) schedaPresidio(a.id);
    },
    // La regola sta in un posto solo: qui si chiede, non si ricalcola.
    blocca: (an) => S.anomaliaBlocca(an),
  });
  if (blocco) corpo.append(blocco);

  // ⛔ I DATI DEL PEZZO IN CIMA (21/09/2026, richiesta dell'operatore: «quando
  // clicchiamo su un presidio per registrare un controllo dovremmo vedere, in
  // alto, i dati del dispositivo così che l'operatore può verificarne la
  // correttezza»).
  //
  // Stavano quasi in fondo, sotto i controlli e le azioni, in un blocco
  // intitolato «Tutti i dati» che comprendeva anche chi aveva creato la riga.
  // Ma il primo gesto davanti a un presidio è confrontare la scheda con
  // l'etichetta: se quel confronto sta sotto tre schermate, non si fa, e si
  // registra un controllo su un pezzo che potrebbe non essere quello.
  //
  // ⚠️ «Modifica anagrafica» sta ATTACCATO al riepilogo e non più in mezzo ai
  // controlli: un pulsante che modifica dei dati va dove quei dati si leggono,
  // o non si capisce che cosa modifichi.
  corpo.append(el('div', { class: 'card card-piatta riepilogo-presidio' }, [
    vistaCampi(a, {
      escludi: ['tracciamento', 'note', 'ubicazione', 'classificazione'],
      vuotiCome: '—',
      senzaTitoli: false,
    }),
    el('button', {
      class: 'btn btn-blocco', type: 'button', style: 'margin-top:10px',
      testo: '✎ Modifica anagrafica', onclick: () => formModificaAsset(a),
    }),
  ]));

  // Il pezzo montato: se c'è un muletto lo dice, e comunque si può sostituire.
  corpo.append(bloccoPezzo(a, ridisegna));

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
  // ⛔ Perché qui sotto non c'è niente, detto prima che se lo chieda.
  //
  // Uno stato che sospende lo scadenzario azzera i controlli e le scadenze
  // (`sospendeLavoro` in stato.js). Senza questa riga la scheda mostrerebbe una
  // sezione «Controlli» vuota, che si legge come un difetto dei dati — «a questo
  // presidio mancano i piani» — invece che come la decisione che è. E la
  // decisione va detta insieme al modo di ANNULLARLA: se il presidio c'è, lo si
  // rimette in servizio da «Modifica anagrafica», dove lo stato è il primo campo.
  if (S.sospendeLavoro(a)) {
    const st = S.indici.stati.get(a.stato_codice);
    corpo.append(el('div', { class: 'avviso' }, [
      el('div', { style: 'font-weight:600',
        testo: `⏸ ${(st && st.descrizione) || a.stato_codice}` }),
      el('div', { class: 'mini', testo:
        'Finché resta in questo stato qui non ci sono verifiche da fare: lo '
        + "scadenzario è sospeso. Se il presidio c'è, rimettilo «in servizio» da "
        + '«Modifica anagrafica» e i controlli tornano.' }),
    ]));
  }

  // ⛔ LE VERIFICHE FERME PER UN DATO CHE MANCA (22/09/2026, segnalazione
  // dell'operatore: «quando manca la data di messa in servizio il controllo non
  // lo fa fare ma lo tiene come da fare — deve essere più chiaro»).
  //
  // Sta SOPRA i controlli, perché è la ragione per cui quei controlli si
  // comportano in modo strano: senza la data non c'è una scadenza da assolvere,
  // quindi il presidio resta fra i «da fare» a ogni giro e nessuna schermata lo
  // diceva. Il dato si compila da qui, non dall'anagrafica intera.
  const ferme = S.verificheSenzaScadenza(a);
  const mancanze = S.mancanzeDeterminanti(a);
  if (ferme.length && mancanze.length) {
    // `.avviso` è già ambra di suo: una variante «avviso-ambra» non esiste nel
    // CSS e sarebbe una classe che non dipinge niente.
    corpo.append(el('div', { class: 'avviso', style: 'margin-bottom:10px' }, [
      el('div', { style: 'font-weight:600',
        testo: `⏳ ${ferme.length === 1 ? 'Una verifica non ha' : `${ferme.length} verifiche non hanno`} una scadenza` }),
      el('div', { class: 'mini', testo:
        `${ferme.map((v) => v.descrizione).join(', ')}. ${mancanze.map((m) => m.messaggio).join(' ')}` }),
      // ⚠️ Che cosa succede davvero, detto per intero. Dal 24/09/2026 la data
      // inserita qui fa comparire SUBITO la scadenza (`controlliApplicabili`
      // conta dalla data di partenza, come l'ufficio): prima questa riga diceva
      // il contrario, ed era vero — la data si salvava e non cambiava niente
      // fino al rientro, che all'operatore sembrava «non me la registra».
      el('div', { class: 'mini', style: 'margin-top:4px', testo:
        'Inserita la data, la scadenza si calcola subito. Se la data non si '
        + 'conosce, il controllo puoi registrarlo lo stesso: la prossima si '
        + 'conterà da quello che registri oggi.' }),
      el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:8px',
        testo: '✎ Inserisci la data che manca',
        onclick: () => formDatiMancanti(a),
      }),
    ]));
  }

  const applicabili = S.controlliApplicabili(a);
  sezioneControlli = sezionePiani(a, applicabili, {
    onEsito: (piano, esito) => formControlloPiano(a, piano, esito),
    onRipeti: (piano) => formControlloPiano(a, piano),
    onVedi: (iv, piano) => schedaRegistrazione(iv.id, { daPresidio: true, piano }),
    // I dati che mancano, nella riga del controllo (24/09/2026).
    datiMancanti: (t) => bloccoDatiMancanti(a, t),
    // ⛔ Il FINE VITA: si sostituisce, adesso o al prossimo giro (23/09/2026).
    onSostituisci: () => {
      chiudiSheet();
      formSostituisciPezzo(a, () => schedaPresidio(a.id), { motivo: 'FINE_VITA' });
    },
    onDaSostituire: async (piano) => {
      const esito = await muta(() => S.fineVitaDaSostituire(a.id,
        { piano_id: piano.piano_id, scadenza: piano.scadenza }),
      'Segnato da sostituire: il presidio è non idoneo, e lo ritrovi fra i «Sospesi».');
      if (esito) schedaPresidio(a.id, { alProssimo: true });
    },
  });
  corpo.append(sezioneControlli);

  // ⛔ Qui resta SOLO «apri anomalia», e le altre due scendono in fondo
  // (20/09/2026, richiesta dell'operatore). Aprire un'anomalia è la strada
  // secondaria dei CONTROLLI — si passa davanti a un estintore e si vede il
  // cartello staccato — quindi sta attaccata a loro. Scegliere i piani e far
  // uscire un presidio da un piano sono un'altra cosa: si fanno raramente,
  // chiedono la password admin, e in mezzo ai controlli facevano scorrere via
  // quello che serve sempre.
  corpo.append(el('div', { class: 'azioni-presidio' }, [
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: '⚠️ Apri anomalia senza registrare un controllo',
      onclick: () => formAnomalia(a),
    }),
  ]));

  const conPiano = applicabili.filter((t) => t.piano_id);

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
        type: 'button', onclick: () => schedaRegistrazione(iv.id, { daPresidio: true }),
      }, [
        el('div', {}, [el('b', { testo: dataIt(iv.data) }), ` · ${(tc && tc.descrizione) || iv.tipo_controllo_codice}`]),
        el('div', { class: 'mini', testo: `${etichettaEsito(iv.esito)}${iv.operatore_nome ? ` · ${iv.operatore_nome}` : ''}` }),
        iv.azione_eseguita ? el('div', { class: 'mini', testo: iv.azione_eseguita }) : null,
        iv.note ? el('div', { class: 'mini', testo: iv.note }) : null,
        el('span', { class: 'voce-freccia', testo: '›' }),
      ]);
    })));
  }

  // ⛔ In fondo resta il solo TRACCIAMENTO (21/09/2026, richiesta dell'operatore:
  // «ciò che deve rimanere in fondo, possibilmente compattato, è la sezione
  // tracciamento»). Chi ha creato la riga e quando non serve a chi sta davanti
  // al pezzo: serve dopo, in ufficio, quando si chiede da dove viene un dato.
  //
  // Tutto il resto è salito in cima, dove si confronta con l'etichetta.
  corpo.append(el('details', { class: 'tracciamento' }, [
    el('summary', { testo: 'Tracciamento' }),
    vistaCampi(a, { solo: ['tracciamento', 'note'], senzaTitoli: true }),
  ]));

  // Le azioni RARE, tutte insieme in fondo: quelle che si fanno una volta ogni
  // tanto, due delle quali dietro la password admin. Togliere un piano da QUI è
  // comunque il gesto naturale — chi ha il presidio davanti ha appena visto
  // perché quel controllo non ha senso su questo pezzo, e costringerlo a
  // segnarselo per il rientro significa che non lo farà.
  corpo.append(el('div', { class: 'azioni-presidio azioni-rare' }, [
    // ⛔ VEDERE i piani non chiede la password (20/09/2026, richiesta
    // dell'operatore). Il pulsante sotto — «Scegli i piani…» — la chiede perché
    // SCRIVE una deroga; questo apre soltanto l'elenco di ciò che si applica e
    // che cosa chiede, comprese le voci di checklist.
    //
    // ⚠️ E non è un doppione di «Esegui i controlli» qui sopra: quella sezione
    // mostra ciò che c'è DA FARE ADESSO, questa dice quali piani esistono su
    // questo presidio, compresi quelli in regola fino al 2031. Sono due domande
    // diverse e la seconda non aveva risposta in nessun punto dell'app.
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: '📋 I piani di questo presidio',
      onclick: () => pianiDelPresidio(a),
    }),
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: `${ADMIN.sbloccato() ? '' : '🔒 '}📋 Scegli i piani di questo presidio…`,
      onclick: conAdmin('Scegliere i piani di un presidio', () => formPianiDiPresidio(a.id)),
    }),
    conPiano.length ? el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: `${ADMIN.sbloccato() ? '' : '🔒 '}⚙︎ Questo presidio fa eccezione…`,
      onclick: conAdmin('Far uscire un presidio da un piano', () => formDeroga(a, conPiano)),
    }) : null,
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: '🗑️ Segnala presidio rimosso / inesistente',
      onclick: () => formEliminaAsset(a),
    }),
  ].filter(Boolean)));

  // In testa alla scheda l'identificativo, che è come il presidio si chiama;
  // il codice lungo resta più sotto, dove serve a chi lavora sui file.
  apriSheet(titoloPresidio(a), corpo);
  // Dal pulsante «esegui controllo» dell'elenco si arriva direttamente ai controlli.
  if (aiControlli) setTimeout(vaiAiControlli, 60);
  if (alProssimo) setTimeout(() => vaiAlProssimo(), 60);
  if (allaRiga) {
    setTimeout(() => {
      const riga = sezioneControlli && sezioneControlli.querySelector
        ? sezioneControlli.querySelector(`[data-codice="${allaRiga}"]`) : null;
      if (riga && riga.scrollIntoView) riga.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else vaiAiControlli();
    }, 60);
  }
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
  const fValore = campoNumerico({ min: 1 });
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
    el('div', { class: 'mini', testo: `${nomeParlato(a)} · ${S.ubicazione(a)}` }),
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
 *
 * ⛔ Aperta DALLA SCHEDA DEL PRESIDIO (`daPresidio`, 23/09/2026, dall'operatore:
 * «se clicco su Vedi, dovrebbe comunque permetterci di registrare il controllo
 * o tornare alla schermata precedente senza tornare da capo»):
 *  * si torna al presidio — con «‹ Torna al presidio», con la ✕, toccando fuori
 *    — all'ALTEZZA di questo controllo, non in cima e non all'elenco;
 *  * se risulta registrato ma NON eseguito (non accessibile, non si poteva
 *    fare), si registra da qui, con gli stessi tre pulsanti della riga;
 *  * se era eseguito, «↻ Rifai il controllo», come sulla riga.
 * Il fine vita non ha esiti (vedi `registraIntervento`): da qui si torna e basta.
 */
function schedaRegistrazione(interventoId, { daPresidio = false, piano = null } = {}) {
  const d = S.dettaglioIntervento(interventoId);
  if (!d) { toast('Controllo non trovato', 'toast-ko'); return; }
  const assetId = d.intervento.asset_id;
  const codice = d.intervento.tipo_controllo_codice;
  const ritorno = () => schedaPresidio(assetId, { allaRiga: codice });
  const corpo = corpoRegistrazione(d, {
    annulla: (id, motivo) => muta(() => S.annullaIntervento(id, motivo), null),
    // `muta` salva e registra nel giornale: una nota scritta in campo deve
    // arrivare in ufficio insieme al resto del giro, e comparire fra le azioni
    // fatte — altrimenti in ufficio appare dal nulla su un controllo di mesi fa.
    annota: (id, nota) => muta(() => S.annotaIntervento(id, nota), 'Nota salvata.'),
    avvisa: (msg) => toast(msg, 'toast-ko', 8000),
    chiudi: (annullato) => {
      // Da presidio, la chiusura stessa riporta lì (`apriSheetConChiusura`).
      chiudiSheet();
      if (annullato) {
        toast('Registrazione annullata. La scadenza è tornata aperta.', 'toast-ok', 7000);
        if (!daPresidio) schedaPresidio(assetId);
      }
    },
  });
  if (!daPresidio) { apriSheet('Controllo registrato', corpo); return; }

  const a = S.indici.assets.get(assetId);
  const t = piano || (a ? S.controlliApplicabili(a).find((x) => x.codice === codice) : null);
  const nonEseguito = S.ESITI_NON_ESEGUIBILI.includes(d.intervento.esito);
  // Il fine vita lo decide `S.eFineVita` (pv-29 è una verifica, 24/09/2026).
  const fineVita = S.eFineVita(codice, (t && t.piano_id) || d.intervento.piano_id);
  const registra = (!a || !t || fineVita) ? null : (nonEseguito
    ? el('div', { class: 'card card-piatta', style: 'margin-top:12px' }, [
      el('div', { style: 'font-weight:600', testo: 'Il controllo va ancora eseguito: registralo adesso' }),
      el('div', { class: 'piano-azioni', style: 'margin-top:8px' }, [
        el('button', { class: 'btn btn-ok btn-esito', type: 'button',
          onclick: () => formControlloPiano(a, t, 'IDONEO') },
        [el('span', { class: 'esito-segno', testo: '✓' }), el('span', { testo: 'Idoneo' })]),
        el('button', { class: 'btn btn-ko btn-esito', type: 'button',
          onclick: () => formControlloPiano(a, t, 'NON_IDONEO') },
        [el('span', { class: 'esito-segno', testo: '✕' }), el('span', { testo: 'Non idoneo' })]),
      ]),
      el('button', { class: 'btn btn-piccolo btn-blocco btn-esito', type: 'button', style: 'margin-top:6px',
        onclick: () => formControlloPiano(a, t, 'NON_ESEGUIBILE') },
      [el('span', { class: 'esito-segno', testo: '⚠' }), el('span', { testo: 'Verifica non eseguibile' })]),
    ])
    : el('button', { class: 'btn btn-blocco', type: 'button', style: 'margin-top:12px',
      testo: '↻ Rifai il controllo', onclick: () => formControlloPiano(a, t) }));
  const torna = el('button', { class: 'btn btn-blocco btn-piccolo', type: 'button',
    testo: '‹ Torna al presidio', onclick: () => chiudiSheet() });
  apriSheetConChiusura('Controllo registrato', el('div', {}, [
    torna,
    registra,
    corpo,
  ].filter(Boolean)), ritorno);
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
  let avvisoPosizione = null;
  const corpo = corpoControlloPiano(a, t, esitoIniziale, {
    registra: (dati, messaggio) => muta(() => {
      // Raccolto dentro la transazione e mostrato dopo: un `toast` chiamato
      // qui verrebbe coperto da quello del salvataggio.
      avvisoPosizione = null;
      const r = S.registraIntervento(a.id, dati);
      // L'anno letto sull'etichetta durante il controllo: fa partire la fine vita.
      if (dati.anno_costruzione) S.aggiornaAsset(a.id, { anno_costruzione: dati.anno_costruzione });
      // La posizione presa durante il controllo (20/09/2026). Nella stessa
      // transazione del controllo — ma NON al suo stesso rango.
      //
      // ⛔ Il `try` non è pigrizia: è la regola che questo punto ha imparato a
      // sue spese il 20/09/2026. Su un pacchetto esportato prima che i campi
      // GPS esistessero, `aggiornaAsset` rifiutava con «Campo sconosciuto: lat»
      // e l'eccezione portava giù l'INTERO salvataggio: l'operatore perdeva il
      // controllo, cioè il lavoro obbligatorio, per colpa di un dato
      // facoltativo che aveva aggiunto per comodità.
      //
      // Una cosa in più non deve mai poter far perdere la cosa dovuta. Se la
      // posizione non si scrive, il controllo si registra lo stesso e il motivo
      // si legge in un messaggio.
      if (dati.coordinate) {
        try {
          S.aggiornaAsset(a.id, dati.coordinate);
        } catch (e) {
          avvisoPosizione = e.message || String(e);
        }
      }
      // Le anomalie dichiarate risolte si chiudono QUI, nella stessa scrittura del
      // controllo che le ha trovate risolte: la nota di chiusura nomina il
      // controllo, così in ufficio si sa perché sono state chiuse (17/09/2026).
      for (const id of dati.anomalie_risolte || []) {
        S.aggiornaAnomalia(id, {
          stato: 'CHIUSA',
          note_chiusura: `Risolta: controllo idoneo del ${dataIt(dati.data || S.oggiIso())}`,
        });
      }
      // E quelle che l'operatore ha CONFERMATO, con la risposta alla seconda
      // domanda: «impedisce di usarlo?». Stessa scrittura del controllo, per lo
      // stesso motivo delle risolte — un aggiornamento fatto dopo, da un'altra
      // schermata, è quello che non si fa.
      for (const c of dati.anomalie_confermate || []) {
        S.riconfermaAnomalia(c.id, c.bloccante);
      }
      return r;
    }, messaggio).then((r) => {
      if (avvisoPosizione) {
        toast(`Controllo registrato. La posizione NON è stata salvata: ${avvisoPosizione} `
          + "Riesporta il pacchetto da Scudo e riprova.", 'toast-warn', 12000);
      }
      return r;
    }),
    avvisa: (msg) => toast(msg, 'toast-ko', 8000),
    chiudi: (registrato = true) => {
      chiudiSheet();
      // Dopo aver registrato si torna alla scheda del presidio, non al nulla:
      // gli altri controlli di quel pezzo sono lì, e quasi sempre se ne fa più
      // di uno prima di spostarsi. E ci si torna all'ALTEZZA del prossimo che
      // manca (23/09/2026), non in cima: senza aprirlo, lo si vede e lo si tocca.
      if (registrato) schedaPresidio(a.id, { alProssimo: true });
    },
  });
  // La chiusura spegne il GPS: è la strada d'uscita che il pannello delle
  // coordinate non può vedere da sé.
  apriSheetConChiusura({ titolo: titoloPresidio(a), sottotitolo: t.descrizione },
    corpo, () => corpo.chiudiCoordinate && corpo.chiudiCoordinate());
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
/**
 * «Apri anomalia senza registrare un controllo».
 *
 * ⛔ Dal 23/09/2026 i campi sono quelli di `campiAnomalia` (controllo.js), gli
 * stessi della modifica e con le parole della scheda del presidio: vedi là il
 * perché. Via i sedici tipi da cliccare e via «Aggiorna stato presidio» — il
 * ciclo di vita del pezzo (scorta, segregato…) non è un difetto, e si cambia da
 * «Modifica anagrafica», dove sta.
 */
function formAnomalia(a) {
  const campi = campiAnomalia(a, null);
  const boxErrori = el('div', { class: 'avviso avviso-rosso', hidden: true, style: 'margin-top:12px' });
  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${nomeParlato(a)} · ${S.ubicazione(a)}` }),
    campi.nodo,
    boxErrori,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Apri anomalia',
        onclick: async () => {
          const errori = campi.errori();
          mostraErroriAnomalia(boxErrori, errori);
          if (errori.length) return;
          const v = campi.valori();
          const res = await muta(() => {
            const an = S.apriAnomalia(a.id, {
              gravita: v.gravita,
              descrizione: v.descrizione,
              azione_proposta: v.azione_proposta,
              bloccante: v.bloccante,
              quantita_ko: v.quantita_ko,
            });
            // I pezzi che non funzionano sono un dato della RIGA: si scrivono
            // anche lì, come fa il controllo.
            if (v.quantita_ko !== null && String(v.quantita_ko) !== String(a.quantita_ko ?? '0')) {
              S.aggiornaAsset(a.id, { quantita_ko: v.quantita_ko });
            }
            return an;
          }, 'Anomalia aperta');
          if (res) chiudiSheet();
        },
      }),
    ]),
  ]);
  apriSheet('Nuova anomalia', corpo);
}

/** I motivi per cui il foglio dell'anomalia non si salva, scritti sopra i pulsanti. */
function mostraErroriAnomalia(box, errori) {
  svuotaNodo(box);
  box.hidden = !errori.length;
  for (const e of errori) box.append(el('div', { testo: `• ${e}` }));
  if (errori.length && box.scrollIntoView) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        // Il titolo è la NOTA dell'operatore; l'elenco delle verifiche non idonee
        // si conta sotto (24/09/2026: `anomalia_testo.js`).
        (() => {
          const r = riassuntoAnomalia(an);
          return el('div', {}, [
            el('div', { class: 'voce-titolo', testo: testo(r.titolo) }),
            r.sotto ? el('div', { class: 'voce-sotto anomalia-conta', testo: r.sotto }) : null,
          ].filter(Boolean));
        })(),
        // Il presidio — con il progressivo Terna, dato primario — prima dell'ubicazione (25/09/2026).
        conContesto && a ? el('div', { class: 'voce-sotto', testo: nomeParlato(a) }) : null,
        conContesto && a ? el('div', { class: 'voce-sotto', testo: S.ubicazione(a) }) : null,
        an.azione_proposta ? el('div', { class: 'voce-sotto', testo: `→ ${an.azione_proposta}` }) : null,
        el('div', { class: 'voce-tag' }, [
          tag(an.gravita || '?', an.gravita === 'ALTA' ? 'tag-rosso' : an.gravita === 'MEDIA' ? 'tag-ambra' : ''),
          tag(statoAnomaliaAParole(an.stato), aperta ? '' : 'tag-verde'),
          an.data_apertura ? tag(dataIt(an.data_apertura)) : null,
        ]),
      ]),
    ]),
  ]);
}

/**
 * La scheda di un'anomalia, per MODIFICARLA.
 *
 * ⛔ Dal 23/09/2026 tutti i campi modificabili, gli stessi dell'apertura
 * (`campiAnomalia`): descrizione PRECOMPILATA con quella registrata («dobbiamo
 * solo modificarla, non riscriverla» — era vuota per il difetto di `el` sulle
 * textarea), «si può usare?» con la risposta in vigore, gravità, i pezzi che non
 * funzionano (se la riga ne conta più d'uno), azione, stato e note.
 */
function schedaAnomalia(an, dopo = null) {
  const a = S.indici.assets.get(an.asset_id);
  const fStato = scelte(STATI_ANOMALIA.map((s) => ({ valore: s, testo: statoAnomaliaAParole(s) })),
    an.stato || 'APERTA', { obbligatorio: true });
  const fNote = el('textarea', { placeholder: 'Note di chiusura / avanzamento' });
  fNote.value = an.note_chiusura || '';
  const campi = a ? campiAnomalia(a, an) : null;
  const boxErrori = el('div', { class: 'avviso avviso-rosso', hidden: true, style: 'margin-top:12px' });

  const corpo = el('div', {}, [
    a ? el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      testo: `Apri la scheda · ${nomeParlato(a)}`, onclick: () => schedaPresidio(a.id),
    }) : null,
    el('dl', { class: 'dati', style: 'margin-top:12px' }, [
      el('dt', { testo: 'Aperta il' }), el('dd', { testo: dataIt(an.data_apertura) }),
      an.data_chiusura ? el('dt', { testo: 'Chiusa il' }) : null,
      an.data_chiusura ? el('dd', { testo: dataIt(an.data_chiusura) }) : null,
      an.confermata_il ? el('dt', { testo: 'Riconfermata il' }) : null,
      an.confermata_il ? el('dd', { testo: `${dataIt(an.confermata_il)}${an.confermata_da ? ` · ${an.confermata_da}` : ''}` }) : null,
      el('dt', { testo: 'Origine' }), el('dd', { testo: testo(an.origine) }),
      a ? el('dt', { testo: 'Ubicazione' }) : null,
      a ? el('dd', { testo: S.ubicazione(a) }) : null,
    ]),
    el('h3', { testo: 'Modifica' }),
    // ⛔ Salvare VALE COME RICONFERMA (23/09/2026, dall'operatore: «dopo che la
    // modifichiamo dovrebbe fare come se l'avessimo confermata, altrimenti
    // dobbiamo riconfermarla e non è intuitivo»). Chi apre un'anomalia, la
    // rilegge e risponde «si può usare?» l'ha guardata oggi: chiedergli di
    // riconfermarla subito dopo è la stessa domanda due volte. Lo si DICE qui,
    // prima di salvare, perché ha un effetto: in questo giro non si richiede più.
    el('div', { class: 'mini', style: 'margin:-4px 0 8px', testo: 'Se resta aperta, salvando la '
      + 'riconfermi con la data di oggi: in questo giro non te la chiediamo più.' }),
    campo('Stato', fStato, STATI_ANOMALIA.map((s) => `${statoAnomaliaAParole(s)}: `
      + `${(STATI_ANOMALIA_A_PAROLE[s] || {}).spiega || ''}`).join(' · ')),
    campi ? campi.nodo : null,
    campo('Note', fNote),
    boxErrori,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Chiudi', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          const errori = campi ? campi.errori() : [];
          mostraErroriAnomalia(boxErrori, errori);
          if (errori.length) return;
          const v = campi ? campi.valori() : {};
          const koCambiato = a && v.quantita_ko !== null && v.quantita_ko !== undefined
            && String(v.quantita_ko) !== String(a.quantita_ko ?? '0');
          const resta = ['APERTA', 'IN_CORSO'].includes(fStato.valore);
          const res = await muta(() => {
            S.aggiornaAnomalia(an.id, {
              stato: fStato.valore,
              note_chiusura: fNote.value.trim(),
              ...(campi ? {
                gravita: v.gravita, descrizione: v.descrizione, azione_proposta: v.azione_proposta,
                // Aperta, la risposta la scrive la riconferma qui sotto.
                ...(resta ? {} : { bloccante: v.bloccante }),
              } : {}),
              ...(koCambiato ? { quantita_ko: String(v.quantita_ko) } : {}),
            });
            if (koCambiato) S.aggiornaAsset(a.id, { quantita_ko: v.quantita_ko });
            // Modificarla È averla guardata: vale come riconferma di oggi, con
            // la risposta a «si può usare?» data in questo foglio.
            if (resta && campi) S.riconfermaAnomalia(an.id, v.bloccante === '1');
            return true;
          }, resta && campi ? 'Anomalia aggiornata e riconfermata oggi' : 'Anomalia aggiornata',
          { annullabile: true, dopoAnnulla: () => riapriSchedaSeAperta(an.asset_id) });
          if (res) { if (dopo) dopo(); else chiudiSheet(); }
        },
      }),
    ]),
  ].filter(Boolean));
  apriSheet('Anomalia', corpo);
}

// --------------------------------------------------------------------------- //
// Form: modifica / creazione / eliminazione presidio
// --------------------------------------------------------------------------- //
/**
 * Assegnare area e ubicazione a UN presidio che non le ha.
 *
 * ⛔ 22/09/2026, segnalazione dell'operatore: «quando è già stato messo idoneo o
 * non idoneo su un controllo non gli fa aggiungere l'ubicazione».
 *
 * Il dato si poteva scrivere — «Modifica anagrafica» lo chiede, ed è provato che
 * il salvataggio funziona anche su un presidio con un controllo già registrato —
 * ma bisognava sapere che è lì: un modulo che si chiama «anagrafica», in fondo a
 * una scheda lunga, aperto per cambiare venti campi quando ne manca uno. Dopo
 * aver registrato un controllo l'app torna proprio su questa scheda, ed è il
 * momento in cui l'operatore ha ancora il pezzo davanti e sa dove si trova.
 *
 * Quindi: un avviso che DICE che manca, e un foglio che chiede solo quello.
 */
/**
 * Chiedere i dati che sbloccano lo scadenzario, e nient'altro.
 *
 * ⛔ 22/09/2026, segnalazione dell'operatore: «quando manca la data di messa in
 * servizio, il controllo non lo fa fare ma lo tiene come da fare. Deve essere
 * più chiaro per l'operatore che deve mettere la data, e deve essere possibile
 * inserirla direttamente da lì, senza per forza andare su modifica anagrafica».
 *
 * Misurato: 185 presidi su 875 hanno almeno una verifica senza scadenza
 * calcolabile, e il motivo è sempre lo stesso — la data che manca. Il dato si
 * poteva scrivere, ma da «✎ Modifica anagrafica»: un modulo con tutti i campi
 * della tipologia, dove quello che serve è uno solo e non si sa quale.
 *
 * ⚠️ Le tre date sono ALTERNATIVE e il foglio lo dice: ne basta una, e la messa
 * in servizio è la più precisa. Chiederle tutte e tre come se servissero tutte
 * farebbe lasciare il foglio a chi ne conosce una sola.
 */
/**
 * I campi di alcuni dati del presidio, per chiederli FUORI dall'anagrafica:
 * `{ nodo, nomi, dati() }`. `dati()` risponde solo i valori scritti e diversi da
 * quelli che c'erano. Uno solo, per il foglio «Dati che mancano» e per la riga
 * del controllo (24/09/2026): due copie degli stessi campi chiederebbero la
 * stessa data in due modi.
 */
function campiDatiMancanti(a, richiesti) {
  const perNome = new Map(S.campiPerCategoria(a.categoria_codice).map((c) => [c.nome, c]));
  const nomi = [...new Set(richiesti || [])].filter((nome) => perNome.has(nome));
  const controlli = new Map();
  const nodi = nomi.map((nome) => {
    const c = perNome.get(nome);
    const valore = a[nome] == null ? '' : String(a[nome]);
    const inp = c.tipo === 'intero' || c.tipo === 'decimale'
      ? campoNumerico({ decimale: c.tipo === 'decimale', valore, min: c.min, max: c.max })
      // Le date con i tre menù (23/09/2026): vedi `campoData`.
      : (c.tipo === 'data' ? campoData({ valore }) : el('input', { type: 'text', value: valore }));
    controlli.set(nome, inp);
    return campo(c.etichetta, inp, c.aiuto || undefined);
  });
  return {
    nomi,
    etichette: nomi.map((n) => perNome.get(n).etichetta),
    nodo: el('div', {}, nodi),
    dati() {
      const out = {};
      for (const [nome, inp] of controlli) {
        const v = (inp.valore ? inp.valore() : inp.value) ?? '';
        if (String(v).trim() && String(v) !== String(a[nome] ?? '')) out[nome] = String(v).trim();
      }
      return out;
    },
  };
}

/**
 * Nella RIGA del controllo, sopra «Verifica non eseguibile»: i dati che
 * mancano a quel controllo per avere una scadenza (24/09/2026, richiesta
 * dell'operatore — vedi `rigaPianoDaEseguire`). Salvati, la scheda si riapre
 * sulla stessa riga: la scadenza c'è, e compaiono idoneo e non idoneo.
 */
function bloccoDatiMancanti(a, t) {
  const campi = campiDatiMancanti(a, t.dati_per_scadenza);
  if (!campi.nomi.length) return null;
  const piu = campi.nomi.length > 1;
  return el('div', { class: 'dati-mancanti-riga' }, [
    el('div', { class: 'dati-mancanti-titolo', testo: piu
      ? '📅 Per calcolare la scadenza serve una di queste date'
      : `📅 Per calcolare la scadenza serve: ${campi.etichette[0].toLowerCase()}` }),
    piu ? el('div', { class: 'mini', testo: "Basta UNA: si conta dalla prima che c'è. La messa "
      + "in servizio è la più precisa; se non si legge, va bene anche l'anno di costruzione." }) : null,
    campi.nodo,
    el('button', {
      class: 'btn btn-primario btn-blocco', type: 'button', style: 'margin-top:6px',
      testo: '✓ Salva e calcola la scadenza',
      onclick: async () => {
        const dati = campi.dati();
        if (!Object.keys(dati).length) {
          toast(piu ? 'Scrivi almeno una delle date.' : 'Scrivi il dato che manca.', 'toast-ko', 6000);
          return;
        }
        const res = await muta(() => { S.aggiornaAsset(a.id, dati); return true; }, null);
        if (!res) return;
        const dopo = S.controlliApplicabili(S.indici.assets.get(a.id)).find((x) => x.codice === t.codice);
        toast(dopo && dopo.scadenza
          ? `Salvato: scade il ${dataIt(dopo.scadenza)}.`
          : 'Salvato.', 'toast-ok', 6000);
        schedaPresidio(a.id, { allaRiga: t.codice });
      },
    }),
  ].filter(Boolean));
}

/**
 * Il verbale dei controlli, in PDF (24/09/2026, richiesta dell'operatore: «un
 * report da stampare e far firmare alla ditta, con i controlli fatti, gli esiti
 * e le anomalie; deve far capire quali sono riconfermate, quali nuove…»).
 *
 * Si sceglie l'impianto — di solito si firma impianto per impianto — e se
 * elencare anche le anomalie aperte che in questo giro nessuno ha rivisto.
 * Solo lettura: `datiVerbale` e `pdfVerbale` (verbale.js) non scrivono niente.
 */
function formVerbale() {
  const assets = S.indici.assets;
  const perImpianto = new Map();
  for (const iv of S.interventiDelGiro()) {
    const a = assets.get(iv.asset_id);
    if (a) perImpianto.set(a.impianto_id, (perImpianto.get(a.impianto_id) || 0) + 1);
  }
  const impianti = [...perImpianto.entries()]
    .map(([id, n]) => ({ id, n, nome: (S.indici.impianti.get(id) || {}).denominazione || id }))
    .sort((x, y) => x.nome.localeCompare(y.nome));
  // ⛔ «TUTTI» vuol dire un verbale PER IMPIANTO, in un solo PDF (24/09/2026,
  // dall'operatore: «dovremmo poter generare tutti i rapporti in una sola volta…
  // un pdf unico con tutti i verbali di tutti gli impianti»). È la prima voce:
  // è quella che si usa a fine giro.
  const TUTTI = '__tutti__';
  const fImpianto = el('select', {}, [
    el('option', { value: TUTTI, testo: 'Tutti: un verbale per impianto, in un solo PDF' }),
    ...impianti.map((i) => el('option', { value: i.id, testo: `${i.nome} — ${i.n} controlli` })),
  ]);
  const fNonRiviste = el('input', { type: 'checkbox' });
  fNonRiviste.checked = true;
  const anteprima = el('div', { class: 'mini', style: 'margin:10px 0' });
  const verbali = () => (fImpianto.value === TUTTI
    ? datiVerbaliPerImpianto({ nonRiviste: fNonRiviste.checked })
    : [datiVerbale({ impiantoId: fImpianto.value, nonRiviste: fNonRiviste.checked })]);
  const aggiorna = () => {
    const lista = verbali();
    const somma = (k) => lista.reduce((t, d) => t + d.conteggi[k], 0);
    anteprima.textContent = `${lista.length === 1 ? 'Un verbale' : `${lista.length} verbali, uno per impianto`}: `
      + `${somma('presidi')} presidi controllati, ${somma('controlli')} controlli (idonei ${somma('idonei')}, non idonei ${somma('nonIdonei')}, `
      + `non eseguibili ${somma('nonEseguibili')}); anomalie ${somma('nuove')} nuove, ${somma('riconfermate')} riconfermate, `
      + `${somma('risolte')} risolte${fNonRiviste.checked ? `, ${somma('nonRiviste')} aperte e non riviste` : ''}.`;
  };
  // ⛔ CHI FIRMA, da correggere prima di scaricare (25/09/2026, dall'operatore:
  // «deve chiederci di modificare i sorveglianti, rimuoverne, aggiungerne, o
  // anche gli operatori della ditta»). Le correzioni valgono per il documento
  // e non toccano i dati: chiave = il nome com'è nei dati, così sopravvivono al
  // cambio di «Quali verbali», che cambia chi compare.
  const firmatari = foglioFirmatari(() => firmatariProposti(verbali()));
  fImpianto.addEventListener('change', () => { aggiorna(); firmatari.ridisegna(); });
  fNonRiviste.addEventListener('change', () => { aggiorna(); firmatari.ridisegna(); });
  aggiorna();
  const corpo = el('div', {}, [
    impianti.length ? null : avviso('In questo giro non risultano ancora controlli registrati: il verbale '
      + 'conterrà solo le anomalie toccate nel giro.', 'avviso-blu'),
    campo('Quali verbali', fImpianto, 'Ogni verbale comincia su una pagina nuova e ha le sue firme.'),
    el('label', { class: 'riga', style: 'gap:8px;margin-top:10px' }, [fNonRiviste,
      el('span', { testo: 'Elenca anche le anomalie aperte che in questo giro non sono state riviste' })]),
    anteprima,
    el('h3', { style: 'margin:14px 0 0;font-size:1rem', testo: 'Chi firma' }),
    firmatari.nodo,
    el('button', {
      class: 'btn btn-primario btn-blocco', type: 'button', style: 'margin-top:14px', testo: '📄 Scarica il PDF',
      onclick: async () => {
        const lista = applicaFirmatari(verbali(), firmatari.scelta());
        const v = String(await versioneInEsecuzione() || '').match(/v\d+$/);
        const pdf = pdfVerbali(lista, { versione: v ? v[0] : '' });
        scaricaFile(nomeFileVerbale(lista.length === 1 ? lista[0] : lista), pdf, 'application/pdf');
        toast('Verbale pronto: aprilo per stamparlo o mandarlo.', 'toast-ok', 6000);
      },
    }),
  ].filter(Boolean));
  apriSheet('Verbale di sorveglianza', corpo);
}

function formDatiMancanti(a) {
  const mancanze = S.mancanzeDeterminanti(a);
  if (!mancanze.length) { toast('Non manca nessun dato determinante.', 'toast-ok'); return; }
  const campi = campiDatiMancanti(a, mancanze.flatMap((m) => m.campi || [m.campo]));
  const { nomi } = campi;

  const corpo = el('div', {}, [
    avviso(mancanze.map((m) => m.messaggio).join(' ')),
    // Che cosa si sblocca, per nome: un elenco di verifiche ferme spiega la
    // fretta meglio di qualunque frase sul dato mancante.
    (() => {
      const ferme = S.verificheSenzaScadenza(a);
      return ferme.length
        ? el('div', { class: 'mini', style: 'margin:8px 0',
          testo: `Senza, ${ferme.length === 1 ? 'questa verifica resta' : 'queste verifiche restano'} `
            + `senza scadenza: ${ferme.map((v) => v.descrizione).join(', ')}. `
            + 'Scritta la data, la scadenza si calcola subito.' })
        : null;
    })(),
    nomi.length > 1
      ? el('div', { class: 'mini', style: 'margin-bottom:8px',
        testo: "Basta UNA di queste: la periodicità si calcola dalla prima che c'è. "
          + 'La messa in servizio è la più precisa; se non si legge, va bene anche '
          + "l'anno di costruzione." })
      : null,
    campi.nodo,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          const dati = campi.dati();
          if (!Object.keys(dati).length) {
            toast('Scrivi almeno una delle date.', 'toast-ko', 6000);
            return;
          }
          const res = await muta(() => {
            S.aggiornaAsset(a.id, dati);
            return { n: Object.keys(dati).length };
          }, null);
          if (!res) return;
          // Dal 24/09/2026 la scadenza compare SUBITO (`ancoraDiCalcolo` in
          // calcoli.js, gemella dell'ufficio). Qui c'era scritto il contrario —
          // la scadenza arrivava solo dal rientro in ufficio — ed era rimasto dopo la v126:
          // un messaggio sul percorso del salvataggio che nessuna prova rilegge.
          toast('Salvato: le scadenze si calcolano da questa data.', 'toast-ok', 7000);
          chiudiSheet();
          schedaPresidio(a.id);
        },
      }),
    ]),
  ].filter(Boolean));
  apriSheet(`Dati che mancano · ${titoloPresidio(a)}`, corpo);
}

function formLuogoPresidio(a) {
  const luogo = U.bloccoUbicazione({
    impiantoId: a.impianto_id || '',
    edificioId: a.edificio_id || '',
    localeId: a.locale_id || '',
    conImpianto: true,
    conTesto: a.ubicazione_testo || '',
    // Quello che l'archivio sa già, proposto come nome: i presidi senza area
    // hanno spesso la posizione scritta a parole («Deposito»).
    proposta: (a.ubicazione_testo || '').trim(),
    coordinate: {
      lat: a.lat || '', lon: a.lon || '',
      accuratezza: a.gps_accuratezza_m || null, rilevato_il: a.gps_rilevato_il || '',
    },
    avvisa: (m) => toast(m, 'toast-ko', 9000),
  });
  apriSheet(`Dove sta · ${titoloPresidio(a)}`, el('div', {}, [
    avviso("Senza area e ubicazione questo presidio non si trova navigando: resta "
      + 'sotto «(senza area)», che si legge come un errore dell\'app. Il luogo che '
      + 'manca si crea da qui.', 'avviso-blu'),
    luogo.nodo,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          const errori = luogo.errori();
          if (errori.length) { toast(errori[0], 'toast-ko', 7000); return; }
          const res = await muta(() => {
            // Prima il luogo: se ne crea uno nuovo, il presidio deve riceverne
            // l'id nella stessa transazione.
            const posto = luogo.applica();
            const cambiati = {};
            for (const [k, v] of Object.entries(posto)) {
              if (String(v ?? '') !== String(a[k] ?? '')) cambiati[k] = v;
            }
            if (!Object.keys(cambiati).length) return { n: 0 };
            S.aggiornaAsset(a.id, cambiati);
            return { n: Object.keys(cambiati).length };
          }, null);
          if (!res) return;
          toast(res.n ? 'Ubicazione assegnata' : 'Nessuna modifica.',
            res.n ? 'toast-ok' : undefined);
          chiudiSheet();
          schedaPresidio(a.id);
        },
      }),
    ]),
  ]));
}

function formModificaAsset(a) {
  // Il gruppo «ubicazione» lo disegna `bloccoUbicazione`, non il modulo
  // generico: qui l'area e l'ubicazione sono OBBLIGATORIE (operatore,
  // 19/09/2026) e il luogo che manca si crea sul posto. Il modulo generico non
  // può fare né l'una né l'altra cosa, perché è guidato dai metadati — e i
  // metadati viaggiano nel pacchetto, quindi una regola scritta lì varrebbe
  // solo per chi ha caricato un pacchetto recente.
  const luogo = U.bloccoUbicazione({
    impiantoId: a.impianto_id || '',
    edificioId: a.edificio_id || '',
    localeId: a.locale_id || '',
    conImpianto: true,
    conTesto: a.ubicazione_testo || '',
    // I cinque presidi senza area hanno la posizione già scritta a parole
    // («Deposito»): proporla come nome evita di ricopiarla.
    proposta: (a.ubicazione_testo || '').trim(),
    coordinate: {
      lat: a.lat || '', lon: a.lon || '',
      accuratezza: a.gps_accuratezza_m || null, rilevato_il: a.gps_rilevato_il || '',
    },
    // ⛔ La posizione si salva SUBITO (22/09/2026, segnalazione dell'operatore:
    // «quando salviamo la posizione dovrebbe salvarla subito, non attendere che
    // scrolliamo in fondo e clicchiamo su salva modifiche»).
    //
    // Prendere una posizione è un gesto che si chiude da sé: si guarda la
    // precisione scendere per venticinque secondi e si preme «Salva questa
    // posizione». Chiedere un secondo salvataggio in fondo a un modulo lungo
    // vuol dire che una posizione presa bene si perde scorrendo, e chi l'ha
    // presa non ha modo di accorgersene — è lo stesso difetto del pulsante che
    // non fa niente, solo più caro, perché per rifarla bisogna tornare sul posto.
    //
    // ⚠️ Il modulo resta aperto e il resto si salva com'è sempre stato: qui si
    // scrivono SOLO i quattro campi della posizione.
    onPosizione: async (valori) => {
      const esito = await muta(() => {
        S.aggiornaAsset(a.id, valori);
        return { n: 1 };
      }, null);
      if (esito) {
        toast(valori.lat ? 'Posizione salvata' : 'Posizione tolta', 'toast-ok');
        // La scheda sotto il foglio va rifatta: senza, mostrerebbe ancora la
        // posizione di prima finché qualcuno non la riapre.
        riapriSchedaSeAperta(a.id);
      }
    },
    avvisa: (m) => toast(m, 'toast-ko', 9000),
  });
  const form = formCampi(a, {
    escludiGruppi: ['ubicazione'],
    adminSbloccato: () => ADMIN.sbloccato(),
    // Il foglio è uno solo: chiedere la password copre il modulo. Alla fine —
    // sbloccato o annullato — il modulo si riapre da capo, con il campo aperto se
    // la password era giusta. È dichiarato sul pulsante, perché quello che si è
    // scritto e non salvato si perde.
    sbloccaAdmin: () => ADMIN.chiediAdmin({
      perche: 'Modificare il progressivo Terna',
      apri: apriSheetConChiusura,
      chiudi: () => formModificaAsset(a),
    }),
  });
  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: S.ubicazione(a) }),
    avviso('I campi specifici per tipologia compaiono in base alla categoria. Due non si '
      + 'toccano da qui: il progressivo Terna chiede la password admin, e «di cui guasti» '
      + 'lo scrive il controllo.', 'avviso-blu'),
    el('h3', { testo: 'Ubicazione' }),
    luogo.nodo,
    form.nodo,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva modifiche',
        onclick: async () => {
          const errori = [...luogo.errori(), ...form.errori()];
          if (errori.length) { toast(errori[0], 'toast-ko', 7000); return; }
          const res = await muta(() => {
            // Il luogo prima: se crea un'area nuova, il presidio deve riceverne
            // l'id nella stessa transazione.
            const posto = luogo.applica();
            const cambiati = { ...form.leggi() };
            for (const [k, v] of Object.entries(posto)) {
              if (String(v ?? '') !== String(a[k] ?? '')) cambiati[k] = v;
            }
            if (!Object.keys(cambiati).length) return { n: 0 };
            S.aggiornaAsset(a.id, cambiati);
            return { n: Object.keys(cambiati).length };
          }, null);
          if (!res) return;
          toast(res.n ? `Aggiornati ${res.n} campi` : 'Nessuna modifica.',
            res.n ? 'toast-ok' : undefined);
          chiudiSheet();
        },
      }),
    ]),
  ]);
  // ⛔ `apriSheetConChiusura` e non `apriSheet`: chiudere il foglio con una
  // rilevazione GPS in corso deve SPEGNERE il ricevitore. È la quarta strada
  // d'uscita — le altre tre (salva, annulla, tempo scaduto) le chiude il
  // pannello — e l'unica che il pannello non può vedere.
  // Il titolo dice QUALE pezzo si sta modificando, con le parole scritte sul
  // pezzo (vedi `nomeParlato`): tipologia sopra, progressivo e matricola del
  // costruttore sotto — il sottotitolo resta anche scorrendo il modulo.
  const cat = S.categoriaDi(a) || {};
  const dett = dettaglioTipologia(a);
  const matricola = String(a.matricola == null ? '' : a.matricola).trim();
  apriSheetConChiusura({
    titolo: `Modifica · ${cat.icona || '🧯'} ${[cat.descrizione || a.categoria_codice, dett].filter(Boolean).join(' · ')}`,
    sottotitolo: [a.identificativo ? `progressivo ${a.identificativo}` : '',
      matricola ? `matricola costruttore ${matricola}` : ''].filter(Boolean).join(' · ')
      || 'senza progressivo né matricola',
  }, corpo, () => luogo.chiudi());
}

/**
 * Un presidio trovato in campo e non censito.
 *
 * Riscritto il 16/09/2026 sulle richieste dell'operatore, e ognuna toglie un
 * attrito misurato sul suo telefono:
 *  * la TIPOLOGIA si cerca scrivendo (ventidue voci in una tendina di sistema si
 *    scorrono alla cieca, con la ruota che copre il foglio);
 *  * il PROGRESSIVO TERNA si propone da solo — il primo numero libero — e accetta
 *    solo cifre: è il numero del registro, non un'etichetta libera;
 *  * i DATI DELLA TIPOLOGIA (estinguente, carica, anno, messa in servizio…) si
 *    chiedono subito, perché sono quelli che decidono quali piani si applicano e
 *    da quando contano: compilarli dopo significa un presidio senza scadenze;
 *  * i PIANI si possono copiare da un presidio simile — cioè le sue eccezioni,
 *    che sono l'unica cosa copiabile: i piani veri si applicano da soli;
 *  * e se c'è qualcosa da controllare, la scheda si apre sui controlli.
 */
function formNuovoPresidio() {
  const st = S.get();
  const impianti = st.perEntita[E.IMPIANTO] || [];
  if (!impianti.length) { toast('Carica prima un pacchetto.', 'toast-ko'); return; }
  const categorie = [...S.indici.categorie.values()];

  // Dove sta: impianto, area, ubicazione e posizione precisa, con la creazione
  // dei luoghi dentro. L'ubicazione di terzo livello è OBBLIGATORIA (operatore,
  // 19/09/2026): un presidio che si ferma al secondo livello è introvabile da
  // chi lo cerca dove dovrebbe essere. Se si sta creando DENTRO un nodo
  // «(senza…)», quel segnaposto non si eredita: non è un luogo.
  const luogo = U.bloccoUbicazione({
    impiantoId: dove.impiantoId || impianti[0].id,
    edificioId: dove.edificioId === S.SENZA_LUOGO ? '' : dove.edificioId,
    localeId: (dove.localeId === '__tutti__' || dove.localeId === S.SENZA_LUOGO)
      ? '' : dove.localeId,
    conImpianto: true,
    conTesto: '',
    asterischi: true,
    // Le coordinate si possono prendere già alla creazione: è il momento in cui
    // si è davanti al pezzo, e tornarci apposta dopo non lo fa nessuno.
    coordinate: { lat: '', lon: '', accuratezza: null, rilevato_il: '' },
    avvisa: (m) => toast(m, 'toast-ko', 9000),
  });
  const cerca = sceltaCercabile({
    voci: categorie.map((c) => ({ valore: c.codice, testo: c.descrizione || c.codice, icona: c.icona })),
    valore: '',
    placeholder: 'Cerca la tipologia: estintore, porta, lampada…',
    onCambia: () => { aggiornaTipologia(); },
  });
  // Il progressivo Terna: solo cifre, e il prossimo libero proposto.
  const fId = el('input', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off',
    value: String(S.prossimoProgressivo() || ''),
  });
  // Il doppione si dice SUBITO, mentre si scrive, e non al salvataggio: chi
  // scopre il rifiuto dopo aver compilato tutto il modulo deve tornare indietro
  // a cercare quale campo fosse sbagliato.
  const avvisoId = el('div', { class: 'mini', style: 'color:var(--rosso)', hidden: true });
  const controllaId = () => {
    const pulito = fId.value.replace(/[^0-9]/g, '');
    if (pulito !== fId.value) fId.value = pulito;
    const gemello = pulito ? S.presidioConProgressivo(pulito) : null;
    avvisoId.hidden = !gemello;
    if (gemello) {
      avvisoId.textContent = `Il progressivo ${pulito} è già di ${gemello.codice}`
        + `${S.ubicazione(gemello) ? ` — ${S.ubicazione(gemello)}` : ''}.`;
    }
    return !gemello;
  };
  fId.addEventListener('input', controllaId);
  const fMatr = el('input', { type: 'text' });
  const rigaMatr = campo('Matricola', fMatr);
  const matricolaObbligatoria = () => Boolean(cerca.valore())
    && S.obbligatoriAllaCreazione({ categoria_codice: cerca.valore() }).some((o) => o.nome === 'matricola');
  // ⛔ I MOTIVI per cui non si crea, TUTTI e scritti (23/09/2026, dall'operatore:
  // «a volte non gli fa inserire nuovi presidi, e non si capisce nemmeno cosa
  // stia bloccando»). Prima era un messaggio di tre-sette secondi con UN motivo
  // alla volta, in fondo allo schermo, e nessun campo segnato: si correggeva il
  // primo, si ripremeva, e ne usciva un altro. Adesso restano scritti qui sopra
  // il pulsante, finché non sono risolti, ognuno con «vai al campo».
  const boxErrori = el('div', { class: 'avviso avviso-rosso nuovo-presidio-errori', hidden: true });
  function mostraErrori(errori) {
    svuotaNodo(boxErrori);
    boxErrori.hidden = !errori.length;
    if (!errori.length) return;
    boxErrori.append(el('div', { style: 'font-weight:600', testo: errori.length === 1
      ? 'Non si può ancora creare, per un motivo:' : `Non si può ancora creare, per ${errori.length} motivi:` }));
    for (const e of errori) {
      boxErrori.append(el('div', { class: 'riga', style: 'justify-content:space-between;gap:8px;margin-top:6px' }, [
        el('span', { testo: `• ${e.testo}` }),
        e.dove && e.dove.scrollIntoView ? el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'vai al campo',
          onclick: () => e.dove.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        }) : null,
      ].filter(Boolean)));
    }
    if (boxErrori.scrollIntoView) boxErrori.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const fQta = campoNumerico({ min: 1, valore: 1 });
  const fNote = el('textarea', { placeholder: "Com'è messo" });

  // I campi specifici della tipologia, ridisegnati quando la tipologia cambia.
  const boxTipologia = el('div', {});
  const boxPiani = el('div', { class: 'card card-piatta', style: 'margin-top:10px' });
  let formTipologia = null;
  let daCopiare = null;   // presidio da cui copiare le eccezioni
  let disegnaPiani = () => {};
  const pianiEsclusi = new Set();   // piani a cui l'operatore ha tolto la spunta

  function aggiornaTipologia() {
    const codice = cerca.valore();
    // La matricola è obbligatoria per estintori e porte REI, non per il resto.
    if (rigaMatr.classList) rigaMatr.classList.toggle('campo-obbligatorio', matricolaObbligatoria());
    svuotaNodo(boxTipologia);
    svuotaNodo(boxPiani);
    if (!codice) {
      boxTipologia.append(el('div', { class: 'mini',
        testo: 'Scegli la tipologia: i campi che la riguardano compaiono qui.' }));
      formTipologia = null;
      return;
    }
    formTipologia = formCampi({ categoria_codice: codice }, {
      soloCampo: true,
      escludiGruppi: ['identificazione', 'ubicazione', 'consistenza', 'note'],
      adminSbloccato: () => ADMIN.sbloccato(),
      // Gli obbligatori ALLA CREAZIONE (23/09/2026): la tipologia, e i dati che
      // decidono i piani. Vedi `S.obbligatoriAllaCreazione`.
      obbligatori: (valori) => S.obbligatoriAllaCreazione({ ...valori, categoria_codice: codice }),
    });
    boxTipologia.append(formTipologia.nodo);

    // I PIANI CHE NASCERANNO, non «quanti ce ne sono a catalogo».
    //
    // Richiesta dell'operatore del 17/09/2026. Quali piani si applichino lo
    // decidono i dati appena scritti qui sopra, e chi compila non ha modo di
    // saperlo: scrivere «CO2» invece di «polvere» cambia la revisione da tre anni
    // a cinque, e lo si scoprirebbe mesi dopo dallo scadenzario. Mostrarli mentre
    // si compila trasforma un effetto invisibile in tre righe che si leggono, e
    // si aggiornano a ogni tasto.
    const simili = (st.perEntita[E.ASSET] || []).filter((x) => !x.eliminato_il
      && x.categoria_codice === codice && (S.indici.eccezioniPerAsset.get(x.id) || []).length);
    boxPiani.append(el('h3', { style: 'margin-top:0', testo: 'Piani di verifica che nasceranno' }));
    const elencoPiani = el('div', {});
    boxPiani.append(elencoPiani);
    disegnaPiani = () => {
      svuotaNodo(elencoPiani);
      const candidato = { categoria_codice: codice, ...(formTipologia ? formTipologia.leggi() : {}) };
      const proposti = S.pianiProposti(candidato);
      // Un piano tolto e poi non più proposto (i dati sono cambiati) non deve
      // restare nell'elenco degli esclusi: si porterebbe dietro un'eccezione su
      // un piano che non c'entra più.
      for (const id of [...pianiEsclusi]) {
        if (!proposti.some((p) => p.piano_id === id)) pianiEsclusi.delete(id);
      }
      if (!proposti.length) {
        elencoPiani.append(el('div', { class: 'mini',
          testo: 'Nessun piano si applica con questi dati: il presidio nascerebbe senza '
            + 'scadenze. Controlla i campi della tipologia qui sopra.' }));
        return;
      }
      elencoPiani.append(el('div', { class: 'mini',
        testo: `${proposti.length} piani, decisi dai dati qui sopra. Togli la spunta a quelli `
          + 'che qui non valgono: diventa un\'eccezione, e chiede la password admin.' }));
      for (const p of proposti) {
        const dentro = !pianiEsclusi.has(p.piano_id);
        elencoPiani.append(casellaFiltro(
          `${p.denominazione} — ${PV.etichettaFrequenza(p.frequenza_valore, p.frequenza_unita)}`
          + (p.norma ? ` · ${p.norma}` : ''),
          dentro,
          (v) => {
            if (v) pianiEsclusi.delete(p.piano_id); else pianiEsclusi.add(p.piano_id);
            disegnaPiani();
          }));
      }
      if (pianiEsclusi.size) {
        elencoPiani.append(el('div', { class: 'mini', style: 'color:var(--rosso)',
          testo: `${pianiEsclusi.size} piani esclusi: il presidio nascerà senza quelle scadenze.` }));
      }
    };
    disegnaPiani();
    // I campi della tipologia decidono i piani: l'elenco si rifà a ogni modifica.
    formTipologia.nodo.addEventListener('input', () => disegnaPiani());
    formTipologia.nodo.addEventListener('change', () => disegnaPiani());
    if (simili.length) {
      const fSim = select([{ valore: '', testo: '— nessuno —' },
        ...simili.map((x) => ({ valore: x.id,
          testo: `${(nomePresidio(x).principale || x.codice)} · ${S.ubicazione(x)} · ${(S.indici.eccezioniPerAsset.get(x.id) || []).length} eccezioni` }))], '');
      fSim.addEventListener('change', () => { daCopiare = fSim.value || null; });
      daCopiare = null;
      boxPiani.append(campo('Copia le eccezioni da un presidio simile', fSim,
        'Le eccezioni dicono che un piano NON vale qui, o vale con un\'altra '
        + 'frequenza. Copiarle chiede la password admin, come cambiarle.'));
    } else {
      boxPiani.append(el('div', { class: 'mini', style: 'margin-top:6px',
        testo: 'Nessun presidio di questa tipologia ha eccezioni: non c\'è niente da copiare.' }));
    }
  }

  aggiornaTipologia();

  const rigaTipologia = campo('Tipologia', cerca.nodo);
  if (rigaTipologia.classList) rigaTipologia.classList.add('campo-obbligatorio');
  const corpo = el('div', {}, [
    avviso('Il presidio creato in campo riceve un identificatore univoco generato qui: '
      + 'rientra in Scudo senza rischio di collisione con quelli creati da altri dispositivi.', 'avviso-blu'),
    el('div', { class: 'mini legenda-obbligatori', testo: 'I campi con * sono obbligatori.' }),
    luogo.nodo,
    rigaTipologia,
    el('div', { class: 'campi campi-2' }, [
      el('div', {}, [
        campo(`Progressivo (${S.PREFISSO_PROGRESSIVO}…)`, fId,
          'Solo cifre, e non si ripete: il prefisso lo mette Scudo. È proposto il primo '
          + 'numero libero — cambialo se il cartellino dice altro.'),
        avvisoId,
      ]),
      rigaMatr,
    ]),
    campo('Quantità', fQta),
    boxTipologia,
    boxPiani,
    campo('Note', fNote),
    boxErrori,
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Crea presidio',
        onclick: async () => {
          // Scritta ma non toccata: se le lettere dicono UNA tipologia sola, è
          // quella — la si sceglie, e i suoi campi compaiono.
          if (!cerca.valore() && cerca.corrispondenze().length === 1) {
            cerca.scegli(cerca.corrispondenze()[0].valore);
          }
          const errori = [];
          if (!cerca.valore()) {
            errori.push({ dove: rigaTipologia, testo: cerca.testoCercato()
              ? `Hai scritto «${cerca.testoCercato()}» ma non hai scelto la tipologia: toccala nell'elenco.`
              : 'Scegli la tipologia del presidio.' });
          }
          for (const m of luogo.errori()) errori.push({ dove: luogo.nodo, testo: m });
          if (!controllaId()) errori.push({ dove: fId, testo: avvisoId.textContent });
          if (matricolaObbligatoria() && !fMatr.value.trim()) {
            const o = S.obbligatoriAllaCreazione({ categoria_codice: cerca.valore() }).find((x) => x.nome === 'matricola');
            errori.push({ dove: rigaMatr, testo: `Matricola: obbligatoria — ${o ? o.perche : ''}.` });
          }
          if (formTipologia) {
            const nomi = new Map(formTipologia.obbligatori().map((o) => [o.etichetta, o.nome]));
            for (const m of formTipologia.errori()) {
              const nome = nomi.get(m.split(':')[0]);
              errori.push({ dove: (nome && formTipologia.contenitore(nome)) || boxTipologia, testo: m });
            }
          }
          mostraErrori(errori);
          if (errori.length) {
            toast(errori.length === 1 ? 'Manca una cosa: è scritta sopra il pulsante.'
              : `Mancano ${errori.length} cose: sono scritte sopra il pulsante.`, 'toast-ko', 5000);
            return;
          }
          // Un piano tolto è un'eccezione sui piani, e ogni scrittura sui piani
          // passa dalla password admin: è la stessa regola che vale nella scheda
          // «Piani», e `test_admin_campo.mjs` censisce che non ci siano strade
          // laterali. Una sola domanda per entrambe le cose.
          const serveAdmin = Boolean(daCopiare) || pianiEsclusi.size > 0;
          if (serveAdmin && !(await ADMIN.chiediAdmin({
            perche: daCopiare && pianiEsclusi.size
              ? 'Escludere piani di verifica e copiare le eccezioni di un altro presidio'
              : (pianiEsclusi.size ? 'Escludere piani di verifica da questo presidio'
                : 'Copiare le eccezioni di un altro presidio'),
            apri: apriSheetConChiusura, chiudi: () => formNuovoPresidio(),
          }))) return;
          const extra = formTipologia ? formTipologia.leggi() : {};
          const nuovo = await muta(() => {
            const creato = S.creaPresidio({
              // `applica()` crea anche i luoghi nuovi, e lo fa QUI dentro: nella
              // stessa transazione del presidio, o un salvataggio rifiutato
              // lascerebbe in archivio un'area vuota che nessuno ha chiesto.
              ...luogo.applica(),
              categoria_codice: cerca.valore(),
              identificativo: fId.value.trim()
                ? `${S.PREFISSO_PROGRESSIVO}${fId.value.trim()}` : '',
              matricola: fMatr.value.trim(),
              quantita: Number(fQta.value) || 1,
              note: fNote.value.trim(),
              ...extra,
            });
            // I piani a cui l'operatore ha tolto la spunta diventano eccezioni
            // ESCLUDI, con il motivo scritto: senza motivo, fra un anno nessuno
            // sa se quel piano manchi per una scelta o per un difetto.
            for (const pianoId of pianiEsclusi) {
              S.creaEccezione(creato.id, {
                piano_id: pianoId, azione: PV.ESCLUDI,
                motivo: 'Escluso alla creazione del presidio, in campo',
              });
            }
            if (daCopiare) {
              for (const e of S.indici.eccezioniPerAsset.get(daCopiare) || []) {
                S.creaEccezione(creato.id, {
                  piano_id: e.piano_id, azione: e.azione,
                  frequenza_valore: e.frequenza_valore, frequenza_unita: e.frequenza_unita,
                  motivo: `Copiata alla creazione dal presidio ${daCopiare}: ${e.motivo || 'senza motivo'}`,
                });
              }
            }
            return creato;
          }, 'Presidio creato');
          if (!nuovo) return;
          chiudiSheet();
          // Se c'è qualcosa da controllare, la scheda si apre sui controlli: è il
          // momento in cui si ha il pezzo davanti.
          const voci = S.vociDelGiro(nuovo.id);
          if (voci.mancanti.length) {
            toast(`Creato. ${voci.mancanti.length === 1 ? 'C\'è un controllo da eseguire' : `Ci sono ${voci.mancanti.length} controlli da eseguire`}.`, 'toast-ok');
          }
          schedaPresidio(nuovo.id, { aiControlli: voci.mancanti.length > 0 });
        },
      }),
    ]),
  ]);
  apriSheetConChiusura('Nuovo presidio trovato in campo', corpo, () => luogo.chiudi());
}

/**
 * Il presidio non c'è: ma le ragioni sono TRE, e finivano in un pulsante solo.
 *
 * ⛔ Sdoppiato il 20/09/2026, dopo aver misurato dove finiva la segnalazione:
 * `eliminato_il` toglie il presidio da OGNI vista dell'ufficio — elenco,
 * estrazioni, cruscotto, pacchetto — e lascia il motivo in un posto che nessuno
 * guarda. Per «è stato tolto» quella è la risposta sbagliata: la postazione
 * esiste, è scoperta, e questo è il fatto che l'ufficio deve vedere.
 *
 *   è stato sostituito   -> sostituzione (un pezzo ARRIVA, con le sue date)
 *   è stato tolto        -> DISMESSO + anomalia (resta, visibile, senza lavoro)
 *   non è mai esistito   -> cancellazione (la riga non doveva esserci)
 */
function formEliminaAsset(a) {
  const fMotivo = el('textarea', { placeholder: "Perché non c'è più (obbligatorio)" });
  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${nomeParlato(a)} · ${S.ubicazione(a)}` }),

    // ⛔ La domanda che viene PRIMA, e che qui non si faceva (19/09/2026,
    // richiesta dell'operatore). «Rimosso» e «sostituito» si somigliano davanti
    // a una postazione vuota, ma nell'archivio sono opposti: rimosso vuol dire
    // che la postazione resta scoperta e le sue scadenze si chiudono; sostituito
    // vuol dire che c'è un pezzo nuovo, con le SUE date, e i controlli ripartono
    // da quelle. Chi sbaglia strada qui non lo scopre più: il presidio sparisce
    // dagli elenchi e il pezzo nuovo non esiste da nessuna parte.
    el('div', { class: 'card card-piatta', style: 'margin:10px 0' }, [
      el('div', { style: 'font-weight:600', testo: "C'è un altro pezzo al suo posto?" }),
      el('div', { class: 'mini', style: 'margin:2px 0 8px' }, [
        'Se questo presidio è stato TOLTO e ne è arrivato un altro — anche un '
        + 'muletto che poi rientra — non è una rimozione: è una sostituzione, e va '
        + 'registrata così, o il pezzo nuovo non risulta da nessuna parte.',
      ]),
      el('button', {
        class: 'btn btn-blocco', type: 'button',
        testo: '↔ Registra la sostituzione',
        onclick: () => { chiudiSheet(); formSostituisciPezzo(a, () => schedaPresidio(a.id)); },
      }),
    ]),

    campo('Motivo', fMotivo),

    // ⛔ Le due strade restanti, ognuna con la sua conseguenza SCRITTA. Erano un
    // pulsante solo («Segnala rimosso») che faceva la seconda: e la seconda, su
    // un pezzo che c'era davvero, cancella dall'archivio la prova che quella
    // postazione esiste ed è scoperta.
    el('div', { class: 'card card-piatta', style: 'margin:14px 0 0' }, [
      el('div', { style: 'font-weight:600', testo: "È stato tolto e non sostituito" }),
      el('div', { class: 'mini', style: 'margin:2px 0 8px', testo:
        'La postazione resta in archivio — segnata «rimosso e non sostituito», '
        + 'quindi senza più verifiche da fare — e si apre un\'anomalia con il '
        + 'motivo, così in ufficio si vede che qui manca la protezione.' }),
      el('button', {
        class: 'btn btn-blocco btn-primario', type: 'button',
        testo: '🚫 È stato tolto: segnala la postazione scoperta',
        onclick: async () => {
          if (!fMotivo.value.trim()) { toast('Il motivo è obbligatorio.', 'toast-ko'); return; }
          const res = await muta(() => S.dismettiPresidio(a.id, fMotivo.value.trim()),
            'Postazione segnata come scoperta, con anomalia.');
          if (res) { chiudiSheet(); schedaPresidio(a.id); }
        },
      }),
    ]),

    el('div', { class: 'card card-piatta', style: 'margin:10px 0 0' }, [
      el('div', { style: 'font-weight:600', testo: 'Non è mai esistito' }),
      el('div', { class: 'mini', style: 'margin:2px 0 8px', testo:
        'Un errore del censimento: questa riga non doveva esserci. Sparisce '
        + "dall'archivio al rientro, e resta solo nel registro delle modifiche "
        + 'con il motivo. Da usare solo se il pezzo non è mai stato lì.' }),
      el('button', {
        class: 'btn btn-blocco', type: 'button',
        testo: '🗑️ Non è mai esistito: togli la riga',
        onclick: async () => {
          if (!fMotivo.value.trim()) { toast('Il motivo è obbligatorio.', 'toast-ko'); return; }
          const ok = await conferma({
            titolo: 'Togliere la riga',
            messaggio: `«${nomeParlato(a)}» sparirà dall'archivio quando il pacchetto rientra.`,
            dettagli: ['Se il pezzo c\'era ed è stato tolto, usa invece «è stato tolto»: '
              + 'la postazione va tenuta, o in ufficio nessuno saprà che è scoperta.'],
            ok: 'Togli la riga',
            variante: 'btn-pericolo',
          });
          if (!ok) return;
          const res = await muta(() => S.eliminaPresidio(a.id, fMotivo.value.trim()),
            'Riga tolta dal censimento');
          if (res) chiudiSheet();
        },
      }),
    ]),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
    ]),
  ]);
  apriSheet('Questo presidio non c\'è', corpo);
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
    placeholder: 'Es. Ufficio TP privo di cartello uscita emergenza',
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
    valore: an.stato || 'APERTA', etichetta: statoAnomaliaAParole(an.stato), icona: '🔖',
  })).map((r) => ({ ...r, tono: '', sotto: (STATI_ANOMALIA_A_PAROLE[r.valore] || {}).spiega || null })),
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
    ...STATI_ANOMALIA.map((x) => filtroBottone(statoAnomaliaAParole(x), filtroAnomalie.stato === x, () => {
      filtroAnomalie.stato = filtroAnomalie.stato === x ? '' : x;
      if (filtroAnomalie.stato) filtroAnomalie.soloAperte = false;
      disegna();
    })),
  ]));
  // Che cosa vuol dire ogni stato, sotto i pulsanti: su un telefono non ci
  // sono i suggerimenti al passaggio del mouse, e «in lavorazione» senza la
  // riga che dice «conta ancora fra le aperte» si legge come «quasi fatto».
  frag.append(el('div', { class: 'mini legenda-stati-anomalia', style: 'margin:-2px 0 10px',
    testo: STATI_ANOMALIA.map((s) => `${statoAnomaliaAParole(s)}: ${STATI_ANOMALIA_A_PAROLE[s].spiega}`).join(' · ') }));

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

  // Quanti PRESIDI stanno dietro alle scadute (20/09/2026). Fino a oggi questa
  // scheda contava solo le scadenze, che sono il LAVORO: «478 scadute» su 275
  // pezzi è un quadro molto diverso da 478 su 478, e la differenza decide se si
  // va una volta in quel posto o quattro. Un estintore con controllo, revisione,
  // collaudo e fine vita scaduti pesa quattro nel primo numero e uno qui.
  const presidiScaduti = new Set(lista
    .filter((x) => S.semaforo(x.data_scadenza) === 'SCADUTO')
    .map((x) => x.asset_id)).size;

  frag.append(el('div', { class: 'griglia-kpi' }, [
    kpi(lista.length, 'scadenze aperte'),
    kpi(scadute, 'scadute', scadute ? 'rosso' : 'verde'),
    kpi(inScadenza, 'in scadenza', inScadenza ? 'ambra' : 'verde'),
    kpi(presidiScaduti, 'presidi da recuperare', presidiScaduti ? 'rosso' : 'verde'),
  ]));
  if (scadute) {
    frag.append(el('div', { class: 'mini', style: 'margin:-4px 0 10px', testo:
      `Le ${scadute} verifiche scadute stanno su ${presidiScaduti} presidi: `
      + `${(scadute / presidiScaduti).toFixed(1).replace('.0', '')} a testa in media.` }));
  }

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

/**
 * La mappa dei luoghi e dei presidi che hanno una posizione.
 *
 * ⚠️ Oggi sono pochi, e va detto invece di lasciare una mappa vuota: misurato
 * il 20/09/2026, 5 impianti su 30 e ZERO presidi su 868. La posizione si prende
 * in campo, e la mappa si riempie man mano — ma chi la apre e trova cinque
 * puntini deve capire perché, o conclude che sia rotta.
 */
/**
 * Che cosa succede toccando un punto sulla mappa.
 *
 * ⛔ Non si salta più direttamente all'elenco (20/09/2026, richiesta
 * dell'operatore). Un tocco su una mappa è per sua natura IMPRECISO — i punti
 * sono grandi come un polpastrello e a volte si sovrappongono — e portare via
 * da dove si sta guardando, senza un passaggio, vuol dire che per tornare
 * indietro bisogna riorientarsi da capo. Peggio: chi tocca un impianto di solito
 * non vuole «i suoi presidi», vuole sapere DOV'È e come arrivarci, che è
 * esattamente ciò per cui ha aperto la mappa.
 *
 * Quattro risposte, nell'ordine in cui servono a chi è in macchina o davanti a
 * un cancello: dove sono, come ci arrivo, correggi il punto, portami dentro.
 */
/** Dalla mappa alla lista: è la vecchia strada del tocco, ora dietro un pulsante. */
function vaiDaMappa(p) {
  // Dalla mappa aperta sopra l'elenco si va DOVE si è chiesto: la mappa si
  // chiude, o resterebbe a coprire la scheda o i presidi appena aperti.
  chiudiMappaDelPresidio();
  if (p.tipo === 'presidio') { schedaPresidio(p.id); return; }
  dove = p.tipo === 'impianto' ? { impiantoId: p.id, edificioId: '', localeId: '' }
    : p.tipo === 'edificio' ? { impiantoId: (p.riga || {}).impianto_id || '', edificioId: p.id, localeId: '' }
      : { ...dove, localeId: p.id };
  vaiA('presidi');
}

/**
 * Le DUE strade per dare una posizione a un luogo, e la scelta è dell'operatore.
 *
 * ⛔ Chiedere quale (20/09/2026, richiesta dell'operatore) invece di offrire
 * solo il GPS. Le due non sono una buona e una di ripiego:
 *
 * * **il satellite** misura dove sei ADESSO, quindi vale solo se sei sul punto,
 *   e dentro una cabina o sotto un capannone spesso non prende affatto;
 * * **a mano** vale anche da lontano e non misura niente: riconosci il tetto
 *   giusto sulla fotografia. Sopra un edificio grande è spesso più preciso di
 *   un GPS che rimbalza sulle pareti.
 *
 * Chi è sul posto sa quale delle due ha in mano. Sceglierlo al posto suo vuol
 * dire, metà delle volte, dargli lo strumento che lì non funziona.
 */
function comeCorreggerePosizione(p) {
  const corpo = el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:10px',
      testo: `Come vuoi dare la posizione ${p.nome ? `a «${p.nome}»` : ''}?` }),
    el('div', { class: 'azioni-presidio' }, [
      el('button', {
        class: 'btn btn-blocco', type: 'button',
        testo: '🛰 Con il satellite (sono sul posto)',
        onclick: () => { chiudiSheet(); posizioneLuogo(p.tipo, p.id, p.nome); },
      }),
      el('button', {
        class: 'btn btn-blocco', type: 'button',
        testo: '✛ A mano, sulla mappa',
        onclick: () => { chiudiSheet(); posizionaSullaMappa(p); },
      }),
    ]),
    el('div', { class: 'mini', style: 'margin-top:10px', testo:
      'Il satellite misura dove sei adesso: serve essere lì, e dentro una cabina '
      + 'spesso non prende. A mano funziona anche da lontano, e sopra un edificio '
      + "grande è spesso più preciso del GPS." }),
  ]);
  apriSheet('Posizione', corpo);
}

/**
 * I campi di una posizione data A MANO — con la croce o trascinando il punto.
 * Uguali per luoghi e presidi, e in un posto solo: le due strade devono
 * scrivere la stessa cosa.
 */
function campiPosizioneAMano(p, punto) {
  const campi = {
    lat: Number(punto.lat).toFixed(6),
    lon: Number(punto.lon).toFixed(6),
    // ⛔ L'accuratezza del GPS si AZZERA: questa posizione non è stata
    // misurata, e lasciare il ±4 m della lettura di prima la farebbe passare
    // per un rilievo con una precisione che nessuno ha mai verificato.
    gps_accuratezza_m: '',
    gps_rilevato_il: '',
  };
  // ⛔ E per un impianto cade il marchio «ricavata»: l'ha messa una persona
  // che è lì. Senza questa riga la mappa continuerebbe a disegnarlo
  // tratteggiato anche dopo che qualcuno l'ha corretto a mano — cioè
  // direbbe «non fidarti» proprio del punto più affidabile che abbiamo.
  if (p.tipo === 'impianto') campi.coordinate_origine = 'RILIEVO';
  return campi;
}

/** Il posizionamento a mano: la croce sulla mappa, fino alla conferma. */
function posizionaSullaMappa(p) {
  // Senza una mappa a schermo (dai Presidi, 24/09/2026) si apre quella SOPRA
  // l'elenco, già sul luogo che contiene il punto: posizionare a mano non deve
  // voler dire cambiare scheda e ritrovarlo.
  if (!mappaViva) {
    const ha = S.haPosizione(p.riga || {});
    mappaSopraElenco({ id: ha ? p.id : null, centro: ha ? p.riga : (p.partenza || null),
      titolo: `📍 ${p.nome || 'Posizione'}`, sottotitolo: p.sottotitolo || '' });
  }
  if (!mappaViva) { toast('Apri la mappa per posizionare a mano.', 'toast-ko'); return; }
  const riga = p.riga || {};
  // Senza una posizione sua si parte dal luogo che lo contiene (`partenza`,
  // dall'elenco dei senza posizione): la croce nasce lì, non nel mezzo di
  // quello che si stava guardando.
  const suo = S.haPosizione(riga);
  const da = suo ? { lat: riga.lat, lon: riga.lon } : (p.partenza || {});
  mappaViva.posizionaAMano(da, async (punto) => {
    if (!punto) return;          // annullato, o mappa lasciata: non si scrive niente
    const campi = campiPosizioneAMano(p, punto);
    await muta(() => {
      if (p.tipo === 'presidio') S.aggiornaAsset(p.id, campi);
      else S.modificaUbicazione(p.tipo, p.id, campi);
      return { messaggio: 'Posizione aggiornata.' };
    }, 'Posizione aggiornata.', { annullabile: true, dopoAnnulla: disegna });
  }, { avvicina: !suo });
}

/**
 * La croce sulla mappa per un MODULO ancora aperto (25/09/2026): non scrive
 * niente, restituisce il punto scelto (o `null` se annullato) a chi riapre il
 * modulo. La mappa è quella a schermo se c'è, altrimenti quella sopra l'elenco,
 * che si richiude a punto scelto.
 */
function posizionaPerIlModulo({ titolo, partenza, onFine }) {
  const aperta = mappaViva ? null : mappaSopraElenco({ id: null, centro: partenza || null, titolo });
  if (!mappaViva) { toast('Apri la mappa per posizionare a mano.', 'toast-ko'); onFine(null); return; }
  let fatto = false;   // chiudere la mappa richiama la fine con null: una volta sola
  mappaViva.posizionaAMano(partenza || {}, (punto) => {
    if (fatto) return;
    fatto = true;
    if (aperta && aperta.livello) aperta.livello.chiudi();
    onFine(punto || null);
  }, { avvicina: true });
}

/**
 * Un punto TRASCINATO sulla mappa, in modalità «✋ sposta i punti» (23/09/2026,
 * richiesta dell'operatore).
 *
 * ⛔ Si CHIEDE, a ogni rilascio del dito, e solo allora (23/09/2026, seconda
 * richiesta: «il toast deve chiedere conferma, spostare sì o no, anziché
 * annulla, così che se li abbiamo spostati per errore possiamo annullare a ogni
 * trascinamento»). Prima si salvava subito con «clicca per annullare»: un dito
 * che scivola è l'errore più probabile di questa modalità, e un messaggio che
 * sparisce dopo sette secondi è una rete troppo corta. Adesso il punto resta
 * dove è stato lasciato, IN ATTESA, e la domanda resta finché non si risponde:
 * «No» lo rimette dov'era (lo fa la mappa), «Sì» lo scrive.
 *
 * Una domanda alla volta: finché c'è, la mappa non fa prendere altri punti.
 * Lasciando la schermata senza rispondere, la risposta è «no».
 */
let confermaSpostamento = null;
async function spostaPuntoSullaMappa(p, punto) {
  const nome = p.etichetta || p.nome || 'il punto';
  confermaSpostamento = chiediConferma(`Spostare «${nome}» qui?`, { si: 'Sì, sposta', no: 'No' });
  const ok = await confermaSpostamento.risposta;
  confermaSpostamento = null;
  if (!ok) return false;
  const campi = campiPosizioneAMano(p, punto);
  const esito = await muta(() => {
    if (p.tipo === 'presidio') S.aggiornaAsset(p.id, campi);
    else S.modificaUbicazione(p.tipo, p.id, campi);
    return true;
  }, `Posizione di «${nome}» salvata.`);
  return Boolean(esito);
}

/**
 * Il registro antincendio dell'impianto: documenti e persone.
 *
 * ⛔ Dentro la scheda dell'impianto e non in una tab nuova (20/09/2026,
 * richiesta dell'operatore). Le sette schede in fondo sono già al limite della
 * barra su un telefono: un'ottava le rende tutte più strette e nessuna più
 * raggiungibile. E l'impianto un posto ce l'ha già — la radice dei Luoghi, e
 * il tocco sulla mappa — quindi non c'è nessun gesto nuovo da imparare.
 *
 * ⚠️ In SOLA LETTURA qui, come il catalogo dei piani: chi è davanti ai Vigili
 * del Fuoco deve poter leggere il numero del CPI senza chiedere una password a
 * nessuno. Cambiarlo è un'altra cosa, e sta dietro «Modifica».
 */
/**
 * Modifica i dati del registro dell'impianto. Dietro la password.
 *
 * ⛔ La password difende ciò che cambia il lavoro di chi non è presente, ed è
 * il caso: questi campi arrivano dall'ufficio, e un numero di CPI cambiato in
 * campo torna indietro e diventa quello di tutti.
 *
 * ⚠️ La scrittura passa da `modificaImpianto`, che passa da `applica(...)` come
 * tutte le altre: se non finisse nel giornale non sopravvivrebbe alla staffetta
 * e in ufficio nessuno saprebbe chi l'ha cambiato.
 */
function formRegistroImpianto(riga) {
  // ⛔ Le DATE sono campi data, non testo (22/09/2026, segnalazione
  // dell'operatore: «quei dati non si aggiornano facilmente»). Erano sei caselle
  // di testo con scritto «nella forma 2021-10-07»: su un telefono, con i guanti,
  // significa digitare dieci caratteri nell'ordine giusto e senza nessun
  // controllo — e una data scritta storta non produce un errore, produce un
  // adempimento che scade nel giorno sbagliato.
  const CAMPI = [
    ['codici_attivita', 'Attività soggette (DPR 151/2011)', 'text',
     'Nella forma «49.1.A». Più di una si separano con «;».'],
    ['cpi_numero', 'CPI — numero', 'text', null],
    ['cpi_rilascio', 'CPI — rilasciato il', 'date', null],
    ['cpi_scadenza', 'CPI — scade il', 'date',
     'Vuoto NON vuol dire scaduto: per molte attività il CPI non scade più, e '
     + 'quello che si rinnova è la conformità qui sotto.'],
    ['scia_protocollo', 'SCIA — protocollo', 'text', null],
    ['scia_data', 'SCIA — data', 'date', null],
    ['conformita_ultimo_rinnovo', 'Conformità — ultimo rinnovo', 'date', null],
    ['conformita_scadenza', 'Conformità — scade il', 'date',
     'Il rinnovo vale 5 anni, 10 per le attività 6, 7, 8, 64, 71, 72 e 77.'],
    // ⛔ Questa riga non c'era, e non c'era nemmeno in ufficio né nell'elenco
    // bianco del server: la data della prova di evacuazione non si poteva
    // aggiornare da nessuna parte. È l'unico di questi adempimenti che scade
    // ogni ANNO, cioè quello che si aggiorna più spesso di tutti.
    ['ultima_prova_evacuazione', 'Ultima prova di evacuazione', 'date',
     'Da qui Scudo calcola la prossima: dodici mesi (DM 02/09/2021).'],
    ['datore_lavoro', 'Datore di lavoro', 'text', null],
    ['rspp', 'RSPP', 'text', null],
    ['aspp', 'ASPP', 'text', null],
    ['rlsa', 'RLSA', 'text', null],
    ['medico_competente', 'Medico competente', 'text', null],
    ['responsabile_registro', 'Responsabile del registro', 'text', null],
    ['squadra_emergenza', 'Squadra di emergenza', 'text', null],
    ['piano_emergenza', 'Piano di emergenza', 'text', null],
  ];
  const campi = new Map();
  const corpo = el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo: riga.denominazione }),
    ...CAMPI.map(([k, etichetta, tipo, aiuto]) => {
      const grezzo = String(riga[k] == null ? '' : riga[k]);
      // ⚠️ Un campo data vuole `AAAA-MM-GG` e rifiuta in silenzio tutto il
      // resto: se in archivio c'è una data scritta in un altro modo — e ce ne
      // sono, la SCIA di SUVERETO è «30/06/2015 - Prot 8871» — il campo si
      // aprirebbe VUOTO e il salvataggio la cancellerebbe. Quella riga resta
      // di testo: così si vede, e chi vuole la corregge.
      const leggibile = tipo !== 'date' || !grezzo || /^\d{4}-\d{2}-\d{2}$/.test(grezzo);
      // Le date leggibili con i tre menù (23/09/2026); quelle scritte in un
      // altro modo restano di testo, per il motivo detto qui sopra.
      const inp = tipo === 'date' && leggibile ? campoData({ valore: grezzo })
        : el('input', { type: leggibile ? tipo : 'text', value: grezzo });
      campi.set(k, inp);
      return campo(etichetta, inp, aiuto || undefined);
    }),
    el('div', { class: 'riga riga-fine', style: 'margin-top:14px;gap:8px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: chiudiSheet }),
      el('button', {
        class: 'btn btn-primario', type: 'button', testo: 'Salva',
        onclick: async () => {
          const dati = {};
          for (const [k, inp] of campi) dati[k] = inp.value.trim();
          const esito = await muta(() => {
            S.modificaImpianto(riga.id, dati);
            return { messaggio: 'Registro aggiornato.' };
          }, null);
          if (esito) { chiudiSheet(); disegna(); }
        },
      }),
    ]),
  ]);
  apriSheet(`Registro · ${riga.denominazione}`, corpo);
}

function sezioniImpianto(riga) {
  const val = (k) => String(riga[k] == null ? '' : riga[k]).trim();
  const data = (k) => {
    const v = val(k);
    if (!v) return '';
    const g = frasScadenza(v);
    return `${v}${g && g.testo ? ` — ${g.testo.toLowerCase()}` : ''}`;
  };
  const riga2 = (k, v) => (v ? el('div', { class: 'dove-riga' }, [
    el('span', { class: 'mini', testo: k }), el('span', { testo: String(v) }),
  ]) : null);

  const documenti = [
    riga2('Attività (DPR 151/2011)', val('codici_attivita')),
    riga2('CPI n.', val('cpi_numero')),
    riga2('CPI rilasciato il', val('cpi_rilascio')),
    riga2('CPI scade il', data('cpi_scadenza')),
    riga2('SCIA', [val('scia_protocollo'), val('scia_data')].filter(Boolean).join(' · ')),
    riga2('Conformità rinnovata il', val('conformita_ultimo_rinnovo')),
    riga2('Conformità scade il', data('conformita_scadenza')),
    // La data dell'ultima prova, non solo la scadenza che ne discende: chi è
    // sul posto deve poter dire «questa è vecchia» guardando il giorno in cui
    // è stata fatta, non un conto alla rovescia che parte da lì.
    riga2('Ultima prova di evacuazione', val('ultima_prova_evacuazione')),
  ].filter(Boolean);

  const persone = [
    riga2('Datore di lavoro', val('datore_lavoro')),
    riga2('RSPP', val('rspp')),
    riga2('ASPP', val('aspp')),
    riga2('RLSA', val('rlsa')),
    riga2('Medico competente', val('medico_competente')),
    riga2('Responsabile del registro', val('responsabile_registro')),
    riga2('Squadra di emergenza', val('squadra_emergenza')),
    riga2('Piano di emergenza', val('piano_emergenza')),
  ].filter(Boolean);

  // Gli obblighi che scadono su questo sito, in testa: è la cosa che si guarda.
  const obblighi = S.obblighiDiImpianto(riga.id);
  return el('div', {}, [
    obblighi.length ? el('div', {}, [
      el('h3', { testo: `Scadenze di questo impianto (${obblighi.length})` }),
      el('ul', { class: 'elenco' }, obblighi.map((o) => {
        const tc = S.indici.tipiControllo.get(o.tipo_controllo_codice);
        const f = frasScadenza(o.data_scadenza);
        return el('li', {}, [
          el('div', { class: 'voce', style: 'cursor:default' }, [
            el('span', { class: `barra-stato ${f.classe || ''}` }),
            el('span', { class: 'voce-corpo' }, [
              el('div', { class: 'voce-titolo',
                testo: (tc && tc.descrizione) || o.tipo_controllo_codice }),
              el('div', { class: 'voce-sotto', testo: `${o.data_scadenza} — ${f.testo}` }),
            ]),
          ]),
        ]);
      })),
    ]) : null,
    el('h3', { testo: 'Documenti' }),
    documenti.length ? el('div', {}, documenti)
      // ⚠️ Il vuoto si DICE, e si dice che cosa vuol dire: una sezione vuota
      // senza spiegazione si legge come «questo impianto non ha un CPI», che
      // è un'affermazione che nessuno ha fatto.
      : el('div', { class: 'mini', testo:
        'Il registro di questo impianto non è ancora stato riportato in Scudo. '
        + "Non vuol dire che manchi: vuol dire che qui non c'è." }),
    persone.length ? el('div', {}, [el('h3', { testo: 'Chi' }), ...persone]) : null,
    el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:10px',
      testo: `${ADMIN.sbloccato() ? '' : '🔒 '}✎ Modifica i dati del registro`,
      onclick: conAdmin('Modificare i dati del registro antincendio',
        () => { chiudiSheet(); formRegistroImpianto(riga); }),
    }),
  ].filter(Boolean));
}

/**
 * Copia un testo negli appunti, e lo DICE.
 *
 * ⛔ 22/09/2026, richiesta dell'operatore: «deve essere possibile copiare il
 * link google map così che possiamo inviare l'ubicazione di un presidio ad
 * un'altra persona, senza dover aprire google map e copiare manualmente l'url».
 *
 * ⚠️ `navigator.clipboard` non esiste su tutti i browser e su una pagina non
 * https nemmeno: il ripiego mostra il link in un foglio, già selezionabile, così
 * si copia a mano invece di non avere niente. Un pulsante che non fa niente e
 * non lo dice è peggio di un pulsante assente — è la stessa regola per cui
 * «elimina» non sparisce ma si spegne con il motivo.
 */
async function copiaNegliAppunti(testo, messaggio) {
  const valore = String(testo || '').trim();
  if (!valore) return false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(valore);
      toast(messaggio || 'Copiato.', 'toast-ok', 6000);
      return true;
    }
  } catch (e) { /* si passa al ripiego */ }
  const campoTesto = el('input', { type: 'text', value: valore, readonly: true });
  campoTesto.style.width = '100%';
  apriSheet('Copia il link', el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo:
      'Questo browser non lascia copiare da solo: tieni premuto sul testo, '
      + 'scegli «Copia» e incollalo nel messaggio.' }),
    campoTesto,
    el('div', { class: 'riga riga-fine', style: 'margin-top:12px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Chiudi', onclick: chiudiSheet }),
    ]),
  ]));
  return false;
}

function schedaPuntoMappa(p) {
  const riga = p.riga || {};
  const coord = U.coordinateLeggibili(riga.lat, riga.lon);
  const ORIGINE = {
    RILIEVO: ['📍 rilevata sul posto', 'porta al cancello'],
    SOTTOSTAZIONE: ['◌ ricavata dalla sottostazione sulla mappa pubblica',
      'porta alla sottostazione, non necessariamente al cancello'],
    INDIRIZZO: ['◌ ricavata dall\'indirizzo', 'porta nella via giusta, non al cancello'],
  };
  const orig = ORIGINE[riga.coordinate_origine];

  // ⛔ Etichetta SOPRA il valore, non attaccata (23/09/2026, dallo schermo
  // dell'operatore: «CategoriaTarga acustico-visiva», «DoveSUVERETO / …»). Due
  // span in fila senza spazio si leggono come una parola sola; su un telefono
  // la colonna dell'etichetta a fianco toglierebbe metà della riga al valore.
  const voce = (etichetta, valore) => (valore
    ? el('div', { class: 'scheda-voce' }, [
      el('div', { class: 'scheda-voce-etichetta', testo: etichetta }),
      el('div', { class: 'scheda-voce-valore', testo: String(valore) }),
    ]) : null);

  const indirizzo = U.indirizzoLeggibile(riga);
  const link = U.linkIndicazioni(riga);
  const TIPO = { impianto: 'Impianto', edificio: 'Area', locale: 'Ubicazione', presidio: 'Presidio' };

  // ⛔ Per un PRESIDIO la scheda dice chi è e come sta (22/09/2026, richiesta
  // dell'operatore: «cliccabili in modo che mostri un tooltip con i dati in
  // anagrafica, se scaduto o no, etc»). Un pallino che si apre su un nome e due
  // coordinate non dice niente che la mappa non dicesse già.
  const presidio = p.tipo === 'presidio' ? riga : null;
  const scadenze = presidio ? S.scadenzeDi(presidio.id) : [];
  const prossima = scadenze[0] || null;
  const voci = presidio ? S.vociDelGiro(presidio.id) : null;
  const cat = presidio ? S.categoriaDi(presidio) : null;

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: TIPO[p.tipo] || p.tipo }),
    // Per un presidio il nome è già il titolo del foglio (categoria,
    // progressivo, matricola): ripeterlo qui sotto era la seconda volta.
    p.tipo !== 'presidio'
      ? el('div', { style: 'font-weight:600;margin-bottom:8px', testo: p.nome }) : null,
    // Lo stato, come nell'elenco: le stesse due domande, con le stesse parole.
    presidio ? el('div', { class: 'riga', style: 'gap:6px;margin-bottom:8px;flex-wrap:wrap' }, [
      tagIdoneita(S.idoneita(presidio)),
      tagVerifiche(S.statoVerifiche(presidio)),
      voci && voci.mancanti.length
        ? tag(`⚑ ${voci.mancanti.length} da controllare`, 'tag-ambra')
        : tag('✓ niente da fare in questo giro', 'tag-verde'),
    ]) : null,
    presidio ? voce('Categoria', (cat && cat.descrizione) || presidio.categoria_codice) : null,
    presidio ? voce('Progressivo Terna', presidio.identificativo) : null,
    presidio ? voce('Matricola', presidio.matricola) : null,
    presidio ? voce('Dove', S.ubicazione(presidio)) : null,
    // «Nessuna scadenza calcolata» lo dicono già le due pastiglie sopra: qui
    // era la TERZA volta sullo stesso schermo. La riga c'è quando dice una data.
    presidio && prossima ? voce('Prossima scadenza',
      `${dataIt(prossima.data_scadenza)} — ${frasScadenza(prossima.data_scadenza).testo}`) : null,
    // L'indirizzo solo se è un INDIRIZZO: per un luogo che non ne ha uno,
    // `indirizzoLeggibile` ripiega sulle coordinate, e la riga sotto le
    // ripeteva identiche.
    riga.indirizzo ? voce('Indirizzo', indirizzo) : null,
    voce('Coordinate', coord),
    // Per un IMPIANTO la scheda continua: il registro antincendio del sito.
    p.tipo === 'impianto' ? sezioniImpianto(riga) : null,
    // ⚠️ L'origine si scrive A PAROLE e non solo col pallino tratteggiato sulla
    // mappa: qui la persona sta per decidere se mettersi in macchina, ed è il
    // momento in cui la differenza fra «rilevata» e «ricavata» conta davvero.
    orig ? el('div', { class: 'avviso', style: 'margin-top:8px' }, [
      el('div', { testo: orig[0] }),
      el('div', { class: 'mini', testo: orig[1] }),
    ]) : null,
    !coord ? el('div', { class: 'mini', style: 'margin-top:8px',
      testo: 'Questo luogo non ha ancora una posizione registrata.' }) : null,
    // ⛔ Una posizione PROPOSTA dall'app non è nel rilievo, e lo dice: finché
    // non la si conferma non arriva in ufficio (vedi `posizioni_proposte.js`).
    p.proposta ? el('div', { class: 'avviso avviso-blu', style: 'margin-top:8px' }, [
      el('div', { testo: '💡 Posizione proposta dall\'app, non ancora nel rilievo' }),
      el('div', { class: 'mini', testo: `Viene dalla ${p.proposta.perche}. Confermala se è giusta: `
        + 'arriverà in ufficio con il pacchetto. Se no, correggila qui sotto.' }),
      el('button', {
        class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:8px',
        testo: '✓ Conferma questa posizione',
        onclick: async () => {
          const esito = await muta(() => {
            S.modificaUbicazione('impianto', p.id, {
              lat: p.proposta.lat, lon: p.proposta.lon,
              gps_accuratezza_m: '', gps_rilevato_il: '',
              coordinate_origine: p.proposta.coordinate_origine,
            });
            return true;
          }, `Posizione di «${p.nome}» confermata.`, { annullabile: true, dopoAnnulla: disegna });
          if (esito) chiudiSheet();
        },
      }),
    ]) : null,

    el('div', { class: 'azioni-presidio', style: 'margin-top:14px' }, [
      link ? el('a', {
        class: 'btn btn-blocco', href: link, target: '_blank', rel: 'noopener',
        testo: '🧭 Naviga fin qui',
      }) : null,
      // ⛔ COPIARE il link, non aprirlo (22/09/2026, richiesta dell'operatore:
      // «deve anche essere possibile copiare il link google map così che
      // possiamo inviare l'ubicazione di un presidio ad un'altra persona senza
      // dover aprire google map e copiare manualmente l'url»).
      //
      // ⚠️ `navigator.clipboard` non c'è dappertutto e su http (non https)
      // nemmeno: il ripiego mostra il link per intero e selezionato, così si
      // copia a mano invece di non avere niente. Un pulsante che non fa niente
      // e non lo dice è peggio di un pulsante assente.
      U.linkMappa(riga.lat, riga.lon) ? el('button', {
        class: 'btn btn-blocco', type: 'button', testo: '🔗 Copia il link della mappa',
        onclick: () => copiaNegliAppunti(U.linkMappa(riga.lat, riga.lon),
          'Link della mappa copiato: incollalo in un messaggio.'),
      }) : null,
      // Per TUTTI i punti, presidi compresi (23/09/2026, richiesta
      // dell'operatore: «metti il pulsante correggi posizione anche sui presidi
      // della mappa, manuale o con gps come per gli impianti»).
      el('button', {
        class: 'btn btn-blocco', type: 'button',
        testo: coord ? '📍 Correggi la posizione' : '📍 Prendi la posizione',
        onclick: () => { chiudiSheet(); comeCorreggerePosizione(p); },
      }),
      el('button', {
        class: 'btn btn-blocco btn-primario', type: 'button',
        testo: p.tipo === 'presidio' ? '➡️ Apri il presidio' : '➡️ Vai ai presidi di qui',
        onclick: () => { chiudiSheet(); vaiDaMappa(p); },
      }),
    ].filter(Boolean)),
  ].filter(Boolean));

  apriSheet(p.nome, corpo);
}

/** La mappa attualmente a schermo, se c'è: serve al posizionamento a mano. */
let mappaViva = null;
/**
 * Quello che la mappa ricorda fra un ridisegno e l'altro: centro, scala,
 * ricerca, modalità «sposta i punti». Ogni salvataggio ridisegna la schermata,
 * e senza questa memoria la mappa tornava ogni volta a tutti gli impianti.
 */
const memoriaMappa = {};
/** Lo stesso, per l'elenco dei senza posizione accanto alla mappa. */
const memoriaSenza = {};

/**
 * I punti della mappa: impianti, aree, ubicazioni e presidi.
 *
 * ⛔ Una funzione a sé (23/09/2026) perché le mappe sono DUE — quella dei
 * luoghi e quella che si apre dall'elenco dei presidi — e devono mostrare la
 * stessa cosa. Due copie di questo ciclo divergerebbero al primo ritocco (il
 * nome dei presidi, la ricerca per luogo, le posizioni proposte), e sulla mappa
 * la differenza non si vede.
 */
function puntiDellaMappa() {
  const st = S.get();
  const punti = [];
  const nomeIm = new Map();
  for (const i of (st.perEntita[E.IMPIANTO] || [])) {
    nomeIm.set(i.id, i.denominazione);
    // `ricavata` distingue un punto dedotto da uno rilevato: oggi lo porta solo
    // l'impianto, che è l'unico livello per cui esiste un indirizzo da cui
    // dedurre. Quando edifici e locali avranno posizioni, arriveranno dal GPS
    // di chi è sul posto — cioè rilevate — e questa riga resterà com'è.
    // ⛔ Dove il pacchetto non ha la posizione ma l'app ne ha una PROPOSTA
    // (`posizioni_proposte.js`, 23/09/2026), il punto si disegna lì — su una
    // COPIA della riga: il rilievo non cambia finché l'operatore non conferma.
    const proposta = propostaPer(i);
    const riga = proposta
      ? { ...i, lat: proposta.lat, lon: proposta.lon, coordinate_origine: proposta.coordinate_origine }
      : i;
    punti.push({ id: i.id, tipo: 'impianto', nome: i.denominazione,
      etichetta: i.denominazione, lat: riga.lat, lon: riga.lon, riga, proposta,
      ricavata: ['INDIRIZZO', 'SOTTOSTAZIONE'].includes(riga.coordinate_origine) });
  }
  const nomeEd = new Map();
  for (const e of (st.perEntita[E.EDIFICIO] || [])) {
    nomeEd.set(e.id, e.denominazione);
    punti.push({ id: e.id, tipo: 'edificio', nome: e.denominazione,
      etichetta: e.denominazione, lat: e.lat, lon: e.lon, riga: e });
  }
  const nomeLoc = new Map();
  for (const l of (st.perEntita[E.LOCALE] || [])) {
    nomeLoc.set(l.id, l.denominazione);
    punti.push({ id: l.id, tipo: 'locale', nome: l.denominazione,
      etichetta: l.denominazione, lat: l.lat, lon: l.lon, riga: l });
  }
  for (const a of (st.perEntita[E.ASSET] || [])) {
    if (a.eliminato_il) continue;
    // ⭐ L'etichetta è il PROGRESSIVO, come ha chiesto l'operatore: è il numero
    // che sta sulla targhetta del pezzo, e su una mappa è l'unica cosa che si
    // può confrontare con quello che si ha in mano.
    //
    // ⛔ `daFare` viaggia con il punto e non si ricalcola a ogni disegno
    // (22/09/2026): la mappa si ridisegna a ogni spostamento del dito, e
    // `vociDelGiro` sceglie i piani di ogni presidio — farlo dentro il ciclo di
    // disegno vorrebbe dire rifare ottocento volte un conto che non cambia.
    //
    // ⛔ E il NOME non è più il codice interno (23/09/2026, segnalazione
    // dell'operatore: toccando un'etichetta la scheda diceva
    // «SUVERETO-STAZIONE-SALAMT1-TARGA_AV-01», un codice che sul campo non si
    // usa). È categoria con emoji, progressivo e matricola — le cose scritte sul
    // pezzo — ed è anche quello su cui si cerca.
    //
    // ⭐ Si cerca anche per DOVE sta (23/09/2026, dall'operatore: «se scrivo
    // "compensatore" dovrebbe mostrarmi tutti i presidi che sono in un'area o
    // edificio che si chiama compensatore»): i NOMI di impianto, area e
    // ubicazione, presi dalle loro righe. ⚠️ Non il codice interno: contiene
    // pezzi abbreviati o vecchi dei nomi («SALAMT1») e troverebbe presidi per
    // parole che sulla mappa non si leggono da nessuna parte.
    const cat = S.categoriaDi(a) || {};
    punti.push({ id: a.id, tipo: 'presidio',
      nome: nomePresidioMappa({ icona: cat.icona, categoria: cat.descrizione || a.categoria,
        identificativo: a.identificativo, matricola: a.matricola }),
      etichetta: a.identificativo || a.matricola || cat.descrizione || a.categoria_codice,
      icona: cat.icona || '',
      cerca: [dettaglioTipologia(a), a.categoria_codice,
        nomeIm.get(a.impianto_id), nomeEd.get(a.edificio_id), nomeLoc.get(a.locale_id)],
      lat: a.lat, lon: a.lon, riga: a,
      daFare: S.vociDelGiro(a.id).mancanti.length > 0 });
  }
  return punti;
}

/** Le azioni della mappa, le stesse per le due mappe (vedi `puntiDellaMappa`). */
function azioniDellaMappa() {
  return {
    seguiPosizione: U.seguiPosizione,
    avvisa: (m) => toast(m, 'toast-ko', 7000),
    // Il tocco apre la SCHEDA, non porta via: la navigazione vera è un pulsante
    // dentro, preso apposta e non per sfioramento.
    onApri: (p) => schedaPuntoMappa(p),
    spostaPunto: (p, punto) => spostaPuntoSullaMappa(p, punto),
  };
}

function pannelloMappa() {
  // ⛔ La mappa di prima si CHIUDE: un ridisegno ne costruisce una nuova, e
  // quella vecchia teneva acceso il GPS di «dove sono» senza più uno schermo.
  if (mappaViva) { mappaViva.chiudi(); mappaViva = null; }
  const st = S.get();
  // ⛔ Chi NON è sulla mappa, accanto alla mappa (24/09/2026: «metti il filtro
  // posizione anche nella mappa della tab ubicazioni»). Prima c'erano solo gli
  // impianti senza posizione (23/09/2026, «manca Populonia»): adesso anche aree,
  // ubicazioni e presidi, con ricerca, e da ognuno le due strade di sempre
  // (satellite o a mano). A mano la croce parte dal luogo che lo contiene.
  const elencoSenza = vistaSenzaPosizione(raccogliSenzaPosizione(), {
    onPosiziona: (v) => comeCorreggerePosizione({ tipo: v.tipo, id: v.id, nome: v.nome, riga: v.riga, partenza: v.vicino }),
  }, memoriaSenza).nodo;
  // L'elenco sta ACCANTO ai comandi della mappa (24/09/2026): da desktop nella
  // colonna di destra, sul telefono sotto come prima.
  const vista = vistaMappa(puntiDellaMappa(), { ...azioniDellaMappa(), memoria: memoriaMappa, accanto: elencoSenza });
  // Uscendo dalla scheda il GPS si spegne: è la quarta strada, quella che il
  // pannello non può vedere da sé.
  mappaViva = vista;
  alLasciareLaVista = () => {
    // Una domanda «spostare qui?» rimasta aperta vale «no»: chi se ne va non
    // ha confermato niente.
    if (confermaSpostamento) confermaSpostamento.chiudi();
    vista.chiudi(); mappaViva = null;
  };
  return vista.nodo;
}

/**
 * La mappa di UN presidio, aperta dall'elenco sopra l'elenco stesso
 * (23/09/2026, richiesta dell'operatore: «senza cambiare scheda deve aprirsi la
 * mappa, sfruttando i componenti che già abbiamo… chiudendola non dobbiamo
 * perderci ma rimanere dove eravamo nei presidi… e dobbiamo poter attivare lo
 * spostamento con il drag and drop, come nella tab della mappa, così come il
 * comando per vedere dove siamo»).
 *
 * È la STESSA mappa dei luoghi — stessi punti (`puntiDellaMappa`), stesse
 * azioni (`azioniDellaMappa`: «dove sono», «✋ sposta i punti» con la domanda a
 * ogni rilascio, la scheda al tocco) — dentro un livello che si posa sopra
 * l'elenco (`livelloMappa`). Cambia solo da dove parte: centrata sul presidio,
 * con i presidi accesi e il suo anello attorno.
 *
 * ⚠️ Una memoria PROPRIA, non `memoriaMappa`: aprire un estintore non deve
 * spostare la vista che l'operatore si era costruito nella scheda Mappa. E
 * «sposta i punti» riparte spento a ogni apertura: si accende apposta.
 *
 * ⛔ Ogni salvataggio ridisegna la schermata sotto (`disegna`), e la mappa
 * sopra va RIFATTA con i dati nuovi (`rifaiMappaDelPresidio`): dopo «Correggi
 * la posizione» dalla scheda del punto, una mappa che non si rifà mostrerebbe
 * il punto dove non è più. La memoria tiene centro, scala e modalità.
 */
const LATO_MAPPA_PRESIDIO_M = 80;
let mappaSopra = null;

function mappaDelPresidio(assetId) {
  const a = S.indici.assets.get(assetId);
  if (!a || !conPosizione([a]).length) return;
  const cat = S.categoriaDi(a) || {};
  const n = nomePresidio(a);
  mappaSopraElenco({
    id: assetId,
    centro: { lat: Number(a.lat), lon: Number(a.lon) },
    titolo: `${cat.icona || '🧯'} ${[n.principale, cat.descrizione || a.categoria_codice].filter(Boolean).join(' · ')}`,
    sottotitolo: S.ubicazione(a),
  });
}

/**
 * La mappa sopra l'elenco, per QUALUNQUE punto (24/09/2026): un presidio, un
 * impianto, un'area, un'ubicazione — o il luogo che contiene un pezzo ancora
 * senza posizione, quando la si apre per posizionarlo a mano. `id` è il punto
 * da evidenziare (può mancare), `centro` dove guardare (può mancare: allora
 * tutto).
 */
function mappaSopraElenco({ id = null, centro = null, titolo, sottotitolo = '' }) {
  if (mappaSopra) mappaSopra.livello.chiudi();
  const stato = {
    assetId: id,
    memoria: centro && Number.isFinite(Number(centro.lat)) && Number.isFinite(Number(centro.lon))
      ? { vista: { lat: Number(centro.lat), lon: Number(centro.lon), lato: LATO_MAPPA_PRESIDIO_M } } : {},
    vista: null,
    livello: null,
  };
  mappaSopra = stato;
  stato.livello = livelloMappa({
    titolo,
    sottotitolo,
    // Con un foglio aperto sopra (la scheda di un punto), Escape chiude quello.
    puoChiudere: () => !sheetAperto(),
    onChiudi: () => {
      // Una domanda «spostare qui?» rimasta aperta vale «no», come lasciando
      // la scheda Mappa: chi chiude non ha confermato niente.
      if (confermaSpostamento) confermaSpostamento.chiudi();
      if (stato.vista) stato.vista.chiudi();
      if (mappaViva === stato.vista) mappaViva = null;
      if (mappaSopra === stato) mappaSopra = null;
    },
  });
  rifaiMappaDelPresidio();
  return stato;
}

/**
 * Il pulsante di LATO di una riga dei Presidi (24/09/2026, richiesta
 * dell'operatore): «🗺 mappa» se il punto ha una posizione, «📍 posizione» se
 * non ce l'ha — su presidi, impianti, aree e ubicazioni. Prima, senza
 * posizione, la riga restava con il solo pulsante del giro, e dare una
 * posizione voleva dire andare nella scheda Mappa e cercarlo nell'elenco.
 */
/**
 * Il GESTO della posizione di una riga (25/09/2026): con la posizione apre la
 * mappa, senza chiede come darla (satellite o a mano). Un posto solo per le tre
 * facce che lo mostrano — il pulsante dei Presidi, quello dell'albero dei Luoghi
 * e l'icona della modalità «Sposta» — o si separerebbero al primo ritocco.
 */
function gestoPosizione(tipo, riga, nome, sottotitolo = '') {
  const conPos = S.haPosizione(riga) || (tipo === 'impianto' && Boolean(propostaPer(riga)));
  return conPos
    ? { conPos, segno: '🗺', parola: 'mappa', etichetta: `Vedi ${nome} sulla mappa`, fai: () => {
      if (tipo === 'presidio') { mappaDelPresidio(riga.id); return; }
      const centro = S.haPosizione(riga) ? riga : propostaPer(riga);
      mappaSopraElenco({ id: riga.id, centro, titolo: `${ICONE_LUOGO[tipo] || '📍'} ${nome}`, sottotitolo });
    } }
    : { conPos, segno: '📍', parola: 'posizione', etichetta: `Dai una posizione a ${nome}`, fai: () => comeCorreggerePosizione({
      tipo, id: riga.id, nome, riga, partenza: posizioneDelContenitore(tipo, riga), sottotitolo }) };
}

function pulsanteMappaOPosizione(tipo, riga, nome, sottotitolo = '', { alTocco = null } = {}) {
  if (!riga || !riga.id) return null;
  const g = gestoPosizione(tipo, riga, nome, sottotitolo);
  // `alTocco`: stesso aspetto, altro gesto — l'impianto nell'albero dei Luoghi
  // apre «Dove si trova», dove c'è anche il suo registro antincendio.
  const etichetta = alTocco ? `Dove si trova ${nome}` : g.etichetta;
  const onclick = alTocco || g.fai;
  return el('button', {
    class: `btn btn-segna ${g.conPos ? 'btn-mappa-presidio' : 'btn-posizione-manca'}`, type: 'button',
    'aria-label': etichetta,
    onclick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); onclick(); },
  }, [el('span', { 'aria-hidden': 'true', testo: g.segno }), el('span', { testo: g.parola })]);
}

/** Il gesto della posizione di un nodo dell'albero dei Luoghi, e il suo sottotitolo. */
function gestoDelNodo(nodo) {
  if (!nodo || !nodo.riga || !['impianto', 'edificio', 'locale'].includes(nodo.tipo)) return null;
  if (nodo.tipo === 'impianto') {
    const g = gestoPosizione('impianto', nodo.riga, nodo.nome);
    return { ...g, etichetta: `Dove si trova ${nodo.nome}`, fai: () => dovSiTrova(nodo) };
  }
  const edi = nodo.tipo === 'locale' ? (S.indici.edifici.get(nodo.riga.edificio_id) || {}) : nodo.riga;
  const imp = S.indici.impianti.get(edi.impianto_id) || {};
  const sotto = nodo.tipo === 'locale' ? `${imp.denominazione || ''} › ${edi.denominazione || ''}` : (imp.denominazione || '');
  return gestoPosizione(nodo.tipo, nodo.riga, nodo.nome, sotto);
}

/** Il pulsante della posizione di un nodo dell'albero dei Luoghi (25/09/2026). */
function posizioneNelAlbero(nodo) {
  const g = gestoDelNodo(nodo);
  if (!g) return null;
  return el('button', {
    class: `btn btn-segna ${g.conPos ? 'btn-mappa-presidio' : 'btn-posizione-manca'}`, type: 'button',
    'aria-label': g.etichetta,
    onclick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); g.fai(); },
  }, [el('span', { 'aria-hidden': 'true', testo: g.segno }), el('span', { testo: g.parola })]);
}
const ICONE_LUOGO = { impianto: '🏭', edificio: '🏢', locale: '📍' };

function rifaiMappaDelPresidio() {
  const m = mappaSopra;
  if (!m) return;
  if (m.vista) m.vista.chiudi();
  m.vista = vistaMappa(puntiDellaMappa(), { ...azioniDellaMappa(), memoria: m.memoria, evidenzia: m.assetId });
  // «Correggi la posizione → a mano» lavora sulla mappa a schermo: questa.
  mappaViva = m.vista;
  m.livello.mostra(m.vista.nodo);
}

function chiudiMappaDelPresidio() {
  if (mappaSopra) mappaSopra.livello.chiudi();
}

/** La modalità «sposta» dell'albero: accesa con la password admin, spenta da «✓ Fine». */
let modoSposta = false;
const memoriaSposta = { aperti: null, selezione: new Map(), conPresidi: false, arrivati: new Set() };

function azioniSposta() {
  return {
    piano: (elementi, dest) => S.pianoSpostamento(elementi, dest),
    // Passa da `muta()` come ogni scrittura: salva prima di ridisegnare, e il
    // messaggio si ANNULLA con un tocco (`annullaEventi` sa disfare uno
    // spostamento intero, conversioni comprese).
    sposta: (elementi, dest, piano) => muta(() => S.spostaNelAlbero(elementi, dest),
      `Spostat${elementi.length === 1 ? 'o' : 'i'} ${piano && piano.riassunto ? piano.riassunto.dentro : ''}.`,
      { annullabile: true, dopoAnnulla: disegna }),
    presidiDi: (tipo, id) => S.presidiDelLuogo(tipo, id).map((a) => presidioInAlbero(a, S.categoriaDi(a))),
    conferma: ({ titolo, righe, si, onSi }) => {
      apriSheet(titolo, el('div', {}, [
        ...righe.map((r) => el('p', { class: 'sposta-conferma-riga', testo: r })),
        el('div', { class: 'azioni-presidio', style: 'margin-top:14px' }, [
          el('button', { class: 'btn btn-blocco btn-primario', type: 'button', testo: si,
            onclick: () => { chiudiSheet(); onSi(); } }),
          el('button', { class: 'btn btn-blocco', type: 'button', testo: 'Annulla',
            onclick: () => chiudiSheet() }),
        ]),
      ]));
    },
    avvisa: (m) => toast(m, 'toast-ko', 8000),
    // Le STESSE azioni dell'albero normale (23/09/2026): stessa password per i
    // luoghi dell'ufficio, stesso «Elimina» spento quando dentro c'è qualcosa.
    crea: (tipoFiglio, padre) => formUbicazione(tipoFiglio, null, padre.id),
    rinomina: (nodo) => rinominaLuogo(nodo.tipo, nodo.id),
    elimina: (nodo) => eliminaLuogo(nodo.tipo, nodo.id, nodo.nome),
    // La posizione anche qui (25/09/2026, dall'operatore: «anche nella modalità
    // sposta dovremmo mostrare la mappa o la possibilità di aggiungere la
    // posizione»): lo stesso gesto dell'albero normale.
    posizione: gestoDelNodo,
    posizionePresidio: (p) => {
      const a = S.indici.assets.get(p.id);
      return a ? gestoPosizione('presidio', a, nomeParlato(a), S.ubicazione(a)) : null;
    },
    perchePuoi: (nodo) => permessiLuogo(nodo.tipo, nodo.id),
    ridisegna: () => disegna(),
    onFine: () => { modoSposta = false; memoriaSposta.selezione.clear(); disegna(); },
  };
}

function vistaLuoghi() {
  const st = S.get();
  const frag = document.createDocumentFragment();
  frag.append(el('h1', { testo: 'Ubicazioni' }));

  const simili = S.ubicazioniSimili();
  frag.append(sottoSchede(schedaLuoghi, [
    { chiave: 'albero', etichetta: 'Albero' },
    { chiave: 'mappa', etichetta: 'Mappa' },
    { chiave: 'sistemare', etichetta: 'Da sistemare', n: simili.length },
  ], (k) => { lasciaLaVista(); schedaLuoghi = k; }));

  if (schedaLuoghi === 'sistemare') {
    frag.append(pannelloDoppioni(simili));
    return frag;
  }
  if (schedaLuoghi === 'mappa') {
    frag.append(pannelloMappa());
    return frag;
  }

  const azioni = {
    onCrea: (tipoFiglio, padre) => formUbicazione(tipoFiglio, null, padre.id),
    onRinomina: (nodo) => rinominaLuogo(nodo.tipo, nodo.id),
    onDove: (nodo) => dovSiTrova(nodo),
    bottonePosizione: posizioneNelAlbero,
    onElimina: (nodo) => eliminaLuogo(nodo.tipo, nodo.id, nodo.nome),
    perchePuoi: (nodo) => permessiLuogo(nodo.tipo, nodo.id),
    onRifiuto: (motivo) => toast(motivo || 'Non si può eliminare.', 'toast-ko', 7000),
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

  // ⛔ Spostare è una MODALITÀ, non un comando in più su ogni nodo (22/09/2026,
  // richiesta dell'operatore: «l'admin deve poter attivare la modalità drag and
  // drop»). Sei comandi per riga in un albero di seicento luoghi farebbero
  // sparire l'albero; e spostare è un lavoro di riordino che si fa a
  // proposito, non un gesto che capita passando. Si entra con la password
  // admin, come per rinominare o cancellare un luogo dell'ufficio: cambia la
  // STRUTTURA dell'archivio, cioè come lo ritrova chi non è qui.
  if (!modoSposta) {
    frag.append(el('div', { class: 'azioni-luoghi' }, [
      el('button', {
        class: 'btn btn-primario', type: 'button',
        testo: '+ Nuovo impianto', onclick: () => formUbicazione('impianto'),
      }),
      el('button', {
        class: 'btn', type: 'button', testo: '✋ Sposta…',
        title: 'Spostare aree, ubicazioni e presidi, come cartelle',
        onclick: conAdmin('Spostare aree, ubicazioni e presidi', () => {
          modoSposta = true;
          memoriaSposta.selezione.clear();
          disegna();
        }),
      }),
    ]));
  }

  frag.append(campoRicerca(ricercaLuoghi, "Cerca un impianto, un'area, un'ubicazione…",
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

  if (modoSposta) {
    memoriaSposta.aperti = ramiAperti;
    const vs = vistaSposta(radici, azioniSposta(), memoriaSposta);
    // Uscendo dalla scheda si esce anche dalla modalità: ritrovarsela accesa
    // tornando, magari giorni dopo, farebbe spostare con un gesto che si credeva
    // di scorrimento.
    alLasciareLaVista = () => { vs.chiudi(); modoSposta = false; memoriaSposta.selezione.clear(); };
    frag.append(vs.nodo);
    return frag;
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
 * ⚠️ Dal 22/09/2026 metà del lavoro si può fare anche qui: nella modalità
 * «✋ Sposta…» dell'albero (password admin) i presidi di una variante si portano
 * nell'altra, e la variante svuotata si elimina. Spostare la CARTELLA intera
 * dentro quella omonima resta rifiutato: due nomi uguali sotto lo stesso padre
 * farebbero fallire il rientro.
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

/**
 * La password admin davanti a un'azione (`admin.js`): se è già sbloccato procede
 * subito, altrimenti chiede. Regola dell'operatore del 15/09/2026.
 */
function conAdmin(perche, fn) {
  return async () => {
    if (await ADMIN.chiediAdmin({ perche, apri: apriSheetConChiusura, chiudi: chiudiSheet })) fn();
  };
}

function vistaPiani() {
  const frag = document.createDocumentFragment();
  frag.append(el('h1', { testo: 'Piani di verifica' }));
  const aperto = ADMIN.sbloccato();

  // ⛔ LEGGERE non chiede la password, SCRIVERE sì (20/09/2026, richiesta
  // dell'operatore: «dobbiamo poter vedere la mappatura in visualizzazione, la
  // password deve essere solo per la modifica»).
  //
  // Prima l'intera scheda era chiusa, e la difesa era sproporzionata alla cosa
  // difesa: la password protegge le scadenze di presidi che non si hanno
  // davanti — cioè il potere di SPOSTARE del lavoro su qualcun altro. Sapere
  // che cosa prevede un piano, e quali verifiche contiene, non sposta niente: è
  // quello che l'operatore sta per fare con il presidio in mano, e negarglielo
  // vuol dire fargli eseguire una checklist che non può leggere per intero.
  //
  // ⚠️ E una porta chiusa su ciò che si può leggere insegna a chiedere la
  // password per abitudine, cioè la consuma: quando serve davvero, è già stata
  // data a qualcuno che voleva solo guardare.
  if (!aperto) {
    frag.append(avviso('👁 Stai guardando il catalogo in sola lettura: puoi aprire ogni '
      + 'piano e vedere le sue verifiche. Per modificarlo, crearne uno nuovo o applicarlo '
      + 'ai presidi serve la password admin.', 'avviso-blu'));
    frag.append(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin:8px 0 10px',
      testo: '🔒 Sblocca per modificare',
      onclick: conAdmin('Gestire i piani di verifica', () => disegna()),
    }));
    frag.append(catalogoPiani());
    return frag;
  }

  frag.append(el('button', {
    class: 'btn btn-piccolo', type: 'button', style: 'margin:-4px 0 10px',
    testo: '🔒 Blocca di nuovo', onclick: () => { ADMIN.blocca(); disegna(); },
  }));
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

  // Qui NON si usa `selettoreCategoria`: quella lavora sul filtro dei Presidi e
  // vuole le voci nella forma di `categoriePresenti` ({codice, n, categoria}).
  // Questa chiamata le passava già convertite, e dal primo commit la scheda Piani
  // andava in errore («Cannot read properties of undefined (reading
  // 'descrizione')») lasciando la pagina bianca — segnalato il 15/09/2026. E anche
  // senza l'errore avrebbe scritto nel filtro sbagliato.
  const vociCategorie = [...S.indici.categorie.values()].map((c) => ({
    valore: c.codice, etichetta: c.descrizione || c.codice, icona: c.icona,
    n: S.cerca({ ...filtriPiani, categorie: [c.codice] }).length,
  })).filter((x) => x.n > 0);
  const applicaCategorie = (sel) => { filtriPiani = { ...filtriPiani, categorie: sel }; };
  frag.append(rigaFiltro({
    etichettaTutti: 'Tutte le tipologie',
    totale: vociCategorie.reduce((t, v) => t + v.n, 0),
    voci: vociCategorie,
    selezione: filtriPiani.categorie || [],
    onCambia: applicaCategorie,
    onApri: () => pannelloScelta({
      titolo: 'Filtra per tipologia',
      etichettaTutti: 'Tutte le tipologie',
      voci: vociCategorie,
      selezione: filtriPiani.categorie || [],
      onApplica: applicaCategorie,
    }),
  }));

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
/**
 * Un piano di verifica, in SOLA LETTURA, con le sue voci.
 *
 * ⛔ Le voci di checklist non si vedevano da nessuna parte (20/09/2026,
 * segnalazione dell'operatore: «le varie voci di verifica andrebbero potute
 * visualizzare, attualmente non le vediamo»). Comparivano solo DENTRO il modulo
 * di registrazione, cioè quando il controllo era già cominciato: per sapere che
 * cosa un piano chiede bisognava fingere di eseguirlo.
 *
 * ⚠️ E il segno ⊙ sulle CONDIZIONALI va mostrato qui come là: 23 voci del
 * catalogo valgono solo per certi pezzi dentro la stessa categoria (bombole di
 * gas ausiliario, serbatoi PED, pesatura dei CO2). Senza il segno, l'elenco
 * promette un lavoro che su questo pezzo non si fa — ed è esattamente il difetto
 * che il 18/09/2026 produceva «1 verifica su 7 non risulta fatta» su 408
 * estintori, cioè un invito a spuntare a caso.
 */
/** Quali piani si applicano a QUESTO presidio, e che cosa chiedono. */
function pianiDelPresidio(a) {
  const applicabili = S.controlliApplicabili(a).filter((t) => t.piano_id);
  const senzaPiano = S.controlliApplicabili(a).filter((t) => !t.piano_id);
  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: titoloPresidio(a) }),
    applicabili.length
      ? el('ul', { class: 'elenco' }, applicabili.map((t) => {
        const azioni = S.indici.azioniPerPiano.get(t.piano_id) || [];
        return el('li', {}, [
          el('button', {
            class: 'voce', type: 'button',
            onclick: () => { chiudiSheet(); schedaPiano(t.piano_id); },
          }, [
            el('span', { class: 'voce-ico', testo: '📋' }),
            el('span', { class: 'voce-corpo' }, [
              el('div', { class: 'voce-titolo', testo: t.denominazione || t.controllo }),
              el('div', { class: 'voce-sotto', testo: [
                PV.etichettaFrequenza(t.frequenza_valore, t.frequenza_unita),
                `${azioni.length} verifiche`,
                t.norma || null,
              ].filter(Boolean).join(' · ') }),
            ]),
            el('span', { class: 'voce-freccia', testo: '›' }),
          ]),
        ]);
      }))
      : el('div', { class: 'mini', style: 'margin-top:8px',
        testo: 'Nessun piano si applica a questo presidio.' }),
    // ⚠️ I controlli SENZA piano si dicono lo stesso, e col motivo: sono la
    // domanda «perché questo presidio non ha una scadenza», che altrimenti si
    // legge come un dato mancante invece che come una regola che non combacia.
    senzaPiano.length ? el('div', { style: 'margin-top:12px' }, [
      el('h3', { testo: `Controlli senza un piano applicabile (${senzaPiano.length})` }),
      el('ul', { class: 'elenco-semplice' }, senzaPiano.map((t) => el('li', {
        testo: `${t.controllo}${t.causa ? ` — ${t.causa}` : ''}`,
      }))),
    ]) : null,
  ].filter(Boolean));
  apriSheet('Piani di verifica', corpo);
}

function schedaPiano(pianoId) {
  const pn = (S.indici.piani || []).find((x) => x.id === pianoId);
  if (!pn) { toast('Piano non trovato.', 'toast-ko'); return; }
  const azioni = S.indici.azioniPerPiano.get(pn.id) || [];
  const cond = S.indici.condizioniPerPiano.get(pn.id) || [];
  const tc = S.indici.tipiControllo.get(pn.tipo_controllo_codice);
  const ta = S.indici.tipiAsset.get(pn.tipo_asset_codice);
  const obbligatorie = azioni.filter((a) => Number(a.obbligatoria ?? 1) === 1).length;

  const riga = (k, v) => (v ? el('div', { class: 'dove-riga' }, [
    el('span', { class: 'mini', testo: k }), el('span', { testo: String(v) }),
  ]) : null);

  const corpo = el('div', {}, [
    riga('Si applica a', (ta && ta.descrizione) || pn.tipo_asset_codice),
    riga('Tipo di controllo', (tc && tc.descrizione) || pn.tipo_controllo_codice),
    riga('Ogni', PV.etichettaFrequenza(pn.frequenza_valore, pn.frequenza_unita)),
    riga('Norma', pn.norma),
    Number(pn.verificata || 0) === 0
      ? el('div', { class: 'avviso', style: 'margin-top:8px' }, [
        el('div', { testo: '⚠ Periodicità da verificare' }),
        el('div', { class: 'mini', testo: pn.fonte
          || 'Non viene da una norma citata: è una prassi o un valore dichiarato.' }),
      ]) : null,
    pn.note ? el('div', { class: 'mini', style: 'margin-top:8px', testo: pn.note }) : null,

    cond.length ? el('div', {}, [
      el('h3', { testo: `Si applica solo se (${cond.length})` }),
      el('ul', { class: 'elenco-semplice' }, cond.map((c) => el('li', {
        testo: `${c.campo} ${c.operatore} ${c.valore}`,
      }))),
    ]) : null,

    el('h3', { testo: `Verifiche da fare (${azioni.length})` }),
    azioni.length
      ? el('div', {}, [
        obbligatorie !== azioni.length ? el('div', { class: 'mini', style: 'margin-bottom:6px',
          testo: `${obbligatorie} obbligatorie · ${azioni.length - obbligatorie} `
            + 'condizionali (⊙): valgono solo per certi pezzi, e non bloccano l\'idoneità.' }) : null,
        el('ol', { class: 'elenco-voci' }, azioni.map((a) => el('li', {
          testo: `${Number(a.obbligatoria ?? 1) === 1 ? '' : '⊙ '}${a.testo || ''}`,
        }))),
      ].filter(Boolean))
      : el('div', { class: 'mini', testo: 'Questo piano non porta una checklist.' }),

    el('div', { class: 'azioni-presidio', style: 'margin-top:14px' }, [
      el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button',
        testo: '🔒 Modifica (password admin)',
        onclick: conAdmin('Modificare un piano di verifica', () => {
          chiudiSheet(); formPiano(pn.id); disegna();
        }),
      }),
    ]),
  ].filter(Boolean));

  apriSheet(pn.denominazione || pn.id, corpo);
}

function catalogoPiani() {
  const frag = document.createDocumentFragment();
  const piani = (S.indici.piani || []).slice();

  if (ADMIN.sbloccato()) {
    frag.append(el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-bottom:10px',
      testo: '+ Nuovo piano di verifica', onclick: () => formPiano(),
    }));
  }

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
            class: 'voce', type: 'button',
            onclick: () => (ADMIN.sbloccato() ? formPiano(pn.id) : schedaPiano(pn.id)),
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
  const fValore = campoNumerico({ min: 1,
    valore: (esistente && esistente.frequenza_valore) || '' });
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
      // ⛔ Si chiamava «Cambia operatore» e apriva un foglio in SOLA LETTURA dove
    // l'operatore non si può cambiare (19/09/2026). Un'etichetta che promette
    // un'azione inesistente insegna a non fidarsi delle altre. Il divieto di
    // cambiare firma a metà giro è una regola voluta, non un difetto: quindi si
    // corregge il nome, non il foglio.
    testo: 'Chi sta lavorando', onclick: apriSessione,
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
    // ⛔ DUE strade dichiarate, non un pulsante solo (21/09/2026, segnalazione
    // dell'operatore: «non è chiaro se si può esportare il pacchetto e inviarlo
    // al prossimo operatore oppure va chiuso il controllo»).
    //
    // La domanda non era mal posta: il programma si comporta in due modi
    // diversi e non lo diceva in nessun punto. MISURATO:
    //
    //   A conclude e poi esporta -> B carica un giro CONCLUSO, e deve premere
    //   «Riapri il controllo» prima di poter registrare qualunque cosa;
    //   A NON conclude e esporta -> B carica un giro IN CORSO e continua.
    //
    // Quindi la regola è una sola e va scritta dove si decide: **si conclude
    // solo quando il giro finisce davvero**. Un pulsante «Esporta» neutro
    // lasciava dedurre la regola da un comportamento che si scopre sul telefono
    // dell'altro, cioè troppo tardi.
    ...pulsantiConsegna(),
  ]));

  // Il VERBALE da stampare e far firmare (24/09/2026): vedi `formVerbale`.
  frag.append(el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: '4. Verbale da far firmare' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px', testo: 'Il verbale di sorveglianza del committente: '
      + 'i controlli eseguiti dalla ditta in questo giro, con norma ed esito, le anomalie — nuove, riconfermate, '
      + 'risolte —, i sorveglianti e lo spazio per le firme. Uno per impianto, anche tutti in un solo PDF. '
      + 'Non cambia niente nel rilievo.' }),
    el('button', { class: 'btn btn-blocco', type: 'button', testo: '📄 Prepara il verbale in PDF',
      onclick: formVerbale }),
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

/**
 * Che cosa vuol dire «salvataggio a rischio», in parole d'uso.
 *
 * Due cose vanno dette, e in quest'ordine: (1) il lavoro fatto FINORA c'è, così
 * non si smette di lavorare per paura; (2) che cosa fare adesso, che è una cosa
 * sola — esportare più spesso. Il dettaglio tecnico sta in fondo, per chi deve
 * riferirlo a chi può risolverlo.
 */
function spiegaSalvataggioARischio(p) {
  apriSheet('Salvataggio a rischio', el('div', {}, [
    avviso('Il magazzino dati del browser non è utilizzabile su questo telefono, e '
      + 'Scudo Campo sta usando una copia di emergenza. Quello che hai registrato '
      + "c'è: continua a lavorare.", 'avviso-ambra'),
    el('h3', { testo: 'Che cosa cambia' }),
    el('ul', { class: 'mini' }, [
      el('li', { testo: 'La copia di emergenza è più piccola e più fragile: se il '
        + 'telefono chiude la pagina per liberare memoria, il rilievo non ancora '
        + 'esportato può andare perso.' }),
      el('li', { testo: 'Non cambia niente di quello che vedi: i controlli si '
        + 'registrano allo stesso modo.' }),
    ]),
    el('h3', { testo: 'Che cosa fare' }),
    el('div', { class: 'mini' }, [
      'Esporta il pacchetto più spesso del solito — dopo ogni impianto, non a fine '
      + 'giornata. Un pacchetto esportato è al sicuro anche se il telefono perde '
      + 'tutto.',
    ]),
    el('button', {
      class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px',
      testo: 'Vai a Dati ed esporta',
      onclick: () => { chiudiSheet(); vaiA('dati'); },
    }),
    el('h3', { testo: 'Perché succede' }),
    el('div', { class: 'mini' }, [
      'Quasi sempre: la pagina è aperta in navigazione privata, oppure il telefono '
      + 'ha lo spazio quasi esaurito. Aprire Scudo Campo da una finestra normale — '
      + "o installarla con «Aggiungi alla schermata Home» — di solito lo risolve."
      + (p.errore ? ` Dettaglio tecnico: ${p.errore}` : ''),
    ]),
  ]));
}

/** L'altro allarme della fascia: due schede che scrivono lo stesso archivio. */
function spiegaAltraScheda() {
  apriSheet("Aperto in un'altra scheda", el('div', {}, [
    avviso('Scudo Campo è aperto in più di una scheda del browser su questo '
      + 'telefono. Le due schede scrivono lo stesso archivio, e quello che '
      + "registri nell'una può sovrascrivere quello che registri nell'altra.",
    'avviso-ambra'),
    el('div', { class: 'mini', style: 'margin-top:8px' }, [
      'Chiudi le altre schede e lavora da una sola. Se non sai quale sia, chiudile '
      + 'tutte e riapri Scudo Campo: il rilievo è salvato, non si perde niente.',
    ]),
  ]));
}

function diagnostica(p) {
  const st = S.get();
  // Il valore arriva dopo: `caches.keys()` è asincrona, e bloccare il disegno
  // della scheda per un dato di servizio sarebbe il baratto sbagliato.
  versioneInEsecuzione().then((v) => {
    const n = document.getElementById('revisione-attiva');
    if (n) n.textContent = v
      || 'non rilevabile (prima apertura, o revisione precedente al 20/09/2026)';
  });
  // Lo spazio occupato (25/09/2026): misurarlo legge tutto il rilievo, quindi
  // arriva dopo, come la revisione.
  const spazio = el('div', { class: 'mini', style: 'margin-top:10px', testo: 'Misuro lo spazio occupato…' });
  store.misuraSpazio()
    .then((m) => spazio.replaceWith(bloccoSpazio(m)))
    .catch(() => { spazio.textContent = 'Lo spazio occupato non si è potuto misurare.'; });
  return el('div', { class: 'card' }, [
    el('h2', { style: 'margin-top:0', testo: 'Come sono conservati i dati' }),
    p.modalita === 'idb'
      ? avviso('Ogni modifica viene scritta subito nel database del browser. Puoi cambiare schermata, '
        + 'chiudere la scheda o spegnere lo schermo: al rientro ritrovi tutto.', 'avviso-verde')
      : avviso('Il database del browser non è disponibile su questo dispositivo (spesso succede in '
        + 'navigazione privata). Si sta usando la copia di emergenza, che è più fragile: esporta il '
        + `pacchetto spesso.${p.errore ? ` Dettaglio: ${p.errore}` : ''}`, 'avviso-rosso'),
    spazio,
    st.caricato
      ? el('dl', { class: 'dati', style: 'margin-top:10px' }, [
        el('dt', { testo: 'Eventi nel giornale' }), el('dd', { testo: String(st.giornale.length) }),
        el('dt', { testo: 'Esportati' }), el('dd', { testo: String(st.esportato.seq) }),
        // Due cose diverse che prima si chiamavano entrambe «codice»: il codice è
        // quello dell'ufficio (si detta al telefono), l'impronta è il checksum
        // dei dati caricati (serve a riconoscere lo stesso file).
        el('dt', { testo: 'Codice del pacchetto' }),
        el('dd', { class: 'mono', testo: codiceCaricato() || '—' }),
        el('dt', { testo: 'Impronta dei dati' }),
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
    el('div', { class: 'mini', testo: `${g.length} eventi, dal più recente. Ogni modifica fatta su questo dispositivo è qui, e rientra in ufficio con il pacchetto.` }),
    el('div', { class: 'scroll-x' }, [
      el('table', { class: 'tabellina' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { testo: 'Quando' }), el('th', { testo: 'Che cosa è successo' }),
          el('th', { testo: 'Chi' }),
        ])]),
        el('tbody', {}, g.slice(0, 300).map((ev) => {
          const d = S.descriviEvento(ev);
          return el('tr', {}, [
            el('td', { testo: dataOraIt(ev.ts_utc) }),
            el('td', {}, [
              el('div', { style: 'font-weight:600', testo: d.azione }),
              el('div', { class: 'mini', testo: d.cosa }),
              d.dettaglio ? el('div', { class: 'mini', style: 'color:var(--testo-tenue)', testo: d.dettaglio }) : null,
            ].filter(Boolean)),
            el('td', { testo: testo(ev.operatore_nome) }),
          ]);
        })),
      ]),
    ]),
  ]);
  apriSheet('Giornale delle modifiche', corpo);
}

/**
 * Chi sta lavorando su questo dispositivo. In SOLA LETTURA.
 *
 * Il nome non si cambia più da qui (operatore, 17/09/2026). Arriva dalla porta
 * d'accesso — dove ci si identifica una volta — e finisce su ogni controllo e ogni
 * anomalia registrati da questo telefono: un campo modificabile in mezzo al giro
 * significa un verbale firmato da chi non l'ha fatto, e nessuno se ne accorge al
 * rientro. Per cambiare persona si esce («Esci: dimentica questo operatore», nella
 * scheda Dati) e si rientra con la propria identità.
 */
function apriSessione() {
  const st = S.get();
  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: 'Il nome finisce su ogni controllo e ogni anomalia registrata da questo dispositivo.' }),
    el('dl', { class: 'dati' }, [
      el('dt', { testo: 'Operatore' }),
      el('dd', { testo: st.sessione.operatore || nomeCompleto() || '—' }),
      el('dt', { testo: 'Matricola' }),
      el('dd', { class: 'mono', testo: st.sessione.matricola || '—' }),
      el('dt', { testo: 'Dispositivo' }),
      el('dd', { class: 'mono', testo: st.sessione.device_id || S.deviceId() }),
    ]),
    avviso('Per lavorare come un\'altra persona: scheda Dati → «Esci: dimentica questo '
      + 'operatore», poi si rientra con il proprio nome. Cambiare il nome qui, a metà '
      + 'giro, lascerebbe i controlli già registrati firmati dalla persona sbagliata.',
    'avviso-blu'),
    el('div', { class: 'riga riga-fine', style: 'margin-top:16px' }, [
      el('button', { class: 'btn btn-primario', type: 'button', testo: 'Chiudi', onclick: chiudiSheet }),
    ]),
  ]);
  apriSheet('Operatore e dispositivo', corpo);
}

// --------------------------------------------------------------------------- //
// Caricamento ed esportazione dei pacchetti
// --------------------------------------------------------------------------- //
/** Il codice del pacchetto caricato: quello del manifest, o ricavato dal giro. */
function codiceCaricato() {
  const m = S.get().manifest || {};
  return m.codice || codicePacchetto(m.sessione_id) || '';
}

async function caricaFile(file) {
  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    toast(`Impossibile leggere il file: ${e.message}`, 'toast-ko', 8000);
    return;
  }

  try {
    // Lettura, validazione e conferma PRIMA di toccare il dispositivo: l'avviso
    // sul lavoro non esportato sta dentro lo stesso foglio (prima era una
    // domanda separata, fatta ancora prima di sapere che cosa si caricava).
    const r = await caricaConConferma(bytes, {
      leggi: leggiPacchetto,
      valida,
      corrente: () => {
        const st = S.get();
        return {
          caricato: st.caricato,
          checksum: st.sessione.checksum_origine,
          codice: st.caricato ? codiceCaricato() : '',
          modificheNonEsportate: S.lavoroNonEsportato() ? S.riepilogo().modifiche_non_esportate : 0,
        };
      },
      chiedi: (riepilogo) => chiediConfermaPacchetto(riepilogo,
        { apri: apriSheetConChiusura, chiudi: chiudiSheet }),
      applica: async (letto) => {
        S.carica(letto, { nome_file: file.name });
        await store.svuota();
        // Come in `muta`: un salvataggio non riuscito si dice (25/09/2026).
        const salvato = await store.salvaDataset(S.serializza());
        if (!salvato.ok) {
          toast('ATTENZIONE: il pacchetto è aperto ma NON è stato salvato sul dispositivo (spazio esaurito): '
            + 'chiudendo l\'app si perde. Guarda lo spazio nella scheda Dati.', 'toast-ko', 20000);
        }
      },
    });

    if (r.esito === 'non_valido') {
      apriSheet('Pacchetto non valido', el('div', {}, [
        avviso(`Il pacchetto ha ${r.errori.length} problemi e non è stato caricato. `
          + 'I dati sul dispositivo non sono stati toccati.', 'avviso-rosso', r.errori.slice(0, 20)),
        el('button', { class: 'btn btn-blocco', type: 'button', testo: 'Chiudi', onclick: chiudiSheet }),
      ]));
      return;
    }
    if (r.esito === 'annullato') {
      toast('Pacchetto non caricato: i dati sul dispositivo non sono cambiati.', '', 5000);
      return;
    }
    // ⛔ Bloccato: c'è lavoro non esportato su questo telefono, e caricare lo
    // cancellerebbe. Se l'operatore ha scelto la via d'uscita, ce lo si porta.
    if (r.esito === 'bloccato') {
      const n = r.riepilogo.modificheNonEsportate;
      if (r.scelta === 'esporta') { await esportaPacchetto(); return; }
      toast(`Non caricato: prima esporta le ${n} modifiche che hai su questo dispositivo.`,
        'toast-ko', 9000);
      return;
    }

    const rip = S.riepilogo();
    if (r.letto.manifest._modificato) {
      toast("Attenzione: questo pacchetto è stato modificato dopo l'esportazione da Scudo.",
        'toast-warn', 10000);
    }
    toast(r.riepilogo.staffetta
      ? `Continui il giro di ${r.riepilogo.ultimoOperatore || 'un altro operatore'}: `
        + `${r.riepilogo.controlliDelGiro} controlli già registrati.`
      : `Caricato ${r.riepilogo.codice || 'il pacchetto'}: ${rip.righe} presidi su ${rip.impianti} impianti.`,
    'toast-ok', 7000);
    dove = { impiantoId: '', edificioId: '', localeId: '' };
    filtri = { testo: '', categorie: [], soloNonConformi: false,
      soloConAnomalie: false, soloDaControllare: false, soloControllati: false, soloSospesi: false,
      posizione: '' };
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

/**
 * Le due strade della consegna, ognuna con il suo effetto scritto.
 *
 * ⚠️ Non sono due modi di fare la stessa cosa: cambiano che cosa trova chi
 * riceve il pacchetto. Metterle una accanto all'altra, con la differenza detta
 * in una riga, è ciò che permette di sceglierle invece di indovinarle.
 */
function pulsantiConsegna() {
  const stato = S.statoGiro();
  const concluso = stato === S.GIRO_CONCLUSO;
  const nota = (t) => el('div', { class: 'mini', style: 'margin:2px 0 12px', testo: t });

  return [
    el('button', {
      class: `btn btn-blocco ${concluso ? '' : 'btn-primario'}`, type: 'button',
      testo: '➡️ Passa il giro a un altro operatore',
      onclick: async () => {
        // ⛔ Se il giro è concluso, passarlo così vuol dire consegnare a
        // qualcuno un lavoro che il suo telefono considera finito: potrebbe
        // riaprirlo, ma deve sapere di doverlo fare. Si chiede prima.
        if (concluso) {
          const ok = await conferma({
            titolo: 'Il controllo risulta concluso',
            messaggio: 'Chi riceve il pacchetto lo troverà chiuso e dovrà riaprirlo '
              + 'prima di registrare qualcosa. Vuoi riaprirlo tu adesso, così lui '
              + 'continua senza pensarci?',
            conferma: 'Riapri e esporta',
          });
          if (ok) await muta(() => S.riapriGiro('riaperto per passare il giro'), null);
        }
        await esportaPacchetto();
      },
    }),
    nota("Mandagli il file: lo carica e continua da dove sei arrivato tu, con i tuoi "
      + "controlli già dentro. NON concludere il controllo — se lo concludi, lui lo "
      + "trova chiuso e deve riaprirlo. ⚠ Uno alla volta: due telefoni con lo stesso "
      + "pacchetto non si possono riportare tutti e due, e l'ufficio rifiuta il secondo."),

    el('button', {
      class: `btn btn-blocco ${concluso ? 'btn-primario' : ''}`, type: 'button',
      testo: '🏁 Il giro è finito, riporta in ufficio',
      onclick: async () => {
        if (!concluso) {
          const r = S.riepilogo(false);
          confermaConclusione(r, { poiEsporta: true });
          return;
        }
        await esportaPacchetto();
      },
    }),
    nota('Chiude il controllo e produce il pacchetto da importare in Scudo '
      + '(Scudo → Campo → Reimporta). Scudo lo verifica e sostituisce i dati.'),
  ];
}

async function esportaPacchetto() {
  const st = S.get();
  if (!st.caricato) { toast('Nessun pacchetto caricato.', 'toast-ko'); return; }
  if (!st.sessione.operatore) {
    toast("Indica prima il nome dell'operatore.", 'toast-warn');
    apriSessione();
    return;
  }

  // Il meta di rientro si costruisce in `pacchetto.js`, non qui: prima era un
  // oggetto scritto a mano, cioè il posto esatto dove una chiave dell'ufficio
  // (codice, periodo, note, impianti previsti) si perde senza nessun errore.
  const meta = metaDiRientro(st.manifest, st.sessione, {
    generato_da: 'Scudo Campo 1.1.0',
    giro_stato: S.statoGiro(),
    // Quanti controlli ha fatto QUESTA mano: entra nella catena delle consegne,
    // che in ufficio dice chi ha fatto che cosa.
    n_controlli: S.controlliDiQuestaMano(),
  });

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
  // Il codice nel nome: in ufficio il file di rientro si riconosce da quello
  // che l'ufficio stesso ha dato, non dalla data.
  const codice = codiceCaricato();
  const nome = `SCUDO_RILIEVO_${stamp}_${codice ? `${codice}_` : ''}${opSlug}.zip`;

  scaricaFile(nome, contenuto, 'application/zip');
  S.segnaEsportato(checksum);
  const salvato = await store.salvaDataset(S.serializza());
  if (!salvato.ok) {
    toast('Il file è stato esportato, ma il dispositivo non ha potuto salvare il rilievo (spazio esaurito): '
      + 'guarda lo spazio nella scheda Dati.', 'toast-ko', 20000);
  }
  disegna();

  apriSheet('Pacchetto esportato', el('div', {}, [
    avviso(`File generato: ${nome}`, 'avviso-verde'),
    el('div', { class: 'mini', style: 'margin-top:8px' }, [
      'Passi successivi: 1) invia o copia il file in ufficio; 2) in Scudo apri Campo → '
      + "Reimporta; 3) controlla l'anteprima e conferma.",
    ]),
    el('dl', { class: 'dati', style: 'margin-top:8px' }, [
      el('dt', { testo: 'Codice del pacchetto' }), el('dd', { class: 'mono', testo: codice || '—' }),
      el('dt', { testo: 'Impronta dei dati' }), el('dd', { class: 'mono', testo: `${checksum.slice(0, 32)}…` }),
    ]),
    avviso("Il rilievo resta su questo dispositivo: cancellalo solo dopo che Scudo ha confermato l'import."),
    el('button', { class: 'btn btn-blocco btn-primario', type: 'button', style: 'margin-top:12px', testo: 'Ho capito', onclick: chiudiSheet }),
  ]));
}

// --------------------------------------------------------------------------- //
avvia().catch((e) => {
  document.getElementById('vista-corpo').append(
    avviso(`Avvio non riuscito: ${e.message || e}`, 'avviso-rosso'),
  );
});
