/**
 * Scudo Campo — la conferma prima di caricare un pacchetto.
 *
 * Perché esiste
 * -------------
 * Caricare un pacchetto SOSTITUISCE tutto quello che c'è sul dispositivo. Fino al
 * formato 3 lo si faceva al primo tocco: l'operatore sceglieva un file fra i
 * download — dove i pacchetti si chiamano tutti quasi uguali — e se era quello
 * sbagliato se ne accorgeva in cabina. Dal formato 4 l'ufficio scrive nel
 * pacchetto un CODICE che si può dettare al telefono, chi l'ha esportato, per
 * chi, per quale periodo, con quali note e su quali impianti lavorare: questo
 * foglio li mostra PRIMA di toccare i dati, e i dati si toccano solo dopo
 * «Carica e sostituisci».
 *
 * Perché un modulo a sé
 * ---------------------
 * Come `controllo.js` e `luoghi.js`: `app.js` apre IndexedDB appena viene
 * importato e non si può costruire in una prova. Le cose che hanno effetti —
 * leggere, aprire il foglio, chiuderlo, applicare — arrivano da fuori.
 *
 * La regola del foglio che chiede una decisione
 * ---------------------------------------------
 * Si risolve ANCHE quando lo si chiude toccando fuori, con la ✕ o con Esc, e
 * chiudere vale «Annulla». La `conferma()` di `ui.js` non lo faceva: la promessa
 * restava sospesa e il caricamento né partiva né finiva.
 */
import { el, tag, avviso, dataIt, dataOraIt } from './ui.js';
import { E, codicePacchetto } from './pacchetto.js';

const TRATTINO = '—';

function valore(v) {
  return v === null || v === undefined || String(v).trim() === '' ? '' : String(v).trim();
}

/**
 * Che cosa dire all'operatore di un pacchetto letto e valido.
 *
 * @param letto     { manifest, dati } come li produce `leggiPacchetto`
 * @param corrente  lo stato del dispositivo: { caricato, checksum, codice,
 *                  modificheNonEsportate }
 */
export function riepilogoPacchetto(letto, corrente = {}) {
  const m = (letto && letto.manifest) || {};
  const dati = (letto && letto.dati) || {};
  const assets = (dati[E.ASSET] || []).filter((a) => !a.eliminato_il);
  const impianti = (dati[E.IMPIANTO] || []).filter((i) => !i.eliminato_il);

  const presidi = new Map();
  for (const a of assets) presidi.set(a.impianto_id, (presidi.get(a.impianto_id) || 0) + 1);
  const nomi = new Map(impianti.map((i) => [i.id, i.denominazione || i.id]));

  // Un id previsto che il pacchetto non contiene si mostra lo stesso, con il suo
  // id: nasconderlo farebbe credere all'operatore che l'ufficio ne abbia
  // indicati meno.
  const previsti = (Array.isArray(m.impianti_previsti) ? m.impianti_previsti : [])
    .map((id) => ({
      id,
      nome: nomi.get(id) || String(id),
      presidi: presidi.get(id) || 0,
      trovato: nomi.has(id),
    }));

  const checksum = valore(m.checksum);
  const sessione = valore(m.sessione_id);
  const interventi = (dati[E.INTERVENTO] || []).filter(
    (i) => sessione && (i.sessione_id || '') === sessione);
  const controlliDelGiro = interventi.length;
  const presidiToccati = new Set(interventi.map((i) => i.asset_id).filter(Boolean));
  return {
    codice: valore(m.codice) || codicePacchetto(m.sessione_id),
    esportatoDa: valore(m.esportato_da),
    esportatoIl: valore(m.esportato_il),
    operatorePrevisto: valore(m.operatore_previsto),
    periodoDa: valore(m.periodo_da),
    periodoA: valore(m.periodo_a),
    note: valore(m.note_pacchetto),
    previsti,
    generatoIl: valore(m.generato_il),
    generatoDa: valore(m.generato_da),
    formato: valore(m.versione),
    impianti: impianti.length,
    presidi: assets.length,
    modificato: Boolean(m._modificato),
    stessoPacchetto: Boolean(corrente.caricato && checksum && corrente.checksum === checksum),
    modificheNonEsportate: Number(corrente.modificheNonEsportate) || 0,
    // ⭐ È un RILIEVO già iniziato, non un pacchetto dell'ufficio (19/09/2026).
    //
    // Prima il foglio non leggeva `origine` e mostrava un rilievo di campo come
    // se venisse dall'ufficio — stesso «esportato da», stesse note, stessi
    // impianti previsti, perché le chiavi dell'ufficio viaggiano invariate.
    // L'unico indizio era la riga «Generato il … · Scudo Campo», che non è
    // un'etichetta. Chi riceve deve sapere che sta prendendo in mano il lavoro
    // di un altro, perché caricare SOSTITUISCE quello che ha sul telefono.
    staffetta: valore(m.origine) === 'campo',
    consegne: Array.isArray(m.consegne) ? m.consegne : [],
    ultimoOperatore: valore(m.operatore),
    giroIniziatoIl: valore(m.giro_iniziato_il),
    giroStato: valore(m.giro_stato),
    giroNote: valore(m.giro_note),
    // Quanto lavoro c'è già dentro, contato dai DATI e non dal manifest.
    //
    // ⚠️ Solo i controlli di QUESTO giro: il pacchetto porta con sé tutto
    // l'archivio storico, e senza il filtro si direbbe «1104 controlli fatti».
    controlliDelGiro: controlliDelGiro,
    presidiToccati: presidiToccati.size,
    // I presidi che di questo giro non hanno ancora niente. Si dice «presidi» e
    // non «controlli» ed è una scelta: contare i controlli mancanti vorrebbe
    // dire far girare il motore dei piani su un archivio non ancora caricato, in
    // un foglio che deve aprirsi subito. Meglio un numero più povero e vero.
    presidiSenzaControllo: Math.max(assets.length - presidiToccati.size, 0),
  };
}

