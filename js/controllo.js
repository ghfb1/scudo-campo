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
 * Quindi: le spunte dicono CHE COSA HO FATTO, l'esito dice COM'È ANDATA. Su non
 * conforme le verifiche non spuntate finiscono nella descrizione dell'anomalia,
 * già scritte — che è «l'operatore deve specificare che cosa non è stato fatto»
 * risolto senza farglielo ribattere su un telefono.
 */
import * as S from './stato.js';
import { GRAVITA } from './pacchetto.js';
import { avviso, campo, campoNumerico, dataIt, el, num, scelte, tag } from './ui.js';
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
  const ultima = CAL.ultimaEsecuzione([{ data: dataIso }, t.ultimo].filter(Boolean));
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
 */
export const MESI_FRA_UN_GIRO_E_L_ALTRO = 6;

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
export function rigaPianoDaEseguire(a, t, { onEsito, onRipeti, onVedi,
  compatta = false, prossimo = false } = {}) {
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
    return el('div', { class: `piano-riga piano-riga-compatta ${tono}` }, [
      el('button', {
        class: 'piano-tocca', type: 'button',
        onclick: () => onEsito && onEsito(t, null),
      }, [
        el('span', { class: 'piano-corpo' }, intestazione),
        el('span', { class: 'voce-freccia', testo: '\u203a' }),
      ]),
    ]);
  }

  return el('div', { class: `piano-riga ${tono}` }, [
    ...intestazione,
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: t.ultimo
        ? `ultimo: ${dataIt(t.ultimo.data)}${t.ultimo.operatore_nome ? ` · ${t.ultimo.operatore_nome}` : ''}`
        : 'nessun controllo di questo tipo in archivio' }),

    st.chiave === 'NON_ESEGUITO'
      ? el('div', { class: 'piano-fatto piano-non-eseguito' }, [
        el('span', { class: 'piano-fatto-testo', testo: `! ${ultimoNelGiro ? etichettaEsito(ultimoNelGiro.esito).replace(/^\S+\s/, '').toLowerCase() : 'non eseguito'}`
          + `${ultimoNelGiro && ultimoNelGiro.data ? ` il ${dataIt(ultimoNelGiro.data)}` : ''} — va ancora eseguito` }),
        el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Vedi',
          onclick: () => ultimoNelGiro && onVedi && onVedi(ultimoNelGiro),
        }),
      ])
      : null,
    t.fatto_nel_giro && st.chiave !== 'NON_ESEGUITO'
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
          onclick: () => ultimoNelGiro && onVedi && onVedi(ultimoNelGiro),
        }),
        el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Rifai',
          onclick: () => onRipeti && onRipeti(t),
        }),
      ])
      : el('div', {}, [
        el('div', { class: 'piano-azioni' }, [
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
      testo: `${prossimi.length} non scadut${prossimi.length === 1 ? 'o' : 'i'}, ma in scadenza prima `
        + 'del prossimo giro. Farli adesso evita che il presidio resti non idoneo per mesi; '
        + 'lasciarli non richiede di registrare niente.' }));
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
 * Quindi: le spunte dicono CHE COSA HO FATTO; l'esito dice COM'È ANDATO. Su NON
 * CONFORME le verifiche non spuntate finiscono nella descrizione dell'anomalia,
 * già scritte — che è la richiesta «l'operatore deve specificare cosa non è
 * stato fatto», risolta senza farlo ribattere a mano.
 *
 * Il percorso più corto, che è quello che si percorre novanta volte su cento:
 * «Ho fatto tutte le N verifiche» → «Conforme». Due tocchi.
 */
export function corpoControlloPiano(a, t, esitoIniziale = null, azioniEsterne = {}) {
  const { registra: salva, avvisa, chiudi } = azioniEsterne;
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
  const fKo = campoNumerico({ min: 0, max: q, placeholder: `da 0 a ${q}` });

  // L'anno di costruzione, quando manca e un piano di FINE VITA si applica a questo
  // presidio (15/09/2026): la fine vita si conta da lì, e nessuno dei rivelatori in
  // archivio ce l'ha. Il controllo è il momento in cui l'etichetta è davanti agli
  // occhi; registrato una volta, il piano comincia a contare.
  const annoMassimo = new Date().getFullYear();
  const serveAnno = !String(a.anno_costruzione ?? '').trim()
    && S.controlliApplicabili(a).some((x) => x.codice === 'ROTTAMAZIONE' && x.piano_id);
  const fAnno = serveAnno
    ? campoNumerico({ min: 1950, max: annoMassimo, placeholder: 'Es. 2019' })
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
  const fTipoAn = scelte(
    tipiAnomalia.map((x) => ({ valore: x.codice, testo: x.descrizione })), '');
  const fDescr = el('textarea', { placeholder: 'Che cosa hai trovato' });

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

  const boxAnomalia = el('div', { class: 'box-anomalia', hidden: true }, [
    el('h3', { testo: "Che cosa non va", style: 'margin-top:0' }),
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: "Con esito non idoneo si apre un'anomalia: è quello che fa "
        + 'ricomparire il pezzo finché non è sistemato.' }),
    campo('Descrizione', fDescr,
      'Le verifiche che hai lasciato senza spunta vengono aggiunte da sole.'),
    campo('Che cosa ha', fTipoAn,
      'Facoltativo. Toccalo di nuovo per toglierlo. Serve a contare e a filtrare '
      + 'in ufficio, non a sostituire quello che hai scritto sopra.'),
    campo('Gravità', fGravita),
  ]);

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
  const anomalieAperte = (S.anomalieDi(a.id, false) || [])
    .filter((x) => ['APERTA', 'IN_CORSO'].includes(x.stato || 'APERTA'));
  const decisioni = new Map();          // anomalia id -> 'CHIUSA' | 'APERTA'
  const boxAnomalieAperte = el('div', { class: 'card card-piatta', hidden: true }, [
    el('h3', { style: 'margin-top:0', testo: anomalieAperte.length === 1
      ? "C'era un'anomalia aperta su questo presidio"
      : `C'erano ${anomalieAperte.length} anomalie aperte su questo presidio` }),
    el('div', { class: 'mini', style: 'margin-bottom:8px',
      testo: 'Per dichiararlo idoneo dicci di ognuna se il difetto c\'è ancora. '
        + 'Se c\'è ancora, l\'esito non può essere idoneo.' }),
    ...anomalieAperte.map((an) => {
      const scelta = el('div', { class: 'interruttore', role: 'group',
        'aria-label': `Anomalia: ${an.descrizione || 'senza descrizione'}` });
      const bottoni = [
        ['CHIUSA', '✓ Risolta, non c\'è più'],
        ['APERTA', '! C\'è ancora'],
      ].map(([valore, etichetta]) => el('button', {
        class: 'interruttore-voce', type: 'button', dataset: { valore },
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
      return el('div', { class: 'anomalia-decisione', style: 'margin-bottom:10px' }, [
        el('div', { style: 'font-weight:600', testo: an.descrizione || '(senza descrizione)' }),
        an.azione_proposta ? el('div', { class: 'mini', testo: `→ ${an.azione_proposta}` }) : null,
        scelta,
      ].filter(Boolean));
    }),
  ]);
  const avvisoAnomalie = el('div', { class: 'mini', style: 'color:var(--rosso);margin-top:6px' });
  boxAnomalieAperte.append(avvisoAnomalie);
  const mancantiAnomalie = () => anomalieAperte.filter((an) => !decisioni.has(an.id)).length;
  const ancoraPresenti = () => anomalieAperte.filter((an) => decisioni.get(an.id) === 'APERTA');

  function aggiorna() {
    const n = azioni.length;
    const f = fatte();
    // «idonee», non «fatte» (18/09/2026). Spuntare una voce è un GIUDIZIO — quella
    // verifica è andata bene — e «fatte» lo faceva leggere come «l'ho guardata»:
    // due cose diverse, e la seconda non decide niente.
    const nr = richieste().length;
    contatore.textContent = nr ? `${f} di ${nr} verifiche idonee`
      + (nr < n ? ` · ${n - nr} valgono solo in certi casi` : '') : '';
    btnTutte.textContent = n && mancanti() === 0
      ? 'Segna tutto non idoneo'
      : 'Segna tutte le verifiche come idonee';

    // La ragione per cui «Idoneo» è spento la decide la regola gemella
    // (`motivoRifiutoIdoneo`): spunte mancanti, pezzi guasti, anomalie ancora
    // presenti. Qui non se ne scrive una seconda — la frase che l'operatore legge
    // è la stessa che il server userebbe per rifiutare, ed è provata sui tre lati
    // da `test_idoneo_cross.py`. (Fino al 17/09/2026 la frase sulle anomalie era
    // scritta QUI, e quindi l'ufficio ne aveva una diversa per la stessa regola.)
    const rifiuto = S.motivoRifiutoIdoneo(
      'IDONEO', caselle.map((c) => ({ fatta: c.casella.checked ? 1 : 0,
        obbligatoria: obbligatoria(c.azione) ? 1 : 0 })),
      multiplo ? fKo.value : null, ancoraPresenti().length)
      || (anomalieAperte.length && mancantiAnomalie()
        ? `Prima dicci se ${mancantiAnomalie() === 1 ? "l'anomalia aperta c'è ancora" : `le ${mancantiAnomalie()} anomalie aperte ci sono ancora`}.`
        : null);
    const bloccato = Boolean(rifiuto);
    boxAnomalieAperte.hidden = anomalieAperte.length === 0 || partiNonEseguibile;
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

    if (esito === 'NON_IDONEO' && !fDescr.dataset.toccato) {
      const senza = caselle.filter((c) => !c.casella.checked).map((c) => c.azione.testo);
      fDescr.placeholder = senza.length
        ? `Che cosa hai trovato. Verranno aggiunte anche le ${senza.length} verifiche non spuntate.`
        : 'Che cosa hai trovato';
    }
  }
  fDescr.addEventListener('input', () => { fDescr.dataset.toccato = '1'; });
  fKo.addEventListener('input', aggiorna);

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
    const senzaSpunta = caselle.filter((c) => !c.casella.checked).map((c) => c.azione.testo);

    if (esito === 'NON_IDONEO' && !fDescr.value.trim() && !senzaSpunta.length) {
      avvisa("Scrivi che cosa hai trovato: un'anomalia senza descrizione non dice "
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
    // riscriverebbe a mano su un telefono.
    let descrizione = fDescr.value.trim();
    if (esito === 'NON_IDONEO' && senzaSpunta.length) {
      const elenco = `Verifiche non eseguite: ${senzaSpunta.join('; ')}.`;
      descrizione = descrizione ? `${descrizione} — ${elenco}` : elenco;
    }
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
      if (fKo.value === '') {
        avvisa(`Dicci quanti dei ${q} pezzi non funzionano: scrivi 0 se vanno tutti.`);
        fKo.focus();
        return;
      }
      ko = Number(fKo.value);
      if (ko < 0 || ko > q) {
        avvisa(`Il numero deve stare fra 0 e ${q}.`); return;
      }
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
        ? anomalieAperte.filter((an) => decisioni.get(an.id) === 'CHIUSA').map((an) => an.id)
        : [],
      descrizione: descrizione || undefined,
      gravita_anomalia: fGravita.valore,
      tipo_anomalia: fTipoAn.valore || undefined,
      anno_costruzione: anno,
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
          'Facoltativa. Le voci senza spunta finiscono comunque nell\'anomalia: '
          + 'qui si scrive quello che non entra in quell\'elenco.'),
      ])
      : avviso('Questo piano non ha un elenco di verifiche in archivio: registra '
        + "l'esito e, se serve, scrivi nelle note che cosa hai controllato.", 'avviso-blu'),

    fAnno ? el('div', { class: 'card card-piatta' }, [
      campo("Anno di costruzione (dall'etichetta)", fAnno,
        'Manca in archivio e serve a calcolare la fine vita. Lascialo vuoto se non si legge.'),
    ]) : null,

    // I pezzi guasti stanno QUI, sopra l'esito, e non in fondo dentro «Data, note,
    // documento» (16/09/2026): su una riga da dodici lampade sono il dato che
    // DECIDE l'esito — una bruciata e il controllo è fatto ma non idoneo — e in
    // fondo a un pannello chiuso non li compilava nessuno.
    multiplo
      ? el('div', { class: 'card card-piatta' }, [
        campo(`Su ${q} pezzi, quanti non funzionano?`, fKo,
          'Zero se funzionano tutti. Con almeno un pezzo guasto il controllo si '
          + 'registra lo stesso, ma non come idoneo.'
          + (koArchivio ? ` In archivio ne risultano ${koArchivio} guast${koArchivio === 1 ? 'o' : 'i'}: confermalo o correggilo.` : '')),
      ])
      : null,

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
        el('h3', { testo: `Verifiche: ${fatte} di ${d.azioni.length}`, style: 'margin-top:0' }),
        el('ul', { class: 'elenco-verbale' }, d.azioni.map((az) => el('li', {
          class: az.fatta === '1' ? 'fatta' : 'non-fatta',
        }, [
          el('span', { class: 'verbale-segno', testo: az.fatta === '1' ? '✓' : '✕' }),
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
      ? avviso(`Ha aperto un'anomalia: ${d.anomalia.descrizione}`, 'avviso-ambra')
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
