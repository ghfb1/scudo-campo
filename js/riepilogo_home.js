/**
 * Scudo Campo — i numeri della home, raggruppati in modo che le somme si vedano.
 *
 * Il problema che risolve (20/09/2026, segnalazione dell'operatore)
 * ----------------------------------------------------------------
 * «La home non mostra i totali e subtotali in modo ben intuitivo: se sommiamo
 * presidi in regola e non in regola non arriviamo comunque a 868, e nemmeno a
 * 1688, quindi non è affatto chiaro.»
 *
 * Misurato, e aveva ragione due volte:
 *
 * 1. **Due unità con lo stesso nome.** «1688 presidi censiti» è la somma delle
 *    QUANTITÀ — i pezzi — mentre «868», «581 in regola» e «281 non in regola»
 *    contano le RIGHE, cioè le postazioni. Sull'archivio di oggi: 868 righe,
 *    169 delle quali valgono più di un pezzo, per 1688 pezzi in tutto. Due
 *    numeri veri, due domande diverse, una parola sola — e chiamandoli entrambi
 *    «presidi» l'unica conclusione possibile è che i conti non tornino.
 * 2. **La somma che torna non si vedeva.** 581 + 281 + 6 fa 868, ma il terzo
 *    addendo stava in una nota sotto, staccato, e in mezzo c'era una scheda che
 *    contava un'altra cosa.
 *
 * Da qui la forma: **blocchi**, ognuno con il suo TOTALE dichiarato e le sue
 * voci che ci sommano dentro. È la proprietà che `test_riepilogo_home.mjs`
 * verifica su ogni blocco, così un numero aggiunto domani in mezzo a un gruppo
 * fa diventare rossa la prova invece di fare la stessa confusione di oggi.
 *
 * ⚠️ Qui non c'è nessun campo `quadra`, e l'assenza è una decisione misurata:
 * c'era, e una mutazione che lo faceva rispondere sempre «sì» NON faceva
 * fallire niente — la prova la somma se la calcola da sé, e in `app.js` quel
 * campo non lo leggeva nessuno. Un valore che solo le prove guardano, e che
 * nessuna prova può smentire, insegna che conta e non conta: la prossima
 * persona lo userebbe per decidere qualcosa.
 *
 * Qui la DECISIONE e anche la vista dell'elenco: `app.js` non è costruibile
 * fuori dal browser, e una schermata che nessuna prova può eseguire è una
 * schermata verificata solo guardandola. È già costato due difetti che
 * `check_js.mjs` non poteva vedere — l'ultimo, il 20/09/2026, era
 * `nomePresidio(a).localeCompare(...)` su un oggetto: il tocco sollevava
 * un'eccezione e non succedeva niente.
 */
import { el } from './ui.js';

/**
 * Un numero con la sua etichetta e il suo tono.
 *
 * `apribile` dice che dietro quel numero c'è un ELENCO da guardare. Non è una
 * proprietà grafica: è la differenza fra «13» e «quali 13», e senza di essa il
 * numero resta una constatazione (20/09/2026, richiesta dell'operatore: «dove
 * dice 13 senza scadenze calcolate, se ci clicchiamo dovrebbe mostrarci quali
 * sono»).
 */
const COLORE = {
  verde: 'var(--verde)', rosso: 'var(--rosso)', ambra: 'var(--ambra)',
  blu: 'var(--blu)', '': 'var(--grigio-500)',
};

function voce(chiave, valore, etichetta, tono = '', apribile = false) {
  // Il COLORE viene dal tono, non scritto a parte: una fetta di ciambella e la
  // pastiglia che le sta accanto devono essere dello stesso colore, o dicono due
  // cose diverse sullo stesso numero.
  return { chiave, valore, etichetta, tono, apribile, colore: COLORE[tono] || COLORE[''] };
}

