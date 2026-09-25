/**
 * Scudo Campo — «dove sta questo presidio», con la creazione dei luoghi dentro.
 *
 * Perché un modulo a sé, e perché uno solo
 * ----------------------------------------
 * La stessa domanda si pone in tre punti — si crea un presidio, si modifica la
 * sua anagrafica, si assegna un luogo a quelli che non ce l'hanno — e finora era
 * scritta tre volte in `app.js`, in tre modi diversi. Il più vecchio offriva
 * «(nessuno)» su area e ubicazione, ed è da lì che nascono i presidi che
 * nell'albero finiscono sotto «(senza area)».
 *
 * La regola, decisa dall'operatore il 19/09/2026: **l'ubicazione di terzo
 * livello è obbligatoria**, sia creando sia modificando. Un presidio si trova
 * navigando, e navigare vuol dire scendere tre gradini: uno che si ferma al
 * secondo non è «quasi a posto», è introvabile da chi lo cerca dove dovrebbe
 * essere.
 *
 * ⚠️ E un obbligo senza una via d'uscita è una trappola: se l'area giusta non
 * esiste ancora, mandare l'operatore nella scheda Luoghi a crearla e poi farlo
 * tornare è il punto in cui si smette e si annota su un foglio. Per questo la
 * creazione del luogo sta **dentro** il modulo: si sceglie «＋ Crea…», si scrive
 * il nome, e il luogo nasce al salvataggio — nella stessa transazione del
 * presidio, così non resta mai un'area vuota creata per un salvataggio annullato.
 *
 * ⛔ L'obbligo sta QUI e non nei metadati del campo (`obbligatorio: true` in
 * `scudo_campi.py`). Misurato il 19/09/2026: `scudo_pacchetto.py` valida ogni
 * presidio in arrivo con le stesse regole dei metadati, e in archivio ci sono
 * **5 presidi su 868** senza area — i fusti di schiumogeno, che la fonte
 * colloca solo a parole («Deposito»). Marcandolo obbligatorio nei metadati,
 * l'ufficio rifiuterebbe **il proprio pacchetto**, perché quei cinque ce li
 * esporta dentro. L'obbligo va dove si SCEGLIE (il modulo), non dove si giudica
 * la storia (il validatore).
 */
import { campo, el, select, svuotaNodo } from './ui.js';
import * as S from './stato.js';

/** Il valore della voce «＋ Crea…»: non è un id, e non deve mai essere salvato. */
export const NUOVO = '__nuovo__';

/**
 * Oltre questa accuratezza la posizione indica l'AREA, non il pezzo.
 *
 * Venticinque metri non è un numero di norma: è la distanza sotto la quale, su
 * una stazione elettrica, due edifici diversi non si confondono. Serve a
 * decidere una FRASE, non a rifiutare un dato — il numero vero si registra
 * sempre, e chi guarda decide.
 */
export const ACCURATEZZA_BUONA_M = 25;

/**
 * Le due soglie fini, chieste dall'operatore il 20/09/2026: «sotto i 10 m è
 * accettabile, 5 m precisa».
 *
 * Non sostituiscono i 25 m, li dividono. I 25 restano il confine che decide una
 * FRASE («indica l'area, non il pezzo»); questi due dicono, dentro quella zona
 * buona, quanto si può ancora guadagnare stando fermi qualche secondo in più —
 * che è l'unica decisione che l'operatore ha davvero in mano mentre misura.
 */
export const ACCURATEZZA_PRECISA_M = 5;
export const ACCURATEZZA_ACCETTABILE_M = 10;

/**
 * Dove sta un'accuratezza sulla scala della qualità, fra 0 (inutile) e 1 (ottima).
 *
 * ⚠️ LOGARITMICA, e non è un vezzo: l'accuratezza non ha un massimo (un fix
 * scadente può dire ±2000 m) e su una scala lineare tutto quello che conta —
 * 3, 5, 10, 25 — si schiaccerebbe in un angolo, cioè la barra non mostrerebbe
 * proprio il miglioramento che deve mostrare. Fra 3 m (meglio di così un
 * telefono non fa) e 100 m (oltre, è un'altra categoria di dato) i quattro
 * gradini si distribuiscono in modo leggibile.
 */
export function quotaAccuratezza(m) {
  const MIGLIORE = 3;
  const PEGGIORE = 100;
  const x = Number(m);
  if (!Number.isFinite(x) || x <= 0) return 0;
  const v = Math.min(Math.max(x, MIGLIORE), PEGGIORE);
  return (Math.log10(PEGGIORE) - Math.log10(v))
    / (Math.log10(PEGGIORE) - Math.log10(MIGLIORE));
}

/**
 * Come si chiama, di che colore è e quanto vale un'accuratezza.
 *
 * ⛔ Colore E parola E simbolo, tutti e tre. Controluce, in cabina, il verde e
 * l'ambra si somigliano, e c'è chi non li distingue affatto: una barra che dice
 * la qualità solo col colore non la dice. Il numero resta scritto accanto —
 * «±3 m» — perché la posizione di un puntino su una scala non si legge.
 *
 * GEMELLA di `livelloAccuratezza` in
 * `frontend/src/components/scudo/accuratezzaGps.js`: la stessa accuratezza deve
 * chiamarsi allo stesso modo sul telefono e nella scheda dell'ufficio, o due
 * persone che guardano lo stesso presidio non parlano della stessa cosa.
 * Le confronta `scripts/scudo/test_accuratezza_cross.mjs`.
 */
