/**
 * Scudo Campo — lettura e scrittura di archivi ZIP, senza dipendenze.
 *
 * Il gemello Python è `backend/app/services/scudo_zip.py`, che si appoggia alla
 * libreria standard. Qui l'archivio va costruito e smontato a mano: il formato
 * è vecchio e stabile, e sono un centinaio di righe — molto meno di quanto
 * costerebbe portarsi dietro una libreria da mezzo megabyte in un'applicazione
 * che deve aprirsi dentro una cabina, senza rete, sul telefono di un operatore.
 *
 * Compressione. In scrittura si usa `CompressionStream('deflate-raw')` quando
 * c'è, altrimenti si scrive senza comprimere: un archivio "stored" è ZIP a
 * tutti gli effetti e Python lo legge senza accorgersi della differenza. In
 * lettura invece il deflate serve davvero, perché i pacchetti generati da Scudo
 * arrivano compressi; se il browser non sa decomprimere lo si dice, invece di
 * restituire dati corrotti.
 */

const FIRMA_LOCALE = 0x04034b50;
const FIRMA_CENTRALE = 0x02014b50;
const FIRMA_FINE = 0x06054b50;
const METODO_STORED = 0;
const METODO_DEFLATE = 8;
// Bit 11 delle flag: i nomi dei file sono in UTF-8. Senza, un lettore vecchio
// interpreterebbe i nomi in CP437.
const FLAG_UTF8 = 0x0800;

// --------------------------------------------------------------------------- //
// CRC-32
// --------------------------------------------------------------------------- //
let TABELLA_CRC = null;

function tabellaCrc() {
  if (TABELLA_CRC) return TABELLA_CRC;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  TABELLA_CRC = t;
  return t;
}

export function crc32(bytes) {
  const t = tabellaCrc();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --------------------------------------------------------------------------- //
// Compressione
// --------------------------------------------------------------------------- //
export function sapComprimere() {
  return typeof globalThis.CompressionStream === 'function';
}

export function sapDecomprimere() {
  return typeof globalThis.DecompressionStream === 'function';
}

async function attraversa(bytes, stream) {
  const risposta = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await risposta.arrayBuffer());
}

async function comprimi(bytes) {
  if (!sapComprimere()) return null;
  try {
    return await attraversa(bytes, new CompressionStream('deflate-raw'));
  } catch {
    return null;
  }
}

async function decomprimi(bytes) {
  if (!sapDecomprimere()) {
    throw new Error(
      "Questo browser non sa decomprimere gli archivi ZIP. Serve una versione più "
      + 'recente (Chrome 80+, Safari 16.4+, Firefox 113+).'
    );
  }
  return attraversa(bytes, new DecompressionStream('deflate-raw'));
}

// --------------------------------------------------------------------------- //
// Scrittura
// --------------------------------------------------------------------------- //
function dataDos(d) {
  const ora = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5)
    | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const giorno = (((d.getFullYear() - 1980) & 0x7f) << 9)
    | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { ora, giorno };
}

/**
 * Costruisce un archivio. `file` è una lista di { nome, dati: Uint8Array }.
 * Ritorna un Uint8Array.
 */
export async function scriviZip(file) {
  const encoder = new TextEncoder();
  const adesso = dataDos(new Date());
  const voci = [];
  const pezzi = [];
  let offset = 0;

  for (const f of file) {
    const nome = encoder.encode(f.nome);
    const grezzi = f.dati;
    const compressi = await comprimi(grezzi);
    // Se la compressione non riduce nulla (file minuscoli) si scrive stored:
    // un archivio più grande dell'originale è solo un modo per sprecare byte.
    const usaDeflate = compressi !== null && compressi.length < grezzi.length;
    const dati = usaDeflate ? compressi : grezzi;
    const metodo = usaDeflate ? METODO_DEFLATE : METODO_STORED;
    const crc = crc32(grezzi);

    const testa = new Uint8Array(30 + nome.length);
    const dv = new DataView(testa.buffer);
    dv.setUint32(0, FIRMA_LOCALE, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, FLAG_UTF8, true);
    dv.setUint16(8, metodo, true);
    dv.setUint16(10, adesso.ora, true);
    dv.setUint16(12, adesso.giorno, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, dati.length, true);
    dv.setUint32(22, grezzi.length, true);
    dv.setUint16(26, nome.length, true);
    dv.setUint16(28, 0, true);
    testa.set(nome, 30);

    pezzi.push(testa, dati);
    voci.push({ nome, metodo, crc, comp: dati.length, orig: grezzi.length, offset });
    offset += testa.length + dati.length;
  }

  const inizioCentrale = offset;
  for (const v of voci) {
    const c = new Uint8Array(46 + v.nome.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, FIRMA_CENTRALE, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, FLAG_UTF8, true);
    dv.setUint16(10, v.metodo, true);
    dv.setUint16(12, adesso.ora, true);
    dv.setUint16(14, adesso.giorno, true);
    dv.setUint32(16, v.crc, true);
    dv.setUint32(20, v.comp, true);
    dv.setUint32(24, v.orig, true);
    dv.setUint16(28, v.nome.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, v.offset, true);
    c.set(v.nome, 46);
    pezzi.push(c);
    offset += c.length;
  }

  const fine = new Uint8Array(22);
  const dvf = new DataView(fine.buffer);
  dvf.setUint32(0, FIRMA_FINE, true);
  dvf.setUint16(4, 0, true);
  dvf.setUint16(6, 0, true);
  dvf.setUint16(8, voci.length, true);
  dvf.setUint16(10, voci.length, true);
  dvf.setUint32(12, offset - inizioCentrale, true);
  dvf.setUint32(16, inizioCentrale, true);
  dvf.setUint16(20, 0, true);
  pezzi.push(fine);

  const totale = pezzi.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(totale);
  let p = 0;
  for (const pezzo of pezzi) { out.set(pezzo, p); p += pezzo.length; }
  return out;
}

