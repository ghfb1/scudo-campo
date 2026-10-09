/**
 * Lo SPAZIO che Scudo Campo occupa sul dispositivo, e se è troppo.
 *
 * Perché esiste (25/09/2026, richiesta dell'operatore: «nella pagina dati
 * dovremmo mostrare la dimensione dell'IndexedDB, così che se è troppo grande lo
 * capiamo, con indicazioni sulla grandezza massima»).
 *
 * Le misure le prende `store.misuraSpazio()`; qui si decide che cosa VOGLIONO
 * DIRE, in una funzione pura (`valutaSpazio`) che una prova può eseguire, e come
 * si mostrano (`bloccoSpazio`).
 *
 * I numeri di riferimento sono MISURATI, non stimati:
 *  * un rilievo appena caricato (pacchetto del 24/09/2026, 875 presidi) pesa
 *    2,7 MB; ogni evento del giornale circa 0,5 KB. ⚠️ Il giro completo NON si
 *    stima con i controlli di prova (idonei, senza anomalie né note: +3,3 KB
 *    l'uno, «8 MB» a fine giro — scritto così nella v137, e sbagliato): il
 *    pacchetto vero dell'operatore pesava 5,1 MB a 525 controlli su 1.516,
 *    cioè ~4,6 KB a controllo e ~10 MB a fine giro;
 *  * Chrome lascerebbe usare a un sito qualche GB (misurato: 10,7 GB). ⚠️ NON è
 *    spazio riservato né un limite da temere: è un TETTO per QUESTO sito
 *    (non per l'app), calcolato sul disco del telefono, lo stesso di foto e app.
 *    Chiamarlo «il limite vero» era fuorviante (25/09/2026, dall'operatore): con
 *    8 MB per un giro non ci si avvicina mai. Il rischio concreto è il telefono
 *    con la memoria piena;
 *  * su iPhone l'app aggiunta alla schermata Home e Safari hanno dati SEPARATI;
 *    su Android l'app installata e Chrome usano gli stessi;
 *  * `localStorage`, la copia di EMERGENZA, tiene circa 5,24 milioni di
 *    caratteri (misurato su Chrome; Safari è dello stesso ordine). Il rilievo
 *    appena caricato ne occupa già metà: un giro intero non ci sta.
 */
import { avviso, el } from './ui.js';

export const RILIEVO_APPENA_CARICATO_MB = 2.7;
export const GIRO_COMPLETO_MB = 10;
// Oltre tre giri interi il rilievo non è «grande»: c'è qualcosa che cresce e
// non dovrebbe (un giornale mai azzerato, un pacchetto caricato sopra l'altro).
export const RILIEVO_ANOMALO_MB = 3 * GIRO_COMPLETO_MB;
// Un po' sotto il misurato (5.242.308): il margine è per i browser che ne danno meno.
export const LIMITE_EMERGENZA_CARATTERI = 5000000;

const MB = 1024 * 1024;

/** «3,4 MB», «820 KB», «10,7 GB»: il numero con la virgola, come si legge. */
export function peso(byte) {
  if (byte == null || !Number.isFinite(byte)) return '—';
  const f = (x, cifre) => x.toFixed(cifre).replace('.', ',');
  if (byte >= 1024 * MB) return `${f(byte / (1024 * MB), 1)} GB`;
  if (byte >= MB) return `${f(byte / MB, 1)} MB`;
  if (byte >= 1024) return `${Math.round(byte / 1024)} KB`;
  return `${byte} byte`;
}

const percento = (parte, tutto) => (tutto ? Math.round((parte / tutto) * 100) : null);
/** «5,0 milioni di caratteri»: localStorage si conta in caratteri, non in byte. */
export const milioni = (n) => `${(n / 1e6).toFixed(1).replace('.', ',')} milioni di caratteri`;

/**
 * Che cosa dicono le misure. `livello`: 'verde' | 'ambra' | 'rosso'; `messaggio`
 * è la frase che decide, `righe` i numeri, `indicazioni` quanto è grande troppo.
 */
