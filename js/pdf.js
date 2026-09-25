/**
 * Un PDF scritto a mano: testo, linee e rettangoli, pagine A4.
 *
 * Perché a mano (24/09/2026, per il verbale dei controlli da far firmare)
 * ---------------------------------------------------------------------
 * Scudo Campo non ha dipendenze: si apre offline dentro una cabina, e una
 * libreria PDF sono centinaia di kilobyte da scaricare la prima volta e da
 * tenere in cache per sempre. Un verbale è testo in tabelle: bastano le 14 font
 * che ogni lettore PDF ha già (qui Helvetica e Helvetica-Bold), senza
 * incorporarne nessuna.
 *
 * Il prezzo, dichiarato:
 *  * la codifica è WinAnsi: lettere accentate italiane, «», €, – — … • sì;
 *    emoji e caratteri fuori tabella diventano «?». Chi scrive il verbale usa
 *    parole, non icone;
 *  * le larghezze dei caratteri (per andare a capo) sono quelle delle metriche
 *    AFM standard di Helvetica; un carattere che manca vale come una «n».
 *
 * Le coordinate che si passano qui partono dall'ALTO a sinistra, in punti
 * tipografici (1/72 di pollice): il PDF le vuole dal basso, e la conversione sta
 * in un posto solo.
 */

export const A4 = { larghezza: 595.28, altezza: 841.89 };

// Metriche AFM (millesimi di em) dei caratteri ASCII 32..126, Helvetica e
// Helvetica-Bold, nell'ordine dei codici.
const LARG_REGULAR = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722,
  722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const LARG_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722,
  722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944,
  667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// I caratteri fuori dall'ASCII che il verbale usa, con il loro codice WinAnsi e
// la larghezza (regular, bold). Le lettere accentate misurano come la base.
const EXTRA = {
  '€': [0x80, 556, 556], '…': [0x85, 1000, 1000], '‘': [0x91, 222, 278], '’': [0x92, 222, 278],
  '“': [0x93, 333, 500], '”': [0x94, 333, 500], '•': [0x95, 350, 350], '–': [0x96, 556, 556],
  '—': [0x97, 1000, 1000], '«': [0xAB, 556, 556], '»': [0xBB, 556, 556], '°': [0xB0, 400, 400],
  '·': [0xB7, 278, 278], '×': [0xD7, 584, 584],
};
const BASE_ACCENTATE = 'ÀAÁAÂAÄAÈEÉEÊEËEÌIÍIÎIÏIÒOÓOÔOÖOÙUÚUÛUÜUÇCàaáaâaäaèeéeêeëeìiíiîiïiòoóoôoöoùuúuûuüuçcñnÑN';
const BASE = {};
for (let i = 0; i < BASE_ACCENTATE.length; i += 2) BASE[BASE_ACCENTATE[i]] = BASE_ACCENTATE[i + 1];
// Gli spazi e i trattini «strani» che arrivano incollati da un foglio di calcolo.
const SOSTITUZIONI = { '\u00A0': ' ', '\u2009': ' ', '\u202F': ' ', '\u2011': '-', '\u2212': '-', '\u2715': 'x', '\u2713': 'v', '\u2714': 'v' };

/** Il codice WinAnsi di un carattere, o null se non c'è. */
function codice(ch) {
  const c = ch.codePointAt(0);
  if (c >= 32 && c <= 126) return c;
  if (EXTRA[ch]) return EXTRA[ch][0];
  if (c >= 0xA0 && c <= 0xFF) return c;   // Latin-1: coincide con WinAnsi
  return null;
}

/** Il testo ripulito: caratteri sostituiti, a capo e tabulazioni in spazi, il resto «?». */
export function normalizzaTesto(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ')) {
    const x = SOSTITUZIONI[ch] || ch;
    if (codice(x) !== null) out += x;
    else if (/\p{Extended_Pictographic}|\p{M}|[\uFE0F\u200D]/u.test(x)) continue;  // emoji e modificatori: via
    else out += '?';
  }
  return out.replace(/ {2,}/g, ' ');
}

/** Larghezza in punti di un testo già normalizzato. */
export function misura(testo, grassetto, corpo) {
  let m = 0;
  for (const ch of testo) {
    const c = ch.codePointAt(0);
    if (c >= 32 && c <= 126) m += (grassetto ? LARG_BOLD : LARG_REGULAR)[c - 32];
    else if (EXTRA[ch]) m += EXTRA[ch][grassetto ? 2 : 1];
    else if (BASE[ch]) m += (grassetto ? LARG_BOLD : LARG_REGULAR)[BASE[ch].codePointAt(0) - 32];
    else m += 556;
  }
  return (m / 1000) * corpo;
}

/**
 * Il testo spezzato in righe larghe al più `larghezza` punti. Una parola più
 * lunga della riga (una matricola, un codice) si spezza a metà invece di uscire
 * dal riquadro.
 */
