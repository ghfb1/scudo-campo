/**
 * Scudo Campo — l'esecuzione di un controllo.
 *
 * Perché è un modulo a sé e non un pezzo di `app.js`
 * --------------------------------------------------
 * Perché è la schermata su cui si lavora, e un errore qui costa più che
 * altrove. In `app.js` non era eseguibile fuori dal browser: quel file apre
 * IndexedDB, registra il service worker e avvia l'applicazione appena viene
 * importato, quindi nessuna prova automatica poteva costruire questo form e
 * premerne i pulsanti. L'unico controllo che lo guardava era `check_js.mjs`, che
 * vede gli identificatori inesistenti e non vede una riga che va in errore
 * quando viene eseguita — ed è già capitato due volte in questo progetto.
 *
 * Qui dentro non c'è niente che tocchi il browser oltre al DOM: le tre cose che
 * hanno effetti — salvare, avvisare, chiudere — arrivano da fuori come funzioni.
 * `scripts/scudo/test_controllo_campo.mjs` le sostituisce con delle finte,
 * costruisce il form sull'archivio vero e ne preme i pulsanti.
 *
 * La regola che questa schermata rende vera
 * -----------------------------------------
 * **Conforme vuol dire eseguito per intero.** Se una sola verifica del piano non
 * è spuntata, «Conforme» non si può premere, e sotto c'è scritto quante ne
 * mancano — non è un errore che appare dopo aver premuto, è uno stato visibile
 * prima. Il divieto vive anche in `registraIntervento`: una regola scritta solo
 * nel form vale finché nessuno scrive un secondo form, e di form che registrano
 * controlli ce ne sono due.
 *
 * **Non conforme non vuol dire incompleto.** Sono due cose diverse e la
 * differenza conta: un estintore su cui ho fatto tutte le otto verifiche e che
 * ha la pressione a zero è NON CONFORME con tutte le spunte messe; un estintore
 * dietro un bancale che non riesco a raggiungere è NON ACCESSIBILE. Sullo stesso
 * pulsante, le due cose diventerebbero indistinguibili per sempre.
 *
 * Quindi: le spunte dicono CHE COSA HO FATTO, l'esito dice COM'È ANDATA.
 *
 * ⛔ Dal 25/09/2026 lo dicono DAVVERO. Dal 20/09 una voce non spuntata in un
 * non idoneo diventava «non idonea», e finiva in un elenco automatico nella
 * descrizione dell'anomalia. In campo è andata così: con qualcosa che non va, il
 * sorvegliante lasciava tutto senza spunta e scriveva la nota — per fare
 * prima — e l'archivio e il verbale dicevano che TUTTE le verifiche erano
 * fallite. Adesso una spunta vuol dire «eseguita», il giudizio è solo l'esito,
 * l'anomalia la scrive l'operatore, e la può collegare — se vuole — a UNA delle
 * verifiche (`verifica_collegata`).
 */
import * as S from './stato.js';
import { GRAVITA } from './pacchetto.js';
import { avviso, campo, campoNumerico, dataIt, el, num, scelte, tag } from './ui.js';
import { bloccoCoordinate } from './ubicazione.js';
import { nodoTestoAnomalia, riassuntoAnomalia, SPIEGA_VOCI_VUOTE } from './anomalia_testo.js';
import * as CAL from './calcoli.js';

/**
 * Che cosa dice una scadenza, a parole.
 *
 * Il colore da solo non basta: sul telefono, in un capannone, contro luce, la
 * differenza fra ambra e rosso non si vede. E «12/02/2027» non dice se quella
 * data è passata — bisogna sapere che giorno è oggi e fare il conto.
 */
export function frasScadenza(dataIso) {
  const sem = S.semaforo(dataIso);
  const gg = S.giorniResidui(dataIso);
  const quando = dataIt(dataIso);
  if (gg === null) return { testo: `Scadenza ${quando}`, classe: '' };
  if (gg < 0) {
    const n = -gg;
    return {
      testo: `SCADUTA da ${n} giorn${n === 1 ? 'o' : 'i'} — scadeva il ${quando}`,
      classe: 'tag-rosso',
    };
  }
  if (gg === 0) return { testo: `Scade OGGI, ${quando}`, classe: 'tag-ambra' };
  if (sem === 'IN_SCADENZA') {
    return { testo: `Scade fra ${gg} giorn${gg === 1 ? 'o' : 'i'} — il ${quando}`, classe: 'tag-ambra' };
  }
  return { testo: `In regola — prossima scadenza il ${quando}`, classe: 'tag-verde' };
}

/**
 * Quanto è grave, di partenza, un'anomalia su questo presidio.
 *
 * Dipende dallo STATO in cui il presidio si trova già: un pezzo dichiarato
 * assente non genera un'anomalia «media» come un pezzo con il cartello storto.
 * È solo un valore iniziale, che l'operatore può cambiare.
 */
export function gravitaSuggerita(a) {
  const s = S.statoDi(a);
  return (s && s.gravita_implicita) || 'MEDIA';
}

/**
 * Una riga dell'elenco «Esegui i controlli»: un piano di verifica, con il suo
 * stato e i due modi di chiuderlo.
 *
 * Che cosa deve rispondere, in quest'ordine, a chi ha il pezzo davanti:
 *   1. che controllo è (nome del piano, non il codice del tipo);
 *   2. ogni quanto va fatto — in anni se sono anni, non «ogni 216 mesi»;
 *   3. se è in ritardo, e da quanto, A PAROLE: il colore da solo non basta
 *      dentro una cabina controluce;
 *   4. quante cose comporta, perché decide se ci vogliono due minuti o dieci;
 *   5. i due pulsanti, larghi, distanti fra loro e con il segno oltre al colore
 *      — con i guanti si sbaglia bersaglio, e ✓ e ✕ non si somigliano nemmeno
 *      in bianco e nero.
 */
/**
 * La conferma dopo aver registrato, con dentro la data che interessa davvero.
 *
 * «Controllo registrato» non risponde alla domanda che si pone chi ha appena
 * finito: quando si torna. La data si calcola con la stessa regola dell'ufficio
 * — ultima esecuzione più periodicità — e l'ultima esecuzione è la PIÙ RECENTE,
 * non quella appena inserita: registrando oggi un verbale cartaceo del 2020 la
 * prossima scadenza non deve arretrare.
 *
 * Con un esito che non è «conforme» la data non si stampa: la scadenza si chiude
 * lo stesso, ma dirla accanto a un guasto suonerebbe come «tutto a posto fino al».
 */
export function messaggioDi(esito, t, dataIso) {
  if (esito === 'NON_IDONEO') return 'Controllo registrato e anomalia aperta.';
  if (esito !== 'IDONEO') return 'Controllo registrato come non eseguito.';
  // L'esito si scrive: da qui si passa solo con IDONEO (i due rami sopra
  // escono prima), e `ultimaEsecuzione` adesso salta gli esiti non eseguiti —
  // un oggetto senza esito sarebbe contato per distrazione, non per scelta.
  const ultima = CAL.ultimaEsecuzione(
    [{ data: dataIso, esito: 'IDONEO' }, t.ultimo].filter(Boolean));
  const prossima = t.frequenza_valore
    ? CAL.prossimaScadenza(ultima, t.frequenza_valore, t.frequenza_unita) : null;
  return prossima
    ? `Registrato. Prossima scadenza: ${dataIt(prossima)}.`
    : 'Controllo registrato: idoneo.';
}

/**
 * Come sta un controllo, in una frase sola e senza contraddizioni.
 *
 * Il difetto che questa funzione chiude: l'etichetta «mai eseguito» veniva
 * dall'assenza di una SCADENZA aperta, non dall'assenza di CONTROLLI. Registrare
 * un controllo assolve la sua scadenza, quindi subito dopo averlo fatto la
 * scheda diceva «MAI ESEGUITO» e due righe sotto «ultimo controllo: 27/08/2026».
 * Due affermazioni opposte nello stesso riquadro: chi le legge smette di fidarsi
 * di tutte e due.
 *
 * I casi sono cinque e vanno tenuti distinti, perché si chiudono in modi diversi:
 */
export function statoPiano(t) {
  // Registrato in questo giro ma NON eseguito («non accessibile», «non eseguito»):
  // non è fatto, e il presidio non si può segnare fatto finché non lo è
  // (`vociDelGiro`, regola del 15/09/2026). `=== false` e non `!`: una riga costruita
  // senza il campo resta com'era.
  if (t.fatto_nel_giro && t.eseguito_nel_giro === false) {
    return { chiave: 'NON_ESEGUITO', testo: 'registrato ma non eseguito — va ancora eseguito', classe: 'tag-ambra' };
  }
  if (t.fatto_nel_giro) return { chiave: 'FATTO', testo: 'fatto in questo giro', classe: 'tag-verde' };
  if (t.indeterminato) {
    // Manca un dato dell'anagrafica: lo chiude chiunque, compilandolo.
    return { chiave: 'INDETERMINATO', testo: `scadenza non calcolabile — ${t.motivo}`, classe: 'tag-ambra' };
  }
  if (t.scadenza) {
    const f = frasScadenza(t.scadenza);
    return {
      chiave: t.semaforo === 'SCADUTO' ? 'SCADUTO'
        : t.semaforo === 'IN_SCADENZA' ? 'IN_SCADENZA' : 'REGOLARE',
      testo: f.testo,
      classe: f.classe || 'tag-verde',
    };
  }
  // Nessuna scadenza aperta. Che voglia dire dipende da se è MAI stato fatto.
  if (t.ultimo) {
    return {
      chiave: 'FATTO_SENZA_PROSSIMA',
      testo: t.prossima_calcolata
        ? `eseguito il ${dataIt(t.ultimo.data)} — prossimo il ${dataIt(t.prossima_calcolata)}`
        : `eseguito il ${dataIt(t.ultimo.data)} — prossima scadenza da ricalcolare`,
      classe: 'tag-verde',
    };
  }
  return { chiave: 'MAI', testo: 'mai eseguito', classe: 'tag-ambra' };
}

/**
 * Che cosa va fatto adesso e che cosa no.
 *
 * Su un estintore i piani sono cinque, e quattro possono scadere fra due e
 * diciotto anni. Mostrarli tutti con la stessa evidenza significa far scorrere
 * dieci pulsanti giganti per arrivare all'unico che riguarda oggi — e su un
 * telefono, in piedi, quello che si scorre non si legge.
 *
 * «Da fare» non è solo «scaduto»: ci sta dentro anche quello che scade a breve
 * (si è già sul posto, tornarci costa un viaggio), quello che non è mai stato
 * eseguito, e quello la cui scadenza non si può calcolare perché manca un dato —
 * che è lavoro anche quello, solo di un altro tipo.
 */
/**
 * Ogni quanto si torna sul posto: la ditta antincendio fa il giro ogni SEI MESI.
 *
 * È il numero che decide che cosa conviene anticipare (operatore, 17/09/2026): un
 * piano che scade fra un mese, se non lo si fa adesso, lascia il presidio non
 * idoneo per i cinque mesi che mancano al giro successivo. Non è una periodicità
 * di norma — quelle stanno nei piani — è la cadenza di chi ci va.
 *
 * ⛔ Il numero sta in `stato.js` (`ORIZZONTE_GIRO_MESI`) e qui si riusa, non si
 * riscrive: dal 22/09/2026 decide anche che cosa il GIRO considera da fare, e
 * due costanti con lo stesso significato avrebbero cominciato a divergere il
 * giorno in cui qualcuno ne cambia una. È lo stesso difetto per cui la
 * schermata diceva «prossimi controlli entro 6 mesi» e il pulsante diceva
 * «✓ fatto».
 */
export const MESI_FRA_UN_GIRO_E_L_ALTRO = S.ORIZZONTE_GIRO_MESI;

function entroMesi(data, mesi) {
  if (!data) return false;
  const limite = new Date();
  limite.setMonth(limite.getMonth() + mesi);
  return String(data) <= limite.toISOString().slice(0, 10);
}