export function valutaSpazio(m) {
  const contenuto = (m.rilievo || 0) + (m.giornale || 0);
  const righe = [
    ['Rilievo salvato', m.rilievoCaratteri != null ? `${peso(m.rilievo)} · ${milioni(m.rilievoCaratteri)}` : peso(m.rilievo)],
    ['Giornale delle modifiche', m.eventi === 0 ? 'vuoto'
      : m.eventi == null ? peso(m.giornale) : `${peso(m.giornale)} · ${m.eventi} ${m.eventi === 1 ? 'evento' : 'eventi'}`],
  ];
  if (m.installata != null) {
    righe.unshift(['Aperta come', m.installata ? 'app installata sulla schermata Home' : 'pagina del browser']);
  }
  const quotaNota = m.uso != null && m.quota != null;
  if (quotaNota) {
    const p = percento(m.uso, m.quota);
    righe.push(['Occupato su disco (dati e app)', peso(m.uso)]);
    righe.push(['Tetto del browser per questo sito', `${peso(m.quota)} — non è spazio riservato (usato: ${p < 1 ? 'meno dell\'1%' : `${p}%`})`]);
  } else {
    righe.push(['Tetto del browser per questo sito', 'il browser non lo dice']);
  }
  if (m.persistente != null) {
    righe.push(['Conservazione', m.persistente
      ? 'garantita: il browser non cancella i dati da solo'
      : 'non garantita: se il telefono resta senza spazio il browser può cancellarli']);
  }

  const indicazioni = [
    `Un rilievo appena caricato pesa circa ${String(RILIEVO_APPENA_CARICATO_MB).replace('.', ',')} MB; `
      + `un giro completo arriva intorno a ${GIRO_COMPLETO_MB} MB.`,
    m.modalita === 'idb'
      ? 'Il tetto del browser è molto più grande di un giro e non è spazio riservato: è quanto il browser '
        + 'permetterebbe a Scudo Campo, sullo stesso disco di foto e app. Il rischio concreto è il telefono con la '
        + 'memoria piena, che può impedire i salvataggi: tienine libera. Se un giorno il sito arrivasse oltre metà del '
        + 'tetto, qui diventa giallo; oltre l\'80%, rosso.'
      : 'La copia di emergenza tiene al massimo circa 5 milioni di caratteri: un giro completo non ci sta.',
    'Su iPhone l\'app aggiunta alla schermata Home e Safari hanno dati SEPARATI: un rilievo aperto in una non si vede '
      + 'nell\'altra. Su Android l\'app installata e Chrome usano gli stessi dati.',
    ...(m.modalita === 'idb' ? ['La copia di emergenza tiene circa 5 milioni di caratteri e serve solo se il database '
      + 'non risponde all\'avvio. Da un terzo di giro il rilievo non ci sta più, ed è normale: il lavoro è nel database, '
      + 'e nel pacchetto esportato ogni sera.'] : []),
    'Per ridurlo: esporta il pacchetto, riportalo in ufficio e carica quello nuovo — il giornale riparte da zero.',
    // Visto nel browser (25/09/2026): Chrome scriveva 2,6 MB di rilievo in
    // 0,5 MB su disco. Senza questa riga i due numeri sembrano un errore.
    ...(quotaNota ? ['«Occupato su disco» è quello che il browser occupa davvero: può essere meno del rilievo, '
      + 'perché il browser lo comprime.'] : []),
  ];

  let livello = 'verde';
  let messaggio = 'Lo spazio va bene.';
  const alza = (l, msg) => {
    const ordine = { verde: 0, ambra: 1, rosso: 2 };
    if (ordine[l] > ordine[livello]) { livello = l; messaggio = msg; }
  };

  if (m.modalita === 'idb') {
    // ⛔ La copia di EMERGENZA, detta per quello che è (25/09/2026). Sull'iPhone
    // di prova, con il pacchetto parziale dell'operatore (5,1 MB), il riquadro
    // diceva in rosso «un salvataggio non è riuscito, esporta subito»: era la
    // copia di emergenza che non ci stava più, mentre il lavoro era salvato nel
    // database. Un allarme su una cosa sbagliata insegna a non credere agli allarmi.
    //
    // «Non ci sta» si decide dai CARATTERI, non solo dall'errore: l'errore vive
    // in memoria e riaprendo l'app si perde, e il riquadro — disegnato quando si
    // apre la scheda — diceva «non ancora scritta» per sempre (visto sull'iPhone
    // di prova, con l'app chiusa e riaperta).
    //
    // E non è un allarme: da un terzo di giro in poi è la condizione NORMALE.
    // Resta verde, e lo dice.
    const nonCiSta = Boolean(m.erroreEmergenza)
      || (!m.emergenzaCaratteri && m.rilievoCaratteri > LIMITE_EMERGENZA_CARATTERI);
    const riga = nonCiSta
      ? `non ci sta più: il rilievo${m.rilievoCaratteri != null ? ` (${milioni(m.rilievoCaratteri)})` : ''} supera i circa 5 milioni che tiene — il lavoro è nel database`
      : m.emergenzaCaratteri
        ? `aggiornata · ${milioni(m.emergenzaCaratteri)} su circa 5 milioni (${percento(m.emergenzaCaratteri, LIMITE_EMERGENZA_CARATTERI)}%)`
        : 'non ancora scritta (si scrive quando l\'app va in secondo piano)';
    righe.push(['Copia di emergenza', riga]);
    if (nonCiSta && livello === 'verde') {
      messaggio = 'Lo spazio va bene. Il lavoro è salvato nel database del browser; la copia di emergenza non ci sta '
        + 'più, ed è normale da un terzo di giro in poi.';
    }
  }
  if (m.modalita !== 'idb') {
    // La copia di emergenza: il limite si conta in caratteri.
    const p = percento(m.localStorage, LIMITE_EMERGENZA_CARATTERI);
    righe.unshift(['Copia di emergenza', `${(m.localStorage / 1e6).toFixed(1).replace('.', ',')} milioni di caratteri su circa 5 (${p}%)`]);
    if (p >= 80) alza('rosso', 'La copia di emergenza è quasi piena: i prossimi salvataggi possono non riuscire. Esporta subito il pacchetto.');
    else alza('ambra', 'Si sta usando la copia di emergenza, che non tiene un giro intero: esporta il pacchetto spesso.');
  }
  if (quotaNota) {
    const p = percento(m.uso, m.quota);
    if (p >= 80) alza('rosso', `Il sito usa l'${p}% del tetto del browser: i prossimi salvataggi possono non riuscire. Esporta il pacchetto.`);
    else if (p >= 50) alza('ambra', `Il sito usa il ${p}% del tetto del browser: esporta il pacchetto e ricomincia da uno nuovo.`);
  }
  if (contenuto > RILIEVO_ANOMALO_MB * MB) {
    alza('ambra', `Il rilievo pesa ${peso(contenuto)}, più di tre giri completi: qualcosa cresce e non dovrebbe. `
      + 'Esporta il pacchetto e ricomincia da uno nuovo.');
  }
  if (m.errore && /quota|space|spazio|exceed/i.test(m.errore)) {
    alza('rosso', `Un salvataggio non è riuscito per mancanza di spazio (${m.errore}). Esporta subito il pacchetto.`);
  }
  return { livello, messaggio, righe, indicazioni, contenuto };
}

/** Il riquadro della scheda Dati. */
export function bloccoSpazio(m) {
  const v = valutaSpazio(m);
  return el('div', { class: 'blocco-spazio' }, [
    el('h3', { testo: 'Spazio occupato sul dispositivo' }),
    avviso(v.messaggio, { verde: 'avviso-verde', ambra: 'avviso-ambra', rosso: 'avviso-rosso' }[v.livello]),
    el('dl', { class: 'dati', style: 'margin-top:8px' },
      v.righe.flatMap(([k, val]) => [el('dt', { testo: k }), el('dd', { testo: val })])),
    el('ul', { class: 'mini', style: 'margin:8px 0 0;padding-left:18px' },
      v.indicazioni.map((t) => el('li', { testo: t }))),
  ]);
}