export function livelloAccuratezza(m) {
  const x = Number(m);
  if (!Number.isFinite(x) || x <= 0) {
    return { chiave: 'SCONOSCIUTA', parola: 'non misurata', simbolo: '?',
      classe: 'sconosciuta', quota: 0 };
  }
  const quota = quotaAccuratezza(x);
  if (x <= ACCURATEZZA_PRECISA_M) {
    return { chiave: 'PRECISA', parola: 'precisa', simbolo: '✓', classe: 'precisa', quota };
  }
  if (x <= ACCURATEZZA_ACCETTABILE_M) {
    return { chiave: 'ACCETTABILE', parola: 'accettabile', simbolo: '✓',
      classe: 'accettabile', quota };
  }
  if (x <= ACCURATEZZA_BUONA_M) {
    return { chiave: 'APPROSSIMATIVA', parola: 'approssimativa', simbolo: '!',
      classe: 'approssimativa', quota };
  }
  return { chiave: 'GROSSOLANA', parola: 'grossolana', simbolo: '✕',
    classe: 'grossolana', quota };
}

/** I quattro gradini, dal peggiore al migliore: è la scala che si disegna. */
export const GRADINI_ACCURATEZZA = [
  { classe: 'grossolana', da: 0, a: quotaAccuratezza(ACCURATEZZA_BUONA_M) },
  { classe: 'approssimativa', da: quotaAccuratezza(ACCURATEZZA_BUONA_M),
    a: quotaAccuratezza(ACCURATEZZA_ACCETTABILE_M) },
  { classe: 'accettabile', da: quotaAccuratezza(ACCURATEZZA_ACCETTABILE_M),
    a: quotaAccuratezza(ACCURATEZZA_PRECISA_M) },
  { classe: 'precisa', da: quotaAccuratezza(ACCURATEZZA_PRECISA_M), a: 1 },
];

/**
 * Quanto si sta ad ascoltare il GPS prima di spegnerlo da soli.
 *
 * Venticinque secondi sono il tempo entro cui un ricevitore che vede il cielo
 * arriva a pochi metri; oltre, migliora pochissimo e continua a consumare. È una
 * promessa alla batteria: anche se nessuno preme niente, il GPS si spegne.
 */
export const DURATA_RILEVAZIONE_MS = 25000;

/**
 * Ogni quanto si RICHIEDE una posizione, invece di aspettare che arrivi.
 *
 * ⛔ Da dove nasce (20/09/2026, segnalazione dell'operatore su Chrome/iOS: «la
 * posizione viene acquisita in un istante, senza fare la misurazione della
 * precisione»). `watchPosition` avvisa quando la posizione CAMBIA. Su un
 * telefono fermo — cioè sempre, quando si è davanti al presidio da registrare —
 * WebKit può consegnare un fix solo e poi tacere per tutti i venticinque
 * secondi. Il pannello mostrava quel primo numero e restava immobile: da fuori
 * è indistinguibile da «ha preso la posizione e ha finito», ed è esattamente il
 * comportamento che si voleva eliminare — il primo fix è sistematicamente il
 * peggiore.
 *
 * Aspettare non basta, quindi: bisogna RICHIEDERE. Ogni tre secondi si chiede
 * una posizione nuova (`maximumAge: 0`, cioè un fix vero e non quello in cache)
 * e si tiene sempre la migliore. Dove `watchPosition` già consegna da sé le due
 * strade si sommano e non fanno danno; su iOS è l'unica che produce una
 * sequenza.
 */
export const INTERVALLO_RILETTURA_MS = 3000;

/**
 * Il collegamento alla mappa.
 *
 * ⚠️ `google.com/maps?q=` e non uno schema `geo:` o `maps://`: gli schemi
 * nativi aprono l'app solo su una delle due piattaforme e sull'altra non fanno
 * NIENTE — un collegamento che su metà dei telefoni non risponde è peggio di
 * nessun collegamento, perché si prova una volta e poi non si prova più. Questo
 * apre l'app delle mappe dove c'è e il sito dove non c'è, su iPhone e su
 * Android. GEMELLO di `linkMappa` in `frontend/src/components/scudo/scudoUtils.js`.
 */
export function linkMappa(lat, lon) {
  const a = String(lat == null ? '' : lat).trim();
  const b = String(lon == null ? '' : lon).trim();
  if (!a || !b) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(a)},${encodeURIComponent(b)}`;
}

/**
 * L'indirizzo di un impianto, come si legge: «VIA AURELIA, 7 — COLLESALVETTI (LI)».
 *
 * Torna stringa vuota se la fonte tace, e non un ripiego: tre impianti su trenta
 * non hanno indirizzo nel DB Facility (CE CORTONA, GROSSETO SEDE, SUVERETO
 * SACOI), e per loro il posto giusto è il silenzio. Scriverci il comune da solo,
 * o l'indirizzo dell'impianto con il nome più simile, manderebbe l'operatore in
 * un posto sbagliato con la stessa faccia di un dato buono.
 */
export function indirizzoLeggibile(imp) {
  const i = imp || {};
  const via = String(i.indirizzo || '').trim();
  const comune = String(i.comune || '').trim();
  const prov = String(i.provincia || '').trim();
  if (!via) {
    // Nessun indirizzo ma un punto sulla mappa: si scrivono le coordinate. Non
    // è un ripiego — è quello che si può dire di vero, e con il link accanto
    // porta esattamente dove deve. Scriverci il solo comune sarebbe un nome
    // che sembra un indirizzo.
    const punto = coordinateLeggibili(i.lat, i.lon);
    if (!punto) return '';
    return comune ? `${punto} — ${comune}${prov ? ` (${prov})` : ''}` : punto;
  }
  const dove = [comune, prov && comune ? `(${prov})` : prov].filter(Boolean).join(' ');
  return dove ? `${via} — ${dove}` : via;
}

/**
 * Le INDICAZIONI stradali fino all'impianto, su Google Maps.
 *
 * ⚠️ `/maps/dir/?api=1&destination=` e non `?q=`: sono due cose diverse e chi
 * guarda questa riga sta per mettersi in macchina. `?q=` apre la scheda del
 * posto — che va bene per «dov'è questo estintore», ed è quello che fa
 * `linkMappa` sulle coordinate di un presidio. Qui serve l'altra: partire da
 * dove si è e arrivare lì.
 *
 * ⚠️ E resta `google.com`, non uno schema nativo, per la stessa ragione scritta
 * su `linkMappa`: `geo:` e `maps://` aprono l'app su UNA delle due piattaforme
 * e sull'altra non fanno niente. Questo apre l'app delle mappe dove c'è e il
 * sito dove non c'è, su iPhone e su Android.
 */