export function dividiPiani(controlli, { orizzonteMesi = MESI_FRA_UN_GIRO_E_L_ALTRO } = {}) {
  const daFare = [];
  const inRegola = [];
  for (const t of controlli) {
    const st = statoPiano(t);
    if (['FATTO', 'REGOLARE', 'FATTO_SENZA_PROSSIMA'].includes(st.chiave)) inRegola.push(t);
    else daFare.push(t);
  }
  // I fatti in questo giro restano in vista: sono la conferma di quello che si è
  // appena fatto, e cercarla dentro una sezione chiusa è il modo più rapido per
  // registrare due volte lo stesso controllo.
  const appenaFatti = inRegola.filter((t) => t.fatto_nel_giro);

  // I PROSSIMI: in regola oggi, ma scadono prima del giro successivo. Si è già
  // sul posto, con la scala e le chiavi in mano; tornarci fra un mese costa un
  // viaggio, e non farli significa lasciare il presidio non idoneo fino al giro
  // dopo. Non sono «da fare»: stanno sotto, con l'esito e con scritto che si
  // possono lasciare.
  const prossimi = inRegola.filter((t) => !t.fatto_nel_giro
    && t.scadenza && entroMesi(t.scadenza, orizzonteMesi));
  const prossimiId = new Set(prossimi.map((t) => t.codice));

  return {
    daFare: [...daFare, ...appenaFatti],
    prossimi,
    inRegola: inRegola.filter((t) => !t.fatto_nel_giro && !prossimiId.has(t.codice)),
  };
}

/**
 * Una riga dell'elenco «Esegui i controlli».
 *
 * Che cosa risponde, in quest'ordine, a chi ha il pezzo davanti:
 *   1. che controllo è (nome del piano, non il codice del tipo);
 *   2. come sta, **a parole**: il colore da solo non si vede in una cabina
 *      controluce, e una data da sola non dice se è passata;
 *   3. i dettagli — periodicità, quante verifiche, la norma — su una riga sola e
 *      in grigio, non come cinque etichette colorate. Le etichette colorate
 *      erano cinque per riga e cinque righe per presidio: venticinque macchie di
 *      colore, dopo le quali non se ne guarda più nessuna;
 *   4. i due pulsanti, larghi, con il SEGNO oltre al colore.
 *
 * In forma `compatta` (i controlli in regola) i pulsanti spariscono e la riga
 * intera diventa toccabile: chi apre quella sezione sta cercando informazione,
 * non sta per registrare.
 */
export function rigaPianoDaEseguire(a, t, { onEsito, onRipeti, onVedi, onSostituisci, onDaSostituire,
  datiMancanti, compatta = false, prossimo = false } = {}) {
  // ⛔ I DATI CHE MANCANO, nella riga del controllo (24/09/2026, dall'operatore:
  // «i campi da compilare relativi alla data mancante andrebbero messi proprio
  // dove c'è il controllo da eseguire, sopra "verifica non eseguibile", così
  // l'utente non cambia scheda: la inserisce, conferma, e poi appaiono idoneo e
  // non idoneo»). `datiMancanti(t)` lo costruisce chi apre la scheda (sa quali
  // campi ha la tipologia e come si salva); qui si decide DOVE sta. Quali campi
  // lo dice `t.dati_per_scadenza`, dalla stessa regola che calcola la scadenza.
  const bloccoDati = (!compatta && datiMancanti && !t.fatto_nel_giro && (t.dati_per_scadenza || []).length)
    ? datiMancanti(t) : null;
  // Idoneo / non idoneo, e il pulsante che li mostra senza la data.
  let esiti = null;
  let rivela = null;
  const azioni = t.azioni || [];
  const st = statoPiano(t);
  const ultimoNelGiro = t.fatto_nel_giro
    ? (S.interventiDi(a.id) || []).find((iv) => iv.tipo_controllo_codice === t.codice)
    : null;

  const tono = { FATTO: 'ok', SCADUTO: 'ko', IN_SCADENZA: 'attenzione',
    INDETERMINATO: 'attenzione', MAI: 'attenzione', NON_ESEGUITO: 'attenzione' }[st.chiave] || '';

  // ⚠️ Via anche l'ASTERISCO, insieme alla sua legenda (19/09/2026). Toglierne
  // uno solo sarebbe stato peggio di lasciarli entrambi: un asterisco senza nota
  // in fondo è un segno che chiede di cercare qualcosa che non c'è.
  const dettagli = [
    t.frequenza_testo || null,
    azioni.length ? `${azioni.length} verifiche` : null,
    t.norma || null,
  ].filter(Boolean).join(' · ');

  const intestazione = [
    el('div', { class: 'piano-nome', testo: t.descrizione }),
    el('div', { class: 'voce-tag', style: 'margin:4px 0 2px' }, [
      tag(st.testo, st.classe),
      t.deroga ? tag('in deroga', 'tag-grigio') : null,
    ].filter(Boolean)),
    el('div', { class: 'mini', testo: dettagli }),
  ];

  if (compatta) {
    return el('div', { class: `piano-riga piano-riga-compatta ${tono}`, 'data-codice': t.codice }, [
      el('button', {
        class: 'piano-tocca', type: 'button',
        onclick: () => onEsito && onEsito(t, null),
      }, [
        el('span', { class: 'piano-corpo' }, intestazione),
        el('span', { class: 'voce-freccia', testo: '\u203a' }),
      ]),
    ]);
  }

  // ⛔ Il FINE VITA non ha «idoneo / non idoneo» (23/09/2026, dall'operatore:
  // «il fine vita, se raggiunto, lo fa verificare come idoneo; invece dovrebbe
  // essere non idoneo, e dovrebbe essere facile sostituirlo, in quel momento o
  // nel successivo giro»). È una data, non una prova: vedi `registraIntervento`,
  // che lo rifiuta anche se una schermata futura dimenticasse questa riga.
  // Il fine vita si decide in `S.eFineVita`: pv-29 sta sotto ROTTAMAZIONE ma è
  // una verifica (24/09/2026).
  const fineVita = S.eFineVita(t.codice, t.piano_id);
  const oggi = new Date().toISOString().slice(0, 10);
  const raggiunto = fineVita && Boolean(t.scadenza) && String(t.scadenza) <= oggi;
  // Segnato «da sostituire» in questo giro: resta la sola strada che manca.
  // Solo con una DATA: senza anno di costruzione la voce registrata «non
  // eseguibile» vuol dire «non si legge», non «da sostituire».
  const segnatoDaSostituire = fineVita && t.fatto_nel_giro && st.chiave === 'NON_ESEGUITO' && Boolean(t.scadenza);
  const bloccoFineVita = segnatoDaSostituire ? el('div', {}, [
    el('div', { class: 'avviso avviso-rosso', style: 'margin-bottom:8px', testo:
      '✕ Segnato da sostituire: il presidio resta non idoneo finché il pezzo non si cambia.' }),
    el('button', {
      class: 'btn btn-primario btn-blocco btn-esito', type: 'button',
      onclick: () => onSostituisci && onSostituisci(t),
    }, [el('span', { class: 'esito-segno', testo: '🔁' }), el('span', { testo: 'Sostituiscilo adesso' })]),
  ]) : (fineVita && !t.fatto_nel_giro) ? el('div', {}, [
    t.scadenza
      ? el('div', { class: `avviso ${raggiunto ? 'avviso-rosso' : 'avviso-blu'}`, style: 'margin-bottom:8px' }, [
        el('div', { testo: raggiunto
          ? `⛔ Fine vita raggiunto il ${dataIt(t.scadenza)}: il pezzo non è più idoneo e va sostituito.`
          : `Fine vita il ${dataIt(t.scadenza)}. Il fine vita non si controlla: quando arriva, il pezzo si sostituisce.` }),
      ])
      // Il messaggio fisso diceva «senza l'anno di costruzione» anche dove il
      // piano si conta dalla messa in servizio (pv-29): adesso chiedono i campi,
      // e i campi sono quelli giusti.
      : (bloccoDati || el('div', { class: 'mini', style: 'margin-bottom:8px', testo:
        'Senza una data del presidio il fine vita non si calcola. Se non si legge, '
        + 'registra la verifica come non eseguibile.' })),
    t.scadenza ? el('div', { class: 'piano-azioni' }, [
      el('button', {
        class: 'btn btn-primario btn-esito', type: 'button',
        onclick: () => onSostituisci && onSostituisci(t),
      }, [el('span', { class: 'esito-segno', testo: '🔁' }), el('span', { testo: 'Sostituiscilo adesso' })]),
      el('button', {
        class: 'btn btn-ko btn-esito', type: 'button',
        onclick: () => onDaSostituire && onDaSostituire(t),
      }, [el('span', { class: 'esito-segno', testo: '✕' }), el('span', { testo: 'Da sostituire al prossimo giro' })]),
    ]) : el('button', {
      class: 'btn btn-piccolo btn-blocco btn-esito', type: 'button',
      onclick: () => onEsito && onEsito(t, 'NON_ESEGUIBILE'),
    }, [el('span', { class: 'esito-segno', testo: '⚠' }), el('span', { testo: 'Verifica non eseguibile' })]),
  ]) : null;

  return el('div', { class: `piano-riga ${tono}`, 'data-codice': t.codice }, [
    ...intestazione,
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: t.ultimo
        ? `ultimo: ${dataIt(t.ultimo.data)}${t.ultimo.operatore_nome ? ` · ${t.ultimo.operatore_nome}` : ''}`
        : 'nessun controllo di questo tipo in archivio' }),
    // La scadenza l'ha calcolata l'app dalla data del presidio (24/09/2026):
    // si dice, perché l'elenco e lo scadenzario la mostreranno solo dopo il
    // rientro in ufficio, che la ricalcola con la stessa regola.
    t.scadenza_calcolata
      ? el('div', { class: 'mini', style: 'margin:-4px 0 8px', testo:
        'Scadenza calcolata qui dalla data del presidio: l\'ufficio la conferma al rientro.' })
      : null,

    st.chiave === 'NON_ESEGUITO' && !segnatoDaSostituire
      ? el('div', { class: 'piano-fatto piano-non-eseguito' }, [
        el('span', { class: 'piano-fatto-testo', testo: `! ${ultimoNelGiro ? etichettaEsito(ultimoNelGiro.esito).replace(/^\S+\s/, '').toLowerCase() : 'non eseguito'}`
          + `${ultimoNelGiro && ultimoNelGiro.data ? ` il ${dataIt(ultimoNelGiro.data)}` : ''} — va ancora eseguito` }),
        el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Vedi',
          onclick: () => ultimoNelGiro && onVedi && onVedi(ultimoNelGiro, t),
        }),
      ])
      : null,
    bloccoFineVita
      ? bloccoFineVita
      : t.fatto_nel_giro && st.chiave !== 'NON_ESEGUITO'
      ? el('div', { class: 'piano-fatto' }, [
        el('span', { class: 'piano-fatto-testo' }, [
          el('div', { testo: `✓ fatto${ultimoNelGiro && ultimoNelGiro.data ? ` il ${dataIt(ultimoNelGiro.data)}` : ''}` }),
          // La domanda che si pone chiunque abbia appena finito un lavoro: e
          // adesso quando torna? Prima la risposta arrivava al rientro in
          // ufficio.
          t.prossima_calcolata
            ? el('div', { class: 'piano-prossima',
              testo: `prossimo il ${dataIt(t.prossima_calcolata)}` })
            : null,
        ].filter(Boolean)),
        // «Vedi» prima di «Rifai»: chi ha appena registrato e ha un dubbio vuole
        // guardare che cosa risulta, non rifarlo. Da lì si annulla.
        el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Vedi',
          onclick: () => ultimoNelGiro && onVedi && onVedi(ultimoNelGiro, t),
        }),
        el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Rifai',
          onclick: () => onRipeti && onRipeti(t),
        }),
      ])
      : el('div', {}, [
        // Prima la data, poi il giudizio: idoneo e non idoneo compaiono salvata
        // la data. Restano a UN tocco per chi la data non la conosce — il
        // controllo si registra lo stesso, e la prossima si conterà da oggi.
        bloccoDati,
        bloccoDati ? (rivela = el('button', {
          class: 'btn btn-piccolo btn-blocco', type: 'button', style: 'margin-top:6px',
          testo: 'Non la conosco: registra il controllo lo stesso',
          onclick: () => { rivela.hidden = true; esiti.hidden = false; },
        })) : null,
        esiti = el('div', { class: 'piano-azioni', hidden: Boolean(bloccoDati) }, [
          el('button', {
            class: 'btn btn-ok btn-esito', type: 'button',
            onclick: () => onEsito && onEsito(t, 'IDONEO'),
          }, [
            el('span', { class: 'esito-segno', testo: '✓' }),
            el('span', { testo: 'Idoneo' }),
          ]),
          el('button', {
            class: 'btn btn-ko btn-esito', type: 'button',
            onclick: () => onEsito && onEsito(t, 'NON_IDONEO'),
          }, [
            el('span', { class: 'esito-segno', testo: '✕' }),
            el('span', { testo: 'Non idoneo' }),
          ]),
        ]),
        // «Verifica non eseguibile» sta QUI, accanto agli altri due, e non dentro
        // la scheda del controllo (18/09/2026, richiesta dell'operatore). Là ci si
        // arriva solo dopo aver premuto idoneo o non idoneo — cioè dopo aver già
        // dato un giudizio sul pezzo, che è esattamente quello che «non
        // eseguibile» dice di non poter dare. Tre risposte alla stessa domanda
        // stanno nello stesso posto.
        // ⚠️ Il segno in un ELEMENTO SUO, come negli altri due pulsanti.
        // Prima era «⃠ Verifica non eseguibile» in una stringa sola, e U+20E0 è
        // un carattere COMBINANTE: non si affianca al testo, gli si sovrappone.
        // Nessuno spazio lo separa perché lo spazio è proprio il carattere su cui
        // si combina. Segnalato dall'operatore («il simbolo è appiccicato al
        // testo») il 19/09/2026.
        el('button', {
          class: 'btn btn-piccolo btn-blocco btn-esito', type: 'button', style: 'margin-top:6px',
          onclick: () => onEsito && onEsito(t, 'NON_ESEGUIBILE'),
        }, [
          el('span', { class: 'esito-segno', testo: '⚠' }),
          el('span', { testo: 'Verifica non eseguibile' }),
        ]),
      ]),

    // Un anticipo si può LASCIARE, e dirlo qui evita l'errore che costa di più:
    // premere «non idoneo» per dire «non l'ho fatto». Non idoneo è un giudizio sul
    // pezzo — fa nascere un'anomalia e lo rende inutilizzabile sui registri —
    // mentre qui la risposta giusta è non registrare niente.
    //
    // ⛔ Niente pulsante «non lo faccio adesso» (19/09/2026, operatore): «per non
    // fare qualcosa c'è semplicemente il fatto di non controllarlo, è una cosa
    // diversa dal non poter fare quel controllo». Era un comando che non
    // registrava niente e nascondeva la riga: dava la forma di un'azione a una
    // non-azione, e la metteva accanto a «verifica non eseguibile», che invece
    // un'azione lo è. Resta la FRASE, che è la parte utile.
    (prossimo && !t.fatto_nel_giro)
      ? el('div', { class: 'piano-lascia' }, [
        el('div', { class: 'mini', testo: t.scadenza
          ? `Se non lo fai adesso va lasciato: scade il ${dataIt(t.scadenza)} e non serve registrare niente. Non premere «non idoneo», che è un giudizio sul pezzo.`
          : 'Se non lo fai adesso va lasciato: non serve registrare niente.' }),
      ])
      : null,
  ].filter(Boolean));
}

