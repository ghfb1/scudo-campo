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

/** Da controllare / Controllati / Tutti: tre scelte ferme, ognuna con il suo numero. */
export const VISTE_GIRO = ['da', 'fatti', 'tutti'];

export function sceltaVistaGiro({ daFare, fatti, totale }, attiva, onCambia) {
  // Etichette corte (16/09/2026): «Da controllare» andava a capo su due righe e la
  // fascia diventava alta cento pixel. «Da fare / Fatti» sono le stesse parole del
  // pulsante accanto a ogni riga, quindi si leggono senza impararle due volte.
  const voci = [
    { chiave: 'da', etichetta: 'Da fare', n: daFare },
    { chiave: 'fatti', etichetta: 'Fatti', n: fatti },
    { chiave: 'tutti', etichetta: 'Tutti', n: totale },
  ];
  return el('div', { class: 'interruttore', role: 'group', 'aria-label': 'Quali presidi mostrare' },
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
export function bloccoAnomalie(anomalie, azioni = {}) {
  const aperte = (anomalie || []).filter((an) => ['APERTA', 'IN_CORSO'].includes(an.stato || 'APERTA'));
  if (!aperte.length) return null;
  return el('div', { class: 'blocco-anomalie' }, [
    el('h3', { class: 'blocco-anomalie-titolo', testo: `⚠️ ${aperte.length} anomali${aperte.length === 1 ? 'a aperta' : 'e aperte'}` }),
    el('ul', { class: 'elenco-anomalie' }, aperte.map((an) => rigaAnomalia(an, azioni))),
  ]);
}

function rigaAnomalia(an, { onRiconferma, onRisolta, onModifica }) {
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
  const gravita = an.gravita === 'ALTA' ? 'tag-rosso' : an.gravita === 'MEDIA' ? 'tag-ambra' : '';
  return el('li', { class: 'anomalia-aperta' }, [
    el('div', { class: 'anomalia-testo', testo: an.descrizione || '(senza descrizione)' }),
    an.azione_proposta ? el('div', { class: 'mini', testo: `→ ${an.azione_proposta}` }) : null,
    el('div', { class: 'voce-tag' }, [
      tag(an.gravita || '?', gravita),
      an.data_apertura ? tag(`aperta il ${dataIt(an.data_apertura)}`) : null,
      an.confermata_il ? tag(`✓ riconfermata il ${dataIt(an.confermata_il)}`, 'tag-blu') : null,
    ].filter(Boolean)),
    el('div', { class: 'anomalia-azioni' }, [
      el('button', { class: 'btn btn-piccolo', type: 'button', testo: '👁 Ancora presente',
        onclick: () => onRiconferma(an) }),
      el('button', { class: 'btn btn-piccolo', type: 'button', testo: '✔ Risolta…',
        onclick: () => { conferma.hidden = false; nota.focus(); } }),
      el('button', { class: 'btn btn-piccolo', type: 'button', testo: '✎ Modifica',
        onclick: () => onModifica(an) }),
    ]),
    conferma,
  ].filter(Boolean));
}
