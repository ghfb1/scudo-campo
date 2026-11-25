import * as S from './stato.js';
import { E, codicePacchetto } from './pacchetto.js';
import { esecutoreDi, tipoPeriodicoInBlocco } from './piani.js';
import { A4, nuovoDocumento } from './pdf.js';
import { M, LARGA, dataIt, penna } from './verbale.js';
import { el, campo, scaricaFile } from './ui.js';

const ATTIVITA = {
  SORVEGLIANZA: ['ESTINTORE', 'Sorveglianza estintori'],
  PROVA_ILLUMINAZIONE: ['ILLUMINAZIONE', 'Prova luci di emergenza'],
  PULIZIA_FILTRI: ['CLIMATIZZATORE', 'Pulizia filtri clima'],
};

// Ogni intervento porta il proprio piano. Applicare quello oggi in vigore
// riscriverebbe la cadenza dei controlli precedenti al cambio di piano.
export function verbaliPeriodici() {
  const gruppi = new Map();
  for (const i of S.get().perEntita[E.INTERVENTO] || []) {
    const att = ATTIVITA[i.tipo_controllo_codice];
    if (!att || i.eliminato_il || !S.ESITI_ESEGUITI.includes(i.esito) || !i.data) continue;
    const a = S.indici.assets.get(i.asset_id);
    const p = S.indici.pianiPerId.get(i.piano_id);
    if (!a || (p?.tipo_asset_codice || S.tipoAssetDi(a)) !== att[0]) continue;
    const mano = p && esecutoreDi(p);
    const tipo = p && p.tipo_controllo_codice === i.tipo_controllo_codice && tipoPeriodicoInBlocco({
      piano_id: p.id, codice: i.tipo_controllo_codice, esecutore: mano,
      frequenza_valore: p.frequenza_valore, frequenza_unita: p.frequenza_unita || 'MESI',
    }, att[0]);
    if (p && !tipo) continue;
    const giorno = String(i.data).slice(0, 10);
    const sessione = i.sessione_id || i.giro_ufficio_id || '';
    const operatore = (i.operatore_nome || '').trim();
    const chiave = JSON.stringify([giorno, a.impianto_id, i.tipo_controllo_codice, i.piano_id || '', sessione, operatore, i.ditta || '']);
    if (!gruppi.has(chiave)) gruppi.set(chiave, { giorno, impiantoId: a.impianto_id,
      impianto: S.indici.impianti.get(a.impianto_id)?.denominazione || a.impianto_id || 'Impianto sconosciuto',
      tipo: tipo || att[1] + ' · periodicità non documentata', storicoSenzaPiano: !p,
      mano, operatore, ditta: i.ditta || '', giro: codicePacchetto(sessione), righe: [] });
    gruppi.get(chiave).righe.push(i);
  }
  return [...gruppi.values()].sort((a,b) => b.giorno.localeCompare(a.giorno)
    || a.impianto.localeCompare(b.impianto, 'it') || a.tipo.localeCompare(b.tipo, 'it') || a.operatore.localeCompare(b.operatore, 'it'));
}

export function pdfVerbaliPeriodici(gruppi) {
  const doc = nuovoDocumento({ titolo: 'Verbali delle verifiche eseguite', autore: 'Scudo' });
  const firme = [];
  for (const g of gruppi) {
    const p = penna(doc, { testata: 'Scudo · Verbale di verifica', destra: dataIt(g.giorno) + (g.giro ? ' · Giro ' + g.giro : ''),
      fondo: A4.altezza - 101, onPagina: () => firme.push(g) });
    p.nuovaPagina();
    p.paragrafo(g.impianto, { corpo: 16, grassetto: true });
    p.paragrafo(g.tipo, { corpo: 13, grassetto: true });
    const incaricato = g.mano === 'TERNA' ? 'Personale Terna' : g.mano === 'DITTA' ? 'Ditta esterna' : 'Esecutore da identificare alla firma';
    p.paragrafo([dataIt(g.giorno), incaricato, g.righe.length + (g.righe.length === 1 ? ' verifica eseguita' : ' verifiche eseguite')].join(' · '));
    if (g.ditta) p.paragrafo('Ditta riportata nel registro: ' + g.ditta);
    if (g.operatore) p.paragrafo('Operatore riportato nel registro: ' + g.operatore);
    const dettagli = [];
    const righe = g.righe.map(i => {
      const a = S.indici.assets.get(i.asset_id);
      const id = String(a?.identificativo || i.asset_codice || i.asset_id);
      const note = [i.descrizione, i.azione_eseguita, i.note];
      if (i.matricola_pezzo) note.push('Matricola verificata: ' + i.matricola_pezzo);
      if (i.quantita_verificata != null) note.push('Pezzi verificati: ' + i.quantita_verificata);
      if (i.quantita_ko != null) note.push('Pezzi guasti: ' + i.quantita_ko);
      let testi = [...new Set(note.filter(Boolean))];
      if (testi.join(' ').length > 320) {
        dettagli.push({ id, testi });
        testi = ['Vedi note in dettaglio.'];
      }
      return { id, celle: [[{ testo: id, grassetto: true }], [{ testo: a ? S.ubicazione(a) : '' }],
        [{ testo: i.esito === 'IDONEO' ? 'Idoneo' : 'Non idoneo' }],
        testi.map(testo => ({ testo }))] };
    }).sort((a,b) => a.id.localeCompare(b.id, 'it', { numeric: true }));
    p.tabella([{ titolo: 'Presidio', larghezza: .19 }, { titolo: 'Ubicazione in anagrafica', larghezza: .31 },
      { titolo: 'Esito', larghezza: .14 }, { titolo: 'Note della verifica', larghezza: .36 }], righe.map(r => r.celle));
    for (const { id, testi } of dettagli) {
      p.titolo('Note in dettaglio · ' + id, 11);
      for (const testo of testi) p.paragrafo(testo);
    }
  }
  firme.forEach((g, index) => {
    doc.suPagina(index + 1);
    const y = A4.altezza - 82;
    doc.linea(M, y, M + LARGA, y);
    const chi = g.mano === 'TERNA' ? 'operatore Terna' : g.mano === 'DITTA' ? 'operatore della ditta' : 'operatore';
    doc.testo(M, y + 18, 'Firma ' + chi + ' __________________________________', { corpo: 10 });
    doc.testo(M, y + 39, 'Nome e cognome _________________________________     Data __________________', { corpo: 9 });
    doc.testo(M, y + 62, 'Scudo · Verbali delle verifiche eseguite', { corpo: 8 });
    doc.testo(M + LARGA - 70, y + 62, 'Foglio ' + (index + 1) + ' di ' + firme.length, { corpo: 8 });
  });
  return doc.bytes();
}

