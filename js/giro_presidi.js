/**
 * Scudo Campo — il lavoro del giro sull'elenco dei presidi: quanto manca, che cosa
 * guardare, e le anomalie del presidio a portata di pollice.
 *
 * Richiesta dell'operatore (14/09/2026): dal telefono deve essere semplice
 *  - vedere quanti presidi dell'impianto o della categoria scelti sono già
 *    controllati e quanti mancano (barra IN ALTO);
 *  - guardare solo quelli da controllare, solo quelli controllati, o tutti — e un
 *    presidio appena controllato sparisce dai «da controllare» senza ricaricare;
 *  - spostare un presidio fra «controllati in questo giro» e «da controllare»,
 *    anche all'indietro, con un tocco;
 *  - vedere subito le anomalie aperte del presidio e riconfermarle, chiuderle o
 *    modificarle senza passare da tre fogli.
 *
 * Modulo a sé (come `controllo.js`, `luoghi.js`): `app.js` non si costruisce in una
 * prova. Le azioni arrivano da fuori; qui c'è solo DOM.
 */
import { el, tag, dataIt } from './ui.js';
import { nodoTestoAnomalia, riassuntoAnomalia } from './anomalia_testo.js';

/**
 * La barra dell'avanzamento: numero E forma, perché la lunghezza di una barra con il
 * telefono in mano non si stima.
 */
export function barraGiro({ fatti, totale, ambito, compatta = false }) {
  const perc = totale ? Math.round((fatti / totale) * 100) : 0;
  const mancano = Math.max(0, totale - fatti);
  // In forma compatta (16/09/2026) è una riga sola sopra l'elenco: il numero, quanti
  // mancano e un filo di barra. La forma intera — con l'ambito e la barra grossa —
  // resta nel foglio «Filtri e avanzamento» e nel riepilogo. Su un telefono
  // l'intestazione fissa prendeva mezzo schermo, e la metà che restava era l'elenco.
  if (compatta) {
    return el('div', { class: 'barra-giro barra-giro-compatta', role: 'status',
      'aria-label': `${fatti} di ${totale} controllati, ${ambito}` }, [
      el('div', { class: 'barra-giro-testo' }, [
        el('b', { testo: `${fatti}/${totale}` }),
        el('span', { class: 'barra-giro-mancano',
          testo: totale ? (mancano ? ` · mancano ${mancano}` : ' · ✓ tutti fatti') : '' }),
        el('span', { class: 'barra-giro-ambito', testo: ambito }),
      ]),
      el('div', { class: 'avanzamento' }, [
        el('div', { class: 'avanzamento-riemp', style: `width:${perc}%` }),
      ]),
    ]);
  }
  return el('div', { class: 'barra-giro', role: 'status', 'aria-label': `${fatti} di ${totale} controllati, ${ambito}` }, [
    el('div', { class: 'barra-giro-testo' }, [
      el('b', { testo: `${fatti} di ${totale} controllati` }),
      el('span', { class: 'barra-giro-mancano', testo: totale ? (mancano ? ` · mancano ${mancano}` : ' · ✓ tutti fatti') : '' }),
      el('span', { class: 'barra-giro-ambito', testo: ambito }),
    ]),
    el('div', { class: 'avanzamento avanzamento-grande' }, [
      el('div', { class: 'avanzamento-riemp', style: `width:${perc}%` }),
    ]),
  ]);
}

/**
 * Da fare / Fatti / Sospesi / Tutti: scelte ferme, ognuna con il suo numero.
 * «Sospesi» dal 23/09/2026: i presidi con un controllo registrato come non
 * eseguibile — usciti dai da fare, ma non verificati (vedi `cerca`).
 */
export const VISTE_GIRO = ['da', 'fatti', 'sospesi', 'tutti'];