export function blocchiRiepilogo(r = {}) {
  const n = (v) => Number(v) || 0;
  const previsti = n(r.controlli_previsti);
  const fatti = n(r.controlli_fatti);
  const righe = n(r.righe);
  const chiusi = n(r.chiusi_non_eseguibili);

  // ⛔ Il blocco «Le verifiche di questo giro» è stato TOLTO il 20/09/2026
  // (segnalazione dell'operatore: «questo é superfluo in cima, perché abbiamo
  // già il grafico a cerchio più in basso»).
  //
  // Diceva esattamente ciò che dice «Avanzamento del giro» sessanta pixel più
  // sotto — fatti, restano, percentuale — e lo diceva per primo, quindi due
  // volte di cui la prima peggiore: una barra non porta la percentuale al
  // centro, che è l'unica cifra che si legge in un colpo d'occhio col telefono
  // in mano. La riduzione da due schede a una barra, fatta in mattinata, aveva
  // tolto inchiostro al duplicato senza togliere il duplicato.
  //
  // ⚠️ Quello che NON era un duplicato — «su N presidi · M verifiche sono già
  // scadute» — è sceso accanto alla ciambella invece di sparire con il blocco.
  // È la riga che dice quanto del lavoro è in ritardo, e non compariva in
  // nessun altro punto della schermata: togliere un doppione è una cosa,
  // portarsi via con lui l'unico dato che portava è un'altra.
  const blocchi = [
    {
      chiave: 'presidi',
      // ⭐ Una CIAMBELLA: le tre voci sommano al totale, e in un cerchio la
      // somma si vede senza contarla — che era la segnalazione da cui è nata
      // tutta questa sezione («se sommiamo in regola e non in regola non
      // arriviamo a 868»). Il numero resta scritto in legenda, perché la
      // lunghezza di un arco non si stima.
      forma: 'ciambella',
      titolo: 'I presidi',
      totale: { valore: righe, etichetta: 'presidi (postazioni)' },
      voci: [
        voce('in_regola', n(r.presidi_in_regola), 'in regola',
          n(r.presidi_in_regola) ? 'verde' : ''),
        voce('non_in_regola', n(r.presidi_non_in_regola), 'non in regola',
          n(r.presidi_non_in_regola) ? 'rosso' : 'verde'),
        // ⭐ Apribile: è il gruppo che chiede «e questi chi sono?». Gli altri due
        // si guardano nell'elenco dei presidi con i filtri che già esistono;
        // questo no, e senza un elenco resta un numero che non si può inseguire.
        voce('senza', n(r.presidi_senza_scadenze), 'senza scadenze calcolate',
          n(r.presidi_senza_scadenze) ? 'ambra' : '', true),
      ],
      // ⚠️ I PEZZI stanno in nota e non in una scheda: una scheda accanto alle
      // altre invita a sommarla con loro, ed è di un'altra unità. La frase dice
      // anche PERCHÉ i due numeri differiscono, o «1688» resta un mistero.
      nota: n(r.presidi) === righe
        ? `${righe} pezzi: ogni postazione ne vale uno`
        : `${n(r.presidi)} pezzi in tutto: alcune postazioni ne valgono più d'uno `
          + '(una fila di lampade, un armadio di bombole)',
    },
    {
      chiave: 'anomalie',
      forma: 'numero',
      titolo: 'Difetti aperti',
      totale: { valore: n(r.anomalie_aperte), etichetta: 'anomalie aperte' },
      voci: [],
      nota: n(r.anomalie_aperte)
        ? 'stanno sui presidi, e si chiudono dal controllo'
        : 'nessun difetto aperto',
    },
  ];

  return blocchi;
}


/**
 * QUALI sono i presidi senza scadenze calcolate.
 *
 * Richiesta dell'operatore del 20/09/2026: «dove dice 13 senza scadenze
 * calcolate, se ci clicchiamo dovrebbe mostrarci quali sono». Un numero che non
 * si può inseguire è una constatazione: resta lì tutti i giorni e nessuno sa da
 * dove cominciare.
 *
 * ⚠️ Le tre funzioni che leggono il presidio arrivano da fuori (`nome`,
 * `dove`, `perche`), come tutto ciò che ha un effetto nelle schermate provabili.
 * Non è cerimonia: la prima stesura chiamava `nomePresidio` direttamente e ne
 * usava il RISULTATO come stringa — ma torna un oggetto, e il tocco sollevava
 * un'eccezione senza dire niente.
 *
 * @param assets  i presidi da elencare
 * @param nome    (a) -> come si chiama
 * @param dove    (a) -> dov'è
 * @param perche  (a) -> perché non ha scadenze
 * @param onApri  (a) -> apre la scheda
 */
export function vistaSenzaScadenze(assets, { che, nome, dove, perche, onApri } = {}) {
  // ⛔ In TESTA va che cosa È, non come si chiama (20/09/2026, segnalazione
  // dell'operatore: «non mostra il tipo, non so se é un estintore, una luce»).
  //
  // Su questo elenco si arriva per decidere che cosa fare, e la prima domanda è
  // sempre «di che si tratta». Una matricola in cima risponde a «quale», che è
  // la seconda: finché non sai se è un estintore o una lampada, «7663» non è
  // un'informazione — è un numero. E l'ordinamento segue: prima per tipo,
  // perché così le cose dello stesso genere stanno insieme e si sbrigano in
  // blocco, poi per nome dentro il tipo.
  const chiave = (a) => `${che ? che(a) : ''}\u0000${nome ? nome(a) : ''}`;
  const righe = [...(assets || [])]
    .sort((x, y) => String(chiave(x)).localeCompare(String(chiave(y))));
  return el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:10px', testo:
      'Non sono né in regola né fuori regola: nessuno può dire quando vanno '
      + 'guardati. Di solito manca la data da cui contare — anno di costruzione '
      + 'o messa in servizio — e si scrive in anagrafica.' }),
    ...righe.map((a) => el('button', {
      class: 'voce voce-selezionabile', type: 'button',
      onclick: () => onApri && onApri(a),
    }, [
      el('div', { class: 'voce-corpo' }, [
        el('div', { class: 'voce-titolo', testo: String(che ? che(a) : '') || a.codice }),
        el('div', { class: 'voce-sotto', testo: String(nome ? nome(a) : a.codice) }),
        el('div', { class: 'voce-sotto', testo: String(dove ? dove(a) : '') }),
        el('div', { class: 'mini', testo: String(perche ? perche(a) : '') }),
      ]),
      el('span', { class: 'voce-freccia', testo: '›' }),
    ])),
  ]);
}
