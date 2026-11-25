import * as S from './stato.js';
import { el, campo, dataIt } from './ui.js';
import { eMensile, tipoPeriodicoInBlocco } from './piani.js';
import * as CAL from './calcoli.js';

export const GRUPPI_VISITA = {
  dovute: 'Scadute o in scadenza oggi',
  prima_esecuzione: 'Prima verifica richiesta',
  entro_visita: 'Scade entro la prossima visita stimata',
  valutare_anticipo: 'Scade tra le due visite stimate',
  impedite: 'Impedimenti da riesaminare',
  fine_vita: 'Fine vita da gestire',
  da_chiarire: 'Piano o dati da completare',
  visita_incerta: 'Scadenze future con visita da confermare',
  successive: 'Scadenze successive',
};

export function gruppoVisita(scadenza, visita, oggi) {
  if (!scadenza) return 'da_chiarire';
  if (scadenza <= oggi) return 'dovute';
  if (!visita.data_stimata || visita.data_stimata < oggi) return 'visita_incerta';
  if (scadenza <= visita.data_stimata) return 'entro_visita';
  const seguente = CAL.prossimaScadenza(visita.data_stimata, visita.mesi, 'MESI');
  return seguente && scadenza < seguente ? 'valutare_anticipo' : 'successive';
}

// Gli stessi ambiti alimentano i pulsanti di registrazione e la consultazione MCP.
export function ambitiPeriodici(gruppo, scadenza, oggi) {
  const ambiti = ['tutti'];
  if (['dovute', 'prima_esecuzione'].includes(gruppo)) ambiti.push('dovuti', 'entro_sette_giorni');
  else if (scadenza > oggi && scadenza <= CAL.prossimaScadenza(oggi, 7, 'GIORNI')
    && ['entro_visita', 'valutare_anticipo', 'successive', 'visita_incerta'].includes(gruppo)) ambiti.push('entro_sette_giorni');
  if (['entro_visita', 'valutare_anticipo'].includes(gruppo)) ambiti.push('valutare_visita');
  return ambiti;
}

// Una riga per controllo applicabile sul pezzo attuale. Lo stato della scheda
// nel pacchetto è un'informazione descrittiva, indipendente dalla scadenza.
export function pianoVisita(impiantoId = '', oggi = S.oggiIso()) {
  const righe = [];
  for (const a of S.cerca({ impiantoId })) {
    if (S.sospendeLavoro(a)) continue;
    const scheda = S.nelPerimetro(a) ? S.vistaPresidioNelGiro(a) : 'fuori_perimetro';
    const eventi = S.interventiDi(a.id).filter(i => !i.eliminato_il && i.data <= oggi
      && CAL.valePerIlPezzo(i.matricola_pezzo, a.matricola));
    const voci = S.vociDelGiro(a.id).mancanti;
    for (const t of S.controlliApplicabili(a)) {
      const storia = eventi.filter(i => i.tipo_controllo_codice === t.codice);
      const registrata = CAL.ultimaEsecuzione(storia);
      const dichiarata = CAL.esecuzioneDalPresidio(a, t.codice, oggi);
      const ultima = dichiarata && (!registrata || dichiarata > registrata) ? dichiarata : registrata;
      const tentativo = CAL.ultimoTentativoNonEseguibile(storia);
      const fineVita = S.eFineVita(t.codice, t.piano_id);
      const daUltima = !fineVita && ultima && t.piano_id
        ? CAL.prossimaScadenza(ultima, t.frequenza_valore, t.frequenza_unita) : null;
      const scadenza = t.scadenza || daUltima || null;
      const visita = S.stimaVisita(a, t, scadenza, oggi);
      const quando = gruppoVisita(scadenza, visita, oggi);
      let gruppo = quando;
      let motivo = GRUPPI_VISITA[quando];
      if (quando === 'valutare_anticipo') {
        const seguente = CAL.prossimaScadenza(visita.data_stimata, visita.mesi, 'MESI');
        motivo = 'Scade prima del passaggio successivo stimato per il ' + dataIt(seguente)
          + '. Valutare l’anticipo con chi esegue il controllo.';
      }
      if (!t.piano_id || t.dati_per_scadenza?.length) {
        gruppo = 'da_chiarire'; motivo = t.motivo || 'Completare i dati necessari al calcolo';
      } else if (fineVita) {
        if (!scadenza) gruppo = 'da_chiarire';
        else if (['dovute', 'entro_visita', 'valutare_anticipo'].includes(quando)) gruppo = 'fine_vita';
        motivo = 'Valutare la sostituzione alla data di fine vita';
      } else if (t.centralina_fuori || (tentativo && S.ESITI_NON_ESEGUIBILI.includes(tentativo.esito))) {
        gruppo = 'impedite'; motivo = t.centralina_fuori ? 'Centralina fuori servizio'
          : [tentativo.esito, tentativo.motivo].filter(Boolean).join(' · ');
      } else if (!scadenza && !ultima && (eMensile(t) || voci.some(v => v.codice === t.codice))) {
        gruppo = 'prima_esecuzione'; motivo = 'Piano applicabile senza una precedente esecuzione documentata';
      }
      righe.push({ asset_id: a.id, identificativo: a.identificativo || a.codice,
        impianto_id: a.impianto_id, impianto: S.indici.impianti.get(a.impianto_id)?.denominazione || '',
        ubicazione: S.ubicazione(a), piano_id: t.piano_id,
        periodico: eMensile(t), tipo_in_blocco: tipoPeriodicoInBlocco(t, S.tipoAssetDi(a)),
        ambiti_periodici: eMensile(t) && scheda !== 'fuori_perimetro' ? ambitiPeriodici(gruppo, scadenza, oggi) : [],
        selezionabile: scheda !== 'fuori_perimetro' && eMensile(t) && S.sorveglianzaTerna(a, t.codice, t.esecutore),
        codice_controllo: t.codice, controllo: t.descrizione,
        tema: S.tipoAssetDi(a) === 'CLIMATIZZATORE' ? 'clima' : 'antincendio',
        esecutore: t.esecutore, periodicita: t.frequenza_testo, ultima_esecuzione: ultima,
        scadenza, stato_scheda: scheda, gruppo, motivo, visita });
    }
  }
  return righe.sort((a,b) => (a.scadenza || '9999').localeCompare(b.scadenza || '9999')
    || a.identificativo.localeCompare(b.identificativo, 'it', { numeric: true })
    || a.codice_controllo.localeCompare(b.codice_controllo));
}


