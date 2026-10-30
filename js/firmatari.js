/**
 * Scudo Campo — CHI FIRMA il verbale, da correggere prima di scaricarlo.
 *
 * Richiesta dell'operatore (25/09/2026): «quando esportiamo il pdf deve chiederci,
 * prima che avvenga l'esportazione, di modificare i sorveglianti, rimuoverne,
 * aggiungerne, o anche gli operatori della ditta».
 *
 * Le correzioni valgono per il DOCUMENTO e non toccano i dati del giro: chi ha
 * registrato un controllo resta chi l'ha registrato. La regola che le applica è
 * `applicaFirmatari` (verbale.js), pura; qui c'è solo il foglio.
 *
 * ⚠️ La chiave di ogni riga è il nome COM'È NEI DATI (`da`): cambiando «Quali
 * verbali» cambia chi compare, e una correzione legata alla posizione in elenco
 * finirebbe sulla persona sbagliata.
 *
 * Modulo a sé (come `controllo.js`, `luoghi.js`): `app.js` non si costruisce in
 * una prova.
 */
import { el } from './ui.js';

/**
 * @param proposti  `() => firmatariProposti(verbali())`, riletto a ogni disegno
 * @returns `{ nodo, ridisegna(), scelta() }` — `scelta()` è l'argomento di `applicaFirmatari`
 */
