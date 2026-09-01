// /api/defi — LE DÉFI DU JOUR
//
// La question à laquelle ce fichier répond : pourquoi revenir un mardi soir ?
//
// Un thème identique pour tout le monde, tiré du même sac chaque jour. Chacun
// pose UNE carte de son étagère — donc il faut l'avoir, donc la collection sert
// à autre chose qu'à être grande. Ensuite on vote, mais en duel et à l'aveugle :
// deux cartes côte à côte, sans savoir qui les a posées. Le lendemain le
// palmarès tombe et le podium est payé.
//
// Le vote aveugle n'est pas un détail : sans lui, on vote pour ses copains et
// pour les morceaux connus. Avec lui, ce sont les trouvailles qui gagnent —
// c'est exactement le tri qu'un digger revendique.
//
// Comme le reste de la v2, rien ne vient du navigateur sauf des intentions.
// Le joueur envoie le numéro d'une carte de SON étagère ; le serveur va
// chercher le morceau dans la bibliothèque. Aucune adresse d'image ou
// d'extrait fournie par un client n'entre jamais ici.

import { store, majAtomique } from "./_store.mjs";
import * as biblio from "./_biblio.mjs";
import {
  ok, ko, preflight, corps, authentifier, jour, uuid, seedOf, majJoueur, avecJoueur
} from "./_lib.mjs";
import { jeuDe, coteDe, resumeDe } from "./jeu.mjs";
import { majClassement } from "./compte.mjs";

export const config = { path: "/api/defi" };

/* Les thèmes. Volontairement écrits comme des questions de comptoir : on doit
   pouvoir y répondre avec une carte, pas avec un raisonnement. */
export const THEMES = [
  "Le son qui réveille une salle à trois heures du matin",
  "Celui qu'on met pour un dimanche pluvieux",
  "Le meilleur featuring, toutes époques confondues",
  "Le morceau qu'on n'ose pas avouer aimer",
  "La plus belle intro de tous les temps",
  "Le son qui sent l'été 2015",
  "Celui qu'on met en voiture, fenêtres ouvertes",
  "Le morceau le plus triste de ta collection",
  "La meilleure basse",
  "Le son qu'on met pour impressionner quelqu'un",
  "Le morceau qui te rappelle le collège",
  "Celui que personne d'autre ne connaîtra ici",
  "La meilleure fin de morceau",
  "Le son pour rentrer à pied à quatre heures du matin",
  "Le morceau qu'on passerait à un mariage",
  "La voix la plus reconnaissable",
  "Le son qui a le mieux vieilli",
  "Celui qu'on met quand on est énervé",
  "Le meilleur sample",
  "Le morceau qui donne envie de danser tout seul",
  "La plus belle production, sans le texte",
  "Le son qui mériterait d'être connu",
  "Celui qu'on met à quelqu'un pour lui faire découvrir un genre",
  "Le morceau le plus court qui marque",
  "La meilleure face B",
  "Le son de fin de soirée, quand il reste trois personnes",
  "Le morceau qu'on écoute en boucle sans se lasser",
  "Celui qui raconte le mieux une ville"
];

export const MAX_VOTES = 24;          // duels par joueur et par jour
export const GAIN_VOTE = 2;           // pour avoir tranché, quel que soit le camp
export const GAIN_PODIUM = [120, 60, 30];
export const MINI_DUELS = 3;          // en dessous, une entrée n'est pas classée

export function themeDu(date) {
  return THEMES[seedOf("defi|" + date) % THEMES.length];
}