export const STATO_SCHEDA = { fatti: 'Fatti', sospesi: 'Sospesi', da_fare: 'Aperte', fuori_perimetro: 'Fuori dal perimetro del giro', fuori: 'Fuori giro' };

export function pianificazioneImpianto(righe, impiantoId, apriPresidio, scegliImpianto) {
  const impianti = [...S.indici.impianti.values()].sort((a,b) => a.denominazione.localeCompare(b.denominazione, 'it'));
  const opzione = (valore, testo) => el('option', { value: valore, testo });
  const attivita = el('select', {}, [opzione('', 'Tutte le attività')]);
  const nomi = new Map();
  for (const r of righe) nomi.set(r.codice_controllo, S.indici.tipiControllo.get(r.codice_controllo)?.descrizione || r.controllo);
  for (const [codice, nome] of [...nomi].sort((a,b) => a[1].localeCompare(b[1], 'it'))) attivita.append(opzione(codice, nome));
  const elenco = el('div', { class: 'piano-visita' });
  function aggiorna() {
    elenco.replaceChildren();
    const filtrate = attivita.value ? righe.filter(r => r.codice_controllo === attivita.value) : righe;
    if (!impiantoId) {
      for (const i of impianti) {
        const locali = filtrate.filter(r => r.impianto_id === i.id);
        if (!locali.length) continue;
        const conta = k => locali.filter(r => r.gruppo === k).length;
        elenco.append(el('button', { type: 'button', class: 'voce', onclick: () => {
          scegliImpianto(i.id);
        } }, [el('span', { class: 'voce-corpo' }, [el('strong', { testo: i.denominazione }),
          el('span', { class: 'voce-sotto', testo: [conta('dovute') + ' scadute o dovute oggi',
            conta('prima_esecuzione') + ' prime verifiche', conta('entro_visita') + ' entro il passaggio',
            conta('valutare_anticipo') + ' anticipi da valutare'].join(' · ') })])] ));
      }
      return;
    }
    const locali = filtrate;
    elenco.append(el('strong', { testo: locali.length + ' attività · ' + S.indici.impianti.get(impiantoId)?.denominazione }));
    if (!locali.length) elenco.append(el('p', { testo: 'Nessuna attività per questa selezione.' }));
    for (const [gruppo, nome] of Object.entries(GRUPPI_VISITA)) {
      const voci = locali.filter(r => r.gruppo === gruppo);
      if (!voci.length) continue;
      const lista = el('div');
      let limite = 0;
      function mostra() {
        const fino = Math.min(limite + 40, voci.length);
        for (const r of voci.slice(limite, fino)) {
          const dettaglio = el('button', { class: 'voce', type: 'button', onclick: () => apriPresidio(r) }, [
            el('span', { class: 'voce-corpo' }, [el('strong', { testo: r.identificativo + ' · ' + r.controllo }),
              el('span', { class: 'voce-sotto', testo: [r.ubicazione, r.esecutore, r.periodicita].filter(Boolean).join(' · ') }),
              el('span', { class: 'voce-sotto', testo: [
                r.ultima_esecuzione ? 'Ultima esecuzione ' + dataIt(r.ultima_esecuzione) : 'Ultima esecuzione non disponibile',
                r.scadenza ? 'Scadenza ' + dataIt(r.scadenza) : 'Scadenza da determinare',
                'Scheda nel pacchetto · ' + STATO_SCHEDA[r.stato_scheda]].join(' · ') }),
              el('span', { class: 'voce-sotto', testo: r.visita.testo }),
              r.motivo !== nome ? el('span', { class: 'voce-sotto', testo: r.motivo }) : null])]);
          lista.append(dettaglio);
        }
        limite = fino;
        if (limite < voci.length) {
          const altri = el('button', { type: 'button', class: 'btn', testo: 'Mostra altre attività', onclick: () => { altri.remove(); mostra(); } });
          lista.append(altri);
        }
      }
      const aperto = gruppo === 'dovute';
      const sezione = el('details', { class: 'card', open: aperto, ontoggle: () => {
        if (sezione.open && !limite) mostra();
      } }, [el('summary', { testo: nome + ' · ' + voci.length }), lista]);
      if (aperto) mostra();
      elenco.append(sezione);
    }
  }
  attivita.addEventListener('change', aggiorna);
  aggiorna();
  return el('div', {}, [el('p', { testo: 'Ogni riga è una verifica. Sono incluse le ricorrenze delle schede già fatte o sospese. Le date dei passaggi sono stime per attività e impianto.' }),
    campo('Attività della visita', attivita), elenco]);
}
