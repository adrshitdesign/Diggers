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

      const envoyee = { ...p.track, pop, poids: 2, rank: 0,
        source: "communaute", proposePar: p.par.pseudo, valideLe: p.tranche,
        indice: p.indice || "" };
      /* La fiche telle qu'elle est RANGÉE, pas telle qu'elle a été envoyée :
         la bibliothèque peut avoir ramené « A & B » à « A ». La carte du
         trouveur et la signature doivent parler de la même chose qu'elle. */
      const rangee = await biblio.ajouter(envoyee);
      const track = rangee.track || envoyee;
      p.track = { ...p.track, artist: track.artist, credits: track.credits || "" };
      await P.set(p.id, p);

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

  /* ---------------- un seul artiste par carte ---------------- */
  // Les cartes entrées avant la v2.2 portent la ligne de crédits complète
  // d'Apple : « GIMS & Dadju ». Le jeu propose quatre noms et aucun n'est bon.
  // Ce bouton ramène chaque carte à un seul artiste et fusionne les doublons.
  /* ---------------- la liste des artistes à interroger ----------------
     Elle vivait en dur dans index.html : ajouter un nom voulait dire modifier
     le code, republier le site, et recommencer. Elle vit maintenant dans la
     base, comme les mentions légales : la modération l'écrit depuis l'écran,
     le constructeur la relit au moment de bâtir le catalogue. Tant qu'elle
     est vide, c'est la liste d'origine du jeu qui sert. */
  if (b.action === "liste-artistes") {
    const C = await store("config");
    if (!b.artistes) {
      const v = await C.get("artistes");
      return ok({ liste: (v && v.liste) || null, maj: (v && v.maj) || 0, par: (v && v.par) || "" });
    }
    if (u.role !== "admin") return ko(403, "Seul l'administrateur change la liste des artistes.");

    if (!Array.isArray(b.artistes)) return ko(400, "La liste doit être un tableau.");
    if (b.artistes.length > 3000) return ko(413, "3 000 artistes au maximum.");

    /* On accepte « Nom » ou [« Nom », poids]. Le poids dit à quel point
       l'artiste est grand public : il pèse sur la popularité des titres, donc
       sur la rareté des cartes. 3 = tout le monde le connaît, 1 = confidentiel. */
    const vus = new Set(), propre = [];
    for (const brut of b.artistes) {
      const nom = String(Array.isArray(brut) ? brut[0] : brut).trim().slice(0, 120);
      if (!nom) continue;
      const cle = norm(nom);
      if (!cle || vus.has(cle)) continue;          // doublon, ou nom qui ne veut rien dire
      vus.add(cle);
      let poids = Number(Array.isArray(brut) ? brut[1] : 2);
      if (!Number.isFinite(poids)) poids = 2;
      propre.push([nom, Math.max(1, Math.min(3, Math.round(poids)))]);
    }
    if (!propre.length) return ko(400, "Aucun nom exploitable dans cette liste.");

    await C.set("artistes", { liste: propre, maj: Date.now(), par: u.pseudo });
    return ok({ liste: propre, enregistres: propre.length,
      ignores: b.artistes.length - propre.length });
  }

  /* Revenir à la liste d'origine du jeu : on efface, le jeu reprend la sienne. */
  if (b.action === "liste-artistes-defaut") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur change la liste des artistes.");
    await (await store("config")).del("artistes");
    return ok({ liste: null });
  }

  if (b.action === "artistes") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur répare la bibliothèque.");
    if (b.apercu) {
      const lib = await biblio.lire();
      return ok({ apercu: true, ...biblio.apercuArtistes(lib.tracks, await biblio.nomsEntiers()) });
    }
    const r = await biblio.reparerArtistes();
    return ok(r);
  }

  /* ---------------- les noms qu'on ne découpe jamais ----------------
     « Earth, Wind & Fire » n'est pas un featuring. Le garde-fou automatique
     (trois titres portant la même signature) en attrape la plupart, mais un
     duo qui n'a que deux titres dans le jeu lui échappe. Cette liste est la
     porte de sortie manuelle, et elle vit en base comme le reste. */
  if (b.action === "noms-entiers") {
    const C = await store("config");
    if (!b.noms) {
      const c = await C.get("noms-entiers");
      return ok({ noms: (c && c.noms) || [] });
    }
    if (u.role !== "admin") return ko(403, "Seul l'administrateur change cette liste.");
    const noms = [...new Set((Array.isArray(b.noms) ? b.noms : [])
      .map(x => String(x || "").trim()).filter(Boolean).map(x => x.slice(0, 120)))].slice(0, 500);
    await C.set("noms-entiers", { noms, maj: Date.now(), par: u.pseudo });
    return ok({ noms });
  }

  /* ---------------- les noms composés, à la loupe ----------------
     « Un seul artiste par carte » fait son travail et rend un compteur. Un
     compteur ne dit pas si le travail est BIEN fait. Cet écran montre les deux
     côtés de la décision, carte par carte :
       · ce qui a été découpé — la ligne d'origine est gardée en crédits, donc
         on peut toujours la relire et revenir en arrière ;
       · ce qui a été laissé entier — les groupes, repérés automatiquement ou
         déclarés à la main.
     C'est la réponse à « je ne suis pas sûr que tout ait été bien renommé ». */
  if (b.action === "composes") {
    const lib = await biblio.lire();
    const entiers = await biblio.nomsEntiers();

    const decoupes = new Map();   // ligne d'origine -> { avant, apres, titres }
    const gardes = new Map();     // ligne restée entière -> { nom, titres }
    for (const t of lib.tracks) {
      if (biblio.plusieursArtistes(t.artist)) {
        const k = norm(t.artist);
        const e = gardes.get(k) || { nom: t.artist, titres: 0,
          declare: entiers.has(k), exemples: [] };
        e.titres++;
        if (e.exemples.length < 3) e.exemples.push(t.title);
        gardes.set(k, e);
        continue;
      }
      // découpée : la ligne complète survit dans les crédits
      if (t.credits && biblio.plusieursArtistes(t.credits)) {
        const k = norm(t.credits) + "→" + norm(t.artist);
        const e = decoupes.get(k) || { avant: t.credits, apres: t.artist, titres: 0, exemples: [] };
        e.titres++;
        if (e.exemples.length < 3) e.exemples.push(t.title);
        decoupes.set(k, e);
      }
    }

    const parTitres = (a, b2) => b2.titres - a.titres;
    return ok({
      decoupes: [...decoupes.values()].sort(parTitres).slice(0, 400),
      gardes: [...gardes.values()].sort(parTitres).slice(0, 400),
      seuil: biblio.SEUIL_GROUPE
    });
  }

  /* Annuler un découpage : on rend aux cartes leur ligne d'origine et on
     ajoute cette ligne à la liste des noms qu'on ne découpe jamais, pour que
     la prochaine réparation ne recommence pas. Les deux vont ensemble — l'un
     sans l'autre ne tiendrait pas dix minutes. */
  if (b.action === "retablir") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur revient sur un découpage.");
    const ligne = String(b.ligne || "").trim();
    if (!ligne) return ko(400, "Quelle ligne ?");

    const lib = await biblio.lire();
    const SIG = await store("signatures");
    let rendues = 0;
    const vus = new Set(lib.tracks.map(t => signature(t)));
    for (const t of lib.tracks) {
      if (norm(t.credits || "") !== norm(ligne)) continue;
      const avant = signature(t);
      t.artist = ligne;
      t.credits = "";
      const apres = signature(t);
      if (avant !== apres) {
        vus.delete(avant); vus.add(apres);
        await SIG.del(avant).catch(() => {});
      }
      rendues++;
    }
    if (!rendues) return ko(404, "Aucune carte ne porte cette ligne en crédits.");
    await biblio.ecrire(lib);

    // et on la protège, sinon la prochaine réparation la redécoupe
    const C = await store("config");
    const c = await C.get("noms-entiers");
    const noms = [...new Set([...(((c && c.noms) || [])), ligne])].slice(0, 500);
    await C.set("noms-entiers", { noms, maj: Date.now(), par: u.pseudo });

    return ok({ rendues, ligne, proteges: noms.length });
  }

  /* ---------------- vérifier les artistes auprès d'Apple ----------------
     Le problème de fond : la bibliothèque a été bâtie en cherchant des NOMS.
     Or un nom n'est pas une identité — « Jul » attrape un autre Jul, « Booba »
     un dessin animé, et une recherche floue rend des morceaux qui n'ont rien à
     voir. D'où des centaines de sons rangés sous le mauvais artiste.

     La solution durable tient en une phrase : **on garde l'identifiant Apple
     du morceau, donc on peut toujours redemander à Apple qui en est
     l'auteur.** Le navigateur interroge Apple par paquets de 200 identifiants,
     compare, et envoie ici ce qu'il faut corriger. Le serveur ne fait
     confiance à rien : il revalide chaque fiche avant de l'écrire.

     Ça se relance quand on veut, et ça converge — une fois passé, il ne reste
     que les morceaux qu'Apple ne connaît plus. */
  /* ON GRAVE L'IDENTIFIANT D'ARTISTE, MÊME QUAND LE NOM EST BON (v2.7.6).
     C'est ce qui manquait pour attraper les homonymes : deux artistes qui
     s'appellent vraiment pareil (deux « SDM ») passent la vérification par nom
     sans rien déclencher, puisque le nom EST le bon. Seul l'identifiant les
     distingue. On profite donc du passage chez Apple pour l'écrire sur chaque
     morceau, sans rien renommer. */
  if (b.action === "artistes-identifiants") {
    if (u.role !== "admin") return ko(403, "Réservé à l'administrateur.");
    const l = Array.isArray(b.identifiants) ? b.identifiants.slice(0, 2000) : [];
    if (!l.length) return ko(400, "Rien à graver.");
    const lib = await biblio.lire();
    const parId = new Map(lib.tracks.map(t => [String(t.id), t]));
    let graves = 0, absents = 0;
    for (const x of l) {
      const t = parId.get(String(x.id));
      if (!t) { absents++; continue; }
      const aid = x.artistId ? String(x.artistId) : null;
      if (!aid || String(t.artistId || "") === aid) continue;
      t.artistId = aid;
      graves++;
    }
    if (graves) await biblio.ecrire(lib);
    return ok({ graves, absents });
  }

  /* Un nom, plusieurs artistes. On ne devine rien : on regroupe les morceaux
     par nom d'artiste et on regarde combien d'IDENTIFIANTS Apple différents ce
     nom recouvre. Deux identifiants sous « SDM » = deux personnes. */
  if (b.action === "homonymes") {
    if (u.role !== "admin") return ko(403, "Réservé à l'administrateur.");
    const lib = await biblio.lire();
    const parNom = new Map();
    let sansId = 0;
    for (const t of lib.tracks) {
      if (!t.artistId) { sansId++; continue; }
      const k = norm(t.artist);
      if (!parNom.has(k)) parNom.set(k, new Map());
      const g = parNom.get(k);
      const id = String(t.artistId);
      if (!g.has(id)) g.set(id, { artistId: id, nb: 0, exemples: [] });
      const e = g.get(id);
      e.nb++;
      if (e.exemples.length < 4) e.exemples.push({ id: t.id, title: t.title, album: t.album || "", year: t.year || null });
      e.nom = t.artist;
    }
    const conflits = [];
    for (const [, g] of parNom) {
      if (g.size < 2) continue;
      const groupes = [...g.values()].sort((x, y) => y.nb - x.nb);
      conflits.push({ nom: groupes[0].nom, total: groupes.reduce((a, x) => a + x.nb, 0), groupes });
    }
    conflits.sort((a, b2) => b2.total - a.total);
    return ok({ conflits: conflits.slice(0, 60), sansId, total: lib.tracks.length });
  }

  /* Trancher : on garde un identifiant, les autres sortent du jeu. */
  if (b.action === "homonyme-trancher") {
    if (u.role !== "admin") return ko(403, "Réservé à l'administrateur.");
    const nom = norm(String(b.nom || ""));
    const garder = String(b.garder || "");
    if (!nom || !garder) return ko(400, "Il faut un nom et l'identifiant à garder.");

    const lib = await biblio.lire();
    const vises = lib.tracks.filter(t => norm(t.artist) === nom && t.artistId
      && String(t.artistId) !== garder);
    if (b.apercu) {
      return ok({ apercu: true, nb: vises.length,
        exemples: vises.slice(0, 40).map(t => ({ id: t.id, title: t.title, artist: t.artist })) });
    }
    if (!vises.length) return ok({ retires: 0 });
    const SIG = await store("signatures");
    let retires = 0;
    for (const t of vises) {
      const r = await biblio.retirer(String(t.id));
      if (r) { retires++; await SIG.del(signature(r)).catch(() => {}); }
    }
    return ok({ retires, total: (await biblio.lire()).tracks.length });
  }

  if (b.action === "artistes-verifies") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur corrige la bibliothèque.");
    const corr = Array.isArray(b.corrections) ? b.corrections.slice(0, 2000) : [];
    if (!corr.length) return ko(400, "Rien à corriger.");

    const lib = await biblio.lire();
    const parId = new Map(lib.tracks.map(t => [String(t.id), t]));
    const SIG = await store("signatures");
    const entiers = await biblio.nomsEntiers();
    const lignes = new Map();
    for (const t of lib.tracks) {
      const k = norm(t.artist);
      lignes.set(k, (lignes.get(k) || 0) + 1);
    }

    /* LE JOURNAL DE LA DERNIÈRE CORRECTION (v2.7.8).
       Une correction en masse qui ne se défait pas est une correction qu'on
       n'ose pas lancer. On garde donc, pour chaque morceau touché, ce qu'il
       était AVANT — de quoi tout remettre en place d'un bouton. Un seul niveau :
       la dernière passe. C'est ce qui manque quand on s'aperçoit après coup que
       le lot n'était pas bon. */
    const JOU = await store("corrections");
    const precedent = b.debut ? null : await JOU.get("derniere");
    const journal = (precedent && Array.isArray(precedent.lignes)) ? precedent.lignes : [];

    let corriges = 0, absents = 0, inchanges = 0;
    for (const c of corr) {
      const t = parId.get(String(c.id));
      if (!t) { absents++; continue; }
      const nom = String(c.artist || "").trim().slice(0, 120);
      if (!nom) { absents++; continue; }
      // la règle du premier crédité s'applique aussi à ce qu'Apple renvoie
      const seul = biblio.artistePrincipal(nom, { entiers, lignes });
      const final = seul || nom;
      if (norm(final) === norm(t.artist)) { inchanges++; continue; }
      const avant = signature(t);
      journal.push({ id: String(t.id), artist: t.artist,
        credits: t.credits || "", artistId: t.artistId || null });
      t.credits = t.credits || (seul ? nom : "");
      t.artist = final;
      if (c.artistId) t.artistId = c.artistId;
      const apres = signature(t);
      if (avant !== apres) await SIG.del(avant).catch(() => {});
      corriges++;
    }
    if (corriges) await biblio.ecrire(lib);
    if (corriges || b.debut) {
      await JOU.set("derniere", { quand: Date.now(), par: u.pseudo,
        lignes: journal.slice(-8000) });
    }
    return ok({ corriges, inchanges, absents, total: lib.tracks.length,
      annulables: journal.length });
  }

  /* Les identifiants des morceaux à vérifier, par paquets. Le navigateur ne
     peut pas demander la bibliothèque entière — elle ne lui est plus envoyée
     depuis la v2.6 — donc c'est le serveur qui découpe. */
  /* Ce qu'on peut encore défaire, et depuis quand. */
  if (b.action === "journal-verification") {
    if (u.role !== "admin") return ko(403, "Réservé à l'administrateur.");
    const j = await (await store("corrections")).get("derniere");
    if (!j || !Array.isArray(j.lignes) || !j.lignes.length) return ok({ vide: true });
    return ok({ vide: false, quand: j.quand, par: j.par || "", nb: j.lignes.length,
      exemples: j.lignes.slice(0, 30).map(x => ({ id: x.id, artist: x.artist })) });
  }

  /* Tout remettre comme avant la dernière correction. */
  if (b.action === "annuler-verification") {
    if (u.role !== "admin") return ko(403, "Réservé à l'administrateur.");
    const JOU = await store("corrections");
    const j = await JOU.get("derniere");
    if (!j || !Array.isArray(j.lignes) || !j.lignes.length) return ko(404, "Il n'y a rien à annuler.");

    const lib = await biblio.lire();
    const parId = new Map(lib.tracks.map(t => [String(t.id), t]));
    const SIG = await store("signatures");
    let rendus = 0, disparus = 0;
    for (const l of j.lignes) {
      const t = parId.get(String(l.id));
      if (!t) { disparus++; continue; }
      const sigActuelle = signature(t);
      t.artist = l.artist;
      t.credits = l.credits || "";
      t.artistId = l.artistId || null;
      if (signature(t) !== sigActuelle) await SIG.del(sigActuelle).catch(() => {});
      rendus++;
    }
    if (rendus) await biblio.ecrire(lib);
    await JOU.del("derniere").catch(() => {});
    return ok({ rendus, disparus, quand: j.quand });
  }

  if (b.action === "a-verifier") {
    if (u.role !== "admin") return ko(403, "Réservé à l'administrateur.");
    const lib = await biblio.lire();
    /* REPRENDRE (v2.7.7). Une vérification interrompue — Apple qui freine sur
       la fin, un onglet fermé — ne doit pas obliger à tout refaire. Les
       identifiants déjà gravés servent de marque-page : en mode « manquants »,
       on ne rend que les morceaux qui n'en ont pas encore. */
    const source = b.manquants ? lib.tracks.filter(t => !t.artistId) : lib.tracks;
    const depuis = Math.max(0, Number(b.depuis) || 0);
    const paquet = Math.min(200, Math.max(1, Number(b.paquet) || 200));
    const tranche = source.slice(depuis, depuis + paquet);
    return ok({
      total: source.length,
      depuis, suivant: depuis + tranche.length,
      pistes: tranche.map(t => ({ id: t.id, artist: t.artist, title: t.title, artistId: t.artistId || null }))
    });
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

  /* ---------------- retirer des sons par liste ----------------
     L'inverse de l'import : on colle une liste « Artiste - Titre », le
     serveur dit lesquels il trouve, et ne retire que sur confirmation. */
  if (b.action === "retirer-liste") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur retire des sons en nombre.");
    const lignes = Array.isArray(b.lignes) ? b.lignes.slice(0, 2000) : [];
    if (!lignes.length) return ko(400, "Aucune ligne.");

    const lib = await biblio.lire();
    const parSig = new Map();
    lib.tracks.forEach(t => {
      const k = norm(t.artist) + "|" + norm(t.title);
      if (!parSig.has(k)) parSig.set(k, []);
      parSig.get(k).push(t);
    });

    const trouves = [], absents = [];
    const vus = new Set();
    for (const brut of lignes) {
      const l = String(brut || "").trim();
      if (!l) continue;
      const p = decouperLigne(l);
      if (!p) { absents.push(l); continue; }
      // on essaie « Artiste - Titre », puis « Titre - Artiste » : personne ne
      // se souvient de l'ordre au moment de coller une liste.
      const a1 = norm(p[0]) + "|" + norm(p[1]);
      const a2 = norm(p[1]) + "|" + norm(p[0]);
      const t = parSig.get(a1) || parSig.get(a2);
      if (!t) { absents.push(l); continue; }
      t.forEach(x => { if (!vus.has(x.id)) { vus.add(x.id); trouves.push(x); } });
    }

    if (b.apercu) {
      return ok({ apercu: true, trouves: trouves.length, absents: absents.length,
        exemples: trouves.slice(0, 40).map(t => ({ artist: t.artist, title: t.title, id: t.id })),
        introuvables: absents.slice(0, 40) });
    }

    const SIG = await store("signatures");
    let retires = 0;
    for (const t of trouves) {
      const r = await biblio.retirer(String(t.id));
      if (r) { retires++; await SIG.del(signature(r)); }
    }
    return ok({ retires, absents: absents.length, total: (await biblio.lire()).tracks.length });
  }

  /* ---------------- les comptes ----------------
     Qui joue, depuis quand, avec quel rôle. « Qui est connecté » n'existe
     pas : le jeu ne tient pas de sessions ouvertes, il signe des jetons
     valables six mois. Ce qu'on peut dire honnêtement, c'est la dernière
     fois que chaque compte a écrit quelque chose — c'est cette colonne-là
     qu'on affiche, et pas une pastille verte qui mentirait. */
  if (b.action === "joueurs") {
    const U = await store("utilisateurs");
    const cles = (await U.list("")).slice(0, 2000);
    const l = [];
    for (const cle of cles) {
      const j = await U.get(cle);
      if (!j) continue;
      const g = j.jeu || {};
      l.push({
        uid: j.uid, pseudo: j.pseudo, role: j.role || "joueur",
        cree: j.cree || 0, vu: j.maj || 0,
        cartes: Array.isArray(g.coffre) ? g.coffre.length : 0,
        credits: g.credits || 0,
        sets: g.sets || 0,
        propositions: (j.stats && j.stats.propositions) || 0,
        validees: (j.stats && j.stats.validees) || 0,
        email: !!(j.email && j.email.adresse),
        jetons: Math.max(0, Number(j.jetons) || 0),
        crew: j.crew || null
      });
    }
    l.sort((x, y) => y.vu - x.vu);
    const fond = await (await store("config")).get("fondateur");
    return ok({ joueurs: l, total: l.length, fondateur: (fond && fond.uid) || null });
  }

  if (b.action === "joueur-role") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur change les rôles.");
    const U = await store("utilisateurs");
    const cible = await U.get(String(b.uid || ""));
    if (!cible) return ko(404, "Compte introuvable.");
    if (cible.uid === u.uid) return ko(409, "On ne change pas son propre rôle.");
    const role = String(b.role || "joueur");
    if (!["joueur", "moderateur", "admin"].includes(role)) return ko(400, "Rôle inconnu.");
    cible.role = role;
    await ecrireUtilisateur(cible);
    return ok({ pseudo: cible.pseudo, role: cible.role });
  }

  if (b.action === "joueur-supprimer") {
    if (u.role !== "admin") return ko(403, "Seul l'administrateur supprime un compte.");
    const U = await store("utilisateurs");
    const cible = await U.get(String(b.uid || ""));
    if (!cible) return ko(404, "Compte introuvable.");
    if (cible.uid === u.uid) return ko(409, "Supprime ton propre compte depuis ton profil.");
    const fond = await (await store("config")).get("fondateur");
    if (fond && fond.uid === cible.uid) return ko(409, "Le compte fondateur ne se supprime pas d'ici.");
    /* Le pseudo doit être retapé : supprimer un compte efface une collection
       entière, et un clic de trop ne doit pas suffire. */
    if (String(b.confirmation || "").trim() !== cible.pseudo)
      return ko(400, "Retape le pseudo exactement pour confirmer.");
    const { effacerCompte } = await import("./compte.mjs");
    const r = await effacerCompte(cible);
    return ok(r);
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

/* Une ligne collée par un humain : « Artiste - Titre », « Artiste — Titre »,
   « Artiste | Titre », ou séparé par une tabulation. On ne coupe que sur le
   PREMIER séparateur : « Jul - Tchikita - remix » doit donner un titre entier,
   et les noms à tiret comme « Jean-Jacques Goldman » ne doivent pas exploser. */
export function decouperLigne(l) {
  const m = String(l).match(/^(.+?)\s*(?:\t|\s\u2014\s|\s\u2013\s|\s-\s|\s*\|\s*)(.+)$/);
  if (!m) return null;
  const a = m[1].trim(), t = m[2].trim();
  return (a && t) ? [a, t] : null;
}
