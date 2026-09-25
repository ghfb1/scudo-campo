/**
 * Scudo Campo — formato pacchetto SCUDO-PKG v2.
 *
 * Gemello di `backend/app/services/scudo_pacchetto.py`. Le due implementazioni
 * devono produrre lo stesso archivio e lo stesso codice di controllo sugli
 * stessi dati, altrimenti ogni rilievo di rientro verrebbe segnalato come
 * modificato. La prova che restino allineate è
 * `scripts/scudo/test_pacchetto_cross.mjs`.
 *
 * Il pacchetto è un archivio ZIP con un CSV per entità, intestazioni in
 * italiano e ubicazioni già risolte in chiaro: si apre in Excel come una
 * tabella normale. Gli identificatori tecnici stanno in fondo a destra.
 *
 * Il codice di controllo è lo sha256 dei byte grezzi dei CSV di dati, in ordine
 * di nome. Forma volutamente banale: la v1 ordinava le righe secondo una forma
 * canonica, e quell'ordinamento era la sola parte del formato che Python e
 * JavaScript potevano implementare diversamente senza sintomi — le due lingue
 * ordinano le stringhe in modo diverso fuori dal piano base Unicode, e le icone
 * delle categorie ci stanno dentro. Sui byte non esiste ambiguità.
 *
 * Se cambi qualcosa qui, cambialo anche nel gemello e alza PKG_VERSION.
 */
import { leggiZip, scriviZip, sembraZip } from './zip.js';

export const PKG_MAGIC = 'SCUDO-PKG';
// 4 dal 14/09/2026: codice del pacchetto, dati dell'ufficio nel manifest e
// `piano_id` sui controlli. Gemello di `PKG_VERSION` in `scudo_pacchetto.py`.
// Formato 5 dal 18/09/2026: `5b-sostituzioni.csv`. Alzato per forza, non per
// formalità: la tabella viene svuotata e reinserita a ogni rientro, quindi
// un'app che non la conoscesse la cancellerebbe in silenzio. Meglio un rifiuto
// con «aggiorna l'app».
export const PKG_VERSION = 5;
// Il lettore accetta anche la versione precedente: un operatore che ha già
// scaricato un pacchetto v2 e ci ha lavorato sopra non deve trovarselo
// rifiutato in cabina, dove non c'è rete per rimediare.
export const PKG_VERSION_MIN = 2;
export const CSV_DELIMITER = ';';
export const MANIFEST = 'manifest.json';
export const LEGGIMI = 'LEGGIMI.txt';

/**
 * Le chiavi del manifest scritte dall'UFFICIO, che il campo restituisce INVARIATE.
 * GEMELLO di `CHIAVI_UFFICIO` in `backend/app/services/scudo_pacchetto.py`; prova:
 * `scripts/scudo/test_manifest_cross.py`. Il manifest di ritorno lo costruisce
 * `metaDiRientro`, qui sotto, e non l'app: una chiave dimenticata in un oggetto
 * scritto a mano sparisce senza nessun errore.
 */
export const CHIAVI_UFFICIO = [
  'codice', 'esportato_da', 'esportato_il', 'operatore_previsto',
  'periodo_da', 'periodo_a', 'note_pacchetto', 'impianti_previsti',
];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * «XXXX-XXXX»: i primi 40 bit del sessione_id in base32 di Crockford.
 * GEMELLO di `codice_pacchetto` in Python. Niente `>>`: in JavaScript lo
 * spostamento lavora a 32 bit e i 40 bit non ci stanno; `Math.floor(n / 2**k)`
 * sì, perché 2^40 è ben sotto 2^53.
 */
export function codicePacchetto(sessioneId) {
  const esa = String(sessioneId || '').replace(/[^0-9a-fA-F]/g, '').slice(0, 10);
  if (esa.length < 10) return '';
  const n = parseInt(esa, 16);
  let cifre = '';
  for (let i = 0; i < 8; i += 1) {
    cifre += CROCKFORD[Math.floor(n / 2 ** (5 * (7 - i))) % 32];
  }
  return `${cifre.slice(0, 4)}-${cifre.slice(4)}`;
}

/**
 * Il meta del pacchetto di RIENTRO, costruito in un posto solo.
 *
 * `manifestOrigine` è il manifest del pacchetto caricato: da lì vengono le
 * CHIAVI_UFFICIO e il sessione_id, invariati. `sessione` sono i dati del giro sul
 * dispositivo; `extra` quello che sa solo l'app (versione, stato del giro).
 */
/**
 * La catena delle mani per cui il pacchetto è passato.
 *
 * Perché esiste (19/09/2026): un giro può essere fatto a metà da un operatore e
 * continuato da un altro — «succede spesso che una zona la faccia uno e un'altra
 * un altro». Senza questa catena, in ufficio arriva il nome dell'ULTIMO che ha
 * tenuto il pacchetto e di chi c'è stato prima non resta niente: misurato, e
 * l'archivio registrava solo il secondo operatore.
 *
 * ⚠️ La catena è un RIASSUNTO leggibile, non una prova: il manifest non entra nel
 * checksum, quindi una mano si può cancellare a mano. La prova è il giornale
 * (che viaggia dentro il checksum) e `operatore_nome`/`device_origine` sulle
 * righe. Va detto, o qualcuno la userà come documento.
 *
 * Idempotente sulla coppia (dispositivo, preso_il): esportare due volte è
 * normale — si rimanda il file — e la catena non deve crescere di una mano per
 * ogni file prodotto.
 */
export function catenaConsegne(precedenti, mano) {
  const catena = (Array.isArray(precedenti) ? precedenti : []).map((x) => ({ ...x }));
  const ultima = catena[catena.length - 1];
  if (ultima && ultima.device_id === mano.device_id && ultima.preso_il === mano.preso_il) {
    catena[catena.length - 1] = mano;
    return catena;
  }
  catena.push(mano);
  return catena;
}

export function metaDiRientro(manifestOrigine, sessione, extra = {}) {
  const m = manifestOrigine || {};
  const s = sessione || {};
  const adesso = extra.generato_il || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const meta = {
    origine: 'campo',
    schema_version: m.schema_version || '1.0',
    operatore: s.operatore || '',
    matricola: s.matricola || '',
    operatore_ditta: s.operatore_ditta || '',
    giro_iniziato_il: s.iniziato_il || '',
    giro_concluso_il: s.concluso_il || '',
    giro_note: s.note_giro || '',
    giro_tipi_asset: (s.tipi_asset || []).join('|'),
    device_id: s.device_id || '',
    sessione_id: s.sessione_id || m.sessione_id || '',
    impianti: m.impianti || '',
    // Chi ha tenuto il pacchetto, in ordine. `n_controlli` arriva da fuori
    // perché questo modulo non conosce i dati: se chi chiama lo dimentica si
    // perde il numero, non la mano.
    consegne: catenaConsegne(m.consegne, {
      operatore: s.operatore || '',
      matricola: s.matricola || '',
      ditta: s.operatore_ditta || '',
      device_id: s.device_id || '',
      preso_il: s.caricato_il || '',
      consegnato_il: adesso,
      n_controlli: Number(extra.n_controlli) || 0,
    }),
    ...extra,
  };
  for (const k of CHIAVI_UFFICIO) meta[k] = m[k] !== undefined ? m[k] : (k === 'impianti_previsti' ? [] : '');
  return meta;
}

