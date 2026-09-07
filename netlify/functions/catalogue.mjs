// /api/catalogue — ce que le navigateur a besoin de savoir sur la bibliothèque,
// et rien de plus.
//
// Jusqu'à la v2.5 cette adresse renvoyait la bibliothèque ENTIÈRE à chaque
// joueur qui ouvrait le jeu : 14 000 cartes, huit mégaoctets, à chaque
// chargement. C'était tenable à 2 000 sons ; à 14 000 c'était plusieurs
// secondes d'écran blanc sur un téléphone, et à 20 000 la réponse dépassait
// ce qu'une fonction Netlify sait renvoyer d'un coup. La limite de 20 000 sons
// n'était pas une limite du jeu : c'était le point où le site cassait.
//
// Le navigateur n'avait en réalité besoin que de trois choses :
//   · de quoi remplir l'écran des goûts — une liste d'artistes, pas de titres ;
//   · de quoi afficher le poids du jeu en bas de page — des compteurs ;
//   · un extrait pour le bouton « tester le son ».
// Les cartes, elles, sont tirées par le serveur et n'ont jamais transité par
// ici. Tout le reste (chercher un titre, en presser un, ouvrir un set partagé)
// passe désormais par /api/bibliotheque, qui répond page par page.
//
// Résultat : ~300 Ko au lieu de 8 Mo, et le nombre de sons dans le jeu ne
// change plus rien au temps de chargement.

import { ok, preflight, ko } from "./_lib.mjs";
import { store } from "./_store.mjs";
import { lireCache as lire } from "./_biblio.mjs";

export const config = { path: "/api/catalogue" };

// Assez d'artistes pour l'écran des goûts et pour ce qui viendra ; pas assez
// pour peser quoi que ce soit.
const ARTISTES_MAX = 300;

/* Un artiste, sa meilleure carte, et combien il en a. C'est tout ce dont
   l'écran des goûts a besoin : il affiche une pochette et un nom. */
function artistesDe(tracks) {
  const par = new Map();
  for (const t of tracks) {
    const nom = t.artist;
    if (!nom) continue;
    let e = par.get(nom);
    if (!e) { e = { n: nom, c: 0, pop: -1, art: "", id: null }; par.set(nom, e); }
    e.c++;
    if ((t.pop || 0) > e.pop) { e.pop = t.pop || 0; e.art = t.art || ""; e.id = t.id; }
  }
  return { total: par.size,
    liste: [...par.values()].sort((a, b) => b.pop - a.pop).slice(0, ARTISTES_MAX) };
}

/* Le calcul parcourt toute la bibliothèque : on ne le refait que lorsqu'elle
   a bougé. La clé du cache est la date de dernière modification. */
async function leger(b) {
  const C = await store("cache");
  const rev = (b.meta && b.meta.rev) || 0;
  const v = await C.get("catalogue-leger").catch(() => null);
  if (v && v.rev === rev && v.titres === b.tracks.length) return v;

  const a = artistesDe(b.tracks);
  const neuf = {
    rev, titres: b.tracks.length,
    artistes: a.liste,
    nbArtistes: a.total,
    // De quoi faire marcher le bouton « tester le son » sans télécharger le
    // reste. On garde une poignée d'extraits, pas un seul : si Apple en retire
    // un, le bouton continue de fonctionner.
    tests: b.tracks.filter(t => t.preview).slice(0, 400)
      .filter((_, i) => i % 40 === 0)
      .map(t => ({ artist: t.artist, title: t.title, preview: t.preview }))
  };
  await C.set("catalogue-leger", neuf).catch(() => {});
  return neuf;
}

export default async function (req) {
  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "GET") return ko(405, "méthode non autorisée");

  const b = await lire();
  // Les mentions légales sont publiques par nature : elles voyagent avec le
  // catalogue, ça évite un appel de plus au chargement du jeu.
  const editeur = await (await store("config")).get("editeur");
  const meta = { ...b.meta, source: "bibliothèque Diggers", editeur: editeur || null };

  /* La bibliothèque entière, sur demande explicite. Elle n'est plus servie au
     chargement du jeu : cette forme reste pour les outils (export, scripts) et
     n'est jamais appelée par un joueur. */
  if (new URL(req.url).searchParams.get("complet") === "1")
    return ok({ meta, tracks: b.tracks }, { "cache-control": "public, max-age=60" });

  const l = await leger(b);
  return ok({
    meta: { ...meta, artistes: l.nbArtistes },
    artistes: l.artistes,
    /* Un extrait par minute : tout le monde voit le même pendant une minute,
       donc le cache du réseau reste cohérent, et il change quand même. */
    test: l.tests.length ? l.tests[Math.floor(Date.now() / 60000) % l.tests.length] : null
  }, { "cache-control": "public, max-age=60" });
}
