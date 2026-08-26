// /api/compte — inscription, connexion, profil personnalisable, sauvegarde de la partie.

import { store } from "./_store.mjs";
import * as biblio from "./_biblio.mjs";
import {
  ok, ko, preflight, corps, signer, hacher, verifierMdp, norm, PSEUDO_OK, RESERVES,
  utilisateur, ecrireUtilisateur, parPseudo, authentifier, profilPublic, uuid,
  ipDe, verrouActif, echec, relacher, attends
} from "./_lib.mjs";

export const config = { path: "/api/compte" };

/* Les titres se gagnent, ils ne se choisissent pas librement. */
export const TITRES = [
  { id: "curieux",     n: "Curieux",           cond: () => true },
  { id: "defricheur",  n: "Défricheur",        cond: u => v(u) >= 1 },
  { id: "eclaireur",   n: "Éclaireur",         cond: u => v(u) >= 5 },
  { id: "archiviste",  n: "Archiviste",        cond: u => v(u) >= 20 },
  { id: "conservateur",n: "Conservateur·rice", cond: u => v(u) >= 50 },
  { id: "moderateur",  n: "Modération",        cond: u => u.role === "moderateur" || u.role === "admin" }
];
const v = u => (u.stats && u.stats.validees) || 0;

export const COULEURS = ["ambre", "vert", "violet", "rouge", "bleu", "rose", "or"];
export const BANNIERES = ["nuit", "cassette", "vinyle", "neon", "papier", "sable"];

/* ---------------- le premier compte du site ---------------- */
// Il faut bien quelqu'un pour ouvrir la moderation. Sur une base encore vide,
// le tout premier compte cree devient administrateur : plus besoin de la cle
// DIGGERS_ADMIN pour demarrer. Des qu'un compte existe, la porte se referme
// et il ne reste que la cle.
async function fondationLibre() {
  const cfg = await store("config");
  const marque = await cfg.get("fondateur");
  // Un fondateur deja designe et toujours la : rien a rouvrir.
  if (marque && marque.uid && await utilisateur(marque.uid)) return false;
  try {
    const cles = await (await store("utilisateurs")).list();
    if (cles && cles.length) {
      if (!marque) await cfg.set("fondateur", { uid: null, ferme: Date.now() });
      return false;
    }
  } catch { return false; }   // dans le doute, pas d'administrateur automatique
  return true;
}

const profilNeuf = () => ({
  couleur: "ambre", banniere: "nuit", bio: "", titre: "curieux",
  avatar: null, vitrine: []
});