export function sceltaVistaGiro({ daFare, fatti, sospesi = 0, totale }, attiva, onCambia) {
  // Etichette corte (16/09/2026): «Da controllare» andava a capo su due righe e la
  // fascia diventava alta cento pixel. «Da fare / Fatti» sono le stesse parole del
  // pulsante accanto a ogni riga, quindi si leggono senza impararle due volte.
  const voci = [
    { chiave: 'da', etichetta: 'Da fare', n: daFare },
    { chiave: 'fatti', etichetta: 'Fatti', n: fatti },
    { chiave: 'sospesi', etichetta: 'Sospesi', n: sospesi },
    { chiave: 'tutti', etichetta: 'Tutti', n: totale },
  ];
  return el('div', { class: 'interruttore interruttore-giro', role: 'group', 'aria-label': 'Quali presidi mostrare' },
    voci.map((v) => el('button', {
      class: `interruttore-voce${attiva === v.chiave ? ' attiva' : ''}`,
      type: 'button', 'aria-pressed': String(attiva === v.chiave),
      onclick: () => onCambia(v.chiave),
    }, [
      el('span', { testo: v.etichetta }),
      el('span', { class: 'interruttore-n', testo: String(v.n) }),
    ])));
}

/**
 * Il pulsante accanto alla riga: sposta il presidio dall'altra parte.
 * Sta FUORI dal pulsante della riga — un pulsante dentro un pulsante, con i guanti,
 * si preme sempre sbagliato.
 *
 * Tre stati, non due (regola dell'operatore del 15/09/2026): «✓ fatto» compare solo
 * quando ogni voce da fare dei piani ha un esito idoneo o non idoneo. Finché ne manca
 * una il pulsante è «👁 esegui controllo» e porta ai controlli (`onEsegui`): un
 * «fatto» premuto su un presidio con i controlli ancora da eseguire toglieva dalla
 * lista di lavoro un pezzo mai guardato. Chi è già fatto torna indietro con «↩ da
 * fare», sempre.
 *
 * opzioni: { largo, mancanti (numero di voci da eseguire), onEsegui() }
 */
export function bottoneSegna(controllatoOra, onSegna, { largo = false, mancanti = 0, onEsegui } = {}) {
  const daEseguire = !controllatoOra && mancanti > 0;
  const azione = () => {
    if (daEseguire) { if (onEsegui) onEsegui(); return; }
    onSegna(controllatoOra ? 'da_controllare' : 'controllato');
  };
  const classe = controllatoOra ? 'segna-indietro' : (daEseguire ? 'segna-esegui' : 'segna-fatto');
  if (largo) {
    // Nella scheda c'è spazio per la frase intera: un «fatto» da solo, sotto i
    // tag, sembrava un'etichetta e non un pulsante.
    const testo = controllatoOra ? '↩ Rimetti fra i da controllare'
      : (daEseguire
        ? `👁 Esegui ${mancanti === 1 ? 'il controllo' : `i controlli`} (manca${mancanti === 1 ? '' : 'no'} ${mancanti})`
        : '✓ Segna controllato in questo giro');
    return el('button', {
      class: `btn btn-blocco btn-piccolo ${classe}`,
      type: 'button', style: 'margin:4px 0 8px', onclick: azione, testo,
    });
  }
  const [segno, parola, etichetta] = controllatoOra
    ? ['↩', 'da fare', 'Rimetti fra i da controllare']
    : (daEseguire
      ? ['👁', 'esegui controllo', `Esegui controllo: ${mancanti === 1 ? 'manca 1 voce' : `mancano ${mancanti} voci`}`]
      : ['✓', 'fatto', 'Segna controllato']);
  return el('button', {
    class: `btn btn-segna ${classe}`,
    type: 'button',
    'aria-label': etichetta,
    onclick: (e) => { if (e && e.stopPropagation) e.stopPropagation(); azione(); },
  }, [el('span', { 'aria-hidden': 'true', testo: segno }), el('span', { testo: parola })]);
}

/**
 * Le anomalie APERTE del presidio, in cima alla scheda, con le tre azioni.
 *
 * «Risolta» chiede un secondo tocco, con la nota facoltativa: chiudere
 * un'anomalia per sbaglio la fa sparire dagli elenchi, e il pezzo rotto con lei.
 *
 * azioni: { onRiconferma(an), onRisolta(an, nota), onModifica(an) }
 */