function periodo(r) {
  if (!r.periodoDa && !r.periodoA) return TRATTINO;
  return `${r.periodoDa ? dataIt(r.periodoDa) : '…'} → ${r.periodoA ? dataIt(r.periodoA) : '…'}`;
}

/**
 * Il contenuto del foglio. `decidi(true|false)` è l'unica uscita: i due pulsanti
 * la chiamano, e nient'altro in questo nodo cambia qualcosa.
 */
export function foglioConfermaPacchetto(r, decidi) {
  const esportato = r.esportatoDa || r.esportatoIl
    ? [r.esportatoDa || TRATTINO, r.esportatoIl ? ` · ${dataOraIt(r.esportatoIl)}` : ''].join('')
    : TRATTINO;

  const righe = [
    ['Esportato da', esportato],
    ['Operatore previsto', r.operatorePrevisto || TRATTINO],
    ['Periodo', periodo(r)],
    ['Contenuto', `${r.impianti} impianti · ${r.presidi} presidi`],
    ['Generato il', r.generatoIl ? `${dataOraIt(r.generatoIl)}${r.generatoDa ? ` · ${r.generatoDa}` : ''}` : TRATTINO],
  ];

  return el('div', { class: 'conferma-pacchetto' }, [
    el('div', { class: 'mini', testo: 'Codice del pacchetto' }),
    el('div', { class: 'codice-pacchetto mono', testo: r.codice || TRATTINO }),
    el('div', {
      class: 'mini', style: 'margin-bottom:10px',
      testo: r.codice
        ? "Controlla che sia il codice che ti ha dato l'ufficio."
        : 'Pacchetto senza codice: esportato da una versione precedente di Scudo.',
    }),

    // Gli avvisi che fanno cambiare idea stanno IN CIMA, prima dei dettagli:
    // in fondo al foglio, sotto l'elenco degli impianti, non li legge nessuno.
    //
    // ⛔ Con lavoro non esportato il carico è BLOCCATO (19/09/2026, decisione
    // dell'operatore). Prima era un avviso rosso con accanto il pulsante
    // premibile: è l'unico punto dell'app dove si perde una giornata di lavoro
    // con un tocco.
    r.modificheNonEsportate
      ? avviso(`Non si può caricare adesso: su questo dispositivo ci sono `
        + `${r.modificheNonEsportate} modifiche registrate e non ancora esportate. `
        + 'Caricare questo pacchetto le cancella, e non si recuperano. Esporta prima '
        + 'il tuo rilievo e mandalo a chi deve continuare, o in ufficio.', 'avviso-rosso')
      : null,
    r.stessoPacchetto
      ? avviso('Questo pacchetto è già caricato sul dispositivo: ricaricarlo riparte da capo.')
      : null,
    r.modificato
      ? avviso("Il pacchetto è stato modificato dopo l'esportazione da Scudo.", 'avviso-rosso')
      : null,

    // ⭐ «Questo è un rilievo già iniziato»: la sezione che prima non c'era.
    r.staffetta
      ? el('div', { class: 'avviso avviso-blu', style: 'margin-top:10px' }, [
        el('div', { style: 'font-weight:700', testo: "Non è un pacchetto dell'ufficio: è un rilievo già iniziato" }),
        el('div', { class: 'mini', style: 'margin-top:4px', testo: [
          r.giroIniziatoIl ? `Giro aperto il ${dataIt(r.giroIniziatoIl)}` : 'Giro già aperto',
          r.giroStato ? `· ${r.giroStato.toLowerCase().replace('_', ' ')}` : '',
        ].filter(Boolean).join(' ') }),
        r.consegne.length
          ? el('div', { style: 'margin-top:6px' }, [
            el('div', { class: 'mini', style: 'font-weight:600', testo: 'Chi ci ha lavorato prima' }),
            el('ul', { class: 'elenco-previsti' }, r.consegne.map((c) => el('li', { class: 'prevista' }, [
              el('span', { class: 'prevista-nome', testo: c.operatore || '(senza nome)' }),
              el('span', { class: 'mini', testo: [
                c.matricola ? ` · matr. ${c.matricola}` : '',
                c.consegnato_il ? ` · fino al ${dataIt(c.consegnato_il)}` : '',
                ` · ${Number(c.n_controlli) || 0} controlli`,
              ].join('') }),
            ])))])
          // Un pacchetto scritto da un'app precedente non porta la catena: si
          // dice quello che si sa, invece di lasciare un vuoto.
          : el('div', { class: 'mini', style: 'margin-top:6px', testo:
            `Chi ci ha lavorato prima: ${r.ultimoOperatore || 'non dichiarato'}`
            + " (l'app di chi te l'ha mandato non teneva l'elenco completo)." }),
        el('div', { class: 'mini', style: 'margin-top:6px', testo:
          `Risulta fatto: ${r.controlliDelGiro} controlli su ${r.presidiToccati} presidi. `
          + `Restano ${r.presidiSenzaControllo} presidi su ${r.presidi} senza nessun controllo di questo giro.` }),
        r.giroNote
          ? el('div', { class: 'mini', style: 'margin-top:6px', testo: `Note del giro: ${r.giroNote}` })
          : null,
        el('div', { class: 'mini', style: 'margin-top:6px', testo:
          'Continui il suo giro. I controlli che registri tu resteranno a tuo nome, e '
          + "alla fine il pacchetto torna in ufficio con il lavoro di tutti." }),
      ].filter(Boolean))
      : null,

    el('dl', { class: 'dati' }, righe.flatMap(([k, v]) => [el('dt', { testo: k }), el('dd', { testo: v })])),

    r.note
      ? el('div', { class: 'avviso avviso-blu', style: 'margin-top:10px' }, [
        el('div', { style: 'font-weight:700', testo: "Note dell'ufficio" }),
        el('div', { class: 'note-pacchetto', testo: r.note }),
      ])
      : null,

    el('h3', { style: 'margin:14px 0 6px', testo: `Impianti previsti (${r.previsti.length})` }),
    r.previsti.length
      ? el('ul', { class: 'elenco-previsti' }, r.previsti.map((p) => el('li', { class: 'prevista' }, [
        tag('★ previsto', 'tag-blu'),
        el('span', { class: 'prevista-nome', testo: ` ${p.nome}` }),
        el('span', {
          class: 'mini',
          testo: p.trovato ? ` · ${p.presidi} presid${p.presidi === 1 ? 'io' : 'i'}` : ' · non è nel pacchetto',
        }),
      ])))
      : el('div', {
        class: 'mini',
        testo: "Nessun impianto indicato dall'ufficio: il pacchetto li contiene tutti, senza priorità.",
      }),

    el('div', { class: 'riga riga-fine', style: 'margin-top:16px;gap:8px' }, [
      el('button', { class: 'btn', type: 'button', testo: 'Annulla', onclick: () => decidi('annulla') }),
      // Con lavoro in sospeso il pulsante di carico NON C'È, e al suo posto c'è
      // la via d'uscita: un pulsante presente e spento insegna a cercare il modo
      // di accenderlo.
      r.modificheNonEsportate
        ? el('button', {
          class: 'btn btn-primario', type: 'button', testo: 'Esporta il tuo rilievo',
          onclick: () => decidi('esporta'),
        })
        : el('button', {
          class: 'btn btn-primario', type: 'button',
          testo: r.staffetta ? 'Continua questo rilievo' : 'Carica e sostituisci',
          onclick: () => decidi('carica'),
        }),
    ]),
    r.modificheNonEsportate
      ? el('div', { class: 'mini', style: 'margin-top:8px', testo:
        'Se quel lavoro non serve più: scheda Dati → «Cancella il rilievo dal '
        + 'dispositivo», poi ricarica.' })
      : null,
  ].filter(Boolean));
}