function artOk(u) {
  if (!u) return false;
  try { const x = new URL(u); return x.protocol === "https:" && /\.(mzstatic|apple)\.com$/i.test(x.hostname); }
  catch { return false; }
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const b = await corps(req);
  const action = b.action;

  /* ---------------- inscription ---------------- */
  if (action === "inscription") {
    const ip = ipDe(req);
    const bloque = await verrouActif("ins:" + ip);
    if (bloque) return ko(429, "Trop de comptes créés depuis cette connexion. " + attends(bloque));
    const pseudo = String(b.pseudo || "").trim();
    const mdp = String(b.mdp || "");
    if (!PSEUDO_OK.test(pseudo)) return ko(400, "Le pseudo fait 2 à 18 signes : lettres, chiffres, espace, . _ -");
    if (RESERVES.has(norm(pseudo))) return ko(400, "Ce pseudo est réservé.");
    if (mdp.length < 8) return ko(400, "Le mot de passe fait au moins 8 signes.");
    if (mdp.length > 200) return ko(400, "Mot de passe trop long.");

    const pseudos = await store("pseudos");
    const cle = norm(pseudo);
    if (!cle) return ko(400, "Pseudo invalide.");
    if (await pseudos.get(cle)) return ko(409, "Ce pseudo est déjà pris.");

    const { sel, hash } = hacher(mdp);
    const fondateur = await fondationLibre();
    const u = {
      uid: uuid(), pseudo, pseudoNorm: cle, sel, hash,
      cree: Date.now(), role: fondateur ? "admin" : "joueur",
      profil: profilNeuf(),
      stats: { propositions: 0, validees: 0, refusees: 0, credits: 0 },
      mesProps: [], quota: { jour: "", n: 0 },
      partie: null
    };
    await ecrireUtilisateur(u);
    await pseudos.set(cle, { uid: u.uid });
    if (fondateur)
      await (await store("config")).set("fondateur", { uid: u.uid, pseudo: u.pseudo, date: Date.now() });
    await echec("ins:" + ip, { max: 6, fenetre: 3600000, verrou: 3600000 });
    return ok({ jeton: await signer(u.uid), moi: profilPublic(u), partie: null, titres: titresDe(u), fondateur });
  }

  /* ---------------- connexion ---------------- */
  if (action === "connexion") {
    const ip = ipDe(req);
    const cleNom = "co:" + norm(b.pseudo), cleIp = "co-ip:" + ip;
    // Deux verrous : un sur le compte visé, un sur la machine qui essaie.
    const bNom = await verrouActif(cleNom), bIp = await verrouActif(cleIp);
    if (bNom || bIp)
      return ko(429, "Trop de tentatives. " + attends(Math.max(bNom, bIp)));

    const u = await parPseudo(b.pseudo);
    const mdp = String(b.mdp || "");
    // On fait le calcul même si le compte n'existe pas, pour ne pas révéler lesquels existent.
    const bon = u ? verifierMdp(mdp, u.sel, u.hash) : verifierMdp(mdp, "0".repeat(32), "x");
    if (!u || !bon) {
      const a = await echec(cleNom, { max: 6, fenetre: 900000, verrou: 900000 });
      const c = await echec(cleIp, { max: 20, fenetre: 900000, verrou: 900000 });
      const t = Math.max(a, c);
      if (t) return ko(429, "Trop de tentatives. " + attends(t));
      return ko(401, "Pseudo ou mot de passe incorrect.");
    }
    await relacher(cleNom); await relacher(cleIp);
    u.dernier = Date.now();
    await ecrireUtilisateur(u);
    return ok({ jeton: await signer(u.uid), moi: profilPublic(u), partie: u.partie, titres: titresDe(u) });
  }

  /* ---------------- à partir d'ici il faut être connecté ---------------- */
  const u = await authentifier(req);
  if (!u) return ko(401, "Connexion expirée.");

  if (action === "moi")
    return ok({ moi: profilPublic(u), partie: u.partie, titres: titresDe(u) });

  /* ---------------- personnalisation ---------------- */
  if (action === "profil") {
    const p = { ...profilNeuf(), ...(u.profil || {}) };
    const patch = b.profil || {};

    if (patch.couleur !== undefined) {
      if (!COULEURS.includes(patch.couleur)) return ko(400, "Couleur inconnue.");
      p.couleur = patch.couleur;
    }
    if (patch.banniere !== undefined) {
      if (!BANNIERES.includes(patch.banniere)) return ko(400, "Bannière inconnue.");
      p.banniere = patch.banniere;
    }
    if (patch.bio !== undefined) p.bio = String(patch.bio).slice(0, 140);
    if (patch.titre !== undefined) {
      const t = TITRES.find(x => x.id === patch.titre);
      if (!t) return ko(400, "Titre inconnu.");
      if (!t.cond(u)) return ko(403, "Ce titre n'est pas encore débloqué.");
      p.titre = t.id;
    }
    if (patch.avatar !== undefined) {
      if (patch.avatar === null) p.avatar = null;
      else if (!artOk(patch.avatar.art)) return ko(400, "Pochette invalide.");
      else p.avatar = { id: String(patch.avatar.id || "").slice(0, 32), art: patch.avatar.art };
    }
    if (patch.vitrine !== undefined) {
      if (!Array.isArray(patch.vitrine)) return ko(400, "Vitrine invalide.");
      p.vitrine = patch.vitrine.slice(0, 3).filter(c => c && artOk(c.art)).map(c => ({
        id: String(c.id || "").slice(0, 32),
        title: String(c.title || "").slice(0, 160),
        artist: String(c.artist || "").slice(0, 120),
        art: c.art,
        rarity: Math.max(1, Math.min(6, Number(c.rarity) || 1)),
        press: String(c.press || "Standard").slice(0, 24)
      }));
    }

    if (patch.pseudo !== undefined && patch.pseudo !== u.pseudo) {
      const np = String(patch.pseudo).trim();
      if (!PSEUDO_OK.test(np)) return ko(400, "Pseudo invalide.");
      if (RESERVES.has(norm(np))) return ko(400, "Ce pseudo est réservé.");
      const pseudos = await store("pseudos");
      const cle = norm(np);
      const pris = await pseudos.get(cle);
      if (pris && pris.uid !== u.uid) return ko(409, "Ce pseudo est déjà pris.");
      if (cle !== u.pseudoNorm) { await pseudos.del(u.pseudoNorm); await pseudos.set(cle, { uid: u.uid }); }
      u.pseudo = np; u.pseudoNorm = cle;
    }

    u.profil = p;
    await ecrireUtilisateur(u);
    await majClassement(u);
    return ok({ moi: profilPublic(u), titres: titresDe(u) });
  }

  /* ---------------- sauvegarde de la partie ---------------- */
  if (action === "sauver") {
    const code = String(b.code || "");
    if (!code || code.length > 200000) return ko(400, "Sauvegarde invalide.");
    u.partie = { code, maj: Date.now() };
    u.resume = {
      cartes: Math.max(0, Number(b.resume && b.resume.cartes) || 0),
      taux: b.resume && b.resume.taux != null ? Math.max(0, Math.min(100, Number(b.resume.taux))) : null,
      meilleurSet: Math.max(0, Math.min(100, Number(b.resume && b.resume.meilleurSet) || 0)),
      serie: Math.max(0, Number(b.resume && b.resume.serie) || 0)
    };
    await ecrireUtilisateur(u);
    await majClassement(u);
    return ok({ maj: u.partie.maj });
  }

  if (action === "charger")
    return ok({ partie: u.partie, moi: profilPublic(u), titres: titresDe(u) });

  /* ---------------- effacer son compte ---------------- */
  // Droit à l'effacement : le joueur doit pouvoir partir sans écrire à personne.
  if (action === "supprimer") {
    if (!verifierMdp(String(b.mdp || ""), u.sel, u.hash))
      return ko(401, "Mot de passe incorrect.");

    // on le sort de son crew
    if (u.crew) {
      const C = await store("crews"), IDX = await store("codes");
      const c = await C.get(u.crew);
      if (c) {
        c.membres = (c.membres || []).filter(x => x !== u.uid);
        if (!c.membres.length) { await C.del(c.id); await IDX.del(c.code); }
        else { if (c.chef === u.uid) c.chef = c.membres[0]; await C.set(c.id, c); }
      }
    }

    // ses propositions restent, mais ne portent plus son nom
    const P = await store("propositions");
    for (const id of (u.mesProps || [])) {
      const p = await P.get(id);
      if (!p) continue;
      p.par = { uid: "", pseudo: "compte supprimé" };
      await P.set(id, p);
    }

    // les sons qu'il a fait entrer restent dans la bibliothèque : c'est du
    // contenu public, mais il perd la signature.
    const lib = await biblio.lire();
    let touche = false;
    lib.tracks.forEach(t => {
      if (t.proposePar && t.proposePar === u.pseudo) { t.proposePar = "un digger"; touche = true; }
    });
    if (touche) await biblio.ecrire(lib);

    await (await store("classement")).del(u.uid);
    await (await store("pseudos")).del(u.pseudoNorm);
    await (await store("utilisateurs")).del(u.uid);
    return ok({ supprime: true });
  }

  /* ---------------- devenir modérateur avec la clé du site ---------------- */
  if (action === "promouvoir") {
    const cle = process.env.DIGGERS_ADMIN || "";
    const cleLim = "adm:" + ipDe(req);
    const bloque = await verrouActif(cleLim);
    if (bloque) return ko(429, "Trop d'essais sur la clé d'administration. " + attends(bloque));
    if (!cle) return ko(503, "Aucune clé d'administration n'est configurée sur le site.");
    if (String(b.cle || "") !== cle) {
      const t = await echec(cleLim, { max: 5, fenetre: 3600000, verrou: 3600000 });
      return ko(403, t ? "Trop d'essais. " + attends(t) : "Clé refusée.");
    }
    await relacher(cleLim);
    u.role = "admin";
    await ecrireUtilisateur(u);
    return ok({ moi: profilPublic(u), titres: titresDe(u) });
  }

  return ko(400, "Action inconnue.");
}

function titresDe(u) {
  return TITRES.map(t => ({ id: t.id, n: t.n, acquis: !!t.cond(u) }));
}

export async function majClassement(u) {
  const c = await store("classement");
  const r = u.resume || {};
  await c.set(u.uid, {
    uid: u.uid, pseudo: u.pseudo,
    couleur: (u.profil || {}).couleur || "ambre",
    titre: (u.profil || {}).titre || "curieux",
    cartes: r.cartes || 0, taux: r.taux == null ? null : r.taux,
    meilleurSet: r.meilleurSet || 0, serie: r.serie || 0,
    validees: (u.stats || {}).validees || 0,
    maj: Date.now()
  });
}