/**
 * Se offrire il controllo di GRUPPO su questo elenco.
 *
 * ⛔ Una funzione a sé perché la regola stava dentro `elencoPresidi`, che le
 * prove non possono costruire — e infatti la mutazione che la toglieva restava
 * VERDE. Adesso si può esercitare (21/09/2026).
 *
 * Il controllo di gruppo serve a un caso preciso: dodici lampade nello stesso
 * locale, dove farlo a una a una sono quarantotto tocchi. Fuori da quel caso è
 * dannoso — il modulo chiede quale PIANO si sta eseguendo, e i piani di un
 * estintore non sono quelli di una lampada.
 *
 * ⚠️ DUE condizioni insieme, e nessuna basta. Senza l'ubicazione il pulsante
 * compariva sull'elenco intero — ottocento presidi di dodici tipologie su
 * trenta impianti — cioè prometteva un'azione di gruppo su un gruppo che non
 * esiste. Senza l'unicità della categoria, un locale con tre lampade e un
 * estintore riproporrebbe lo stesso problema in piccolo.
 */
export function offriControlloDiGruppo(daFare, { localeId } = {}) {
  const lista = daFare || [];
  if (lista.length < 2) return false;
  if (!localeId) return false;
  return new Set(lista.map((x) => x.categoria_codice)).size === 1;
}

export function bloccoAnomalie(anomalie, azioni = {}) {
  const aperte = (anomalie || []).filter((an) => ['APERTA', 'IN_CORSO'].includes(an.stato || 'APERTA'));
  if (!aperte.length) return null;
  return el('div', { class: 'blocco-anomalie' }, [
    el('h3', { class: 'blocco-anomalie-titolo', testo: `⚠️ ${aperte.length} anomali${aperte.length === 1 ? 'a aperta' : 'e aperte'}` }),
    // `blocca` si chiede a chi chiama, una per anomalia: l'unico che conosce il
    // catalogo dei tipi è lo stato dell'app, e questo modulo non deve importarlo.
    el('ul', { class: 'elenco-anomalie' }, aperte.map((an) => rigaAnomalia(an, {
      ...azioni, blocca: azioni.blocca ? azioni.blocca(an) : undefined,
      giaRisposta: azioni.giaRisposta ? Boolean(azioni.giaRisposta(an)) : false,
      altre: aperte.filter((x) => x !== an),
    }))),
  ]);
}

