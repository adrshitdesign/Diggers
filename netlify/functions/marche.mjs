// /api/marche — le marché appartient aux joueurs.
//
// Le site ne vend plus rien : il n'y a plus de vendeurs inventés, plus de
// cartes qui sortent de nulle part contre des crédits. Ce qui circule ici
// vient forcément d'une étagère, et y retourne.
//
// Deux façons de traiter :
//   · l'annonce en crédits — tu poses une carte à ton prix, un autre l'achète ;
//   · l'offre d'échange   — tu proposes une carte contre l'annonce, le vendeur
//                            accepte ou refuse.
//
// Dans les deux cas la carte quitte l'étagère au moment où elle est posée : on
// ne peut pas vendre deux fois le même exemplaire, ni le fondre pendant qu'il
// est en vitrine.

import { store, majAtomique } from "./_store.mjs";
import * as biblio from "./_biblio.mjs";
import {
  ok, ko, preflight, corps, authentifier, ecrireUtilisateur, utilisateur, uuid,
  majJoueur, avecJoueur
} from "./_lib.mjs";
import { jeuDe, carteVue, coteDe, etatVu, resumeDe } from "./jeu.mjs";
import { majClassement } from "./compte.mjs";

export const config = { path: "/api/marche" };

const MAX_ANNONCES = 12;      // par joueur, en même temps
const MAX_OFFRES = 20;        // par annonce
const PRIX_MAX = 2000000;
const PAGE = 60;

const annoncesStore = () => store("annonces");

/* Une annonce vue par tout le monde : la carte est reconnue, donc rien à cacher. */
function annonceVue(a, lib, moi) {
  const c = carteVue(a.carte, lib);
  return {
    id: a.id,
    vendeur: a.vendeurPseudo,
    mien: moi ? a.vendeurUid === moi.uid : false,
    prix: a.prix,
    cote: c.cote,
    ecart: c.cote ? Math.round((a.prix - c.cote) / c.cote * 100) : 0,
    carte: c,
    cree: a.cree,
    etat: a.etat,
    offres: (a.offres || []).length,
    mesOffres: moi ? (a.offres || []).filter(o => o.parUid === moi.uid).length : 0
  };
}

const ouverte = a => a && a.etat === "ouverte";

async function toutesLesAnnonces() {
  const S = await annoncesStore();
  const cles = await S.list("");
  const l = await Promise.all(cles.map(k => S.get(k)));
  return l.filter(Boolean);
}

/* Rendre une carte à une étagère, la sienne ou celle d'un autre. */
function rendre(g, carte) {
  if (!g.coffre.some(c => c.uid === carte.uid)) g.coffre.push(carte);
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST" && req.method !== "GET") return ko(405, "méthode non autorisée");

  const lib = await biblio.lire();
  const S = await annoncesStore();

  /* Le fil des annonces est public : on peut regarder le marché sans compte,
     comme on regarde une vitrine. Tout le reste demande d'être connecté. */
  if (req.method === "GET") {
    const l = (await toutesLesAnnonces()).filter(ouverte)
      .sort((a, b) => b.cree - a.cree).slice(0, PAGE);
    return ok({ annonces: l.map(a => annonceVue(a, lib, null)), total: l.length });
  }

  const u = await authentifier(req);
  if (!u) return ko(401, "Connexion expirée.");
  const b = await corps(req);

  /* Une seule action à la fois par compte. Sans ça, deux clics sur « acheter »
     partis en même temps lisaient tous les deux la même étagère et l'un des
     deux écrasait l'autre : une carte payée, disparue. */
  return await avecJoueur(u, (frais) => traiter(req, frais, b, lib, S));
}

