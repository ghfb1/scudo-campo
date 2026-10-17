/**
 * Scudo Campo — le righe del PRESIDIO nella scheda che si apre toccandolo sulla
 * mappa (06/10/2026).
 *
 * Richiesta dell'operatore: «quando sulla mappa clicchiamo su un presidio, ce lo
 * dà con nessun difetto rilevato anche se ci sono anomalie. Inoltre dovrebbe
 * mostrare le note come le abbiamo inserite (gli "a capo" vanno rispettati), e
 * anche se un estintore è carrellato o meno».
 *
 * Un modulo a sé perché la scheda sta in `app.js`, che avvia l'applicazione
 * appena viene importato e non si può costruire in una prova: queste righe sì.
 */

import { dataIt, el, tag } from './ui.js';
import * as S from './stato.js';
import { riassuntoAnomalia } from './anomalia_testo.js';
import { CAMPI_NON_A_SCHERMO, notaMarcatore, valoreLeggibile } from './campi.js';
import { etichettaEsito, frasScadenza } from './controllo.js';

/**
 * Un codice di scelta a parole: nel catalogo le opzioni sono solo codici
 * («POLVERE», «REI_120», «VERSO_ESODO»). Le eccezioni dove la regola generica
 * («REI 120», «Polvere») non basta stanno qui.
 */
export const CODICI_A_PAROLE = {
  CARRELLATO: 'Carrellato (su ruote)',
  FISSA: 'Fissa (bombola a servizio di un impianto)',
  USCITA_SICUREZZA: 'Uscita di sicurezza',
  VERSO_ESODO: "Nel verso dell'esodo",
  CONTRARIO_ESODO: "Contro il verso dell'esodo",
  INOX_ALLUMINIO: 'Inox o alluminio',
};

