/**
 * Le IMMAGINI DI ESEMPIO delle tipologie di presidio (02/10/2026, dall'operatore:
 * «ogni tipologia di presidio dovrebbe riportare un'immagine di esempio, e
 * nell'anagrafica dovrebbe essere possibile visualizzarla»).
 *
 * ⚠️ DI ESEMPIO: non sono foto del presidio, e la scheda lo dice. Servono a
 * riconoscere la tipologia («com'è fatto un rilevatore termico?»), non il pezzo.
 *
 * ⛔ Due sole origini ammesse, e la prova le controlla:
 *  - LICENZA LIBERA (Wikimedia Commons: CC0, pubblico dominio, CC BY, CC BY-SA),
 *    con autore, licenza e fonte, perché queste licenze chiedono di citarli e la
 *    scheda li mostra accanto all'immagine;
 *  - `origine: 'operatore'`: foto fornite dall'operatore, che ha DICHIARATO il
 *    permesso di pubblicarle (02/10/2026: porta REI e sirena — sue, scattate in impianto —,
 *    LED, manichetta, targa, uscita di sicurezza, schiumogeno, segnalatore ottico e del portone — di catalogo, «abbiamo il permesso»). Pubblicate
 *    senza metadati (l'EXIF di un telefono porta data e talvolta posizione).
 * Una foto di negozio o catalogo SENZA quel permesso non va qui: il sito è pubblico.
 *
 * I file stanno in `img/tipologie/`, a 640 px (20-70 KB l'uno), e sono fra le
 * RISORSE del service worker: si vedono anche offline. Una tipologia senza voce
 * non mostra niente (e la scheda lo dice). Le scelte, le candidate scartate e lo
 * script che le ha scaricate stanno in automezzi-rientri/2026-10-02-immagini/.
 */
import { el } from './ui.js';

