// /api/compte — inscription, connexion, profil personnalisable, effacement.
// La partie elle-même n'est plus ici : elle appartient au serveur, dans /api/jeu.

import { store } from "./_store.mjs";
import * as biblio from "./_biblio.mjs";
import {
  ok, ko, preflight, corps, signer, hacher, verifierMdp, norm, PSEUDO_OK, RESERVES,
  utilisateur, ecrireUtilisateur, parPseudo, authentifier, profilPublic, uuid,
  ipDe, verrouActif, echec, relacher, attends,
  EMAIL_OK, normEmail, secretUsageUnique, empreinteDe, empreinteEgale,
  COULEURS, BANNIERES
} from "./_lib.mjs";
import { cosmetiquesDe } from "./boutique.mjs";
import { envoyer, envoiConfigure, adresseDuSite, lettre } from "./_mail.mjs";

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

export { COULEURS, BANNIERES };

/* ---------------- le premier compte du site ---------------- */
// Il faut bien quelqu'un pour ouvrir la modération. Sur une base encore vide,
// le tout premier compte créé devient administrateur : plus besoin de la clé
// DIGGERS_ADMIN pour démarrer. Dès qu'un compte existe, la porte se referme
// et il ne reste que la clé.
async function fondationLibre() {
  const cfg = await store("config");
  const marque = await cfg.get("fondateur");
  // Un fondateur déjà désigné et toujours là : rien à rouvrir.
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
      mesProps: [], quota: { jour: "", n: 0 }
    };
    await ecrireUtilisateur(u);
    await pseudos.set(cle, { uid: u.uid });
    if (fondateur)
      await (await store("config")).set("fondateur", { uid: u.uid, pseudo: u.pseudo, date: Date.now() });
    await echec("ins:" + ip, { max: 6, fenetre: 3600000, verrou: 3600000 });
    return ok({ jeton: await signer(u.uid, u.sessionV), moi: profilPublic(u), titres: titresDe(u), fondateur });
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
    return ok({ jeton: await signer(u.uid, u.sessionV), moi: profilPublic(u), titres: titresDe(u) });
  }

  /* ---------------- j'ai oublié mon mot de passe ----------------
     On répond toujours la même chose, que le compte existe ou non : sinon ce
     formulaire devient un moyen de savoir qui est inscrit. */
  if (action === "oubli") {
    const ip = ipDe(req);
    const bloque = await verrouActif("oub:" + ip);
    if (bloque) return ko(429, "Trop de demandes. " + attends(bloque));
    await echec("oub:" + ip, { max: 8, fenetre: 3600000, verrou: 3600000 });

    const rassurant = ok({ envoye: true, configure: envoiConfigure() });
    if (!envoiConfigure()) return ko(503, "La récupération par e-mail n'est pas ouverte sur ce site.");

    const id = String(b.identifiant || "").trim();
    let cible = null;
    if (id.includes("@")) {
      const idx = await (await store("emails")).get(normEmail(id));
      if (idx) cible = await utilisateur(idx.uid);
    } else cible = await parPseudo(id);

    if (cible && cible.email && cible.email.adresse && cible.email.verifie) {
      const { clair, empreinte } = secretUsageUnique(24);
      cible.reinit = { empreinte, exp: Date.now() + 3600000 };
      await ecrireUtilisateur(cible);
      const lien = adresseDuSite(req) + "/?reinit=" + cible.uid + "." + clair;
      const l = lettre({
        titre: "Reprendre la main sur ton compte",
        phrases: [
          "Quelqu'un — probablement toi — a demandé un nouveau mot de passe pour le compte <b>"
            + cible.pseudo + "</b>.",
          "Ce lien est valable <b>une heure</b> et ne marche qu'une fois. Toutes les sessions ouvertes seront fermées."
        ],
        bouton: "Choisir un nouveau mot de passe",
        lien,
        pied: "Si ce n'est pas toi, ignore ce message : rien n'a changé. Diggers n'écrit jamais pour autre chose."
      });
      await envoyer({ a: cible.email.adresse, sujet: "Diggers — nouveau mot de passe", texte: l.texte, html: l.html });
    }
    return rassurant;
  }

  if (action === "reinit") {
    const [uid, code] = String(b.cle || "").split(".");
    const mdp = String(b.mdp || "");
    if (mdp.length < 8) return ko(400, "Le mot de passe fait au moins 8 signes.");
    if (mdp.length > 200) return ko(400, "Mot de passe trop long.");
    const cible = uid ? await utilisateur(uid) : null;
    const r = cible && cible.reinit;
    if (!r || !code || r.exp < Date.now() || !empreinteEgale(r.empreinte, empreinteDe(code)))
      return ko(403, "Ce lien n'est plus valable. Redemande-en un.");

    const { sel, hash } = hacher(mdp);
    cible.sel = sel; cible.hash = hash;
    delete cible.reinit;
    // Toutes les sessions ouvertes tombent : c'est le but d'une reprise en main.
    cible.sessionV = (cible.sessionV || 0) + 1;
    await ecrireUtilisateur(cible);
    await relacher("co:" + cible.pseudoNorm);
    return ok({ jeton: await signer(cible.uid, cible.sessionV), moi: profilPublic(cible), titres: titresDe(cible) });
  }

  /* Vérifier l'adresse : tant que le lien n'est pas cliqué, elle ne sert à rien. */
  if (action === "verifier-email") {
    const [uid, code] = String(b.cle || "").split(".");
    const cible = uid ? await utilisateur(uid) : null;
    const e = cible && cible.email;
    if (!e || !code || !e.empreinte || (e.exp || 0) < Date.now() || !empreinteEgale(e.empreinte, empreinteDe(code)))
      return ko(403, "Ce lien de vérification n'est plus valable.");
    e.verifie = true; delete e.empreinte; delete e.exp;
    await ecrireUtilisateur(cible);
    await (await store("emails")).set(normEmail(e.adresse), { uid: cible.uid });
    return ok({ verifie: true, pseudo: cible.pseudo });
  }

  /* ---------------- à partir d'ici il faut être connecté ---------------- */
  const u = await authentifier(req);
  if (!u) return ko(401, "Connexion expirée.");

  if (action === "moi")
    return ok({ moi: profilPublic(u), titres: titresDe(u) });

  /* ---------------- personnalisation ---------------- */
  if (action === "profil") {
    const p = { ...profilNeuf(), ...(u.profil || {}) };
    const patch = b.profil || {};

    // Le décor payant n'est portable que par qui l'a acheté.
    const dispo = cosmetiquesDe(u);
    if (patch.couleur !== undefined) {
      if (!dispo.couleurs.includes(patch.couleur)) return ko(403, "Cette couleur ne t'appartient pas.");
      p.couleur = patch.couleur;
    }
    if (patch.banniere !== undefined) {
      if (!dispo.bannieres.includes(patch.banniere)) return ko(403, "Cette bannière ne t'appartient pas.");
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
      // On ne met en vitrine que des cartes qu'on possède vraiment, et le
      // pressage affiché est celui de l'exemplaire, pas celui qu'on annonce.
      const coffre = (u.jeu && Array.isArray(u.jeu.coffre)) ? u.jeu.coffre : [];
      const lib = await biblio.lire();
      const choisies = [];
      for (const v of patch.vitrine.slice(0, 3)) {
        if (!v) continue;
        const ex = coffre.find(x => x.uid === String(v.uid || "") && x.known);
        if (!ex) continue;
        const t = lib.tracks.find(x => String(x.id) === String(ex.id));
        if (!t || !artOk(t.art)) continue;
        choisies.push({
          uid: ex.uid, id: String(t.id).slice(0, 32),
          title: String(t.title).slice(0, 160),
          artist: String(t.artist).slice(0, 120),
          art: t.art,
          rarity: Math.max(1, Math.min(6, Number(ex.rarity) || 1)),
          press: String(ex.press || "Standard").slice(0, 24)
        });
      }
      p.vitrine = choisies;
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

  /* ---------------- la partie ne s'envoie plus ----------------
     Le navigateur ne dépose plus d'état : la collection, les crédits et le
     taux d'identification vivent sur le serveur, dans /api/jeu. Ces deux
     actions restaient une porte ouverte — on se déclarait le score qu'on
     voulait. Elles répondent, mais elles ne rangent plus rien. */
  if (action === "sauver" || action === "charger")
    return ko(410, "La partie est tenue par le serveur. Passe par /api/jeu.");

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

    if (u.email && u.email.adresse) await (await store("emails")).del(normEmail(u.email.adresse));
    await (await store("classement")).del(u.uid);
    await (await store("pseudos")).del(u.pseudoNorm);
    await (await store("utilisateurs")).del(u.uid);
    return ok({ supprime: true });
  }

  /* ---------------- l'adresse e-mail, facultative ---------------- */
  if (action === "email") {
    const adresse = normEmail(b.adresse);
    if (!EMAIL_OK.test(adresse)) return ko(400, "Cette adresse ne ressemble pas à une adresse e-mail.");
    if (!envoiConfigure()) return ko(503, "La récupération par e-mail n'est pas ouverte sur ce site.");
    const idx = await store("emails");
    const pris = await idx.get(adresse);
    if (pris && pris.uid !== u.uid) return ko(409, "Cette adresse est déjà rattachée à un compte.");

    const ancienne = u.email && u.email.adresse;
    if (ancienne && normEmail(ancienne) !== adresse) await idx.del(normEmail(ancienne));

    const { clair, empreinte } = secretUsageUnique(24);
    u.email = { adresse, verifie: false, empreinte, exp: Date.now() + 86400000 };
    await ecrireUtilisateur(u);

    const lien = adresseDuSite(req) + "/?email=" + u.uid + "." + clair;
    const l = lettre({
      titre: "Confirme ton adresse",
      phrases: [
        "Tu viens de rattacher cette adresse au compte Diggers <b>" + u.pseudo + "</b>.",
        "Elle servira <b>uniquement</b> à te renvoyer un mot de passe si tu le perds. Rien d'autre ne partira d'ici."
      ],
      bouton: "Confirmer mon adresse",
      lien,
      pied: "Si tu n'as rien demandé, ignore ce message : sans ce clic, l'adresse ne sert à rien."
    });
    const envoi = await envoyer({ a: adresse, sujet: "Diggers — confirme ton adresse", texte: l.texte, html: l.html });
    if (!envoi.ok) return ko(502, "L'envoi a échoué : " + envoi.raison);
    return ok({ moi: profilPublic(u), titres: titresDe(u), envoye: true });
  }

  if (action === "email-retirer") {
    if (u.email && u.email.adresse) await (await store("emails")).del(normEmail(u.email.adresse));
    delete u.email;
    await ecrireUtilisateur(u);
    return ok({ moi: profilPublic(u), titres: titresDe(u) });
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
