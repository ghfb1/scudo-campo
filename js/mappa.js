/**
 * Scudo Campo — la mappa dei luoghi e dei presidi.
 *
 * Richiesta dell'operatore (20/09/2026): «nella scheda luoghi vorrei anche la
 * modalità mappa zoomabile con i vari impianti, edifici, presidi, in modo che
 * l'utente possa vedere dove si trova lui e dove sono i presidi (con numero
 * progressivo)».
 *
 * ⛔ SENZA SFONDO CARTOGRAFICO, e non è una rinuncia: è la conseguenza della
 * prima regola di quest'app — zero dipendenze e apertura in modalità aereo. Le
 * tessere di una mappa si scaricano, e dentro una cabina non si scarica niente;
 * una mappa che funziona solo con la rete è una mappa che manca esattamente
 * dove serve. Qui si disegnano i PUNTI e le loro distanze vere, con la barra di
 * scala in metri: alla scala di una stazione elettrica — cinquanta, duecento
 * metri — è quello che si guarda davvero, «l'estintore è trenta metri a
 * nord-est della cabina».
 *
 * ⚠️ E senza sfondo la barra di scala non è un ornamento: è l'unica cosa che dà
 * un significato alle distanze. Un puntino a tre centimetri da un altro non
 * vuol dire niente finché non si sa se sono dieci metri o un chilometro.
 *
 * La proiezione è equirettangolare locale, ancorata al centro dei punti. Alla
 * scala di un sito l'errore è sotto il metro, e una proiezione vera
 * (Mercatore, UTM) costerebbe codice e non cambierebbe un pixel.
 */
import { el } from './ui.js';
// ⚠️ Solo la COSTANTE, non le funzioni: `seguiPosizione` continua ad arrivare
// da fuori, perché è l'unico modo di provare questa schermata senza un GPS
// vero. Ma la soglia della precisione è un vocabolario — «precisa» vuol dire
// cinque metri in tutta l'app, e in ufficio lo dice `accuratezzaGps.js` — e
// riscriverla qui sarebbe la terza copia dello stesso numero.
import { ACCURATEZZA_PRECISA_M } from './ubicazione.js';

/** Metri per grado: valori standard, la longitudine si accorcia col coseno. */
const M_PER_GRADO_LAT = 110574;
const M_PER_GRADO_LON = 111320;

/** L'inquadratura minima, in metri: due punti a un metro non si guardano da un metro. */
export const SPAN_MINIMO_M = 60;

/**
 * Da gradi a metri, rispetto a un'origine.
 *
 * `y` cresce verso il BASSO, come in SVG: farlo qui e non nel disegno evita che
 * chi legge il disegno debba tenere a mente un'inversione.
 */
export function inMetri(punto, origine) {
  const lat = Number(punto.lat);
  const lon = Number(punto.lon);
  const lat0 = Number(origine.lat);
  const lon0 = Number(origine.lon);
  return {
    x: (lon - lon0) * M_PER_GRADO_LON * Math.cos((lat0 * Math.PI) / 180),
    y: (lat0 - lat) * M_PER_GRADO_LAT,
  };
}

/**
 * I punti con coordinate leggibili, e basta: gli altri non si disegnano.
 *
 * ⛔ `null` e `undefined` si scartano PER NOME (22/09/2026). `Number(null)` vale
 * **0**, che è finito e sta dentro i limiti: senza questa riga un punto senza
 * coordinate finiva nel Golfo di Guinea, e con lui l'inquadratura di tutta la
 * mappa — misurato aprendo la mappa dell'ufficio, dove l'API manda `null`
 * mentre il pacchetto CSV manda stringhe vuote. Ottocentosettantacinque presidi
 * senza posizione risultavano «geolocalizzati» e la mappa mostrava il Sahara.
 */
export function conPosizione(punti) {
  return (punti || []).filter((p) => {
    if (p.lat === null || p.lat === undefined || p.lon === null || p.lon === undefined) {
      return false;
    }
    const la = Number(p.lat);
    const lo = Number(p.lon);
    return Number.isFinite(la) && Number.isFinite(lo)
      && String(p.lat).trim() !== '' && String(p.lon).trim() !== ''
      && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  });
}

/**
 * L'inquadratura che contiene tutti i punti, in metri.
 *
 * ⚠️ Con UN punto solo non c'è estensione, e una `viewBox` di larghezza zero
 * non disegna niente: si apre un riquadro di `SPAN_MINIMO_M` attorno. Lo stesso
 * vale per due punti a un metro l'uno dall'altro — lo zoom a mille non aiuta
 * nessuno.
 */
export function inquadratura(punti, { margine = 0.15, spanMinimo = SPAN_MINIMO_M } = {}) {
  const buoni = conPosizione(punti);
  if (!buoni.length) return null;
  const origine = {
    lat: buoni.reduce((n, p) => n + Number(p.lat), 0) / buoni.length,
    lon: buoni.reduce((n, p) => n + Number(p.lon), 0) / buoni.length,
  };
  const xy = buoni.map((p) => ({ ...p, ...inMetri(p, origine) }));
  let minX = Math.min(...xy.map((p) => p.x));
  let maxX = Math.max(...xy.map((p) => p.x));
  let minY = Math.min(...xy.map((p) => p.y));
  let maxY = Math.max(...xy.map((p) => p.y));
  let larghezza = maxX - minX;
  let altezza = maxY - minY;
  const lato = Math.max(larghezza, altezza, spanMinimo);
  // Quadrata: una mappa che si deforma fa leggere una distanza est-ovest e una
  // nord-sud con due righelli diversi.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const mezzo = (lato * (1 + margine)) / 2;
  minX = cx - mezzo; minY = cy - mezzo;
  larghezza = mezzo * 2; altezza = mezzo * 2;
  return { origine, punti: xy, minX, minY, larghezza, altezza };
}

/**
 * Una barra di scala «bella»: 1, 2 o 5 per una potenza di dieci.
 *
 * `metriVisibili` è quanto misura il lato del riquadro. Si sceglie il passo più
 * vicino a un quarto della larghezza, perché una barra lunga metà schermo
 * copre i punti e una lunga un decimo non si misura a occhio.
 */
export function passoScala(metriVisibili) {
  const obiettivo = Math.max(1, metriVisibili / 4);
  const potenza = 10 ** Math.floor(Math.log10(obiettivo));
  for (const m of [1, 2, 5, 10]) {
    if (potenza * m >= obiettivo) return potenza * m;
  }
  return potenza * 10;
}

/** «120 m» oppure «1,2 km»: oltre il chilometro i metri non si leggono. */
export function etichettaScala(metri) {
  if (metri >= 1000) {
    const km = metri / 1000;
    return `${(Math.round(km * 10) / 10).toString().replace('.', ',')} km`;
  }
  return `${Math.round(metri)} m`;
}

// --------------------------------------------------------------------------- //
// Lo sfondo satellitare: FACOLTATIVO, e il perché va letto prima di toccarlo
// --------------------------------------------------------------------------- //
/**
 * ⛔ L'app resta offline-first: questo strato è l'unica cosa che chiede la rete,
 * e quando la rete non c'è **non succede niente** — restano la griglia, la barra
 * di scala e i punti, cioè la mappa di prima. Nessun caricamento da aspettare,
 * nessun errore da leggere, nessuna funzione che sparisce.
 *
 * Perché si può fare senza rompere la regola di casa: «zero dipendenze» parla di
 * LIBRERIE — un `<img>` non è una libreria, non entra nel bundle, non ha
 * versioni da aggiornare e non può rompere l'avvio. Se domani il servizio
 * sparisse, questa mappa tornerebbe esattamente com'era ieri.
 *
 * ⚠️ Due cose da sapere, e sono il prezzo:
 * 1. le immagini vengono da **Esri World Imagery**, un servizio di terzi: vuole
 *    l'attribuzione (scritta sotto la mappa quando è acceso) e potrebbe
 *    cambiare condizioni senza avvisare;
 * 2. chiedere una tessera vuol dire **dire a qualcun altro quale riquadro stai
 *    guardando**. Su installazioni come queste non è irrilevante, e per questo
 *    c'è un interruttore e la scelta si ricorda.
 *
 * ⚠️ Le tessere sono in Mercatore, questa mappa è equirettangolare locale. Ogni
 * tessera viene piazzata dai suoi DUE ANGOLI convertiti con `inMetri`: dentro
 * una tessera la differenza fra le due proiezioni è di centimetri, e piazzarle
 * una per una invece di stirare un'immagine sola è ciò che la tiene sotto
 * l'errore visibile anche a cinquanta chilometri.
 */
// ⛔ Esportate dal 22/09/2026: la mappa dell'ufficio ha la sua copia di queste
// due righe (i due lati non possono condividere un file), e
// `scripts/scudo/test_mappa_cross.mjs` confronta i VALORI. Confrontare il
// sorgente non funzionerebbe: qui l'indirizzo è spezzato su due righe, quindi
// un `includes` sul testo direbbe «diversi» su due stringhe identiche.
//
// ⛔ `services.` e non `server.arcgisonline.com` (23/09/2026, segnalazione
// dell'operatore: «la navigazione è lenta»). Stesso servizio, stesse tessere —
// verificato byte per byte — ma misurate dieci tessere diverse, alternate: mediana
// 0,53 s contro 1,48 s. Su uno schermo servono decine di tessere.
export const TESSERE_URL = 'https://services.arcgisonline.com/arcgis/rest/services/'
  + 'World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const TESSERE_ATTRIBUZIONE = 'Immagini: Esri, Maxar, Earthstar Geographics';

/**
 * Le FONTI delle immagini dal satellite (23/09/2026, «le immagini sono troppo
 * vecchie, è possibile usarne di più recenti?»).
 *
 * Misurato sugli impianti veri, con i metadati di Esri:
 *
 * | impianto  | Esri (Vantor)       | Regione Toscana |
 * |-----------|---------------------|-----------------|
 * | SUVERETO  | 21/08/2021, 46 cm   | 2022, 20 cm     |
 * | GROSSETO  | 10/05/2022, 50 cm   | 2022, 20 cm     |
 * | ACCIAIOLO | 19/04/2023, 31 cm   | 2022, 20 cm     |
 * | AREZZO    | 04/03/2025, 31 cm   | 2022, 20 cm     |
 *
 * Non c'è una fonte più recente dappertutto: la Regione è più nuova e più
 * dettagliata a Suvereto, più vecchia ad Acciaiolo e Arezzo. Per questo si
 * SCEGLIE, e sotto la mappa si legge la data della foto Esri della zona.
 *
 * ⚠️ La fonte regionale ha una LICENZA che va rispettata alla lettera: le foto
 * sono di AGEA, concesse alla Regione «per fini istituzionali senza che in
 * alcun modo sia consentito il download delle immagini», e chi le mostra deve
 * citare il testo qui sotto, invariato. Quindi: la citazione è sempre in vista,
 * e nessuna di queste tessere viene salvata dall'app (il service worker non
 * tocca le tessere di nessuna fonte). Resta una scelta A MANO, non il
 * predefinito: se l'uso in un'app aziendale sia coperto va confermato con la
 * Regione, e non è una cosa che il codice può decidere.
 *
 * ⛔ GOOGLE È UNA FONTE DI PROVA, SENZA CHIAVE (23/09/2026, decisione del
 * committente: «puoi trattarla come fonte di prova senza chiave… l'app è sotto
 * password e a breve non sarà raggiungibile nemmeno da github pages»). È
 * l'unica fonte trovata che mostra la sede NUOVA di Suvereto (Esri è del 2021,
 * la Regione del 2022). Ma le tessere vengono dall'indirizzo che usa Google
 * Maps, non dalla sua API: i termini di Google ammettono solo l'API (Map Tiles
 * API, con chiave, 100.000 tessere al mese gratis). Quindi: dichiarata «prova»
 * sul pulsante e nella citazione, nessuna copia salvata (il service worker non
 * tocca le tessere), e PRIMA DI UN USO UFFICIALE va sostituita con l'API o
 * tolta. L'indirizzo può cambiare o essere bloccato senza preavviso: allora
 * la mappa resta sulla griglia, e le altre due fonti sono a un tocco.
 * È la fonte PREDEFINITA (`FONTE_PREDEFINITA`) ed è la prima dei pulsanti.
 *
 * `data` è la riga «📅» sotto la mappa per le fonti con una data sola; Esri
 * non ce l'ha perché la sua data cambia da zona a zona e si chiede ai metadati.
 *
 * GEMELLE di quelle in `frontend/src/components/scudo/mappaGeometria.js`.
 */
export const FONTI_IMMAGINI = {
  google: {
    nome: 'Google', descrizione: 'Google · più recente · prova',
    attribuzione: 'Immagini ©Google · fonte di PROVA senza chiave, non per l\'uso ufficiale',
    data: null,
  },
  esri: {
    nome: 'Esri', descrizione: 'Esri · data diversa per zona',
    attribuzione: TESSERE_ATTRIBUZIONE,
    data: null,
  },
  toscana: {
    nome: 'Toscana 2022', descrizione: 'Regione Toscana · 2022 · 20 cm',
    attribuzione: 'Ortofoto 2022 copyright AGEA - licenza d\'uso concessa a Regione Toscana '
      + 'con la convenzione del 11/07/2024',
    data: '📅 Foto del 2022 · Regione Toscana · 20 cm',
  },
};
/** La fonte con cui si apre la mappa, se non se n'è mai scelta un'altra. */
export const FONTE_PREDEFINITA = 'google';
const TESSERE_GOOGLE = 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}';
const WMS_TOSCANA = 'https://www502.regione.toscana.it/ows_ofc/com.rt.wms.RTmap/wms?map=owsofc'
  + '&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=rt_ofc.5k22.32bit&STYLES='
  + '&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg&BBOX=';
const R_TERRA = 6378137;