export function vistaVerbaliPeriodici(impiantoId = '') {
  const gruppi = verbaliPeriodici();
  const opzione = (value, testo) => el('option', { value, testo });
  const mesi = [...new Set(gruppi.map(g => g.giorno.slice(0,7)))];
  const mese = el('select', {}, mesi.map(m => opzione(m, new Date(m + '-01T12:00:00').toLocaleDateString('it', { month: 'long', year: 'numeric' }))));
  const sedi = new Map(gruppi.map(g => [g.impiantoId, g.impianto]));
  if (impiantoId && !sedi.has(impiantoId)) sedi.set(impiantoId, S.indici.impianti.get(impiantoId)?.denominazione || impiantoId);
  const sede = el('select', {}, [opzione('', 'Tutti gli impianti'), ...[...sedi].sort((a,b) => a[1].localeCompare(b[1], 'it')).map(([id,nome]) => opzione(id,nome))]);
  if (sedi.has(impiantoId)) sede.value = impiantoId;
  const tipi = [...new Set(gruppi.filter(g => !g.storicoSenzaPiano).map(g => g.tipo))].sort();
  const tipo = el('select', {}, [opzione('', 'Tutti i mensili e bimestrali'), ...tipi.map(t => opzione(t,t)),
    ...(gruppi.some(g => g.storicoSenzaPiano) ? [opzione('storico', 'Storico con periodicità non documentata')] : [])]);
  const esiti = el('div', { class: 'piano-visita' });
  function scarica(elenco, nome) {
    scaricaFile(('Verbali - ' + nome).replace(/[\\/:*?"<>|]/g, '-') + '.pdf', pdfVerbaliPeriodici(elenco), 'application/pdf');
  }
  function aggiorna() {
    const trovati = gruppi.filter(g => g.giorno.startsWith(mese.value) && (!sede.value || sede.value === g.impiantoId)
      && (g.storicoSenzaPiano ? tipo.value === 'storico' : !tipo.value || tipo.value === g.tipo));
    esiti.replaceChildren();
    if (!trovati.length) { esiti.append(el('p', { testo: 'Nessun verbale per questo mese con i filtri scelti.' })); return; }
    esiti.append(el('button', { type: 'button', class: 'btn btn-primario', testo: 'Scarica i verbali filtrati (' + trovati.length + ') in un PDF',
      onclick: () => scarica(trovati, [mese.value, sedi.get(sede.value), tipo.value].filter(Boolean).join(' - ')) }));
    for (const g of trovati) {
      const nome = [g.giorno, g.impianto, g.tipo, g.operatore, g.ditta, g.giro].filter(Boolean);
      esiti.append(el('button', { type: 'button', class: 'btn', onclick: () => scarica([g], nome.join(' - ')) }, [
        el('strong', { testo: [dataIt(g.giorno), g.impianto].join(' · ') }),
        el('div', { testo: [g.tipo, g.operatore, g.ditta, g.giro, g.righe.length + (g.righe.length === 1 ? ' verifica' : ' verifiche'), 'PDF'].filter(Boolean).join(' · ') }),
      ]));
    }
  }
  for (const menu of [mese,sede,tipo]) menu.addEventListener('change', aggiorna);
  if (!mesi.length) return el('p', { testo: 'Nello storico disponibile non ci sono verifiche periodiche eseguite.' });
  aggiorna();
  return el('div', { class: 'mensili' }, [campo('Mese di esecuzione', mese), campo('Impianto', sede),
    campo('Tipo di verifica', tipo), esiti]);
}
