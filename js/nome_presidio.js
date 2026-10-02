/**
 * Scudo Campo — come si chiama un presidio in elenco e nella scheda.
 *
 * GEMELLO di `frontend/src/components/scudo/nomePresidio.js` (regola data
 * dall'operatore il 14/09/2026): **la matricola per prima**, perché è quella
 * stampata sull'oggetto che si ha davanti; il progressivo del registro estintori
 * (`#12`) è la «matricola Terna» e va detto; senza matricola — porte, rilevatori,
 * lampade — il nome è il progressivo. I progressivi `XXXX-US-01` li compone il
 * generatore del seed: chiamarli matricola Terna sarebbe inventare.
 *
 * I due lati li confronta `scripts/scudo/test_nome_presidio_cross.mjs` sui presidi
 * del pacchetto vero: l'app di campo non può importare dal frontend (zero
 * dipendenze), quindi la regola esiste due volte e va tenuta uguale.
 */

const PROGRESSIVO_TERNA = /^#\d+$/;

export function nomePresidio(r) {
  const x = r || {};
  // Le matricole dei fogli arrivano con spazi in coda («123456 »).
  const matricola = String(x.matricola == null ? '' : x.matricola).trim();
  const progressivo = String(x.identificativo == null ? '' : x.identificativo).trim();
  const terna = PROGRESSIVO_TERNA.test(progressivo);

  if (matricola) {
    return {
      principale: matricola,
      eMatricola: true,
      secondario: progressivo ? (terna ? `matr. Terna ${progressivo}` : progressivo) : '',
    };
  }
  return {
    principale: progressivo || x.codice || '',
    eMatricola: false,
    secondario: terna ? 'matricola Terna' : '',
  };
}

/**
 * Il dettaglio che distingue due presidi della STESSA tipologia.
 *
 * Richiesta dell'operatore del 16/09/2026: «estintore - CO2», non l'estinguente
 * sepolto in mezzo agli altri dati. Due estintori della stessa categoria hanno
 * periodicità di revisione diverse a seconda dell'estinguente (CO2 60 mesi,
 * polvere 36 o 60, base acqua 24 o 48): è la prima cosa da sapere, e stava in
 * quarta posizione su una riga grigia.
 *
 * Una tabella esplicita, non un'euristica: per ogni categoria il campo che la
 * divide in sotto-tipi. Una categoria che non c'è non ha dettaglio — meglio niente
 * che il primo campo valorizzato, che un giorno sarebbe la marca.
 */
const DETTAGLIO_DI = {
  ESTINTORE: 'estinguente',
  IMP_FISSO_CO2: 'estinguente',
  PORTA_REI: 'tipologia_porta',
  USCITA_SICUREZZA: 'n_ante',
  SCHIUMOGENO: 'estinguente',
};

export function dettaglioTipologia(r) {
  const x = r || {};
  const campo = DETTAGLIO_DI[x.categoria_codice];
  if (!campo) return '';
  const v = String(x[campo] == null ? '' : x[campo]).trim();
  if (!v) return '';
  if (campo === 'n_ante') {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? `${n} ${n === 1 ? 'anta' : 'ante'}` : '';
  }
  // `REI_60` si legge «REI 60»; gli estinguenti restano come sono (CO2, POLVERE).
  return v.replace(/_/g, ' ');
}