function rigaAnomalia(an, { onRiconferma, onRisolta, onModifica, onDoppione, blocca, giaRisposta = false, altre = [] }) {
  // ⛔ «È un doppione» (25/09/2026, dall'operatore: «alcune anomalie sono state
  // segnate doppie»). Fino alla v139 lo stesso difetto su due piani apriva due
  // anomalie, e dal telefono l'unico modo di toglierne una era dichiararla
  // «risolta» — falso. Qui si ANNULLA, dicendo di quale è il doppione. Solo se
  // sul presidio ce n'è almeno un'altra aperta.
  const sceltaDoppione = onDoppione && altre.length ? el('div', { class: 'anomalia-doppione', hidden: true }, [
    el('div', { class: 'mini', style: 'margin:6px 0 4px', testo: 'Questa anomalia è il doppione di:' }),
    ...altre.map((x) => el('button', { class: 'btn btn-piccolo btn-blocco', type: 'button',
      testo: `⧉ ${riassuntoAnomalia(x).titolo}`, onclick: () => onDoppione(an, x) })),
    el('button', { class: 'btn btn-piccolo', type: 'button', testo: 'No',
      onclick: () => { sceltaDoppione.hidden = true; } }),
  ]) : null;
  const nota = el('input', { type: 'text', placeholder: 'Che cosa è stato fatto (facoltativo)', 'aria-label': 'Nota di chiusura' });
  const conferma = el('div', { class: 'anomalia-chiusura', hidden: true }, [
    nota,
    el('div', { class: 'riga', style: 'gap:6px;margin-top:6px' }, [
      el('button', { class: 'btn btn-ok', type: 'button', testo: '✔ Sì, è risolta',
        onclick: () => onRisolta(an, nota.value.trim()) }),
      el('button', { class: 'btn', type: 'button', testo: 'No',
        onclick: () => { conferma.hidden = true; } }),
    ]),
  ]);
  // ⚠️ `blocca` arriva da chi chiama e non si calcola qui: la regola vive in
  // `anomaliaBlocca` (stato.js) e una seconda copia diverge alla prima modifica.
  // `undefined` = non si sa, e allora non si scrive niente.
  const gravita = an.gravita === 'ALTA' ? 'tag-rosso' : an.gravita === 'MEDIA' ? 'tag-ambra' : '';
  let riapri = null;
  let domande = null;

  // ⛔ LE DUE RISPOSTE, non un pulsante solo (22/09/2026, segnalazione
  // dell'operatore: «quel box giallo per la conferma anomalia non ci dice se è
  // bloccante e non ce la fa nemmeno modificare — e per questo non ce lo fa
  // mettere idoneo»).
  //
  // Qui c'era «👁 Ancora presente», che chiamava `riconfermaAnomalia` SENZA la
  // risposta alla seconda domanda. Due effetti, ed erano quelli segnalati:
  //  1. `bloccante` restava vuoto, quindi valeva il default del TIPO — e 123
  //     anomalie aperte su 212 hanno un tipo che blocca;
  //  2. `confermata_il` veniva scritta lo stesso, e da quel momento la scheda
  //     del controllo non faceva più la domanda («si chiede una volta per
  //     giro»): la risposta non data diventava definitiva, e il presidio non si
  //     poteva più dichiarare idoneo per tutto il giro.
  //
  // Adesso si risponde qui, e si può CORREGGERE: le due risposte sono sempre
  // tutte e due premibili, e quella in vigore è evidenziata. Toccare l'altra la
  // cambia — è la stessa cosa che chiede l'operatore quando dice «se sbagliamo
  // dovremmo poter correggere».
  const risposta = el('div', { class: 'interruttore anomalia-blocca', role: 'group',
    'aria-label': `Questo difetto impedisce di usare il presidio? — ${riassuntoAnomalia(an).titolo}` });
  for (const [valore, etichetta] of [
    [false, "! Si può usare"],
    [true, "✕ Impedisce l'uso"],
  ]) {
    const attiva = blocca === valore;
    risposta.append(el('button', {
      // Giallo «si può usare», rosso «impedisce l'uso» (24/09/2026).
      class: `interruttore-voce ${valore ? 'tono-ko' : 'tono-attenzione'}${attiva ? ' attiva' : ''}`,
      type: 'button', 'aria-pressed': String(attiva),
      testo: etichetta,
      onclick: () => onRiconferma(an, valore),
    }));
  }

  return el('li', { class: 'anomalia-aperta' }, [
    // La nota dell'operatore in evidenza, l'elenco delle verifiche raccolto
    // (24/09/2026: vedi `anomalia_testo.js`).
    el('div', { class: 'anomalia-testo' }, [nodoTestoAnomalia(an)]),
    an.azione_proposta ? el('div', { class: 'mini', testo: `→ ${an.azione_proposta}` }) : null,
    el('div', { class: 'voce-tag' }, [
      tag(an.gravita || '?', gravita),
      an.data_apertura ? tag(`aperta il ${dataIt(an.data_apertura)}`) : null,
      an.confermata_il ? tag(`✓ riconfermata il ${dataIt(an.confermata_il)}`, 'tag-blu') : null,
      // ⛔ Se questo difetto impedisca di usare il presidio, scritto A PAROLE
      // (21/09/2026). Da questo giorno «idoneo con un'anomalia aperta» è un
      // esito legittimo e FREQUENTE — 87 presidi su 875 hanno solo difetti non
      // bloccanti — e senza questa riga si legge come una svista: chi guarda il
      // verbale in ufficio vedrebbe ✓ accanto a ⚠ e penserebbe a un errore.
      blocca === true ? tag("impedisce l'uso: niente IDONEO", 'tag-rosso')
        : blocca === false ? tag('si può usare: IDONEO possibile', 'tag-verde') : null,
    ].filter(Boolean)),
    // ⛔ GIÀ RISPOSTO in questo giro: un pulsante solo (24/09/2026, dall'operatore:
    // «dopo che clicchiamo su una delle scelte o la modifichiamo, appare sempre
    // come se dovessimo farla: serve un unico pulsante che le fa riapparire;
    // solo al prossimo pacchetto deve riproporle»). La risposta si legge nelle
    // etichette qui sopra («riconfermata il…», «si può usare…»); le domande
    // restano a un tocco, per correggere. Al giro dopo `confermataNelGiro` torna
    // falso e si richiede tutto.
    giaRisposta ? (riapri = el('button', {
      class: 'btn btn-piccolo btn-blocco anomalia-riapri', type: 'button',
      testo: '✎ Cambia la risposta o modificala',
      onclick: () => { riapri.hidden = true; domande.hidden = false; },
    })) : null,
    // La domanda per esteso sopra le due risposte: «bloccante» è una parola
    // nostra, e sullo schermo di chi ha il pezzo davanti deve diventare la
    // domanda che si sta facendo.
    (domande = el('div', { class: 'anomalia-domande', hidden: giaRisposta }, [
      el('div', { class: 'mini', style: 'margin-top:6px',
        testo: "C'è ancora? Dici se impedisce di usare il presidio:" }),
      risposta,
      el('div', { class: 'anomalia-azioni' }, [
        el('button', { class: 'btn btn-piccolo', type: 'button', testo: '✔ Risolta…',
          onclick: () => { conferma.hidden = false; nota.focus(); } }),
        el('button', { class: 'btn btn-piccolo', type: 'button', testo: '✎ Modifica',
          onclick: () => onModifica(an) }),
        sceltaDoppione ? el('button', { class: 'btn btn-piccolo', type: 'button', testo: '⧉ È un doppione…',
          onclick: () => { sceltaDoppione.hidden = false; } }) : null,
      ].filter(Boolean)),
      conferma,
      sceltaDoppione,
    ])),
  ].filter(Boolean));
}