export function codiceAParole(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (CODICI_A_PAROLE[s]) return CODICI_A_PAROLE[s];
  // Sigle che si scrivono così: CO2, REI 120.
  if (/^[A-Z]{2,4}\d+$/.test(s)) return s;
  if (/^REI_\d+$/.test(s)) return s.replace('_', ' ');
  if (!/^[A-Z0-9_]+$/.test(s)) return s;
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Per compatibilità con chi la importa già: il tipo di installazione a parole. */
export function installazioneAParole(a) {
  return codiceAParole(a && a.installazione);
}

/**
 * I dati PROPRI della categoria del presidio, a parole: i campi che il catalogo
 * dichiara per quella categoria (`categorie`), solo quelli compilati.
 *
 * ⛔ Dalla categoria e non da un elenco scritto qui (06/10/2026, dall'operatore:
 * «il tipo di installazione dell'estintore, oppure per le uscite di sicurezza gli
 * altri dati utili, vanno sotto la categoria; deve essere visibile anche
 * l'estinguente»). Estintore: estinguente, carica, installazione, serbatoio,
 * revisione…; uscita di sicurezza: tipologia, ante, dotazione, verso di apertura.
 * Un campo nuovo del catalogo compare da sé, nella categoria giusta.
 */
export function datiDellaCategoria(a) {
  if (!a) return [];
  const dati = S.campiPerCategoria(a.categoria_codice)
    .filter((c) => Array.isArray(c.categorie) && c.categorie.length)
    // L'ubicazione del vecchio censimento clima resta nel dato, non qui (17/10/2026).
    .filter((c) => !CAMPI_NON_A_SCHERMO.has(c.nome))
    .map((c) => {
      const grezzo = a[c.nome];
      if (grezzo === null || grezzo === undefined || String(grezzo).trim() === '') return null;
      let valore;
      if (c.tipo === 'scelta') valore = codiceAParole(grezzo);
      else if (c.nome === 'carica_kg' || c.nome === 'carica_refrigerante_kg') valore = `${String(grezzo).replace('.', ',')} kg`;
      else if (c.nome === 'tco2eq') valore = `${String(grezzo).replace('.', ',')} t`;
      else valore = valoreLeggibile(c, grezzo, a);
      // Le potenze del climatizzatore anche in BTU/h (09/10/2026, dall'operatore:
      // «fare anche la conversione per ricavare i btu dai dati che abbiamo»): è
      // la misura con cui si chiamano in commercio, «un 9000». Solo da leggere.
      // «(kg)» resta nel valore, non nell'etichetta: «Carica: 6 kg».
      return valore ? { etichetta: c.etichetta.replace(/\s*\((kg|kW|m|mm|bar)\)$/, ''), valore } : null;
    })
    .filter(Boolean);
  // Un climatizzatore SENZA potenza lo dice (09/10/2026): saltare la riga
  // faceva cercare i BTU che non c'erano, e il motivo — nessuna fonte riporta
  // la potenza resa — non si leggeva da nessuna parte.
  const cat = S.categoriaDi(a);
  if (cat && cat.tipo_asset_codice === 'CLIMATIZZATORE' && !String(a.potenza_frigorifera_kw ?? '').trim()) {
    dati.splice(Math.min(1, dati.length), 0, { etichetta: 'Potenza frigorifera resa',
      valore: 'non indicata: BTU/h non calcolabili (leggila sulla targhetta, in kW o BTU/h)' });
  }
  return dati;
}

/**
 * La voce «Categoria» del presidio: il nome della categoria e, sotto, i suoi dati.
 */
export function voceCategoria(a, nomeCategoria) {
  const dati = datiDellaCategoria(a);
  return el('div', { class: 'scheda-voce' }, [
    el('div', { class: 'scheda-voce-etichetta', testo: 'Categoria' }),
    el('div', { class: 'scheda-voce-valore', testo: nomeCategoria || (a && a.categoria_codice) || '' }),
    dati.length ? el('dl', { class: 'dati dati-categoria' }, dati.flatMap((d) => [
      el('dt', { testo: d.etichetta }),
      el('dd', { testo: d.valore }),
    ])) : null,
  ]);
}

function voce(etichetta, valore, classe = '') {
  return el('div', { class: 'scheda-voce' }, [
    el('div', { class: 'scheda-voce-etichetta', testo: etichetta }),
    typeof valore === 'string'
      ? el('div', { class: `scheda-voce-valore ${classe}`.trim(), testo: valore })
      : valore,
  ]);
}

/**
 * Le righe in più per un presidio, sotto «Dove»: anomalie aperte, note. (I dati
 * della categoria stanno in `voceCategoria`, sotto il nome della categoria.)
 *
 * ⛔ Le anomalie aperte si ELENCANO, con la risposta a «si può usare?». La
 * pastiglia dell'idoneità dice quante sono; chi apre la scheda sulla mappa vuole
 * sapere quali, e se il pezzo si può usare lo stesso.
 *
 * ⛔ Le note con i loro a capo (`testo-a-capo`, `white-space: pre-wrap`): un
 * elenco scritto su più righe, stampato su una riga sola, diventa un muro di
 * testo in cui non si capisce dove finisce una voce e comincia l'altra.
 */
export function righePresidioMappa(a) {
  if (!a) return [];
  const righe = [];
  const aperte = S.anomalieDi(a.id);
  if (aperte.length) {
    righe.push(voce(`Anomalie aperte (${aperte.length})`, el('ul', { class: 'scheda-anomalie' },
      aperte.map((an) => {
        const r = riassuntoAnomalia(an);
        const blocca = S.anomaliaBlocca(an);
        return el('li', {}, [
          el('span', { class: 'testo-a-capo', testo: r.titolo }),
          el('span', {
            class: `tag ${blocca ? 'tag-rosso' : 'tag-ambra'}`, style: 'margin-left:6px',
            testo: blocca ? '✕ impedisce l\'uso' : '! si può usare',
          }),
        ]);
      }))));
  }
  const note = String(a.note || '').trim();
  if (note) righe.push(voce('Note', note, 'testo-a-capo'));
  return righe;
}

/**
 * Un presidio NON INDIVIDUATO nell'ultimo controllo non è «idoneo, verifiche in
 * regola» (09/10/2026, dall'operatore su UISUV-260: «non è stato trovato e quindi
 * verificato, ma se ci clicchiamo dal presidio o dalla mappa dice idoneo, verifiche
 * in regola, niente da fare in questo giro, come se non ci fossero stati problemi»).
 *
 * L'idoneità resta quella dell'ultimo controllo ESEGUITO — è la regola gemella con
 * l'ufficio, e non cambia —: cambia quello che si scrive in testa alla scheda,
 * perché da allora nessuno ha visto il pezzo. `null` se il presidio è stato trovato.
 */
export function statoNonIndividuato(a) {
  const iv = a && S.ultimoNonIndividuato(a.id);
  if (!iv) return null;
  const d = String(iv.data || '').slice(0, 10).split('-').reverse().join('/');
  return {
    idoneita: `⚠ non individuato il ${d}: non si sa se si può usare`,
    verifiche: '⚠ da cercare: il controllo va rifatto',
  };
}


// --------------------------------------------------------------------------- //
// Il popup del presidio sulla mappa, riordinato (12/10/2026)
// --------------------------------------------------------------------------- //
//
// Dall'operatore: «il popup che si apre deve mostrare anche la quantità, data
// costruzione/installazione/etc., ultima revisione o ultime verifiche. I dati
// devono essere mostrati in modo migliore, più facili da consultare anche da
// mobile».
//
// Prima ogni dato era una voce a sé, etichetta sopra e valore sotto: dieci voci
// erano due schermate di telefono, e la quantità, le date del pezzo e i
// controlli fatti non c'erano. Adesso:
//  * «Il pezzo»: una GRIGLIA a due colonne, etichetta corta a sinistra e valore a
//    destra, che su un telefono sta in mezza schermata;
//  * «Controlli»: la prossima scadenza in evidenza, poi un riquadro per ogni
//    controllo del presidio — l'ultimo registrato (data ed esito) e il prossimo.
// Le date senza valore si scrivono «—»: chi cerca l'anno di costruzione e non lo
// trova deve sapere che manca il dato, non chiedersi se la riga esiste.

/** Le date del pezzo, nell'ordine in cui si leggono sull'etichetta e nel libretto. */
export const DATE_DEL_PEZZO = ['anno_costruzione', 'data_installazione', 'data_messa_servizio'];

/** «1 pz», «5 pz · 2 guasti». */
export function quantitaAParole(a) {
  const q = Number(String(a.quantita ?? '').replace(',', '.'));
  const n = Number.isFinite(q) && q > 0 ? q : 1;
  const ko = Number(a.quantita_ko || 0);
  return `${n} pz${ko > 0 ? ` · ${ko} guast${ko === 1 ? 'o' : 'i'}` : ''}`;
}

/**
 * Le righe di «Il pezzo»: `[{ etichetta, valore, nota?, vuoto? }]`.
 * Categoria e i suoi dati (estinguente, carica, installazione…), progressivo,
 * matricola, marca e modello, quantità, date, dove.
 */
export function righeDelPezzo(a, nomeCategoria = '') {
  if (!a) return [];
  const cat = S.categoriaDi(a);
  const campi = S.campiPerCategoria(a.categoria_codice);
  const righe = [];
  const metti = (etichetta, valore, extra = {}) => {
    const v = String(valore ?? '').trim();
    righe.push({ etichetta, valore: v || '—', vuoto: !v, ...extra });
  };
  // Progressivo e matricola SUBITO dopo la categoria: sono i due numeri che si
  // confrontano con quello che si ha davanti (visto a 390 px: dopo i dati della
  // categoria scivolavano a metà schermo).
  metti('Categoria', nomeCategoria || (cat && cat.descrizione) || a.categoria_codice);
  metti('Progressivo Terna', a.identificativo);
  metti('Matricola', a.matricola);
  // Marca PRIMA del modello (09/10/2026): «Daikin REYQ18U7Y1B» si riconosce.
  // Per un climatizzatore sono quelli dell'unità esterna, come in ClimaTrack.
  metti(cat && cat.tipo_asset_codice === 'CLIMATIZZATORE' ? 'Marca e modello (unità esterna)' : 'Marca e modello',
    [a.marca, a.modello].filter(Boolean).join(' '));
  metti('Quantità', quantitaAParole(a));
  for (const d of datiDellaCategoria(a)) righe.push({ etichetta: d.etichetta, valore: d.valore });
  for (const nome of DATE_DEL_PEZZO) {
    const c = campi.find((x) => x.nome === nome);
    if (!c) continue;   // la tipologia non ha questa data: niente riga
    const leggibile = valoreLeggibile(c, a[nome], a);
    metti(c.etichetta, leggibile, { nota: leggibile !== null ? notaMarcatore(c, a, campi) : null });
  }
  // Per un climatizzatore il «Dove» è solo quello a livelli (impianto › area ›
  // ubicazione, 17/10/2026): un testo libero accanto viene dal vecchio censimento
  // e, dall'operatore, «ci confonde». Per gli altri presidi resta com'era.
  const clima = cat && cat.tipo_asset_codice === 'CLIMATIZZATORE';
  metti('Dove', S.ubicazione(clima ? { ...a, ubicazione_testo: '' } : a));
  return righe;
}

/**
 * La prossima scadenza in breve, per la riga di un controllo: «01/01/2033 · in
 * regola», «16/10/2026 · fra 3 giorni», «10/10/2026 · scaduta da 2 giorni».
 * La frase lunga di `frasScadenza` («IN REGOLA — PROSSIMA SCADENZA IL …»), in
 * una pastiglia accanto a «Prossimo», andava a capo da sola (visto a 390 px).
 */
export function prossimaInBreve(dataIso) {
  const gg = S.giorniResidui(dataIso);
  const d = dataIt(dataIso);
  if (gg === null) return { testo: d, classe: '' };
  if (gg < 0) return { testo: `${d} · scaduta da ${-gg} giorn${gg === -1 ? 'o' : 'i'}`, classe: 'tag-rosso' };
  if (gg === 0) return { testo: `${d} · scade oggi`, classe: 'tag-ambra' };
  if (S.semaforo(dataIso) === 'IN_SCADENZA') return { testo: `${d} · fra ${gg} giorn${gg === 1 ? 'o' : 'i'}`, classe: 'tag-ambra' };
  return { testo: `${d} · in regola`, classe: 'tag-verde' };
}

/**
 * I controlli del presidio: `[{ nome, codice, ultimo, prossima }]`.
 * `ultimo` = l'ultimo REGISTRATO di quel tipo (`{ data, esito }`, qualunque esito:
 * un «non accessibile» del mese scorso è proprio quello che si vuole sapere),
 * `prossima` = la scadenza (`{ data, testo, classe }`), o null.
 */
export function controlliDelPezzo(a) {
  if (!a) return [];
  const registrati = S.interventiDi(a.id).filter((i) => !i.eliminato_il);
  return S.controlliApplicabili(a).map((t) => {
    const u = registrati.find((i) => i.tipo_controllo_codice === t.codice);
    // ⛔ Dopo un controllo fatto in campo la scadenza aperta si chiude, e la
    // prossima la calcola l'app con la regola dell'ufficio (`prossima_calcolata`,
    // la stessa che usa la scheda del presidio). Senza, un semestrale fatto il
    // 25/09 diceva «nessuna scadenza calcolata» (visto nel browser).
    const data = t.scadenza || t.prossima_calcolata || '';
    const f = data ? prossimaInBreve(data) : null;
    const tc = S.indici.tipiControllo.get(t.codice) || {};
    return {
      codice: t.codice,
      nome: t.descrizione,
      // La sorveglianza (`genera_scadenza = 0`) ha una periodicità per chi è sul
      // posto ma in ufficio non diventa una scadenza: non va nel riquadro.
      generaScadenza: String(tc.genera_scadenza ?? '1') !== '0',
      ultimo: u ? { data: String(u.data || '').slice(0, 10), esito: u.esito } : null,
      prossima: f ? { data, testo: f.testo, classe: f.classe, calcolata: !t.scadenza } : null,
    };
  })
    // Il più urgente in cima; quelli senza scadenza in fondo.
    .sort((x, y) => (x.prossima ? x.prossima.data : '9999').localeCompare(y.prossima ? y.prossima.data : '9999'));
}

/** La griglia etichetta | valore. */
export function grigliaDati(righe) {
  return el('dl', { class: 'scheda-griglia' }, righe.flatMap((r) => [
    el('dt', { testo: r.etichetta }),
    el('dd', { class: r.vuoto ? 'mancante' : '' }, [
      el('span', { testo: r.valore }),
      r.nota ? el('div', { class: 'mini', testo: r.nota }) : null,
    ].filter(Boolean)),
  ]));
}

/**
 * Il corpo del popup per un PRESIDIO, sotto le pastiglie dello stato: «Il pezzo»,
 * «Controlli», poi anomalie aperte e note (`righePresidioMappa`).
 */
export function vistaPresidioMappa(a, nomeCategoria = '') {
  if (!a) return el('div', {});
  const controlli = controlliDelPezzo(a);
  // ⛔ La prima prossima scadenza fra TUTTI i controlli, comprese quelle
  // calcolate dopo un controllo fatto in campo: prendendo solo le scadenze
  // aperte (`S.scadenzeDi`) il riquadro diceva 01/01/2028 sopra un semestrale
  // che tornava a marzo (visto nel browser). Il nome è quello del piano.
  const primo = controlli.find((c) => c.prossima && c.generaScadenza) || null;
  return el('div', { class: 'scheda-presidio-mappa' }, [
    el('h3', { class: 'scheda-sezione', testo: 'Il pezzo' }),
    grigliaDati(righeDelPezzo(a, nomeCategoria)),
    el('h3', { class: 'scheda-sezione', testo: 'Controlli' }),
    // Con il PIANO (09/10/2026): su un climatizzatore la pulizia dei filtri e il
    // controllo F-Gas scadono in mesi diversi, e una data da sola non dice quale.
    primo ? el('div', { class: 'scheda-prossima' }, [
      el('div', { class: 'mini', testo: 'Prossima scadenza' }),
      el('div', { style: 'font-weight:600', testo: `${dataIt(primo.prossima.data)} · ${primo.nome}` }),
      tag(frasScadenza(primo.prossima.data).testo, frasScadenza(primo.prossima.data).classe),
    ]) : null,
    controlli.length ? el('ul', { class: 'scheda-controlli' }, controlli.map((c) => el('li', {}, [
      el('div', { class: 'scheda-controllo-nome', testo: c.nome }),
      el('div', { class: 'scheda-controllo-riga' }, [
        el('span', { class: 'mini', testo: 'Ultimo ' }),
        el('span', { testo: c.ultimo ? `${dataIt(c.ultimo.data)} · ${etichettaEsito(c.ultimo.esito)}` : 'mai registrato' }),
      ]),
      el('div', { class: 'scheda-controllo-riga' }, [
        el('span', { class: 'mini', testo: 'Prossimo ' }),
        c.prossima ? tag(c.prossima.testo, c.prossima.classe) : el('span', { testo: 'nessuna scadenza calcolata' }),
      ]),
      c.prossima && c.prossima.calcolata
        ? el('div', { class: 'mini', testo: "calcolata dall'ultimo controllo" }) : null,
    ].filter(Boolean)))) : el('div', { class: 'mini', testo: 'Nessun controllo previsto per questo presidio.' }),
    ...righePresidioMappa(a),
  ].filter(Boolean));
}
