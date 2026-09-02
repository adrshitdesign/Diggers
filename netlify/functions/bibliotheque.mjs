// /api/bibliotheque — TOUT CE QUI EXISTE DANS LE JEU, ouvert à tout le monde.
//
// Deux questions auxquelles un collectionneur veut pouvoir répondre sans
// demander à personne : « qu'est-ce qui existe ? » et « c'est rare à quel
// point, vraiment ? ». La rareté annoncée par le jeu est une probabilité ;
// ici on donne le fait : combien d'exemplaires de cette carte se promènent
// réellement dans les étagères, et sous quel pressage.
//
// C'est aussi ce qui rend le marché honnête. Sans ce compteur, personne ne
// peut savoir si le Vinyle qu'on lui propose est le seul du jeu ou le
// quarantième.
//
// Le comptage passe en revue toutes les fiches de joueurs : c'est trop lourd
// pour le refaire à chaque affichage, donc on le garde au frais quelques
// minutes. Personne n'a besoin d'une seconde près.

import { ok, ko, preflight, corps } from "./_lib.mjs";
import { store } from "./_store.mjs";
import { lire } from "./_biblio.mjs";
import { TIERS, PRESS, tierOf } from "./jeu.mjs";

export const config = { path: "/api/bibliotheque" };

const FRAICHEUR = 5 * 60 * 1000;    // on recompte au plus une fois toutes les 5 minutes
const PAGE = 60;
const MAX_JOUEURS = 4000;           // garde-fou : au-delà, on ne bloque pas la page

/* ---------------- le recensement ---------------- */

async function recenser() {
  const U = await store("utilisateurs");
  const cles = (await U.list("")).slice(0, MAX_JOUEURS);

  const parCarte = new Map();       // id -> { n, proprietaires, pressages }
  let joueurs = 0, exemplaires = 0;

  for (const cle of cles) {
    const u = await U.get(cle);
    const coffre = (u && u.jeu && Array.isArray(u.jeu.coffre)) ? u.jeu.coffre : null;
    if (!coffre) continue;
    joueurs++;
    const vusIci = new Set();
    for (const c of coffre) {
      const id = String(c.id);
      let e = parCarte.get(id);
      if (!e) { e = { n: 0, proprietaires: 0, pressages: {} }; parCarte.set(id, e); }
      e.n++;
      exemplaires++;
      const p = c.press || "Standard";
      e.pressages[p] = (e.pressages[p] || 0) + 1;
      if (!vusIci.has(id)) { vusIci.add(id); e.proprietaires++; }
    }
  }

  return {
    date: Date.now(), joueurs, exemplaires,
    cartes: Object.fromEntries(parCarte)
  };
}

async function recensement() {
  const C = await store("cache");
  const v = await C.get("exemplaires");
  if (v && v.date && Date.now() - v.date < FRAICHEUR) return { ...v, frais: false };
  const neuf = await recenser();
  await C.set("exemplaires", neuf);
  return { ...neuf, frais: true };
}

/* ---------------- la vue ---------------- */

const vide = { n: 0, proprietaires: 0, pressages: {} };

function carteVue(t, compte) {
  const e = compte || vide;
  const r = tierOf(t.pop);
  return {
    id: t.id, title: t.title, artist: t.artist, credits: t.credits || "",
    album: t.album || "", genre: t.genre || "", year: t.year || null,
    art: t.art, url: t.url || "",
    pop: t.pop, rarete: r, rareteNom: TIERS[r].n,
    source: t.source || "noyau",
    // le joueur qui a fait entrer le son dans le jeu, s'il y en a un
    trouveur: t.proposePar || null,
    exemplaires: e.n, proprietaires: e.proprietaires,
    pressages: PRESS.map(p => ({ n: p.n, nb: e.pressages[p.n] || 0 })).filter(x => x.nb > 0)
  };
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET" && req.method !== "POST") return ko(405, "méthode non autorisée");

  const p = req.method === "GET"
    ? Object.fromEntries(new URL(req.url).searchParams)
    : await corps(req);

  const b = await lire();
  const rec = await recensement();
  const compte = id => rec.cartes[String(id)];

  /* le résumé, en tête de page : ce que pèse le jeu */
  const parRarete = TIERS.map((t, i) => i === 0 ? null : { rang: i, nom: t.n, titres: 0, exemplaires: 0 });
  for (const t of b.tracks) {
    const r = parRarete[tierOf(t.pop)];
    if (!r) continue;
    r.titres++;
    r.exemplaires += (compte(t.id) || vide).n;
  }

  let l = b.tracks;

  const q = String(p.q || "").toLowerCase().trim();
  if (q) l = l.filter(t => ((t.artist || "") + " " + (t.title || "") + " " + (t.album || "")).toLowerCase().includes(q));

  const rar = Number(p.rarete);
  if (rar >= 1 && rar <= 6) l = l.filter(t => tierOf(t.pop) === rar);

  if (p.source === "communaute") l = l.filter(t => t.source === "communaute");

  const tri = String(p.tri || "rare");
  const n = t => (compte(t.id) || vide).n;
  if (tri === "az")           l = [...l].sort((a, c) => (a.artist || "").localeCompare(c.artist || "", "fr") || (a.title || "").localeCompare(c.title || "", "fr"));
  else if (tri === "commun")  l = [...l].sort((a, c) => c.pop - a.pop);
  else if (tri === "repandu") l = [...l].sort((a, c) => n(c) - n(a) || a.pop - c.pop);
  else if (tri === "rarissime") l = [...l].sort((a, c) => n(a) - n(c) || a.pop - c.pop);
  else                        l = [...l].sort((a, c) => a.pop - c.pop);   // « rare » : les plus confidentiels d'abord

  const total = l.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.min(pages, Math.max(1, Number(p.page) || 1));
  const tranche = l.slice((page - 1) * PAGE, page * PAGE);

  return ok({
    meta: {
      titres: b.tracks.length,
      exemplaires: rec.exemplaires,
      joueurs: rec.joueurs,
      recense: rec.date,
      parRarete: parRarete.filter(Boolean)
    },
    total, page, pages, parPage: PAGE,
    cartes: tranche.map(t => carteVue(t, compte(t.id)))
  }, { "cache-control": "public, max-age=60" });
}