/** L'indirizzo di una tessera z/x/y nella fonte scelta. */
export function urlTessera(fonte, z, x, y) {
  if (fonte === 'toscana') {
    // Il WMS vuole il riquadro in metri Mercatore (EPSG:3857): gli stessi
    // confini della tessera z/x/y, quindi le due fonti si sovrappongono esatte.
    const lato = (2 * Math.PI * R_TERRA) / (2 ** z);
    const x0 = -Math.PI * R_TERRA + x * lato;
    const y1 = Math.PI * R_TERRA - y * lato;
    const bbox = [x0, y1 - lato, x0 + lato, y1].map((v) => v.toFixed(2)).join(',');
    return `${WMS_TOSCANA}${bbox}`;
  }
  const modello = fonte === 'google' ? TESSERE_GOOGLE : TESSERE_URL;
  return modello.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

/**
 * La data della foto Esri al livello che si sta guardando, dai metadati.
 *
 * I metadati rispondono con un risultato per LIVELLO (misurato: dieci a
 * Suvereto), ognuno valido fra `MinMapLevel` e `MaxMapLevel`: la foto che si vede
 * è quella del livello corrente, non la prima della lista.
 *
 * @returns `{ data: 'AAAA-MM-GG', chi, cm }` o null
 */
export function dataFotoDaMetadati(risultati, z) {
  const validi = (risultati || []).map((r) => (r && r.attributes) || {})
    .filter((a) => /^\d{8}$/.test(String(a.SRC_DATE || '')));
  const qui = validi.find((a) => Number(a.MinMapLevel) <= z && z <= Number(a.MaxMapLevel)) || validi[0];
  if (!qui) return null;
  const d = String(qui.SRC_DATE);
  const cm = Number(qui.SRC_RES) > 0 ? Math.round(Number(qui.SRC_RES) * 100) : null;
  return { data: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, chi: qui.NICE_DESC || '', cm };
}

// L'indice delle versioni di Esri dice come si chiama il servizio dei metadati
// ATTUALE (cambia a ogni rilascio: «World_Imagery_Metadata» senza data risponde
// 404, misurato). Si legge una volta per sessione.
let indiceMetadati = null;
/**
 * Chiede a Esri la data della foto in un punto. Solo nel browser, e senza
 * rete non succede niente: la riga della data semplicemente non compare.
 */
export async function leggiDataFotoEsri(lat, lon, z) {
  if (typeof fetch !== 'function') return null;
  if (!indiceMetadati) {
    indiceMetadati = fetch('https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json')
      .then((r) => r.json())
      .then((idx) => Object.values(idx).filter((v) => v && v.metadataLayerUrl)
        .sort((a, b) => String(b.itemTitle).localeCompare(String(a.itemTitle)))[0].metadataLayerUrl)
      .catch(() => { indiceMetadati = null; return null; });
  }
  const base = await indiceMetadati;
  if (!base) return null;
  const d = 0.001;
  const url = `${base}/identify?geometry=${lon},${lat}&geometryType=esriGeometryPoint&sr=4326`
    + `&layers=all&tolerance=2&mapExtent=${lon - d},${lat - d},${lon + d},${lat + d}`
    + '&imageDisplay=256,256,96&returnGeometry=false&f=json';
  try {
    const r = await fetch(url);
    return dataFotoDaMetadati((await r.json()).results, z);
  } catch { return null; }
}
const TESSERE_ZOOM_MAX = 19;
/**
 * Quante tessere al massimo per disegno: oltre, è una grandinata di richieste.
 *
 * ⚠️ È un DEFAULT e non un limite assoluto (22/09/2026): su un telefono
 * trentasei tessere coprono lo schermo, su un monitor da ufficio no — e le
 * tessere mancanti si vedono come una fascia bianca, che si legge come «la
 * mappa è rotta». Chi disegna su una finestra grande passa il suo tetto; il
 * confronto fra i due lati resta sul default, che è quello che conta.
 */
const TESSERE_MAX = 36;

/** L'inversa di `inMetri`: da metri locali a gradi. */
export function daMetri(punto, origine) {
  const lat0 = Number(origine.lat);
  const lon0 = Number(origine.lon);
  return {
    lat: lat0 - Number(punto.y) / M_PER_GRADO_LAT,
    lon: lon0 + Number(punto.x) / (M_PER_GRADO_LON * Math.cos((lat0 * Math.PI) / 180)),
  };
}

/** Le formule standard delle mappe a tessere (slippy map), z/x/y. */
export function tesseraDi(lat, lon, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
    z,
  };
}

/** L'angolo NORD-OVEST di una tessera, in gradi. */
export function angoloTessera(x, y, z) {
  const n = 2 ** z;
  const r = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  return { lat: (r * 180) / Math.PI, lon: (x / n) * 360 - 180 };
}

/**
 * Il livello di zoom che fa apparire le tessere alla loro dimensione naturale.
 *
 * Una tessera è 256 px. Se se ne disegnassero venti in uno schermo largo 360 px
 * si scaricherebbero venti immagini per mostrarne una sfocata; se se ne
 * disegnasse un quarto, si vedrebbero i pixel. Si sceglie il livello in cui un
 * pixel di tessera vale circa un pixel di schermo.
 */
export function zoomTessere(latoMetri, larghezzaPx, lat) {
  const perPixel = latoMetri / Math.max(1, larghezzaPx);
  const risoluzione = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 256;
  const z = Math.round(Math.log2(risoluzione / perPixel)) + 8;
  return Math.max(2, Math.min(TESSERE_ZOOM_MAX, z));
}

/**
 * Le tessere che coprono il riquadro visibile, già in coordinate della mappa.
 *
 * @returns `[{ chiave, url, x, y, w, h }]` — vuoto se il riquadro è degenere.
 */
export function tessereVisibili(vista, origine, larghezzaPx, { massimo = TESSERE_MAX, fonte = 'esri' } = {}) {
  const { minX, minY, lato } = vista;
  if (!(lato > 0)) return [];
  // `alto`: la vista non è sempre quadrata (da desktop la mappa è larga quanto
  // lo schermo, 24/09/2026). Senza, è `lato`.
  const alto = vista.alto > 0 ? vista.alto : lato;
  const nw = daMetri({ x: minX, y: minY }, origine);
  const se = daMetri({ x: minX + lato, y: minY + alto }, origine);
  const z = zoomTessere(lato, larghezzaPx, origine.lat);
  const a = tesseraDi(nw.lat, nw.lon, z);
  const b = tesseraDi(se.lat, se.lon, z);
  const fuori = [];
  const n = 2 ** z;
  for (let tx = Math.min(a.x, b.x); tx <= Math.max(a.x, b.x); tx += 1) {
    for (let ty = Math.min(a.y, b.y); ty <= Math.max(a.y, b.y); ty += 1) {
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      const c1 = angoloTessera(tx, ty, z);
      const c2 = angoloTessera(tx + 1, ty + 1, z);
      const p1 = inMetri(c1, origine);
      const p2 = inMetri(c2, origine);
      fuori.push({
        // La chiave porta la fonte: cambiandola, le tessere dell'altra non si
        // riusano per sbaglio (stessa posizione, altra foto).
        chiave: fonte === 'esri' ? `${z}/${tx}/${ty}` : `${fonte}:${z}/${tx}/${ty}`,
        url: urlTessera(fonte, z, tx, ty),
        x: p1.x, y: p1.y, w: p2.x - p1.x, h: p2.y - p1.y,
      });
      if (fuori.length >= massimo) return fuori;
    }
  }
  return fuori;
}

/** La scelta sui dettagli, ricordata come quella sullo sfondo. Spenta di suo. */
const CHIAVE_DETTAGLI = 'scudo-campo:mappa-dettagli';
/**
 * ⛔ DUE interruttori e non uno (22/09/2026, richiesta dell'operatore: «con un
 * toggle dovrebbe essere possibile visualizzare anche i presidi… e deve essere
 * toggabile anche il fatto se sono da controllare o meno»).
 *
 * Prima ce n'era uno solo, «dettagli», che accendeva insieme aree, ubicazioni e
 * presidi e valeva solo sotto i 200 m di scala. I presidi sono la cosa che si
 * cerca sulla mappa — «dov'è quell'estintore» — e le ubicazioni sono il
 * contenitore: tenerli sullo stesso interruttore vuol dire non poter vedere i
 * primi senza le seconde.
 *
 * ⚠️ La SOGLIA resta, ma solo sulle ubicazioni: erano loro il motivo per cui
 * esiste (558 punti che alla scala di una provincia sono una macchia). Sui
 * presidi vince l'interruttore — se l'operatore lo accende, i presidi si
 * vedono — e quando sono troppi per distinguerli lo dice il conteggio, invece
 * di non mostrarli.
 */
function letta(chiave, difetto = false) {
  try { const v = localStorage.getItem(chiave); return v === null ? difetto : v === '1'; }
  catch { return difetto; }
}
function ricorda(chiave, acceso) {
  try { localStorage.setItem(chiave, acceso ? '1' : '0'); } catch { /* niente storage */ }
}

function dettagliAccesi() {
  return letta(CHIAVE_DETTAGLI, false);
}
function ricordaDettagli(acceso) {
  ricorda(CHIAVE_DETTAGLI, acceso);
}

const CHIAVE_PRESIDI = 'scudo-campo:mappa-presidi';
const CHIAVE_DA_FARE = 'scudo-campo:mappa-da-fare';

/**
 * La scelta dell'operatore sullo sfondo, ricordata su QUESTO telefono.
 * ⚠️ La chiave è cambiata il 23/09/2026 («-2»), quando Google è diventata la
 * predefinita: con la vecchia, chi aveva toccato una volta Esri non l'avrebbe
 * mai vista.
 */
const CHIAVE_FONTE = 'scudo-campo:mappa-fonte-2';
/** La fonte delle immagini scelta l'ultima volta; la predefinita se non si è mai scelto. */
function fonteScelta() {
  try {
    const v = localStorage.getItem(CHIAVE_FONTE);
    return FONTI_IMMAGINI[v] ? v : FONTE_PREDEFINITA;
  } catch { return FONTE_PREDEFINITA; }
}
function ricordaFonte(v) {
  try { localStorage.setItem(CHIAVE_FONTE, v); } catch { /* niente */ }
}
const CHIAVE_SFONDO = 'scudo-campo:mappa-satellite';
function sfondoAcceso() {
  try {
    const v = localStorage.getItem(CHIAVE_SFONDO);
    return v === null ? true : v === '1';
  } catch { return true; }
}
function ricordaSfondo(acceso) {
  try { localStorage.setItem(CHIAVE_SFONDO, acceso ? '1' : '0'); } catch { /* niente */ }
}

/**
 * Fin dove si scende, e quando.
 *
 * ⛔ Di default si vedono SOLO gli impianti (20/09/2026, richiesta
 * dell'operatore). Il motivo è aritmetico prima che estetico: gli impianti sono
 * 30, tutto il resto è **1426** fra aree, ubicazioni e presidi. Alla scala di
 * una provincia stanno tutti dentro pochi pixel, quindi non sono «dettaglio in
 * più»: sono una macchia che copre le trenta cose che si stavano cercando.
 *
 * Servono DUE condizioni insieme, e nessuna delle due basta:
 * * l'operatore ha acceso i dettagli — perché scaricare la mappa di un sito
 *   mentre si guida verso un altro non serve a niente;
 * * la scala è quella di un sito, cioè la barra dice **200 m o meno**. È la
 *   distanza a cui «l'estintore è dietro la cabina» comincia a voler dire
 *   qualcosa; sopra, due presidi dello stesso edificio sono lo stesso pixel.
 */
export const SOGLIA_DETTAGLI_M = 200;

/**
 * Quanto resta acceso il GPS quando si chiede «dove sono».
 *
 * ⛔ Dieci secondi, contro i venticinque del pannello che SALVA una posizione
 * (22/09/2026). Le due domande sono diverse: là il numero finisce in archivio e
 * ci resta — vale la pena aspettare il meglio — qui serve per il minuto in cui
 * si guarda la mappa. Tenere acceso un ricevitore oltre a quel minuto è
 * batteria spesa per una risposta che non cambia più.
 */
export const DURATA_DOVE_SONO_MS = 10000;

/**
 * Il lato minimo della vista, in metri: quanto poco può stare in uno schermo.
 *
 * È il fondo corsa dell'ingrandimento, e si esprime in metri apposta — un
 * rapporto di zoom dipende da quanto è grande il corpus e quindi non dice
 * niente.
 *
 * Dieci metri, misurati nel browser vero il 22/09/2026 su SUVERETO:
 *  * il servizio delle immagini arriva al livello 19 (0,22 m per pixel a
 *    questa latitudine); dal 20 in su risponde con un'immagine segnaposto,
 *    «Map data not yet available» — quindi sotto una certa scala si può
 *    solo INGRANDIRE la stessa foto;
 *  * a 33 m di vista la foto è sfocata ma si leggono tetti e alberi, e
 *    l'anello di ±4 m è la precisione vera;
 *  * a 12,8 m la foto è fatta di macchie di colore;
 *  * a 5 m (il limite della v105) era una poltiglia di pixel, e un anello di
 *    ±4 m riempiva lo schermo intero: nessuna informazione in più.
 */
export const LATO_MINIMO_VISTA_M = 10;

/** Quanto si aspetta dopo l'ultimo tasto prima di filtrare e ridisegnare. */
/** Quante volte la lente ingrandisce attorno al punto trascinato. */
export const INGRANDIMENTO_LENTE = 4;
// Ogni mappa ha i SUOI id (la lente li usa): l'app ne costruisce una nuova a
// ogni ridisegno, e due mappe con lo stesso id si ruberebbero il fondo.
let numeroMappa = 0;
/** Sotto questo spostamento un dito su un punto è un tocco, non un trascinamento. */
export const SOGLIA_TRASCINA_PUNTO_PX = 6;
/** La scala a cui si posiziona a mano dall'elenco dei senza posizione: un sito. */
export const LATO_POSIZIONA_M = 300;
export const RITARDO_RICERCA_MS = 150;

/**
 * Quanto si aspetta, a mappa ferma, prima di chiedere a Esri la data della foto:
 * mentre si scorre il centro cambia a ogni istante, e una richiesta per ogni
 * passo sarebbe traffico per una riga che nessuno fa in tempo a leggere.
 */
export const RITARDO_DATA_MS = 700;

/** Larghezza della mappa quando il DOM non la sa dire (le prove in Node). */
const LARGHEZZA_NOMINALE_PX = 360;

/**
 * Dove va il NOME di ogni punto, perché si leggano tutti senza sovrapporsi.
 *
 * ⛔ 22/09/2026, richiesta dell'operatore: «dove le etichette sono troppo
 * ravvicinate, dovresti trovare il modo per far sì che si vedano tutte e due
 * senza sovrapporsi, con una linea che porta al punto o altra strategia».
 *
 * Prima ogni nome provava quattro posti attorno al suo pallino e, se erano
 * tutti presi, SPARIVA. E c'era un secondo difetto, visto solo nel browser
 * vero: un nome si confrontava con i pallini GIÀ disegnati, non con quelli che
 * venivano dopo — quindi «LARDERELLO» e «CALA TELEGRAFO» finivano sotto il
 * pallino di un impianto vicino.
 *
 * Adesso, in quest'ordine:
 *  1. **tutti i pallini occupano il loro posto prima di qualunque nome**: un
 *     nome non si stampa mai su un punto, nemmeno su uno che arriva dopo;
 *  2. ogni nome prova i quattro posti accanto al suo pallino;
 *  3. poi **anelli sempre più larghi**, otto direzioni ciascuno, e quando il
 *     nome finisce lontano porta una **linea guida** fino al suo punto — una
 *     linea che non attraversa nessun altro nome, o non si saprebbe più quale
 *     nome va con quale punto;
 *  4. il nome sta **dentro lo schermo**: uno tagliato dal bordo («RTOFERRAIO»)
 *     è un nome sbagliato, non un nome corto.
 *
 * Un nome resta senza posto solo quando non ce n'è davvero — centinaia di
 * presidi alla scala di una provincia — e chi chiama lo deve DIRE.
 *
 * Pura e senza DOM: la stessa funzione sta, identica, in
 * `frontend/src/components/scudo/mappaGeometria.js`, e le confronta
 * `scripts/scudo/test_mappa_cross.mjs`.
 *
 * @param voci `[{ x, y, rp, w, h }]` in metri, già in ordine di PRIORITÀ (il
 *   primo sceglie per primo); `rp` è il raggio del suo pallino.
 * @param vista `{ minX, minY, lato, altezza }` — `altezza` solo se la parte
 *   VISIBILE non è quadrata (l'ufficio disegna in 16:10 con `slice`: si vede
 *   tutta la larghezza e una fascia centrale dell'altezza). Senza, è `lato`.
 * @returns un elemento per voce: `null` se il nome non trova posto, altrimenti
 *   `{ x, y, w, h, guida }` con `guida` = `{ x1, y1, x2, y2 }` o `null`.
 */