export function linkIndicazioni(imp) {
  const i = imp || {};
  // ⛔ Le COORDINATE vincono sull'indirizzo, e non viceversa (20/09/2026,
  // richiesta dell'operatore che ha dettato quattro punti). Un pin è una
  // posizione; un indirizzo è un nome che qualcuno deve interpretare, e su
  // queste installazioni i nomi sono «LOCALITÀ PIAN DELLA TORA» o «STRADA
  // STATALE 541, KM 8,230» — portano al paese, non al cancello. E due impianti
  // a cinquecento metri l'uno dall'altro con lo stesso indirizzo (SUVERETO e
  // SUVERETO SACOI) non si distinguono affatto.
  const lat = String(i.lat ?? '').trim();
  const lon = String(i.lon ?? '').trim();
  if (lat && lon) {
    return `https://www.google.com/maps/dir/?api=1&destination=${
      encodeURIComponent(`${lat},${lon}`)}`;
  }
  const via = String(i.indirizzo || '').trim();
  if (!via) return null;
  const parti = [via, String(i.comune || '').trim(), String(i.provincia || '').trim()]
    .filter(Boolean);
  return 'https://www.google.com/maps/dir/?api=1&destination='
    + encodeURIComponent(parti.join(', '));
}

/** Le coordinate come si leggono: sei decimali sono ~11 cm, oltre è rumore. */
export function coordinateLeggibili(lat, lon) {
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x.toFixed(6) : String(v || '').trim();
  };
  if (!String(lat || '').trim() || !String(lon || '').trim()) return '';
  return `${n(lat)}, ${n(lon)}`;
}

/**
 * Chiede la posizione al dispositivo.
 *
 * Iniettabile, perché `navigator.geolocation` non esiste in Node e una
 * schermata che nessuna prova può costruire è una schermata verificata solo
 * guardandola. Gli errori si distinguono UNO PER UNO: «permesso negato», «niente
 * segnale» e «ci ha messo troppo» si risolvono in tre modi diversi, e un unico
 * «errore di localizzazione» manda l'operatore a indovinare quale dei tre sia.
 */
export function posizioneDalDispositivo() {
  return new Promise((risolvi, rifiuta) => {
    const fine = seguiPosizione({
      onAggiorna: (p) => { fine.ferma(); risolvi(p); },
      onErrore: (e) => { fine.ferma(); rifiuta(e); },
    });
  });
}

/**
 * Segue la posizione finché non la si ferma, e tiene la MIGLIORE.
 *
 * ⛔ Perché non basta un colpo solo, e perché l'ha visto l'operatore prima di
 * noi (20/09/2026): la stessa posizione, presa due volte di fila, è uscita
 * «±11 m» e poi «±3 m». Non è un caso — il primo fix del GPS è grossolano e
 * migliora man mano che il ricevitore aggancia più satelliti. Prendere il primo
 * valore che arriva significa prendere **sistematicamente il peggiore**, e su un
 * presidio la differenza fra tre e undici metri è fra «è quello» e «è uno dei
 * quattro in quell'angolo».
 *
 * ⚠️ E questo, a differenza di `getCurrentPosition`, TIENE IL GPS ACCESO. Va
 * fermato sempre: al salvataggio, all'annullamento, allo scadere del tempo e
 * alla chiusura della schermata. `ferma()` è idempotente apposta — chiamarlo due
 * volte non deve essere un errore, perché i percorsi che ci arrivano sono
 * quattro e nessuno di loro sa che cosa hanno già fatto gli altri.
 *
 * Si tiene la LETTURA MIGLIORE e non l'ultima: l'accuratezza oscilla, e l'ultima
 * può essere peggiore di una di prima. Tenere l'ultima butterebbe via il lavoro
 * dei secondi precedenti.
 */