/**
 * La sezione «Esegui i controlli» per intero: quello che riguarda oggi, e il
 * resto dietro un interruttore.
 */
export function sezionePiani(a, controlli, azioni = {}) {
  const { daFare, prossimi, inRegola } = dividiPiani(controlli);
  const box = el('div', {});

  if (!controlli.length) {
    box.append(el('h3', { testo: 'Esegui i controlli' }));
    box.append(el('div', { class: 'mini',
      testo: 'Nessun piano di verifica previsto per questa tipologia. Se hai '
        + "eseguito comunque un controllo, segnalalo come punto aperto: qui non c'è "
        + 'un piano a cui agganciarlo.' }));
    return box;
  }

  box.append(el('h3', { testo: 'Esegui i controlli' }));
  box.append(el('div', { class: 'mini', style: 'margin:-2px 0 10px',
    testo: daFare.length
      ? `${daFare.length} da fare ora${inRegola.length ? `, ${inRegola.length} in regola` : ''}.`
      : 'Nessun controllo da fare adesso su questo presidio.' }));

  if (daFare.length) {
    box.append(el('div', { class: 'piani-elenco piani-da-fare' },
      daFare.map((t) => rigaPianoDaEseguire(a, t, azioni))));
  }

  // I PROSSIMI, sotto quelli da fare: scadono prima del giro successivo, e si è
  // già sul posto (operatore, 17/09/2026).
  if (prossimi.length) {
    box.append(el('h3', { style: 'margin:16px 0 2px',
      testo: `Prossimi controlli (entro ${MESI_FRA_UN_GIRO_E_L_ALTRO} mesi)` }));
    box.append(el('div', { class: 'mini', style: 'margin-bottom:8px',
      // ⛔ «Lasciarli non richiede di registrare niente» era la frase di prima, e
      // dal 22/09/2026 non è più vera: questi controlli sono lavoro del giro,
      // quindi finché restano il presidio non si può segnare «fatto». La frase
      // non si tiene per inerzia — era esattamente la contraddizione segnalata
      // dall'operatore, con il pulsante «✓ fatto» sopra una sezione che diceva
      // che c'era altro da fare.
      testo: `${prossimi.length} non scadut${prossimi.length === 1 ? 'o' : 'i'}, ma in scadenza prima `
        + 'del prossimo giro: si è già sul posto, e farli adesso evita che il presidio '
        + 'resti non idoneo per mesi. Finché restano, il presidio resta fra i da controllare.' }));
    box.append(el('div', { class: 'piani-elenco piani-prossimi' },
      prossimi.map((t) => rigaPianoDaEseguire(a, t, { ...azioni, prossimo: true }))));
  }

  if (inRegola.length) {
    const elenco = el('div', { class: 'piani-elenco piani-in-regola', style: 'margin-top:10px', hidden: true },
      inRegola.map((t) => rigaPianoDaEseguire(a, t, { ...azioni, compatta: true })));
    const bottone = el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button',
      style: 'margin-top:10px',
      testo: `Mostra anche i ${inRegola.length} in regola`,
      onclick: () => {
        elenco.hidden = !elenco.hidden;
        bottone.textContent = elenco.hidden
          ? `Mostra anche i ${inRegola.length} in regola`
          : 'Nascondi quelli in regola';
      },
    });
    box.append(bottone, elenco);
  }

  // La nota «* la periodicità non è ancora stata confrontata con il testo della
  // norma» è stata tolta il 19/09/2026 su richiesta dell'operatore: è una
  // riserva sul catalogo, cioè una cosa che si decide in ufficio, e in campo
  // compariva sotto OGNI elenco di controlli senza che nessuno potesse farci
  // niente. Il campo `piani_verifica.verificata` resta e resta leggibile
  // dall'ufficio: è lì che quella riserva va guardata.
  return box;
}

/**
 * Esecuzione di UN piano di verifica su UN presidio.
 *
 * La regola che questa schermata rende vera
 * -----------------------------------------
 * **Conforme vuol dire eseguito per intero.** Se una sola verifica del piano non
 * è spuntata, il pulsante «Conforme» non si può premere, e sotto c'è scritto
 * quante ne mancano — non è un errore che appare dopo aver premuto, è uno stato
 * visibile prima. Il divieto vive anche in `registraIntervento`, perché una
 * regola scritta solo nel form vale finché nessuno scrive un secondo form.
 *
 * **Non conforme non vuol dire incompleto.** Sono due cose diverse e la
 * differenza conta: un estintore su cui ho fatto tutte le otto verifiche e che
 * ha la pressione a zero è NON CONFORME con tutte le spunte messe; un estintore
 * dietro un bancale che non riesco ad aprire è NON ESEGUITO. Mettere le due
 * cose sullo stesso pulsante avrebbe prodotto un archivio in cui «non conforme»
 * significa entrambe, e nessuno può più distinguerle.
 *
 * Quindi: le spunte dicono CHE COSA HO FATTO; l'esito dice COM'È ANDATO.
 * L'anomalia la scrive l'operatore (dal 25/09/2026: vedi in testa al modulo).
 *
 * Il percorso più corto, che è quello che si percorre novanta volte su cento:
 * «Ho fatto tutte le N verifiche» → «Conforme». Due tocchi.
 */
/**
 * «Quanti pezzi non funzionano», con le due risposte vere a un tocco solo.
 *
 * Perché non basta un campo numerico (20/09/2026, richiesta dell'operatore:
 * «assicurati che la compilazione sia davvero intuitiva e veloce, anche quando
 * un parziale della quantità ha problemi»).
 *
 * Misurato sull'archivio: **169 righe su 868 valgono più di un pezzo** — 68 ne
 * valgono due, 25 tre, 22 quattro: 139 su 169 (l'82%) stanno entro otto. E le
 * risposte non sono distribuite: 770 righe su 868 hanno ZERO pezzi guasti, e
 * delle 99 che ne hanno, **83 li hanno tutti**. Cioè due risposte sole coprono
 * quasi tutto, e un campo da riempire con i guanti le trattava come il caso
 * raro in mezzo.
 *
 *   * fino a otto pezzi: un pulsante per numero — «nessuno · 1 · 2 · tutti (4)»;
 *   * oltre: «nessuno · alcuni… · tutti (N)», e «alcuni…» apre il campo.
 *
 * ⚠️ «nessuno» NON è preselezionato, e non è una dimenticanza: è la stessa
 * regola del 19/09 per cui il campo non porta più il valore d'archivio. Una
 * risposta già data si conferma per inerzia, e questa decide l'esito.
 *
 * @returns { nodo, valore(), errore() } — `valore()` è null finché non si
 *          risponde, `errore()` dice che cosa manca, nominando il numero.
 */
/*
 * `iniziale`: in MODIFICA di un'anomalia il numero c'è già, e si parte da lì
 * (23/09/2026). Alla registrazione di un controllo resta vuoto, per la regola
 * detta sopra: lì la risposta decide l'esito, e non si conferma per inerzia.
 */