const veille = (d) => {
  const t = new Date(d + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

const defautDefi = (date) => ({ date, theme: themeDu(date), entrees: [], clos: false });

async function lireDefi(date) {
  const d = await (await store("defis")).get(date);
  if (!d) return defautDefi(date);
  if (!d.theme) d.theme = themeDu(date);
  if (!Array.isArray(d.entrees)) d.entrees = [];
  return d;
}

/* Toute écriture sur un défi passe par ici : on relit, on transforme, et on
   n'écrit que si personne n'a bougé entre-temps. Sans ça, deux votes tombés à
   la même milliseconde s'écrasent l'un l'autre et un duel disparaît — le
   palmarès devient faux sans que personne ne s'en aperçoive.
   Le transformateur renvoie null pour renoncer (déjà posé, déjà clos). */
function majDefi(date, transformer) {
  return majAtomique("defis", date, (brut) => {
    const d = brut || defautDefi(date);
    if (!d.theme) d.theme = themeDu(date);
    if (!Array.isArray(d.entrees)) d.entrees = [];
    return transformer(d);
  });
}

/* Ce qu'une entrée montre au public : le morceau, jamais qui l'a posé.
   Le morceau est relu dans la bibliothèque à chaque affichage — on ne fait
   confiance à rien de ce qui a pu être écrit à côté. */
function entreeVue(e, lib, avecPseudo) {
  const t = (lib.tracks || []).find(x => String(x.id) === String(e.carteId));
  const carte = t ? {
    title: t.title, artist: t.artist, credits: t.credits || "",
    album: t.album || "", genre: t.genre || "", year: t.year || null,
    art: t.art, preview: t.preview, url: t.url,
    rarity: e.rarity, press: e.press, cote: coteDe({ rarity: e.rarity, press: e.press })
  } : { perdue: true, rarity: e.rarity, press: e.press };
  const v = { id: e.id, carte };
  if (avecPseudo) { v.pseudo = e.pseudo; v.duels = e.duels; v.gagnes = e.gagnes; }
  return v;
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();

  const aujourdhui = jour();

  /* ---------------- le thème du jour, ouvert à tous ---------------- */
  if (req.method === "GET") {
    const d = await lireDefi(aujourdhui);
    return ok({ date: d.date, theme: d.theme, entrees: d.entrees.length },
      { "cache-control": "public, max-age=30" });
  }
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const u = await authentifier(req);
  if (!u) return ko(401, "Il faut un compte pour jouer au défi.");
  const b = await corps(req);

  // Le défi touche aux crédits et à l'étagère : même règle que le reste du jeu.
  return await avecJoueur(u, (frais) => traiter(frais, b, aujourdhui));
}

async function traiter(u, b, aujourdhui) {
  const lib = await biblio.lire();
  const d = await lireDefi(aujourdhui);
  const mien = d.entrees.find(e => e.uid === u.uid);
  const g = jeuDe(u);

  /* ---------------- où j'en suis ---------------- */
  if (b.action === "etat") {
    const j = (u.defi && u.defi.jour === aujourdhui) ? u.defi : { jour: aujourdhui, votes: 0 };
    return ok({
      date: d.date, theme: d.theme, entrees: d.entrees.length,
      posee: mien ? entreeVue(mien, lib, false).carte : null,
      votes: j.votes || 0, votesRestants: Math.max(0, MAX_VOTES - (j.votes || 0)),
      duelPossible: d.entrees.filter(e => e.uid !== u.uid).length >= 2,
      credits: g.credits
    });
  }

  /* ---------------- ce que je peux poser ---------------- */
  if (b.action === "cartes") {
    const vues = new Set(), liste = [];
    for (const c of g.coffre) {
      if (!c.known) continue;                       // une carte face cachée ne répond à rien
      const t = (lib.tracks || []).find(x => String(x.id) === String(c.id));
      if (!t) continue;
      const cle = String(c.id);
      if (vues.has(cle)) continue;                  // un seul exemplaire par morceau
      vues.add(cle);
      liste.push({
        uid: c.uid, title: t.title, artist: t.artist, art: t.art,
        year: t.year || null, rarity: c.rarity, press: c.press
      });
    }
    return ok({ cartes: liste, theme: d.theme, deja: !!mien });
  }

  /* ---------------- poser sa carte ---------------- */
  if (b.action === "poser") {
    if (mien) return ko(409, "Tu as déjà posé une carte aujourd'hui.");
    const c = g.coffre.find(x => x.uid === String(b.uid || ""));
    if (!c) return ko(404, "Cette carte n'est pas dans ton étagère.");
    if (!c.known) return ko(409, "Une carte encore face cachée ne répond à rien : trouve-la d'abord.");
    const t = (lib.tracks || []).find(x => String(x.id) === String(c.id));
    if (!t) return ko(410, "Ce morceau n'est plus dans la bibliothèque.");

    const entree = {
      id: uuid(), uid: u.uid, pseudo: u.pseudo, pose: Date.now(),
      carteId: String(c.id), rarity: c.rarity, press: c.press,
      duels: 0, gagnes: 0
    };
    /* Deux envois simultanés ne doivent pas donner deux entrées au même
       joueur : la vérification et l'ajout sont la même opération. */
    const r = await majDefi(aujourdhui, (etat) => {
      if (etat.entrees.some(e => e.uid === u.uid)) return null;
      etat.entrees.push(entree);
      return etat;
    });
    if (!r.ecrit) return ko(409, "Tu as déjà posé une carte aujourd'hui.");
    return ok({ posee: entreeVue(entree, lib, false).carte, entrees: r.val.entrees.length });
  }

  /* ---------------- un duel à trancher ---------------- */
  if (b.action === "duel") {
    const j = (u.defi && u.defi.jour === aujourdhui) ? u.defi : { jour: aujourdhui, votes: 0, vus: [] };
    if ((j.votes || 0) >= MAX_VOTES) return ko(429, "Tu as fait tes " + MAX_VOTES + " duels du jour.");
    const autres = d.entrees.filter(e => e.uid !== u.uid);
    if (autres.length < 2) return ok({ duel: null, raison: "Pas encore assez de cartes posées." });

    // on sert d'abord les entrées les moins vues, pour que tout le monde soit jugé
    autres.sort((a, b2) => a.duels - b2.duels || Math.random() - 0.5);
    const second = 1 + Math.floor(Math.random() * Math.min(4, autres.length - 1));
    const paire = [autres[0], autres[second]];
    return ok({
      duel: paire.map(e => entreeVue(e, lib, false)),
      theme: d.theme, votesRestants: MAX_VOTES - (j.votes || 0)
    });
  }

  /* ---------------- voter ---------------- */
  if (b.action === "voter") {
    const j = (u.defi && u.defi.jour === aujourdhui) ? u.defi : { jour: aujourdhui, votes: 0, vus: [] };
    if ((j.votes || 0) >= MAX_VOTES) return ko(429, "Tu as fait tes " + MAX_VOTES + " duels du jour.");

    const gagnant = d.entrees.find(e => e.id === String(b.gagnant || ""));
    const perdant = d.entrees.find(e => e.id === String(b.perdant || ""));
    if (!gagnant || !perdant || gagnant.id === perdant.id) return ko(400, "Duel invalide.");
    if (gagnant.uid === u.uid || perdant.uid === u.uid) return ko(403, "On ne vote pas pour sa propre carte.");

    const cle = [gagnant.id, perdant.id].sort().join("|");
    if ((j.vus || []).includes(cle)) return ko(409, "Tu as déjà tranché ce duel.");

    /* ORDRE IMPORTANT. La fiche du joueur est le portier : c'est elle qui porte
       le quota et la liste des duels déjà tranchés. On la passe en premier.
       Si on incrémentait les duels avant, un vote refusé pour doublon aurait
       quand même faussé le palmarès. */
    let restants = 0, compte = false;
    const ru = await majJoueur(u.uid, (fiche) => {
      const k = (fiche.defi && fiche.defi.jour === aujourdhui)
        ? fiche.defi : { jour: aujourdhui, votes: 0, vus: [] };
      k.vus = k.vus || [];
      if (k.vus.includes(cle)) return null;
      if ((k.votes || 0) >= MAX_VOTES) return null;
      k.vus.push(cle); if (k.vus.length > 200) k.vus.splice(0, k.vus.length - 200);
      k.jour = aujourdhui; k.votes = (k.votes || 0) + 1;
      fiche.defi = k;
      const gf = jeuDe(fiche);
      gf.credits += GAIN_VOTE;
      fiche.resume = resumeDe(gf);
      restants = MAX_VOTES - k.votes; compte = true;
      return fiche;
    });
    if (!ru.ecrit || !compte) return ko(409, "Vote déjà compté.");

    /* Les compteurs de duels sont la note du concours. On les incrémente sous
       condition ; si ça casse malgré les reprises, on rend son vote au joueur
       plutôt que de le lui facturer pour rien. */
    const rd = await majDefi(aujourdhui, (etat) => {
      const gg = etat.entrees.find(e => e.id === gagnant.id);
      const pp = etat.entrees.find(e => e.id === perdant.id);
      if (!gg || !pp) return null;
      gg.duels++; gg.gagnes++; pp.duels++;
      return etat;
    });
    if (!rd.ecrit) {
      await majJoueur(u.uid, (fiche) => {
        if (!fiche.defi || fiche.defi.jour !== aujourdhui) return null;
        fiche.defi.votes = Math.max(0, fiche.defi.votes - 1);
        fiche.defi.vus = (fiche.defi.vus || []).filter(x => x !== cle);
        const gf = jeuDe(fiche);
        gf.credits = Math.max(0, gf.credits - GAIN_VOTE);
        return fiche;
      });
      return ko(409, "Vote non enregistré, réessaie.");
    }

    return ok({ vote: true, votesRestants: restants, gain: GAIN_VOTE, credits: jeuDe(ru.val).credits });
  }

  /* ---------------- le palmarès ---------------- */
  if (b.action === "palmares") {
    const date = String(b.date || veille(aujourdhui)).slice(0, 10);
    let p = await lireDefi(date);
    if (!p.clos && date < aujourdhui) p = await clore(p);
    const classees = p.entrees
      .filter(e => e.duels >= MINI_DUELS)
      .map(e => ({ e, score: e.gagnes / e.duels }))
      .sort((a, b2) => b2.score - a.score || b2.e.duels - a.e.duels);
    return ok({
      date: p.date, theme: p.theme, participants: p.entrees.length,
      podium: classees.slice(0, 10).map((x, i) => {
        const v = entreeVue(x.e, lib, true);
        return {
          rang: i + 1, pseudo: v.pseudo, carte: v.carte,
          duels: x.e.duels, gagnes: x.e.gagnes,
          taux: Math.round(x.score * 100), gain: GAIN_PODIUM[i] || 0
        };
      })
    });
  }

  return ko(400, "Action inconnue.");
}

/* Clôture : on paie le podium, une fois et une seule.
   Le drapeau « clos » est posé AVANT de payer, et sous condition : celui qui
   gagne cette écriture-là est le seul à payer. Deux joueurs qui demandent le
   palmarès à la même seconde ne créditent donc pas le podium deux fois. */
async function clore(p) {
  if (p.clos) return p;
  let classees = [];
  const r = await majDefi(p.date, (etat) => {
    if (etat.clos) return null;
    classees = etat.entrees
      .filter(e => e.duels >= MINI_DUELS)
      .map(e => ({ e, score: e.gagnes / e.duels }))
      .sort((a, b) => b.score - a.score || b.e.duels - a.e.duels);
    etat.clos = true;
    return etat;
  });
  if (!r.ecrit) return await lireDefi(p.date);

  for (let i = 0; i < Math.min(3, classees.length); i++) {
    const gain = GAIN_PODIUM[i], premier = i === 0;
    const paye = await majJoueur(classees[i].e.uid, (fiche) => {
      const gf = jeuDe(fiche);
      gf.credits += gain;
      fiche.defisGagnes = (fiche.defisGagnes || 0) + (premier ? 1 : 0);
      fiche.resume = resumeDe(gf);
      return fiche;
    });
    if (paye.ecrit) await majClassement(paye.val);
  }
  return r.val;
}
