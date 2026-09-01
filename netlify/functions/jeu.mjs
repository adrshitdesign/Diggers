// /api/jeu — le jeu lui-même, tenu par le serveur.
//
// Avant, le navigateur tirait les cartes, décidait des raretés, s'accordait les
// crédits et envoyait au serveur une sauvegarde que personne ne relisait. La
// console suffisait à se donner une collection entière.
//
// Ici, rien ne vient du navigateur sauf des intentions : « ouvre un carton »,
// « je réponds Untel », « joue ce set ». Le serveur tire, valide, compte, range,
// et ne renvoie d'une carte que ce que le joueur a le droit de voir. Une carte
// face cachée ne porte ni titre, ni artiste, ni pochette, ni extrait : ces
// choses s'achètent une par une, et le prix est retiré du gain.

import { store } from "./_store.mjs";
import * as biblio from "./_biblio.mjs";
import {
  ok, ko, preflight, corps, authentifier, ecrireUtilisateur, uuid, jour, avecJoueur
} from "./_lib.mjs";
import { majClassement } from "./compte.mjs";

export const config = { path: "/api/jeu" };

/* ============ les règles, copiées du jeu et désormais seules valables ============ */

export const TIERS = [null,
  { n: "Tube",           w: 50, min: 88, base: 20 },
  { n: "Classique",      w: 25, min: 72, base: 35 },
  { n: "Titre d'album",  w: 12, min: 55, base: 60 },
  { n: "Face B",         w: 7,  min: 35, base: 110 },
  { n: "Rareté",         w: 4,  min: 15, base: 240 },
  { n: "Pépite",         w: 2,  min: 0,  base: 600 }];

export const PRESS = [
  { n: "Standard",   w: 78,  mult: 1 },
  { n: "Promo",      w: 12,  mult: 1.6 },
  { n: "Vinyle",     w: 7,   mult: 2.5 },
  { n: "Or ✦",       w: 2.5, mult: 6 },
  { n: "Test press", w: 0.5, mult: 25 }];

export const CLUES = {
  audio: 0, genre: 2, album: 5, mask: 4, flou: 4, crop: 7
};

const LADDER = [26, 13, 7, 4];
const GAIN_DOUBLON = 3, PLANCHER = 4;
const SET_CAP = 5, GAIN_WIN = 40, GAIN_TIE = 20, GAIN_LOSS = 12;
const ECLAT_PRESSAGE = [0, 800, 1200, 2000, 3500, 7000, 14000];
const PACKS = { jour: 0, std: 100, scene: 220 };
const COFFRE_MAX = 4000;

export const CONTRAINTES = [
  { id: "old",   l: "Rien après 1999",             f: c => c.year && c.year <= 1999 },
  { id: "new",   l: "Rien avant 2010",             f: c => c.year && c.year >= 2010 },
  { id: "court", l: "Moins de 4 minutes",          f: c => c.ms && c.ms < 240000 },
  { id: "long",  l: "Plus de 4 minutes",           f: c => c.ms && c.ms >= 240000 },
  { id: "sous",  l: "Aucun Tube",                  f: c => c.rarity >= 2 },
  { id: "pep",   l: "Que des Faces B ou plus rare", f: c => c.rarity >= 4 },
  { id: "libre", l: "Aucune contrainte",           f: () => true }];

export const tierOf = pop => {
  for (let i = 1; i < TIERS.length; i++) if (pop >= TIERS[i].min) return i;
  return 6;
};
export const coteDe = c => Math.round(TIERS[c.rarity].base * (PRESS.find(p => p.n === c.press) || PRESS[0]).mult);
export const eclatsDe = c => Math.max(2, Math.round(coteDe(c) / 2));

/* Le hasard reste ici. Rien de tout ça ne doit exister côté navigateur. */
const pickW = l => {
  const t = l.reduce((a, b) => a + b.w, 0);
  let r = Math.random() * t;
  for (const o of l) if ((r -= o.w) <= 0) return o;
  return l[l.length - 1];
};
const pickTier = () => {
  const t = TIERS.slice(1).reduce((a, b) => a + b.w, 0);
  let r = Math.random() * t;
  for (let i = 1; i < TIERS.length; i++) if ((r -= TIERS[i].w) <= 0) return i;
  return 1;
};