export function sceltaPezziGuasti(q, koArchivio = 0, onCambia = null, { iniziale = null, aiuto = null } = {}) {
  const ALCUNI = '__alcuni__';
  const aElenco = q <= 8;

  // I colori dicono che cosa vuol dire la risposta (24/09/2026, richiesta
  // dell'operatore): nessuno guasto verde, alcuni giallo, tutti rosso.
  const voci = [{ valore: '0', testo: 'nessuno', tono: 'ok' }];
  if (aElenco) {
    for (let n = 1; n < q; n += 1) voci.push({ valore: String(n), testo: String(n), tono: 'attenzione' });
  } else {
    voci.push({ valore: ALCUNI, testo: 'alcuni…', tono: 'attenzione' });
  }
  voci.push({ valore: String(q), testo: `tutti (${q})`, tono: 'ko' });

  const fQuanti = campoNumerico({ min: 1, max: q - 1, placeholder: `da 1 a ${q - 1}` });
  const rigaQuanti = campo('Quanti, di preciso', fQuanti);
  rigaQuanti.hidden = true;
  // Il pulsante «Idoneo» si accende e si spegne su questo numero: deve
  // reagire al TOCCO, non al salvataggio, o l'operatore lo vedrebbe spegnersi
  // solo dopo averlo premuto.
  if (onCambia) fQuanti.addEventListener('input', onCambia);

  let partenza = '';
  if (iniziale !== null && iniziale !== undefined && Number.isFinite(Number(iniziale))) {
    const n = Math.max(0, Math.min(q, Number(iniziale)));
    partenza = voci.some((x) => x.valore === String(n)) ? String(n) : ALCUNI;
    if (partenza === ALCUNI) { fQuanti.value = String(n); rigaQuanti.hidden = false; }
  }
  const gruppo = scelte(voci, partenza, {
    obbligatorio: true,
    onCambia: (v) => {
      rigaQuanti.hidden = v !== ALCUNI;
      if (v !== ALCUNI) fQuanti.value = '';
      if (onCambia) onCambia(v);
    },
  });

  const nodo = el('div', { class: 'card card-piatta' }, [
    campo(`Su ${q} pezzi, quanti non funzionano?`, gruppo,
      (aiuto || 'Con almeno un pezzo guasto il controllo si registra lo stesso, ma non come idoneo.')
      + (koArchivio
        ? ` In archivio ne risultano ${koArchivio} guast${koArchivio === 1 ? 'o' : 'i'}: confermalo o correggilo.`
        : '')),
    rigaQuanti,
  ]);

  return {
    nodo,
    valore() {
      const v = gruppo.valore;
      if (!v) return null;
      if (v !== ALCUNI) return Number(v);
      return fQuanti.value === '' ? null : Number(fQuanti.value);
    },
    errore() {
      const v = gruppo.valore;
      if (!v) {
        return `Dicci quanti dei ${q} pezzi non funzionano: «nessuno» se vanno tutti bene.`;
      }
      if (v === ALCUNI) {
        const n = Number(fQuanti.value);
        if (fQuanti.value === '' || !Number.isFinite(n)) {
          return 'Scrivi quanti pezzi non funzionano.';
        }
        // I due estremi hanno il loro pulsante: mandarci anche il campo
        // vorrebbe dire due strade per la stessa risposta, e chi legge
        // l'archivio non saprebbe più quale ha usato l'operatore.
        if (n < 1 || n > q - 1) {
          return `Qui va un numero fra 1 e ${q - 1}: per gli estremi usa «nessuno» o «tutti (${q})».`;
        }
      }
      return null;
    },
  };
}


