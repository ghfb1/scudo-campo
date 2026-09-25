/**
 * Scudo Campo — l'anagrafica dei luoghi, ad albero.
 *
 * Perché un modulo a sé
 * ---------------------
 * Per la stessa ragione di `controllo.js`: in `app.js` non sarebbe eseguibile
 * fuori dal browser — quel file apre IndexedDB e avvia l'applicazione appena
 * viene importato — e una schermata che nessuna prova può costruire è una
 * schermata verificata solo guardandola. Qui dentro non c'è niente che tocchi il
 * browser oltre al DOM: le azioni che hanno effetti arrivano da fuori.
 *
 * Che cosa mostra, e che cosa NON è
 * ---------------------------------
 * Mostra i LUOGHI, non il lavoro. La differenza si vede su un edificio appena
 * creato e ancora vuoto: nell'albero del lavoro (`albero()` in `stato.js`, che
 * parte dai presidi) non esisterebbe, e chi lo ha appena creato penserebbe che
 * il salvataggio non abbia funzionato.
 *
 * Perché un albero e non un elenco piatto
 * ---------------------------------------
 * Perché la domanda che ci si pone qui è «che cosa c'è sotto questo impianto»,
 * e la risposta è una gerarchia. Ma un albero su un telefono ha un difetto suo:
 * espanso tutto è illeggibile. Quindi nasce **chiuso**, ogni nodo dice quanti
 * presidi contiene prima di aprirsi, e lo stato di apertura vive nel nodo — non
 * in una variabile globale che si porterebbe dietro l'albero di ieri.
 */
import { el, tag } from './ui.js';
import { indirizzoLeggibile, linkIndicazioni } from './ubicazione.js';

const ICONA = { impianto: '🏭', edificio: '🏢', locale: '🚪', orfani: '⚠️' };
// Come si chiamano i livelli A SCHERMO. Dal 15/09/2026, su richiesta dell'operatore,
// l'edificio si chiama «area» e il locale «ubicazione»: nel pacchetto, negli indici e
// nei nomi delle colonne restano `edificio` e `locale` (sono il formato scambiato con
// l'ufficio). Il genere cambia gli articoli — «nuova area», «quest'area» — e per
// questo le frasi stanno qui, intere, invece di comporsi da un nome.
export const NOMI_LUOGO = {
  impianto: { nome: 'impianto', plurale: 'impianti', nuovo: 'Nuovo impianto', questo: 'questo impianto', creato: 'Impianto creato.', della: "dell'impianto" },
  edificio: { nome: 'area', plurale: 'aree', nuovo: 'Nuova area', questo: "quest'area", creato: 'Area creata.', della: "dell'area" },
  locale: { nome: 'ubicazione', plurale: 'ubicazioni', nuovo: 'Nuova ubicazione', questo: 'questa ubicazione', creato: 'Ubicazione creata.', della: "dell'ubicazione" },
};
const NOME_TIPO = { impianto: 'impianto', edificio: NOMI_LUOGO.edificio.nome, locale: NOMI_LUOGO.locale.nome };
const FIGLIO_DI = { impianto: 'edificio', edificio: 'locale' };

/**
 * Un nodo e la sua discendenza.
 *
 * @param nodo    come lo produce `alberoUbicazioni()` in stato.js
 * @param azioni  { onCrea(tipoFiglio, nodoPadre), onRinomina(nodo), onApri(nodo),
 *                  onElimina(nodo), perchePuoi(nodo) }
 *                `perchePuoi` risponde `{ eliminabile, motivo, serveAdmin }`: la
 *                decide `app.js`, perché dipende dal giornale e dalla password —
 *                due cose che questo modulo non deve conoscere per restare
 *                eseguibile in una prova.
 * @param aperti  Set di id da mostrare già espansi (serve a riaprire dopo una
 *                modifica: senza, ogni salvataggio richiuderebbe l'albero e
 *                l'operatore ricomincerebbe da capo a ogni rinomina)
 */
