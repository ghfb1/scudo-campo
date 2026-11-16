/**
 * I numeri dei grafici. Senza DOM, senza stato, senza orologio.
 *
 * Perché un modulo a parte
 * ------------------------
 * Il disegno sta in `ui.js`, il dato sta qui. Un grafico disegnato bene su
 * numeri sbagliati è peggio di nessun grafico: convince, e non ha modo di
 * accorgersi di sé. Tenendo il conteggio in funzioni pure lo si può eseguire in
 * Node contro casi con una risposta sola — `scripts/scudo/test_grafici_campo.mjs`.
 *
 * Nessuna di queste funzioni legge `new Date()` per conto suo: la data è un
 * parametro. Una funzione che guarda l'orologio non si può provare, perché la
 * prova cambia risposta domani.
 */

export const MESI_BREVI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu',
  'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

export const meseDi = (iso) => String(iso || '').slice(0, 7);

export function etichettaMese(m) {
  const [a, n] = String(m).split('-');
  const i = Number(n) - 1;
  return `${MESI_BREVI[i] || n} ${String(a).slice(2)}`;
}

export function isoDi(data) {
  const p = (n) => String(n).padStart(2, '0');
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`;
}

export function prossimiMesi(da, quanti) {
  const out = [];
  const d = new Date(da.getFullYear(), da.getMonth(), 1);
  for (let i = 0; i < quanti; i += 1) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/**
 * Quante scadenze in ciascuno dei prossimi mesi, più i due estremi.
 *
 * I due estremi ci sono apposta. Senza il secchio «già scadute» il grafico
 * comincia da oggi e il lavoro arretrato scompare; senza il secchio «oltre» il
 * totale delle colonne si legge come «tutto il lavoro che c'è», e qui il lavoro
 * oltre l'anno è più del doppio.
 *
 * Vincolo che la prova verifica: scadute + somma dei mesi + oltre = totale.
 */
export function caricoMensile(scadenze, oggi = new Date(), mesi = 6) {
  const oggiIso = isoDi(oggi);
  const orizzonte = prossimiMesi(oggi, mesi);
  const dentro = new Set(orizzonte);
  const conta = new Map(orizzonte.map((m) => [m, 0]));
  let scadute = 0;
  let oltre = 0;
  let senzaData = 0;

  for (const s of scadenze) {
    const d = s.data_scadenza || '';
    if (!d) { senzaData += 1; continue; }
    // La scadenza di OGGI non è scaduta: il termine scade a fine giornata, e
    // chi la esegue oggi è in regola.
    if (d < oggiIso) { scadute += 1; continue; }
    const m = meseDi(d);
    if (dentro.has(m)) conta.set(m, conta.get(m) + 1);
    else oltre += 1;
  }

  return {
    scadute,
    oltre,
    senza_data: senzaData,
    mesi: orizzonte.map((m) => ({ mese: m, etichetta: etichettaMese(m), n: conta.get(m) })),
    totale: scadenze.length,
  };
}

/**
 * Le tre quote del semaforo. `semaforoFn(dataIso)` è quella di `stato.js`:
 * la regola su che cosa sia «in scadenza» è una sola, e sta là.
 */
export function quoteSemaforo(scadenze, semaforoFn) {
  const q = { SCADUTO: 0, IN_SCADENZA: 0, REGOLARE: 0, SENZA_DATA: 0 };
  for (const s of scadenze) {
    if (!s.data_scadenza) { q.SENZA_DATA += 1; continue; }
    const v = semaforoFn(s.data_scadenza);
    if (q[v] === undefined) q.SENZA_DATA += 1;
    else q[v] += 1;
  }
  return q;
}

/**
 * Raggruppa le scadenze per una chiave, contando anche quante sono scadute.
 *
 * L'ordinamento mette davanti chi ha più scadute e non chi ne ha di più in
 * totale: la domanda dell'operatore è «da dove comincio», non «chi è il più
 * grosso». La coda su `valore` serve a rendere l'ordine stabile — un grafico
 * che si riordina da solo fra due disegni identici non si può usare.
 */
export function raggruppa(scadenze, chiaveFn, semaforoFn) {
  const m = new Map();
  for (const s of scadenze) {
    const k = chiaveFn(s);
    if (!k) continue;
    if (!m.has(k.valore)) m.set(k.valore, { ...k, n: 0, scadute: 0, in_scadenza: 0 });
    const v = m.get(k.valore);
    v.n += 1;
    const sem = s.data_scadenza ? semaforoFn(s.data_scadenza) : null;
    if (sem === 'SCADUTO') v.scadute += 1;
    else if (sem === 'IN_SCADENZA') v.in_scadenza += 1;
  }
  return [...m.values()].sort((a, b) => b.scadute - a.scadute
    || b.n - a.n
    || String(a.valore).localeCompare(String(b.valore)));
}
