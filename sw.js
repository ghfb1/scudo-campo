/**
 * Scudo Campo — service worker.
 *
 * Serve a una cosa sola: aprire l'app dentro una cabina, senza rete. Non tocca
 * i dati del rilievo, che vivono in IndexedDB e non passano da qui.
 *
 * Strategia: cache-first sui file dell'applicazione, che sono statici e
 * versionati dal nome della cache. Alzare VERSIONE pubblica una nuova
 * revisione; le vecchie cache vengono eliminate all'attivazione.
 *
 * Nota sul percorso: tutte le voci sono RELATIVE. Su GitHub Pages il sito vive
 * sotto `/<repo>/`, non sulla radice del dominio: un percorso assoluto come
 * `/index.html` punterebbe fuori dal sito e la cache resterebbe vuota, con
 * l'app che sembra funzionare finché c'è rete e sparisce quando serve davvero.
 */
const VERSIONE = 'scudo-campo-v41';

const RISORSE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './js/app.js',
  './js/stato.js',
  './js/store.js',
  './js/ui.js',
  './js/pacchetto.js',
  './js/zip.js',
  './js/campi.js',
  './js/accesso.js',
  './js/piani.js',
  './js/grafici.js',
  './js/controllo.js',
  './js/calcoli.js',
  './js/luoghi.js',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil((async () => {
    const cache = await caches.open(VERSIONE);
    // addAll fallisce tutto se una sola risorsa manca: si aggiunge una per una
    // così un file rinominato non lascia l'app senza nessuna cache.
    await Promise.all(RISORSE.map(async (r) => {
      try { await cache.add(new Request(r, { cache: 'reload' })); } catch { /* singola risorsa non disponibile */ }
    }));
    // NIENTE skipWaiting automatico.
    //
    // Attivarsi da soli significa che da quel momento la cache nuova serve i
    // file nuovi a una pagina che sta ancora ESEGUENDO i moduli vecchi: due
    // revisioni mescolate nella stessa sessione, che è peggio di restare
    // indietro. La nuova revisione entra quando l'operatore preme "Aggiorna" —
    // e quel pulsante ricarica, quindi non resta niente di misto.
  })());
});

// L'attivazione la chiede la pagina, quando l'operatore accetta.
self.addEventListener('message', (ev) => {
  if (ev.data === 'ATTIVA_ORA') self.skipWaiting();
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil((async () => {
    const chiavi = await caches.keys();
    // La cache dei pacchetti condivisi non è versionata: cancellarla a ogni
    // aggiornamento butterebbe un file appena ricevuto.
    await Promise.all(chiavi
      .filter((k) => k !== VERSIONE && k !== CONDIVISI)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Ricezione di un pacchetto condiviso (Android: Condividi -> Scudo Campo).
//
// Il file arriva come POST multipart, e una pagina non può leggerlo: solo il
// service worker vede quella richiesta. Lo mette da parte in una cache, risponde
// con un redirect alla pagina, e l'app lo raccoglie all'avvio.
//
// Si usa una cache e non postMessage perché al momento della POST la pagina non
// esiste ancora: l'app viene aperta DA questa richiesta.
const CONDIVISI = 'scudo-campo-condivisi';

self.addEventListener('fetch', (ev) => {
  const req = ev.request;

  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/carica')) {
    ev.respondWith((async () => {
      try {
        const form = await req.formData();
        const file = form.get('pacchetto');
        if (file && file.size) {
          const cache = await caches.open(CONDIVISI);
          await cache.put('./in-arrivo', new Response(file, {
            headers: {
              'Content-Type': 'application/zip',
              'X-Nome-File': encodeURIComponent(file.name || 'pacchetto.zip'),
            },
          }));
        }
      } catch {
        // Se la lettura fallisce si apre comunque l'app: l'operatore carica il
        // file a mano, che è il percorso di sempre. Meglio di una pagina di
        // errore in cui il pacchetto è perso e non si sa perché.
      }
      return Response.redirect('./?condiviso=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  ev.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) {
      // Aggiornamento in sottofondo: la prossima apertura avrà la versione
      // nuova, questa continua a funzionare con quella già in mano.
      ev.waitUntil((async () => {
        try {
          const fresca = await fetch(req);
          if (fresca && fresca.ok) (await caches.open(VERSIONE)).put(req, fresca.clone());
        } catch { /* offline: si tiene la copia in cache */ }
      })());
      return cached;
    }
    try {
      const risposta = await fetch(req);
      if (risposta && risposta.ok && risposta.type === 'basic') {
        (await caches.open(VERSIONE)).put(req, risposta.clone());
      }
      return risposta;
    } catch (e) {
      // Navigazione offline verso una risorsa mai vista: si serve la home,
      // che è l'unica pagina dell'applicazione.
      if (req.mode === 'navigate') {
        const home = await caches.match('./index.html');
        if (home) return home;
      }
      throw e;
    }
  })());
});