export function piazzaEtichette(voci, vista) {
  const { minX, lato } = vista;
  const alto = vista.altezza ?? lato;
  const minY = vista.minY + (lato - alto) / 2;
  // Il passo della griglia degli ingombri: un nome medio ne tocca poche celle,
  // così il controllo resta locale anche con centinaia di punti in vista.
  const hMedia = voci.length ? voci.reduce((t, v) => t + v.h, 0) / voci.length : 1;
  const cella = Math.max(hMedia * 2, lato / 200, 1e-9);
  const griglia = new Map();
  const celle = (b, fn) => {
    const x0 = Math.floor(b.x / cella); const x1 = Math.floor((b.x + b.w) / cella);
    const y0 = Math.floor(b.y / cella); const y1 = Math.floor((b.y + b.h) / cella);
    for (let i = x0; i <= x1; i += 1) for (let j = y0; j <= y1; j += 1) fn(`${i},${j}`);
  };
  const occupa = (b) => celle(b, (k) => {
    if (!griglia.has(k)) griglia.set(k, []);
    griglia.get(k).push(b);
  });
  const urta = (b) => {
    let si = false;
    celle(b, (k) => {
      if (si) return;
      for (const o of griglia.get(k) || []) {
        if (b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y) {
          si = true; return;
        }
      }
    });
    return si;
  };
  // Una linea guida non deve passare sopra un NOME già messo, e un nome non
  // deve coprire la guida di un altro. I pallini non contano: una guida che
  // sfiora un punto si legge lo stesso, una che taglia un nome no.
  //
  // ⚠️ Intersezione ESATTA segmento-rettangolo (Liang–Barsky), non un
  // campionamento: la prima stesura provava undici punti lungo il segmento, e
  // una guida che tagliava l'ANGOLO di un nome fra due campioni passava.
  // L'ha trovato la prova dei sei punti coincidenti.
  const nomi = [];
  const guide = [];
  const segmentoNelRettangolo = (g, b) => {
    const dx = g.x2 - g.x1; const dy = g.y2 - g.y1;
    let t0 = 0; let t1 = 1;
    const lati = [[-dx, g.x1 - b.x], [dx, b.x + b.w - g.x1], [-dy, g.y1 - b.y], [dy, b.y + b.h - g.y1]];
    for (const [pp, qq] of lati) {
      if (pp === 0) { if (qq < 0) return false; continue; }
      const t = qq / pp;
      if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else {
        if (t < t0) return false; if (t < t1) t1 = t;
      }
    }
    // Toccare il bordo per un tratto nullo non è attraversare.
    return t1 - t0 > 1e-9;
  };
  const margine = lato * 0.01;
  const dentro = (b) => b.x >= minX + margine && b.y >= minY + margine
    && b.x + b.w <= minX + lato - margine && b.y + b.h <= minY + alto - margine;

  // 1. Tutti i pallini, prima di tutti i nomi.
  for (const v of voci) occupa({ x: v.x - v.rp, y: v.y - v.rp, w: v.rp * 2, h: v.rp * 2 });

  // Sedici direzioni: le quattro cardinali per prime (una guida dritta si
  // segue meglio), poi le diagonali, poi quelle intermedie.
  const DIREZIONI = [0, Math.PI, -Math.PI / 2, Math.PI / 2,
    -Math.PI / 4, (-3 * Math.PI) / 4, Math.PI / 4, (3 * Math.PI) / 4,
    ...[1, 3, 5, 7, 9, 11, 13, 15].map((k) => (k * Math.PI) / 8)];
  const esito = new Array(voci.length).fill(null);
  // L'ordine è quello di chi chiama: la PRIORITÀ (gli impianti prima dei
  // presidi). ⚠️ Provato il 22/09/2026 «prima i più affollati», l'euristica
  // classica: sui 24 impianti veri restavano senza posto 3 nomi come prima, e
  // le linee guida salivano da 10 a 14. Non migliora, quindi non c'è.
  voci.forEach((v, k) => { esito[k] = piazzaUna(v); });
  return esito;

  function piazzaUna(v) {
    // Un punto fuori dallo schermo non ha un nome da mettere in vista.
    if (v.x < minX || v.x > minX + lato || v.y < minY || v.y > minY + alto) return null;
    const { x, y, rp, w, h } = v;
    // Una voce SENZA nome (larghezza zero) occupa solo il suo pallino: è il
    // modo in cui l'ufficio fa spazio ai presidi di cui non mostra il nome.
    if (!(w > 0)) return null;
    const vicino = rp * 1.4;
    // ⛔ Se il pallino ne TOCCA un altro, niente posti accanto: si parte dagli
    // anelli, con la guida. Due ragioni, e la seconda è stata misurata:
    //  * un nome «accanto» a due pallini sovrapposti è ambiguo — accanto a
    //    quale? Solo una linea che arriva a UN punto lo dice;
    //  * i primi quattro nomi di un grappolo prendevano i quattro posti accanto
    //    e lo chiudevano in un anello: ogni guida dei nomi successivi doveva
    //    attraversarne uno, quindi non trovavano posto. Sei punti coincidenti
    //    in una mappa vuota: due nomi persi.
    const toccaUnAltro = voci.some((o) => o !== v && Math.hypot(o.x - x, o.y - y) < o.rp + rp);
    const candidati = toccaUnAltro ? [] : [
      { x: x - w / 2, y: y - vicino - h },          // sopra
      { x: x - w / 2, y: y + vicino },              // sotto
      { x: x + vicino, y: y - h / 2 },              // a destra
      { x: x - vicino - w, y: y - h / 2 },          // a sinistra
    ];
    // 2. Gli anelli: la distanza cresce col pallino, così la mappa si comporta
    // allo stesso modo a ogni scala.
    for (const d of [2.5, 4, 6, 9, 13, 18, 24, 31]) {
      for (const a of DIREZIONI) {
        const c = Math.cos(a); const sn = Math.sin(a);
        const cx = x + c * (rp * d + w / 2);
        const cy = y + sn * (rp * d + h / 2);
        candidati.push({ x: cx - w / 2, y: cy - h / 2, lontano: true });
      }
    }
    for (const c of candidati) {
      const b = { x: c.x, y: c.y, w, h };
      if (!dentro(b) || urta(b)) continue;
      // E nemmeno sopra la linea guida di un altro: la si coprirebbe proprio
      // nel punto che dice a chi appartiene quel nome.
      if (guide.some((g) => segmentoNelRettangolo(g, b))) continue;
      let guida = null;
      if (c.lontano) {
        // Dal bordo del pallino al punto del nome più vicino al pallino.
        const qx = Math.min(Math.max(x, b.x), b.x + w);
        const qy = Math.min(Math.max(y, b.y), b.y + h);
        const dd = Math.hypot(qx - x, qy - y) || 1;
        guida = { x1: x + ((qx - x) / dd) * rp, y1: y + ((qy - y) / dd) * rp, x2: qx, y2: qy };
        if (nomi.some((o) => segmentoNelRettangolo(guida, o))) continue;
      }
      occupa(b);
      nomi.push(b);
      if (guida) guide.push(guida);
      return { ...b, guida };
    }
    return null;
  }
}

/**
 * La ricerca sulla mappa, e il nome di un presidio sulla mappa (23/09/2026).
 *
 * Richiesta dell'operatore: «sopra la mappa una barra di ricerca: finché è
 * vuota si vedono tutti gli elementi secondo le caselle, quando si scrive si
 * vede solo ciò che corrisponde (per matricola, progressivo, etc), con la X per
 * cancellare come nei presidi; sia su Scudo Campo sia su Scudo». E: «toccando
 * un'etichetta, in alto dovrebbe mostrare categoria (con emoji), progressivo e
 * matricola — invece mostra SUVERETO-STAZIONE-SALAMT1-TARGA_AV-01, un codice
 * che sul campo non usiamo».
 *
 * Pure, e GEMELLE di quelle in `frontend/src/components/scudo/mappaGeometria.js`
 * (le confronta `scripts/scudo/test_mappa_cross.mjs`): la stessa parola deve
 * trovare le stesse cose sul telefono e in ufficio.
 *
 * ⚠️ Il codice interno NON entra nella ricerca: contiene i nomi di impianto e
 * area, e cercare «suvereto» accenderebbe tutti i presidi di Suvereto invece
 * dell'impianto. Si cerca quello che si legge sul pezzo e nell'elenco.
 */