/**
 * Gli STATI DI UN'ANOMALIA a parole (23/09/2026, dall'operatore: «se vado su
 * anomalie non si capisce cosa significa "in_corso"»).
 *
 * I codici restano quelli dei dati — APERTA, IN_CORSO, CHIUSA, ANNULLATA
 * viaggiano nel pacchetto e l'ufficio li legge così — e cambia solo quello che
 * si LEGGE, in un posto solo: filtri, riepilogo, elenco e scheda. «In corso»
 * non diceva che cosa fosse in corso; e soprattutto non diceva la cosa che
 * conta, cioè che un'anomalia «in lavorazione» è ancora APERTA — il presidio
 * resta com'è finché qualcuno non la chiude.
 */
export const STATI_ANOMALIA_A_PAROLE = {
  APERTA: { etichetta: 'Aperta', spiega: 'da sistemare, nessuno ci sta ancora lavorando' },
  IN_CORSO: { etichetta: 'In lavorazione', spiega: 'qualcuno la sta già sistemando; conta ancora fra le aperte' },
  CHIUSA: { etichetta: 'Chiusa', spiega: 'il difetto è sistemato' },
  ANNULLATA: { etichetta: 'Annullata', spiega: 'non era un difetto, o era registrata per errore' },
};

/** L'etichetta di uno stato d'anomalia; un codice sconosciuto si mostra com'è. */
export function statoAnomaliaAParole(codice) {
  const c = codice || 'APERTA';
  return (STATI_ANOMALIA_A_PAROLE[c] || {}).etichetta || c;
}