/* La contrainte du jour : la même pour tout le monde, tirée sur l'horloge du
   serveur — l'avancer sur sa machine ne change plus rien. */
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function contrainteDuJour(j) {
  const r = mulberry32(seedOf((j || jour()) + "|set"));
  return CONTRAINTES[Math.floor(r() * CONTRAINTES.length)];
}

/* ============ l'état d'un joueur ============ */

export function jeuNeuf() {
  return {
    credits: 400, eclats: 0,
    coffre: [], enq: {},
    idLog: "",
    gouts: null, premier: true,
    jourDate: "", setsDate: "", setsToday: 0,
    bestSet: 0, sets: 0, setsWon: 0,
    streak: 0, lastPlayed: "",
    fondus: 0, achetes: 0, presses: 0, vendus: 0,
    cree: Date.now()
  };
}

export function jeuDe(u) {
  if (!u.jeu) u.jeu = jeuNeuf();
  if (!u.jeu.enq) u.jeu.enq = {};
  if (!Array.isArray(u.jeu.coffre)) u.jeu.coffre = [];
  return u.jeu;
}

/* La journée du joueur, sur l'horloge du serveur. */
function majJournee(g) {
  const t = jour();
  if (g.setsDate !== t) { g.setsDate = t; g.setsToday = 0; }
  if (g.lastPlayed !== t) {
    const h = new Date(Date.now() - 86400000);
    const hk = h.getUTCFullYear() + "-" + String(h.getUTCMonth() + 1).padStart(2, "0") + "-" + String(h.getUTCDate()).padStart(2, "0");
    g.streak = (g.lastPlayed === hk) ? (g.streak || 0) + 1 : 1;
    g.lastPlayed = t;
  }
}

export function tauxSec(g) {
  const l = g.idLog || "";
  if (!l.length) return null;
  let n = 0;
  for (const ch of l) if (ch === "1") n++;
  return Math.round(n / l.length * 100);
}

function noterIdent(g, aSec) {
  g.idLog = ((g.idLog || "") + (aSec ? "1" : "0")).slice(-200);
}

/* ============ ce que le joueur a le droit de voir ============ */

const CHAMPS_CARTE = ["title", "artist", "credits", "album", "genre", "year", "ms", "art",
  "preview", "url", "pop", "rank", "fans", "fansMaj", "source", "proposePar"];

function pisteDe(lib, id) {
  return lib.tracks.find(t => String(t.id) === String(id)) || null;
}

/* Une carte reconnue se montre en entier. Une carte face cachée ne montre que
   ce qui a été payé : c'est toute la différence avec l'ancienne version, où le
   titre voyageait dans la page avant même la première question. */
export function carteVue(c, lib) {
  const t = pisteDe(lib, c.id);
  const base = {
    uid: c.uid, rarity: c.rarity, press: c.press, known: !!c.known,
    reveals: c.reveals == null ? null : c.reveals,
    aSec: !!c.aSec, achete: !!c.achete, tries: c.tries || 0,
    heard: !!c.heard, origine: c.origine || null,
    cote: coteDe(c)
  };
  if (!t) return { ...base, perdue: true };

  if (c.known) {
    base.id = c.id;
    for (const k of CHAMPS_CARTE) if (t[k] !== undefined) base[k] = t[k];
    return base;
  }

  // face cachée : rien qui puisse la nommer, sauf ce qui a déjà été acheté.
  const ind = c.indices || [];
  base.indices = {};
  if (ind.includes("audio")) base.indices.preview = t.preview;
  if (ind.includes("genre")) base.indices.genre = t.genre || "Autre";
  if (ind.includes("album")) base.indices.album = t.album || "—";
  if (ind.includes("mask")) base.indices.mask = masquer(t.title);
  if (ind.includes("flou") || ind.includes("crop")) base.indices.art = t.art;
  if (ind.includes("crop")) base.indices.crop = true;
  else if (ind.includes("flou")) base.indices.flou = true;
  base.choices = (c.choices || []).slice();
  base.valeur = valeurDe(c);
  return base;
}