export const IMMAGINI_TIPOLOGIE = {
  SEGN_PORTONE: {"file": "./img/tipologie/SEGN_PORTONE.jpg", "titolo": "segnalatore visivo del portone", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  SCHIUMOGENO: {"file": "./img/tipologie/SCHIUMOGENO.jpg", "titolo": "fusto di schiumogeno su carrello", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  TARGA_AV: {"file": "./img/tipologie/TARGA_AV.jpg", "titolo": "targa ottico-acustica «ALLARME INCENDIO»", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  CARTELLO_USCITA: {"file": "./img/tipologie/CARTELLO_USCITA.jpg", "titolo": "Emergency exit old.jpg", "autore": "Megalesius", "licenza": "CC BY-SA 4.0", "licenza_url": "https://creativecommons.org/licenses/by-sa/4.0", "fonte": "https://commons.wikimedia.org/wiki/File:Emergency_exit_old.jpg"},
  CENTRALINA: {"file": "./img/tipologie/CENTRALINA.jpg", "titolo": "Fire alarm control panelB.jpg", "autore": "Valenzuela400", "licenza": "CC BY-SA 4.0", "licenza_url": "https://creativecommons.org/licenses/by-sa/4.0", "fonte": "https://commons.wikimedia.org/wiki/File:Fire_alarm_control_panelB.jpg"},
  ESTINTORE: {"file": "./img/tipologie/ESTINTORE.jpg", "titolo": "Fire extinguisher tool.jpg", "autore": "Denis kasozi", "licenza": "CC BY 4.0", "licenza_url": "https://creativecommons.org/licenses/by/4.0", "fonte": "https://commons.wikimedia.org/wiki/File:Fire_extinguisher_tool.jpg"},
  EVAC_FUMI: {"file": "./img/tipologie/EVAC_FUMI.jpg", "titolo": "VENTZ control panel for heat and smoke vents (01).jpg", "autore": "Georg Pik", "licenza": "CC0", "licenza_url": "http://creativecommons.org/publicdomain/zero/1.0/deed.en", "fonte": "https://commons.wikimedia.org/wiki/File:VENTZ_control_panel_for_heat_and_smoke_vents_(01).jpg"},
  GRUPPO_CONTINUITA: {"file": "./img/tipologie/GRUPPO_CONTINUITA.jpg", "titolo": "Uninterruptible power supply.jpg", "autore": "Tahir mq", "licenza": "CC BY-SA 4.0", "licenza_url": "https://creativecommons.org/licenses/by-sa/4.0", "fonte": "https://commons.wikimedia.org/wiki/File:Uninterruptible_power_supply.jpg"},
  GRUPPO_ELETTROGENO: {"file": "./img/tipologie/GRUPPO_ELETTROGENO.jpg", "titolo": "Caterpillar (Olympian) Generator Set.jpg", "autore": "Gregsedits", "licenza": "CC BY-SA 3.0", "licenza_url": "https://creativecommons.org/licenses/by-sa/3.0", "fonte": "https://commons.wikimedia.org/wiki/File:Caterpillar_(Olympian)_Generator_Set.jpg"},
  IDRANTE: {"file": "./img/tipologie/IDRANTE.jpg", "titolo": "Fire hydrant pillar two ways.jpg", "autore": "Gendhiscantik", "licenza": "CC BY-SA 4.0", "licenza_url": "https://creativecommons.org/licenses/by-sa/4.0", "fonte": "https://commons.wikimedia.org/wiki/File:Fire_hydrant_pillar_two_ways.jpg"},
  IDRICO: {"file": "./img/tipologie/IDRICO.jpg", "titolo": "cassetta con manichetta su colonna", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  IMP_FISSO_CO2: {"file": "./img/tipologie/IMP_FISSO_CO2.jpg", "titolo": "Argonaute CO2 fire extinguising.jpg", "autore": "Hervé Cozanet", "licenza": "CC BY-SA 3.0", "licenza_url": "http://creativecommons.org/licenses/by-sa/3.0/", "fonte": "https://commons.wikimedia.org/wiki/File:Argonaute_CO2_fire_extinguising.jpg"},
  LAMPADA_EMERG: {"file": "./img/tipologie/LAMPADA_EMERG.jpg", "titolo": "plafoniera di emergenza LED: in ricarica e in emergenza", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  LED_BACKUP: {"file": "./img/tipologie/LED_BACKUP.jpg", "titolo": "plafoniera di emergenza LED", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  LEVA_SGANCIO: {"file": "./img/tipologie/LEVA_SGANCIO.jpg", "titolo": "Canoe Creek Service Plaza; Emergency Fuel Pump Shut-Off Button.jpg", "autore": "DanTD", "licenza": "CC BY 4.0", "licenza_url": "https://creativecommons.org/licenses/by/4.0", "fonte": "https://commons.wikimedia.org/wiki/File:Canoe_Creek_Service_Plaza;_Emergency_Fuel_Pump_Shut-Off_Button.jpg"},
  PORTA_REI: {"file": "./img/tipologie/PORTA_REI.jpg", "titolo": "porta REI fotografata in un impianto", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  PULSANTE_EMERG: {"file": "./img/tipologie/PULSANTE_EMERG.jpg", "titolo": "Manual call point 1.jpg", "autore": "Edward Betts", "licenza": "Public domain", "licenza_url": "", "fonte": "https://commons.wikimedia.org/wiki/File:Manual_call_point_1.jpg"},
  RIL_FUMO: {"file": "./img/tipologie/RIL_FUMO.jpg", "titolo": "Smoke detector, Russia (11).jpg", "autore": "Georg Pik", "licenza": "CC0", "licenza_url": "http://creativecommons.org/publicdomain/zero/1.0/deed.en", "fonte": "https://commons.wikimedia.org/wiki/File:Smoke_detector,_Russia_(11).jpg"},
  RIL_IDROGENO: {"file": "./img/tipologie/RIL_IDROGENO.jpg", "titolo": "rilevatore di gas fisso (Evikon E2630)", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  RIL_TERMICO: {"file": "./img/tipologie/RIL_TERMICO.jpg", "titolo": "Heat detector (02).JPG", "autore": "Georg Pik", "licenza": "CC0", "licenza_url": "http://creativecommons.org/publicdomain/zero/1.0/deed.en", "fonte": "https://commons.wikimedia.org/wiki/File:Heat_detector_(02).JPG"},
  SCHIUMA_IMPIANTO: {"file": "./img/tipologie/SCHIUMA_IMPIANTO.jpg", "titolo": "Hidromesclador 3.jpg", "autore": "Ricard Cervantes", "licenza": "CC BY-SA 2.5", "licenza_url": "https://creativecommons.org/licenses/by-sa/2.5", "fonte": "https://commons.wikimedia.org/wiki/File:Hidromesclador_3.jpg"},
  SEGN_OTTICO: {"file": "./img/tipologie/SEGN_OTTICO.jpg", "titolo": "segnalatore ottico luminoso", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  SIRENA: {"file": "./img/tipologie/SIRENA.jpg", "titolo": "sirena antincendio a soffitto, fotografata in impianto", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  USCITA_SICUREZZA: {"file": "./img/tipologie/USCITA_SICUREZZA.jpg", "titolo": "porta d'uscita con maniglione antipanico", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"},
  VENT_BATTERIE: {"file": "./img/tipologie/VENT_BATTERIE.jpg", "titolo": "Exhaust-fan-on-side-wall.jpg", "autore": "Adamantios", "licenza": "CC BY-SA 3.0", "licenza_url": "http://creativecommons.org/licenses/by-sa/3.0/", "fonte": "https://commons.wikimedia.org/wiki/File:Exhaust-fan-on-side-wall.jpg"},
};

/** L'immagine di esempio di una categoria, o `null`. */
export function immagineDiCategoria(codice) {
  return IMMAGINI_TIPOLOGIE[codice] || null;
}

/**
 * Le VARIANTI dentro una tipologia (02/10/2026, dall'operatore: «per gli
 * estintori, se carrellati, usa questo»). Si sceglie dal valore di un campo del
 * presidio — `installazione`, la tendina che dal 16/09 ha preso il posto della
 * casella «Carrellato» (ritirata: vedi `CAMPI_RITIRATI` in stato.js). Misurato
 * sul pacchetto: 50 estintori CARRELLATO, 358 PORTATILE.
 */
export const VARIANTI_IMMAGINI = [
  { categoria: 'ESTINTORE', campo: 'installazione', valore: 'CARRELLATO', nome: 'Estintore carrellato',
    immagine: {"file": "./img/tipologie/ESTINTORE_CARRELLATO.jpg", "titolo": "estintore carrellato", "origine": "operatore", "autore": "fornita dall'operatore", "licenza": "uso autorizzato", "licenza_url": "", "fonte": "", "aggiunta_il": "2026-10-02"} },
];

/** L'immagine di esempio per QUESTO presidio: la variante se c'è, sennò la tipologia. */
export function immagineDelPresidio(a) {
  const x = a || {};
  const v = VARIANTI_IMMAGINI.find((w) => w.categoria === x.categoria_codice
    && String(x[w.campo] || '').trim().toUpperCase() === w.valore);
  return v ? { ...v.immagine, nome: v.nome } : immagineDiCategoria(x.categoria_codice);
}

/**
 * Il riquadro dell'anagrafica: APERTO di default (02/10/2026, dall'operatore: «le
 * immagini mettile aperte di default»), e si chiude con un tocco (`<details
 * open>`, non un foglio: aprirne uno chiuderebbe la scheda del presidio).
 * Sotto, i crediti che la licenza chiede: autore, licenza, fonte.
 */
export function bloccoImmagineTipologia(codice, nomeCategoria = '', immagine = undefined) {
  const im = immagine === undefined ? immagineDiCategoria(codice) : immagine;
  if (!im) {
    return el('div', { class: 'mini immagine-tipologia-assente',
      testo: `Nessuna immagine di esempio per ${nomeCategoria || 'questa tipologia'}.` });
  }
  return el('details', { class: 'immagine-tipologia', open: true }, [
    el('summary', { testo: `🖼 Immagine di esempio${nomeCategoria ? `: ${nomeCategoria}` : ''}` }),
    el('img', { src: im.file, alt: `Esempio di ${nomeCategoria || codice}`, loading: 'lazy' }),
    el('div', { class: 'mini', testo: "Immagine di ESEMPIO della tipologia, non di questo presidio." }),
    im.origine === 'operatore'
      ? el('div', { class: 'mini immagine-crediti', testo: "Foto fornita dall'operatore, uso autorizzato." })
      : el('div', { class: 'mini immagine-crediti' }, [
        `Foto: ${im.autore} · `,
        im.licenza_url ? el('a', { href: im.licenza_url, target: '_blank', rel: 'noopener', testo: im.licenza }) : im.licenza,
        ' · ',
        el('a', { href: im.fonte, target: '_blank', rel: 'noopener', testo: 'Wikimedia Commons' }),
      ]),
  ]);
}

/** Il riquadro per un presidio: con la variante (es. «Estintore carrellato») se c'è. */
export function bloccoImmagineDelPresidio(a, nomeCategoria = '') {
  const im = immagineDelPresidio(a);
  return bloccoImmagineTipologia(a && a.categoria_codice, (im && im.nome) || nomeCategoria, im);
}