export const E = {
  UI: 'UNITA_IMPIANTI',
  IMPIANTO: 'IMPIANTO',
  EDIFICIO: 'EDIFICIO',
  LOCALE: 'LOCALE',
  OPERATORE: 'OPERATORE',
  ASSET: 'ASSET',
  ANOMALIA: 'ANOMALIA',
  SOSTITUZIONE: 'SOSTITUZIONE',
  INTERVENTO: 'INTERVENTO',
  SCADENZA: 'SCADENZA',
  VERIFICA: 'VERIFICA',
  TIPO_ASSET: 'TIPO_ASSET',
  CATEGORIA: 'CATEGORIA',
  STATO: 'STATO',
  TIPO_ANOMALIA: 'TIPO_ANOMALIA',
  TIPO_CONTROLLO: 'TIPO_CONTROLLO',
  REGOLA: 'REGOLA',
  PIANO: 'PIANO',
  PIANO_CONDIZIONE: 'PIANO_CONDIZIONE',
  PIANO_AZIONE: 'PIANO_AZIONE',
  INTERVENTO_AZIONE: 'INTERVENTO_AZIONE',
  ECCEZIONE: 'ECCEZIONE',
  CAMPO: 'CAMPO',
  CHANGE: 'CHANGE',
};

// L'esito di un controllo.
//
// IDONEO / NON_IDONEO al posto di CONFORME / NON_CONFORME: «conforme» descrive
// un ADEMPIMENTO — la verifica è stata eseguita come prescritto — mentre quello
// che serve leggere su un presidio è se si può usare. Un estintore la cui
// revisione è stata fatta a regola d'arte e che è risultato scarico è conforme
// al controllo e non idoneo all'uso.
export const ESITI = ['IDONEO', 'NON_IDONEO', 'NON_ESEGUITO', 'NON_ACCESSIBILE'];

// I nomi di prima, per leggere l'archivio e i pacchetti scritti fino a ieri.
// Un pacchetto esportato da Scudo prima di questa modifica porta 1190 controlli
// con i nomi vecchi: senza questa traduzione l'app li rifiuterebbe uno per uno.
export const ESITI_STORICI = { CONFORME: 'IDONEO', NON_CONFORME: 'NON_IDONEO' };

export function normalizzaEsito(v) {
  if (!v) return null;
  const u = String(v).trim().toUpperCase();
  const n = ESITI_STORICI[u] || u;
  return ESITI.includes(n) ? n : null;
}
export const GRAVITA = ['ALTA', 'MEDIA', 'BASSA'];
export const STATI_ANOMALIA = ['APERTA', 'IN_CORSO', 'CHIUSA', 'ANNULLATA'];
export const STATI_VERIFICA = ['APERTO', 'RISOLTO', 'ANNULLATO'];

const D = 'dato';
const I = 'id';
const K = 'comodo';

