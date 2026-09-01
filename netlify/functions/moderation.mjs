// /api/moderation — la file d'attente et le verdict. Réservé aux modérateurs.

import { store } from "./_store.mjs";
import {
  ok, ko, preflight, corps, authentifier, estModerateur, signature, norm,
  utilisateur, ecrireUtilisateur, uuid
} from "./_lib.mjs";
import { majClassement } from "./compte.mjs";
import * as biblio from "./_biblio.mjs";

export const config = { path: "/api/moderation" };

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return ko(405, "méthode non autorisée");

  const u = await authentifier(req);
  if (!u) return ko(401, "Connexion expirée.");
  if (!estModerateur(u)) return ko(403, "Réservé à la modération.");

  const b = await corps(req);
  const P = await store("propositions");
  const F = await store("file");

  /* ---------------- la file ---------------- */
  if (b.action === "file") {
    const cles = (await F.list("attente/")).sort();     // les plus anciennes d'abord
    const ids = (await Promise.all(cles.slice(0, 60).map(k => F.get(k)))).filter(Boolean).map(x => x.id);
    const props = (await Promise.all(ids.map(i => P.get(i)))).filter(Boolean).filter(p => p.statut === "en_attente");
    return ok({ file: props, total: cles.length });
  }

  /* ---------------- l'historique ---------------- */
  if (b.action === "historique") {
    const cles = await P.list("");
    const tout = (await Promise.all(cles.map(k => P.get(k)))).filter(Boolean)
      .filter(p => p.statut !== "en_attente")
      .sort((a, b2) => (b2.tranche || 0) - (a.tranche || 0)).slice(0, 80);
    return ok({ historique: tout });
  }

  /* ---------------- le verdict ---------------- */
  if (b.action === "trancher") {
    const p = await P.get(String(b.id || ""));
    if (!p) return ko(404, "Proposition introuvable.");
    if (p.statut !== "en_attente") return ko(409, "Déjà tranchée.");

    const SIG = await store("signatures");
    const sigAvant = signature(p.track);

    if (b.verdict === "valider") {
      // le modérateur peut corriger la fiche avant de la publier
      const c = b.corrections || {};
      if (c.title)  p.track.title  = String(c.title).slice(0, 160);
      if (c.artist) p.track.artist = String(c.artist).slice(0, 120);
      if (c.genre)  p.track.genre  = String(c.genre).slice(0, 60);
      if (c.year)   p.track.year   = Math.max(1900, Math.min(new Date().getFullYear() + 1, Number(c.year)));

      const pop = Math.max(0, Math.min(99, Number(b.pop)));
      if (!Number.isFinite(pop)) return ko(400, "Il faut fixer une popularité entre 0 et 99.");

      p.statut = "validee";
      p.pop = pop;
      p.note = String(b.note || "").slice(0, 240);
      p.tranche = Date.now();
      p.parQui = u.pseudo;
      await P.set(p.id, p);

      const track = { ...p.track, pop, poids: 2, rank: 0,
        source: "communaute", proposePar: p.par.pseudo, valideLe: p.tranche,
        indice: p.indice || "" };
      await biblio.ajouter(track);

      const sigApres = signature(p.track);
      if (sigApres !== sigAvant) await SIG.del(sigAvant);
      await SIG.set(sigApres, { statut: "validee", prop: p.id, track: track.id });
      await F.del(await cleFile(F, p));

      // la récompense du trouveur : la carte, en pressage d'origine
      const auteur = await utilisateur(p.par.uid);
      if (auteur) {
        auteur.stats = auteur.stats || { propositions: 0, validees: 0, refusees: 0 };
        auteur.stats.validees++;
        auteur.recompenses = (auteur.recompenses || []).concat({
          id: uuid(), cree: Date.now(), pris: false, prop: p.id,
          carte: { ...track, press: "Vinyle", origine: true }
        }).slice(-50);
        await ecrireUtilisateur(auteur);
        await majClassement(auteur);
      }
      return ok({ statut: "validee", track });
    }

    if (b.verdict === "refuser") {
      p.statut = "refusee";
      p.note = String(b.note || "").slice(0, 240) || "Ne rentre pas dans le catalogue.";
      p.tranche = Date.now();
      p.parQui = u.pseudo;
      await P.set(p.id, p);
      await F.del(await cleFile(F, p));
      if (b.rouvrir) await SIG.del(sigAvant);
      else await SIG.set(sigAvant, { statut: "refusee", prop: p.id });

      const auteur = await utilisateur(p.par.uid);
      if (auteur) {
        auteur.stats = auteur.stats || { propositions: 0, validees: 0, refusees: 0 };
        auteur.stats.refusees++;
        await ecrireUtilisateur(auteur);
      }
      return ok({ statut: "refusee" });
    }

    return ko(400, "Verdict inconnu.");
  }

  /* ---------------- la bibliothèque ---------------- */
  /* ---------------- les compteurs d'écoutes ----------------
     Ils ne viennent plus d'une clé Last.fm collée par le joueur dans ses
     réglages, mais du serveur : on demande à Deezer, qui publie librement le
     nombre de fans d'un artiste, et on range le chiffre avec sa date. Le
     compteur bouge tout le temps — c'est justement pour ça qu'il est daté et
     qu'on peut le rafraîchir. Rien n'est cassé si Deezer ne répond pas. */
  if (b.action === "ecoutes") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur relève les compteurs.");
    const lib = await biblio.lire();
    if (!lib.tracks.length) return ko(400, "La bibliothèque est vide.");

    const peremption = Date.now() - 30 * 86400000;
    const aFaire = [...new Set(lib.tracks
      .filter(t => !t.fansMaj || t.fansMaj < peremption)
      .map(t => t.artist))];
    if (!aFaire.length) return ok({ fini: true, artistes: 0, restants: 0, titres: 0 });

    const lot = aFaire.slice(0, 12);
    let touches = 0, trouves = 0;
    const echecs = [];
    for (const nom of lot) {
      let fans = null;
      try {
        const r = await fetch("https://api.deezer.com/search/artist?limit=1&q=" + encodeURIComponent(nom),
          { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const d = await r.json();
          const a = d && d.data && d.data[0];
          // On n'accepte la réponse que si le nom correspond vraiment.
          if (a && norm(a.name) === norm(nom) && typeof a.nb_fan === "number") fans = a.nb_fan;
        }
      } catch { echecs.push(nom); }
      const maintenant = Date.now();
      for (const t of lib.tracks) {
        if (t.artist !== nom) continue;
        t.fansMaj = maintenant;
        if (fans != null) { t.fans = fans; touches++; }
        else delete t.fans;
      }
      if (fans != null) trouves++;
    }
    await biblio.ecrire(lib);
    return ok({
      fini: aFaire.length <= lot.length,
      artistes: lot.length, trouves, titres: touches,
      restants: Math.max(0, aFaire.length - lot.length),
      echecs: echecs.slice(0, 5)
    });
  }

  if (b.action === "bibliotheque") {
    const lib = await biblio.lire();
    return ok({ meta: lib.meta, tracks: lib.tracks, plafond: biblio.PLAFOND });
  }

  if (b.action === "modifier") {
    const t = await biblio.modifier(String(b.track || ""), b.patch || {});
    if (!t) return ko(404, "Son introuvable.");
    return ok({ track: t });
  }

  if (b.action === "retirer") {
    const t = await biblio.retirer(String(b.track || ""));
    if (!t) return ko(404, "Son introuvable.");
    await (await store("signatures")).del(signature(t));
    return ok({ retire: t.id });
  }

  if (b.action === "importer") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur importe un catalogue.");
    if (!Array.isArray(b.tracks)) return ko(400, "Aucun son à importer.");
    if (b.tracks.length > 400) return ko(413, "Envoie l'import par paquets de 400 au maximum.");
    const r = await biblio.importer(b.tracks, !!b.remplacer);
    return ok(r);
  }

  if (b.action === "vider") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur vide la bibliothèque.");
    const r = await biblio.vider(b.source === "communaute" ? "communaute" : b.source === "tout" ? null : "noyau");
    return ok(r);
  }

  /* ---------------- les mentions légales ---------------- */
  if (b.action === "mentions") {
    const C = await store("config");
    if (!b.editeur) return ok({ editeur: (await C.get("editeur")) || null });
    if (u.role !== "admin") return ko(403, "Seul l'administrateur change les mentions légales.");
    const t = (v, n) => String(v || "").trim().slice(0, n);
    const e = {
      nom: t(b.editeur.nom, 120),
      statut: t(b.editeur.statut, 120),
      adresse: t(b.editeur.adresse, 240),
      contact: t(b.editeur.contact, 160),
      directeur: t(b.editeur.directeur, 120),
      hebergeur: t(b.editeur.hebergeur, 240)
        || "Netlify, Inc. — 512 2nd Street, Suite 200, San Francisco, CA 94107, États-Unis",
      /* Le régime du particulier : la LCEN permet à une personne physique qui
         édite un site à titre NON professionnel de ne pas publier son nom et son
         adresse, à condition d'avoir communiqué son identité à son hébergeur —
         ce qui est le cas dès qu'on a un compte Netlify. Ce sont alors les
         coordonnées de l'hébergeur qui sont publiées, et elles seules.
         Ça s'arrête net dès qu'il y a une vente : voir boutique.mjs. */
      particulier: !!b.editeur.particulier,
      maj: Date.now()
    };
    if (!e.contact)
      return ko(400, "Une adresse de contact est obligatoire, même en restant anonyme.");
    if (!e.particulier && (!e.nom || !e.adresse))
      return ko(400, "Le nom et l'adresse sont obligatoires dès qu'on ne publie pas à titre personnel.");
    if (!e.hebergeur)
      return ko(400, "L'hébergeur doit être indiqué.");
    await C.set("editeur", e);
    return ok({ editeur: e });
  }

  /* ---------------- nommer un modérateur ---------------- */
  if (b.action === "nommer") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur nomme les modérateurs.");
    const { parPseudo } = await import("./_lib.mjs");
    const cible = await parPseudo(b.pseudo);
    if (!cible) return ko(404, "Compte introuvable.");
    cible.role = b.retirer ? "joueur" : "moderateur";
    await ecrireUtilisateur(cible);
    return ok({ pseudo: cible.pseudo, role: cible.role });
  }

  return ko(400, "Action inconnue.");
}

async function cleFile(F, p) {
  const c = "attente/" + p.cree + "-" + p.id;
  if (await F.get(c)) return c;
  const toutes = await F.list("attente/");
  return toutes.find(k => k.endsWith("-" + p.id)) || c;
}