// --------------------------------------------------------------------------- //
// Lettura
// --------------------------------------------------------------------------- //
export function sembraZip(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 4);
  const f = dv.getUint32(0, true);
  return f === FIRMA_LOCALE || f === FIRMA_FINE || f === 0x08074b50;
}

function trovaFine(bytes) {
  // La coda dell'archivio può contenere un commento lungo fino a 65535 byte:
  // si cerca all'indietro dentro quella finestra invece di assumere che il
  // record finale sia esattamente in fondo.
  const max = Math.min(bytes.length, 22 + 0xffff);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let i = bytes.length - 22; i >= bytes.length - max; i -= 1) {
    if (i < 0) break;
    if (dv.getUint32(i, true) === FIRMA_FINE) return i;
  }
  return -1;
}

/**
 * Estrae tutti i file. Ritorna una Map nome -> Uint8Array.
 * Lancia Error con un messaggio comprensibile se l'archivio non è leggibile.
 */
export async function leggiZip(bytes) {
  if (!sembraZip(bytes)) throw new Error("Il file non è un archivio ZIP.");

  const fine = trovaFine(bytes);
  if (fine < 0) {
    throw new Error(
      'Archivio incompleto: manca il record finale. Probabile download o copia '
      + 'interrotta.'
    );
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const nVoci = dv.getUint16(fine + 10, true);
  let p = dv.getUint32(fine + 16, true);
  const decoder = new TextDecoder('utf-8');
  const out = new Map();

  for (let i = 0; i < nVoci; i += 1) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== FIRMA_CENTRALE) {
      throw new Error('Indice dell\'archivio corrotto.');
    }
    const metodo = dv.getUint16(p + 10, true);
    const dimComp = dv.getUint32(p + 20, true);
    const dimOrig = dv.getUint32(p + 24, true);
    const lenNome = dv.getUint16(p + 28, true);
    const lenExtra = dv.getUint16(p + 30, true);
    const lenCommento = dv.getUint16(p + 32, true);
    const offLocale = dv.getUint32(p + 42, true);
    const crcAtteso = dv.getUint32(p + 16, true);
    const nome = decoder.decode(bytes.subarray(p + 46, p + 46 + lenNome))
      .replace(/\\/g, '/').replace(/^\.\//, '');
    p += 46 + lenNome + lenExtra + lenCommento;

    if (nome.endsWith('/')) continue;

    if (dv.getUint32(offLocale, true) !== FIRMA_LOCALE) {
      throw new Error(`Voce "${nome}" corrotta nell'archivio.`);
    }
    // Le lunghezze del nome e del campo extra nell'intestazione locale possono
    // essere diverse da quelle dell'indice centrale: vanno rilette da qui,
    // altrimenti i dati partono dall'offset sbagliato.
    const lenNomeL = dv.getUint16(offLocale + 26, true);
    const lenExtraL = dv.getUint16(offLocale + 28, true);
    const inizio = offLocale + 30 + lenNomeL + lenExtraL;
    const grezzi = bytes.subarray(inizio, inizio + dimComp);

    let contenuto;
    if (metodo === METODO_STORED) {
      contenuto = grezzi;
    } else if (metodo === METODO_DEFLATE) {
      contenuto = await decomprimi(grezzi);
    } else {
      throw new Error(`Metodo di compressione ${metodo} non supportato (voce "${nome}").`);
    }

    if (dimOrig && contenuto.length !== dimOrig) {
      throw new Error(`Voce "${nome}" incompleta: attesi ${dimOrig} byte, letti ${contenuto.length}.`);
    }
    // Il CRC è il controllo che l'archivio porta con sé: verificarlo qui
    // trasforma un file danneggiato in un messaggio chiaro invece che in righe
    // di CSV assurde molto più avanti.
    if (crcAtteso && crc32(contenuto) !== crcAtteso) {
      throw new Error(`Voce "${nome}" danneggiata: il codice di controllo interno non torna.`);
    }

    out.set(nome, contenuto);
  }
  return out;
}