export function nodoAlbero(nodo, azioni = {}, aperti = new Set()) {
  const { onCrea, onRinomina, onApri, onElimina, onDove, perchePuoi } = azioni;
  // Il rifiuto è un messaggio, non un silenzio: `onRifiuto` arriva da fuori come
  // tutto ciò che ha un effetto.
  const onRifiuto = azioni.onRifiuto || (() => {});
  const haFigli = nodo.figli && nodo.figli.length > 0;
  const chiave = `${nodo.tipo}:${nodo.id}`;
  let aperto = aperti.has(chiave);

  const figli = el('div', { class: 'albero-figli', hidden: !aperto },
    haFigli ? nodo.figli.map((f) => nodoAlbero(f, azioni, aperti)) : []);

  const freccia = el('span', {
    class: 'albero-freccia',
    testo: haFigli ? (aperto ? '▾' : '▸') : '·',
  });

  const apri = () => {
    if (!haFigli) return;
    aperto = !aperto;
    figli.hidden = !aperto;
    freccia.textContent = aperto ? '▾' : '▸';
    if (aperto) aperti.add(chiave); else aperti.delete(chiave);
  };

  // Il conteggio dei presidi PRIMA di aprire: è quello che fa decidere se vale
  // la pena. Un nodo vuoto lo dice, invece di aprirsi sul niente.
  const conteggio = nodo.presidi
    ? `${nodo.presidi} presid${nodo.presidi === 1 ? 'io' : 'i'}`
    : 'vuoto';

  // La posizione compare dove c'è, a qualunque livello. Dal 20/09/2026 anche
  // aree e ubicazioni possono averne una propria, presa col GPS stando sul
  // posto: su una stazione grande «l'impianto» è un recinto di ettari, e il
  // punto che serve è quello della cabina.
  //
  // ⚠️ Nessun `nodo.tipo === 'impianto'` qui: un nodo senza coordinate e senza
  // indirizzo non produce nessun link da sé, e il tipo era un guardiano che non
  // poteva fallire (misurato: toglierlo lasciava tutte le prove verdi). La
  // proprietà — un luogo senza posizione non offre indicazioni — resta fissata
  // da `test_luoghi_campo.mjs`, sui dati invece che su una guardia.
  const indicazioni = linkIndicazioni(nodo.riga);

  const testa = el('div', { class: `albero-nodo albero-${nodo.tipo}${nodo.previsto ? ' albero-previsto' : ''}` }, [
    el('button', {
      class: 'albero-tocca', type: 'button',
      'aria-expanded': haFigli ? String(aperto) : null,
      onclick: apri,
    }, [
      freccia,
      el('span', { class: 'albero-ico', testo: ICONA[nodo.tipo] || '📍' }),
      el('span', { class: 'albero-corpo' }, [
        el('div', { class: 'albero-nome', testo: nodo.nome }),
        // Simbolo E parola: una fascia colorata da sola non si legge contro luce.
        nodo.previsto ? tag('★ previsto', 'tag-blu') : null,
        // ⚠️ ROSSO: un obbligo di sito scaduto — un CPI, una prova di
        // evacuazione — non è meno grave di un presidio guasto. Senza il
        // certificato l'attività non è in regola, e il cartellino è l'unica
        // cosa che lo dice prima di aprire il foglio.
        nodo.obblighi_scaduti
          ? tag(`${nodo.obblighi_scaduti} ${nodo.obblighi_scaduti === 1
            ? 'obbligo di sito scaduto' : 'obblighi di sito scaduti'}`, 'tag-rosso')
          : null,
        el('div', { class: 'mini' }, [
          el('span', { testo: conteggio }),
          // Quanti presidi di qui sono sulla mappa (25/09/2026): con il pulsante
          // del luogo dice se il LUOGO ha una posizione, con questo se ce l'hanno
          // i presidi che contiene. Solo se ce n'è almeno uno.
          nodo.presidi ? el('span', { class: 'albero-posizioni', testo: nodo.presidi_con_posizione
            ? ` · 🗺 ${nodo.presidi_con_posizione === nodo.presidi ? 'tutti' : `${nodo.presidi_con_posizione} di ${nodo.presidi}`} sulla mappa`
            : ' · 📍 nessuno sulla mappa' }) : null,
          nodo.dettaglio ? el('span', { testo: ` · ${nodo.dettaglio}` }) : null,
          haFigli ? el('span', { testo: ` · ${nodo.figli.length} sotto` }) : null,
        ].filter(Boolean)),
      ].filter(Boolean)),
    ]),
    // ⛔ UN SOLO BERSAGLIO, nella riga del nome (20/09/2026, segnalazione
    // dell'operatore: «rendi meno invadente la navigazione/posizione/indirizzo
    // nella tab dei luoghi, altrimenti ci si distrae dall'alberatura»).
    //
    // Aveva ragione, ed era colpa di come le avevo messe: ogni nodo portava una
    // fascia azzurra «Naviga» a tutta larghezza PIÙ una riga tratteggiata per la
    // posizione, sopra i quattro comandi. Tre righe di contorno per un nodo, e
    // l'albero — che è il motivo per cui questa scheda esiste — spariva sotto.
    //
    // Adesso è un'icona sola, alta quanto il pollice, in fondo alla riga del
    // nome: il nodo torna a essere nome + conteggi, come prima che la
    // navigazione esistesse. Le PAROLE non si perdono, si spostano nel foglio
    // che l'icona apre — dove c'è spazio per scriverle per esteso, e dove
    // «Naviga» e «Rileva la posizione» non si possono confondere.
    // ⛔ La posizione del LUOGO con lo stesso pulsante dei Presidi (25/09/2026,
    // dall'operatore: «coerente con come funziona su presidi»): «🗺 mappa» se ce
    // l'ha, «📍 posizione» se no. Lo costruisce chi disegna (`app.js`), che ha le
    // azioni; senza, resta l'icona di prima.
    azioni.bottonePosizione
      ? azioni.bottonePosizione(nodo)
      : onDove
      ? el('button', {
        class: 'albero-dove', type: 'button',
        testo: indicazioni ? '🧭' : '📍',
        title: indicazioni ? `Dove si trova ${nodo.nome}` : `Rileva la posizione di ${nodo.nome}`,
        'aria-label': indicazioni ? `Dove si trova ${nodo.nome}`
          : `Rileva la posizione di ${nodo.nome}`,
        onclick: () => onDove(nodo),
      })
      : null,
    // I comandi stanno FUORI dal pulsante che apre: un pulsante dentro un
    // pulsante non è cliccabile in modo prevedibile, e su un telefono il tocco
    // finisce quasi sempre su quello sbagliato.
    nodo.riga
      ? el('div', { class: 'albero-comandi' }, [
        onApri ? el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Presidi',
          onclick: () => onApri(nodo),
        }) : null,
        onRinomina ? el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Rinomina',
          onclick: () => onRinomina(nodo),
        }) : null,
        (onCrea && FIGLIO_DI[nodo.tipo]) ? el('button', {
          class: 'btn btn-piccolo', type: 'button',
          testo: `+ ${NOME_TIPO[FIGLIO_DI[nodo.tipo]]}`,
          onclick: () => onCrea(FIGLIO_DI[nodo.tipo], nodo),
        }) : null,
        // «Elimina» c'è sempre e, quando non si può, è SPENTO CON IL MOTIVO
        // SCRITTO invece che assente (19/09/2026). Un pulsante che sparisce non
        // dice perché: l'operatore che ha appena creato un'ubicazione per errore
        // conclude che non si possa cancellare — ed è esattamente la segnalazione
        // da cui nasce questa riga.
        onElimina ? (() => {
          const p = (perchePuoi && perchePuoi(nodo)) || {};
          return el('button', {
            class: `btn btn-piccolo${p.eliminabile ? ' btn-pericolo' : ' btn-spento'}`,
            type: 'button',
            testo: 'Elimina',
            title: p.motivo || '',
            'aria-disabled': p.eliminabile ? null : 'true',
            onclick: () => (p.eliminabile ? onElimina(nodo) : onRifiuto(p.motivo)),
          });
        })() : null,
      ].filter(Boolean))
      : null,
  ].filter(Boolean));

  // Il ramo dice di che LIVELLO è: un impianto si deve staccare dal successivo,
  // e in un elenco di trenta righe uguali il confine si perdeva (operatore,
  // 17/09/2026). La classe la mette qui e non nel CSS a indovinare la profondità.
  return el('div', { class: `albero-ramo albero-ramo-${nodo.tipo}` }, [testa, figli]);
}