export function aCapo(testo, grassetto, corpo, larghezza) {
  const t = normalizzaTesto(testo).trim();
  if (!t) return [''];
  const righe = [];
  let riga = '';
  for (const parola of t.split(' ')) {
    const prova = riga ? `${riga} ${parola}` : parola;
    if (misura(prova, grassetto, corpo) <= larghezza) { riga = prova; continue; }
    if (riga) righe.push(riga);
    let resto = parola;
    while (misura(resto, grassetto, corpo) > larghezza && resto.length > 1) {
      let n = resto.length - 1;
      while (n > 1 && misura(resto.slice(0, n), grassetto, corpo) > larghezza) n -= 1;
      righe.push(resto.slice(0, n));
      resto = resto.slice(n);
    }
    riga = resto;
  }
  if (riga) righe.push(riga);
  return righe;
}

const escapePdf = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const n2 = (x) => (Math.round(x * 100) / 100).toString();

/**
 * Il documento. `pagina()` ne apre una nuova; il resto disegna sull'ultima.
 * `bytes()` restituisce il file.
 */
export function nuovoDocumento({ titolo = '', autore = '' } = {}) {
  const pagine = [];
  let corrente = null;
  const H = A4.altezza;

  const doc = {
    pagina() {
      corrente = [];
      pagine.push(corrente);
      return pagine.length;
    },
    get numeroPagine() { return pagine.length; },
    /** Torna a disegnare su una pagina già aperta (1 = la prima): serve al piè di
     *  pagina «pagina x di N», che si scrive quando N si conosce. */
    suPagina(n) { corrente = pagine[n - 1]; },
    /** Testo con la linea di base a `y` (dall'alto). */
    testo(x, y, s, { grassetto = false, corpo = 9, grigio = 0 } = {}) {
      const t = normalizzaTesto(s);
      if (!t) return;
      const bytes = [...t].map((ch) => String.fromCharCode(codice(ch))).join('');
      corrente.push(`BT ${grigio ? `${n2(grigio)} g ` : ''}/${grassetto ? 'F2' : 'F1'} ${n2(corpo)} Tf `
        + `${n2(x)} ${n2(H - y)} Td (${escapePdf(bytes)}) Tj ET${grigio ? ' 0 g' : ''}`);
    },
    linea(x1, y1, x2, y2, { spessore = 0.5, grigio = 0 } = {}) {
      corrente.push(`${n2(grigio)} G ${n2(spessore)} w ${n2(x1)} ${n2(H - y1)} m ${n2(x2)} ${n2(H - y2)} l S 0 G`);
    },
    /** Rettangolo con l'angolo in alto a sinistra in (x, y). */
    rettangolo(x, y, w, h, { riempi = null, bordo = 0.5 } = {}) {
      const r = `${n2(x)} ${n2(H - y - h)} ${n2(w)} ${n2(h)} re`;
      if (riempi !== null) corrente.push(`${n2(riempi)} g ${r} f 0 g`);
      if (bordo) corrente.push(`${n2(bordo)} w ${r} S`);
    },
    bytes() {
      // Oggetti: 1 catalogo, 2 albero delle pagine, 3-4 font, 5 info, poi per
      // ogni pagina (pagina, contenuto).
      const oggetti = [];
      const kids = pagine.map((_, i) => `${6 + i * 2} 0 R`).join(' ');
      oggetti.push('<< /Type /Catalog /Pages 2 0 R >>');
      oggetti.push(`<< /Type /Pages /Kids [${kids}] /Count ${pagine.length} >>`);
      oggetti.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      oggetti.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      const info = (s) => `(${escapePdf([...normalizzaTesto(s)].map((ch) => String.fromCharCode(codice(ch))).join(''))})`;
      oggetti.push(`<< /Title ${info(titolo)} /Author ${info(autore)} /Producer (Scudo Campo) >>`);
      pagine.forEach((cmd, i) => {
        const flusso = cmd.join('\n');
        oggetti.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(A4.larghezza)} ${n2(A4.altezza)}] `
          + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${7 + i * 2} 0 R >>`);
        oggetti.push(`<< /Length ${flusso.length} >>\nstream\n${flusso}\nendstream`);
      });
      // Tutto è ASCII o WinAnsi a un byte: la lunghezza della stringa è quella
      // in byte, e gli offset della tabella xref si contano sulla stringa.
      let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
      const offset = [];
      oggetti.forEach((o, i) => {
        offset.push(out.length);
        out += `${i + 1} 0 obj\n${o}\nendobj\n`;
      });
      const xref = out.length;
      out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
      for (const o of offset) out += `${String(o).padStart(10, '0')} 00000 n \n`;
      out += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
      const b = new Uint8Array(out.length);
      for (let i = 0; i < out.length; i += 1) b[i] = out.charCodeAt(i) & 0xFF;
      return b;
    },
  };
  return doc;
}