export function seguiPosizione({
  onAggiorna = () => {}, onErrore = () => {}, onFine = () => {},
  durataMs = 25000, intervalloMs = INTERVALLO_RILETTURA_MS, geo = null,
  // ⛔ `fermaSottoM`: si SPEGNE appena la precisione è abbastanza buona
  // (22/09/2026, segnalazione dell'operatore: «sembra che il satellite rimanga
  // sempre attivo perché dove sono si aggiusta di continuo, facendo consumare
  // batteria»).
  //
  // Aspettare serve finché il numero migliora: il primo fix è il peggiore, ed è
  // tutto il motivo per cui questa funzione esiste. Ma sotto i cinque metri non
  // c'è più niente da guadagnare — è la banda «precisa», e un presidio non si
  // distingue meglio di così — quindi continuare vuol dire solo tenere acceso
  // il ricevitore. Chi ha bisogno di guardare il numero scendere fino in fondo
  // (il pannello che salva la posizione di un pezzo) semplicemente non lo passa.
  fermaSottoM = null,
} = {}) {
  const sorgente = geo
    || (typeof navigator !== 'undefined' && navigator.geolocation) || null;
  let id = null;
  let scadenza = null;
  let ripetizione = null;
  let fermato = false;
  let migliore = null;
  let letture = 0;

  const ferma = (motivo = 'fermato') => {
    if (fermato) return;
    fermato = true;
    if (scadenza) { clearTimeout(scadenza); scadenza = null; }
    // ⚠️ Anche la ripetizione: è una seconda strada per tenere acceso il GPS, e
    // una strada in più è un modo in più di restare accesi per sbaglio.
    if (ripetizione) { clearInterval(ripetizione); ripetizione = null; }
    if (id !== null && sorgente && sorgente.clearWatch) sorgente.clearWatch(id);
    id = null;
    onFine(motivo, migliore);
  };

  if (!sorgente) {
    onErrore(new Error('Questo dispositivo non sa dire dove si trova.'));
    return { ferma: () => {}, migliore: () => null, letture: () => 0 };
  }

  const accetta = (pos) => {
    if (fermato || !pos || !pos.coords) return;
    letture += 1;
    const letta = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuratezza: Number.isFinite(pos.coords.accuracy)
        ? Math.round(pos.coords.accuracy) : null,
    };
    // «Migliore» = accuratezza più piccola. Una lettura senza accuratezza non
    // si può confrontare: si tiene solo se non c'è ancora niente.
    const meglio = migliore === null
      || (Number.isFinite(letta.accuratezza)
        && (!Number.isFinite(migliore.accuratezza) || letta.accuratezza < migliore.accuratezza));
    if (meglio) migliore = letta;
    onAggiorna(migliore, letta, letture);
    // ⚠️ DOPO `onAggiorna`: chi ascolta deve vedere la lettura che ha fatto
    // fermare, o l'ultima cosa che legge sarebbe quella di prima — e la
    // schermata mostrerebbe un numero peggiore di quello che ha deciso.
    if (Number.isFinite(fermaSottoM) && Number.isFinite(migliore.accuratezza)
        && migliore.accuratezza <= fermaSottoM) {
      ferma('precisione');
    }
  };

  const sbaglia = (err) => {
    if (fermato) return;
    const messaggi = {
      1: 'Il telefono non dà il permesso di leggere la posizione. Si concede dalle '
         + 'impostazioni del browser, alla voce Posizione.',
      2: "Nessun segnale: qui dentro il GPS non arriva. Prova all'aperto, vicino a "
         + 'una porta o a una finestra.',
      3: "Il telefono ci sta mettendo troppo. Riprova, meglio se all'aperto.",
    };
    // Un errore NON ferma il seguito se una posizione buona è già arrivata:
    // il GPS segnala spesso un fix mancato in mezzo a fix riusciti, e
    // chiudere lì butterebbe via quello che si è già preso.
    if (migliore === null) {
      ferma('errore');
      onErrore(new Error(messaggi[err && err.code] || 'Non è stato possibile leggere la posizione.'));
    }
  };

  const opzioni = { enableHighAccuracy: true, timeout: durataMs, maximumAge: 0 };
  if (sorgente.watchPosition) id = sorgente.watchPosition(accetta, sbaglia, opzioni);

  // ⛔ E si RICHIEDE, non si aspetta soltanto: su WebKit un telefono fermo
  // riceve un fix solo da `watchPosition`, e il pannello resterebbe immobile sul
  // primo numero, che è il peggiore. Vedi `INTERVALLO_RILETTURA_MS`.
  if (sorgente.getCurrentPosition && intervalloMs > 0) {
    ripetizione = setInterval(() => {
      if (fermato) return;
      sorgente.getCurrentPosition(accetta, sbaglia, opzioni);
    }, intervalloMs);
  }

  // Il tempo massimo è una PROMESSA all'operatore e alla batteria: dopo questo,
  // il GPS si spegne da solo anche se nessuno ha premuto niente.
  scadenza = setTimeout(() => ferma('tempo'), durataMs);

  return {
    ferma,
    migliore: () => migliore,
    letture: () => letture,
    /**
     * Quanti timer sono ancora appesi: il watch e la ripetizione.
     *
     * ⛔ Serve perché il difetto che deve intercettare è INVISIBILE da fuori.
     * Misurato il 20/09/2026 togliendo il `clearInterval` da `ferma()`: la
     * guardia `if (fermato) return` impedisce comunque ogni richiesta, quindi
     * un contatore di letture non vede niente — eppure il telefono continua a
     * svegliarsi ogni tre secondi per sempre. Le due difese servono entrambe e
     * non sono la stessa: una non fa lavorare il GPS, l'altra spegne l'orologio.
     * L'unica che può accorgersene è un'ispezione diretta dello stato.
     */
    timerAppesi: () => (id !== null ? 1 : 0) + (ripetizione !== null ? 1 : 0),
  };
}


/**
 * Il pannello delle COORDINATE, da solo.
 *
 * Estratto da `bloccoUbicazione` il 20/09/2026 perché i chiamanti sono due, e il
 * secondo è quello che conta: quando si registra un CONTROLLO si è davanti al
 * pezzo, ed è l'unico momento in cui la posizione si può prendere davvero.
 * Chiedere all'operatore di uscire dal controllo, aprire l'anagrafica, prendere
 * la posizione e tornare indietro è il percorso che non fa nessuno.
 *
 * @param coordinate         `{ lat, lon, accuratezza, rilevato_il }` di partenza
 * @param geolocalizzazione  finta nelle prove; `navigator.geolocation` nell'app
 * @param avvisa             dove finiscono i messaggi d'errore
 * @param titolo             l'intestazione del riquadro
 * @returns `{ nodo, valori(), chiudi() }` — `chiudi()` SPEGNE il GPS, e va
 *          chiamata da chi chiude la schermata: è l'unica strada d'uscita che
 *          il pannello non può vedere da sé.
 */
/**
 * La scala della precisione: quattro zone colorate e un puntino che ci cammina.
 *
 * Richiesta dell'operatore del 20/09/2026: «qualcosa di animato, colorato, che
 * fa capire la precisione che migliora via via che prova». Il movimento È
 * l'informazione — un numero che passa da 20 a 3 va letto e confrontato con
 * quello di prima, un puntino che scivola verso destra si vede senza leggere,
 * con i guanti e il telefono in mano.
 *
 * ⚠️ Il puntino NON sostituisce il numero: la posizione su una scala non si
 * stima, e la regola della casa è che il numero stia accanto alla forma. La
 * scala dice «sto migliorando», la pastiglia dice «±3 m, precisa».
 *
 * ⚠️ Il FANTASMA — il trattino fermo dov'era la prima lettura — è la parte che
 * risponde alla domanda vera: «vale la pena aspettare ancora?». Senza di lui si
 * vede dove si è, non quanta strada si è fatta.
 *
 * Niente timer: il movimento è una transizione CSS sulla posizione, e le
 * animazioni si spengono da sole con `prefers-reduced-motion`.
 */