// L'elenco deve corrispondere riga per riga a TABELLE nel gemello Python.
export const TABELLE = [
  { entita: E.UI, file: '0-unita-impianti.csv', titolo: 'Unità impianti', obbligatoria: true, colonne: [
    ['codice', 'Codice', D], ['denominazione', 'Denominazione', D], ['note', 'Note', D],
    ['id', 'ID', I],
  ] },
  { entita: E.IMPIANTO, file: '1-impianti.csv', titolo: 'Impianti', obbligatoria: true, colonne: [
    ['denominazione', 'Impianto', D], ['codice_terna', 'Codice Terna', D],
    ['tipologia', 'Tipologia', D], ['tensione', 'Tensione', D],
    ['comune', 'Comune', D], ['provincia', 'Provincia', D], ['indirizzo', 'Indirizzo', D],
    ['via', 'Via', D], ['civico', 'Civico', D], ['cap', 'CAP', D],
    ['codici_attivita', 'Codici attività (DPR 151/2011)', D],
    ['scia_protocollo', 'SCIA protocollo', D], ['scia_data', 'SCIA del', D],
    ['conformita_ultimo_rinnovo', 'Ultimo rinnovo conformità', D],
    ['conformita_scadenza', 'Conformità scade il', D],
    // Il frontespizio del registro antincendio (20/09/2026): il titolo
    // autorizzativo e le persone. Arriva sul telefono perché è quello che
    // l'operatore deve poter dire ai Vigili del Fuoco stando sul posto.
    ['cpi_numero', 'CPI numero', D],
    ['cpi_rilascio', 'CPI rilasciato il', D],
    ['cpi_scadenza', 'CPI scade il', D],
    ['datore_lavoro', 'Datore di lavoro', D],
    ['medico_competente', 'Medico competente', D],
    ['rspp', 'RSPP', D],
    ['aspp', 'ASPP', D],
    ['rlsa', 'RLSA', D],
    ['responsabile_registro', 'Responsabile del registro', D],
    ['squadra_emergenza', 'Squadra di emergenza', D],
    ['piano_emergenza', 'Piano di emergenza', D],
    ['ultima_prova_evacuazione', 'Ultima prova di evacuazione', D],
    ['distaccamento', 'Distaccamento', D],
    ['presidiato', 'Presidiato', D], ['attivo', 'Attivo', D], ['note', 'Note', D],
    // In coda alle colonne dati (20/09/2026): le COORDINATE dell'impianto. Dove
    // la fonte scritta non basta — «LOCALITÀ PIAN DELLA TORA», una centrale
    // geotermica in mezzo ai campi — un indirizzo porta al paese e un punto
    // porta al cancello. Additive: un pacchetto scritto prima non le ha.
    ['lat', 'Latitudine', D], ['lon', 'Longitudine', D],
    // Da DOVE viene il punto: un rilievo, la sottostazione mappata, o la sola
    // geocodifica dell'indirizzo. Senza, la mappa disegna uguali una posizione
    // presa sul posto e una dedotta da una via — e solo la prima porta al
    // cancello. Sta SOLO sull'impianto: è l'unico livello che ha un indirizzo
    // da cui dedurre qualcosa.
    ['coordinate_origine', 'Origine della posizione', D],
    ['gps_accuratezza_m', 'Accuratezza GPS (m)', D],
    ['gps_rilevato_il', 'Posizione rilevata il', D],
    ['id', 'ID', I], ['ui_id', 'ID unità impianti', I],
  ] },
  { entita: E.EDIFICIO, file: '2-edifici.csv', titolo: 'Edifici', colonne: [
    ['impianto', 'Impianto', K], ['denominazione', 'Edificio', D], ['note', 'Note', D],
    // La posizione presa col GPS sul posto (20/09/2026). L'accuratezza è una
    // colonna sua e non un suffisso: in un foglio «mostrami solo quelle sotto i
    // 25 metri» è la domanda che ci si fa.
    ['lat', 'Latitudine', D], ['lon', 'Longitudine', D],
    ['gps_accuratezza_m', 'Accuratezza GPS (m)', D],
    ['gps_rilevato_il', 'Posizione rilevata il', D],
    ['id', 'ID', I], ['impianto_id', 'ID impianto', I],
  ] },
  { entita: E.LOCALE, file: '3-locali.csv', titolo: 'Locali e aree', colonne: [
    ['impianto', 'Impianto', K], ['edificio', 'Edificio', K],
    ['denominazione', 'Locale / area', D], ['piano', 'Piano', D], ['note', 'Note', D],
    // La posizione presa col GPS sul posto (20/09/2026). L'accuratezza è una
    // colonna sua e non un suffisso: in un foglio «mostrami solo quelle sotto i
    // 25 metri» è la domanda che ci si fa.
    ['lat', 'Latitudine', D], ['lon', 'Longitudine', D],
    ['gps_accuratezza_m', 'Accuratezza GPS (m)', D],
    ['gps_rilevato_il', 'Posizione rilevata il', D],
    ['id', 'ID', I], ['edificio_id', 'ID edificio', I],
  ] },
  { entita: E.ASSET, file: '4-presidi.csv', titolo: 'Presidi antincendio', obbligatoria: true, colonne: [
    ['codice', 'Codice presidio', D],
    ['impianto', 'Impianto', K], ['edificio', 'Edificio', K], ['locale', 'Locale / area', K],
    ['ubicazione_testo', 'Posizione precisa', D],
    // Le coordinate dal GPS del telefono (20/09/2026). GEMELLE di
    // `scudo_pacchetto.py`, nello stesso ordine — il checksum si calcola sui
    // byte dei CSV, e due ordini diversi danno due checksum diversi sugli
    // stessi dati.
    ['lat', 'Latitudine', D], ['lon', 'Longitudine', D],
    ['gps_accuratezza_m', 'Accuratezza GPS (m)', D],
    ['gps_rilevato_il', 'Posizione rilevata il', D],
    ['categoria', 'Categoria', K], ['categoria_codice', 'Codice categoria', D],
    ['identificativo', '#ID targhetta', D], ['matricola', 'Matricola', D],
    ['marca', 'Marca', D], ['modello', 'Modello', D],
    ['anno_costruzione', 'Anno di costruzione', D],
    ['data_installazione', 'Data di installazione', D],
    ['data_messa_servizio', 'Messa in servizio', D],
    ['estinguente', 'Estinguente', D], ['carica_kg', 'Carica (kg)', D],
    ['carrellato', 'Carrellato', D], ['classe_fuoco', 'Classe di fuoco', D],
    ['ultima_revisione', 'Ultima revisione', D], ['ultimo_collaudo', 'Ultimo collaudo', D],
    ['quantita', 'Quantità', D], ['quantita_ko', 'Di cui guasti', D],
    ['stato', 'Stato', K], ['stato_codice', 'Codice stato', D],
    ['vita_utile_mesi', 'Vita utile (mesi)', D],
    ['note', 'Note', D], ['origine_dato', 'Fonte del dato', D],
    ['creato_il', 'Creato il', D], ['creato_da', 'Creato da', D],
    ['modificato_il', 'Modificato il', D], ['modificato_da', 'Modificato da', D],
    ['device_origine', 'Dispositivo', D], ['eliminato_il', 'Rimosso il', D],
    ['id', 'ID', I], ['impianto_id', 'ID impianto', I],
    ['edificio_id', 'ID edificio', I], ['locale_id', 'ID locale', I],
  ] },
  // Il pezzo montato su una postazione è cambiato (18/09/2026). Viaggia nel
  // pacchetto perché il gesto si fa QUI — è in campo che il tecnico monta il
  // muletto — e perché la scheda deve poter dire «c'è un pezzo temporaneo dal …»
  // senza chiedere niente all'ufficio. Gemella in `scudo_pacchetto.py`: stesse
  // colonne, stesso ordine, o il checksum non torna.
  { entita: E.SOSTITUZIONE, file: '5b-sostituzioni.csv', titolo: 'Pezzi sostituiti', colonne: [
    ['asset_codice', 'Codice presidio', K], ['impianto', 'Impianto', K],
    ['ubicazione', 'Ubicazione', K],
    ['data', 'Data', D],
    ['matricola_uscita', 'Matricola uscita', D],
    ['matricola_entrata', 'Matricola entrata', D],
    ['motivo_codice', 'Perché', D], ['motivo', 'Nota sul perché', D],
    ['temporanea', 'Temporanea', D], ['rientro_atteso', 'Rientro atteso', D],
    ['chiusa_il', 'Chiusa il', D], ['esito_chiusura', 'Come si è chiusa', D],
    ['documento_rif', 'Riferimento documento', D],
    ['operatore_nome', 'Operatore', D], ['note', 'Note', D],
    ['registrato_il', 'Registrata il', D], ['device_origine', 'Dispositivo', D],
    // La fotografia del pezzo uscito viaggia con la riga: senza, al rientro
    // dell'originale non si saprebbe che cosa rimettere.
    ['dati_uscita_json', 'Dati del pezzo uscito', D],
    ['id', 'ID', I], ['asset_id', 'ID presidio', I],
    ['intervento_id', 'ID controllo', I], ['sessione_id', 'ID sessione', I],
  ] },
  { entita: E.ANOMALIA, file: '5-anomalie.csv', titolo: 'Anomalie', colonne: [
    ['asset_codice', 'Codice presidio', K], ['impianto', 'Impianto', K],
    ['ubicazione', 'Ubicazione', K],
    ['tipo_codice', 'Che cosa ha', D],
    ['gravita', 'Gravità', D], ['descrizione', 'Descrizione', D],
    ['azione_proposta', 'Azione proposta', D], ['quantita_ko', 'Pezzi guasti', D],
    ['stato', 'Stato', D], ['data_apertura', 'Aperta il', D],
    ['data_chiusura', 'Chiusa il', D], ['origine', 'Origine', D],
    ['note_chiusura', 'Note', D],
    ['registrato_il', 'Registrata il', D], ['device_origine', 'Dispositivo', D],
    ['id', 'ID', I], ['asset_id', 'ID presidio', I],
    ['intervento_apertura_id', 'ID controllo di apertura', I],
    ['sessione_id', 'ID sessione', I],
    // In coda (15/09/2026): «ancora presente», visto in campo. Un pacchetto scritto
    // prima non le ha, e il lettore le lascia vuote.
    ['confermata_il', 'Riconfermata il', D], ['confermata_da', 'Riconfermata da', D],
    // Se questo difetto impedisce di usare il presidio: la risposta di chi ha
    // il pezzo davanti, che vince sul default del suo tipo.
    ['bloccante', 'Impedisce l\'uso', D],
    // In coda (25/09/2026): la verifica del piano a cui l'anomalia si riferisce,
    // scelta — facoltativa — da chi la apre con un controllo non idoneo. Il
    // TESTO, copiato da quel controllo: se il piano cambia, resta quella di
    // quel giorno. Un pacchetto scritto prima non la ha, e il lettore la lascia vuota.
    ['verifica_collegata', 'Verifica collegata', D],
    // In coda (25/09/2026, dall'operatore: «ogni anomalia dovrebbe riportare il
    // progressivo Terna, anche nel csv, perché è quello il dato primario»). È
    // CONTESTO: si scrive all'esportazione dal presidio (anche sulle anomalie
    // vecchie) e l'import non lo legge — il legame vero resta `asset_id`.
    ['asset_identificativo', 'Progressivo Terna', K],
  ] },
  { entita: E.INTERVENTO, file: '6-controlli.csv', titolo: 'Controlli eseguiti', colonne: [
    ['asset_codice', 'Codice presidio', K], ['impianto', 'Impianto', K],
    ['ubicazione', 'Ubicazione', K],
    ['data', 'Data', D], ['tipo_controllo_codice', 'Tipo di controllo', D],
    ['esito', 'Esito', D], ['descrizione', 'Descrizione', D],
    ['azione_eseguita', 'Azione eseguita', D], ['documento_rif', 'Riferimento documento', D],
    ['operatore_nome', 'Operatore', D], ['ditta', 'Ditta', D],
    ['quantita_verificata', 'Pezzi verificati', D], ['quantita_ko', 'Pezzi guasti', D],
    ['note', 'Note', D],
    ['registrato_il', 'Registrato il', D], ['device_origine', 'Dispositivo', D],
    ['id', 'ID', I], ['asset_id', 'ID presidio', I], ['sessione_id', 'ID sessione', I],
    // In coda (formato 4): senza, il piano del controllo spariva al rientro.
    ['piano_id', 'ID piano', I],
    // In coda (18/09/2026): QUALE pezzo era montato quando il controllo è stato
    // fatto. Senza, il primo rientro dal campo la cancellava e il muletto tornava
    // a ereditare la storia del pezzo portato via — in silenzio.
    ['matricola_pezzo', 'Matricola del pezzo', D],
  ] },
  // Le spunte del controllo: portano il TESTO, non solo il codice dell'azione.
  { entita: E.INTERVENTO_AZIONE, file: '6b-controlli-azioni.csv', titolo: 'Verifiche del controllo', colonne: [
    ['asset_codice', 'Codice presidio', K], ['data', 'Data', D],
    ['ordine', 'N.', D], ['testo', 'Che cosa', D], ['fatta', 'Fatta', D],
    ['nota', 'Nota', D],
    ['id', 'ID', I], ['intervento_id', 'ID controllo', I],
    ['azione_id', 'ID azione del piano', I],
  ] },
  { entita: E.SCADENZA, file: '7-scadenze.csv', titolo: 'Scadenzario', colonne: [
    ['asset_codice', 'Codice presidio', K], ['impianto', 'Impianto', K],
    ['ubicazione', 'Ubicazione', K],
    ['data_scadenza', 'Scadenza', D], ['tipo_controllo_codice', 'Tipo di controllo', D],
    ['controllo', 'Controllo', K], ['norma', 'Norma', K],
    ['stato', 'Stato', D], ['origine', 'Origine', D], ['regola_id', 'Regola applicata', D],
    ['id', 'ID', I], ['asset_id', 'ID presidio', I],
    // In coda (19/09/2026): QUALE controllo ha assolto questa scadenza. Il campo
    // lo scrive già quando registra, ma senza questa colonna si perdeva scrivendo
    // il CSV — e appena il pacchetto cambiava mano i presidi già fatti uscivano
    // dal conteggio dell'avanzamento. «In coda» vuol dire in coda agli ID:
    // `ordinate()` scrive prima tutte le colonne dati e poi tutte quelle id.
    ['intervento_id', 'ID controllo', I],
    // In coda agli id (20/09/2026): l'IMPIANTO, per le scadenze che non hanno
    // un presidio — rinnovo del CPI, conformità, prova di evacuazione. Una
    // scadenza ha l'uno o l'altro, mai tutti e due.
    ['impianto_id', 'ID impianto', I],
  ] },
  { entita: E.VERIFICA, file: '8-punti-aperti.csv', titolo: 'Punti aperti da verificare', colonne: [
    ['impianto', 'Impianto', K], ['ambito', 'Ambito', D],
    ['priorita', 'Priorità', D], ['punto_aperto', 'Punto aperto', D],
    ['fonte', 'Fonte', D], ['stato', 'Stato', D],
    ['esito_verifica', 'Esito della verifica', D], ['data_verifica', 'Verificato il', D],
    ['operatore_nome', 'Operatore', D],
    ['id', 'ID', I], ['impianto_id', 'ID impianto', I], ['sessione_id', 'ID sessione', I],
  ] },
  { entita: E.OPERATORE, file: '9-operatori.csv', titolo: 'Operatori', colonne: [
    ['nome', 'Nome', D], ['ditta', 'Ditta', D], ['ruolo', 'Ruolo', D],
    ['certificazione', 'Certificazione', D],
    ['scadenza_certificazione', 'Scadenza certificazione', D],
    ['attivo', 'Attivo', D],
    ['id', 'ID', I],
  ] },
  { entita: E.CATEGORIA, file: 'cataloghi/categorie.csv', titolo: 'Categorie di presidio', obbligatoria: true, colonne: [
    ['codice', 'Codice', D], ['descrizione', 'Categoria', D],
    ['tipo_asset_codice', 'Tipologia tecnica', D], ['famiglia', 'Famiglia', D],
    ['icona', 'Icona', D],
  ] },
  { entita: E.STATO, file: 'cataloghi/stati.csv', titolo: 'Stati del presidio', obbligatoria: true, colonne: [
    ['codice', 'Codice', D], ['descrizione', 'Stato', D],
    ['operativo', 'Operativo', D], ['gravita_implicita', 'Gravità implicita', D],
    ['sospende_scadenze', 'Sospende lo scadenzario', D],
  ] },
  { entita: E.TIPO_ANOMALIA, file: 'cataloghi/tipi-anomalia.csv', titolo: 'Tipi di anomalia', colonne: [
    ['codice', 'Codice', D], ['descrizione', 'Che cosa ha', D],
    ['gravita_suggerita', 'Gravità suggerita', D],
    // ⛔ Il DEFAULT: se un difetto di questo tipo impedisca di dichiarare
    // IDONEO. Non è la gravità — quella dice quanto è urgente riparare, questa
    // se intanto si può usare — e viaggia perché la regola dell'idoneità si
    // applica in campo, dove il catalogo arriva solo da qui.
    ['blocca_idoneita', 'Impedisce IDONEO', D], ['attivo', 'Attivo', D],
  ] },
  { entita: E.TIPO_ASSET, file: 'cataloghi/tipi-presidio.csv', titolo: 'Tipologie tecniche', obbligatoria: true, colonne: [
    ['codice', 'Codice', D], ['descrizione', 'Descrizione', D], ['famiglia', 'Famiglia', D],
  ] },
  { entita: E.TIPO_CONTROLLO, file: 'cataloghi/tipi-controllo.csv', titolo: 'Tipi di controllo', obbligatoria: true, colonne: [
    ['codice', 'Codice', D], ['descrizione', 'Controllo', D], ['norma', 'Norma', D],
    ['genera_scadenza', 'Genera scadenza', D],
    ['frequenza_default_mesi', 'Frequenza predefinita (mesi)', D],
    ['base_calcolo', 'Si conta da', D],
  ] },
  { entita: E.REGOLA, file: 'cataloghi/regole-periodicita.csv', titolo: 'Regole di periodicità', colonne: [
    ['id', 'Codice regola', D], ['tipo_asset_codice', 'Tipologia tecnica', D],
    ['tipo_controllo_codice', 'Tipo di controllo', D],
    ['estinguente', 'Estinguente', D], ['servizio_dal', 'In servizio dal', D],
    ['servizio_al', 'In servizio fino al', D],
    ['frequenza_mesi', 'Frequenza (mesi)', D], ['norma', 'Norma', D],
    ['verificata', 'Verificata sulla norma', D], ['note', 'Note', D],
  ] },
  // I piani sostituiscono le periodicità. Le tre tabelle stanno QUI, in questa
  // posizione esatta: il checksum si calcola sui byte dei CSV nel loro ordine,
  // quindi le due liste gemelle devono restare allineate riga per riga.
  { entita: E.PIANO, file: 'cataloghi/piani-verifica.csv', titolo: 'Piani di verifica', colonne: [
    ['id', 'Codice piano', D], ['codice', 'Sigla', D],
    ['denominazione', 'Piano di verifica', D],
    ['tipo_asset_codice', 'Tipologia tecnica', D],
    ['tipo_controllo_codice', 'Tipo di controllo', D],
    ['norma', 'Norma', D],
    ['frequenza_valore', 'Ogni', D], ['frequenza_unita', 'Unità', D],
    ['base_calcolo', 'Si conta da', D], ['data_fissa', 'Data fissa', D],
    ['condizione_descrizione', 'Si applica quando', D],
    ['priorita', 'Priorità', D],
    // A chi si applica: TIPOLOGIA oppure SU_RICHIESTA. In coda alle colonne
    // esistenti, e nello stesso posto del gemello Python: il checksum si calcola
    // sui byte dei CSV nel loro ordine, quindi due ordini diversi darebbero due
    // checksum diversi sugli stessi dati.
    ['ambito', 'Si applica a', D],
    ['attivo', 'Attivo', D],
    ['verificata', 'Verificata sulla norma', D],
    ['fonte', 'Fonte', D], ['note', 'Note', D],
  ] },
  { entita: E.PIANO_CONDIZIONE, file: 'cataloghi/piani-condizioni.csv', titolo: 'Condizioni dei piani', colonne: [
    ['id', 'Codice condizione', D], ['piano_id', 'Piano', D],
    ['campo', 'Campo', D], ['operatore', 'Operatore', D],
    ['valore', 'Valore', D], ['ordine', 'Ordine', D],
  ] },
  { entita: E.PIANO_AZIONE, file: 'cataloghi/piani-azioni.csv', titolo: 'Azioni dei piani', colonne: [
    ['id', 'Codice azione', D], ['piano_id', 'Piano', D],
    ['ordine', 'Ordine', D], ['testo', 'Che cosa fare', D],
    ['obbligatoria', 'Obbligatoria', D],
  ] },
  // Le deroghe sul singolo presidio: viaggiano con i dati, non coi cataloghi.
  { entita: E.ECCEZIONE, file: '9b-eccezioni.csv', titolo: 'Deroghe sui singoli presidi', colonne: [
    ['asset_codice', 'Codice presidio', K], ['piano_id', 'Piano', D],
    ['azione', 'Che cosa fa', D],
    ['frequenza_valore', 'Ogni', D], ['frequenza_unita', 'Unità', D],
    ['motivo', 'Motivo', D], ['autore', 'Deciso da', D],
    ['creato_il', 'Deciso il', D],
    ['valida_dal', 'Valida dal', D], ['valida_al', 'Valida fino al', D],
    ['id', 'ID', I], ['asset_id', 'ID presidio', I], ['sessione_id', 'ID sessione', I],
  ] },
  { entita: E.CAMPO, file: 'cataloghi/campi.csv', titolo: 'Campi dei presidi', colonne: [
    ['nome', 'Nome tecnico', D], ['etichetta', 'Etichetta', D], ['tipo', 'Tipo', D],
    ['gruppo', 'Gruppo', D], ['gruppo_etichetta', 'Gruppo (etichetta)', D],
    ['modificabile', 'Modificabile', D], ['campo_campo', 'Compilabile in campo', D],
    ['colonna', 'Colonna', D], ['obbligatorio', 'Obbligatorio', D],
    ['categorie', 'Categorie', D], ['opzioni', 'Opzioni', D],
    ['opzioni_da', 'Opzioni da', D], ['dipende_da', 'Dipende da', D],
    ['min', 'Minimo', D], ['max', 'Massimo', D], ['aiuto', 'Aiuto', D],
    // In coda dal 16/09/2026, stesso ordine del gemello Python.
    ['admin', 'Solo admin', D], ['unita_tempo', 'Unità di tempo', D],
  ] },
  { entita: E.CHANGE, file: 'giornale.csv', titolo: 'Giornale delle modifiche', colonne: [
    ['ts_utc', 'Quando (UTC)', D], ['entita', 'Entità', D],
    ['operazione', 'Operazione', D], ['operatore_nome', 'Operatore', D],
    ['device_id', 'Dispositivo', D], ['payload', 'Dettaglio', D],
    ['evento_id', 'ID evento', I], ['entita_id', 'ID record', I],
    ['sessione_id', 'ID sessione', I],
  ] },
];