export function corpoControlloPiano(a, t, esitoIniziale = null, azioniEsterne = {}) {
  const { registra: salva, avvisa, chiudi, geolocalizzazione = null } = azioniEsterne;
  const azioni = t.azioni || [];
  const q = num(a.quantita, 1);
  const multiplo = q > 1;

  // `NON_ESEGUIBILE` non è un esito del database: è la RICHIESTA di aprire la
  // scheda direttamente sul «perché non è stato possibile». L'esito vero —
  // NON_ACCESSIBILE o NON_ESEGUITO — lo sceglie l'operatore lì dentro.
  const partiNonEseguibile = esitoIniziale === 'NON_ESEGUIBILE';
  let esito = esitoIniziale === 'NON_IDONEO' ? 'NON_IDONEO'
    : (partiNonEseguibile ? 'NON_ACCESSIBILE' : null);

  const caselle = [];
  // ⚠️ Il conto guarda solo le voci OBBLIGATORIE (18/09/2026). Una voce
  // condizionale — «Estintori non PED…», «se carrellato» — vale solo dove quel
  // caso c'è: contarla nel denominatore faceva leggere «6 di 7 idonee» a un
  // operatore che aveva spuntato tutto quello che si poteva spuntare.
  const obbligatoria = (az) => az.obbligatoria === undefined
    || String(az.obbligatoria) === '1' || az.obbligatoria === true;
  const richieste = () => caselle.filter((c) => obbligatoria(c.azione));
  const fatte = () => richieste().filter((c) => c.casella.checked).length;
  const mancanti = () => richieste().length - fatte();

  const fData = el('input', { type: 'date', value: S.oggiIso() });
  const fNote = el('textarea', { placeholder: 'Annotazioni del controllo' });
  const fAzione = el('input', { type: 'text', placeholder: 'Es. sostituito manometro' });
  const fDoc = el('input', { type: 'text', placeholder: 'Es. IS.3474684' });
  // ⛔ NON precompilato (19/09/2026, operatore: «invece che "su 3 pz 3 hanno
  // problemi" sarebbe meglio dire su 3 pz, quanti hanno problemi»).
  //
  // Prima portava `a.quantita_ko`, cioè il valore in archivio. Misurato: 169
  // righe valgono più di un pezzo, 60 hanno guasti registrati e **44 li hanno
  // tutti guasti** — su quelle la scheda si apriva con «Su 3 pezzi, quanti non
  // funzionano» e dentro un 3 già scritto. Non è una domanda, è una risposta
  // messa in bocca a chi deve darla, ed è lo stesso difetto delle preselezioni
  // tolte il 18/09. Quello che l'archivio dice oggi resta scritto sotto, come
  // contesto, dove nessuno lo può confermare per inerzia.
  const koArchivio = num(a.quantita_ko);
  // Non più un campo da riempire: i due casi veri — nessuno e tutti — sono un
  // tocco solo, e il numero in mezzo si chiede solo quando serve davvero.
  const pezziKo = multiplo ? sceltaPezziGuasti(q, koArchivio, () => aggiorna()) : null;

  // L'anno di costruzione, quando manca e un piano di FINE VITA si applica a questo
  // presidio (15/09/2026): la fine vita si conta da lì, e nessuno dei rivelatori in
  // archivio ce l'ha. Il controllo è il momento in cui l'etichetta è davanti agli
  // occhi; registrato una volta, il piano comincia a contare.
  const annoMassimo = new Date().getFullYear();
  const serveAnno = !String(a.anno_costruzione ?? '').trim()
    && S.controlliApplicabili(a).some((x) => S.eFineVita(x.codice, x.piano_id) && x.piano_id);
  const fAnno = serveAnno
    ? campoNumerico({ min: 1950, max: annoMassimo, placeholder: 'Es. 2019' })
    : null;

  /**
   * La posizione, quando il presidio non ce l'ha (20/09/2026, operatore:
   * «quando registriamo un controllo, se la posizione manca, suggeriamo di
   * salvarla anche in quel momento, senza cambiare tab o scheda»).
   *
   * È lo stesso ragionamento del campo dell'anno qui sopra: il controllo è
   * l'unico momento in cui si è DAVANTI al pezzo, e una cosa che si può
   * registrare solo stando lì va chiesta lì. Mandare l'operatore in anagrafica
   * e poi farlo tornare è il percorso che non fa nessuno.
   *
   * Compare SOLO se manca: su un presidio che ce l'ha già sarebbe una domanda a
   * cui si è già risposto, e la scheda del controllo è lunga abbastanza.
   */
  const servePosizione = !String(a.lat ?? '').trim();
  const coord = servePosizione
    ? bloccoCoordinate({
      coordinate: { lat: '', lon: '', accuratezza: null, rilevato_il: '' },
      geolocalizzazione, avvisa,
      titolo: 'Questo presidio non ha una posizione',
    })
    : null;

  const tipiAnomalia = [...(S.indici.tipiAnomalia || new Map()).values()]
    .filter((x) => Number(x.attivo ?? 1) === 1);
  const fGravita = scelte(GRAVITA.map((g) => ({ valore: g, testo: g.toLowerCase() })),
    gravitaSuggerita(a), { obbligatorio: true });
  // «Che cosa ha»: sedici voci, e NESSUNA preselezione (18/09/2026, richiesta
  // dell'operatore). Il catalogo dei tipi non è filtrato per categoria — le voci
  // sono le stesse per un estintore e per una porta REI — quindi una scelta
  // suggerita qui sarebbe suggerita a caso, e una scelta a caso si conferma per
  // inerzia: finirebbe in archivio come se qualcuno l'avesse decisa.
  //
  // Per la stessa ragione scegliere un tipo non muove più la GRAVITÀ: la gravità
  // la vede chi ha il pezzo davanti, e sovrascriverla con quella «che di solito
  // corrisponde» significa mettere in bocca all'operatore una valutazione che non
  // ha fatto.
  // ⚠️ COSTRUITO E NON DISEGNATO dal 21/09/2026: il campo è uscito dal foglio
  // del non idoneo (vedi più sotto), ma il controllo resta qui e il suo valore
  // continua a viaggiare nel payload. Toglierlo del tutto vorrebbe dire toccare
  // anche `tipo_anomalia` nel ponte di `app.js`, e il giorno in cui si decide
  // di rimetterlo — da qualche parte, in una forma più stretta — tornerebbe a
  // essere tutto da riscrivere. `.valore` è '' finché nessuno lo disegna.
  const fTipoAn = scelte(
    tipiAnomalia.map((x) => ({ valore: x.codice, testo: x.descrizione })), '');
  const fDescr = el('textarea', { placeholder: 'Che cosa hai trovato' });
  // La verifica a cui il difetto si riferisce: FACOLTATIVA, una sola, dentro un
  // riquadro CHIUSO. Non serve leggere l'elenco per registrare un non idoneo;
  // serve a chi, in ufficio o sul verbale, vuole sapere «quale».
  // ⚠️ Pulsanti e non un menù a tendina: la ruota di sistema copre il foglio da
  // cui parte ed è inservibile con i guanti (regola della schermata, sorvegliata
  // da `test_controllo_campo.mjs`). Un secondo tocco sulla stessa la toglie.
  const fCollegata = scelte(azioni.map((az) => ({ valore: az.testo, testo: az.testo })), '');
  const boxCollegata = el('details', { class: 'verifica-collegata' }, [
    el('summary', { testo: 'Riguarda una verifica dell\'elenco? (facoltativo)' }),
    el('div', { class: 'mini', style: 'margin:6px 0',
      testo: 'Toccala: comparirà nell\'anomalia e nel verbale. Un secondo tocco la toglie.' }),
    fCollegata,
  ]);

  // --- checklist ----------------------------------------------------------- //
  const contatore = el('div', { class: 'checklist-conta' });
  const elencoAzioni = el('ul', { class: 'elenco-azioni' }, azioni.map((az) => {
    const c = el('input', { type: 'checkbox' });
    caselle.push({ casella: c, azione: az });
    c.addEventListener('change', () => aggiorna());
    const cond = !(az.obbligatoria === undefined || String(az.obbligatoria) === '1'
      || az.obbligatoria === true);
    return el('li', {}, [
      el('label', { class: `casella casella-grande${cond ? ' casella-condizionale' : ''}` }, [
        c,
        el('span', { class: 'casella-testo' }, [
          el('span', { testo: az.testo }),
          // Dirlo, e non solo non contarla: senza, l'operatore la legge come una
          // verifica saltata e va a cercarsi di chi è la colpa.
          cond ? el('span', { class: 'casella-solo-se',
            testo: ' — solo se si applica a questo pezzo' }) : null,
        ].filter(Boolean)),
      ]),
    ]);
  }));

  const btnTutte = el('button', {
    class: 'btn btn-blocco btn-piccolo', type: 'button',
    onclick: () => {
      const tutteFatte = mancanti() === 0;
      for (const c of caselle) c.casella.checked = !tutteFatte;
      aggiorna();
    },
  });

  // La nota facoltativa sulle verifiche (18/09/2026). Serve quando una voce non è
  // idonea ma la descrizione dell'anomalia non è il posto giusto — «il terzo
  // estintore da sinistra ha il manometro opaco» è un'osservazione su UNA voce,
  // non il difetto del presidio.
  const fNotaVerifiche = el('textarea', {
    placeholder: 'Facoltativo: un\'osservazione sulle verifiche' });

  // --- esito --------------------------------------------------------------- //
  const motivoConforme = el('div', { class: 'mini', style: 'margin-top:4px' });
  const btnConforme = el('button', { class: 'btn btn-ok btn-esito btn-grande', type: 'button' }, [
    el('span', { class: 'esito-segno', testo: '✓' }), el('span', { testo: 'Idoneo' }),
  ]);
  const btnNonConforme = el('button', { class: 'btn btn-ko btn-esito btn-grande', type: 'button' }, [
    el('span', { class: 'esito-segno', testo: '✕' }), el('span', { testo: 'Non idoneo' }),
  ]);

  // ⛔ «È lo stesso difetto?» (25/09/2026, dall'operatore: «alcune anomalie sono
  // state segnate doppie»). Un presidio con due piani non idonei per lo stesso
  // difetto apriva DUE anomalie con la stessa nota. Se sul presidio ci sono
  // anomalie che ci sono ancora, prima di tutto si chiede se il difetto è una di
  // quelle: una risposta obbligatoria, niente preselezionato. Scelta quella, non
  // se ne apre una nuova e la descrizione non serve.
  let stessoDifetto = '';                       // '' = non risposto, 'NUOVO', o l'id
  const boxStesso = el('div', { class: 'stesso-difetto' });
  const campiNuovo = el('div', {});
  const presenti = () => tutteAperte.filter((an) => ['APERTA', 'NON_BLOCCA'].includes(decisioni.get(an.id)));
  const disegnaStesso = () => {
    const lista = presenti();
    if (stessoDifetto && stessoDifetto !== 'NUOVO' && !lista.some((an) => an.id === stessoDifetto)) stessoDifetto = '';
    boxStesso.textContent = '';
    boxStesso.hidden = !lista.length;
    campiNuovo.hidden = Boolean(lista.length) && stessoDifetto !== 'NUOVO';
    if (!lista.length) return;
    boxStesso.append(campo('Il difetto è uno di quelli già aperti? *',
      scelte([
        ...lista.map((an) => ({ valore: an.id, testo: `Sì: ${riassuntoAnomalia(an).titolo}`, tono: 'attenzione' })),
        { valore: 'NUOVO', testo: 'No, è un difetto nuovo' },
      ], stessoDifetto, { onCambia: (v) => { stessoDifetto = v; disegnaStesso(); } }),
      'Se è lo stesso non si apre un\'altra anomalia: il controllo resta non idoneo per quel difetto.'));
  };
  const boxAnomalia = el('div', { class: 'box-anomalia', hidden: true }, [
    el('h3', { testo: "Che cosa non va", style: 'margin-top:0' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: "Con esito non idoneo si apre un'anomalia: è quello che fa "
        + 'ricomparire il pezzo finché non è sistemato.' }),
    boxStesso,
    campiNuovo,
  ].filter(Boolean));
  campiNuovo.append(...[
    campo('Descrizione *', fDescr,
      'Scrivi che cosa non va. Le spunte qui sopra dicono solo quali verifiche sono state eseguite.'),
    azioni.length ? boxCollegata : null,
    // ⛔ L'elenco dei sedici tipi è stato TOLTO da qui il 21/09/2026
    // (segnalazione dell'operatore). Era dichiarato facoltativo e si presentava
    // come un muro: sedici pulsanti a tutta larghezza fra la descrizione e il
    // pulsante di conferma, in mezzo a un gesto che si fa con il telefono in
    // una mano. Un campo facoltativo che occupa mezzo schermo si legge come
    // obbligatorio, e infatti così è stato letto.
    //
    // ⚠️ Che cosa si perde, detto invece che scoperto dopo: `tipo_codice` resta
    // vuoto sulle anomalie aperte da qui, quindi non contano nei filtri per
    // tipo dell'ufficio. È un prezzo accettabile perché la DESCRIZIONE resta
    // obbligatoria — è lei che dice che cosa si è visto — e perché il tipo si
    // può sempre mettere dopo, da «Modifica» sulla scheda dell'anomalia, dove
    // l'elenco non è in mezzo a niente.
    //
    // ⚠️ E il tipo vuoto vuol dire BLOCCANTE (`anomaliaBlocca` ripiega sul
    // default prudente): è la risposta giusta qui, perché un'anomalia che nasce
    // da un controllo NON IDONEO riguarda per definizione qualcosa che non è
    // andato bene. La si può declassare al giro dopo, rispondendo «c'è ancora,
    // ma si può usare».
    campo('Gravità', fGravita),
  ].filter(Boolean));

  // Il terzo caso, tenuto separato e in tono minore perché è raro ma esiste:
  // non conforme e non eseguito non sono la stessa cosa, e un archivio in cui
  // significano entrambe non permette più di distinguerle.
  const fMotivoNo = el('input', { type: 'text', placeholder: 'Es. bancali davanti alla cassetta' });
  const selNonEseguito = scelte([
    { valore: 'NON_ACCESSIBILE', testo: 'Non ci sono potuto arrivare' },
    { valore: 'NON_ESEGUITO', testo: 'Ci sono arrivato ma non si poteva fare' },
  ], 'NON_ACCESSIBILE', { obbligatorio: true, onCambia: (v) => { esito = v; } });
  const btnRegistraNonEseguito = el('button', {
    class: 'btn btn-blocco btn-grande', type: 'button',
    testo: 'Registra: verifica non eseguibile',
  });
  const boxNonEseguito = el('div', { class: 'box-non-eseguito', hidden: true }, [
    campo('Che cosa è successo', selNonEseguito),
    campo('Perché non è stato possibile', fMotivoNo,
      'Lo legge chi dovrà tornarci: «bancali davanti alla cassetta» dice a chi '
      + 'organizza il prossimo giro che cosa spostare prima.'),
  ]);
  // Il pulsante sta FUORI dal riquadro e in fondo alla scheda, come gli altri due
  // (regola del 18/09/2026: si conferma dopo i campi, non passandoci sopra).
  const boxRegistraNonEseguito = el('div', { hidden: true }, [btnRegistraNonEseguito]);
  const btnNonEseguito = el('button', {
    class: 'btn btn-piccolo btn-blocco btn-esito', type: 'button',
  }, [
    // Stesso motivo del pulsante sulla riga: U+20E0 è combinante e si sovrappone
    // al testo invece di affiancarlo.
    el('span', { class: 'esito-segno', testo: '⚠' }),
    el('span', { testo: 'Verifica non eseguibile…' }),
  ]);

  // --- le anomalie aperte, quando si dichiara IDONEO ---------------------- //
  //
  // Richiesta dell'operatore del 17/09/2026: dichiarare idoneo un presidio che ha
  // un'anomalia aperta è una contraddizione che va sciolta SUL POSTO — o il
  // difetto non c'è più, e allora l'anomalia si chiude, o c'è ancora, e allora
  // l'esito non è idoneo. Prima l'anomalia restava aperta in silenzio e in ufficio
  // si leggeva «idoneo» accanto a «1 anomalia aperta».
  const tutteAperte = (S.anomalieDi(a.id, false) || [])
    .filter((x) => ['APERTA', 'IN_CORSO'].includes(x.stato || 'APERTA'));
  // ⛔ Si chiede UNA VOLTA PER GIRO, non una volta per piano (21/09/2026,
  // segnalazione dell'operatore: «l'operatore si trova a dover riconfermare
  // l'anomalia più volte, anche ogni volta che c'è da mettere idoneo/non idoneo
  // su ogni piano»).
  //
  // Misurato prima di correggere: 403 conferme per 212 anomalie — ognuna
  // chiesta 1,9 volte in media, fino a 4 sullo stesso presidio. Le decisioni
  // vivevano in una mappa LOCALE al modulo, che si azzerava a ogni apertura,
  // mentre `confermata_il` esisteva già, viaggiava nel pacchetto e si vedeva
  // nella scheda: il modulo non la leggeva.
  //
  // Un'anomalia confermata in QUESTO giro è già stata guardata: non si RICHIEDE
  // — ma si mostra lo stesso, con la risposta data, e si può correggere.
  //
  // ⛔ 22/09/2026, segnalazione dell'operatore: «se sbagliamo dovremmo poter
  // correggere». Prima le già confermate sparivano da questa scheda e la loro
  // risposta diventava definitiva per tutto il giro: se era «impedisce l'uso»
  // — e lo era per difetto, perché il pulsante della scheda non faceva la
  // domanda — il presidio non si poteva più dichiarare idoneo, e non c'era
  // nessuna strada per cambiare idea. Una risposta che non si può correggere
  // non è una domanda: è una trappola.
  const anomalieAperte = tutteAperte.filter((x) => !S.confermataNelGiro(x));
  const giaConfermate = tutteAperte.filter((x) => S.confermataNelGiro(x));
  const decisioni = new Map();          // anomalia id -> 'CHIUSA' | 'APERTA' | 'NON_BLOCCA'
  // Le già confermate partono con la risposta che hanno in archivio: il pulsante
  // giusto nasce acceso, e toccare l'altro la corregge.
  for (const an of giaConfermate) {
    decisioni.set(an.id, S.anomaliaBlocca(an) ? 'APERTA' : 'NON_BLOCCA');
  }
  const boxAnomalieAperte = el('div', { class: 'card card-piatta', hidden: true }, [
    el('h3', { style: 'margin-top:0', testo: tutteAperte.length === 1
      ? "C'era un'anomalia aperta su questo presidio"
      : `C'erano ${tutteAperte.length} anomalie aperte su questo presidio` }),
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: "Dicci di ognuna se il difetto c'è ancora, e se impedisce di usare "
        + 'il presidio. Te lo chiediamo una volta sola in questo giro'
        + (giaConfermate.length
          ? ': quelle a cui hai già risposto sono chiuse, e «Cambia la risposta» le riapre.'
          : '.') }),
    ...tutteAperte.map((an) => {
      const scelta = el('div', { class: 'interruttore', role: 'group',
        'aria-label': `Anomalia: ${riassuntoAnomalia(an).titolo}` });
      // ⛔ TRE risposte e non due (21/09/2026). La terza è quella che mancava:
      // «c'è ancora ma il presidio si usa» — box ammaccato, cartello staccato,
      // posizionamento non conforme. Prima le risposte erano due e nessuna
      // diceva il vero in quel caso: «risolta» è falso, «c'è ancora» costringeva
      // a NON IDONEO un estintore carico e funzionante.
      //
      // La risposta si scrive sull'anomalia (`bloccante`) e vince sul default
      // del suo tipo: è la deroga per caso singolo, data da chi guarda il pezzo.
      // Verde, giallo, rosso (24/09/2026, richiesta dell'operatore).
      const bottoni = [
        ['CHIUSA', "✓ Risolta, non c'è più", 'ok'],
        ['NON_BLOCCA', "! C'è ancora, ma si può usare", 'attenzione'],
        ['APERTA', '✕ C\'è ancora e impedisce l\'uso', 'ko'],
      ].map(([valore, etichetta, tono]) => el('button', {
        class: `interruttore-voce tono-${tono}${decisioni.get(an.id) === valore ? ' attiva' : ''}`,
        type: 'button', dataset: { valore },
        'aria-pressed': String(decisioni.get(an.id) === valore),
        testo: etichetta,
        onclick: () => {
          decisioni.set(an.id, valore);
          for (const b of scelta.figli || scelta.children || []) {
            const attiva = b.dataset && b.dataset.valore === valore;
            b.classList.toggle('attiva', attiva);
            b.setAttribute('aria-pressed', String(attiva));
          }
          aggiorna();
        },
      }));
      for (const b of bottoni) scelta.append(b);
      // ⛔ GIÀ RISPOSTO in questo giro (anche con «Modifica», che vale come
      // riconferma): la risposta a parole e un pulsante solo per cambiarla,
      // invece delle tre domande come se fossero ancora da fare (24/09/2026,
      // dall'operatore). Al giro dopo si richiede tutto.
      const gia = giaConfermate.includes(an);
      let cambia = null;
      if (gia) scelta.hidden = true;
      const risposto = gia ? el('div', { class: 'anomalia-gia-risposto' }, [
        el('span', { class: `tag ${S.anomaliaBlocca(an) ? 'tag-rosso' : 'tag-verde'}`,
          testo: `✓ già risposto in questo giro: ${S.anomaliaBlocca(an) ? "c'è ancora e impedisce l'uso" : "c'è ancora, ma si può usare"}` }),
        (cambia = el('button', {
          class: 'btn btn-piccolo btn-blocco', type: 'button', style: 'margin-top:6px',
          testo: '✎ Cambia la risposta',
          onclick: () => { cambia.hidden = true; scelta.hidden = false; },
        })),
      ]) : null;
      return el('div', { class: 'anomalia-decisione', style: 'margin-bottom:10px' }, [
        // Nota in evidenza, elenco raccolto (24/09/2026: `anomalia_testo.js`).
        el('div', { style: 'font-weight:600' }, [nodoTestoAnomalia(an)]),
        an.azione_proposta ? el('div', { class: 'mini', testo: `→ ${an.azione_proposta}` }) : null,
        risposto,
        scelta,
      ].filter(Boolean));
    }),
  ]);
  const avvisoAnomalie = el('div', { class: 'mini', style: 'color:var(--rosso);margin-top:6px' });
  boxAnomalieAperte.append(avvisoAnomalie);
  // ⚠️ Obbligatorie sono solo quelle MAI confermate in questo giro: le altre
  // una risposta ce l'hanno già, e ripretenderla sarebbe tornare alle 403
  // conferme per 212 anomalie di prima del 21/09.
  const mancantiAnomalie = () => anomalieAperte.filter((an) => !decisioni.has(an.id)).length;
  // ⛔ Solo le BLOCCANTI rifiutano IDONEO. Le già confermate in questo giro
  // contano anche loro — la decisione è del giro, non del modulo — e per quelle
  // vale quello che l'operatore aveva risposto allora.
  // Una sola lettura, per tutte: la decisione del giro vive nella mappa, che per
  // le già confermate parte dal valore in archivio. Sommare due insiemi — «le
  // nuove decise» più «le vecchie come stanno» — era il modo in cui una
  // correzione non poteva arrivare.
  const ancoraPresenti = () => tutteAperte.filter((an) => decisioni.get(an.id) === 'APERTA');

  function aggiorna() {
    disegnaStesso();
    const n = azioni.length;
    const f = fatte();
    // «idonee», non «fatte» (18/09/2026). Spuntare una voce è un GIUDIZIO — quella
    // verifica è andata bene — e «fatte» lo faceva leggere come «l'ho guardata»:
    // due cose diverse, e la seconda non decide niente.
    const nr = richieste().length;
    // «eseguite» (25/09/2026): la spunta dice che la verifica è stata fatta,
    // il giudizio è l'esito. «idonee» (dal 18/09) la faceva leggere come un voto
    // voce per voce, e un voto mancante come un voto negativo.
    contatore.textContent = nr ? `${f} di ${nr} verifiche eseguite`
      + (nr < n ? ` · ${n - nr} valgono solo in certi casi` : '') : '';
    btnTutte.textContent = n && mancanti() === 0
      ? 'Togli tutte le spunte'
      : 'Segna tutte le verifiche come eseguite';

    // La ragione per cui «Idoneo» è spento la decide la regola gemella
    // (`motivoRifiutoIdoneo`): spunte mancanti, pezzi guasti, anomalie ancora
    // presenti. Qui non se ne scrive una seconda — la frase che l'operatore legge
    // è la stessa che il server userebbe per rifiutare, ed è provata sui tre lati
    // da `test_idoneo_cross.py`. (Fino al 17/09/2026 la frase sulle anomalie era
    // scritta QUI, e quindi l'ufficio ne aveva una diversa per la stessa regola.)
    const rifiuto = S.motivoRifiutoIdoneo(
      'IDONEO', caselle.map((c) => ({ fatta: c.casella.checked ? 1 : 0,
        obbligatoria: obbligatoria(c.azione) ? 1 : 0 })),
      multiplo ? pezziKo.valore() : null, ancoraPresenti().length)
      || (anomalieAperte.length && mancantiAnomalie()
        ? `Prima dicci se ${mancantiAnomalie() === 1 ? "l'anomalia aperta c'è ancora" : `le ${mancantiAnomalie()} anomalie aperte ci sono ancora`}.`
        : null);
    const bloccato = Boolean(rifiuto);
    boxAnomalieAperte.hidden = tutteAperte.length === 0 || partiNonEseguibile;
    if (!partiNonEseguibile) {
      btnConforme.disabled = bloccato;
      btnConforme.classList.toggle('btn-spento', bloccato);
    }
    motivoConforme.textContent = partiNonEseguibile ? '' : (rifiuto || '');

    // ⛔ Le anomalie aperte bloccano QUALUNQUE esito, non solo «idoneo»
    // (18/09/2026, richiesta dell'operatore). Prima si poteva registrare non
    // idoneo lasciandole senza risposta, e quella era la strada per cui un
    // difetto risolto restava aperto per sempre: nessuno ripassa da un'anomalia
    // se non gliela si mette davanti mentre ha il pezzo in mano.
    // ⚠️ …tranne quando il controllo NON SI È POTUTO FARE (19/09/2026). Se non
    // si è arrivati al pezzo non si può nemmeno dire se il difetto c'è ancora:
    // chiederlo qui sarebbe chiedere di indovinare, ed è la stessa obiezione per
    // cui sono sparite le preselezioni. Su quella strada la scheda non mostra
    // nemmeno il riquadro.
    const senzaRisposta = (anomalieAperte.length && !partiNonEseguibile)
      ? mancantiAnomalie() : 0;
    for (const b of [btnNonConforme, btnRegistraNonEseguito]) {
      b.disabled = senzaRisposta > 0;
      b.classList.toggle('btn-spento', senzaRisposta > 0);
    }
    avvisoAnomalie.textContent = senzaRisposta
      ? `Prima dicci se ${senzaRisposta === 1 ? "l'anomalia aperta c'è ancora"
        : `le ${senzaRisposta} anomalie aperte ci sono ancora`}: vale per qualunque esito.`
      : '';
    void n;

    btnConforme.classList.toggle('scelto', esito === 'IDONEO');
    btnNonConforme.classList.toggle('scelto', esito === 'NON_IDONEO');
    // Il secondo tocco deve dire che cosa farà: «Non conforme» premuto due
    // volte non si distingue da «Non conforme» premuto per sbaglio.
    btnNonConforme.lastChild.textContent = esito === 'NON_IDONEO'
      ? 'Registra non idoneo' : 'Non idoneo';
    boxAnomalia.hidden = esito !== 'NON_IDONEO';
    // Sulla strada corta il riquadro del motivo è l'unica cosa che c'è: sempre
    // aperto, e senza il pulsantino che lo apriva.
    boxNonEseguito.hidden = partiNonEseguibile
      ? false : !['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(esito);
    boxRegistraNonEseguito.hidden = boxNonEseguito.hidden;
    btnNonEseguito.hidden = boxNonEseguito.hidden === false;

  }

  btnConforme.addEventListener('click', () => { esito = 'IDONEO'; registra(); });
  // Due tocchi, e il secondo dice che cosa farà.
  //
  // Il primo apre il riquadro dell'anomalia — con non idoneo un'anomalia si
  // apre sempre, ed è quella che fa ricomparire il pezzo finché non è
  // sistemato. Registrare al primo tocco significherebbe aprirla senza che
  // nessuno abbia scritto che cosa c'è che non va.
  btnNonConforme.addEventListener('click', () => {
    if (esito !== 'NON_IDONEO') { esito = 'NON_IDONEO'; aggiorna(); fDescr.focus(); return; }
    registra();
  });
  btnNonEseguito.addEventListener('click', () => {
    esito = selNonEseguito.valore; aggiorna(); fMotivoNo.focus();
  });
  btnRegistraNonEseguito.addEventListener('click', () => registra());

  async function registra() {
    // ⛔ La descrizione è SEMPRE di chi c'era (25/09/2026): niente più elenco
    // automatico delle voci senza spunta, che era vuoto solo se tutto era
    // spuntato — e quindi obbligava a scrivere proprio quando le voci erano a
    // posto, e diceva «tutte fallite» quando nessuno le aveva spuntate.
    // «Stesso difetto?»: con anomalie ancora presenti la risposta è obbligatoria.
    if (esito === 'NON_IDONEO' && presenti().length && !stessoDifetto) {
      avvisa('Dicci se il difetto è uno di quelli già aperti o uno nuovo: senza, si aprirebbe '
        + 'un\'anomalia doppia.');
      return;
    }
    const esistente = esito === 'NON_IDONEO' && stessoDifetto && stessoDifetto !== 'NUOVO'
      ? tutteAperte.find((an) => an.id === stessoDifetto) : null;
    if (esito === 'NON_IDONEO' && !esistente && !fDescr.value.trim()) {
      avvisa("Scrivi che cosa non va: un'anomalia senza descrizione non dice "
        + 'niente a chi la legge in ufficio.');
      fDescr.focus();
      return;
    }
    let anno;
    if (fAnno && fAnno.value !== '') {
      anno = Number(fAnno.value);
      if (!Number.isInteger(anno) || anno < 1950 || anno > annoMassimo) {
        avvisa(`L'anno di costruzione deve stare fra 1950 e ${annoMassimo}; lascialo vuoto se non si legge.`);
        return;
      }
    }
    if (['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(esito) && !fMotivoNo.value.trim()) {
      avvisa('Scrivi perché non è stato possibile: senza motivo il controllo '
        + 'risulta semplicemente non fatto.');
      fMotivoNo.focus();
      return;
    }

    // La descrizione dell'anomalia nomina le verifiche rimaste indietro. È la
    // parte che in ufficio dice che cosa manca davvero, e nessuno la
    // riscriverebbe a mano su un telefono. La FRASE sta in `stato.js`, gemella
    // di quella del server: qui si decide quando dirla, non come.
    // Lo stesso difetto: la descrizione del controllo lo nomina, a parole.
    let descrizione = esistente
      ? (fDescr.value.trim() || `Difetto già segnalato: ${riassuntoAnomalia(esistente).titolo}`)
      : fDescr.value.trim();
    if (['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(esito)) {
      descrizione = fMotivoNo.value.trim();
    }

    let ko;
    if (multiplo && !['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(esito)) {
      // Obbligatorio, e proprio perché non è più precompilato: lasciato vuoto il
      // server non tocca `quantita_ko`, quindi l'archivio resterebbe a quello di
      // prima — e un presidio «idoneo» con tre pezzi guasti in archivio è la
      // contraddizione che il campo precompilato evitava per caso. Su una riga da
      // più pezzi quel numero è il dato che decide l'esito: chiederlo è il punto.
      const manca = pezziKo.errore();
      if (manca) { avvisa(manca); return; }
      ko = pezziKo.valore();
    } else if (['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(esito)) {
      // Nessun numero: non si è guardato niente, quindi non si dichiara niente.
      // `null` lascia l'archivio com'era, che è la sola cosa vera.
      ko = null;
    } else {
      ko = esito === 'NON_IDONEO' ? 1 : 0;
    }

    const res = await salva({
      tipo_controllo_codice: t.codice,
      piano_id: t.piano_id || null,
      esito,
      data: fData.value || S.oggiIso(),
      azione_eseguita: fAzione.value.trim(),
      documento_rif: fDoc.value.trim(),
      note: fNote.value.trim(),
      quantita_ko: ko,
      quantita_verificata: q,
      apri_anomalia: esito === 'NON_IDONEO',
      // Le anomalie che l'operatore ha dichiarato risolte si chiudono con il
      // controllo, nella stessa scrittura: chiuderle dopo, da un'altra schermata,
      // è il passaggio che non si fa.
      anomalie_risolte: esito === 'IDONEO'
        ? tutteAperte.filter((an) => decisioni.get(an.id) === 'CHIUSA').map((an) => an.id)
        : [],
      // ⛔ Le anomalie CONFERMATE, con la loro risposta alla seconda domanda.
      // Si scrive anche quando l'esito è NON IDONEO: «c'è ancora» è
      // un'osservazione di oggi, e vale comunque — è quella che toglie la
      // domanda dai piani successivi di questo giro.
      // ⚠️ Anche le CORREZIONI: una già confermata la cui risposta è cambiata
      // deve tornare in archivio, o la correzione resterebbe sullo schermo.
      // Quelle non toccate non si riscrivono: un evento di giornale identico al
      // precedente è rumore che nasconde le modifiche vere.
      anomalie_confermate: tutteAperte
        .filter((an) => ['APERTA', 'NON_BLOCCA'].includes(decisioni.get(an.id)))
        .filter((an) => !S.confermataNelGiro(an)
          || S.anomaliaBlocca(an) !== (decisioni.get(an.id) === 'APERTA'))
        .map((an) => ({ id: an.id, bloccante: decisioni.get(an.id) === 'APERTA' })),
      descrizione: descrizione || undefined,
      verifica_collegata: esito === 'NON_IDONEO' && !esistente ? (fCollegata.valore || undefined) : undefined,
      anomalia_esistente: esistente ? esistente.id : undefined,
      gravita_anomalia: fGravita.valore,
      tipo_anomalia: fTipoAn.valore || undefined,
      anno_costruzione: anno,
      // Le coordinate viaggiano come l'anno: il ponte in `app.js` le scrive sul
      // presidio nella STESSA transazione del controllo. Solo se ne è stata
      // presa una — un riquadro aperto e non compilato non deve svuotare niente.
      coordinate: coord && coord.valori().lat ? coord.valori() : null,
      azioni: caselle.map(({ casella, azione }, i) => ({
        azione_id: azione.id || null,
        ordine: Number(azione.ordine ?? i),
        testo: azione.testo,
        fatta: casella.checked ? 1 : 0,
      })),
    }, messaggioDi(esito, t, fData.value || S.oggiIso()));

    if (res) chiudi();
  }

  const intestazione = [
    el('div', { class: 'mini', testo: `${a.identificativo || a.codice} · ${S.ubicazione(a)}` }),
    el('div', { class: 'riga', style: 'gap:6px;margin:6px 0 2px' }, [
      t.frequenza_testo ? tag(t.frequenza_testo, 'tag-blu') : null,
      t.scadenza ? tag(frasScadenza(t.scadenza).testo, frasScadenza(t.scadenza).classe) : null,
    ].filter(Boolean)),
  ];

  // ⛔ LA STRADA CORTA: «verifica non eseguibile» non è un esito del pezzo, e la
  // scheda non deve somigliare a quella in cui lo si giudica (19/09/2026,
  // segnalazione dell'operatore: «il popup non dovrebbe mostrare le altre parti
  // del form come se si potesse segnare idoneo o non idoneo»).
  //
  // Che cosa sparisce, e perché ognuna di quelle cose sarebbe una domanda a cui
  // non si può rispondere: la CHECKLIST (non si è visto niente da spuntare),
  // l'ANNO letto sull'etichetta (l'etichetta non l'ha vista nessuno), i PEZZI
  // GUASTI (non si sono contati), le ANOMALIE APERTE da confermare o chiudere
  // (non si è arrivati al pezzo), il riquadro dell'ANOMALIA NUOVA e i pulsanti
  // IDONEO / NON IDONEO. Resta quello che si sa davvero: che cosa è successo,
  // perché, e quando.
  if (partiNonEseguibile) {
    const corpoCorto = el('div', {}, [
      ...intestazione,
      avviso('Stai registrando che questo controllo NON si è potuto fare. Il presidio '
        + 'resta come sta — nessun giudizio sul pezzo, nessuna anomalia — e la voce '
        + 'esce dai «da controllare» di questo giro con un segnale di attenzione, '
        + 'così in ufficio si sa che cosa è rimasto da guardare.', 'avviso-ambra'),
      boxNonEseguito,
      el('details', { class: 'dettagli-extra' }, [
        el('summary', { testo: 'Data e note' }),
        campo('Data', fData),
        campo('Note', fNote),
      ]),
      boxRegistraNonEseguito,
      el('div', { class: 'riga riga-fine', style: 'margin-top:14px' }, [
        el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: () => chiudi(false) }),
      ]),
    ]);
    aggiorna();
    return corpoCorto;
  }

  const corpo = el('div', {}, [
    ...intestazione,

    azioni.length
      ? el('div', { class: 'card card-piatta' }, [
        el('h3', { testo: 'Che cosa verificare', style: 'margin-top:0' }),
        contatore,
        elencoAzioni,
        btnTutte,
        campo('Nota sulle verifiche', fNotaVerifiche,
          'Facoltativa: un\'osservazione sulle verifiche che non è un difetto del presidio.'),
      ])
      : avviso('Questo piano non ha un elenco di verifiche in archivio: registra '
        + "l'esito e, se serve, scrivi nelle note che cosa hai controllato.", 'avviso-blu'),

    fAnno ? el('div', { class: 'card card-piatta' }, [
      campo("Anno di costruzione (dall'etichetta)", fAnno,
        'Manca in archivio e serve a calcolare la fine vita. Lascialo vuoto se non si legge.'),
    ]) : null,

    // La posizione, se il presidio non ce l'ha. Sta accanto all'anno perché
    // rispondono alla stessa condizione: sono le due cose che si possono
    // registrare SOLO stando davanti al pezzo.
    coord ? el('div', { class: 'card card-piatta' }, [coord.nodo]) : null,

    // I pezzi guasti stanno QUI, sopra l'esito, e non in fondo dentro «Data, note,
    // documento» (16/09/2026): su una riga da dodici lampade sono il dato che
    // DECIDE l'esito — una bruciata e il controllo è fatto ma non idoneo — e in
    // fondo a un pannello chiuso non li compilava nessuno.
    multiplo ? pezziKo.nodo : null,

    boxAnomalieAperte,

    // I due riquadri che DIPENDONO dall'esito stanno prima dei pulsanti, perché
    // si compilano prima di confermare; i pulsanti stanno in fondo a tutto
    // (18/09/2026, richiesta dell'operatore). Prima «Registra» era a metà scheda,
    // con sotto la descrizione dell'anomalia e i campi facoltativi: si confermava
    // passando SOPRA a campi non ancora compilati, che è il modo più naturale di
    // non compilarli.
    boxAnomalia,
    boxNonEseguito,

    el('details', { class: 'dettagli-extra' }, [
      el('summary', { testo: 'Data, note, documento' }),
      campo('Data', fData),
      campo('Azione eseguita', fAzione),
      campo('Riferimento documento', fDoc),
      campo('Note', fNote),
    ]),

    el('h3', { testo: "Com'è andata", style: 'margin-top:18px' }),
    el('div', { class: 'azioni-esito' }, [btnConforme, btnNonConforme]),
    motivoConforme,
    btnNonEseguito,
    boxRegistraNonEseguito,

    el('div', { class: 'riga riga-fine', style: 'margin-top:14px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: () => chiudi(false) }),
    ]),
  ]);

  aggiorna();
  // ⛔ La chiusura del GPS viaggia SUL NODO, e non come valore di ritorno a
  // parte: `corpoControlloPiano` restituisce un nodo, e i suoi chiamanti — la
  // schermata vera e le prove — lo appendono e basta. Un secondo valore da
  // ricordare di propagare è un secondo modo di dimenticarselo, e dimenticarlo
  // qui vuol dire il ricevitore acceso dopo che il foglio si è chiuso.
  corpo.chiudiCoordinate = () => { if (coord) coord.chiudi(); };
  return corpo;
}

/**
 * Che cosa risulta registrato per un controllo, e come disfarlo.
 *
 * Perché serve
 * ------------
 * Si tocca «Conforme» sul presidio sbagliato — succede, con il telefono in una
 * mano e l'estintore nell'altra. Senza un modo per disfare, l'unico rimedio è
 * registrare un secondo controllo per "correggere" il primo, che non corregge
 * niente: nel registro restano due controlli, e uno non è mai stato eseguito.
 *
 * Prima di poter disfare bisogna poter GUARDARE: qui c'è tutto quello che è
 * finito nel verbale, spunta per spunta, com'è stato salvato. È anche la risposta
 * alla domanda «che cosa ho fatto su questo pezzo», che ci si pone dieci minuti
 * dopo, quando non ci si ricorda più.
 *
 * L'annullamento chiede un motivo, e non è burocrazia: il giornale viaggia nel
 * pacchetto e finisce nel registro dell'ufficio, dove un controllo sparito senza
 * spiegazione è indistinguibile da un guasto del programma.
 */
export function corpoRegistrazione(d, { annulla, annota, chiudi, avvisa } = {}) {
  const iv = d.intervento;
  const fatte = d.azioni.filter((x) => x.fatta === '1').length;

  const fMotivo = el('input', { type: 'text',
    placeholder: 'Es. era un altro estintore, ho sbagliato riga' });
  const btnConferma = el('button', {
    class: 'btn btn-ko btn-blocco', type: 'button', testo: 'Sì, annulla la registrazione',
  });
  const boxAnnulla = el('div', { class: 'box-annulla', hidden: true }, [
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: "Il controllo sparisce, la scadenza torna aperta e l'anomalia "
        + "eventualmente aperta viene tolta. Resta scritto nel giornale che l'hai "
        + 'annullato e perché: in ufficio lo vedranno.' }),
    campo('Perché lo annulli', fMotivo),
    btnConferma,
  ]);
  // --- la nota di QUESTA verifica ---------------------------------------- //
  //
  // Non è un'anomalia, e la distinzione va tenuta anche nelle parole: l'anomalia
  // sta sul presidio ed è un problema aperto, la nota sta sul controllo ed è
  // un'osservazione di quel giorno. Chi scrive «manca il cappuccio» qui dentro
  // non apre niente, e va detto — da cui la frase sotto il campo.
  //
  // Si può annotare anche un controllo di un altro giro: annotare aggiunge,
  // annullare toglie, e solo la seconda cancellerebbe qualcosa dall'archivio.
  const testoNota = el('div', { class: 'mini',
    testo: iv.note ? `Note: ${iv.note}` : 'Nessuna nota su questa verifica.' });
  const fNota = el('textarea', {
    rows: '3', value: iv.note || '',
    placeholder: "Che cosa hai osservato durante questa verifica",
  });
  const boxNota = el('div', { class: 'card card-piatta', hidden: true }, [
    fNota,
    el('div', { class: 'mini', style: 'margin:4px 0 8px',
      testo: "È una nota sulla verifica, non un'anomalia: non apre niente da fare. "
        + "Se hai trovato un problema del presidio, apri un'anomalia." }),
    el('div', { class: 'riga', style: 'gap:8px' }, [
      el('button', { class: 'btn btn-primario', type: 'button', testo: 'Salva la nota',
        onclick: async () => {
          const esito = await annota(iv.id, fNota.value);
          if (esito === false) return;
          iv.note = fNota.value.trim();
          testoNota.textContent = iv.note ? `Note: ${iv.note}` : 'Nessuna nota su questa verifica.';
          btnNota.textContent = iv.note ? '✎ Modifica la nota' : '✎ Aggiungi una nota';
          boxNota.hidden = true; btnNota.hidden = false;
        } }),
      el('button', { class: 'btn', type: 'button', testo: 'Lascia stare',
        onclick: () => { fNota.value = iv.note || ''; boxNota.hidden = true; btnNota.hidden = false; } }),
    ]),
  ]);
  const btnNota = el('button', {
    class: 'btn', type: 'button', style: 'margin-top:6px',
    testo: iv.note ? '✎ Modifica la nota' : '✎ Aggiungi una nota',
    onclick: () => { boxNota.hidden = false; btnNota.hidden = true; fNota.focus(); },
  });
  const riquadroNota = el('div', { style: 'margin-top:10px' }, [testoNota, btnNota, boxNota]);

  const btnApriAnnulla = el('button', {
    class: 'btn btn-blocco', type: 'button', testo: '↺ Annulla questa registrazione',
    onclick: () => { boxAnnulla.hidden = false; btnApriAnnulla.hidden = true; fMotivo.focus(); },
  });

  btnConferma.addEventListener('click', async () => {
    if (!fMotivo.value.trim()) {
      avvisa('Scrivi perché lo annulli: in ufficio un controllo sparito senza '
        + 'spiegazione è indistinguibile da un guasto del programma.');
      fMotivo.focus();
      return;
    }
    const esito = await annulla(iv.id, fMotivo.value.trim());
    if (esito) chiudi(true);
  });

  return el('div', {}, [
    el('div', { class: 'mini',
      testo: `${(d.asset && (d.asset.identificativo || d.asset.codice)) || ''}`
        + `${d.asset ? ` · ${S.ubicazione(d.asset)}` : ''}` }),
    el('h3', { testo: d.nome, style: 'margin:8px 0 4px' }),

    el('div', { class: 'riga', style: 'gap:6px;margin-bottom:10px' }, [
      tag(etichettaEsito(iv.esito), iv.esito === 'IDONEO' ? 'tag-verde'
        : iv.esito === 'NON_IDONEO' ? 'tag-rosso' : 'tag-ambra'),
      tag(dataIt(iv.data), 'tag-grigio'),
      iv.operatore_nome ? tag(iv.operatore_nome, 'tag-blu') : null,
    ].filter(Boolean)),

    // Le spunte come sono state salvate. È «la lista delle cose fatte durante il
    // controllo»: il testo è quello fotografato al momento, non quello che il
    // piano dice oggi.
    d.azioni.length
      ? el('div', { class: 'card card-piatta' }, [
        el('h3', { testo: `Verifiche eseguite: ${fatte} di ${d.azioni.length}`, style: 'margin-top:0' }),
        // ✓ eseguita, — non spuntata (25/09/2026): una voce vuota non è un
        // giudizio negativo, e un ✕ la faceva leggere così.
        el('ul', { class: 'elenco-verbale' }, d.azioni.map((az) => el('li', {
          class: az.fatta === '1' ? 'fatta' : 'non-fatta',
        }, [
          el('span', { class: 'verbale-segno', testo: az.fatta === '1' ? '✓' : '—' }),
          el('span', { testo: az.testo }),
        ]))),
      ])
      : el('div', { class: 'mini', testo: 'Questo piano non aveva un elenco di verifiche.' }),

    riquadroNota,
    iv.azione_eseguita
      ? el('div', { class: 'mini', testo: `Azione eseguita: ${iv.azione_eseguita}` }) : null,
    iv.documento_rif
      ? el('div', { class: 'mini', testo: `Documento: ${iv.documento_rif}` }) : null,

    d.anomalia
      ? avviso(`Ha aperto un'anomalia: ${(() => { const r = riassuntoAnomalia(d.anomalia); return r.sotto && r.sotto !== 'nessuna nota scritta' ? `${r.titolo} (${r.sotto.replace(/^\+ /, '')})` : r.titolo; })()}`, 'avviso-ambra')
      : null,
    // Che cosa è successo alla scadenza, in due righe: quella che si chiude e
    // quella che si apre. La seconda era la domanda senza risposta.
    el('div', { class: 'riquadro-scadenza' }, [
      d.scadenza
        ? el('div', { class: 'mini', testo: `Chiusa la scadenza del ${dataIt(d.scadenza.data_scadenza)}.` })
        : null,
      d.prossima
        ? el('div', {}, [
          el('span', { testo: 'Prossima scadenza: ' }),
          el('b', { testo: dataIt(d.prossima) }),
          d.frequenza_testo ? el('span', { class: 'mini', testo: ` (${d.frequenza_testo})` }) : null,
        ])
        : el('div', { class: 'mini',
          testo: 'La prossima scadenza la calcola Scudo al rientro: questo '
            + 'controllo non ha un piano con una periodicità.' }),
    ]),

    el('div', { style: 'margin-top:16px' }, [
      d.annullabile
        ? btnApriAnnulla
        : el('div', { class: 'mini',
          testo: 'Questo controllo non è di questo giro: si può correggere solo in '
            + "ufficio. Annullarlo qui lo cancellerebbe anche dall'archivio, perché "
            + 'il rientro sostituisce le tabelle.' }),
      boxAnnulla,
    ]),
  ]);
}