function scalaAccuratezza() {
  const zone = el('div', { class: 'gps-zone' }, GRADINI_ACCURATEZZA.map((g) => el('div', {
    class: `gps-zona z-${g.classe}`,
    // In millesimi: le quattro zone vengono dalle STESSE costanti che decidono
    // le parole, quindi il disegno non può dire una cosa e la pastiglia un'altra.
    style: `flex:${Math.round((g.a - g.da) * 1000)} 0 0`,
  })));
  const fantasma = el('div', { class: 'gps-fantasma', style: 'left:0%;opacity:0' });
  const punto = el('div', { class: 'gps-punto', style: 'left:0%;opacity:0' });
  const nodo = el('div', { class: 'gps-scala gps-cerca' }, [zone, fantasma, punto]);
  return {
    nodo,
    aggiorna(accuratezza, prima, misurando = true) {
      const l = livelloAccuratezza(accuratezza);
      nodo.className = `gps-scala${misurando ? ' gps-misura' : ''}`;
      punto.className = `gps-punto ${l.classe}`;
      punto.setAttribute('style', `left:${(l.quota * 100).toFixed(1)}%`);
      const p = Number(prima);
      const migliorata = Number.isFinite(p) && p > Number(accuratezza);
      fantasma.setAttribute('style', migliorata
        ? `left:${(quotaAccuratezza(p) * 100).toFixed(1)}%`
        : 'left:0%;opacity:0');
    },
    ferma() { nodo.className = nodo.className.replace(' gps-misura', ''); },
  };
}