export const PER_ENTITA = Object.fromEntries(TABELLE.map((t) => [t.entita, t]));
export const PER_FILE = Object.fromEntries(TABELLE.map((t) => [t.file, t]));
const FILE_DATI = TABELLE.map((t) => t.file);

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export class PacchettoNonValido extends Error {
  constructor(messaggio, dettagli = []) {
    super(messaggio);
    this.messaggio = messaggio;
    this.dettagli = dettagli;
  }
}

// --------------------------------------------------------------------------- //
// Valori e intestazioni
// --------------------------------------------------------------------------- //
function testo(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (Array.isArray(v)) return v.join('|');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function normalizzaIntestazione(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function ordinate(tab) {
  const dati = tab.colonne.filter((c) => c[2] !== I);
  const ids = tab.colonne.filter((c) => c[2] === I);
  return dati.concat(ids);
}

// --------------------------------------------------------------------------- //
// CSV
// --------------------------------------------------------------------------- //
function quota(v) {
  const s = testo(v);
  if (s === '') return '';
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function scriviCsv(tab, righe, colonneExtra = []) {
  const tutte = ordinate(tab);
  const dati = tutte.filter((c) => c[2] !== I);
  const ids = tutte.filter((c) => c[2] === I);
  const extra = colonneExtra.map(([n, e]) => [n, e, D]);
  const colonne = dati.concat(extra, ids);

  const out = [colonne.map((c) => quota(c[1])).join(CSV_DELIMITER)];
  for (const r of righe) out.push(colonne.map((c) => quota(r[c[0]])).join(CSV_DELIMITER));
  return encoder.encode(`﻿${out.join('\r\n')}\r\n`);
}

function celle(testoCsv) {
  /* Parser con supporto ai campi quotati: una nota di anomalia contiene spesso
     un punto e virgola o un a capo, e uno split ingenuo la spezzerebbe in due
     colonne rovinando tutte le successive. */
  const righe = [];
  let campo = '';
  let riga = [];
  let inQuote = false;

  const prima = testoCsv.slice(0, testoCsv.indexOf('\n') + 1 || undefined);
  const conta = (ch) => prima.split(ch).length - 1;
  let delim = CSV_DELIMITER;
  if (conta(',') > conta(CSV_DELIMITER)) delim = ',';
  else if (conta('\t') > conta(CSV_DELIMITER)) delim = '\t';

  for (let i = 0; i < testoCsv.length; i += 1) {
    const ch = testoCsv[i];
    if (inQuote) {
      if (ch === '"') {
        if (testoCsv[i + 1] === '"') { campo += '"'; i += 1; } else inQuote = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') { inQuote = true; continue; }
    if (ch === delim) { riga.push(campo); campo = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { riga.push(campo); righe.push(riga); riga = []; campo = ''; continue; }
    campo += ch;
  }
  if (campo !== '' || riga.length) { riga.push(campo); righe.push(riga); }
  return righe;
}

function parsificaCsv(nome, grezzo, tab, campiMeta, avvisi) {
  let t = decoder.decode(grezzo);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  if (!t.trim()) return [];

  const griglia = celle(t);
  if (!griglia.length) return [];
  const intestazioni = griglia[0];

  const perEtichetta = new Map();
  for (const [n, e] of tab.colonne) {
    perEtichetta.set(normalizzaIntestazione(e), n);
    perEtichetta.set(normalizzaIntestazione(n), n);
  }
  for (const c of campiMeta || []) {
    if (!perEtichetta.has(normalizzaIntestazione(c.etichetta))) {
      perEtichetta.set(normalizzaIntestazione(c.etichetta), c.nome);
    }
    if (!perEtichetta.has(normalizzaIntestazione(c.nome))) {
      perEtichetta.set(normalizzaIntestazione(c.nome), c.nome);
    }
  }

  const mappa = [];
  const ignorate = [];
  for (const h of intestazioni) {
    const chiave = perEtichetta.get(normalizzaIntestazione(h)) || null;
    mappa.push(chiave);
    if (!chiave && String(h || '').trim()) ignorate.push(String(h).trim());
  }

  const righe = [];
  for (let i = 1; i < griglia.length; i += 1) {
    const c = griglia[i];
    if (!c.some((x) => (x || '').trim())) continue;
    const r = {};
    for (let j = 0; j < c.length; j += 1) {
      if (!mappa[j]) continue;
      const v = (c[j] || '').trim();
      if (v !== '') r[mappa[j]] = v;
    }
    if (Object.keys(r).length) righe.push(r);
  }
  if (ignorate.length) {
    avvisi.push(`${nome}: colonne non riconosciute e ignorate (${[...new Set(ignorate)].slice(0, 8).join(', ')})`);
  }
  return righe;
}

// --------------------------------------------------------------------------- //
// Checksum
// --------------------------------------------------------------------------- //
async function sha256Hex(bytes) {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const buf = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Fallback(bytes);
}

export async function calcolaChecksum(file) {
  const nomi = FILE_DATI.filter((n) => file.has(n)).sort();
  const pezzi = [];
  let totale = 0;
  for (const n of nomi) {
    const nb = encoder.encode(`${n}\n`);
    const d = file.get(n);
    const nl = encoder.encode('\n');
    pezzi.push(nb, d, nl);
    totale += nb.length + d.length + nl.length;
  }
  const tutto = new Uint8Array(totale);
  let p = 0;
  for (const pezzo of pezzi) { tutto.set(pezzo, p); p += pezzo.length; }
  return sha256Hex(tutto);
}

/* SHA-256 puro, usato solo quando crypto.subtle non è disponibile — cioè
   aprendo la pagina da file:// invece che da un host. */
function sha256Fallback(bytes) {
  const KK = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const l = bytes.length;
  const pad = new Uint8Array((((l + 8) >> 6) + 1) << 6);
  pad.set(bytes);
  pad[l] = 0x80;
  const dv = new DataView(pad.buffer);
  dv.setUint32(pad.length - 4, l << 3, false);
  dv.setUint32(pad.length - 8, Math.floor((l * 8) / 4294967296), false);

  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < pad.length; i += 64) {
    for (let j = 0; j < 16; j += 1) w[j] = dv.getUint32(i + j * 4, false);
    for (let j = 16; j < 64; j += 1) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let j = 0; j < 64; j += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + KK[j] + w[j]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// --------------------------------------------------------------------------- //
// Scrittura
// --------------------------------------------------------------------------- //
function leggimi(manifest) {
  const r = [
    'PACCHETTO SCUDO - rilievo di campo',
    '='.repeat(62), '',
    `Generato il  : ${manifest.generato_il || ''}`,
    `Da           : ${manifest.generato_da || ''}`,
    `Operatore    : ${manifest.operatore || '(non indicato)'}`,
    `Dispositivo  : ${manifest.device_id || ''}`,
    `Impianti     : ${manifest.impianti || '(tutti)'}`,
    '',
    `Codice       : ${manifest.codice || '(nessuno)'}`,
    `Esportato da : ${manifest.esportato_da || '(non indicato)'}`,
    `Operatore previsto: ${manifest.operatore_previsto || '(non indicato)'}`,
    `Periodo      : ${manifest.periodo_da || '?'} - ${manifest.periodo_a || '?'}`,
    `Note         : ${manifest.note_pacchetto || '(nessuna)'}`,
    '', 'CHE COS\'E\'', '-'.repeat(62),
    "Il rilievo eseguito in campo. Un foglio CSV per ogni tipo di dato: si",
    'apre in Excel come una tabella normale.',
    '', 'I FILE', '-'.repeat(62),
  ];
  for (const t of TABELLE) {
    const n = (manifest.file || {})[t.file];
    if (n === undefined) continue;
    r.push(`  ${t.file.padEnd(32)} ${t.titolo} (${n} righe)`);
  }
  r.push(
    '', 'COSA FARNE', '-'.repeat(62),
    'Va importato in Scudo: sezione Scudo -> Campo -> Reimporta il rilievo.',
    'Scudo lo verifica e sostituisce i dati esistenti con questi.',
    '',
    "Non cancellare il rilievo dal telefono finche' Scudo non ha confermato",
    "l'importazione.",
    '', `Codice di controllo: ${manifest.checksum || ''}`, '',
  );
  return encoder.encode(r.join('\r\n'));
}

/**
 * Costruisce l'archivio. `dati` è { entità: [righe con nomi tecnici] }.
 * `campiMeta` serve a decidere quali colonne di dettaglio aggiungere ai presidi.
 */
export async function scriviPacchetto(dati, meta = {}, campiMeta = []) {
  const file = [];
  const mappa = new Map();
  const conteggi = {};

  const dettaglio = (campiMeta || []).filter((c) => c.colonna === false);
  const usati = new Set();
  for (const r of dati[E.ASSET] || []) {
    for (const c of dettaglio) {
      if (r[c.nome] !== undefined && r[c.nome] !== null && r[c.nome] !== '') usati.add(c.nome);
    }
  }
  const extra = (campiMeta || [])
    .filter((c) => usati.has(c.nome))
    .map((c) => [c.nome, c.etichetta]);

  for (const t of TABELLE) {
    const righe = dati[t.entita];
    if (righe === undefined) continue;
    const contenuto = scriviCsv(t, righe, t.entita === E.ASSET ? extra : []);
    file.push({ nome: t.file, dati: contenuto });
    mappa.set(t.file, contenuto);
    conteggi[t.file] = righe.length;
  }

  const manifest = {
    formato: PKG_MAGIC,
    versione: PKG_VERSION,
    generato_il: meta.generato_il || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    generato_da: meta.generato_da || 'Scudo Campo',
    origine: meta.origine || 'campo',
    operatore: meta.operatore || '',
    // Il giro viaggia con i dati. Senza questi campi, "chi ha fatto il
    // controllo, con chi, quando, ed è finito?" resta scritto solo nel telefono
    // dell'operatore, cioè nell'unico posto che l'ufficio non può leggere.
    matricola: meta.matricola || '',
    operatore_ditta: meta.operatore_ditta || '',
    giro_iniziato_il: meta.giro_iniziato_il || '',
    giro_concluso_il: meta.giro_concluso_il || '',
    giro_stato: meta.giro_stato || '',
    giro_note: meta.giro_note || '',
    // Le tipologie che il giro si proponeva di controllare. Senza, in ufficio
    // un giro sugli estintori risulta un giro totale lasciato a metà.
    giro_tipi_asset: meta.giro_tipi_asset || '',
    device_id: meta.device_id || '',
    sessione_id: meta.sessione_id || '',
    impianti: meta.impianti || '',
    // La catena delle mani (19/09/2026). Il manifest NON è un passa-tutto: è
    // costruito da un elenco esplicito di chiavi, in entrambi i gemelli. Una
    // chiave dimenticata qui non rompe niente — sparisce e basta.
    consegne: Array.isArray(meta.consegne) ? meta.consegne : [],
    // I dati dell'ufficio, chiave per chiave come nel gemello Python.
    codice: meta.codice || codicePacchetto(meta.sessione_id),
    esportato_da: meta.esportato_da || '',
    esportato_il: meta.esportato_il || '',
    operatore_previsto: meta.operatore_previsto || '',
    periodo_da: meta.periodo_da || '',
    periodo_a: meta.periodo_a || '',
    note_pacchetto: meta.note_pacchetto || '',
    impianti_previsti: Array.isArray(meta.impianti_previsti) ? [...meta.impianti_previsti] : [],
    schema_version: meta.schema_version || '1.0',
    file: conteggi,
    checksum: await calcolaChecksum(mappa),
  };

  file.push({ nome: MANIFEST, dati: encoder.encode(JSON.stringify(manifest, null, 1)) });
  file.push({ nome: LEGGIMI, dati: leggimi(manifest) });
  return scriviZip(file);
}

// --------------------------------------------------------------------------- //
// Lettura
// --------------------------------------------------------------------------- //
/** Apre e parsifica l'archivio. Ritorna { manifest, dati, avvisi, campi }. */
export async function leggiPacchetto(bytes) {
  if (!bytes || !bytes.length) throw new PacchettoNonValido('File vuoto.');

  if (!sembraZip(bytes)) {
    const testa = decoder.decode(bytes.subarray(0, 400));
    if (testa.toLowerCase().includes('entita')) {
      throw new PacchettoNonValido(
        'Questo è un CSV singolo, il formato vecchio (v1). I pacchetti ora sono '
        + 'archivi .zip con un foglio per tipo di dato: riscaricalo da Scudo.'
      );
    }
    throw new PacchettoNonValido(
      "Il file non è un archivio ZIP. Serve il pacchetto .zip esportato da Scudo."
    );
  }

  let file;
  try {
    file = await leggiZip(bytes);
  } catch (e) {
    throw new PacchettoNonValido(e.message || 'Archivio illeggibile.');
  }

  if (!file.has(MANIFEST)) {
    throw new PacchettoNonValido(
      `Manca ${MANIFEST}: l'archivio non è un pacchetto Scudo, oppure è stato `
      + 'ricreato mettendo i file dentro una sottocartella.'
    );
  }
  let manifest;
  try {
    let t = decoder.decode(file.get(MANIFEST));
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    manifest = JSON.parse(t);
  } catch (e) {
    throw new PacchettoNonValido(`Manifesto illeggibile: ${e.message}`);
  }

  if (manifest.formato !== PKG_MAGIC) {
    throw new PacchettoNonValido(
      `Formato non riconosciuto: atteso ${PKG_MAGIC}, trovato ${manifest.formato || '(assente)'}.`
    );
  }
  if (!(manifest.versione >= PKG_VERSION_MIN && manifest.versione <= PKG_VERSION)) {
    throw new PacchettoNonValido(
      `Versione pacchetto ${manifest.versione} non supportata: questa app legge `
      + `dalla ${PKG_VERSION_MIN} alla ${PKG_VERSION}. Se il numero è più alto, aggiorna l'app.`
    );
  }

  const mancanti = TABELLE.filter((t) => t.obbligatoria && !file.has(t.file)).map((t) => t.file);
  if (mancanti.length) {
    throw new PacchettoNonValido(`Nell'archivio mancano fogli necessari: ${mancanti.join(', ')}`);
  }

  const avvisi = [];
  // I metadati dei campi si leggono per primi: servono a riconoscere le colonne
  // di dettaglio dentro il foglio dei presidi.
  const tabCampi = PER_ENTITA[E.CAMPO];
  const campi = file.has(tabCampi.file)
    ? parsificaCsv(tabCampi.file, file.get(tabCampi.file), tabCampi, [], avvisi).map(normalizzaCampo)
    : [];

  const dati = {};
  for (const t of TABELLE) {
    if (!file.has(t.file)) { dati[t.entita] = []; continue; }
    if (t.entita === E.CAMPO) { dati[t.entita] = campi; continue; }
    try {
      dati[t.entita] = parsificaCsv(t.file, file.get(t.file), t, campi, avvisi);
    } catch (e) {
      throw new PacchettoNonValido(`Foglio ${t.file} illeggibile: ${e.message}`);
    }
  }

  const calcolato = await calcolaChecksum(file);
  manifest._checksum_calcolato = calcolato;
  manifest._modificato = Boolean(manifest.checksum) && calcolato !== manifest.checksum;
  if (manifest._modificato) {
    avvisi.push('Il contenuto è stato modificato dopo l\'esportazione: il codice di controllo non corrisponde.');
  }

  for (const [nome, atteso] of Object.entries(manifest.file || {})) {
    const tab = PER_FILE[nome];
    if (!tab) continue;
    const letto = (dati[tab.entita] || []).length;
    if (letto !== atteso) avvisi.push(`${nome}: dichiarate ${atteso} righe, lette ${letto}.`);
  }

  return { manifest, dati, avvisi, campi };
}

/** I metadati arrivano dal CSV come stringhe: qui tornano tipi utilizzabili. */
function normalizzaCampo(r) {
  const bool = (v) => ['1', 'si', 'sì', 'true', 'vero'].includes(String(v || '').toLowerCase());
  const lista = (v) => (v ? String(v).split('|').filter(Boolean) : null);
  const numero = (v) => (v === undefined || v === '' ? null : Number(v));
  return {
    nome: r.nome,
    etichetta: r.etichetta || r.nome,
    tipo: r.tipo || 'testo',
    gruppo: r.gruppo || 'note',
    gruppo_etichetta: r.gruppo_etichetta || r.gruppo || '',
    modificabile: bool(r.modificabile),
    campo_campo: bool(r.campo_campo),
    colonna: bool(r.colonna),
    obbligatorio: bool(r.obbligatorio),
    categorie: lista(r.categorie),
    opzioni: lista(r.opzioni),
    opzioni_da: r.opzioni_da || null,
    dipende_da: r.dipende_da || null,
    min: numero(r.min),
    max: numero(r.max),
    aiuto: r.aiuto || null,
    admin: bool(r.admin),
    unita_tempo: r.unita_tempo || null,
  };
}

// --------------------------------------------------------------------------- //
// Validazione semantica
// --------------------------------------------------------------------------- //
function numero(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Stessa logica del lato Python: l'operatore scopre il problema in campo e
 *  non al rientro in ufficio. */
export function valida(manifest, dati) {
  const err = [];
  const g = (e) => dati[e] || [];

  const assets = g(E.ASSET);
  const impianti = g(E.IMPIANTO);

  if (!g(E.UI).length) err.push("Il pacchetto non contiene l'unità impianti: rifiutato.");
  if (!impianti.length) err.push('Il pacchetto non contiene impianti: rifiutato.');
  if (!assets.length) err.push('Il pacchetto non contiene presidi: rifiutato.');

  const ids = (e) => new Set(g(e).map((r) => r.id).filter(Boolean));
  const idUi = ids(E.UI);
  const idImpianti = ids(E.IMPIANTO);
  const idEdifici = ids(E.EDIFICIO);
  const idLocali = ids(E.LOCALE);
  const idAssets = ids(E.ASSET);
  const nomiImpianti = new Set(impianti.map((r) => (r.denominazione || '').trim().toUpperCase()).filter(Boolean));
  const codCategorie = new Set(g(E.CATEGORIA).map((r) => r.codice));
  const codStati = new Set(g(E.STATO).map((r) => r.codice));
  const codControlli = new Set(g(E.TIPO_CONTROLLO).map((r) => r.codice));

  // --- coerenza dei piani di verifica -------------------------------------- //
  //
  // Un piano orfano non fa rumore: viene importato, il motore non lo sceglie mai
  // perché la sua tipologia non esiste, e il presidio risulta «senza scadenza
  // calcolata» — la stessa faccia di un dato anagrafico mancante.
  const codTipiAsset = new Set(g(E.TIPO_ASSET).map((r) => r.codice));
  const idPiani = new Set(g(E.PIANO).map((r) => r.id).filter(Boolean));
  const unitaValide = new Set(['GIORNI', 'SETTIMANE', 'MESI', 'ANNI']);

  for (const r of g(E.PIANO)) {
    const nome = r.denominazione || r.id || '?';
    if (codTipiAsset.size && r.tipo_asset_codice && !codTipiAsset.has(r.tipo_asset_codice)) {
      err.push(`Piani di verifica: «${nome}» dichiara la tipologia ${r.tipo_asset_codice}, che non è a catalogo.`);
    }
    if (codControlli.size && r.tipo_controllo_codice && !codControlli.has(r.tipo_controllo_codice)) {
      err.push(`Piani di verifica: «${nome}» dichiara il controllo ${r.tipo_controllo_codice}, che non è a catalogo.`);
    }
    const u = String(r.frequenza_unita || 'MESI').toUpperCase();
    if (!unitaValide.has(u)) {
      err.push(`Piani di verifica: «${nome}» ha unità di periodicità «${u}», che non esiste. `
        + `Ammesse: ${[...unitaValide].sort().join(', ')}.`);
    }
  }

  for (const [ent, etichetta] of [[E.PIANO_AZIONE, 'Azioni dei piani'],
    [E.PIANO_CONDIZIONE, 'Condizioni dei piani'], [E.ECCEZIONE, 'Deroghe']]) {
    for (const r of g(ent)) {
      if (idPiani.size && r.piano_id && !idPiani.has(r.piano_id)) {
        err.push(`${etichetta}: la riga ${r.id} rimanda al piano ${r.piano_id}, che nel pacchetto non c'è.`);
      }
    }
  }


  // I piani sono in elenco perché adesso si possono CREARE in campo: finché
  // nascevano solo dal generatore del seed un id duplicato era impossibile per
  // costruzione, e da quando li scrive un telefono «impossibile» è diventato
  // «non ancora successo». Il gemello Python porta la stessa lista.
  for (const ent of [E.UI, E.IMPIANTO, E.EDIFICIO, E.LOCALE, E.ASSET, E.ANOMALIA,
    E.INTERVENTO, E.SCADENZA, E.VERIFICA, E.OPERATORE,
    E.PIANO, E.PIANO_AZIONE, E.PIANO_CONDIZIONE, E.ECCEZIONE]) {
    const visti = new Set();
    for (const r of g(ent)) {
      if (!r.id) continue;
      if (visti.has(r.id)) err.push(`${PER_ENTITA[ent].titolo}: identificatore duplicato ${r.id}.`);
      visti.add(r.id);
    }
  }

  const codici = new Set();
  for (const a of assets) {
    if (!a.codice) { err.push(`Presidi: riga senza codice (ID ${a.id || 'assente'}).`); continue; }
    if (codici.has(a.codice)) err.push(`Presidi: codice duplicato ${a.codice}.`);
    codici.add(a.codice);
  }

  for (const imp of impianti) {
    if (imp.ui_id && !idUi.has(imp.ui_id)) {
      err.push(`Impianti: ${imp.denominazione || imp.id} fa riferimento a un'unità impianti inesistente.`);
    }
    if (!(imp.denominazione || '').trim()) {
      err.push(`Impianti: riga senza denominazione (ID ${imp.id || 'assente'}).`);
    }
  }
  for (const e of g(E.EDIFICIO)) {
    if (e.impianto_id) {
      if (!idImpianti.has(e.impianto_id)) {
        err.push(`Edifici: ${e.denominazione || e.id} fa riferimento a un impianto inesistente.`);
      }
    } else if (!nomiImpianti.has((e.impianto || '').trim().toUpperCase())) {
      err.push(`Edifici: ${e.denominazione || e.id} — impianto '${e.impianto || ''}' non trovato.`);
    }
  }
  for (const l of g(E.LOCALE)) {
    if (l.edificio_id && !idEdifici.has(l.edificio_id)) {
      err.push(`Locali: ${l.denominazione || l.id} fa riferimento a un edificio inesistente.`);
    }
  }

  for (const a of assets) {
    const eti = a.codice || a.id || '(senza codice)';
    if (a.impianto_id) {
      if (!idImpianti.has(a.impianto_id)) err.push(`Presidi: ${eti} fa riferimento a un impianto inesistente.`);
    } else if (!nomiImpianti.has((a.impianto || '').trim().toUpperCase())) {
      err.push(`Presidi: ${eti} — impianto '${a.impianto || ''}' non trovato.`);
    }
    if (a.edificio_id && !idEdifici.has(a.edificio_id)) err.push(`Presidi: ${eti} fa riferimento a un edificio inesistente.`);
    if (a.locale_id && !idLocali.has(a.locale_id)) err.push(`Presidi: ${eti} fa riferimento a un locale inesistente.`);
    if (codCategorie.size && !codCategorie.has(a.categoria_codice)) {
      err.push(`Presidi: ${eti} — categoria '${a.categoria_codice}' non a catalogo.`);
    }
    if (codStati.size && !codStati.has(a.stato_codice)) {
      err.push(`Presidi: ${eti} — stato '${a.stato_codice}' non a catalogo.`);
    }
    const q = numero(a.quantita);
    const ko = numero(a.quantita_ko);
    if (a.quantita && q === null) err.push(`Presidi: ${eti} — Quantità non è un numero (${a.quantita}).`);
    if (a.quantita_ko && ko === null) err.push(`Presidi: ${eti} — Di cui guasti non è un numero (${a.quantita_ko}).`);
    if (q !== null && ko !== null && ko > q) {
      err.push(`Presidi: ${eti} — pezzi guasti (${ko}) maggiori della quantità totale (${q}).`);
    }
  }

  for (const iv of g(E.INTERVENTO)) {
    const eti = iv.asset_codice || iv.id || '(senza riferimento)';
    if (iv.asset_id) {
      if (!idAssets.has(iv.asset_id)) err.push(`Controlli: ${eti} fa riferimento a un presidio inesistente.`);
    } else if (!codici.has(iv.asset_codice)) {
      err.push(`Controlli: presidio '${iv.asset_codice}' non trovato.`);
    }
    // I nomi di prima restano ACCETTATI in lettura: un pacchetto scritto prima
    // della rinomina porta CONFORME / NON_CONFORME su ogni controllo, e
    // rifiutarli vorrebbe dire respingere riga per riga un giro già fatto.
    if (!normalizzaEsito(iv.esito)) {
      err.push(`Controlli: ${eti} — esito '${iv.esito}' non valido (ammessi: ${ESITI.join(', ')}).`);
    }
    if (codControlli.size && !codControlli.has(iv.tipo_controllo_codice)) {
      err.push(`Controlli: ${eti} — tipo di controllo '${iv.tipo_controllo_codice}' non a catalogo.`);
    }
    if (!iv.data) err.push(`Controlli: ${eti} — manca la data.`);
  }

  for (const an of g(E.ANOMALIA)) {
    const eti = an.asset_codice || an.id || '(senza riferimento)';
    if (an.asset_id) {
      if (!idAssets.has(an.asset_id)) err.push(`Anomalie: ${eti} fa riferimento a un presidio inesistente.`);
    } else if (!codici.has(an.asset_codice)) {
      err.push(`Anomalie: presidio '${an.asset_codice}' non trovato.`);
    }
    if (!GRAVITA.includes(an.gravita)) err.push(`Anomalie: ${eti} — gravità '${an.gravita}' non valida.`);
    if (!STATI_ANOMALIA.includes(an.stato || 'APERTA')) {
      err.push(`Anomalie: ${eti} — stato '${an.stato}' non valido.`);
    }
    if (!(an.descrizione || '').trim()) err.push(`Anomalie: ${eti} — la descrizione è obbligatoria.`);
  }

  for (const sc of g(E.SCADENZA)) {
    if (sc.asset_id && !idAssets.has(sc.asset_id)) {
      err.push(`Scadenze: ${sc.asset_codice || sc.id} fa riferimento a un presidio inesistente.`);
    }
  }

  for (const vf of g(E.VERIFICA)) {
    const eti = vf.ambito || vf.id || '(senza ambito)';
    if (vf.impianto_id && !idImpianti.has(vf.impianto_id)) {
      err.push(`Punti aperti: ${eti} fa riferimento a un impianto inesistente.`);
    }
    if (!STATI_VERIFICA.includes(vf.stato || 'APERTO')) {
      err.push(`Punti aperti: ${eti} — stato '${vf.stato}' non valido.`);
    }
  }

  return err;
}

export function conteggi(dati) {
  const out = {};
  for (const t of TABELLE) {
    const n = (dati[t.entita] || []).length;
    if (n) out[t.titolo] = n;
  }
  return out;
}