export function normaRicerca(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Tutte le parole scritte devono comparire, in qualunque ordine. Vuoto: tutto. */
export function corrispondeRicerca(p, testo) {
  const q = normaRicerca(testo);
  if (!q) return true;
  const pagliaio = normaRicerca([p.nome, p.etichetta, ...((p && p.cerca) || [])]
    .filter((x) => x !== null && x !== undefined && x !== '').join(' '));
  return q.split(' ').every((parola) => pagliaio.includes(parola));
}

/**
 * «🔔 Targa acustico-visiva · UISUV-840 · matr. 7663»: che cosa è, poi quale.
 * La matricola è NOMINATA — il numero nudo si legge come un progressivo.
 */
export function nomePresidioMappa(r) {
  const x = r || {};
  const cosa = [x.icona, x.categoria].filter(Boolean).join(' ');
  const matricola = String(x.matricola == null ? '' : x.matricola).trim();
  return [cosa, String(x.identificativo || '').trim(), matricola ? `matr. ${matricola}` : '']
    .filter(Boolean).join(' · ') || 'presidio';
}

export function dettagliVisibili(latoMetri, opzioneAccesa) {
  return Boolean(opzioneAccesa) && passoScala(latoMetri) <= SOGLIA_DETTAGLI_M;
}

/**
 * Quali punti si disegnano, dati gli interruttori e la scala.
 *
 * ⛔ Una funzione a sé e non un `filter` dentro `disegna()`: è la decisione che
 * l'operatore vede — «perché non vedo i presidi?» — e una decisione dentro un
 * ciclo di disegno non si può esercitare in una prova. (È lo stesso motivo per
 * cui `offriControlloDiGruppo` è uscita da `elencoPresidi`.)
 *
 * Le regole, e ognuna ha una ragione diversa:
 *
 * * gli IMPIANTI ci sono sempre: sono trenta e sono il contenitore di tutto;
 * * i PRESIDI li decide l'interruttore, a qualunque scala. Sono la cosa che si
 *   cerca su una mappa, e nasconderli «perché sono troppi» vuol dire rispondere
 *   a una domanda che l'operatore ha già fatto premendo il pulsante;
 * * le UBICAZIONI (aree e locali) vogliono anche la SCALA, come dal 20/09/2026:
 *   sono 558 punti che alla scala di una provincia coprono gli impianti;
 * * «solo da controllare» filtra i soli presidi: un'area non si controlla.
 */
export function puntiDaDisegnare(punti, { presidi, ubicazioni, soloDaFare, latoMetri, ricerca, evidenzia } = {}) {
  // ⛔ Il punto EVIDENZIATO c'è sempre (23/09/2026): è quello per cui la mappa
  // è stata aperta dall'elenco dei presidi. Nessuna casella e nessuna ricerca
  // lo può nascondere — «solo da controllare» acceso su un presidio già fatto
  // aprirebbe una mappa centrata sul niente.
  const sempre = (p) => Boolean(evidenzia) && p.id === evidenzia;
  // ⛔ Con una RICERCA le caselle non contano (23/09/2026): si vede tutto ciò
  // che corrisponde, a ogni livello e a ogni scala. Cercare una matricola con
  // «presidi» spento e non trovare niente direbbe «non c'è» di un pezzo che c'è.
  if (normaRicerca(ricerca)) return (punti || []).filter((p) => sempre(p) || corrispondeRicerca(p, ricerca));
  const fini = dettagliVisibili(latoMetri, ubicazioni);
  return (punti || []).filter((p) => {
    if (sempre(p)) return true;
    if (p.tipo === 'impianto') return true;
    if (p.tipo === 'presidio') return Boolean(presidi) && (!soloDaFare || p.daFare === true);
    return fini;
  });
}

const ICONA = { impianto: '🏭', edificio: '🏢', locale: '📍', presidio: '🧯', io: '📡' };

/**
 * La mappa.
 *
 * @param punti  [{ id, tipo, nome, etichetta, lat, lon }]
 * @param azioni `{ onApri(punto), seguiPosizione, avvisa, spostaPunto, memoria }`
 *   * `spostaPunto(punto, {lat, lon})` — se c'è, compare «✋ sposta i punti»:
 *     trascinando un punto se ne salva la posizione. Risponde `true` se l'ha
 *     salvata; `false` (o un errore) rimette il punto dov'era.
 *   * `memoria` — un oggetto di chi apre la mappa, che sopravvive alla vista:
 *     dentro si ricordano centro, scala, ricerca e modalità. Vedi sotto.
 *   * `evidenzia` — l'id di UN punto da far risaltare (un anello attorno) e da
 *     disegnare sempre, qualunque cosa dicano le caselle; con esso i presidi
 *     partono accesi, SENZA ricordarlo come preferenza. Lo usa la mappa aperta
 *     dall'elenco dei presidi.
 * @returns `{ nodo, chiudi() }` — `chiudi()` spegne il GPS, come ovunque.
 */
export function vistaMappa(punti, azioni = {}) {
  const { onApri, seguiPosizione, avvisa, spostaPunto, evidenzia } = azioni;
  // ⛔ La MEMORIA della vista (23/09/2026). L'app ridisegna tutta la schermata
  // dopo ogni salvataggio, quindi dopo ogni posizione salvata la mappa rinasce:
  // senza memoria tornava alla vista di tutti gli impianti. Con la modalità
  // «sposta i punti» sarebbe successo a OGNI punto spostato — cioè la modalità
  // non si sarebbe potuta usare. Il centro si ricorda in GRADI e non in metri:
  // i metri sono relativi al baricentro dei punti, e spostarne uno lo sposta.
  const memoria = azioni.memoria || null;
  // COPIE dei punti: spostandone uno la mappa ne cambia la posizione, e non
  // deve cambiarla negli oggetti di chi l'ha aperta (le prove condividono gli
  // stessi punti fra una mappa e l'altra, e se ne sono accorte).
  const tutti = (punti || []).map((p) => ({ ...p }));
  const q = inquadratura(tutti);
  const senza = tutti.length - conPosizione(tutti).length;
  const ricavati = conPosizione(tutti).filter((p) => p.ricavata).length;

  if (!q) {
    return {
      nodo: el('div', { class: 'card' }, [
        el('div', { style: 'font-weight:600', testo: 'Niente da mostrare sulla mappa' }),
        el('div', { class: 'mini', style: 'margin-top:4px', testo:
          `Nessuno di questi ${tutti.length} luoghi ha una posizione registrata. `
          + 'Si prende dal loro foglio «dove si trova», stando sul posto: da lì '
          + 'in poi compaiono qui.' }),
      ]),
      chiudi() {},
    };
  }

  // Stato della vista: zoom (1 = il riquadro che contiene tutto, in LARGHEZZA)
  // e spostamento in metri.
  //
  // ⛔ La vista NON è più sempre quadrata (24/09/2026, richiesta
  // dell'operatore: «da desktop la mappa dovrebbe sfruttare al massimo lo
  // schermo… entrare tutto in uno schermo verticalmente ma sfruttare lo spazio
  // orizzontale»). `lato` resta la LARGHEZZA in metri (`q.larghezza / zoom`) e
  // l'altezza è `lato × rapporto`, il rapporto fra altezza e larghezza del
  // riquadro a schermo. Sul telefono il riquadro è quadrato (`aspect-ratio`
  // nel CSS), il rapporto vale 1 e tutto è come prima; nelle prove non c'è un
  // riquadro misurabile, e vale 1 lo stesso.
  let zoom = 1;
  function rapporto() {
    const w = svg.clientWidth; const h = svg.clientHeight;
    return w > 0 && h > 0 ? h / w : 1;
  }
  // Lo zoom che fa stare TUTTO: su un riquadro più largo che alto, la
  // larghezza deve crescere finché l'altezza contiene tutti i punti.
  const zoomTutto = () => Math.min(1, rapporto());
  // Un dito (o due) sulla mappa: le tessere nuove aspettano che si alzi.
  let gesto = false;
  let fondoInSospeso = null;
  function fineGesto() {
    gesto = false;
    if (fondoInSospeso) { const v = fondoInSospeso; fondoInSospeso = null; disegnaFondo(v); }
  }
  let fonte = fonteScelta();
  const leggiData = azioni.leggiDataFoto
    || (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? leggiDataFotoEsri : null);
  // La ricerca, e la vista da rimettere quando la si svuota.
  let ricerca = '';
  let vistaPrima = null;
  let timerRicerca = null;
  // ⚠️ Costruiti QUI, non accanto a `cerca`: `disegna()` gira già durante la
  // costruzione della vista e scrive nella nota della ricerca.
  const campoCerca = el('input', {
    type: 'search', inputmode: 'search', autocomplete: 'off', enterkeyhint: 'search',
    placeholder: 'Cerca matricola, progressivo, categoria, luogo…',
    'aria-label': 'Cerca sulla mappa',
  });
  campoCerca.addEventListener('input', () => {
    clearTimeout(timerRicerca);
    timerRicerca = setTimeout(() => cerca(campoCerca.value), RITARDO_RICERCA_MS);
  });
  // La croce, come nei presidi: `type=search` la disegna da sé su alcuni
  // browser e NON su iOS in una PWA installata, che è dove quest'app vive.
  const svuota = el('button', {
    class: 'btn btn-piccolo cerca-svuota', type: 'button', testo: '✕', hidden: true,
    'aria-label': 'Cancella quello che hai cercato',
    onclick: () => { clearTimeout(timerRicerca); campoCerca.value = ''; cerca(''); campoCerca.focus(); },
  });
  const barraRicerca = el('div', { class: 'cerca-riga mappa-cerca' }, [campoCerca, svuota]);
  const notaRicerca = el('div', { class: 'mini mappa-nota mappa-nota-ricerca', hidden: true });
  // Quanti nomi non hanno trovato posto all'ultimo disegno: si DICE (vedi sotto).
  let nomiSenzaPosto = 0;
  let dx = 0;
  let dy = 0;
  let io = null;
  let seguito = null;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'mappa-svg');
  svg.setAttribute('role', 'img');
  // Le tessere in un gruppo PROPRIO e disegnato per primo: stanno sotto la
  // griglia, i punti e i nomi, che sono le cose che questa mappa afferma.
  const fondo = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.append(fondo);
  const gruppo = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.append(gruppo);

  // 🔍 La LENTE del trascinamento (23/09/2026, dall'operatore: «mentre
  // trasciniamo il dito copre dove lo stiamo posizionando: dovrebbe apparire
  // una bolla di preview su un lato della mappa dove non c'è il dito,
  // zoommata»). Non ridisegna niente: due `<use>` puntano al fondo e ai punti
  // della mappa, con una `viewBox` più stretta attorno al punto che si porta.
  // Gli id sono per QUESTA mappa: l'app ne costruisce una nuova a ogni ridisegno.
  numeroMappa += 1;
  const idFondo = `mappa-${numeroMappa}-fondo`;
  const idGruppo = `mappa-${numeroMappa}-gruppo`;
  fondo.setAttribute('id', idFondo);
  gruppo.setAttribute('id', idGruppo);
  const NS = 'http://www.w3.org/2000/svg';
  const lenteSvg = document.createElementNS(NS, 'svg');
  lenteSvg.setAttribute('class', 'mappa-lente-svg');
  const usaFondo = document.createElementNS(NS, 'use');
  usaFondo.setAttribute('href', `#${idFondo}`);
  const usaGruppo = document.createElementNS(NS, 'use');
  usaGruppo.setAttribute('href', `#${idGruppo}`);
  const lenteMira = document.createElementNS(NS, 'g');
  lenteMira.setAttribute('class', 'mappa-lente-mira');
  lenteSvg.append(usaFondo, usaGruppo, lenteMira);
  const lente = el('div', { class: 'mappa-lente', hidden: true, 'aria-hidden': 'true' }, [lenteSvg]);
  let satellite = sfondoAcceso();
  let dettagli = dettagliAccesi();
  // Aperta su UN presidio, i presidi si vedono: il contesto — quale estintore
  // gli sta accanto — è metà della risposta a «dov'è». Non si scrive nella
  // preferenza: la mappa dei luoghi resta come l'operatore l'ha lasciata.
  let presidi = evidenzia ? true : letta(CHIAVE_PRESIDI, false);
  let soloDaFare = letta(CHIAVE_DA_FARE, false);
  // La mira del posizionamento a mano: `null` quando non si sta posizionando.
  let mira = null;
  let trascinoMira = false;
  // «Sposta i punti»: la modalità, e il punto che si sta trascinando
  // (`{ p, inizio, x0, y0, mosso }`). `appenaTrascinato` spegne il tocco che il
  // browser può mandare alla fine di un trascinamento: senza, lasciare un punto
  // aprirebbe anche la sua scheda.
  let trascinaPunti = Boolean(spostaPunto && memoria && memoria.trascina);
  let trascinoPunto = null;
  let appenaTrascinato = false;
  // Un punto lasciato e IN ATTESA della risposta di `spostaPunto` (che chiede
  // conferma): finché c'è, gli altri punti non si prendono — una domanda alla
  // volta, o non si sa più a quale punto si sta rispondendo.
  let inAttesa = false;
  // Le immagini già create si tengono: una tessera copre sempre lo stesso
  // pezzo di terra, quindi la sua posizione non cambia mai. Ricrearle a ogni
  // spostamento farebbe lampeggiare la mappa e rifare le richieste.
  const tessere = new Map();

  // ⛔ Le tessere di prima RESTANO SOTTO finché le nuove non sono arrivate
  // (23/09/2026, «la navigazione è lenta»). Prima si toglievano tutte al primo
  // cambio di livello, e fino all'arrivo delle nuove — secondi, su un telefono
  // in campo — restava la griglia grigia: la mappa sembrava sparire a ogni
  // pizzico. Adesso si vede la foto di prima, più sfocata o più grande, e
  // quella nuova le si posa sopra. Le vecchie se ne vanno quando tutte le nuove
  // sono pronte, o comunque oltre un tetto (un telefono non tiene centinaia di
  // immagini in pagina).
  const vecchie = new Set();
  const TETTO_VECCHIE = 120;
  function toglieVecchie(tutte = false) {
    const pronte = [...tessere.values()].every((i) => i.__pronta);
    if (!tutte && !pronte && vecchie.size <= TETTO_VECCHIE) return;
    for (const v of vecchie) if (v.parentNode) v.parentNode.removeChild(v);
    vecchie.clear();
  }
  function disegnaFondo(vista) {
    if (!satellite) {
      for (const [, n2] of tessere) { if (n2.parentNode) n2.parentNode.removeChild(n2); }
      tessere.clear();
      toglieVecchie(true);
      aggiornaDataFoto(null);
      return;
    }
    // Il tetto delle tessere segue la GRANDEZZA del riquadro (24/09/2026): da
    // desktop la mappa è larga quanto lo schermo, e trentasei tessere non la
    // coprono tutta — la fascia bianca si legge come «la mappa è rotta». Una
    // tessera si vede fra 181 e 362 px (il livello si arrotonda): si conta la
    // più piccola, più una di bordo per lato. Sul telefono resta 36.
    const pxW = svg.clientWidth || 360;
    const pxH = svg.clientHeight || pxW;
    const massimo = Math.max(TESSERE_MAX, Math.ceil((pxW / 181 + 2) * (pxH / 181 + 2)));
    const volute = tessereVisibili(vista, q.origine, pxW, { fonte, massimo });
    const chiavi = new Set(volute.map((t) => t.chiave));
    for (const [k, n2] of [...tessere]) {
      if (!chiavi.has(k)) {
        tessere.delete(k);
        n2.classList.add('mappa-tessera-vecchia');
        vecchie.add(n2);
      }
    }
    for (const t of volute) {
      if (tessere.has(t.chiave)) continue;
      const img = svgEl('image', {
        x: t.x, y: t.y, width: Math.abs(t.w), height: Math.abs(t.h),
        preserveAspectRatio: 'none', class: 'mappa-tessera',
      });
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', t.url);
      img.setAttribute('href', t.url);
      // ⛔ Senza rete la tessera non arriva, e non deve succedere NIENTE: si
      // toglie l'elemento e resta la griglia. È il caso normale in cabina, non
      // un errore da segnalare — un avviso rosso a ogni tessera mancante
      // renderebbe la mappa inutilizzabile proprio dove serve.
      img.addEventListener('error', () => {
        if (img.parentNode) img.parentNode.removeChild(img);
        tessere.delete(t.chiave);
        toglieVecchie();
      });
      img.addEventListener('load', () => { img.__pronta = true; toglieVecchie(); });
      tessere.set(t.chiave, img);
      // In fondo al gruppo, cioè SOPRA le vecchie.
      fondo.append(img);
    }
    toglieVecchie();
    aggiornaDataFoto(vista);
  }

  // ---------------------------------------------------------------- data della foto
  // Sotto la mappa si legge DI QUANDO è la foto che si sta guardando: è la
  // risposta a «troppo vecchie», e dice dove conviene l'altra fonte. Per Esri
  // la data cambia da zona a zona e si chiede ai suoi metadati, a dito fermo e
  // solo se il centro si è spostato; per le altre fonti è una sola, scritta
  // accanto alla fonte in `FONTI_IMMAGINI`.
  let timerData = null;
  let chiaveData = '';
  function aggiornaDataFoto(vista) {
    clearTimeout(timerData);
    // Satellite spento: `disegnaFondo` passa `null` (un secondo controllo su
    // `satellite` qui era ridondante — misurato: toglierlo lasciava verdi le prove).
    if (!vista) { dataFoto.hidden = true; chiaveData = ''; return; }
    if (FONTI_IMMAGINI[fonte].data) {
      dataFoto.textContent = FONTI_IMMAGINI[fonte].data;
      dataFoto.hidden = false;
      chiaveData = '';
      return;
    }
    // Solo Esri dichiara la data della foto; Google no, e non se la inventa.
    if (!leggiData || fonte !== 'esri') { dataFoto.hidden = true; chiaveData = ''; return; }
    const centro = daMetri({ x: vista.minX + vista.lato / 2, y: vista.minY + (vista.alto || vista.lato) / 2 }, q.origine);
    const z = zoomTessere(vista.lato, svg.clientWidth || 360, centro.lat);
    const chiave = `${centro.lat.toFixed(3)},${centro.lon.toFixed(3)},${z}`;
    if (chiave === chiaveData) return;
    timerData = setTimeout(() => {
      chiaveData = chiave;
      Promise.resolve(leggiData(centro.lat, centro.lon, z)).then((r) => {
        if (chiaveData !== chiave) return;
        dataFoto.textContent = r
          ? `📅 Foto di questa zona: ${r.data.split('-').reverse().join('/')}`
            + `${r.chi ? ` · ${r.chi}` : ''}${r.cm ? ` · ${r.cm} cm` : ''}`
          : '';
        dataFoto.hidden = !r;
      }, () => { dataFoto.hidden = true; });
    }, RITARDO_DATA_MS);
  }
  const barra = el('div', { class: 'mappa-scala' });
  const nota = el('div', { class: 'mini mappa-nota' });
  const avvisoDettagli = el('div', { class: 'mini mappa-nota' });
  // Dovuta al servizio che fornisce le immagini, e utile all'operatore:
  // dice che quel fondo non lo abbiamo disegnato noi e non è un rilievo.
  const attribuzione = el('div', { class: 'mini mappa-nota', testo:
    `${FONTI_IMMAGINI[fonteScelta()].attribuzione} · servono rete; senza, resta la griglia.` });
  const dataFoto = el('div', { class: 'mini mappa-nota mappa-data-foto', hidden: true });

  const svgEl = (nome, attrs = {}) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', nome);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  function disegna() {
    const lato = q.larghezza / zoom;
    const alto = lato * rapporto();
    const minX = q.minX + (q.larghezza - lato) / 2 + dx;
    const minY = q.minY + (q.altezza - alto) / 2 + dy;
    svg.setAttribute('viewBox', `${minX} ${minY} ${lato} ${alto}`);
    if (memoria) {
      memoria.vista = { ...daMetri({ x: minX + lato / 2, y: minY + alto / 2 }, q.origine), lato };
      memoria.ricerca = ricerca;
      memoria.trascina = trascinaPunti;
    }
    svg.setAttribute('aria-label',
      `Mappa: ${q.punti.length} luoghi, riquadro di ${etichettaScala(lato)} di lato`);

    // ⛔ A dito IN MOVIMENTO non si chiedono tessere (23/09/2026): un pizzico
    // attraversa quattro o cinque livelli, e chiederle tutte voleva dire decine
    // di immagini che nessuno avrebbe guardato, in coda davanti a quelle che
    // servivano. Quelle già in pagina si muovono con la mappa (sono in metri);
    // le nuove si chiedono quando il dito si alza.
    if (gesto) fondoInSospeso = { minX, minY, lato, alto };
    else disegnaFondo({ minX, minY, lato, alto });

    while (gruppo.firstChild) gruppo.removeChild(gruppo.firstChild);

    // ⛔ Il fondo non è più grigio e basta (20/09/2026: «non vedo la cartina,
    // sfondo grigio»). Senza tessere non c'è una cartina da vedere — è il
    // vincolo dell'app, non un difetto — ma un vuoto uniforme si legge come
    // «non ha caricato», e a quel punto non si guarda più nemmeno quello che
    // c'è. La griglia ha il PASSO della barra di scala: diventa un righello, e
    // ogni quadrato vale quello che la barra dichiara. Così il fondo dice una
    // cosa vera invece di sembrare rotto.
    // ⛔ Le MISURE in pixel, dalla vista larga del desktop (24/09/2026). Prima
    // ogni grandezza era una frazione di `lato`, cioè della larghezza: su un
    // riquadro quadrato di 360-480 px andava bene, su uno largo 1200 px pallini,
    // nomi e la «N» diventavano tre volte più grandi — misurato nel browser.
    // `corto` è il lato CORTO della vista (sul telefono = `lato`: niente cambia);
    // `pxInMetri` quanti metri vale un pixel.
    const corto = Math.min(lato, alto);
    const pxInMetri = lato / Math.max(1, svg.clientWidth || LARGHEZZA_NOMINALE_PX);
    // Il RIGHELLO e la griglia hanno lo stesso passo («ogni quadrato vale quello
    // che la barra dichiara»). Da desktop la barra sta nella colonna dei comandi,
    // più stretta della mappa: il passo si sceglie su quello che ci entra, e la
    // barra si misura in PIXEL DELLA MAPPA, non in percentuale della colonna —
    // una percentuale della colonna sarebbe un righello sbagliato. Sul telefono
    // la barra è larga quanto la mappa (oltre l'80%) e il passo è quello di sempre.
    const pxMappa = svg.clientWidth || 0;
    const pxBarra = barra.clientWidth || 0;
    const latoRighello = pxMappa > 0 && pxBarra > 0 && pxBarra < pxMappa * 0.8
      ? lato * (pxBarra / pxMappa) : lato;
    const passoG = passoScala(latoRighello);
    const primaX = Math.ceil(minX / passoG) * passoG;
    const primaY = Math.ceil(minY / passoG) * passoG;
    for (let x = primaX; x < minX + lato; x += passoG) {
      gruppo.append(svgEl('line', { x1: x, y1: minY, x2: x, y2: minY + alto,
        class: 'mappa-griglia' }));
    }
    for (let y = primaY; y < minY + alto; y += passoG) {
      gruppo.append(svgEl('line', { x1: minX, y1: y, x2: minX + lato, y2: y,
        class: 'mappa-griglia' }));
    }
    // Il nord: su una mappa senza sfondo non c'è nessun altro appiglio per
    // orientarla, e «trenta metri a nord-est della cabina» ha senso solo se si
    // sa da che parte sia il nord.
    const nord = Math.min(corto, 480 * pxInMetri);
    const nx = minX + nord * 0.06;
    const ny = minY + nord * 0.06;
    gruppo.append(svgEl('line', { x1: nx, y1: ny + nord * 0.05, x2: nx, y2: ny,
      class: 'mappa-nord' }));
    const nt = svgEl('text', { x: nx, y: ny - nord * 0.012, 'text-anchor': 'middle',
      'font-size': nord * 0.035, class: 'mappa-nord-testo' });
    nt.textContent = 'N';
    gruppo.append(nt);
    // I raggi si scalano con la vista: un punto grande come tutta la mappa non
    // dice dov'è, e uno di un pixel non si tocca.
    // Al massimo 12 px: sul telefono (fino a 480 px di larghezza) è il
    // quarantesimo di sempre.
    const r = Math.min(corto / 40, 12 * pxInMetri);
    // I livelli sotto l'impianto si vedono solo alle due condizioni insieme.
    // La scala si legge sul lato CORTO: su una vista larga, «a che scala siamo»
    // è la domanda del telefono girato, non della larghezza dello schermo.
    const finiVisibili = dettagliVisibili(corto, dettagli);
    const daDisegnare = puntiDaDisegnare(q.punti,
      { presidi, ubicazioni: dettagli, soloDaFare, latoMetri: corto, ricerca, evidenzia });
    const elenco = io ? [...daDisegnare, { ...io, tipo: 'io', nome: 'Sei qui', etichetta: '' }] : daDisegnare;
    // ⛔ I nomi non si accavallano, e dal 22/09/2026 non spariscono più:
    // quando non c'è posto accanto al pallino, si allontanano con una linea
    // guida. Tutta la regola sta in `piazzaEtichette`, che è pura e condivisa
    // con la mappa dell'ufficio.
    //
    // Gli impianti prima dei presidi: quando lo spazio non basta per tutti, a
    // perdere il nome dev'essere il dettaglio, non il contenitore.
    const PESO = { io: 0, impianto: 1, edificio: 2, locale: 3, presidio: 4 };
    // L'evidenziato ha il nome per primo dopo «Sei qui»: è quello che si cerca.
    const peso = (p) => (evidenzia && p.id === evidenzia && p.tipo !== 'io' ? 0.5 : (PESO[p.tipo] ?? 9));
    elenco.sort((a, b) => peso(a) - peso(b));

    // ⛔ «Sei qui» ha misure in PIXEL, non in proporzione al riquadro
    // (22/09/2026, segnalazione dell'operatore: «non vedo il cerchio
    // trasparente intorno alla posizione, vedo solo il pallino blu»).
    //
    // Misurato nel browser vero, due difetti uno sull'altro:
    //  * il cerchio coincideva con il pallino (`Math.max(accuratezza, r)` è
    //    «almeno grande quanto il pallino»): a zoom 1 pallino 649,5 m e
    //    cerchio 649,5 m, a zoom 100 6,5 e 6,5;
    //  * e il puntino blu veniva dipinto PER PRIMO — l'ordine serve a dare la
    //    precedenza al suo nome — quindi finiva SOTTO il pallino rosso
    //    dell'impianto. Chi apre la mappa sta quasi sempre sopra un impianto:
    //    il suo puntino era coperto sempre.
    const rIo = Math.max(r * 0.55, 6 * pxInMetri);
    const misure = elenco.map((p) => {
      // Il presidio porta la sua emoji SUL PUNTO, non nel nome (23/09/2026,
      // «togli l'emoji dal progressivo sulla mappa»): ripeterla accanto al
      // numero la dice due volte e allarga il nome per niente.
      const testo = p.tipo === 'presidio' ? `${p.etichetta || p.nome}`
        : `${ICONA[p.tipo] || '•'} ${p.etichetta || p.nome}`;
      const corpo = r * 1.6;
      // Larghezza stimata: non esiste un modo di misurare il testo prima di
      // disegnarlo senza un DOM vero, e questa mappa deve funzionare anche nel
      // DOM finto delle prove. 0,55 del corpo per carattere è la stima larga
      // per un carattere di sistema — larga apposta: sbagliare per eccesso
      // allontana un nome, sbagliare per difetto ne impasta due.
      // Il presidio è un'EMOJI: deve leggersi, quindi è più grande di un pallino
      // (misurato nel browser: a r pieno l'emoji era di 12 px, riconoscibile a
      // fatica sopra il satellite).
      return { testo, corpo, x: p.x, y: p.y,
        rp: p.tipo === 'io' ? rIo : (p.tipo === 'presidio' ? r * 1.3 : r),
        w: testo.length * corpo * 0.55, h: corpo * 1.2 };
    });
    // `piazzaEtichette` vuole il QUADRATO di lato `lato` e l'altezza visibile
    // centrata dentro (è il modo in cui la usa l'ufficio): da qui la cima del
    // quadrato, che con una vista larga sta sopra quella visibile.
    const posti = piazzaEtichette(misure, { minX, minY: minY - (lato - alto) / 2, lato, altezza: alto });
    // ⚠️ Si contano solo i punti DENTRO lo schermo: `piazzaEtichette` risponde
    // `null` anche per chi è fuori vista, e contarli faceva dire «13 nomi non
    // stanno a questa scala» dopo aver centrato la mappa su di me — misurato
    // nel browser vero il 22/09/2026, erano tredici impianti fuori dal riquadro.
    nomiSenzaPosto = posti.filter((x, k) => x === null && misure[k].x >= minX
      && misure[k].x <= minX + lato && misure[k].y >= minY && misure[k].y <= minY + alto).length;

    let gruppoIo = null;
    let gruppoEvidenziato = null;
    elenco.forEach((p, k) => {
      const { testo, corpo, rp } = misure[k];
      // `data-id`: chi è questo punto, anche quando il suo nome non trova posto
      // sullo schermo (le prove del trascinamento lo cercano così).
      const g = svgEl('g', { class: `mappa-punto mappa-${p.tipo}`, 'data-id': p.id || '' });
      if (p.tipo === 'io' && Number.isFinite(Number(p.accuratezza))) {
        // Il raggio è la precisione in METRI VERI: alla scala di un sito è la
        // misura, e si legge sul righello della griglia.
        //
        // ⚠️ Il minimo NON è la precisione: è la soglia sotto la quale un anello
        // non si vedrebbe (16 px, e comunque più largo di un pallino
        // d'impianto, che spesso sta proprio lì sotto). Quando scatta vuol dire
        // «più preciso di quanto questa scala possa mostrare» — e il numero
        // esatto è scritto nella nota e sul pulsante, che è la ragione per cui
        // è lecito arrotondare qui e non altrove.
        g.append(svgEl('circle', {
          cx: p.x, cy: p.y,
          r: Math.max(Number(p.accuratezza), 16 * pxInMetri, r * 1.3),
          class: 'mappa-accuratezza' }));
      }
      // L'anello del punto evidenziato: in PIXEL come «Sei qui», non in
      // proporzione — a 40 m di vista un anello di un quarantesimo si
      // confonderebbe con l'alone dei presidi accanto.
      const evidenziato = Boolean(evidenzia) && p.id === evidenzia && p.tipo !== 'io';
      if (evidenziato) {
        g.classList.add('mappa-evidenziato');
        g.append(svgEl('circle', { cx: p.x, cy: p.y,
          r: Math.max(rp * 1.9, 18 * pxInMetri), class: 'mappa-anello' }));
      }
      // ⛔ Un punto RICAVATO non si disegna come uno rilevato (20/09/2026).
      //
      // Nove impianti su trenta hanno una posizione dedotta: sei dalla
      // sottostazione mappata in OpenStreetMap con lo stesso nome (misurata a
      // 61-452 m dall'indirizzo, e a 168-228 m dai pin dell'operatore sui
      // quattro impianti che li avevano già), tre dalla sola geocodifica della
      // via. Sono utili — dicono in che via andare — e NON sono un rilievo: non
      // portano al cancello. Disegnarli identici insegnerebbe a fidarsi di un
      // punto quanto dell'altro, e la prima volta che uno sbaglia si smette di
      // fidarsi di tutti e due.
      // ⛔ Un presidio CON LAVORO da fare si vede senza aprirlo (22/09/2026):
      // il colore lo distingue da uno in regola, ed è la domanda che porta
      // qualcuno a guardare la mappa prima di scendere dalla macchina.
      g.append(svgEl('circle', { cx: p.x, cy: p.y, r: rp,
        class: `mappa-pallino${p.ricavata ? ' mappa-ricavata' : ''}`
          + `${p.daFare ? ' mappa-da-fare' : ''}` }));
      // ⛔ Il presidio è la sua EMOJI DI CATEGORIA, non un pallino verde
      // (23/09/2026, richiesta dell'operatore: «così è più chiaro»). Otto
      // pallini verdi in una sala quadri dicono «otto cose»; un estintore, una
      // lampada e una porta dicono quali. Il pallino resta SOTTO, come alone:
      // stacca l'emoji dal satellite, e in ambra dice ancora «da controllare».
      if (p.tipo === 'presidio') {
        const em = svgEl('text', { x: p.x, y: p.y, 'text-anchor': 'middle',
          'dominant-baseline': 'central', 'font-size': rp * 1.35, class: 'mappa-emoji' });
        em.textContent = p.icona || ICONA.presidio;
        g.append(em);
      }

      const posto = posti[k];
      if (posto) {
        if (posto.guida) {
          // La guida si disegna PRIMA del nome, così il nome le sta sopra.
          g.append(svgEl('line', { x1: posto.guida.x1, y1: posto.guida.y1,
            x2: posto.guida.x2, y2: posto.guida.y2, class: 'mappa-guida' }));
        }
        const t = svgEl('text', {
          x: posto.x + posto.w / 2, y: posto.y + posto.h * 0.82,
          'text-anchor': 'middle', 'font-size': corpo,
        });
        t.textContent = testo;
        g.append(t);
      }
      if (onApri && p.tipo !== 'io') {
        g.setAttribute('tabindex', '0');
        g.addEventListener('click', () => {
          if (appenaTrascinato) { appenaTrascinato = false; return; }
          onApri(p);
        });
      }
      // ⛔ In modalità «sposta i punti» il dito su un punto prende IL PUNTO, non
      // la mappa (23/09/2026, richiesta dell'operatore: «quando è attivata, si
      // possono spostare gli elementi sulla mappa e quello gli modifica la
      // posizione salvata»). Fuori dalla modalità non cambia niente: un punto
      // spostato per sbaglio mentre si scorre la mappa è una posizione sbagliata
      // salvata senza volerlo.
      if (trascinaPunti && p.tipo !== 'io') {
        g.classList.add('mappa-trascinabile');
        g.addEventListener('pointerdown', (e) => {
          if (mira || inAttesa) return;
          appenaTrascinato = false;
          trascinoPunto = { p, inizio: { x: e.clientX, y: e.clientY }, x0: p.x, y0: p.y,
            lat0: p.lat, lon0: p.lon, mosso: false };
          preso = null;
          if (e.stopPropagation) e.stopPropagation();
          // Il dito resta della MAPPA finché non si alza: il punto sotto il dito
          // viene ridisegnato a ogni passo, e col tocco il browser consegna gli
          // eventi all'elemento su cui il dito si è posato — che sparisce.
          try { if (svg.setPointerCapture && e.pointerId !== undefined) svg.setPointerCapture(e.pointerId); } catch { /* niente */ }
        });
      }
      if (p.tipo === 'io') gruppoIo = g;
      else if (evidenziato) gruppoEvidenziato = g;
      else gruppo.append(g);
    });
    // L'evidenziato si dipinge sopra gli altri punti (e sotto «Sei qui»): in
    // una sala con dodici presidi, il suo anello non deve finire sotto le
    // emoji dei vicini.
    if (gruppoEvidenziato) gruppo.append(gruppoEvidenziato);
    // ⛔ «Sei qui» si dipinge per ULTIMO, sopra tutto: è la cosa che si cerca,
    // e l'operatore sta quasi sempre sopra un impianto. La precedenza del NOME
    // (primo della lista) e l'ordine della PITTURA (ultimo) sono due domande
    // diverse, ed erano state risposte con lo stesso ordine.
    if (gruppoIo) gruppo.append(gruppoIo);

    // ⛔ Quando l'opzione è accesa ma la scala è troppo larga, si DICE. Senza,
    // l'operatore accende i dettagli, non vede cambiare niente e conclude che
    // il pulsante è rotto — che è peggio di non averlo.
    const righe = [];
    if (dettagli && !finiVisibili) {
      righe.push(`🏢 Aree e ubicazioni compaiono sotto i ${SOGLIA_DETTAGLI_M} m di scala: `
        + `ingrandisci ancora (adesso ${etichettaScala(passoScala(corto))}).`);
    }
    // ⚠️ Quando un nome non trova posto nemmeno con la linea guida, si DICE
    // quanti sono: una manciata di pallini senza etichetta, senza spiegazione,
    // si legge come «la mappa ha smesso di funzionare».
    const nPresidi = daDisegnare.filter((x) => x.tipo === 'presidio').length;
    if (nomiSenzaPosto > 0) {
      righe.push(`🏷️ ${nomiSenzaPosto} ${nomiSenzaPosto === 1 ? 'nome non sta' : 'nomi non stanno'} `
        + 'a questa scala: ingrandisci per leggerli.');
    }
    if (presidi && soloDaFare) {
      righe.push(`⚑ Solo i presidi con qualcosa da controllare (${nPresidi} qui).`);
    }
    avvisoDettagli.textContent = righe.join(' ');
    avvisoDettagli.hidden = righe.length === 0;

    // La ricerca DICE che cosa ha trovato, e soprattutto che cosa non può
    // mostrare: oggi quasi nessun presidio ha una posizione, e «è in archivio
    // ma non ha una posizione» e «non esiste» sono due risposte diverse.
    if (normaRicerca(ricerca)) {
      const trovati = tutti.filter((x) => corrispondeRicerca(x, ricerca));
      const inMappa = conPosizione(trovati).length;
      notaRicerca.textContent = !trovati.length
        ? `🔎 Niente corrisponde a «${ricerca.trim()}».`
        : `🔎 ${trovati.length} ${trovati.length === 1 ? 'corrisponde' : 'corrispondono'} a `
          + `«${ricerca.trim()}»: ${inMappa} sulla mappa`
          + (trovati.length - inMappa
            ? `, ${trovati.length - inMappa} senza posizione (non si possono mostrare qui).` : '.')
          + ' Le caselle non contano finché si cerca.';
      notaRicerca.hidden = false;
    } else {
      notaRicerca.hidden = true;
    }

    // ⛔ La croce si disegna per ULTIMA, sopra tutto: è la cosa che si sta
    // muovendo, e se finisse sotto un'etichetta non si vedrebbe più dov'è.
    // Il braccio è lungo mezzo schermo apposta — una crocetta piccola si copre
    // col dito proprio mentre la si sposta, che è l'unico momento in cui serve.
    if (mira) {
      const b = corto * 0.22;
      const g = svgEl('g', { class: 'mappa-mira' });
      g.append(svgEl('line', { x1: mira.x - b, y1: mira.y, x2: mira.x + b, y2: mira.y }));
      g.append(svgEl('line', { x1: mira.x, y1: mira.y - b, x2: mira.x, y2: mira.y + b }));
      g.append(svgEl('circle', { cx: mira.x, cy: mira.y, r: corto / 55,
        class: 'mappa-mira-centro' }));
      // Il bersaglio del dito è molto più grande del disegno: prendere una
      // linea di un pixel con il pollice non riesce.
      const presa = svgEl('circle', { cx: mira.x, cy: mira.y, r: corto / 12,
        class: 'mappa-mira-presa' });
      presa.addEventListener('pointerdown', (e) => {
        trascinoMira = true;
        preso = { x: e.clientX, y: e.clientY };
        if (e.stopPropagation) e.stopPropagation();
      });
      g.append(presa);
      gruppo.append(g);
    }

    const passo = passoG;
    barra.textContent = '';
    barra.append(el('span', { class: 'mappa-scala-barra',
      style: pxMappa > 0 && latoRighello < lato
        ? `width:${(passo / lato) * pxMappa}px` : `width:${(passo / lato) * 100}%` }));
    barra.append(el('span', { class: 'mini', testo: etichettaScala(passo) }));
  }

  // ⛔ Si può rimpicciolire SOTTO il riquadro che contiene tutto (20/09/2026,
  // segnalazione dell'operatore: «dobbiamo poter zoomare meno»). Prima il minimo
  // era 1, cioè «tutti i punti a filo dei bordi»: i due impianti agli angoli
  // finivano mezzi fuori e non si capiva quanto fossero lontani da tutto il
  // resto. Un quarto lascia aria intorno senza rendere i punti invisibili.
  const ZOOM_MIN = 0.25;
  // ⛔ E il massimo si esprime in METRI, non in un rapporto (22/09/2026,
  // segnalazione dell'operatore: «dovremmo poter zoommare più di 100 m, anche a
  // costo di perdere qualità»).
  //
  // Era `ZOOM_MAX = 400`, cioè «quattrocento volte il riquadro che contiene
  // tutto» — e quel riquadro sui trenta impianti veri è largo 25 979 m, quindi
  // il fondo corsa cadeva a 65 m di vista. Un rapporto non dice niente da solo:
  // sullo stesso codice, aperto su un impianto solo, gli stessi 400 arrivavano
  // a qualche centimetro. La domanda vera è «quanti metri sta in uno schermo»,
  // e quella si scrive in metri.
  //
  // Le tessere del satellite si fermano al livello 19: sotto, la stessa
  // immagine viene ingrandita e sfoca. È un compromesso accettato
  // esplicitamente — e la geometria NON sfoca: griglia, barra di scala e
  // cerchio della precisione restano esatti, perché sono disegnati, non
  // scaricati.
  const zoomMassimo = () => Math.max(1, q.larghezza / LATO_MINIMO_VISTA_M);
  const zooma = (fattore) => {
    zoom = Math.min(zoomMassimo(), Math.max(Math.min(ZOOM_MIN, zoomTutto()), zoom * fattore));
    if (zoom === zoomTutto()) { dx = 0; dy = 0; }
    disegna();
  };

  // Trascinamento: con il dito e con il mouse, un solo percorso.
  let preso = null;
  svg.addEventListener('pointerdown', (e) => { preso = { x: e.clientX, y: e.clientY }; gesto = true; });
  svg.addEventListener('pointermove', (e) => {
    if (trascinoPunto) {
      const lato = q.larghezza / zoom;
      const larghezzaPx = (svg.clientWidth || 320);
      const ddx = e.clientX - trascinoPunto.inizio.x;
      const ddy = e.clientY - trascinoPunto.inizio.y;
      // Sotto qualche pixel è un TOCCO, non un trascinamento: apre la scheda
      // come sempre, e la posizione non si tocca.
      if (!trascinoPunto.mosso && Math.hypot(ddx, ddy) < SOGLIA_TRASCINA_PUNTO_PX) return;
      trascinoPunto.mosso = true;
      trascinoPunto.p.x = trascinoPunto.x0 + (ddx / larghezzaPx) * lato;
      trascinoPunto.p.y = trascinoPunto.y0 + (ddy / larghezzaPx) * lato;
      disegna();
      // La lente ingrandisce il lato CORTO: su una vista larga, la larghezza
      // la renderebbe una lente che quasi non ingrandisce.
      mostraLente(trascinoPunto.p, e.clientX, Math.min(lato, lato * rapporto()));
      return;
    }
    if (!preso) return;
    const lato = q.larghezza / zoom;
    const larghezzaPx = (svg.clientWidth || 320);
    // Con la mira in mano si muove LEI, non la mappa: spostare il fondo sotto
    // una croce ferma è l'altro modo di farlo, e sarebbe una seconda cosa da
    // imparare in un momento in cui si sta già facendo attenzione a un punto.
    if (trascinoMira && mira) {
      mira.x += ((e.clientX - preso.x) / larghezzaPx) * lato;
      mira.y += ((e.clientY - preso.y) / larghezzaPx) * lato;
      preso = { x: e.clientX, y: e.clientY };
      aggiornaMira();
      disegna();
      return;
    }
    dx -= ((e.clientX - preso.x) / larghezzaPx) * lato;
    dy -= ((e.clientY - preso.y) / larghezzaPx) * lato;
    preso = { x: e.clientX, y: e.clientY };
    disegna();
  });
  const mollo = () => { preso = null; trascinoMira = false; fineGesto(); };
  /**
   * Il punto lasciato: si salva dove è stato lasciato. Uscito dalla mappa o
   * interrotto (una seconda dita, una telefonata) torna dov'era: una posizione
   * si salva solo dove il dito l'ha LASCIATA, non dove è capitato.
   */
  /**
   * La lente sopra la mappa, nell'angolo OPPOSTO al dito: se il dito è nella
   * metà sinistra sta in alto a destra, e viceversa. Ingrandisce
   * `INGRANDIMENTO_LENTE` volte attorno al punto, con una croce nel centro
   * esatto — è lì che il punto verrà lasciato.
   */
  function mostraLente(p, xDito, lato) {
    const r = svg.getBoundingClientRect ? svg.getBoundingClientRect() : { left: 0, width: 320 };
    const aDestra = (xDito - r.left) < (r.width || 320) / 2;
    const l = lato / INGRANDIMENTO_LENTE;
    lenteSvg.setAttribute('viewBox', `${p.x - l / 2} ${p.y - l / 2} ${l} ${l}`);
    while (lenteMira.firstChild) lenteMira.removeChild(lenteMira.firstChild);
    const b = l * 0.12;
    for (const [x1, y1, x2, y2] of [[p.x - b, p.y, p.x + b, p.y], [p.x, p.y - b, p.x, p.y + b]]) {
      const ln = document.createElementNS(NS, 'line');
      for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) ln.setAttribute(k, v);
      lenteMira.append(ln);
    }
    lente.setAttribute('class', `mappa-lente ${aDestra ? 'mappa-lente-destra' : 'mappa-lente-sinistra'}`);
    lente.hidden = false;
  }
  function nascondiLente() { lente.hidden = true; }

  function lasciaPunto(salva) {
    const t = trascinoPunto;
    trascinoPunto = null;
    nascondiLente();
    if (!t || !t.mosso) return;
    appenaTrascinato = true;
    const { p } = t;
    const rimetti = () => {
      p.x = t.x0; p.y = t.y0; p.lat = t.lat0; p.lon = t.lon0;
      disegna();
    };
    if (!salva) { rimetti(); return; }
    const g = daMetri({ x: p.x, y: p.y }, q.origine);
    p.lat = g.lat; p.lon = g.lon;
    // Anche la copia che usa la ricerca: inquadrando i risultati il punto deve
    // stare dove è stato messo.
    const originale = tutti.find((x) => x.id === p.id && x.tipo === p.tipo);
    if (originale) { originale.lat = g.lat; originale.lon = g.lon; }
    disegna();
    inAttesa = true;
    Promise.resolve()
      .then(() => spostaPunto(p, { lat: g.lat, lon: g.lon }))
      .finally(() => { inAttesa = false; })
      .then((ok) => {
        if (ok === false) {
          if (originale) { originale.lat = t.lat0; originale.lon = t.lon0; }
          rimetti();
        }
      }, (e) => {
        if (originale) { originale.lat = t.lat0; originale.lon = t.lon0; }
        rimetti();
        if (avvisa) avvisa((e && e.message) || String(e));
      });
  }
  svg.addEventListener('pointerup', () => { lasciaPunto(true); mollo(); });
  svg.addEventListener('pointercancel', () => { lasciaPunto(false); mollo(); });
  svg.addEventListener('pointerleave', () => { lasciaPunto(false); mollo(); });

  /**
   * Zoom attorno a un PUNTO dello schermo (le dita, il cursore): quello che
   * sta sotto resta sotto. `zooma` ingrandisce attorno al centro, ed è giusto
   * per i pulsanti; per un pizzico no — la cabina fra le dita scivolerebbe via.
   */
  function zoomaVerso(fattore, cx, cy) {
    const r = svg.getBoundingClientRect ? svg.getBoundingClientRect() : null;
    if (!r || !(r.width > 0)) { zooma(fattore); return; }
    const nuovo = Math.min(zoomMassimo(), Math.max(Math.min(ZOOM_MIN, zoomTutto()), zoom * fattore));
    const prima = q.larghezza / zoom / r.width;
    const dopo = q.larghezza / nuovo / r.width;
    dx += (cx - (r.left + r.width / 2)) * (prima - dopo);
    dy += (cy - (r.top + r.height / 2)) * (prima - dopo);
    zoom = nuovo;
    disegna();
  }

  // Pizzicare: due dita, la distanza fra loro è lo zoom.
  //
  // ⛔ E la PAGINA non deve ingrandirsi (24/09/2026, dall'operatore: «se
  // zoommiamo con le dita non dovrebbe zoommare la pagina ma la mappa»). Tre
  // strade, una per ambiente, e ognuna va fermata:
  //  * dita su un telefono: `touchmove` a due dita, fermato qui (e
  //    `touch-action: none` nel CSS del riquadro);
  //  * iOS Safari, che ingrandisce con i suoi eventi `gesture*` anche quando
  //    i `touch*` sono fermati: si fermano anche quelli;
  //  * il TRACKPAD di un portatile, dove il pizzico arriva come rotella con
  //    `ctrlKey`: prima la mappa non ascoltava la rotella affatto, quindi
  //    ingrandiva la pagina. Ora la rotella, con o senza pizzico, è della mappa.
  let distanza = null;
  const fra = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  svg.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length === 2) {
      distanza = fra(e.touches); preso = null; gesto = true;
      // Due dita sono uno ZOOM: il punto che si stava portando torna a posto.
      lasciaPunto(false);
      if (e.preventDefault) e.preventDefault();
    }
  }, { passive: false });
  svg.addEventListener('touchmove', (e) => {
    if (!distanza || !e.touches || e.touches.length !== 2) return;
    const adesso = fra(e.touches);
    if (adesso > 0 && distanza > 0) {
      zoomaVerso(adesso / distanza, (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2);
    }
    distanza = adesso;
    if (e.preventDefault) e.preventDefault();
  }, { passive: false });
  svg.addEventListener('touchend', () => { distanza = null; fineGesto(); });
  const fermaGesto = (e) => { if (e.preventDefault) e.preventDefault(); };
  svg.addEventListener('gesturestart', fermaGesto, { passive: false });
  svg.addEventListener('gesturechange', fermaGesto, { passive: false });
  svg.addEventListener('gestureend', fermaGesto, { passive: false });
  // La rotella e il pizzico del trackpad. `deltaMode` 1 = righe (Firefox con
  // la rotella del mouse): una riga vale circa 16 px. Il pizzico è più fine
  // della rotella, quindi pesa di più a parità di delta.
  let timerRotella = null;
  svg.addEventListener('wheel', (e) => {
    if (e.preventDefault) e.preventDefault();
    const delta = Number(e.deltaY || 0) * (e.deltaMode === 1 ? 16 : 1);
    if (!delta) return;
    gesto = true;
    zoomaVerso(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
    // Le tessere nuove si chiedono quando la rotella si ferma, come a dito alzato.
    clearTimeout(timerRotella);
    timerRotella = setTimeout(fineGesto, 200);
  }, { passive: false });

  const bottone = (testo, fn, etichetta) => el('button', {
    class: 'btn btn-piccolo', type: 'button', testo, 'aria-label': etichetta || testo, onclick: fn,
  });

  /**
   * Una CASELLA, non un pulsante (22/09/2026, richiesta dell'operatore: «sulla
   * mappa, i pulsanti vanno trasformati in checkbox per spuntare o non spuntare
   * ciò che vogliamo vedere»).
   *
   * ⛔ È la stessa correzione già fatta sui filtri dei presidi il 16/09: due
   * pastiglie che cambiano colore si leggono come ETICHETTE, non come comandi,
   * e non dicono che si possono accendere insieme. Qui ce ne sono quattro che
   * si combinano — satellite, presidi, solo da controllare, ubicazioni — e un
   * pulsante che cambia scritta («🧯 presidi» / «🧯 senza presidi») costringe a
   * leggere per sapere in che stato è. Una casella lo mostra.
   */
  const casella = (testo, acceso, onCambia, etichetta) => {
    const inp = el('input', { type: 'checkbox' });
    inp.checked = Boolean(acceso);
    inp.addEventListener('change', () => onCambia(Boolean(inp.checked)));
    const lab = el('label', { class: 'mappa-casella' }, [
      inp, el('span', { testo }),
    ]);
    if (etichetta) lab.setAttribute('aria-label', etichetta);
    lab.casella = inp;
    return lab;
  };

  // L'interruttore dello sfondo. Serve per due motivi diversi e tutti e due
  // veri: i dati del telefono, e il fatto che chiedere una tessera dice a
  // qualcun altro quale riquadro si sta guardando.
  // La FONTE delle immagini: due pulsanti che si leggono come una scelta, con
  // quella in uso premuta. Si vede solo con il satellite acceso.
  const pulsanteFonte = (chiave) => el('button', {
    class: `btn btn-piccolo mappa-fonte${fonte === chiave ? ' btn-primario' : ''}`, type: 'button',
    testo: FONTI_IMMAGINI[chiave].descrizione, 'aria-pressed': fonte === chiave ? 'true' : 'false',
    onclick: () => {
      if (fonte === chiave) return;
      fonte = chiave;
      ricordaFonte(chiave);
      for (const b of pulsantiFonte) {
        const su = b.__fonte === chiave;
        b.classList.toggle('btn-primario', su);
        b.setAttribute('aria-pressed', su ? 'true' : 'false');
      }
      attribuzione.textContent = `${FONTI_IMMAGINI[fonte].attribuzione} · servono rete; senza, resta la griglia.`;
      chiaveData = '';
      disegna();
    },
  });
  const pulsantiFonte = Object.keys(FONTI_IMMAGINI).map((k) => { const b = pulsanteFonte(k); b.__fonte = k; return b; });
  const sceltaFonte = el('div', { class: 'mappa-fonti', hidden: !satellite },
    [el('span', { class: 'mini mappa-fonti-titolo', testo: 'Immagini dal satellite:' }), ...pulsantiFonte]);

  const btnSat = casella('🛰 satellite', satellite, (acceso) => {
    satellite = acceso;
    ricordaSfondo(satellite);
    aggiornaSat();
    disegna();
  }, 'Mostra o nasconde le immagini dal satellite');
  function aggiornaSat() {
    btnSat.casella.checked = satellite;
    attribuzione.hidden = !satellite;
    sceltaFonte.hidden = !satellite;
    // Sopra una fotografia il nero su bianco non basta più: i nomi vogliono un
    // contorno e la griglia deve schiarirsi, o diventano tutti e due invisibili
    // sopra un tetto scuro. Una classe sola, e decide il CSS.
    svg.setAttribute('class', `mappa-svg${satellite ? ' mappa-con-sfondo' : ''}`);
  }

  const btnDett = casella('🏢 ubicazioni', dettagli, (acceso) => {
    dettagli = acceso;
    ricordaDettagli(dettagli);
    aggiornaDett();
    disegna();
  }, 'Mostra o nasconde aree e ubicazioni');
  function aggiornaDett() {
    btnDett.casella.checked = dettagli;
  }

  // ⛔ I PRESIDI hanno un interruttore loro (22/09/2026, richiesta
  // dell'operatore). Stavano insieme ad aree e ubicazioni, e sono la cosa che
  // si cerca su una mappa: «dov'è quell'estintore» è la domanda, il resto è il
  // contenitore.
  const btnPresidi = casella('🧯 presidi', presidi, (acceso) => {
    presidi = acceso;
    ricorda(CHIAVE_PRESIDI, presidi);
    aggiornaPresidi();
    disegna();
  }, 'Mostra o nasconde i presidi');
  function aggiornaPresidi() {
    btnPresidi.casella.checked = presidi;
    // «solo da controllare» non ha senso senza i presidi: sparisce con loro,
    // invece di restare spuntabile sopra un elenco vuoto.
    btnDaFare.hidden = !presidi;
  }

  const btnDaFare = casella('⚑ solo da controllare', soloDaFare, (acceso) => {
    soloDaFare = acceso;
    ricorda(CHIAVE_DA_FARE, soloDaFare);
    aggiornaDaFare();
    disegna();
  }, 'Mostra solo i presidi con qualcosa da controllare');
  function aggiornaDaFare() {
    btnDaFare.casella.checked = soloDaFare;
  }

  // ⛔ La LEGENDA: è la regola della casa — ogni colore che compare deve
  // comparire in legenda, o «scuro» non ha un valore. Qui serve anche perché i
  // colori dicono un LIVELLO (impianto, area, ubicazione, presidio) e non una
  // gravità, e senza scritto si leggerebbero come un semaforo.
  const legenda = el('div', { class: 'mappa-legenda' }, [
    el('span', { class: 'mappa-legenda-voce' }, [
      el('span', { class: 'mappa-legenda-segno legenda-impianto' }), 'impianto']),
    el('span', { class: 'mappa-legenda-voce' }, [
      el('span', { class: 'mappa-legenda-segno legenda-edificio' }), 'area']),
    el('span', { class: 'mappa-legenda-voce' }, [
      el('span', { class: 'mappa-legenda-segno legenda-locale' }), 'ubicazione']),
    el('span', { class: 'mappa-legenda-voce' }, [
      // Il presidio si riconosce dalla sua emoji di categoria (🧯 💡 🚪…),
      // su un alone chiaro: la legenda lo dice a parole.
      el('span', { class: 'mappa-legenda-segno legenda-presidio' }), 'presidio (la sua emoji)']),
    el('span', { class: 'mappa-legenda-voce' }, [
      el('span', { class: 'mappa-legenda-segno legenda-da-fare' }), 'presidio da controllare']),
    el('span', { class: 'mappa-legenda-voce' }, [
      el('span', { class: 'mappa-legenda-segno legenda-ricavata' }), 'posizione ricavata']),
  ]);

  // ⛔ Lo stato del GPS sta sul PULSANTE, non in una riga in fondo
  // (22/09/2026, segnalazione dell'operatore: «ancora non vedo quando sta
  // prendendo la posizione e quando no»).
  //
  // La nota c'era già e diceva tutto — ma stava sotto la barra di scala, sotto
  // otto comandi e sotto una legenda di sei voci: su un telefono, fuori
  // schermo. Un messaggio che nessuno vede non è un messaggio. L'unica cosa
  // che chi ha premuto sta sicuramente guardando è il tasto che ha premuto,
  // quindi è il tasto a dirlo: cambia parola, porta il numero mentre scende, e
  // torna com'era quando il ricevitore è spento.
  const btnGps = bottone('📡 dove sono', () => avviaGps(), 'Trova la mia posizione');
  const gpsAcceso = (acceso, testo) => {
    btnGps.textContent = testo;
    btnGps.classList.toggle('mappa-gps-acceso', Boolean(acceso));
    // Per chi non vede il colore né l'animazione: lo stato si legge.
    btnGps.setAttribute('aria-busy', acceso ? 'true' : 'false');
  };

  // ✋ La modalità «sposta i punti»: c'è solo se chi apre la mappa sa salvare
  // una posizione (l'app di campo sì; una mappa in sola lettura no).
  const btnTrascina = spostaPunto
    ? bottone('✋ sposta i punti', () => impostaTrascina(!trascinaPunti), 'Sposta i punti sulla mappa')
    : null;
  const barraTrascina = el('div', { class: 'mappa-trascina-barra', hidden: true }, [
    el('div', { class: 'mini', testo: '✋ Trascina un punto dove sta davvero: quando lo lasci '
      + 'ti chiedo se spostarlo lì. La mappa si sposta trascinando fuori dai punti.' }),
    el('button', { class: 'btn btn-piccolo btn-primario', type: 'button', testo: '✓ Fine',
      onclick: () => impostaTrascina(false) }),
  ]);
  function impostaTrascina(acceso) {
    trascinaPunti = Boolean(spostaPunto && acceso);
    if (!trascinaPunti) trascinoPunto = null;
    if (btnTrascina) {
      btnTrascina.classList.toggle('btn-primario', trascinaPunti);
      btnTrascina.setAttribute('aria-pressed', trascinaPunti ? 'true' : 'false');
    }
    barraTrascina.hidden = !trascinaPunti;
    disegna();
  }

  // ⛔ In DUE gruppi a griglia (24/09/2026, richiesta dell'operatore:
  // «migliora il posizionamento dei pulsanti, allineandoli»). Erano nove
  // elementi in fila che andavano a capo dove capitava: righe di lunghezze
  // diverse, pulsanti di larghezze diverse, nessuna colonna. Adesso una riga
  // per MUOVERE la mappa (＋ － tutto, dove sono) e una griglia a due colonne
  // uguali per che cosa MOSTRARE e come; sotto, le fonti una per riga.
  const comandi = el('div', { class: 'mappa-comandi' }, [
    el('div', { class: 'mappa-comandi-vista' }, [
      bottone('＋', () => zooma(1.6), 'Ingrandisci'),
      bottone('－', () => zooma(1 / 1.6), 'Rimpicciolisci'),
      bottone('⤢ tutto', () => { zoom = zoomTutto(); dx = 0; dy = 0; disegna(); }, 'Inquadra tutto'),
      btnGps,
    ]),
    el('div', { class: 'mappa-comandi-caselle' }, [
      btnTrascina,
      btnSat,
      btnPresidi,
      btnDaFare,
      btnDett,
    ].filter(Boolean)),
  ]);

  function avviaGps() {
    if (!seguiPosizione) return;
    if (seguito) { seguito.ferma('nuovo'); seguito = null; }
    gpsAcceso(true, '📡 cerco il segnale…');
    nota.textContent = '📡 Cerco il segnale…';
    // ⛔ La mappa si SPOSTA su di me, e la scala resta quella che era
    // (22/09/2026, richiesta dell'operatore: «quando clicchiamo su dove sono
    // deve portare a dove siamo con la mappa, mantenendo la stessa scala che
    // abbiamo prima di cliccarci, senza modificarla»).
    //
    // Prima il puntino compariva e basta: alla scala di una provincia era un
    // pixel da cercare, e alla scala di un sito quasi sempre fuori dal
    // riquadro — cioè il pulsante sembrava non fare niente. Cambiare anche lo
    // zoom sarebbe l'errore opposto: chi ha inquadrato una cabina sta
    // guardando quella, e ritrovarsi alla scala di prima è come essere
    // riportati indietro.
    //
    // ⚠️ Si centra solo al PRIMO segnale: le letture successive migliorano la
    // precisione, e riagganciare la mappa a ogni aggiornamento strapperebbe di
    // mano lo spostamento a chi nel frattempo la sta trascinando.
    let centrato = false;
    seguito = seguiPosizione({
      // ⛔ DIECI secondi, non venticinque (22/09/2026, segnalazione
      // dell'operatore: «sembra che il satellite rimanga sempre attivo perché
      // dove sono si aggiusta di continuo, facendo consumare batteria»).
      //
      // I venticinque secondi del pannello che SALVA una posizione hanno una
      // ragione: quel numero finisce in archivio e ci resta, quindi vale la
      // pena aspettare il meglio. Qui la domanda è un'altra — «dove sono
      // adesso» — e la risposta serve per un minuto: dieci secondi bastano, e
      // il resto è ricevitore acceso per niente.
      durataMs: DURATA_DOVE_SONO_MS,
      // E se la precisione arriva prima, si smette prima: sotto i cinque metri
      // non c'è più niente da guadagnare.
      fermaSottoM: ACCURATEZZA_PRECISA_M,
      onAggiorna: (migliore) => {
        io = { ...inMetri(migliore, q.origine), accuratezza: migliore.accuratezza };
        if (!centrato) {
          centrato = true;
          dx = io.x - (q.minX + q.larghezza / 2);
          dy = io.y - (q.minY + q.altezza / 2);
        }
        gpsAcceso(true, `📡 misuro… ±${migliore.accuratezza ?? '?'} m`);
        nota.textContent = `📡 Sei qui, ±${migliore.accuratezza ?? '?'} m — sto ancora misurando…`;
        disegna();
      },
      onErrore: (e) => {
        gpsAcceso(false, '📡 dove sono');
        nota.textContent = '';
        if (avvisa) avvisa(e.message || String(e));
      },
      // ⛔ Che il GPS sia SPENTO va scritto: è la promessa fatta alla batteria,
      // e un puntino fermo senza spiegazione si legge come un ricevitore ancora
      // acceso — che è esattamente il dubbio dell'operatore. Il motivo si
      // distingue, perché sono due esiti diversi: «basta così» e «non ci sono
      // riuscito in dieci secondi».
      onFine: (motivo, migliore) => {
        seguito = null;
        gpsAcceso(false, '📡 dove sono');
        const acc = migliore && Number.isFinite(Number(migliore.accuratezza))
          ? `±${migliore.accuratezza} m` : null;
        if (!acc) {
          nota.textContent = `📡 spento dopo ${Math.round(DURATA_DOVE_SONO_MS / 1000)} s: `
            + 'nessun segnale. Tocca di nuovo «dove sono» per riprovare.';
          return;
        }
        nota.textContent = motivo === 'precisione'
          ? `Sei qui, ${acc} — GPS spento: più preciso di così non serve.`
          : `Sei qui, ${acc} — GPS spento dopo ${Math.round(DURATA_DOVE_SONO_MS / 1000)} s. `
            + 'Tocca di nuovo «dove sono» per rimisurare.';
      },
    });
  }

  // ---------------------------------------------------------------- mira
  // ⛔ Posizionare a mano è la SECONDA strada, non un ripiego (20/09/2026,
  // richiesta dell'operatore: «deve chiederci se manualmente o con satellite»).
  // Dentro una cabina il GPS non prende, e su una fotografia dal satellite si
  // riconosce il tetto giusto a occhio meglio di quanto un telefono riesca a
  // misurarlo. Le due strade valgono, e chi è sul posto sa quale.
  const barraMira = el('div', { class: 'mappa-mira-barra' });
  barraMira.hidden = true;
  const testoMira = el('div', { class: 'mini' });
  let chiudiMira = null;

  function aggiornaMira() {
    if (!mira) { testoMira.textContent = ''; return; }
    const g = daMetri(mira, q.origine);
    testoMira.textContent = `${g.lat.toFixed(6)}, ${g.lon.toFixed(6)}`;
  }

  function fineMira() {
    mira = null;
    trascinoMira = false;
    chiudiMira = null;
    barraMira.hidden = true;
    disegna();
  }

  barraMira.append(
    el('div', { style: 'font-weight:600', testo: '✛ Trascina la croce sul punto' }),
    testoMira,
    el('div', { class: 'riga riga-fine', style: 'margin-top:8px;gap:8px' }, [
      el('button', { class: 'btn btn-piccolo', type: 'button', testo: 'Annulla',
        onclick: () => { const f = chiudiMira; fineMira(); if (f) f(null); } }),
      el('button', { class: 'btn btn-piccolo btn-primario', type: 'button',
        testo: '✓ Conferma qui',
        onclick: () => {
          const g = mira ? daMetri(mira, q.origine) : null;
          const f = chiudiMira;
          fineMira();
          if (f) f(g);
        } }),
    ]),
  );

  aggiornaSat();
  aggiornaDett();
  aggiornaDaFare();
  aggiornaPresidi();
  // Se la vista parte da «tutto» (nessuna memoria, nessuna ricerca): alla
  // prima misura vera va inquadrato tutto nella forma VERA del riquadro.
  // ⚠️ Deciso QUI, prima del primo `disegna()`: è lui a scrivere la memoria,
  // e letta dopo direbbe sempre «c'era già una vista» (misurato nel browser:
  // da desktop la prima apertura tagliava gli impianti in alto e in basso).
  const daInquadrare = !(memoria && memoria.vista && Number(memoria.vista.lato) > 0)
    && !(memoria && memoria.ricerca);
  // La vista di prima, se questa mappa rinasce da un ridisegno dell'app.
  if (memoria && memoria.vista && Number(memoria.vista.lato) > 0) {
    const c = inMetri(memoria.vista, q.origine);
    zoom = Math.min(zoomMassimo(), Math.max(ZOOM_MIN, q.larghezza / Number(memoria.vista.lato)));
    const lato = q.larghezza / zoom;
    dx = c.x - (q.minX + q.larghezza / 2);
    dy = c.y - (q.minY + q.altezza / 2);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(lato)) { zoom = 1; dx = 0; dy = 0; }
  }
  if (memoria && memoria.ricerca) {
    ricerca = memoria.ricerca;
    campoCerca.value = ricerca;
    svuota.hidden = false;
  }
  if (btnTrascina) {
    btnTrascina.classList.toggle('btn-primario', trascinaPunti);
    btnTrascina.setAttribute('aria-pressed', trascinaPunti ? 'true' : 'false');
  }
  barraTrascina.hidden = !trascinaPunti;
  disegna();

  // ⚠️ Al primo disegno il riquadro non è ancora in pagina, quindi
  // `svg.clientWidth` vale 0 e si usa il ripiego di 360 px. Su un telefono
  // cambia poco; su uno schermo largo il livello delle tessere resterebbe
  // tarato su una larghezza che non è quella, cioè un fondo sfocato per
  // sempre. Un solo ridisegno appena il riquadro ha una misura vera.
  //
  // ⛔ Si tiene il riferimento e lo si spegne in `chiudi()`: un timer che
  // sopravvive alla vista è già costato una suite di prove bloccata per sempre.
  // ---------------------------------------------------------------- ricerca
  // ⛔ La barra sopra la mappa (23/09/2026). Si filtra a ogni tasto, con un
  // attimo di respiro (il ridisegno piazza i nomi), e si INQUADRA ciò che si è
  // trovato: un risultato fuori dal riquadro, alla scala di un sito, sarebbe
  // un risultato che non si vede. Svuotando si torna alla vista di prima — chi
  // aveva inquadrato una cabina ritrova la sua cabina.
  function inquadraRisultati() {
    const trovati = conPosizione(tutti.filter((x) => corrispondeRicerca(x, ricerca)));
    if (!trovati.length) return;
    const m = trovati.map((x) => inMetri(x, q.origine));
    const xs = m.map((v) => v.x); const ys = m.map((v) => v.y);
    // La larghezza che serve perché ci stiano in larghezza E in altezza.
    const lato = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) / rapporto(),
      SPAN_MINIMO_M) * 1.35;
    zoom = Math.min(zoomMassimo(), Math.max(ZOOM_MIN, q.larghezza / lato));
    dx = (Math.max(...xs) + Math.min(...xs)) / 2 - (q.minX + q.larghezza / 2);
    dy = (Math.max(...ys) + Math.min(...ys)) / 2 - (q.minY + q.altezza / 2);
  }
  function cerca(valore) {
    const prima = normaRicerca(ricerca);
    ricerca = valore;
    const ora = normaRicerca(ricerca);
    if (!prima && ora) vistaPrima = { zoom, dx, dy };
    if (ora) inquadraRisultati();
    else if (vistaPrima) { ({ zoom, dx, dy } = vistaPrima); vistaPrima = null; }
    svuota.hidden = !ricerca;
    disegna();
    // La nota della ricerca sta sopra il riquadro: comparendo lo spinge giù.
    if (adatta()) disegna();
  }

  let primoRidisegno = setTimeout(() => {
    primoRidisegno = null;
    adatta();
    // Un solo guardiano, `daInquadrare`: c'era anche «zoom ancora a 1 e
    // nessuno spostamento», ed era ridondante — misurato: con `daInquadrare`
    // sempre vero le prove restavano verdi. Fra la costruzione e questo
    // timer (0 ms) nessuno tocca la mappa.
    if (daInquadrare) zoom = zoomTutto();
    if (svg.clientWidth) disegna();
  }, 0);

  const riquadro = el('div', { class: 'mappa-riquadro' }, [svg, lente]);
  // ⛔ DUE colonne (24/09/2026): a sinistra la ricerca e la mappa, a destra
  // comandi, legenda e note. Sul telefono stanno una sotto l'altra, nello
  // stesso ordine di prima; da desktop affiancate (CSS), così la mappa prende
  // tutta la larghezza che resta e l'altezza dello schermo, e i comandi non
  // finiscono sotto la piega.
  const colonnaMappa = el('div', { class: 'mappa-colonna-mappa' }, [barraRicerca, notaRicerca, riquadro]);
  const colonnaComandi = el('div', { class: 'mappa-colonna-comandi' }, [
    barraMira,
    barraTrascina,
    el('div', { class: 'mappa-sotto' }, [barra, comandi]),
    // ⚠️ La nota sta SUBITO sotto i comandi, prima della legenda: è la
    // risposta al tocco appena dato, e sotto sei voci di legenda non la
    // leggeva nessuno.
    nota,
    legenda,
    avvisoDettagli,
    sceltaFonte,
    dataFoto,
    attribuzione,
    senza ? el('div', { class: 'mini mappa-nota', testo:
      `${senza} luoghi non hanno ancora una posizione e non si vedono qui: `
      + 'si prende dal loro foglio «dove si trova», stando sul posto.' }) : null,
    ricavati ? el('div', { class: 'mini mappa-nota', testo:
      `◌ ${ricavati} ${ricavati === 1 ? 'posizione è ricavata' : 'posizioni sono ricavate'} `
      + "dall'indirizzo o dalla sottostazione sulla mappa pubblica: portano nella "
      + 'via giusta, non davanti al cancello. Rilevale sul posto per correggerle.' }) : null,
    // Quello che chi apre la mappa vuole accanto ai comandi (l'app: gli
    // impianti senza posizione). Da desktop sta nella colonna, non sotto la
    // piega.
    azioni.accanto || null,
  ].filter(Boolean));
  const nodo = el('div', { class: 'mappa' }, [colonnaMappa, colonnaComandi]);

  /**
   * Da DESKTOP il riquadro prende l'altezza che resta nello schermo (24/09/2026).
   *
   * ⚠️ In JavaScript e non nel CSS perché la risposta dipende da quello che
   * sta SOPRA la mappa — titolo, sotto-schede, la testata del livello, la nota
   * della ricerca — che cambia da schermata a schermata. Si misura dentro
   * l'elemento che scorre (`.vista`, o il corpo del livello sopra l'elenco),
   * contando lo scorrimento: così a pagina in cima entra tutto.
   * Sul telefono (sotto i 720 px) non fa niente: resta il quadrato del CSS.
   * @returns `true` se l'altezza è cambiata (va ridisegnato).
   */
  const LARGO = '(min-width: 720px)';
  function adatta() {
    if (typeof matchMedia !== 'function' || !nodo.isConnected || !riquadro.getBoundingClientRect) return false;
    const prima = riquadro.style.height;
    if (!matchMedia(LARGO).matches) {
      riquadro.style.height = '';
      colonnaComandi.style.maxHeight = '';
      return prima !== '';
    }
    const scorre = nodo.closest('.livello-mappa-corpo, .vista');
    if (!scorre) return false;
    const sopra = (n) => n.getBoundingClientRect().top - scorre.getBoundingClientRect().top + scorre.scrollTop;
    const padre = nodo.parentElement;
    const riserva = (padre ? parseFloat(getComputedStyle(padre).paddingBottom) || 0 : 0) + 4;
    const h = Math.max(320, Math.floor(scorre.clientHeight - sopra(riquadro) - riserva));
    riquadro.style.height = `${h}px`;
    colonnaComandi.style.maxHeight = `${Math.max(320, Math.floor(sopra(riquadro) + h - sopra(colonnaComandi)))}px`;
    return prima !== riquadro.style.height;
  }
  const suRidimensiona = () => { adatta(); disegna(); };
  const conFinestra = typeof addEventListener === 'function' && typeof removeEventListener === 'function';
  if (conFinestra) addEventListener('resize', suRidimensiona);

  return {
    nodo,
    /**
     * Apre il posizionamento a mano su un punto (o al centro della vista).
     * `avvicina`: porta la vista alla scala di un sito anche se il punto è già
     * in vista (si parte dal luogo che contiene un pezzo senza posizione).
     *
     * `onFine(punto)` riceve `{lat, lon}` alla conferma e `null` all'annullo —
     * mai niente: chi chiama deve poter distinguere «confermato» da
     * «lasciato perdere», o riaprirebbe il foglio sbagliato.
     */
    posizionaAMano(partenza, onFine, { avvicina = false } = {}) {
      // Il centro della vista, qualunque sia la sua forma.
      const centro = {
        x: q.minX + q.larghezza / 2 + dx,
        y: q.minY + q.altezza / 2 + dy,
      };
      const conPartenza = Boolean(partenza && partenza.lat && partenza.lon);
      const p0 = conPartenza ? inMetri(partenza, q.origine) : centro;
      // ⛔ La croce deve stare dove si GUARDA (24/09/2026). Dall'elenco dei
      // senza posizione si parte dal luogo che contiene il pezzo — l'area,
      // l'impianto — che quasi mai è nel riquadro in quel momento: la croce
      // sarebbe nata fuori dallo schermo, e «Conferma qui» avrebbe salvato un
      // punto che nessuno ha visto. Se la partenza è fuori vista la mappa ci va,
      // e, se la scala è quella di una provincia, scende a quella di un sito.
      if (conPartenza) {
        const lato = q.larghezza / zoom;
        const alto = lato * rapporto();
        const fuori = Math.abs(p0.x - centro.x) > lato / 2 || Math.abs(p0.y - centro.y) > alto / 2;
        // Se è FUORI vista, o se si chiede di AVVICINARSI (`avvicina`: il pezzo
        // non ha una posizione sua, e la partenza è il suo luogo — visto nel
        // browser: l'impianto era in vista, alla scala di una provincia, e la
        // croce nasceva lì sopra a 150 km di riquadro). «Correggi la posizione»
        // di un punto che si sta già guardando non sposta niente.
        if (fuori || (avvicina && lato > LATO_POSIZIONA_M)) {
          if (lato > LATO_POSIZIONA_M) zoom = Math.min(zoomMassimo(), q.larghezza / LATO_POSIZIONA_M);
          dx = p0.x - (q.minX + q.larghezza / 2);
          dy = p0.y - (q.minY + q.altezza / 2);
        }
      }
      mira = { x: p0.x, y: p0.y };
      chiudiMira = onFine;
      barraMira.hidden = false;
      aggiornaMira();
      disegna();
      // Sul telefono l'elenco sta SOTTO la mappa: chi ha toccato una sua riga
      // guarda in basso, e la croce è in alto.
      // E da desktop «✓ Conferma qui» sta in cima alla colonna dei comandi, che
      // chi arriva dall'elenco ha fatto scorrere fino in fondo: va riportata su.
      // Prima il riquadro, poi la barra: sul telefono la barra sta subito sotto
      // la mappa, e così si vedono tutti e due.
      if (riquadro.scrollIntoView) riquadro.scrollIntoView({ block: 'nearest' });
      if (barraMira.scrollIntoView) barraMira.scrollIntoView({ block: 'nearest' });
    },
    chiudi() {
      if (conFinestra) removeEventListener('resize', suRidimensiona);
      if (seguito) { seguito.ferma('uscita'); seguito = null; }
      if (primoRidisegno) { clearTimeout(primoRidisegno); primoRidisegno = null; }
      clearTimeout(timerRicerca);
      clearTimeout(timerData);
      clearTimeout(timerRotella);
      // ⛔ Uscendo con un posizionamento aperto, chi aspetta va avvisato: un
      // `onFine` mai chiamato lascia il chiamante a credere che la scheda sia
      // ancora aperta, e al rientro se ne troverebbe due.
      if (chiudiMira) { const f = chiudiMira; chiudiMira = null; mira = null; f(null); }
    },
  };
}