/**
 * Apre il foglio e aspetta la decisione. `apri(titolo, nodo, allaChiusura)` e
 * `chiudi()` sono `apriSheetConChiusura` e `chiudiSheet` di `ui.js`.
 *
 * La decisione vale una volta sola: il pulsante decide e POI chiude, e la
 * chiusura richiama `allaChiusura`, che trova la promessa già risolta.
 */
export function chiediConfermaPacchetto(r, { apri, chiudi }) {
  return new Promise((resolve) => {
    let deciso = false;
    // Tre esiti veri, nessun `true` che significa due cose: 'carica', 'annulla',
    // 'esporta'. La chiusura senza pulsanti vale 'annulla'.
    const fine = (v) => { if (deciso) return; deciso = true; resolve(v); };
    const nodo = foglioConfermaPacchetto(r, (v) => { fine(v); chiudi(); });
    apri(r.staffetta ? `Continuare il rilievo di ${r.ultimoOperatore || 'un altro operatore'}?`
      : 'Caricare questo pacchetto?', nodo, () => fine('annulla'));
  });
}

/**
 * Lettura → validazione → conferma → SOLO ALLORA applicazione.
 *
 * L'ordine è la ragione di questa funzione: prima i dati del dispositivo si
 * cancellavano al primo tocco. `applica` non viene chiamata se il pacchetto non
 * è valido o se l'operatore annulla. Le eccezioni di `leggi` (file che non è un
 * pacchetto) risalgono a chi chiama, che le mostra.
 *
 * Esito: { esito: 'caricato' | 'annullato' | 'bloccato' | 'non_valido', ... }
 */
export async function caricaConConferma(bytes, { leggi, valida, corrente, chiedi, applica }) {
  const letto = await leggi(bytes);
  const errori = valida(letto.manifest, letto.dati);
  if (errori.length) return { esito: 'non_valido', errori, letto };
  const riepilogo = riepilogoPacchetto(letto, corrente ? corrente() : {});
  const scelta = await chiedi(riepilogo);
  // ⛔ La difesa vera sta QUI, non nel foglio: il foglio è interfaccia, e
  // l'interfaccia si cambia. Qualunque cosa abbia risposto, con lavoro non
  // esportato non si applica niente.
  if (riepilogo.modificheNonEsportate) {
    return { esito: 'bloccato', scelta, riepilogo, letto };
  }
  if (scelta !== 'carica' && scelta !== true) return { esito: 'annullato', riepilogo, letto };
  await applica(letto);
  return { esito: 'caricato', riepilogo, letto };
}