/**
 * L'albero intero, con il conto di quello che contiene.
 *
 * Il riepilogo in testa non è decorazione: dice se quello che si sta guardando è
 * tutto l'archivio o una parte, e su un elenco che nasce chiuso è l'unico modo
 * per sapere quanto c'è sotto senza aprirlo.
 */
/**
 * «Dove si trova»: il foglio che apre l'icona del nodo.
 *
 * Sta qui e non in `app.js` per la ragione di sempre — `app.js` apre IndexedDB e
 * avvia l'applicazione appena viene importato, quindi nessuna prova può
 * costruirlo — e perché è qui che le parole tolte dall'albero devono ricomparire
 * per esteso: nell'albero c'è un'icona, qui c'è scritto che cosa fa.
 *
 * @param nodo     un nodo di `alberoUbicazioni()`
 * @param azioni   `{ onPosizione(nodo) }`
 */
export function vistaDove(nodo, azioni = {}) {
  const riga = nodo.riga || {};
  const indirizzo = indirizzoLeggibile(riga);
  const link = linkIndicazioni(riga);
  const presa = String(riga.lat || '').trim() && String(riga.lon || '').trim();
  return el('div', { class: 'dove' }, [
    el('div', { class: 'dove-dove' }, [
      indirizzo
        ? el('div', { class: 'mono', testo: indirizzo })
        : el('div', { class: 'mini', testo: 'Nessun indirizzo e nessuna posizione: '
          + 'chi non ci è mai stato non sa dove venire.' }),
      presa && riga.gps_accuratezza_m
        ? el('div', { class: 'mini', testo: `±${riga.gps_accuratezza_m} m`
          + `${riga.gps_rilevato_il ? ` · rilevata il ${riga.gps_rilevato_il}` : ''}` })
        : null,
    ].filter(Boolean)),
    link
      ? el('a', {
        class: 'btn btn-blocco btn-primario', style: 'margin-top:12px',
        href: link, target: '_blank', rel: 'noopener', testo: '🧭 Naviga',
      })
      : null,
    azioni.onMappa
      ? el('button', {
        class: 'btn btn-blocco', type: 'button', style: 'margin-top:8px',
        testo: '🗺 Vedi sulla mappa', onclick: () => azioni.onMappa(nodo),
      })
      : null,
    el('button', {
      class: 'btn btn-blocco', type: 'button', style: 'margin-top:8px',
      testo: presa ? '📍 Correggi la posizione' : '📍 Rileva la posizione',
      onclick: () => azioni.onPosizione && azioni.onPosizione(nodo),
    }),
    azioni.onRinomina
      ? el('button', {
        class: 'btn btn-blocco', type: 'button', style: 'margin-top:8px',
        testo: `✎ Rinomina ${NOMI_LUOGO[nodo.tipo] ? NOMI_LUOGO[nodo.tipo].questo : ''}`.trim(),
        onclick: () => azioni.onRinomina(nodo),
      })
      : null,
  ].filter(Boolean));
}