/** «Conforme», «Non conforme», … in italiano leggibile. */
export function etichettaEsito(e) {
  return {
    IDONEO: '✓ Idoneo',
    NON_IDONEO: '✕ Non idoneo',
    NON_ESEGUITO: '— Non eseguito',
    NON_ACCESSIBILE: '🚧 Non accessibile',
  }[e] || String(e || '').replace(/_/g, ' ').toLowerCase();
}

/**
 * I campi di un'ANOMALIA — gli stessi, con le stesse parole, per aprirla e per
 * modificarla (23/09/2026, dall'operatore: «se clicchiamo su "apri anomalia
 * senza registrare il controllo" non c'è coerenza su come registriamo le
 * anomalie nei controlli — si può usare, non si può usare… anche la modifica
 * dovrebbe avere quella coerenza e mostrare tutti i campi modificabili; vanno
 * tolte le opzioni preimpostate cliccabili; "pezzi guasti su 1" non si capisce»).
 *
 * Che cosa c'era, e perché non andava:
 *  * «Apri anomalia» aveva i SEDICI tipi da cliccare (tolti dal controllo il
 *    21/09/2026 per la stessa ragione: un muro di pulsanti facoltativi in mezzo
 *    al gesto), non chiedeva se il presidio si può usare, e diceva «Pezzi guasti
 *    (su 1)» — una domanda che su un pezzo solo non ha senso;
 *  * «Modifica» non mostrava né la domanda né i pezzi, e la descrizione
 *    appariva VUOTA (difetto di `el` sulle textarea, corretto in ui.js).
 *
 * Adesso i due fogli usano questo, e le parole sono quelle della scheda del
 * presidio (`bloccoAnomalie`): «! Si può usare» / «✕ Impedisce l'uso». I pezzi
 * sono la domanda del controllo (`sceltaPezziGuasti`), e SOLO se la riga conta
 * più di un pezzo: su uno solo la risposta è già «impedisce l'uso».
 *
 * @param an  l'anomalia da modificare, o null per aprirne una nuova. In modifica
 *            ogni campo parte da quello che c'è (descrizione compresa); in
 *            apertura «si può usare?» NON è preselezionato — è un giudizio, e
 *            una risposta già data si conferma per inerzia.
 * @returns `{ nodo, errori(), valori() }` — `valori().quantita_ko` è null se la
 *          domanda sui pezzi non c'è.
 */
