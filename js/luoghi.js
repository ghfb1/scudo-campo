/**
 * Scudo Campo — l'anagrafica dei luoghi, ad albero.
 *
 * Perché un modulo a sé
 * ---------------------
 * Per la stessa ragione di `controllo.js`: in `app.js` non sarebbe eseguibile
 * fuori dal browser — quel file apre IndexedDB e avvia l'applicazione appena
 * viene importato — e una schermata che nessuna prova può costruire è una
 * schermata verificata solo guardandola. Qui dentro non c'è niente che tocchi il
 * browser oltre al DOM: le azioni che hanno effetti arrivano da fuori.
 *
 * Che cosa mostra, e che cosa NON è
 * ---------------------------------
 * Mostra i LUOGHI, non il lavoro. La differenza si vede su un edificio appena
 * creato e ancora vuoto: nell'albero del lavoro (`albero()` in `stato.js`, che
 * parte dai presidi) non esisterebbe, e chi lo ha appena creato penserebbe che
 * il salvataggio non abbia funzionato.
 *
 * Perché un albero e non un elenco piatto
 * ---------------------------------------
 * Perché la domanda che ci si pone qui è «che cosa c'è sotto questo impianto»,
 * e la risposta è una gerarchia. Ma un albero su un telefono ha un difetto suo:
 * espanso tutto è illeggibile. Quindi nasce **chiuso**, ogni nodo dice quanti
 * presidi contiene prima di aprirsi, e lo stato di apertura vive nel nodo — non
 * in una variabile globale che si porterebbe dietro l'albero di ieri.
 */
import { el, tag } from './ui.js';

const ICONA = { impianto: '🏭', edificio: '🏢', locale: '🚪', orfani: '⚠️' };
const NOME_TIPO = { impianto: 'impianto', edificio: 'edificio', locale: 'locale' };
const FIGLIO_DI = { impianto: 'edificio', edificio: 'locale' };

/**
 * Un nodo e la sua discendenza.
 *
 * @param nodo    come lo produce `alberoUbicazioni()` in stato.js
 * @param azioni  { onCrea(tipoFiglio, nodoPadre), onRinomina(nodo), onApri(nodo) }
 * @param aperti  Set di id da mostrare già espansi (serve a riaprire dopo una
 *                modifica: senza, ogni salvataggio richiuderebbe l'albero e
 *                l'operatore ricomincerebbe da capo a ogni rinomina)
 */
export function nodoAlbero(nodo, azioni = {}, aperti = new Set()) {
  const { onCrea, onRinomina, onApri } = azioni;
  const haFigli = nodo.figli && nodo.figli.length > 0;
  const chiave = `${nodo.tipo}:${nodo.id}`;
  let aperto = aperti.has(chiave);

  const figli = el('div', { class: 'albero-figli', hidden: !aperto },
    haFigli ? nodo.figli.map((f) => nodoAlbero(f, azioni, aperti)) : []);

  const freccia = el('span', {
    class: 'albero-freccia',
    testo: haFigli ? (aperto ? '▾' : '▸') : '·',
  });

  const apri = () => {
    if (!haFigli) return;
    aperto = !aperto;
    figli.hidden = !aperto;
    freccia.textContent = aperto ? '▾' : '▸';
    if (aperto) aperti.add(chiave); else aperti.delete(chiave);
  };

  // Il conteggio dei presidi PRIMA di aprire: è quello che fa decidere se vale
  // la pena. Un nodo vuoto lo dice, invece di aprirsi sul niente.
  const conteggio = nodo.presidi
    ? `${nodo.presidi} presid${nodo.presidi === 1 ? 'io' : 'i'}`
    : 'vuoto';

  const testa = el('div', { class: `albero-nodo albero-${nodo.tipo}` }, [
    el('button', {
      class: 'albero-tocca', type: 'button',
      'aria-expanded': haFigli ? String(aperto) : null,
      onclick: apri,
    }, [
      freccia,
      el('span', { class: 'albero-ico', testo: ICONA[nodo.tipo] || '📍' }),
      el('span', { class: 'albero-corpo' }, [
        el('div', { class: 'albero-nome', testo: nodo.nome }),
        el('div', { class: 'mini' }, [
          el('span', { testo: conteggio }),
          nodo.dettaglio ? el('span', { testo: ` · ${nodo.dettaglio}` }) : null,
          haFigli ? el('span', { testo: ` · ${nodo.figli.length} sotto` }) : null,
        ].filter(Boolean)),
      ]),
    ]),
    // I comandi stanno FUORI dal pulsante che apre: un pulsante dentro un
    // pulsante non è cliccabile in modo prevedibile, e su un telefono il tocco
    // finisce quasi sempre su quello sbagliato.
    nodo.riga
      ? el('div', { class: 'albero-comandi' }, [
        onApri ? el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Presidi',
          onclick: () => onApri(nodo),
        }) : null,
        onRinomina ? el('button', {
          class: 'btn btn-piccolo', type: 'button', testo: 'Rinomina',
          onclick: () => onRinomina(nodo),
        }) : null,
        (onCrea && FIGLIO_DI[nodo.tipo]) ? el('button', {
          class: 'btn btn-piccolo', type: 'button',
          testo: `+ ${NOME_TIPO[FIGLIO_DI[nodo.tipo]]}`,
          onclick: () => onCrea(FIGLIO_DI[nodo.tipo], nodo),
        }) : null,
      ].filter(Boolean))
      : null,
  ].filter(Boolean));

  return el('div', { class: 'albero-ramo' }, [testa, figli]);
}

/**
 * L'albero intero, con il conto di quello che contiene.
 *
 * Il riepilogo in testa non è decorazione: dice se quello che si sta guardando è
 * tutto l'archivio o una parte, e su un elenco che nasce chiuso è l'unico modo
 * per sapere quanto c'è sotto senza aprirlo.
 */
export function vistaAlberoLuoghi(radici, azioni = {}, aperti = new Set()) {
  if (!radici.length) {
    return el('div', { class: 'mini', testo: 'Nessuna ubicazione in archivio.' });
  }
  const edifici = radici.reduce((n, i) => n + i.figli.length, 0);
  const locali = radici.reduce((n, i) => n + i.figli.reduce((m, e) => m + e.figli.length, 0), 0);
  const vuoti = radici.flatMap((i) => [i, ...i.figli, ...i.figli.flatMap((e) => e.figli)])
    .filter((n) => !n.presidi).length;

  return el('div', {}, [
    el('div', { class: 'mini', style: 'margin-bottom:8px' }, [
      el('span', { testo: `${radici.length} impianti · ${edifici} edifici · ${locali} locali` }),
      vuoti ? el('span', { testo: ` · ${vuoti} senza presidi` }) : null,
    ].filter(Boolean)),
    el('div', { class: 'albero' }, radici.map((r) => nodoAlbero(r, azioni, aperti))),
  ]);
}