export function vistaAlberoLuoghi(radici, azioni = {}, aperti = new Set()) {
  if (!radici.length) {
    return el('div', { class: 'mini', testo: 'Nessuna ubicazione in archivio.' });
  }
  const edifici = radici.reduce((n, i) => n + i.figli.length, 0);
  const locali = radici.reduce((n, i) => n + i.figli.reduce((m, e) => m + e.figli.length, 0), 0);
  const vuoti = radici.flatMap((i) => [i, ...i.figli, ...i.figli.flatMap((e) => e.figli)])
    .filter((n) => !n.presidi).length;

  const previsti = radici.filter((r) => r.previsto).length;

  return el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:8px' }, [
      el('span', { testo: `${radici.length} impianti · ${edifici} ${edifici === 1 ? 'area' : 'aree'} · ${locali} ${locali === 1 ? 'ubicazione' : 'ubicazioni'}` }),
      previsti ? el('span', { testo: ` · ★ ${previsti} previsti per questo giro, in cima` }) : null,
      vuoti ? el('span', { testo: ` · ${vuoti} senza presidi` }) : null,
    ].filter(Boolean)),
    el('div', { class: 'albero' }, radici.map((r) => nodoAlbero(r, azioni, aperti))),
  ]);
}

/**
 * Che cosa si può fare stando su un nodo dell'albero dei presidi.
 *
 * ⛔ Perché è una funzione, e perché sta qui invece che in `app.js`.
 *
 * `albero()` produce DUE specie di nodi che si disegnano uguali e non lo sono:
 * i luoghi veri, che hanno una riga nell'anagrafica, e i due segnaposto
 * «(senza area)» e «(senza ubicazione)», che sono la risposta alla domanda
 * «quelli che non ce l'hanno» e per id portano `SENZA_LUOGO`. Finché la
 * distinzione è stata implicita, `app.js` ha offerto sui segnaposto tutti e tre
 * i comandi di un luogo vero — rinomina, elimina, crea qui sotto — e ognuno
 * falliva in un modo diverso, nessuno prima di aver fatto compilare un modulo.
 * Il peggiore era «Elimina», ACCESO e rosso su un nodo pieno di presidi, perché
 * `motivoNonEliminabile` cercava i presidi con `locale_id === '__senza__'` e ne
 * trovava zero: i veri ce l'hanno vuoto.
 *
 * Sta in `luoghi.js` perché `app.js` non è costruibile in una prova (apre
 * IndexedDB e avvia l'applicazione appena viene importato), e una regola che
 * nessuna prova può eseguire è una regola che vale finché qualcuno se la
 * ricorda. Qui invece la mutazione «i segnaposto sono luoghi come gli altri» si
 * vede fallire.
 *
 * @param dove        `{ impiantoId, edificioId, localeId }`, come lo tiene app.js
 * @param senzaLuogo  il segnaposto (`S.SENZA_LUOGO`): passato, non importato,
 *                    perché questo modulo non deve conoscere `stato.js`
 */