async function traiter(req, u, b, lib, S) {
  const g = jeuDe(u);

  const sauver = async (extra) => {
    u.resume = resumeDe(g);
    await ecrireUtilisateur(u);
    await majClassement(u);
    return ok({ ...(extra || {}), etat: etatVu(g, lib) });
  };

  switch (b.action) {

    /* ---------- regarder ---------- */
    case "liste": {
      const q = String(b.q || "").toLowerCase().trim();
      let l = (await toutesLesAnnonces()).filter(ouverte);
      if (q) {
        l = l.filter(a => {
          const c = carteVue(a.carte, lib);
          return ((c.artist || "") + " " + (c.title || "")).toLowerCase().includes(q);
        });
      }
      l.sort((a, b2) => b2.cree - a.cree);
      return ok({ annonces: l.slice(0, PAGE).map(a => annonceVue(a, lib, u)), total: l.length });
    }

    /* Mes annonces, et les offres qu'on m'a faites. */
    case "miennes": {
      const l = (await toutesLesAnnonces()).filter(a => a.vendeurUid === u.uid);
      return ok({
        annonces: l.sort((a, b2) => b2.cree - a.cree).map(a => ({
          ...annonceVue(a, lib, u),
          detailOffres: (a.offres || []).map(o => ({
            id: o.id, par: o.parPseudo, carte: carteVue(o.carte, lib), cree: o.cree
          }))
        })),
        posees: l.filter(ouverte).length, max: MAX_ANNONCES
      });
    }

    /* ---------- poser une carte ---------- */
    case "poser": {
      const prix = Math.round(Number(b.prix));
      if (!Number.isFinite(prix) || prix < 1 || prix > PRIX_MAX) return ko(400, "Prix invalide.");
      const i = g.coffre.findIndex(c => c.uid === String(b.uid || ""));
      if (i < 0) return ko(404, "Cette carte n'est pas dans ton étagère.");
      const carte = g.coffre[i];
      if (!carte.known) return ko(409, "Une carte encore face cachée ne se vend pas : trouve-la d'abord.");
      if (carte.press === "Test press") return ko(409, "Un test press ne se vend pas. Il n'en existe qu'un.");

      const miennes = (await toutesLesAnnonces()).filter(a => a.vendeurUid === u.uid && ouverte(a));
      if (miennes.length >= MAX_ANNONCES) return ko(429, "Tu as déjà " + MAX_ANNONCES + " annonces en cours.");

      g.coffre.splice(i, 1);
      const a = {
        id: uuid(), vendeurUid: u.uid, vendeurPseudo: u.pseudo,
        carte, prix, cree: Date.now(), etat: "ouverte", offres: []
      };
      await S.set(a.id, a);
      return await sauver({ annonce: annonceVue(a, lib, u) });
    }

    /* ---------- retirer son annonce ---------- */
    case "retirer": {
      const a = await S.get(String(b.id || ""));
      if (!a) return ko(404, "Annonce introuvable.");
      if (a.vendeurUid !== u.uid) return ko(403, "Ce n'est pas ton annonce.");
      if (!ouverte(a)) return ko(409, "Cette annonce n'est plus ouverte.");
      a.etat = "retiree";
      await S.set(a.id, a);
      rendre(g, a.carte);
      // les cartes offertes en échange repartent chez leurs propriétaires
      await rendreLesOffres(a, u.uid, g);
      await S.del(a.id);
      return await sauver({ retiree: true });
    }

    /* ---------- acheter ---------- */
    case "acheter": {
      const id = String(b.id || "");
      const vue = await S.get(id);
      if (!vue) return ko(404, "Annonce introuvable.");
      if (!ouverte(vue)) return ko(409, "Trop tard : cette carte est déjà partie.");
      if (vue.vendeurUid === u.uid) return ko(409, "C'est ta propre annonce.");
      if (g.credits < vue.prix) return ko(402, "Pas assez de crédits.");

      /* LE POINT CRITIQUE DU JEU.
         Deux acheteurs qui cliquent à la même milliseconde lisaient tous les
         deux « ouverte » et repartaient chacun avec la carte : un exemplaire
         devenait deux, et le vendeur était payé deux fois. On réserve donc
         l'annonce par écriture conditionnelle — elle n'est à personne tant
         qu'on n'a pas gagné cette écriture-là. */
      const reserve = await majAtomique("annonces", id, (x) => {
        if (!x || x.etat !== "ouverte") return null;
        x.etat = "vendue"; x.acheteurUid = u.uid; x.vendue = Date.now();
        return x;
      });
      if (!reserve.ecrit) return ko(409, "Trop tard : cette carte est déjà partie.");
      const a = reserve.val;

      // Le vendeur est peut-être en train de jouer : on ne réécrit pas sa
      // fiche entière, on n'y ajoute que le prix.
      const paye = await majJoueur(a.vendeurUid, (v) => {
        const gv = jeuDe(v);
        gv.credits += a.prix;
        gv.vendus = (gv.vendus || 0) + 1;
        v.resume = resumeDe(gv);
        return v;
      });
      if (!paye.ecrit) {   // compte disparu entre-temps : on rouvre l'annonce
        await majAtomique("annonces", id, (x) => {
          if (!x) return null;
          x.etat = "ouverte"; delete x.acheteurUid; delete x.vendue;
          return x;
        });
        return ko(410, "Le vendeur n'existe plus.");
      }
      await majClassement(paye.val);

      g.credits -= a.prix;
      const carte = { ...a.carte, achete: true, aSec: false, reveals: null };
      g.coffre.push(carte);
      g.achetes = (g.achetes || 0) + 1;

      await rendreLesOffres(a, u.uid, g);
      await S.del(a.id);
      return await sauver({ achetee: carteVue(carte, lib), prix: a.prix, vendeur: a.vendeurPseudo });
    }

    /* ---------- proposer un échange ---------- */
    case "offrir": {
      const a = await S.get(String(b.id || ""));
      if (!a) return ko(404, "Annonce introuvable.");
      if (!ouverte(a)) return ko(409, "Cette annonce n'est plus ouverte.");
      if (a.vendeurUid === u.uid) return ko(409, "C'est ta propre annonce.");
      if ((a.offres || []).length >= MAX_OFFRES) return ko(429, "Cette annonce a déjà trop d'offres.");
      if ((a.offres || []).some(o => o.parUid === u.uid)) return ko(409, "Tu as déjà une offre sur cette annonce.");

      const i = g.coffre.findIndex(c => c.uid === String(b.uid || ""));
      if (i < 0) return ko(404, "Cette carte n'est pas dans ton étagère.");
      const carte = g.coffre[i];
      if (!carte.known) return ko(409, "Une carte face cachée ne s'échange pas.");
      if (carte.press === "Test press") return ko(409, "Un test press ne s'échange pas.");

      g.coffre.splice(i, 1);
      a.offres = a.offres || [];
      a.offres.push({ id: uuid(), parUid: u.uid, parPseudo: u.pseudo, carte, cree: Date.now() });
      await S.set(a.id, a);
      return await sauver({ offerte: true });
    }

    /* ---------- retirer son offre ---------- */
    case "annuler-offre": {
      const a = await S.get(String(b.id || ""));
      if (!a) return ko(404, "Annonce introuvable.");
      const i = (a.offres || []).findIndex(o => o.id === String(b.offre || "") && o.parUid === u.uid);
      if (i < 0) return ko(404, "Offre introuvable.");
      const [o] = a.offres.splice(i, 1);
      await S.set(a.id, a);
      rendre(g, o.carte);
      return await sauver({ annulee: true });
    }

    /* ---------- le vendeur tranche ---------- */
    case "repondre-offre": {
      const a = await S.get(String(b.id || ""));
      if (!a) return ko(404, "Annonce introuvable.");
      if (a.vendeurUid !== u.uid) return ko(403, "Ce n'est pas ton annonce.");
      if (!ouverte(a)) return ko(409, "Cette annonce n'est plus ouverte.");
      const i = (a.offres || []).findIndex(o => o.id === String(b.offre || ""));
      if (i < 0) return ko(404, "Offre introuvable.");
      const [o] = a.offres.splice(i, 1);

      if (b.oui !== true) {                       // refus : la carte rentre chez elle
        await S.set(a.id, a);
        if (o.parUid === u.uid) rendre(g, o.carte); else await rendreUne(o.parUid, o.carte);
        return await sauver({ refusee: true });
      }

      const acheteur = await utilisateur(o.parUid);
      if (!acheteur) {
        await S.set(a.id, a);
        return ko(410, "Ce joueur n'existe plus.");
      }
      const pris = await majAtomique("annonces", a.id, (x) => {
        if (!x || x.etat !== "ouverte") return null;
        x.etat = "echangee"; x.offres = a.offres;
        return x;
      });
      if (!pris.ecrit) return ko(409, "Cette annonce n'est plus ouverte.");

      // l'échange : chacun reçoit la carte de l'autre
      const recu = await majJoueur(o.parUid, (j) => {
        const ga = jeuDe(j);
        ga.coffre.push({ ...a.carte, achete: true, aSec: false, reveals: null });
        j.resume = resumeDe(ga);
        return j;
      });
      if (!recu.ecrit) return ko(410, "Ce joueur n'existe plus.");
      await majClassement(recu.val);

      g.coffre.push({ ...o.carte, achete: true, aSec: false, reveals: null });

      await rendreLesOffres(a, u.uid, g);
      await S.del(a.id);
      return await sauver({ echangee: carteVue(o.carte, lib), avec: o.parPseudo });
    }

    default:
      return ko(400, "Action inconnue.");
  }
}

/* Quand une annonce se ferme, les offres qui restaient dessus rendent
   leurs cartes : personne ne perd un exemplaire parce qu'il a été trop lent. */
async function rendreLesOffres(a, moiUid, monJeu) {
  for (const o of (a.offres || [])) {
    // Si c'est ma propre offre, je me la rends moi-même : passer par le
    // rangement écraserait l'écriture que je m'apprête à faire.
    if (moiUid && o.parUid === moiUid) rendre(monJeu, o.carte);
    else await rendreUne(o.parUid, o.carte);
  }
  a.offres = [];
}

/* Rendre une carte à quelqu'un d'autre. Il joue peut-être en ce moment :
   on ne réécrit pas sa fiche par-dessus la sienne, on y ajoute la carte. */
async function rendreUne(uid, carte) {
  await majJoueur(uid, (j) => {
    const gj = jeuDe(j);
    if (gj.coffre.some(c => c.uid === carte.uid)) return null;   // déjà rendue
    gj.coffre.push(carte);
    j.resume = resumeDe(gj);
    return j;
  });
}