/**
 * La mappa SOPRA un'altra schermata, senza cambiare scheda (23/09/2026,
 * richiesta dell'operatore: «dalla tab presidi… senza cambiare scheda deve
 * aprirsi la mappa, sfruttando i componenti che già abbiamo… chiudendola non
 * dobbiamo perderci ma rimanere dove eravamo nei presidi»).
 *
 * Qui c'è solo il CONTENITORE: una testata con il nome e «✕ Chiudi», e sotto
 * quello che si mette dentro con `mostra(nodo)` — la `vistaMappa` di sempre,
 * con le sue caselle, «dove sono» e «sposta i punti». Niente di nuovo da
 * imparare, e niente da tenere allineato a mano con la mappa dei luoghi.
 *
 * ⛔ Non è il foglio a comparsa (`apriSheet`), e per due motivi misurati sul
 * codice: toccando un punto la mappa apre la SUA scheda, che è un foglio — e
 * un foglio solo alla volta vuol dire che la scheda avrebbe cacciato la mappa;
 * e il foglio ha l'altezza del contenuto, la mappa vuole lo schermo.
 *
 * ⚠️ L'elenco sotto NON si tocca: il livello si posa sopra e se ne va, quindi
 * chiudendo si è esattamente dove si era — stessa riga, stesso scorrimento.
 *
 * @param opzioni `{ titolo, sottotitolo, onChiudi(), puoChiudere(), radice }`
 *   * `onChiudi` — chiamata UNA volta, comunque si chiuda: è dove chi apre
 *     spegne il GPS e la mappa;
 *   * `puoChiudere` — per Escape: con un foglio aperto sopra, Escape chiude il
 *     foglio e non anche la mappa sotto (si legge PRIMA, in cattura, perché il
 *     foglio si chiude nello stesso tasto);
 *   * `radice` — dove appenderlo (il `body`; le prove ne passano uno finto).
 * @returns `{ nodo, mostra(contenuto), chiudi(), aperto() }`
 */