export function azioniDelNodo(dove = {}, senzaLuogo = '__senza__') {
  const localeId = dove.localeId === '__tutti__' ? '' : dove.localeId;
  const qui = localeId ? { tipo: 'locale', id: localeId }
    : dove.edificioId ? { tipo: 'edificio', id: dove.edificioId }
      : dove.impiantoId ? { tipo: 'impianto', id: dove.impiantoId } : null;

  // Sopra tutto: non si è dentro niente, e l'unica cosa da creare è un impianto.
  if (!qui) return { qui: null, segnaposto: false, creaFiglio: 'impianto', rinomina: false, elimina: false };

  // Un segnaposto non si rinomina, non si elimina, e NON si può creare niente
  // sotto: un'ubicazione creata dentro «(senza area)» nascerebbe appesa a
  // un'area inesistente, e infatti `creaLocale` la rifiuta — ma dopo il modulo.
  if (qui.id === senzaLuogo) {
    return { qui, segnaposto: true, creaFiglio: null, rinomina: false, elimina: false };
  }

  return { qui, segnaposto: false, creaFiglio: FIGLIO_DI[qui.tipo] || null, rinomina: true, elimina: true };
}

/**
 * I gradini del percorso: dove si è, e che cosa c'è sopra.
 *
 * ⚠️ Un nome che manca RIPIEGA, non fa cadere il gradino. Misurato sul browser
 * il 19/09/2026: `app.js` costruiva l'elenco cercando il nome in anagrafica e
 * scartando i livelli il cui nome tornava `undefined`. Stando dentro «(senza
 * ubicazione)» — che in anagrafica non c'è, perché non è un luogo — il terzo
 * gradino spariva, e la barra scriveva «‹ Su a ACCIAIOLO · sei in Box di
 * stallo» un livello più sotto: nominava il PADRE come se fosse il posto in cui
 * si è, e il pulsante «su» ne saltava uno. Lo stesso sarebbe successo con un
 * luogo vero cancellato da un altro operatore.
 *
 * Il ripiego non è cosmesi: la barra è l'unico modo di risalire, e un gradino in
 * meno è una scala che non torna dove si era.
 *
 * @param dove   `{ impiantoId, edificioId, localeId }`
 * @param nome   `(tipo, id) => string | undefined` — il nome in anagrafica
 * @param senza  `{ valore, edificio, locale }` — il segnaposto e i suoi due nomi
 */