export function bloccoCoordinate({
  coordinate = {}, geolocalizzazione = null, avvisa = null,
  titolo = 'Coordinate (facoltative)',
  // ⛔ `onCambio` esiste dal 22/09/2026 (segnalazione dell'operatore: «quando
  // salviamo la posizione dovrebbe salvarla subito, non attendere che
  // scrolliamo in fondo e clicchiamo su salva modifiche»).
  //
  // Il pannello del GPS è un gesto che si chiude da solo: si guarda la
  // precisione scendere, si preme «Salva questa posizione», e a quel punto la
  // cosa È fatta. Chiedere un secondo salvataggio in fondo a un modulo lungo
  // vuol dire che una posizione presa bene si perde scorrendo — e chi l'ha
  // presa non ha modo di accorgersene.
  //
  // ⚠️ È FACOLTATIVO, e chi non lo passa continua a comportarsi come prima:
  // nella creazione di un presidio il pezzo non esiste ancora (non c'è niente
  // da aggiornare), e nella scheda del controllo le coordinate viaggiano con il
  // controllo, nella sua stessa transazione.
  onCambio = null,
  // Iniettabile come `geolocalizzazione`, e per la stessa ragione: una prova non
  // può aspettare tre secondi veri per vedere la seconda lettura. L'app non lo
  // passa mai — usa il valore dichiarato, che una prova a sé tiene d'occhio,
  // perché un parametro impostato solo dalle prove è un parametro che in
  // produzione può andare a zero senza che niente diventi rosso.
  intervalloMs = INTERVALLO_RILETTURA_MS,
  // ⛔ `aMano` (25/09/2026, dall'operatore: «quando creiamo un'area o
  // un'ubicazione possiamo solo usare il gps, invece va usato lo stesso sistema
  // usato altrove, con la scelta anche del metodo manuale»). La croce sulla mappa
  // la apre chi usa il pannello — qui non c'è una mappa, e la prova deve poter
  // costruire il pannello senza —: con `aMano` i due gesti diventano quelli di
  // «Correggi la posizione», satellite e a mano. Senza, il pannello è quello di prima.
  aMano = null,
} = {}) {
  const gps = { ...(coordinate || {}) };
  const rigaGps = el('div', {});
  // Il seguito in corso, se c'è. Vive qui perché a fermarlo devono poter
  // arrivare QUATTRO strade — salva, annulla, tempo scaduto, chiusura del
  // foglio — e nessuna sa che cosa hanno già fatto le altre.
  let seguito = null;
  const fermaGps = () => { if (seguito) { seguito.ferma('uscita'); seguito = null; } };

  const disegnaGps = () => {
    svuotaNodo(rigaGps);
    const testo = coordinateLeggibili(gps.lat, gps.lon);
    const link = linkMappa(gps.lat, gps.lon);
    rigaGps.append(el('div', { class: 'mini', style: 'font-weight:600',
      testo: titolo }));
    if (testo) {
      rigaGps.append(el('div', { class: 'mono', testo }));
      const acc = Number(gps.accuratezza);
      if (Number.isFinite(acc)) {
        // La stessa pastiglia della rilevazione, con le stesse parole: il
        // presidio salvato a ±8 m deve leggersi «accettabile» anche il giorno
        // dopo, o le bande varrebbero solo mentre si misura.
        const l = livelloAccuratezza(acc);
        rigaGps.append(el('div', { class: 'gps-riga' }, [
          el('span', { class: `gps-chip ${l.classe}`,
            testo: `${l.simbolo} ${l.parola} · ±${acc} m` }),
          gps.rilevato_il
            ? el('span', { class: 'mini', testo: `rilevate il ${gps.rilevato_il}` }) : null,
        ]));
        if (acc > ACCURATEZZA_BUONA_M) {
          rigaGps.append(el('div', { class: 'mini', style: 'color:var(--ambra)',
            testo: "indica l'area, non il pezzo. Dentro un edificio è normale." }));
        }
      }
      if (link) {
        rigaGps.append(el('a', { class: 'btn btn-blocco btn-piccolo',
          style: 'margin-top:6px', href: link, target: '_blank', rel: 'noopener',
          testo: '🗺 Vedi sulla mappa' }));
      }
    } else {
      rigaGps.append(el('div', { class: 'mini',
        testo: 'Non rilevate. Servono a ritrovare il presidio sul posto: '
          + 'prendile stando accanto al pezzo.' }));
    }
    rigaGps.append(el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:6px',
      testo: aMano ? '🛰 Con il satellite (sono sul posto)'
        : (testo ? '📍 Rileva di nuovo la posizione' : '📍 Prendi la posizione da qui'),
      onclick: () => disegnaRilevazione(),
    }));
    if (aMano) {
      rigaGps.append(el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:6px',
        testo: '✛ A mano, sulla mappa',
        onclick: () => { fermaGps(); aMano(valori()); },
      }));
    }
    if (testo) {
      rigaGps.append(el('button', {
        class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:6px',
        testo: 'Togli le coordinate',
        onclick: () => {
          gps.lat = ''; gps.lon = ''; gps.accuratezza = null; gps.rilevato_il = '';
          disegnaGps();
          // Anche togliere è un gesto esplicito su questo pannello: se il
          // salvataggio è immediato in un verso deve esserlo nell'altro, o si
          // toglierebbe una posizione che resta scritta.
          if (onCambio) onCambio(valori());
        },
      }));
    }
  };

  /**
   * La rilevazione IN CORSO: si vede la precisione migliorare, e si salva
   * quando basta.
   *
   * L'operatore l'ha misurato sul suo telefono: la stessa posizione, presa due
   * volte, è uscita ±11 m e poi ±3 m. Il primo fix è sempre il peggiore, e un
   * bottone che prende «quello che c'è adesso» prende sistematicamente quello.
   * Qui si guarda il numero scendere e si decide: il peggioramento non si vede
   * mai, perché si tiene sempre la lettura migliore.
   */
  function disegnaRilevazione() {
    svuotaNodo(rigaGps);
    const stato = el('div', { class: 'gps-chip cercando', testo: '📡 cerco il segnale…' });
    const scala = scalaAccuratezza();
    const valore = el('div', { class: 'mono' });
    const storia = el('div', { class: 'mini', style: 'color:var(--testo-tenue)' });
    // ⛔ Che la misurazione sia IN CORSO va scritto, non lasciato capire dal
    // numero che cambia. Segnalazione dell'operatore del 20/09/2026: con un fix
    // solo — il caso normale su un iPhone fermo — il pannello restava immobile
    // sul primo numero, e «sto ancora misurando» era indistinguibile da «ho
    // finito». Un conteggio che sale e dei secondi che scendono dicono la
    // differenza anche quando l'accuratezza non si muove.
    const avanzamento = el('div', { class: 'mini', style: 'color:var(--testo-tenue)' });
    let prima = null;
    let presa = null;
    let quante = 0;
    const finoA = Date.now() + DURATA_RILEVAZIONE_MS;
    let tic = null;
    const fermaTic = () => { if (tic) { clearInterval(tic); tic = null; } };
    // ⚠️ Il conto alla rovescia si spegne DA SÉ quando arriva a zero, e non solo
    // quando qualcuno lo ferma. Misurato il 20/09/2026 con una mutazione: un
    // orologio che dipende solo dalla catena delle chiamate resta acceso per
    // sempre appena una di quelle non arriva — nelle prove ha tenuto in vita il
    // processo, e in un browser sarebbe un timer che nessuno vede più.
    const disegnaAvanzamento = () => {
      const restano = Math.max(0, Math.round((finoA - Date.now()) / 1000));
      if (!restano) { avanzamento.textContent = ''; fermaTic(); return; }
      const n = quante === 1 ? '1 lettura' : `${quante} letture`;
      avanzamento.textContent = quante
        ? `${n} · continuo a misurare ancora ${restano} s`
        : `continuo a misurare ancora ${restano} s`;
    };

    const salva = el('button', {
      class: 'btn btn-blocco btn-piccolo btn-primario', type: 'button',
      style: 'margin-top:6px', testo: 'Aspetta il primo segnale…',
    });
    salva.disabled = true;
    const annulla = el('button', {
      class: 'btn btn-blocco btn-piccolo', type: 'button', style: 'margin-top:6px',
      testo: 'Annulla',
      onclick: () => { fermaTic(); fermaGps(); disegnaGps(); },
    });

    salva.addEventListener('click', () => {
      if (!presa) return;
      fermaTic();
      fermaGps();
      gps.lat = presa.lat; gps.lon = presa.lon;
      gps.accuratezza = presa.accuratezza;
      gps.rilevato_il = S.oggiIso();
      disegnaGps();
      if (onCambio) onCambio(valori());
    });

    // `titolo` e non la scritta fissa: nel controllo il riquadro si chiama
    // «Questo presidio non ha una posizione», e durante la rilevazione deve
    // continuare a dire la stessa cosa — cambiare nome a metà fa credere di
    // essere finiti in un'altra schermata.
    rigaGps.append(
      el('div', { class: 'mini', style: 'font-weight:600', testo: titolo }),
      el('div', { class: 'gps-riga' }, [stato]), scala.nodo,
      valore, storia, avanzamento, salva, annulla,
    );
    disegnaAvanzamento();
    tic = setInterval(disegnaAvanzamento, 1000);

    fermaGps();
    seguito = seguiPosizione({
      durataMs: DURATA_RILEVAZIONE_MS,
      intervalloMs,
      geo: geolocalizzazione,
      onAggiorna: (migliore, _letta, n) => {
        presa = migliore;
        quante = n || quante + 1;
        disegnaAvanzamento();
        if (prima === null) prima = migliore.accuratezza;
        valore.textContent = coordinateLeggibili(migliore.lat, migliore.lon);
        const acc = Number(migliore.accuratezza);
        const l = livelloAccuratezza(acc);
        stato.className = `gps-chip ${l.classe}`;
        stato.textContent = Number.isFinite(acc)
          ? `${l.simbolo} ${l.parola} · ±${acc} m`
          : 'posizione presa';
        scala.aggiorna(acc, prima);
        // Il miglioramento si DICE, invece di lasciarlo indovinare da un numero
        // che cambia: «±11 → ±3 m» è il motivo per cui vale la pena aspettare.
        storia.textContent = Number.isFinite(prima) && Number.isFinite(acc) && acc < prima
          ? `migliorata da ±${prima} m` : '';
        salva.disabled = false;
        salva.textContent = `✓ Salva questa posizione (±${Number.isFinite(acc) ? acc : '?'} m)`;
      },
      onErrore: (e) => {
        fermaTic();
        fermaGps();
        if (avvisa) avvisa(e.message || String(e));
        disegnaGps();
      },
      onFine: (motivo) => {
        seguito = null;
        fermaTic();
        avanzamento.textContent = '';
        // Il puntino smette di pulsare: fermo e pulsante sono due stati diversi
        // e devono avere due aspetti diversi, o «sta ancora misurando» torna a
        // essere indistinguibile da «ha finito» — solo in grafica invece che a
        // parole.
        scala.ferma();
        if (motivo !== 'tempo') return;
        stato.textContent = presa
          ? `Fermato dopo ${Math.round(DURATA_RILEVAZIONE_MS / 1000)} secondi: `
            + 'questa è la precisione migliore ottenuta.'
          : `Nessun segnale in ${Math.round(DURATA_RILEVAZIONE_MS / 1000)} secondi. `
            + "Prova all'aperto.";
      },
    });
  }

  /**
   * I quattro campi, sempre tutti e quattro anche vuoti: togliere le coordinate
   * deve svuotare anche l'accuratezza e la data, o resterebbe «±8 m» accanto a
   * un posto che non c'è più.
   */
  function valori() {
    const lat = String(gps.lat ?? '').trim();
    const lon = String(gps.lon ?? '').trim();
    return {
      lat,
      lon,
      gps_accuratezza_m: lat ? String(gps.accuratezza ?? '') : '',
      gps_rilevato_il: lat ? String(gps.rilevato_il ?? '') : '',
    };
  }

  disegnaGps();

  return {
    nodo: rigaGps,
    chiudi() { fermaGps(); },
    valori,
  };
}