export function foglioFirmatari(proposti) {
  const scelte = { sorv: new Map(), sorvNuovi: [], tecn: new Map(), tecnNuovi: [] };
  const nodo = el('div', { class: 'firmatari' });
  // Dopo «+ Aggiungi» il campo nuovo prende il fuoco: il pulsante premuto sparisce
  // col ridisegno, e sul telefono servirebbe un tocco in più per scrivere (visto
  // nel browser: quello che si digitava subito dopo non andava da nessuna parte).
  let fuocoSu = null;

  const riga = (valori, { conMatricola, tolto, nuovo, onNome, onMatricola, onTogli, dettaglio }) => {
    const fNome = el('input', { type: 'text', value: valori.nome || '', placeholder: 'Nome e cognome',
      'aria-label': 'Nome e cognome', class: 'firmatario-nome' });
    fNome.addEventListener('input', () => onNome(fNome.value));
    const campi = [fNome];
    if (conMatricola) {
      const fMatr = el('input', { type: 'text', value: valori.matricola || '', placeholder: 'matricola',
        'aria-label': 'Matricola', class: 'firmatario-matricola' });
      fMatr.addEventListener('input', () => onMatricola(fMatr.value));
      campi.push(fMatr);
    }
    // Una riga tolta resta in vista, spenta, con «Rimetti»: sparendo, chi l'ha
    // tolta per sbaglio non saprebbe più chi c'era.
    if (tolto) for (const c of campi) c.disabled = true;
    if (nuovo) daMettereAFuoco = fNome;
    return el('div', { class: `firmatario${tolto ? ' firmatario-tolto' : ''}` }, [
      el('div', { class: 'firmatario-riga' }, [
        ...campi,
        el('button', { class: `btn btn-piccolo${tolto ? '' : ' btn-pericolo'}`, type: 'button',
          testo: tolto ? 'Rimetti' : 'Togli', onclick: onTogli }),
      ]),
      dettaglio ? el('div', { class: 'mini', testo: dettaglio }) : null,
    ].filter(Boolean));
  };

  const sezione = (titolo, spiega, righe, aggiungi) => el('div', { class: 'firmatari-sezione' }, [
    el('label', { testo: titolo }),
    el('div', { class: 'mini', style: 'margin-bottom:6px', testo: spiega }),
    ...righe,
    el('button', { class: 'btn btn-piccolo', type: 'button', style: 'margin-top:4px',
      testo: aggiungi.testo, onclick: aggiungi.fai }),
  ]);

  let daMettereAFuoco = null;
  const ridisegna = () => {
    daMettereAFuoco = null;
    while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
    const p = proposti();
    const righeSorv = [
      ...p.sorveglianti.map((x) => {
        if (!scelte.sorv.has(x.da)) scelte.sorv.set(x.da, { nome: x.nome, matricola: x.matricola || '', tolto: false });
        const s = scelte.sorv.get(x.da);
        return riga(s, {
          conMatricola: true, tolto: s.tolto,
          onNome: (v) => { s.nome = v; }, onMatricola: (v) => { s.matricola = v; },
          onTogli: () => { s.tolto = !s.tolto; ridisegna(); },
          dettaglio: `${x.controlli} controll${x.controlli === 1 ? 'o' : 'i'}`
            + `${x.anomalie ? `, ${x.anomalie} anomali${x.anomalie === 1 ? 'a' : 'e'}` : ''} registrat${x.controlli + x.anomalie === 1 ? 'o' : 'i'}`
            + (s.tolto ? ' — non firma; nelle righe dei controlli resta chi li ha registrati' : ''),
        });
      }),
      ...scelte.sorvNuovi.map((s, i) => riga(s, {
        conMatricola: true, tolto: false, nuovo: i === scelte.sorvNuovi.length - 1 && fuocoSu === 'sorv',
        onNome: (v) => { s.nome = v; }, onMatricola: (v) => { s.matricola = v; },
        onTogli: () => { scelte.sorvNuovi.splice(i, 1); ridisegna(); },
        dettaglio: 'aggiunto qui: firma in ogni verbale di questo PDF',
      })),
    ];
    const righeTecn = [
      ...p.tecnici.map((x) => {
        if (!scelte.tecn.has(x.da)) scelte.tecn.set(x.da, { nome: x.nome, tolto: false });
        const s = scelte.tecn.get(x.da);
        return riga(s, { tolto: s.tolto, onNome: (v) => { s.nome = v; },
          onTogli: () => { s.tolto = !s.tolto; ridisegna(); } });
      }),
      ...scelte.tecnNuovi.map((s, i) => riga(s, { tolto: false, nuovo: i === scelte.tecnNuovi.length - 1 && fuocoSu === 'tecn',
        onNome: (v) => { s.nome = v; },
        onTogli: () => { scelte.tecnNuovi.splice(i, 1); ridisegna(); },
        dettaglio: 'aggiunto qui: firma in ogni verbale di questo PDF' })),
    ];
    nodo.append(
      sezione('Sorveglianti del committente',
        'Firmano per il committente. Correggi un nome scritto male, togli chi non c\'era, aggiungi chi '
          + 'era presente senza usare il telefono. Vale per questo PDF: i dati del giro non cambiano.',
        righeSorv,
        { testo: '+ Aggiungi un sorvegliante', fai: () => { scelte.sorvNuovi.push({ nome: '', matricola: '' }); fuocoSu = 'sorv'; ridisegna(); } }),
      sezione('Tecnici della ditta manutentrice',
        p.tecnici.length ? 'Firmano per presa visione.'
          : 'Il giro non ne indica nessuno: aggiungili qui, o nel PDF lo spazio resta da compilare a mano.',
        righeTecn,
        { testo: '+ Aggiungi un tecnico', fai: () => { scelte.tecnNuovi.push({ nome: '' }); fuocoSu = 'tecn'; ridisegna(); } }),
    );
    fuocoSu = null;
    if (daMettereAFuoco && daMettereAFuoco.focus) daMettereAFuoco.focus();
  };

  const scelta = () => ({
    sorveglianti: [
      ...[...scelte.sorv.entries()].map(([da, s]) => ({ da, nome: s.tolto ? '' : s.nome, matricola: s.matricola })),
      ...scelte.sorvNuovi.map((s) => ({ da: '', nome: s.nome, matricola: s.matricola })),
    ],
    tecnici: [
      ...[...scelte.tecn.entries()].map(([da, s]) => ({ da, nome: s.tolto ? '' : s.nome })),
      ...scelte.tecnNuovi.map((s) => ({ da: '', nome: s.nome })),
    ],
  });

  ridisegna();
  return { nodo, ridisegna, scelta };
}