/**
 * Il livello SOPRA quello in cui si è, nei Presidi: dove porta «indietro».
 *
 * ⛔ 24/09/2026, segnalazione dell'operatore: «su presidi, quando entriamo in
 * un impianto, area o ubicazione, la freccia a sinistra in alto ci porta alla
 * home; invece dovrebbe portarci indietro di un livello di ubicazione». La
 * freccia conosceva solo i CAMBI DI SCHEDA (la cronologia delle istantanee):
 * scendere in un impianto non ne crea una, quindi «indietro» saltava tutto il
 * percorso e tornava alla schermata di prima dei Presidi.
 *
 * Ubicazione → area (o impianto, se l'ubicazione non ha un'area) → impianto →
 * tutti gli impianti → `null` (si è già alla radice: decide la cronologia).
 * «Tutte le ubicazioni dell'area» (`__tutti__`) torna all'AREA: è da lì che ci
 * si arriva.
 */
export function livelloSopra(dove = {}) {
  if (!dove.impiantoId) return null;
  if (dove.localeId) return { impiantoId: dove.impiantoId, edificioId: dove.edificioId || '', localeId: '' };
  if (dove.edificioId) return { impiantoId: dove.impiantoId, edificioId: '', localeId: '' };
  return { impiantoId: '', edificioId: '', localeId: '' };
}

export function livelliDiPercorso(dove = {}, nome = () => '', senza = {}) {
  const RIPIEGO = { impianto: '(impianto)', edificio: '(area)', locale: '(ubicazione)' };
  const localeId = dove.localeId === '__tutti__' ? '' : dove.localeId;
  const risolvi = (tipo, id) => {
    if (!id) return null;
    if (senza.valore && id === senza.valore) return senza[tipo] || RIPIEGO[tipo];
    return nome(tipo, id) || RIPIEGO[tipo];
  };

  const livelli = [{ tipo: null, id: '', nome: 'Tutti gli impianti', radice: true,
    dove: { impiantoId: '', edificioId: '', localeId: '' } }];
  if (dove.impiantoId) {
    livelli.push({ tipo: 'impianto', id: dove.impiantoId,
      nome: risolvi('impianto', dove.impiantoId),
      dove: { impiantoId: dove.impiantoId, edificioId: '', localeId: '' } });
  }
  if (dove.edificioId) {
    livelli.push({ tipo: 'edificio', id: dove.edificioId,
      nome: risolvi('edificio', dove.edificioId),
      dove: { impiantoId: dove.impiantoId, edificioId: dove.edificioId, localeId: '' } });
  }
  if (localeId) {
    livelli.push({ tipo: 'locale', id: localeId,
      nome: risolvi('locale', localeId),
      dove: { impiantoId: dove.impiantoId, edificioId: dove.edificioId, localeId } });
  }
  return livelli;
}

/**
 * Le NOTE dei luoghi in cui si è, per la scheda dei Presidi (25/09/2026,
 * dall'operatore: «le note delle ubicazioni e delle aree non si vedono quando
 * siamo nei presidi che entriamo nelle varie aree e ubicazioni»).
 *
 * Area e ubicazione, non l'impianto: le note di un impianto sono il suo registro
 * (SCIA, CPI, attività), che ha il suo foglio — qui sarebbero mezzo schermo sopra
 * l'elenco. Solo quelle scritte: una riga «nessuna nota» a ogni livello sarebbe
 * rumore sopra il lavoro.
 *
 * @param dove   `{ impiantoId, edificioId, localeId }` della scheda dei Presidi
 * @param riga   `(tipo, id) => riga d'anagrafica | undefined`
 * @returns `[{ tipo, nome, note }]`, dall'area all'ubicazione
 */
export function noteDelPercorso(dove = {}, riga = () => undefined, senzaLuogo = '__senza__') {
  const out = [];
  const passi = [['edificio', dove.edificioId], ['locale', dove.localeId]];
  for (const [tipo, id] of passi) {
    if (!id || id === senzaLuogo || id === '__tutti__') continue;
    const r = riga(tipo, id);
    const note = String((r && r.note) || '').trim();
    if (note) out.push({ tipo, nome: r.denominazione || '', note });
  }
  return out;
}

/** Il riquadro delle note di `noteDelPercorso`; `null` se non ce ne sono. */
export function riquadroNoteDelPercorso(note) {
  if (!note || !note.length) return null;
  return el('div', { class: 'note-luogo' }, note.map((n) => el('div', { class: 'note-luogo-voce' }, [
    el('div', { class: 'note-luogo-titolo', testo: `📝 Note ${NOMI_LUOGO[n.tipo].della} «${n.nome}»` }),
    el('div', { class: 'note-luogo-testo', testo: n.note }),
  ])));
}