export function campiAnomalia(a, an = null) {
  const q = num(a && a.quantita, 1);
  const fDescr = el('textarea', { placeholder: 'Che cosa non va' });
  // ⛔ Si modifica la NOTA, non l'elenco delle verifiche (24/09/2026): prima il
  // campo si riempiva con tutta la descrizione, sette voci comprese, e chi
  // voleva correggere quattro parole se le trovava in fondo a un paragrafo.
  // L'elenco resta com'era (`ricomponiDescrizione`) ed è mostrato sotto.
  const parti = an ? S.parteNota(an.descrizione) : { nota: '', coda: '' };
  fDescr.value = parti.nota;
  let blocca = an ? S.anomaliaBlocca(an) : null;
  const risposta = el('div', { class: 'interruttore anomalia-blocca', role: 'group',
    'aria-label': 'Con questo difetto il presidio si può usare?' });
  const bottoni = [[false, '! Si può usare'], [true, "✕ Impedisce l'uso"]].map(([valore, etichetta]) => {
    const b = el('button', {
      class: `interruttore-voce ${valore ? 'tono-ko' : 'tono-attenzione'}${blocca === valore ? ' attiva' : ''}`, type: 'button',
      'aria-pressed': String(blocca === valore), testo: etichetta,
      onclick: () => {
        blocca = valore;
        for (const x of bottoni) {
          x.classList.toggle('attiva', x.__valore === valore);
          x.setAttribute('aria-pressed', String(x.__valore === valore));
        }
      },
    });
    b.__valore = valore;
    return b;
  });
  for (const b of bottoni) risposta.append(b);
  const fGravita = scelte(GRAVITA.map((g) => ({ valore: g, testo: g.toLowerCase() })),
    (an && an.gravita) || gravitaSuggerita(a), { obbligatorio: true });
  const koOra = num(a && a.quantita_ko, 0);
  const pezzi = q > 1 ? sceltaPezziGuasti(q, an ? 0 : koOra, null, { iniziale: an ? koOra : null,
    aiuto: 'Anche un solo pezzo che non funziona rende il presidio non idoneo.' }) : null;
  const fAzione = el('input', { type: 'text', placeholder: 'Che cosa va fatto (facoltativo)' });
  fAzione.value = an ? String(an.azione_proposta || '') : '';

  const obbl = (n) => { if (n.classList) n.classList.add('campo-obbligatorio'); return n; };
  const nodo = el('div', { class: 'campi-anomalia' }, [
    el('div', { class: 'mini legenda-obbligatori', testo: 'I campi con * sono obbligatori.' }),
    obbl(campo(parti.coda ? 'Nota dell\'operatore' : 'Descrizione', fDescr, an
      ? (parti.coda ? 'Quello che hai scritto tu. Le voci lasciate senza spunta qui sotto restano come sono state registrate.'
        : 'Modificala: parte da quella registrata.')
      : 'Quello che hai visto lo sai solo tu.')),
    // L'elenco delle verifiche, in sola lettura: resta com'era (24/09/2026).
    parti.coda ? (() => {
      const t = S.testoAnomalia(an);
      const n = t.verifiche.length;
      return el('details', { class: 'anomalia-verifiche' }, [
        el('summary', { testo: `${n ? `${n} ${n === 1 ? 'voce lasciata senza spunta' : 'voci lasciate senza spunta'}` : 'Voci lasciate senza spunta'} al controllo` }),
        el('div', { class: 'mini', style: 'margin:4px 0', testo: SPIEGA_VOCI_VUOTE }),
        n ? el('ul', {}, t.verifiche.map((v) => el('li', { testo: v }))) : el('div', { class: 'mini', testo: t.grezzo }),
      ]);
    })() : null,
    // La verifica collegata, in sola lettura: la sceglie chi apre l'anomalia
    // dal controllo, e il testo è quello di quel giorno.
    an && String(an.verifica_collegata || '').trim()
      ? el('div', { class: 'anomalia-collegata', testo: `↳ riguarda la verifica: ${String(an.verifica_collegata).trim()}` }) : null,
    obbl(campo('Con questo difetto, il presidio si può usare?', risposta,
      "«Impedisce l'uso» rende il presidio non idoneo finché l'anomalia resta aperta.")),
    campo('Gravità', fGravita),
    pezzi ? pezzi.nodo : null,
    campo('Azione proposta', fAzione),
  ].filter(Boolean));

  return {
    nodo,
    errori() {
      const out = [];
      // Con l'elenco delle verifiche la descrizione c'è già: la nota è facoltativa.
      if (!fDescr.value.trim() && !parti.coda) out.push('Scrivi che cosa non va: la descrizione è obbligatoria.');
      if (blocca === null) out.push('Dicci se con questo difetto il presidio si può usare.');
      if (pezzi) { const e = pezzi.errore(); if (e) out.push(e); }
      return out;
    },
    valori() {
      return {
        descrizione: an ? S.ricomponiDescrizione(an.descrizione, fDescr.value) : fDescr.value.trim(),
        bloccante: blocca === null ? '' : (blocca ? '1' : '0'),
        gravita: fGravita.valore,
        azione_proposta: fAzione.value.trim(),
        quantita_ko: pezzi ? pezzi.valore() : null,
      };
    },
  };
}