export function livelloMappa(opzioni = {}) {
  const { titolo = 'Mappa', sottotitolo = '', onChiudi, puoChiudere } = opzioni;
  const radice = opzioni.radice || (typeof document !== 'undefined' ? document.body : null);
  const prima = typeof document !== 'undefined' ? document.activeElement : null;
  let aperto = true;
  const corpo = el('div', { class: 'livello-mappa-corpo' });
  const btnChiudi = el('button', {
    class: 'btn livello-mappa-chiudi', type: 'button', testo: '✕ Chiudi',
    'aria-label': 'Chiudi la mappa e torna dov’eri', onclick: () => chiudi(),
  });
  const nodo = el('div', { class: 'livello-mappa', role: 'dialog', 'aria-modal': 'true',
    'aria-label': titolo }, [
    el('div', { class: 'livello-mappa-testa' }, [
      el('div', { class: 'livello-mappa-titoli' }, [
        el('div', { class: 'livello-mappa-titolo', testo: titolo }),
        sottotitolo ? el('div', { class: 'mini livello-mappa-sotto', testo: sottotitolo }) : null,
      ].filter(Boolean)),
      btnChiudi,
    ]),
    corpo,
  ]);
  const suTasto = (e) => {
    if (e.key !== 'Escape' || !aperto) return;
    if (puoChiudere && !puoChiudere()) return;
    chiudi();
  };
  const conFinestra = typeof addEventListener === 'function' && typeof removeEventListener === 'function';
  if (conFinestra) addEventListener('keydown', suTasto, true);
  if (radice) radice.append(nodo);
  if (btnChiudi.focus) btnChiudi.focus({ preventScroll: true });

  function mostra(contenuto) {
    while (corpo.firstChild) corpo.removeChild(corpo.firstChild);
    if (contenuto) corpo.append(contenuto);
  }
  function chiudi() {
    if (!aperto) return;
    aperto = false;
    if (conFinestra) removeEventListener('keydown', suTasto, true);
    if (nodo.parentNode) nodo.parentNode.removeChild(nodo);
    // Il fuoco torna al pulsante che l'ha aperta, se c'è ancora: un salvataggio
    // ridisegna l'elenco, e allora quel pulsante non esiste più.
    if (prima && prima.isConnected && prima.focus) prima.focus({ preventScroll: true });
    if (onChiudi) onChiudi();
  }
  return { nodo, mostra, chiudi, aperto: () => aperto };
}