const masquer = titre => String(titre || "").replace(/[^\s'’-]/g, "•");

function valeurDe(c) {
  let v = LADDER[Math.min(c.tries || 0, LADDER.length - 1)];
  for (const k of (c.indices || [])) v -= (CLUES[k] || 0);
  return Math.max(PLANCHER, v);
}

export function etatVu(g, lib) {
  return {
    credits: g.credits, eclats: g.eclats,
    coffre: g.coffre.map(c => carteVue(c, lib)),
    idLog: (g.idLog || "").length,
    taux: tauxSec(g),
    bestSet: g.bestSet, sets: g.sets, setsWon: g.setsWon,
    setsToday: g.setsToday, setCap: SET_CAP,
    jourDispo: g.jourDate !== jour(),
    gouts: g.gouts, premier: !!g.premier,
    streak: g.streak, fondus: g.fondus, achetes: g.achetes,
    presses: g.presses, vendus: g.vendus || 0
  };
}

/* ============ le tirage ============ */

/* Les fausses réponses sont tirées parmi les artistes qui ont, eux aussi, un
   titre du même palier. Sans ça, il suffisait de croiser la rareté affichée
   avec le catalogue public pour éliminer trois propositions sur quatre. */
function distracteurs(lib, bon, n, palier) {
  const memePalier = [...new Set(lib.tracks.filter(t => tierOf(t.pop) === palier).map(t => t.artist))]
    .filter(a => a !== bon);
  const tous = [...new Set(lib.tracks.map(t => t.artist))].filter(a => a !== bon);
  const out = [];
  const piocher = source => {
    while (out.length < n && source.length) {
      const i = Math.floor(Math.random() * source.length);
      const a = source.splice(i, 1)[0];
      if (!out.includes(a)) out.push(a);
    }
  };
  piocher(memePalier);
  piocher(tous);
  return out;
}

function tirerUne(lib, filtre) {
  const want = pickTier();
  let pool = lib.tracks.filter(t => tierOf(t.pop) === want && (!filtre || filtre(t)));
  if (!pool.length) pool = lib.tracks.filter(t => !filtre || filtre(t));
  if (!pool.length) pool = lib.tracks;
  if (!pool.length) return null;
  const t = pool[Math.floor(Math.random() * pool.length)];
  return {
    uid: t.id + "-" + uuid().slice(0, 6),
    id: t.id,
    rarity: tierOf(t.pop),
    press: pickW(PRESS).n,
    known: false, reveals: null, aSec: false, achete: false,
    tries: 0, heard: false, indices: [],
    choices: melanger([t.artist, ...distracteurs(lib, t.artist, 3, tierOf(t.pop))]),
    ouverte: Date.now()
  };
}

const melanger = a => {
  const l = a.slice();
  for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  return l;
};

/* ============ la note d'un set ============ */

const GENRE_DEC = [60, 52, 40, 28];
function transition(a, b, run) {
  const same = a.genre === b.genre;
  const g = same ? GENRE_DEC[Math.min(run || 0, GENRE_DEC.length - 1)] : 15;
  const dy = (a.year && b.year) ? Math.abs(a.year - b.year) : 25;
  return Math.round(Math.min(100, g + 40 * Math.max(0, 1 - dy / 25)));
}
function transRuns(s) {
  const out = []; let run = 0;
  for (let i = 0; i < s.length - 1; i++) {
    const same = s[i].genre === s[i + 1].genre;
    out.push(transition(s[i], s[i + 1], run));
    run = same ? run + 1 : 0;
  }
  return out;
}
function noteMontee(s) {
  let r = 0;
  for (let i = 0; i < s.length - 1; i++) if (s[i + 1].pop >= s[i].pop) r++;
  const span = s[s.length - 1].pop - s[0].pop;
  return Math.round(r / (s.length - 1) * 35 + Math.max(0, Math.min(span, 70)) / 70 * 65);
}
const noteFil = s => { const t = transRuns(s); return Math.round(t.reduce((a, b) => a + b, 0) / t.length); };
const notePepites = s => Math.round(s.reduce((a, c) => a + (100 - c.pop), 0) / s.length);
const bonusPress = s => Math.max(0, PRESS.findIndex(p => p.n === s[s.length - 1].press)) * 3;

export function noter(s) {
  const m = noteMontee(s), f = noteFil(s), p = notePepites(s), b = bonusPress(s);
  return { m, f, p, b, total: Math.min(100, Math.round(m * 0.40 + f * 0.35 + p * 0.25) + b) };
}

function setAdverse(lib, cont) {
  const pool = []; let g = 0;
  const cand = () => {
    const c = tirerUne(lib, null);
    if (!c) return null;
    const t = pisteDe(lib, c.id);
    return t ? { ...t, rarity: c.rarity, press: c.press } : null;
  };
  while (pool.length < 5 && g++ < 600) {
    const c = cand(); if (!c) break;
    if (cont.f(c) && !pool.some(x => x.id === c.id) && !pool.some(x => x.artist === c.artist)) pool.push(c);
  }
  let h = 0;
  while (pool.length < 5 && h++ < 600) {
    const c = cand(); if (!c) break;
    if (cont.f(c) && !pool.some(x => x.id === c.id)) pool.push(c);
  }
  pool.sort((a, b) => a.pop - b.pop);
  if (pool.length === 5 && Math.random() < 0.45) {
    const i = 1 + Math.floor(Math.random() * 3);
    [pool[i], pool[i + 1]] = [pool[i + 1], pool[i]];
  }
  return pool;
}

/* ============ la porte ============ */

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const u = await authentifier(req);
  if (!u) return ko(401, "Connexion expirée.");

  const b = await corps(req);

  /* Une seule action à la fois par compte.
     Le jeu entier fonctionne en « je lis ta fiche, je la modifie, je la
     réécris ». Deux requêtes du même joueur lancées à la même milliseconde
     lisaient donc le même solde : deux cartons ouverts, un seul payé, et la
     carte de l'un écrasée par l'autre. Un double-clic suffisait. */
  return await avecJoueur(u, (frais) => traiter(req, frais, b));
}

async function traiter(req, u, b) {
  const g = jeuDe(u);
  majJournee(g);
  const lib = await biblio.lire();
  const fini = async (extra) => {
    // Le résumé qui alimente le classement est calculé ici, à partir de l'état
    // que le serveur tient lui-même. Le navigateur n'a plus son mot à dire.
    u.resume = resumeDe(g);
    await ecrireUtilisateur(u);
    await majClassement(u);
    return ok({ ...(extra || {}), etat: etatVu(g, lib) });
  };

  switch (b.action) {

    /* ---------- l'état, à l'ouverture du jeu ---------- */
    // On en profite pour republier le résumé au classement : c'est le seul
    // endroit d'où il peut venir, et il doit suivre la journée du serveur.
    case "etat":
      return await fini({ contrainte: contrainteDuJour().l });

    /* ---------- l'onboarding : les artistes que le joueur dit reconnaître ---------- */
    case "gouts": {
      const l = Array.isArray(b.artistes) ? b.artistes.slice(0, 60).map(x => String(x).slice(0, 120)) : [];
      g.gouts = l;
      g.premier = l.length > 0;
      return await fini();
    }

    /* ---------- ouvrir un carton ---------- */
    case "carton": {
      const type = String(b.type || "");
      if (!(type in PACKS)) return ko(400, "Carton inconnu.");
      if (!lib.tracks.length) return ko(503, "La bibliothèque est vide.");
      if (g.coffre.length + 5 > COFFRE_MAX) return ko(409, "Ton étagère est pleine.");
      const prix = PACKS[type];
      if (type === "jour") {
        if (g.jourDate === jour()) return ko(429, "Le carton du jour a déjà été ouvert.");
      } else if (g.credits < prix) return ko(402, "Pas assez de crédits.");

      let filtre = null;
      if (g.premier && Array.isArray(g.gouts) && g.gouts.length) {
        const aimes = new Set(g.gouts);
        filtre = t => aimes.has(t.artist);
      } else if (type === "scene") {
        const genres = [...new Set(lib.tracks.map(t => t.genre || "Autre"))];
        const genre = genres[Math.floor(Math.random() * genres.length)];
        filtre = t => (t.genre || "Autre") === genre;
      }

      const tirees = [];
      for (let i = 0; i < 5; i++) {
        const c = tirerUne(lib, filtre);
        if (!c) break;
        g.coffre.push(c);
        tirees.push(c);
      }
      if (!tirees.length) return ko(503, "Rien à tirer dans la bibliothèque.");

      if (type === "jour") g.jourDate = jour();
      else g.credits -= prix;
      g.premier = false;

      return await fini({ cartes: tirees.map(c => carteVue(c, lib)) });
    }

    /* ---------- acheter un indice ---------- */
    case "indice": {
      const c = g.coffre.find(x => x.uid === b.uid);
      if (!c) return ko(404, "Carte inconnue.");
      if (c.known) return ko(409, "Cette carte est déjà reconnue.");
      const cle = String(b.cle || "");
      if (!(cle in CLUES)) return ko(400, "Indice inconnu.");
      c.indices = c.indices || [];
      if (!c.indices.includes(cle)) c.indices.push(cle);
      if (cle === "audio") c.heard = true;
      return await fini({ carte: carteVue(c, lib) });
    }

    /* ---------- répondre ---------- */
    case "repondre": {
      const c = g.coffre.find(x => x.uid === b.uid);
      if (!c) return ko(404, "Carte inconnue.");
      if (c.known) return ko(409, "Cette carte est déjà reconnue.");
      const t = pisteDe(lib, c.id);
      if (!t) return ko(410, "Ce morceau a quitté la bibliothèque.");

      const passe = b.passe === true;
      const choix = String(b.choix || "");
      if (!passe && !(c.choices || []).includes(choix)) return ko(400, "Réponse hors des propositions.");
      const bon = !passe && choix === t.artist;

      if (!bon && !passe) {
        c.tries = (c.tries || 0) + 1;
        noterIdent(g, false);
        return await fini({ bon: false, carte: carteVue(c, lib), valeur: valeurDe(c) });
      }

      const aSec = bon && (c.tries || 0) === 0 && !(c.indices || []).length && !c.heard;
      noterIdent(g, aSec);
      const doublon = g.coffre.some(x => x.uid !== c.uid && String(x.id) === String(c.id) && x.known);
      const gain = passe ? 0 : (doublon ? GAIN_DOUBLON : valeurDe(c));
      c.known = true;
      c.reveals = (c.indices || []).length;
      c.aSec = aSec;
      g.credits += gain;

      return await fini({ bon, passe, gain, doublon, aSec, carte: carteVue(c, lib) });
    }

    /* ---------- fondre des doublons ---------- */
    case "fondre": {
      const uids = Array.isArray(b.uids) ? b.uids.slice(0, 200) : [];
      const fondables = new Set(doublons(g).map(c => c.uid));
      let eclats = 0, n = 0;
      for (const uid of uids) {
        if (!fondables.has(uid)) continue;
        const i = g.coffre.findIndex(c => c.uid === uid);
        if (i < 0) continue;
        eclats += eclatsDe(g.coffre[i]);
        g.coffre.splice(i, 1);
        n++;
      }
      if (!n) return ko(400, "Aucun doublon à fondre là-dedans.");
      g.eclats += eclats;
      g.fondus += n;
      return await fini({ fondus: n, eclats });
    }

    /* ---------- presser un titre choisi ---------- */
    case "presser": {
      const t = pisteDe(lib, b.id);
      if (!t) return ko(404, "Titre inconnu.");
      if (g.coffre.length + 1 > COFFRE_MAX) return ko(409, "Ton étagère est pleine.");
      const cout = ECLAT_PRESSAGE[tierOf(t.pop)];
      if (g.eclats < cout) return ko(402, "Pas assez d'éclats.");
      g.eclats -= cout;
      g.presses++;
      const c = {
        uid: t.id + "-" + uuid().slice(0, 6), id: t.id,
        rarity: tierOf(t.pop), press: pickW(PRESS).n,
        known: true, reveals: null, aSec: false, achete: true,
        tries: 0, heard: false, indices: [], choices: []
      };
      g.coffre.push(c);
      return await fini({ carte: carteVue(c, lib), cout });
    }

    /* ---------- le Set ---------- */
    case "set": {
      const cont = contrainteDuJour();
      const elig = g.coffre.filter(c => c.known).map(c => carteVue(c, lib))
        .filter(c => !c.perdue && cont.f(c));
      const artistes = new Set(elig.map(c => c.artist)).size;
      // L'adversaire est tiré une fois et gardé : on ne relance pas la machine
      // jusqu'à tomber sur un set faible.
      if (!g.setAdv || g.setAdv.jour !== jour() || g.setAdv.cont !== cont.id) {
        const adv = setAdverse(lib, cont);
        g.setAdv = adv.length === 5
          ? { jour: jour(), cont: cont.id, cartes: adv, note: noter(adv) }
          : null;
        await ecrireUtilisateur(u);
      }
      return ok({
        contrainte: { id: cont.id, l: cont.l },
        eligibles: elig, artistes,
        adverseNote: g.setAdv ? g.setAdv.note.total : null,
        joue: g.setsToday, cap: SET_CAP,
        etat: etatVu(g, lib)
      });
    }

    case "set-jouer": {
      const uids = Array.isArray(b.uids) ? b.uids : [];
      if (uids.length !== 5) return ko(400, "Il faut cinq cartes.");
      if (new Set(uids).size !== 5) return ko(400, "Deux fois la même carte.");
      const cont = contrainteDuJour();
      const cartes = [];
      for (const uid of uids) {
        const c = g.coffre.find(x => x.uid === uid && x.known);
        if (!c) return ko(400, "Une des cartes n'est pas à toi.");
        const v = carteVue(c, lib);
        if (v.perdue) return ko(410, "Un des morceaux a quitté la bibliothèque.");
        if (!cont.f(v)) return ko(400, "Une des cartes ne respecte pas la contrainte du jour.");
        cartes.push(v);
      }
      if (new Set(cartes.map(c => c.artist)).size !== 5) return ko(400, "Il faut cinq artistes différents.");

      const moi = noter(cartes);
      const garde = (g.setAdv && g.setAdv.jour === jour() && g.setAdv.cont === cont.id) ? g.setAdv : null;
      const adv = garde ? garde.cartes : setAdverse(lib, cont);
      if (adv.length < 5) return ko(503, "Pas assez de morceaux pour un adversaire.");
      const advNote = garde ? garde.note : noter(adv);
      g.setAdv = null;   // le prochain set aura un autre adversaire
      const won = moi.total > advNote.total, tie = moi.total === advNote.total;
      const paye = g.setsToday < SET_CAP;
      const gain = paye ? (won ? GAIN_WIN : tie ? GAIN_TIE : GAIN_LOSS) : 0;

      g.credits += gain;
      g.sets++;
      if (won) g.setsWon++;
      g.setsToday++;
      if (moi.total > g.bestSet) g.bestSet = moi.total;

      return await fini({
        note: moi, adverse: adv.map(a => ({
          id: a.id, title: a.title, artist: a.artist, art: a.art, genre: a.genre,
          year: a.year, pop: a.pop, rarity: a.rarity, press: a.press
        })), adverseNote: advNote, won, tie, gain, paye
      });
    }

    default:
      return ko(400, "Action inconnue.");
  }
}

/* Les doublons : même morceau, plusieurs exemplaires reconnus. On garde
   toujours le meilleur — celui dont le pressage vaut le plus cher. */
export function doublons(g) {
  const n = {};
  g.coffre.forEach(c => { if (c.known) n[c.id] = (n[c.id] || 0) + 1; });
  const out = [];
  for (const id of Object.keys(n)) {
    if (n[id] < 2) continue;
    const ex = g.coffre.filter(c => c.known && String(c.id) === String(id))
      .sort((a, b) => coteDe(b) - coteDe(a));
    out.push(...ex.slice(1));
  }
  return out;
}

/* Ce que le classement a le droit de savoir, calculé ici et nulle part ailleurs. */
export function resumeDe(g) {
  return {
    cartes: g.coffre.filter(c => c.known).length,
    taux: tauxSec(g),
    meilleurSet: g.bestSet || 0,
    serie: g.streak || 0
  };
}
