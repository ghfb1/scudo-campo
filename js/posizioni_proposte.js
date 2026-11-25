/**
 * Posizioni PROPOSTE dall'app per impianti che nel pacchetto non ne hanno una.
 *
 * Perché esiste (23/09/2026, dall'operatore: «sulla mappa manca populonia…
 * ci sono pacchetti in corso, trova una soluzione per fixare in volo senza
 * corromperglieli»)
 * -------------------------------------------------------------------------
 * Sei impianti su trenta erano usciti senza coordinate, per scelta del seme
 * (`SENZA_COORDINATE_NOTO` in `build_seed_from_xlsx.py`). Per POPULONIA la
 * scelta è stata rimisurata e ribaltata: nome e indirizzo, entro 1 km — la
 * regola delle coordinate ricavate. Il seme la porta da adesso; ma i
 * pacchetti già sui telefoni sono stati esportati prima.
 *
 * ⛔ Qui NON si scrive niente nel rilievo. Una posizione scritta dall'app da
 * sola sarebbe una modifica che nessuno ha fatto: comparirebbe come «lavoro
 * non esportato», bloccherebbe il caricamento del pacchetto successivo, e al
 * rientro direbbe in ufficio che l'operatore ha rilevato un punto che non ha
 * mai visto. La proposta si DISEGNA (tratteggiata, come ogni posizione
 * ricavata) e la scheda offre «✓ Conferma questa posizione»: solo quel tocco
 * la scrive, con una modifica normale che viaggia nel pacchetto — l'unica
 * strada che arriva all'archivio dell'ufficio, perché al rientro l'ufficio
 * SOSTITUISCE l'anagrafica con quella del pacchetto.
 *
 * Vale solo dove il pacchetto tace: un impianto che ha già una posizione la
 * tiene, anche se diversa. E si riconosce per id E nome, così un id riusato
 * altrove non si prende la posizione di un altro impianto.
 *
 * ⚠️ Le coordinate devono essere IDENTICHE a quelle del seme
 * (`backend/app/services/scudo_seed_data.json`): lo pretende
 * `test_mappa_campo.mjs`. Due fonti per lo stesso punto divergono al primo
 * ritocco, e sulla mappa la differenza non si vede.
 */
export const POSIZIONI_PROPOSTE = {
  'a5c99357-0a02-58b5-91fc-0ad7692d9784': {
    nome: 'POPULONIA',
    lat: '42.98299',
    lon: '10.54772',
    coordinate_origine: 'SOTTOSTAZIONE',
    perche: 'sottostazione Terna «Populonia» (132 kV) sulla mappa pubblica, '
      + 'a 370 m dalla località dell\'indirizzo, «La Rinsacca»',
  },
};

/** La proposta per questo impianto, se il pacchetto non ha una posizione. */
export function propostaPer(impianto) {
  if (!impianto || String(impianto.lat || '').trim() || String(impianto.lon || '').trim()) return null;
  const p = POSIZIONI_PROPOSTE[impianto.id];
  return p && p.nome === impianto.denominazione ? p : null;
}
