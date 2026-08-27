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
import { avviso, campo, dataIt, el, num, scelte, tag } from './ui.js';
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
export function dividiPiani(controlli) {
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
  return {
    daFare: [...daFare, ...appenaFatti],
    inRegola: inRegola.filter((t) => !t.fatto_nel_giro),
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
export function rigaPianoDaEseguire(a, t, { onEsito, onRipeti, onVedi, compatta = false } = {}) {
  const azioni = t.azioni || [];
  const st = statoPiano(t);
  const ultimoNelGiro = t.fatto_nel_giro
    ? (S.interventiDi(a.id) || []).find((iv) => iv.tipo_controllo_codice === t.codice)
    : null;

  const tono = { FATTO: 'ok', SCADUTO: 'ko', IN_SCADENZA: 'attenzione',
    INDETERMINATO: 'attenzione', MAI: 'attenzione' }[st.chiave] || '';

  // La periodicità non verificata non è un'etichetta: è un asterisco, spiegato
  // una volta sola in fondo alla sezione. Ripetuta su ogni riga era rumore, e il
  // rumore insegna a non leggere nemmeno quello che conta.
  const daVerificare = !t.indeterminato && t.frequenza_valore && !t.verificata;
  const dettagli = [
    t.frequenza_testo ? `${t.frequenza_testo}${daVerificare ? ' *' : ''}` : null,
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

    t.fatto_nel_giro
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
      : el('div', { class: 'piano-azioni' }, [
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
  ]);
}

/**
 * La sezione «Esegui i controlli» per intero: quello che riguarda oggi, e il
 * resto dietro un interruttore.
 */
export function sezionePiani(a, controlli, azioni = {}) {
  const { daFare, inRegola } = dividiPiani(controlli);
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

  if (controlli.some((t) => !t.indeterminato && t.frequenza_valore && !t.verificata)) {
    box.append(el('div', { class: 'mini', style: 'margin-top:10px',
      testo: '* la periodicità non è ancora stata confrontata con il testo della '
        + 'norma: il numero viene dalle tabelle aziendali.' }));
  }
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

  let esito = esitoIniziale === 'NON_IDONEO' ? 'NON_IDONEO' : null;

  const caselle = [];
  const fatte = () => caselle.filter((c) => c.casella.checked).length;
  const mancanti = () => azioni.length - fatte();

  const fData = el('input', { type: 'date', value: S.oggiIso() });
  const fNote = el('textarea', { placeholder: 'Annotazioni del controllo' });
  const fAzione = el('input', { type: 'text', placeholder: 'Es. sostituito manometro' });
  const fDoc = el('input', { type: 'text', placeholder: 'Es. IS.3474684' });
  const fKo = el('input', { type: 'number', min: '0', max: String(q), inputmode: 'numeric',
    value: String(num(a.quantita_ko)) });

  const tipiAnomalia = [...(S.indici.tipiAnomalia || new Map()).values()]
    .filter((x) => Number(x.attivo ?? 1) === 1);
  const fGravita = scelte(GRAVITA.map((g) => ({ valore: g, testo: g.toLowerCase() })),
    gravitaSuggerita(a), { obbligatorio: true });
  // «Che cosa ha»: sedici voci, e scegliere una di esse porta con sé la gravità
  // che di solito le corrisponde. Era una tendina, ed era inservibile su un
  // telefono: la ruota di sistema copriva il foglio da cui era partita.
  const fTipoAn = scelte(
    tipiAnomalia.map((x) => ({ valore: x.codice, testo: x.descrizione })), '',
    { onCambia: (v) => {
      const x = tipiAnomalia.find((y) => y.codice === v);
      if (x && x.gravita_suggerita) { fGravita.valore = x.gravita_suggerita; fGravita.ridipingi(); }
    } });
  const fDescr = el('textarea', { placeholder: 'Che cosa hai trovato' });

  // --- checklist ----------------------------------------------------------- //
  const contatore = el('div', { class: 'checklist-conta' });
  const elencoAzioni = el('ul', { class: 'elenco-azioni' }, azioni.map((az) => {
    const c = el('input', { type: 'checkbox' });
    caselle.push({ casella: c, azione: az });
    c.addEventListener('change', () => aggiorna());
    return el('li', {}, [
      el('label', { class: 'casella casella-grande' }, [
        c, el('span', { class: 'casella-testo', testo: az.testo }),
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
    { valore: 'NON_ESEGUITO', testo: 'Non ho potuto eseguirlo' },
  ], 'NON_ACCESSIBILE', { obbligatorio: true, onCambia: (v) => { esito = v; } });
  const btnRegistraNonEseguito = el('button', {
    class: 'btn btn-blocco', type: 'button', testo: 'Registra come non eseguito',
  });
  const boxNonEseguito = el('div', { class: 'box-non-eseguito', hidden: true }, [
    campo('Che cosa è successo', selNonEseguito),
    campo('Perché non è stato possibile', fMotivoNo,
      'Lo legge chi dovrà tornarci: «bancali davanti alla cassetta» dice a chi '
      + 'organizza il prossimo giro che cosa spostare prima.'),
    btnRegistraNonEseguito,
  ]);
  const btnNonEseguito = el('button', {
    class: 'btn btn-piccolo btn-blocco', type: 'button',
    testo: 'Non sono riuscito a farlo…',
  });

  function aggiorna() {
    const n = azioni.length;
    const f = fatte();
    contatore.textContent = n ? `${f} di ${n} verifiche fatte` : '';
    btnTutte.textContent = n && mancanti() === 0
      ? 'Togli tutte le spunte'
      : `Ho fatto tutte le ${n} verifiche`;

    const bloccato = n > 0 && mancanti() > 0;
    btnConforme.disabled = bloccato;
    btnConforme.classList.toggle('btn-spento', bloccato);
    motivoConforme.textContent = bloccato
      ? `Per dichiarare idoneo mancano ${mancanti()} verifiche su ${n}. `
        + 'Spuntale, oppure registra non idoneo dicendo che cosa manca.'
      : '';

    btnConforme.classList.toggle('scelto', esito === 'IDONEO');
    btnNonConforme.classList.toggle('scelto', esito === 'NON_IDONEO');
    // Il secondo tocco deve dire che cosa farà: «Non conforme» premuto due
    // volte non si distingue da «Non conforme» premuto per sbaglio.
    btnNonConforme.lastChild.textContent = esito === 'NON_IDONEO'
      ? 'Registra non idoneo' : 'Non idoneo';
    boxAnomalia.hidden = esito !== 'NON_IDONEO';
    boxNonEseguito.hidden = !['NON_ESEGUITO', 'NON_ACCESSIBILE'].includes(esito);
    btnNonEseguito.hidden = boxNonEseguito.hidden === false;

    if (esito === 'NON_IDONEO' && !fDescr.dataset.toccato) {
      const senza = caselle.filter((c) => !c.casella.checked).map((c) => c.azione.testo);
      fDescr.placeholder = senza.length
        ? `Che cosa hai trovato. Verranno aggiunte anche le ${senza.length} verifiche non spuntate.`
        : 'Che cosa hai trovato';
    }
  }
  fDescr.addEventListener('input', () => { fDescr.dataset.toccato = '1'; });

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
    if (multiplo) {
      ko = fKo.value === '' ? null : Number(fKo.value);
      if (ko !== null && (ko < 0 || ko > q)) {
        avvisa(`Il numero deve stare fra 0 e ${q}.`); return;
      }
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
      descrizione: descrizione || undefined,
      gravita_anomalia: fGravita.valore,
      tipo_anomalia: fTipoAn.valore || undefined,
      azioni: caselle.map(({ casella, azione }, i) => ({
        azione_id: azione.id || null,
        ordine: Number(azione.ordine ?? i),
        testo: azione.testo,
        fatta: casella.checked ? 1 : 0,
      })),
    }, messaggioDi(esito, t, fData.value || S.oggiIso()));

    if (res) chiudi();
  }

  const corpo = el('div', {}, [
    el('div', { class: 'mini', testo: `${a.identificativo || a.codice} · ${S.ubicazione(a)}` }),
    el('div', { class: 'riga', style: 'gap:6px;margin:6px 0 2px' }, [
      t.frequenza_testo ? tag(t.frequenza_testo, 'tag-blu') : null,
      t.scadenza ? tag(frasScadenza(t.scadenza).testo, frasScadenza(t.scadenza).classe) : null,
    ].filter(Boolean)),

    azioni.length
      ? el('div', { class: 'card card-piatta' }, [
        el('h3', { testo: 'Che cosa verificare', style: 'margin-top:0' }),
        contatore,
        elencoAzioni,
        btnTutte,
      ])
      : avviso('Questo piano non ha un elenco di verifiche in archivio: registra '
        + "l'esito e, se serve, scrivi nelle note che cosa hai controllato.", 'avviso-blu'),

    el('h3', { testo: "Com'è andata" }),
    el('div', { class: 'azioni-esito' }, [btnConforme, btnNonConforme]),
    motivoConforme,
    boxAnomalia,
    btnNonEseguito,
    boxNonEseguito,

    el('details', { class: 'dettagli-extra' }, [
      el('summary', { testo: 'Data, note, documento' }),
      multiplo
        ? el('div', { class: 'campi campi-2' }, [
          campo('Data', fData),
          campo('Quanti non funzionano', fKo, `Questa riga vale ${q} pezzi.`),
        ])
        : campo('Data', fData),
      campo('Azione eseguita', fAzione),
      campo('Riferimento documento', fDoc),
      campo('Note', fNote),
    ]),

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
export function corpoRegistrazione(d, { annulla, chiudi, avvisa } = {}) {
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

    iv.note ? el('div', { class: 'mini', style: 'margin-top:8px', testo: `Note: ${iv.note}` }) : null,
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