/**
 * @param impiantoId       l'impianto di partenza
 * @param edificioId       area corrente ('' = nessuna)
 * @param localeId         ubicazione corrente ('' = nessuna)
 * @param conImpianto      disegna anche la scelta dell'impianto
 * @param conTesto         disegna «Posizione precisa» (null = non disegnarlo)
 * @param proposta         nome proposto quando si crea un luogo nuovo
 * @param areaFissa        area imposta dall'esterno: si chiede solo l'ubicazione
 */
export function bloccoUbicazione({
  // `onPosizione(valori)`: chiamato quando il pannello del GPS salva o toglie
  // una posizione. Facoltativo — senza, il comportamento è quello di prima.
  onPosizione = null,
  impiantoId = '', edificioId = '', localeId = '',
  conImpianto = false, conTesto = null, proposta = '', areaFissa = '',
  // `asterischi`: impianto, area e ubicazione portano l'asterisco degli
  // obbligatori (la creazione di un presidio, 23/09/2026).
  asterischi = false,
  coordinate = null, avvisa = null, geolocalizzazione = null,
  intervalloMs = INTERVALLO_RILETTURA_MS,
  // ⛔ `aMano` (25/09/2026, dall'operatore: «quando creiamo un'area o
  // un'ubicazione possiamo solo usare il gps, invece va usato lo stesso sistema
  // usato altrove, con la scelta anche del metodo manuale»). La croce sulla mappa
  // la apre chi usa il pannello — qui non c'è una mappa, e la prova deve poter
  // costruire il pannello senza —: con `aMano` i due gesti diventano quelli di
  // «Correggi la posizione», satellite e a mano. Senza, il pannello è quello di prima.
  aMano = null,
} = {}) {
  const fImp = conImpianto
    ? select(S.opzioniCampo({ opzioni_da: 'impianti' }, {}), impiantoId) : null;
  const fEdi = el('select', {});
  const fNomeEdi = el('input', { type: 'text', placeholder: "Come si chiama l'area" });
  const rigaNomeEdi = campo('Nome della nuova area', fNomeEdi);
  const fLoc = el('select', {});
  const fNomeLoc = el('input', { type: 'text', placeholder: "Come si chiama l'ubicazione" });
  const rigaNomeLoc = campo('Nome della nuova ubicazione', fNomeLoc);
  const fPiano = el('input', { type: 'text', placeholder: 'Facoltativo' });
  const rigaPiano = campo('Piano', fPiano);
  const fTesto = conTesto === null ? null
    : el('input', { type: 'text', value: conTesto,
      placeholder: 'Dove esattamente: parete nord, ingresso…' });

  const impianto = () => (fImp ? fImp.value : impiantoId);
  const area = () => (areaFissa || fEdi.value);

  function riempi(sel, voci, etichettaNuovo, valore) {
    svuotaNodo(sel);
    sel.append(el('option', { value: '', testo: '— scegli —' }));
    for (const o of voci) sel.append(el('option', { value: o.valore, testo: o.testo }));
    sel.append(el('option', { value: NUOVO, testo: etichettaNuovo }));
    sel.value = voci.some((o) => o.valore === valore) ? valore : '';
  }

  function aggiornaUbicazioni(valore = '') {
    const a = area();
    const voci = a && a !== NUOVO
      ? S.opzioniCampo({ opzioni_da: 'locali' }, { edificio_id: a }) : [];
    riempi(fLoc, voci, '＋ Crea una nuova ubicazione…', valore);
    // Area nuova = sotto non c'è ancora niente: l'unica strada è crearla, e
    // lasciare «— scegli —» selezionato sarebbe un elenco vuoto senza spiegazione.
    if (fEdi.value === NUOVO) fLoc.value = NUOVO;
    visibilita();
  }

  function aggiornaAree(valore = '') {
    if (areaFissa) return;
    riempi(fEdi, S.opzioniCampo({ opzioni_da: 'edifici' }, { impianto_id: impianto() }),
      '＋ Crea una nuova area…', valore);
    aggiornaUbicazioni();
  }

  function visibilita() {
    rigaNomeEdi.hidden = areaFissa ? true : fEdi.value !== NUOVO;
    rigaNomeLoc.hidden = fLoc.value !== NUOVO;
    rigaPiano.hidden = fLoc.value !== NUOVO;
    // La proposta si scrive una volta sola: riscriverla a ogni cambio
    // cancellerebbe quello che l'operatore ha appena battuto.
    if (!rigaNomeEdi.hidden && !fNomeEdi.value) fNomeEdi.value = proposta;
    if (!rigaNomeLoc.hidden && !fNomeLoc.value) fNomeLoc.value = proposta;
  }

  if (fImp) fImp.addEventListener('change', () => aggiornaAree());
  fEdi.addEventListener('change', () => aggiornaUbicazioni());
  fLoc.addEventListener('change', visibilita);
  aggiornaAree(edificioId);
  aggiornaUbicazioni(localeId);

  // ---- le coordinate, facoltative ---------------------------------------- #
  //
  // `coordinate: null` = non si disegnano affatto (il foglio che assegna un
  // Il pannello delle coordinate, quando lo si vuole: `coordinate: null` = non
  // si disegna affatto (il foglio che assegna un luogo a più presidi in blocco
  // non può prendere UNA posizione per tutti).
  const coord = coordinate
    ? bloccoCoordinate({ coordinate, geolocalizzazione, avvisa, intervalloMs,
      // Si passa avanti a chi costruisce il modulo: la modifica anagrafica la
      // usa per salvare la posizione SUBITO (22/09/2026), la creazione no —
      // lì il presidio non esiste ancora.
      onCambio: onPosizione })
    : null;

  const righe = [];
  const obbl = (nodo) => { if (asterischi && nodo.classList) nodo.classList.add('campo-obbligatorio'); return nodo; };
  if (fImp) righe.push(obbl(campo('Impianto', fImp)));
  if (!areaFissa) righe.push(obbl(campo('Area', fEdi)), rigaNomeEdi);
  righe.push(obbl(campo('Ubicazione', fLoc)), rigaNomeLoc, rigaPiano);
  if (fTesto) {
    righe.push(campo('Posizione precisa', fTesto,
      "Dentro l'ubicazione: «parete nord», «ingresso lato officina». Non la sostituisce."));
  }
  if (coord) righe.push(coord.nodo);
  const nodo = el('div', {}, righe);

  return {
    nodo,
    campi: { fImp, fEdi, fLoc, fTesto },

    /**
     * Spegne il GPS.
     *
     * ⛔ Va chiamata dalla schermata che chiude il foglio, ed è la QUARTA strada
     * d'uscita — le altre tre (salva, annulla, tempo scaduto) le gestisce il
     * pannello. Senza questa, chiudere il foglio con una rilevazione in corso
     * lascia il ricevitore acceso fino allo scadere del tempo, che è esattamente
     * il consumo di fondo che `getCurrentPosition` non aveva.
     */
    chiudi() { if (coord) coord.chiudi(); },

    /**
     * I motivi per cui non si può salvare, in ordine di lettura.
     *
     * Restituisce un elenco e non un booleano: il messaggio dice QUALE campo
     * manca, e su un modulo lungo «compila i campi obbligatori» costringe a
     * ricercarli uno per uno.
     */
    errori() {
      const out = [];
      if (fImp && !fImp.value) out.push("Scegli l'impianto.");
      if (!areaFissa) {
        if (!fEdi.value) out.push("Scegli l'area: senza, il presidio non si trova navigando.");
        else if (fEdi.value === NUOVO && !fNomeEdi.value.trim()) {
          out.push("Scrivi il nome della nuova area.");
        }
      }
      if (!fLoc.value) {
        out.push("Scegli l'ubicazione: è il terzo livello, quello in cui si cerca il presidio.");
      } else if (fLoc.value === NUOVO && !fNomeLoc.value.trim()) {
        out.push("Scrivi il nome della nuova ubicazione.");
      }
      return out;
    },

    /**
     * Crea i luoghi che mancano e restituisce i campi da scrivere sul presidio.
     *
     * ⚠️ Va chiamata DENTRO `muta()`, insieme alla scrittura del presidio: i
     * luoghi nuovi e il presidio devono stare nella stessa transazione, o un
     * salvataggio rifiutato lascerebbe in archivio un'area vuota che nessuno ha
     * chiesto — e che poi viaggia in ufficio.
     */
    applica() {
      const impId = impianto();
      let ediId = areaFissa || fEdi.value;
      if (!areaFissa && fEdi.value === NUOVO) {
        ediId = S.creaEdificio({ impianto_id: impId, denominazione: fNomeEdi.value.trim() }).id;
      }
      let locId = fLoc.value;
      if (fLoc.value === NUOVO) {
        locId = S.creaLocale({ edificio_id: ediId, denominazione: fNomeLoc.value.trim(),
          piano: fPiano.value.trim() }).id;
      }
      const out = { impianto_id: impId, edificio_id: ediId, locale_id: locId };
      if (fTesto) out.ubicazione_testo = fTesto.value.trim();
      if (coord) Object.assign(out, coord.valori());
      return out;
    },
  };
}
